// ipc/index.js — the single place every IPC handler module gets registered.
//
// Adding a channel is still a three-step change (see CONTRIBUTING.md): a handler in the right
// ipc/<area>.ipc.js, an entry in preload.js, and the guarded() wrapper if it takes a path.
// A brand new area also needs its module listed here.
const MODULES = [
  require('./files.ipc'),
  require('./config.ipc'),
  require('./project.ipc'),
  require('./notes.ipc'),
  require('./attachments.ipc'),
  require('./search.ipc'),
  require('./templates.ipc'),
  require('./history.ipc'),
  require('./plugins.ipc'),
  require('./appearance.ipc'),
  require('./window.ipc'),
];

function registerAll(ctx) {
  for (const m of MODULES) m.register(ctx);
}

module.exports = { registerAll };
