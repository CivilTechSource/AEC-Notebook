// tableView.js — a spreadsheet-style view of every project in a library path:
// rows = projects, columns = that path's schema fields. Sort + filter; click a row to open it.
(function () {
  const I = () => window.ICON;
  const V = () => window.DataValidation;

  function open(libraryPath) {
    window.Tabs.open({
      id: 'table:' + libraryPath,
      title: '⊞ ' + base(libraryPath),
      icon: I().schema,
      render: (pane) => render(pane, libraryPath),
    });
  }

  function render(pane, libraryPath) {
    const state = { sortKey: null, sortDir: 1, filter: '' };

    function group() { return window.Store.state.groups.find((g) => g.path === libraryPath); }
    function fields() { return V().schemaFields(window.Store.schemaForPath(libraryPath)); }

    function draw() {
      const g = group();
      const cols = fields();
      const projects = rows(g ? g.projects : [], cols, state);

      pane.innerHTML = `
        <div class="page-head">
          <div>
            <div class="page-title">⊞ ${escHtml(base(libraryPath))}</div>
            <div class="page-desc">${projects.length} project${projects.length === 1 ? '' : 's'} · ${cols.length} field${cols.length === 1 ? '' : 's'}</div>
          </div>
          <div class="head-actions">
            <input id="tblFilter" placeholder="Filter…" value="${escAttr(state.filter)}" style="width:200px;height:30px;" />
            <button class="btn" id="tblCsv">${I().export} CSV</button>
          </div>
        </div>
        <div class="page-body">
          <table class="proj-table">
            <thead><tr>
              <th data-sort="__name">Project ${sortCaret(state, '__name')}</th>
              <th data-sort="__status">Status ${sortCaret(state, '__status')}</th>
              ${cols.map((f) => `<th data-sort="${escAttr(f.key)}">${escHtml(f.label)} ${sortCaret(state, f.key)}</th>`).join('')}
            </tr></thead>
            <tbody></tbody>
          </table>
          ${projects.length ? '' : '<div class="empty-hint" style="text-align:left;padding:20px 28px;">No projects match.</div>'}
        </div>`;

      const tbody = pane.querySelector('tbody');
      projects.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="pt-name">${escHtml(p.name)}</td><td>${statusCell(p)}</td>` +
          cols.map((f) => `<td>${cellHtml(f, (p.data || {})[f.key])}</td>`).join('');
        tr.querySelector('.pt-name').onclick = () => window.openProjectFromSwitcher?.(p);
        tr.addEventListener('auxclick', (e) => { if (e.button === 1) window.openProjectFromSwitcher?.(p, { newTab: true }); });
        tbody.appendChild(tr);
      });

      pane.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = 1; }
        draw();
      });
      const filt = pane.querySelector('#tblFilter');
      // Debounced: draw() rebuilds every row, and doing that per keystroke on a folder with a few
      // hundred projects makes typing lag. The caret position is carried across because the input
      // is destroyed by the redraw — it used to be forced to the end, so editing the middle of a
      // filter threw you to the end of it on the next character.
      filt.oninput = () => {
        state.filter = filt.value;
        const caret = filt.selectionStart;
        redraw(() => restoreFocus(caret));
      };
      pane.querySelector('#tblCsv').onclick = () => exportCsv(base(libraryPath), cols, projects);
    }

    let redrawTimer = null;
    function redraw(after) {
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(() => { redrawTimer = null; draw(); after?.(); }, 120);
    }

    function restoreFocus(caret) {
      const el = pane.querySelector('#tblFilter');
      if (!el) return;
      el.focus();
      const at = Math.min(caret ?? el.value.length, el.value.length);
      el.setSelectionRange(at, at);
    }
    draw();
  }

  function rows(list, cols, state) {
    let r = list.slice();
    const f = state.filter.trim().toLowerCase();
    if (f) r = r.filter((p) => p.name.toLowerCase().includes(f) || cols.some((c) => cellText(c, (p.data || {})[c.key]).toLowerCase().includes(f)));
    if (state.sortKey === '__name') r.sort((a, b) => a.name.localeCompare(b.name) * state.sortDir);
    else if (state.sortKey === '__status') r.sort((a, b) => (statusRank(a) - statusRank(b)) * state.sortDir);
    else if (state.sortKey) r.sort((a, b) => cmp(cellText(colByKey(cols, state.sortKey), (a.data || {})[state.sortKey]), cellText(colByKey(cols, state.sortKey), (b.data || {})[state.sortKey])) * state.sortDir);
    else r.sort((a, b) => a.name.localeCompare(b.name));
    return r;
  }

  function colByKey(cols, k) { return cols.find((c) => c.key === k) || { type: 'text' }; }
  function statusRank(p) { if (!p.hasMetadata) return 2; if (p.complete === false) return 1; return 0; }
  function statusCell(p) {
    if (!p.hasMetadata) return `<span class="pt-pill muted">not set up</span>`;
    if (p.complete === false) return `<span class="pt-pill amber">incomplete</span>`;
    return `<span class="pt-pill green">complete</span>`;
  }

  function cellText(field, value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '';
    if (field.type === 'multiselect') return (value || []).map((v) => optLabel(field, v)).join(', ');
    if (field.type === 'dropdown') return optLabel(field, value);
    if (field.type === 'checkbox') return value ? 'Yes' : 'No';
    if (field.type === 'file') return String(value).split(/[\\/]/).pop();
    return String(value);
  }
  function cellHtml(field, value) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '<span class="pt-empty">—</span>';
    if (field.type === 'multiselect') return `<span class="pill-row">${value.map((v) => `<span class="pill">${escHtml(optLabel(field, v))}</span>`).join('')}</span>`;
    if (field.type === 'dropdown') { const hl = V().shouldHighlight(field, value); return `<span class="pill ${hl ? 'pill-danger' : ''}">${escHtml(optLabel(field, value))}</span>`; }
    return escHtml(cellText(field, value));
  }
  function optLabel(field, value) { const o = (field.options || []).find((x) => x.value === value); return o ? o.label : value; }

  // A cell starting with = + - @ (or a leading tab/CR) is executed as a formula by Excel and
  // Sheets when the export is opened. Prefix with a quote so it stays text.
  function csvCell(v) {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  function exportCsv(name, cols, projects) {
    const head = ['Project', 'Status', ...cols.map((c) => c.label)];
    const lines = [head, ...projects.map((p) => [p.name, statusRank(p) === 0 ? 'complete' : statusRank(p) === 1 ? 'incomplete' : 'not set up', ...cols.map((c) => cellText(c, (p.data || {})[c.key]))])];
    const csv = lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
    // Excel reads a BOM-less CSV as the system codepage, so a project called "Ashfield Résidence"
    // or any © / – in a field opens as mojibake. The BOM is the only thing that makes it read
    // UTF-8. Written as \uFEFF rather than the literal character, which is invisible in an editor
    // and would not survive the first person who tidied this line.
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
    window.setStatus?.('Exported CSV');
  }

  function sortCaret(state, k) { return state.sortKey === k ? (state.sortDir > 0 ? '▴' : '▾') : ''; }
  function cmp(a, b) { const na = parseFloat(a), nb = parseFloat(b); if (!isNaN(na) && !isNaN(nb) && String(na) === a && String(nb) === b) return na - nb; return String(a).localeCompare(String(b)); }
  function base(p) { return (p || '').split(/[\\/]/).filter(Boolean).pop() || p; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.TableView = { open };
})();
