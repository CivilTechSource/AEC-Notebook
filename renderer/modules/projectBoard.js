// projectBoard.js — per-project board driven by the project's (per-path) schema.
//  - View mode (default): read-only; dropdown/multiselect render as pills (items #3, #6).
//  - Edit mode: inputs that AUTO-SAVE (no Save button); inline validation.
//  - Sections from the schema render as collapsible groups (item #5).
//  - Open boards auto-refresh when their schema changes (item #4) via refreshForPath().
(function () {
  const V = () => window.DataValidation;
  const I = () => window.ICON;

  // Registry of mounted boards so we can re-render on schema change.
  const mounted = new Set(); // { project, paneEl, editMode }

  function render(pane, project) {
    let entry = [...mounted].find((m) => m.paneEl === pane);
    if (!entry) { entry = { project, paneEl: pane, editMode: false }; mounted.add(entry); }
    entry.project = project;
    draw(entry);
  }

  function refreshForPath(libraryPath) {
    mounted.forEach((entry) => {
      if (!entry.paneEl.isConnected) { mounted.delete(entry); return; }  // tab was closed
      if (entry.project.libraryPath === libraryPath) draw(entry);
    });
  }

  // Called by the tab system when a pane is reused for different content / closed.
  function unmount(paneEl) { mounted.forEach((e) => { if (e.paneEl === paneEl) mounted.delete(e); }); }

  function draw(entry) {
    const { project, paneEl } = entry;
    const schema = window.Store.schemaForProject(project);
    const record = { ...(project.data || {}) };
    entry.record = record;
    const editing = entry.editMode;

    const fz = record.flood_zone;
    const zoneLabel = fz ? String(fz).replace('zone', 'Zone ') : null;

    paneEl.innerHTML = `
      <div class="board-head">
        <div class="board-headrow">
          <div class="board-title">${escHtml(project.name)}</div>
          <button class="btn ${editing ? 'primary' : ''}" id="editToggle">${editing ? '✓ Done' : '✎ Edit'}</button>
        </div>
        <div class="board-sub">
          <span>${escHtml(project.path)}</span>
          ${zoneLabel ? `<span class="sep">·</span><span class="zone"><span class="z-dot"></span>Flood ${escHtml(zoneLabel)}</span>` : ''}
          ${editing ? `<span class="sep">·</span><span style="color:var(--green);" id="autosaveMsg">auto-saving</span>` : ''}
        </div>
      </div>
      <div class="board-banner" id="boardBanner" hidden></div>
      <div class="board-sections" id="boardSections"></div>`;

    paneEl.querySelector('#editToggle').onclick = async () => {
      if (entry.editMode) {
        // leaving edit mode -> commit pending edits immediately so the view reflects them
        getPersist(entry).cancel();
        try { await window.Store.saveProjectData(entry.project.path, entry.record); }
        catch { /* toast already shown by store */ }
      }
      entry.editMode = !entry.editMode;
      draw(entry);
    };

    const host = paneEl.querySelector('#boardSections');
    const secs = schema.sections || [];
    if (!secs.length || secs.every((s) => !s.fields.length)) {
      host.innerHTML = `<div style="padding:6px 22px;"><div class="empty-hint" style="text-align:left;">No fields defined for this folder. Open the Schema Editor (🧩) to add some.</div></div>`;
    } else {
      secs.forEach((sec) => { if (sec.fields.length) host.appendChild(sectionBlock(entry, sec, record, editing)); });
    }

    // notes section
    host.appendChild(notesSection(entry, project));

    // plugin board-section contributions (sandboxed)
    if (window.PluginBridge) window.PluginBridge.renderBoardSections(host, project, schema);

    updateBanner(entry, schema);
  }

  // Completeness banner — lists outstanding required/validation issues (incl. cross-field attachment rule).
  function updateBanner(entry, schema) {
    const banner = entry.paneEl.querySelector('#boardBanner');
    if (!banner) return;
    schema = schema || window.Store.schemaForProject(entry.project);
    const hasAnyData = Object.keys(entry.record).length > 0;
    const res = window.DataValidation.validateRecord(schema, entry.record);
    if (res.valid || !hasAnyData) { banner.hidden = true; banner.innerHTML = ''; return; }
    const items = Object.values(res.errors);
    banner.hidden = false;
    banner.innerHTML = `${window.ICON.warn} <b>Incomplete</b> — ${items.length} item${items.length === 1 ? '' : 's'} to resolve:
      <ul>${items.map((e) => `<li>${escHtml(e)}</li>`).join('')}</ul>`;
  }

  function sectionBlock(entry, sec, record, editing) {
    const block = document.createElement('div');
    block.className = 'section';
    block.innerHTML = `
      <button class="section-head"><span class="chev">${I().chevDown}</span><span class="s-title">${escHtml(sec.title)}</span><span class="s-count">${sec.fields.length}</span></button>
      <div class="section-body" style="display:block;"><div class="board-fields"></div></div>`;
    block.querySelector('.section-head').onclick = () => block.classList.toggle('collapsed');
    const fhost = block.querySelector('.board-fields');
    sec.fields.forEach((field) => fhost.appendChild(editing ? editControl(entry, field, record) : viewControl(field, record)));
    return block;
  }

  // ---------- VIEW MODE ----------
  function viewControl(field, record) {
    const wrap = document.createElement('div');
    wrap.className = 'view-field';
    const val = record[field.key];
    const highlight = V().shouldHighlight(field, val);
    let valueHtml;

    if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) {
      valueHtml = `<span class="vf-empty">—</span>`;
    } else if (field.type === 'multiselect') {
      valueHtml = `<span class="pill-row">${val.map((v) => `<span class="pill">${escHtml(optLabel(field, v))}</span>`).join('')}</span>`;
    } else if (field.type === 'dropdown') {
      valueHtml = `<span class="pill ${highlight ? 'pill-danger' : ''}">${escHtml(optLabel(field, val))}</span>`;
    } else if (field.type === 'checkbox') {
      valueHtml = `<span class="pill">${val ? 'Yes' : 'No'}</span>`;
    } else if (field.type === 'file') {
      valueHtml = `<a class="vf-file vf-link" title="Open ${escAttr(val)}">${I().folder} ${escHtml(baseName(val))}</a>`;
    } else {
      valueHtml = `<span class="vf-text ${highlight ? 'danger' : ''}">${escHtml(String(val))}</span>`;
    }
    wrap.innerHTML = `<div class="vf-label">${escHtml(field.label)}</div><div class="vf-value">${valueHtml}</div>`;
    if (field.type === 'file' && val) {
      const link = wrap.querySelector('.vf-link');
      link.onclick = () => window.api.openFile(val);
      link.oncontextmenu = (e) => { e.preventDefault(); window.api.revealFile(val); };  // right-click = reveal in Finder
    }
    return wrap;
  }

  // ---------- EDIT MODE (auto-save) ----------
  function editControl(entry, field, record) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.innerHTML = escHtml(field.label) + (field.required ? ' <span style="color:var(--red)">*</span>' : '');
    wrap.appendChild(lbl);
    const val = record[field.key];

    if (field.type === 'multiselect') {
      const chips = document.createElement('div');
      chips.className = 'pill-row editable';
      const selected = new Set(Array.isArray(val) ? val : []);
      (field.options || []).forEach((o) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pill toggle' + (selected.has(o.value) ? ' on' : '');
        chip.textContent = o.label || o.value;
        chip.onclick = () => {
          if (selected.has(o.value)) selected.delete(o.value); else selected.add(o.value);
          chip.classList.toggle('on');
          commit(entry, field, [...selected], wrap);
        };
        chips.appendChild(chip);
      });
      wrap.appendChild(chips);
      return wrap;
    }

    let control;
    switch (field.type) {
      case 'textarea': control = el('textarea'); control.value = val ?? ''; break;
      case 'number': control = el('input'); control.type = 'number'; control.value = val ?? ''; break;
      case 'date': control = el('input'); control.type = 'date'; control.value = val ?? ''; break;
      case 'checkbox': control = el('input'); control.type = 'checkbox'; control.style.width = 'auto'; control.checked = !!val; break;
      case 'dropdown':
        control = el('select');
        control.innerHTML = `<option value="">— select —</option>` + (field.options || []).map((o) => `<option value="${escAttr(o.value)}">${escHtml(o.label)}</option>`).join('');
        control.value = val ?? '';
        break;
      case 'file': {
        control = el('input'); control.type = 'text'; control.readOnly = true; control.value = val ?? ''; control.placeholder = 'No file chosen';
        const row = el('div'); row.className = 'row'; row.style.marginTop = '6px';
        const pick = el('button'); pick.className = 'btn'; pick.textContent = 'Choose…'; pick.type = 'button';
        const openBtn = el('button'); openBtn.className = 'btn'; openBtn.type = 'button'; openBtn.innerHTML = `${I().folder} Open`;
        openBtn.style.display = val ? '' : 'none';
        openBtn.onclick = () => { if (control.value) window.api.openFile(control.value); };
        pick.onclick = async () => { const p = await window.api.pickFile(); if (p) { control.value = p; openBtn.style.display = ''; commit(entry, field, p, wrap); } };
        row.appendChild(pick); row.appendChild(openBtn);
        wrap.appendChild(control); wrap.appendChild(row);
        attachValidation(wrap, control, field, () => commit(entry, field, control.value, wrap));
        return wrap;
      }
      default: control = el('input'); control.type = 'text'; control.value = val ?? '';
    }
    wrap.appendChild(control);

    const read = () => field.type === 'checkbox' ? control.checked : (field.type === 'number' ? (control.value === '' ? '' : Number(control.value)) : control.value);
    const fire = () => commit(entry, field, read(), wrap);
    if (field.type === 'checkbox' || field.type === 'dropdown' || field.type === 'date') control.addEventListener('change', fire);
    else { control.addEventListener('change', fire); control.addEventListener('input', fire); } // update record on each keystroke; disk write stays debounced
    showFieldValidation(wrap, field, read());
    return wrap;
  }

  // Per-board debounced auto-save (one debouncer per entry so split-view boards don't clobber each other).
  function getPersist(entry) {
    if (!entry._persist) {
      entry._persist = debounce(async () => {
        try { await window.Store.saveProjectData(entry.project.path, entry.record); } catch { return; }
        const m = entry.paneEl.querySelector('#autosaveMsg'); if (m) { m.textContent = 'saved ✓'; setTimeout(() => { if (m.isConnected) m.textContent = 'auto-saving'; }, 1200); }
        window.setStatus?.('Saved ' + entry.project.name);
      }, 400);
    }
    return entry._persist;
  }

  function commit(entry, field, value, wrap) {
    entry.record[field.key] = value;
    wrap.classList.toggle('highlight-red', V().shouldHighlight(field, value));
    showFieldValidation(wrap, field, value);
    updateBanner(entry);
    getPersist(entry)();
  }

  function showFieldValidation(wrap, field, value) {
    let err = wrap.querySelector('.field-error');
    const result = V().validateField(field, value);
    if (!result.valid) {
      if (!err) { err = document.createElement('div'); err.className = 'field-error'; wrap.appendChild(err); }
      err.innerHTML = I().warn + ' ' + escHtml(result.error);
    } else if (err) err.remove();
  }
  function attachValidation(wrap, control, field, onChange) {
    control.addEventListener('change', onChange);
  }

  // ---------- notes (Obsidian-style list) ----------
  function notesSection(entry, project) {
    const block = document.createElement('div');
    block.className = 'section';
    block.innerHTML = `
      <button class="section-head"><span class="chev">${I().chevDown}</span><span class="s-title">Notes</span><span class="s-count" id="noteCount">0</span><span class="s-spacer"></span>
        <span class="btn ghost" id="newNoteBtn" title="New note" style="height:24px;padding:0 8px;">${I().plus} New</span></button>
      <div class="section-body" style="display:block;"><div class="note-list" id="boardNotes"></div></div>`;
    block.querySelector('.section-head').onclick = (e) => { if (e.target.closest('#newNoteBtn')) return; block.classList.toggle('collapsed'); };
    block.querySelector('#newNoteBtn').onclick = async (e) => {
      e.stopPropagation();
      const name = await window.api.createNote(project.path, 'Untitled');
      await renderNotes(block, project);
      window.NotesView.open(project, name, { newTab: true, isNew: true });   // opens empty, title focused
    };
    renderNotes(block, project);
    return block;
  }

  async function renderNotes(block, project) {
    const host = block.querySelector('#boardNotes');
    const notes = await window.api.listNotes(project.path);
    block.querySelector('#noteCount').textContent = notes.length;
    if (!notes.length) { host.innerHTML = `<div class="empty-hint" style="text-align:left;padding:6px 0;font-size:12px;">No notes yet. Click <b>New</b> to create one.</div>`; return; }
    host.innerHTML = '';
    notes.slice().sort((a, b) => a.localeCompare(b)).forEach((name) => {
      const row = document.createElement('div');
      row.className = 'note-row';
      row.innerHTML = `<span class="nr-ico">${I().note}</span><span class="nr-name"></span>
        <button class="nr-act" data-a="newtab" title="Open in new tab">⧉</button>
        <button class="nr-act" data-a="side" title="Open to the right">⇥</button>`;
      row.querySelector('.nr-name').textContent = name.replace(/\.md$/, '');
      row.onclick = () => window.NotesView.open(project, name);                                  // reuse active tab
      row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); window.NotesView.open(project, name, { newTab: true }); } });
      row.querySelector('[data-a="newtab"]').onclick = (e) => { e.stopPropagation(); window.NotesView.open(project, name, { newTab: true }); };
      row.querySelector('[data-a="side"]').onclick = (e) => { e.stopPropagation(); window.NotesView.open(project, name, { toSide: true }); };
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); noteMenu(e, project, name, block); });
      host.appendChild(row);
    });
  }

  function noteMenu(e, project, name, block) {
    document.querySelectorAll('.context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
    menu.innerHTML = `<button data-a="open">Open</button><button data-a="newtab">Open in new tab</button><button data-a="side">Open to the right</button><button data-a="del">Delete</button>`;
    document.body.appendChild(menu);
    const dismiss = (ev) => { if (ev && menu.contains(ev.target)) return; menu.remove(); document.removeEventListener('mousedown', dismiss); };
    menu.querySelector('[data-a="open"]').onclick = () => { window.NotesView.open(project, name); dismiss(); };
    menu.querySelector('[data-a="newtab"]').onclick = () => { window.NotesView.open(project, name, { newTab: true }); dismiss(); };
    menu.querySelector('[data-a="side"]').onclick = () => { window.NotesView.open(project, name, { toSide: true }); dismiss(); };
    menu.querySelector('[data-a="del"]').onclick = async () => {
      dismiss();
      let content = '';
      try { content = await window.api.readNote(project.path, name); } catch { /* ignore */ }
      await window.api.deleteNote(project.path, name);
      renderNotes(block, project);
      window.Undo.record(`Deleted note “${name.replace(/\.md$/, '')}”`, async () => {
        await window.api.writeNote(project.path, name, content);
        renderNotes(block, project);
      });
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  // ---------- helpers ----------
  function optLabel(field, value) { const o = (field.options || []).find((x) => x.value === value); return o ? o.label : value; }
  function baseName(p) { return String(p).split(/[\\/]/).pop(); }
  function debounce(fn, ms) {
    let t, lastArgs;
    const f = (...a) => { lastArgs = a; clearTimeout(t); t = setTimeout(() => { lastArgs = null; fn(...a); }, ms); };
    f.cancel = () => { clearTimeout(t); t = null; lastArgs = null; };
    f.flush = () => { if (t) { clearTimeout(t); t = null; } if (lastArgs) { const a = lastArgs; lastArgs = null; fn(...a); } };
    return f;
  }
  function el(tag) { return document.createElement(tag); }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.ProjectBoard = { render, refreshForPath, unmount };
})();
