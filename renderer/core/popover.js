// popover.js — one floating card, positioned against a rectangle.
//
// Used by the [[ suggester and the wikilink hover preview. Deliberately singular: two popovers on
// screen at once is never what you want, and making that structural avoids having to coordinate
// them. Opening one closes the other.
(function () {
  let current = null;   // { el, onClose }

  function close() {
    if (!current) return;
    const { el, onClose } = current;
    current = null;                       // cleared first: onClose may open another popover
    el.remove();
    document.removeEventListener('mousedown', onDocMouseDown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    try { onClose?.(); } catch (e) { console.error('popover onClose failed', e); }
  }

  function onDocMouseDown(e) { if (current && !current.el.contains(e.target)) close(); }

  // rect is in viewport coordinates (getBoundingClientRect / a caret rect).
  function open({ rect, html, className = '', maxWidth = 380, onClose = null }) {
    close();
    const el = document.createElement('div');
    el.className = 'popover' + (className ? ' ' + className : '');
    el.style.maxWidth = maxWidth + 'px';
    el.innerHTML = html;
    document.body.appendChild(el);
    place(el, rect);

    current = { el, onClose };
    // Capture phase: a click on a tab or the ribbon should dismiss before that handler runs.
    document.addEventListener('mousedown', onDocMouseDown, true);
    // Any layout change invalidates the anchor, and re-measuring is not worth it here.
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return el;
  }

  // Below the anchor by default; flipped above when there isn't room, clamped to the viewport.
  function place(el, rect) {
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - r.width - 8));
    let top = rect.bottom + 4;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, rect.top - r.height - 4);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function isOpen() { return !!current; }
  function element() { return current?.el || null; }

  window.Popover = { open, close, isOpen, element, place };
})();
