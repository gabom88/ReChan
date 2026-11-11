// rechan_web.pre.js — glue between the Emscripten runtime and the page.
// Included with --pre-js, so it runs inside rechan.js with `Module` in scope.
// The page (shell/js/app.js) defines Module before loading rechan.js and
// provides Module.rcAssets (the IndexedDB asset store).

Module['preRun'] = Module['preRun'] || [];
Module['preRun'].push(function () {
  // Saves and settings (userfiles/) persist in IndexedDB through IDBFS.
  FS.mkdirTree('/rechan/userfiles');
  FS.mount(IDBFS, {}, '/rechan/userfiles');
  addRunDependency('rc-userfiles');
  FS.syncfs(true, function (err) {
    if (err) console.warn('[ReChan] Could not restore saves:', err);
    removeRunDependency('rc-userfiles');
  });
});

(function () {
  var syncTimer = 0;
  var syncing = false;
  var again = false;
  function doSync() {
    syncTimer = 0;
    if (syncing) { again = true; return; }
    syncing = true;
    FS.syncfs(false, function (err) {
      syncing = false;
      if (err) console.warn('[ReChan] Could not persist saves:', err);
      if (again) { again = false; schedule(); }
    });
  }
  function schedule() {
    if (!syncTimer) syncTimer = setTimeout(doSync, 400);
  }
  Module['rcPersistUserFiles'] = schedule;
  // Make sure a save made just before the app is backgrounded is flushed.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && syncTimer) {
      clearTimeout(syncTimer);
      doSync();
    }
  });
})();

Module['onRuntimeInitialized'] = (function (prev) {
  return function () {
    Module['rcInputPtr'] = Module['_rcweb_input_state']();
    if (Module['rcOnRuntimeReady']) Module['rcOnRuntimeReady']();
    if (prev) prev();
  };
})(Module['onRuntimeInitialized']);
