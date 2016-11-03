function File(path, symlink) {
  this.path = path;
  this.symlink = symlink !== undefined ? symlink : false;
  this.realPath = null;
  this.cachedContents = null;
}

File.prototype.isFile = function() {
  return true;
};

File.prototype.isDirectory = function() {
  return false;
};

File.prototype.setPath = function(path) {
  this.realPath = null;
};

File.prototype.getPath = function() {
  return this.path;
};

File.prototype.on = function(eventType, callback) {
  // TODO: Create a WebSocket to pump in events for:
  // - contents-changed
  // - removed
  // - moved
};

exports.File = File;

exports.watch = function(path, callback) {

};

exports.closeAllWatchers = function() {

};

exports.closeAllWatchers = function() {

};

exports.getWatchedPaths = function() {
  return [];
};
