// storageView.js — Storage page: library paths (+ scan depth), storage mode, app folder name, custom path.
(function () {
  const I = () => window.ICON;
  const S = () => window.Store.state.settings;

  function render(host) {
    host.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Storage &amp; Files</div>
          <div class="page-desc">Where project info &amp; notes live, and how the app finds your projects</div>
        </div>
      </div>
      <div class="page-body" style="padding:24px 28px 48px;">
        <div style="max-width:720px;">

          <div class="section-label">Project library folders</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
            Add every folder that holds project folders. Set how many <b>levels deep</b> the projects are (1 = direct subfolders).
          </div>
          <div id="libList"></div>
          <button class="add-path" id="addPathBtn">${I().plus} Add folder path…</button>

          <div class="section-label">App folder name</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5;">
            The folder the app creates for its data (used both inside project folders and in the central/custom store). This is the single place to change it.
          </div>
          <div class="card" style="display:flex;gap:10px;align-items:center;">
            <span class="lib-ico">${I().folderBig}</span>
            <input id="folderName" value="${escAttr(S().folderName || 'ProjectNotes')}" placeholder="ProjectNotes" style="flex:1;font-family:var(--mono);" />
          </div>

          <div class="section-label">Where data is stored</div>
          <div id="storeOpts" style="margin-bottom:14px;"></div>
          <div class="maint-card info" style="margin-bottom:32px;">
            <div class="maint-ico" style="background:rgba(91,140,255,.13);color:var(--accent);">${I().folderBig}</div>
            <div style="flex:1;">
              <div class="mc-title">Move existing data here</div>
              <div class="mc-sub">Switching location doesn't move anything automatically. Click to <b>copy</b> existing project info &amp; notes from your other locations into the current one (originals are left untouched as a backup).</div>
            </div>
            <button class="btn" id="migrateDataBtn">Copy data in…</button>
          </div>

          <div class="section-label">File formats</div>
          <div class="row" style="margin-bottom:32px;align-items:stretch;">
            <div class="card" style="flex:1;margin:0;">
              <div class="row" style="gap:9px;"><span class="mono" style="font-size:11px;font-weight:600;color:var(--amber);background:rgba(224,162,59,.13);border-radius:5px;padding:2px 7px;">.json</span><b>Project info</b></div>
              <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.55;">Field values stored as structured JSON — easy to read, diff and back up.</div>
            </div>
            <div class="card" style="flex:1;margin:0;">
              <div class="row" style="gap:9px;"><span class="mono" style="font-size:11px;font-weight:600;color:var(--accent);background:rgba(91,140,255,.13);border-radius:5px;padding:2px 7px;">.md</span><b>Notes</b></div>
              <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.55;">Plain Markdown — open them in any editor; nothing is locked into the app.</div>
            </div>
          </div>

          <div class="section-label">Maintenance</div>
          <div class="maint-card">
            <div class="maint-ico" style="background:rgba(91,140,255,.13);color:var(--accent);">${I().refresh}</div>
            <div style="flex:1;"><div class="mc-title">Re-scan &amp; reconnect</div><div class="mc-sub">Find new or moved projects across your library folders, without duplicating data.</div></div>
            <button class="btn primary" id="migrateBtn">Run scan</button>
          </div>
        </div>
      </div>`;

    renderLibList(host);
    renderStoreOpts(host);
    loadCentralRoot(host);      // async: re-renders the cards once the real path is known

    host.querySelector('#addPathBtn').onclick = async () => {
      const folder = await window.api.pickFolder();
      if (!folder) return;
      await window.Store.addLibraryPath(folder);
      renderLibList(host);
      window.setStatus?.('Added library folder');
    };
    const fn = host.querySelector('#folderName');
    fn.onchange = async () => {
      S().folderName = fn.value.trim() || 'ProjectNotes';
      fn.value = S().folderName;
      await window.Store.saveSettings();
      await window.Store.rescan();
      renderStoreOpts(host); renderLibList(host);
      window.setStatus?.('App folder name updated');
    };
    host.querySelector('#migrateBtn').onclick = async () => {
      window.setStatus?.('Re-scanning…'); await window.Store.rescan(); renderLibList(host); window.setStatus?.('All changes saved');
    };
    host.querySelector('#migrateDataBtn').onclick = async () => {
      const paths = window.Store.allProjects().map((p) => p.path);
      if (!paths.length) { window.Toast?.info('No projects to migrate yet.'); return; }
      const ok = await window.Modal.confirm({ title: 'Copy data into this location?', body: `This copies project info & notes for ${paths.length} project(s) from your other storage locations into the current one. Originals are kept.`, okText: 'Copy data' });
      if (!ok) return;
      window.setStatus?.('Copying data…');
      try {
        const n = await window.api.migrateData(paths);
        await window.Store.rescan(); renderLibList(host);
        window.Toast?.success(n ? `Copied data for ${n} project(s).` : 'Nothing to copy — current location already has the data.');
      } catch (err) { window.Toast?.error('Migration failed: ' + (err.message || err)); }
      window.setStatus?.('All changes saved');
    };
  }

  function renderLibList(host) {
    const list = host.querySelector('#libList');
    const groups = window.Store.state.groups;
    list.innerHTML = '';
    if (!window.Store.state.libraryPaths.length) { list.innerHTML = `<div class="empty-hint" style="text-align:left;padding:12px 0;">No library folders yet.</div>`; return; }
    window.Store.state.libraryPaths.forEach((lp) => {
      const count = (groups.find((g) => g.path === lp.path)?.projects.length) || 0;
      const depth = lp.depth || 1;
      const row = document.createElement('div');
      row.className = 'lib-row';
      row.innerHTML = `
        <span class="lib-ico">${I().folderBig}</span>
        <span class="lib-path"></span>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);white-space:nowrap;">levels
          <select class="lib-depth" style="width:auto;height:26px;padding:0 6px;">
            ${[1, 2, 3, 4].map((d) => `<option value="${d}" ${d === depth ? 'selected' : ''}>${d}</option>`).join('')}
          </select></label>
        <span class="lib-count">${count} ${count === 1 ? 'project' : 'projects'}</span>
        <button class="lib-relink" title="This folder moved or was renamed — point the entry at its new location, keeping its schema">Change…</button>
        <button class="lib-remove" title="Remove folder">✕</button>`;
      row.querySelector('.lib-path').textContent = lp.path;
      row.querySelector('.lib-depth').onchange = async (e) => { await window.Store.setLibraryDepth(lp.path, e.target.value); renderLibList(host); window.setStatus?.('Re-scanned at depth ' + e.target.value); };
      // Relink keeps the schema; remove + re-add would silently start from an empty one.
      row.querySelector('.lib-relink').onclick = async () => {
        const next = await window.api.pickFolder();
        if (!next) return;
        const ok = await window.Store.relinkLibraryPath(lp.path, next);
        renderLibList(host);
        if (ok) window.Toast?.success('Folder relinked — its schema was kept.');
        else window.Toast?.error('That folder is already registered.');
      };
      row.querySelector('.lib-remove').onclick = async () => {
        const ok = await window.Modal.confirm({
          title: 'Remove this library folder?',
          body: `“${lp.path}” will be removed from the app along with its schema. Your project files and notes on disk are not touched.`,
          okText: 'Remove', danger: true,
        });
        if (!ok) return;
        await window.Store.removeLibraryPath(lp.path);
        renderLibList(host);
        window.setStatus?.('Removed library folder');
      };
      list.appendChild(row);
    });
  }

  // The real per-platform data directory, resolved by the main process. Hardcoding a path here
  // told Windows and Linux users their data lived at a macOS path that doesn't exist for them.
  let centralRoot = null;
  async function loadCentralRoot(host) {
    try { centralRoot = await window.api.centralRoot(); } catch { centralRoot = null; }
    if (host?.isConnected) renderStoreOpts(host);
  }

  function renderStoreOpts(host) {
    const opts = host.querySelector('#storeOpts');
    if (!opts) return;
    const mode = S().storageMode;
    const folder = S().folderName || 'ProjectNotes';
    const custom = S().customPath || '(choose a folder…)';
    const centralPath = centralRoot ? `${centralRoot}/Projects/<Project (id)>/` : 'resolving…';
    opts.innerHTML = `
      ${optCard('infolder', mode, 'Inside the project folder', 'Data sits next to the files it describes — moving or sharing a project keeps everything together.', `&lt;project&gt;/${escHtml(folder)}/`, 'var(--accent)', 'Recommended')}
      ${optCard('central', mode, 'Central app folder', 'A separate, app-managed location. Each project still gets its own readable folder, so you can take your notes with you.', escHtml(centralPath), 'var(--purple)')}
      ${optCard('custom', mode, 'Custom location', 'Keep info &amp; notes in a folder you choose (e.g. a personal drive), separate from the project files.', escHtml(custom) + `/${escHtml(folder)}/Projects/&lt;Project (id)&gt;/`, 'var(--teal)')}
      <div id="customPicker" style="margin-top:-4px;${mode === 'custom' ? '' : 'display:none;'}">
        <button class="btn" id="pickCustom">${I().folderBig} Choose custom folder…</button>
        <span class="mono" style="font-size:11px;color:var(--muted);margin-left:10px;">${escHtml(S().customPath || 'none selected')}</span>
      </div>`;

    opts.querySelectorAll('.store-opt').forEach((el) => {
      el.onclick = async () => {
        S().storageMode = el.dataset.mode;
        await window.Store.saveSettings();
        if (el.dataset.mode === 'custom' && !S().customPath) { renderStoreOpts(host); return; } // wait for path
        await window.Store.rescan();
        renderStoreOpts(host); renderLibList(host);
        window.setStatus?.('Storage mode: ' + el.dataset.mode);
      };
    });
    const pick = opts.querySelector('#pickCustom');
    if (pick) pick.onclick = async () => {
      const dir = await window.api.pickFolder();
      if (!dir) return;
      S().customPath = dir; S().storageMode = 'custom';
      await window.Store.saveSettings();
      await window.Store.rescan();
      renderStoreOpts(host); renderLibList(host);
      window.setStatus?.('Custom location set');
    };
  }

  function optCard(value, mode, title, desc, pathStr, color, badge) {
    const active = mode === value;
    return `
      <div class="store-opt ${active ? 'active' : ''}" data-mode="${value}">
        <div class="ring"><div class="rdot"></div></div>
        <div style="flex:1;">
          <div class="so-title">${title}</div>
          <div class="so-desc">${desc}</div>
          <div class="so-path" style="color:${color};">${pathStr}</div>
        </div>
        ${badge ? `<span class="so-rec">${badge}</span>` : ''}
      </div>`;
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.StorageView = { render };
})();
