// By default, browserify sets process.platform to 'browser'. Atom needs a
// real value for process.platform because it does a lot of resource loading
// based on this variable (including keyboard shortcut registration!).
function detectPlatform() {
  let platform = 'browser';
  let userAgentPlatform;
  try {
    userAgentPlatform = window.navigator.platform;
  } catch (e) {
    console.error(`Could not find the platform: assuming '${platform}'.`);
    return platform;
  }

  if (userAgentPlatform.includes('Mac')) {
    platform = 'darwin';
  } else if (userAgentPlatform.includes('Linux')) {
    platform = 'linux';
  } else if (userAgentPlatform.includes('Win')) {
    platform = 'win32';
  }

  return platform;
}
process.platform = detectPlatform();

window.setImmediate = function(callback) {
  Promise.resolve().then(callback);
};

const pathModule = require('path');

const resourcePath = ATOM_RESOURCE_PATH;

// This exists in a GitHub checkout of Atom, but I cannot seem to
// find it under /Applications/Atom.app/.
const menusDirPath = resourcePath + '/menus';
const menusConfigFile = menusDirPath + '/menu.json';

// process.env.ATOM_DEV_RESOURCE_PATH = '/This/is/fake';
process.env.ATOM_HOME = '/This/is/.atom';
process.resourcesPath = resourcePath;

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
    ATOM_HOME: process.env.ATOM_HOME,
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

// Unfortunately, I'm not sure why this hack works. Between fs, multiple versions
// of fs-plus, and browserfs, there are a lot of entities trying to do funny things
// with the fs module. We need to do some work to ensure only one instance of is
// is used in the system. lstatSyncNoException is an API introduced by fs-plus, but
// somehow it was missing when calling atom.project.addPath() when tree-view is loaded.
fs.lstatSyncNoException = function(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (e) {
    return null;
  }
};

for (const fileName in ATOM_FILES_TO_ADD) {
  addFile(fileName, ATOM_FILES_TO_ADD[fileName]);
}

const atomPackages = [];

for (const pkgName in ATOM_PACKAGE_DATA) {
  const packageData = ATOM_PACKAGE_DATA[pkgName];
  atomPackages.push({
    name: pkgName,
    main: packageData.metadata.main,
  });
  const entryMap = packageData['files'];
  for (const fileName in entryMap) {
    const contents = entryMap[fileName];
    addFile(fileName, contents);
  }
}

fsPlus.resolveOnLoadPath = function(...args) {
  return fsPlus.resolve.apply(fsPlus, require('module').globalPaths.concat(args));
};

// TODO: Find a better way to hack this?
require('module').globalPaths = [];
require('module').paths = [];

// If we want to try a non-null blobStore:
//     const FileSystemBlobStore = require('../src/file-system-blob-store.js');
//     blobStore = new FileSystemBlobStore('/tmp');


// Ultimately, two things should happen:
// 1. tree-view should be fixed so it can tolerate an empty state.
// 2. This should be able to be specified from the caller if someone
//    creates a webapp that
const atomPackageInitialState = {
  'tree-view': {
    attached: true,
  },
};

const initializeApplicationWindow = require('../src/initialize-application-window');
initializeApplicationWindow({blobStore: null}).then(() => {
  require('electron').ipcRenderer.send('window-command', 'window:loaded');

  // Adding a root will cause the tree-view to pop open once it loads.
  atom.project.addPath(fsPlus.getHomeDirectory());

  for (const atomPackage of atomPackages) {
    const {name, main} = atomPackage;
    atom.packages.activatePackage(ATOM_PACKAGE_ROOT_FROM_BROWSERIFY + '/' + name);
    const initialState = atomPackageInitialState[name];
    // TODO(mbolin): Use main to eliminate the repeated calls to require() with
    // one line of code in this loop. May be a problem for browserify's static pass.
  }

  require('../../__atom_packages__/notifications/lib/main.js').activate();

  // For whatever reason, Atom seems to think tabs should not be auto-activated?
  // atom.packages.loadedPackages['tabs'].mainModulePath is undefined.
  // Though even if it could, it's unclear that it would load the path that Browserify
  // has prepared, so we may be better off loading it explicitly.
  require('../../__atom_packages__/tabs/lib/main.js').activate();

  require('../../__atom_packages__/find-and-replace/lib/find.js').activate();

  // tree-view does not seem to tolerate the case where it receives an empty state
  // from the previous session, so we make sure to pass one explicitly.
  const treeViewState = {attached: true};
  require('../../__atom_packages__/tree-view/lib/main.js').activate(treeViewState);
});
