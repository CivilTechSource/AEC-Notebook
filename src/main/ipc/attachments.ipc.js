// attachments.ipc.js — files dropped or pasted into a note, stored under <metaDir>/attachments/.
const { ipcMain, shell } = require('electron');
const storage = require('../services/storage');
const search = require('../services/search');
const { guarded } = require('../pathGuard');
const { trackedWrite } = require('../writeTracker');

function register() {
  ipcMain.handle('attach:save', guarded((_e, { path: p, filename, base64 }) => trackedWrite(p, storage.saveAttachment(p, filename, base64))));
  ipcMain.handle('attach:read', guarded((_e, { path: p, rel }) => storage.readAttachment(p, rel)));
  ipcMain.handle('attach:open', guarded(async (_e, { path: p, rel }) => {
    const abs = await storage.attachmentAbsPath(p, rel);
    return shell.openPath(abs);
  }));
  // Reveal resolves the absolute path HERE rather than handing it to the renderer, for the same
  // reason open does: the renderer names an attachment, it never names a filesystem location.
  ipcMain.handle('attach:reveal', guarded(async (_e, { path: p, rel }) => {
    shell.showItemInFolder(await storage.attachmentAbsPath(p, rel));
    return true;
  }));

  // The board's Attachments section. Listing is cheap (readdir + stat); the reference scan reads
  // every note in the project, so the renderer caches it per project rather than calling it on
  // every board draw — see projectBoard.js.
  ipcMain.handle('attach:list', guarded((_e, { path: p }) => storage.listAttachments(p)));
  ipcMain.handle('attach:refs', guarded((_e, { path: p }) => search.findAttachmentRefs(p)));
  ipcMain.handle('attach:delete', guarded((_e, { path: p, rel }) => trackedWrite(p, storage.deleteAttachment(p, rel))));
}

module.exports = { register };
