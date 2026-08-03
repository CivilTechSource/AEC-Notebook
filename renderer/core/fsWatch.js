// fsWatch.js — fan out "changed on disk" events from the main process.
//
// Subscribers pass an anchor element; when that element leaves the DOM (its tab closed) the
// subscription is dropped, so closed editors don't keep reacting to file changes.
(function () {
  const subs = [];   // { fn, anchor }

  function subscribe(fn, anchor) {
    subs.push({ fn, anchor: anchor || null });
    return () => {
      const i = subs.findIndex((s) => s.fn === fn);
      if (i >= 0) subs.splice(i, 1);
    };
  }

  function dispatch(change) {
    for (let i = subs.length - 1; i >= 0; i--) {
      const s = subs[i];
      if (s.anchor && !s.anchor.isConnected) { subs.splice(i, 1); continue; }
      try { s.fn(change); } catch (e) { console.error('fsWatch subscriber failed', e); }
    }
  }

  // Project-level changes refresh the store directly; note-level changes go to open editors.
  function start() {
    window.api.onFsChange((change) => {
      if (!change) return;
      if (change.kind === 'project') window.Store?.reloadProject?.(change.projectPath);
      dispatch(change);
    });
  }

  window.FsWatch = { subscribe, dispatch, start };
})();
