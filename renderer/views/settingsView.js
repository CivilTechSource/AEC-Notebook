// settingsView.js — appearance. What a note looks like, and the escape hatch for everything else.
//
// This page writes ONLY to CSS custom properties on :root. It does not add stylesheet rules and it
// does not touch component CSS, which is what keeps it from drifting as the app changes: a control
// here is a token in renderer/styles/tokens.css, and if the token disappears the control stops
// having an effect rather than breaking a layout.
//
// Values live in settings.json under `appearance`, so they travel with the rest of the config and
// are readable/diffable like everything else this app stores.
(function () {
  const I = () => window.ICON;
  const S = () => window.Store.state.settings;

  // key -> { css, def, ... }. `css` is the token the value is written to; `def` is what tokens.css
  // already says, and is also what "Reset" restores by REMOVING the override rather than writing
  // the default back — so a later change to tokens.css reaches anyone on defaults.
  const FIELDS = {
    editorFont:    { css: '--editor-font',    def: 'var(--mono)' },
    editorSize:    { css: '--editor-fs',      def: '14px',  unit: 'px', min: 11, max: 24 },
    editorLine:    { css: '--editor-lh',      def: '1.7',   unit: '',   min: 1.2, max: 2.4, step: 0.05 },
    editorWeight:  { css: '--editor-weight',  def: '400' },
    editorMeasure: { css: '--editor-measure', def: '780px', unit: 'px', min: 560, max: 1400, step: 20 },
    headingScale:  { css: '--heading-scale',  def: '1',     unit: '',   min: 0.8, max: 1.6, step: 0.05 },
    accent:        { css: '--accent',         def: '#5b8cff' },
  };

  // Families offered by name. System stacks only — the app ships no webfonts and must render the
  // same offline, so anything here has to already be on the machine. The stack ends in a generic
  // family, so a missing font degrades rather than falling back to Times.
  const FONTS = [
    { label: 'Monospace (default)', value: 'var(--mono)' },
    { label: 'System sans',         value: "'Segoe UI', system-ui, -apple-system, sans-serif" },
    { label: 'Serif',               value: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
    { label: 'Humanist sans',       value: "'Optima', 'Segoe UI', Candara, system-ui, sans-serif" },
    { label: 'Grotesque',           value: "'Inter', 'Helvetica Neue', Arial, system-ui, sans-serif" },
  ];

  const WEIGHTS = [
    { label: 'Light', value: '300' },
    { label: 'Normal', value: '400' },
    { label: 'Medium', value: '500' },
  ];

  // A small, deliberately limited palette. An arbitrary colour picker is one line of code and a
  // permanent accessibility problem — every one of these clears 4.5:1 against both themes'
  // canvases, which a freely chosen colour will not.
  const ACCENTS = [
    { label: 'Blue',   value: '#5b8cff', hover: '#6e9bff' },
    { label: 'Violet', value: '#9b6bd4', hover: '#ab7ee0' },
    { label: 'Teal',   value: '#3fa4b4', hover: '#4fb6c6' },
    { label: 'Green',  value: '#4f9e68', hover: '#5fb87a' },
    { label: 'Amber',  value: '#c08529', hover: '#d4953a' },
    { label: 'Red',    value: '#d4564b', hover: '#e5675c' },
  ];

  function appearance() {
    if (!S().appearance || typeof S().appearance !== 'object') S().appearance = {};
    return S().appearance;
  }

  /**
   * Push the saved appearance onto :root.
   *
   * Exported and called at boot BEFORE the first paint of a note, so the editor never renders at
   * the default size and then jumps. An unset value removes its override rather than writing the
   * default in, which keeps tokens.css authoritative for anyone who hasn't chosen.
   */
  function apply() {
    const a = appearance();
    const root = document.documentElement.style;
    for (const [key, spec] of Object.entries(FIELDS)) {
      const v = a[key];
      if (v == null || v === '') root.removeProperty(spec.css);
      else root.setProperty(spec.css, String(v));
    }
    // The accent hover shade is derived, not chosen: two controls for one decision is two chances
    // to end up with a hover state that doesn't match its base.
    const accent = ACCENTS.find((c) => c.value === a.accent);
    if (accent) root.setProperty('--accent-h', accent.hover);
    else root.removeProperty('--accent-h');

    // Plugin iframes get the tokens copied across, so they have to be told too.
    window.PluginBridge?.broadcastTheme?.();
  }

  // ---------- the user's own stylesheet ----------
  // Injected as text into a <style> that stays LAST in <head>, so it wins on equal specificity
  // without anyone having to write !important.
  async function loadUserCss() {
    let css = '';
    try { css = await window.api.readUserCss(); } catch { /* absent or unreadable: nothing to add */ }
    let el = document.getElementById('userCss');
    if (!el) {
      el = document.createElement('style');
      el.id = 'userCss';
      document.head.appendChild(el);
    }
    el.textContent = css;
    return css;
  }

  // ---------- page ----------
  function render(host) {
    const a = appearance();
    host.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">Settings</div>
          <div class="page-desc">How notes look. Where they're stored is on the <b>Storage &amp; Files</b> page.</div>
        </div>
        <div class="head-actions">
          <button class="btn" id="setReset">Reset to defaults</button>
        </div>
      </div>
      <div class="page-body" style="padding:24px 28px 48px;">
        <div style="max-width:720px;">

          <div class="section-label">Theme</div>
          <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:26px;">
            <span class="lib-ico">${I().palette}</span>
            <div style="flex:1;">
              <div class="mc-title">Light / dark</div>
              <div class="mc-sub">Also on the ribbon, at the bottom.</div>
            </div>
            <button class="btn" id="setTheme"></button>
          </div>

          <div class="section-label">Accent colour</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
            Links, selection, the active tab. These six are checked for contrast against both themes.
          </div>
          <div id="setAccents" class="accent-row"></div>

          <div class="section-label">Note text</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
            Applies to both Edit and Reading — they share the same values so switching between them
            doesn't reflow your text.
          </div>
          <div class="card" id="setType"></div>

          <div class="section-label">Preview</div>
          <div class="set-preview note-reading" id="setPreview"></div>

          <div class="section-label">Your own CSS</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
            Everything above is a CSS variable. For anything not offered here, edit
            <span class="mono" id="setCssPath">custom.css</span> — it's loaded last, so it wins.
          </div>
          <div class="maint-card">
            <div class="maint-ico" style="background:var(--accent-tint);color:var(--accent);">${I().template}</div>
            <div style="flex:1;">
              <div class="mc-title">custom.css</div>
              <div class="mc-sub" id="setCssState">Checking…</div>
            </div>
            <button class="btn" id="setCssReload">Reload</button>
            <button class="btn primary" id="setCssOpen">Edit…</button>
          </div>
        </div>
      </div>`;

    renderAccents(host);
    renderType(host);
    renderPreview(host);
    wireTheme(host);
    wireUserCss(host);

    host.querySelector('#setReset').onclick = async () => {
      const ok = await window.Modal.confirm({
        title: 'Reset appearance?',
        body: 'Font, size, spacing, column width and accent colour go back to the defaults. Your custom.css is not touched.',
        okText: 'Reset',
      });
      if (!ok) return;
      S().appearance = {};
      apply();
      await window.Store.saveSettings();
      render(host);
      window.setStatus?.('Appearance reset');
    };
  }

  function wireTheme(host) {
    const btn = host.querySelector('#setTheme');
    const label = () => { btn.textContent = S().theme === 'light' ? 'Switch to dark' : 'Switch to light'; };
    label();
    btn.onclick = () => { document.getElementById('themeToggle')?.click(); label(); renderPreview(host); };
  }

  function renderAccents(host) {
    const wrap = host.querySelector('#setAccents');
    const current = appearance().accent || FIELDS.accent.def;
    wrap.innerHTML = '';
    for (const c of ACCENTS) {
      const b = document.createElement('button');
      b.className = 'accent-swatch' + (c.value === current ? ' on' : '');
      b.style.background = c.value;
      b.title = c.label;
      b.setAttribute('aria-label', c.label);
      b.onclick = () => set(host, 'accent', c.value, { rerender: true });
      wrap.appendChild(b);
    }
  }

  function renderType(host) {
    const a = appearance();
    const card = host.querySelector('#setType');
    card.innerHTML = `
      <label class="field"><span class="lbl">Font</span>
        <select id="sFont">${FONTS.map((f) => `<option value="${escAttr(f.value)}"${(a.editorFont || FIELDS.editorFont.def) === f.value ? ' selected' : ''}>${escHtml(f.label)}</option>`).join('')}</select>
      </label>
      <label class="field"><span class="lbl">Weight</span>
        <select id="sWeight">${WEIGHTS.map((w) => `<option value="${w.value}"${(a.editorWeight || FIELDS.editorWeight.def) === w.value ? ' selected' : ''}>${w.label}</option>`).join('')}</select>
      </label>
      ${slider('sSize', 'Size', 'editorSize', a)}
      ${slider('sLine', 'Line spacing', 'editorLine', a)}
      ${slider('sHead', 'Heading size', 'headingScale', a)}
      ${slider('sMeasure', 'Column width', 'editorMeasure', a)}`;

    card.querySelector('#sFont').onchange = (e) => set(host, 'editorFont', e.target.value);
    card.querySelector('#sWeight').onchange = (e) => set(host, 'editorWeight', e.target.value);
    bindSlider(host, card, '#sSize', 'editorSize');
    bindSlider(host, card, '#sLine', 'editorLine');
    bindSlider(host, card, '#sHead', 'headingScale');
    bindSlider(host, card, '#sMeasure', 'editorMeasure');
  }

  function slider(id, label, key, a) {
    const spec = FIELDS[key];
    const value = parseFloat(a[key] != null ? a[key] : spec.def);
    return `
      <label class="field set-slider"><span class="lbl">${escHtml(label)}<span class="set-val" data-for="${id}">${fmt(value, spec)}</span></span>
        <input type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step || 1}" value="${value}" />
      </label>`;
  }

  function fmt(value, spec) { return spec.unit === 'px' ? `${Math.round(value)}px` : String(Math.round(value * 100) / 100); }

  function bindSlider(host, card, sel, key) {
    const spec = FIELDS[key];
    const el = card.querySelector(sel);
    const out = card.querySelector(`.set-val[data-for="${el.id}"]`);
    // input -> live token + preview (no disk write); change -> persist. Dragging a slider fires
    // input continuously, and a settings.json write per pixel is the same mistake the schema
    // editor made per keystroke.
    el.oninput = () => {
      const v = parseFloat(el.value);
      out.textContent = fmt(v, spec);
      appearance()[key] = spec.unit === 'px' ? `${Math.round(v)}px` : String(v);
      apply();
      renderPreview(host);
    };
    el.onchange = () => window.Store.saveSettings();
  }

  async function set(host, key, value, opts = {}) {
    appearance()[key] = value;
    apply();
    if (opts.rerender) renderAccents(host);
    renderPreview(host);
    await window.Store.saveSettings();
  }

  // A real note, rendered through the real pipeline, so what you see is what a note will do —
  // including the heading scale and the code/quote styling.
  const SAMPLE = [
    '# Site visit — Riverside Depot',
    '',
    'Headwall to the **north culvert** is scoured; see [[Drainage survey]] and the photo below.',
    '',
    '## Actions',
    '',
    '- [x] Measure invert levels',
    '- [ ] Chase RFI with the contractor #rfi',
    '',
    '> [!warning] Access',
    '> Gate code changes on Monday.',
    '',
    '`Q = CiA` — rational method, `C = 0.85`.',
  ].join('\n');

  function renderPreview(host) {
    const el = host.querySelector('#setPreview');
    if (!el) return;
    el.innerHTML = window.MD.render(SAMPLE);
    // No project context: embeds decline politely and checkboxes stay read-only, which is right
    // for a preview — a tick here would have nowhere to be written.
    window.MD.enhance(el, {});
  }

  function wireUserCss(host) {
    const state = host.querySelector('#setCssState');
    const pathEl = host.querySelector('#setCssPath');

    window.api.userCssPath()
      .then((p) => { if (p && pathEl.isConnected) pathEl.textContent = p; })
      .catch(() => {});

    const report = (css) => {
      if (!state.isConnected) return;
      const rules = (css.match(/\{/g) || []).length;
      state.textContent = css.trim()
        ? `Loaded — ${rules} rule${rules === 1 ? '' : 's'}. Applied after everything else.`
        : 'Not created yet. Click Edit to start one, with the tokens documented in it.';
    };

    loadUserCss().then(report);

    host.querySelector('#setCssReload').onclick = async () => {
      const css = await loadUserCss();
      report(css);
      window.Toast?.success('custom.css reloaded');
    };
    host.querySelector('#setCssOpen').onclick = async () => {
      try { await window.api.openUserCss(); }
      catch (err) { window.Toast?.error('Could not open custom.css: ' + (err.message || err)); return; }
      window.Toast?.info('Save the file, then click Reload to see your changes.');
    };
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.SettingsView = { render, apply, loadUserCss };
})();
