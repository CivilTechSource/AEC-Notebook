// writeTracker.js — keeps in-flight disk writes alive across app quit.
//
// The renderer fires a final autosave flush from beforeunload; without tracking those promises the
// process can exit before the bytes hit disk. main.js wires drainOnQuit() to before-quit.
const watcher = require('./services/watcher');

const inFlight = new Set();

function tracked(promise) {
  inFlight.add(promise);
  return promise.finally(() => inFlight.delete(promise));
}

// A project's meta dir is created by its first write, so that's the moment it becomes watchable.
function trackedWrite(projectPath, promise) {
  watcher.ensureWatched(projectPath);
  return tracked(promise);
}

// Hold the quit until every pending write settles, then let it through.
function drainOnQuit(app) {
  let draining = false;
  app.on('before-quit', (e) => {
    if (draining || inFlight.size === 0) return;
    e.preventDefault();
    draining = true;
    Promise.allSettled([...inFlight]).then(() => app.quit());
  });
}

module.exports = { tracked, trackedWrite, drainOnQuit };
