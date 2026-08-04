#!/usr/bin/env node
// Refresh renderer/vendor/* from node_modules.
//
// The renderer loads these as plain <script>/<link> tags (no bundler, and the CSP forbids remote
// origins), so the browser-ready builds are committed. Keeping the packages in package.json means
// `npm audit` and Dependabot still see them; this script is how the committed copies get updated.
// Run `npm run vendor` after bumping any of these dependencies.
//
// Most libraries here must ship a build that runs from a <script> tag as-is. That rules out
// anything CommonJS- or ESM-only: highlight.js, for instance, ships neither a UMD nor an IIFE
// bundle, which is why syntax highlighting uses Prism.
//
// CodeMirror is the one exception, and the reason esbuild is a devDependency. It is ESM-only
// across a dozen packages with no browser build at all, so it gets bundled here into a single
// IIFE. This is the ONLY bundling in the project: application code stays plain ES2022 loaded by
// ordered <script> tags, and nothing in renderer/ or src/ is compiled. Keep it that way.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'renderer', 'vendor');

// Straight copies.
const FILES = [
  { pkg: 'marked', from: 'marked/lib/marked.umd.js', to: 'marked.umd.js' },
  { pkg: 'dompurify', from: 'dompurify/dist/purify.min.js', to: 'purify.min.js' },
  { pkg: 'katex', from: 'katex/dist/katex.min.js', to: 'katex/katex.min.js' },
  { pkg: 'katex', from: 'katex/dist/katex.min.css', to: 'katex/katex.min.css' },
  // The big one, and the only self-contained mermaid build. Its ESM sibling is far smaller but
  // imports sibling chunks, and Chromium blocks ES module imports over file:// — which is how the
  // renderer is loaded. Never referenced from index.html: mermaid.js injects it on first use.
  { pkg: 'mermaid', from: 'mermaid/dist/mermaid.min.js', to: 'mermaid.min.js' },
];

// Whole directories (KaTeX resolves its fonts relative to its stylesheet).
const DIRS = [
  { pkg: 'katex', from: 'katex/dist/fonts', to: 'katex/fonts' },
];

// Prism ships core and each language as separate browser scripts. Concatenating the ones we want
// into a single file keeps this a copy step rather than a build step — the order matters, since a
// language can depend on another (markup and clike are already in prism.js).
const PRISM_LANGUAGES = [
  'bash', 'python', 'json', 'yaml', 'sql', 'ini', 'diff',
  'javascript', 'typescript', 'csharp', 'lisp', 'markdown',
];

function copyFile(rel, to) {
  const src = path.join(ROOT, 'node_modules', rel);
  if (!fs.existsSync(src)) return `missing ${rel} — run npm install first`;
  const dest = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return null;
}

function copyDir(rel, to) {
  const src = path.join(ROOT, 'node_modules', rel);
  if (!fs.existsSync(src)) return `missing ${rel} — run npm install first`;
  const dest = path.join(OUT, to);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  return null;
}

function version(pkg) {
  return require(path.join(ROOT, 'node_modules', pkg, 'package.json')).version;
}

fs.mkdirSync(OUT, { recursive: true });
let failed = false;
const fail = (msg) => { console.error(msg); failed = true; };

for (const f of FILES) {
  const err = copyFile(f.from, f.to);
  if (err) fail(err);
  else console.log(`vendored ${f.to} <- ${f.pkg}@${version(f.pkg)}`);
}

for (const d of DIRS) {
  const err = copyDir(d.from, d.to);
  if (err) fail(err);
  else console.log(`vendored ${d.to}/ <- ${d.pkg}@${version(d.pkg)}`);
}

// Prism: core + selected languages, concatenated in dependency order.
{
  const parts = [];
  const core = path.join(ROOT, 'node_modules', 'prismjs', 'prism.js');
  if (!fs.existsSync(core)) {
    fail('missing prismjs/prism.js — run npm install first');
  } else {
    // Prism auto-highlights on DOMContentLoaded by default, which would race our own decorator
    // and restyle code we haven't prepared yet. This is the documented way to switch it off, and
    // it must be set before the core script runs.
    parts.push('window.Prism = window.Prism || {}; window.Prism.manual = true;');
    parts.push(fs.readFileSync(core, 'utf8'));
    const missing = [];
    for (const lang of PRISM_LANGUAGES) {
      const p = path.join(ROOT, 'node_modules', 'prismjs', 'components', `prism-${lang}.min.js`);
      if (!fs.existsSync(p)) { missing.push(lang); continue; }
      parts.push(fs.readFileSync(p, 'utf8'));
    }
    if (missing.length) fail(`prism languages not found: ${missing.join(', ')}`);
    fs.writeFileSync(path.join(OUT, 'prism.js'), parts.join('\n;\n'));
    console.log(`vendored prism.js <- prismjs@${version('prismjs')} (core + ${PRISM_LANGUAGES.length - missing.length} languages)`);
  }
}

// CodeMirror: the one bundled dependency. scripts/codemirror-entry.js is the ESM entry point;
// the output publishes window.CM6 and is loaded by a plain <script> tag like everything else.
{
  const entry = path.join(ROOT, 'scripts', 'codemirror-entry.js');
  const out = path.join(OUT, 'codemirror.js');
  try {
    const esbuild = require('esbuild');
    const res = esbuild.buildSync({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',        // Electron 43 ships a much newer Chromium; no need to down-level
      minify: true,
      sourcemap: false,           // a 2 MB map committed to the repo helps nobody
      legalComments: 'none',
      logLevel: 'silent',
    });
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.text).join('; '));
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`vendored codemirror.js <- @codemirror/* bundled by esbuild (${kb} KB)`);
  } catch (e) {
    fail(`could not bundle CodeMirror: ${e.message}`);
  }
}

process.exit(failed ? 1 : 0);
