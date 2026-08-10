// preload.js — exposes a minimal, typed API surface to the renderer.
// The renderer has no direct Node access; everything goes through these channels.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Native dialogs
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),

  // Projects
  readProject: (p) => ipcRenderer.invoke('project:read', { path: p }),
  writeProject: (p, data) => ipcRenderer.invoke('project:write', { path: p, data }),

  // Notes
  listNotes: (p) => ipcRenderer.invoke('notes:list', { path: p }),
  readNote: (p, name) => ipcRenderer.invoke('notes:read', { path: p, name }),
  writeNote: (p, name, content) => ipcRenderer.invoke('notes:write', { path: p, name, content }),
  createNote: (p, base) => ipcRenderer.invoke('notes:create', { path: p, base }),
  renameNote: (p, oldName, newBase) => ipcRenderer.invoke('notes:rename', { path: p, oldName, newBase }),
  deleteNote: (p, name) => ipcRenderer.invoke('notes:delete', { path: p, name }),

  // Attachments
  saveAttachment: (p, filename, base64) => ipcRenderer.invoke('attach:save', { path: p, filename, base64 }),
  readAttachment: (p, rel) => ipcRenderer.invoke('attach:read', { path: p, rel }),
  openAttachment: (p, rel) => ipcRenderer.invoke('attach:open', { path: p, rel }),
  revealAttachment: (p, rel) => ipcRenderer.invoke('attach:reveal', { path: p, rel }),
  listAttachments: (p) => ipcRenderer.invoke('attach:list', { path: p }),
  attachmentRefs: (p) => ipcRenderer.invoke('attach:refs', { path: p }),
  deleteAttachment: (p, rel) => ipcRenderer.invoke('attach:delete', { path: p, rel }),
  openFile: (p) => ipcRenderer.invoke('file:open', { path: p }),
  revealFile: (p) => ipcRenderer.invoke('file:reveal', { path: p }),

  // Custom title bar (the window is frameless)
  platform: () => ipcRenderer.invoke('app:platform'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  popupMenu: (x, y) => ipcRenderer.invoke('window:popupMenu', { x, y }),
  onWindowState: (handler) => ipcRenderer.on('window:state', (_e, s) => handler(s)),

  // Config
  centralRoot: () => ipcRenderer.invoke('app:centralRoot'),
  readConfig: (filename) => ipcRenderer.invoke('config:read', { filename }),
  writeConfig: (filename, data) => ipcRenderer.invoke('config:write', { filename, data }),

  // Scan + migrate
  scanRoot: (root, depth) => ipcRenderer.invoke('scan:root', { root, depth }),
  scanRootWithData: (root, depth) => ipcRenderer.invoke('scan:rootWithData', { root, depth }),
  migrate: (p) => ipcRenderer.invoke('scan:migrate', { path: p }),
  rewriteWikilinks: (p, from, to) => ipcRenderer.invoke('notes:rewriteLinks', { path: p, from, to }),

  // Watch project data for changes made outside the app
  watchProjects: (paths) => ipcRenderer.invoke('watch:set', { paths }),
  onFsChange: (handler) => ipcRenderer.on('fs:changed', (_e, change) => handler(change)),
  migrateData: (paths) => ipcRenderer.invoke('data:migrateInto', { paths }),
  search: (query, projects) => ipcRenderer.invoke('search:run', { query, projects }),
  backlinks: (p, name) => ipcRenderer.invoke('search:backlinks', { path: p, name }),

  // Note version history (restoring goes back through writeNote, so there's no restore channel)
  listSnapshots: (p, name) => ipcRenderer.invoke('history:list', { path: p, name }),
  readSnapshot: (p, name, ts) => ipcRenderer.invoke('history:read', { path: p, name, ts }),
  // Move existing snapshots when the history location setting changes.
  relocateHistory: (paths, from, to) => ipcRenderer.invoke('history:relocate', { paths, from, to }),

  // Note templates
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  readTemplate: (file) => ipcRenderer.invoke('templates:read', { file }),
  templatesDir: () => ipcRenderer.invoke('templates:dir'),
  openTemplatesDir: () => ipcRenderer.invoke('templates:openDir'),

  // Appearance — the user's own custom.css, read as text and injected (see services/userStyles.js)
  userCssPath: () => ipcRenderer.invoke('appearance:userCssPath'),
  readUserCss: () => ipcRenderer.invoke('appearance:readUserCss'),
  openUserCss: () => ipcRenderer.invoke('appearance:openUserCss'),

  // Plugins
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  pluginSource: (id) => ipcRenderer.invoke('plugins:source', { id }),
  pluginUserDir: () => ipcRenderer.invoke('plugins:userDir'),
  openPluginUserDir: () => ipcRenderer.invoke('plugins:openUserDir'),

  // A plugin's own file store. The renderer never passes a destination path — only the plugin id
  // and a stored filename; the main process derives the location. See ipc/pluginData.ipc.js.
  pluginImportFile: (id, src) => ipcRenderer.invoke('pluginData:import', { id, src }),
  pluginListFiles: (id) => ipcRenderer.invoke('pluginData:list', { id }),
  pluginReadFile: (id, name) => ipcRenderer.invoke('pluginData:read', { id, name }),
  pluginDeleteFile: (id, name) => ipcRenderer.invoke('pluginData:delete', { id, name }),
  pluginOpenFile: (id, name) => ipcRenderer.invoke('pluginData:open', { id, name }),
  pluginRevealFile: (id, name) => ipcRenderer.invoke('pluginData:reveal', { id, name }),

  // Menu events (main -> renderer)
  onMenu: (channel, handler) => {
    const valid = ['menu:open-folder', 'menu:scan-folder', 'menu:open-schema', 'menu:open-plugins'];
    if (valid.includes(channel)) ipcRenderer.on(channel, handler);
  },
});
