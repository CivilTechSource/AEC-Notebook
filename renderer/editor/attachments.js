// attachments.js — client side of note attachments.
// Drag/drop or paste a file into a note -> saved under <metaDir>/attachments and linked.
// Reading view resolves attachment images to data: URLs and opens file links via the OS.
(function () {
  function isImage(name) { return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name); }

  function readAsBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function insertAtCursor(ta, text) {
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    const pos = s + text.length;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.dispatchEvent(new Event('input'));  // triggers note autosave + word count
  }

  // Save each File and insert a markdown image/link at the cursor.
  async function insertFromFiles(ta, project, files) {
    for (const file of files) {
      try {
        const base64 = await readAsBase64(file);
        const name = file.name || `pasted-${Date.now()}.png`;
        const rel = await window.api.saveAttachment(project.path, name, base64);
        const label = rel.split('/').pop();
        insertAtCursor(ta, (isImage(rel) ? `![${label}](${rel})` : `[${label}](${rel})`) + '\n');
        window.Toast?.success('Attached ' + label);
      } catch (err) { window.Toast?.error('Attach failed: ' + (err.message || err)); }
    }
  }

  // Wire drop + paste on a textarea so dropped/pasted files become attachments.
  function wireEditor(ta, project) {
    ta.addEventListener('dragover', (e) => { if ((e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); });
    ta.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) { e.preventDefault(); insertFromFiles(ta, project, files); }
    });
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); insertFromFiles(ta, project, files); }
    });
  }

  // In the rendered reading view, swap attachment <img> srcs to data URLs and open file links.
  async function resolveReadingView(readEl, project) {
    for (const img of readEl.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('attachments/')) {
        try { img.src = await window.api.readAttachment(project.path, src); }
        catch { img.alt = '(missing attachment)'; }
      }
    }
    readEl.querySelectorAll('a[href^="attachments/"]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); window.api.openAttachment(project.path, a.getAttribute('href')); });
    });
  }

  // readAsBase64 is shared with the CodeMirror handlers in editor/cm/attachments.js — the reading
  // and saving half of this module is identical for both editors; only the insert differs.
  window.Attach = { wireEditor, resolveReadingView, insertFromFiles, isImage, readAsBase64 };
})();
