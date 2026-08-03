#!/usr/bin/env node
// Refresh renderer/vendor/* from node_modules.
//
// The renderer loads these as plain <script> tags (no bundler, and the CSP forbids remote
// origins), so the browser-ready builds are committed. Keeping the packages in package.json
// means `npm audit` and Dependabot still see them; this script is how the committed copies get
// updated. Run `npm run vendor` after bumping either dependency.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'renderer', 'vendor');

const FILES = [
  { pkg: 'marked', from: 'marked/lib/marked.umd.js', to: 'marked.umd.js' },
  { pkg: 'dompurify', from: 'dompurify/dist/purify.min.js', to: 'purify.min.js' },
];

fs.mkdirSync(OUT, { recursive: true });

let failed = false;
for (const f of FILES) {
  const src = path.join(ROOT, 'node_modules', f.from);
  if (!fs.existsSync(src)) {
    console.error(`missing ${f.from} — run npm install first`);
    failed = true;
    continue;
  }
  const version = require(path.join(ROOT, 'node_modules', f.pkg, 'package.json')).version;
  fs.copyFileSync(src, path.join(OUT, f.to));
  console.log(`vendored ${f.to} <- ${f.pkg}@${version}`);
}

process.exit(failed ? 1 : 0);
