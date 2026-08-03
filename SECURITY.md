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
  before the storage layer sees them.
- Note names are confined with `path.basename`, so a crafted name can't escape its notes folder.
- Plugins run in `<iframe sandbox="allow-scripts">` (null origin, no app access) served over a
  separate `pnplugin://` scheme with `default-src 'none'` — **no network access**. The host
  verifies `event.source` against registered frames and honours only manifest-declared
  permissions.
- A plugin's `manifest.entry` must be a plain `.js` filename inside its own folder; paths and `..`
  are rejected.
- Rendered markdown is sanitised with DOMPurify. External links open in the system browser; the
  app window itself cannot be navigated away from `index.html`.

## Known limitations

- **Plugins are not sandboxed from each other's data.** A plugin granted `writeField` can write any
  field of the project it's mounted on. Only install plugins you trust.
- **Installers are not code-signed.** Windows SmartScreen and macOS Gatekeeper will warn on first
  run. Verify you downloaded from the official releases page.
- **Project data is not encrypted at rest.** It's plain JSON and Markdown by design — use full-disk
  encryption if that matters for your work.
