// files.ipc.js — native file/folder pickers, and handing a file to the OS.
const { ipcMain, dialog, shell } = require('electron');
const { addPickedPath, openableFile } = require('../pathGuard');

function register() {
  ipcMain.handle('dialog:pickFolder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled) return null;
    addPickedPath(res.filePaths[0]);   // user consented to this one explicitly
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:pickFile', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (res.canceled) return null;
    addPickedPath(res.filePaths[0]);
    return res.filePaths[0];
  });

  ipcMain.handle('file:open', async (_e, { path: p }) => shell.openPath(await openableFile(p)));
  ipcMain.handle('file:reveal', async (_e, { path: p }) => { shell.showItemInFolder(await openableFile(p)); return true; });
}

module.exports = { register };
