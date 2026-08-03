// menu.js — the native application menu.
//
// The menu bar is hidden (autoHideMenuBar) because the app draws its own title bar; the ☰ button
// pops this menu via the window:popupMenu IPC channel. Menu items talk to the renderer by sending
// menu:* messages, which preload.js allowlists in onMenu().
const { Menu } = require('electron');

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:open-folder'),
        },
        {
          label: 'Scan Folder for Projects…',
          click: () => win.webContents.send('menu:scan-folder'),
        },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit' },
      ],
    },
    // Without an Edit menu, Cmd+C/V/X/A/Z do nothing in text fields on macOS — those
    // shortcuts are driven by menu roles there, not by the web view.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Schema Editor', accelerator: 'CmdOrCtrl+E', click: () => win.webContents.send('menu:open-schema') },
        { label: 'Plugins', click: () => win.webContents.send('menu:open-plugins') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
