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
};
