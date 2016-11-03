function Clipboard() {
  this.metadata = null;
  this.signatureForMetadata = null;
}

Clipboard.prototype = {
  md5: function(text) {
    // TODO: Pure JS implementation of md5.
    return "6d5c9d3b291785b69f79aa5bda210b79cbb8bd94";
  },

  /** Write the given text to the clipboard. */
  write: function(text, metadata) {
    // Do nothing.
  },

  /** Read the text from the clipboard. */
  read: function() {
    return "";
  },

  readWithMetadata: function() {
    return {text: ""};
  },
};

module.exports = Clipboard;
