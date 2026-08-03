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
  const storage = require('../src/main/storage');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-p-'));
  const dir = path.join(root, name);
  await fsp.mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(notes)) await storage.writeNote(dir, file, body);
  return { path: dir, name };
}

test('#tag search matches the tag, not prose containing the word', async () => {
  const idx = require('../src/main/searchIndex');
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
  const idx = require('../src/main/searchIndex');
  const p = await makeProject('Q', { 'A.md': 'no tags here' });
  idx.invalidate();
  assert.deepStrictEqual(await idx.query('#nope', [p]), []);
});

test('full-text search finds note bodies and project names', async () => {
  const idx = require('../src/main/searchIndex');
  const p = await makeProject('Riverside', { 'Note.md': 'culvert headwall detail' });
  idx.invalidate();
  const hits = await idx.query('culvert', [p]);
  assert.strictEqual(hits[0].noteName, 'Note.md');
  assert.match(hits[0].snippet, /culvert/);
});
