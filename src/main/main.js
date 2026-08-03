const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol } = require('electron');
const path = require('path');
const storage = require('./storage');
const scanner = require('./scanner');
const plugins = require('./plugins');
const pluginHost = require('./pluginHost');
const search = require('./search');
const searchIndex = require('./searchIndex');
const watcher = require('./watcher');

// Plugin pages are served from their own scheme so they get an independent CSP
// (the app's strict script-src can't reach into them). Must be registered before app-ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pnplugin', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const APP_ROOT = path.join(__dirname, '..', '..');

const IS_MAC = process.platform === 'darwin';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
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
  win.once('ready-to-show', () => win.show());

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

    // Serve plugin pages: pnplugin://p/?id=<pluginId>
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
    mainWin = createWindow();
    buildMenu(mainWin);

    // Tell the renderer when project data changes on disk outside the app.
    watcher.onChange((change) => {
      searchIndex.invalidate();
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('fs:changed', change);
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) { mainWin = createWindow(); buildMenu(mainWin); }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- path guard ----------
// Every project-scoped handler takes an absolute path from the renderer. Constrain those to
// folders the user actually registered (library.json) or picked in a native dialog this session,
// so a bug — or a compromised renderer — can't read or write arbitrary parts of the disk.
const pickedPaths = new Set();      // paths the user chose via a native dialog

function isInside(parent, child) {
  const p = path.resolve(parent), c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

// Cached: this is consulted on every project-scoped IPC call (including each note autosave),
// so re-reading the file each time would be a syscall per keystroke. Invalidated on write.
let _rootsCache = null;
function invalidateRoots() { _rootsCache = null; }
async function libraryRoots() {
  if (_rootsCache) return _rootsCache;
  try {
    const lib = await storage.readConfig('library.json');
    _rootsCache = (lib?.paths || []).map((e) => (typeof e === 'string' ? e : e.path)).filter(Boolean);
  } catch { _rootsCache = []; }      // corrupt library.json -> nothing is allowed, fail closed
  return _rootsCache;
}

async function assertAllowed(p) {
  if (typeof p !== 'string' || !p.trim() || !path.isAbsolute(p)) throw new Error('Invalid path');
  if (pickedPaths.has(path.resolve(p))) return p;
  const roots = await libraryRoots();
  if (roots.some((r) => isInside(r, p))) return p;
  // Data for a project can also live outside its folder (central/custom storage modes).
  if (isInside(storage.centralRoot(), p)) return p;
  throw new Error(`Path is outside your library folders: ${p}`);
}

// Wrap a handler so its `path` argument is checked before the storage layer sees it.
function guarded(fn) {
  return async (_e, args = {}) => { await assertAllowed(args.path); return fn(_e, args); };
}

// ---------- IPC handlers ----------

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled) return null;
  pickedPaths.add(path.resolve(res.filePaths[0]));   // user consented to this one explicitly
  return res.filePaths[0];
});

ipcMain.handle('dialog:pickFile', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (res.canceled) return null;
  pickedPaths.add(path.resolve(res.filePaths[0]));
  return res.filePaths[0];
});

// Projects (storage mode/location is resolved in the main process from settings.json)
ipcMain.handle('project:read', guarded((_e, { path: p }) => storage.readProject(p)));
ipcMain.handle('project:write', guarded((_e, { path: p, data }) => { searchIndex.invalidate(); return trackedWrite(p, storage.writeProject(p, data)); }));

// Writes that must not be cut short by app quit (the renderer fires a final autosave flush
// from beforeunload; without this the process can exit before the bytes hit disk).
const inFlight = new Set();
function tracked(promise) {
  inFlight.add(promise);
  return promise.finally(() => inFlight.delete(promise));
}

// A project's meta dir is created by its first write, so that's the moment it becomes watchable.
function trackedWrite(projectPath, promise) {
  watcher.ensureWatched(projectPath);
  return tracked(promise);
}
let draining = false;
app.on('before-quit', (e) => {
  if (draining || inFlight.size === 0) return;
  e.preventDefault();
  draining = true;
  Promise.allSettled([...inFlight]).then(() => app.quit());
});

// Notes (any mutation invalidates the search index)
ipcMain.handle('notes:list', guarded((_e, { path: p }) => storage.listNotes(p)));
ipcMain.handle('notes:read', guarded((_e, { path: p, name }) => storage.readNote(p, name)));
ipcMain.handle('notes:write', guarded((_e, { path: p, name, content }) => { searchIndex.invalidate(); return trackedWrite(p, storage.writeNote(p, name, content)); }));
ipcMain.handle('notes:create', guarded((_e, { path: p, base }) => { searchIndex.invalidate(); return trackedWrite(p, storage.createNote(p, base)); }));
ipcMain.handle('notes:rename', guarded((_e, { path: p, oldName, newBase }) => { searchIndex.invalidate(); return storage.renameNote(p, oldName, newBase); }));
ipcMain.handle('notes:delete', guarded((_e, { path: p, name }) => { searchIndex.invalidate(); return storage.deleteNote(p, name); }));
ipcMain.handle('notes:rewriteLinks', guarded((_e, { path: p, from, to }) => { searchIndex.invalidate(); return search.rewriteWikilinks(p, from, to); }));

// Attachments
ipcMain.handle('attach:save', guarded((_e, { path: p, filename, base64 }) => storage.saveAttachment(p, filename, base64)));
ipcMain.handle('attach:read', guarded((_e, { path: p, rel }) => storage.readAttachment(p, rel)));
ipcMain.handle('attach:open', guarded(async (_e, { path: p, rel }) => { const abs = await storage.attachmentAbsPath(p, rel); return shell.openPath(abs); }));

// Open a file the user chose for a "file" field, or reveal it. These paths are arbitrary by
// design — a field value picked in an earlier session won't be in the allowlist — so they get a
// lighter check: must be an absolute path to a file that exists. Handing it to the OS opens it in
// the default app; it can't read data back into the renderer.
async function openableFile(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('Invalid path');
  const st = await require('fs/promises').stat(p);
  if (!st.isFile()) throw new Error('Not a file');
  return p;
}
ipcMain.handle('file:open', async (_e, { path: p }) => shell.openPath(await openableFile(p)));
ipcMain.handle('file:reveal', async (_e, { path: p }) => { shell.showItemInFolder(await openableFile(p)); return true; });

// ---------- custom title bar ----------
// The window is frameless (see createWindow), so minimise/maximise/close and the menu have to
// be driven from the renderer. Each acts on the window that sent the request.
function senderWindow(e) { return BrowserWindow.fromWebContents(e.sender); }

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

// Where the app actually keeps its data on THIS platform (the Storage page shows it).
ipcMain.handle('app:centralRoot', () => storage.centralRoot());

// Config (schema + settings, central store)
ipcMain.handle('config:read', (_e, { filename }) => storage.readConfig(filename));
ipcMain.handle('config:write', (_e, { filename, data }) => {
  if (filename === 'library.json') invalidateRoots();   // the path allowlist just changed
  return tracked(storage.writeConfig(filename, data));
});

// Scanning + migration (roots go through the same allowlist as project paths)
ipcMain.handle('scan:root', async (_e, { root, depth }) => { await assertAllowed(root); return scanner.scanRoot(root, depth); });
// Batched: scan + reconcile + read every project in one round-trip (see scanner.scanRootWithData).
ipcMain.handle('scan:rootWithData', async (_e, { root, depth }) => { await assertAllowed(root); return scanner.scanRootWithData(root, depth); });
// After a rescan the renderer tells us the full project set so we can watch exactly those.
ipcMain.handle('watch:set', async (_e, { paths }) => {
  for (const p of paths || []) await assertAllowed(p);
  return watcher.setWatched(paths);
});
ipcMain.handle('scan:migrate', guarded((_e, { path: p }) => scanner.migrateMoved(p)));
ipcMain.handle('data:migrateInto', async (_e, { paths }) => {
  for (const p of paths || []) await assertAllowed(p);
  return storage.migrateAllInto(paths);
});

// Search (MiniSearch index for full-text; file-scan for backlinks)
ipcMain.handle('search:run', (_e, { query, projects }) => searchIndex.query(query, projects));
ipcMain.handle('search:backlinks', guarded((_e, { path: p, name }) => search.findBacklinks(p, name)));

// Plugins
ipcMain.handle('plugins:list', () => plugins.listPlugins(APP_ROOT));
ipcMain.handle('plugins:source', (_e, { id }) => plugins.readPluginSource(APP_ROOT, id));
// Where users install their own plugins — the Plugins page shows this and can open it.
ipcMain.handle('plugins:userDir', () => plugins.userPluginsRoot());
ipcMain.handle('plugins:openUserDir', async () => {
  const dir = plugins.userPluginsRoot();
  if (!dir) return false;
  await require('fs/promises').mkdir(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});
