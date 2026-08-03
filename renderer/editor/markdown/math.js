// math.js — LaTeX via KaTeX: $inline$ and $$display$$.
//
// Operates on text nodes rather than the HTML string, so a $ inside a code span or an already
// rendered formula is never touched. The hard part is telling maths from money: an engineering
// note is full of "$5" and "£20 / $25", and treating those as delimiters would swallow whole
// paragraphs. The rules below are the usual ones — no space after the opening $, no space before
// the closing $, and no digit straight after the closing $.
//
// Rendered with output:'html'. KaTeX can emit MathML, but that would mean widening the sanitiser
// to allow a whole extra tag vocabulary for very little gain.
(function () {
  // Never descend into these: their content is either source or already-rendered output.
  const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

  function textNodesUnder(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
          if (SKIP_TAGS.has(p.tagName) || p.classList.contains('katex')) return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue.includes('$') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    return out;
  }

  // Returns [{ start, end, tex, display }] for one text node, left to right, non-overlapping.
  function findMath(text) {
    const found = [];
    let i = 0;
    while (i < text.length) {
      const at = text.indexOf('$', i);
      if (at === -1) break;

      const display = text.startsWith('$$', at);
      const openLen = display ? 2 : 1;
      const contentStart = at + openLen;
      const next = text[contentStart];

      // "$ x$" and a lone trailing "$" are not maths.
      if (next === undefined || (!display && /\s/.test(next))) { i = at + 1; continue; }

      const close = text.indexOf(display ? '$$' : '$', contentStart);
      if (close === -1) { i = at + 1; continue; }

      const tex = text.slice(contentStart, close);
      const before = text[close - 1];
      const after = text[close + (display ? 2 : 1)];
      // Empty, "…space$", or "$25" style closers are rejected — that last one is what keeps
      // "costs $5 and $10" from being read as a formula.
      if (!tex.trim() || (!display && (/\s/.test(before) || /\d/.test(after || '')))) { i = at + 1; continue; }

      found.push({ start: at, end: close + (display ? 2 : 1), tex, display });
      i = close + (display ? 2 : 1);
    }
    return found;
  }

  function apply(el) {
    if (!window.katex) return;

    for (const node of textNodesUnder(el)) {
      const text = node.nodeValue;
      const spans = findMath(text);
      if (!spans.length) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const s of spans) {
        if (s.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, s.start)));
        const holder = document.createElement(s.display ? 'div' : 'span');
        holder.className = s.display ? 'math-display' : 'math-inline';
        try {
          // throwOnError:false renders the offending source in red instead of throwing, which is
          // far more useful than losing the paragraph to one mistyped brace.
          holder.innerHTML = window.katex.renderToString(s.tex, {
            displayMode: s.display, output: 'html', throwOnError: false, strict: false,
          });
        } catch {
          holder.textContent = (s.display ? '$$' : '$') + s.tex + (s.display ? '$$' : '$');
        }
        frag.appendChild(holder);
        cursor = s.end;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  window.MD.registerDecorator({ id: 'math', apply });
  window.MDMath = { findMath };      // exported for tests
})();
