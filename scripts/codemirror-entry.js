// codemirror-entry.js — the source esbuild bundles into renderer/vendor/codemirror.js.
//
// This file is NOT loaded by the app. It exists so esbuild has one ESM entry point to follow;
// the output is an IIFE that publishes `window.CM6`, which is what the renderer actually uses.
// Run `npm run vendor` after changing anything here.
//
// The renderer composes these pieces itself (see renderer/editor/cm/setup.js) rather than
// receiving a pre-built editor — keeping composition on the readable side of the bundle.
//
// Deliberately NOT using @codemirror/language-data: it loads each language through a dynamic
// import(), and Chromium refuses ES module imports over file://, which is how the renderer loads.
// The languages below are therefore bundled statically, matching the list already vendored for
// Prism so a fenced block looks the same while editing as it does in Reading mode.

import { EditorState, EditorSelection, Compartment, StateEffect, StateField, Prec } from '@codemirror/state';
import {
  EditorView, keymap, drawSelection, highlightActiveLine, highlightActiveLineGutter,
  rectangularSelection, crosshairCursor, dropCursor, placeholder, lineNumbers,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, undo, redo, indentWithTab,
  toggleComment, insertNewlineAndIndent,
} from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching,
  foldGutter, foldKeymap, codeFolding, foldCode, unfoldCode, LanguageDescription, StreamLanguage,
} from '@codemirror/language';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';

// Fenced-code languages. Each `load` resolves immediately because the parser is already in this
// bundle — LanguageDescription just expects a promise.
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp';

const desc = (name, alias, support) => LanguageDescription.of({ name, alias, load: () => Promise.resolve(support) });

const codeLanguages = [
  desc('JavaScript', ['js', 'jsx'], javascript({ jsx: true })),
  desc('TypeScript', ['ts'], javascript({ jsx: true, typescript: true })),
  desc('Python', ['py'], python()),
  desc('JSON', ['json'], json()),
  desc('YAML', ['yaml', 'yml'], yaml()),
  desc('SQL', ['sql'], sql()),
  desc('Shell', ['bash', 'sh', 'shell', 'zsh'], StreamLanguage.define(shell)),
  desc('Diff', ['diff', 'patch'], StreamLanguage.define(diff)),
  desc('INI', ['ini', 'properties', 'conf'], StreamLanguage.define(properties)),
  desc('Lisp', ['lisp', 'commonlisp', 'lsp'], StreamLanguage.define(commonLisp)),
];

window.CM6 = {
  // state
  EditorState, EditorSelection, Compartment, StateEffect, StateField, Prec,
  // view
  EditorView, keymap, drawSelection, highlightActiveLine, highlightActiveLineGutter,
  rectangularSelection, crosshairCursor, dropCursor, placeholder, lineNumbers,
  // commands
  defaultKeymap, history, historyKeymap, undo, redo, indentWithTab,
  toggleComment, insertNewlineAndIndent,
  // language
  syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching,
  foldGutter, foldKeymap, codeFolding, foldCode, unfoldCode, LanguageDescription, StreamLanguage,
  // markdown
  markdown, markdownLanguage, markdownKeymap, codeLanguages,
  // completion + search
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  search, searchKeymap, openSearchPanel, highlightSelectionMatches,
  // highlight tags, for building a theme against the app's own tokens
  tags,
};
