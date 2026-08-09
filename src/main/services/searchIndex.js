// searchIndex.js — MiniSearch-backed full-text index (the engine Obsidian's Omnisearch uses).
// Builds an in-memory index over project field values + note contents so searches don't
// re-read every file on each keystroke. Rebuilt lazily when data changes (invalidate()).
const MiniSearch = require('minisearch');
const storage = require('./storage');

let mini = null;
let builtSig = null;
let stale = true;
const docBody = new Map();   // doc id -> source text (for snippets; kept out of the index to stay lean)

function valStr(v) { return Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')); }
function sig(projects) { return (projects || []).map((p) => p.path).sort().join('|'); }

// #tags are stripped by the default tokenizer, so a tag click used to search for the bare word
// and match unrelated prose. Index them as their own field and search it exactly.
const TAG_RE = /(^|\s)#([a-zA-Z0-9_/-]+)/g;
function extractTags(text) {
  const out = new Set();
  String(text || '').replace(TAG_RE, (m, pre, tag) => (out.add(tag.toLowerCase()), m));
  return [...out];
}

function newIndex() {
  return new MiniSearch({
    fields: ['title', 'body', 'fields', 'tags'],
    storeFields: ['type', 'projectPath', 'projectName', 'noteName'],
    searchOptions: { boost: { title: 3, fields: 2, body: 1 }, prefix: true, fuzzy: 0.2 },
  });
}

const noteId = (projectPath, noteName) => `n:${projectPath}:${noteName}`;
const projectId = (projectPath) => `p:${projectPath}`;

function noteDoc(p, f, body) {
  return {
    id: noteId(p.path, f), type: 'note', projectPath: p.path, projectName: p.name, noteName: f,
    title: f.replace(/\.md$/, ''), body, fields: '', tags: extractTags(body).join(' '),
  };
}

function projectDoc(p, fieldsText) {
  return {
    id: projectId(p.path), type: 'project', projectPath: p.path, projectName: p.name, noteName: '',
    title: p.name, body: '', fields: fieldsText, tags: '',
  };
}

async function docsForProject(p) {
  const docs = [];
  try {
    const rec = await storage.readProject(p.path);
    const fieldsText = rec ? Object.entries(rec.values || {}).map(([k, v]) => `${k}: ${valStr(v)}`).join('\n') : '';
    docs.push(projectDoc(p, fieldsText));
    docBody.set(projectId(p.path), fieldsText);
  } catch { /* ignore */ }
  try {
    for (const f of await storage.listNotes(p.path)) {
      let body = ''; try { body = await storage.readNote(p.path, f); } catch { /* ignore */ }
      docs.push(noteDoc(p, f, body));
      docBody.set(noteId(p.path, f), body);
    }
  } catch { /* ignore */ }
  return docs;
}

async function build(projects) {
  mini = newIndex();
  docBody.clear();
  dirtyDocs.clear();
  for (const p of projects || []) mini.addAll(await docsForProject(p));
  builtSig = sig(projects);
  stale = false;
}

// ---------- staying current without rebuilding everything ----------
//
// Every note write, rename, delete and watcher event used to call invalidate(), and the next
// query re-read EVERY note in EVERY project from disk. On local disk that's a slow sweep; on
// OneDrive Files On-Demand placeholders it's a download, and it fails outright when you're
// offline — which is exactly when you're on site and most want your notes.
//
// So changes are recorded per document and applied at query time: one file read for one edit,
// instead of thousands. `stale` survives for the cases that genuinely invalidate everything
// (a storage-mode change, an unknown edit).
const dirtyDocs = new Map();   // doc id -> { projectPath, noteName|null }

function invalidate() { stale = true; }

// A single note changed on disk (written, renamed away from, deleted, or edited externally).
function invalidateNote(projectPath, noteName) {
  if (!projectPath || !noteName) return invalidate();
  dirtyDocs.set(noteId(projectPath, noteName), { projectPath, noteName });
}

// A project's field values changed; its notes are untouched.
function invalidateProject(projectPath) {
  if (!projectPath) return invalidate();
  dirtyDocs.set(projectId(projectPath), { projectPath, noteName: null });
}

// Re-read just the documents marked dirty and swap them in. A document whose file is gone is
// discarded; one that didn't exist before is added.
async function applyDirty(projects) {
  if (!dirtyDocs.size) return;
  const byPath = new Map((projects || []).map((p) => [p.path, p]));
  const pending = [...dirtyDocs.entries()];
  dirtyDocs.clear();

  for (const [id, { projectPath, noteName }] of pending) {
    const p = byPath.get(projectPath);
    if (!p) continue;                       // project no longer in scope; the next build drops it
    let doc = null;
    try {
      if (noteName) {
        // listNotes rather than a bare read: readNote returns '' for a missing file, which would
        // leave a deleted note in the index as an empty document that still matches its title.
        const exists = (await storage.listNotes(projectPath)).includes(noteName);
        if (exists) doc = noteDoc(p, noteName, await storage.readNote(projectPath, noteName));
      } else {
        const rec = await storage.readProject(projectPath);
        const fieldsText = rec ? Object.entries(rec.values || {}).map(([k, v]) => `${k}: ${valStr(v)}`).join('\n') : '';
        doc = projectDoc(p, fieldsText);
      }
    } catch {
      stale = true;                         // couldn't read it — fall back to a full rebuild
      continue;
    }
    // discard + add rather than replace: replace() throws on an id the index doesn't hold, and a
    // dirty doc may be one that didn't exist before. MiniSearch auto-vacuums discarded ids, so a
    // long editing session doesn't accumulate tombstones.
    if (mini.has(id)) mini.discard(id);
    docBody.delete(id);
    if (doc) { mini.add(doc); docBody.set(id, doc.type === 'note' ? doc.body : doc.fields); }
  }
}

async function ensureIndex(projects) {
  if (!mini || sig(projects) !== builtSig || stale) { await build(projects); return; }
  await applyDirty(projects);
  if (stale) await build(projects);         // applyDirty gave up on something — rebuild after all
}

function makeSnippet(body, term) {
  const i = body.toLowerCase().indexOf(String(term || '').toLowerCase());
  if (i < 0) return body.slice(0, 80).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, i - 30), end = Math.min(body.length, i + 50);
  return (start ? '…' : '') + body.slice(start, end).replace(/\s+/g, ' ').trim() + (end < body.length ? '…' : '');
}

async function query(q, projects) {
  if (!q || !q.trim()) return [];
  await ensureIndex(projects);
  const term = q.trim();

  // A leading # means "find notes carrying this tag" — an exact match on the tags field only,
  // not a fuzzy word search across all the prose.
  const results = term.startsWith('#')
    ? mini.search(term.slice(1).toLowerCase(), { fields: ['tags'], prefix: false, fuzzy: false })
    : mini.search(term);
  return results.slice(0, 60).map((r) => {
    const body = docBody.get(r.id) || '';
    const hit = (r.terms && r.terms[0]) || term;
    const snippet = r.type === 'project'
      ? (body.split('\n').find((l) => l.toLowerCase().includes(hit.toLowerCase())) || r.projectPath)
      : makeSnippet(body, hit);
    return { type: r.type, projectPath: r.projectPath, projectName: r.projectName, noteName: r.noteName, snippet, score: r.score };
  });
}

module.exports = { query, invalidate, invalidateNote, invalidateProject };
