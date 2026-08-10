# Writing Plugins for AEC Notebook

A plugin is a folder with two files: a `manifest.json` describing it, and a JavaScript file that
draws its UI. No build step, no dependencies, no framework — if you can write a `<script>` tag,
you can write a plugin.

Plugins can add a section to every project board (a runoff calculator, a fee estimator, a unit
converter) and, with permission, write results straight back into a project's fields.

---

## Where plugins live

There are two locations. **You install plugins into the first one.**

### Your plugins folder

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\AEC Notebook\plugins` |
| macOS | `~/Library/Application Support/AEC Notebook/plugins` |
| Linux | `~/.config/AEC Notebook/plugins` |

**Don't type these from memory.** Open the app, go to the **Plugins** page in the left ribbon, and
click **Plugins folder**. That opens the exact directory for your install and creates it if it
doesn't exist yet.

> Running from source (`npm start`) rather than an installed build? The folder is named after the
> package instead — `%APPDATA%\aec-notebook\plugins` on Windows, and so on. The **Plugins folder**
> button always gets it right.

### Bundled plugins

The sample plugins that ship with the app live in the app's own `plugins/` directory. In an
installed build that directory is read-only, so don't try to add anything there. If you install a
plugin whose `id` matches a bundled one, yours wins.

### Installing a plugin

1. Plugins page → **Plugins folder**.
2. Drop the plugin's folder inside. Keep it as a folder — `manifest.json` must sit at its top level,
   not nested in an extra directory. A GitHub ZIP usually unzips to `plugin-name-main/`; either
   rename that or move its contents up one level.
3. Back in the app, click **Refresh**.

Your folder should look like this:

```
%APPDATA%\AEC Notebook\plugins\
  fee-estimator\
    manifest.json
    index.js
  storm-runoff\
    manifest.json
    index.js
```

To remove a plugin, delete its folder and click Refresh. To switch one off without deleting it,
use the toggle on its card.

If a plugin doesn't appear after Refresh, its manifest was rejected — see
[Troubleshooting](#troubleshooting).

### Sharing a plugin

Publish the folder as a Git repository and tell people to clone or download it into their plugins
folder. There's no registry and no installer. Include a README saying what permissions it asks for
and why.

---

## Your first plugin

Create `hello/` in your plugins folder with these two files.

**`manifest.json`**

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello and shows the project name.",
  "entry": "index.js",
  "contributes": { "boardSection": { "title": "Hello" } }
}
```

**`index.js`**

```js
const root = document.getElementById('root');
root.innerHTML = '<div class="card">Loading…</div>';

PluginAPI.onInit(({ projectName, fields }) => {
  root.innerHTML = `
    <div class="card">
      <p>Hello from <b>${projectName || 'no project'}</b>.</p>
      <p class="muted">This board has ${fields.length} field(s).</p>
      <button id="hi">Say hi</button>
    </div>`;
  document.getElementById('hi').onclick = () => PluginAPI.notify('Hi!');
});
```

Click **Refresh** on the Plugins page. "Hello" appears in the list; open any project board and
you'll see a **Hello** section. The **Run** button on the Plugins page runs it standalone, without
a project attached.

---

## manifest.json

| Key | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique identifier. Letters, digits, `.`, `_`, `-`; must start with a letter or digit. Used for enable/disable state, so keep it stable across versions. |
| `name` | yes | Display name. |
| `version` | no | Shown on the card. Defaults to `0.0.0`. |
| `description` | no | One line, shown under the name. |
| `entry` | no | Script filename. Defaults to `index.js`. Must be a plain `.js` filename inside the plugin folder — subdirectories, `..`, and absolute paths are rejected. |
| `contributes.boardSection.title` | no | Adds a section with this heading to every project board. Omit it and the plugin only runs from the Plugins page. |
| `contributes.activity.title` | no | Gives the plugin its own ribbon button and a full page of its own, instead of a board section. For a tool that owns a whole workflow rather than annotating one project. |
| `contributes.activity.icon` | no | The *name* of an icon in the app's own set (`renderer/core/icons.js`), e.g. `"cpd"`. Anything unrecognised falls back to the first letter of `name`. You cannot supply your own SVG — that markup would land in the app's DOM, outside your sandbox. |
| `permissions` | no | Array of capabilities: `"writeField"`, `"storage"`, `"files"`, `"projects"`. Each is refused unless declared. |

### Board section or activity page?

A **board section** renders inside *every* project board, below Notes and Attachments, with the
mounted project's fields in `ctx`. Right for something that annotates or calculates against one
project.

An **activity page** gets a ribbon button and the whole page. It is mounted once, with no project
context, and is not re-mounted when you navigate away and back — so a half-typed form survives.
Right for a tool that owns its own data (a log, a register, a tracker). In this mode your frame is
sized by the layout, not by your content, so set `html,body{height:100%}` yourself and scroll your
own body.

Everything is one file: `entry` is the only script loaded. If you want to split code up, inline it
or concatenate it yourself before shipping.

---

## The PluginAPI

`window.PluginAPI` is injected before your script runs.

### `onInit(callback)`

Fires when the host sends the project context. **Do your rendering here** — the data isn't
available synchronously at script start. If init already happened, your callback runs immediately.

```js
PluginAPI.onInit((ctx) => {
  ctx.projectName;   // "Riverside Culvert", or "" when run standalone
  ctx.fields;        // [{ key, label, type }, …] — the board's schema fields
  ctx.values;        // { fieldKey: value, … } — the project's current data
  ctx.theme;         // CSS variables (already applied for you)
});
```

`ctx.values` is a snapshot taken when the plugin mounted. It does not update live.

### `getFields()`

The same `fields` array, for use after init. Returns `[]` before init.

### `writeField(key, value)` → `Promise<{ ok, error? }>`

Writes a value into the project's data. **Requires `"permissions": ["writeField"]` in your
manifest.**

```js
const res = await PluginAPI.writeField('peak_flow', 42.5);
if (!res.ok) console.warn(res.error);   // "permission denied" | "unknown field"
```

It fails when: the permission isn't declared; the plugin is running standalone (no project); or
`key` doesn't match a field in the current board's schema. Always check `res.ok` — don't assume it
worked.

Match the field's type: a `number` field wants a JS number, `checkbox` wants a boolean,
`multiselect` wants an array of option values, `dropdown` wants one option value.

### `copy(text)`

Copies text to the clipboard through the host and shows a confirmation. Fire-and-forget.

### `notify(message)`

Shows a toast in the app. Fire-and-forget.

### `storage.get()` / `storage.set(data)` → `Promise<{ ok, data?, error? }>`

Requires `"storage"`. Your plugin's own JSON document, stored beside the app's config in the user
profile as `plugin-<your-id>.json` — **not** in the install directory, which needs admin rights and
is replaced on every update.

It is a whole-document read and write, not a key/value store: read once on init, keep it in memory,
and write the whole thing back when it changes.

```js
const res = await PluginAPI.storage.get();
const doc = (res.ok && res.data) || { entries: [] };
doc.entries.push({ hours: 3.5 });
const w = await PluginAPI.storage.set(doc);
if (!w.ok) PluginAPI.notify('Could not save: ' + w.error);   // never claim a save that didn't land
```

Capped at 2 MB serialised; past that `set` returns `{ ok: false }` rather than growing the config
root without bound. The write goes through the app's normal config path, so it is atomic and keeps
a `.bak`. Because the filename comes from your `id`, changing your `id` orphans the data.

### `files.*` → `Promise<{ ok, … }>`

Requires `"files"`. A private folder for the plugin, at `plugin-data/<your-id>/files/`.

| Call | Returns |
| --- | --- |
| `files.pick()` | Opens the OS file dialog and copies the chosen file in. `{ ok, name, size }`, or `{ ok, cancelled: true }`. |
| `files.list()` | `{ ok, files: [{ name, size, modified }] }` |
| `files.read(name)` | `{ ok, dataUrl }` — a `data:` URL |
| `files.open(name)` / `files.reveal(name)` | Hands the file to the OS |
| `files.remove(name)` | Deletes it |

You never see or supply a filesystem path — only the name the file was stored under. Files are
capped at the same size as attachments, and a name collision renames rather than overwrites.

`read` is only useful for **images**: this page's CSP allows `img-src data:` and nothing else, so a
PDF in an `<embed>` is blocked. Preview images inline, and give everything else an Open button.

### `listProjects()` → `Promise<{ ok, projects }>`

Requires `"projects"`. Read-only: `[{ id, name, group }]`, where `group` is the library folder's
name. Use `id` if you need to store a durable reference to a project.

---

## Styling

The host injects its stylesheet and pushes its theme variables into your document, including when
the user toggles light/dark. Use the variables and classes and your plugin looks native
automatically:

- **Variables:** `--bg`, `--bg-card`, `--text`, `--text-2`, `--muted`, `--line`, `--line-3`,
  `--accent`, `--green`, `--amber`, `--red`, `--teal`, `--purple`, `--radius`, `--mono`
- **Classes:** `.card`, `.btn`, `.btn.primary`, `.muted`, `.mono`, `.lbl`
- `button`, `input`, `select`, `textarea`, `label`, and `a` are already styled

Don't hardcode colours — `#fff` looks wrong the moment someone switches theme. Use `var(--text)`.

Your iframe is resized to fit its content automatically; don't set a fixed height on `body`. The
exception is a `contributes.activity` plugin, which owns the page: there the frame is sized by the
layout and you set `html,body{height:100%}` and scroll your own body.

---

## The sandbox — what you cannot do

Plugins run in `<iframe sandbox="allow-scripts">` on an opaque origin, served under a
`default-src 'none'` policy. This is deliberate: a plugin you downloaded shouldn't be able to read
your files or phone home.

| Not available | Do this instead |
| --- | --- |
| Network — `fetch`, `XMLHttpRequest`, WebSockets, remote images/fonts/scripts | Bundle what you need. Plugins are offline tools. |
| `localStorage`, `sessionStorage`, cookies (these **throw**, they don't just fail) | `PluginAPI.storage` for your own data, or `writeField` to set a project field. |
| Node, `require`, `fs`, filesystem access of any kind | `PluginAPI.files` — a private folder, reached by filename, never by path. |
| Downloading a file (`<a download href="data:…">` is blocked by the CSP) | `PluginAPI.copy()` — put CSV or Markdown on the clipboard and let the user paste it. |
| The app's DOM, its variables, other plugins | Use `PluginAPI`. |
| `window.open`, navigation, alerts | `PluginAPI.notify()`. |
| Remote images | Inline `data:` URIs (allowed) or SVG. |

Your script is wrapped in a `try/catch`. An uncaught error shows in place of your UI instead of
breaking the board — so a broken plugin can't take the app down, but it also won't be silent.

---

## Practical notes

**Debugging.** View → Toggle Developer Tools, then pick your plugin's frame in the console's
context dropdown. `console.log` works normally.

**Reloading during development.** Edit your file, then click **Refresh** on the Plugins page.

**Guard for standalone.** A plugin with a `boardSection` also runs from the Plugins page with no
project — `projectName` is `""` and `fields` is `[]`. Check before offering to write anything:

```js
PluginAPI.onInit(({ fields }) => {
  const numbers = fields.filter((f) => f.type === 'number');
  if (numbers.length) showSaveButton(numbers);   // only when there's somewhere to save
});
```

**Don't assume field keys exist.** Every library folder has its own schema, so `peak_flow` may not
be there. Filter `fields` by `type` and let the user pick the target, as `storm-runoff` does.

**Escape anything you inject.** `innerHTML` with a project value in it is an injection risk inside
your own frame. Prefer `textContent`, or escape.

---

## Troubleshooting

**Plugin doesn't appear after Refresh.** The manifest was rejected. Causes, in rough order of
likelihood:

- `manifest.json` isn't at the top level of the plugin folder (extra nesting from a ZIP)
- Invalid JSON — a trailing comma will do it
- `id` has spaces or illegal characters
- `entry` names a file that doesn't exist, isn't `.js`, or contains a path separator or `..`

Run the app from a terminal (`npm start`) and you'll see the reason logged as
`[plugins] skipping <folder>: <why>`.

**"Plugin error: …" where the UI should be.** Your script threw. Open DevTools for the stack.

**`writeField` returns `permission denied`.** Add `"permissions": ["writeField"]` to the manifest
and click Refresh.

**`writeField` returns `unknown field`.** Either no project is attached (running standalone), or
the key isn't in that board's schema.

**Styling looks wrong in light mode.** You hardcoded a colour. Use the CSS variables.

---

## A complete example

`plugins/storm-runoff/` in the repository is a working plugin that uses nearly all of this: schema
inspection, `writeField` with a user-chosen target, `copy`, themed styling, and a standalone mode.
Read it alongside this document.
