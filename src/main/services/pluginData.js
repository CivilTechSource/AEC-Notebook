// pluginData.js — per-plugin file storage (a plugin's "evidence" attachments).
//
// Lives under <centralRoot>/plugin-data/<pluginId>/files. Deliberately NOT beside the project
// files: what a plugin stores here is the user's own record, not project data, and it must not
// appear on a shared drive for colleagues to read. The install directory is not an option either
// — electron-builder replaces it wholesale on every update.
//
// Plugin code never reaches this module. The renderer's pluginBridge brokers each call after
// checking the plugin's declared permissions; this module's job is to make sure the pluginId it
// is handed cannot walk out of the config root.

const fsp = require('fs/promises');
const path = require('path');
const storage = require('./storage');

// Same shape plugins.js enforces on a manifest id. Re-asserted here because this module joins the
// id onto a path: plugins.js is the only current caller's validator, and a second one that stops
// validating would silently turn this into a traversal.
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

// <centralRoot>/plugin-data/<id> — with the containment assert metaDirFor uses, for the same
// reason: a bad id here writes user data somewhere nobody will ever look for it.
function dataDir(pluginId) {
  const id = String(pluginId ?? '');
  if (!ID_RE.test(id)) throw new Error(`invalid plugin id: ${pluginId}`);
  const root = path.join(storage.centralRoot(), 'plugin-data');
  const dir = path.join(root, id);
  if (!storage.isInside(root, dir) || path.dirname(path.resolve(dir)) !== path.resolve(root)) {
    throw new Error(`plugin id "${id}" escapes the plugin data folder`);
  }
  return dir;
}

function filesDir(pluginId) { return path.join(dataDir(pluginId), 'files'); }

// Strip everything that could make a stored name mean something other than a name. The result is
// always a bare basename inside filesDir — callers pass these strings back to us later.
function safeName(name) {
  const base = path.basename(String(name ?? ''))
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');
  return base || 'file';
}

// Resolve a stored file, refusing anything that isn't directly inside the plugin's files dir.
function fileIn(pluginId, name) {
  const dir = filesDir(pluginId);
  const file = path.join(dir, safeName(name));
  if (!storage.isInside(dir, file)) throw new Error('file escapes the plugin data folder');
  return file;
}

async function uniqueName(dir, filename) {
  const safe = safeName(filename);
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let cand = base + ext;
  let n = 1;
  while (true) {
    try { await fsp.access(path.join(dir, cand)); cand = `${base} ${n++}${ext}`; }
    catch { return cand; }
  }
}

function formatMB(bytes) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

// Copy a user-picked file in. The source path comes from the native picker (the user's own consent
// gesture) — the destination is derived entirely from the validated plugin id, never from input.
//
// Bytes are read in the main process rather than crossing IPC as base64: a 25 MB certificate would
// otherwise become a 33 MB string in the renderer and another copy in the sandboxed frame.
async function importFile(pluginId, srcPath) {
  const src = String(srcPath ?? '');
  if (!src) throw new Error('No file selected');

  const stat = await fsp.stat(src);
  if (!stat.isFile()) throw new Error('Not a file');
  if (stat.size > storage.MAX_ATTACHMENT_BYTES) {
    throw new Error(`“${path.basename(src)}” is ${formatMB(stat.size)} — evidence files are limited to ${formatMB(storage.MAX_ATTACHMENT_BYTES)}. Link to it on the drive instead.`);
  }

  const dir = filesDir(pluginId);
  await ensureDir(dir);
  const buf = await fsp.readFile(src);

  // 'wx' fails if the name was taken between uniqueName's check and the write — the same TOCTOU
  // saveAttachment closes. Retry with a fresh name rather than overwriting someone else's file.
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = await uniqueName(dir, path.basename(src));
    try {
      await storage.retryOnLock(() => fsp.writeFile(path.join(dir, name), buf, { flag: 'wx' }));
      return { name, size: buf.length };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free filename for the evidence file');
}

async function listFiles(pluginId) {
  const dir = filesDir(pluginId);
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      const st = await fsp.stat(path.join(dir, e.name));
      out.push({ name: e.name, size: st.size, modified: st.mtimeMs });
    } catch { /* vanished between readdir and stat */ }
  }
  return out;
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.pdf': 'application/pdf',
};

// Read as a data: URL. The plugin CSP allows `img-src data:` but nothing else, so this is only
// useful for images — every other type is opened through the OS instead (see openFile).
async function readFile(pluginId, name) {
  const file = fileIn(pluginId, name);
  const buf = await fsp.readFile(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function deleteFile(pluginId, name) {
  try { await fsp.unlink(fileIn(pluginId, name)); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  return true;
}

function absPath(pluginId, name) { return fileIn(pluginId, name); }

module.exports = { dataDir, filesDir, safeName, importFile, listFiles, readFile, deleteFile, absPath };
