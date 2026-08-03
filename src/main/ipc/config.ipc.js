// config.ipc.js — the central config store (settings, library, schemas, session, plugins).
const { ipcMain } = require('electron');
const storage = require('../services/storage');
const { invalidateRoots } = require('../pathGuard');
const { tracked } = require('../writeTracker');

function register() {
  ipcMain.handle('config:read', (_e, { filename }) => storage.readConfig(filename));
  ipcMain.handle('config:write', (_e, { filename, data }) => {
    if (filename === 'library.json') invalidateRoots();   // the path allowlist just changed
    return tracked(storage.writeConfig(filename, data));
  });

  // Where the app actually keeps its data on THIS platform (the Storage page shows it).
  ipcMain.handle('app:centralRoot', () => storage.centralRoot());
}

module.exports = { register };
