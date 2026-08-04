// notes.js — Obsidian-style note editor: inline title (renames file), Edit/Reading toggle,
// markdown reading view with [[wikilinks]] + #tags, and a backlinks panel. Auto-saves.
(function () {
  function noteId(project, name) { return `note:${project.path}:${name}`; }

  function open(project, name, opts = {}) {
    window.Tabs.open({
      id: noteId(project, name), title: name.replace(/\.md$/, ''), icon: window.ICON.note,
      newTab: !!opts.newTab, toSide: !!opts.toSide,
      // What the right sidebar needs to know about this tab. getBody/revealLine can only be
      // supplied once the editor exists, so they're added in renderEditor via updateContext.
      context: { kind: 'note', project, name },
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
          <div class="note-actions">
            <button class="btn ghost" id="noteHistory" title="Version history">History</button>
            <div class="seg">
              <button class="seg-btn" data-mode="edit">Edit</button>
              <button class="seg-btn" data-mode="reading">Reading</button>
            </div>
          </div>
        </div>
        <input class="note-title" id="noteTitle" placeholder="Untitled" />
        <textarea class="note-body" id="noteBody" placeholder="Start writing…  [[link]] to notes, #tag to categorise"></textarea>
        <div class="note-reading" id="noteReading" hidden></div>
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
    // Grow the textarea to fit its content so the PANE scrolls rather than the box. Without this
    // a long note scrolls inside the textarea, independently of the title and the outline pane.
    const autoGrow = () => {
      bodyEl.style.height = 'auto';                      // collapse first, or it can only ever grow
      bodyEl.style.height = bodyEl.scrollHeight + 'px';
    };
    updateMeta(); updateWords();
    const flash = (m) => { statusEl.textContent = m; statusEl.style.color = 'var(--green)'; clearTimeout(flash._t); flash._t = setTimeout(() => { if (statusEl.isConnected) statusEl.textContent = ''; }, 1200); };

    const saveBody = debounce(async () => {
      try { await window.api.writeNote(project.path, state.name, bodyEl.value); }
      catch (err) { window.Toast?.error('Could not save note: ' + err.message); return; }
      flash('saved'); window.setStatus?.('Saved ' + state.name);
    }, 500);
    // The outline and outgoing-links panes read the live buffer, so they need to know it changed.
    // Debounced separately from the save: those panes re-render, and doing that per keystroke
    // makes typing feel heavy.
    const announceBody = debounce(() => window.Events?.emit('note-body-changed', { id: tab.id }), 300);
    bodyEl.addEventListener('input', () => { updateWords(); autoGrow(); saveBody(); announceBody(); });
    // Closing the tab (or quitting) inside the 500 ms debounce window would otherwise drop
    // the last keystrokes — flush synchronously on teardown.
    window.Tabs.setDestroyHook(tab.id, () => saveBody.flush());
    bodyEl.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveBody(); } });
    window.Attach.wireEditor(bodyEl, project);          // drop / paste images & files
    window.WikilinkSuggest.attach(bodyEl, project);     // [[ … ]] completion

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
      const newId = noteId(project, finalName);
      window.Tabs.rekey(oldId, newId, finalName.replace(/\.md$/, ''));
      // The sidebar keys off the note name; without this the panes keep querying the old one.
      window.Tabs.updateContext(newId, { name: finalName });
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
      window.Tabs.emitActive();      // backlinks just changed under the sidebar's feet
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
      // scrollHeight is 0 while hidden, so the textarea can only be measured once it's visible.
      if (!reading) autoGrow();
      if (reading) {
        saveBody.flush?.();
        try { await window.api.writeNote(project.path, state.name, bodyEl.value); } catch { /* toast already */ }
        readEl.innerHTML = window.MD.render(bodyEl.value);
        // Callouts, code highlighting, maths, diagrams, embeds and live checkboxes. getBody/
        // setBody are what let a ticked checkbox write back into this buffer.
        await window.MD.enhance(readEl, {
          project,
          // Seed the chain with this note so ![[itself]] is refused straight away. Without it the
          // guard still terminates, but only after rendering one full copy of the note inside itself.
          embedChain: new Set([state.name.replace(/\.md$/, '').toLowerCase()]),
          getBody: () => bodyEl.value,
          setBody: (next) => {
            bodyEl.value = next;
            updateWords();
            autoGrow();
            saveBody();
            announceBody();
          },
        });
        wireReadingLinks(readEl, project);
        window.HoverPreview.attach(readEl, project);    // peek at a [[link]] without following it
        window.Attach.resolveReadingView(readEl, project);   // load attachment images, wire file links
      }
    };
    pane.querySelectorAll('.seg-btn').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
    setMode(state.mode);

    // ----- sidebar context -----
    // Jumping to a heading is the editor's job: only it knows whether the textarea or the
    // rendered view is on screen, and the two need completely different treatment.
    function revealLine(lineIdx) {
      if (!bodyEl.isConnected) return;
      if (state.mode === 'reading') {
        // The rendered headings appear in the same order as the parsed ones, so match by index.
        const idx = window.MD.headings(bodyEl.value).findIndex((h) => h.line === lineIdx);
        readEl.querySelectorAll('h1,h2,h3,h4,h5,h6')[idx]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      const lines = bodyEl.value.split('\n');
      const pos = lines.slice(0, lineIdx).reduce((n, l) => n + l.length + 1, 0);
      bodyEl.focus();
      bodyEl.setSelectionRange(pos, pos + (lines[lineIdx] || '').length);
      // The textarea grows to fit its content, so it's the PANE that scrolls, not the box.
      const lh = parseFloat(getComputedStyle(bodyEl).lineHeight) || 22;
      const scroller = pane.closest('.tabpanes');
      if (scroller) scroller.scrollTop = Math.max(0, bodyEl.offsetTop + lineIdx * lh - scroller.clientHeight / 3);
    }
    window.Tabs.updateContext(tab.id, { getBody: () => bodyEl.value, revealLine });

    // ----- version history -----
    pane.querySelector('#noteHistory').onclick = () => {
      // Flush first: the snapshot the viewer diffs against is whatever is on disk, so a pending
      // autosave would otherwise make the comparison look wrong by half a sentence.
      saveBody.flush();
      window.HistoryView.open(project, state.name, () => bodyEl.value, (text) => {
        bodyEl.value = text;
        updateWords(); autoGrow(); announceBody();
        saveBody.flush();                       // write it straight away, don't wait out the debounce
        if (state.mode === 'reading') setMode('reading');
      });
    };

    // Arrived here from a [[Note#Heading]] link — jump to the section. Deferred a frame because
    // setMode('reading') renders asynchronously and there'd be nothing to scroll to yet.
    if (opts.heading) {
      setTimeout(() => {
        const h = window.MD.headings(bodyEl.value)
          .find((x) => x.text.toLowerCase() === String(opts.heading).trim().toLowerCase());
        if (h) revealLine(h.line);
        else window.Toast?.info?.(`“${state.name.replace(/\.md$/, '')}” has no heading “${opts.heading}”.`);
      }, 60);
    }

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
      if (!dirty) { bodyEl.value = disk; updateWords(); autoGrow(); announceBody(); if (state.mode === 'reading') setMode('reading'); flash('reloaded from disk'); return; }
      const keepMine = await window.Modal.confirm({
        title: 'This note changed on disk',
        body: `“${state.name}” was edited outside the app while you had unsaved changes. Keep your version, or discard it and load the one on disk?`,
        okText: 'Keep mine',
        cancelText: 'Load from disk',
      });
      if (keepMine) { originalSave.flush(); }
      else { bodyEl.value = disk; dirty = false; updateWords(); autoGrow(); announceBody(); if (state.mode === 'reading') setMode('reading'); flash('loaded from disk'); }
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
        const heading = a.dataset.heading || '';
        const notes = await window.api.listNotes(project.path);
        const match = notes.find((n) => n.replace(/\.md$/, '').toLowerCase() === want.toLowerCase());
        if (match) { open(project, match, heading ? { heading } : {}); return; }
        // create on the fly (Obsidian behaviour)
        const created = await window.api.createNote(project.path, want);
        open(project, created, { isNew: true });
      });
    });

    // Footnote jumps. These are in-document anchors, and letting the browser follow an href
    // would navigate the whole app window off index.html.
    readEl.querySelectorAll('a[data-fn], a[data-fnback]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const n = a.dataset.fn || a.dataset.fnback;
        const target = readEl.querySelector(a.dataset.fn ? `#fn-${CSS.escape(n)}` : `#fnref-${CSS.escape(n)}`);
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target?.classList.add('fn-flash');
        setTimeout(() => target?.classList.remove('fn-flash'), 900);
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

  // Exposed so other views can find (and close) the tab holding a given note.
  window.NotesView = { open, idFor: noteId };
})();
