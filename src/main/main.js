// main.js — app lifecycle only: the window, the plugin scheme, the fs-change bridge, quit draining.
// IPC handlers live in ipc/ (registered in one call below); the path allowlist is in pathGuard.js.
const { app, BrowserWindow, shell, protocol } = require('electron');
const path = require('path');
const storage = require('./services/storage');
const pluginHost = require('./services/pluginHost');
const searchIndex = require('./services/searchIndex');
const watcher = require('./services/watcher');
const { buildMenu } = require('./menu');
const { drainOnQuit } = require('./writeTracker');
const windowState = require('./windowState');
const ipc = require('./ipc');

// Plugin pages are served from their own scheme so they get an independent CSP
// (the app's strict script-src can't reach into them). Must be registered before app-ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pnplugin', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const APP_ROOT = path.join(__dirname, '..', '..');

const IS_MAC = process.platform === 'darwin';

function createWindow(restored = { bounds: windowState.DEFAULTS, maximized: false }) {
  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth: 1100,
    minHeight: 700,
    title: 'AEC Notebook',
    backgroundColor: '#1b2030',
    // The app draws its own title bar. On macOS keep the traffic lights (hiddenInset); elsewhere
    // go fully frameless and supply our own controls. autoHideMenuBar keeps the native menu
    // reachable via Alt without it occupying a permanent row inside the window.
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,          // the preload only uses contextBridge + ipcRenderer, which work sandboxed
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  win.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));
  // Maximise before showing, or the window visibly snaps a frame after appearing.
  if (restored.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  windowState.track(win);

  // A link in a rendered note must never navigate the app window off index.html — that leaves
  // the user in a browser with no way back. Send external links to the real browser instead.
  const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
  const openExternally = (url) => {
    let u; try { u = new URL(url); } catch { return; }
    if (EXTERNAL_SCHEMES.has(u.protocol)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return;   // in-page reload is fine
    e.preventDefault();
    openExternally(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: 'deny' }; });

  // Forward renderer errors to the main process stdout (low-noise diagnostics).
  // Electron >= 35 passes a single details object with a string `level`.
  win.webContents.on('console-message', (details) => {
    if (details?.level === 'error') console.log(`[renderer:ERROR] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => console.log(`[did-fail-load] ${code} ${desc}`));

  // Keep the custom title bar's maximise/restore glyph in step with the real window state,
  // including when the user double-clicks the bar or uses a Windows snap gesture.
  const sendState = () => {
    if (!win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized() });
  };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('enter-full-screen', sendState);
  win.on('leave-full-screen', sendState);

  return win;
}

// Serve plugin pages: pnplugin://p/?id=<pluginId>
function registerPluginProtocol() {
  protocol.handle('pnplugin', async (req) => {
    try {
      const id = new URL(req.url).searchParams.get('id');
      const html = await pluginHost.pageFor(APP_ROOT, id);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': pluginHost.CSP } });
    } catch (e) {
      // The message can carry plugin-controlled text (manifest filename) — escape it.
      const msg = String(e.message).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      return new Response(`<pre>Plugin load error: ${msg}</pre>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  });
}

// Single-instance lock — prevents stale/duplicate windows from piling up.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWin = null;
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });
  app.whenReady().then(async () => {
    // One-time move of pre-1.0 data from the hardcoded macOS path (see storage.centralRoot).
    await storage.migrateLegacyRoot().catch((e) => console.log(`[storage] ${e.message}`));
    // Collect temp files stranded by a previous crash or forced quit. Fire-and-forget: this is
    // tidying, and it must never delay the window appearing.
    storage.sweepStaleTemps(storage.centralRoot()).catch(() => {});

    registerPluginProtocol();
    ipc.registerAll({ appRoot: APP_ROOT });

    mainWin = createWindow(await windowState.load());
    buildMenu(mainWin);

    // Tell the renderer when project data changes on disk outside the app.
    watcher.onChange((change) => {
      // The watcher already knows exactly what changed, so tell the index that rather than
      // throwing the whole thing away — an external edit to one note shouldn't cost a re-read of
      // every note in every project the next time the quick switcher opens.
      if (change.kind === 'note' && change.noteName) searchIndex.invalidateNote(change.projectPath, change.noteName);
      else if (change.kind === 'project') searchIndex.invalidateProject(change.projectPath);
      else searchIndex.invalidate();
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('fs:changed', change);
    });
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) { mainWin = createWindow(await windowState.load()); buildMenu(mainWin); }
    });
  });
}

// Writes that must not be cut short by app quit.
drainOnQuit(app);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
