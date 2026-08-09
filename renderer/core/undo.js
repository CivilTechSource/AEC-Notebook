// undo.js — a small undo stack for destructive actions (delete note/field/section).
// Each destructive site records an inverse operation; the user can undo via the toast
// button or Cmd/Ctrl+Z. This is app-level undo, separate from native text-editing undo.
(function () {
  const stack = [];
  const MAX = 50;

  // Record an undoable action and surface a toast with an "Undo" button.
  // The toast undoes THAT action, not whatever happens to be on top of the stack — otherwise
  // clicking Undo on an older toast silently reverts a newer, unrelated change.
  function record(label, undoFn) {
    const item = { label, undoFn };
    stack.push(item);
    if (stack.length > MAX) stack.shift();
    window.Toast?.action?.(label, 'Undo', () => apply(item));
  }

  async function apply(item) {
    const i = stack.indexOf(item);
    // Either already undone, or pushed off the end of the 50-item stack. Both used to return
    // silently — the user clicks Undo on an old toast and nothing at all happens, which is the
    // exact failure mode the rest of this codebase goes out of its way to avoid.
    if (i < 0) {
      window.Toast?.info(`“${item.label}” can no longer be undone.`);
      return;
    }
    stack.splice(i, 1);
    try { await item.undoFn(); window.Toast?.success('Undone: ' + item.label); }
    catch (e) { window.Toast?.error('Undo failed: ' + (e.message || e)); }
  }

  // Ctrl+Z path: undo the most recent outstanding action.
  async function run() {
    const item = stack[stack.length - 1];
    if (!item) { window.Toast?.info('Nothing to undo'); return; }
    await apply(item);
  }

  window.Undo = { record, run, get size() { return stack.length; } };
})();
