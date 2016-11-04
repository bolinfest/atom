// Non-standard line at top so Atom does not try to compile this.

'use strict'
/* @flow */

const {COMPILERS, compileFileAtPath, setAtomHomeDirectory} = require('../src/compile-cache');
const browserify = require('browserify');
const fs = require('fs-plus');
const path = require('path');
const {spawnSync} = require('child_process');
const CSON = require('season');
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
    tree => fs.traverseTreeSync(tree, transpileFile, () => {})
  );
  copySyncWatch(
    gitRoot + '/exports',
    nodeModules + '/atom/exports',
    tree => fs.traverseTreeSync(tree, transpileFile, () => {})
  );
  copySyncWatch(
    gitRoot + '/static',
    nodeModules + '/atom/static',
    tree => {}
  );
  copyFileSyncWatch(gitRoot + '/static/octicons.woff', standaloneDir + '/out/octicons.woff');

  // TODO: We need a build process for styles.css.
  copyFileSyncWatch(standaloneDir + '/styles.css', standaloneDir + '/out/styles.css');

  // Insert some shims.
  copyFileSyncWatch(
    standaloneDir + '/shims/clipboard.js',
    nodeModules + '/atom/src/clipboard.js');
  [
    'electron',
    'module',
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
  ])

  const bundler = browserify(
    [browserifyInputFile],
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
        {atom: nodeModules + '/atom/exports/atom.js'},
        require('browserify/lib/builtins')
      ),
      cache: {},
      packageCache: {},
      verbose: true,
    }
  ).on('log', console.log);

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
        const outFile = standaloneDir + '/out/atom.js';
        try {
          fs.unlinkSync(outFile);
        } catch(e) {
          // do nothing
        }

        function write(data) {
          fs.appendFileSync(outFile, data);
        }

        for (const name of ['base', 'darwin', 'linux', 'win32']) {
          const keymap = CSON.readFileSync(`${gitRoot}/keymaps/${name}.cson`);
          if (keymap.body) {
            delete keymap.body['cmd-c'];
            delete keymap.body['cmd-v'];
            delete keymap.body['cmd-x'];
          }
          write(`var STANDALONE_KEYMAP_${name.toUpperCase()} =`);
          write(JSON.stringify(keymap));
          write(';\n');
        }

        write(content);

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
