// outlinks.js — the [[links]] going OUT of the current note (the inverse of backlinks).
//
// Links are resolved against the project's real notes so a link to something that doesn't exist
// yet is shown as such. That matters here: clicking a dangling wikilink in the reading view
// silently creates the note, and without this pane there's no way to see which links are dangling
// before you click one.
(function () {
  let host = null;
  let current = null;
  let seq = 0;

  function mount(el) {
    host = el;
    el.innerHTML = '';
    window.Events?.on('note-body-changed', (p) => {
      if (current && p && p.id === current.id) render(current);
    });
  }

  function update(ctx) {
    current = ctx && ctx.kind === 'note' ? ctx : null;
    render(current);
  }

  async function render(ctx) {
    if (!host) return;
    if (!ctx) return empty('Open a note to see its outgoing links.');

    const body = typeof ctx.getBody === 'function' ? ctx.getBody() : '';
    const links = window.MD.refs(body).links;
    if (!links.length) return empty('This note links nowhere yet.');

    const mine = ++seq;
    let existing = [];
    try { existing = await window.api.listNotes(ctx.project.path); } catch { /* treat as none */ }
    if (mine !== seq) return;

    // Wikilink resolution is case-insensitive (see notes.js), so match that here.
    const have = new Set(existing.map((n) => n.replace(/\.md$/, '').toLowerCase()));
    const rows = links.map((name) => ({ name, exists: have.has(name.toLowerCase()) }));
    const missing = rows.filter((r) => !r.exists).length;

    host.innerHTML =
      `<div class="rb-count">${rows.length} link${rows.length === 1 ? '' : 's'}${missing ? ` · ${missing} not created` : ''}</div>` +
      rows.map((r) => `<button class="rb-row" data-note="${esc(r.name)}" data-exists="${r.exists}">
          <span class="rb-row-name${r.exists ? '' : ' rb-dangling'}">${escHtml(r.name)}</span>
          ${r.exists ? '' : '<span class="rb-row-sub">not created yet</span>'}
        </button>`).join('');

    host.querySelectorAll('.rb-row').forEach((row) => {
      row.onclick = async () => {
        const want = row.dataset.note;
        const notes = await window.api.listNotes(ctx.project.path);
        const match = notes.find((n) => n.replace(/\.md$/, '').toLowerCase() === want.toLowerCase());
        if (match) return window.NotesView.open(ctx.project, match);
        const created = await window.api.createNote(ctx.project.path, want);
        window.NotesView.open(ctx.project, created, { isNew: true });
      };
    });
  }

  function empty(msg) { host.innerHTML = `<div class="rb-empty">${escHtml(msg)}</div>`; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.Sidebar.register({ id: 'outlinks', title: 'Outgoing links', icon: window.ICON.outlink, mount, update });
})();
