// storage.js — main-process persistence layer.
//
// Project info (project.json) and notes (*.md) live together in a per-project "meta dir".
// Where that meta dir is depends on the storage settings (single source of truth = settings.json,
// written by the renderer's Storage page):
//   - infolder : <project>/<folderName>/        (folderName configurable; default below)
//   - central  : <appSupport>/ProjectNotes/Projects/<Project Name (id)>/
//   - custom   : <customPath>/<folderName>/Projects/<Project Name (id)>/
// Central & custom always create a readable, portable per-project folder.

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Lazily required to avoid a require cycle (watcher.js requires storage.js for metaDirFor).
function markSelfWrite(file) {
  try { require('./watcher').markSelfWrite(file); } catch { /* watcher not in use (tests) */ }
}

const DEFAULT_FOLDER = 'ProjectNotes';   // the app folder name (default; user-editable in the UI)
const PROJECT_FILE = 'project.json';
const NOTES_DIRNAME = 'notes';

// App config + central data root (always here, regardless of storage mode).
// Uses Electron's per-platform userData dir (%APPDATA% on Windows, ~/Library/Application Support
// on macOS, ~/.config on Linux). PNOTES_HOME overrides it, which also lets this module be
// required outside Electron (tests) where `app` is unavailable.
function centralRoot() {
  if (process.env.PNOTES_HOME) return process.env.PNOTES_HOME;
  try {
    const { app } = require('electron');
    if (app?.getPath) return app.getPath('userData');
  } catch { /* not running under Electron */ }
  return path.join(os.homedir(), '.aec-notebook');
}

// Earlier builds kept app config somewhere else, and existing users must not lose it:
//   1. every platform read the hardcoded macOS path (the cross-platform bug);
//   2. the app was called "Project Notes" / "project-notes-app", so Electron's userData dir
//      carried that name — renaming the app to "AEC Notebook" moves userData out from under them.
// Copy the first candidate that exists into the current root, once, and leave the original alone.
function legacyRoots() {
  const roots = [path.join(os.homedir(), 'Library', 'Application Support', 'ProjectNotes')];
  let appData = null;
  try {
    const { app } = require('electron');
    if (app?.getPath) appData = app.getPath('appData');
  } catch { /* not under Electron */ }
  if (appData) {
    roots.push(path.join(appData, 'AEC Notebook'));      // current productName
    roots.push(path.join(appData, 'aec-notebook'));      // before productName was set (package name)
    roots.push(path.join(appData, 'Project Notes'));     // packaged 0.1.0
    roots.push(path.join(appData, 'project-notes-app')); // dev / unpackaged 0.1.0
  }
  return roots;
}

async function migrateLegacyRoot() {
  const root = path.resolve(centralRoot());
  try { await fsp.access(path.join(root, 'settings.json')); return false; }  // current root in use
  catch { /* nothing here yet */ }

  // Normally only one candidate exists. When several do (an app renamed more than once), take
  // the one the user touched most recently rather than whichever happens to be listed first.
  const found = [];
  for (const legacy of legacyRoots()) {
    if (path.resolve(legacy) === root) continue;                            // already correct
    try {
      const st = await fsp.stat(path.join(legacy, 'settings.json'));
      found.push({ dir: legacy, mtime: st.mtimeMs });
    } catch { /* no config here */ }
  }
  found.sort((a, b) => b.mtime - a.mtime);

  for (const { dir } of found) {
    await ensureDir(path.dirname(root));
    try { await fsp.cp(dir, root, { recursive: true, force: false, errorOnExist: false }); }
    catch (e) { console.log(`[storage] legacy root migration failed: ${e.message}`); continue; }
    console.log(`[storage] migrated legacy data from ${dir} -> ${root}`);
    return true;
  }
  return false;
}

async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

// ---------- storage settings (cached; refreshed when settings.json is written) ----------
let _settings = null;
async function storageSettings(force = false) {
  if (_settings && !force) return _settings;
  let s = {};
  try { s = JSON.parse(await fsp.readFile(path.join(centralRoot(), 'settings.json'), 'utf8')); } catch { /* defaults */ }
  _settings = {
    storageMode: s.storageMode || 'infolder',
    folderName: (s.folderName != null ? s.folderName : DEFAULT_FOLDER),
    customPath: s.customPath || '',
  };
  return _settings;
}
function invalidateSettings() { _settings = null; }

// ---------- per-project meta dir resolution ----------
function sanitizeBase(base) {
  return String(base).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
}
function shortId(absPath) { return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 6); }
function projectFolderName(projectPath) {
  return `${sanitizeBase(path.basename(projectPath))} (${shortId(path.resolve(projectPath))})`;
}

async function metaDirFor(projectPath) {
  const s = await storageSettings();
  if (s.storageMode === 'infolder') {
    return s.folderName ? path.join(projectPath, s.folderName) : projectPath;
  }
  if (s.storageMode === 'custom' && s.customPath) {
    return path.join(s.customPath, s.folderName || DEFAULT_FOLDER, 'Projects', projectFolderName(projectPath));
  }
  // central
  const dir = path.join(centralRoot(), 'Projects', projectFolderName(projectPath));
  await migrateLegacyCentral(projectPath, dir);
  return dir;
}

// One-time upgrade: old central scheme was centralRoot/projects/<base64url(absPath)>.
// Guarded by a module-level flag: this used to run an fs.access (and possibly a rename) for
// every candidate folder on every scan, which is O(folders) syscalls per rescan for a one-off job.
let _legacyCentralChecked = false;
async function legacyCentralExists() {
  if (_legacyCentralChecked) return false;
  try { await fsp.access(path.join(centralRoot(), 'projects')); return true; }
  catch { _legacyCentralChecked = true; return false; }   // no legacy dir at all -> never look again
}

async function migrateLegacyCentral(projectPath, newDir) {
  if (!(await legacyCentralExists())) return;
  try {
    const legacy = path.join(centralRoot(), 'projects', Buffer.from(path.resolve(projectPath)).toString('base64url'));
    if (legacy === newDir) return;
    await fsp.access(legacy);                 // throws if no legacy dir -> nothing to do
    try { await fsp.access(newDir); return; } catch { /* new doesn't exist yet */ }
    await ensureDir(path.dirname(newDir));
    await fsp.rename(legacy, newDir);
  } catch { /* no legacy data */ }
}

// ---------- project info ----------
// project.json shape: { values: {fieldKey: value}, _meta: {path, updatedAt} }.
// Older flat files (values at top level, meta under _keys) are still read transparently.
function normalizeProject(raw) {
  if (!raw) return { values: {}, meta: {} };
  if (raw.values && typeof raw.values === 'object') {
    // Self-heal accidental nesting ({values:{values:{...}}}) from an earlier migrate bug.
    let values = raw.values, meta = raw._meta || {};
    while (values && typeof values === 'object' && values.values && typeof values.values === 'object') {
      if (values.meta) meta = values.meta;
      values = values.values;
    }
    return { values, meta };
  }
  const values = {}, meta = {};
  for (const [k, v] of Object.entries(raw)) { if (k.startsWith('_')) meta[k.slice(1)] = v; else values[k] = v; }
  return { values, meta };
}

async function readProject(projectPath) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(await metaDirFor(projectPath), PROJECT_FILE), 'utf8'));
    return normalizeProject(raw);
  } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

// Serialized per project path, with a unique temp name, so two writers for the same project
// (split view, or a plugin writeField landing mid-autosave) can't race on the same temp file.
const _projectChains = new Map();
async function writeProject(projectPath, values) {
  const key = path.resolve(projectPath);
  const prev = _projectChains.get(key) || Promise.resolve();
  const run = prev.then(async () => {
    const dir = await metaDirFor(projectPath);
    await ensureDir(dir);
    const file = path.join(dir, PROJECT_FILE);
    const payload = { values: values || {}, _meta: { path: projectPath, updatedAt: new Date().toISOString() } };
    markSelfWrite(file);
    const tmp = `${file}.${process.pid}.${++_tmpSeq}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fsp.rename(tmp, file);
    return normalizeProject(payload);
  });
  _projectChains.set(key, run.catch(() => {}));
  return run;
}

async function hasProjectData(projectPath) {
  try { await fsp.access(path.join(await metaDirFor(projectPath), PROJECT_FILE)); return true; }
  catch { return false; }
}

// ---------- notes (.md) ----------
async function notesDir(projectPath) { return path.join(await metaDirFor(projectPath), NOTES_DIRNAME); }
// Confine a note name to its directory (strip any path components -> no traversal).
function noteFile(dir, name) { return path.join(dir, path.basename(String(name))); }

async function listNotes(projectPath) {
  try { return (await fsp.readdir(await notesDir(projectPath))).filter((f) => f.endsWith('.md')); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

async function readNote(projectPath, name) {
  try { return await fsp.readFile(noteFile(await notesDir(projectPath), name), 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return ''; throw err; }
}

async function writeNote(projectPath, name, content) {
  const dir = await notesDir(projectPath);
  await ensureDir(dir);
  const safe = path.basename(name.endsWith('.md') ? name : `${name}.md`);
  const file = path.join(dir, safe);
  markSelfWrite(file);        // so the fs watcher doesn't report our own write as external
  await fsp.writeFile(file, content, 'utf8');
  return safe;
}

async function uniqueName(dir, base) {
  const clean = sanitizeBase(base);
  let candidate = `${clean}.md`, n = 1;
  while (true) {
    try { await fsp.access(path.join(dir, candidate)); candidate = `${clean} ${n++}.md`; }
    catch { return candidate; }
  }
}

async function createNote(projectPath, base = 'Untitled') {
  const dir = await notesDir(projectPath);
  await ensureDir(dir);
  const name = await uniqueName(dir, base);
  await fsp.writeFile(path.join(dir, name), '', 'utf8');
  return name;
}

async function renameNote(projectPath, oldName, newBase) {
  const dir = await notesDir(projectPath);
  const from = noteFile(dir, oldName.endsWith('.md') ? oldName : `${oldName}.md`);
  const cleanBase = sanitizeBase(newBase);
  if (`${cleanBase}.md` === oldName) return oldName;
  let target = `${cleanBase}.md`, n = 1;
  while (true) {
    const full = path.join(dir, target);
    if (full === from) break;
    try { await fsp.access(full); target = `${cleanBase} ${n++}.md`; } catch { break; }
  }
  await fsp.rename(from, path.join(dir, target));
  return target;
}

async function deleteNote(projectPath, name) {
  try { await fsp.unlink(noteFile(await notesDir(projectPath), name)); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  return true;
}

// ---------- attachments (images / files dropped into notes) ----------
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.pdf': 'application/pdf' };

async function attachmentsDir(projectPath) { return path.join(await metaDirFor(projectPath), 'attachments'); }

async function uniqueAttachment(dir, filename) {
  const safe = path.basename(String(filename)).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'file';
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let cand = base + ext, n = 1;
  while (true) {
    try { await fsp.access(path.join(dir, cand)); cand = `${base} ${n++}${ext}`; }
    catch { return cand; }
  }
}

// Save a base64 payload into <metaDir>/attachments and return the note-relative path.
async function saveAttachment(projectPath, filename, base64) {
  const dir = await attachmentsDir(projectPath);
  await ensureDir(dir);
  const name = await uniqueAttachment(dir, filename || 'file');
  await fsp.writeFile(path.join(dir, name), Buffer.from(base64, 'base64'));
  return 'attachments/' + name;
}

// Read an attachment as a data: URL (CSP-safe for <img src>). Path-confined to the attachments dir.
async function readAttachment(projectPath, rel) {
  const file = path.join(await attachmentsDir(projectPath), path.basename(String(rel)));
  const buf = await fsp.readFile(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function attachmentAbsPath(projectPath, rel) {
  return path.join(await attachmentsDir(projectPath), path.basename(String(rel)));
}

// ---------- app config (settings/library/schemas) — always in centralRoot ----------
// A malformed config must never be silently treated as "absent": the renderer would rebuild
// empty state and the next save would overwrite the recoverable file. Instead we quarantine the
// bad file, fall back to the .bak if there is one, and tell the caller what happened.
async function readConfig(filename) {
  const file = path.join(centralRoot(), filename);
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }

  try { return JSON.parse(raw); } catch { /* fall through to recovery */ }

  const quarantine = `${file}.corrupt-${Date.now()}`;
  try { await fsp.rename(file, quarantine); } catch { /* best effort */ }
  console.log(`[config] malformed ${filename} quarantined at ${path.basename(quarantine)}`);

  // Try the previous good copy before giving up.
  try {
    const bak = JSON.parse(await fsp.readFile(`${file}.bak`, 'utf8'));
    console.log(`[config] recovered ${filename} from .bak`);
    return bak;
  } catch { /* no usable backup */ }

  const err = new Error(`${filename} was corrupt and has been moved to ${path.basename(quarantine)}. No backup was available.`);
  err.code = 'ECONFIGCORRUPT';
  throw err;
}

// Atomic write (temp + rename) so concurrent/interrupted writes can't corrupt the file.
// Keeps one .bak generation, and — critically — surfaces failures instead of reporting success:
// a swallowed error here means the user loses a schema and is told "All changes saved".
let _writeChain = Promise.resolve();
let _tmpSeq = 0;
async function writeConfig(filename, data) {
  const run = _writeChain.then(async () => {
    await ensureDir(centralRoot());
    const file = path.join(centralRoot(), filename);
    const tmp = `${file}.${process.pid}.${++_tmpSeq}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    try { await fsp.copyFile(file, `${file}.bak`); } catch { /* no previous version yet */ }
    await fsp.rename(tmp, file);
  });
  // Keep the chain alive for the next writer even if this one rejects.
  _writeChain = run.catch(() => {});
  await run;                       // throws to the caller -> IPC rejects -> renderer can toast
  if (filename === 'settings.json') invalidateSettings();
  return true;
}

async function folderName() { return (await storageSettings()).folderName || DEFAULT_FOLDER; }

// ---------- opt-in migration (COPY data from other locations into the current one) ----------
function metaDirExplicit(projectPath, s) {
  if (s.storageMode === 'infolder') return s.folderName ? path.join(projectPath, s.folderName) : projectPath;
  if (s.storageMode === 'custom' && s.customPath) return path.join(s.customPath, s.folderName || DEFAULT_FOLDER, 'Projects', projectFolderName(projectPath));
  return path.join(centralRoot(), 'Projects', projectFolderName(projectPath));
}

async function copyDataDir(srcDir, dstDir) {
  let any = false;
  if (path.resolve(srcDir) === path.resolve(dstDir)) return false;
  try { // project.json (don't overwrite existing)
    const srcPj = path.join(srcDir, PROJECT_FILE);
    await fsp.access(srcPj);
    await ensureDir(dstDir);
    try { await fsp.access(path.join(dstDir, PROJECT_FILE)); }
    catch { await fsp.copyFile(srcPj, path.join(dstDir, PROJECT_FILE)); any = true; }
  } catch { /* no source project.json */ }
  try { // notes (don't overwrite existing names)
    const srcNotes = path.join(srcDir, NOTES_DIRNAME);
    const files = (await fsp.readdir(srcNotes)).filter((f) => f.endsWith('.md'));
    if (files.length) {
      await ensureDir(path.join(dstDir, NOTES_DIRNAME));
      for (const f of files) {
        const dst = path.join(dstDir, NOTES_DIRNAME, f);
        try { await fsp.access(dst); } catch { await fsp.copyFile(path.join(srcNotes, f), dst); any = true; }
      }
    }
  } catch { /* no source notes */ }
  return any;
}

// Copy a project's data from whichever OTHER location holds it into the current location.
async function migrateInto(projectPath) {
  const cur = await storageSettings();
  const curDir = await metaDirFor(projectPath);
  const candidates = [
    { storageMode: 'infolder', folderName: cur.folderName, customPath: '' },
    { storageMode: 'central', folderName: cur.folderName, customPath: '' },
    { storageMode: 'custom', folderName: cur.folderName, customPath: cur.customPath },
  ].filter((m) => m.storageMode !== cur.storageMode && !(m.storageMode === 'custom' && !m.customPath));
  let moved = false;
  for (const m of candidates) moved = (await copyDataDir(metaDirExplicit(projectPath, m), curDir)) || moved;
  return moved;
}

async function migrateAllInto(projectPaths) {
  let n = 0;
  for (const p of projectPaths || []) { if (await migrateInto(p)) n += 1; }
  return n;
}

module.exports = {
  DEFAULT_FOLDER,
  centralRoot,
  migrateLegacyRoot,
  metaDirFor,
  normalizeProject,
  hasProjectData,
  folderName,
  readProject,
  writeProject,
  listNotes,
  readNote,
  writeNote,
  createNote,
  renameNote,
  deleteNote,
  saveAttachment,
  readAttachment,
  attachmentAbsPath,
  migrateAllInto,
  readConfig,
  writeConfig,
};
