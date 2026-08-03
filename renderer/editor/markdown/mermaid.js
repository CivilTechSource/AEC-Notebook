// mermaid.js — render ```mermaid fenced blocks as diagrams.
//
// The library is 3.5 MB, so it is NOT in index.html. It's injected on first sight of a mermaid
// block and never loaded otherwise, which keeps app start instant for the overwhelming majority
// of notes that contain no diagrams. That lazy load is also why there's no on/off setting: the
// cost the setting would have avoided is already only paid by notes that ask for it.
//
// Mermaid emits SVG, which DOMPurify strips at the settings the app uses elsewhere, so the output
// is sanitised explicitly with the SVG profile before it goes anywhere near the document.
(function () {
  const SRC = 'vendor/mermaid.min.js';
  let loading = null;      // in-flight load, shared by every block on the page
  let api = null;

  // The vendored build is an esbuild IIFE that assigns to an internal namespace rather than
  // window.mermaid, so check the documented name first and fall back to the observed one.
  function findGlobal() {
    if (window.mermaid?.render) return window.mermaid;
    const ns = window.__esbuild_esm_mermaid_nm?.mermaid;
    if (ns?.render) return ns;
    // …and if a future version changes the wrapper again, look for anything that quacks right
    // rather than failing outright on a renamed private global.
    for (const key of Object.getOwnPropertyNames(window)) {
      if (!key.startsWith('__esbuild')) continue;
      const cand = window[key]?.mermaid;
      if (cand?.render) return cand;
    }
    return null;
  }

  function load() {
    if (api) return Promise.resolve(api);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.onload = () => {
        api = findGlobal();
        if (!api) return reject(new Error('mermaid loaded but exposed no render()'));
        const dark = document.documentElement.getAttribute('data-theme') !== 'light';
        api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
        resolve(api);
      };
      s.onerror = () => reject(new Error('could not load ' + SRC));
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });   // let a later block retry
    return loading;
  }

  let seq = 0;

  async function apply(el) {
    const blocks = [...el.querySelectorAll('pre > code.language-mermaid')].filter((c) => !c.dataset.rendered);
    if (!blocks.length) return;

    let mermaid;
    try { mermaid = await load(); }
    catch (e) {
      for (const c of blocks) fail(c, 'Diagram library unavailable: ' + e.message);
      return;
    }

    for (const code of blocks) {
      code.dataset.rendered = '1';
      const source = code.textContent;
      const host = document.createElement('div');
      host.className = 'mermaid-figure';
      try {
        const { svg } = await mermaid.render('mmd-' + (++seq), source);
        // Sanitise with the SVG profile: this is generated markup, but it's generated FROM note
        // content, and the app's rule is that note content never reaches the DOM unsanitised.
        host.innerHTML = window.DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        code.parentElement.replaceWith(host);
      } catch (e) {
        // A syntax error in one diagram shouldn't cost the reader the rest of the note, and the
        // source stays on screen so the mistake is findable.
        fail(code, String(e?.message || e).split('\n')[0]);
      }
    }
  }

  function fail(codeEl, message) {
    const pre = codeEl.parentElement;
    if (!pre) return;
    const note = document.createElement('div');
    note.className = 'mermaid-error';
    note.textContent = 'Diagram error: ' + message;
    pre.classList.add('mermaid-source');
    pre.parentElement?.insertBefore(note, pre);
  }

  window.MD.registerDecorator({ id: 'mermaid', apply });
})();
