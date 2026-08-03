// modal.js — lightweight promise-based dialogs (Electron has no window.prompt).
(function () {
  function backdrop() {
    const b = document.createElement('div');
    b.className = 'modal-backdrop';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'true');
    return b;
  }

  // Keep Tab inside the dialog while it's open, and hand focus back to wherever it came from.
  // Without this, tabbing walks into the page behind the modal and focus is lost on close.
  function trapFocus(b) {
    const returnTo = document.activeElement;
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const focusables = [...b.querySelectorAll('button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    b.addEventListener('keydown', onKey);
    return () => { try { returnTo?.focus?.(); } catch { /* gone */ } };
  }

  // Text prompt -> resolves to string or null (cancel).
  function prompt({ title = 'Enter value', label = '', value = '', placeholder = '', okText = 'OK' } = {}) {
    return new Promise((resolve) => {
      const b = backdrop();
      b.innerHTML = `
        <div class="modal">
          <h3>${esc(title)}</h3>
          ${label ? `<div class="lbl" style="margin-bottom:6px;color:var(--muted);font-size:11px;">${esc(label)}</div>` : ''}
          <input id="mInput" placeholder="${esc(placeholder)}" value="${escAttr(value)}" />
          <div class="row" style="justify-content:flex-end;margin-top:16px;">
            <button class="btn" id="mCancel">Cancel</button>
            <button class="btn primary" id="mOk">${esc(okText)}</button>
          </div>
        </div>`;
      document.body.appendChild(b);
      const restoreFocus = trapFocus(b);
      const input = b.querySelector('#mInput');
      input.focus(); input.select();
      const done = (val) => { b.remove(); restoreFocus(); resolve(val); };
      b.querySelector('#mCancel').onclick = () => done(null);
      b.querySelector('#mOk').onclick = () => done(input.value.trim() || null);
      b.onclick = (e) => { if (e.target === b) done(null); };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(input.value.trim() || null);
        if (e.key === 'Escape') done(null);
      });
    });
  }

  // Confirm -> resolves boolean. `cancelText` matters when the choice isn't "do it / don't":
  // for a two-way decision, a button labelled "Cancel" hides what declining actually does.
  function confirm({ title = 'Are you sure?', body = '', okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      const b = backdrop();
      b.innerHTML = `
        <div class="modal">
          <h3>${esc(title)}</h3>
          ${body ? `<div style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:8px;">${esc(body)}</div>` : ''}
          <div class="row" style="justify-content:flex-end;margin-top:16px;">
            <button class="btn" id="mCancel">${esc(cancelText)}</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" id="mOk">${esc(okText)}</button>
          </div>
        </div>`;
      document.body.appendChild(b);
      const restoreFocus = trapFocus(b);
      const done = (val) => { b.remove(); restoreFocus(); resolve(val); };
      b.querySelector('#mCancel').onclick = () => done(false);
      b.querySelector('#mOk').onclick = () => done(true);
      b.onclick = (e) => { if (e.target === b) done(false); };
      b.querySelector('#mOk').focus();
      // Escape must dismiss a confirm too — it only worked in prompt().
      b.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    });
  }

  function esc(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.Modal = { prompt, confirm };
})();
