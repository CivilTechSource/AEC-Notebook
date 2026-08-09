// notes.ipc.js — markdown notes inside a project's meta dir.
//
// Every mutation tells the search index which DOCUMENT changed, not just "something did". The
// blunt invalidate() made the next query re-read every note in every project, which on a synced
// drive is a download per file and a failure when offline.
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
    // Capture what the file says NOW, before it's overwritten — the history is "what it used to
    // say". Awaited so the snapshot can't race the write that supersedes it; maybeSnapshot
    // rate-limits itself, so on a typical autosave this is an in-memory check and returns at once.
    await history.maybeSnapshot(p, name);
    const written = await trackedWrite(p, storage.writeNote(p, name, content));
    searchIndex.invalidateNote(p, written);   // `written` carries the .md suffix the caller may have omitted
    return written;
  }));
  ipcMain.handle('notes:create', guarded(async (_e, { path: p, base }) => {
    const name = await trackedWrite(p, storage.createNote(p, base));
    searchIndex.invalidateNote(p, name);
    return name;
  }));
  ipcMain.handle('notes:rename', guarded(async (_e, { path: p, oldName, newBase }) => {
    const finalName = await storage.renameNote(p, oldName, newBase);
    // Both names move: the old id has to leave the index, the new one has to enter it.
    searchIndex.invalidateNote(p, oldName.endsWith('.md') ? oldName : `${oldName}.md`);
    searchIndex.invalidateNote(p, finalName);
    // Move the history with the note, or its versions are orphaned under the old name.
    await history.renameHistory(p, oldName, finalName);
    return finalName;
  }));
  ipcMain.handle('notes:delete', guarded(async (_e, { path: p, name }) => {
    const done = await storage.deleteNote(p, name);
    searchIndex.invalidateNote(p, name.endsWith('.md') ? name : `${name}.md`);
    return done;
  }));
  ipcMain.handle('notes:rewriteLinks', guarded(async (_e, { path: p, from, to }) => {
    const res = await search.rewriteWikilinks(p, from, to);
    // Only the notes that actually changed — rewriteWikilinks already reports them.
    for (const file of res.files) searchIndex.invalidateNote(p, file);
    return res;
  }));
}

module.exports = { register };
