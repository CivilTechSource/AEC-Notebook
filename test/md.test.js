const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// md.js is a browser IIFE that publishes onto `window`; load it into a fake global.
function loadMD() {
  const win = {};
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'md.js'), 'utf8');
  new Function('window', src).call({ window: win }, win);
  return win.MD;
}

const MD = loadMD();

test('preprocess leaves plain prose containing numbers untouched', () => {
  const s = 'The pipe is 300 mm dia and 12 m long.';
  assert.strictEqual(MD.preprocess(s), s);
});

test('preprocess restores code spans verbatim alongside prose numbers', () => {
  const s = 'run `npm i` then wait 5 minutes';
  assert.strictEqual(MD.preprocess(s), s);
});

test('preprocess restores fenced code blocks verbatim', () => {
  const s = 'before\n```\nconst x = 1;\n```\nafter 42 items';
  assert.strictEqual(MD.preprocess(s), s);
});

test('wikilinks become anchors carrying the target note name', () => {
  const out = MD.preprocess('see [[Site Visit]] today');
  assert.match(out, /class="wikilink"/);
  assert.match(out, /data-note="Site Visit"/);
});

test('wikilink aliases render the alias but link the target', () => {
  const out = MD.preprocess('[[Site Visit|the visit]]');
  assert.match(out, /data-note="Site Visit"/);
  assert.match(out, />the visit</);
});

test('tags become tag spans', () => {
  const out = MD.preprocess('logged #drainage today');
  assert.match(out, /class="tag" data-tag="drainage"/);
});

test('wikilinks inside code spans are not rewritten', () => {
  const s = 'literal `[[not a link]]` here';
  assert.strictEqual(MD.preprocess(s), s);
});

test('refs extracts links and tags', () => {
  const { links, tags } = MD.refs('[[A]] and [[B|b]] with #x #y');
  assert.deepStrictEqual(links, ['A', 'B']);
  assert.deepStrictEqual(tags, ['x', 'y']);
});
