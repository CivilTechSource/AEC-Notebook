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

// ---------- re-homing out-of-folder data when a project moves ----------
//
// In central/custom mode the data directory is keyed on sha1(absolute project path). Renaming or
// moving a project folder changes that key, so every note vanished from the app while sitting
// safely on disk under the old hash. migrateMoved can't help — it reads through the NEW key, which
// is empty. The only surviving link is _meta.path inside project.json.

async function useCentralMode() {
  const storage = require('../src/main/services/storage');
  await storage.writeConfig('settings.json', { storageMode: 'central', folderName: 'ProjectNotes' });
  require('../src/main/services/scanner').invalidateOrphans();
}

async function useInFolderMode() {
  const storage = require('../src/main/services/storage');
  await storage.writeConfig('settings.json', { storageMode: 'infolder', folderName: 'ProjectNotes' });
  require('../src/main/services/scanner').invalidateOrphans();
}

test('central-mode data follows a project folder RENAMED in place', async () => {
  const storage = require('../src/main/services/storage');
  const scanner = require('../src/main/services/scanner');
  await useCentralMode();

  const root = await library(['Riverside Depot']);
  const before = path.join(root, 'Riverside Depot');
  await storage.writeProject(before, { client: 'Thames Water' });
  await storage.writeNote(before, 'Site visit.md', 'headwall is scoured');

  // Renamed in Explorer: same parent, different name.
  const after = path.join(root, 'Riverside Depot (archived)');
  await fsp.rename(before, after);
  assert.strictEqual(await storage.readProject(after), null, 'precondition: the new hash key is empty');

  scanner.invalidateOrphans();
  assert.strictEqual(await scanner.rehomeOutOfFolder(after), true);

  const rec = await storage.readProject(after);
  assert.ok(rec, 'project.json is readable at the new location');
  assert.strictEqual(rec.values.client, 'Thames Water');
  assert.deepStrictEqual(await storage.listNotes(after), ['Site visit.md'], 'and the notes came too');

  await useInFolderMode();
});

test('central-mode data follows a project folder MOVED to another parent', async () => {
  const storage = require('../src/main/services/storage');
  const scanner = require('../src/main/services/scanner');
  await useCentralMode();

  const from = await library(['Weir Refurbishment']);
  const to = await library([]);
  const before = path.join(from, 'Weir Refurbishment');
  await storage.writeProject(before, { stage: 'RIBA 4' });
  await storage.writeNote(before, 'Inspection.md', 'scour to the left abutment');

  // Dragged into an archive folder: same name, different parent.
  const after = path.join(to, 'Weir Refurbishment');
  await fsp.rename(before, after);
  assert.strictEqual(await storage.readProject(after), null, 'precondition: the new hash key is empty');

  scanner.invalidateOrphans();
  assert.strictEqual(await scanner.rehomeOutOfFolder(after), true);
  assert.strictEqual((await storage.readProject(after)).values.stage, 'RIBA 4');
  assert.deepStrictEqual(await storage.listNotes(after), ['Inspection.md']);

  await useInFolderMode();
});

test('scanRootWithData reports a re-homed project as set up, not as new', async () => {
  // scanRoot decides hasMetadata before any re-homing has happened, so without the follow-up the
  // reconnected project still showed "not set up" until the next rescan.
  const storage = require('../src/main/services/storage');
  const scanner = require('../src/main/services/scanner');
  await useCentralMode();

  const root = await library(['Pumping Station']);
  const before = path.join(root, 'Pumping Station');
  await storage.writeProject(before, { client: 'Anglian' });
  const after = path.join(root, 'Pumping Station A');
  await fsp.rename(before, after);

  scanner.invalidateOrphans();
  const found = await scanner.scanRootWithData(root, 1);
  const entry = found.find((f) => f.path === after);
  assert.ok(entry, 'the folder is still scanned');
  assert.strictEqual(entry.hasMetadata, true, 'and reported as configured');
  assert.strictEqual(entry.values.client, 'Anglian');

  await useInFolderMode();
});

test('re-homing refuses to guess when two orphans could match', async () => {
  const storage = require('../src/main/services/storage');
  const scanner = require('../src/main/services/scanner');
  await useCentralMode();

  // Two different projects that happen to share a folder name, both moved away.
  const rootA = await library(['Bridge 12']);
  const rootB = await library(['Bridge 12']);
  await storage.writeProject(path.join(rootA, 'Bridge 12'), { client: 'A' });
  await storage.writeProject(path.join(rootB, 'Bridge 12'), { client: 'B' });
  await fsp.rm(path.join(rootA, 'Bridge 12'), { recursive: true, force: true });
  await fsp.rm(path.join(rootB, 'Bridge 12'), { recursive: true, force: true });

  const rootC = await library(['Bridge 12']);
  const target = path.join(rootC, 'Bridge 12');

  scanner.invalidateOrphans();
  assert.strictEqual(await scanner.rehomeOutOfFolder(target), false, 'ambiguous — must not pick one');
  assert.strictEqual(await storage.readProject(target), null, 'and must not have written anything');

  await useInFolderMode();
});

test('re-homing leaves a project alone when its data is already in place', async () => {
  const storage = require('../src/main/services/storage');
  const scanner = require('../src/main/services/scanner');
  await useCentralMode();

  const root = await library(['Culvert Survey']);
  const p = path.join(root, 'Culvert Survey');
  await storage.writeProject(p, { client: 'Severn Trent' });

  scanner.invalidateOrphans();
  assert.strictEqual(await scanner.rehomeOutOfFolder(p), false, 'nothing to do');
  assert.strictEqual((await storage.readProject(p)).values.client, 'Severn Trent');

  await useInFolderMode();
});

test('re-homing is a no-op in in-folder mode, where data moves with the folder anyway', async () => {
  const scanner = require('../src/main/services/scanner');
  await useInFolderMode();
  const root = await library(['Anything']);
  assert.strictEqual(await scanner.rehomeOutOfFolder(path.join(root, 'Anything')), false);
});
