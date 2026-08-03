// outline.js — the current note's heading tree.
//
// Reads the live buffer rather than the file on disk, so the outline tracks what you're typing.
// Jumping to a heading is delegated to the editor via ctx.revealLine(): this pane knows the line
// number, only the editor knows whether it's showing a textarea or the rendered reading view.
(function () {
  let host = null;
  let current = null;      // the ctx we last rendered, so body-change events can re-render

  function mount(el) {
    host = el;
    el.innerHTML = '';
    // Typing changes the headings; re-render on the editor's debounced signal rather than on
    // every keystroke.
    window.Events?.on('note-body-changed', (p) => {
      if (current && p && p.id === current.id) render(current);
    });
  }

  function update(ctx) {
    current = ctx && ctx.kind === 'note' ? ctx : null;
    render(current);
  }

  function render(ctx) {
    if (!host) return;
    if (!ctx) return empty('Open a note to see its outline.');

    const body = typeof ctx.getBody === 'function' ? ctx.getBody() : '';
    const heads = window.MD.headings(body);
    if (!heads.length) return empty('No headings in this note.');

    // Indent relative to the shallowest heading present, so a note that starts at ## doesn't
    // render with a permanent empty gutter.
    const base = Math.min(...heads.map((h) => h.level));
    host.innerHTML = `<div class="rb-count">${heads.length} heading${heads.length === 1 ? '' : 's'}</div>` +
      heads.map((h) => `<button class="rb-row rb-outline-row" data-line="${h.line}" style="padding-left:${10 + (h.level - base) * 13}px">
          <span class="rb-h-level">H${h.level}</span>
          <span class="rb-row-name">${escHtml(h.text)}</span>
        </button>`).join('');

    host.querySelectorAll('.rb-outline-row').forEach((row) => {
      row.onclick = () => ctx.revealLine?.(Number(row.dataset.line));
    });
  }

  function empty(msg) { host.innerHTML = `<div class="rb-empty">${escHtml(msg)}</div>`; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  window.Sidebar.register({ id: 'outline', title: 'Outline', icon: window.ICON.outline, mount, update });
})();
