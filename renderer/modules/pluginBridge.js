// pluginBridge.js — permissioned host<->plugin bridge.
//
// Plugins run in a locked <iframe sandbox="allow-scripts"> (null origin, no app access).
// This module injects a tiny PluginAPI SDK into that iframe and brokers a small set of
// capabilities over postMessage. Every inbound message is verified to come from a registered
// plugin frame (event.source match), and only manifest-declared permissions are honoured.
(function () {
  const registry = [];   // { win, iframe, manifest, project, schemaFields }

  const THEME_VARS = ['--bg', '--bg-panel', '--bg-dark', '--bg-card', '--bg-card-2', '--line', '--line-2', '--line-3', '--line-4',
    '--text', '--text-2', '--text-3', '--muted', '--muted-2', '--faint', '--accent', '--accent-h', '--green', '--amber', '--red', '--teal', '--purple', '--radius', '--mono'];
  function themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const o = {};
    THEME_VARS.forEach((k) => { o[k] = cs.getPropertyValue(k).trim(); });
    return o;
  }
  // Push the current theme to every live plugin frame (call when the app theme changes).
  function broadcastTheme() {
    const theme = themeVars();
    registry.forEach((r) => { if (r.win && r.iframe.isConnected) { try { r.win.postMessage({ __pn: 'theme', data: theme }, '*'); } catch { /* gone */ } } });
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  // Mount a plugin into a container. ctx = { project, fields, values } (project may be null for standalone).
  // The page is served by the main process over pnplugin:// (its own CSP) so inline plugin scripts run,
  // while sandbox="allow-scripts" (no allow-same-origin) keeps it isolated from the app.
  async function mount(container, plugin, ctx = {}) {
    const iframe = document.createElement('iframe');
    iframe.className = 'plugin-frame';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.src = 'pnplugin://p/?id=' + encodeURIComponent(plugin.id);

    const reg = { win: null, iframe, manifest: plugin, project: ctx.project || null, schemaFields: ctx.fields || [] };
    iframe.addEventListener('load', () => {
      reg.win = iframe.contentWindow;
      registry.push(reg);
      iframe.contentWindow.postMessage({ __pn: 'init', data: { fields: ctx.fields || [], values: ctx.values || {}, projectName: ctx.project?.name || '', theme: themeVars() } }, '*');
    });
    container.appendChild(iframe);
    return iframe;
  }

  // Render board-section contributions for a project (called by the board).
  async function renderBoardSections(host, project, schema) {
    for (let i = registry.length - 1; i >= 0; i--) if (!registry[i].iframe.isConnected) registry.splice(i, 1); // prune dead
    let plugins = [];
    try { plugins = await window.api.listPlugins(); } catch { return; }
    const enabled = await getEnabled();
    const fields = (window.DataValidation.schemaFields(schema) || []).map((f) => ({ key: f.key, label: f.label, type: f.type }));
    const values = project.data || {};

    for (const p of plugins) {
      if (!p.contributes?.boardSection || enabled[p.id] === false) continue;
      const sec = document.createElement('div');
      sec.className = 'section';
      const title = p.contributes.boardSection.title || p.name;
      sec.innerHTML = `<button class="section-head"><span class="chev">${window.ICON.chevDown}</span><span class="s-title">${escHtml(title)}</span><span class="s-count" title="sandboxed plugin">plugin</span></button>
        <div class="section-body" style="display:block;"><div class="plugin-host"></div></div>`;
      sec.querySelector('.section-head').onclick = () => sec.classList.toggle('collapsed');
      host.appendChild(sec);
      mount(sec.querySelector('.plugin-host'), p, { project, fields, values });
    }
  }

  async function getEnabled() {
    try { const c = await window.api.readConfig('plugins.json'); return (c && c.enabled) || {}; }
    catch { return {}; }
  }
  async function setEnabled(id, on) {
    const c = (await window.api.readConfig('plugins.json')) || { enabled: {} };
    c.enabled = c.enabled || {};
    c.enabled[id] = on;
    await window.api.writeConfig('plugins.json', c);
  }

  // ---- single host-side message broker ----
  window.addEventListener('message', async (e) => {
    const reg = registry.find((r) => r.win && r.win === e.source);
    if (!reg) return;                       // not from a known plugin frame -> ignore
    const m = e.data || {};
    if (m.__pn === 'resize') { const h = m.payload?.height; if (h) reg.iframe.style.height = Math.max(40, h + 2) + 'px'; return; }
    if (m.__pn === 'notify') { window.Toast?.info(m.payload?.msg || ''); return; }
    if (m.__pn === 'copy') { try { await navigator.clipboard.writeText(m.payload?.text || ''); window.Toast?.success('Copied to clipboard'); } catch { /* ignore */ } return; }
    if (m.__pn === 'writeField') {
      const { key, value } = m.payload || {};
      const allowed = (reg.manifest.permissions || []).includes('writeField');
      const field = (reg.schemaFields || []).find((f) => f.key === key);
      if (!allowed) return reply(reg, m.id, { ok: false, error: 'permission denied' });
      if (!reg.project || !field) return reply(reg, m.id, { ok: false, error: 'unknown field' });
      try {
        await window.Store.saveProjectData(reg.project.path, { [key]: value });
        reply(reg, m.id, { ok: true });
        window.Toast?.success(`Saved ${field.label} = ${value}`);
        window.ProjectBoard?.refreshForPath?.(reg.project.libraryPath);
      } catch (err) { reply(reg, m.id, { ok: false, error: err.message }); }
    }
  });
  function reply(reg, id, result) { try { reg.win.postMessage({ __pn: 'reply', id, result }, '*'); } catch { /* frame gone */ } }

  window.PluginBridge = { mount, renderBoardSections, getEnabled, setEnabled, broadcastTheme };
})();
