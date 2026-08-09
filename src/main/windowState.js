// windowState.js — remember where the window was, and put it back there.
//
// The risky half of this is restoring: a saved position is only valid for the monitor layout it
// was saved on. Site laptops get docked and undocked constantly, so bounds recorded on a second
// monitor routinely point somewhere no display exists any more. Restoring those blind opens the
// window off-screen with no way to drag it back — fitToDisplays() is what prevents that.
const storage = require('./services/storage');
const { tracked } = require('./writeTracker');

const FILE = 'window.json';
const DEFAULTS = { width: 1440, height: 920 };
const MIN_VISIBLE = 80;    // px of the window's top edge that must land on a real display

// Pure: given saved bounds and the work areas of the attached displays, return bounds that are
// actually reachable, or null to fall back to the default centred window.
// Exported for testing — it takes work areas rather than reading `screen` itself.
function fitToDisplays(saved, workAreas) {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  if (!Array.isArray(workAreas) || !workAreas.length) return null;
  if (saved.width < 400 || saved.height < 300) return null;

  // The title bar is the only way to move a window, so it's the title bar that has to be
  // reachable — an overlap anywhere isn't enough.
  const titleBar = { x: saved.x, y: saved.y, width: saved.width, height: MIN_VISIBLE };
  const visible = workAreas.some((a) => {
    const overlapX = Math.min(titleBar.x + titleBar.width, a.x + a.width) - Math.max(titleBar.x, a.x);
    const overlapY = Math.min(titleBar.y + titleBar.height, a.y + a.height) - Math.max(titleBar.y, a.y);
    return overlapX > MIN_VISIBLE && overlapY > 0;
  });
  if (!visible) return null;

  // Don't hand back a window larger than the display it sits on.
  const home = workAreas.find((a) => saved.x >= a.x - 20 && saved.x < a.x + a.width) || workAreas[0];
  return {
    x: saved.x,
    y: saved.y,
    width: Math.min(saved.width, home.width),
    height: Math.min(saved.height, home.height),
  };
}

async function load() {
  let saved = null;
  try { saved = await storage.readConfig(FILE); } catch { /* corrupt or absent: use defaults */ }
  if (!saved) return { bounds: { ...DEFAULTS }, maximized: false };

  let areas = [];
  try { areas = require('electron').screen.getAllDisplays().map((d) => d.workArea); } catch { /* pre-ready */ }
  const bounds = fitToDisplays(saved.bounds, areas);
  return { bounds: bounds || { ...DEFAULTS }, maximized: !!saved.maximized };
}

// Persist on move/resize/close. Debounced: a drag fires these continuously.
function track(win) {
  let timer = null;
  const save = () => {
    if (win.isDestroyed()) return;
    // getNormalBounds() is the un-maximised geometry, which is what we want to restore to when
    // the user un-maximises later. getBounds() would record the full screen.
    const payload = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    // tracked(): the `close` save below fires during quit, so without this the process can exit
    // before the bytes land and the window reopens where it was two sessions ago.
    tracked(storage.writeConfig(FILE, payload)).catch(() => { /* a lost window position isn't worth a toast */ });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 400); };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  // 'close' fires before the window is gone, so the bounds are still readable here. Skipping the
  // debounce matters: the timer would never fire.
  win.on('close', () => { clearTimeout(timer); save(); });
}

module.exports = { load, track, fitToDisplays, DEFAULTS };
