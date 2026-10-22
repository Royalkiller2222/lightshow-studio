// Edits the selected timeline cue; lives in the right-hand inspector panel.
//
// Fixture cues: effect, target and the effect's own controls (the effect lists
// which ones it uses). Speed shows a beat division when beat-synced and a rate
// in Hz when not. Rarely-touched waveform details sit under "More" (Pro).
//
// Laser cues get the BEYOND-style Key Effects: one row per parameter with a ◆
// button that keys it at the playhead, and a curve (envelope) editor for the
// parameter you click. Keying works like After Effects — once a parameter has
// keys, editing it writes a key at the playhead (Auto-key does that for every
// parameter). See Docs/DESIGN_DECISIONS.md "Keyframe envelopes".

import { EFFECTS, paramsFor } from '../show/effects.js';
import { SHAPES, DIVISIONS, FANS } from '../show/waveforms.js';
import { GROUPS } from '../show/ShowEngine.js';
import { PATTERNS } from '../laser/patterns.js';
import {
  LASER_PARAMS, PARAM_BY_KEY, EASES, KEY_EPS,
  isAnimated, valueAt, setKey, removeKey, clearKeys, sortKeys,
} from '../laser/envelopes.js';
import { icon } from '../ui/icons.js';
import { esc, more, hexToRgb, rgbToHex, clamp } from '../ui/dom.js';

const KEY_HIT_PX = 7; // pointer radius for grabbing a keyframe diamond

const ATTR_LABEL = { intensity: 'Intensity', color: 'Colour', position: 'Movement' };
const BASIC = ['effectKey', 'groupId', 'color', 'color2', 'size', 'sync', 'division', 'rate', 'band', 'pan', 'tilt', 'duration'];
const ADVANCED = ['shape', 'base', 'spread', 'fan', 'dir', 'duty'];

/** "Colour · Rainbow" -> "Rainbow" (the effect list groups by attribute already). */
export function effectShortName(eff) {
  if (!eff) return 'Effect';
  const i = eff.label.indexOf(' · ');
  return i >= 0 ? eff.label.slice(i + 3) : eff.label;
}

export class CueInspector {
  /**
   * @param {object} deps
   *   transport, engine,
   *   onChange(): a cue changed in a way the timeline shows (label, length, keys),
   *   onCommit(): an edit finished (undo checkpoint),
   *   onDelete(cue)
   */
  constructor({ transport, engine, onChange, onCommit, onDelete }) {
    this.transport = transport;
    this.engine = engine;
    this.onChange = onChange;
    this.onCommit = onCommit;
    this.onDelete = onDelete;
    this.cue = null;

    this.autoKey = false;    // BEYOND "Enable auto-keying"
    this.envParam = 'size';  // parameter shown in the curve editor
    this.envSel = null;      // selected keyframe object
    this._sliderHeld = null; // param whose slider is being dragged (skip live updates)

    this.el = document.createElement('div');
    this.el.className = 'cue-insp';
    this.el.innerHTML = this._fixtureHtml() + this._laserHtml();
    this.$ = (s) => this.el.querySelector(s);
    this.fixtureView = this.$('[data-view="fixture"]');
    this.laserView = this.$('[data-view="laser"]');
    this.envCanvas = this.$('[data-role="env"]');
    this.envCtx = this.envCanvas.getContext('2d');
    this._wire();
  }

  // ------------------------------------------------------------------ markup
  _fixtureHtml() {
    const opt = (list, k = 'key', l = 'label') => list.map((x) => `<option value="${x[k]}">${esc(x[l])}</option>`).join('');
    const effOpts = ['intensity', 'color', 'position'].map((attr) => {
      const o = EFFECTS.filter((e) => e.attr === attr && e.key !== 'sparks')
        .map((e) => `<option value="${e.key}">${esc(effectShortName(e))}</option>`).join('');
      return `<optgroup label="${ATTR_LABEL[attr]}">${o}</optgroup>`;
    }).join('') + '<optgroup label="Special"><option value="sparks">Cold sparks</option></optgroup>';
    const grpOpts = GROUPS.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
    const range = (k, min, max, step) => `<input type="range" min="${min}" max="${max}" step="${step}" data-ins="${k}" /><span class="val" data-insval="${k}"></span>`;
    const row = (k, label, ctl) => `<label class="prop" data-ctl="${k}"><span class="name">${label}</span><span class="ctl">${ctl}</span></label>`;

    const basic = [
      row('effectKey', 'Effect', `<select data-ins="effectKey">${effOpts}</select>`),
      row('groupId', 'Fixtures', `<select data-ins="groupId">${grpOpts}</select>`),
      row('color', 'Colour', '<input type="color" data-ins="color" />'),
      row('color2', 'Colour 2', '<input type="color" data-ins="color2" />'),
      row('size', 'Amount', range('size', 0, 1, 0.01)),
      row('sync', 'Beat-sync', '<input type="checkbox" class="switch" data-ins="sync" />'),
      row('division', 'Speed', `<select data-ins="division">${opt(DIVISIONS)}</select>`),
      row('rate', 'Speed', range('rate', 0.05, 8, 0.05)),
      row('band', 'Follows', '<select data-ins="band"><option value="bass">Bass</option><option value="mid">Mids</option><option value="high">Highs</option></select>'),
      row('pan', 'Pan', range('pan', 0, 1, 0.01)),
      row('tilt', 'Tilt', range('tilt', 0, 1, 0.01)),
      row('duration', 'Length', '<input type="number" min="0.25" step="0.25" data-ins="duration" style="width:80px" /><span class="muted small">seconds</span>'),
    ].join('');
    const adv = [
      row('shape', 'Wave shape', `<select data-ins="shape">${opt(SHAPES)}</select>`),
      row('base', 'Floor', range('base', 0, 1, 0.01)),
      row('spread', 'Spread', range('spread', 0, 2, 0.01)),
      row('fan', 'Spread mode', `<select data-ins="fan">${opt(FANS)}</select>`),
      row('dir', 'Direction', '<select data-ins="dir"><option value="1">Forward</option><option value="-1">Reverse</option></select>'),
      row('duty', 'Duty', range('duty', 0.05, 0.95, 0.01)),
    ].join('');

    return `
      <div data-view="fixture" hidden>
        <div class="ihead">
          <div class="badge fixture">${icon('moving-head')}</div>
          <div class="txt"><div class="kicker">Fixture cue</div><div class="ititle" data-role="f-title"></div></div>
        </div>
        <div class="sec">${basic}</div>
        <div data-role="f-more">${more('fixture-cue', adv)}</div>
        <div class="ifoot"><button type="button" class="btn danger" data-act="del-cue">${icon('trash', 'sm')}Delete cue</button></div>
      </div>`;
  }

  _laserHtml() {
    const pats = PATTERNS.map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
    const eases = EASES.map((e) => `<option value="${e.key}">${esc(e.label)}</option>`).join('');
    const rowFor = (p) => {
      const input = p.kind === 'color'
        ? `<input type="color" data-lpv="${p.key}" aria-label="${esc(p.label)}" />`
        : `<input type="range" min="${p.min}" max="${p.max}" step="${p.step}" data-lpv="${p.key}" aria-label="${esc(p.label)}" /><span class="val" data-lpval="${p.key}"></span>`;
      return `<div class="lp-row" data-lp="${p.key}">
          <button type="button" class="keybtn" data-key="${p.key}" title="Set a ${esc(p.label)} keyframe at the playhead">${icon('diamond')}</button>
          <span class="name" data-pick="${p.key}" title="Edit the ${esc(p.label)} curve">${esc(p.label)}</span>
          ${input}
        </div>`;
    };
    const basic = LASER_PARAMS.filter((p) => !p.adv).map(rowFor).join('');
    const adv = LASER_PARAMS.filter((p) => p.adv).map(rowFor).join('');
    return `
      <div data-view="laser" hidden>
        <div class="ihead">
          <div class="badge laser">${icon('laser')}</div>
          <div class="txt"><div class="kicker">Laser cue</div><div class="ititle" data-role="l-title"></div></div>
        </div>
        <div class="sec">
          <label class="prop"><span class="name">Pattern</span><span class="ctl"><select data-lmeta="pattern">${pats}</select></span></label>
          <label class="prop"><span class="name">Length</span><span class="ctl"><input type="number" min="0.25" step="0.25" data-lmeta="duration" style="width:80px" /><span class="muted small">seconds</span></span></label>
        </div>
        <div class="sec">
          <div class="sec-title">Key effects<span class="grow"></span>
            <label class="pro small muted" style="display:flex;align-items:center;gap:6px;font-weight:400" title="When on, changing any parameter writes a keyframe at the playhead (animated parameters always do)">Auto-key <input type="checkbox" class="switch" data-role="autokey" /></label>
          </div>
          ${basic}
          ${more('laser-params', adv, 'More effects')}
        </div>
        <div class="sec">
          <div class="env-bar">
            <span class="t" data-role="env-title"></span>
            <select class="pro" data-role="env-ease" title="How the value moves between keyframes">${eases}</select>
            <button type="button" class="btn sm ghost" data-act="env-clear" title="Remove this parameter's keyframes (keeps its current value)">Clear</button>
          </div>
          <div class="env-wrap"><canvas class="env-canvas" data-role="env" tabindex="0" aria-label="Keyframe curve"></canvas></div>
          <div class="env-hint">Click the curve to add a keyframe, drag to move it (snaps to half-beats; hold Shift for free), double-click or press Del to remove.</div>
        </div>
        <div class="ifoot"><button type="button" class="btn danger" data-act="del-cue">${icon('trash', 'sm')}Delete cue</button></div>
      </div>`;
  }

  // ------------------------------------------------------------------ wiring
  _wire() {
    const el = this.el;
    el.addEventListener('click', (e) => {
      const keyBtn = e.target.closest('[data-key]');
      if (keyBtn) { this._keyParam(keyBtn.dataset.key); return; }
      const pick = e.target.closest('[data-pick]');
      if (pick) { this._pickParam(pick.dataset.pick); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'del-cue' && this.cue) this.onDelete(this.cue);
      else if (act === 'env-clear') this._clearEnvelope();
    });

    el.addEventListener('input', (e) => {
      if (!this.cue) return;
      if (this.cue.kind === 'laser') this._onLaserInput(e);
      else this._onFixtureInput(e);
    });

    // 'change' (slider released / select committed) is the undo checkpoint.
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.role === 'autokey') { this.autoKey = t.checked; return; }
      if (t.dataset.role === 'env-ease' && this.cue && isAnimated(this.cue, this.envParam)) {
        this.cue.anim[this.envParam].ease = t.value;
      }
      this.onCommit();
    });

    // Don't fight the user: skip live updates on the slider being dragged.
    el.addEventListener('pointerdown', (e) => { if (e.target.dataset.lpv) this._sliderHeld = e.target.dataset.lpv; });
    window.addEventListener('pointerup', () => { this._sliderHeld = null; });

    this.envCanvas.addEventListener('pointerdown', (e) => this._envPointerDown(e));
    this.envCanvas.addEventListener('dblclick', (e) => this._envDblClick(e));
    this.envCanvas.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopPropagation(); // Del here means "keyframe", never the selected cue or fixture
      if (this.envSel) this._deleteEnvKey(this.envSel);
    });
  }

  // ---------------------------------------------------------------- showing
  /** Show `cue` (or nothing). Remembers the curve parameter across cues. */
  show(cue) {
    this.cue = cue;
    this.envSel = null;
    const laser = !!cue && cue.kind === 'laser';
    this.fixtureView.hidden = !cue || laser;
    this.laserView.hidden = !laser;
    if (!cue) return;
    if (laser) {
      if (!isAnimated(cue, this.envParam)) {
        const anim = LASER_PARAMS.find((p) => isAnimated(cue, p.key));
        if (anim) this.envParam = anim.key;
      }
      this._laserRefresh(cue);
    } else {
      this._fixtureRefresh(cue);
    }
  }

  /** After the timeline moved/resized the cue: refresh the length fields. */
  refreshMeta() {
    if (!this.cue) return;
    const d = this.$(this.cue.kind === 'laser' ? '[data-lmeta="duration"]' : '[data-ins="duration"]');
    if (d && document.activeElement !== d) d.value = +this.cue.duration.toFixed(3);
  }

  // ------------------------------------------------------------ fixture cue
  _fixtureRefresh(cue) {
    const p = cue.params;
    const set = (k, v) => { const el = this.$(`[data-ins="${k}"]`); if (el) el.value = v; };
    set('effectKey', cue.effectKey);
    set('groupId', cue.groupId);
    set('duration', +cue.duration.toFixed(3));
    this.$('[data-ins="color"]').value = rgbToHex(p.color);
    this.$('[data-ins="color2"]').value = rgbToHex(p.color2);
    this.$('[data-ins="sync"]').checked = !!p.sync;
    for (const k of ['shape', 'division', 'rate', 'size', 'base', 'spread', 'fan', 'dir', 'duty', 'band', 'pan', 'tilt']) set(k, p[k]);
    this._fixtureVals();
    this._fixtureVisibility();
    this._fixtureTitle();
  }

  _fixtureTitle() {
    const cue = this.cue;
    const eff = EFFECTS.find((x) => x.key === cue.effectKey);
    const grp = GROUPS.find((g) => g.id === cue.groupId);
    this.$('[data-role="f-title"]').textContent = `${effectShortName(eff)} · ${grp ? grp.label : cue.groupId}`;
  }

  _fixtureVals() {
    const p = this.cue.params;
    const out = (k, text) => { const el = this.$(`[data-insval="${k}"]`); if (el) el.textContent = text; };
    out('size', `${Math.round(p.size * 100)}%`);
    out('rate', `${(+p.rate).toFixed(2)} Hz`);
    out('base', `${Math.round(p.base * 100)}%`);
    out('spread', (+p.spread).toFixed(2));
    out('duty', `${Math.round(p.duty * 100)}%`);
    out('pan', `${Math.round(p.pan * 100)}%`);
    out('tilt', `${Math.round(p.tilt * 100)}%`);
  }

  /** Show only the controls this effect uses (Speed: division when synced, Hz when not). */
  _fixtureVisibility() {
    const eff = EFFECTS.find((x) => x.key === this.cue.effectKey);
    const uses = new Set(['effectKey', 'groupId', 'duration', ...(eff ? eff.controls : [])]);
    const synced = !!this.cue.params.sync;
    if (uses.has('sync')) { if (synced) uses.delete('rate'); else uses.delete('division'); }
    let anyAdv = false;
    for (const row of this.fixtureView.querySelectorAll('[data-ctl]')) {
      const on = uses.has(row.dataset.ctl);
      row.hidden = !on;
      if (on && ADVANCED.includes(row.dataset.ctl)) anyAdv = true;
    }
    this.$('[data-role="f-more"]').hidden = !anyAdv;
  }

  _onFixtureInput(e) {
    const key = e.target.dataset.ins;
    const cue = this.cue;
    if (!key) return;
    const el = e.target;
    if (key === 'effectKey') {
      cue.effectKey = el.value;
      cue.params = paramsFor(el.value);
      this._fixtureRefresh(cue);
      this.onChange();
      return;
    }
    if (key === 'groupId') { cue.groupId = el.value; this._fixtureTitle(); this.onChange(); return; }
    if (key === 'duration') { cue.duration = Math.max(0.25, parseFloat(el.value) || 0.25); this.onChange(); return; }
    if (key === 'color' || key === 'color2') cue.params[key] = hexToRgb(el.value);
    else if (key === 'sync') { cue.params.sync = el.checked; this._fixtureVisibility(); }
    else if (key === 'shape' || key === 'fan' || key === 'band') cue.params[key] = el.value;
    else cue.params[key] = parseFloat(el.value);
    this._fixtureVals();
  }

  // -------------------------------------------------------------- laser cue
  /** Cue-local time (0..1) of the playhead, clamped to the cue. */
  _cueU(cue) {
    return clamp((this.transport.time - cue.start) / (cue.duration || 1), 0, 1);
  }

  /**
   * Where an inspector edit / ◆ press puts its key: exactly at the playhead
   * while paused (so the control shows what you set), quantised to the
   * half-beat grid while playing — tap ◆ on the beat, and a slider drag during
   * playback records at most one key per half-beat instead of one per frame.
   */
  _keyU(cue) {
    const u = this._cueU(cue);
    return this.transport.playing ? this._snapU(cue, u, false) : u;
  }

  /** Snap a key time to the half-beat grid (or the cue ends); Shift = free. */
  _snapU(cue, u, free) {
    u = clamp(u, 0, 1);
    if (free) return u;
    const step = 30 / (this.transport.bpm || 120); // half a beat, in seconds
    const off = this.transport.beatOffset || 0;
    const abs = cue.start + u * cue.duration;
    const gridU = (off + Math.round((abs - off) / step) * step - cue.start) / cue.duration;
    let best = u, bestD = Infinity;
    for (const cand of [gridU, 0, 1]) {
      if (cand < 0 || cand > 1) continue;
      const d = Math.abs(cand - u);
      if (d < bestD) { bestD = d; best = cand; }
    }
    return best;
  }

  _laserRefresh(cue) {
    this.$('[data-lmeta="pattern"]').value = cue.pattern;
    this.$('[data-lmeta="duration"]').value = +cue.duration.toFixed(3);
    this.$('[data-role="autokey"]').checked = this.autoKey;
    const pat = PATTERNS.find((p) => p.key === cue.pattern);
    this.$('[data-role="l-title"]').textContent = pat ? pat.label : cue.pattern;
    const u = this._cueU(cue);
    for (const spec of LASER_PARAMS) this._showParam(spec, valueAt(cue, spec.key, u), true);
    this._markRows(cue);
  }

  /** Write a param's value into its control (+ readout). */
  _showParam(spec, v, force = false) {
    const el = this.$(`[data-lpv="${spec.key}"]`);
    if (!el || v === undefined) return;
    if (spec.kind === 'color') {
      if (!force && document.activeElement === el) return; // picker open
      const hex = rgbToHex(v);
      if (el.value !== hex) el.value = hex;
      return;
    }
    if (!force && this._sliderHeld === spec.key) return;
    if (Math.abs(parseFloat(el.value) - v) > 1e-6) el.value = v;
    const out = this.$(`[data-lpval="${spec.key}"]`);
    if (out) out.textContent = spec.fmt(v);
  }

  /** Highlight animated params (filled ◆) and the one in the curve editor. */
  _markRows(cue) {
    for (const row of this.el.querySelectorAll('.lp-row')) {
      const key = row.dataset.lp;
      row.classList.toggle('anim', isAnimated(cue, key));
      row.classList.toggle('cur', key === this.envParam);
    }
    const spec = PARAM_BY_KEY[this.envParam];
    const animated = isAnimated(cue, this.envParam);
    this.$('[data-role="env-title"]').textContent = `${spec.label} curve${animated ? '' : ' — not animated'}`;
    const ease = this.$('[data-role="env-ease"]');
    ease.disabled = !animated;
    ease.value = animated ? cue.anim[this.envParam].ease : 'linear';
    this.$('[data-act="env-clear"]').hidden = !animated;
  }

  _onLaserInput(e) {
    const cue = this.cue;
    const el = e.target;
    if (el.dataset.lmeta === 'pattern') {
      cue.pattern = el.value;
      const pat = PATTERNS.find((p) => p.key === cue.pattern);
      this.$('[data-role="l-title"]').textContent = pat ? pat.label : cue.pattern;
      this.onChange();
      return;
    }
    if (el.dataset.lmeta === 'duration') { cue.duration = Math.max(0.25, parseFloat(el.value) || 0.25); this.onChange(); return; }
    const key = el.dataset.lpv;
    if (!key) return;
    const spec = PARAM_BY_KEY[key];
    const v = spec.kind === 'color' ? hexToRgb(el.value) : parseFloat(el.value);
    if (isAnimated(cue, key) || this.autoKey) {
      // After Effects-style: once animated, an edit sets a key at the playhead.
      this.envSel = setKey(cue, key, this._keyU(cue), v);
      this.envParam = key;
      this._markRows(cue);
      this.onChange();
    } else {
      cue.params[key] = v;
    }
    if (spec.kind !== 'color') {
      const out = this.$(`[data-lpval="${key}"]`);
      if (out) out.textContent = spec.fmt(v);
    }
  }

  /** ◆ button: key the parameter at the playhead with its current value. */
  _keyParam(key) {
    const cue = this.cue;
    if (!cue || cue.kind !== 'laser') return;
    const u = this._keyU(cue);
    this.envSel = setKey(cue, key, u, valueAt(cue, key, u));
    this.envParam = key;
    this._markRows(cue);
    this.onChange();
    this.onCommit();
  }

  _pickParam(key) {
    if (!this.cue || this.cue.kind !== 'laser') return;
    this.envParam = key;
    this.envSel = null;
    this._markRows(this.cue);
  }

  _clearEnvelope() {
    const cue = this.cue;
    if (!cue || !isAnimated(cue, this.envParam)) return;
    clearKeys(cue, this.envParam, this._cueU(cue));
    this.envSel = null;
    this._laserRefresh(cue);
    this.onChange();
    this.onCommit();
  }

  _deleteEnvKey(k) {
    const cue = this.cue;
    if (!cue) return;
    removeKey(cue, this.envParam, k);
    this.envSel = null;
    this._laserRefresh(cue);
    this.onChange();
    this.onCommit();
  }

  /** While paused, put the playhead on a key so the inspector shows/edits it. */
  _seekToKey(cue, k) {
    if (!this.transport.playing) this.transport.seek(cue.start + k.t * cue.duration);
  }

  // ---- curve editor geometry ----
  _envGeom() {
    const w = this.envCanvas.clientWidth, h = this.envCanvas.clientHeight;
    return { w, h, l: 10, r: w - 10, t: 10, b: h - 10 };
  }
  _uToX(u, g) { return g.l + u * (g.r - g.l); }
  _xToU(x, g) { return (x - g.l) / ((g.r - g.l) || 1); }
  _vToY(spec, v, g) { return g.b - ((v - spec.min) / (spec.max - spec.min)) * (g.b - g.t); }
  _yToV(spec, y, g) {
    const v = spec.min + ((g.b - y) / ((g.b - g.t) || 1)) * (spec.max - spec.min);
    return clamp(v, spec.min, spec.max);
  }
  _keyY(spec, k, g) {
    return spec.kind === 'color' ? (g.t + g.b) / 2 : this._vToY(spec, clamp(k.v, spec.min, spec.max), g);
  }
  _envLocal(e) {
    const c = this.envCanvas, r = c.getBoundingClientRect();
    return { x: e.clientX - r.left - c.clientLeft, y: e.clientY - r.top - c.clientTop }; // inside the border
  }

  /** Nearest keyframe of the edited param under the pointer, or null. */
  _envHit(cue, x, y) {
    if (!isAnimated(cue, this.envParam)) return null;
    const spec = PARAM_BY_KEY[this.envParam];
    const g = this._envGeom();
    let best = null, bestD = KEY_HIT_PX * KEY_HIT_PX;
    for (const k of cue.anim[this.envParam].keys) {
      const dx = x - this._uToX(k.t, g), dy = y - this._keyY(spec, k, g);
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = k; }
    }
    return best;
  }

  _envPointerDown(e) {
    const cue = this.cue;
    if (!cue || cue.kind !== 'laser' || e.button !== 0) return;
    this.envCanvas.focus();
    const key = this.envParam;
    const spec = PARAM_BY_KEY[key];
    const g = this._envGeom();
    const p = this._envLocal(e);
    let k = this._envHit(cue, p.x, p.y);
    if (!k) {
      const u = this._snapU(cue, this._xToU(p.x, g), e.shiftKey);
      const v = spec.kind === 'color' ? valueAt(cue, key, u) : this._yToV(spec, p.y, g);
      k = setKey(cue, key, u, v);
      this.onChange();
    }
    this.envSel = k;
    this._markRows(cue);
    this._seekToKey(cue, k);

    const env = cue.anim[key];
    const move = (ev) => {
      const q = this._envLocal(ev);
      k.t = this._snapU(cue, this._xToU(q.x, g), ev.shiftKey);
      if (spec.kind !== 'color') k.v = this._yToV(spec, q.y, g);
      sortKeys(env);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Dropping a key onto another replaces it (one key per time, as in AE).
      env.keys = env.keys.filter((o) => o === k || Math.abs(o.t - k.t) >= KEY_EPS);
      this._seekToKey(cue, k);
      this.onChange();
      this.onCommit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _envDblClick(e) {
    const cue = this.cue;
    if (!cue || cue.kind !== 'laser') return;
    const p = this._envLocal(e);
    const k = this._envHit(cue, p.x, p.y);
    if (k) this._deleteEnvKey(k);
  }

  _drawEnvelope(cue) {
    const c = this.envCanvas;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
      c.width = Math.floor(cssW * dpr); c.height = Math.floor(cssH * dpr);
    }
    const ctx = this.envCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, cssW, cssH);

    const key = this.envParam;
    const spec = PARAM_BY_KEY[key];
    const g = this._envGeom();
    const animated = isAnimated(cue, key);

    // Beat grid inside the cue (half-beats faint) — keys snap to these. On a
    // long cue, thin the lines (every 2nd/4th/...) so they stay >= 4px apart.
    const half = 30 / (this.transport.bpm || 120);
    const off = this.transport.beatOffset || 0;
    const end = cue.start + cue.duration;
    const pxHalf = ((g.r - g.l) * half) / (cue.duration || 1);
    let every = 1;
    while (pxHalf * every < 4 && every < 4096) every *= 2;
    for (let n = Math.ceil((cue.start - off) / half / every) * every; pxHalf > 0; n += every) {
      const s = off + n * half;
      if (s > end + 1e-9) break;
      const x = this._uToX((s - cue.start) / cue.duration, g);
      ctx.strokeStyle = n % 2 === 0 ? 'rgba(110,130,170,0.32)' : 'rgba(110,130,170,0.12)';
      ctx.beginPath(); ctx.moveTo(x, g.t); ctx.lineTo(x, g.b); ctx.stroke();
    }

    if (spec.kind === 'color') {
      // Colour: the evaluated colour as a strip; keys sit on its centre line.
      const y0 = g.t + (g.b - g.t) * 0.25, hh = (g.b - g.t) * 0.5;
      const n = Math.max(2, Math.floor(g.r - g.l));
      for (let i = 0; i < n; i++) {
        const v = valueAt(cue, key, i / (n - 1));
        ctx.fillStyle = `rgb(${(v[0] * 255) | 0},${(v[1] * 255) | 0},${(v[2] * 255) | 0})`;
        ctx.fillRect(g.l + i, y0, 1.5, hh);
      }
    } else {
      if (spec.min < 0 && spec.max > 0) { // zero line
        const y = this._vToY(spec, 0, g);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.r, y); ctx.stroke();
      }
      ctx.strokeStyle = animated ? '#5fe0ac' : 'rgba(95,224,172,0.35)';
      ctx.lineWidth = 1.5;
      if (!animated) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const N = 160;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = clamp(valueAt(cue, key, u), spec.min, spec.max);
        const x = this._uToX(u, g), y = this._vToY(spec, v, g);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#5c6470';
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.fillText(spec.fmt(spec.max), 3, g.t + 3);
      ctx.fillText(spec.fmt(spec.min), 3, g.b + 3);
    }

    if (animated) {
      for (const k of cue.anim[key].keys) {
        const x = this._uToX(k.t, g), y = this._keyY(spec, k, g);
        ctx.fillStyle = k === this.envSel ? '#ffffff' : '#f0a742';
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#0a0c0f'; ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#6c7481';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click to add a keyframe', cssW / 2, cssH / 2 - 14);
      ctx.textAlign = 'start';
    }

    const now = (this.transport.time - cue.start) / (cue.duration || 1);
    if (now >= 0 && now <= 1) {
      const x = this._uToX(now, g);
      ctx.strokeStyle = '#ff5c7a';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke();
    }
  }

  /** Per-frame: follow the playhead in animated controls + redraw the curve. */
  frame() {
    const cue = this.cue;
    if (!cue || cue.kind !== 'laser' || !this.el.isConnected || this.laserView.hidden) return;
    const u = this._cueU(cue);
    for (const spec of LASER_PARAMS) {
      if (isAnimated(cue, spec.key)) this._showParam(spec, valueAt(cue, spec.key, u));
    }
    this._drawEnvelope(cue);
  }
}
