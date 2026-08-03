// plugins.ipc.js — plugin discovery. The pages themselves are served over the pnplugin://
// scheme (see main.js) so they get their own CSP; plugin code never runs in this process.
const { ipcMain, shell } = require('electron');
const plugins = require('../services/plugins');

function register({ appRoot }) {
  ipcMain.handle('plugins:list', () => plugins.listPlugins(appRoot));
  ipcMain.handle('plugins:source', (_e, { id }) => plugins.readPluginSource(appRoot, id));
  // Where users install their own plugins — the Plugins page shows this and can open it.
  ipcMain.handle('plugins:userDir', () => plugins.userPluginsRoot());
  ipcMain.handle('plugins:openUserDir', async () => {
    const dir = plugins.userPluginsRoot();
    if (!dir) return false;
    await require('fs/promises').mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  });
}

module.exports = { register };
