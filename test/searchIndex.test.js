const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let home;
test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-idx-'));
  process.env.PNOTES_HOME = home;
});
test.after(() => { fs.rmSync(home, { recursive: true, force: true }); delete process.env.PNOTES_HOME; });

async function makeProject(name, notes) {
  const storage = require('../src/main/services/storage');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-p-'));
  const dir = path.join(root, name);
  await fsp.mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(notes)) await storage.writeNote(dir, file, body);
  return { path: dir, name };
}

test('#tag search matches the tag, not prose containing the word', async () => {
  const idx = require('../src/main/services/searchIndex');
  const p = await makeProject('P', {
    'Tagged.md': 'inspection done #drainage today',
    'Prose.md': 'we discussed drainage at length but tagged nothing',
  });
  idx.invalidate();

  const tagged = await idx.query('#drainage', [p]);
  assert.deepStrictEqual(tagged.map((r) => r.noteName), ['Tagged.md']);

  // Plain word search still finds both notes.
  const plain = await idx.query('drainage', [p]);
  assert.strictEqual(plain.length, 2);
});

test('#tag search returns nothing for an unused tag', async () => {
  const idx = require('../src/main/services/searchIndex');
  const p = await makeProject('Q', { 'A.md': 'no tags here' });
  idx.invalidate();
  assert.deepStrictEqual(await idx.query('#nope', [p]), []);
});

test('full-text search finds note bodies and project names', async () => {
  const idx = require('../src/main/services/searchIndex');
  const p = await makeProject('Riverside', { 'Note.md': 'culvert headwall detail' });
  idx.invalidate();
  const hits = await idx.query('culvert', [p]);
  assert.strictEqual(hits[0].noteName, 'Note.md');
  assert.match(hits[0].snippet, /culvert/);
});

// ---------- incremental invalidation ----------
//
// invalidate() used to be called on every write, and the next query re-read every note in every
// project. On OneDrive Files On-Demand that is a download per file and an outright failure when
// offline. These tests pin the behaviour that replaced it: one changed note costs one read.

// Count reads by wrapping storage.readNote for the duration of a query.
async function countingReads(fn) {
  const storage = require('../src/main/services/storage');
  const real = storage.readNote;
  let reads = 0;
  storage.readNote = (...a) => { reads += 1; return real(...a); };
  try { return { result: await fn(), reads }; }
  finally { storage.readNote = real; }
}

test('editing one note re-reads only that note, not the whole library', async () => {
  const idx = require('../src/main/services/searchIndex');
  const storage = require('../src/main/services/storage');
  const p = await makeProject('Incr', {
    'One.md': 'alpha content', 'Two.md': 'beta content', 'Three.md': 'gamma content',
    'Four.md': 'delta content', 'Five.md': 'epsilon content',
  });

  idx.invalidate();
  await idx.query('content', [p]);                     // build the index

  await storage.writeNote(p.path, 'Two.md', 'beta content plus culvert');
  idx.invalidateNote(p.path, 'Two.md');

  const { reads } = await countingReads(() => idx.query('culvert', [p]));
  assert.strictEqual(reads, 1, `one edited note should cost one read, not ${reads}`);
});

test('an edited note is findable by its new text and not by the old', async () => {
  const idx = require('../src/main/services/searchIndex');
  const storage = require('../src/main/services/storage');
  const p = await makeProject('Edited', { 'Note.md': 'headwall detail' });

  idx.invalidate();
  assert.strictEqual((await idx.query('headwall', [p])).length, 1);

  await storage.writeNote(p.path, 'Note.md', 'gabion detail');
  idx.invalidateNote(p.path, 'Note.md');

  assert.deepStrictEqual(await idx.query('headwall', [p]), [], 'the old text must be gone');
  assert.strictEqual((await idx.query('gabion', [p])).length, 1, 'the new text must be findable');
});

test('a deleted note leaves the index rather than lingering as an empty document', async () => {
  // readNote returns '' for a missing file, so re-indexing naively would have left a document
  // whose title still matched the note name.
  const idx = require('../src/main/services/searchIndex');
  const storage = require('../src/main/services/storage');
  const p = await makeProject('Deleted', { 'Doomed.md': 'scour protection', 'Kept.md': 'scour notes' });

  idx.invalidate();
  assert.strictEqual((await idx.query('scour', [p])).length, 2);

  await storage.deleteNote(p.path, 'Doomed.md');
  idx.invalidateNote(p.path, 'Doomed.md');

  const hits = await idx.query('scour', [p]);
  assert.deepStrictEqual(hits.map((h) => h.noteName), ['Kept.md']);
  assert.deepStrictEqual(await idx.query('Doomed', [p]), [], 'the title must not match either');
});

test('a note created after the build is picked up', async () => {
  const idx = require('../src/main/services/searchIndex');
  const storage = require('../src/main/services/storage');
  const p = await makeProject('Created', { 'First.md': 'existing' });

  idx.invalidate();
  await idx.query('existing', [p]);

  await storage.writeNote(p.path, 'Second.md', 'piling record');
  idx.invalidateNote(p.path, 'Second.md');

  const hits = await idx.query('piling', [p]);
  assert.deepStrictEqual(hits.map((h) => h.noteName), ['Second.md']);
});

test('a project field change does not re-read any notes', async () => {
  const idx = require('../src/main/services/searchIndex');
  const storage = require('../src/main/services/storage');
  const p = await makeProject('Fields', { 'A.md': 'a', 'B.md': 'b', 'C.md': 'c' });

  idx.invalidate();
  await idx.query('a', [p]);

  await storage.writeProject(p.path, { client: 'Thames Water' });
  idx.invalidateProject(p.path);

  const { reads } = await countingReads(() => idx.query('Thames', [p]));
  assert.strictEqual(reads, 0, `a field edit should read no notes at all, read ${reads}`);
});

test('project field values are searchable after an incremental update', async () => {
  const idx = require('../src/main/services/searchIndex');
  const storage = require('../src/main/services/storage');
  const p = await makeProject('Searchable', { 'A.md': 'nothing relevant' });

  idx.invalidate();
  await idx.query('nothing', [p]);

  await storage.writeProject(p.path, { planningRef: 'APP-2026-0417' });
  idx.invalidateProject(p.path);

  const hits = await idx.query('APP-2026-0417', [p]);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].type, 'project');
});
