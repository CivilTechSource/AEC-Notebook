// search.js — note-level file scanning: backlinks and wikilink maintenance.
// (Full-text search lives in searchIndex.js, which is MiniSearch-backed.)
const storage = require('./storage');

function norm(s) { return String(s ?? '').toLowerCase(); }

// Must stay in step with WIKILINK in renderer/editor/md.js. The groups are kept separate so a
// rewrite can put the heading and alias back untouched:
//   1 leading !   2 note name   3 #heading (optional)   4 |alias (optional)
// Getting this wrong is silent: a [[Note#Heading]] link that this regex doesn't recognise is
// invisible to backlinks and, worse, is left dangling when the note is renamed.
const WIKILINK = /(!?)\[\[([^\]|#]+)((?:#[^\]|]+)?)((?:\|[^\]]*)?)\]\]/g;

// Markdown links pointing into the attachments folder: ![alt](attachments/x.png) and the
// non-image [text](attachments/spec.pdf).
//
// Deliberately loose about the target. Links written before targets were encoded contain raw
// spaces, parens and brackets, and those notes still exist — so this matches everything up to the
// closing paren and lets attachmentName() sort out encoding afterwards. Being too strict here is
// silent and expensive: a link shape this misses shows up in the UI as "not linked from any note",
// which is exactly how somebody deletes a file that was in use.
const ATTACHMENT_LINK = /\]\(\s*<?(attachments\/[^)\n]*?)>?\s*(?:"[^"]*")?\s*\)/g;

function makeSnippet(content, idx, len) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + len + 50);
  return (start > 0 ? '…' : '') + content.slice(start, end).replace(/\s+/g, ' ').trim() + (end < content.length ? '…' : '');
}

// Find notes in a project that link to [[noteName]] (backlinks).
async function findBacklinks(projectPath, noteName) {
  const target = norm(String(noteName).replace(/\.md$/, ''));
  const out = [];
  try {
    for (const file of await storage.listNotes(projectPath)) {
      if (norm(file.replace(/\.md$/, '')) === target) continue; // skip self
      let content = '';
      try { content = await storage.readNote(projectPath, file); } catch { /* ignore */ }
      const re = new RegExp(WIKILINK.source, 'g');   // fresh lastIndex per file
      let m, hit = false, snippet = '';
      while ((m = re.exec(content))) {
        if (norm(m[2].trim()) === target) { hit = true; snippet = makeSnippet(content, m.index, m[0].length); break; }
      }
      if (hit) out.push({ noteName: file, snippet });
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * Repoint every [[oldName]] in a project's notes at [[newName]], preserving any |alias.
 * Called after a note is renamed — otherwise the links dangle and clicking one silently
 * creates a new empty note.
 * @returns {Promise<{files: string[], count: number}>} which notes changed and how many links.
 */
async function rewriteWikilinks(projectPath, oldName, newName) {
  const from = norm(String(oldName).replace(/\.md$/, ''));
  const to = String(newName).replace(/\.md$/, '');
  const changed = [];
  let count = 0;
  if (!from || !to || from === norm(to)) return { files: changed, count };

  for (const file of await storage.listNotes(projectPath)) {
    let content;
    try { content = await storage.readNote(projectPath, file); } catch { continue; }
    let hits = 0;
    // The heading and alias are carried through verbatim: renaming a note must not also
    // silently retarget [[Note#Heading]] at the top of the note, or drop a |display alias.
    const next = content.replace(WIKILINK, (m, bang, target, heading, alias) => {
      if (norm(target.trim()) !== from) return m;
      hits += 1;
      return `${bang}[[${to}${heading}${alias}]]`;
    });
    if (hits) {
      try { await storage.writeNote(projectPath, file, next); changed.push(file); count += hits; }
      catch { /* leave this file alone; report the rest */ }
    }
  }
  return { files: changed, count };
}

/**
 * Which notes reference each attachment.
 *
 * The inverse of "what does this note link to", and the only way to know an attachment is still
 * in use. Without it the app can tell you a file exists but not whether deleting it breaks a note.
 *
 * Keyed by the filename on disk, so an encoded link (`attachments/site%20plan.pdf`) and a legacy
 * raw one (`attachments/site plan.pdf`) collapse onto the same entry.
 *
 * @returns {Promise<Object<string, string[]>>} filename -> note filenames, in listing order.
 *   A plain object rather than a Map: this crosses IPC, where a Map does not survive.
 */
async function findAttachmentRefs(projectPath) {
  const out = {};
  let files = [];
  try { files = await storage.listNotes(projectPath); } catch { return out; }

  for (const file of files) {
    let content = '';
    try { content = await storage.readNote(projectPath, file); } catch { continue; }
    const re = new RegExp(ATTACHMENT_LINK.source, 'g');   // fresh lastIndex per note
    let m;
    const seenInThisNote = new Set();
    while ((m = re.exec(content))) {
      const name = storage.attachmentName(m[1]);          // decode + basename, one definition
      if (!name || seenInThisNote.has(name)) continue;    // ten uses in one note is still one note
      seenInThisNote.add(name);
      (out[name] ||= []).push(file);
    }
  }
  return out;
}

module.exports = { findBacklinks, rewriteWikilinks, findAttachmentRefs };
