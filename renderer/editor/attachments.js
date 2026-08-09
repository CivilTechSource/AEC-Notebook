// attachments.js — client side of note attachments.
// Drag/drop or paste a file into a note -> saved under <metaDir>/attachments and linked.
// Reading view resolves attachment images to data: URLs and opens file links via the OS.
(function () {
  // Kept in step with MAX_ATTACHMENT_BYTES in src/main/services/storage.js, which enforces it
  // again on the far side of IPC. Checked HERE first because this is the only side that still has
  // the File object, so the refusal can name the file and its size instead of saying "too big".
  const MAX_BYTES = 25 * 1024 * 1024;

  function isImage(name) { return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name); }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  // A file over the cap becomes ~1.37x as base64 in this process, again crossing IPC, and again
  // as a Buffer in main. Reading a 200 MB drawing that way freezes the window before it fails.
  function tooBig(file) {
    if (file.size <= MAX_BYTES) return false;
    window.Toast?.error(`“${file.name}” is ${formatSize(file.size)} — attachments are limited to ${formatSize(MAX_BYTES)}. Link to it on the drive instead.`);
    return true;
  }

  function readAsBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // ---------- building the link ----------
  //
  // A markdown link target is a URL, and a filename is not. Left raw, marked refuses to parse the
  // link at all and the note shows `![diamond 1.png](attachments/diamond 1.png)` as literal text —
  // no image, no link, no error. Measured against the vendored marked, EVERY one of these breaks
  // raw and works encoded:
  //
  //   diamond 1.png        space   — and note our own de-dup appends " 1", so dropping the same
  //                                  file twice used to produce a broken link the second time
  //   plan (rev A).png     parens  — the ) closes the link early
  //   plan [rev A].png     brackets
  //   50% slope.png        percent
  //
  // encodeURI leaves ( and ) alone, so those are encoded by hand afterwards. The main process
  // decodes symmetrically before touching disk (storage.attachmentName).
  function encodeRel(rel) {
    return encodeURI(String(rel)).replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  // The LABEL is display text, not a URL: it stays human-readable and only needs the characters
  // that would end it early escaped.
  function escapeLabel(s) { return String(s).replace(/([[\]\\])/g, '\\$1'); }

  /**
   * The markdown to paste for an attachment. One definition, because the editor's drop handler and
   * the board's "copy link" must not disagree about what a working link looks like.
   * @param {string} rel  note-relative and UNencoded, as saveAttachment returns it
   */
  function markdownLink(rel) {
    const label = escapeLabel(String(rel).split('/').pop());
    return `${isImage(rel) ? '!' : ''}[${label}](${encodeRel(rel)})`;
  }

  // Each attachment comes back as a whole base64 data URL, so a note with ten site photos used to
  // re-read all ten — sequentially — every time you switched into Reading mode. Cached by
  // project + relative path for the session and resolved in parallel.
  //
  // The real fix is a pnattach:// scheme alongside pnplugin://, so images stream natively and the
  // browser caches them instead of us holding data URLs in a Map. That's deferred with the app://
  // work (see HANDOFF.md) because it needs the same protocol handler.
  const dataUrlCache = new Map();   // `${projectPath}\u0000${rel}` -> data: URL

  function attachmentUrl(project, rel) {
    const key = `${project.path}\u0000${rel}`;
    if (!dataUrlCache.has(key)) {
      // The promise itself is cached, so ten <img> tags pointing at one photo make one IPC call.
      dataUrlCache.set(key, window.api.readAttachment(project.path, rel).catch((err) => {
        dataUrlCache.delete(key);        // a failure must not be cached as the answer
        throw err;
      }));
    }
    return dataUrlCache.get(key);
  }

  // An attachment replaced on disk would otherwise keep serving the old bytes for the session.
  function forget(projectPath) {
    for (const key of [...dataUrlCache.keys()]) {
      if (key.startsWith(`${projectPath}\u0000`)) dataUrlCache.delete(key);
    }
  }

  // In the rendered reading view, swap attachment <img> srcs to data URLs and open file links.
  async function resolveReadingView(readEl, project) {
    const imgs = [...readEl.querySelectorAll('img')]
      .filter((img) => (img.getAttribute('src') || '').startsWith('attachments/'));

    await Promise.all(imgs.map(async (img) => {
      const src = img.getAttribute('src');
      try { img.src = await attachmentUrl(project, src); }
      catch { img.alt = '(missing attachment)'; }
    }));

    readEl.querySelectorAll('a[href^="attachments/"]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); window.api.openAttachment(project.path, a.getAttribute('href')); });
    });
  }

  // readAsBase64, isImage and tooBig are shared with the CodeMirror handlers in
  // editor/cm/attachments.js, which owns the insert half. The textarea-shaped wireEditor /
  // insertFromFiles / insertAtCursor that used to live here went with the textarea itself.
  window.Attach = {
    resolveReadingView, isImage, readAsBase64, tooBig, forget, MAX_BYTES,
    markdownLink, encodeRel, escapeLabel,
  };
})();
