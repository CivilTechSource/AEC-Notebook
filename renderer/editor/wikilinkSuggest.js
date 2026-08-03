// wikilinkSuggest.js — type [[ in a note and pick the target from a list.
//
// Before this, linking meant already knowing the exact note name; get it wrong and clicking the
// link in reading view silently created a second, near-identically named note.
//
// Written against a plain textarea but with no assumptions beyond value/selectionStart, so the
// same module should survive a move to a real editor component.
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

  // Where the caret is on screen. A textarea gives no API for this, so measure a mirror div
  // styled identically and read the position of a marker placed at the caret offset.
  function caretRect(ta) {
    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderLeftWidth', 'textTransform']) mirror.style[p] = cs[p];
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, ta.selectionStart);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const taBox = ta.getBoundingClientRect();
    const mBox = mirror.getBoundingClientRect();
    const mkBox = marker.getBoundingClientRect();
    mirror.remove();

    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const x = taBox.left + (mkBox.left - mBox.left);
    const y = taBox.top + (mkBox.top - mBox.top) - ta.scrollTop;
    return { left: x, top: y, bottom: y + lineHeight };
  }

  // The unclosed [[ immediately before the caret, if there is one.
  function activeQuery(ta) {
    const before = ta.value.slice(0, ta.selectionStart);
    // No ], [ or newline between the brackets and the caret — otherwise the link is already
    // closed, or we're looking at something that isn't a link at all.
    const m = before.match(/\[\[([^[\]\n]*)$/);
    return m ? { query: m[1], start: ta.selectionStart - m[1].length - 2 } : null;
  }

  function attach(ta, project) {
    let items = [];
    let index = 0;
    let anchor = null;    // { start } of the '[[' being completed

    function closeList() { anchor = null; items = []; index = 0; window.Popover.close(); }

    function render() {
      if (!items.length) return closeList();
      const html = `<div class="pop-list">${items.map((name, i) =>
        `<button class="pop-item${i === index ? ' active' : ''}" data-i="${i}">${escHtml(name)}</button>`).join('')}` +
        `<div class="pop-hint">↑↓ choose · ⏎ insert · esc dismiss</div></div>`;

      const existing = window.Popover.element();
      if (existing && anchor) {
        // Re-rendering in place keeps the card from jumping around as the query narrows.
        existing.innerHTML = html;
        wireItems(existing);
        return;
      }
      const el = window.Popover.open({
        rect: caretRect(ta), html, className: 'pop-suggest', maxWidth: 320,
        onClose: () => { anchor = null; items = []; },
      });
      wireItems(el);
    }

    function wireItems(el) {
      el.querySelectorAll('.pop-item').forEach((b) => {
        // mousedown, not click: clicking would blur the textarea first and lose the caret.
        b.addEventListener('mousedown', (e) => { e.preventDefault(); accept(Number(b.dataset.i)); });
      });
    }

    function accept(i) {
      const name = items[i];
      if (name == null || anchor == null) return closeList();
      const start = anchor.start;
      const end = ta.selectionStart;
      const insert = `[[${name}]]`;
      ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
      const caret = start + insert.length;
      ta.setSelectionRange(caret, caret);
      closeList();
      // Synthesised so the editor's own autosave/word-count/outline handlers run.
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function refresh() {
      const hit = activeQuery(ta);
      if (!hit) return closeList();
      anchor = { start: hit.start };
      const q = hit.query.toLowerCase();
      const all = await noteNames(project.path);
      // Still relevant? The user may have typed on while we were awaiting.
      if (!activeQuery(ta)) return closeList();
      items = all.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
      index = 0;
      if (!items.length) return closeList();
      render();
    }

    ta.addEventListener('input', refresh);
    ta.addEventListener('blur', () => setTimeout(closeList, 120));   // let a click on an item land

    ta.addEventListener('keydown', (e) => {
      if (!anchor || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); index = (index + 1) % items.length; render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); index = (index - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(index); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(); }
    });
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  window.WikilinkSuggest = { attach };
})();
