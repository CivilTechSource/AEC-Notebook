// The containment predicate behind the IPC path allowlist. This used to be a copy of the logic
// in main.js with a "keep the two in sync" comment; the guard now lives in its own module, so
// this exercises the real thing.
const test = require('node:test');
const assert = require('node:assert');
const { isInside } = require('../src/main/pathGuard');

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
