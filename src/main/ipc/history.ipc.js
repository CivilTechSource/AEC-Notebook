// history.ipc.js — reading a note's version history.
//
// There is no restore channel on purpose: restoring is just writing the old content back through
// notes:write, which snapshots the current version on its way past. So a restore is itself
// undoable, and there's one write path rather than two.
const { ipcMain } = require('electron');
const history = require('../services/history');
const { guarded, assertAllowed } = require('../pathGuard');
const { tracked } = require('../writeTracker');

function register() {
  ipcMain.handle('history:list', guarded((_e, { path: p, name }) => history.listSnapshots(p, name)));
  ipcMain.handle('history:read', guarded((_e, { path: p, name, ts }) => history.readSnapshot(p, name, ts)));

  // Called by the Storage page when the history location setting changes. Without it the existing
  // snapshots stay where they were and the History panel reports "no earlier versions" for notes
  // that plainly have some.
  ipcMain.handle('history:relocate', async (_e, { paths, from, to }) => {
    for (const p of paths || []) await assertAllowed(p);
    let moved = 0;
    for (const p of paths || []) moved += await tracked(history.relocate(p, from, to));
    return moved;
  });
}

module.exports = { register };
