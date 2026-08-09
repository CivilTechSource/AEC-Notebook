// attachments.js — drop and paste files into a note, for CodeMirror.
//
// Only the plumbing changes. Reading the file, saving it through IPC and choosing the markdown
// form all still live in editor/attachments.js — this supplies the CodeMirror-shaped event
// handlers and an insert-at-cursor that goes through a transaction instead of splicing a value.
(function () {
  const { EditorView } = window.CM6;

  function insertAtCursor(view, text) {
    const range = view.state.selection.main;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
      userEvent: 'input.attach',
      scrollIntoView: true,
    });
  }

  // Save each dropped/pasted File and insert a link at the cursor. The size check, the base64
  // read and the image test are shared with editor/attachments.js, which owns everything that
  // isn't CodeMirror-shaped; the insert is the only part that differs.
  async function insertFiles(view, project, files) {
    for (const file of files) {
      // Refused before the FileReader runs: reading a 200 MB drawing into a base64 string is
      // itself the freeze, so the check has to come first, not after.
      if (window.Attach.tooBig(file)) continue;
      try {
        const base64 = await window.Attach.readAsBase64(file);
        const name = file.name || `pasted-${Date.now()}.png`;
        const rel = await window.api.saveAttachment(project.path, name, base64);
        // Attach.markdownLink URL-encodes the target: a filename with a space, a bracket or a
        // paren produces a link marked won't parse, and the note ends up showing the raw
        // `![x](attachments/x y.png)` as text.
        insertAtCursor(view, window.Attach.markdownLink(rel) + '\n');
        window.Toast?.success('Attached ' + rel.split('/').pop());
      } catch (err) {
        window.Toast?.error('Attach failed: ' + (err.message || err));
      }
    }
  }

  function extension(project) {
    return EditorView.domEventHandlers({
      dragover(event) {
        if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
      },
      drop(event, view) {
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length) return false;
        event.preventDefault();
        // Put the cursor where the drop landed before inserting, so a file dropped mid-document
        // doesn't append itself wherever the cursor happened to be.
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos != null) view.dispatch({ selection: { anchor: pos } });
        insertFiles(view, project, files);
        return true;
      },
      paste(event, view) {
        const files = [...(event.clipboardData?.items || [])]
          .filter((it) => it.kind === 'file')
          .map((it) => it.getAsFile())
          .filter(Boolean);
        if (!files.length) return false;      // ordinary text paste — let CodeMirror handle it
        event.preventDefault();
        insertFiles(view, project, files);
        return true;
      },
    });
  }

  window.CMAttachments = { extension, insertAtCursor };
})();
