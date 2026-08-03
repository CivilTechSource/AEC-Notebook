// The pure transforms behind the Phase 2 markdown features. Each module is a browser IIFE that
// registers itself with window.MD and hangs its testable half off a window global, so they're
// loaded here against a stub MD the same way md.test.js loads md.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BT = String.fromCharCode(96);   // backtick, so fenced-block fixtures stay readable

function loadExtension(file, extraWindow = {}) {
  const win = {
    MD: { registerDecorator() {}, registerPreprocessor() {}, headings: null },
    ...extraWindow,
  };
  // headings() is the real implementation — embeds' section slicing depends on it.
  const mdWin = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'renderer', 'editor', 'md.js'), 'utf8'))
    .call({ window: mdWin }, mdWin);
  win.MD.headings = mdWin.MD.headings;

  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'editor', 'markdown', file), 'utf8');
  new Function('window', src).call({ window: win }, win);
  return win;
}

// ---------- footnotes ----------

const { MDFootnotes } = loadExtension('footnotes.js');

test('footnotes: a cited definition is numbered and moved to the end', () => {
  const out = MDFootnotes.transform('Bearing capacity is marginal[^a].\n\n[^a]: Per BS 8004.');
  assert.match(out, /<sup class="fn-ref" id="fnref-1"><a href="#fn-1" data-fn="1">1<\/a><\/sup>/);
  assert.match(out, /<li class="fn-item" id="fn-1">Per BS 8004\./);
  assert.ok(out.indexOf('fn-ref') < out.indexOf('footnotes'), 'the list must come after the body');
});

test('footnotes: numbering follows citation order, not definition order', () => {
  const out = MDFootnotes.transform('First[^z] then second[^a].\n\n[^a]: A\n[^z]: Z');
  assert.match(out, /id="fnref-1"[^]*?Z/);      // [^z] cited first, so it is 1
  const first = out.indexOf('>Z<') >= 0 ? out.indexOf('>Z<') : out.indexOf('Z');
  const second = out.indexOf('A');
  assert.ok(first < second, 'Z should be listed before A');
});

test('footnotes: a repeated reference reuses its number', () => {
  const out = MDFootnotes.transform('a[^1] b[^1]\n\n[^1]: once');
  assert.strictEqual((out.match(/data-fn="1"/g) || []).length, 2);
  assert.strictEqual((out.match(/class="fn-item"/g) || []).length, 1);
});

test('footnotes: a reference with no definition is left alone', () => {
  const src = 'dangling[^nope] here\n\n[^other]: unrelated';
  const out = MDFootnotes.transform(src);
  assert.match(out, /\[\^nope\]/, 'the literal reference should survive');
});

test('footnotes: text with no footnotes is returned untouched', () => {
  const src = 'Just prose, and a price of $5.';
  assert.strictEqual(MDFootnotes.transform(src), src);
});

// ---------- checkboxes ----------

const { MDCheckboxes } = loadExtension('checkboxes.js');

test('checkboxes: ticks the nth task and leaves the rest alone', () => {
  const src = '- [ ] one\n- [ ] two\n- [ ] three';
  assert.strictEqual(MDCheckboxes.setNthTask(src, 1, true), '- [ ] one\n- [x] two\n- [ ] three');
});

test('checkboxes: unticks, and handles ordered lists and indentation', () => {
  assert.strictEqual(MDCheckboxes.setNthTask('- [x] done', 0, false), '- [ ] done');
  assert.strictEqual(MDCheckboxes.setNthTask('1. [ ] a', 0, true), '1. [x] a');
  assert.strictEqual(MDCheckboxes.setNthTask('    * [ ] nested', 0, true), '    * [x] nested');
});

test('checkboxes: an out-of-range index changes nothing', () => {
  // This is what tells the UI the buffer moved under it, so it must be an exact no-op.
  const src = '- [ ] only one';
  assert.strictEqual(MDCheckboxes.setNthTask(src, 5, true), src);
});

test('checkboxes: a bracket that is not a task marker is untouched', () => {
  const src = 'See [ ] in the drawing legend';
  assert.strictEqual(MDCheckboxes.setNthTask(src, 0, true), src);
});

// ---------- embeds: heading slicing ----------

const { MDEmbeds } = loadExtension('embeds.js');

const NOTE = [
  '# Site visit',
  'intro line',
  '## Access',
  'gate code 1234',
  '### Gate',
  'round the back',
  '## Hazards',
  'overhead cables',
].join('\n');

test('embeds: slices from a heading to the next of the same level', () => {
  const out = MDEmbeds.sliceHeading(NOTE, 'Access');
  assert.match(out, /^## Access/);
  assert.match(out, /gate code 1234/);
  assert.match(out, /### Gate/, 'a deeper subsection belongs to the section');
  assert.ok(!out.includes('Hazards'), 'must stop at the next same-level heading');
});

test('embeds: the last section runs to the end of the note', () => {
  const out = MDEmbeds.sliceHeading(NOTE, 'Hazards');
  assert.match(out, /overhead cables$/);
});

test('embeds: heading match is case-insensitive and trimmed', () => {
  assert.ok(MDEmbeds.sliceHeading(NOTE, '  hAzArDs  ').includes('overhead cables'));
});

test('embeds: an unknown heading returns null rather than the whole note', () => {
  assert.strictEqual(MDEmbeds.sliceHeading(NOTE, 'Nonexistent'), null);
});

test('embeds: a heading inside a code fence is not a slice target', () => {
  const src = ['# Real', 'x', BT.repeat(3), '## Fake', BT.repeat(3), '## Real Two', 'y'].join('\n');
  assert.strictEqual(MDEmbeds.sliceHeading(src, 'Fake'), null);
});

// ---------- maths delimiter detection ----------

const { MDMath } = loadExtension('math.js');

test('math: finds inline and display formulas', () => {
  const found = MDMath.findMath('inline $a^2+b^2$ and block $$E=mc^2$$ end');
  assert.strictEqual(found.length, 2);
  assert.deepStrictEqual([found[0].tex, found[0].display], ['a^2+b^2', false]);
  assert.deepStrictEqual([found[1].tex, found[1].display], ['E=mc^2', true]);
});

test('math: currency is not treated as a formula', () => {
  // The case that matters for these notes: costs, rates and quantities are everywhere.
  assert.deepStrictEqual(MDMath.findMath('it costs $5 and $10 total'), []);
  assert.deepStrictEqual(MDMath.findMath('budget $1,200 vs $1,500'), []);
});

test('math: a space after the opening delimiter disqualifies it', () => {
  assert.deepStrictEqual(MDMath.findMath('$ not maths $'), []);
});

test('math: an unclosed delimiter is ignored', () => {
  assert.deepStrictEqual(MDMath.findMath('a lone $ sign'), []);
  assert.deepStrictEqual(MDMath.findMath('open $x but never closed'), []);
});

test('math: adjacent formulas do not overlap', () => {
  const found = MDMath.findMath('$a$ then $b$');
  assert.deepStrictEqual(found.map((f) => f.tex), ['a', 'b']);
});
