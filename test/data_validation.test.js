const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/shared/data_validation');

const field = (over) => ({ id: 'f1', key: 'k', label: 'Field', type: 'text', required: false, options: [], validation: {}, ...over });

test('required field rejects empty values', () => {
  for (const v of [undefined, null, '', []]) {
    assert.strictEqual(V.validateField(field({ required: true }), v).valid, false);
  }
});

test('optional empty field passes', () => {
  assert.strictEqual(V.validateField(field(), '').valid, true);
});

test('text respects maxLength', () => {
  const f = field({ validation: { maxLength: 3 } });
  assert.strictEqual(V.validateField(f, 'abc').valid, true);
  assert.strictEqual(V.validateField(f, 'abcd').valid, false);
});

test('number respects min and max and rejects non-numbers', () => {
  const f = field({ type: 'number', validation: { min: 1, max: 10 } });
  assert.strictEqual(V.validateField(f, 5).valid, true);
  assert.strictEqual(V.validateField(f, 0).valid, false);
  assert.strictEqual(V.validateField(f, 11).valid, false);
  assert.strictEqual(V.validateField(f, '5').valid, false);
});

test('dropdown only accepts declared option values', () => {
  const f = field({ type: 'dropdown', options: [{ label: 'Zone 1', value: 'zone1' }] });
  assert.strictEqual(V.validateField(f, 'zone1').valid, true);
  assert.strictEqual(V.validateField(f, 'zone9').valid, false);
});

test('multiselect requires an array of declared values', () => {
  const f = field({ type: 'multiselect', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] });
  assert.strictEqual(V.validateField(f, ['a', 'b']).valid, true);
  assert.strictEqual(V.validateField(f, ['a', 'z']).valid, false);
  assert.strictEqual(V.validateField(f, 'a').valid, false);
});

test('schemaFields flattens both sectioned and legacy flat schemas', () => {
  const sectioned = { sections: [{ fields: [field({ key: 'a' })] }, { fields: [field({ key: 'b' })] }] };
  assert.deepStrictEqual(V.schemaFields(sectioned).map((f) => f.key), ['a', 'b']);
  assert.deepStrictEqual(V.schemaFields({ fields: [field({ key: 'c' })] }).map((f) => f.key), ['c']);
  assert.deepStrictEqual(V.schemaFields(null), []);
});

test('requiresAttachment option blocks the record until a file field is filled', () => {
  const zone = field({ key: 'zone', type: 'dropdown', options: [{ label: 'Zone 3', value: 'zone3', requiresAttachment: true }] });
  const doc = field({ key: 'doc', type: 'file' });
  const schema = { sections: [{ fields: [zone, doc] }] };

  const missing = V.validateRecord(schema, { zone: 'zone3' });
  assert.strictEqual(missing.valid, false);
  assert.match(missing.errors.zone, /requires/);

  assert.strictEqual(V.validateRecord(schema, { zone: 'zone3', doc: 'C:\\ra.pdf' }).valid, true);
});

test('shouldHighlight honours equals and in rules', () => {
  assert.strictEqual(V.shouldHighlight(field({ validation: { highlightWhen: { equals: 'zone3' } } }), 'zone3'), true);
  assert.strictEqual(V.shouldHighlight(field({ validation: { highlightWhen: { equals: 'zone3' } } }), 'zone1'), false);
  assert.strictEqual(V.shouldHighlight(field({ validation: { highlightWhen: { in: ['a', 'b'] } } }), 'b'), true);
  assert.strictEqual(V.shouldHighlight(field(), 'anything'), false);
});
