// callouts.js — Obsidian-style callouts: > [!warning] Watch out
//
// Done as a DOM pass rather than a markdown extension because marked has already produced exactly
// the structure we want (a blockquote whose first paragraph holds the marker); rewriting that is
// far less fragile than intercepting the block parser.
//
// Runs after sanitising. Everything structural is built with createElement and the original,
// already-sanitised nodes are moved across — no note content is ever re-parsed as HTML.
(function () {
  // Aliases follow Obsidian's so notes written there render the same way here.
  const TYPES = {
    note:      { cls: 'note',    label: 'Note' },
    info:      { cls: 'note',    label: 'Info' },
    todo:      { cls: 'note',    label: 'To do' },
    abstract:  { cls: 'note',    label: 'Abstract' },
    summary:   { cls: 'note',    label: 'Summary' },
    tip:       { cls: 'tip',     label: 'Tip' },
    hint:      { cls: 'tip',     label: 'Hint' },
    important: { cls: 'tip',     label: 'Important' },
    success:   { cls: 'success', label: 'Success' },
    check:     { cls: 'success', label: 'Check' },
    done:      { cls: 'success', label: 'Done' },
    question:  { cls: 'warn',    label: 'Question' },
    faq:       { cls: 'warn',    label: 'FAQ' },
    warning:   { cls: 'warn',    label: 'Warning' },
    caution:   { cls: 'warn',    label: 'Caution' },
    attention: { cls: 'warn',    label: 'Attention' },
    danger:    { cls: 'danger',  label: 'Danger' },
    error:     { cls: 'danger',  label: 'Error' },
    bug:       { cls: 'danger',  label: 'Bug' },
    failure:   { cls: 'danger',  label: 'Failure' },
    example:   { cls: 'example', label: 'Example' },
    quote:     { cls: 'quote',   label: 'Quote' },
    cite:      { cls: 'quote',   label: 'Cite' },
  };

  // [!type] optionally followed by + (foldable, open) or - (foldable, starts closed), then a title.
  // The terminator tells us whether the marker line had a body after it on the same paragraph.
  const MARKER = /^\s*<p>\s*\[!([a-zA-Z]+)\]([+-]?)[ \t]*([^<\n]*?)\s*(<br\s*\/?>|<\/p>)/i;

  function apply(el) {
    for (const bq of [...el.querySelectorAll('blockquote')]) {
      // Nested first would be re-processed when the outer one is rebuilt; skip anything already
      // lifted out of the document by an earlier iteration.
      if (!bq.isConnected) continue;
      const m = bq.innerHTML.match(MARKER);
      if (!m) continue;

      const [full, rawType, fold, rawTitle, terminator] = m;
      const spec = TYPES[rawType.toLowerCase()];
      if (!spec) continue;                       // unknown [!whatever] stays an ordinary quote

      // Rebuild the remaining content. A <br> terminator means the paragraph continued, so it
      // has to be reopened; a </p> means that paragraph held only the marker.
      const rest = bq.innerHTML.slice(full.length);
      const bodyHtml = /^<br/i.test(terminator) ? '<p>' + rest : rest;

      const callout = document.createElement('div');
      callout.className = `callout callout-${spec.cls}`;
      const foldable = fold === '+' || fold === '-';
      if (fold === '-') callout.classList.add('collapsed');

      const head = document.createElement(foldable ? 'button' : 'div');
      head.className = 'callout-head';
      const title = document.createElement('span');
      title.className = 'callout-title';
      title.textContent = rawTitle || spec.label;     // textContent: the title is plain text
      if (foldable) {
        const chev = document.createElement('span');
        chev.className = 'callout-chev';
        chev.innerHTML = window.ICON.chevDown || '';
        head.appendChild(chev);
      }
      head.appendChild(title);

      const body = document.createElement('div');
      body.className = 'callout-body';
      // The source here is the blockquote's own already-sanitised markup, minus the marker.
      body.innerHTML = bodyHtml;

      callout.appendChild(head);
      callout.appendChild(body);
      if (foldable) head.addEventListener('click', () => callout.classList.toggle('collapsed'));

      bq.replaceWith(callout);
    }
  }

  window.MD.registerDecorator({ id: 'callouts', apply });
})();
