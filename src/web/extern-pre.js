// Linked ahead of everything in ra2.js (--extern-pre-js), including the loader of the
// preloaded data (ra2.data, the fonts), which asks Module.locateFile where it is.
// Under Node it is next to ra2.js, not in the current directory; a page sets
// locateFile itself.
var Module = typeof Module !== 'undefined' ? Module : {};
if (!Module.locateFile && typeof process !== 'undefined' && process.versions && process.versions.node && typeof __dirname !== 'undefined') {
  Module.locateFile = function (path) { return __dirname + '/' + path; };
}
