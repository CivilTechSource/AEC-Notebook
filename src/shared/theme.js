// theme.js — the tokens that cross the plugin sandbox boundary.
//
// Plugins render in an opaque-origin iframe and cannot read the app's stylesheets, so the host
// copies these variables across on init and again whenever the theme changes. That used to mean
// the same list existed in three places (the bridge's enumeration, pluginHost's fallback CSS, and
// tokens.css itself) and adding a token meant editing all three — forgetting one silently broke
// plugin theming. This file is now the only place the mirrored set is written down.
//
// MIRRORED is the subset of renderer/styles/tokens.css that plugins receive. It is deliberately
// smaller than the full token set: plugins get the palette and the two typography/geometry
// primitives, not the app's internal spacing scale or interaction-surface tokens.
//
// DARK holds the dark-theme values, used only as the fallback baked into a plugin page for the
// instant before the host's theme message arrives. test/theme.test.js asserts these values still
// match tokens.css, so this cannot drift.
//
// Dual export (CommonJS + window global) so the same file serves the main process and the
// renderer, which has no module loader — same pattern as data_validation.js.

const DARK = {
  '--bg': '#212429',
  '--bg-panel': '#1b1d21',
  '--bg-dark': '#16171a',
  '--bg-card': '#282c32',
  '--bg-card-2': '#1e2024',
  '--line': '#2a2e34',
  '--line-2': '#2f343b',
  '--line-3': '#34383f',
  '--line-4': '#41464e',
  '--text': '#e6e8ec',
  '--text-2': '#c4c8ce',
  '--text-3': '#b6bcc4',
  '--muted': '#8a9199',
  '--muted-2': '#6a7079',
  '--faint': '#565b63',
  '--accent': '#5b8cff',
  '--accent-h': '#6e9bff',
  '--green': '#5fb87a',
  '--amber': '#e0a23b',
  '--red': '#e5675c',
  '--teal': '#5fb6c4',
  '--purple': '#9b6bd4',
  '--radius': '8px',
  '--mono': "'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace",
};

const MIRRORED = Object.keys(DARK);

// The :root block baked into a plugin page as its pre-theme fallback.
function darkRootCss() {
  return ':root{' + MIRRORED.map((k) => `${k}:${DARK[k]};`).join('') + '}';
}

// Dual export: CommonJS (main process) + global (renderer).
// The identifier has to be distinctive: this loads as a classic script, so a top-level `const api`
// would collide with the `api` global the preload's contextBridge already defines.
const themeApi = { MIRRORED, DARK, darkRootCss };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = themeApi;
}
if (typeof window !== 'undefined') {
  window.Theme = themeApi;
}
