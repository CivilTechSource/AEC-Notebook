<div align="center">

<img src="icon.png" alt="AEC Notebook" width="96" />

# AEC Notebook

**Turn the project folders you already have into a searchable, structured notebook.**

Point it at your projects drive. Define the fields *you* care about. Keep site notes beside the
work they describe — in plain JSON and Markdown you can still open without this app.

[Download](#download) · [Getting started](#getting-started) · [Writing plugins](PLUGINS.md) ·
[Contributing](CONTRIBUTING.md)

</div>

![A project board showing client, stage and contract value, a Zone 3 flood risk flag, linked notes, and a runoff calculator plugin](docs/images/project-board.png)

---

## The problem it solves

A structured place for engineers, architects and every other discipline to capture what they know
about a project — the facts *and* the experience.

Today those live apart. The facts end up in a spreadsheet that drifts out of date; the site notes
end up in someone's inbox. The only thing everyone agrees on is the project folder on the drive.

AEC Notebook puts both next to that folder. Your files never move, and nothing is locked in:
project data is a `project.json` you can read and diff, notes are ordinary `.md` files.

## What it does

**Point it at the project folders you already have.** Add a *library folder* — a folder that
contains your projects — and every project inside gets its own board automatically. Your files
never move and nothing is duplicated: the board and its notes sit right beside the real project
files, on the same drive everyone already uses.

**Attach whatever properties matter to each folder.** Every library folder gets its own field
definitions — text, number, date, select, multi-select, file, checkbox — grouped into sections you
can drag to reorder. Export a schema as JSON and reuse it on the next drive.

![The schema editor with a Flood Zone dropdown, its allowed options, a highlight rule, and a live preview](docs/images/schema-editor.png)

**Validation that reflects how you actually work.** Required fields, min/max, allowed options — and
cross-field rules. Here, selecting *Zone 3* demands a flood risk assessment on file before the
project counts as complete, and flags the field in red until it has one.

**Site notes that link to each other.** Markdown with `[[wikilinks]]`, `#tags`, backlinks, tables,
callouts, task lists, LaTeX and Mermaid diagrams. Rename a note and it offers to repoint every link
to it. Edit a note in another editor and the app notices instead of overwriting you. Every save
keeps a version you can diff and restore.

![A note in reading view with a heading, task list, tag chips, a wikilink and a backlinks panel](docs/images/notes.png)

**Drop files in and keep track of them.** Drag a photo, a marked-up PDF or a spreadsheet into a
note and it's copied in beside it. The project board lists every attachment with its size and which
notes link to it — and flags the ones nothing references any more, so a folder of site photos
doesn't quietly grow forever.

<!-- Screenshot to add: the Attachments section on a project board, with a couple of linked files
     and one flagged "not linked from any note". Save it as docs/images/attachments.png and
     uncomment the line below.
![The Attachments section on a project board, listing files with their sizes and which notes link to them](docs/images/attachments.png)
-->

**Track your CPD without a spreadsheet.** A built-in **CPD Tracker** logs Continuing Professional
Development against an annual hours target, with a place to attach evidence (certificates,
attendance records) against each entry, and a one-click summary you can copy out for an annual
return.

**Add more tools whenever you need them.** Plugins are how the app grows — a fee estimator, a
runoff calculator, a CPD log, whatever your team needs next. Drop a plugin's folder in and it shows
up in the app. Each one runs in an isolated sandbox with no network and no filesystem access, and
can only touch the project fields you've granted it, so a broken or untrusted plugin can't take the
app down or reach your files.

![The plugins page listing two sandboxed plugins with permission badges](docs/images/plugins.png)

**Plus:** a tabbed workspace with split panes and session restore · full-text search and a
`Ctrl/Cmd+P` quick switcher · a spreadsheet-style table view of every project in a folder,
exportable to CSV · note templates that fill themselves in from the project's own fields · light
and dark themes.

**Make it yours.** The **Settings** page adjusts the font, size, line spacing, heading scale,
column width and accent colour for notes. Everything in the app is a CSS variable, so a `custom.css`
in the app folder can change anything the page doesn't offer.

Not sure of the syntax? The **Syntax & shortcuts** pane on the right lists all of it — markdown and
keyboard — and clicking a snippet copies it.

## Download

Grab an installer from the [**Releases page**](../../releases/latest):

| Platform | File |
| --- | --- |
| Windows | `aec-notebook-<version>-win-x64.exe` |
| macOS | `aec-notebook-<version>-mac-<arch>.dmg` |
| Linux | `aec-notebook-<version>-linux-x64.AppImage` or `.deb` |

Installers are **not code-signed**, so Windows SmartScreen and macOS Gatekeeper will warn on first
run. On Windows choose *More info → Run anyway*; on macOS right-click the app and choose *Open*.
See [SECURITY.md](SECURITY.md).

Prefer to build it yourself? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Getting started

The left ribbon has the workspace at the top and everything configurable at the bottom.

1. Open **Storage & Files** (bottom of the ribbon) and add a *library folder* — a folder that
   contains project folders. Set how many levels deep the projects sit (1 = direct subfolders).
2. Open the **Schema Editor** and define the fields for that folder.
3. Pick a project in the left panel, hit **Edit**, and fill it in. Everything auto-saves.
4. Add a note from the project board, and drag any file into it to attach it.

## Where your data lives

Two things are stored separately.

**Per-project data** (`project.json` + `notes/*.md` + `attachments/`) goes wherever you choose on
the Storage page:

| Mode | Location |
| --- | --- |
| In folder *(default)* | `<project>/ProjectNotes/` |
| Central | `<userData>/Projects/<Project Name (id)>/` |
| Custom | `<your folder>/ProjectNotes/Projects/<Project Name (id)>/` |

**Note version history** is separate again, because snapshots are a safety net for the app rather
than a project deliverable — on a synced drive you don't want one every few minutes counting
against your quota. It defaults to the central app folder; **Storage & Files** can move it beside
the notes instead, and switching takes the existing snapshots with it.

**App config** (`settings.json`, `library.json`, `schemas.json`, `session.json`, `plugins.json`,
and your `custom.css`) always lives in the platform's user-data directory:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\AEC Notebook` |
| macOS | `~/Library/Application Support/AEC Notebook` |
| Linux | `~/.config/AEC Notebook` |

Set `PNOTES_HOME` to override that (useful for testing against a throwaway directory).

Switching storage mode does not move anything automatically — use **Copy data in…** on the Storage
page, which copies from your other locations and leaves the originals as a backup.

## Plugins

Plugins add tools to the app — a runoff calculator, a fee estimator, a CPD log. Each one is a folder
with a `manifest.json` and a single JavaScript file. No build step.

A plugin either adds a **section to every project board** and writes results straight back into
project fields, or takes its **own ribbon button and page** for a tool that owns its own data.
Two are bundled: **Storm Runoff Calculator** (board section) and **CPD Tracker** (activity page —
logs Continuing Professional Development against an annual target, with evidence files attached to
each entry and a summary you can copy out for an annual return).

**To install one:** open the **Plugins** page in the left ribbon, click **Plugins folder**, drop the
plugin's folder in, and click **Refresh**. That button opens the right directory for your install
and creates it if needed:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\AEC Notebook\plugins` |
| macOS | `~/Library/Application Support/AEC Notebook/plugins` |
| Linux | `~/.config/AEC Notebook/plugins` |

Plugins run in an isolated sandbox with **no network access and no filesystem access**, so a plugin
can't read your files or phone home. Anything beyond that is a permission it has to declare, and
the Plugins page badges each one: `writeField` (set fields on the project it's mounted on),
`storage` (its own settings file), `files` (its own folder, reached only through the file dialog
you drive), `projects` (a read-only list of your projects, including where they live). Install
plugins you trust.

**To write one:** see **[PLUGINS.md](PLUGINS.md)** for the full guide — a five-minute starter
plugin, the manifest format, the `PluginAPI` reference, styling, sandbox limits, and
troubleshooting. `plugins/storm-runoff/` is a complete worked example.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is
organised and how to get set up. Security details and the app's threat model live in
[SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Civil Teach Source Group Limited.
