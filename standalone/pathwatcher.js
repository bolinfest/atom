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

exports.File = File;
