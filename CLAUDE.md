# AEC Notebook — working notes for agents

An Electron desktop app for AEC project folders on a shared drive. Each project folder gets a
schema-driven metadata board (`project.json`) plus markdown notes, stored *beside the actual
project files*. See `README.md` for the product, `Project Brief.md` for the original spec.

## Non-negotiables

**No bundler, no framework, no transpiler.** Plain ES2022. This is deliberate (`CONTRIBUTING.md`)
— don't introduce React/Vite/TypeScript/webpack without an explicit decision.

**There is exactly one runtime dependency: `minisearch`.** Everything else the app uses at
runtime — `marked`, `dompurify`, `prismjs`, `katex`, `mermaid`, CodeMirror — is vendored into
`renderer/vendor/` (committed) because the CSP forbids remote origins. Those packages are
**devDependencies**: they exist only so `npm run vendor` can rebuild the vendored copies. Never
hand-edit anything in `renderer/vendor/`, and never move a vendoring-only package back into
`dependencies` — electron-builder ships `dependencies` verbatim, which put ~97 MB of build tooling
inside the installer.

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

`guarded()` checks against the *library root* allowlist, so it does not apply to paths derived from
`centralRoot()` — it would fail closed on every call. `pluginData.ipc.js` is the one such module:
it takes a plugin id, never a destination path, and asserts containment itself. If you write
another, say so in the commit rather than leaving it looking like an omission.

**Errors a user could act on must reach them** — `window.Toast.error(...)`, not a swallowed
`catch {}`. Silent failure is the bug class this codebase has historically suffered from.

**Comments explain *why*, not *what*.** The existing comments carry a lot of hard-won context
(race conditions, platform quirks, past data-loss bugs). Preserve them when you move code.

## Layout

```
src/main/          main.js (lifecycle only), menu.js, pathGuard.js, writeTracker.js,
                   windowState.js, preload.js
src/main/ipc/      one module per area + index.js registrar
src/main/services/ storage, scanner, search, searchIndex, watcher, history, templates,
                   userStyles, plugins, pluginHost, pluginData
src/shared/        data_validation, theme, templates, diff, history  (dual CommonJS + window global)
renderer/          index.html, app.js
renderer/styles/   tokens → base → shell → components → editor → views → theme-light (cascade order)
renderer/core/     store, toast, modal, popover, undo, fsWatch, icons, events
renderer/workspace/ tabs.js, sidebar.js
renderer/editor/   notes, noteEditor, md, attachments, hoverPreview
renderer/editor/cm/       CodeMirror wiring (setup, theme, commands, wikilink, attachments)
renderer/editor/markdown/ extensions that self-register with MD (callouts, embeds, maths, …)
renderer/views/    projectBoard, schemaEditor, tableView, storageView, settingsView,
                   quickSwitcher, historyView
renderer/panels/   right-sidebar panes: backlinks, outline, outlinks, tags, reference
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
  Every brokered call is gated on a manifest-declared permission, and anything naming a file on
  disk derives that name from the plugin's **id**, never from the message payload — `config:write`
  joins a filename straight onto the config root without sanitising it.
- **The path allowlist fails closed.** A corrupt `library.json` means *nothing* is allowed. The
  roots list is cached because it's consulted on every note autosave keystroke; invalidate it when
  `library.json` is written.
- **Writes are atomic, serialised and lock-tolerant** (temp + rename, one `.bak`, per-file promise
  chains, `retryOnLock` for the EBUSY/EPERM that OneDrive and Google Drive FS produce mid-sync) and
  quit is held until they drain (`writeTracker.js`). Corrupt config is quarantined, never silently
  treated as absent. If you change anything about how data is written, say so loudly.
- **The app folder name is user input on a path join.** `storage.sanitizeFolderName` is what stops
  it walking out of the project folder, and `metaDirFor` asserts containment afterwards. The path
  allowlist only ever sees the *project* path, so it cannot catch this on its own.
- **The search index is invalidated per document, not wholesale.** `invalidateNote` /
  `invalidateProject` re-read one file; the blunt `invalidate()` is for changes that move where
  data lives. Reaching for `invalidate()` on an edit costs a full re-read of every note in every
  project — a download per file on Files On-Demand, and a failure when offline.
- **"Changed on disk" is decided by content, not by timing.** `watcher.js` suppresses our own
  writes with a 400 ms marker, which cannot cover a sync client touching the file seconds later.
  `NotesView.reconcile` compares the file against what the tab last wrote. Never reintroduce a
  time-based check there: a conflict dialog raised wrongly is a dialog that stops being read.
- **Appearance is CSS custom properties, nothing else.** The Settings page writes only to tokens
  on `:root` (`--editor-font`, `--editor-fs`, `--accent`, …), and the user's `custom.css` is
  injected as text into a `<style>` that stays last in `<head>`. Don't add component rules from
  JS — a control that stops matching a token should stop working, not break a layout.
- **Notes are scoped per project.** Wikilinks, backlinks and link-rewriting stop at the project
  boundary. This is a product decision, not an oversight.

## Testing

`npm test` runs plain `node:test` — no framework. CI runs it on Linux, macOS and Windows.
Anything pure (validation, markdown preprocessing, path handling, search, retention policy) should
have a test; UI wiring generally doesn't.

Some tests load renderer IIFEs by **file path** (`test/md.test.js`, `test/storeMigration.test.js`)
and `test/theme.test.js` parses `tokens.css`. Moving those files breaks the tests — update the
paths in the same change.
