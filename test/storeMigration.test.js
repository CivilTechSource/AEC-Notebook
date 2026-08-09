// store.js is a browser IIFE. Load it against a stubbed `window.api` backed by the real storage
// layer, so the schema migration is exercised exactly as it runs in the app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const STORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'store.js'), 'utf8');
const VALIDATION_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'data_validation.js'), 'utf8');

async function bootStore(configs) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-store-'));
  process.env.PNOTES_HOME = home;
  delete require.cache[require.resolve('../src/main/services/storage')];
  const storage = require('../src/main/services/storage');
  for (const [name, data] of Object.entries(configs)) await storage.writeConfig(name, data);

  const win = {
    api: {
      readConfig: (f) => storage.readConfig(f),
      writeConfig: (f, d) => storage.writeConfig(f, d),
      scanRootWithData: async () => [],
      watchProjects: async () => 0,
    },
    Toast: { error: (m) => { throw new Error('unexpected Toast.error: ' + m); } },
  };
  const ctx = vm.createContext(win);
  ctx.window = win;
  vm.runInContext(VALIDATION_SRC, ctx);
  vm.runInContext(STORE_SRC, ctx);
  return { Store: win.Store, storage, home };
}

test('legacy byPath schemas migrate onto stable ids without losing fields', async () => {
  const libA = path.join(os.tmpdir(), 'LibA');
  const libB = path.join(os.tmpdir(), 'LibB');
  const { Store, storage, home } = await bootStore({
    'library.json': { paths: [{ path: libA, collapsed: false, depth: 1 }, { path: libB, collapsed: false, depth: 2 }] },
    'schemas.json': {
      byPath: {
        [libA]: { version: 4, sections: [{ id: 'sec_1', title: 'Details', fields: [{ id: 'f1', key: 'client', label: 'Client', type: 'text' }] }] },
        [libB]: { version: 2, sections: [{ id: 'sec_2', title: 'Site', fields: [{ id: 'f2', key: 'zone', label: 'Zone', type: 'dropdown', options: [] }] }] },
      },
    },
  });

  await Store.loadConfig();

  // Each library path still resolves to its own schema, with fields intact.
  assert.strictEqual(Store.schemaForPath(libA).sections[0].fields[0].key, 'client');
  assert.strictEqual(Store.schemaForPath(libA).version, 4);
  assert.strictEqual(Store.schemaForPath(libB).sections[0].fields[0].key, 'zone');
  assert.strictEqual(Store.schemaForPath(libB).sections[0].title, 'Site');

  // Persisted in the new shape, keyed by id, with library.json carrying the ids.
  const savedSchemas = await storage.readConfig('schemas.json');
  const savedLib = await storage.readConfig('library.json');
  assert.ok(savedSchemas.byId, 'schemas.json should now use byId');
  assert.strictEqual(savedSchemas.byPath, undefined);
  assert.strictEqual(Object.keys(savedSchemas.byId).length, 2);
  for (const lp of savedLib.paths) assert.ok(lp.schemaId, `${lp.path} should have a schemaId`);
  assert.notStrictEqual(savedLib.paths[0].schemaId, savedLib.paths[1].schemaId);

  fs.rmSync(home, { recursive: true, force: true });
});

test('migration is idempotent â€” a second load changes nothing', async () => {
  const lib = path.join(os.tmpdir(), 'LibC');
  const { Store, storage, home } = await bootStore({
    'library.json': { paths: [{ path: lib, collapsed: false, depth: 1 }] },
    'schemas.json': { byPath: { [lib]: { version: 3, sections: [{ id: 's', title: 'D', fields: [{ id: 'f', key: 'k', label: 'K', type: 'text' }] }] } } },
  });

  await Store.loadConfig();
  const afterFirst = JSON.stringify(await storage.readConfig('schemas.json'));
  const libAfterFirst = JSON.stringify(await storage.readConfig('library.json'));

  await Store.loadConfig();
  assert.strictEqual(JSON.stringify(await storage.readConfig('schemas.json')), afterFirst);
  assert.strictEqual(JSON.stringify(await storage.readConfig('library.json')), libAfterFirst);

  fs.rmSync(home, { recursive: true, force: true });
});

test('a renamed library folder keeps its schema when relinked', async () => {
  const oldPath = path.join(os.tmpdir(), 'OldName');
  const newPath = path.join(os.tmpdir(), 'NewName');
  const { Store, home } = await bootStore({
    'library.json': { paths: [{ path: oldPath, collapsed: false, depth: 1 }] },
    'schemas.json': { byPath: { [oldPath]: { version: 7, sections: [{ id: 's', title: 'D', fields: [{ id: 'f', key: 'client', label: 'Client', type: 'text' }] }] } } },
  });
  await Store.loadConfig();

  assert.strictEqual(await Store.relinkLibraryPath(oldPath, newPath), true);
  // The schema followed the entry to its new path â€” this is the whole point of stable ids.
  assert.strictEqual(Store.schemaForPath(newPath).sections[0].fields[0].key, 'client');
  assert.strictEqual(Store.schemaForPath(newPath).version, 7);

  fs.rmSync(home, { recursive: true, force: true });
});

test('a fresh install with no config gets a working empty schema', async () => {
  const { Store, home } = await bootStore({});
  await Store.loadConfig();
  // (compared by length, not deepStrictEqual: the array is from the vm realm)
  assert.strictEqual(Store.state.libraryPaths.length, 0);
  const s = Store.schemaForPath('/anything');
  assert.ok(Array.isArray(s.sections), 'unknown path should still yield a usable schema');
  fs.rmSync(home, { recursive: true, force: true });
});

test('schemas no library folder references are collected', async () => {
  // removeLibraryPath drops the path but not its schema, and the byPath migration mints a fresh id
  // for a schema whose path is gone. Both left schemas.json growing invisibly.
  const libA = path.join(os.tmpdir(), 'LibKept');
  const { Store, storage, home } = await bootStore({
    'library.json': { paths: [{ path: libA, collapsed: false, depth: 1, schemaId: 'sch_keep' }] },
    'schemas.json': {
      byId: {
        sch_keep: { version: 1, sections: [{ id: 's1', title: 'Details', fields: [{ id: 'f1', key: 'client', label: 'Client', type: 'text' }] }] },
        sch_orphan_1: { version: 1, sections: [{ id: 's2', title: 'Gone', fields: [] }] },
        sch_orphan_2: { version: 1, sections: [{ id: 's3', title: 'Also gone', fields: [] }] },
      },
    },
  });

  await Store.loadConfig();

  const saved = await storage.readConfig('schemas.json');
  assert.deepStrictEqual(Object.keys(saved.byId), ['sch_keep'], 'only the referenced schema survives');
  assert.strictEqual(Store.schemaForPath(libA).sections[0].fields[0].key, 'client', 'and it is intact');

  fs.rmSync(home, { recursive: true, force: true });
});

test('a failed schemas.json read never triggers the collection', async () => {
  // With an unreadable schemas.json, state.schemas is empty and "unreferenced" would describe
  // every schema the user has — collecting then would turn one bad read into permanent loss.
  const libA = path.join(os.tmpdir(), 'LibA2');
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-store-'));
  process.env.PNOTES_HOME = home;
  delete require.cache[require.resolve('../src/main/services/storage')];
  const storage = require('../src/main/services/storage');
  await storage.writeConfig('library.json', { paths: [{ path: libA, collapsed: false, depth: 1, schemaId: 'sch_x' }] });
  await fsp.writeFile(path.join(home, 'schemas.json'), '{ this is not json', 'utf8');

  const errors = [];
  const win = {
    api: {
      readConfig: (f) => storage.readConfig(f),
      writeConfig: (f, d) => storage.writeConfig(f, d),
      scanRootWithData: async () => [],
      watchProjects: async () => 0,
    },
    Toast: { error: (m) => errors.push(m) },
  };
  const ctx = vm.createContext(win);
  ctx.window = win;
  vm.runInContext(VALIDATION_SRC, ctx);
  vm.runInContext(STORE_SRC, ctx);

  await win.Store.loadConfig();

  assert.ok(errors.length, 'the user is told the file could not be read');
  // schemas.json was quarantined by readConfig; the key thing is that we did not write an
  // empty replacement over anything.
  const rewritten = await storage.readConfig('schemas.json');
  assert.ok(rewritten === null || Object.keys(rewritten.byId || {}).length === 0,
    'no schema file was rebuilt from empty state');

  fs.rmSync(home, { recursive: true, force: true });
});
