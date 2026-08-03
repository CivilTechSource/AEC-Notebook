// plugins.js — discovery + sandboxed loading of optional tools.
// Plugins are folders placed in the app's `plugins/` directory (e.g. cloned from GitHub),
// each with a manifest.json and an entry script. We never execute plugin code in the
// main process; instead we hand the renderer a manifest + sandboxed source so it can run
// the plugin inside an isolated <iframe sandbox>/Worker. A crashing plugin can't take the app down.

const fsp = require('fs/promises');
const path = require('path');

// Plugins are discovered in two places:
//  - bundled:  <appRoot>/plugins        (samples shipped with the app; read-only once packaged)
//  - user:     <userData>/plugins       (where people actually install third-party plugins)
// The user dir wins on id collision, so a user can shadow a bundled sample.
function pluginsRoot(appRoot) {
  return path.join(appRoot, 'plugins');
}

function userPluginsRoot() {
  if (process.env.PNOTES_HOME) return path.join(process.env.PNOTES_HOME, 'plugins');
  try {
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'plugins');
  } catch { /* not running under Electron */ }
  return null;
}

function pluginRoots(appRoot) {
  return [pluginsRoot(appRoot), userPluginsRoot()].filter(Boolean);
}

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

// A plugin folder is untrusted input (the docs tell people to clone them from GitHub), so the
// manifest's `entry` must not be able to escape the plugin directory.
function safeEntry(dir, entry) {
  const rel = String(entry || 'index.js');
  if (!rel.toLowerCase().endsWith('.js')) return null;
  const abs = path.resolve(dir, rel);
  if (abs !== path.resolve(dir, path.basename(rel))) return null;   // no separators, no ..
  if (!abs.startsWith(path.resolve(dir) + path.sep)) return null;
  return abs;
}

async function readManifest(dir, folderName) {
  const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const id = manifest.id || folderName;
  if (!ID_RE.test(String(id))) throw new Error(`invalid plugin id: ${id}`);
  const entryAbs = safeEntry(dir, manifest.entry);
  if (!entryAbs) throw new Error(`invalid plugin entry: ${manifest.entry}`);
  return {
    id: String(id),
    name: manifest.name || folderName,
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    entry: path.basename(entryAbs),
    entryAbs,
    contributes: manifest.contributes || {},   // e.g. { boardSection: { title } }
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],  // e.g. ["writeField"]
    dir,
  };
}

async function listPlugins(appRoot) {
  const byId = new Map();
  for (const root of pluginRoots(appRoot)) {
    let entries;
    try { entries = await fsp.readdir(root, { withFileTypes: true }); }
    catch { continue; }   // missing dir is normal (user dir may not exist yet)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const plugin = await readManifest(path.join(root, entry.name), entry.name);
        byId.set(plugin.id, plugin);   // later root (user) shadows earlier (bundled)
      } catch (e) {
        // Folder without a valid manifest is ignored, not fatal — but say why.
        console.log(`[plugins] skipping ${entry.name}: ${e.message}`);
      }
    }
  }
  return [...byId.values()];
}

// Read a plugin's entry source so the renderer can run it in a sandbox.
async function readPluginSource(appRoot, pluginId) {
  const plugins = await listPlugins(appRoot);
  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
  const source = await fsp.readFile(plugin.entryAbs, 'utf8');
  return { manifest: plugin, source };
}

module.exports = { pluginsRoot, userPluginsRoot, pluginRoots, listPlugins, readPluginSource, safeEntry };
