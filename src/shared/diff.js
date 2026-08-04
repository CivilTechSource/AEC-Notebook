// diff.js — line diff for the note history viewer.
//
// Hand-rolled rather than pulled in: the app has three runtime dependencies and a diff for two
// versions of one markdown note is not worth a fourth.
//
// Classic LCS via dynamic programming. That's O(n·m) in time and memory, which is fine for notes
// but not for arbitrary input — so a size guard falls back to a whole-file replace rather than
// letting a pathological pair allocate a huge table.

const MAX_CELLS = 4_000_000;   // ~2000x2000 lines; beyond this, don't build the table

function splitLines(text) {
  const s = String(text ?? '');
  if (s === '') return [];
  return s.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * @returns {Array<{type:'same'|'add'|'del', text:string, aLine:number|null, bLine:number|null}>}
 *          aLine/bLine are 1-based line numbers in the old/new text, null where absent.
 */
function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text, i) => ({ type: 'del', text, aLine: i + 1, bLine: null })),
      ...b.map((text, i) => ({ type: 'add', text, aLine: null, bLine: i + 1 })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i], aLine: i + 1, bLine: j + 1 }); i++; j++; }
    // Tie broken towards deletions first, so a changed line reads as "was X / now Y".
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ type: 'del', text: a[i], aLine: i + 1, bLine: null }); i++; }
    else { out.push({ type: 'add', text: b[j], aLine: null, bLine: j + 1 }); j++; }
  }
  while (i < a.length) { out.push({ type: 'del', text: a[i], aLine: i + 1, bLine: null }); i++; }
  while (j < b.length) { out.push({ type: 'add', text: b[j], aLine: null, bLine: j + 1 }); j++; }
  return out;
}

function summarise(rows) {
  return {
    added: rows.filter((r) => r.type === 'add').length,
    removed: rows.filter((r) => r.type === 'del').length,
    unchanged: rows.filter((r) => r.type === 'same').length,
  };
}

// Collapse long unchanged stretches so the viewer shows changes, not a wall of context.
function collapse(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ type: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}`, aLine: null, bLine: null }); skipped = 0; }
      out.push(r);
    } else skipped++;
  });
  if (skipped) out.push({ type: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}`, aLine: null, bLine: null });
  return out;
}

const diffApi = { diffLines, summarise, collapse, splitLines };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = diffApi;
}
if (typeof window !== 'undefined') {
  window.Diff = diffApi;
}
