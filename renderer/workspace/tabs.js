// tabs.js — Obsidian-style multi-group tabbed area.
//  - Click a file => opens in the ACTIVE group's active tab (reuses it). If already open, focuses it.
//  - Pinned tabs are never reused/replaced.
//  - New tab via middle-click / "Open in new tab"; "Open to the right" opens in a split group.
//  - Drag a tab: reorder within its bar, move to another group, or drop on the split zone to split.
(function () {
  let groups = [];
  let activeGroup = null;
  const tabIndex = new Map();          // id -> tab  ({id,title,icon,render,pinned,tabEl,paneEl,group})
  const MAX_GROUPS = 3;
  // Groups are a flat list laid out along one axis, not a nested tree: dropping on the right
  // edge lays them out in a row, on the bottom edge in a column, and the choice applies to the
  // whole workspace. That covers side-by-side and stacked without the bookkeeping a tree needs.
  let splitDir = 'row';
  let splitZones = [];

  const container = () => document.getElementById('tabgroups');
  const welcome = () => document.getElementById('welcomePane');

  function uid() { return 'g' + Math.random().toString(36).slice(2, 8); }
  function totalTabs() { return groups.reduce((n, g) => n + g.tabs.length, 0); }
  function syncWelcome() { const w = welcome(); if (w) w.hidden = totalTabs() > 0; }

  // ---------- groups ----------
  function createGroup() {
    const el = document.createElement('div'); el.className = 'tabgroup';
    const strip = document.createElement('div'); strip.className = 'tabstrip';
    strip.setAttribute('role', 'tablist');
    const panes = document.createElement('div'); panes.className = 'tabpanes';
    el.appendChild(strip); el.appendChild(panes);
    const group = { id: uid(), el, stripEl: strip, panesEl: panes, tabs: [], activeId: null };

    strip.addEventListener('dragover', (e) => { e.preventDefault(); });
    strip.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/tab');
      if (id) dropInto(id, group, e.clientX);
    });
    el.addEventListener('mousedown', () => { activeGroup = group; });

    groups.push(group);
    relayout();
    return group;
  }

  function removeGroup(group) {
    if (groups.length <= 1) return;
    group.el.remove();
    groups = groups.filter((g) => g !== group);
    if (activeGroup === group) activeGroup = groups[groups.length - 1];
    relayout();
  }

  function relayout() {
    const c = container();
    c.querySelectorAll('.group-resizer').forEach((r) => r.remove());
    c.style.flexDirection = splitDir;
    c.classList.toggle('stacked', splitDir === 'column');
    groups.forEach((g, i) => { c.appendChild(g.el); if (i < groups.length - 1) c.appendChild(makeResizer(g, groups[i + 1])); });
  }

  // One resizer, two axes. The only differences are which coordinate and which dimension to
  // read, so they're picked up front rather than branching inside the mousemove.
  function makeResizer(first, second) {
    const vertical = splitDir === 'column';
    const r = document.createElement('div');
    r.className = 'group-resizer' + (vertical ? ' vertical' : '');
    r.addEventListener('mousedown', (e) => {
      const start = vertical ? e.clientY : e.clientX;
      const size = (g) => (vertical ? g.el.getBoundingClientRect().height : g.el.getBoundingClientRect().width);
      const a = size(first), total = a + size(second);
      const move = (ev) => {
        const delta = (vertical ? ev.clientY : ev.clientX) - start;
        const na = Math.max(120, Math.min(total - 120, a + delta));
        first.el.style.flex = `0 0 ${na}px`;
        second.el.style.flex = '1 1 0';
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.body.style.cursor = ''; fireChange();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    });
    return r;
  }

  // ---------- open ----------
  function open({ id, title, icon, render, context = null, newTab = false, toSide = false, pinned = false }) {
    if (tabIndex.has(id)) { const t = tabIndex.get(id); activeGroup = t.group; activate(t.group, id); return t; }
    if (!groups.length) activeGroup = createGroup();

    let group = activeGroup || groups[0];
    if (toSide) { group = sideGroup(group); newTab = true; }

    // Obsidian reuse: replace the active (unpinned) tab in place unless a new tab is requested.
    if (!newTab && group.activeId) {
      const active = tabIndex.get(group.activeId);
      if (active && !active.pinned) { rebind(active, { id, title, icon, render, context }); return active; }
    }
    return createTab(group, { id, title, icon, render, context, pinned });
  }

  function sideGroup(from) {
    const idx = groups.indexOf(from);
    if (groups[idx + 1]) return groups[idx + 1];
    if (groups.length >= MAX_GROUPS) return groups[idx]; // cap reached
    return createGroup();
  }

  function createTab(group, { id, title, icon, render, context, pinned }) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (pinned ? ' pinned' : '');
    tabEl.draggable = true;
    tabEl.setAttribute('role', 'tab');
    tabEl.tabIndex = 0;                       // reachable by keyboard
    tabEl.innerHTML = `<span class="pin" title="Pinned">📌</span><span class="tab-ico" aria-hidden="true">${icon || ''}</span><span class="ttl"></span><button class="close" aria-label="Close tab" title="Close">✕</button>`;
    tabEl.querySelector('.ttl').textContent = title;

    const tab = { id, title, icon, render, pinned, context: context || null, tabEl, paneEl: null, group };
    tabEl._tab = tab;

    tabEl.addEventListener('click', () => { activeGroup = tab.group; activate(tab.group, tab.id); });
    // Keyboard: Enter/Space focuses the tab, arrows move along the strip, Delete closes it.
    tabEl.addEventListener('keydown', (e) => {
      const siblings = tab.group.tabs;
      const i = siblings.indexOf(tab);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activeGroup = tab.group; activate(tab.group, tab.id); }
      else if (e.key === 'ArrowRight' && siblings[i + 1]) { e.preventDefault(); siblings[i + 1].tabEl.focus(); }
      else if (e.key === 'ArrowLeft' && siblings[i - 1]) { e.preventDefault(); siblings[i - 1].tabEl.focus(); }
      else if (e.key === 'Delete') { e.preventDefault(); close(tab.id); }
    });
    tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); close(tab.id); } });
    tabEl.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(e, tab); });
    tabEl.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); close(tab.id); });
    tabEl.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/tab', tab.id); tabEl.classList.add('dragging'); showSplitZone(); });
    tabEl.addEventListener('dragend', () => { tabEl.classList.remove('dragging'); hideSplitZone(); });

    const paneEl = document.createElement('div'); paneEl.className = 'pane'; paneEl.hidden = true;
    paneEl.setAttribute('role', 'tabpanel');
    tab.paneEl = paneEl;

    group.stripEl.appendChild(tabEl);
    group.panesEl.appendChild(paneEl);
    group.tabs.push(tab);
    tabIndex.set(id, tab);

    syncWelcome();
    // Activate BEFORE rendering: content measured while the pane is hidden reports zero size,
    // which left plugin iframes collapsed on first mount.
    activate(group, id);
    if (typeof render === 'function') render(paneEl, tab);
    fireChange();
    return tab;
  }

  // Replace a tab's content in place (Obsidian "open in active tab").
  function rebind(tab, { id, title, icon, render, context }) {
    runDestroyHook(tab);          // the outgoing content may have unsaved work
    tabIndex.delete(tab.id);
    tab.id = id; tab.title = title; tab.icon = icon; tab.render = render; tab.context = context || null;
    tab.tabEl.querySelector('.ttl').textContent = title;
    tab.tabEl.querySelector('.tab-ico').innerHTML = icon || '';
    tabIndex.set(id, tab);
    window.ProjectBoard?.unmount?.(tab.paneEl);   // drop stale board registration
    tab.paneEl.innerHTML = '';
    activate(tab.group, id);                      // visible before render (see createTab)
    if (typeof render === 'function') render(tab.paneEl, tab);
  }

  function activate(group, id) {
    if (!tabIndex.has(id)) return;
    group.activeId = id;
    group.tabs.forEach((t) => {
      const on = t.id === id;
      t.tabEl.classList.toggle('active', on);
      t.tabEl.setAttribute('aria-selected', String(on));
      t.paneEl.hidden = !on;
    });
    // Panes aren't re-rendered when you switch back to them, so anything derived from other
    // files (backlinks, note lists) would show whatever was true when the tab was first opened.
    const tab = tabIndex.get(id);
    try { tab.onActivate?.(); } catch (e) { console.error('tab onActivate failed', e); }
    emitActive();
  }

  // Tell the right sidebar which tab is in front. Deliberately not deduplicated: re-activating
  // the same tab is exactly the "came back to the front" signal panes need in order to recompute
  // from other files, same reason onActivate exists.
  function emitActive() {
    const tab = activeGroup?.activeId ? tabIndex.get(activeGroup.activeId) : null;
    window.Events?.emit('active-tab-changed', tab ? { id: tab.id, ...(tab.context || {}) } : null);
  }

  // A pane learns things about itself only after it renders (a note's textarea, for one), so it
  // can top up its context afterwards. Merges rather than replaces.
  function updateContext(id, patch) {
    const t = tabIndex.get(id); if (!t) return;
    t.context = { ...(t.context || {}), ...(patch || {}) };
    if (activeGroup?.activeId === id) emitActive();
  }

  function setPinned(tab, val) { tab.pinned = val; tab.tabEl.classList.toggle('pinned', val); fireChange(); }

  // Panes may hold debounced unsaved work (note autosave). Give them a chance to flush
  // before the DOM goes away, or the last few keystrokes are lost.
  function runDestroyHook(tab) {
    try { tab.onDestroy?.(); } catch (e) { console.error('tab onDestroy failed', e); }
    tab.onDestroy = null;
  }

  function destroy(tab) {
    runDestroyHook(tab);
    window.ProjectBoard?.unmount?.(tab.paneEl);
    tab.tabEl.remove(); tab.paneEl.remove();
    tab.group.tabs = tab.group.tabs.filter((t) => t !== tab);
    tabIndex.delete(tab.id);
  }

  // Flush every open tab (window close / quit).
  function flushAll() { tabIndex.forEach(runDestroyHook); }

  function close(id) {
    const tab = tabIndex.get(id); if (!tab) return;
    const group = tab.group;
    const wasActive = group.activeId === id;
    destroy(tab);
    if (wasActive) { const last = group.tabs[group.tabs.length - 1]; if (last) activate(group, last.id); else group.activeId = null; }
    if (group.tabs.length === 0) removeGroup(group);
    syncWelcome();
    fireChange();
    emitActive();   // closing the last tab has to clear the sidebar, and activate() won't run
  }

  function closeOthers(keep) {
    [...keep.group.tabs].forEach((t) => { if (t !== keep) destroy(t); });
    activate(keep.group, keep.id);
    syncWelcome();
    fireChange();          // otherwise session.json keeps tabs that are already gone
  }

  // ---------- drag: reorder within bar / move across groups ----------
  function dropInto(id, targetGroup, clientX) {
    const tab = tabIndex.get(id); if (!tab) return;
    const beforeEl = insertionRef(targetGroup, clientX, tab.tabEl);
    const src = tab.group;

    targetGroup.stripEl.insertBefore(tab.tabEl, beforeEl);
    if (tab.paneEl.parentElement !== targetGroup.panesEl) targetGroup.panesEl.appendChild(tab.paneEl);
    tab.group = targetGroup;
    // Both strips are re-read from the DOM: the source lost a tab, the target gained one. When
    // they're the same group that's one call, which is why this isn't branched.
    rebuildOrder(src);
    if (src !== targetGroup) rebuildOrder(targetGroup);

    if (src !== targetGroup && src.activeId === id) { const last = src.tabs[src.tabs.length - 1]; src.activeId = last ? last.id : null; if (last) activate(src, last.id); }
    activeGroup = targetGroup;
    activate(targetGroup, id);
    if (src !== targetGroup && src.tabs.length === 0) removeGroup(src);
    fireChange();
  }

  function insertionRef(group, clientX, draggingEl) {
    const tabsEls = [...group.stripEl.querySelectorAll('.tab')].filter((el) => el !== draggingEl);
    for (const el of tabsEls) { const r = el.getBoundingClientRect(); if (clientX < r.left + r.width / 2) return el; }
    return null;
  }
  function rebuildOrder(group) { group.tabs = [...group.stripEl.querySelectorAll('.tab')].map((el) => el._tab).filter(Boolean); }

  // ---------- split zones ----------
  // Two drop targets while dragging: the right edge splits side-by-side, the bottom edge stacks.
  // The one you drop on decides the layout axis for the whole workspace.
  const ZONES = [
    { dir: 'row', cls: 'split-right', label: 'Split →' },
    { dir: 'column', cls: 'split-down', label: 'Split ↓' },
  ];

  function showSplitZone() {
    if (groups.length >= MAX_GROUPS) return;
    if (!splitZones.length) {
      splitZones = ZONES.map((z) => {
        const el = document.createElement('div');
        el.className = `split-zone ${z.cls}`;
        el.innerHTML = `<span>${z.label}</span>`;
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
        el.addEventListener('dragleave', () => el.classList.remove('over'));
        el.addEventListener('drop', (e) => {
          e.preventDefault(); el.classList.remove('over');
          const id = e.dataTransfer.getData('text/tab'); if (!id) return;
          splitDir = z.dir;
          const g2 = createGroup();     // createGroup relayouts, picking up the new direction
          dropInto(id, g2, Infinity);
          hideSplitZone();
        });
        return el;
      });
    }
    splitZones.forEach((el) => container().appendChild(el));
  }
  function hideSplitZone() { splitZones.forEach((el) => el.remove()); }

  // ---------- tab context menu ----------
  function tabMenu(e, tab) {
    document.querySelectorAll('.context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      <button data-a="pin">${tab.pinned ? 'Unpin' : 'Pin'}</button>
      <button data-a="side">Open to the right</button>
      <button data-a="close">Close</button>
      <button data-a="others">Close others</button>`;
    document.body.appendChild(menu);
    const close = (ev) => { if (ev && menu.contains(ev.target)) return; menu.remove(); document.removeEventListener('mousedown', close); };
    menu.querySelector('[data-a="pin"]').onclick = () => { setPinned(tab, !tab.pinned); close(); };
    menu.querySelector('[data-a="side"]').onclick = () => { const g = sideGroup(tab.group); if (g !== tab.group) dropInto(tab.id, g, Infinity); close(); };
    menu.querySelector('[data-a="close"]').onclick = () => { close(); window.Tabs.close(tab.id); };
    menu.querySelector('[data-a="others"]').onclick = () => { closeOthers(tab); close(); };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  // ---------- accessors ----------
  function getPane(id) { return tabIndex.get(id)?.paneEl || null; }
  function has(id) { return tabIndex.has(id); }
  function setTitle(id, title) { const t = tabIndex.get(id); if (t) { t.title = title; t.tabEl.querySelector('.ttl').textContent = title; } }
  function pin(id) { const t = tabIndex.get(id); if (t) setPinned(t, true); }
  function focus(id) { const t = tabIndex.get(id); if (t) { activeGroup = t.group; activate(t.group, id); } }

  // ---------- session persistence ----------
  let changeCb = null;
  function onChange(cb) { changeCb = cb; }
  function fireChange() { try { changeCb && changeCb(); } catch { /* ignore */ } }
  function serialize() {
    const out = [];
    groups.forEach((g, gi) => g.tabs.forEach((t) => out.push({ id: t.id, pinned: !!t.pinned, active: g.activeId === t.id, group: gi })));
    return out;
  }
  function getSplitDir() { return splitDir; }
  function setSplitDir(dir) {
    const next = dir === 'column' ? 'column' : 'row';
    if (next === splitDir) return;
    splitDir = next;
    if (groups.length) relayout();
  }

  // change a tab's id (used when a note is renamed and its id encodes the name)
  function rekey(oldId, newId, newTitle) {
    const t = tabIndex.get(oldId); if (!t) return;
    tabIndex.delete(oldId); t.id = newId; tabIndex.set(newId, t);
    if (t.group.activeId === oldId) t.group.activeId = newId;
    if (newTitle != null) setTitle(newId, newTitle);
    fireChange();   // the id encodes the note name — without this the session keeps the old one
  }

  // Let a pane register work to flush when its tab is closed, replaced, or the app quits.
  function setDestroyHook(id, fn) { const t = tabIndex.get(id); if (t) t.onDestroy = fn; }
  // …and work to redo whenever the tab is brought back to the front.
  function setActivateHook(id, fn) { const t = tabIndex.get(id); if (t) t.onActivate = fn; }

  document.addEventListener('DOMContentLoaded', () => { if (!groups.length) { activeGroup = createGroup(); syncWelcome(); } });
  window.addEventListener('beforeunload', flushAll);

  window.Tabs = { open, close, has, getPane, setTitle, rekey, pin, focus, onChange, serialize, setDestroyHook, setActivateHook, flushAll, updateContext, emitActive, getSplitDir, setSplitDir };
})();
