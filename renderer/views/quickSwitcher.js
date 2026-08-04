// quickSwitcher.js — Cmd/Ctrl+P full-text quick switcher across projects, fields, and notes.
(function () {
  let overlay = null;
  let results = [];
  let active = 0;
  let seq = 0;
  let returnFocusTo = null;   // restore focus to whatever was focused before opening

  function open(prefill) {
    if (overlay) { const i = overlay.querySelector('#qsInput'); if (prefill) { i.value = prefill; i.dispatchEvent(new Event('input')); } i.focus(); return; }
    returnFocusTo = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = 'qs-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Quick switcher');
    overlay.innerHTML = `
      <div class="qs-box">
        <input id="qsInput" placeholder="Search projects, fields, and notes…" autocomplete="off" />
        <div class="qs-results" id="qsResults"></div>
        <div class="qs-foot"><span>↑↓ navigate · ↵ open · ⌘↵ new tab · esc close</span><span id="qsCount"></span></div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#qsInput');
    input.focus();
    if (prefill) { input.value = prefill; }

    const run = debounce(async () => {
      const q = input.value.trim();
      const mySeq = ++seq;
      if (!q) { results = []; render(); return; }
      const projects = window.Store.allProjects().map((p) => ({ path: p.path, name: p.name, libraryPath: p.libraryPath }));
      let res = [];
      try { res = await window.api.search(q, projects); } catch (e) { window.Toast?.error('Search failed: ' + e.message); }
      if (mySeq !== seq) return; // a newer query superseded this one
      results = res; active = 0; render();
    }, 200);

    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, results.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(results[active], e.metaKey || e.ctrlKey); }
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    if (prefill) run();   // kick off the initial search
  }

  function close() {
    seq++;                       // abandon any search still in flight
    overlay?.remove(); overlay = null; results = []; active = 0;
    try { returnFocusTo?.focus?.(); } catch { /* element gone */ }
    returnFocusTo = null;
  }

  function render() {
    // The debounced search can land after the overlay has been closed.
    if (!overlay) return;
    const host = overlay.querySelector('#qsResults');
    overlay.querySelector('#qsCount').textContent = results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : '';
    if (!results.length) { host.innerHTML = `<div class="qs-empty">No matches</div>`; return; }
    host.innerHTML = '';
    results.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'qs-row' + (i === active ? ' active' : '');
      const icon = r.type === 'note' ? window.ICON.note : window.ICON.boardTab;
      const title = r.type === 'note' ? r.noteName.replace(/\.md$/, '') : r.projectName;
      // Project names are folder names off a shared drive, so they are NOT trusted markup.
      // This used to interpolate r.projectName unescaped into innerHTML; a folder named with a
      // tag in it would have been injected into the page. Both parts go in as text now.
      const sub = r.type === 'note' ? `${r.projectName} · ${r.snippet}` : r.snippet;
      row.innerHTML = `<span class="qs-ico">${icon}</span><span class="qs-text"><span class="qs-title"></span><span class="qs-sub"></span></span><span class="qs-kind"></span>`;
      row.querySelector('.qs-title').textContent = title;
      row.querySelector('.qs-sub').textContent = sub;
      row.querySelector('.qs-kind').textContent = r.type;
      row.onmousemove = () => { if (active !== i) { active = i; render(); } };
      row.onclick = (e) => choose(r, e.metaKey || e.ctrlKey);
      host.appendChild(row);
    });
    host.querySelector('.qs-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(r, newTab) {
    if (!r) return;
    const project = window.Store.getProject(r.projectPath);
    if (!project) return;
    close();
    if (r.type === 'note') window.NotesView.open(project, r.noteName, { newTab });
    else window.openProjectFromSwitcher?.(project, { newTab });
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  window.QuickSwitcher = { open, close };
})();
