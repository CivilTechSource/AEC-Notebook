// Template substitution. The {{field:}} token reads live board values, so the cases that matter
// are the ones where a field is absent, empty, or typed as something other than a string.
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/templates');

// Fixed clock so nothing here depends on when it runs.
const NOW = new Date(2026, 7, 4, 9, 5, 3);   // 4 Aug 2026, 09:05:03 (month is 0-based)

const FIELDS = [
  { key: 'client' }, { key: 'jobNumber' }, { key: 'siteAddress' },
  { key: 'floodZone' }, { key: 'surveyed' }, { key: 'disciplines' },
];
const VALUES = {
  client: 'Northgate Developments',
  jobNumber: 'P23001',
  siteAddress: '',
  floodZone: 'Zone 2',
  surveyed: true,
  disciplines: ['Drainage', 'Highways'],
};

const ctx = (over = {}) => ({ title: 'Site visit', values: VALUES, fields: FIELDS, now: NOW, ...over });

test('substitutes date and time with sensible defaults', () => {
  assert.strictEqual(T.substitute('{{date}}', ctx()), '2026-08-04');
  assert.strictEqual(T.substitute('{{time}}', ctx()), '09:05');
});

test('date accepts a format argument', () => {
  assert.strictEqual(T.substitute('{{date:DD/MM/YYYY}}', ctx()), '04/08/2026');
  assert.strictEqual(T.substitute('{{date:YYYYMMDD-HHmmss}}', ctx()), '20260804-090503');
  assert.strictEqual(T.substitute('{{date:DDD DD MMM YY}}', ctx()), 'Tue 04 Aug 26');
});

test('substitutes the title', () => {
  assert.strictEqual(T.substitute('# {{title}}', ctx()), '# Site visit');
});

test('pulls plain values from the board', () => {
  assert.strictEqual(T.substitute('Client: {{field:client}}', ctx()), 'Client: Northgate Developments');
  assert.strictEqual(T.substitute('{{field:jobNumber}}', ctx()), 'P23001');
});

test('formats non-string field types the way a person would write them', () => {
  assert.strictEqual(T.substitute('{{field:disciplines}}', ctx()), 'Drainage, Highways');  // multiselect
  assert.strictEqual(T.substitute('{{field:surveyed}}', ctx()), 'Yes');                    // checkbox
});

test('a field that exists but is empty substitutes to nothing', () => {
  // Distinct from an unknown field: the template is right, the board just has no answer yet.
  assert.strictEqual(T.substitute('Address: {{field:siteAddress}}', ctx()), 'Address: ');
  assert.strictEqual(T.substitute('{{field:floodZone}}', ctx({ values: {} })), '');
});

test('a field key not on the board is left standing, not blanked', () => {
  // The whole point: a typo in a template used for years should be visible in the output.
  assert.strictEqual(T.substitute('{{field:jobno}}', ctx()), '{{field:jobno}}');
});

test('without a schema, any field key is accepted', () => {
  assert.strictEqual(T.substitute('{{field:anything}}', ctx({ fields: null })), '');
  assert.strictEqual(T.substitute('{{field:client}}', ctx({ fields: null })), 'Northgate Developments');
});

test('unrecognised tokens are left alone', () => {
  assert.strictEqual(T.substitute('{{nonsense}} and {{other:arg}}', ctx()), '{{nonsense}} and {{other:arg}}');
});

test('an empty field token is left alone', () => {
  assert.strictEqual(T.substitute('{{field:}}', ctx()), '{{field:}}');
});

test('handles a realistic template end to end', () => {
  const tpl = [
    '# {{title}} — {{date:DD/MM/YYYY}}',
    '',
    '- Client: {{field:client}}',
    '- Job: {{field:jobNumber}}',
    '- Flood zone: {{field:floodZone}}',
    '- Attended: {{time}}',
    '',
    '## Observations',
  ].join('\n');
  const out = T.substitute(tpl, ctx());
  assert.match(out, /^# Site visit — 04\/08\/2026$/m);
  assert.match(out, /- Client: Northgate Developments/);
  assert.match(out, /- Flood zone: Zone 2/);
  assert.match(out, /- Attended: 09:05/);
  assert.ok(!out.includes('{{'), 'no tokens should survive a well-formed template');
});

test('empty and missing input is safe', () => {
  assert.strictEqual(T.substitute('', ctx()), '');
  assert.strictEqual(T.substitute(null, ctx()), '');
  assert.strictEqual(T.substitute('no tokens here', {}), 'no tokens here');
});

test('tokensUsed reports what a template references', () => {
  const used = T.tokensUsed('{{title}} {{field:client}} {{date:YYYY}}');
  assert.deepStrictEqual(used.map((t) => [t.name, t.arg]), [
    ['title', null], ['field', 'client'], ['date', 'YYYY'],
  ]);
});
