// What the editor does when the watcher reports the open note changed on disk.
//
// This decision has two failure modes and they are not symmetric. Too eager and the user is asked
// to arbitrate a conflict against their own autosave — which is what happened on OneDrive, where
// the sync client touches the file well after the main process's 400 ms self-write marker has
// expired. Too lax and somebody else's edit is silently overwritten.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'editor', 'notes.js'), 'utf8');

function load() {
  const win = { addEventListener() {} };
  const ctx = vm.createContext(win);
  ctx.window = win;
  vm.runInContext(SRC, ctx);
  return win.NotesView.reconcile;
}

const reconcile = load();

test('nothing to do when the file already matches the buffer', () => {
  assert.strictEqual(reconcile({ disk: 'same', buffer: 'same', lastWritten: 'older', dirty: true }), 'ignore');
});

test('an echo of our own write is ignored even though we have typed since', () => {
  // The exact OneDrive case: autosave wrote "v2", the user kept typing to "v3", and the sync
  // client's touch of the file arrives long after the self-write marker expired.
  assert.strictEqual(
    reconcile({ disk: 'v2', buffer: 'v3', lastWritten: 'v2', dirty: true }),
    'ignore',
  );
});

test('an echo is ignored regardless of how late it arrives — identity is by content, not time', () => {
  // There is deliberately no clock in the signature. A test that had to advance a timer would be
  // pinning the bug rather than the fix.
  assert.strictEqual(reconcile({ disk: 'saved text', buffer: 'saved text plus more', lastWritten: 'saved text', dirty: true }), 'ignore');
});

test('a real external edit with no unsaved work reloads silently', () => {
  assert.strictEqual(
    reconcile({ disk: 'theirs', buffer: 'ours', lastWritten: 'ours', dirty: false }),
    'reload',
  );
});

test('a real external edit with unsaved work asks the user', () => {
  assert.strictEqual(
    reconcile({ disk: 'theirs', buffer: 'ours+typing', lastWritten: 'ours', dirty: true }),
    'ask',
  );
});

test('a first-open note that was never written still reconciles', () => {
  // lastWritten starts as the content read at open, so an external edit before any save is a
  // genuine external edit.
  assert.strictEqual(
    reconcile({ disk: 'changed elsewhere', buffer: 'as opened', lastWritten: 'as opened', dirty: false }),
    'reload',
  );
});

test('an empty note is not treated as a special case', () => {
  assert.strictEqual(reconcile({ disk: '', buffer: '', lastWritten: '', dirty: false }), 'ignore');
  assert.strictEqual(reconcile({ disk: 'now has content', buffer: '', lastWritten: '', dirty: false }), 'reload');
});

test('the buffer matching disk wins over a stale lastWritten', () => {
  // After "Load from disk" the buffer and file agree; a late echo of an older write must not
  // re-open the question.
  assert.strictEqual(reconcile({ disk: 'theirs', buffer: 'theirs', lastWritten: 'ours', dirty: false }), 'ignore');
});
