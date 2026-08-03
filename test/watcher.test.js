const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let home;
test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-watch-'));
  process.env.PNOTES_HOME = home;
});
test.after(() => {
  require('../src/main/services/watcher').closeAll();
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.PNOTES_HOME;
});

// Wait for the next change event, or resolve null after `ms`.
function nextChange(watcher, ms = 2500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { watcher.onChange(() => {}); resolve(null); }, ms);
    watcher.onChange((change) => { clearTimeout(timer); watcher.onChange(() => {}); resolve(change); });
  });
}

async function setupProject() {
  const storage = require('../src/main/services/storage');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-wp-'));
  const dir = path.join(root, 'Proj');
  await fsp.mkdir(dir, { recursive: true });
  await storage.writeNote(dir, 'A.md', 'original');
  return dir;
}

test('an external note edit is reported', async () => {
  const watcher = require('../src/main/services/watcher');
  const storage = require('../src/main/services/storage');
  const proj = await setupProject();
  await watcher.setWatched([proj]);

  // Let the setup write's self-write marker expire so this reads as a genuine external edit.
  await new Promise((r) => setTimeout(r, 500));

  const pending = nextChange(watcher);
  // Write directly, bypassing storage.writeNote, to simulate another editor.
  const metaDir = await storage.metaDirFor(proj);
  await fsp.writeFile(path.join(metaDir, 'notes', 'A.md'), 'changed elsewhere', 'utf8');

  const change = await pending;
  assert.ok(change, 'expected a change event');
  assert.strictEqual(change.kind, 'note');
  assert.strictEqual(change.noteName, 'A.md');
  assert.strictEqual(change.projectPath, proj);
  watcher.closeAll();
});

test("the app's own writes do not echo back as external changes", async () => {
  const watcher = require('../src/main/services/watcher');
  const storage = require('../src/main/services/storage');
  const proj = await setupProject();
  await watcher.setWatched([proj]);

  await new Promise((r) => setTimeout(r, 500));                  // clear the setup write's marker

  const pending = nextChange(watcher, 1200);
  await storage.writeNote(proj, 'A.md', 'written by the app');   // marks a self-write

  assert.strictEqual(await pending, null, 'self-write should be suppressed');
  watcher.closeAll();
});

test('setWatched replaces the watched set', async () => {
  const watcher = require('../src/main/services/watcher');
  const a = await setupProject();
  const b = await setupProject();

  assert.strictEqual(await watcher.setWatched([a, b]), 2);
  assert.strictEqual(await watcher.setWatched([b]), 1);
  assert.strictEqual(await watcher.setWatched([]), 0);
});

test('a project set up AFTER the last scan still gets watched', async () => {
  // Regression: watchProject bailed when the meta dir didn't exist yet, so any project whose
  // first data was created after the last rescan was silently never watched.
  const watcher = require('../src/main/services/watcher');
  const storage = require('../src/main/services/storage');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-late-'));
  const proj = path.join(root, 'FreshProject');
  await fsp.mkdir(proj, { recursive: true });

  // No data yet -> nothing to watch.
  assert.strictEqual(await watcher.setWatched([proj]), 0);
  assert.strictEqual(watcher.isWatched(proj), false);

  // First write creates the meta dir; ensureWatched must pick it up without a rescan.
  await storage.writeNote(proj, 'A.md', 'hello');
  watcher.ensureWatched(proj);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(watcher.isWatched(proj), true, 'should be watched after its first write');

  watcher.closeAll();
});

test('markSelfWrite suppresses the whole event burst, then expires', () => {
  const watcher = require('../src/main/services/watcher');
  const f = path.join(os.tmpdir(), 'x.md');
  watcher.markSelfWrite(f);
  // One write => several fs events; all of them must be suppressed.
  assert.strictEqual(watcher.isSelfWrite(f), true);
  assert.strictEqual(watcher.isSelfWrite(f), true);
  assert.strictEqual(watcher.isSelfWrite(path.join(os.tmpdir(), 'other.md')), false);
});
