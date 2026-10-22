// Floating controls on top of the 3D view: the Select / Move / Rotate tools
// and camera reset (top-left), atmosphere — haze, room light, house light —
// (top-right), the cold-spark button + mouse hint (bottom-left), and the laser
// galvo preview (bottom-right, Program only). Atmosphere lives here rather than
// in a panel because it changes how you *see* the venue, not the show itself.

import { icon } from './icons.js';
import { prefs } from './dom.js';

const TOOLS = [
  { id: 'select', icon: 'pointer', label: 'Select', key: 'V' },
  { id: 'move', icon: 'move', label: 'Move', key: 'X' },
  { id: 'rotate', icon: 'rotate', label: 'Rotate (45° steps)', key: 'C' },
];

export class ViewportOverlay {
  /**
   * @param {HTMLElement} root
   * @param {object} deps
   *   atmosphere: Atmosphere (haze / brightness / house light + onChange),
   *   onTool(mode), onCameraReset(), onSpark(on), onAtmosphereCommit(),
   *   hasSparks(): bool, fixtureCount(): number
   */
  constructor(root, deps) {
    this.root = root;
    this.deps = deps;
    this.atmo = deps.atmosphere;
    this.tool = 'select';
    this._hintGone = prefs.get('hint.camera', false);

    const tools = TOOLS.map((t) => `<button type="button" data-tool="${t.id}" title="${t.label} (${t.key})" aria-label="${t.label}">${icon(t.icon)}</button>`).join('');
    root.innerHTML = `
      <div class="vo-tl float">
        <div class="seg icons" role="group" aria-label="Tools">${tools}</div>
        <span class="vo-sep"></span>
        <button type="button" class="btn ghost icon sm" data-act="cam" title="Reset the camera" aria-label="Reset the camera">${icon('home', 'sm')}</button>
      </div>
      <div class="vo-tr float">
        <label class="atmo" title="Haze — beams only show where light scatters in haze">${icon('haze')}<input type="range" min="0" max="1" step="0.01" data-atmo="haze" aria-label="Haze" /></label>
        <span class="vo-sep"></span>
        <label class="atmo" title="Room light — how much of the venue you can see">${icon('sun')}<input type="range" min="0" max="2.5" step="0.01" data-atmo="brightness" aria-label="Room light" /></label>
        <span class="vo-sep"></span>
        <button type="button" class="btn ghost icon sm" data-atmo="house" title="House light — floods the venue so you can see the rig" aria-label="House light">${icon('bulb', 'sm')}</button>
      </div>
      <div class="vo-bl">
        <button type="button" class="btn spark-btn" data-act="spark" title="Hold to fire every cold spark machine" hidden>${icon('sparkles')}Hold for sparks</button>
        <div class="vo-hint${this._hintGone ? ' gone' : ''}" data-role="hint">Left-drag to orbit · right-drag to pan · scroll to zoom</div>
      </div>
      <div class="vo-br float" data-ws-only="program">
        <canvas width="304" height="228" data-role="laser" aria-label="Laser output preview"></canvas>
        <div class="cap"><span>Laser output</span><span data-role="laser-state">idle</span></div>
      </div>
      <div class="vo-empty" data-role="empty" hidden><b>Your venue is empty</b>Drag a fixture from the library on the left into the room.</div>`;

    this.$ = (s) => root.querySelector(s);
    this.laserCanvas = this.$('[data-role="laser"]');

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tool]');
      if (t) { this.deps.onTool(t.dataset.tool); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cam') this.deps.onCameraReset();
      if (e.target.closest('[data-atmo="house"]')) { this.atmo.setHouse(!this.atmo.house); this.deps.onAtmosphereCommit(); }
    });
    root.addEventListener('input', (e) => {
      const k = e.target.dataset.atmo;
      if (k === 'haze') this.atmo.setHaze(parseFloat(e.target.value));
      else if (k === 'brightness') this.atmo.setBrightness(parseFloat(e.target.value));
    });
    root.addEventListener('change', (e) => { if (e.target.dataset.atmo) this.deps.onAtmosphereCommit(); });

    const spark = this.$('[data-act="spark"]');
    const fire = (on) => { spark.classList.toggle('on', on); this.deps.onSpark(on); };
    spark.addEventListener('pointerdown', (e) => { spark.setPointerCapture(e.pointerId); fire(true); });
    spark.addEventListener('pointerup', () => fire(false));
    spark.addEventListener('pointercancel', () => fire(false));
    spark.addEventListener('lostpointercapture', () => fire(false));

    this.atmo.onChange(() => this.syncAtmosphere());
    this.syncAtmosphere();
    this.setTool('select');
  }

  setTool(mode) {
    this.tool = mode;
    for (const b of this.root.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === mode));
  }

  syncAtmosphere() {
    const set = (k, v) => { const el = this.$(`[data-atmo="${k}"]`); if (document.activeElement !== el) el.value = v; };
    set('haze', this.atmo.haze);
    set('brightness', this.atmo.brightness);
    this.$('[data-atmo="house"]').setAttribute('aria-pressed', String(this.atmo.house));
  }

  /** The camera hint fades for good once the user has moved the camera. */
  cameraMoved() {
    if (this._hintGone) return;
    this._hintGone = true;
    prefs.set('hint.camera', true);
    this.$('[data-role="hint"]').classList.add('gone');
  }

  setLaserState(text) {
    const el = this.$('[data-role="laser-state"]');
    if (el.textContent !== text) el.textContent = text;
  }

  /** Cheap per-frame checks: spark button only when sparks exist; empty-venue note. */
  frame() {
    const spark = this.$('[data-act="spark"]');
    const has = this.deps.hasSparks();
    if (spark.hidden === has) spark.hidden = !has;
    const empty = this.$('[data-role="empty"]');
    const none = this.deps.fixtureCount() === 0;
    if (empty.hidden === none) empty.hidden = !none;
  }
}
