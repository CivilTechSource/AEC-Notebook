// toast.js — small, non-blocking notifications. Used to surface errors that would
// otherwise fail silently (e.g. a save failing because a cloud folder is offline).
(function () {
  function host() {
    let h = document.getElementById('toastHost');
    if (!h) { h = document.createElement('div'); h.id = 'toastHost'; document.body.appendChild(h); }
    return h;
  }

  function show(message, type = 'info', timeout = 4000) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-ico">${type === 'error' ? '⚠' : type === 'success' ? '✓' : 'ℹ'}</span><span class="toast-msg"></span><button class="toast-x">✕</button>`;
    el.querySelector('.toast-msg').textContent = message;
    el.querySelector('.toast-x').onclick = () => el.remove();
    host().appendChild(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
    return el;
  }

  const error = (m) => show(m, 'error', 6000);
  const success = (m) => show(m, 'success', 2500);
  const info = (m) => show(m, 'info');

  // Toast with an inline action button (e.g. "Undo").
  function action(message, actionLabel, fn, timeout = 7000) {
    const el = show(message, 'info', timeout);
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.onclick = () => { try { fn(); } finally { el.remove(); } };
    el.insertBefore(btn, el.querySelector('.toast-x'));
    return el;
  }

  // Catch otherwise-unhandled IPC/promise rejections so the user always gets feedback.
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason || 'Unknown error');
    error('Something went wrong: ' + msg);
  });

  // Wrap an async operation: on throw, show an error toast and rethrow-swallow.
  async function guard(label, fn) {
    try { return await fn(); }
    catch (err) { error(`${label} failed: ${err.message || err}`); return undefined; }
  }

  window.Toast = { show, error, success, info, action, guard };
})();
