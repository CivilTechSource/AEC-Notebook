// window.ipc.js — the custom title bar.
//
// The window is frameless (see main.js createWindow), so minimise/maximise/close and the menu
// have to be driven from the renderer. Each acts on the window that sent the request.
const { ipcMain, BrowserWindow, Menu } = require('electron');
const { buildMenu } = require('../menu');

function senderWindow(e) { return BrowserWindow.fromWebContents(e.sender); }

function register() {
  ipcMain.handle('window:minimize', (e) => { senderWindow(e)?.minimize(); });
  ipcMain.handle('window:toggleMaximize', (e) => {
    const w = senderWindow(e);
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle('window:close', (e) => { senderWindow(e)?.close(); });
  ipcMain.handle('window:isMaximized', (e) => !!senderWindow(e)?.isMaximized());

  // The native menu is hidden (autoHideMenuBar); this pops it from the title bar button so it
  // stays discoverable without occupying a permanent row.
  ipcMain.handle('window:popupMenu', (e, { x, y } = {}) => {
    const w = senderWindow(e);
    if (!w) return false;
    // On a frameless window there is no menu bar to fall back on, so rebuild the menu if it has
    // somehow gone missing rather than leaving the user with no way to reach File/View at all.
    let menu = Menu.getApplicationMenu();
    if (!menu) { buildMenu(w); menu = Menu.getApplicationMenu(); }
    if (!menu) return false;
    menu.popup({ window: w, x: Math.round(x || 0), y: Math.round(y || 0) });
    return true;
  });

  ipcMain.handle('app:platform', () => process.platform);
}

module.exports = { register };
