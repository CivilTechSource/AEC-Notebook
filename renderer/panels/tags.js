// tags.js — every #tag used across the current project, with counts.
//
// Tags are scoped to the project, same as wikilinks and backlinks. Building the list means
// reading every note in the project, so the result is cached per project path and dropped when
// anything in that project changes on disk — otherwise every tab switch would re-read the lot.
(function () {
  let host = null;
  let current = null;
  let seq = 0;
  const cache = new Map();      // projectPath -> [{ tag, count }]

  function mount(el) {
    host = el;
    el.innerHTML = '';
    // Our own writes come back through here too, which is what we want: saving a note that adds
    // a tag should update the pane.
    window.FsWatch?.subscribe((change) => {
      if (!change?.projectPath) return;
      cache.delete(change.projectPath);
      if (current && current.project.path === change.projectPath) render(current);
    });
    window.Events?.on('note-body-changed', (p) => {
      // The buffer changed but nothing is on disk yet; drop the cache so the next render is fresh.
      if (current && p && p.id === current.id) { cache.delete(current.project.path); render(current); }
    });
  }

  function update(ctx) {
    current = ctx && ctx.project ? ctx : null;
    render(current);
  }

  async function render(ctx) {
    if (!host) return;
    if (!ctx) return empty('Open a project or note to see its tags.');

    const mine = ++seq;
    let tags = cache.get(ctx.project.path);
    if (!tags) {
      try { tags = await collect(ctx); } catch { if (mine === seq) empty('Could not read tags.'); return; }
      if (mine !== seq) return;
      cache.set(ctx.project.path, tags);
    }
    if (!tags.length) return empty('No tags in this project yet. Add one with #like-this.');

    host.innerHTML = `<div class="rb-count">${tags.length} tag${tags.length === 1 ? '' : 's'}</div>` +
      tags.map((t) => `<button class="rb-row rb-tag-row" data-tag="${esc(t.tag)}">
          <span class="tag">#${escHtml(t.tag)}</span>
          <span class="rb-tag-count">${t.count}</span>
        </button>`).join('');

    // Same destination as clicking a tag in the reading view.
    host.querySelectorAll('.rb-tag-row').forEach((row) => {
      row.onclick = () => window.QuickSwitcher.open('#' + row.dataset.tag);
    });
  }

  async function collect(ctx) {
    const counts = new Map();
    const names = await window.api.listNotes(ctx.project.path);
    // The open note's unsaved buffer is more current than its file — prefer it.
    const liveName = ctx.kind === 'note' ? ctx.name : null;
    for (const name of names) {
      let body = '';
      if (name === liveName && typeof ctx.getBody === 'function') body = ctx.getBody();
      else { try { body = await window.api.readNote(ctx.project.path, name); } catch { continue; } }
      for (const tag of window.MD.refs(body).tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  function empty(msg) { host.innerHTML = `<div class="rb-empty">${escHtml(msg)}</div>`; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.Sidebar.register({ id: 'tags', title: 'Tags', icon: window.ICON.tag, mount, update });
})();
