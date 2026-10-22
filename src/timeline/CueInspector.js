// Edits the selected timeline cue; lives in the right-hand inspector panel.
//
// Fixture cues: the effect and its own controls (the effect lists which ones it
// uses). Which fixtures it drives belongs to its *track*. Speed shows a beat
// division when beat-synced and a rate in Hz when not. Rarely-touched waveform
// details sit under "More" (Pro).
//
// Laser cues get the BEYOND-style Key Effects: one row per parameter with a ◆
// button that keys it at the playhead. Keying works like After Effects — once a
// parameter has keys, editing it writes a key at the playhead (Auto-key does
// that for every parameter). The keyframe curves themselves are edited in the
// timeline, in lanes under the cue's track; clicking a parameter name opens its
// lane. See Docs/DESIGN_DECISIONS.md "Keyframe envelopes".

import { EFFECTS, paramsFor } from '../show/effects.js';
import { SHAPES, DIVISIONS, FANS } from '../show/waveforms.js';
import { GROUPS } from '../show/ShowEngine.js';
import { PATTERNS } from '../laser/patterns.js';
import { LASER_PARAMS, PARAM_BY_KEY, EASES, isAnimated, valueAt, setKey, clearKeys } from '../laser/envelopes.js';
import { icon } from '../ui/icons.js';
import { esc, more, hexToRgb, rgbToHex, clamp } from '../ui/dom.js';
import { snapKeyU } from './snap.js';

const ATTR_LABEL = { intensity: 'Intensity', color: 'Colour', position: 'Movement' };
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
   *   onDelete(cue), onPickParam(cue, key): show that parameter's curve lane,
   *   onSelectTrack(track)
   */
  constructor({ transport, engine, onChange, onCommit, onDelete, onPickParam, onSelectTrack }) {
    this.transport = transport;
    this.engine = engine;
    this.onChange = onChange;
    this.onCommit = onCommit;
    this.onDelete = onDelete;
    this.onPickParam = onPickParam;
    this.onSelectTrack = onSelectTrack;
    this.cue = null;

    this.autoKey = false;    // BEYOND "Enable auto-keying"
    this.envParam = 'size';  // parameter whose curve is focused
    this._sliderHeld = null; // param whose slider is being dragged (skip live updates)

    this.el = document.createElement('div');
    this.el.className = 'cue-insp';
    this.el.innerHTML = this._fixtureHtml() + this._laserHtml();
    this.$ = (s) => this.el.querySelector(s);
    this.fixtureView = this.$('[data-view="fixture"]');
    this.laserView = this.$('[data-view="laser"]');
    this._wire();
  }

  // ------------------------------------------------------------------ markup
  _trackRow() {
    return `<div class="prop"><span class="name">Track</span><span class="ctl"><button type="button" class="btn sm ghost" data-act="track" title="Edit this cue's track (its fixtures, mute, solo)" style="max-width:100%;overflow:hidden;text-overflow:ellipsis"></button></span></div>`;
  }

  _fixtureHtml() {
    const opt = (list, k = 'key', l = 'label') => list.map((x) => `<option value="${x[k]}">${esc(x[l])}</option>`).join('');
    const effOpts = ['intensity', 'color', 'position'].map((attr) => {
      const o = EFFECTS.filter((e) => e.attr === attr && e.key !== 'sparks')
        .map((e) => `<option value="${e.key}">${esc(effectShortName(e))}</option>`).join('');
      return `<optgroup label="${ATTR_LABEL[attr]}">${o}</optgroup>`;
    }).join('') + '<optgroup label="Special"><option value="sparks">Cold sparks</option></optgroup>';
    const range = (k, min, max, step) => `<input type="range" min="${min}" max="${max}" step="${step}" data-ins="${k}" /><span class="val" data-insval="${k}"></span>`;
    const row = (k, label, ctl) => `<label class="prop" data-ctl="${k}"><span class="name">${label}</span><span class="ctl">${ctl}</span></label>`;

    const basic = [
      row('effectKey', 'Effect', `<select data-ins="effectKey">${effOpts}</select>`),
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
        <div class="sec">${this._trackRow()}${basic}</div>
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
          <span class="name" data-pick="${p.key}" title="Show the ${esc(p.label)} curve in the timeline">${esc(p.label)}</span>
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
          ${this._trackRow()}
          <label class="prop"><span class="name">Pattern</span><span class="ctl"><select data-lmeta="pattern">${pats}</select></span></label>
          <label class="prop"><span class="name">Length</span><span class="ctl"><input type="number" min="0.25" step="0.25" data-lmeta="duration" style="width:80px" /><span class="muted small">seconds</span></span></label>
        </div>
        <div class="sec">
          <div class="sec-title">Key effects<span class="grow"></span>
            <label class="pro small muted" style="display:flex;align-items:center;gap:6px;font-weight:400" title="When on, changing any parameter writes a keyframe at the playhead (animated parameters always do)">Auto-key <input type="checkbox" class="switch" data-role="autokey" /></label>
          </div>
          ${basic}
          ${more('laser-params', adv, 'More effects')}
          <div class="curve-row">
            <span class="t" data-role="env-title"></span>
            <select class="pro" data-role="env-ease" title="How the value moves between keyframes">${eases}</select>
            <button type="button" class="btn sm ghost" data-act="env-clear" title="Remove this parameter's keyframes from this cue (keeps its current value)">Clear</button>
          </div>
          <p class="muted small" style="margin:6px 0 0">Press ◆ to set a keyframe at the playhead. Shape the curve in the timeline, under this cue's track.</p>
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
      else if (act === 'track' && this.cue) this.onSelectTrack?.(this.engine.trackOf(this.cue));
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
        this.onChange();
      }
      this.onCommit();
    });

    // Don't fight the user: skip live updates on the slider being dragged.
    el.addEventListener('pointerdown', (e) => { if (e.target.dataset.lpv) this._sliderHeld = e.target.dataset.lpv; });
    window.addEventListener('pointerup', () => { this._sliderHeld = null; });
  }

  // ---------------------------------------------------------------- showing
  /** Show `cue` (or nothing). Remembers the focused parameter across cues. */
  show(cue) {
    this.cue = cue;
    const laser = !!cue && cue.kind === 'laser';
    this.fixtureView.hidden = !cue || laser;
    this.laserView.hidden = !laser;
    if (!cue) return;
    const track = this.engine.trackOf(cue);
    for (const b of this.el.querySelectorAll('[data-act="track"]')) {
      b.textContent = track ? track.name : '—';
    }
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

  /** Re-read the current cue (keys were edited in the timeline, undo, …). */
  refresh() { if (this.cue) this.show(this.cue); }

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
    const uses = new Set(['effectKey', 'duration', ...(eff ? eff.controls : [])]);
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
    return this.transport.playing ? snapKeyU(this.transport, cue, u) : u;
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

  /** Highlight animated params (filled ◆) and the focused one. */
  _markRows(cue) {
    for (const row of this.el.querySelectorAll('.lp-row')) {
      const key = row.dataset.lp;
      row.classList.toggle('anim', isAnimated(cue, key));
      row.classList.toggle('cur', key === this.envParam);
    }
    const spec = PARAM_BY_KEY[this.envParam];
    const animated = isAnimated(cue, this.envParam);
    this.$('[data-role="env-title"]').textContent = `${spec.label}: ${animated ? `${cue.anim[this.envParam].keys.length} keyframe${cue.anim[this.envParam].keys.length === 1 ? '' : 's'}` : 'not animated'}`;
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
      const wasAnimated = isAnimated(cue, key);
      setKey(cue, key, this._keyU(cue), v);
      this.envParam = key;
      this._markRows(cue);
      if (!wasAnimated) this.onPickParam?.(cue, key); // a new curve: open its lane
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
    setKey(cue, key, u, valueAt(cue, key, u));
    this.envParam = key;
    this._markRows(cue);
    this.onPickParam?.(cue, key);
    this.onChange();
    this.onCommit();
  }

  _pickParam(key) {
    if (!this.cue || this.cue.kind !== 'laser') return;
    this.envParam = key;
    this._markRows(this.cue);
    this.onPickParam?.(this.cue, key);
  }

  /** The timeline focused another curve lane: follow it. */
  setFocus(key) {
    this.envParam = key;
    if (this.cue && this.cue.kind === 'laser') this._markRows(this.cue);
  }

  _clearEnvelope() {
    const cue = this.cue;
    if (!cue || !isAnimated(cue, this.envParam)) return;
    clearKeys(cue, this.envParam, this._cueU(cue));
    this._laserRefresh(cue);
    this.onChange();
    this.onCommit();
  }

  /** Per-frame: follow the playhead in the animated controls. */
  frame() {
    const cue = this.cue;
    if (!cue || cue.kind !== 'laser' || !this.el.isConnected || this.laserView.hidden) return;
    const u = this._cueU(cue);
    for (const spec of LASER_PARAMS) {
      if (isAnimated(cue, spec.key)) this._showParam(spec, valueAt(cue, spec.key, u));
    }
  }
}
