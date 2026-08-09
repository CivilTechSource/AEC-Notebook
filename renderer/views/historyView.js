// historyView.js — browse a note's snapshots and put one back.
//
// Restoring writes the old text back through the ordinary save path, which snapshots the current
// version on the way past. So a restore is itself undoable, and there is only one write path.
(function () {
  let backdrop = null;

  function close() {
    backdrop?.remove();
    backdrop = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

  /**
   * @param {object} project
   * @param {string} noteName
   * @param {() => string} getCurrent   the live buffer, so the diff reflects unsaved edits
   * @param {(text:string) => void} onRestore
   */
  async function open(project, noteName, getCurrent, onRestore) {
    close();

    let snaps = [];
    try { snaps = await window.api.listSnapshots(project.path, noteName); }
    catch (err) { window.Toast?.error('Could not read history: ' + (err.message || err)); return; }

    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Version history');
    backdrop.innerHTML = `
      <div class="modal hist-modal">
        <div class="hist-head">
          <h3 style="margin:0;">Version history</h3>
          <span class="hist-note mono"></span>
          <span style="flex:1"></span>
          <button class="btn" id="histClose">Close</button>
        </div>
        <div class="hist-body">
          <div class="hist-list" id="histList"></div>
          <div class="hist-diff" id="histDiff"></div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('.hist-note').textContent = noteName;
    backdrop.querySelector('#histClose').onclick = close;
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey, true);

    const listEl = backdrop.querySelector('#histList');
    const diffEl = backdrop.querySelector('#histDiff');

    if (!snaps.length) {
      listEl.innerHTML = '<div class="rb-empty">No earlier versions yet.</div>';
      diffEl.innerHTML = `<div class="rb-empty">A version is kept before each save, at most once every
        few minutes. Edit this note and come back.</div>`;
      return;
    }

    listEl.innerHTML = snaps.map((s, i) => `
      <button class="hist-row${i === 0 ? ' active' : ''}" data-ts="${s.ts}">
        <span class="hist-when">${escHtml(relative(s.ts))}</span>
        <span class="hist-abs mono">${escHtml(absolute(s.ts))}</span>
      </button>`).join('');

    listEl.querySelectorAll('.hist-row').forEach((row) => {
      row.onclick = () => {
        listEl.querySelectorAll('.hist-row').forEach((r) => r.classList.toggle('active', r === row));
        showDiff(Number(row.dataset.ts));
      };
    });

    async function showDiff(ts) {
      diffEl.innerHTML = '<div class="rb-empty">Loading…</div>';
      let old;
      try { old = await window.api.readSnapshot(project.path, noteName, ts); }
      catch (err) { diffEl.innerHTML = `<div class="rb-empty">Could not read that version: ${escHtml(err.message || String(err))}</div>`; return; }
      if (!backdrop) return;                      // closed while loading

      const current = getCurrent();
      // One diff, two consumers. This ran diffLines twice over the same pair of texts, which on a
      // long note is the whole cost of opening the panel paid twice.
      const changes = window.Diff.diffLines(old, current);
      const rows = window.Diff.collapse(changes);
      const stats = window.Diff.summarise(changes);

      const head = `
        <div class="hist-diff-head">
          <span class="hist-stat hist-del">−${stats.removed}</span>
          <span class="hist-stat hist-add">+${stats.added}</span>
          <span class="hist-vs">this version vs. what's open now</span>
          <span style="flex:1"></span>
          <button class="btn primary" id="histRestore">Restore this version</button>
        </div>`;

      const body = stats.added + stats.removed === 0
        ? '<div class="rb-empty">Identical to the current note.</div>'
        : `<div class="hist-lines">${rows.map(renderRow).join('')}</div>`;

      diffEl.innerHTML = head + body;
      diffEl.querySelector('#histRestore').onclick = async () => {
        const ok = await window.Modal.confirm({
          title: 'Restore this version?',
          body: `“${noteName.replace(/\.md$/, '')}” will be replaced with the version from ${absolute(ts)}. `
              + 'The current text is kept in the history, so this can be undone from here.',
          okText: 'Restore',
        });
        if (!ok) return;
        onRestore(old);
        close();
        window.Toast?.success('Restored the version from ' + relative(ts));
      };
    }

    showDiff(snaps[0].ts);
  }

  function renderRow(r) {
    if (r.type === 'gap') return `<div class="hist-line hist-gap">⋯ ${escHtml(r.text)}</div>`;
    const sign = r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' ';
    return `<div class="hist-line hist-${r.type}"><span class="hist-sign">${sign}</span><span class="hist-text">${escHtml(r.text) || '&nbsp;'}</span></div>`;
  }

  function absolute(ts) {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  function relative(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  window.HistoryView = { open, close };
})();
