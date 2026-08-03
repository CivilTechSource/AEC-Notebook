// Restoring a saved window position is the one place this app can put itself somewhere the user
// cannot reach: bounds recorded while docked to a second monitor point into empty space once the
// laptop is undocked. fitToDisplays() is the guard, so it gets the tests.
const test = require('node:test');
const assert = require('node:assert');
const { fitToDisplays } = require('../src/main/windowState');

const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };   // to the right of the laptop
const ABOVE  = { x: 0, y: -1080, width: 1920, height: 1040 };  // stacked above

test('bounds fully inside a display are kept as-is', () => {
  const saved = { x: 100, y: 80, width: 1440, height: 920 };
  assert.deepStrictEqual(fitToDisplays(saved, [LAPTOP]), saved);
});

test('bounds on a second monitor are kept while that monitor is attached', () => {
  const saved = { x: 2200, y: 120, width: 1440, height: 920 };
  assert.deepStrictEqual(fitToDisplays(saved, [LAPTOP, SECOND]), saved);
});

test('bounds on a monitor that is gone are rejected', () => {
  // The classic undock: saved at x=2200, now only the laptop screen exists.
  const saved = { x: 2200, y: 120, width: 1440, height: 920 };
  assert.strictEqual(fitToDisplays(saved, [LAPTOP]), null);
});

test('a window whose title bar sits above every display is rejected', () => {
  // Negative-Y layouts are legal while the monitor is attached...
  const saved = { x: 100, y: -900, width: 1440, height: 920 };
  assert.deepStrictEqual(fitToDisplays(saved, [LAPTOP, ABOVE]), saved);
  // ...and unreachable once it isn't. The body would overlap the laptop screen here, but the
  // title bar — the only thing you can drag — would not.
  assert.strictEqual(fitToDisplays(saved, [LAPTOP]), null);
});

test('a barely-overlapping window is rejected rather than left on a sliver', () => {
  const saved = { x: 1880, y: 100, width: 1440, height: 920 };   // 40px of title bar on screen
  assert.strictEqual(fitToDisplays(saved, [LAPTOP]), null);
});

test('a window larger than its display is clamped to fit', () => {
  const saved = { x: 0, y: 0, width: 3000, height: 2000 };
  const out = fitToDisplays(saved, [LAPTOP]);
  assert.strictEqual(out.width, LAPTOP.width);
  assert.strictEqual(out.height, LAPTOP.height);
});

test('missing, partial or absurd saved state falls back to null', () => {
  assert.strictEqual(fitToDisplays(null, [LAPTOP]), null);
  assert.strictEqual(fitToDisplays({ width: 1440, height: 920 }, [LAPTOP]), null);        // no x/y
  assert.strictEqual(fitToDisplays({ x: 0, y: 0, width: 1440 }, [LAPTOP]), null);         // no height
  assert.strictEqual(fitToDisplays({ x: 0, y: 0, width: 10, height: 10 }, [LAPTOP]), null); // too small
  assert.strictEqual(fitToDisplays({ x: 0, y: 0, width: 1440, height: 920 }, []), null);  // no displays yet
});
