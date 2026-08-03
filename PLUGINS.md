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
| `permissions` | no | Array of capabilities. Currently only `"writeField"` exists. |

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

Your iframe is resized to fit its content automatically; don't set a fixed height on `body`.

---

## The sandbox — what you cannot do

Plugins run in `<iframe sandbox="allow-scripts">` on an opaque origin, served under a
`default-src 'none'` policy. This is deliberate: a plugin you downloaded shouldn't be able to read
your files or phone home.

| Not available | Do this instead |
| --- | --- |
| Network — `fetch`, `XMLHttpRequest`, WebSockets, remote images/fonts/scripts | Bundle what you need. Plugins are offline tools. |
| `localStorage`, `sessionStorage`, cookies (these **throw**, they don't just fail) | Persist via `writeField` into a project field. |
| Node, `require`, `fs`, filesystem access of any kind | — |
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
