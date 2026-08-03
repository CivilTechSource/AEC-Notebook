// pathGuard.js — the allowlist that constrains every project-scoped IPC handler.
//
// Every such handler takes an absolute path from the renderer. Constrain those to folders the
// user actually registered (library.json) or picked in a native dialog this session, so a bug —
// or a compromised renderer — can't read or write arbitrary parts of the disk.
const path = require('path');
const storage = require('./services/storage');

const pickedPaths = new Set();      // paths the user chose via a native dialog

function isInside(parent, child) {
  const p = path.resolve(parent), c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

// The user consented to this exact path by choosing it in a native dialog.
function addPickedPath(p) { pickedPaths.add(path.resolve(p)); }

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

module.exports = { isInside, addPickedPath, invalidateRoots, assertAllowed, guarded, openableFile };
