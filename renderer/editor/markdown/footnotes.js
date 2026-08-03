// footnotes.js — [^1] references and [^1]: definitions.
//
// marked has no footnote support, so this runs as a preprocessor: definitions are lifted out of
// the body, references are numbered by first appearance, and a numbered list is appended at the
// end with links both ways.
//
// Registered as a preprocessor, which means it only ever sees text with code spans and fenced
// blocks already stashed out — a [^1] inside a code sample is left alone for free.
//
// Everything the note supplies lands in text position or is escaped; ids are built from the
// assigned number, never from the user's label, so a label like "a b" or "x'y" can't break out.
(function () {
  const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm;
  const REFERENCE = /\[\^([^\]\s]+)\]/g;

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  // Footnote bodies are short and inline by nature, so inline-parse them for bold/links/code
  // rather than running the full block parser. Optional so this module is testable standalone.
  function inline(text) {
    try { return window.marked?.parseInline ? window.marked.parseInline(text) : escHtml(text); }
    catch { return escHtml(text); }
  }

  function transform(src) {
    if (!src.includes('[^')) return src;      // cheap bail-out for the overwhelmingly common case

    // 1. Lift the definitions out.
    const defs = new Map();                   // label -> raw text
    let body = src.replace(DEFINITION, (m, label, text) => { defs.set(label, text); return ''; });
    if (!defs.size) return src;

    // 2. Number references by first appearance, keeping only labels that have a definition.
    const order = [];                         // label, in citation order
    body = body.replace(REFERENCE, (m, label) => {
      if (!defs.has(label)) return m;         // a reference with no definition stays literal text
      let n = order.indexOf(label) + 1;
      if (n === 0) n = order.push(label);
      return `<sup class="fn-ref" id="fnref-${n}"><a href="#fn-${n}" data-fn="${n}">${n}</a></sup>`;
    });
    if (!order.length) return src;            // definitions but nothing cites them — leave as-is

    // 3. Append the list. Uncited definitions are intentionally dropped; they'd have no number.
    const items = order.map((label, i) => {
      const n = i + 1;
      return `<li class="fn-item" id="fn-${n}">${inline(defs.get(label))}` +
             ` <a href="#fnref-${n}" class="fn-back" data-fnback="${n}" title="Back to text">↩</a></li>`;
    }).join('');

    return `${body.replace(/\n{3,}$/, '\n\n')}\n\n<section class="footnotes"><ol>${items}</ol></section>\n`;
  }

  window.MD.registerPreprocessor(transform);
  window.MDFootnotes = { transform };      // exported for tests
})();
