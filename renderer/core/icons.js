// icons.js — inline SVG set lifted from the Claude Design mockup, exposed as window.ICON.
(function () {
  const ICON = {
    // ribbon
    board:  '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="2.5" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="2" x2="7" y2="16" stroke="currentColor" stroke-width="1.3"/><line x1="12" y1="2" x2="12" y2="16" stroke="currentColor" stroke-width="1.3"/></svg>',
    schema: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="3" width="13" height="3" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="2.5" y="8" width="13" height="3" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="2.5" y="13" width="9" height="2" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>',
    plugin: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 2.5v2M11 2.5v2M4 4.5h9v4a4.5 4.5 0 01-9 0z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 13v2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    storage:'<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><ellipse cx="9" cy="4.5" rx="6" ry="2.3" stroke="currentColor" stroke-width="1.3"/><path d="M3 4.5v9c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3v-9" stroke="currentColor" stroke-width="1.3"/><path d="M3 9c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3" stroke="currentColor" stroke-width="1.3"/></svg>',
    gear:   '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.6" stroke="currentColor" stroke-width="1.2"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    template: '<svg width="14" height="14" viewBox="0 0 15 15" fill="none"><rect x="2" y="1.8" width="11" height="11.4" rx="1.6" stroke="currentColor" stroke-width="1.2"/><path d="M2 5.3h11M5.6 5.3v7.9" stroke="currentColor" stroke-width="1.2"/></svg>',
    // right sidebar panes
    backlink: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7.5 10.5a3 3 0 004.24 0l2.5-2.5a3 3 0 00-4.24-4.24l-.9.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 7.5a3 3 0 00-4.24 0l-2.5 2.5a3 3 0 004.24 4.24l.9-.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    outline:  '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 4h12M5 8h10M7 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    outlink:  '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7 3.5H4.2a.7.7 0 00-.7.7v9.6a.7.7 0 00.7.7h9.6a.7.7 0 00.7-.7V11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 3.5h4.5V8M14.5 3.5L8 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tag:      '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6.5 3v12M11.5 3v12M3 6.5h12M3 11.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    collapse: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // tabs / notes
    note:    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4 1.8h4.5L11.5 5v8.2a.8.8 0 01-.8.8H4a.8.8 0 01-.8-.8V2.6a.8.8 0 01.8-.8z" stroke="currentColor" stroke-width="1.2"/><path d="M8 1.8V5h3.3" stroke="currentColor" stroke-width="1.2"/></svg>',
    boardTab:'<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="1.5" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><line x1="5.5" y1="1.5" x2="5.5" y2="13.5" stroke="currentColor" stroke-width="1.2"/></svg>',
    // misc
    chevDown:'<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 4l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1.5 4a1 1 0 011-1h2.8l1.2 1.3h6a1 1 0 011 1v6.4a1 1 0 01-1 1H2.5a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    folderBig:'<svg width="18" height="18" viewBox="0 0 19 19" fill="none"><path d="M2 4.5a1 1 0 011-1h3.4l1.5 1.6h7.1a1 1 0 011 1v7.4a1 1 0 01-1 1H3a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    refresh: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11.5 6.5a5 5 0 11-1.5-3.6M11.5 1v3h-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus:    '<svg width="13" height="13" viewBox="0 0 13 13"><line x1="6.5" y1="2.5" x2="6.5" y2="10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="2.5" y1="6.5" x2="10.5" y2="6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    grip:    '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3.5" r="1.1"/><circle cx="7" cy="3.5" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/><circle cx="3" cy="12.5" r="1.1"/><circle cx="7" cy="12.5" r="1.1"/></svg>',
    shield:  '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.2l4.3 1.6v3.4c0 2.8-1.9 4.5-4.3 5.4-2.4-.9-4.3-2.6-4.3-5.4V2.8z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M4.6 6.4l1.4 1.4 2.6-2.7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn:    '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.5l5.3 9.2H1.2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.5 5v2.3M6.5 9h.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    export:  '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.5v7M4 6l2.5 2.5L9 6M2.5 11h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    import:  '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 8.5v-7M4 4l2.5-2.5L9 4M2.5 11h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy:    '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.3" stroke="currentColor" stroke-width="1.1"/><path d="M9 3.5V2.2a.7.7 0 00-.7-.7H2.5a.7.7 0 00-.7.7v5.8a.7.7 0 00.7.7H3.5" stroke="currentColor" stroke-width="1.1"/></svg>',
  };

  // field-type icons + colors
  const FIELD_ICON = {
    text:    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 4h9M7.5 4v8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    textarea:'<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 4h9M3 7.5h9M3 11h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    date:    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2" y="3" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h11M5 1.5v3M10 1.5v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    dropdown:'<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2" y="3" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 6.5l1.5 1.5L9 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    number:  '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M5 3l-1 9M11 3l-1 9M3 6h9M2.5 10h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    file:    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4 1.5h4L11 4.5v8a.7.7 0 01-.7.7H4a.7.7 0 01-.7-.7v-10a.7.7 0 01.7-.8z" stroke="currentColor" stroke-width="1.2"/><path d="M7.5 1.5V5h3" stroke="currentColor" stroke-width="1.2"/></svg>',
    checkbox:'<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="2" y="2" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 7.5l2 2 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // Without this, multi-select fields fell back to the plain "text" icon in the schema list.
    multiselect:'<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1.5" y="3" width="5" height="4" rx="1.2" stroke="currentColor" stroke-width="1.2"/><rect x="1.5" y="8.5" width="5" height="4" rx="1.2" stroke="currentColor" stroke-width="1.2"/><path d="M8.5 5h5M8.5 10.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  };

  window.ICON = ICON;
  window.FIELD_ICON = FIELD_ICON;
})();
