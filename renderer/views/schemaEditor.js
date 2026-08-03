// schemaEditor.js — per-path, sectioned Schema Editor.
//  - A path selector chooses WHICH library path's schema you're editing (item #1).
//  - Schemas are organised into sections; fields nest under sections (item #5).
//  - Field types include multiselect (item #6).
(function () {
  const I = () => window.ICON;
  const FI = () => window.FIELD_ICON;
  const TYPES = [
    ['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'],
    ['dropdown', 'Select'], ['multiselect', 'Multi-select'], ['file', 'File'], ['checkbox', 'Checkbox'],
  ];
  const TYPE_LABEL = Object.fromEntries(TYPES);
  const HAS_OPTIONS = (t) => t === 'dropdown' || t === 'multiselect';

  let currentPath = null;
  let selectedId = null;

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  function uid(p) { return window.Store.uid(p); }
  function schema() { return window.Store.schemaForPath(currentPath); }
  function sections() { return schema().sections; }
  function allFields() { return sections().flatMap((s) => s.fields); }
  function findField(id) { for (const s of sections()) { const f = s.fields.find((x) => x.id === id); if (f) return { field: f, section: s }; } return null; }

  async function save() {
    // Safety net: a field the user never named still needs a usable property name — an empty key
    // would make every such field write to the same slot in project.json. The field currently
    // being edited is skipped so a key isn't derived from a half-typed name; it gets one on blur
    // (see renderDetail) or the next time the selection moves.
    for (const f of allFields()) if (!f.key && f.id !== selectedId) f.key = uniqueKey(slug(f.label || ''), f);
    await window.Store.saveSchemaForPath(currentPath);
  }

  function render(host) {
    const paths = window.Store.state.libraryPaths;
    if (!currentPath || !paths.some((p) => p.path === currentPath)) currentPath = paths[0]?.path || null;

    if (!currentPath) {
      host.innerHTML = `<div class="page-head"><div><div class="page-title">Schema Editor</div>
        <div class="page-desc">Add a library folder on the Storage page first — each folder gets its own schema.</div></div></div>`;
      return;
    }
    if (!selectedId || !findField(selectedId)) selectedId = allFields()[0]?.id || null;

    host.innerHTML = `
      <div class="page-head">
        <div>
          <div class="crumb"><a id="crumbWs">workspace</a><span>/</span><span style="color:var(--text-3);">schema</span></div>
          <div class="page-title">Schema Editor</div>
          <div class="page-desc" style="gap:10px;">
            <span>Editing schema for</span>
            <select id="pathSelect" style="width:auto;height:28px;padding:2px 8px;font-size:12px;">
              ${paths.map((p) => `<option value="${escAttr(p.path)}" ${p.path === currentPath ? 'selected' : ''}>${escHtml(base(p.path))}</option>`).join('')}
            </select>
            <span class="mono" style="color:var(--text-2);">v${schema().version}</span>
          </div>
        </div>
        <div class="head-actions">
          <button class="btn" id="seSection">${I().plus} Section</button>
          <button class="btn" id="seCopy">${I().copy} Copy</button>
          <button class="btn" id="seExport">${I().export} Export</button>
          <button class="btn" id="seImport">${I().import} Import</button>
          <button class="btn primary" id="seAdd">${I().plus} Add field</button>
        </div>
      </div>
      <div class="schema-split">
        <div class="schema-list">
          <div class="section-label">Sections &amp; fields · drag fields to reorder</div>
          <div id="seSections"></div>
        </div>
        <div class="schema-detail" id="seDetail"></div>
      </div>`;

    host.querySelector('#crumbWs').onclick = () => document.querySelector('.ribbon-btn[data-page="workspace"]').click();
    host.querySelector('#pathSelect').onchange = (e) => { currentPath = e.target.value; selectedId = null; render(host); };
    host.querySelector('#seSection').onclick = async () => { sections().push({ id: uid('sec_'), title: 'New Section', fields: [] }); await save(); renderSections(host); };
    host.querySelector('#seAdd').onclick = () => addField(host);
    host.querySelector('#seExport').onclick = exportSchema;
    host.querySelector('#seCopy').onclick = copySchema;
    host.querySelector('#seImport').onclick = () => importSchema(host);

    renderSections(host);
    renderDetail(host);
  }

  function renderSections(host) {
    const wrap = host.querySelector('#seSections');
    wrap.innerHTML = '';
    if (!sections().length) { wrap.innerHTML = `<div class="empty-hint" style="text-align:left;">No sections. Click “Section”.</div>`; return; }
    sections().forEach((sec) => wrap.appendChild(sectionBlock(host, sec)));
  }

  function sectionBlock(host, sec) {
    const block = document.createElement('div');
    block.className = 'schema-section';
    block.innerHTML = `
      <div class="schema-section-head">
        <span class="sec-grip" draggable="true" title="Drag to reorder section">${I().grip}</span>
        <span class="chev">${I().chevDown}</span>
        <input class="sec-title" value="${escAttr(sec.title)}" />
        <span class="sec-count">${sec.fields.length}</span>
        <button class="btn ghost" data-addf title="Add field here">${I().plus}</button>
        <button class="btn ghost danger" data-delsec title="Delete section">✕</button>
      </div>
      <div class="schema-section-body"></div>`;

    const head = block.querySelector('.schema-section-head');
    head.querySelector('.chev').onclick = () => block.classList.toggle('collapsed');

    // section drag-reorder (via the grip only, so the title input stays editable)
    const grip = head.querySelector('.sec-grip');
    grip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/section', sec.id); block.classList.add('dragging'); });
    grip.addEventListener('dragend', () => block.classList.remove('dragging'));
    head.addEventListener('dragover', (e) => { if ((e.dataTransfer.types || []).includes('text/section')) { e.preventDefault(); head.classList.add('dropbefore'); } });
    head.addEventListener('dragleave', () => head.classList.remove('dropbefore'));
    head.addEventListener('drop', async (e) => {
      const sid = e.dataTransfer.getData('text/section');
      head.classList.remove('dropbefore');
      if (!sid || sid === sec.id) return;
      e.preventDefault();
      const arr = sections();
      const from = arr.findIndex((s) => s.id === sid);
      const to = arr.findIndex((s) => s.id === sec.id);
      if (from < 0 || to < 0) return;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      await save(); renderSections(host);
    });
    const titleInput = head.querySelector('.sec-title');
    titleInput.onchange = async () => { sec.title = titleInput.value; await save(); };
    head.querySelector('[data-addf]').onclick = () => addField(host, sec);
    head.querySelector('[data-delsec]').onclick = async () => {
      if (sections().length === 1) { alert('Keep at least one section.'); return; }
      const ok = await window.Modal.confirm({ title: 'Delete section?', body: `“${sec.title}” and its ${sec.fields.length} field(s) will be removed.`, okText: 'Delete', danger: true });
      if (!ok) return;
      const idx = sections().indexOf(sec);
      schema().sections = sections().filter((s) => s !== sec);
      await save(); renderSections(host); renderDetail(host);
      window.Undo.record(`Deleted section “${sec.title}”`, async () => {
        schema().sections.splice(idx, 0, sec);
        await save(); renderSections(host); renderDetail(host);
      });
    };

    const body = block.querySelector('.schema-section-body');
    // drop onto empty area of the section => append
    body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('dragover'); });
    body.addEventListener('dragleave', () => body.classList.remove('dragover'));
    body.addEventListener('drop', async (e) => {
      e.preventDefault(); body.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/field');
      if (id) await moveField(id, sec, sec.fields.length, host);
    });

    if (!sec.fields.length) body.innerHTML = `<div class="empty-hint" style="text-align:left;padding:8px;font-size:11px;">Empty — add a field.</div>`;
    else sec.fields.forEach((f, idx) => body.appendChild(fieldRow(host, sec, f, idx)));
    return block;
  }

  function fieldRow(host, sec, field, idx) {
    const el = document.createElement('div');
    el.className = 'schema-field' + (field.id === selectedId ? ' selected' : '');
    el.draggable = true;
    const validated = HAS_OPTIONS(field.type) || field.type === 'date' || field.type === 'file';
    el.innerHTML = `
      <span class="grip">${I().grip}</span>
      <span class="ficon t-${field.type}">${FI()[field.type] || FI().text}</span>
      <span class="fname"></span>
      ${validated ? `<span class="val-badge">${I().shield} Validated</span>` : ''}
      <span class="ftype">${TYPE_LABEL[field.type] || field.type}</span>
      <span class="reqdot" style="background:${field.required ? 'var(--red)' : 'transparent'}" title="Required"></span>`;
    el.querySelector('.fname').textContent = field.label || '(unnamed)';
    // Saving after the selection moves lets the field we just left pick up its key.
    el.onclick = async () => { selectedId = field.id; renderSections(host); renderDetail(host); await save(); };

    el.addEventListener('dragstart', (e) => { e.stopPropagation(); el.classList.add('dragging'); e.dataTransfer.setData('text/field', field.id); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('dropbefore'); });
    el.addEventListener('dragleave', () => el.classList.remove('dropbefore'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); el.classList.remove('dropbefore');
      const id = e.dataTransfer.getData('text/field');
      if (id) await moveField(id, sec, idx, host);
    });
    return el;
  }

  async function moveField(id, targetSec, targetIdx, host) {
    const loc = findField(id);
    if (!loc) return;
    const fromArr = loc.section.fields;
    const fromIdx = fromArr.indexOf(loc.field);
    fromArr.splice(fromIdx, 1);
    // adjust index if moving within same section after removal
    let idx = targetIdx;
    if (loc.section === targetSec && fromIdx < targetIdx) idx -= 1;
    targetSec.fields.splice(idx, 0, loc.field);
    await save();
    renderSections(host);
  }

  // ---------- detail panel ----------
  function renderDetail(host) {
    const detail = host.querySelector('#seDetail');
    if (!detail) return;
    const loc = selectedId ? findField(selectedId) : null;
    const f = loc?.field;
    if (!f) { detail.innerHTML = `<div class="section-label">Field properties</div><div class="empty-hint" style="text-align:left;">Select or add a field.</div>`; return; }

    detail.innerHTML = `
      <div class="section-label">Field properties</div>
      <div class="field"><span class="lbl">Field name</span><input id="dName" value="${escAttr(f.label)}" /></div>
      <div class="field"><span class="lbl">Field type</span>
        <select id="dType">${TYPES.map(([v, l]) => `<option value="${v}" ${v === f.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="toggle-row">
        <div><div class="tr-title">Required field</div><div class="tr-sub">Block save when empty</div></div>
        <div class="switch ${f.required ? 'on' : ''}" id="dReq"><div class="knob"></div></div>
      </div>
      <div id="dExtra"></div>
      <div style="margin-top:18px;display:flex;justify-content:flex-end;"><button class="btn danger" id="dDelete">Delete field</button></div>`;

    const name = detail.querySelector('#dName');
    // Label updates live; the KEY is assigned once, on blur, from the finished label — it's the
    // property name in project.json, so it should read like `client`, not `new_field_v5s`.
    // A key is never rewritten once set: existing project data is stored under it.
    name.oninput = async () => { f.label = name.value; await save(); renderSections(host); };
    name.onchange = async () => { if (!f.key) { f.key = uniqueKey(slug(name.value), f); await save(); } };
    detail.querySelector('#dType').onchange = async (e) => {
      f.type = e.target.value;
      if (HAS_OPTIONS(f.type) && !f.options) f.options = [];
      await save(); renderSections(host); renderDetail(host);
    };
    detail.querySelector('#dReq').onclick = async (e) => { f.required = !f.required; e.currentTarget.classList.toggle('on', f.required); await save(); renderSections(host); };
    detail.querySelector('#dDelete').onclick = async () => {
      const idx = loc.section.fields.indexOf(f);
      const sec = loc.section;
      sec.fields.splice(idx, 1);
      selectedId = allFields()[0]?.id || null;
      await save(); renderSections(host); renderDetail(host);
      window.Undo.record(`Deleted field “${f.label || '(unnamed)'}”`, async () => {
        sec.fields.splice(idx, 0, f);
        selectedId = f.id;
        await save(); renderSections(host); renderDetail(host);
      });
    };
    renderExtra(host, detail.querySelector('#dExtra'), f);
  }

  function renderExtra(host, extra, f) {
    f.validation = f.validation || {};
    if (HAS_OPTIONS(f.type)) {
      extra.innerHTML = `
        <div style="border-top:1px solid var(--line);margin-top:6px;padding-top:16px;">
          <div class="section-label">Allowed options</div>
          <div id="optList"></div>
          <button class="btn" id="optAdd" style="margin-bottom:18px;">${I().plus} Add option</button>
          ${f.type === 'dropdown' ? `
          <div class="section-label">Highlight rule</div>
          <div class="toggle-row" style="border:none;padding-top:0;"><div><div class="tr-title">Highlight red on a value</div><div class="tr-sub">Enter the option value to flag (e.g. zone3)</div></div></div>
          <input id="hlEquals" placeholder="value to highlight" value="${escAttr(f.validation.highlightWhen?.equals ?? '')}" style="margin-bottom:18px;" />` : ''}
          <div class="section-label">Live preview</div>
          <div class="live-preview" id="livePreview"></div>
        </div>`;
      renderOptions(host, extra, f);
      extra.querySelector('#optAdd').onclick = async () => { f.options.push({ label: '', value: '', requiresAttachment: false }); await save(); renderExtra(host, extra, f); };
      const hl = extra.querySelector('#hlEquals');
      // Also re-render the option rows: the flagged option's dot/row styling is derived from
      // this rule, so it stayed stale until something else forced a redraw.
      if (hl) hl.oninput = async () => {
        f.validation.highlightWhen = hl.value.trim() ? { equals: hl.value.trim() } : undefined;
        await save(); renderOptions(host, extra, f); renderPreview(extra, f);
      };
      renderPreview(extra, f);
    } else if (f.type === 'number') {
      extra.innerHTML = `<div class="card" style="margin-top:14px;"><div class="row" style="align-items:flex-end;">
        <div class="field" style="flex:1;margin:0;"><span class="lbl">Min</span><input id="numMin" type="number" value="${f.validation.min ?? ''}"></div>
        <div class="field" style="flex:1;margin:0;"><span class="lbl">Max</span><input id="numMax" type="number" value="${f.validation.max ?? ''}"></div></div></div>`;
      const s = async () => { const mn = extra.querySelector('#numMin').value, mx = extra.querySelector('#numMax').value; f.validation.min = mn === '' ? undefined : Number(mn); f.validation.max = mx === '' ? undefined : Number(mx); await save(); };
      extra.querySelector('#numMin').onchange = s; extra.querySelector('#numMax').onchange = s;
    } else if (f.type === 'text' || f.type === 'textarea') {
      extra.innerHTML = `<div class="card" style="margin-top:14px;"><div class="field" style="margin:0;"><span class="lbl">Max length (optional)</span><input id="txtMax" type="number" value="${f.validation.maxLength ?? ''}"></div></div>`;
      extra.querySelector('#txtMax').onchange = async (e) => { f.validation.maxLength = e.target.value === '' ? undefined : Number(e.target.value); await save(); };
    } else extra.innerHTML = '';
  }

  function renderOptions(host, extra, f) {
    const list = extra.querySelector('#optList');
    list.innerHTML = '';
    (f.options || []).forEach((o, i) => {
      const flagged = f.validation.highlightWhen?.equals && f.validation.highlightWhen.equals === o.value;
      const row = document.createElement('div');
      row.className = 'opt-row' + (flagged ? ' flagged' : '');
      row.innerHTML = `
        <span class="o-dot" style="background:${flagged ? 'var(--red)' : 'var(--green)'}"></span>
        <input class="oLabel" placeholder="Label" value="${escAttr(o.label)}" style="flex:1;" />
        <input class="oValue" placeholder="value" value="${escAttr(o.value)}" style="flex:1;" />
        ${f.type === 'dropdown' ? `<label style="white-space:nowrap;color:var(--muted);font-size:11px;display:flex;align-items:center;gap:4px;"><input type="checkbox" class="oAttach" ${o.requiresAttachment ? 'checked' : ''} style="width:auto;"> needs file</label>` : ''}
        <button class="btn danger" style="height:24px;padding:0 8px;" data-del>✕</button>`;
      const s = async () => {
        o.label = row.querySelector('.oLabel').value;
        o.value = row.querySelector('.oValue').value.trim() || slug(o.label);
        const att = row.querySelector('.oAttach'); if (att) o.requiresAttachment = att.checked;
        await save(); renderPreview(extra, f);
      };
      row.querySelector('.oLabel').onchange = s;
      row.querySelector('.oValue').onchange = s;
      if (row.querySelector('.oAttach')) row.querySelector('.oAttach').onchange = s;
      row.querySelector('[data-del]').onclick = async () => { f.options.splice(i, 1); await save(); renderExtra(host, extra, f); };
      list.appendChild(row);
    });
  }

  function renderPreview(extra, f) {
    const host = extra.querySelector('#livePreview');
    if (!host) return;
    if (f.type === 'multiselect') {
      host.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">${escHtml(f.label || 'Field')} ${f.required ? '<span style="color:var(--red)">*</span>' : ''}</div>
        <div class="pill-row">${(f.options || []).slice(0, 4).map((o) => `<span class="pill">${escHtml(o.label || o.value)}</span>`).join('') || '<span style="color:var(--muted-2);font-size:12px;">no options</span>'}</div>`;
      return;
    }
    const hl = f.validation.highlightWhen?.equals;
    const flaggedOpt = (f.options || []).find((o) => o.value === hl);
    const showFlag = !!flaggedOpt;
    host.innerHTML = `
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">${escHtml(f.label || 'Field')} ${f.required ? '<span style="color:var(--red)">*</span>' : ''}</div>
      <div style="height:36px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;border-radius:7px;${showFlag ? 'background:rgba(229,103,92,.12);border:1.5px solid var(--red);' : 'background:var(--bg);border:1px solid var(--line-3);'}">
        <span style="font-size:13px;color:var(--text);">${escHtml(flaggedOpt?.label || (f.options?.[0]?.label) || '— select —')}</span><span style="color:${showFlag ? 'var(--red)' : 'var(--muted-2)'};">▾</span>
      </div>
      ${showFlag && flaggedOpt.requiresAttachment ? `<div style="display:flex;align-items:center;gap:7px;margin-top:9px;font-size:11px;color:var(--red);">${I().warn} Risk assessment required before save</div>` : ''}`;
  }

  // A field's key is the property name in project.json. Keep it unique within the schema so two
  // fields can't quietly write to the same value.
  function uniqueKey(base, self) {
    const clean = base || 'field';
    const taken = new Set(allFields().filter((x) => x !== self).map((x) => x.key).filter(Boolean));
    if (!taken.has(clean)) return clean;
    let n = 2;
    while (taken.has(`${clean}_${n}`)) n += 1;
    return `${clean}_${n}`;
  }

  async function addField(host, sec) {
    const target = sec || sections().find((s) => s.fields.some((f) => f.id === selectedId)) || sections()[0];
    if (!target) { alert('Add a section first.'); return; }
    // Deliberately no key yet: it's derived from the name the user gives the field (see
    // renderDetail). A field that's never named falls back to a generated key on save.
    const f = { id: uid('f_'), key: '', label: 'New Field', type: 'text', required: false, options: [], validation: {} };
    target.fields.push(f);
    selectedId = f.id;
    await save();
    renderSections(host); renderDetail(host);
    host.querySelector('#dName')?.focus();
  }

  function exportSchema() {
    const blob = new Blob([JSON.stringify(schema(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `schema-${base(currentPath)}.json`; a.click();
    URL.revokeObjectURL(a.href); window.setStatus?.('Schema exported');
  }
  async function copySchema() { await navigator.clipboard.writeText(JSON.stringify(schema(), null, 2)); window.setStatus?.('Schema copied'); }
  function importSchema(host) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const norm = Array.isArray(parsed.sections) ? parsed : { version: 1, sections: [{ id: uid('sec_'), title: 'Details', fields: parsed.fields || [] }] };
        window.Store.setSchemaForPath(currentPath, norm);
        selectedId = null; await save(); render(host); window.setStatus?.('Schema imported');
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    input.click();
  }

  function base(p) { return (p || '').split(/[\\/]/).filter(Boolean).pop() || p; }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.SchemaEditor = { render };
})();
