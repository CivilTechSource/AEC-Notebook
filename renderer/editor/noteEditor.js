// noteEditor.js — the seam between the app and whatever text editor is underneath.
//
// notes.js used to reach into a <textarea> for .value, .setSelectionRange, .focus, .isConnected
// and 'input' events in about a dozen places. Rather than scatter CodeMirror's API through it,
// everything goes through this interface:
//
//   getValue · setValue · focus · revealLine · isConnected · destroy
//
// Two things follow from that. CodeMirror details stay in editor/cm/, and a future change —
// including adding Live Preview, which is a decoration extension on this same view — touches one
// file rather than the editor's every caller.
(function () {
  const CM = () => window.CM6;

  /**
   * @param {object} opts
   *   parent            element to mount into
   *   doc               initial text
   *   project           needed by the [[ ]] completion source and attachment handling
   *   placeholderText
   *   onChange()        fired for USER edits only — never for setValue
   *   onSave()          Ctrl/Cmd+S
   */
  function create({ parent, doc = '', project, placeholderText = '', onChange, onSave }) {
    const M = CM();

    // Guards onChange during a programmatic setValue. Update listeners run synchronously inside
    // dispatch, so a plain flag is enough and is clearer than an annotation.
    let applyingExternal = false;

    const view = new M.EditorView({
      parent,
      state: M.EditorState.create({
        doc,
        extensions: [
          ...window.CMSetup.extensions({ project, onSave, placeholderText }),
          M.EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternal) onChange?.();
          }),
        ],
      }),
    });

    const getValue = () => view.state.doc.toString();

    function setValue(text) {
      const next = String(text ?? '');
      if (next === getValue()) return;      // don't churn the document, or lose the cursor, for nothing
      applyingExternal = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          // Keep the cursor in range rather than letting it snap to 0 on a reload from disk.
          selection: { anchor: Math.min(view.state.selection.main.anchor, next.length) },
        });
      } finally {
        applyingExternal = false;
      }
    }

    // lineIdx is 0-based, matching MD.headings(); CodeMirror lines are 1-based.
    function revealLine(lineIdx) {
      const total = view.state.doc.lines;
      const line = view.state.doc.line(Math.min(Math.max(1, lineIdx + 1), total));
      view.dispatch({
        selection: { anchor: line.from, head: line.to },
        effects: M.EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
      view.focus();
    }

    return {
      view,                                   // escape hatch for anything genuinely CodeMirror-shaped
      getValue,
      setValue,
      revealLine,
      focus: () => view.focus(),
      isConnected: () => view.dom.isConnected,
      destroy: () => view.destroy(),
      openSearch: () => M.openSearchPanel(view),
    };
  }

  window.NoteEditor = { create };
})();
