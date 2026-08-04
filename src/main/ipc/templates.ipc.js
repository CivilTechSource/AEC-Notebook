// templates.ipc.js — note templates.
//
// No guarded() wrapper here: none of these take a filesystem path from the renderer. They take a
// template NAME, which templates.safeTemplatePath constrains to a bare .md file inside the
// templates directory.
const { ipcMain, shell } = require('electron');
const templates = require('../services/templates');

function register() {
  ipcMain.handle('templates:list', () => templates.listTemplates());
  ipcMain.handle('templates:read', (_e, { file }) => templates.readTemplate(file));
  ipcMain.handle('templates:dir', () => templates.templatesDir());
  // Templates are meant to be edited by hand — this is how the user gets to them.
  ipcMain.handle('templates:openDir', async () => {
    await templates.ensureStarters();
    await shell.openPath(templates.templatesDir());
    return true;
  });
}

module.exports = { register };
