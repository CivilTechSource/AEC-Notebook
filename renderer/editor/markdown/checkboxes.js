// checkboxes.js — make reading-view task lists actually tickable.
//
// marked renders "- [ ] thing" as a disabled checkbox, so until now the reading view showed task
// lists you could look at but not use. Ticking one has to write back to the markdown, which means
// finding the right "- [ ]" in the source: they're matched by ORDER, since the rendered boxes and
// the source markers appear in the same sequence.
(function () {
  // A task marker at the start of a list item: bullet or ordered, then [ ] / [x].
  const TASK = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/gm;

  function setNthTask(src, n, checked) {
    let i = 0;
    return src.replace(TASK, (m, pre, mark, post) => (i++ === n ? pre + (checked ? 'x' : ' ') + post : m));
  }

  function apply(el, ctx) {
    // Without a way to write back, leave them disabled rather than offering a control that
    // silently does nothing — the hover preview renders through here too.
    if (typeof ctx.getBody !== 'function' || typeof ctx.setBody !== 'function') return;

    [...el.querySelectorAll('input[type="checkbox"]')].forEach((box, index) => {
      box.disabled = false;
      box.addEventListener('change', () => {
        const before = ctx.getBody();
        const after = setNthTask(before, index, box.checked);
        if (after === before) {
          // The buffer moved under us (edited in the other pane, or reloaded from disk). Put the
          // box back rather than writing a change to the wrong line.
          box.checked = !box.checked;
          window.Toast?.error('Could not update that checkbox — the note changed. Reopen it and try again.');
          return;
        }
        ctx.setBody(after);
      });
    });
  }

  window.MD.registerDecorator({ id: 'checkboxes', apply });
  window.MDCheckboxes = { setNthTask };     // exported for tests
})();
