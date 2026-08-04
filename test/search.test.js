// NOTE: the wikilink syntax grew in Phase 2 ([[Note#Heading]] and ![[Note]] embeds). These tests
// exist because the main-process regex has to track the renderer's, and a mismatch is silent:
// unrecognised links simply don't appear as backlinks and aren't repointed on rename.
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

test('note writes are atomic and serialised', async () => {
  // Regression: writeNote was a bare writeFile — no temp+rename, no chain — so a crash mid-write
  // truncated the note, and the autosave, a ticked checkbox and a link rewrite could interleave.
  const storage = require('../src/main/services/storage');
  const p = await project('Patomic', { 'Note.md': 'start' });

  // Fire many overlapping writes at the same file; the last one queued must win intact.
  const writes = [];
  for (let i = 0; i < 25; i++) writes.push(storage.writeNote(p, 'Note.md', `revision ${i}\n`.repeat(50)));
  await Promise.all(writes);

  const body = await storage.readNote(p, 'Note.md');
  assert.strictEqual(body, `revision 24\n`.repeat(50), 'the final write should land whole');

  // No temp files may survive a successful run.
  const notesPath = path.join(p, 'ProjectNotes', 'notes');
  const left = (await fsp.readdir(notesPath)).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(left, [], 'temp files must be renamed away, not left behind');
});

test('createNote never truncates an existing note', async () => {
  const storage = require('../src/main/services/storage');
  const p = await project('Pcreate', { 'Report.md': 'valuable content' });
  const name = await storage.createNote(p, 'Report');
  assert.notStrictEqual(name, 'Report.md', 'must pick a free name');
  assert.strictEqual(await storage.readNote(p, 'Report.md'), 'valuable content', 'the original must survive');
});

test('findBacklinks sees heading links and embeds, not just plain links', async () => {
  // Regression: the Phase 2 syntax extension left the main-process regex behind, so a
  // [[Note#Heading]] link was invisible here — no backlink, and no repoint on rename.
  const search = require('../src/main/services/search');
  const p = await project('P1h', {
    'Site Visit.md': 'target',
    'Heading.md': 'jump to [[Site Visit#Access]] please',
    'Embed.md': 'inlined below\n\n![[Site Visit]]',
    'Both.md': 'section embed ![[Site Visit#Hazards]]',
    'Unrelated.md': 'no links at all',
  });
  const links = await search.findBacklinks(p, 'Site Visit');
  assert.deepStrictEqual(links.map((l) => l.noteName).sort(), ['Both.md', 'Embed.md', 'Heading.md']);
});

test('rewriteWikilinks carries the heading, alias and embed marker through a rename', async () => {
  const search = require('../src/main/services/search');
  const storage = require('../src/main/services/storage');
  const p = await project('P2h', {
    'Refs.md': [
      'plain [[Old Name]]',
      'heading [[Old Name#Access]]',
      'alias [[Old Name|the old one]]',
      'both [[Old Name#Access|jump]]',
      'embed ![[Old Name]]',
      'embed section ![[Old Name#Access]]',
      'untouched [[Something Else]]',
    ].join('\n'),
  });
  const res = await search.rewriteWikilinks(p, 'Old Name', 'New Name');
  assert.strictEqual(res.count, 6);

  const body = await storage.readNote(p, 'Refs.md');
  assert.match(body, /plain \[\[New Name\]\]/);
  assert.match(body, /heading \[\[New Name#Access\]\]/, 'the heading must survive');
  assert.match(body, /alias \[\[New Name\|the old one\]\]/);
  assert.match(body, /both \[\[New Name#Access\|jump\]\]/);
  assert.match(body, /embed !\[\[New Name\]\]/, 'the ! must survive or the embed becomes a link');
  assert.match(body, /embed section !\[\[New Name#Access\]\]/);
  assert.match(body, /untouched \[\[Something Else\]\]/);
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
