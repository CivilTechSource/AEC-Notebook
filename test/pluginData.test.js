const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// centralRoot() reads PNOTES_HOME on every call, so pointing it at a temp dir keeps these tests
// away from the real config root. Set before requiring the module under test for clarity.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aecnb-pd-'));
process.env.PNOTES_HOME = HOME;

const pluginData = require('../src/main/services/pluginData');

test('dataDir lands inside <centralRoot>/plugin-data', () => {
  assert.strictEqual(pluginData.dataDir('cpd-tracker'), path.join(HOME, 'plugin-data', 'cpd-tracker'));
  assert.strictEqual(pluginData.filesDir('cpd-tracker'), path.join(HOME, 'plugin-data', 'cpd-tracker', 'files'));
});

test('dataDir rejects any id that could walk out of the plugin data folder', () => {
  // The id reaches this module from a manifest, which is untrusted input — plugins.js validates it
  // too, but a traversal here would write user data anywhere on disk.
  for (const bad of ['..', '../evil', '..\\evil', 'a/b', 'a\\b', '/abs', 'C:\\abs', '.hidden', '', null]) {
    assert.throws(() => pluginData.dataDir(bad), /invalid plugin id|escapes/, `should reject ${JSON.stringify(bad)}`);
  }
});

test('safeName strips separators and reserved characters', () => {
  assert.strictEqual(pluginData.safeName('../../etc/passwd'), 'passwd');
  assert.strictEqual(pluginData.safeName('a\\b\\c.pdf'), 'c.pdf');
  assert.strictEqual(pluginData.safeName('re:port*?.pdf'), 'report.pdf');
  assert.strictEqual(pluginData.safeName('..'), 'file');
  assert.strictEqual(pluginData.safeName(''), 'file');
});

test('a stored file cannot be read or deleted from outside its own folder', async () => {
  const secret = path.join(HOME, 'settings.json');
  await fsp.writeFile(secret, '{"secret":true}');
  // safeName reduces the traversal to a basename, so this resolves inside the plugin's own dir
  // (where it does not exist) rather than at the config root.
  await assert.rejects(() => pluginData.readFile('cpd-tracker', '../settings.json'), /ENOENT/);
  await pluginData.deleteFile('cpd-tracker', '../settings.json');
  assert.ok(fs.existsSync(secret), 'a file outside the plugin folder must survive');
});

test('importFile copies in and never overwrites an existing name', async () => {
  const src = path.join(HOME, 'certificate.pdf');
  await fsp.writeFile(src, 'first');

  const a = await pluginData.importFile('cpd-tracker', src);
  assert.strictEqual(a.name, 'certificate.pdf');
  assert.strictEqual(a.size, 5);

  await fsp.writeFile(src, 'second');
  const b = await pluginData.importFile('cpd-tracker', src);
  assert.strictEqual(b.name, 'certificate 1.pdf', 'a second file with the same name is renamed, not overwritten');

  const dir = pluginData.filesDir('cpd-tracker');
  assert.strictEqual(await fsp.readFile(path.join(dir, 'certificate.pdf'), 'utf8'), 'first');
  assert.strictEqual(await fsp.readFile(path.join(dir, 'certificate 1.pdf'), 'utf8'), 'second');

  const listed = (await pluginData.listFiles('cpd-tracker')).map((f) => f.name).sort();
  assert.deepStrictEqual(listed, ['certificate 1.pdf', 'certificate.pdf']);
});

test('importFile refuses a file over the size cap', async () => {
  const storage = require('../src/main/services/storage');
  const big = path.join(HOME, 'huge.bin');
  await fsp.writeFile(big, Buffer.alloc(storage.MAX_ATTACHMENT_BYTES + 1));
  await assert.rejects(() => pluginData.importFile('cpd-tracker', big), /limited to/);
  await fsp.unlink(big);
});

test('readFile returns a data: URL with a mime type, listFiles is empty for an unused plugin', async () => {
  const src = path.join(HOME, 'shot.png');
  await fsp.writeFile(src, Buffer.from('89504e47', 'hex'));
  const { name } = await pluginData.importFile('other-plugin', src);
  const url = await pluginData.readFile('other-plugin', name);
  assert.ok(url.startsWith('data:image/png;base64,'), url.slice(0, 40));

  assert.deepStrictEqual(await pluginData.listFiles('never-used'), []);
});

test('deleteFile removes the file and is a no-op the second time', async () => {
  const src = path.join(HOME, 'gone.txt');
  await fsp.writeFile(src, 'x');
  const { name } = await pluginData.importFile('other-plugin', src);
  await pluginData.deleteFile('other-plugin', name);
  assert.ok(!fs.existsSync(path.join(pluginData.filesDir('other-plugin'), name)));
  await pluginData.deleteFile('other-plugin', name);   // must not throw
});

test.after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });
