// notes.ipc.js — markdown notes inside a project's meta dir.
// Any mutation invalidates the search index.
const { ipcMain } = require('electron');
const storage = require('../services/storage');
const search = require('../services/search');
const searchIndex = require('../services/searchIndex');
const history = require('../services/history');
const { guarded } = require('../pathGuard');
const { trackedWrite } = require('../writeTracker');

function register() {
  ipcMain.handle('notes:list', guarded((_e, { path: p }) => storage.listNotes(p)));
  ipcMain.handle('notes:read', guarded((_e, { path: p, name }) => storage.readNote(p, name)));
  ipcMain.handle('notes:write', guarded(async (_e, { path: p, name, content }) => {
    searchIndex.invalidate();
    // Capture what the file says NOW, before it's overwritten — the history is "what it used to
    // say". Awaited so the snapshot can't race the write that supersedes it; maybeSnapshot
    // rate-limits itself, so on a typical autosave this is an in-memory check and returns at once.
    await history.maybeSnapshot(p, name);
    return trackedWrite(p, storage.writeNote(p, name, content));
  }));
  ipcMain.handle('notes:create', guarded((_e, { path: p, base }) => {
    searchIndex.invalidate();
    return trackedWrite(p, storage.createNote(p, base));
  }));
  ipcMain.handle('notes:rename', guarded(async (_e, { path: p, oldName, newBase }) => {
    searchIndex.invalidate();
    const finalName = await storage.renameNote(p, oldName, newBase);
    // Move the history with the note, or its versions are orphaned under the old name.
    await history.renameHistory(p, oldName, finalName);
    return finalName;
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
