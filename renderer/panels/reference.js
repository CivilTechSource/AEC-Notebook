// reference.js — markdown syntax and keyboard shortcuts, as a sidebar pane.
//
// Everything the app understands is in here, which is the point: the syntax has grown well past
// plain markdown (wikilinks, embeds, callouts, footnotes, maths, diagrams) and none of it was
// discoverable from inside the app. A user had to read the README to find out that `![[Note]]`
// embeds a note.
//
// Static content, so unlike the other panes it ignores the active tab entirely and mounts once.
// Groups remember whether they're open for the session.
(function () {
  let host = null;
  const openGroups = new Set(['Text', 'Shortcuts']);   // the two people reach for most

  const isMac = navigator.platform.toLowerCase().includes('mac');
  const MOD = isMac ? '⌘' : 'Ctrl';

  // Each row is [what it does, the literal you type]. The example column is rendered as code, so
  // it is shown verbatim — never interpreted.
  const SYNTAX = [
    ['Text', [
      ['Bold', '**bold**'],
      ['Italic', '*italic*'],
      ['Bold italic', '***both***'],
      ['Strikethrough', '~~struck~~'],
      ['Inline code', '`code`'],
      ['Highlight a line', '> quoted text'],
      ['Horizontal rule', '---'],
    ]],
    ['Headings', [
      ['Heading 1', '# Title'],
      ['Heading 2', '## Section'],
      ['Heading 3', '### Subsection'],
      ['…down to 6', '###### Smallest'],
    ]],
    ['Lists', [
      ['Bullet', '- item'],
      ['Numbered', '1. item'],
      ['Nested', '  - indent two spaces'],
      ['Task', '- [ ] to do'],
      ['Done', '- [x] done'],
    ]],
    ['Links', [
      ['Link to a note', '[[Note name]]'],
      ['…with different text', '[[Note name|shown text]]'],
      ['…to a heading in it', '[[Note name#Heading]]'],
      ['Embed a whole note', '![[Note name]]'],
      ['Embed one section', '![[Note name#Heading]]'],
      ['Web link', '[text](https://example.com)'],
      ['Tag', '#site-visit'],
    ]],
    ['Tables', [
      ['Header row', '| Chainage | Level |'],
      ['Separator', '|---|---|'],
      ['Body row', '| 0+250 | 41.20 |'],
    ]],
    ['Callouts', [
      ['Note', '> [!note] Title'],
      ['Warning', '> [!warning] Access'],
      ['Danger', '> [!danger] Do not'],
      ['Tip / Success / Question', '> [!tip] …'],
      ['Foldable, open', '> [!note]+ Title'],
      ['Foldable, closed', '> [!note]- Title'],
    ]],
    ['Code & diagrams', [
      ['Fenced code', '```js'],
      ['Diagram', '```mermaid'],
      ['…then', 'graph TD; A-->B;'],
    ]],
    ['Maths', [
      ['Inline', '$E = mc^2$'],
      ['Display', '$$Q = CiA$$'],
    ]],
    ['Footnotes', [
      ['Reference', 'text[^1]'],
      ['Definition', '[^1]: the note'],
    ]],
    ['Attachments', [
      ['Drag or paste a file', 'into the editor'],
      ['Image', '![alt](attachments/photo.jpg)'],
      ['File link', '[spec.pdf](attachments/spec.pdf)'],
    ]],
  ];

  const SHORTCUTS = [
    ['Shortcuts', [
      ['Quick switcher / search', `${MOD} P`],
      ['Filter the project list', `${MOD} F`],
      ['Undo a deletion', `${MOD} Z`],
      ['Save now', `${MOD} S`],
      ['Schema editor', `${MOD} E`],
      ['Add a library folder', `${MOD} O`],
    ]],
    ['In the editor', [
      ['Bold', `${MOD} B`],
      ['Italic', `${MOD} I`],
      ['Tick / untick a task', `${MOD} ↵`],
      ['Undo / redo typing', `${MOD} Z  ·  ${MOD} ⇧ Z`],
      ['Find in this note', `${MOD} F`],
      ['Suggest a note to link', 'type [['],
      ['Indent', 'Tab'],
    ]],
    ['Tabs', [
      ['New tab', 'middle-click a project'],
      ['Split view', 'drag a tab to the edge'],
      ['Close a tab', 'middle-click it'],
      ['Move between tabs', '← →  when a tab has focus'],
    ]],
  ];

  function mount(el) {
    host = el;
    render();
  }

  // Static: the pane says the same thing whatever tab is in front. It still has to accept the
  // call, because the sidebar pushes context into whichever pane is visible.
  function update() { if (host && !host.childElementCount) render(); }

  function render() {
    const groups = [...SHORTCUTS, ...SYNTAX];
    host.innerHTML = `<div class="rb-count">Markdown &amp; keys</div>` + groups.map(([title, rows]) => `
      <div class="ref-group${openGroups.has(title) ? ' open' : ''}">
        <button class="ref-head" data-group="${escAttr(title)}">
          <span class="ref-chev">${window.ICON.chevDown}</span>
          <span class="ref-title">${escHtml(title)}</span>
        </button>
        <div class="ref-body">
          ${rows.map(([what, how]) => `
            <div class="ref-row">
              <span class="ref-what">${escHtml(what)}</span>
              <code class="ref-how">${escHtml(how)}</code>
            </div>`).join('')}
        </div>
      </div>`).join('');

    host.querySelectorAll('.ref-head').forEach((b) => {
      b.onclick = () => {
        const g = b.dataset.group;
        const wrap = b.parentElement;
        const nowOpen = !wrap.classList.contains('open');
        wrap.classList.toggle('open', nowOpen);
        if (nowOpen) openGroups.add(g); else openGroups.delete(g);
      };
    });

    // Click a snippet to copy it — the reason to look this up is usually to use it.
    host.querySelectorAll('.ref-how').forEach((code) => {
      code.title = 'Click to copy';
      code.onclick = async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
          code.classList.add('copied');
          setTimeout(() => code.classList.remove('copied'), 700);
        } catch { /* clipboard unavailable; the text is on screen either way */ }
      };
    });
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  window.Sidebar.register({ id: 'reference', title: 'Syntax & shortcuts', icon: window.ICON.help, mount, update });
})();
