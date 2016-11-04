process.binding = (arg) => {
  console.error(`process.binding() called with ${arg}: not supported.`);
  return {};
};

// compile-cache.js writes to this.
// require.extensions = {};

process.env.ATOM_DEV_RESOURCE_PATH = '/This/is/fake';

const {statSyncNoException} = require('fs-plus');
require('fs-plus').statSyncNoException = function(filePath) {
  if (filePath == process.env.ATOM_DEV_RESOURCE_PATH) {
    return {}; // This is a dummy stat object.
  } else {
    return statSyncNoException(filePath);
  }
};

// Let's see if dev mode helps us out.
process.argv = ['/path/to/Atom', '--dev'];

const FileSystemBlobStore = require('../src/file-system-blob-store.js');

// TODO: Find a better way to hack this.
require('module').globalPaths = [];

const initializeApplicationWindow = require('../src/initialize-application-window');
initializeApplicationWindow({blobStore: new FileSystemBlobStore('/tmp')}).then(() => {
  console.log('created?');
});
