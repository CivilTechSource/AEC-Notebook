// backlinks.js — "which notes link here", as a sidebar pane.
//
// This used to be a strip welded under the note body (notes.js), which meant it only existed
// while a note was open and scrolled away with the text. Same data, same IPC — different home.
(function () {
  let host = null;
  let seq = 0;             // guards against an older response landing after a newer one

  function mount(el) { host = el; el.innerHTML = ''; }

  async function update(ctx) {
    if (!host) return;
    if (!ctx || ctx.kind !== 'note') return empty('Open a note to see what links to it.');

    const mine = ++seq;
    let links = [];
    try { links = await window.api.backlinks(ctx.project.path, ctx.name); }
    catch { if (mine === seq) empty('Could not read backlinks.'); return; }
    if (mine !== seq) return;

    if (!links.length) return empty('No other note links here yet.');

    host.innerHTML = `<div class="rb-count">${links.length} backlink${links.length === 1 ? '' : 's'}</div>` +
      links.map((l) => `<button class="rb-row" data-note="${esc(l.noteName)}">
          <span class="rb-row-name">${escHtml(l.noteName.replace(/\.md$/, ''))}</span>
          <span class="rb-row-sub">${escHtml(l.snippet)}</span>
        </button>`).join('');
    host.querySelectorAll('.rb-row').forEach((row) => {
      row.onclick = () => window.NotesView.open(ctx.project, row.dataset.note);
    });
  }

  function empty(msg) { host.innerHTML = `<div class="rb-empty">${escHtml(msg)}</div>`; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.Sidebar.register({ id: 'backlinks', title: 'Backlinks', icon: window.ICON.backlink, mount, update });
})();
