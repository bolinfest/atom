window.setImmediate = function(callback) {
  Promise.resolve().then(callback);
};

const resourcePath = '/Users/zuck/resourcePath';

// This exists in a GitHub checkout of Atom, but I cannot seem to
// find it under /Applications/Atom.app/.
const templateConfigDirPath = resourcePath + '/dot-atom';
const menusDirPath = resourcePath + '/menus';
const menusConfigFile = menusDirPath + '/menu.json';

window.location.hash = '#' + JSON.stringify({
  initialPaths: [],
  locationsToOpen: [{}],
  // windowInitializationScript: 'atom/src/initialize-application-window.coffee',
  resourcePath,
  devMode: false,
  safeMode: false,
  profileStartup: false,
  clearWindowState: false,
  env: {
    ATOM_HOME: '/This/is/.atom',
    ATOM_DEV_RESOURCE_PATH: '/This/is/fake',
  },
  appVersion: '1.11.2',
  atomHome: '',
  shellLoadTime: 999,
});

process.binding = (arg) => {
  console.error(`process.binding() called with ${arg}: not supported.`);
  return {};
};

process.resourcesPath = resourcePath;

// process.env.ATOM_DEV_RESOURCE_PATH = '/This/is/fake';
process.env.ATOM_HOME = '/This/is/.atom';

const fs = require('fs-plus');
fs.getHomeDirectory = function() {
  // You could imagine we would do:
  //     return process.env.HOME || process.env.USERPROFILE;
  // but we are in a web browser! Anyone who is calling this is suspicious.
  return '/Users/zuck';
}

const {statSyncNoException} = fs;
fs.statSyncNoException = function(filePath) {
  if (filePath == process.env.ATOM_DEV_RESOURCE_PATH) {
    return {}; // This is a dummy stat object.
  } else {
    return statSyncNoException(filePath);
  }
};

fs.makeTreeSync = function(filePath) {
  if (filePath === process.env.ATOM_HOME) {
    console.error(`Ignore fs.makeTreeSync(${filePath})`);
  } else {
    throw Error(`Unsupported fs.makeTreeSync(${filePath})`);
  }
}

const {resolve} = fs;
fs.resolve = function(loadPaths, pathToResolve, extensions) {
  if (loadPaths === resourcePath && pathToResolve === 'dot-atom') {
    // This is a special case in Config.load().
    return templateConfigDirPath;
  } else if (loadPaths === menusDirPath) {
    return menusDirPath + '/menu.json';
  } else {
    return resolve(loadPaths, pathToResolve, extensions);
  }
};

const {traverseTree} = fs;
fs.traverseTree = function(rootPath, onFile, onDirectory) {
  if (rootPath === templateConfigDirPath) {
    console.warn(`Ignoring traversal of ${rootPath}: appears to be loading config.`);
  } else {
    return traverseTree(rootPath, onFile, onDirectory);
  }
};

const DUMMY_STYLESHEET = '/dummy/stylesheet/path';
const {resolveOnLoadPath} = fs;
fs.resolveOnLoadPath = function(loadPaths, pathToResolve, extensions) {
  if (Array.isArray(pathToResolve) && pathToResolve.length == 2 &&
    pathToResolve[0] === 'css' && pathToResolve[1] === 'less'
  ) {
    return DUMMY_STYLESHEET;
  } else {
    return resolveOnLoadPath.apply(fs, arguments);
  }
};

const {readFileSync} = fs;
fs.readFileSync = function(filePath, optionsOrEncoding) {
  if (optionsOrEncoding === 'utf8') {
    if (filePath === menusConfigFile) {
      console.warn(`Returning dummy menu data for readFileSync(${filePath})`);
      return JSON.stringify({
        menu: [],
      });
    } else if (filePath === DUMMY_STYLESHEET ||
      filePath.startsWith(resourcePath)
      ) {
      console.warn(`Returning empty contents for readFileSync(${filePath})`);
      return '';
    }
  }

  return readFileSync(filePath, optionsOrEncoding);
};
require('fs').readFileSync = fs.readFileSync;

// TODO: Find a better way to hack this.
require('module').globalPaths = [];

// If we want to try a non-null blobStore:
//     const FileSystemBlobStore = require('../src/file-system-blob-store.js');
//     blobStore = new FileSystemBlobStore('/tmp');

const initializeApplicationWindow = require('../src/initialize-application-window');
initializeApplicationWindow({blobStore: null}).then(() => {
  console.log('created?');
});
console.log('initializeApplicationWindow called, but what about Promise resolution?');
