// config.ipc.js — the central config store (settings, library, schemas, session, plugins).
const { ipcMain } = require('electron');
const storage = require('../services/storage');
const searchIndex = require('../services/searchIndex');
const scanner = require('../services/scanner');
const { invalidateRoots } = require('../pathGuard');
const { tracked } = require('../writeTracker');

function register() {
  ipcMain.handle('config:read', (_e, { filename }) => storage.readConfig(filename));
  ipcMain.handle('config:write', (_e, { filename, data }) => {
    if (filename === 'library.json') invalidateRoots();   // the path allowlist just changed
    if (filename === 'settings.json') {
      // Storage mode, app folder name and history location all move where data LIVES, so every
      // indexed document and every cached orphan lookup now points at the wrong place. This is
      // the case the blunt invalidate() still exists for.
      searchIndex.invalidate();
      scanner.invalidateOrphans();
    }
    return tracked(storage.writeConfig(filename, data));
  });

  // Where the app actually keeps its data on THIS platform (the Storage page shows it).
  ipcMain.handle('app:centralRoot', () => storage.centralRoot());
}

module.exports = { register };
