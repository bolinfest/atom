window.setImmediate = function(callback) {
  Promise.resolve().then(callback);
};

const pathModule = require('path');

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
  console.warn(`process.binding() called with ${arg}: not supported.`);
  return {};
};

process.resourcesPath = resourcePath;

// process.env.ATOM_DEV_RESOURCE_PATH = '/This/is/fake';
process.env.ATOM_HOME = '/This/is/.atom';

// BrowserFS.install(window);
const inMemoryFs = new BrowserFS.FileSystem.InMemory();
BrowserFS.initialize(inMemoryFs);

const fsPlus = require('fs-plus');
fsPlus.getHomeDirectory = function() {
  // You could imagine we would do:
  //     return process.env.HOME || process.env.USERPROFILE;
  // but we are in a web browser! Anyone who is calling this is suspicious.
  return '/Users/zuck';
};

const fs = require('fs');
function addFile(file, contents) {
  fsPlus.makeTreeSync(pathModule.dirname(file));
  fs.writeFileSync(file, contents);
}

addFile(menusConfigFile, JSON.stringify({menu: []}));
addFile(pathModule.join(resourcePath, 'static/atom.less'), '');
fsPlus.makeTreeSync(pathModule.join(resourcePath, 'keymaps'));
fsPlus.makeTreeSync(pathModule.join(resourcePath, 'menus'));
addFile(pathModule.join(resourcePath, 'menus/browser.cson'), JSON.stringify({menu: []}));

const DUMMY_STYLESHEET = '/dummy/stylesheet/path';
fsPlus.resolveOnLoadPath = function(...args) {
  return fsPlus.resolve.apply(fsPlus, require('module').globalPaths.concat(args));
};

// TODO: Find a better way to hack this?
require('module').globalPaths = [];
require('module').paths = [];

// If we want to try a non-null blobStore:
//     const FileSystemBlobStore = require('../src/file-system-blob-store.js');
//     blobStore = new FileSystemBlobStore('/tmp');

const initializeApplicationWindow = require('../src/initialize-application-window');
initializeApplicationWindow({blobStore: null}).then(() => {
  require('electron').ipcRenderer.send('window-command', 'window:loaded');
});
