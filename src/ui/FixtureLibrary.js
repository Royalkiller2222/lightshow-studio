// Build workspace library: every fixture type as a card. Drag a card into the
// venue to place it (as a mirrored pair across the centre line when "Place
// mirrored pairs" is on), or click + to drop one in at a default spot.

import { fixtureIcon, icon } from './icons.js';
import { esc, prefs } from './dom.js';

export class FixtureLibrary {
  /**
   * deps: types (registry FIXTURE_TYPES), shell,
   *       onAdd(key), onDragStart(key), onDragEnd()
   */
  constructor(root, { types, shell, onAdd, onDragStart, onDragEnd }) {
    this.root = root;
    this.mirror = prefs.get('place.mirror', true);

    const cards = types.map((t) => {
      const ch = t.profile ? t.profile.channelCount : 0;
      const sub = ch === 0 ? 'Prop · no DMX' : `${ch} ch · ${t.onTruss ? 'on the truss' : 'on the floor'}`;
      return `
        <li class="fx-card" draggable="true" data-type="${t.key}" title="Drag into the venue, or click + to add">
          <span class="tile">${fixtureIcon(t.key)}</span>
          <span class="txt"><span class="nm">${esc(t.label)}</span><br><span class="sb">${esc(sub)}</span></span>
          <button type="button" class="btn ghost icon sm" data-add="${t.key}" title="Add a ${esc(t.label)}" aria-label="Add a ${esc(t.label)}">${icon('plus', 'sm')}</button>
        </li>`;
    }).join('');

    root.innerHTML = `
      <div class="ph">
        <span class="ph-title">Fixtures</span>
        <button type="button" class="btn ghost icon sm" data-act="hide" title="Hide the library" aria-label="Hide the library">${icon('panel-left', 'sm')}</button>
      </div>
      <div class="pbody">
        <label class="switch-row" title="Drag-placed fixtures land as a pair, mirrored across the centre line">
          <span style="display:flex;align-items:center;gap:8px">${icon('mirror', 'sm')}Place mirrored pairs</span>
          <input type="checkbox" class="switch" data-role="mirror" ${this.mirror ? 'checked' : ''} />
        </label>
        <ul class="fx-list">${cards}</ul>
        <div class="tip" style="margin-top:12px">${icon('help', 'sm')}<div>Drag a fixture into the room. Placement snaps to the floor grid; ceiling fixtures hang from the truss.</div></div>
      </div>`;

    root.querySelector('[data-act="hide"]').addEventListener('click', () => shell.togglePanel('left', false));
    root.querySelector('[data-role="mirror"]').addEventListener('change', (e) => {
      this.mirror = e.target.checked;
      prefs.set('place.mirror', this.mirror);
    });
    root.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) onAdd(add.dataset.add);
    });
    root.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.fx-card');
      if (card && !e.target.closest('[data-add]')) onAdd(card.dataset.type);
    });
    root.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.fx-card');
      if (!card) return;
      e.dataTransfer.setData('text/plain', card.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
      onDragStart(card.dataset.type);
    });
    root.addEventListener('dragend', () => onDragEnd());
  }
}
