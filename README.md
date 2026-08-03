# AEC Notebook

A desktop notebook for project folders. Point it at the folders you already have on disk, define
the fields *you* care about per library folder, and keep markdown notes next to the work they
describe. Nothing is locked in the app: project info is plain JSON, notes are plain `.md`.

Built with Electron. MIT licensed.

## Why

Engineering and architecture teams keep projects as folders on a shared drive. The metadata about
those projects — client, status, flood zone, planning reference — ends up in a spreadsheet that
drifts out of sync, and the notes end up in someone's inbox. AEC Notebook keeps both beside the
folder itself.

## Features

- **Per-folder schemas.** Each library folder gets its own field definitions — text, number, date,
  select, multi-select, file, checkbox — grouped into collapsible sections. Drag to reorder,
  export/import as JSON.
- **Validation that means something.** Required fields, min/max, max length, allowed options, and
  cross-field rules (e.g. selecting *Zone 3* requires a risk assessment file before the project
  counts as complete).
- **Markdown notes** with `[[wikilinks]]`, `#tags`, backlinks, drag-and-drop attachments, and a
  reading view.
- **Tabbed workspace** with split panes, pinned tabs, and session restore.
- **Full-text search** across project fields and note contents (MiniSearch), plus a `Ctrl/Cmd+P`
  quick switcher.
- **Table view** — every project in a folder as rows, schema fields as columns, sortable and
  filterable, exportable to CSV.
- **Sandboxed plugins.** Third-party tools run in an isolated iframe with their own CSP and an
  explicit permission model. A crashing plugin cannot take the app down.

## Install and run

Requires Node.js 20+.

```bash
npm install
```

```bash
npm start
```

Run the tests:

```bash
npm test
```

Build installers for the current platform (output in `dist/`):

```bash
npm run dist
```

## Getting started

1. Open the **Storage** page from the left ribbon and add a *library folder* — a folder that
   contains project folders. Set how many levels deep the projects sit (1 = direct subfolders).
2. Open the **Schema Editor** and define the fields for that folder.
3. Pick a project in the left panel, hit **Edit**, and fill it in. Everything auto-saves.

## Where your data lives

Two things are stored separately.

**Per-project data** (`project.json` + `notes/*.md` + `attachments/`) goes wherever you choose on
the Storage page:

| Mode | Location |
| --- | --- |
| In folder *(default)* | `<project>/ProjectNotes/` |
| Central | `<userData>/Projects/<Project Name (id)>/` |
| Custom | `<your folder>/ProjectNotes/Projects/<Project Name (id)>/` |

**App config** (`settings.json`, `library.json`, `schemas.json`, `session.json`, `plugins.json`)
always lives in the platform's user-data directory:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\AEC Notebook` |
| macOS | `~/Library/Application Support/AEC Notebook` |
| Linux | `~/.config/AEC Notebook` |

Set `PNOTES_HOME` to override that (useful for testing against a throwaway directory).

Switching storage mode does not move anything automatically — use **Copy data in…** on the Storage
page, which copies from your other locations and leaves the originals as a backup.

## Plugins

Plugins add tools to your project boards — a runoff calculator, a fee estimator, a unit converter —
and can write results straight back into project fields. Each one is a folder with a
`manifest.json` and a single JavaScript file. No build step.

**To install one:** open the **Plugins** page in the left ribbon, click **Plugins folder**, drop the
plugin's folder in, and click **Refresh**. That button opens the right directory for your install
and creates it if needed:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\AEC Notebook\plugins` |
| macOS | `~/Library/Application Support/AEC Notebook/plugins` |
| Linux | `~/.config/AEC Notebook/plugins` |

Plugins run in an isolated sandbox with **no network and no filesystem access**, so a plugin can't
read your files or phone home — but it can write to the project it's mounted on if you install one
that declares the `writeField` permission. Install plugins you trust.

**To write one:** see **[PLUGINS.md](PLUGINS.md)** for the full guide — a five-minute starter
plugin, the manifest format, the `PluginAPI` reference, styling, sandbox limits, and
troubleshooting. `plugins/storm-runoff/` is a complete worked example.

## Architecture

```
src/main/       Electron main process — persistence, scanning, search index, plugin loading
  main.js         window, menu, IPC handlers, navigation guards
  storage.js      project.json / notes / attachments / config, atomic writes
  scanner.js      library folder scanning + moved-folder reconciliation
  searchIndex.js  MiniSearch full-text index
  plugins.js      plugin discovery + manifest validation
  preload.js      the entire renderer-facing API surface
src/shared/     Pure logic usable from either process (data_validation.js)
renderer/       UI — no Node access; everything goes through window.api
plugins/        Bundled sample plugins
test/           node:test unit tests
```

Security posture: `contextIsolation` on, `nodeIntegration` off, a channel-allowlisted preload, a
strict CSP on the app document, external links forced out to the system browser, and plugins
isolated behind a separate protocol scheme with their own CSP.

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a PR.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Civil Teach Source Group Limited.
