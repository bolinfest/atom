// Non-standard line at top so Atom does not try to compile this.

'use strict'
/* @flow */

const {COMPILERS, compileFileAtPath, setAtomHomeDirectory} = require('../src/compile-cache');
const browserify = require('browserify');
const coffee = require('coffee-script');
const fs = require('fs-plus');
const path = require('path');
// const season = require('season');
// const {spawnSync} = require('child_process');

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
  fs.copyFileSync(gitRoot + '/package.json', nodeModules + '/atom/package.json');

  // When we copy src/ and exports/, we must also transpile everything inside.
  fs.copySync(gitRoot + '/src', nodeModules + '/atom/src');
  fs.traverseTreeSync(nodeModules + '/atom/src', transpileFile, () => {});
  fs.copySync(gitRoot + '/exports', nodeModules + '/atom/exports');
  fs.traverseTreeSync(nodeModules + '/atom/exports', transpileFile, () => {});
  fs.copySync(gitRoot + '/static', nodeModules + '/atom/static');

  // Insert some shims.
  fs.copyFileSync(
    standaloneDir + '/shims/clipboard.js',
    nodeModules + '/atom/src/clipboard.js');
  [
    'module',
    'remote',
    'screen',
    'shell',
  ].forEach(moduleName => createShimWithPaths(moduleName, standaloneDir, nodeModules));

  // Call browserify on node_modules/atom/src/standalone-atom.js.
  const browserifyInputFile = nodeModules + '/atom/src/standalone-atom.js';
  fs.copyFileSync(standaloneDir + '/shims/standalone-atom.js', browserifyInputFile);
  const modulesToIgnore = new Set([
    // Modules with native dependencies.
    'electron',
    'git-utils',
    'marker-index',
    'oniguruma',
    'onig-reg-exp',
    'scrollbar-style',
    'tls',

    '../src/main-process/win-shell', // From exports/atom.js
  ]);
  const browserifyJob = browserify(
    [browserifyInputFile],
    {
      filter(id) {
        return !modulesToIgnore.has(id);
      },

      packageFilter(pkg, dir) {
        if (pkg.name === 'pathwatcher') {
          const clone = Object.assign({}, pkg);
          clone.browser = standaloneDir + '/shims/pathwatcher.js';
          return clone;
        } else {
          return pkg;
        }
      },
    }
  );
  browserifyJob.on('error', exitOnError);
  const bundle = browserifyJob.bundle();
  bundle.on('error', exitOnError);

  const browserifyOutputFile = standaloneDir + '/out/atom.js';
  fs.makeTreeSync(path.dirname(browserifyOutputFile));
  bundle.pipe(fs.createWriteStream(browserifyOutputFile));
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
  fs.copyFileSync(
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

function exitOnError(error) {
  if (error.stack) {
    console.error(error.stack);
  }
  else {
    console.error(String(error));
  }
  process.exit(1);
}

module.exports = {
  build,
};
