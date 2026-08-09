// project.ipc.js — project.json reads/writes, library scanning, and data migration.
// Storage mode/location is resolved in the main process from settings.json.
const { ipcMain } = require('electron');
const storage = require('../services/storage');
const scanner = require('../services/scanner');
const searchIndex = require('../services/searchIndex');
const watcher = require('../services/watcher');
const { guarded, assertAllowed } = require('../pathGuard');
const { trackedWrite } = require('../writeTracker');

function register() {
  ipcMain.handle('project:read', guarded((_e, { path: p }) => storage.readProject(p)));
  ipcMain.handle('project:write', guarded(async (_e, { path: p, data }) => {
    const rec = await trackedWrite(p, storage.writeProject(p, data));
    searchIndex.invalidateProject(p);   // the field values changed; this project's notes did not
    return rec;
  }));

  // Scanning + migration (roots go through the same allowlist as project paths)
  ipcMain.handle('scan:root', async (_e, { root, depth }) => { await assertAllowed(root); return scanner.scanRoot(root, depth); });
  // Batched: scan + reconcile + read every project in one round-trip (see scanner.scanRootWithData).
  ipcMain.handle('scan:rootWithData', async (_e, { root, depth }) => { await assertAllowed(root); return scanner.scanRootWithData(root, depth); });
  ipcMain.handle('scan:migrate', guarded((_e, { path: p }) => scanner.migrateMoved(p)));

  // After a rescan the renderer tells us the full project set so we can watch exactly those.
  ipcMain.handle('watch:set', async (_e, { paths }) => {
    for (const p of paths || []) await assertAllowed(p);
    return watcher.setWatched(paths);
  });

  ipcMain.handle('data:migrateInto', async (_e, { paths }) => {
    for (const p of paths || []) await assertAllowed(p);
    const n = await storage.migrateAllInto(paths);
    if (n) searchIndex.invalidate();      // whole projects' worth of notes just appeared
    return n;
  });
}

module.exports = { register };
