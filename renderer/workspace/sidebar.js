// sidebar.js — the right sidebar: a vertical icon rail plus one visible pane at a time.
//
// Mirrors the left ribbon's language (36px buttons, accent pill on the active one) so the two
// edges of the window read as a pair. Panes register themselves at load and are mounted lazily —
// a pane the user never opens costs nothing.
//
// Panes are driven by the 'active-tab-changed' event rather than by per-tab hooks, because they
// live outside the tab and must survive tabs opening, closing and moving between split groups.
// Only the VISIBLE pane is updated; hidden panes would otherwise fire IPC on every tab switch.
(function () {
  const panes = [];          // { id, title, icon, mount, update, host, mounted }
  let activeId = null;
  let collapsed = false;
  let lastCtx = null;
  let changeCb = null;

  const rail = () => document.getElementById('rightbar-rail');
  const panel = () => document.getElementById('rightbar-panel');
  const resizer = () => document.getElementById('rightbar-resizer');

  function register(pane) {
    panes.push({ ...pane, host: null, mounted: false });
    if (document.readyState !== 'loading') renderRail();
  }

  function renderRail() {
    const r = rail(); if (!r) return;
    r.innerHTML = '';
    for (const p of panes) {
      const b = document.createElement('button');
      b.className = 'rb-btn' + (p.id === activeId && !collapsed ? ' active' : '');
      b.title = p.title;
      b.setAttribute('aria-label', p.title);
      b.innerHTML = p.icon || '';
      // Clicking the pane you're already on collapses the sidebar — the same toggle behaviour
      // the ribbon would have if its pages were closable.
      b.onclick = () => { if (p.id === activeId && !collapsed) setCollapsed(true); else show(p.id); };
      r.appendChild(b);
    }
  }

  function show(id) {
    const p = panes.find((x) => x.id === id); if (!p) return;
    activeId = id;
    if (collapsed) setCollapsed(false, true);   // don't fire two change events
    const body = panel()?.querySelector('.rb-body'); if (!body) return;

    for (const other of panes) if (other.host) other.host.hidden = other.id !== id;
    if (!p.host) {
      p.host = document.createElement('div');
      p.host.className = 'rb-pane';
      body.appendChild(p.host);
    }
    p.host.hidden = false;
    if (!p.mounted) { try { p.mount?.(p.host); } catch (e) { console.error(`sidebar pane "${id}" failed to mount`, e); } p.mounted = true; }

    const title = panel()?.querySelector('.rb-title-text');
    if (title) title.textContent = p.title;
    renderRail();
    update(lastCtx);
    fireChange();
  }

  function setCollapsed(val, quiet = false) {
    collapsed = !!val;
    const pl = panel(), rz = resizer();
    if (pl) pl.hidden = collapsed;
    if (rz) rz.hidden = collapsed;
    renderRail();
    if (!collapsed) update(lastCtx);   // it may have gone stale while hidden
    if (!quiet) fireChange();
  }

  // Push context into the visible pane only.
  function update(ctx) {
    lastCtx = ctx || null;
    if (collapsed) return;
    const p = panes.find((x) => x.id === activeId);
    if (!p || !p.mounted) return;
    try { p.update?.(lastCtx, p.host); } catch (e) { console.error(`sidebar pane "${p.id}" failed to update`, e); }
  }

  // ---------- width ----------
  function wireResizer() {
    const rz = resizer(), pl = panel();
    if (!rz || !pl) return;
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = pl.getBoundingClientRect().width;
      // Dragging right shrinks this panel, so the delta is inverted relative to the left one.
      const move = (ev) => { pl.style.width = Math.max(180, Math.min(560, startW - (ev.clientX - startX))) + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.body.style.cursor = ''; fireChange();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
    });
  }

  // ---------- layout persistence ----------
  function onChange(cb) { changeCb = cb; }
  function fireChange() { try { changeCb && changeCb(); } catch { /* ignore */ } }

  function getLayout() {
    const pl = panel();
    return {
      width: pl ? Math.round(pl.getBoundingClientRect().width) : null,
      collapsed,
      activePane: activeId,
    };
  }
  function applyLayout(l) {
    if (!l) return;
    const pl = panel();
    if (pl && Number.isFinite(l.width)) pl.style.width = Math.max(180, Math.min(560, l.width)) + 'px';
    // A pane recorded from an older build may no longer exist; fall back to the first.
    const wanted = panes.some((p) => p.id === l.activePane) ? l.activePane : panes[0]?.id;
    if (wanted) show(wanted);
    setCollapsed(l.collapsed !== false ? !!l.collapsed : false, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderRail();
    wireResizer();
    const btn = document.getElementById('rbCollapse');
    if (btn) { btn.innerHTML = window.ICON.collapse; btn.onclick = () => setCollapsed(true); }
    if (!activeId && panes.length) show(panes[0].id);
    window.Events?.on('active-tab-changed', update);
  });

  window.Sidebar = { register, show, setCollapsed, isCollapsed: () => collapsed, getLayout, applyLayout, onChange };
})();
