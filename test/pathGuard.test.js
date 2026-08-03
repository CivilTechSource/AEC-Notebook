// The allowlist logic in main.js is inline (it closes over Electron state), so this test covers
// the containment predicate it relies on. Keep the two in sync if either changes.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function isInside(parent, child) {
  const p = path.resolve(parent), c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

test('a path inside the root is allowed', () => {
  assert.strictEqual(isInside('/lib', '/lib/ProjectA'), true);
  assert.strictEqual(isInside('/lib', '/lib/2024/ProjectA'), true);
});

test('the root itself is allowed', () => {
  assert.strictEqual(isInside('/lib', '/lib'), true);
  assert.strictEqual(isInside('/lib', '/lib/'), true);
});

test('a sibling directory sharing a name prefix is rejected', () => {
  // The classic bug: naive startsWith without the separator lets "/library-secrets" through.
  assert.strictEqual(isInside('/lib', '/library-secrets'), false);
  assert.strictEqual(isInside('/lib', '/libother'), false);
});

test('traversal out of the root is rejected', () => {
  assert.strictEqual(isInside('/lib', '/lib/../etc/passwd'), false);
  assert.strictEqual(isInside('/lib', '/etc/passwd'), false);
});

test('an unrelated absolute path is rejected', () => {
  assert.strictEqual(isInside('/lib', '/'), false);
  assert.strictEqual(isInside('/lib/a', '/lib'), false);   // parent is not inside child
});
