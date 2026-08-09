// app.js — bootstrap: ribbon pages, grouped project panel, tab behaviours, shortcuts, resizers.
(function () {
  const $ = (s) => document.querySelector(s);
  const basename = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  let searchTerm = '';

  function setStatus(msg) { const el = $('#statusMsg'); if (el) el.textContent = msg; }
  window.setStatus = setStatus;

  // Custom properties repaint on their own; the old display:none/reflow hack just caused a
  // full-page flash (and forced every iframe to re-layout) on each toggle.
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }
  function toggleTheme() {
    const next = (window.Store.state.settings.theme === 'light') ? 'dark' : 'light';
    window.Store.state.settings.theme = next;
    applyTheme(next);
    window.Store.saveSettings();
    window.PluginBridge?.broadcastTheme?.();   // keep plugin frames in sync with the theme
  }

  // ---------- ribbon / pages ----------
  const PAGE_RENDER = {
    schema: () => window.SchemaEditor.render($('#page-schema')),
    plugins: () => window.PluginsView.render($('#page-plugins')),
    storage: () => window.StorageView.render($('#page-storage')),
    settings: () => window.SettingsView.render($('#page-settings')),
  };
  function showPage(page) {
    // 'settings' used to alias 'storage', so the ribbon carried two buttons that opened the same
    // page. Settings is now appearance — where data lives stays on Storage.
    // Clicking Workspace while already on it — and with the panel hidden — brings it back.
    // Without this the collapse button would be a one-way door.
    if (page === 'workspace' && !$('#page-workspace').hidden && leftCollapsed) setLeftCollapsed(false);
    document.querySelectorAll('.ribbon-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== `page-${page}`; });
    if (PAGE_RENDER[page]) PAGE_RENDER[page]();
  }

  // ---------- project panel ----------
  function projectDot(p) {
    if (!p.hasMetadata) return 'var(--muted-2)';     // not set up
    if (p.complete === false) return 'var(--amber)'; // has data but missing required
    return 'var(--green)';                           // complete
  }
  function projectMeta(p) {
    if (!p.hasMetadata) return 'not set up';
    if (p.complete === false) return 'incomplete';
    return 'configured';
  }

  function renderProjectPanel() {
    const { groups, activeProjectPath } = window.Store.state;
    const host = $('#projectGroups');
    const empty = $('#projectEmpty');
    host.innerHTML = '';
    empty.style.display = groups.length ? 'none' : 'block';
    const term = searchTerm.trim().toLowerCase();

    groups.forEach((g) => {
      const matches = g.projects.filter((p) => !term || p.name.toLowerCase().includes(term));
      if (term && matches.length === 0) return;
      const group = document.createElement('div');
      group.className = 'path-group' + (g.collapsed ? ' collapsed' : '');

      const header = document.createElement('button');
      header.className = 'path-header';
      header.title = g.path;
      header.innerHTML = `<span class="chev">${window.ICON.chevDown}</span><span class="folder-ico">${window.ICON.folder}</span><span class="path-name">${escapeHtml(basename(g.path))}</span><span class="path-count">${matches.length}</span><span class="path-table" title="Open table view">⊞</span>`;
      header.onclick = () => window.Store.toggleGroupCollapsed(g.path);
      header.querySelector('.path-table').onclick = (e) => { e.stopPropagation(); window.TableView.open(g.path); };
      group.appendChild(header);

      const body = document.createElement('div');
      body.className = 'path-body';
      if (matches.length === 0) body.innerHTML = `<div class="empty-hint" style="padding:10px;font-size:11px;">No project folders found here.</div>`;
      else matches.forEach((p) => {
        const item = document.createElement('button');
        item.className = 'project-item' + (p.path === activeProjectPath ? ' active' : '');
        item.innerHTML = `<span class="pdot" style="background:${projectDot(p)}"></span><span class="pinfo"><span class="pname"></span><span class="pmeta"></span></span>`;
        item.querySelector('.pname').textContent = p.name;
        item.querySelector('.pmeta').textContent = projectMeta(p);
        item.onclick = () => openProject(p);                              // reuse active tab (Obsidian)
        item.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openProject(p, { newTab: true }); } }); // middle => new tab
        item.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e, p); });
        body.appendChild(item);
      });
      group.appendChild(body);
      host.appendChild(group);
    });

    const count = window.Store.projectCount();
    $('#footCount').textContent = count + (count === 1 ? ' project' : ' projects');
  }

  function openProject(project, opts = {}) {
    showPage('workspace');
    window.Store.setActive(project.path);
    $('#tbActiveProject').textContent = project.name;
    window.Tabs.open({
      id: 'project:' + project.path,
      title: project.name,
      icon: window.ICON.boardTab,
      newTab: !!opts.newTab,
      toSide: !!opts.toSide,
      // No note here, but the Tags pane is project-scoped and still has something to show.
      context: { kind: 'project', project },
      // `tab` is passed through so the board can register a destroy hook and flush its pending
      // field autosave — see ProjectBoard.render.
      render: (pane, tab) => window.ProjectBoard.render(pane, project, tab),
    });
    $('#statusMid').textContent = project.name + ' · main';
  }

  // ---------- context menu ----------
  function showContextMenu(e, project) {
    document.querySelectorAll('.context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      <button data-act="open">Open</button>
      <button data-act="newtab">Open in new tab</button>
      <button data-act="side">Open to the right</button>
      <button data-act="reveal">Copy path</button>`;
    document.body.appendChild(menu);
    menu.querySelector('[data-act="open"]').onclick = () => { openProject(project); menu.remove(); };
    menu.querySelector('[data-act="newtab"]').onclick = () => { openProject(project, { newTab: true }); menu.remove(); };
    menu.querySelector('[data-act="side"]').onclick = () => { openProject(project, { toSide: true }); menu.remove(); };
    menu.querySelector('[data-act="reveal"]').onclick = () => { navigator.clipboard.writeText(project.path); setStatus('Path copied'); menu.remove(); };
    const dismiss = (ev) => { if (ev && menu.contains(ev.target)) return; menu.remove(); document.removeEventListener('mousedown', dismiss); };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  // ---------- actions ----------
  async function rescan() { setStatus('Scanning library folders…'); await window.Store.rescan(); setStatus('All changes saved'); }

  // Focus the project filter without discarding what the user already typed there.
  function focusSearch() {
    showPage('workspace');
    const s = $('#projectSearch');
    s.focus();
    s.select();
  }

  // ---------- custom title bar ----------
  // The window is frameless, so minimise/maximise/close live here. The ☰ button pops the native
  // application menu, which is otherwise hidden (Alt also works).
  const MAX_GLYPH = '';       // restore-down / maximise glyphs from the Segoe icon fonts
  const RESTORE_GLYPH = '';

  async function wireTitlebar() {
    const maxBtn = $('#winMax');
    const setMaxGlyph = (maximized) => {
      if (!maxBtn) return;
      maxBtn.textContent = maximized ? RESTORE_GLYPH : MAX_GLYPH;
      maxBtn.title = maximized ? 'Restore' : 'Maximise';
      maxBtn.setAttribute('aria-label', maxBtn.title);
    };

    // mousedown, not click: the mouseup that completes a click lands on the freshly-opened
    // native menu and dismisses it again, so the menu appears never to open at all.
    $('#menuBtn')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      window.api.popupMenu(r.left, r.bottom);      // drop it under the button
    });
    $('#winMin')?.addEventListener('click', () => window.api.windowMinimize());
    maxBtn?.addEventListener('click', async () => setMaxGlyph(await window.api.windowToggleMaximize()));
    $('#winClose')?.addEventListener('click', () => window.api.windowClose());

    // Double-clicking the bar itself toggles maximise, as a native title bar does.
    $('#titlebar')?.addEventListener('dblclick', async (e) => {
      if (e.target.closest('.tb-btn')) return;
      setMaxGlyph(await window.api.windowToggleMaximize());
    });

    window.api.onWindowState(({ maximized }) => setMaxGlyph(maximized));
    try {
      document.documentElement.setAttribute('data-platform', await window.api.platform());
      setMaxGlyph(await window.api.windowIsMaximized());
    } catch { /* leave defaults */ }
  }

  // ---------- left panel: resize + collapse ----------
  let leftCollapsed = false;

  function setLeftCollapsed(val) {
    leftCollapsed = !!val;
    $('#projectpanel').hidden = leftCollapsed;
    $('#panel-resizer').hidden = leftCollapsed;
    // The ribbon button doubles as the way back, so reflect the state on it.
    const btn = document.querySelector('.ribbon-btn[data-page="workspace"]');
    if (btn) btn.title = leftCollapsed ? 'Show project panel' : 'Workspace';
    saveSession();
  }
  function toggleLeftCollapsed() { setLeftCollapsed(!leftCollapsed); }

  function wireResizer() {
    const rz = $('#panel-resizer');
    const panel = $('#projectpanel');
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = panel.getBoundingClientRect().width;
      const move = (ev) => { panel.style.width = Math.max(180, Math.min(520, startW + (ev.clientX - startX))) + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.body.style.cursor = ''; saveSession();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
    });
    // Double-clicking the resizer collapses, the way dragging it to zero would in an editor.
    rz.addEventListener('dblclick', toggleLeftCollapsed);
    $('#panelCollapse')?.addEventListener('click', () => setLeftCollapsed(true));
  }

  // ---------- wiring ----------
  function wire() {
    document.querySelectorAll('.ribbon-btn').forEach((btn) => btn.addEventListener('click', () => { if (btn.dataset.page) showPage(btn.dataset.page); }));
    $('#rescanBtn').addEventListener('click', rescan);
    $('#projectSearch').addEventListener('input', (e) => { searchTerm = e.target.value; renderProjectPanel(); });
    $('#themeToggle')?.addEventListener('click', toggleTheme);

    wireTitlebar();

    setRibbonIcon('workspace', window.ICON.board);
    setRibbonIcon('schema', window.ICON.schema);
    setRibbonIcon('plugins', window.ICON.plugin);
    setRibbonIcon('storage', window.ICON.storage);
    setRibbonIcon('settings', window.ICON.gear);
    const pc = $('#panelCollapse'); if (pc) pc.innerHTML = window.ICON.collapse;

    window.api.onMenu('menu:open-folder', () => showPage('storage'));
    window.api.onMenu('menu:scan-folder', rescan);
    window.api.onMenu('menu:open-schema', () => showPage('schema'));
    window.api.onMenu('menu:open-plugins', () => showPage('plugins'));

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const el = document.activeElement;
      const editing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      // None of these may fire while the user is typing — Ctrl+F used to yank you out of a
      // note and wipe the project filter mid-sentence.
      //
      // This guard is now load-bearing for undo, not just a convenience. CodeMirror's content is
      // contenteditable, so `editing` is true whenever the note editor has focus — which is
      // exactly the boundary we want: CodeMirror's own history owns Ctrl+Z inside the editor,
      // app-level undo (destructive actions: deleted notes, fields, sections) owns it everywhere
      // else. Don't narrow this check to INPUT/TEXTAREA without replacing that split.
      // Ctrl/Cmd+P is the exception: it opens a modal over whatever you were doing rather than
      // stealing your text, so blocking it inside the editor just made the app's main navigation
      // unreachable from the place you spend most of your time. Obsidian allows it too.
      if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); window.QuickSwitcher.open(); return; }
      if (editing) return;
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); }            // filter project list
      else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); window.Undo.run(); } // app-level undo
    });

    // let the quick switcher open project boards
    window.openProjectFromSwitcher = (project, opts) => openProject(project, opts);

    wireResizer();
    window.Store.subscribe(renderProjectPanel);
    window.Tabs.onChange(saveSession);       // persist open tabs for session restore
    window.Sidebar?.onChange?.(saveSession); // …and the right sidebar's width / active pane
  }

  // ---------- session restore ----------
  function parseTabId(id) {
    if (id.startsWith('project:')) return { kind: 'project', projectPath: id.slice(8) };
    if (id.startsWith('note:')) { const rest = id.slice(5); const i = rest.lastIndexOf(':'); return { kind: 'note', projectPath: rest.slice(0, i), noteName: rest.slice(i + 1) }; }
    return null;
  }
  function currentLayout() {
    const panel = $('#projectpanel');
    return {
      left: { width: Math.round(panel.getBoundingClientRect().width) || null, collapsed: leftCollapsed },
      right: window.Sidebar?.getLayout?.() || null,
      splitDir: window.Tabs.getSplitDir(),
    };
  }
  const writeSession = () => window.api.writeConfig('session.json', { tabs: window.Tabs.serialize(), layout: currentLayout() }).catch(() => {});
  const saveSession = debounce(writeSession, 600);
  // Quitting inside the 600 ms window dropped the layout change that triggered it — open a tab,
  // close the app, and the tab wasn't there next time. Tabs.flushAll already runs on beforeunload
  // for the same reason; this is the session's half of it.
  window.addEventListener('beforeunload', () => { saveSession.cancel(); writeSession(); });

  function applyLayout(l) {
    if (!l) return;
    // Width first, then collapsed — restoring collapsed hides the panel, and measuring a hidden
    // element to re-apply its width afterwards gives zero.
    if (Number.isFinite(l.left?.width)) $('#projectpanel').style.width = Math.max(180, Math.min(520, l.left.width)) + 'px';
    if (l.left?.collapsed) setLeftCollapsed(true);
    window.Sidebar?.applyLayout?.(l.right);
    // Set before tabs are restored so the split groups are created along the right axis.
    if (l.splitDir) window.Tabs.setSplitDir(l.splitDir);
  }

  async function restoreSession() {
    let s; try { s = await window.api.readConfig('session.json'); } catch { return; }
    applyLayout(s?.layout);              // layout is restored even if no tabs were open
    if (!s?.tabs?.length) return;
    let activeId = null;

    // Tabs are serialized with the index of the split group they were in. Restore that layout:
    // the first tab of each new group opens "to the side", the rest join it.
    const byGroup = new Map();
    for (const t of s.tabs) {
      const g = Number.isInteger(t.group) ? t.group : 0;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(t);
    }

    // A note that was renamed or deleted since last run must not come back as a phantom empty
    // tab under its old name. Check what actually exists first (one listing per project).
    const notesByProject = new Map();
    for (const t of s.tabs) {
      const parsed = parseTabId(t.id);
      if (parsed?.kind !== 'note' || notesByProject.has(parsed.projectPath)) continue;
      try { notesByProject.set(parsed.projectPath, await window.api.listNotes(parsed.projectPath)); }
      catch { notesByProject.set(parsed.projectPath, []); }
    }

    let firstGroup = true;
    for (const g of [...byGroup.keys()].sort((a, b) => a - b)) {
      let firstInGroup = true;
      for (const t of byGroup.get(g)) {
        const parsed = parseTabId(t.id); if (!parsed) continue;
        const project = window.Store.getProject(parsed.projectPath); if (!project) continue;
        if (parsed.kind === 'note' && !(notesByProject.get(parsed.projectPath) || []).includes(parsed.noteName)) continue;
        // toSide only for the first tab of each group after the first — that creates the split.
        const opts = { newTab: true, toSide: !firstGroup && firstInGroup };
        if (parsed.kind === 'project') openProject(project, opts);
        else window.NotesView.open(project, parsed.noteName, opts);
        if (t.pinned) window.Tabs.pin(t.id);
        if (t.active) activeId = t.id;
        firstInGroup = false;
      }
      firstGroup = false;
    }
    if (activeId) window.Tabs.focus(activeId);
  }
  function debounce(fn, ms) {
    let t = null;
    const f = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
    f.cancel = () => { clearTimeout(t); t = null; };
    return f;
  }

  function setRibbonIcon(page, svg) { const b = document.querySelector(`.ribbon-btn[data-page="${page}"]`); if (b) b.innerHTML = svg; }

  // "N plugins active" counted everything INSTALLED, so disabling one changed nothing in the
  // status bar — the one place that claims to tell you what's running.
  async function updatePluginStatus() {
    try {
      const plugins = await window.api.listPlugins();
      const enabled = await window.PluginBridge.getEnabled();
      const n = plugins.filter((p) => enabled[p.id] !== false).length;   // absent means enabled
      $('#statusPlugins').textContent = `${n} ${n === 1 ? 'plugin' : 'plugins'} active`;
    } catch { /* noop */ }
  }
  window.updatePluginStatus = updatePluginStatus;   // the Plugins page re-runs it after a toggle
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  async function boot() {
    wire();
    window.FsWatch.start();          // react to project data changed outside the app
    await window.Store.loadConfig();
    applyTheme(window.Store.state.settings.theme);
    // Appearance before the first note paints, or the editor renders at the default size and
    // visibly jumps. The user stylesheet is deliberately not awaited — it's cosmetic, and a slow
    // or missing file must not hold up the app.
    window.SettingsView.apply();
    window.SettingsView.loadUserCss().catch(() => {});
    await window.Store.rescan();
    renderProjectPanel();
    updatePluginStatus();
    await restoreSession();
    setStatus('All changes saved');
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
