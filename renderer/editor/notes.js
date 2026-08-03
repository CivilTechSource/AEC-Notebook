// notes.js — Obsidian-style note editor: inline title (renames file), Edit/Reading toggle,
// markdown reading view with [[wikilinks]] + #tags, and a backlinks panel. Auto-saves.
(function () {
  function noteId(project, name) { return `note:${project.path}:${name}`; }

  function open(project, name, opts = {}) {
    window.Tabs.open({
      id: noteId(project, name), title: name.replace(/\.md$/, ''), icon: window.ICON.note,
      newTab: !!opts.newTab, toSide: !!opts.toSide,
      render: (pane, tab) => renderEditor(pane, tab, project, name, opts),
    });
  }

  async function renderEditor(pane, tab, project, name, opts) {
    let content = '';
    try { content = await window.api.readNote(project.path, name); }
    catch (err) { window.Toast?.error('Could not open note: ' + err.message); }
    const state = { name, mode: opts.isNew ? 'edit' : 'edit' };

    pane.innerHTML = `
      <div class="note-editor">
        <div class="note-topbar">
          <div class="note-meta mono" id="noteMeta"></div>
          <div class="seg">
            <button class="seg-btn" data-mode="edit">Edit</button>
            <button class="seg-btn" data-mode="reading">Reading</button>
          </div>
        </div>
        <input class="note-title" id="noteTitle" placeholder="Untitled" />
        <textarea class="note-body" id="noteBody" placeholder="Start writing…  [[link]] to notes, #tag to categorise"></textarea>
        <div class="note-reading" id="noteReading" hidden></div>
        <div class="note-backlinks" id="noteBacklinks" hidden></div>
        <div class="note-foot"><span id="noteStatus"></span><span style="flex:1"></span><span id="noteWords" class="mono"></span></div>
      </div>`;

    const titleEl = pane.querySelector('#noteTitle');
    const bodyEl = pane.querySelector('#noteBody');
    const readEl = pane.querySelector('#noteReading');
    const metaEl = pane.querySelector('#noteMeta');
    const statusEl = pane.querySelector('#noteStatus');
    const wordsEl = pane.querySelector('#noteWords');

    titleEl.value = state.name.replace(/\.md$/, '');
    bodyEl.value = content;
    const updateMeta = () => { metaEl.textContent = `${project.name}/notes/${state.name}`; };
    const updateWords = () => { wordsEl.textContent = (bodyEl.value.trim() ? bodyEl.value.trim().split(/\s+/).length : 0) + ' words'; };
    updateMeta(); updateWords();
    const flash = (m) => { statusEl.textContent = m; statusEl.style.color = 'var(--green)'; clearTimeout(flash._t); flash._t = setTimeout(() => { if (statusEl.isConnected) statusEl.textContent = ''; }, 1200); };

    const saveBody = debounce(async () => {
      try { await window.api.writeNote(project.path, state.name, bodyEl.value); }
      catch (err) { window.Toast?.error('Could not save note: ' + err.message); return; }
      flash('saved'); window.setStatus?.('Saved ' + state.name);
    }, 500);
    bodyEl.addEventListener('input', () => { updateWords(); saveBody(); });
    // Closing the tab (or quitting) inside the 500 ms debounce window would otherwise drop
    // the last keystrokes — flush synchronously on teardown.
    window.Tabs.setDestroyHook(tab.id, () => saveBody.flush());
    // Backlinks depend on OTHER notes, which may have changed while this tab sat in the
    // background — recompute when it comes back to the front.
    window.Tabs.setActivateHook(tab.id, () => { if (bodyEl.isConnected) refreshBacklinks(); });
    bodyEl.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveBody(); } });
    window.Attach.wireEditor(bodyEl, project);   // drop / paste images & files

    // inline title rename
    const applyRename = async () => {
      const newBase = titleEl.value.trim();
      const oldBase = state.name.replace(/\.md$/, '');
      if (!newBase || newBase === oldBase) return;
      saveBody.flush();                       // don't let a pending write land on the old name
      let finalName;
      try { finalName = await window.api.renameNote(project.path, state.name, newBase); }
      catch (err) { window.Toast?.error('Rename failed: ' + err.message); return; }
      const oldId = noteId(project, state.name);
      state.name = finalName;
      titleEl.value = finalName.replace(/\.md$/, '');
      updateMeta();
      window.Tabs.rekey(oldId, noteId(project, finalName), finalName.replace(/\.md$/, ''));
      flash('renamed');
      await offerLinkRewrite(oldBase, finalName.replace(/\.md$/, ''));
    };

    // Renaming a note leaves every [[old name]] dangling — clicking one would silently create a
    // new empty note. Offer to repoint them.
    async function offerLinkRewrite(oldBase, newBase) {
      let backlinks = [];
      try { backlinks = await window.api.backlinks(project.path, oldBase); } catch { return; }
      if (!backlinks.length) return;
      const n = backlinks.length;
      const ok = await window.Modal.confirm({
        title: 'Update links to this note?',
        body: `${n} note${n === 1 ? '' : 's'} link to “${oldBase}”. Repoint them at “${newBase}”?`,
        okText: 'Update links',
      });
      if (!ok) return;
      try {
        const res = await window.api.rewriteWikilinks(project.path, oldBase, newBase);
        window.Toast?.success(`Updated ${res.count} link${res.count === 1 ? '' : 's'} in ${res.files.length} note${res.files.length === 1 ? '' : 's'}.`);
        // Those notes may be open in other tabs holding the pre-rewrite text. Without this they
        // keep a stale buffer and the next keystroke there silently undoes the rewrite.
        // (The fs watcher can't help: these are our own writes, so it suppresses them.)
        for (const file of res.files) {
          window.FsWatch?.dispatch({ kind: 'note', projectPath: project.path, noteName: file });
        }
      } catch (err) { window.Toast?.error('Could not update links: ' + (err.message || err)); }
      refreshBacklinks();
    }
    titleEl.addEventListener('change', applyRename);
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyRename(); bodyEl.focus(); } });

    // ----- mode toggle -----
    const setMode = async (mode) => {
      state.mode = mode;
      pane.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      const reading = mode === 'reading';
      bodyEl.hidden = reading;
      readEl.hidden = !reading;
      if (reading) {
        saveBody.flush?.();
        try { await window.api.writeNote(project.path, state.name, bodyEl.value); } catch { /* toast already */ }
        readEl.innerHTML = window.MD.render(bodyEl.value);
        wireReadingLinks(readEl, project);
        window.Attach.resolveReadingView(readEl, project);   // load attachment images, wire file links
      }
      refreshBacklinks();
    };
    pane.querySelectorAll('.seg-btn').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
    setMode(state.mode);

    // ----- backlinks -----
    async function refreshBacklinks() {
      const host = pane.querySelector('#noteBacklinks');
      let links = [];
      try { links = await window.api.backlinks(project.path, state.name); } catch { /* ignore */ }
      if (!links.length) { host.hidden = true; host.innerHTML = ''; return; }
      host.hidden = false;
      host.innerHTML = `<div class="bl-head">🔗 ${links.length} backlink${links.length === 1 ? '' : 's'}</div>` +
        links.map((l) => `<div class="bl-row" data-note="${escAttr(l.noteName)}"><span class="bl-name">${escHtml(l.noteName.replace(/\.md$/, ''))}</span><span class="bl-snip">${escHtml(l.snippet)}</span></div>`).join('');
      host.querySelectorAll('.bl-row').forEach((row) => row.onclick = () => open(project, row.dataset.note));
    }
    refreshBacklinks();

    // ----- changed on disk -----
    // Someone edited this note in another editor. Reload silently if the user has no unsaved
    // work; otherwise offer the choice rather than picking a side for them.
    let dirty = false;
    bodyEl.addEventListener('input', () => { dirty = true; });
    const originalSave = saveBody;
    const onExternal = async (change) => {
      if (change.kind !== 'note' || change.projectPath !== project.path || change.noteName !== state.name) return;
      if (!bodyEl.isConnected) return;
      let disk = '';
      try { disk = await window.api.readNote(project.path, state.name); } catch { return; }
      if (disk === bodyEl.value) { dirty = false; return; }
      if (!dirty) { bodyEl.value = disk; updateWords(); if (state.mode === 'reading') setMode('reading'); flash('reloaded from disk'); return; }
      const keepMine = await window.Modal.confirm({
        title: 'This note changed on disk',
        body: `“${state.name}” was edited outside the app while you had unsaved changes. Keep your version, or discard it and load the one on disk?`,
        okText: 'Keep mine',
        cancelText: 'Load from disk',
      });
      if (keepMine) { originalSave.flush(); }
      else { bodyEl.value = disk; dirty = false; updateWords(); if (state.mode === 'reading') setMode('reading'); flash('loaded from disk'); }
    };
    window.FsWatch?.subscribe(onExternal, bodyEl);

    if (opts.isNew) setTimeout(() => { titleEl.focus(); titleEl.select(); }, 0);
  }

  // Wikilink + tag clicks inside the reading view.
  function wireReadingLinks(readEl, project) {
    readEl.querySelectorAll('a.wikilink').forEach((a) => {
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const want = a.dataset.note;
        const notes = await window.api.listNotes(project.path);
        const match = notes.find((n) => n.replace(/\.md$/, '').toLowerCase() === want.toLowerCase());
        if (match) { open(project, match); return; }
        // create on the fly (Obsidian behaviour)
        const created = await window.api.createNote(project.path, want);
        open(project, created, { isNew: true });
      });
    });
    readEl.querySelectorAll('span.tag').forEach((t) => {
      t.style.cursor = 'pointer';
      t.addEventListener('click', () => window.QuickSwitcher.open('#' + t.dataset.tag));
    });
  }

  function debounce(fn, ms) {
    let t, lastArgs;
    const f = (...a) => { lastArgs = a; clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    f.flush = () => { clearTimeout(t); if (lastArgs) fn(...lastArgs); };
    return f;
  }
  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.NotesView = { open };
})();
