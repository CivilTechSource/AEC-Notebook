// CPD Tracker — a personal Continuing Professional Development log.
//
// Runs sandboxed. Everything it stores goes through PluginAPI: the record itself into the plugin's
// own document (storage), evidence files into the plugin's own file store (files), and the list of
// projects an entry can be attached to comes back read-only (projects).
//
// The column set is deliberately user-editable rather than hardcoded to one institution: ICE,
// IStructE, Engineers Australia and RIBA all want slightly different things recorded, and the seed
// columns below are only a starting point. Date, activity and hours are fixed because the annual
// total is computed from them.
//
// Layout is master-detail: the list stays on screen and the selected record opens in a panel on
// the right, so moving between records is one click. That panel autosaves — there is no modal in
// the sandbox to ask "save before switching?", and losing a part-written CPD record to a stray
// click is worse than writing one field too eagerly.

const root = document.getElementById('root');
const API = window.PluginAPI;

// ---------- column model ----------
// Mirrors the app's own schema field shape ({ key, label, type, options }) so this reads as native
// and could be lifted into core later. 'file' is absent on purpose: evidence is a first-class part
// of every entry with its own picker, so a file column would be a confusing second way to do it.
const TYPES = ['text', 'textarea', 'number', 'date', 'checkbox', 'dropdown', 'multiselect'];
const HAS_OPTIONS = (t) => t === 'dropdown' || t === 'multiselect';

function defaultDoc() {
  return {
    version: 1,
    settings: {
      annualTargetHours: 30,
      yearStartMonth: 1,          // 1 = calendar year; institutions differ
      columns: [
        { id: 'c1', key: 'type', label: 'Activity type', type: 'dropdown', inTable: true,
          options: ['Course / seminar', 'Conference', 'On-the-job learning', 'Self-study',
                    'Mentoring', 'Professional service', 'Technical writing'] },
        { id: 'c2', key: 'provider', label: 'Provider', type: 'text', inTable: true, options: [] },
        { id: 'c3', key: 'competency', label: 'Competencies', type: 'multiselect', inTable: false,
          options: ['Technical knowledge', 'Design', 'Management', 'Commercial', 'Communication',
                    'Health & safety', 'Sustainability', 'Ethics'] },
        { id: 'c4', key: 'reflection', label: 'Reflection / learning outcome', type: 'textarea', inTable: false, options: [] },
      ],
    },
    entries: [],
  };
}

// ---------- state ----------
let doc = null;
let projects = [];
let view = 'list';         // 'list' | 'settings'
let currentId = null;      // selected record; the side panel is open when this is set
let year = null;           // selected CPD year (the starting calendar year)
let blocked = '';          // set when storage is unavailable — the whole page goes read-only
let saving = false;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round1 = (n) => Math.round(n * 10) / 10;
const todayISO = () => new Date().toISOString().slice(0, 10);
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function fmtBytes(b) {
  if (!(b > 0)) return '';
  return b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

// Which CPD year a date falls in. With yearStartMonth = 1 this is just the calendar year; with
// anything else a date before the start month belongs to the year that began the previous January.
function cpdYearOf(iso) {
  const start = doc.settings.yearStartMonth || 1;
  const d = new Date((iso || todayISO()) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return new Date().getFullYear();
  return d.getMonth() + 1 < start ? d.getFullYear() - 1 : d.getFullYear();
}
function yearLabel(y) {
  const start = doc.settings.yearStartMonth || 1;
  return start === 1 ? String(y) : `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}
function knownYears() {
  const ys = new Set(doc.entries.map((e) => cpdYearOf(e.date)));
  ys.add(cpdYearOf(todayISO()));
  return [...ys].sort((a, b) => b - a);
}
function entriesFor(y) {
  return doc.entries.filter((e) => cpdYearOf(e.date) === y)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
const totalHours = (list) => round1(list.reduce((s, e) => s + num(e.hours), 0));

const columns = () => (doc.settings.columns || []);
const tableColumns = () => columns().filter((c) => c.inTable !== false);
const entryById = (id) => doc.entries.find((e) => e.id === id) || null;

// Render a stored value for display. Never returns markup — callers escape.
function displayValue(col, v) {
  if (v == null || v === '') return '';
  if (col.type === 'checkbox') return v ? 'Yes' : 'No';
  if (col.type === 'multiselect') return Array.isArray(v) ? v.join(', ') : String(v);
  if (col.type === 'date') return fmtDate(v);
  return String(v);
}

// ---------- persistence ----------
async function save() {
  if (blocked || saving) return false;
  saving = true;
  try {
    const res = await API.storage.set(doc);
    if (!res || !res.ok) {
      // Never leave the user believing a CPD record was filed when it wasn't.
      API.notify(`CPD Tracker could not save: ${(res && res.error) || 'unknown error'}`);
      return false;
    }
    return true;
  } finally { saving = false; }
}

// ---------- styles ----------
const style = document.createElement('style');
style.textContent = `
  /* This plugin owns a whole page (contributes.activity), so it fills the frame and scrolls its own
     panes — the host does not size an activity frame to its content. #root needs the height too, or
     the percentages below resolve against an auto-height parent and collapse. */
  html,body,#root{height:100%;overflow:hidden;}
  .cpd{display:flex;flex-direction:column;height:100%;min-height:0;}
  .cpd .head{display:flex;align-items:flex-start;gap:16px;padding:18px 24px 14px;border-bottom:1px solid var(--line-2);flex:none;flex-wrap:wrap;}
  .cpd .head h1{margin:0;font-size:19px;font-weight:600;color:var(--text);}
  .cpd .head .sub{margin-top:3px;font-size:12px;color:var(--muted);}
  .cpd .head .spacer{flex:1;}
  .cpd .acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}

  .cpd .main{flex:1;min-height:0;display:flex;}
  .cpd .listpane{flex:1;min-width:0;overflow:auto;padding:18px 24px 40px;}
  .cpd .wrap{max-width:1000px;}

  .cpd .meter{min-width:260px;}
  .cpd .meter .nums{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12px;color:var(--muted);margin-bottom:5px;}
  .cpd .meter .nums b{font-size:17px;color:var(--text);font-weight:600;}
  .cpd .bar{height:7px;border-radius:5px;background:var(--bg-card-2);overflow:hidden;border:1px solid var(--line-2);}
  .cpd .bar span{display:block;height:100%;border-radius:5px;transition:width .2s;}

  .cpd table{width:100%;border-collapse:collapse;font-size:13px;}
  .cpd th{text-align:left;font-weight:500;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted-2);padding:0 10px 8px;border-bottom:1px solid var(--line-2);white-space:nowrap;}
  .cpd td{padding:10px;border-bottom:1px solid var(--line);color:var(--text-2);vertical-align:top;}
  .cpd tbody tr{cursor:pointer;}
  .cpd tbody tr:hover td{background:var(--bg-card);color:var(--text);}
  .cpd tbody tr.sel td{background:var(--bg-card);color:var(--text);box-shadow:inset 2px 0 0 var(--accent);}
  .cpd td.t{color:var(--text);font-weight:500;}
  .cpd td.hrs{text-align:right;font-family:var(--mono);white-space:nowrap;}
  .cpd .pill{display:inline-block;font-size:11px;padding:1px 7px;border-radius:5px;background:rgba(91,140,255,.12);color:var(--accent);}
  .cpd .clip{font-size:11px;color:var(--muted);white-space:nowrap;}

  /* ---- record panel ---- */
  .cpd .side{width:430px;flex:none;display:flex;flex-direction:column;min-height:0;
    border-left:1px solid var(--line-2);background:var(--bg-panel);}
  .cpd .side[hidden]{display:none;}
  .cpd .shead{display:flex;align-items:center;gap:9px;padding:13px 16px;border-bottom:1px solid var(--line-2);flex:none;}
  .cpd .shead .stitle{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--text);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cpd .shead .sstat{font-size:11px;color:var(--muted);white-space:nowrap;}
  .cpd .shead button{height:26px;padding:0 9px;}
  .cpd .sbody{flex:1;min-height:0;overflow:auto;padding:16px 16px 34px;}
  /* 430px is too narrow for a label column, so the panel stacks its fields. */
  .cpd .side .row{flex-direction:column;align-items:stretch;gap:5px;}
  .cpd .side .row>label{width:auto;padding-top:0;}

  .cpd .grid{display:flex;flex-direction:column;gap:13px;max-width:620px;}
  .cpd .row{display:flex;align-items:flex-start;gap:12px;}
  .cpd .row>label{width:170px;flex:none;padding-top:8px;}
  .cpd .row .ctl{flex:1;min-width:0;}
  .cpd textarea{min-height:92px;resize:vertical;font-family:inherit;line-height:1.55;}
  .cpd .opts{display:flex;flex-wrap:wrap;gap:6px;}
  .cpd .opt{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-2);
    border:1px solid var(--line-3);border-radius:20px;padding:3px 11px 3px 8px;cursor:pointer;}
  .cpd .opt input{width:auto;margin:0;}
  .cpd .opt.on{border-color:var(--accent);color:var(--text);background:rgba(91,140,255,.1);}
  .cpd .chk{display:flex;align-items:center;height:30px;}
  .cpd .chk input{width:auto;}

  .cpd .ev{display:flex;flex-direction:column;gap:8px;}
  .cpd .ev .item{display:flex;align-items:center;gap:10px;padding:7px 10px;background:var(--bg-card);
    border:1px solid var(--line-2);border-radius:9px;}
  .cpd .ev .item img{width:38px;height:38px;object-fit:cover;border-radius:6px;flex:none;background:var(--bg-dark);}
  .cpd .ev .item .ico{width:38px;height:38px;border-radius:6px;flex:none;display:flex;align-items:center;
    justify-content:center;background:var(--bg-dark);color:var(--muted);font-size:10px;font-weight:600;}
  .cpd .ev .item .n{flex:1;min-width:0;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cpd .ev .item button{height:26px;padding:0 9px;flex:none;}

  .cpd .empty{padding:44px 20px;text-align:center;color:var(--muted);font-size:13px;}
  .cpd .banner{padding:11px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:12.5px;
    background:rgba(224,162,59,.12);border:1px solid rgba(224,162,59,.3);color:var(--text-2);}

  .cpd .cols{display:flex;flex-direction:column;gap:9px;}
  .cpd .col{display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--bg-card);
    border:1px solid var(--line-2);border-radius:9px;flex-wrap:wrap;}
  .cpd .col .lbl-in{flex:2;min-width:130px;}
  .cpd .col select{flex:1;min-width:120px;}
  .cpd .col .keyname{font-family:var(--mono);font-size:11px;color:var(--muted-2);flex:none;}
  .cpd .col .optin{flex-basis:100%;}
  .cpd .core{opacity:.75;}
  .cpd .sec{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-2);margin:22px 0 10px;}
  .cpd .sec:first-child{margin-top:0;}
  .cpd .danger{color:var(--red);border-color:rgba(224,90,90,.4);}
  .cpd .hint{font-size:11.5px;color:var(--muted);margin-top:5px;}
`;
document.head.appendChild(style);

const $ = (s) => root.querySelector(s);
const $$ = (s) => [...root.querySelectorAll(s)];

// ---------- shell ----------
function paint() {
  if (view === 'settings') return paintSettings();
  paintList();
}

function bannerHtml() {
  return blocked ? `<div class="banner"><b>Read-only.</b> ${esc(blocked)}</div>` : '';
}

// ---------- list ----------
function rowHtml(e) {
  const cols = tableColumns();
  return `
    <td>${esc(fmtDate(e.date))}</td>
    <td class="t">${esc(e.title || 'Untitled')}</td>
    ${cols.map((c) => `<td>${esc(displayValue(c, (e.values || {})[c.key]))}</td>`).join('')}
    <td>${e.projectName ? `<span class="pill">${esc(e.projectName)}</span>` : ''}</td>
    <td class="clip">${(e.evidence || []).length ? `${(e.evidence || []).length} file${(e.evidence || []).length === 1 ? '' : 's'}` : ''}</td>
    <td class="hrs">${round1(num(e.hours))}</td>`;
}

function headerHtml(list) {
  const total = totalHours(list);
  const target = num(doc.settings.annualTargetHours);
  const pct = target > 0 ? Math.min(100, (total / target) * 100) : 0;
  const closed = year < cpdYearOf(todayISO());
  const colour = total >= target && target > 0 ? 'var(--green)' : closed ? 'var(--red)' : 'var(--amber)';
  return `
    <div class="nums"><span><b>${round1(total)}</b> of ${round1(target)} hrs</span><span>${Math.round(pct)}%</span></div>
    <div class="bar"><span style="width:${pct}%;background:${colour}"></span></div>`;
}

function paintList() {
  const years = knownYears();
  if (year == null || !years.includes(year)) year = years[0];
  const list = entriesFor(year);
  const cols = tableColumns();

  root.innerHTML = `
    <div class="cpd">
      <div class="head">
        <div>
          <h1>CPD Log</h1>
          <div class="sub" id="count">${list.length} ${list.length === 1 ? 'entry' : 'entries'} in ${esc(yearLabel(year))}</div>
        </div>
        <div class="meter" id="meter">${headerHtml(list)}</div>
        <div class="spacer"></div>
        <div class="acts">
          <select id="yr" style="width:auto;">${years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${esc(yearLabel(y))}</option>`).join('')}</select>
          <button id="md">Copy Markdown</button>
          <button id="csv">Copy CSV</button>
          <button id="settings">Settings</button>
          <button id="add" class="primary"${blocked ? ' disabled' : ''}>Add entry</button>
        </div>
      </div>
      <div class="main">
        <div class="listpane"><div class="wrap">
          ${bannerHtml()}
          ${list.length ? `
          <table>
            <thead><tr>
              <th style="width:110px;">Date</th>
              <th>Activity</th>
              ${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}
              <th style="width:110px;">Project</th>
              <th style="width:70px;">Evidence</th>
              <th style="width:70px;text-align:right;">Hours</th>
            </tr></thead>
            <tbody>${list.map((e) => `<tr data-id="${esc(e.id)}"${e.id === currentId ? ' class="sel"' : ''}>${rowHtml(e)}</tr>`).join('')}</tbody>
          </table>` : `<div class="empty">No CPD recorded for ${esc(yearLabel(year))}.<br>Use <b>Add entry</b> to log an activity.</div>`}
        </div></div>
        <div class="side" id="side" hidden></div>
      </div>
    </div>`;

  $('#yr').onchange = async (e) => { await flush(); year = parseInt(e.target.value, 10); paint(); paintSide(); };
  $('#settings').onclick = async () => { await flush(); view = 'settings'; paint(); };
  $('#md').onclick = async () => { await flush(); API.copy(exportMarkdown(year)); };
  $('#csv').onclick = async () => { await flush(); API.copy(exportCsv(year)); };
  $('#add').onclick = addEntry;

  // Delegated so a row can be replaced in place after an edit without rebinding anything.
  const tbody = $('tbody');
  if (tbody) tbody.onclick = (ev) => { const tr = ev.target.closest('tr'); if (tr) select(tr.dataset.id); };

  paintSide();
}

async function addEntry() {
  if (blocked) return;
  await flush();
  const e = { id: uid('e_'), date: todayISO(), title: '', hours: 0, projectId: null, projectName: '', evidence: [], values: {} };
  doc.entries.push(e);
  currentId = e.id;
  await save();
  paint();
  $('#f-title')?.focus();
}

// Move the selection, saving whatever the panel was holding first.
async function select(id) {
  if (id === currentId) return;
  await flush();
  currentId = id;
  $$('tbody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === id));
  paintSide();
}

// ---------- record panel ----------
function controlFor(col, value) {
  const v = value == null ? '' : value;
  const name = `data-col="${esc(col.key)}"`;
  switch (col.type) {
    case 'textarea':
      return `<textarea ${name}>${esc(v)}</textarea>`;
    case 'number':
      return `<input type="number" step="any" ${name} value="${esc(v)}">`;
    case 'date':
      return `<input type="date" ${name} value="${esc(v)}">`;
    case 'checkbox':
      return `<div class="chk"><input type="checkbox" ${name}${v ? ' checked' : ''}></div>`;
    case 'dropdown':
      return `<select ${name}><option value="">— none —</option>${(col.options || []).map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'multiselect': {
      const on = Array.isArray(v) ? v : [];
      return `<div class="opts">${(col.options || []).map((o) => `
        <label class="opt${on.includes(o) ? ' on' : ''}"><input type="checkbox" ${name} value="${esc(o)}"${on.includes(o) ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
    }
    default:
      return `<input type="text" ${name} value="${esc(v)}">`;
  }
}

function setStat(msg) { const el = $('#sstat'); if (el) el.textContent = msg; }

function paintSide() {
  const side = $('#side');
  if (!side) return;
  const e = entryById(currentId);
  if (!e) { side.hidden = true; side.innerHTML = ''; currentId = null; return; }
  side.hidden = false;

  side.innerHTML = `
    <div class="shead">
      <div class="stitle" id="stitle">${esc(e.title || 'New CPD entry')}</div>
      <span class="sstat" id="sstat"></span>
      <button id="del" class="danger"${blocked ? ' disabled' : ''}>Delete</button>
      <button id="close" title="Close">✕</button>
    </div>
    <div class="sbody">
      <div class="grid">
        <div class="row"><label>Date</label><div class="ctl"><input type="date" id="f-date" value="${esc(e.date || '')}"></div></div>
        <div class="row"><label>Activity</label><div class="ctl"><input type="text" id="f-title" value="${esc(e.title || '')}" placeholder="What did you do?"></div></div>
        <div class="row"><label>Hours</label><div class="ctl"><input type="number" id="f-hours" step="0.25" min="0" value="${esc(e.hours ?? 0)}"></div></div>
        <div class="row"><label>Project</label><div class="ctl">
          <select id="f-project">
            <option value="">— not linked —</option>
            ${projects.map((p) => `<option value="${esc(p.id)}"${p.id === e.projectId ? ' selected' : ''}>${esc(p.name)}${p.group ? ` — ${esc(p.group)}` : ''}</option>`).join('')}
          </select>
          ${projects.length ? '' : '<div class="hint">No projects available.</div>'}
        </div></div>
        ${columns().map((c) => `<div class="row"><label>${esc(c.label)}</label><div class="ctl">${controlFor(c, (e.values || {})[c.key])}</div></div>`).join('')}
        <div class="row"><label>Evidence</label><div class="ctl">
          <div class="ev" id="ev"></div>
          <div style="margin-top:9px;"><button id="attach"${blocked ? ' disabled' : ''}>Attach file…</button></div>
          <div class="hint">Certificates, attendance records. Copied into your CPD folder, so they survive the original moving.</div>
        </div></div>
      </div>
    </div>`;

  paintEvidence(e);

  // Autosave on change (blur for text, immediately for selects and checkboxes) rather than on
  // every keystroke — the whole document is rewritten each time, so per-keystroke would be a
  // config write per character.
  side.querySelector('.sbody').addEventListener('change', () => { flush(); });
  $('#f-title').addEventListener('input', (ev) => { $('#stitle').textContent = ev.target.value || 'New CPD entry'; });
  $$('.opt input').forEach((i) => i.addEventListener('change', () => i.closest('.opt').classList.toggle('on', i.checked)));

  $('#close').onclick = async () => { await flush(); currentId = null; $$('tbody tr').forEach((tr) => tr.classList.remove('sel')); paintSide(); };
  $('#del').onclick = async () => {
    // No modal API in the sandbox, so confirmation is a second click on an armed button.
    const btn = $('#del');
    if (btn.dataset.armed) {
      for (const ev of e.evidence || []) await API.files.remove(ev.file);
      doc.entries = doc.entries.filter((x) => x.id !== e.id);
      currentId = null;
      await save();
      paint();
      return;
    }
    btn.dataset.armed = '1';
    btn.textContent = 'Confirm';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 4000);
  };
  $('#attach').onclick = async () => {
    const res = await API.files.pick();
    if (!res || !res.ok) { if (res && res.error) API.notify(`Could not attach: ${res.error}`); return; }
    if (res.cancelled) return;
    readForm(e);
    (e.evidence = e.evidence || []).push({ file: res.name, label: res.name, size: res.size });
    await save();
    refreshRow(e.id);
    paintSide();
  };
}

// Write the panel back into the record and persist it, then bring the row and the totals in step.
async function flush() {
  const e = entryById(currentId);
  if (!e || blocked || !$('#f-date')) return;
  const beforeYear = cpdYearOf(e.date);
  readForm(e);
  setStat('Saving…');
  const ok = await save();
  setStat(ok ? 'Saved' : 'Not saved');

  // Editing the date can move an entry out of the year being viewed. Follow it rather than letting
  // the row vanish with no explanation.
  const afterYear = cpdYearOf(e.date);
  if (afterYear !== beforeYear) { year = afterYear; paint(); return; }
  refreshRow(e.id);
  refreshHeader();
}

function refreshRow(id) {
  const tr = $(`tbody tr[data-id="${CSS.escape(id)}"]`);
  const e = entryById(id);
  if (!tr || !e) return;
  tr.innerHTML = rowHtml(e);
}

function refreshHeader() {
  const list = entriesFor(year);
  const meter = $('#meter');
  const count = $('#count');
  if (meter) meter.innerHTML = headerHtml(list);
  if (count) count.textContent = `${list.length} ${list.length === 1 ? 'entry' : 'entries'} in ${yearLabel(year)}`;
}

async function paintEvidence(e) {
  const host = $('#ev');
  if (!host) return;
  const files = e.evidence || [];
  if (!files.length) { host.innerHTML = '<div class="hint" style="margin:0;">Nothing attached yet.</div>'; return; }

  host.innerHTML = files.map((f, i) => `
    <div class="item" data-i="${i}">
      <div class="ico">${esc((f.file.split('.').pop() || '?').slice(0, 4).toUpperCase())}</div>
      <div class="n" title="${esc(f.file)}">${esc(f.file)}<div class="hint" style="margin:0;">${esc(fmtBytes(f.size))}</div></div>
      <button data-open>Open</button>
      <button data-rm class="danger"${blocked ? ' disabled' : ''}>✕</button>
    </div>`).join('');

  host.querySelectorAll('.item').forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector('[data-open]').onclick = () => API.files.open(files[i].file);
    el.querySelector('[data-rm]').onclick = async () => {
      const cur = entryById(currentId);
      readForm(cur);
      await API.files.remove(files[i].file);
      cur.evidence.splice(i, 1);
      await save();
      refreshRow(cur.id);
      paintSide();
    };
  });

  // Images can be previewed inline because this page's CSP allows img-src data:. Anything else
  // (a PDF certificate, most often) has to be handed to the OS via the Open button.
  files.forEach(async (f, i) => {
    if (!IMAGE_RE.test(f.file)) return;
    const res = await API.files.read(f.file);
    if (!res || !res.ok) return;
    const slot = host.querySelector(`.item[data-i="${i}"] .ico`);
    if (!slot) return;
    const img = document.createElement('img');
    img.src = res.dataUrl;
    img.alt = f.file;
    slot.replaceWith(img);
  });
}

// Pull the panel back into the entry. Called before anything that repaints, saves or switches
// record, so a value typed but not yet committed isn't quietly dropped.
function readForm(e) {
  if (!e || !$('#f-date')) return;
  e.date = $('#f-date').value || todayISO();
  e.title = $('#f-title').value.trim();
  e.hours = num($('#f-hours').value);
  const pid = $('#f-project').value;
  e.projectId = pid || null;
  e.projectName = pid ? (projects.find((p) => p.id === pid)?.name || '') : '';

  e.values = e.values || {};
  for (const c of columns()) {
    const els = $$(`[data-col="${CSS.escape(c.key)}"]`);
    if (!els.length) continue;
    if (c.type === 'multiselect') e.values[c.key] = els.filter((el) => el.checked).map((el) => el.value);
    else if (c.type === 'checkbox') e.values[c.key] = !!els[0].checked;
    else if (c.type === 'number') e.values[c.key] = els[0].value === '' ? '' : num(els[0].value);
    else e.values[c.key] = els[0].value;
  }
}

// ---------- settings ----------
function keyFrom(label, taken) {
  const base = String(label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  return k;
}

// Values left behind by a deleted column. Kept rather than destroyed — the same instinct as the
// app quarantining a corrupt config instead of treating it as absent.
function orphanKeys() {
  const live = new Set(columns().map((c) => c.key));
  const found = new Set();
  for (const e of doc.entries) for (const k of Object.keys(e.values || {})) if (!live.has(k)) found.add(k);
  return [...found];
}

function paintSettings() {
  const orphans = orphanKeys();
  root.innerHTML = `
    <div class="cpd">
      <div class="head">
        <div><h1>CPD settings</h1><div class="sub">Target, CPD year and the columns recorded against each entry</div></div>
        <div class="spacer"></div>
        <div class="acts"><button id="back">&larr; All entries</button></div>
      </div>
      <div class="main"><div class="listpane"><div class="wrap">
        ${bannerHtml()}
        <div class="sec">Annual requirement</div>
        <div class="grid">
          <div class="row"><label>Target hours per year</label><div class="ctl">
            <input type="number" id="s-target" min="0" step="0.5" value="${esc(doc.settings.annualTargetHours)}"></div></div>
          <div class="row"><label>CPD year starts</label><div class="ctl">
            <select id="s-month">${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
              .map((m, i) => `<option value="${i + 1}"${(doc.settings.yearStartMonth || 1) === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select>
            <div class="hint">Not every institution uses the calendar year.</div></div></div>
        </div>

        <div class="sec">Columns</div>
        <div class="cols">
          <div class="col core">
            <input class="lbl-in" value="Date, Activity, Hours" disabled>
            <span class="keyname">built in</span>
            <span class="hint" style="margin:0;flex-basis:100%;">Fixed — the annual total is calculated from these.</span>
          </div>
          <div id="collist"></div>
        </div>
        <div style="margin-top:11px;display:flex;gap:8px;align-items:center;">
          <button id="addcol"${blocked ? ' disabled' : ''}>Add column</button>
          ${orphans.length ? `<button id="purge" class="danger">Purge ${orphans.length} orphaned value${orphans.length === 1 ? '' : 's'}</button>` : ''}
        </div>
        ${orphans.length ? `<div class="hint">Data from deleted columns is kept, not destroyed: <span class="mono">${esc(orphans.join(', '))}</span>. Purging removes it from every entry.</div>` : ''}
      </div></div></div>
    </div>`;

  paintColumns();

  $('#back').onclick = async () => { await readSettings(); view = 'list'; paint(); };
  $('#s-target').onchange = () => readSettings();
  $('#s-month').onchange = async () => { await readSettings(); paint(); };
  $('#addcol').onclick = async () => {
    const taken = new Set(columns().map((c) => c.key));
    columns().push({ id: uid('c_'), key: keyFrom('New column', taken), label: 'New column', type: 'text', inTable: true, options: [] });
    await save();
    paint();
  };
  const purge = $('#purge');
  if (purge) purge.onclick = async () => {
    const live = new Set(columns().map((c) => c.key));
    for (const e of doc.entries) for (const k of Object.keys(e.values || {})) if (!live.has(k)) delete e.values[k];
    await save();
    paint();
  };
}

function paintColumns() {
  const host = $('#collist');
  host.innerHTML = columns().map((c) => `
    <div class="col" data-id="${esc(c.id)}" style="margin-bottom:9px;">
      <input class="lbl-in" data-label value="${esc(c.label)}"${blocked ? ' disabled' : ''}>
      <select data-type${blocked ? ' disabled' : ''}>${TYPES.map((t) => `<option value="${t}"${c.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <span class="keyname" title="Stays fixed so existing entries keep their data">${esc(c.key)}</span>
      <label class="opt${c.inTable !== false ? ' on' : ''}"><input type="checkbox" data-intable${c.inTable !== false ? ' checked' : ''}>in table</label>
      <button data-del class="danger"${blocked ? ' disabled' : ''}>Remove</button>
      ${HAS_OPTIONS(c.type) ? `<input class="optin" data-options value="${esc((c.options || []).join(', '))}" placeholder="Comma-separated options"${blocked ? ' disabled' : ''}>` : ''}
    </div>`).join('');

  host.querySelectorAll('.col').forEach((el) => {
    const col = columns().find((c) => c.id === el.dataset.id);
    el.querySelector('[data-label]').onchange = async (ev) => { col.label = ev.target.value.trim() || col.label; await save(); paintColumns(); };
    el.querySelector('[data-type]').onchange = async (ev) => { col.type = ev.target.value; await save(); paintColumns(); };
    el.querySelector('[data-intable]').onchange = async (ev) => { col.inTable = ev.target.checked; await save(); paintColumns(); };
    const opts = el.querySelector('[data-options]');
    if (opts) opts.onchange = async (ev) => { col.options = ev.target.value.split(',').map((s) => s.trim()).filter(Boolean); await save(); paintColumns(); };
    el.querySelector('[data-del]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Confirm';
        setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Remove'; } }, 4000);
        return;
      }
      doc.settings.columns = columns().filter((c) => c.id !== col.id);
      await save();
      paint();
    };
  });
}

async function readSettings() {
  if (!$('#s-target')) return;
  doc.settings.annualTargetHours = num($('#s-target').value);
  doc.settings.yearStartMonth = parseInt($('#s-month').value, 10) || 1;
  await save();
}

// ---------- export ----------
function exportRows(y) {
  const cols = columns();
  const header = ['Date', 'Activity', 'Hours', 'Project', ...cols.map((c) => c.label), 'Evidence'];
  const rows = entriesFor(y).map((e) => [
    e.date || '', e.title || '', String(round1(num(e.hours))), e.projectName || '',
    ...cols.map((c) => displayValue(c, (e.values || {})[c.key])),
    (e.evidence || []).map((f) => f.file).join('; '),
  ]);
  return { header, rows };
}

function exportCsv(y) {
  const { header, rows } = exportRows(y);
  const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const total = totalHours(entriesFor(y));
  return [header, ...rows, [], ['Total hours', '', String(total)], ['Annual target', '', String(round1(num(doc.settings.annualTargetHours)))]]
    .map((r) => r.map(cell).join(',')).join('\r\n');
}

function exportMarkdown(y) {
  const { header, rows } = exportRows(y);
  const total = totalHours(entriesFor(y));
  const target = round1(num(doc.settings.annualTargetHours));
  const esc2 = (v) => String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  return [
    `## CPD record — ${yearLabel(y)}`,
    '',
    `**${total} of ${target} hours** across ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}.`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc2).join(' | ')} |`),
  ].join('\n');
}

// ---------- boot ----------
// The host wraps this file in a bare try/catch, so an uncaught throw here replaces the whole page
// with an error dump. Every failure below degrades to a read-only page with an explanation instead.
async function init(ctx) {
  doc = defaultDoc();

  if (!API || !API.storage) {
    blocked = 'This build of the app does not provide plugin storage, so nothing can be saved.';
  } else {
    const res = await API.storage.get();
    if (!res || !res.ok) {
      blocked = res && res.error === 'permission denied'
        ? 'CPD Tracker does not have the "storage" permission, so entries cannot be saved.'
        : `Could not read the CPD record: ${(res && res.error) || 'unknown error'}`;
    } else if (res.data && typeof res.data === 'object') {
      const d = res.data;
      doc = {
        version: 1,
        settings: { ...defaultDoc().settings, ...(d.settings || {}) },
        entries: Array.isArray(d.entries) ? d.entries : [],
      };
      if (!Array.isArray(doc.settings.columns)) doc.settings.columns = defaultDoc().settings.columns;
    }
  }

  if (API && API.listProjects) {
    const pr = await API.listProjects();
    if (pr && pr.ok) projects = pr.projects || [];
  }

  // A board mount would be a second live frame on the same document — say so rather than let two
  // copies race each other's writes.
  if (ctx && ctx.mode === 'board') blocked = 'Open CPD from the ribbon to edit your log.';

  paint();
}

if (API) API.onInit((ctx) => { init(ctx).catch((err) => { blocked = String(err.message || err); doc = doc || defaultDoc(); paint(); }); });
else { blocked = 'Not running inside AEC Notebook.'; doc = defaultDoc(); paint(); }
