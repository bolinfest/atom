module.exports = {
  app: {
    getPath(arg) {
      if (arg === 'home') {
        // Ideally we would do:
        //     return process.env.HOME || process.env.USERPROFILE;
        // but we are in a web browser! Anyone who is calling this is suspicious.
        return '/Users/zuck';
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
