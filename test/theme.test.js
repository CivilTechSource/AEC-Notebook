// The tokens plugins receive are declared in src/shared/theme.js, but the values the app actually
// renders with come from renderer/styles/tokens.css. Nothing at runtime forces those to agree —
// a plugin would just quietly render with a stale palette until someone noticed. These tests are
// what keeps them honest.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const theme = require('../src/shared/theme');

const TOKENS_CSS = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles', 'tokens.css'), 'utf8');

// Parse the `:root { --name: value; }` block. Only the first one — the light theme lives in its
// own file, so tokens.css has exactly one :root.
function parseRoot(css) {
  const block = css.slice(css.indexOf(':root'));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  const out = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/);
    if (m) out[m[1]] = m[2].replace(/\s*\/\*.*$/, '').trim();
  }
  return out;
}

const cssTokens = parseRoot(TOKENS_CSS);

test('tokens.css parses into a non-trivial token set', () => {
  // Guard the parser itself: if the regex ever stops matching, the tests below would pass vacuously.
  assert.ok(Object.keys(cssTokens).length > 30, `only parsed ${Object.keys(cssTokens).length} tokens`);
});

test('every mirrored token exists in tokens.css', () => {
  for (const name of theme.MIRRORED) {
    assert.ok(name in cssTokens, `${name} is mirrored to plugins but not defined in tokens.css`);
  }
});

test('mirrored fallback values match tokens.css', () => {
  for (const name of theme.MIRRORED) {
    assert.strictEqual(
      theme.DARK[name], cssTokens[name],
      `${name} drifted: theme.js has "${theme.DARK[name]}", tokens.css has "${cssTokens[name]}"`,
    );
  }
});

test('the generated plugin fallback CSS covers every mirrored token', () => {
  const css = theme.darkRootCss();
  assert.ok(css.startsWith(':root{') && css.endsWith('}'));
  for (const name of theme.MIRRORED) assert.ok(css.includes(`${name}:`), `${name} missing from darkRootCss()`);
});
