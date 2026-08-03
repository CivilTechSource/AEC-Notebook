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

async function docsForProject(p) {
  const docs = [];
  try {
    const rec = await storage.readProject(p.path);
    const fieldsText = rec ? Object.entries(rec.values || {}).map(([k, v]) => `${k}: ${valStr(v)}`).join('\n') : '';
    const id = 'p:' + p.path;
    docs.push({ id, type: 'project', projectPath: p.path, projectName: p.name, noteName: '', title: p.name, body: '', fields: fieldsText, tags: '' });
    docBody.set(id, fieldsText);
  } catch { /* ignore */ }
  try {
    for (const f of await storage.listNotes(p.path)) {
      const id = 'n:' + p.path + ':' + f;
      let body = ''; try { body = await storage.readNote(p.path, f); } catch { /* ignore */ }
      docs.push({ id, type: 'note', projectPath: p.path, projectName: p.name, noteName: f, title: f.replace(/\.md$/, ''), body, fields: '', tags: extractTags(body).join(' ') });
      docBody.set(id, body);
    }
  } catch { /* ignore */ }
  return docs;
}

async function build(projects) {
  mini = newIndex();
  docBody.clear();
  for (const p of projects || []) mini.addAll(await docsForProject(p));
  builtSig = sig(projects);
  stale = false;
}

async function ensureIndex(projects) {
  if (!mini || sig(projects) !== builtSig || stale) await build(projects);
}

// Mark the index out of date; the next query rebuilds it (cheap because searches are occasional).
function invalidate() { stale = true; }

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

module.exports = { query, invalidate };
