const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const plugins = require('../src/main/services/plugins');

test('safeEntry accepts a plain .js filename in the plugin dir', () => {
  const dir = path.resolve('/tmp/p');
  assert.strictEqual(plugins.safeEntry(dir, 'index.js'), path.join(dir, 'index.js'));
  assert.strictEqual(plugins.safeEntry(dir, undefined), path.join(dir, 'index.js'));
});

test('safeEntry rejects traversal, subpaths and non-js entries', () => {
  const dir = path.resolve('/tmp/p');
  for (const bad of ['../../../../etc/passwd', '../secret.js', 'sub/dir.js', 'sub\\dir.js', 'index.json', '/abs/index.js']) {
    assert.strictEqual(plugins.safeEntry(dir, bad), null, `should reject ${bad}`);
  }
});

test('listPlugins reads a valid manifest and skips an invalid one', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-'));
  const appRoot = path.join(root, 'app');
  const pdir = path.join(appRoot, 'plugins', 'good');
  await fsp.mkdir(pdir, { recursive: true });
  await fsp.writeFile(path.join(pdir, 'manifest.json'), JSON.stringify({
    id: 'good', name: 'Good', version: '1.0.0', entry: 'index.js', permissions: ['writeField'],
  }));
  await fsp.writeFile(path.join(pdir, 'index.js'), '// noop');

  const bad = path.join(appRoot, 'plugins', 'evil');
  await fsp.mkdir(bad, { recursive: true });
  await fsp.writeFile(path.join(bad, 'manifest.json'), JSON.stringify({ id: 'evil', entry: '../../../../etc/passwd' }));

  const found = await plugins.listPlugins(appRoot);
  assert.deepStrictEqual(found.map((p) => p.id), ['good']);
  assert.deepStrictEqual(found[0].permissions, ['writeField']);

  const { source } = await plugins.readPluginSource(appRoot, 'good');
  assert.strictEqual(source, '// noop');

  await assert.rejects(() => plugins.readPluginSource(appRoot, 'evil'), /Plugin not found/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('contributes and multiple permissions survive the manifest read intact', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-'));
  const appRoot = path.join(root, 'app');
  const pdir = path.join(appRoot, 'plugins', 'tracker');
  await fsp.mkdir(pdir, { recursive: true });
  await fsp.writeFile(path.join(pdir, 'manifest.json'), JSON.stringify({
    id: 'tracker',
    name: 'Tracker',
    contributes: { activity: { title: 'CPD', icon: 'cpd' } },
    permissions: ['storage', 'files', 'projects'],
  }));
  await fsp.writeFile(path.join(pdir, 'index.js'), '// noop');

  const [p] = await plugins.listPlugins(appRoot);
  // app.js builds a ribbon button off contributes.activity and pluginBridge gates every brokered
  // call on this permissions array — a manifest reader that dropped either would fail open.
  assert.deepStrictEqual(p.contributes, { activity: { title: 'CPD', icon: 'cpd' } });
  assert.deepStrictEqual(p.permissions, ['storage', 'files', 'projects']);
  assert.strictEqual(p.entry, 'index.js', 'entry defaults when the manifest omits it');

  fs.rmSync(root, { recursive: true, force: true });
});

test('the bundled CPD Tracker manifest is valid and asks only for what it uses', async () => {
  const [cpd] = (await plugins.listPlugins(path.join(__dirname, '..'))).filter((p) => p.id === 'cpd-tracker');
  assert.ok(cpd, 'cpd-tracker should be discovered from the bundled plugins dir');
  assert.strictEqual(cpd.contributes.activity.icon, 'cpd', 'must name an icon that exists in renderer/core/icons.js');
  assert.deepStrictEqual([...cpd.permissions].sort(), ['files', 'projects', 'storage']);

  const icons = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'icons.js'), 'utf8');
  assert.match(icons, /^\s*cpd:\s*'/m, 'the named glyph must exist, or the ribbon falls back to a letter');
});
