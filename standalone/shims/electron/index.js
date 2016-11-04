const listeners = {};
const handlers = {};

function dispatch(action, ...args) {
  console.info('dispatch', action, ...args, listeners[action]);
  (listeners[action] || []).forEach(function(listener) {
    listener(action, ...args);
  })
}

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
  windowDimensions: {
    x: 130,
    y: 45,
    width: 918,
    height: 760,
    maximized: false,
  },
  textEditors: {
    editorGrammarOverrides: {},
  },
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
        isFullScreen: function() { return false; },
        getPosition() { return [0, 0]; },
        getSize() { return [800, 600]; },
        isMaximized() {},
      }
    },

    screen: {
      getPrimaryDisplay() {
        return {
          workAreaSize: {},
        };
      },
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
