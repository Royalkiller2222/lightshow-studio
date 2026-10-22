// Floating UI: anchored popovers (output settings, help) and toast
// notifications (save/load results). One popover is open at a time; it closes
// on Esc, on a click outside, or when its anchor is clicked again.

import { esc } from './dom.js';

let openPopover = null;

export class Popover {
  /**
   * @param {HTMLElement} anchor  element the popover hangs under
   * @param {HTMLElement} content element shown inside the popover
   * @param {{ align?: 'start'|'end', onOpen?: Function, onClose?: Function, label?: string }} opts
   */
  constructor(anchor, content, { align = 'end', onOpen = null, onClose = null, label = '' } = {}) {
    this.anchor = anchor;
    this.align = align;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.root = document.createElement('div');
    this.root.className = 'popover';
    this.root.setAttribute('role', 'dialog');
    if (label) this.root.setAttribute('aria-label', label);
    this.root.hidden = true;
    this.root.appendChild(content);
    document.body.appendChild(this.root);

    anchor.addEventListener('click', () => this.toggle());
    this._outside = (e) => {
      if (this.root.contains(e.target) || this.anchor.contains(e.target)) return;
      this.close();
    };
    this._key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); this.anchor.focus(); } };
  }

  get isOpen() { return !this.root.hidden; }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (openPopover && openPopover !== this) openPopover.close();
    openPopover = this;
    this.onOpen?.();
    this.root.hidden = false;
    this.anchor.setAttribute('aria-expanded', 'true');
    this.place();
    window.addEventListener('pointerdown', this._outside, true);
    window.addEventListener('keydown', this._key, true);
    window.addEventListener('resize', this._placeBound = () => this.place());
    const first = this.root.querySelector('input, select, button');
    first?.focus({ preventScroll: true });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.anchor.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', this._outside, true);
    window.removeEventListener('keydown', this._key, true);
    window.removeEventListener('resize', this._placeBound);
    if (openPopover === this) openPopover = null;
    this.onClose?.();
  }

  place() {
    const r = this.anchor.getBoundingClientRect();
    const w = this.root.offsetWidth;
    let left = this.align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${r.bottom + 6}px`;
  }
}

// ---- toasts ----
let toastBox = null;

/** Brief notification at the bottom of the window. kind: 'info' | 'ok' | 'error'. */
export function toast(message, { kind = 'info', ms = 3200 } = {}) {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = esc(message);
  toastBox.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }, ms);
}
