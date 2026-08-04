// history.js — point-in-time snapshots of notes, so an accidental edit is recoverable.
//
// Layout: <metaDir>/.history/<note name>/<epoch>.md
//
// That location is load-bearing. It sits BESIDE notes/ rather than inside it, which means every
// existing scan path excludes it for free:
//   - storage.listNotes reads notes/ only, so snapshots are never listed as notes;
//   - searchIndex and search.findBacklinks both go through listNotes, so they can't be poisoned;
//   - watcher.js filters to paths starting "notes/", so writing a snapshot can't wake the watcher
//     and trigger the write that made it — the loop this design exists to avoid.
// Putting it under notes/ would have required a separate exclusion in all five places, and
// missing any one produces phantom notes or a write loop.
//
// Snapshots capture the content BEFORE a write, so the history is "what it used to say".
const fsp = require('fs/promises');
const path = require('path');
const storage = require('./storage');
const policy = require('../../shared/history');

const HISTORY_DIRNAME = '.history';
// Autosave fires every 500 ms of typing. Without a floor, a morning's work would be tens of
// thousands of snapshots; with it, a burst of typing collapses into one entry per interval.
const MIN_INTERVAL_MS = 5 * 60 * 1000;

// Avoids a stat on every keystroke's autosave. Only ever makes us snapshot MORE often (after a
// restart), never less, so a stale entry can't cost the user a version.
const lastSnapshotAt = new Map();   // absolute note path -> epoch ms

function baseName(noteName) {
  return path.basename(String(noteName).endsWith('.md') ? String(noteName) : `${noteName}.md`);
}

async function historyRoot(projectPath) {
  return path.join(await storage.metaDirFor(projectPath), HISTORY_DIRNAME);
}

async function historyDir(projectPath, noteName) {
  return path.join(await historyRoot(projectPath), baseName(noteName));
}

async function listSnapshots(projectPath, noteName) {
  let entries = [];
  try { entries = await fsp.readdir(await historyDir(projectPath, noteName)); }
  catch { return []; }
  const dir = await historyDir(projectPath, noteName);
  const out = [];
  for (const f of entries) {
    const m = f.match(/^(\d+)\.md$/);
    if (!m) continue;
    let size = 0;
    try { size = (await fsp.stat(path.join(dir, f))).size; } catch { /* vanished */ }
    out.push({ ts: Number(m[1]), size });
  }
  return out.sort((a, b) => b.ts - a.ts);       // newest first
}

async function readSnapshot(projectPath, noteName, ts) {
  const stamp = Number(ts);
  if (!Number.isSafeInteger(stamp) || stamp <= 0) throw new Error('Invalid snapshot id');
  const file = path.join(await historyDir(projectPath, noteName), `${stamp}.md`);
  return fsp.readFile(file, 'utf8');
}

// Apply the retention policy, deleting what falls outside it.
async function prune(projectPath, noteName, now = Date.now()) {
  const dir = await historyDir(projectPath, noteName);
  const snaps = await listSnapshots(projectPath, noteName);
  const { drop } = policy.planRetention(snaps.map((s) => s.ts), now);
  for (const ts of drop) {
    try { await fsp.unlink(path.join(dir, `${ts}.md`)); } catch { /* already gone */ }
  }
  return drop.length;
}

/**
 * Snapshot a note's CURRENT on-disk content, if one is due. Called before the note is overwritten.
 * Never throws: losing a snapshot must not fail the user's save.
 */
async function maybeSnapshot(projectPath, noteName, now = Date.now()) {
  try {
    const name = baseName(noteName);
    const key = path.join(projectPath, name);

    const last = lastSnapshotAt.get(key);
    if (last != null && now - last < MIN_INTERVAL_MS) return null;

    const current = await storage.readNote(projectPath, name);
    // Nothing worth keeping — and this is also the "note was just created" case.
    if (!current) { lastSnapshotAt.set(key, now); return null; }

    const dir = await historyDir(projectPath, name);
    // On a cold start there's no in-memory marker, so fall back to what's on disk before writing.
    if (last == null) {
      const existing = await listSnapshots(projectPath, name);
      if (existing.length && now - existing[0].ts < MIN_INTERVAL_MS) {
        lastSnapshotAt.set(key, existing[0].ts);
        return null;
      }
      // Don't re-store a version identical to the newest snapshot.
      if (existing.length) {
        try {
          if ((await readSnapshot(projectPath, name, existing[0].ts)) === current) {
            lastSnapshotAt.set(key, existing[0].ts);
            return null;
          }
        } catch { /* unreadable snapshot: fall through and write a new one */ }
      }
    }

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${now}.md`), current, 'utf8');
    lastSnapshotAt.set(key, now);
    await prune(projectPath, name, now);
    return now;
  } catch {
    return null;      // history is a safety net, never a reason a save fails
  }
}

// Keep a note's history with it when it's renamed, or the record is orphaned under the old name.
async function renameHistory(projectPath, oldName, newName) {
  try {
    const from = await historyDir(projectPath, oldName);
    const to = await historyDir(projectPath, newName);
    if (from === to) return false;
    try { await fsp.access(from); } catch { return false; }        // no history to move
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    lastSnapshotAt.delete(path.join(projectPath, baseName(oldName)));
    return true;
  } catch { return false; }
}

// A deleted note keeps its history: undo restores the note, and the versions should still be there.
async function forget(projectPath, noteName) {
  lastSnapshotAt.delete(path.join(projectPath, baseName(noteName)));
}

module.exports = {
  HISTORY_DIRNAME, MIN_INTERVAL_MS,
  historyRoot, historyDir, listSnapshots, readSnapshot, maybeSnapshot, prune, renameHistory, forget,
};
