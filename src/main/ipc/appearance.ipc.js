// appearance.ipc.js — the user's own stylesheet.
//
// No guarded() wrapper: none of these take a filesystem path from the renderer. The path is
// always <centralRoot>/custom.css, resolved in the main process — same reasoning as templates.ipc.
const { ipcMain, shell } = require('electron');
const userStyles = require('../services/userStyles');

function register() {
  ipcMain.handle('appearance:userCssPath', () => userStyles.userCssPath());
  ipcMain.handle('appearance:readUserCss', () => userStyles.readUserCss());
  // The file is meant to be edited by hand — this is how the user gets to it. Created first so
  // the editor opens something with the tokens documented in it rather than a blank page.
  ipcMain.handle('appearance:openUserCss', async () => {
    await userStyles.ensureUserCss();
    await shell.openPath(userStyles.userCssPath());
    return true;
  });
}

module.exports = { register };
