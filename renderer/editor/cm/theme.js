// theme.js — CodeMirror styling, written against the app's own design tokens.
//
// Every colour here is a var(--token) rather than a literal. That means the editor follows the
// light/dark switch automatically: toggling the theme changes :root, and the editor repaints with
// no reconfiguration, no Compartment and no rebuild. It also means the editor can never drift
// from the rest of the app's palette.
//
// Sizing deliberately matches what .note-body used to be (var(--mono), 14px, 1.7) so switching to
// Reading mode doesn't visibly reflow the text.
(function () {
  const { EditorView, HighlightStyle, syntaxHighlighting, tags: t } = window.CM6;

  const base = EditorView.theme({
    '&': {
      color: 'var(--text-2)',
      backgroundColor: 'transparent',
      // The three user-settable typography tokens (tokens.css). The reading view reads the same
      // ones, which is what stops the text reflowing when you toggle between the two.
      fontFamily: 'var(--editor-font)',
      fontSize: 'var(--editor-fs)',
      fontWeight: 'var(--editor-weight)',
      height: '100%',
    },
    '.cm-content': {
      padding: '10px 0 40px',
      lineHeight: 'var(--editor-lh)',
      caretColor: 'var(--accent)',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: 'var(--editor-lh)',
      overflow: 'auto',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-line': { padding: '0' },

    // Cursor and selection. CodeMirror draws its own selection layer (drawSelection), so the
    // native ::selection rules don't apply and these are the ones that matter.
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--accent-tint-strong)',
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--accent-tint)' },
    '.cm-activeLine': { backgroundColor: 'transparent' },   // too noisy in prose

    '.cm-placeholder': { color: 'var(--faint)' },

    // Matching brackets — subtle, since prose is full of them.
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'var(--accent-tint)',
      outline: 'none',
    },

    // Find & replace panel, styled to match the app's own inputs and buttons.
    '.cm-panels': {
      backgroundColor: 'var(--bg-panel)',
      color: 'var(--text-2)',
      border: 'none',
      borderBottom: '1px solid var(--line)',
      fontFamily: 'var(--font-ui)',
    },
    '.cm-panels.cm-panels-bottom': { borderBottom: 'none', borderTop: '1px solid var(--line)' },
    '.cm-panel.cm-search': { padding: '8px 10px', fontSize: '12px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      backgroundColor: 'var(--bg-dark)',
      color: 'var(--text)',
      border: '1px solid var(--line-3)',
      borderRadius: 'var(--radius-sm)',
      padding: '3px 8px',
      font: 'inherit',
      margin: '0 4px 0 0',
    },
    '.cm-panel.cm-search input:focus': { outline: 'none', borderColor: 'var(--accent)' },
    '.cm-panel.cm-search button:hover': { backgroundColor: 'var(--bg-card)', cursor: 'pointer' },
    '.cm-panel.cm-search label': { color: 'var(--muted)', fontSize: '11px' },
    '.cm-searchMatch': { backgroundColor: 'var(--amber-tint)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--accent-tint-strong)' },

    // Autocomplete popup — the [[ ]] suggester lives here.
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--line-3)',
      borderRadius: 'var(--radius-md)',
      boxShadow: '0 10px 30px rgba(0,0,0,.45)',
      fontFamily: 'var(--font-ui)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: '12.5px', maxHeight: '16em' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '5px 10px', color: 'var(--text-2)' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-tint)',
      color: 'var(--text)',
    },
    '.cm-completionIcon': { display: 'none' },      // the list is all one kind of thing
  });

  // Markdown syntax colouring.
  //
  // processingInstruction is the one that defines the feel: it covers the markers themselves
  // (the #, the **, the backticks). Keeping them faint rather than hiding them is the whole point
  // of a source editor — you can see the structure without it shouting.
  const highlight = HighlightStyle.define([
    { tag: t.processingInstruction, color: 'var(--faint)' },

    // em-relative so they follow --editor-fs, times the same --heading-scale the reading view uses.
    { tag: t.heading1, color: 'var(--text)', fontWeight: '700', fontSize: 'calc(1.5em * var(--heading-scale))', lineHeight: '1.4' },
    { tag: t.heading2, color: 'var(--text)', fontWeight: '700', fontSize: 'calc(1.3em * var(--heading-scale))', lineHeight: '1.4' },
    { tag: t.heading3, color: 'var(--text)', fontWeight: '600', fontSize: 'calc(1.15em * var(--heading-scale))' },
    { tag: [t.heading4, t.heading5, t.heading6], color: 'var(--text)', fontWeight: '600' },

    { tag: t.strong, color: 'var(--text)', fontWeight: '700' },
    { tag: t.emphasis, color: 'var(--text)', fontStyle: 'italic' },
    { tag: t.strikethrough, color: 'var(--muted)', textDecoration: 'line-through' },

    { tag: [t.link, t.url], color: 'var(--accent)' },
    { tag: t.monospace, color: 'var(--teal)' },
    { tag: t.quote, color: 'var(--muted)' },
    { tag: t.list, color: 'var(--accent)' },
    { tag: t.contentSeparator, color: 'var(--line-4)' },

    // Fenced code blocks — the languages bundled in scripts/codemirror-entry.js.
    { tag: t.keyword, color: 'var(--purple)' },
    { tag: [t.string, t.special(t.string)], color: 'var(--green)' },
    { tag: [t.number, t.bool, t.null], color: 'var(--amber)' },
    { tag: t.comment, color: 'var(--muted-2)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--accent)' },
    { tag: [t.className, t.typeName, t.namespace], color: 'var(--teal)' },
    { tag: [t.operator, t.punctuation, t.separator], color: 'var(--muted)' },
    { tag: [t.propertyName, t.attributeName], color: 'var(--red)' },
    { tag: t.invalid, color: 'var(--red)' },
  ]);

  window.CMTheme = { extensions: [base, syntaxHighlighting(highlight)] };
})();
