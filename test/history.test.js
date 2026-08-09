// Note version history: the retention policy, the diff, and — most importantly — that snapshots
// stay invisible to every path that scans a project.
const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const policy = require('../src/shared/history');
const diff = require('../src/shared/diff');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 7, 4, 12, 0, 0).getTime();

// ---------- retention policy ----------

test('everything from the last 24 hours is kept', () => {
  const ts = [NOW - 60_000, NOW - HOUR, NOW - 6 * HOUR, NOW - 23 * HOUR];
  const { keep, drop } = policy.planRetention(ts, NOW);
  assert.strictEqual(keep.length, 4);
  assert.strictEqual(drop.length, 0);
});

test('beyond 24 hours only the newest snapshot of each day survives', () => {
  // Three from the same day, four days back.
  const base = NOW - 4 * DAY;
  const ts = [base, base + HOUR, base + 2 * HOUR];
  const { keep, drop } = policy.planRetention(ts, NOW);
  assert.deepStrictEqual(keep, [base + 2 * HOUR], 'the newest of that day');
  assert.deepStrictEqual(drop.sort(), [base, base + HOUR].sort());
});

test('separate days each keep one', () => {
  const ts = [NOW - 3 * DAY, NOW - 4 * DAY, NOW - 5 * DAY];
  const { keep, drop } = policy.planRetention(ts, NOW);
  assert.strictEqual(keep.length, 3);
  assert.strictEqual(drop.length, 0);
});

test('snapshots past 30 days are dropped', () => {
  const recent = NOW - HOUR;
  const old1 = NOW - 40 * DAY;
  const old2 = NOW - 50 * DAY;
  const { keep, drop } = policy.planRetention([recent, old1, old2], NOW);
  assert.ok(keep.includes(recent));
  // …except the oldest, which is always kept as the record of what the note first said.
  assert.ok(keep.includes(old2), 'the oldest surviving snapshot is never dropped');
  assert.deepStrictEqual(drop, [old1]);
});

test('a single very old snapshot is never dropped', () => {
  const ancient = NOW - 400 * DAY;
  const { keep, drop } = policy.planRetention([ancient], NOW);
  assert.deepStrictEqual(keep, [ancient]);
  assert.deepStrictEqual(drop, []);
});

test('empty input is handled', () => {
  assert.deepStrictEqual(policy.planRetention([], NOW), { keep: [], drop: [] });
});

test('duplicate timestamps collapse', () => {
  const t = NOW - HOUR;
  assert.deepStrictEqual(policy.planRetention([t, t, t], NOW).keep, [t]);
});

test('results come back newest-first', () => {
  const ts = [NOW - 3 * HOUR, NOW - HOUR, NOW - 2 * HOUR];
  assert.deepStrictEqual(policy.planRetention(ts, NOW).keep, [NOW - HOUR, NOW - 2 * HOUR, NOW - 3 * HOUR]);
});

// ---------- diff ----------

test('diff reports added and removed lines', () => {
  const rows = diff.diffLines('a\nb\nc', 'a\nB\nc');
  assert.deepStrictEqual(rows.map((r) => r.type), ['same', 'del', 'add', 'same']);
  assert.deepStrictEqual(diff.summarise(rows), { added: 1, removed: 1, unchanged: 2 });
});

test('diff of identical text has no changes', () => {
  const rows = diff.diffLines('same\ntext', 'same\ntext');
  assert.deepStrictEqual(diff.summarise(rows), { added: 0, removed: 0, unchanged: 2 });
});

test('diff handles insertion at the start and end', () => {
  assert.deepStrictEqual(diff.diffLines('b', 'a\nb').map((r) => r.type), ['add', 'same']);
  assert.deepStrictEqual(diff.diffLines('a', 'a\nb').map((r) => r.type), ['same', 'add']);
});

test('diff against empty text is all additions or all deletions', () => {
  assert.deepStrictEqual(diff.diffLines('', 'a\nb').map((r) => r.type), ['add', 'add']);
  assert.deepStrictEqual(diff.diffLines('a\nb', '').map((r) => r.type), ['del', 'del']);
});

test('diff normalises CRLF so a line-ending change is not a whole-file rewrite', () => {
  // Notes edited in Notepad come back CRLF; without this every line would read as changed.
  assert.deepStrictEqual(diff.summarise(diff.diffLines('a\r\nb', 'a\nb')), { added: 0, removed: 0, unchanged: 2 });
});

test('diff carries 1-based line numbers', () => {
  const rows = diff.diffLines('x\ny', 'x\nz');
  assert.strictEqual(rows.find((r) => r.type === 'del').aLine, 2);
  assert.strictEqual(rows.find((r) => r.type === 'add').bLine, 2);
});

test('collapse hides long unchanged runs but keeps context', () => {
  const oldText = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const newText = oldText.replace('line 20', 'CHANGED');
  const rows = diff.collapse(diff.diffLines(oldText, newText), 2);
  assert.ok(rows.some((r) => r.type === 'gap'), 'should summarise the untouched stretches');
  assert.ok(rows.length < 40, 'and be shorter than the full file');
  assert.ok(rows.some((r) => r.text === 'CHANGED'));
});

// ---------- the service, and the exclusions that matter ----------

let home, history, storage;

test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-hist-'));
  process.env.PNOTES_HOME = home;
  delete require.cache[require.resolve('../src/main/services/storage')];
  storage = require('../src/main/services/storage');
  history = require('../src/main/services/history');
});
test.after(() => { fs.rmSync(home, { recursive: true, force: true }); delete process.env.PNOTES_HOME; });

async function projectWith(noteBody) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-histproj-'));
  await storage.writeNote(root, 'Report.md', noteBody);
  return root;
}

test('a snapshot captures what the note said BEFORE the write', async () => {
  const p = await projectWith('original text');
  const ts = await history.maybeSnapshot(p, 'Report.md');
  assert.ok(ts, 'a snapshot should have been taken');
  await storage.writeNote(p, 'Report.md', 'replaced text');

  const snaps = await history.listSnapshots(p, 'Report.md');
  assert.strictEqual(snaps.length, 1);
  assert.strictEqual(await history.readSnapshot(p, 'Report.md', snaps[0].ts), 'original text');
  assert.strictEqual(await storage.readNote(p, 'Report.md'), 'replaced text');
});

test('rapid saves do not each produce a snapshot', async () => {
  // Autosave fires every 500ms of typing; without the floor a morning's work is tens of thousands.
  const p = await projectWith('v1');
  await history.maybeSnapshot(p, 'Report.md');
  for (let i = 0; i < 10; i++) {
    await storage.writeNote(p, 'Report.md', `v${i + 2}`);
    await history.maybeSnapshot(p, 'Report.md');
  }
  assert.strictEqual((await history.listSnapshots(p, 'Report.md')).length, 1);
});

test('an empty note is not snapshotted', async () => {
  const p = await projectWith('');
  assert.strictEqual(await history.maybeSnapshot(p, 'Report.md'), null);
  assert.deepStrictEqual(await history.listSnapshots(p, 'Report.md'), []);
});

test('history follows a rename', async () => {
  const p = await projectWith('before rename');
  await history.maybeSnapshot(p, 'Report.md');
  assert.strictEqual((await history.listSnapshots(p, 'Report.md')).length, 1);

  const finalName = await storage.renameNote(p, 'Report.md', 'Renamed');
  await history.renameHistory(p, 'Report.md', finalName);

  assert.deepStrictEqual(await history.listSnapshots(p, 'Report.md'), [], 'nothing left under the old name');
  assert.strictEqual((await history.listSnapshots(p, finalName)).length, 1, 'and it moved to the new one');
});

test('readSnapshot rejects a bogus id rather than touching the filesystem', async () => {
  const p = await projectWith('x');
  for (const bad of ['../../etc/passwd', '0', '-1', 'abc', 1.5]) {
    await assert.rejects(() => history.readSnapshot(p, 'Report.md', bad), /Invalid snapshot id/);
  }
});

test('CRITICAL: snapshots are invisible to listNotes', async () => {
  // .history sits beside notes/, not inside it. If that ever changes, this is the test that
  // catches snapshots showing up as phantom notes — in the sidebar, the board and the search index.
  const p = await projectWith('content');
  await history.maybeSnapshot(p, 'Report.md');
  assert.deepStrictEqual(await storage.listNotes(p), ['Report.md']);
});

test('CRITICAL: snapshots are invisible to backlinks', async () => {
  // findBacklinks reads every note via listNotes; a snapshot containing an old [[link]] must not
  // register as a live backlink.
  const search = require('../src/main/services/search');
  const p = await projectWith('see [[Target]] here');
  await history.maybeSnapshot(p, 'Report.md');
  await storage.writeNote(p, 'Report.md', 'the link is gone now');

  const links = await search.findBacklinks(p, 'Target');
  assert.deepStrictEqual(links, [], 'the snapshot must not count as a backlink');
});

test('CRITICAL: the history directory is outside notes/', async () => {
  const p = await projectWith('x');
  const dir = await history.historyDir(p, 'Report.md');
  const notes = path.join(await storage.metaDirFor(p), 'notes');
  assert.ok(!dir.startsWith(notes + path.sep), `${dir} must not be inside ${notes}`);
});

// ---------- where snapshots live ----------
//
// The location is a setting because the trade-off is real either way: central keeps snapshots out
// of a synced project folder (no sync traffic, no SharePoint quota for a safety net that belongs
// to the app), in-project keeps them travelling with the folder when it's copied or archived.

async function setHistoryLocation(location) {
  await storage.writeConfig('settings.json', { storageMode: 'infolder', folderName: 'ProjectNotes', historyLocation: location });
}

test('central is the default, so snapshots do not land in the project folder', async () => {
  await storage.writeConfig('settings.json', { storageMode: 'infolder', folderName: 'ProjectNotes' });
  const p = await projectWith('body');
  const root = await history.historyRoot(p);
  assert.ok(!storage.isInside(p, root), `${root} should not be inside ${p}`);
  assert.ok(storage.isInside(storage.centralRoot(), root), 'it belongs under the central root');
});

test('the in-project location sits beside notes/, not inside it', async () => {
  await setHistoryLocation('inproject');
  const p = await projectWith('body');
  const root = await history.historyRoot(p);
  const meta = await storage.metaDirFor(p);
  assert.strictEqual(path.resolve(root), path.resolve(meta, '.history'));
  assert.ok(!storage.isInside(path.join(meta, 'notes'), root), 'must not be under notes/ — listNotes would show it');
  await setHistoryLocation('central');
});

test('two projects with the same folder name keep separate central histories', async () => {
  await setHistoryLocation('central');
  const a = await projectWith('a');
  const b = await projectWith('b');
  // Distinct temp parents, same basename would still be distinct because the id hashes the path.
  assert.notStrictEqual(await history.historyRoot(a), await history.historyRoot(b));
});

test('switching the location moves existing snapshots with it', async () => {
  await setHistoryLocation('inproject');
  const p = await projectWith('first version');
  const ts = await history.maybeSnapshot(p, 'Report.md');
  assert.ok(ts, 'precondition: a snapshot exists');
  assert.strictEqual((await history.listSnapshots(p, 'Report.md')).length, 1);

  await setHistoryLocation('central');
  // Before relocating, the new location knows nothing about it — this is the orphaning the
  // relocate step exists to prevent.
  assert.deepStrictEqual(await history.listSnapshots(p, 'Report.md'), []);

  const moved = await history.relocate(p, 'inproject', 'central');
  assert.strictEqual(moved, 1);

  const snaps = await history.listSnapshots(p, 'Report.md');
  assert.strictEqual(snaps.length, 1, 'the version is visible again at the new location');
  assert.strictEqual(await history.readSnapshot(p, 'Report.md', snaps[0].ts), 'first version');

  // And it is no longer in the old place.
  const oldRoot = await history.historyRootFor(p, 'inproject');
  await assert.rejects(() => fsp.access(path.join(oldRoot, 'Report.md')));
});

test('relocating is a no-op when there is nothing to move', async () => {
  await setHistoryLocation('central');
  const p = await projectWith('body');
  assert.strictEqual(await history.relocate(p, 'inproject', 'central'), 0);
  assert.strictEqual(await history.relocate(p, 'central', 'central'), 0);
});

test('relocating does not clobber a history already at the destination', async () => {
  // Switch back and forth and both sides can hold versions of the same note. The destination copy
  // is the more recent record, so it wins.
  await setHistoryLocation('central');
  const p = await projectWith('central version');
  await history.maybeSnapshot(p, 'Report.md');
  const centralSnaps = await history.listSnapshots(p, 'Report.md');
  assert.strictEqual(centralSnaps.length, 1);

  // Plant a competing in-project history for the same note.
  const inProjectRoot = await history.historyRootFor(p, 'inproject');
  await fsp.mkdir(path.join(inProjectRoot, 'Report.md'), { recursive: true });
  await fsp.writeFile(path.join(inProjectRoot, 'Report.md', '1700000000000.md'), 'older in-project copy', 'utf8');

  assert.strictEqual(await history.relocate(p, 'inproject', 'central'), 0, 'nothing moved — the destination was occupied');
  const after = await history.listSnapshots(p, 'Report.md');
  assert.strictEqual(after.length, 1);
  assert.strictEqual(await history.readSnapshot(p, 'Report.md', after[0].ts), 'central version', 'the destination copy survived');
});
