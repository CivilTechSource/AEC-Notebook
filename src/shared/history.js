// history.js — how long note snapshots are kept.
//
// Pure policy, no filesystem, so the rules can be tested directly. The shape of it:
//
//   under 24 hours   keep every snapshot          — this is the "undo my afternoon" window
//   24h to 30 days   keep the newest per day      — enough to answer "what did this say last week"
//   over 30 days     drop, except the oldest one
//
// That last exception is narrow on purpose. The point is to preserve the ORIGIN record: a note
// written a year ago and edited once should still be able to show what it first said, rather than
// having that fall off the end. It deliberately applies only to snapshots already past the daily
// window — applying it to the oldest snapshot overall would pin a same-day duplicate and defeat
// the daily collapse.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const DEFAULTS = {
  keepAllMs: 24 * HOUR,   // everything newer than this survives untouched
  dailyDays: 30,          // beyond that, one per calendar day for this many days
};

// Local calendar day, not UTC: "last Tuesday" means the user's Tuesday.
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Decide which snapshots to keep.
 * @param {number[]} timestamps epoch ms, any order
 * @param {number}   now        injectable clock
 * @returns {{ keep: number[], drop: number[] }} both newest-first
 */
function planRetention(timestamps, now = Date.now(), opts = {}) {
  const { keepAllMs, dailyDays } = { ...DEFAULTS, ...opts };
  const sorted = [...new Set(timestamps)].sort((a, b) => b - a);   // newest first
  if (!sorted.length) return { keep: [], drop: [] };

  const keep = new Set();
  const seenDays = new Set();
  const dailyCutoff = now - dailyDays * DAY;
  const expired = [];                               // older than the daily window

  for (const ts of sorted) {
    const age = now - ts;
    if (age <= keepAllMs) { keep.add(ts); continue; }
    if (ts < dailyCutoff) { expired.push(ts); continue; }
    const key = dayKey(ts);
    // sorted is newest-first, so the first one seen for a day IS that day's newest.
    if (!seenDays.has(key)) { seenDays.add(key); keep.add(ts); }
  }

  // Of the ones that have aged out entirely, hold on to the very first — the origin record.
  if (expired.length) keep.add(expired[expired.length - 1]);

  return {
    keep: sorted.filter((t) => keep.has(t)),
    drop: sorted.filter((t) => !keep.has(t)),
  };
}

const historyApi = { planRetention, dayKey, DEFAULTS };

// Dual export: CommonJS (main process) + global (renderer). Distinctive identifier on purpose —
// see the note in theme.js about top-level consts colliding with preload globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = historyApi;
}
if (typeof window !== 'undefined') {
  window.HistoryPolicy = historyApi;
}
