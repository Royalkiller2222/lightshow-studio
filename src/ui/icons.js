// The app's icon set: small hand-drawn 24×24 line icons (no icon font or
// library — keeps the one-click install dependency-free and works under the
// page's strict CSP). icon(name) returns an inline <svg> string that inherits
// `currentColor`, so icons follow the text colour of whatever they sit in.

const P = {
  logo: '<path d="M4 20 20 7M4 20l16-3M4 20 15 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor" stroke="none"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
  open: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5"/><circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  pointer: '<path d="M5.5 3.5 18 11l-5.6 1.4L9.6 18z"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m9 5.5 3-2.5 3 2.5M9 18.5l3 2.5 3-2.5M5.5 9 3 12l2.5 3M18.5 9l2.5 3-2.5 3"/>',
  rotate: '<path d="M19.5 12A7.5 7.5 0 1 1 17 6.4"/><path d="M19.5 3.5v4.5H15"/>',
  home: '<path d="m4 11 8-7 8 7"/><path d="M6.5 9.5V20h11V9.5"/>',
  haze: '<path d="M7 17.5h10a4 4 0 0 0 .4-8A5.8 5.8 0 0 0 6.2 10.7 3.5 3.5 0 0 0 7 17.5z"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  sparkles: '<path d="m11 3 1.7 4.6L17.3 9.3l-4.6 1.7L11 15.6 9.3 11 4.7 9.3l4.6-1.7z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'chev-right': '<path d="m9 6 6 6-6 6"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  'chev-left': '<path d="m15 6-6 6 6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M8.5 7 3.5 12l5 5zM15.5 7l5 5-5 5z"/>',
  diamond: '<path d="m12 4 7 8-7 8-7-8z"/>',
  build: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  program: '<rect x="3" y="5" width="9" height="5" rx="1.2"/><rect x="9" y="14" width="12" height="5" rx="1.2"/><path d="M15 7.5h6M3 16.5h3"/>',
  output: '<circle cx="12" cy="12" r="2"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  warning: '<path d="M12 4 21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".7" fill="currentColor" stroke="none"/>',
  grip: '<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>',
  'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15"/>',
  'panel-right': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M15 4.5v15"/>',
  'panel-bottom': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 14h17"/>',
  laser: '<rect x="2.5" y="14.5" width="6" height="5" rx="1"/><path d="m8.5 16 12.5-9M8.5 17l12.5-4M8.5 18l12.5 1"/>',
  // fixture types
  'moving-head': '<path d="M6.5 4h11M8 4v5.5M16 4v5.5"/><rect x="8" y="8.5" width="8" height="7.5" rx="2.2"/><path d="m10 16-2 5M14 16l2 5"/>',
  'led-par': '<circle cx="12" cy="11" r="6.5"/><circle cx="12" cy="11" r="2.6"/><path d="M12 2.5v2"/>',
  'pixel-bar': '<rect x="2.5" y="9" width="19" height="6" rx="1.5"/><path d="M6.5 12h.01M10 12h.01M14 12h.01M17.5 12h.01" stroke-width="2.6"/>',
  batten: '<rect x="2.5" y="9.5" width="19" height="4.5" rx="1"/><path d="m5 14-1 6M12 14v6M19 14l1 6"/>',
  'cold-spark': '<rect x="7" y="17" width="10" height="4" rx="1"/><path d="M12 14V3.5M9 13.5 7 7.5M15 13.5l2-6"/>',
  podium: '<path d="M3.5 20.5h17M6 20.5v-9h12v9M9 11.5v-3h6v3"/>',
};

/** Inline SVG for a named icon (`cls` adds classes, e.g. 'lg'). */
export function icon(name, cls = '') {
  const body = P[name] || P.help;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Fixture-type icon: falls back to a generic bulb for unknown types. */
export function fixtureIcon(typeKey, cls = '') {
  return icon(P[typeKey] ? typeKey : 'bulb', cls);
}
