// pluginsView.js — Plugins page. Lists installed plugins and runs them in a sandboxed iframe.
(function () {
  const I = () => window.ICON;
  const COLORS = ['#5b8cff', '#9b6bd4', '#e0a23b', '#5fb87a', '#5fb6c4'];

  async function render(host) {
    const plugins = await window.api.listPlugins();
    const enabled = await window.PluginBridge.getEnabled();
    host.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Plugins</div>
          <div class="page-desc">${I().shield} Every plugin runs in an isolated sandbox — a crash can't take down the app</div>
        </div>
        <div class="head-actions">
          <button class="btn" id="plugFolder">${I().folderBig} Plugins folder</button>
          <button class="btn" id="plugRefresh">${I().refresh} Refresh</button>
        </div>
      </div>
      <div class="page-body" style="padding:20px 28px 40px;">
        <div style="max-width:780px;">
          <div class="section-label">Installed <span style="color:var(--green);background:rgba(95,184,122,.13);border-radius:9px;padding:1px 7px;letter-spacing:0;">${plugins.length} found</span></div>
          <div id="plugList"></div>
        </div>
      </div>`;

    host.querySelector('#plugRefresh').onclick = () => render(host);
    host.querySelector('#plugFolder').onclick = async () => {
      await window.api.openPluginUserDir();
      window.setStatus?.('Opened plugins folder');
    };

    // The bundled plugins dir is read-only in a packaged build, so point people at the
    // user-writable one — that's the only place a third-party plugin can actually be installed.
    const userDir = await window.api.pluginUserDir().catch(() => null);
    const list = host.querySelector('#plugList');
    if (!plugins.length) {
      list.innerHTML = `<div class="empty-hint" style="text-align:left;">No plugins installed. Put a folder (manifest.json + entry script) in
        ${userDir ? `<span class="mono">${escapeHtml(userDir)}</span>` : 'the plugins folder'}, then click Refresh.</div>`;
      return;
    }
    plugins.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'plug-row';
      card.style.flexWrap = 'wrap';
      const on = enabled[p.id] !== false;
      const board = p.contributes?.boardSection;
      const activity = p.contributes?.activity;
      card.innerHTML = `
        <div class="plug-av" style="background:${COLORS[idx % COLORS.length]}">${escapeHtml((p.name[0] || 'P').toUpperCase())}</div>
        <div class="plug-info">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
            <span class="plug-name">${escapeHtml(p.name)}</span>
            <span class="plug-ver">v${escapeHtml(p.version)}</span>
            <span class="sandbox-badge">${I().shield} Sandboxed</span>
            ${board ? `<span class="sandbox-badge" style="color:var(--accent);background:rgba(91,140,255,.12)">⊞ Board section</span>` : ''}
            ${activity ? `<span class="sandbox-badge" style="color:var(--purple);background:rgba(155,107,212,.12)">▤ Activity page</span>` : ''}
            ${(p.permissions || []).map((perm) => `<span class="sandbox-badge" style="color:var(--amber);background:rgba(224,162,59,.12)">${escapeHtml(perm)}</span>`).join('')}
          </div>
          <div class="plug-desc">${escapeHtml(p.description)}</div>
          <div class="plug-by">id: <span class="mono">${escapeHtml(p.id)}</span></div>
        </div>
        <div class="switch ${on ? 'on' : ''}" data-toggle title="Enable / disable"><div class="knob"></div></div>
        <button class="btn primary" data-run>${activity ? 'Open' : 'Run'}</button>
        <div class="sandbox-host" style="flex-basis:100%;" hidden></div>`;
      // An activity plugin already has a page of its own, and running a second copy here would put
      // two live frames on the same plugin storage — last write wins, silently. Send them to the
      // real page instead.
      card.querySelector('[data-run]').onclick = () => {
        if (activity) { if (!on) { window.setStatus?.(`${p.name} is disabled`); return; } window.openActivityPlugin?.(p.id); return; }
        runPlugin(card, p);
      };
      card.querySelector('[data-toggle]').onclick = async (e) => {
        const next = !e.currentTarget.classList.contains('on');
        e.currentTarget.classList.toggle('on', next);
        await window.PluginBridge.setEnabled(p.id, next);
        window.updatePluginStatus?.();          // the status bar counts enabled plugins, not installed
        window.setStatus?.(`${p.name} ${next ? 'enabled' : 'disabled'}`);
      };
      list.appendChild(card);
    });
  }

  // Run a plugin standalone (no project context) through the shared bridge.
  async function runPlugin(card, plugin) {
    const slot = card.querySelector('.sandbox-host');
    slot.hidden = false;
    slot.innerHTML = '';
    await window.PluginBridge.mount(slot, plugin, { project: null, fields: [], values: {} });
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  window.PluginsView = { render };
})();
