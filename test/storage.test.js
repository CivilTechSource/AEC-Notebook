// storage.js — the parts where getting it wrong writes the user's data somewhere it shouldn't be.
//
// The app folder name is typed by a user on the Storage page and then joined onto every project
// path, so it is the one piece of user input that can move the data directory. The path allowlist
// can't catch that: it validates the *project* path it was handed, not the directory the storage
// layer goes on to resolve.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let home;
test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-store-'));
  process.env.PNOTES_HOME = home;
});
test.after(() => { fs.rmSync(home, { recursive: true, force: true }); delete process.env.PNOTES_HOME; });

const storage = () => require('../src/main/services/storage');

// Rewrite settings.json and drop the cached copy, the way config:write does in the app.
async function setSettings(patch) {
  await fsp.writeFile(path.join(home, 'settings.json'), JSON.stringify(patch), 'utf8');
  await storage().writeConfig('settings.json', patch);   // writeConfig invalidates the cache
}

// ---------- sanitizeFolderName ----------

test('a folder name with path separators cannot walk out of the project', () => {
  const { sanitizeFolderName } = storage();
  for (const evil of ['../..', '..\\..', '../secrets', 'a/b', 'a\\b', '..']) {
    const clean = sanitizeFolderName(evil);
    assert.ok(!clean.includes('/') && !clean.includes('\\'), `${evil} -> ${clean} still has a separator`);
    assert.ok(!/(^|[/\\])\.\.($|[/\\])/.test(clean), `${evil} -> ${clean} still has a .. segment`);
  }
});

test('dot-only names fall back to the default rather than resolving to the parent', () => {
  const { sanitizeFolderName, DEFAULT_FOLDER } = storage();
  assert.strictEqual(sanitizeFolderName('.'), DEFAULT_FOLDER);
  assert.strictEqual(sanitizeFolderName('..'), DEFAULT_FOLDER);
  assert.strictEqual(sanitizeFolderName('...'), DEFAULT_FOLDER);
});

test('empty, whitespace and null fall back to the default', () => {
  const { sanitizeFolderName, DEFAULT_FOLDER } = storage();
  for (const v of ['', '   ', null, undefined]) assert.strictEqual(sanitizeFolderName(v), DEFAULT_FOLDER);
});

test('Windows-reserved characters are stripped', () => {
  const { sanitizeFolderName } = storage();
  assert.strictEqual(sanitizeFolderName('Proj:ect*Notes?'), 'ProjectNotes');
});

test('an ordinary name is left alone', () => {
  const { sanitizeFolderName } = storage();
  assert.strictEqual(sanitizeFolderName('_MetaData'), '_MetaData');
  assert.strictEqual(sanitizeFolderName('Project Notes'), 'Project Notes');
});

test('a name with accents or spaces survives — this is not a slug', () => {
  const { sanitizeFolderName } = storage();
  assert.strictEqual(sanitizeFolderName('Résidence  Notes'), 'Résidence Notes');
});

// ---------- metaDirFor containment ----------

test('the resolved data directory stays inside the project folder', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  for (const folderName of ['../../elsewhere', '..', 'Notes']) {
    await setSettings({ storageMode: 'infolder', folderName });
    const dir = await s.metaDirFor(project);
    assert.ok(s.isInside(project, dir), `folderName "${folderName}" resolved to ${dir}, outside ${project}`);
  }
  fs.rmSync(project, { recursive: true, force: true });
});

test('a blank folder name does not collapse the data dir onto the project root', async () => {
  // It used to: metaDirFor returned projectPath itself, which put a recursive fs.watch over the
  // whole project tree and mixed notes/ in with the user's actual files.
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: '' });
  const dir = await s.metaDirFor(project);
  assert.notStrictEqual(path.resolve(dir), path.resolve(project));
  assert.strictEqual(path.basename(dir), s.DEFAULT_FOLDER);
  fs.rmSync(project, { recursive: true, force: true });
});

// ---------- isInside ----------

test('isInside does not match a sibling that merely shares a prefix', () => {
  const { isInside } = storage();
  assert.ok(isInside('/lib', '/lib/a'));
  assert.ok(isInside('/lib', '/lib'));
  assert.ok(!isInside('/lib', '/library-secrets'));
});

// ---------- retryOnLock ----------

test('retryOnLock retries EBUSY and returns the eventual success', async () => {
  const { retryOnLock } = storage();
  let calls = 0;
  const result = await retryOnLock(async () => {
    calls += 1;
    if (calls < 3) { const e = new Error('locked by the sync client'); e.code = 'EBUSY'; throw e; }
    return 'written';
  });
  assert.strictEqual(result, 'written');
  assert.strictEqual(calls, 3);
});

test('retryOnLock retries EPERM — the rename half of an atomic write', async () => {
  const { retryOnLock } = storage();
  let calls = 0;
  await retryOnLock(async () => {
    calls += 1;
    if (calls < 2) { const e = new Error('perm'); e.code = 'EPERM'; throw e; }
    return true;
  });
  assert.strictEqual(calls, 2);
});

test('retryOnLock does not retry a real failure', async () => {
  const { retryOnLock } = storage();
  let calls = 0;
  await assert.rejects(
    () => retryOnLock(async () => { calls += 1; const e = new Error('disk full'); e.code = 'ENOSPC'; throw e; }),
    /disk full/,
  );
  assert.strictEqual(calls, 1, 'ENOSPC must surface immediately, not after a second of retries');
});

test('retryOnLock gives up eventually rather than looping forever', async () => {
  const { retryOnLock } = storage();
  let calls = 0;
  await assert.rejects(
    () => retryOnLock(async () => { calls += 1; const e = new Error('still locked'); e.code = 'EBUSY'; throw e; }),
    /still locked/,
  );
  assert.ok(calls > 1 && calls <= 5, `expected a small bounded number of attempts, got ${calls}`);
});

// ---------- attachments ----------

test('an attachment over the cap is refused, and the message names the file and its size', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });
  const tooBig = Buffer.alloc(s.MAX_ATTACHMENT_BYTES + 1).toString('base64');
  await assert.rejects(
    () => s.saveAttachment(project, 'Site Plan Rev C.pdf', tooBig),
    (err) => /Site Plan Rev C\.pdf/.test(err.message) && /MB/.test(err.message),
  );
  fs.rmSync(project, { recursive: true, force: true });
});

test('two attachments with the same name both survive', async () => {
  // uniqueAttachment checks for a free name and the write used to happen separately, so a second
  // save landing in that gap replaced the first file rather than picking a new name.
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });

  const rels = await Promise.all([
    s.saveAttachment(project, 'photo.jpg', Buffer.from('first').toString('base64')),
    s.saveAttachment(project, 'photo.jpg', Buffer.from('second').toString('base64')),
    s.saveAttachment(project, 'photo.jpg', Buffer.from('third').toString('base64')),
  ]);

  assert.strictEqual(new Set(rels).size, 3, 'each save must get its own filename');
  const bodies = await Promise.all(rels.map(async (rel) => {
    const url = await s.readAttachment(project, rel);
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
  }));
  assert.deepStrictEqual(bodies.sort(), ['first', 'second', 'third']);
  fs.rmSync(project, { recursive: true, force: true });
});

// ---------- write chains ----------

test('overlapping note writes land whole, in order, leaving no temp files', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });

  await Promise.all(Array.from({ length: 25 }, (_, i) => s.writeNote(project, 'Race.md', `body ${i}`)));
  assert.strictEqual(await s.readNote(project, 'Race.md'), 'body 24');

  const notesDir = path.join(project, 'Notes', 'notes');
  const leftovers = (await fsp.readdir(notesDir)).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(leftovers, [], 'atomic writes must not strand temp files');
  fs.rmSync(project, { recursive: true, force: true });
});

// ---------- stranded temp files ----------
//
// Every atomic write is writeFile(tmp) + rename(tmp, file). A hard kill between the two strands
// the temp. Found in a real app folder: six window.json.<pid>.<n>.tmp files, one per killed
// session, dating back days — window.json is rewritten on every window move.

test('a stale temp file is collected', async () => {
  const s = storage();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-tmp-'));
  const stale = path.join(dir, 'window.json.12780.4.tmp');
  await fsp.writeFile(stale, 'x', 'utf8');
  // Backdate it past the age threshold rather than waiting an hour.
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await fsp.utimes(stale, old, old);

  assert.strictEqual(await s.sweepStaleTemps(dir), 1);
  await assert.rejects(() => fsp.access(stale));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a temp file from a write in flight is left alone', async () => {
  const s = storage();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-tmp-'));
  const fresh = path.join(dir, 'project.json.999.1.tmp');
  await fsp.writeFile(fresh, 'x', 'utf8');

  assert.strictEqual(await s.sweepStaleTemps(dir), 0, 'a recent temp may belong to a live write');
  await fsp.access(fresh);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the sweep only touches files matching our own temp pattern', async () => {
  const s = storage();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-tmp-'));
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  // Things that must survive: a real note, a backup, and somebody else's .tmp.
  const keep = ['Site visit.md', 'settings.json.bak', 'notes.tmp', 'draft.tmp.md'];
  for (const name of keep) {
    const f = path.join(dir, name);
    await fsp.writeFile(f, 'keep', 'utf8');
    await fsp.utimes(f, old, old);
  }
  const ours = path.join(dir, 'notes.json.4242.9.tmp');
  await fsp.writeFile(ours, 'x', 'utf8');
  await fsp.utimes(ours, old, old);

  assert.strictEqual(await s.sweepStaleTemps(dir), 1);
  for (const name of keep) await fsp.access(path.join(dir, name));   // throws if any went missing
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sweeping a directory that does not exist is not an error', async () => {
  const s = storage();
  assert.strictEqual(await s.sweepStaleTemps(path.join(os.tmpdir(), 'aecnb-does-not-exist-' + Date.now())), 0);
});

// ---------- attachment links ----------
//
// A markdown link target is a URL, not a path. Left raw, marked refuses to parse a target that
// contains a space, a paren or a bracket, and the note shows `![x](attachments/a b.png)` as
// literal text — no image, no link, no error. Our own de-duplication appends " 1" on a collision,
// so dropping the same file twice used to manufacture a broken link.

test('attachmentName decodes before taking the basename', () => {
  const { attachmentName } = storage();
  assert.strictEqual(attachmentName('attachments/diamond%201.png'), 'diamond 1.png');
  assert.strictEqual(attachmentName('attachments/plan%20%28rev%20A%29.png'), 'plan (rev A).png');
});

test('attachmentName still reads links written before targets were encoded', () => {
  const { attachmentName } = storage();
  assert.strictEqual(attachmentName('attachments/diamond 1.png'), 'diamond 1.png');
});

test('a stray percent does not throw — it is a legacy raw filename, not an escape', () => {
  // decodeURIComponent('50% slope.png') raises URIError. Falling back to the undecoded string is
  // right: that is exactly what the old, unencoded link meant.
  const { attachmentName } = storage();
  assert.strictEqual(attachmentName('attachments/50% slope.png'), '50% slope.png');
});

test('an attachment link cannot escape the attachments folder', () => {
  const { attachmentName } = storage();
  assert.strictEqual(attachmentName('attachments/../../notes/Secret.md'), 'Secret.md');
  // Encoded traversal is why the decode has to happen BEFORE basename, not after.
  assert.strictEqual(attachmentName('..%2F..%2Fnotes%2FSecret.md'), 'Secret.md');
  assert.strictEqual(attachmentName('attachments/%2e%2e%2fSecret.md'), 'Secret.md');
});

// ---------- listing and deleting ----------

test('listAttachments reports name, size and mtime, sorted', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });
  await s.saveAttachment(project, 'beta.png', Buffer.from('bb').toString('base64'));
  await s.saveAttachment(project, 'alpha.pdf', Buffer.from('aaaa').toString('base64'));

  const list = await s.listAttachments(project);
  assert.deepStrictEqual(list.map((f) => f.name), ['alpha.pdf', 'beta.png']);
  assert.strictEqual(list[0].size, 4);
  assert.ok(list[0].mtime > 0);
  fs.rmSync(project, { recursive: true, force: true });
});

test('listAttachments returns [] when nothing has been attached', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });
  assert.deepStrictEqual(await s.listAttachments(project), []);
  fs.rmSync(project, { recursive: true, force: true });
});

test('deleting an attachment frees the name, so undo restores it exactly', async () => {
  // This is why there is no restore channel: undo goes back through saveAttachment, and the name
  // being free is what makes the link in the note keep working.
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });
  const rel = await s.saveAttachment(project, 'site plan.pdf', Buffer.from('pdf-bytes').toString('base64'));
  assert.strictEqual(rel, 'attachments/site plan.pdf');

  await s.deleteAttachment(project, 'attachments/site%20plan.pdf');    // encoded, as a note holds it
  assert.deepStrictEqual(await s.listAttachments(project), []);

  const again = await s.saveAttachment(project, 'site plan.pdf', Buffer.from('pdf-bytes').toString('base64'));
  assert.strictEqual(again, rel, 'the restore must land on the original name, not "site plan 1.pdf"');
  fs.rmSync(project, { recursive: true, force: true });
});

test('deleting an attachment that is already gone is not an error', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });
  assert.strictEqual(await s.deleteAttachment(project, 'attachments/never-existed.png'), true);
  fs.rmSync(project, { recursive: true, force: true });
});

test('deleting cannot be tricked into removing a note', async () => {
  const s = storage();
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-proj-'));
  await setSettings({ storageMode: 'infolder', folderName: 'Notes' });
  await s.writeNote(project, 'Keep me.md', 'important');
  await s.deleteAttachment(project, 'attachments/../notes/Keep me.md');
  assert.deepStrictEqual(await s.listNotes(project), ['Keep me.md'], 'the note must survive');
  fs.rmSync(project, { recursive: true, force: true });
});
