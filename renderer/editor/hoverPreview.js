// hoverPreview.js — hover a [[wikilink]] in the reading view to see the target note.
//
// Clicking a wikilink whose note doesn't exist creates it. That makes "what's behind this link?"
// a question you can't safely answer by clicking, which is exactly what a preview is for — and
// why a link to a missing note previews as such rather than showing an empty card.
(function () {
  const DELAY = 350;          // long enough that skimming the text doesn't flash cards
  const MAX_CHARS = 700;      // a preview, not the note

  function attach(readEl, project) {
    let timer = null;
    let openFor = null;       // the anchor the visible popover belongs to

    const cancel = () => { clearTimeout(timer); timer = null; };

    readEl.querySelectorAll('a.wikilink').forEach((a) => {
      a.addEventListener('mouseenter', () => {
        cancel();
        if (openFor === a) return;
        timer = setTimeout(() => show(a), DELAY);
      });
      a.addEventListener('mouseleave', () => {
        cancel();
        // Give the pointer a moment to reach the card, so hovering into it doesn't dismiss it.
        setTimeout(() => {
          const el = window.Popover.element();
          if (openFor === a && el && !el.matches(':hover')) { window.Popover.close(); }
        }, 180);
      });
      // Following the link makes the preview redundant.
      a.addEventListener('click', () => { cancel(); window.Popover.close(); });
    });

    async function show(a) {
      const want = a.dataset.note;
      if (!want) return;

      let notes = [];
      try { notes = await window.api.listNotes(project.path); } catch { return; }
      const match = notes.find((n) => n.replace(/\.md$/, '').toLowerCase() === want.toLowerCase());

      let html;
      if (!match) {
        html = `<div class="pop-preview-title">${escHtml(want)}</div>
                <div class="pop-preview-empty">This note doesn't exist yet. Clicking the link will create it.</div>`;
      } else {
        let body = '';
        try { body = await window.api.readNote(project.path, match); } catch { return; }
        const clipped = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) + '\n\n…' : body;
        // Same sanitised pipeline as the note itself — never innerHTML raw file content.
        html = `<div class="pop-preview-title">${escHtml(match.replace(/\.md$/, ''))}</div>
                <div class="pop-preview-body note-reading">${body.trim() ? window.MD.render(clipped) : '<p class="pop-preview-empty">This note is empty.</p>'}</div>`;
      }

      // The pointer may have moved on while we were reading from disk.
      if (!a.matches(':hover')) return;
      openFor = a;
      window.Popover.open({
        rect: a.getBoundingClientRect(), html, className: 'pop-preview', maxWidth: 420,
        onClose: () => { openFor = null; },
      });
      const el = window.Popover.element();
      el?.addEventListener('mouseleave', () => window.Popover.close());

      // Decorate the preview too, so a callout or a highlighted snippet looks the same here as in
      // the note. No getBody/setBody: a checkbox ticked in a preview would be writing to a file
      // you aren't editing. embedDepth is maxed so a preview never expands embeds of its own —
      // that would mean more disk reads behind a transient hover card.
      const bodyEl = el?.querySelector('.pop-preview-body');
      if (bodyEl) await window.MD.enhance(bodyEl, { project, embedDepth: Number.MAX_SAFE_INTEGER });
    }
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  window.HoverPreview = { attach };
})();
