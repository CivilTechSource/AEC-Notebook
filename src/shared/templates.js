// templates.js — token substitution for note templates.
//
// Pure string work, shared by both processes so it can be unit tested without Electron.
//
// The interesting token is {{field:<key>}}: it reads the project's own board values, so a site
// visit template can arrive with the client, job number and site address already filled in. That
// is the thing a general-purpose notes app can't do, because it has no idea what a project is.
//
// Unknown tokens are deliberately left standing rather than blanked. A template is authored once
// and used for years; a silent empty string hides the typo, whereas "{{field:jobno}}" sitting in
// a note is self-reporting.

const TOKEN = /\{\{([a-zA-Z]+)(?::([^}]*))?\}\}/g;

function pad(n) { return String(n).padStart(2, '0'); }

// Minimal date formatting — enough for filenames and headers, no dependency.
// Longer tokens must be replaced before their prefixes (YYYY before YY, MM before M).
function formatDate(d, pattern) {
  const map = {
    YYYY: d.getFullYear(),
    YY: pad(d.getFullYear() % 100),
    MMM: d.toLocaleString('en-GB', { month: 'short' }),
    MM: pad(d.getMonth() + 1),
    DDD: d.toLocaleString('en-GB', { weekday: 'short' }),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return String(pattern).replace(/YYYY|YY|MMM|MM|DDD|DD|HH|mm|ss/g, (m) => map[m]);
}

// Board values are typed; render each the way a person would write it.
function formatValue(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');          // multiselect
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'; // checkbox
  return String(v);
}

/**
 * @param {string} text     the template body
 * @param {object} ctx      { title, values, fields, now }
 *   values  - the project's board values, keyed by field key
 *   fields  - optional schema field list; when given, a {{field:}} key that isn't in it is
 *             treated as an authoring error and left standing
 *   now     - injectable clock, so tests aren't time-dependent
 */
function substitute(text, ctx = {}) {
  const { title = '', values = {}, fields = null, now = new Date() } = ctx;
  const known = fields ? new Set(fields.map((f) => f.key)) : null;

  return String(text ?? '').replace(TOKEN, (match, name, arg) => {
    switch (name.toLowerCase()) {
      case 'date':
        return formatDate(now, arg || 'YYYY-MM-DD');
      case 'time':
        return formatDate(now, arg || 'HH:mm');
      case 'title':
        return title;
      case 'field': {
        const key = (arg || '').trim();
        if (!key) return match;
        if (known && !known.has(key)) return match;   // not a field on this board — leave visible
        return formatValue(values[key]);
      }
      default:
        return match;                                  // unrecognised token stays put
    }
  });
}

// Tokens referenced by a template, so a picker can warn before a note is created.
function tokensUsed(text) {
  const out = [];
  String(text ?? '').replace(TOKEN, (m, name, arg) => {
    out.push({ name: name.toLowerCase(), arg: arg == null ? null : arg.trim(), raw: m });
    return m;
  });
  return out;
}

const templatesApi = { substitute, tokensUsed, formatDate, formatValue };

// Dual export: CommonJS (main process) + global (renderer). The identifier is distinctive on
// purpose — see the note in theme.js about top-level consts colliding with preload globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = templatesApi;
}
if (typeof window !== 'undefined') {
  window.Templates = templatesApi;
}
