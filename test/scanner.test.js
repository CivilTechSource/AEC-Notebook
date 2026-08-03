const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let home;
test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-scan-'));
  process.env.PNOTES_HOME = home;
});
test.after(() => { fs.rmSync(home, { recursive: true, force: true }); delete process.env.PNOTES_HOME; });

async function library(tree) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-lib-'));
  for (const dir of tree) await fsp.mkdir(path.join(root, dir), { recursive: true });
  return root;
}

test('scanRoot reports direct subfolders at depth 1', async () => {
  const scanner = require('../src/main/services/scanner');
  const root = await library(['Alpha', 'Beta', '.hidden']);
  const found = await scanner.scanRoot(root, 1);
  assert.deepStrictEqual(found.map((f) => f.name).sort(), ['Alpha', 'Beta']);
  assert.strictEqual(found.every((f) => f.hasMetadata === false), true);
});

test('scanRoot descends to the configured depth', async () => {
  const scanner = require('../src/main/services/scanner');
  const root = await library(['2024/Alpha', '2024/Beta', '2025/Gamma']);
  const found = await scanner.scanRoot(root, 2);
  assert.deepStrictEqual(found.map((f) => f.name).sort(), ['Alpha', 'Beta', 'Gamma']);
});

test('scanRootWithData returns project values in one call', async () => {
  const scanner = require('../src/main/services/scanner');
  const storage = require('../src/main/services/storage');
  const root = await library(['Alpha', 'Beta']);
  await storage.writeProject(path.join(root, 'Alpha'), { client: 'Acme', zone: 'zone3' });

  const found = await scanner.scanRootWithData(root, 1);
  const alpha = found.find((f) => f.name === 'Alpha');
  const beta = found.find((f) => f.name === 'Beta');

  assert.deepStrictEqual(alpha.values, { client: 'Acme', zone: 'zone3' });
  assert.strictEqual(alpha.hasMetadata, true);
  assert.strictEqual(beta.values, null);
  assert.strictEqual(beta.hasMetadata, false);
});

test('migrateMoved reconciles a project folder that moved, without rewriting on rescan', async () => {
  const scanner = require('../src/main/services/scanner');
  const storage = require('../src/main/services/storage');
  const root = await library(['Old']);
  const oldPath = path.join(root, 'Old');
  await storage.writeProject(oldPath, { client: 'Acme' });

  const newPath = path.join(root, 'New');
  await fsp.rename(oldPath, newPath);

  const rec = await scanner.migrateMoved(newPath);
  assert.deepStrictEqual(rec.values, { client: 'Acme' });
  assert.strictEqual((await storage.readProject(newPath)).meta.path, newPath);

  // Second call is a no-op (path already reconciled) â€” this is what keeps rescans cheap.
  const before = (await storage.readProject(newPath)).meta.updatedAt;
  await scanner.migrateMoved(newPath);
  assert.strictEqual((await storage.readProject(newPath)).meta.updatedAt, before);
});
