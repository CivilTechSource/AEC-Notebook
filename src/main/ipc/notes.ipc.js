// notes.ipc.js — markdown notes inside a project's meta dir.
// Any mutation invalidates the search index.
const { ipcMain } = require('electron');
const storage = require('../services/storage');
const search = require('../services/search');
const searchIndex = require('../services/searchIndex');
const { guarded } = require('../pathGuard');
const { trackedWrite } = require('../writeTracker');

function register() {
  ipcMain.handle('notes:list', guarded((_e, { path: p }) => storage.listNotes(p)));
  ipcMain.handle('notes:read', guarded((_e, { path: p, name }) => storage.readNote(p, name)));
  ipcMain.handle('notes:write', guarded((_e, { path: p, name, content }) => {
    searchIndex.invalidate();
    return trackedWrite(p, storage.writeNote(p, name, content));
  }));
  ipcMain.handle('notes:create', guarded((_e, { path: p, base }) => {
    searchIndex.invalidate();
    return trackedWrite(p, storage.createNote(p, base));
  }));
  ipcMain.handle('notes:rename', guarded((_e, { path: p, oldName, newBase }) => {
    searchIndex.invalidate();
    return storage.renameNote(p, oldName, newBase);
  }));
  ipcMain.handle('notes:delete', guarded((_e, { path: p, name }) => {
    searchIndex.invalidate();
    return storage.deleteNote(p, name);
  }));
  ipcMain.handle('notes:rewriteLinks', guarded((_e, { path: p, from, to }) => {
    searchIndex.invalidate();
    return search.rewriteWikilinks(p, from, to);
  }));
}

module.exports = { register };
