// history.js — point-in-time snapshots of notes, so an accidental edit is recoverable.
//
// Two possible layouts, chosen by the `historyLocation` setting:
//   central (default)  <centralRoot>/History/<Project Name (id)>/<note name>/<epoch>.md
//   inproject          <metaDir>/.history/<note name>/<epoch>.md
//
// Central is the default because project folders on a shared drive are usually synced. A snapshot
// every few minutes of editing is then sync traffic and SharePoint quota for something that is a
// safety net for the app, not a project deliverable. In-project is offered for people who want
// history to travel with the folder when it's copied or archived.
//
// The in-project location is load-bearing where it's used: it sits BESIDE notes/ rather than
// inside it, which means every existing scan path excludes it for free:
//   - storage.listNotes reads notes/ only, so snapshots are never listed as notes;
//   - searchIndex and search.findBacklinks both go through listNotes, so they can't be poisoned;
//   - watcher.js filters to paths starting "notes/", so writing a snapshot can't wake the watcher
//     and trigger the write that made it — the loop this design exists to avoid.
// Putting it under notes/ would have required a separate exclusion in all five places, and
// missing any one produces phantom notes or a write loop. The central location sidesteps all of
// this by not being under a watched directory at all.
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

// Resolve for a specific location, so relocate() can address both without touching the setting.
async function historyRootFor(projectPath, location) {
  if (location === 'inproject') return path.join(await storage.metaDirFor(projectPath), HISTORY_DIRNAME);
  return path.join(storage.centralRoot(), 'History', storage.projectFolderName(projectPath));
}

async function historyRoot(projectPath) {
  return historyRootFor(projectPath, await storage.historyLocation());
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

/**
 * Move a project's snapshots from one location to the other.
 *
 * Switching the setting with history already on disk would otherwise orphan it: the versions stay
 * where they were, the History panel looks at the new place and reports "no earlier versions", and
 * nothing tells the user their record is still sitting in the old folder.
 *
 * Per-note rather than whole-directory, so a target that already holds some history (switched
 * back and forth) merges instead of failing. An existing note directory at the destination is
 * left alone — it is the more recent record of the two.
 *
 * @returns {Promise<number>} how many note histories moved.
 */
async function relocate(projectPath, from, to) {
  if (from === to) return 0;
  const src = await historyRootFor(projectPath, from);
  const dst = await historyRootFor(projectPath, to);
  if (path.resolve(src) === path.resolve(dst)) return 0;

  let notes = [];
  try { notes = await fsp.readdir(src); } catch { return 0; }   // nothing recorded here
  if (!notes.length) return 0;

  await fsp.mkdir(dst, { recursive: true });
  let moved = 0;
  for (const note of notes) {
    const target = path.join(dst, note);
    try { await fsp.access(target); continue; }                  // already there — don't clobber
    catch { /* free */ }
    try { await fsp.rename(path.join(src, note), target); moved += 1; }
    catch {
      // Across volumes rename fails with EXDEV; central and in-project really can be on
      // different drives, which is half the reason the setting exists.
      try { await fsp.cp(path.join(src, note), target, { recursive: true }); await fsp.rm(path.join(src, note), { recursive: true, force: true }); moved += 1; }
      catch { /* leave this note's history where it is rather than losing it */ }
    }
  }
  // Only if we emptied it; a partial move must leave the evidence behind.
  try { await fsp.rmdir(src); } catch { /* not empty, or gone */ }
  lastSnapshotAt.clear();
  return moved;
}

module.exports = {
  HISTORY_DIRNAME, MIN_INTERVAL_MS,
  historyRoot, historyRootFor, historyDir, listSnapshots, readSnapshot, maybeSnapshot, prune,
  renameHistory, forget, relocate,
};
