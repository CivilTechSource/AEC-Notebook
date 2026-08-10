# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's ["Report a vulnerability"][advisories] flow
rather than opening a public issue. Include reproduction steps and the app version. We aim to
acknowledge within a week.

[advisories]: https://github.com/CivilTechSource/AEC-Notebook/security/advisories/new

## Supported versions

Only the latest release receives fixes.

## Threat model

AEC Notebook is a local desktop app. It has no server component, no telemetry, no auto-update, and
makes no network requests — the app document's CSP forbids remote origins entirely.

The two untrusted inputs are **plugins** (which users install from third parties) and **note
content** (which may come from a shared drive or a synced folder).

Current mitigations:

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on. The renderer has no Node access; the
  entire privileged surface is the channel allowlist in `src/main/preload.js`.
- Filesystem paths from the renderer are checked against the user's registered library folders
  before the storage layer sees them. Every path-taking IPC channel goes through that check.
- The configurable app folder name is joined onto project paths, so it is sanitised (separators,
  Windows-reserved characters and dot-only segments removed) and the resolved data directory is
  asserted to be inside the project folder.
- Note names are confined with `path.basename`, so a crafted name can't escape its notes folder.
- Attachments are capped at 25 MB, enforced in the main process as well as the renderer.
- Plugins run in `<iframe sandbox="allow-scripts">` (null origin, no app access) served over a
  separate `pnplugin://` scheme with `default-src 'none'` — **no network access**. The host
  verifies `event.source` against registered frames and honours only manifest-declared
  permissions.
- A plugin's `manifest.entry` must be a plain `.js` filename inside its own folder; paths and `..`
  are rejected.
- A plugin's own storage and file folder are named from its **manifest id**, never from anything it
  sends over the bridge — the config write path joins a filename onto the config root without
  sanitising it, so a plugin-supplied name would be a traversal. The id is re-validated at the
  bridge and again in the main process, and containment is asserted after the join. Plugin storage
  is capped at 2 MB and evidence files at the attachment limit.
- Plugin files are reached by stored filename only. A plugin never sends or receives a filesystem
  path: importing goes through the native file dialog (the user's own consent gesture) and the main
  process reads the bytes, so they never pass through the renderer or the sandboxed frame.
- Rendered markdown is sanitised with DOMPurify. External links open in the system browser; the
  app window itself cannot be navigated away from `index.html`.

## Known limitations

- **Plugins are not sandboxed from each other's data.** A plugin granted `writeField` can write any
  field of the project it's mounted on. Only install plugins you trust.
- **`projects` discloses where your projects are.** A plugin granted that permission receives each
  project's full path, because that is what identifies a project everywhere else in the app and
  what makes a stored reference durable. On a shared drive that reveals your folder layout. It is
  read-only — a plugin cannot read the files themselves — but it is a disclosure, and it is why the
  permission is declared, badged on the Plugins page, and refused unless asked for.
- **Installers are not code-signed.** Windows SmartScreen and macOS Gatekeeper will warn on first
  run. Verify you downloaded from the official releases page.
- **Project data is not encrypted at rest.** It's plain JSON and Markdown by design — use full-disk
  encryption if that matters for your work.
