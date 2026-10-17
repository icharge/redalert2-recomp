// Linked in front of ra2.js (--pre-js). A wasm trap in the game's thread is a
// JavaScript exception with no C frame to catch it, so the page side asks the
// host for the report: ra2_crash_report prints the lifted function that was
// running, the last import, the registers and the ring of indirect calls
// (docs/web/architecture.md, "Faults"). The state is in shared memory, so
// it is still there once the thread is gone.
var Module = typeof Module !== 'undefined' ? Module : {};

(function () {
  var reported = false;
  function report(why) {
    if (reported) return;
    reported = true;
    try {
      Module.ccall('ra2_crash_report', null, ['string'], [why]);
    } catch (e) {
      console.error('(no crash report: ' + e + ')');
    }
  }
  Module.ra2CrashReport = report;
  var previous = Module.onAbort;
  Module.onAbort = function (what) {
    report('abort: ' + what);
    if (previous) previous(what);
  };
  // This file also runs in every pthread worker, where the trap happens first;
  // only the main thread reports and exits, since a worker's exit code is not
  // the process's. Emscripten forwards the worker's exception to the main thread.
  var onMainThread = true;
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try { onMainThread = require('worker_threads').isMainThread; } catch (e) {}
    if (onMainThread) {
      process.on('uncaughtException', function (e) {
        report((e && e.name === 'RuntimeError' ? 'wasm trap: ' : 'uncaught: ') + (e && e.message ? e.message : e));
        process.exit(3);
      });
    }
  } else if (typeof window !== 'undefined') {
    window.addEventListener('error', function (ev) {
      report('uncaught: ' + (ev.message || ev.error));
    });
  }
})();
