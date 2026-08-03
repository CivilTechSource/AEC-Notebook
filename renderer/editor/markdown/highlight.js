// highlight.js — syntax colouring for fenced code blocks, via Prism.
//
// Prism rather than highlight.js, despite the latter being the more common choice: highlight.js
// ships only CommonJS and ESM builds, neither of which loads from a <script> tag, and adding a
// bundler for it isn't a trade this codebase wants to make. Prism ships ready-to-run browser
// files. The vendored bundle is core plus a fixed language list (see scripts/vendor.js).
(function () {
  // Rendered by the mermaid decorator instead; colouring it as source would be wrong twice over.
  const SKIP = new Set(['mermaid']);

  function languageOf(codeEl) {
    const cls = [...codeEl.classList].find((c) => c.startsWith('language-'));
    return cls ? cls.slice('language-'.length).toLowerCase() : null;
  }

  function apply(el) {
    if (!window.Prism?.languages) return;

    for (const code of el.querySelectorAll('pre > code')) {
      if (code.dataset.highlighted) continue;
      const lang = languageOf(code);
      if (!lang || SKIP.has(lang)) continue;

      const grammar = window.Prism.languages[lang];
      // An unvendored language stays plain text rather than being mislabelled as something else.
      if (!grammar) continue;

      // Prism.highlight escapes its input; textContent is the un-decorated source, so this
      // neither trusts nor re-parses anything the note supplied as markup.
      code.innerHTML = window.Prism.highlight(code.textContent, grammar, lang);
      code.dataset.highlighted = '1';
      code.parentElement?.classList.add('has-highlight');
    }
  }

  window.MD.registerDecorator({ id: 'highlight', apply });
})();
