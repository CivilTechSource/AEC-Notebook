// embeds.js — ![[Note]] pulls another note's content inline, ![[Note#Heading]] just one section.
//
// md.js turns the syntax into an empty placeholder; this fills it, which is why it's a decorator
// rather than a preprocessor — it has to read from disk, and preprocessing is synchronous.
//
// Two separate guards, because they fail differently:
//   - a cycle (A embeds B embeds A) is a mistake worth naming, so it's detected by chain and
//     reported by name;
//   - depth is the backstop for a long chain that isn't a cycle. Without either, a note that
//     embeds itself renders until the renderer gives up.
(function () {
  const MAX_DEPTH = 3;

  // The section under a heading: from that heading down to the next one at the same or a higher
  // level. Exported because it's the part with real edge cases.
  function sliceHeading(body, heading) {
    const heads = window.MD.headings(body);
    const want = String(heading || '').trim().toLowerCase();
    const idx = heads.findIndex((h) => h.text.toLowerCase() === want);
    if (idx < 0) return null;
    const from = heads[idx];
    const next = heads.slice(idx + 1).find((h) => h.level <= from.level);
    const lines = body.split('\n');
    return lines.slice(from.line, next ? next.line : lines.length).join('\n').trim();
  }

  function notice(host, text, kind = 'warn') {
    host.className = `md-embed md-embed-${kind}`;
    host.textContent = text;
  }

  async function apply(el, ctx) {
    const hosts = [...el.querySelectorAll('.md-embed')].filter((h) => !h.dataset.filled);
    if (!hosts.length) return;
    if (!ctx.project) { hosts.forEach((h) => notice(h, 'Embedded notes are only shown inside a project.')); return; }

    const depth = ctx.embedDepth || 0;
    const chain = ctx.embedChain instanceof Set ? ctx.embedChain : new Set();

    let names = [];
    try { names = await window.api.listNotes(ctx.project.path); } catch { /* handled per host below */ }

    for (const host of hosts) {
      host.dataset.filled = '1';
      const want = host.dataset.note || '';
      const heading = host.dataset.heading || '';
      const key = want.toLowerCase();

      if (chain.has(key)) { notice(host, `“${want}” embeds itself — stopped here.`, 'error'); continue; }
      if (depth >= MAX_DEPTH) { notice(host, `“${want}” not expanded — embeds are nested too deeply.`); continue; }

      const match = names.find((n) => n.replace(/\.md$/, '').toLowerCase() === key);
      if (!match) { notice(host, `“${want}” doesn't exist yet.`); continue; }

      let body = '';
      try { body = await window.api.readNote(ctx.project.path, match); }
      catch { notice(host, `Could not read “${want}”.`, 'error'); continue; }

      if (heading) {
        const section = sliceHeading(body, heading);
        if (section == null) { notice(host, `“${want}” has no heading “${heading}”.`); continue; }
        body = section;
      }

      host.className = 'md-embed md-embed-filled';
      const head = document.createElement('button');
      head.className = 'md-embed-head';
      head.textContent = heading ? `${match.replace(/\.md$/, '')} › ${heading}` : match.replace(/\.md$/, '');
      head.title = 'Open this note';
      head.addEventListener('click', () => window.NotesView.open(ctx.project, match, heading ? { heading } : {}));

      const inner = document.createElement('div');
      inner.className = 'md-embed-body note-reading';
      inner.innerHTML = window.MD.render(body);

      host.textContent = '';
      host.appendChild(head);
      host.appendChild(inner);

      // Recurse with this note added to the chain, so a cycle is caught one level down.
      await window.MD.enhance(inner, {
        ...ctx,
        embedDepth: depth + 1,
        embedChain: new Set([...chain, key]),
        // The embedded note is not the buffer being edited, so its checkboxes stay read-only
        // rather than writing ticks into the wrong file.
        getBody: null,
        setBody: null,
      });
    }
  }

  window.MD.registerDecorator({ id: 'embeds', apply });
  window.MDEmbeds = { sliceHeading };      // exported for tests
})();
