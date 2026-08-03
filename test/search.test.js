const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// storage/search resolve config through PNOTES_HOME; point it at a scratch dir per run.
let home;
test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-search-'));
  process.env.PNOTES_HOME = home;
});
test.after(() => { fs.rmSync(home, { recursive: true, force: true }); delete process.env.PNOTES_HOME; });

async function project(name, notes) {
  const storage = require('../src/main/services/storage');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  const dir = path.join(root, name);
  await fsp.mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(notes)) await storage.writeNote(dir, file, body);
  return dir;
}

test('findBacklinks finds notes linking to a target and skips self', async () => {
  const search = require('../src/main/services/search');
  const p = await project('P1', {
    'Site Visit.md': 'nothing here',
    'Survey.md': 'see [[Site Visit]] for details',
    'Aliased.md': 'see [[Site Visit|the visit]]',
    'Other.md': 'links to [[Survey]] instead',
  });
  const links = await search.findBacklinks(p, 'Site Visit');
  assert.deepStrictEqual(links.map((l) => l.noteName).sort(), ['Aliased.md', 'Survey.md']);
});

test('rewriteWikilinks repoints links and preserves aliases', async () => {
  const search = require('../src/main/services/search');
  const storage = require('../src/main/services/storage');
  const p = await project('P2', {
    'Survey.md': 'see [[Site Visit]] and [[Site Visit|the visit]] and [[Other]]',
    'Untouched.md': 'only [[Other]] here',
  });

  const res = await search.rewriteWikilinks(p, 'Site Visit', 'Site Inspection');
  assert.strictEqual(res.count, 2);
  assert.deepStrictEqual(res.files, ['Survey.md']);

  const body = await storage.readNote(p, 'Survey.md');
  assert.match(body, /\[\[Site Inspection\]\]/);
  assert.match(body, /\[\[Site Inspection\|the visit\]\]/);
  assert.match(body, /\[\[Other\]\]/);                       // unrelated link untouched
  assert.doesNotMatch(body, /Site Visit/);

  assert.strictEqual(await storage.readNote(p, 'Untouched.md'), 'only [[Other]] here');
});

test('rewriteWikilinks is a no-op when the name is unchanged', async () => {
  const search = require('../src/main/services/search');
  const p = await project('P3', { 'A.md': '[[X]]' });
  assert.deepStrictEqual(await search.rewriteWikilinks(p, 'X', 'X'), { files: [], count: 0 });
  assert.deepStrictEqual(await search.rewriteWikilinks(p, 'X', ''), { files: [], count: 0 });
});

test('rewriteWikilinks matches case-insensitively, like the link resolver', async () => {
  const search = require('../src/main/services/search');
  const storage = require('../src/main/services/storage');
  const p = await project('P4', { 'A.md': 'go to [[site visit]]' });
  const res = await search.rewriteWikilinks(p, 'Site Visit', 'Site Inspection');
  assert.strictEqual(res.count, 1);
  assert.match(await storage.readNote(p, 'A.md'), /\[\[Site Inspection\]\]/);
});
