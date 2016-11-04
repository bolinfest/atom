const listeners = {};
const handlers = {};

const temporaryWindowState = JSON.stringify({
  version: 1,
  project: {
    deserializer: "Project",
    paths: [],
    buffers: []
  },
  workspace: {
    deserializer: "Workspace"
  },
  fullScreen: false,
});

module.exports = {
  app: {
    getPath(arg) {
      if (arg === 'home') {
        return require('fs-plus').getHomeDirectory();
      } else {
        console.error(`app.getPath() called with ${arg}: not supported.`);
      }
    },

    getVersion() {
      // TODO: Read this from Atom's package.json.
      return '0.37.8';
    },

    on(eventName, callback) {
      console.error(`Dropping ${eventName} on the floor in Electron.`);
    },

    setAppUserModelId(modelId) {

    },
  },

  ipcRenderer: {
    on(action, cb) {
      if (!listeners[action]) {
        listeners[action] = [];
      }
      listeners[action].push(cb);
      console.info('Register IPC listener', action);
      if (action === 'ipc-helpers-get-temporary-window-state-response') {
        dispatch('ipc-helpers-get-temporary-window-state-response', temporaryWindowState);
      }
    },

    send(action, ...args) {
      var handler = handlers[action];
      if (!handler) {
        console.warn('Ignored IPC call', action, ...args);
        return;
      }
      console.log('Received IPC call', action, ...args);
      handler(...args)
    },

    removeAllListeners(action) {
      console.log('Unregister IPC', action);
      delete listeners[action];
    },
  },

  remote: {
    getCurrentWindow() {
      return {
        on: function() {},
        isFullScreen: function() {},
        getPosition() { return [0, 0]; },
        getSize() { return [800, 600]; },
        isMaximized() {},
      }
    },
  },

  webFrame: {
    setZoomLevelLimits: function() {},
  },

  screen: {
    on() {
    }
  },
};
