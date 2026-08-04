// templates.js — note templates stored as plain markdown in <centralRoot>/templates/.
//
// Plain files on purpose: a template is just a note with tokens in it, so it can be written,
// versioned and shared the same way as anything else. Substitution itself lives in
// src/shared/templates.js and runs in the renderer, which is where the board values already are —
// this module only finds and reads the files.
//
// Template names arrive from the renderer, so they get the same treatment as plugin entry points:
// a bare filename inside the templates directory, or nothing.
const fsp = require('fs/promises');
const path = require('path');
const storage = require('./storage');

function templatesDir() { return path.join(storage.centralRoot(), 'templates'); }

// Reject anything that isn't a plain .md filename sitting directly in the templates directory.
// Mirrors plugins.safeEntry: resolve it and require the result to be the directory's own child.
function safeTemplatePath(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  if (!name.toLowerCase().endsWith('.md')) return null;
  const dir = templatesDir();
  const abs = path.resolve(dir, name);
  if (abs !== path.resolve(dir, path.basename(name))) return null;
  return abs;
}

// Shipped on first use so the picker isn't an empty list. Written only if the directory doesn't
// exist at all — once the user has a templates folder, it's theirs and we never add to it.
const STARTERS = {
  'Site visit.md': [
    '# {{title}} — {{date:DD/MM/YYYY}}',
    '',
    '- **Client:** {{field:client}}',
    '- **Job number:** {{field:jobNumber}}',
    '- **Site:** {{field:siteAddress}}',
    '- **Attended:** {{time}}',
    '- **Weather:**',
    '',
    '## Present',
    '',
    '## Observations',
    '',
    '## Actions',
    '',
    '- [ ] ',
    '',
    '#site-visit',
    '',
  ].join('\n'),

  'RFI.md': [
    '# RFI — {{title}}',
    '',
    '- **Raised:** {{date:DD/MM/YYYY}}',
    '- **Job number:** {{field:jobNumber}}',
    '- **Client:** {{field:client}}',
    '- **Status:** Open',
    '',
    '## Question',
    '',
    '## Background',
    '',
    '## Response',
    '',
    '#rfi',
    '',
  ].join('\n'),
};

async function ensureStarters() {
  const dir = templatesDir();
  try { await fsp.access(dir); return false; }        // already exists — leave it entirely alone
  catch { /* first run */ }
  await fsp.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(STARTERS)) {
    await fsp.writeFile(path.join(dir, name), body, 'utf8');
  }
  return true;
}

async function listTemplates() {
  await ensureStarters();
  let entries = [];
  try { entries = await fsp.readdir(templatesDir(), { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .map((e) => ({ file: e.name, name: e.name.replace(/\.md$/i, '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readTemplate(file) {
  const abs = safeTemplatePath(file);
  if (!abs) throw new Error(`Invalid template name: ${file}`);
  return fsp.readFile(abs, 'utf8');
}

module.exports = { templatesDir, listTemplates, readTemplate, safeTemplatePath, ensureStarters };
