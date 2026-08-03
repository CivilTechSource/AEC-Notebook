# Contributing

Thanks for taking the time. This is a small codebase with deliberately few moving parts — no
bundler, no framework, no transpiler. Please keep it that way unless there's a concrete reason.

## Getting set up

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

Tests are plain `node:test` — no test framework to learn. Anything pure (validation, markdown
preprocessing, path handling, search) should have a test; UI wiring generally doesn't.

## How the code is organised

- `src/main/` — the Electron main process. Everything that touches the filesystem lives here.
  `main.js` is app lifecycle only; IPC handlers are in `src/main/ipc/`, and the modules they call
  are in `src/main/services/`.
- `src/shared/` — pure logic used by both processes. No Node or Electron imports.
- `renderer/` — the UI. No Node access; every privileged operation goes through `window.api`,
  which is defined in `src/main/preload.js`. Modules are grouped into `core/`, `workspace/`,
  `editor/`, `views/` and `plugins/`; styles into `renderer/styles/`.
- `plugins/` — bundled sample plugins (not to be confused with `renderer/plugins/`, which is the
  host side of the bridge).

If you add an IPC channel, it needs three things: a handler in the relevant
`src/main/ipc/<area>.ipc.js`, an entry in `preload.js`, and — if it takes a filesystem path — the
`guarded()` wrapper so the path is checked against the user's registered library folders. A new
area also needs listing in `src/main/ipc/index.js`.

The renderer has no module loader: each file is an IIFE publishing one `window` global, and the
`<script>` order in `index.html` is the dependency graph.

## House style

- Match the surrounding code. It's plain ES2022, 2-space indent, semicolons.
- Comments explain *why*, not *what*. If a line looks odd but is deliberate, say why it's there.
- Prefer fixing the cause over adding a guard at the call site.
- Errors that a user could act on should reach them — `window.Toast.error(...)`, not a swallowed
  `catch {}`. Silent failure is the bug class this codebase has historically suffered from.

## Pull requests

- One logical change per PR.
- Run `npm test` before pushing; CI runs it on Linux, macOS, and Windows.
- If you change anything about where data is stored or how it's written, say so explicitly in the
  PR description — that's the code most likely to lose someone's work.
- If you touch the vendored libraries in `renderer/vendor/`, regenerate them with `npm run vendor`
  rather than editing by hand, and bump the matching dependency in `package.json`.

## Reporting bugs

Include your OS, the app version, and — if it's about data — which storage mode you're in
(Storage page). If the app wrote something unexpected, the config files in your user-data
directory (see the README) are usually the fastest way to diagnose it.
