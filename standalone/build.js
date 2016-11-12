// Non-standard line at top so Atom does not try to compile this.

'use strict'
/* @flow */

const {COMPILERS, compileFileAtPath, setAtomHomeDirectory} = require('../src/compile-cache');
const browserify = require('browserify');
const fs = require('fs-plus');
const path = require('path');
const {spawnSync} = require('child_process');
const through = require('through');
const watchify = require('watchify');
const chokidar = require('chokidar');

const willWatch = process.argv[2] == '-w'; //ghetto
let startedWatching = false;

function build() {
  // This is necessary to set the compile-cache.
  setAtomHomeDirectory(path.join(fs.getHomeDirectory(), '.atom'));

  // TODO(mbolin): Run `yarn check || yarn --force` in gitRoot?
  const gitRoot = path.normalize(path.join(__dirname, '..'));
  const standaloneDir = path.join(gitRoot, 'standalone');
  const nodeModules = path.join(standaloneDir, 'node_modules');

  // Create a new node_modules directory.
  fs.removeSync(nodeModules);
  fs.makeTreeSync(nodeModules);

  // Move the relevant source code from Atom that we need to browserify under
  // node_modules/atom.
  fs.makeTreeSync(nodeModules + '/atom/src');
  fs.makeTreeSync(nodeModules + '/atom/exports');
  // TODO(mbolin): Read in the new package.json and programmatically remove dependencies we don't
  // want to include right now and then write it back out.
  copyFileSyncWatch(gitRoot + '/package.json', nodeModules + '/atom/package.json');

  // When we copy src/ and exports/, we must also transpile everything inside.
  copySyncWatch(
    gitRoot + '/src',
    nodeModules + '/atom/src',
    tree => fs.traverseTreeSync(tree, transpileFile, () => true)
  );
  copySyncWatch(
    gitRoot + '/exports',
    nodeModules + '/atom/exports',
    tree => fs.traverseTreeSync(tree, transpileFile, () => true)
  );
  copySyncWatch(
    gitRoot + '/static',
    nodeModules + '/atom/static',
    tree => {}
  );
  copyFileSyncWatch(gitRoot + '/static/octicons.woff', standaloneDir + '/out/octicons.woff');

  // Do copy-sync work for a fixed set of Atom packages that must be installed in your
  // ~/.atom/dev/packages directory.
  const atomPackages = [
    'find-and-replace',
    'notifications',
    'tabs',
    'tree-view',
  ];
  const atomPackagesDir = `${standaloneDir}/node_modules/__atom_packages__`;
  fs.makeTreeSync(atomPackagesDir);

  // Every entry in this app has the path to the "main" file in package.json.
  const devPackagesDir = `${process.env.HOME}/.atom/dev/packages`;
  const filesTypesToCopyFromPackage = new Set(['.cson', '.js', '.json', '.less']);
  const atomPackageData = {};
  const entryPoints = [];
  for (const pkg of atomPackages) {
    atomPackageData[pkg] = {};

    const destinationDir = `${atomPackagesDir}/${pkg}`;
    copySyncWatch(
      `${devPackagesDir}/${pkg}`,
      destinationDir,
      tree => fs.traverseTreeSync(tree, transpileFile, () => true));

    const entries = atomPackageData[pkg]['files'] = {};
    fs.traverseTreeSync(
      destinationDir,
      fileName => {
        const extension = path.extname(fileName);
        if (filesTypesToCopyFromPackage.has(extension)) {
          entries[fileName] = fs.readFileSync(fileName, 'utf8');
        }
      },
      directoryName => {
        return directoryName !== 'node_modules';
      }
    );

    // Resolve the "main" attribute of package.json.
    const manifest = JSON.parse(fs.readFileSync(`${destinationDir}/package.json`), 'utf8');
    let {main} = manifest;

    if (main == null) {
      main = `${destinationDir}/index.js`;
    } else {
      main = path.resolve(destinationDir, main);
      if (fs.isDirectorySync(main)) {
        main = `${path.normalize(main)}/index.js`;
      }
      if (!fs.isFileSync(main)) {
        main = main + '.js';
      }
    }
    entryPoints.push(main);
    atomPackageData[pkg]['metadata'] = {main};
  }

  // Insert some shims.
  copyFileSyncWatch(
    standaloneDir + '/shims/clipboard.js',
    nodeModules + '/atom/src/clipboard.js');
  [
    'electron',
    'remote',
    'screen',
    'shell',
  ].forEach(moduleName => createShimWithPaths(moduleName, standaloneDir, nodeModules));

  // Call browserify on node_modules/atom/src/standalone-atom.js.
  const browserifyInputFile = nodeModules + '/atom/src/standalone-atom.js';
  copyFileSyncWatch(standaloneDir + '/shims/standalone-atom.js', browserifyInputFile);

  const modulesToFilter = new Set([
    // Modules with native dependencies that we do not expect to exercise at runtime.
    'onig-reg-exp',
    'runas',
    './squirrel-update',
    'tls',
    '../src/main-process/win-shell', // From exports/atom.js
  ]);

  const fullShims = new Set([
    'electron',
    'git-utils',
    'keyboard-layout',
    'nslog',
    'oniguruma',
    'pathwatcher',
    'marker-index',
    'scrollbar-style',
  ]);

  const bundler = browserify(
    [
      browserifyInputFile,
    ].concat(entryPoints),
    {
      // filter() is documented at: https://github.com/substack/module-deps#var-d--mdepsopts.
      filter(id) {
        return !modulesToFilter.has(id);
      },
      packageFilter(pkg, dir) {
        const {name} = pkg;
        if (fullShims.has(name)) {
          const clone = Object.assign({}, pkg);
          clone.browser = standaloneDir + `/shims/${name}/index.js`;
          return clone;
        } else {
          return pkg;
        }
      },
      builtins: Object.assign(
        {
          atom: nodeModules + '/atom/exports/atom.js',
          electron: `${standaloneDir}/shims/electron/index.js`
        },
        require('browserify/lib/builtins'),
        {
          buffer: require.resolve('browserfs/dist/shims/buffer.js'),
          fs: require.resolve('browserfs/dist/shims/fs.js'),
          path: require.resolve('browserfs/dist/shims/path.js'),
        }
      ),
      insertGlobalVars: {
        // process, Buffer, and BrowserFS globals.
        // BrowserFS global is not required if you include browserfs.js
        // in a script tag.
        process() { return "require('browserfs/dist/shims/process.js')" },
        Buffer() { return "require('buffer').Buffer" },
        BrowserFS() { return "require('" + require.resolve('browserfs') + "')" },
      },
      cache: {},
      packageCache: {},
      verbose: true,
    }
  ).on('log', console.log);

  const transformSuffixes = {
    // Currently, this matches both:
    //     node_modules/atom-space-pen-views/lib/select-list-view.js
    //     standalone/node_modules/__atom_packages__/find-and-replace/node_modules/atom-space-pen-views/lib/select-list-view.js
    // Though ultimately we likely want to use this to overwrite require.resolve(), in general.
    '/node_modules/atom-space-pen-views/lib/select-list-view.js': function(file, src) {
      // TODO(mbolin): Replace this crude transform with a more precise and efficient one.

      // Here, we are trying to patch up:
      //
      //    atom.themes.requireStylesheet(require.resolve('../stylesheets/select-list.less'));
      //
      // The piece that is matched by our regex is:
      //
      //    ../stylesheets/select-list.less
      //
      // Recall that we need to make it look like the file exists on the filesystem at:
      // `${atomPackagesDir}/find-and-replace/node_modules/atom-space-pen-views/stylesheets/select-list.less`
      // in the case of the find-and-replace package.
      //
      // Because we are going to replace the require.resolve() call altogether in this case,
      // there will be no require() leftover, so Browserify will not try to resolve this file at
      // all, ony the BrowserFS.FileSystem.InMemory will have to.
      return src.replace(/require.resolve\(['"]([^\)]+)['"]\)/, function(fullMatch, arg) {
        const absolutePath = path.join(path.dirname(file), arg);
        // Remember to stringify because the replacement must be a string literal.
        return JSON.stringify(absolutePath);
      });
    },
  };
  bundler.transform(
    function (file) {
      let patchTransform = null;
      for (const suffix in transformSuffixes) {
        if (file.endsWith(suffix)) {
          patchTransform = transformSuffixes[suffix];
          break;
        }
      }

      // TODO(mbolin): Prefer Node's built-in transform streams over through.
      if (patchTransform == null) {
        function write(buf) {
          this.queue(buf);
        }
        function end() {
          this.queue(null);
        }
        return through(write, end);
      } else {
        const data = [];
        function write(buf) {
          data.push(buf);
        }
        function end() {
          const src = data.join('');
          this.queue(patchTransform(file, src));
          this.queue(null);
        }
        return through(write, end);
      }
    },
    // We must set {global:true} so that transforms apply to things under node_modules.
    {global: true}
  );

  // Map of absolute paths to file contents.
  // Each of these entries will be added to the BrowserFS.FileSystem.InMemory file store at startup.
  const ATOM_FILES_TO_ADD = {};

  const ATOM_RESOURCE_PATH = '/Users/zuck/resourcePath';
  const resourceFoldersToCopy = [
    '/keymaps',
    '/menus',
    '/node_modules/atom-dark-syntax',
    '/node_modules/atom-dark-ui',
    '/node_modules/atom-light-syntax',
    '/node_modules/atom-light-ui',
    '/node_modules/atom-ui',
    '/resources',
    '/static',
  ];
  for (const folder of resourceFoldersToCopy) {
    fs.traverseTreeSync(
      gitRoot + folder,
      fileName => {
        const relative = path.relative(gitRoot, fileName);
        const entry = path.join(ATOM_RESOURCE_PATH, relative);
        ATOM_FILES_TO_ADD[entry] = fs.readFileSync(fileName, 'utf8');
      },
      directoryName => true
    );
  }

  const bundle = ids => {
    if (ids) {
      console.log('Changed', ids);
    }
    bundler.bundle((error, content) => {
      if (error != null) {
        if (error.stack) {
          console.error(error.stack);
        } else {
          console.error(String(error));
        }
      } else {
        // Clear out file before we start appending to it.
        const outFile = standaloneDir + '/out/atom.js';
        try {
          fs.unlinkSync(outFile);
        } catch(e) {
          // do nothing
        }

        function write(data) {
          fs.appendFileSync(outFile, data);
        }

        write(`var ATOM_RESOURCE_PATH = `);
        write(JSON.stringify(ATOM_RESOURCE_PATH));
        write(';\n');

        write(`var ATOM_FILES_TO_ADD = `);
        write(JSON.stringify(ATOM_FILES_TO_ADD));
        write(';\n');

        write(`var ATOM_PACKAGE_DATA = `);
        write(JSON.stringify(atomPackageData));
        write(';\n');

        write('var ATOM_PACKAGE_ROOT_FROM_BROWSERIFY = ');
        write(JSON.stringify(atomPackagesDir));
        write(';\n');

        write(content);

        // Some stylesheet insists on loading octicons.woff relative to the .html page, so we
        // include both testpage.html and octicons.woff in the out/ directory.
        try {
          fs.symlinkSync(standaloneDir + '/testpage.html', standaloneDir + '/out/testpage.html');
        } catch(e) {
          // do nothing
        }

        startedWatching = willWatch;
      }
    });
  };

  if (willWatch) {
    bundler
      .plugin(watchify)
      .on('update', bundle);
    // Example of how to watch a one-off file and have it rebulid everything:
    chokidar.watch(gitRoot + '/keymaps').on('all', () => {
      if (startedWatching) {
        bundle();
      }
    });
  }

  bundle();
}

function transpileFile(absolutePath) {
  const ext = path.extname(absolutePath);
  if (!COMPILERS.hasOwnProperty(ext)) {
    return;
  }

  const compiler = COMPILERS[ext];
  const transpiledSource = compileFileAtPath(compiler, absolutePath, ext);

  // Replace the original file extension with .js.
  const outputFile = absolutePath.substring(0, absolutePath.length - ext.length) + '.js';
  fs.writeFileSync(outputFile, transpiledSource);
}

function createShimWithPaths(moduleName, standaloneDir, nodeModules) {
  const moduleDirectory = `${nodeModules}/atom/node_modules/${moduleName}`;
  fs.makeTreeSync(moduleDirectory);
  copyFileSyncWatch(
    `${standaloneDir}/shims/${moduleName}.js`,
    `${moduleDirectory}/${moduleName}.js`);
  fs.writeFileSync(
    moduleDirectory + '/package.json',
    JSON.stringify({
      name: moduleName,
      main: `./${moduleName}.js`,
    },
    /* replacer */ undefined,
    2));
}

function copySyncWatch(from, to, then) {
  fs.copySync(from, to);
  then(to);
  if (willWatch) {
    console.log('Will watch', from);
    chokidar.watch(from).on('all', (a, b) => {
      if (startedWatching) {
        fs.copySync(from, to);
        then(to);
      }
    });
  }
}

function copyFileSyncWatch(from, to) {
  fs.copyFileSync(from, to);
  if (willWatch) {
    console.log('Will watch file', from);
    chokidar.watch(from).on('all', () => {
      if (startedWatching) {
        fs.copyFileSync(from, to);
      }
    });
  }
}

module.exports = {
  build,
};
