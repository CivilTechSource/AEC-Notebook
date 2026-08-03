// events.js — app-wide pub/sub for signals that aren't tied to one tab.
//
// Tabs already have per-tab lifecycle hooks (Tabs.setActivateHook / setDestroyHook), but those
// only reach the tab that registered them. Panels that live outside the tab — the right sidebar,
// for one — need to hear "the active note changed" without knowing which tab it came from.
//
// Follows the FsWatch idiom: subscribers pass an anchor element and the subscription is dropped
// once that element leaves the DOM, so a closed panel stops reacting.
(function () {
  const subs = new Map();   // name -> [{ fn, anchor }]

  function on(name, fn, anchor) {
    if (!subs.has(name)) subs.set(name, []);
    subs.get(name).push({ fn, anchor: anchor || null });
    return () => off(name, fn);
  }

  function off(name, fn) {
    const list = subs.get(name);
    if (!list) return;
    const i = list.findIndex((s) => s.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  function emit(name, payload) {
    const list = subs.get(name);
    if (!list) return;
    // Iterate backwards: handlers may unsubscribe, and detached anchors are spliced out in place.
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.anchor && !s.anchor.isConnected) { list.splice(i, 1); continue; }
      // One bad subscriber must not stop the others from being told.
      try { s.fn(payload); } catch (e) { console.error(`Events subscriber for "${name}" failed`, e); }
    }
  }

  window.Events = { on, off, emit };
})();
