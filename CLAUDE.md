# AEC Notebook — working notes for agents

An Electron desktop app for AEC project folders on a shared drive. Each project folder gets a
schema-driven metadata board (`project.json`) plus markdown notes, stored *beside the actual
project files*. See `README.md` for the product, `Project Brief.md` for the original spec.

## Non-negotiables

**No bundler, no framework, no transpiler.** Plain ES2022. This is deliberate (`CONTRIBUTING.md`)
— don't introduce React/Vite/TypeScript/webpack without an explicit decision. Runtime deps are
three: `marked`, `dompurify`, `minisearch`. The first two are vendored into `renderer/vendor/`
because the CSP forbids remote origins; regenerate with `npm run vendor`, never hand-edit them.

**Layer rule.**
- `src/main/` — the Electron main process. *Everything* that touches the filesystem lives here.
- `src/shared/` — pure logic used by both processes. No Node, no Electron imports.
- `renderer/` — the UI. No Node access; every privileged call goes through `window.api`
  (defined in `src/main/preload.js`).

**Adding an IPC channel is a three-step change:**
1. a handler in the right `src/main/ipc/<area>.ipc.js`,
2. an entry in `src/main/preload.js`,
3. the `guarded()` wrapper from `src/main/pathGuard.js` if it takes a filesystem path.

A brand-new area also needs its module added to the list in `src/main/ipc/index.js`.

**Errors a user could act on must reach them** — `window.Toast.error(...)`, not a swallowed
`catch {}`. Silent failure is the bug class this codebase has historically suffered from.

**Comments explain *why*, not *what*.** The existing comments carry a lot of hard-won context
(race conditions, platform quirks, past data-loss bugs). Preserve them when you move code.

## Layout

```
src/main/          main.js (lifecycle only), menu.js, pathGuard.js, writeTracker.js, preload.js
src/main/ipc/      one module per area + index.js registrar
src/main/services/ storage, scanner, search, searchIndex, watcher, plugins, pluginHost
src/shared/        data_validation.js, theme.js  (dual CommonJS + window global export)
renderer/          index.html, app.js
renderer/styles/   tokens → base → shell → components → editor → views → theme-light (cascade order)
renderer/core/     store, toast, modal, undo, fsWatch, icons, events
renderer/workspace/ tabs.js
renderer/editor/   notes, md, attachments
renderer/views/    projectBoard, schemaEditor, tableView, storageView, quickSwitcher
renderer/plugins/  pluginBridge, pluginsView
plugins/           bundled sample plugins (NOT the same as renderer/plugins/)
```

**The renderer has no module loader.** Every module is an IIFE hanging one global off `window`,
and the `<script>` order in `index.html` *is* the dependency graph. A new module must be inserted
after everything it reads at load time. Folders group by role only — they carry no load-order
meaning.

## Things that will bite you

- **Design tokens live in one place.** `renderer/styles/tokens.css` defines them;
  `src/shared/theme.js` declares the subset mirrored into plugin iframes and their dark fallbacks.
  `test/theme.test.js` fails if those drift. Don't re-add a token list anywhere else.
- **Plugins are sandboxed on purpose.** Opaque-origin `<iframe sandbox="allow-scripts">`, served
  over the `pnplugin://` scheme so the page gets its own CSP (`default-src 'none'`,
  `connect-src 'none'`). Plugin code never runs in the main process. Grow the API by adding
  brokered methods in `pluginBridge.js` — never by loosening the sandbox. See `SECURITY.md`.
- **The path allowlist fails closed.** A corrupt `library.json` means *nothing* is allowed. The
  roots list is cached because it's consulted on every note autosave keystroke; invalidate it when
  `library.json` is written.
- **Writes are atomic and serialised** (temp + rename, one `.bak`, per-project promise chains) and
  quit is held until they drain (`writeTracker.js`). Corrupt config is quarantined, never silently
  treated as absent. If you change anything about how data is written, say so loudly.
- **Notes are scoped per project.** Wikilinks, backlinks and link-rewriting stop at the project
  boundary. This is a product decision, not an oversight.

## Testing

`npm test` runs plain `node:test` — no framework. CI runs it on Linux, macOS and Windows.
Anything pure (validation, markdown preprocessing, path handling, search, retention policy) should
have a test; UI wiring generally doesn't.

Some tests load renderer IIFEs by **file path** (`test/md.test.js`, `test/storeMigration.test.js`)
and `test/theme.test.js` parses `tokens.css`. Moving those files breaks the tests — update the
paths in the same change.
