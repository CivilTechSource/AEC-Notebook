// userStyles.js — the user's own CSS, kept as a plain file in the app folder.
//
// The Settings page covers the things most people want to change. This is the escape hatch for
// everything else, and it exists because the alternative is a settings page that grows a control
// per request forever. Every colour, size and spacing in the app is a CSS custom property
// (renderer/styles/tokens.css), so a few lines here can retheme the whole thing.
//
// It is READ and injected as text rather than linked as a stylesheet. The renderer is served over
// file://, where a <link> to another path is not `'self'` under the document's CSP; injecting the
// text into a <style> element uses the `style-src 'unsafe-inline'` the app already relies on, and
// keeps the CSP unchanged. It also means a missing file is simply an empty string rather than a
// failed request in the console.
const fsp = require('fs/promises');
const path = require('path');
const storage = require('./storage');

const FILENAME = 'custom.css';

function userCssPath() { return path.join(storage.centralRoot(), FILENAME); }

// Written once, on first use, so the file people are told to open isn't blank and doesn't need
// the docs open beside it. Never rewritten — once it exists it's theirs.
const STARTER = `/* custom.css — your own styles, loaded after everything else.
 *
 * The whole app is built on CSS custom properties, so overriding one here changes it everywhere
 * it's used. The full list is in renderer/styles/tokens.css inside the app.
 *
 * Anything the Settings page controls is applied on top of this, so if a rule below seems to have
 * no effect, check whether Settings is setting the same property.
 *
 * Uncomment something to try it.
 */

:root {
  /* --- accent -------------------------------------------------------- */
  /* --accent: #7c5cff;        */  /* links, selection, the active-tab bar */
  /* --accent-h: #8f74ff;      */  /* its hover shade                      */

  /* --- note typography ----------------------------------------------- */
  /* --editor-font: Georgia, 'Iowan Old Style', serif; */
  /* --editor-fs: 15px;        */
  /* --editor-lh: 1.8;         */
  /* --editor-measure: 900px;  */  /* how wide the note column is allowed to get */

  /* --- surfaces ------------------------------------------------------- */
  /* --bg: #1a1c20;            */  /* the main canvas   */
  /* --bg-panel: #141619;      */  /* the side panels   */
  /* --radius-lg: 4px;         */  /* squarer cards     */
}

/* Rules work too, not just tokens. For example, to give headings in a note
   their own family:

.note-reading h1, .note-reading h2, .note-reading h3 {
  font-family: 'Segoe UI', system-ui, sans-serif;
  letter-spacing: -0.2px;
}
*/
`;

async function ensureUserCss() {
  const file = userCssPath();
  try { await fsp.access(file); return false; }        // already there — leave it entirely alone
  catch { /* first use */ }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  // 'wx' so two windows racing on first launch can't have one truncate the other's copy.
  try { await fsp.writeFile(file, STARTER, { encoding: 'utf8', flag: 'wx' }); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  return true;
}

// Returns '' when there is nothing to apply. A read failure must not stop the app from painting,
// so it is reported to the caller as empty rather than thrown.
async function readUserCss() {
  try { return await fsp.readFile(userCssPath(), 'utf8'); }
  catch { return ''; }
}

module.exports = { FILENAME, userCssPath, ensureUserCss, readUserCss };
