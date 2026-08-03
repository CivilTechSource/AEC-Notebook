// scanner.js — folder scanning (with configurable nested depth) + migration.

const fsp = require('fs/promises');
const path = require('path');
const storage = require('./storage');

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
  return Promise.all(found.map(async (f) => {
    let values = null;
    try {
      const rec = await migrateMoved(f.path);
      values = rec ? rec.values : null;
    } catch { /* unreadable project.json -> treat as not set up */ }
    return { name: f.name, path: f.path, hasMetadata: !!f.hasMetadata, values };
  }));
}

module.exports = { scanRoot, scanRootWithData, migrateMoved };
