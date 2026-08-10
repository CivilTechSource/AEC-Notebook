// pluginBridge.js — permissioned host<->plugin bridge.
//
// Plugins run in a locked <iframe sandbox="allow-scripts"> (null origin, no app access).
// This module injects a tiny PluginAPI SDK into that iframe and brokers a small set of
// capabilities over postMessage. Every inbound message is verified to come from a registered
// plugin frame (event.source match), and only manifest-declared permissions are honoured.
(function () {
  const registry = [];   // { win, iframe, manifest, project, schemaFields }

  // Which tokens cross into plugin frames is decided in src/shared/theme.js — see the note there
  // about this list having previously existed in three places.
  const THEME_VARS = window.Theme.MIRRORED;
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
  function basename(p) { return String(p ?? '').split(/[\\/]/).filter(Boolean).pop() || ''; }

  // Mount a plugin into a container. ctx = { project, fields, values } (project may be null for standalone).
  // The page is served by the main process over pnplugin:// (its own CSP) so inline plugin scripts run,
  // while sandbox="allow-scripts" (no allow-same-origin) keeps it isolated from the app.
  //
  // opts.fill mounts the frame at the container's full height instead of growing it to fit the
  // content — for a plugin that owns a whole page (contributes.activity) rather than a board section.
  async function mount(container, plugin, ctx = {}, opts = {}) {
    const iframe = document.createElement('iframe');
    iframe.className = 'plugin-frame' + (opts.fill ? ' plugin-frame--fill' : '');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.src = 'pnplugin://p/?id=' + encodeURIComponent(plugin.id);

    const mode = opts.mode || (ctx.project ? 'board' : 'standalone');
    const reg = { win: null, iframe, manifest: plugin, project: ctx.project || null, schemaFields: ctx.fields || [], fill: !!opts.fill };
    iframe.addEventListener('load', () => {
      reg.win = iframe.contentWindow;
      registry.push(reg);
      iframe.contentWindow.postMessage({ __pn: 'init', data: { fields: ctx.fields || [], values: ctx.values || {}, projectName: ctx.project?.name || '', mode, theme: themeVars() } }, '*');
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

  // Enabled plugins that own a whole page. app.js builds a ribbon button per entry.
  async function getActivityPlugins() {
    let plugins = [];
    try { plugins = await window.api.listPlugins(); } catch { return []; }
    const enabled = await getEnabled();
    return plugins.filter((p) => p.contributes?.activity && enabled[p.id] !== false);
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

  // ---- brokered capabilities ----
  // Every one of these is gated on a manifest-declared permission. A plugin that hasn't asked for
  // a capability gets a refusal, not a silent no-op, so it can tell the user what's missing.
  function allows(reg, perm) { return (reg.manifest.permissions || []).includes(perm); }

  // The plugin's storage filename is derived from its id and NEVER from the message payload:
  // config:read/config:write join the filename straight onto centralRoot() without sanitising it,
  // so a plugin-supplied name would be a path traversal into the config root. plugins.js already
  // validates the id — this is the second pair of eyes, because the failure mode is arbitrary
  // config overwrite.
  const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
  function storageFile(reg) {
    const id = String(reg.manifest.id || '');
    if (!ID_RE.test(id)) throw new Error('invalid plugin id');
    return `plugin-${id}.json`;    // flat: writeConfig only ensures centralRoot(), not subdirs
  }

  // A plugin writing without bound would grow the config root forever. Big enough for years of
  // records, small enough that a runaway loop is caught rather than filling the disk.
  const MAX_STORAGE_BYTES = 2 * 1024 * 1024;

  async function brokerStorage(reg, m) {
    if (!allows(reg, 'storage')) return reply(reg, m.id, { ok: false, error: 'permission denied' });
    try {
      if (m.__pn === 'storage.get') {
        return reply(reg, m.id, { ok: true, data: (await window.api.readConfig(storageFile(reg))) ?? null });
      }
      const body = JSON.stringify(m.payload?.data ?? null);
      if (body.length > MAX_STORAGE_BYTES) {
        return reply(reg, m.id, { ok: false, error: `storage full — ${reg.manifest.name} may store at most ${Math.round(MAX_STORAGE_BYTES / 1024)} KB` });
      }
      await window.api.writeConfig(storageFile(reg), m.payload?.data ?? null);
      return reply(reg, m.id, { ok: true });
    } catch (err) {
      // The plugin gets told so it can stop claiming "saved", and the user gets told because a
      // lost write here is lost data they can still act on.
      window.Toast?.error(`${reg.manifest.name}: ${err.message || err}`);
      return reply(reg, m.id, { ok: false, error: err.message || String(err) });
    }
  }

  async function brokerFiles(reg, m) {
    if (!allows(reg, 'files')) return reply(reg, m.id, { ok: false, error: 'permission denied' });
    const id = reg.manifest.id;
    const name = m.payload?.name;
    try {
      switch (m.__pn) {
        case 'files.pick': {
          // The native dialog IS the user's consent to reach outside the allowlist. The plugin
          // never sees the source path, only the name the file was stored under.
          const src = await window.api.pickFile();
          if (!src) return reply(reg, m.id, { ok: true, cancelled: true });
          return reply(reg, m.id, { ok: true, ...(await window.api.pluginImportFile(id, src)) });
        }
        case 'files.list':   return reply(reg, m.id, { ok: true, files: await window.api.pluginListFiles(id) });
        case 'files.read':   return reply(reg, m.id, { ok: true, dataUrl: await window.api.pluginReadFile(id, name) });
        case 'files.open':   await window.api.pluginOpenFile(id, name); return reply(reg, m.id, { ok: true });
        case 'files.reveal': await window.api.pluginRevealFile(id, name); return reply(reg, m.id, { ok: true });
        case 'files.delete': await window.api.pluginDeleteFile(id, name); return reply(reg, m.id, { ok: true });
        default: return reply(reg, m.id, { ok: false, error: 'unknown call' });
      }
    } catch (err) {
      window.Toast?.error(`${reg.manifest.name}: ${err.message || err}`);
      return reply(reg, m.id, { ok: false, error: err.message || String(err) });
    }
  }

  // ---- single host-side message broker ----
  window.addEventListener('message', async (e) => {
    const reg = registry.find((r) => r.win && r.win === e.source);
    if (!reg) return;                       // not from a known plugin frame -> ignore
    const m = e.data || {};
    // A fill-mode frame is sized by CSS. Honouring its content height here would fight the
    // plugin's own ResizeObserver: the frame grows, the content grows with it, repeat.
    if (m.__pn === 'resize') { if (reg.fill) return; const h = m.payload?.height; if (h) reg.iframe.style.height = Math.max(40, h + 2) + 'px'; return; }
    if (m.__pn === 'storage.get' || m.__pn === 'storage.set') return brokerStorage(reg, m);
    if (typeof m.__pn === 'string' && m.__pn.startsWith('files.')) return brokerFiles(reg, m);
    if (m.__pn === 'listProjects') {
      if (!allows(reg, 'projects')) return reply(reg, m.id, { ok: false, error: 'permission denied' });
      // Always reply. A throw here would leave the plugin awaiting a promise that never settles,
      // which looks like a hang rather than a failure it could report.
      try {
        const list = window.Store.allProjects().map((p) => ({ id: p.path, name: p.name, group: basename(p.libraryPath) }));
        return reply(reg, m.id, { ok: true, projects: list });
      } catch (err) {
        return reply(reg, m.id, { ok: false, error: err.message || String(err) });
      }
    }
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

  window.PluginBridge = { mount, renderBoardSections, getEnabled, setEnabled, getActivityPlugins, broadcastTheme };
})();
