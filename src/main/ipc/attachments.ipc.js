// attachments.ipc.js — files dropped or pasted into a note, stored under <metaDir>/attachments/.
const { ipcMain, shell } = require('electron');
const storage = require('../services/storage');
const { guarded } = require('../pathGuard');

function register() {
  ipcMain.handle('attach:save', guarded((_e, { path: p, filename, base64 }) => storage.saveAttachment(p, filename, base64)));
  ipcMain.handle('attach:read', guarded((_e, { path: p, rel }) => storage.readAttachment(p, rel)));
  ipcMain.handle('attach:open', guarded(async (_e, { path: p, rel }) => {
    const abs = await storage.attachmentAbsPath(p, rel);
    return shell.openPath(abs);
  }));
}

module.exports = { register };
