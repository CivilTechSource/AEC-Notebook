// search.ipc.js — MiniSearch index for full-text; file-scan for backlinks.
const { ipcMain } = require('electron');
const search = require('../services/search');
const searchIndex = require('../services/searchIndex');
const { guarded, assertAllowed } = require('../pathGuard');

function register() {
  // The project list arrives from the renderer and the index reads project.json plus every note
  // under each path, so it goes through the same allowlist as every other path-taking channel.
  // This was the one handler that took paths without one.
  ipcMain.handle('search:run', async (_e, { query, projects }) => {
    for (const p of projects || []) await assertAllowed(p?.path);
    return searchIndex.query(query, projects);
  });
  ipcMain.handle('search:backlinks', guarded((_e, { path: p, name }) => search.findBacklinks(p, name)));
}

module.exports = { register };
