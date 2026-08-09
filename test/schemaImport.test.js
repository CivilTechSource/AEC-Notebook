// An imported schema is arbitrary JSON off someone's disk that becomes the definition every
// project in a library folder is validated and rendered against. Unchecked, a field with no key
// silently collects every project's data in one slot of project.json, an unknown type renders as a
// blank control, and a malformed options array throws inside the board render — which is a page
// that never paints, not an error message.
//
// schemaEditor.js is a browser IIFE, loaded here the same way store.js is in storeMigration.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'schemaEditor.js'), 'utf8');

function load() {
  const win = {
    addEventListener() {},
    Store: { uid: (p) => `${p}test`, schemaForPath: () => ({ version: 1, sections: [] }) },
  };
  const ctx = vm.createContext(win);
  ctx.window = win;
  vm.runInContext(SRC, ctx);
  return win.SchemaEditor.normaliseImported;
}

const normalise = load();

// Values produced inside the vm context carry that realm's Array/Object prototypes, so
// deepStrictEqual fails on prototype identity even when the structure matches. Compare the plain
// data instead — which is all a schema ever is once it reaches schemas.json.
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---------- rejected outright ----------

test('a non-object is rejected', () => {
  for (const bad of [null, 42, 'schema', true]) {
    assert.throws(() => normalise(bad), /isn.t a schema object/);
  }
});

test('a section without a fields array is rejected rather than silently emptied', () => {
  assert.throws(() => normalise({ sections: [{ title: 'Details' }] }), /no fields array/);
  assert.throws(() => normalise({ sections: [{ title: 'Details', fields: 'client' }] }), /no fields array/);
});

test('a schema with no sections is rejected', () => {
  assert.throws(() => normalise({ sections: [] }), /no sections/);
});

test('a field that is not an object is rejected', () => {
  assert.throws(() => normalise({ sections: [{ title: 'D', fields: ['client'] }] }), /not an object/);
});

// ---------- coerced, where the intent is unambiguous ----------

test('the legacy flat shape becomes a single section', () => {
  const out = normalise({ version: 3, fields: [{ key: 'client', label: 'Client', type: 'text' }] });
  assert.strictEqual(out.sections.length, 1);
  assert.strictEqual(out.sections[0].fields[0].key, 'client');
  assert.strictEqual(out.version, 3);
});

test('an unknown field type falls back to text rather than rendering a blank control', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ key: 'x', label: 'X', type: 'wormhole' }] }] });
  assert.strictEqual(out.sections[0].fields[0].type, 'text');
});

test('a field with no key gets one derived from its label', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ label: 'Job Number', type: 'text' }] }] });
  assert.strictEqual(out.sections[0].fields[0].key, 'job_number');
});

test('a field with neither key nor label still gets a usable key', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ type: 'text' }] }] });
  assert.ok(out.sections[0].fields[0].key, 'a key is required — an empty one collects every field in one slot');
});

test('duplicate keys are made unique, so two fields cannot write to one slot', () => {
  const out = normalise({
    sections: [{ title: 'D', fields: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'client', label: 'Client again', type: 'text' },
      { key: 'client', label: 'And again', type: 'text' },
    ] }],
  });
  const keys = out.sections[0].fields.map((f) => f.key);
  assert.strictEqual(new Set(keys).size, 3, `expected three distinct keys, got ${keys.join(', ')}`);
  assert.strictEqual(keys[0], 'client', 'the first one keeps the name it asked for');
});

test('missing ids are generated so drag-reorder and selection work', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ key: 'a', type: 'text' }] }] });
  assert.ok(out.sections[0].id);
  assert.ok(out.sections[0].fields[0].id);
});

test('a dropdown with no options array gets an empty one instead of throwing at render', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ key: 'zone', type: 'dropdown' }] }] });
  assert.deepStrictEqual(plain(out.sections[0].fields[0].options), []);
});

test('option entries are coerced to {label, value, requiresAttachment}', () => {
  const out = normalise({
    sections: [{ title: 'D', fields: [{ key: 'zone', type: 'dropdown', options: [
      { value: 'zone3', label: 'Zone 3', requiresAttachment: 1 },
      { value: 'zone1' },
      null,
    ] }] }],
  });
  const opts = plain(out.sections[0].fields[0].options);
  assert.deepStrictEqual(opts[0], { label: 'Zone 3', value: 'zone3', requiresAttachment: true });
  assert.deepStrictEqual(opts[1], { label: 'zone1', value: 'zone1', requiresAttachment: false });
  assert.deepStrictEqual(opts[2], { label: '', value: '', requiresAttachment: false });
});

test('options are dropped from types that do not have them', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ key: 'n', type: 'number', options: [{ value: 'x' }] }] }] });
  assert.deepStrictEqual(plain(out.sections[0].fields[0].options), []);
});

test('a non-object validation block is replaced rather than carried through', () => {
  const out = normalise({ sections: [{ title: 'D', fields: [{ key: 'a', type: 'text', validation: 'nope' }] }] });
  assert.deepStrictEqual(plain(out.sections[0].fields[0].validation), {});
});

test('a valid schema round-trips unchanged in the ways that matter', () => {
  const input = {
    version: 7,
    sections: [{ id: 'sec_1', title: 'Details', fields: [
      { id: 'f1', key: 'client', label: 'Client', type: 'text', required: true, validation: { maxLength: 80 } },
      { id: 'f2', key: 'zone', label: 'Flood zone', type: 'dropdown', required: false,
        options: [{ label: 'Zone 3', value: 'zone3', requiresAttachment: true }],
        validation: { highlightWhen: { equals: 'zone3' } } },
    ] }],
  };
  const out = normalise(input);
  assert.strictEqual(out.version, 7);
  assert.strictEqual(out.sections[0].id, 'sec_1');
  assert.deepStrictEqual(plain(out.sections[0].fields.map((f) => f.key)), ['client', 'zone']);
  assert.strictEqual(out.sections[0].fields[0].required, true);
  assert.strictEqual(out.sections[0].fields[1].validation.highlightWhen.equals, 'zone3');
  assert.strictEqual(out.sections[0].fields[1].options[0].requiresAttachment, true);
});
