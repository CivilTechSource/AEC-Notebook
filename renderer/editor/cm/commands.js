// commands.js — the markdown editing commands CodeMirror doesn't ship.
//
// Everything goes through transactions rather than mutating text, so undo groups them correctly
// and multiple selections work without extra effort. Position mapping is left to changeByRange:
// inserting a marker shifts everything after it, and doing that arithmetic by hand is exactly
// where this kind of code goes wrong.
(function () {
  const { EditorSelection } = window.CM6;

  // Wrap or unwrap each selection with a marker (** bold, * italic, ` code).
  // If the selection is already wrapped the markers come off. With an empty selection it inserts
  // the pair and parks the cursor between them, which is what you want mid-sentence.
  function toggleWrap(marker) {
    const len = marker.length;
    return (view) => {
      const { state } = view;
      view.dispatch(state.changeByRange((range) => {
        const before = state.sliceDoc(Math.max(0, range.from - len), range.from);
        const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + len));

        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - len, to: range.from },
              { from: range.to, to: range.to + len },
            ],
            range: EditorSelection.range(range.from - len, range.to - len),
          };
        }
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.from + len, range.to + len),
        };
      }), { userEvent: 'input.wrap', scrollIntoView: true });
      return true;
    };
  }

  // Toggle the task checkbox on every line a selection touches. Matches the marker shape that
  // MDCheckboxes.setNthTask writes, so ticking here and ticking in Reading mode agree.
  const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
  const BULLET = /^(\s*)(?:[-*+]|\d+[.)])(\s+)/;

  function toggleTask(view) {
    const { state } = view;
    const changes = [];
    const seen = new Set();

    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = state.doc.line(n);

        const task = line.text.match(TASK);
        if (task) {
          const at = line.from + task[1].length;
          changes.push({ from: at, to: at + 1, insert: task[2] === ' ' ? 'x' : ' ' });
          continue;
        }
        // Not a task yet — promote a list item, or a bare line, into one.
        const bullet = line.text.match(BULLET);
        if (bullet) {
          changes.push({ from: line.from + bullet[0].length, insert: '[ ] ' });
        } else if (line.text.trim()) {
          const indent = (line.text.match(/^\s*/) || [''])[0].length;
          changes.push({ from: line.from + indent, insert: '- [ ] ' });
        }
      }
    }
    if (!changes.length) return false;
    view.dispatch({ changes, userEvent: 'input.task' });
    return true;
  }

  window.CMCommands = {
    toggleBold: toggleWrap('**'),
    toggleItalic: toggleWrap('*'),
    toggleCode: toggleWrap('`'),
    toggleTask,
  };
})();
