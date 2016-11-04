const FileSystemBlobStore = require('../src/file-system-blob-store.js');

const initializeApplicationWindow = require('../src/initialize-application-window');
initializeApplicationWindow({blobStore: new FileSystemBlobStore('/tmp')}).then(() => {
  console.log('created?');
});
