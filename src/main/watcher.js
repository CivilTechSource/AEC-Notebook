// watcher.js — notice when project data changes underneath the app.
//
// The whole promise of this app is that your notes are plain files you can open in any editor.
// Without watching, an edit made elsewhere is invisible and the next keystroke in an open tab
// silently overwrites it. We watch each project's meta dir and tell the renderer what changed;
// the renderer decides whether to reload quietly or offer a choice.

const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const watchers = new Map();   // projectPath -> { watcher, timer }
const DEBOUNCE_MS = 250;      // editors write in bursts (temp file + rename + touch)

let notify = () => {};
function onChange(fn) { notify = fn; }

// Writes made *by this app* would otherwise echo straight back as "changed on disk".
// Callers stamp a path just before writing; echoes inside this window are ignored.
// Kept deliberately short: long enough to cover the event burst from one write, short enough
// that a genuine external edit landing right after ours isn't swallowed. Subscribers compare
// disk content against their buffer anyway, so a stray echo is harmless — a missed edit is not.
const selfWrites = new Map();  // absolute file path -> expiry timestamp
const SELF_WRITE_MS = 400;

function markSelfWrite(absFile) {
  selfWrites.set(path.resolve(absFile), Date.now() + SELF_WRITE_MS);
}
// A single write produces a BURST of fs events (rename + change, often twice), so the marker
// must suppress everything in its window rather than being consumed by the first event —
// otherwise every save echoes back as "changed on disk".
function isSelfWrite(absFile) {
  const key = path.resolve(absFile);
  const until = selfWrites.get(key);
  if (until == null) return false;
  if (Date.now() > until) { selfWrites.delete(key); return false; }
  return true;
}

// A project's meta dir doesn't exist until it first gets data, so attaching only at scan time
// silently skips every project set up since the last rescan. Callers re-attach after a write
// (see `ensureWatched`); this is idempotent.
async function watchProject(projectPath) {
  if (watchers.has(projectPath)) return;
  let dir;
  try { dir = await storage.metaDirFor(projectPath); } catch { return; }

  let watcher;
  try {
    // recursive works on Windows and macOS; on Linux it silently watches only the top level,
    // which still covers project.json. Notes changes there are picked up on the next rescan.
    watcher = fs.watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename).replace(/\\/g, '/');
      if (rel.endsWith('.tmp') || rel.includes('.tmp.')) return;      // our own atomic writes
      const isNote = rel.startsWith('notes/') && rel.endsWith('.md');
      const isProject = rel === 'project.json';
      if (!isNote && !isProject) return;
      if (isSelfWrite(path.join(dir, filename))) return;

      const entry = watchers.get(projectPath);
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        notify({ projectPath, kind: isNote ? 'note' : 'project', noteName: isNote ? rel.slice('notes/'.length) : null });
      }, DEBOUNCE_MS);
    });
  } catch { return; }   // dir may not exist yet (project not set up) — nothing to watch

  watcher.on('error', () => unwatchProject(projectPath));
  watchers.set(projectPath, { watcher, timer: null });
}

function unwatchProject(projectPath) {
  const entry = watchers.get(projectPath);
  if (!entry) return;
  clearTimeout(entry.timer);
  try { entry.watcher.close(); } catch { /* already gone */ }
  watchers.delete(projectPath);
}

// Replace the watched set wholesale (called after every rescan).
async function setWatched(projectPaths) {
  const want = new Set(projectPaths || []);
  for (const p of [...watchers.keys()]) if (!want.has(p)) unwatchProject(p);
  await Promise.all([...want].map((p) => watchProject(p)));
  return watchers.size;
}

function closeAll() { for (const p of [...watchers.keys()]) unwatchProject(p); }

// Attach a watcher for a project we've just written to, if it isn't watched yet. Only projects
// the user has already brought into view get here, so this can't start watching the whole disk.
// Fire-and-forget: a failure here must never fail the write that triggered it.
function ensureWatched(projectPath) {
  if (!projectPath || watchers.has(projectPath)) return;
  watchProject(projectPath).catch(() => {});
}

function isWatched(projectPath) { return watchers.has(projectPath); }

module.exports = { onChange, setWatched, watchProject, unwatchProject, ensureWatched, isWatched, closeAll, markSelfWrite, isSelfWrite };
