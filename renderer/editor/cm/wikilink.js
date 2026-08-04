// wikilink.js — [[ ]] completion, as a CodeMirror completion source.
//
// Replaces editor/wikilinkSuggest.js. The note-name lookup and its short cache carry over
// unchanged; what disappears is all the machinery that existed only because a textarea can't tell
// you where the caret is on screen — the mirror div, the manual popover, the arrow-key handling
// and the blur timing. CodeMirror positions and navigates the list itself.
(function () {
  const CACHE_MS = 5000;
  const cache = new Map();   // projectPath -> { at, names }

  async function noteNames(projectPath) {
    const hit = cache.get(projectPath);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.names;
    let names = [];
    try { names = await window.api.listNotes(projectPath); } catch { /* offer nothing */ }
    const stripped = names.map((n) => n.replace(/\.md$/, ''));
    cache.set(projectPath, { at: Date.now(), names: stripped });
    return stripped;
  }

  // Matches an unclosed [[ before the cursor. No ], [ or newline in between — otherwise the link
  // is already closed, or this isn't a link at all.
  const OPEN = /\[\[([^[\]\n]*)$/;

  function source(project) {
    return async (context) => {
      const before = context.matchBefore(OPEN);
      if (!before) return null;
      // Don't pop the list open on a bare [[ unless the user asked for it explicitly.
      if (before.from === before.to && !context.explicit) return null;

      const typed = before.text.slice(2).toLowerCase();
      const names = await noteNames(project.path);
      if (context.aborted) return null;

      return {
        // from = just after the [[, so the completion replaces only what's been typed.
        from: before.from + 2,
        options: names
          .filter((n) => n.toLowerCase().includes(typed))
          .slice(0, 20)
          .map((name) => ({
            label: name,
            type: 'text',
            // Close the brackets as part of applying, and leave the cursor past them.
            apply: (view, _completion, from, to) => {
              view.dispatch({
                changes: { from, to, insert: `${name}]]` },
                selection: { anchor: from + name.length + 2 },
                userEvent: 'input.complete',
              });
            },
          })),
        validFor: /^[^[\]\n]*$/,     // keep filtering as they type rather than re-querying
      };
    };
  }

  window.CMWikilink = { source };
})();
