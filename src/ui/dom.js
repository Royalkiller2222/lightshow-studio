// Small DOM + preference helpers shared by the UI modules. No framework: views
// render HTML strings and wire events by delegation; these keep that tidy.

import { icon } from './icons.js';

/** Escape text for HTML content / attribute values. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Build an element from an HTML string (first element child). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 0:12.4 style time (minutes:seconds.tenths); `tenths=false` drops them. */
export function fmtTime(sec, tenths = true) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${m}:${ss}`;
}

export function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb) {
  const [r, g, b] = rgb || [1, 1, 1];
  const h = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** True when keyboard focus is in a field that types text (shortcuts stand down). */
export function isTypingTarget(t) {
  const tag = (t && t.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return !!(t && t.isContentEditable);
  return t.type !== 'range' && t.type !== 'color' && t.type !== 'button';
}

// ---- per-viewer UI preferences (panel sizes, workspace, Simple/Pro, ...) ----
// Conveniences only: everything must work when storage is unavailable.
const PREFIX = 'lss.';

export const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

/**
 * A "More" disclosure for advanced controls. Only shown in Pro (hidden in
 * Simple by CSS); its open/closed state is remembered per `key` by the Shell.
 */
export function more(key, inner, label = 'More') {
  const open = prefs.get(`more.${key}`, false);
  return `<details class="more" data-more="${esc(key)}"${open ? ' open' : ''}>
    <summary>${icon('chev-right', 'sm')}${esc(label)}</summary>
    <div class="more-body">${inner}</div>
  </details>`;
}
