// The template store on disk. Name handling gets the most attention: template names come from the
// renderer, so safeTemplatePath is the boundary that keeps them inside the templates directory.
const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let templates, home;

test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aecnb-tpl-'));
  process.env.PNOTES_HOME = home;                       // centralRoot() honours this
  delete require.cache[require.resolve('../src/main/services/storage')];
  delete require.cache[require.resolve('../src/main/services/templates')];
  templates = require('../src/main/services/templates');
});

test.after(async () => {
  delete process.env.PNOTES_HOME;
  await fsp.rm(home, { recursive: true, force: true });
});

test('starter templates are written on first use', async () => {
  const created = await templates.ensureStarters();
  assert.strictEqual(created, true);
  const files = await fsp.readdir(templates.templatesDir());
  assert.ok(files.includes('Site visit.md'));
  assert.ok(files.includes('RFI.md'));
});

test('an existing templates folder is left completely alone', async () => {
  // Once the folder exists it belongs to the user; we must never add files back into it.
  await fsp.rm(path.join(templates.templatesDir(), 'RFI.md'));
  const created = await templates.ensureStarters();
  assert.strictEqual(created, false, 'should report that it did nothing');
  const files = await fsp.readdir(templates.templatesDir());
  assert.ok(!files.includes('RFI.md'), 'a deleted starter must not reappear');
});

test('listTemplates returns markdown files, sorted, without the extension', async () => {
  await fsp.writeFile(path.join(templates.templatesDir(), 'Approval.md'), '# a');
  await fsp.writeFile(path.join(templates.templatesDir(), 'notes.txt'), 'ignored');
  const list = await templates.listTemplates();
  const names = list.map((t) => t.name);
  assert.deepStrictEqual(names, ['Approval', 'Site visit']);
  assert.ok(!names.includes('notes'), 'non-markdown files are not templates');
  assert.strictEqual(list[0].file, 'Approval.md');
});

test('readTemplate returns the file body', async () => {
  const body = await templates.readTemplate('Site visit.md');
  assert.match(body, /\{\{field:client\}\}/);
});

test('safeTemplatePath rejects anything outside the templates directory', async () => {
  for (const bad of [
    '../../../etc/passwd',
    '../secret.md',
    'sub/dir.md',
    'sub\\dir.md',
    path.join(os.tmpdir(), 'abs.md'),
    'notes.txt',        // wrong extension
    '',
    null,
  ]) {
    assert.strictEqual(templates.safeTemplatePath(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('safeTemplatePath accepts a plain markdown filename', () => {
  const ok = templates.safeTemplatePath('Site visit.md');
  assert.ok(ok && ok.startsWith(templates.templatesDir()));
});

test('readTemplate refuses a traversing name rather than reading it', async () => {
  await assert.rejects(() => templates.readTemplate('../../../etc/passwd'), /Invalid template name/);
});
