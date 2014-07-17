#!/bin/bash
#
# Run this script to create a browserfied version of Atom:
#
# ./standalone/standalone.sh [--no-npm-install]
#
# See https://github.com/substack/node-browserify
# See https://github.com/atom/atom
#
# Note that this script is designed to be idempotent.

if [ "$(uname)" != "Darwin" ]; then
  echo "Sorry, currently this only works on OS X."
  exit 1
fi

set -e

cd "$(git rev-parse --show-toplevel)"

# Run the build script to get all of the dependencies and generated files in place.
if [ "$1" != "--no-npm-install" ]; then
  npm install .
  ./script/build

  # Install a specific version of browserify due to
  # https://github.com/substack/node-browserify/issues/796.
  npm install browserify@3.9.1
  npm install envify@1.2.0
  npm install less
fi

browserify=node_modules/browserify/bin/cmd.js
coffee=node_modules/coffee-script/bin/coffee
lessc=node_modules/less/bin/lessc

rm -rf node_modules/atom
mkdir -p node_modules/atom

cp -R src node_modules/atom/src
cp -R exports node_modules/atom/exports
cp package.json node_modules/atom
find node_modules/atom -name \*.coffee | xargs -I {} $coffee --compile {}

# I'm still trying to figure out which one it should be.
ATOM_APP=atom-shell/Atom.app
ATOM_APP=/Applications/Atom.app

# TODO: Programmatically remove CommandInstaller stuff.

ATOM_NODE_MODULES=node_modules/atom/node_modules

# common
common_libs=$ATOM_APP/Contents/Resources/atom/common/api/lib/*.js
for fullfile in $common_libs
do
  filename=$(basename "$fullfile")
  filename="${filename%.*}"
  rm -rf $ATOM_NODE_MODULES/$filename
  mkdir -p $ATOM_NODE_MODULES/$filename
  cp $fullfile $ATOM_NODE_MODULES/$filename
  echo "
  {
    \"name\": \"$filename\",
    \"main\": \"./$filename.js\"
  }
  " > $ATOM_NODE_MODULES/$filename/package.json
done

# clipboard
echo '
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
' > node_modules/atom/src/clipboard.js

# ipc
rm -rf $ATOM_NODE_MODULES/ipc
mkdir -p $ATOM_NODE_MODULES/ipc
cp $ATOM_APP/Contents/Resources/atom/browser/api/lib/ipc.js $ATOM_NODE_MODULES/ipc
echo '
{
  "name": "ipc",
  "main": "./ipc.js"
}
' > $ATOM_NODE_MODULES/ipc/package.json

# module
rm -rf $ATOM_NODE_MODULES/module
mkdir -p $ATOM_NODE_MODULES/module
echo '
{
  "name": "module",
  "main": "./module.js"
}
' > $ATOM_NODE_MODULES/module/package.json
echo '
exports.globalPaths = [];
' > $ATOM_NODE_MODULES/module/module.js

# remote
rm -rf $ATOM_NODE_MODULES/remote
mkdir -p $ATOM_NODE_MODULES/remote
echo '
{
  "name": "remote",
  "main": "./remote.js"
}
' > $ATOM_NODE_MODULES/remote/package.json
echo '
var lastWindow;
exports.getCurrentWindow = function() {
  if (lastWindow) {
    return lastWindow;
  }

  lastWindow = {
    domWindow: window,
    loadSettings: {},
    getPosition: function() {
      return [window.screenX, window.screenY];
    },
    getSize: function() {
      return [window.innerWidth, window.innerHeight];
    },
  }

  return lastWindow;
};
' > $ATOM_NODE_MODULES/remote/remote.js

# screen
rm -rf $ATOM_NODE_MODULES/screen
mkdir -p $ATOM_NODE_MODULES/screen
echo '
exports.getPrimaryDisplay = function() {
  return {
    workAreaSize: {
      width: 1024,
      height: 800,
    },
  };
};
' > $ATOM_NODE_MODULES/screen/screen.js
echo '
{
  "name": "screen",
  "main": "./screen.js"
}
' > $ATOM_NODE_MODULES/screen/package.json

# shell
rm -rf $ATOM_NODE_MODULES/shell
mkdir -p $ATOM_NODE_MODULES/shell
echo '
exports.beep = function() {
  // TODO: beep().
};
' > $ATOM_NODE_MODULES/shell/shell.js
echo '
{
  "name": "shell",
  "main": "./shell.js"
}
' > $ATOM_NODE_MODULES/shell/package.json

# text-buffer
cp -R node_modules/text-buffer node_modules/atom/node_modules

# Unfortunately, pathwatcher doesn't have a browserify alternative built-in,
# so we have to create our own.
PATHWATCHER_SHIMS=node_modules/pathwatcher/shims
mkdir -p $PATHWATCHER_SHIMS
cp standalone/pathwatcher.js $PATHWATCHER_SHIMS/pathwatcher.js
sed -i '' -e 's#^{$#{"browser": "./shims/pathwatcher.js",#' node_modules/pathwatcher/package.json

echo "
window.atom = require('./atom').loadOrCreate('editor');
atom.initialize();

window.TextBuffer = require('text-buffer');
window.Editor = require('./editor');
window.EditorView = require('./editor-view');
window.DisplayBuffer = require('./display-buffer');
window.PaneView = require('./pane-view');

// atom.startEditorWindow();
" > node_modules/atom/src/standalone-atom.js
# Probably want to add --require atom/editor, etc.
OUTFILE=standalone/atom.js
$browserify \
   --ignore bindings \
   --ignore oniguruma \
   --ignore onig-reg-exp \
   --ignore tls \
   --ignore scrollbar-style \
   --ignore git-utils \
   --outfile $OUTFILE \
   node_modules/atom/src/standalone-atom.js

# For some reason, the module shim is not working, so just delete this line.
sed -i '' -e "/require('module').globalPaths.push(exportsPath);/d" $OUTFILE

# Workaround for https://github.com/atom/first-mate/commit/cb58560c0d6be658870f65056c802cf4113c8091.
sed -i '' -e 's#return scanner = new OnigScanner(patterns);#return scanner = {findNextMatch:function(a,b,callback){if (typeof callback === "function") callback(null, null);return null},findNextMatchSync:function(){return null}}#' $OUTFILE

# Generate the CSS for the UI from the LESS source files.
CSS_OUT=standalone/atom.css
rm -f $CSS_OUT
touch $CSS_OUT
LESS_INCLUDE_PATH=static/variables
# This list of files came from running the following in Atom's developer console:
# var styles = document.getElementsByTagName('style'); for (var i = 0; i < styles.length; i++) console.log(style.id)
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/bootstrap/less/bootstrap.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/static/atom.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/archive-view/stylesheets/archive-view.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/background-tips/stylesheets/background-tips.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/bookmarks/stylesheets/bookmarks.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/bracket-matcher/stylesheets/bracket-matcher.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/deprecation-cop/stylesheets/deprecation-cop.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/feedback/stylesheets/feedback.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/git-diff/stylesheets/git-diff.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/image-view/stylesheets/image-view.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/keybinding-resolver/stylesheets/keybinding-resolver.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/markdown-preview/stylesheets/markdown-preview.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/release-notes/stylesheets/release-notes.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/settings-view/stylesheets/settings-view.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/spell-check/stylesheets/spell-check.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/status-bar/stylesheets/status-bar.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/styleguide/stylesheets/styleguide.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/tabs/stylesheets/tabs.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/timecop/stylesheets/timecop.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/tree-view/stylesheets/tree-view.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/wrap-guide/stylesheets/wrap-guide.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/find-and-replace/stylesheets/find-and-replace.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/atom-dark-syntax/index.less >> $CSS_OUT
$lessc --include-path=$LESS_INCLUDE_PATH $ATOM_APP/Contents/Resources/app/node_modules/atom-dark-ui/index.less >> $CSS_OUT

echo "Load file://$PWD/standalone/atom.html?loadSettings={\"resourcePath\":\"\"} in Google Chrome."
echo "Make sure to enable ES6 features via chrome://flags for Set support."
