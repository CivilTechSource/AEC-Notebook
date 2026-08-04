// history.ipc.js — reading a note's version history.
//
// There is no restore channel on purpose: restoring is just writing the old content back through
// notes:write, which snapshots the current version on its way past. So a restore is itself
// undoable, and there's one write path rather than two.
const { ipcMain } = require('electron');
const history = require('../services/history');
const { guarded } = require('../pathGuard');

function register() {
  ipcMain.handle('history:list', guarded((_e, { path: p, name }) => history.listSnapshots(p, name)));
  ipcMain.handle('history:read', guarded((_e, { path: p, name, ts }) => history.readSnapshot(p, name, ts)));
}

module.exports = { register };
