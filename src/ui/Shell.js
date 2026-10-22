// The window shell: which workspace is active (Build / Program), the
// resizable + collapsible panels around the 3D view, and Simple vs Pro.
//
// Workspaces don't rebuild anything — every panel's content is mounted once
// and CSS shows the part tagged data-ws-only="<workspace>". Panel sizes are
// remembered per workspace (Build wants a wide library, Program a tall
// timeline). Simple/Pro is a body class: `.pro` controls and `.more`
// disclosures are hidden in Simple.

import { prefs, clamp } from './dom.js';
import { icon } from './icons.js';

export const WORKSPACES = [
  { id: 'build', label: 'Build', icon: 'build', keys: 'Ctrl+1', hint: 'Set up the venue, fixtures and patch' },
  { id: 'program', label: 'Program', icon: 'program', keys: 'Ctrl+2', hint: 'Program the show on the timeline' },
];

const MIN = { left: 190, right: 260, bottom: 140 };
const MAX = { left: 460, right: 520 };

const DEFAULTS = {
  build: { left: 248, right: 300, bottom: 220, open: { left: true, right: true, bottom: true } },
  program: { left: 232, right: 320, bottom: 330, open: { left: true, right: true, bottom: true } },
};

export class Shell {
  constructor() {
    this.body = document.body;
    this.listeners = new Set();
    const saved = prefs.get('layout', {});
    this.layout = {};
    for (const ws of WORKSPACES) {
      const d = DEFAULTS[ws.id];
      const s = saved[ws.id] || {};
      this.layout[ws.id] = { ...d, ...s, open: { ...d.open, ...(s.open || {}) } };
    }
    const ws = prefs.get('workspace', 'program');
    this._ws = WORKSPACES.some((w) => w.id === ws) ? ws : 'program';
    this._pro = prefs.get('pro', true);

    this.panels = {
      left: document.getElementById('left'),
      right: document.getElementById('right'),
      bottom: document.getElementById('bottom'),
    };
    this._initSplitters();
    this._initMoreMemory();
    this._apply();
    window.addEventListener('resize', () => this._apply());
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  get workspace() { return this._ws; }

  setWorkspace(id) {
    if (id === this._ws || !WORKSPACES.some((w) => w.id === id)) return;
    this._ws = id;
    prefs.set('workspace', id);
    this._apply();
    this._emit();
  }

  get pro() { return this._pro; }

  setPro(on) {
    if (on === this._pro) return;
    this._pro = !!on;
    prefs.set('pro', this._pro);
    this._apply();
    this._emit();
  }

  isOpen(which) { return this.layout[this._ws].open[which]; }

  /** Show/hide a panel (left | right | bottom) in the current workspace. */
  togglePanel(which, force) {
    const L = this.layout[this._ws];
    L.open[which] = force ?? !L.open[which];
    this._save();
    this._apply();
    this._emit();
  }

  _save() { prefs.set('layout', this.layout); }

  _apply() {
    const L = this.layout[this._ws];
    const b = this.body;
    b.dataset.ws = this._ws;
    b.classList.toggle('simple', !this._pro);
    b.classList.toggle('pro-mode', this._pro);
    const maxBottom = Math.max(MIN.bottom, Math.floor(window.innerHeight * 0.7));
    L.bottom = clamp(L.bottom, MIN.bottom, maxBottom);
    b.style.setProperty('--left-w', L.open.left ? `${L.left}px` : '0px');
    b.style.setProperty('--right-w', L.open.right ? `${L.right}px` : '0px');
    b.style.setProperty('--bottom-h', L.open.bottom ? `${L.bottom}px` : '0px');
    for (const which of ['left', 'right', 'bottom']) {
      this.panels[which].classList.toggle('closed', !L.open[which]);
      const reopen = this._reopen[which];
      if (reopen) reopen.hidden = L.open[which];
    }
  }

  _initSplitters() {
    this._reopen = {};
    const arrow = { left: 'chev-right', right: 'chev-left', bottom: 'chev-left' };
    for (const split of document.querySelectorAll('.split[data-split]')) {
      const which = split.dataset.split;
      // A small tab on the splitter re-opens a hidden panel.
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reopen';
      btn.title = `Show ${which === 'left' ? 'library' : which === 'right' ? 'inspector' : 'bottom panel'}`;
      btn.innerHTML = icon(arrow[which], 'sm');
      if (which === 'bottom') btn.firstElementChild.style.transform = 'rotate(90deg)';
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => this.togglePanel(which, true));
      split.appendChild(btn);
      this._reopen[which] = btn;

      split.addEventListener('dblclick', (e) => { if (e.target === split) this.togglePanel(which); });
      split.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target !== split) return;
        e.preventDefault();
        split.setPointerCapture(e.pointerId);
        split.classList.add('dragging');
        const L = this.layout[this._ws];
        const move = (ev) => {
          let size;
          if (which === 'left') size = ev.clientX - this.panels.left.getBoundingClientRect().left;
          else if (which === 'right') size = this.panels.right.getBoundingClientRect().right - ev.clientX;
          else size = this.panels.bottom.getBoundingClientRect().bottom - ev.clientY - 2;
          if (size < MIN[which] * 0.6) {
            if (L.open[which]) { L.open[which] = false; this._apply(); }
            return;
          }
          L.open[which] = true;
          L[which] = which === 'bottom'
            ? clamp(size, MIN.bottom, Math.floor(window.innerHeight * 0.7))
            : clamp(size, MIN[which], MAX[which]);
          this._apply();
        };
        const up = () => {
          split.classList.remove('dragging');
          split.removeEventListener('pointermove', move);
          split.removeEventListener('pointerup', up);
          split.removeEventListener('pointercancel', up);
          this._save();
          this._emit();
        };
        split.addEventListener('pointermove', move);
        split.addEventListener('pointerup', up);
        split.addEventListener('pointercancel', up);
      });
    }
  }

  // Remember which "More" sections are open (the toggle event doesn't bubble,
  // so listen in the capture phase).
  _initMoreMemory() {
    document.addEventListener('toggle', (e) => {
      const d = e.target;
      if (d instanceof HTMLDetailsElement && d.dataset.more) prefs.set(`more.${d.dataset.more}`, d.open);
    }, true);
  }
}
