// scanner.js — folder scanning (with configurable nested depth) + migration.

const fsp = require('fs/promises');
const path = require('path');
const storage = require('./storage');

/**
 * Re-home out-of-folder data after a project folder is renamed or moved.
 *
 * In central/custom mode the meta dir is keyed on sha1(absolute project path), so renaming or
 * moving a project folder changes the key and every note vanishes from the app while sitting
 * safely on disk under the old hash. migrateMoved below can't help: it reads through the NEW key,
 * which is empty. The only surviving link is `_meta.path` inside each project.json.
 *
 * An "orphan" is a stored folder whose claimed path no longer exists. Two ways one can be matched
 * to the project in front of us, covering the two things people actually do:
 *
 *   moved    — same folder name, different parent  (dragged into an "Archive" folder)
 *   renamed  — same parent, different folder name  (renamed in place in Explorer)
 *
 * Either signal alone is weak, so exactly one orphan must match; two candidates means we stop and
 * leave both alone. Adopting the wrong one would attach another project's notes to this project,
 * which is worse than the folder showing up as "not set up" and being reconnected by hand.
 */
let _orphanCache = null;      // { at, list: [{ dir, claimed }] }
const ORPHAN_TTL_MS = 30_000; // one build per rescan burst, not one per project

function invalidateOrphans() { _orphanCache = null; }

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function orphanIndex(storeRoot) {
  if (_orphanCache && Date.now() - _orphanCache.at < ORPHAN_TTL_MS) return _orphanCache.list;
  const list = [];
  let entries = [];
  try { entries = await fsp.readdir(storeRoot, { withFileTypes: true }); }
  catch { _orphanCache = { at: Date.now(), list }; return list; }   // no store yet

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(storeRoot, entry.name);
    let claimed;
    try {
      const rec = storage.normalizeProject(JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')));
      claimed = rec.meta?.path;
    } catch { continue; }                       // no readable project.json -> nothing to re-home
    if (!claimed || await exists(claimed)) continue;   // still where it says it is
    list.push({ dir, claimed });
  }
  _orphanCache = { at: Date.now(), list };
  return list;
}

async function rehomeOutOfFolder(projectPath) {
  if (await storage.storageMode() === 'infolder') return false;   // migrateMoved already covers this

  const targetDir = await storage.metaDirFor(projectPath);
  if (await exists(path.join(targetDir, 'project.json'))) return false;   // data is already here

  const storeRoot = path.dirname(targetDir);              // .../Projects
  const wantBase = path.basename(projectPath).toLowerCase();
  const wantParent = path.resolve(path.dirname(projectPath)).toLowerCase();

  const candidates = (await orphanIndex(storeRoot)).filter(({ claimed }) => {
    const sameName = path.basename(claimed).toLowerCase() === wantBase;
    const sameParent = path.resolve(path.dirname(claimed)).toLowerCase() === wantParent;
    return sameName || sameParent;
  });
  if (candidates.length !== 1) return false;              // none, or ambiguous — never guess

  try {
    await fsp.rename(candidates[0].dir, targetDir);
    console.log(`[scanner] re-homed data for ${candidates[0].claimed} -> ${projectPath}`);
    invalidateOrphans();
    return true;
  } catch (e) {
    console.log(`[scanner] could not re-home ${candidates[0].dir}: ${e.message}`);
    return false;
  }
}

/**
 * Scan a library root for project folders.
 * @param {string} root
 * @param {number} depth - how many levels deep projects live (1 = immediate children).
 *
 * A folder is reported as a project when it is at the configured depth, OR it already
 * has project data at any shallower level (so configured projects always surface).
 * We never recurse into a folder that's reported as a project.
 */
async function scanRoot(root, depth = 1) {
  const maxDepth = Math.max(1, Number(depth) || 1);
  const skip = await storage.folderName();   // don't descend into the app's own meta folder
  const out = [];

  async function hasSubdirs(dir) {
    try { return (await fsp.readdir(dir, { withFileTypes: true })).some((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== skip); }
    catch { return false; }
  }

  async function walk(dir, level) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === skip) continue;
      const full = path.join(dir, entry.name);
      const configured = await storage.hasProjectData(full);
      // A folder is a project if: it has data, we've hit the depth limit, or it's a leaf (no subfolders).
      if (configured || level >= maxDepth || !(await hasSubdirs(full))) {
        out.push({ name: entry.name, path: full, hasMetadata: configured });
      } else {
        await walk(full, level + 1);
      }
    }
  }

  await walk(root, 1);
  return out;
}

/**
 * Migration for in-folder storage: if a project folder moved, its portable in-folder
 * data still has the old absolute path stored. Reconcile it. (No-op in central/custom
 * modes, where data isn't inside the project folder.)
 */
async function migrateMoved(newPath) {
  // Out-of-folder stores are keyed on the path, so a moved folder has to be found again BEFORE
  // we read through the new key — otherwise readProject returns null and the project looks
  // "not set up" despite its notes being on disk.
  await rehomeOutOfFolder(newPath).catch(() => {});
  const rec = await storage.readProject(newPath);   // normalized { values, meta } or null
  if (!rec) return null;
  // Already reconciled to this path -> no-op (critical: avoids rewriting on every rescan).
  if (rec.meta && rec.meta.path === newPath) return rec;
  // Folder moved: rewrite the VALUES only; writeProject re-stamps _meta.path = newPath.
  await storage.writeProject(newPath, rec.values);
  return rec;
}

/**
 * Scan a root AND resolve every project's data in one IPC round-trip.
 * The renderer used to do scanRoot -> (migrate + readProject) per project, one await at a time:
 * ~2N sequential IPC calls with the UI frozen. Here the per-project work runs in main, batched.
 */
async function scanRootWithData(root, depth = 1) {
  const found = await scanRoot(root, depth);
  // One index build per scan rather than one per project, but never stale across scans: a folder
  // re-homed by this pass must not still look like an orphan to the next one.
  invalidateOrphans();
  return Promise.all(found.map(async (f) => {
    let values = null;
    let hasMetadata = !!f.hasMetadata;
    try {
      const rec = await migrateMoved(f.path);
      values = rec ? rec.values : null;
      // scanRoot decided hasMetadata before any re-homing happened, so a project we just
      // reconnected would otherwise still show as "not set up" until the next rescan.
      if (rec) hasMetadata = true;
    } catch { /* unreadable project.json -> treat as not set up */ }
    // A rescan is the natural moment to tidy: infrequent, already doing IO per project, and in
    // in-folder mode a temp stranded by a crash sits right beside the user's notes.
    if (hasMetadata) {
      try {
        const meta = await storage.metaDirFor(f.path);
        await storage.sweepStaleTemps(meta);
        await storage.sweepStaleTemps(path.join(meta, 'notes'));
      } catch { /* tidying must never fail a scan */ }
    }
    return { name: f.name, path: f.path, hasMetadata, values };
  }));
}

module.exports = { scanRoot, scanRootWithData, migrateMoved, rehomeOutOfFolder, invalidateOrphans };
