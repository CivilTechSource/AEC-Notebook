// Every ICON.x / FIELD_ICON.x the renderer reaches for must actually exist.
//
// These maps are interpolated straight into innerHTML, so a missing key doesn't throw — it writes
// the literal string "undefined" into the page and nothing anywhere reports it. That is how the
// attachments section shipped its first draft with ICON.file, which doesn't exist: `file` lives in
// FIELD_ICON, and every non-image, non-PDF attachment would have shown "undefined" as its icon.
//
// A static scan rather than a hand-maintained list, so it keeps covering new call sites for free.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');

function loadIcons() {
  const win = {};
  const src = fs.readFileSync(path.join(RENDERER, 'core', 'icons.js'), 'utf8');
  new Function('window', src).call({ window: win }, win);
  return win;
}

// Every renderer .js except the vendored bundles.
function rendererSources(dir = RENDERER, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rendererSources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const { ICON, FIELD_ICON } = loadIcons();

test('icons.js publishes both maps', () => {
  assert.ok(ICON && Object.keys(ICON).length, 'window.ICON');
  assert.ok(FIELD_ICON && Object.keys(FIELD_ICON).length, 'window.FIELD_ICON');
});

test('every icon key referenced in the renderer exists', () => {
  // I() is the local alias for window.ICON, FI() for window.FIELD_ICON — both idioms are used.
  //
  // This scans raw source, comments included. Deliberately: stripping comments means guessing at
  // string literals containing "//", and a false negative here hides the exact bug the test is
  // for. The cost is that a comment must not spell a key that doesn't exist — write about
  // `ICON.doc` in prose rather than as a call.
  const PATTERNS = [
    [/\bI\(\)\.([A-Za-z_$][\w$]*)/g, 'ICON', ICON],
    [/\bwindow\.ICON\.([A-Za-z_$][\w$]*)/g, 'ICON', ICON],
    [/\bFI\(\)\.([A-Za-z_$][\w$]*)/g, 'FIELD_ICON', FIELD_ICON],
    [/\bwindow\.FIELD_ICON\.([A-Za-z_$][\w$]*)/g, 'FIELD_ICON', FIELD_ICON],
  ];

  const missing = [];
  for (const file of rendererSources()) {
    if (file.endsWith(path.join('core', 'icons.js'))) continue;      // the definition itself
    const src = fs.readFileSync(file, 'utf8');
    for (const [re, mapName, map] of PATTERNS) {
      for (const m of src.matchAll(re)) {
        if (!(m[1] in map)) missing.push(`${path.relative(RENDERER, file)} -> ${mapName}.${m[1]}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], `icon keys referenced but not defined:\n  ${missing.join('\n  ')}`);
});

test('every icon is an inline svg, not an empty string', () => {
  for (const [name, map] of [['ICON', ICON], ['FIELD_ICON', FIELD_ICON]]) {
    for (const [key, value] of Object.entries(map)) {
      assert.ok(
        typeof value === 'string' && value.trim().startsWith('<svg') && value.includes('</svg>'),
        `${name}.${key} is not a complete inline svg`,
      );
    }
  }
});

test('icons use currentColor so they follow the theme', () => {
  // A hardcoded hex would stay dark-theme coloured after the light/dark switch.
  for (const [name, map] of [['ICON', ICON], ['FIELD_ICON', FIELD_ICON]]) {
    for (const [key, value] of Object.entries(map)) {
      if (!/stroke="|fill="/.test(value)) continue;
      const hardcoded = [...value.matchAll(/(?:stroke|fill)="(#[0-9a-f]{3,8})"/gi)].map((m) => m[1]);
      assert.deepStrictEqual(hardcoded, [], `${name}.${key} hardcodes ${hardcoded.join(', ')}`);
    }
  }
});
