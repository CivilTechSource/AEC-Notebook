// setup.js — which CodeMirror extensions the note editor runs with.
//
// Kept on this side of the bundle so the composition is readable and changeable without a rebuild.
// scripts/codemirror-entry.js only exports the pieces; this decides what the editor actually is.
(function () {
  const CM = window.CM6;

  function extensions({ project, onSave, placeholderText }) {
    return [
      // --- core editing ---
      CM.EditorView.lineWrapping,          // prose, not code: never scroll sideways
      CM.history(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.EditorState.allowMultipleSelections.of(true),
      CM.rectangularSelection(),
      CM.crosshairCursor(),
      CM.bracketMatching(),
      CM.closeBrackets(),
      CM.highlightSelectionMatches(),
      CM.search({ top: true }),
      CM.codeFolding(),
      CM.indentUnit.of('  '),              // two spaces, matching the house style for nested lists

      // --- markdown ---
      // addKeymap is left on: it supplies Enter -> continue the list markup and Backspace ->
      // delete back through it, which is most of what makes typing a list feel right.
      CM.markdown({
        base: CM.markdownLanguage,
        codeLanguages: CM.codeLanguages,
      }),

      // --- [[ ]] completion ---
      CM.autocompletion({
        override: [window.CMWikilink.source(project)],
        activateOnTyping: true,
        closeOnBlur: true,
        icons: false,
      }),

      // --- appearance, drag/drop ---
      ...window.CMTheme.extensions,
      CM.placeholder(placeholderText || ''),
      window.CMAttachments.extension(project),

      // --- keys ---
      // High precedence so these win over the defaults. Deliberately NOT binding Ctrl+E for
      // inline code: that's the Schema Editor's menu accelerator, and Electron menu accelerators
      // fire ahead of web content, so binding it here would produce a key that silently does the
      // wrong thing.
      CM.Prec.high(CM.keymap.of([
        { key: 'Mod-b', run: window.CMCommands.toggleBold },
        { key: 'Mod-i', run: window.CMCommands.toggleItalic },
        { key: 'Mod-Enter', run: window.CMCommands.toggleTask },
        { key: 'Mod-s', run: () => { onSave?.(); return true; } },
      ])),
      CM.keymap.of([
        ...CM.closeBracketsKeymap,
        ...CM.completionKeymap,
        ...CM.searchKeymap,
        ...CM.historyKeymap,
        ...CM.foldKeymap,
        ...CM.defaultKeymap,
        // Tab indents rather than moving focus. That's what an editor should do and what Obsidian
        // does; the cost is that Tab no longer leaves the editor, which is a real accessibility
        // trade and worth remembering if keyboard navigation ever comes up.
        CM.indentWithTab,
      ]),
    ];
  }

  window.CMSetup = { extensions };
})();
