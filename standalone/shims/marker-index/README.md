# Pure JavaScript implementation of marker-index

These `.coffee` files are taken from the last version of marker-index.coffee
before it was replaced by a native implementation:
https://github.com/atom/text-buffer/commit/ef5bab6e08b1e4249ec0998a710903126e32c42b

Note that the `.coffee` files are just here for reference.
Since we have to hack them up anyway, we ran [decaffeinate](
https://www.npmjs.com/package/decaffeinate) on the original files to convert
them to JavaScript and then hacked on them from there.

To make things extra fun, we also had to remove the use of `import` and `export`
injected by `decaffeinate` to make things easier for Browserify.
