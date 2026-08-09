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

// OneDrive, SharePoint and Google Drive FS all hold a file open for a moment while they sync it.
// A write landing in that window fails with EBUSY (Windows) or EPERM (the rename half), and the
// user sees "Could not save note" for something that would have worked 50 ms later.
//
// Only those two codes are retried: ENOSPC, EACCES and friends are real and must surface at once
// rather than being sat on for half a second first.
const LOCK_CODES = new Set(['EBUSY', 'EPERM']);
const RETRY_DELAYS = [50, 150, 400];

async function retryOnLock(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (!LOCK_CODES.has(err.code) || attempt >= RETRY_DELAYS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

// Every atomic write here is `writeFile(tmp)` then `rename(tmp, file)`. A hard kill between those
// two — a crash, a forced quit, the machine losing power — strands the temp file, and nothing ever
// collected them. Observed in the wild: six `window.json.<pid>.<n>.tmp` files in one app folder,
// one per killed session, because window.json is rewritten on every window move.
//
// They are inert (the watcher already ignores `.tmp`), but they accumulate forever and they sit
// next to the user's notes in in-folder mode, which looks like the app is leaking.
//
// Only files matching OUR pattern, and only ones old enough that no live write could own them —
// a write completes in milliseconds, so an hour is many orders of magnitude of headroom.
const TEMP_RE = /\.\d+\.\d+\.tmp$/;
const TEMP_MIN_AGE_MS = 60 * 60 * 1000;

async function sweepStaleTemps(dir, now = Date.now()) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!TEMP_RE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = await fsp.stat(file);
      if (now - st.mtimeMs < TEMP_MIN_AGE_MS) continue;   // could belong to a write in flight
      await fsp.unlink(file);
      removed += 1;
    } catch { /* vanished or locked — it'll be caught next time */ }
  }
  if (removed) console.log(`[storage] cleared ${removed} stale temp file(s) in ${dir}`);
  return removed;
}

// The app folder name is typed by the user on the Storage page and then joined onto every
// project path. Left raw, a value like `../..` walks the meta dir OUT of the project folder —
// and the path allowlist only ever sees the *project* path, not the resolved destination, so
// notes, project.json and snapshots would land somewhere nothing checked.
//
// Sanitised here rather than at the input, because this is the one place every consumer
// (metaDirFor, metaDirExplicit, folderName, the scanner's skip name) goes through. An empty
// result falls back to the default: "no folder name" used to mean "write into the project root",
// which also put a recursive fs.watch over an entire CAD/PDF project tree.
function sanitizeFolderName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '')     // separators and the Windows-reserved set
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');            // '.', '..', '...' — a traversal segment, not a name
  return cleaned || DEFAULT_FOLDER;
}

// ---------- storage settings (cached; refreshed when settings.json is written) ----------
let _settings = null;
async function storageSettings(force = false) {
  if (_settings && !force) return _settings;
  let s = {};
  try { s = JSON.parse(await fsp.readFile(path.join(centralRoot(), 'settings.json'), 'utf8')); } catch { /* defaults */ }
  _settings = {
    storageMode: s.storageMode || 'infolder',
    folderName: sanitizeFolderName(s.folderName),
    customPath: s.customPath || '',
    // Where note snapshots live. Central keeps them out of a synced project folder (no sync
    // traffic, no SharePoint quota); in-project keeps them portable with the project.
    historyLocation: s.historyLocation === 'inproject' ? 'inproject' : 'central',
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

// Containment test, defined here because this is the lowest module in the require order —
// pathGuard.js re-exports it rather than keeping a second copy that could drift. The `+ sep`
// is what stops `/lib` matching `/library-secrets`.
function isInside(parent, child) {
  const p = path.resolve(parent), c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

async function metaDirFor(projectPath) {
  const s = await storageSettings();
  if (s.storageMode === 'infolder') {
    const dir = path.join(projectPath, s.folderName);
    // sanitizeFolderName should make this unreachable. It's asserted anyway because the failure
    // mode is writing the user's notes outside every folder they registered, and a second pair
    // of eyes on that costs one string comparison per resolve.
    if (!isInside(projectPath, dir)) throw new Error(`App folder name "${s.folderName}" escapes the project folder`);
    return dir;
  }
  if (s.storageMode === 'custom' && s.customPath) {
    return path.join(s.customPath, s.folderName, 'Projects', projectFolderName(projectPath));
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
    const body = JSON.stringify(payload, null, 2);
    await retryOnLock(async () => {
      markSelfWrite(file);          // re-stamped per attempt: the marker window is only 400 ms
      const tmp = `${file}.${process.pid}.${++_tmpSeq}.tmp`;
      await fsp.writeFile(tmp, body, 'utf8');
      try { await fsp.rename(tmp, file); }
      catch (err) { await fsp.unlink(tmp).catch(() => {}); throw err; }   // don't strand a temp file
    });
    return normalizeProject(payload);
  });
  const settled = run.catch(() => {});
  _projectChains.set(key, settled);
  // Drop the entry once this write is the last one outstanding, or the map grows one permanent
  // key per project touched for the life of the process.
  settled.then(() => { if (_projectChains.get(key) === settled) _projectChains.delete(key); });
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

// Notes get the same treatment as project.json: temp file + rename, serialised per note.
//
// This used to be a bare writeFile. Two things went wrong with that. A crash or power loss
// partway through left a truncated note — and notes are the user's actual content, not
// regenerable metadata. And nothing serialised concurrent writers, so the 500 ms autosave, a
// ticked checkbox and a rename-driven link rewrite could interleave on the same file.
//
// Chained per note rather than per project: two different notes have no reason to wait on
// each other, and autosave is on the keystroke path.
//
// The chain is keyed on project + note name, NOT on the resolved absolute path, and that is
// load-bearing. Resolving the path means awaiting metaDirFor, and an await before the chain is
// registered lets concurrent callers reach the map in a different order than they were called in
// — so the LAST write did not reliably win. For autosave that's the whole guarantee: a checkbox
// tick landing between two saves must not resurrect the earlier text.
const _noteChains = new Map();
function writeNote(projectPath, name, content) {
  const safe = path.basename(String(name).endsWith('.md') ? String(name) : `${name}.md`);
  const key = `${path.resolve(projectPath)}\u0000${safe}`;

  const prev = _noteChains.get(key) || Promise.resolve();
  const run = prev.then(async () => {
    const dir = await notesDir(projectPath);
    const file = path.join(dir, safe);
    await ensureDir(dir);
    await retryOnLock(async () => {
      markSelfWrite(file);    // so the fs watcher doesn't report our own write as external
      const tmp = `${file}.${process.pid}.${++_tmpSeq}.tmp`;
      await fsp.writeFile(tmp, content, 'utf8');
      try { await fsp.rename(tmp, file); }
      catch (err) { await fsp.unlink(tmp).catch(() => {}); throw err; }
    });
    return safe;
  });
  // Keep the chain alive past a failure so one bad write doesn't wedge every later one.
  const settled = run.catch(() => {});
  _noteChains.set(key, settled);
  settled.then(() => { if (_noteChains.get(key) === settled) _noteChains.delete(key); });
  return run;
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
  // 'wx' fails if the file already exists. uniqueName checks first, but between that check and
  // the write another creation can land on the same name — and a plain writeFile would silently
  // truncate the note that got there first. Retry rather than overwrite.
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = await uniqueName(dir, base);
    const file = path.join(dir, name);
    try {
      markSelfWrite(file);
      await fsp.writeFile(file, '', { encoding: 'utf8', flag: 'wx' });
      return name;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not find a free filename for "${base}"`);
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
  // Both names change on disk; stamp both so the watcher doesn't report our own rename back to
  // the editor as an external edit.
  markSelfWrite(from);
  markSelfWrite(path.join(dir, target));
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

// Attachments cross IPC as a base64 string, so an uncapped file is a base64 copy in the renderer,
// another crossing the bridge and a Buffer here — roughly 3.7x the file on the wire. AEC users
// drag drawings and point-cloud exports, so this is the difference between a refusal and an
// out-of-memory crash. The renderer checks first (it can name the file and its size); this is the
// backstop so the cap doesn't live only in the untrusted half.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatMB(bytes) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

// Save a base64 payload into <metaDir>/attachments and return the note-relative path.
async function saveAttachment(projectPath, filename, base64) {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`“${path.basename(String(filename || 'file'))}” is ${formatMB(buf.length)} — attachments are limited to ${formatMB(MAX_ATTACHMENT_BYTES)}. Link to it on the drive instead.`);
  }
  const dir = await attachmentsDir(projectPath);
  await ensureDir(dir);
  // 'wx' fails if the file exists. uniqueAttachment checks first, but another save landing between
  // that check and the write would silently replace the file that got there first — the same
  // TOCTOU createNote already fixed. Retry rather than overwrite.
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = await uniqueAttachment(dir, filename || 'file');
    try {
      await retryOnLock(() => fsp.writeFile(path.join(dir, name), buf, { flag: 'wx' }));
      return 'attachments/' + name;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not find a free filename for "${filename}"`);
}

// A note's link is a URL, not a path: `attachments/site plan.pdf` is written into the markdown as
// `attachments/site%20plan.pdf`, because marked refuses to parse a link target containing a raw
// space and leaves the whole thing as literal text. So the filename has to be decoded on the way
// back before it can be matched against the filesystem.
//
// Defensive, because it also has to cope with notes written before links were encoded: a file
// genuinely named "50% slope.png" produces a raw `%` that decodeURIComponent rejects outright.
// Falling back to the undecoded string is right — that's exactly what the old link meant.
function decodeRel(rel) {
  const s = String(rel ?? '');
  try { return decodeURIComponent(s); }
  catch { return s; }
}

// Strip the link down to a bare filename inside the attachments dir. Decode FIRST: `%2e%2e%2f`
// is `../` once decoded, and basename has to be the last word on the subject.
function attachmentName(rel) { return path.basename(decodeRel(rel)); }

// Read an attachment as a data: URL (CSP-safe for <img src>). Path-confined to the attachments dir.
async function readAttachment(projectPath, rel) {
  const file = path.join(await attachmentsDir(projectPath), attachmentName(rel));
  const buf = await fsp.readFile(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function attachmentAbsPath(projectPath, rel) {
  return path.join(await attachmentsDir(projectPath), attachmentName(rel));
}

// ---------- listing and housekeeping ----------
// Nothing enumerated this folder until now: the app could save an attachment, read one by name and
// open one, but never tell you what was in there. So a file whose note was deleted stayed on disk
// with nothing able to surface it — five orphans and 1.2 MB in the first real project checked.
async function listAttachments(projectPath) {
  const dir = await attachmentsDir(projectPath);
  let names = [];
  try { names = await fsp.readdir(dir); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }

  const out = [];
  for (const name of names) {
    try {
      const st = await fsp.stat(path.join(dir, name));
      if (!st.isFile()) continue;                    // no folders masquerading as attachments
      out.push({ name, size: st.size, mtime: st.mtimeMs });
    } catch { /* vanished between readdir and stat */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Deleting is undoable, and the undo goes back through saveAttachment rather than a restore
// channel of its own — the same reasoning as note history restoring through writeNote. Removing
// the file frees the name, so the restore lands on it again and the note's link still resolves.
async function deleteAttachment(projectPath, rel) {
  const file = path.join(await attachmentsDir(projectPath), attachmentName(rel));
  try { await fsp.unlink(file); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  return true;
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
    const body = JSON.stringify(data, null, 2);
    await retryOnLock(async () => {
      const tmp = `${file}.${process.pid}.${++_tmpSeq}.tmp`;
      await fsp.writeFile(tmp, body, 'utf8');
      try { await fsp.copyFile(file, `${file}.bak`); } catch { /* no previous version yet */ }
      try { await fsp.rename(tmp, file); }
      catch (err) { await fsp.unlink(tmp).catch(() => {}); throw err; }
    });
  });
  // Keep the chain alive for the next writer even if this one rejects.
  _writeChain = run.catch(() => {});
  await run;                       // throws to the caller -> IPC rejects -> renderer can toast
  if (filename === 'settings.json') invalidateSettings();
  return true;
}

async function folderName() { return (await storageSettings()).folderName; }
async function historyLocation() { return (await storageSettings()).historyLocation; }
async function storageMode() { return (await storageSettings()).storageMode; }

// ---------- opt-in migration (COPY data from other locations into the current one) ----------
function metaDirExplicit(projectPath, s) {
  const folder = sanitizeFolderName(s.folderName);
  if (s.storageMode === 'infolder') return path.join(projectPath, folder);
  if (s.storageMode === 'custom' && s.customPath) return path.join(s.customPath, folder, 'Projects', projectFolderName(projectPath));
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
  MAX_ATTACHMENT_BYTES,
  centralRoot,
  migrateLegacyRoot,
  metaDirFor,
  normalizeProject,
  hasProjectData,
  folderName,
  historyLocation,
  storageMode,
  projectFolderName,
  sanitizeFolderName,
  isInside,
  retryOnLock,
  sweepStaleTemps,
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
  attachmentName,
  listAttachments,
  deleteAttachment,
  migrateAllInto,
  readConfig,
  writeConfig,
};
