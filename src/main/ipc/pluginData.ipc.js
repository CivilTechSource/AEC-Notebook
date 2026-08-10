// pluginData.ipc.js — a plugin's own file store (see services/pluginData.js).
//
// No guarded() wrapper here, and that is deliberate. guarded() checks a path against the library
// root allowlist; every path in this module is DERIVED from centralRoot() plus a validated plugin
// id, and the config root is not a library root — the allowlist would fail closed on every call.
// Containment is asserted inside pluginData.js instead.
//
// The one renderer-supplied path is `src` on plugin:importFile, and it is a SOURCE to read, not a
// destination to write. It comes from the native picker, which is the user's consent gesture and
// already routes through addPickedPath in files.ipc.js.
const { ipcMain, shell } = require('electron');
const pluginData = require('../services/pluginData');
const { tracked } = require('../writeTracker');

function register() {
  ipcMain.handle('pluginData:import', (_e, { id, src }) => tracked(pluginData.importFile(id, src)));
  ipcMain.handle('pluginData:list', (_e, { id }) => pluginData.listFiles(id));
  ipcMain.handle('pluginData:read', (_e, { id, name }) => pluginData.readFile(id, name));
  ipcMain.handle('pluginData:delete', (_e, { id, name }) => tracked(pluginData.deleteFile(id, name)));

  // Resolved here rather than handed to the renderer, for the same reason attach:open does it:
  // the caller names a stored file, it never names a filesystem location.
  ipcMain.handle('pluginData:open', (_e, { id, name }) => shell.openPath(pluginData.absPath(id, name)));
  ipcMain.handle('pluginData:reveal', (_e, { id, name }) => {
    shell.showItemInFolder(pluginData.absPath(id, name));
    return true;
  });
}

module.exports = { register };
