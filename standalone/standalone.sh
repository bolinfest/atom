#!/bin/bash
#
# Run this script to create a browserfied version of Atom:
#
# ./standalone/standalone.sh [--no-build]
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
if [ "$1" != "--no-build" ]; then
  npm install .
  ./script/build
fi

# Install a specific version of browserify due to
# https://github.com/substack/node-browserify/issues/796.
npm install browserify@3.9.1
npm install envify@1.2.0

browserify=/Users/mbolin/src/node-browserify/bin/cmd.js
coffee=node_modules/coffee-script/bin/coffee

rm -rf node_modules/atom
mkdir -p node_modules/atom

cp -R src node_modules/atom/src
cp -R exports node_modules/atom/exports
cp package.json node_modules/atom
find node_modules/atom -name \*.coffee | xargs -I {} $coffee --compile {}

# I'm still trying to figure out which one it should be.
ATOM_APP=atom-shell/Atom.app
ATOM_APP=/Applications/Atom.app

# TODO(mbolin): Should be copying to node_modules/atom/node_modules/XXX.
# TODO(mbolin): Need to copy CSS to web page.
# TODO(mbolin): Need to actually use Editor in web page.

# common
common_libs=$ATOM_APP/Contents/Resources/atom/common/api/lib/*.js
for fullfile in $common_libs
do
  filename=$(basename "$fullfile")
  filename="${filename%.*}"
  rm -rf node_modules/$filename
  mkdir -p node_modules/$filename
  cp $fullfile node_modules/$filename
  echo "
  {
    \"name\": \"$filename\",
    \"main\": \"./$filename.js\"
  }
  " > node_modules/$filename/package.json
done

# ipc
rm -rf node_modules/ipc
mkdir -p node_modules/ipc
cp $ATOM_APP/Contents/Resources/atom/browser/api/lib/ipc.js node_modules/ipc
echo '
{
  "name": "ipc",
  "main": "./ipc.js"
}
' > node_modules/ipc/package.json

# remote
rm -rf node_modules/remote
mkdir -p node_modules/remote
echo '
{
  "name": "remote",
  "main": "./remote.js"
}
' > node_modules/remote/package.json
echo '
exports.getCurrentWindow = function() {
  // This method appears to be called when Atom is being initialized.
  var currentWindow = window;
  if (currentWindow.loadSettings === undefined) {
    currentWindow.loadSettings = {};
  }
  return currentWindow;
};
' > node_modules/remote/remote.js

# shell
rm -rf node_modules/shell
mkdir -p node_modules/shell
echo '
exports.beep = function() {
  // TODO: beep().
};
' > node_modules/shell/shell.js
echo '
{
  "name": "shell",
  "main": "./shell.js"
}
' > node_modules/shell/package.json

# Unfortunately, pathwatcher doesn't have a browserify alternative built-in,
# so we have to create our own.
PATHWATCHER_SHIMS=node_modules/pathwatcher/shims
mkdir -p $PATHWATCHER_SHIMS
cp standalone/pathwatcher.js $PATHWATCHER_SHIMS/pathwatcher.js
sed -i '' -e 's#^{$#{"browser": "./shims/pathwatcher.js",#' node_modules/pathwatcher/package.json

echo "
window.atom = require('./atom').loadOrCreate('editor');
window.Editor = require('./editor');
" > node_modules/atom/src/standalone-atom.js
$browserify \
   --ignore bindings \
   --ignore oniguruma \
   --ignore onig-reg-exp \
   --ignore screen \
   --ignore tls \
   --outfile standalone/atom.js \
   node_modules/atom/src/standalone-atom.js

echo "Load file://$PWD/standalone/atom.html?loadSettings={} in Google Chrome."
