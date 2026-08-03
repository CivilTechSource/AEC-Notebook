// Storm Runoff Calculator — Rational Method peak flow: Q (L/s) = C · i(mm/hr) · A(m²) / 3600.
// Runs sandboxed. When mounted on a project board it can save Q to a number field via PluginAPI.
const root = document.getElementById('root');

const SURFACES = [
  ['Asphalt / paving', 0.90], ['Roofs', 0.85], ['Compacted gravel', 0.50],
  ['Lawn / grass', 0.20], ['Woodland', 0.10], ['Custom', null],
];

const style = document.createElement('style');
style.textContent = `
  .run{display:flex;flex-direction:column;gap:9px;max-width:380px;}
  .run .row{display:flex;align-items:center;gap:10px;}
  .run .row > label{width:118px;flex:none;}
  .run input,.run select{flex:1;}
  .run .out{margin:4px 0;padding:11px 13px;background:rgba(91,140,255,.12);border:1px solid rgba(91,140,255,.3);border-radius:var(--radius);font-size:15px;color:var(--text);}
  .run .out small{color:var(--muted);font-size:12px;}
  .run .save button{flex:none;}
`;
document.head.appendChild(style);

root.innerHTML = `
  <div class="run">
    <div class="row"><label>Surface type</label>
      <select id="surf">${SURFACES.map((s, i) => `<option value="${i}">${s[0]}${s[1] != null ? ` (C=${s[1]})` : ''}</option>`).join('')}</select></div>
    <div class="row"><label>Runoff coeff. C</label><input id="C" type="number" step="0.01" min="0" max="1" value="0.90"></div>
    <div class="row"><label>Rainfall i (mm/hr)</label><input id="i" type="number" min="0" value="50"></div>
    <div class="row"><label>Area A (m²)</label><input id="A" type="number" min="0" value="1200"></div>
    <div class="out" id="out"></div>
    <div class="row save" id="saveRow" style="display:none"><label>Save Q to</label><select id="field"></select><button id="save" class="primary">Save</button></div>
    <button id="copy">Copy as Markdown</button>
  </div>`;

const $ = (s) => root.querySelector(s);
const num = (id) => parseFloat($(id).value) || 0;
const round = (n) => Math.round(n * 1000) / 1000;

function calc() {
  const C = num('#C'), i = num('#i'), A = num('#A');
  const qLs = C * i * A / 3600;      // L/s
  return { C, i, A, qLs, qm3: qLs / 1000 };
}
function render() {
  const r = calc();
  $('#out').innerHTML = `<b>Q = ${round(r.qLs)} L/s</b> &nbsp; <small>(${round(r.qm3)} m³/s)</small>`;
}
$('#surf').onchange = () => { const c = SURFACES[+$('#surf').value][1]; if (c != null) $('#C').value = c; render(); };
['#C', '#i', '#A'].forEach((id) => $(id).addEventListener('input', render));
render();

function markdown() {
  const r = calc();
  return `**Storm runoff (Rational Method)** — C=${r.C}, i=${r.i} mm/hr, A=${r.A} m² → **Q = ${round(r.qLs)} L/s** (${round(r.qm3)} m³/s)`;
}
$('#copy').onclick = () => {
  if (window.PluginAPI) window.PluginAPI.copy(markdown());
  else { navigator.clipboard?.writeText(markdown()).catch(() => {}); }
};

// Board integration: if mounted with writeable number fields, offer "Save Q to <field>".
if (window.PluginAPI) {
  window.PluginAPI.onInit(({ fields }) => {
    const nums = (fields || []).filter((f) => f.type === 'number');
    if (!nums.length) return;
    $('#field').innerHTML = nums.map((f) => `<option value="${f.key}">${f.label}</option>`).join('');
    $('#saveRow').style.display = 'flex';
    $('#save').onclick = async () => {
      const res = await window.PluginAPI.writeField($('#field').value, round(calc().qLs));
      $('#save').textContent = res && res.ok ? 'Saved ✓' : 'Failed';
      setTimeout(() => { $('#save').textContent = 'Save'; }, 1200);
    };
  });
}
