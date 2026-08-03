// search.ipc.js — MiniSearch index for full-text; file-scan for backlinks.
const { ipcMain } = require('electron');
const search = require('../services/search');
const searchIndex = require('../services/searchIndex');
const { guarded } = require('../pathGuard');

function register() {
  ipcMain.handle('search:run', (_e, { query, projects }) => searchIndex.query(query, projects));
  ipcMain.handle('search:backlinks', guarded((_e, { path: p, name }) => search.findBacklinks(p, name)));
}

module.exports = { register };
