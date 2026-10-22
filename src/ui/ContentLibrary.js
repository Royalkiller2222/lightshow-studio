// Program workspace library: laser patterns (drawn as real thumbnails from the
// pattern data) and fixture effects. Drag one onto the timeline, or
// double-click / press Enter to add it at the playhead. The search box filters
// both lists.

import { PATTERNS } from '../laser/patterns.js';
import { EFFECTS } from '../show/effects.js';
import { icon } from './icons.js';
import { esc } from './dom.js';
import { DND_TYPE } from '../timeline/TimelinePanel.js';
import { effectShortName } from '../timeline/CueInspector.js';

const GROUPS = [
  { attr: 'intensity', label: 'Intensity', color: 'var(--c-int)' },
  { attr: 'color', label: 'Colour', color: 'var(--c-col)' },
  { attr: 'position', label: 'Movement', color: 'var(--c-pos)' },
];

export class ContentLibrary {
  /** deps: shell, onAddPattern(key), onAddEffect(key) */
  constructor(root, { shell, onAddPattern, onAddEffect }) {
    this.root = root;
    const pats = PATTERNS.map((p) => `
      <div class="pat" draggable="true" tabindex="0" data-kind="pattern" data-key="${p.key}" data-search="${esc(p.label.toLowerCase())} laser pattern" title="${esc(p.label)} — drag onto the timeline or double-click">
        <canvas width="184" height="115" data-thumb="${p.key}"></canvas>
        <div class="nm">${esc(p.label)}</div>
      </div>`).join('');

    const effectRow = (e, color) => `
      <div class="eff" draggable="true" tabindex="0" data-kind="effect" data-key="${e.key}" data-search="${esc(e.label.toLowerCase())}" title="Drag onto the timeline or double-click">
        <span class="dot" style="background:${color}"></span>${esc(effectShortName(e))}
      </div>`;
    const groups = GROUPS.map((g) => `
      <div class="eff-group" data-group>
        <div class="gt">${g.label}</div>
        ${EFFECTS.filter((e) => e.attr === g.attr && e.key !== 'sparks').map((e) => effectRow(e, g.color)).join('')}
      </div>`).join('') + `
      <div class="eff-group" data-group>
        <div class="gt">Special</div>
        ${effectRow(EFFECTS.find((e) => e.key === 'sparks'), 'var(--c-fx)')}
      </div>`;

    root.innerHTML = `
      <div class="ph">
        <span class="ph-title">Library</span>
        <button type="button" class="btn ghost icon sm" data-act="hide" title="Hide the library" aria-label="Hide the library">${icon('panel-left', 'sm')}</button>
      </div>
      <div class="pbody">
        <input type="search" class="lib-search" placeholder="Search patterns and effects" aria-label="Search the library" />
        <div class="sec">
          <div class="sec-title">${icon('laser', 'sm')}Laser patterns</div>
          <div class="pat-grid">${pats}</div>
        </div>
        <div class="sec">
          <div class="sec-title">${icon('moving-head', 'sm')}Fixture effects</div>
          ${groups}
        </div>
        <div class="lib-empty" data-role="none" hidden>Nothing matches that search.</div>
        <div class="tip">${icon('help', 'sm')}<div>Drag onto the timeline, or double-click to add at the playhead.</div></div>
      </div>`;

    for (const c of root.querySelectorAll('canvas[data-thumb]')) drawPattern(c, PATTERNS.find((p) => p.key === c.dataset.thumb));

    root.querySelector('[data-act="hide"]').addEventListener('click', () => shell.togglePanel('left', false));
    const add = (item) => {
      if (item.dataset.kind === 'pattern') onAddPattern(item.dataset.key);
      else onAddEffect(item.dataset.key);
    };
    root.addEventListener('dblclick', (e) => { const it = e.target.closest('[data-kind]'); if (it) add(it); });
    root.addEventListener('keydown', (e) => {
      const it = e.target.closest('[data-kind]');
      if (it && e.key === 'Enter') { e.preventDefault(); add(it); }
    });
    root.addEventListener('dragstart', (e) => {
      const it = e.target.closest('[data-kind]');
      if (!it) return;
      e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: it.dataset.kind, key: it.dataset.key }));
      e.dataTransfer.effectAllowed = 'copy';
    });
    root.querySelector('.lib-search').addEventListener('input', (e) => this._filter(e.target.value));
  }

  _filter(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    for (const it of this.root.querySelectorAll('[data-search]')) {
      const hit = words.every((w) => it.dataset.search.includes(w));
      it.hidden = !hit;
      any = any || hit;
    }
    for (const g of this.root.querySelectorAll('[data-group]')) {
      g.hidden = ![...g.querySelectorAll('[data-search]')].some((x) => !x.hidden);
    }
    this.root.querySelector('[data-role="none"]').hidden = any;
  }
}

/** Draw a pattern's strokes (galvo space -1..1) into a thumbnail canvas. */
function drawPattern(c, pat) {
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) * 0.42;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // soft glow pass, then a crisp core — reads as a laser, not a line drawing
  for (const [width, alpha] of [[6, 0.18], [2.2, 1]]) {
    ctx.strokeStyle = `rgba(95, 224, 172, ${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const stroke of pat.strokes) {
      stroke.forEach(([x, y], i) => {
        const X = x * s, Y = -y * s;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
    }
    ctx.stroke();
  }
  ctx.restore();
}
