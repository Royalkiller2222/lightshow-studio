// Ctrl+K command search: every action in the app by name, with its shortcut.
// Beginners find features by describing them ("add laser", "house light");
// pros get keyboard access to everything without memorising menus.

import { icon } from './icons.js';
import { esc } from './dom.js';

export class CommandPalette {
  /** getCommands(): [{ id, group, title, keys?, run(), when?() }] */
  constructor(getCommands) {
    this.getCommands = getCommands;
    this.items = [];
    this.active = 0;

    this.back = document.createElement('div');
    this.back.className = 'cmdk-back';
    this.box = document.createElement('div');
    this.box.className = 'cmdk';
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', 'Search commands');
    this.box.innerHTML = `
      <div class="cmdk-in">${icon('search')}<input type="text" placeholder="Search commands — try “laser”, “save”, “house light”" aria-label="Search commands" spellcheck="false" /></div>
      <div class="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div>`;
    this.back.hidden = this.box.hidden = true;
    document.body.append(this.back, this.box);
    this.input = this.box.querySelector('input');
    this.list = this.box.querySelector('.cmdk-list');

    this.back.addEventListener('pointerdown', () => this.close());
    this.input.addEventListener('input', () => { this.active = 0; this._render(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this._run(this.items[this.active]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
    this.list.addEventListener('pointermove', (e) => {
      const it = e.target.closest('[data-i]');
      if (it && Number(it.dataset.i) !== this.active) { this.active = Number(it.dataset.i); this._highlight(); }
    });
    this.list.addEventListener('click', (e) => {
      const it = e.target.closest('[data-i]');
      if (it) this._run(this.items[Number(it.dataset.i)]);
    });
  }

  get isOpen() { return !this.box.hidden; }

  open() {
    this._prevFocus = document.activeElement;
    this.back.hidden = this.box.hidden = false;
    this.input.value = '';
    this.active = 0;
    this._render();
    this.input.focus();
  }

  close() {
    if (this.box.hidden) return;
    this.back.hidden = this.box.hidden = true;
    if (this._prevFocus && this._prevFocus.isConnected) this._prevFocus.focus?.({ preventScroll: true });
  }

  _render() {
    const words = this.input.value.toLowerCase().split(/\s+/).filter(Boolean);
    this.items = this.getCommands()
      .filter((c) => !c.when || c.when())
      .filter((c) => { const hay = `${c.group} ${c.title}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    if (!this.items.length) {
      this.list.innerHTML = '<div class="cmdk-empty">No command matches that.</div>';
      return;
    }
    this.active = Math.min(this.active, this.items.length - 1);
    this.list.innerHTML = this.items.map((c, i) => `
      <div class="cmdk-item${i === this.active ? ' active' : ''}" role="option" data-i="${i}">
        <span class="grp">${esc(c.group)}</span><span class="ttl">${esc(c.title)}</span>
        ${c.keys ? c.keys.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('') : ''}
      </div>`).join('');
  }

  _highlight() {
    for (const el of this.list.querySelectorAll('[data-i]')) el.classList.toggle('active', Number(el.dataset.i) === this.active);
    this.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  _move(d) {
    if (!this.items.length) return;
    this.active = (this.active + d + this.items.length) % this.items.length;
    this._highlight();
  }

  _run(cmd) {
    if (!cmd) return;
    this.close();
    cmd.run();
  }
}
