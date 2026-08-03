// search.js — note-level file scanning: backlinks and wikilink maintenance.
// (Full-text search lives in searchIndex.js, which is MiniSearch-backed.)
const storage = require('./storage');

function norm(s) { return String(s ?? '').toLowerCase(); }

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
      const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g; let m, hit = false, snippet = '';
      while ((m = re.exec(content))) {
        if (norm(m[1].trim()) === target) { hit = true; snippet = makeSnippet(content, m.index, m[0].length); break; }
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
    const next = content.replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (m, target, alias) => {
      if (norm(target.trim()) !== from) return m;
      hits += 1;
      return `[[${to}${alias || ''}]]`;
    });
    if (hits) {
      try { await storage.writeNote(projectPath, file, next); changed.push(file); count += hits; }
      catch { /* leave this file alone; report the rest */ }
    }
  }
  return { files: changed, count };
}

module.exports = { findBacklinks, rewriteWikilinks };
