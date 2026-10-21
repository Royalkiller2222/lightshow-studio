// The real playback engine that replaces the hardcoded DemoShow. It owns the
// cue list (effect clips on the timeline) and fixture groups. Each frame it
// blacks out, then evaluates every cue active at the transport's time and
// merges them into the UniverseHub. Cues later in the list win per channel
// (LTP) — a simple, predictable priority while we build toward HTP/LTP layers.

import { EFFECT_BY_KEY, paramsFor, writeAttr, writeRGB } from './effects.js';
import { PATTERN_BY_KEY } from '../laser/patterns.js';
import { resolveLaserParams } from '../laser/envelopes.js';

let _id = 1;

/** Default values for the 7 laser-cue parameters (BEYOND-style). */
export function laserParams() {
  return { size: 1, rotX: 0, rotY: 0, rotZ: 0, posX: 0, posY: 0, color: [0.1, 1, 0.4], brightness: 1, points: 1, scan: 1 };
}

export class ShowEngine {
  constructor(hub, fixtures) {
    this.hub = hub;
    this.fixtures = fixtures; // live array (shared with app)
    this.cues = [];
    this.universe = 1;
    this.manualSpark = false;
    this.laserRig = null; // set by app; renders the active laser cue
    this._selection = []; // current viewport selection, for the "Selection" group

    // Per-frame merge buffer. Effects write here via `sink`; we flush once per
    // fixture. Intensity is HTP (brightest cue wins); colour/position are LTP
    // (last applied — i.e. top lane — wins).
    this._acc = new Map();
    this.sink = {
      fixture: null,
      acc: this._acc,
      _a() {
        let a = this.acc.get(this.fixture);
        if (!a) { a = { dim: 0, lit: false, rgb: null, pan: null, tilt: null, trig: false, height: null }; this.acc.set(this.fixture, a); }
        return a;
      },
      dimmer(v) { const a = this._a(); a.lit = true; if (v > a.dim) a.dim = v; }, // HTP
      rgb(r, g, b) { this._a().rgb = [r, g, b]; },
      panTilt(p, t) { const a = this._a(); a.pan = p; a.tilt = t; },
      trigger(on) { this._a().trig = !!on; },
      height(v) { this._a().height = v; },
    };
  }

  setSelection(list) { this._selection = list || []; }

  /** Resolve a group id to its current fixture list. */
  groupFixtures(id) {
    const f = this.fixtures;
    switch (id) {
      case 'all': return f;
      case 'movers': return f.filter((x) => x.profile && x.profile.has('Pan'));
      case 'pars': return f.filter((x) => x.constructor.name === 'LedPar');
      case 'bars': return f.filter((x) => x.constructor.name === 'PixelBar' || x.constructor.name === 'Batten');
      case 'lasers': return f.filter((x) => x.constructor.name === 'LaserProjector');
      case 'sparks': return f.filter((x) => x.profile && x.profile.has('Trigger'));
      case 'selection': return this._selection;
      default: return [];
    }
  }

  addCue({ effectKey = 'i-flat', groupId = 'movers', start = 0, duration = 4, lane = 0 } = {}) {
    const cue = { id: _id++, kind: 'fixture', effectKey, groupId, start, duration, lane, params: paramsFor(effectKey) };
    this.cues.push(cue);
    return cue;
  }

  /** A BEYOND-style laser cue: a vector pattern + the 7 laser parameters. */
  addLaserCue({ pattern = 'beam-fan', start = 0, duration = 4, lane = 0 } = {}) {
    const cue = { id: _id++, kind: 'laser', pattern, start, duration, lane, params: laserParams() };
    this.cues.push(cue);
    return cue;
  }

  removeCue(id) {
    const i = this.cues.findIndex((c) => c.id === id);
    if (i >= 0) this.cues.splice(i, 1);
  }

  update(time, bpm, bands = null) {
    if (this.hub.mode !== 'internal') return;
    this._acc.clear();

    // Apply lower lanes first so the top lane (lane 0) wins per channel (LTP);
    // within a lane, later-starting cues take precedence. Intensity from HTP
    // cues is accumulated as a max instead of replaced.
    const ordered = this.cues.slice().sort((a, b) => (b.lane - a.lane) || (a.start - b.start));
    for (const cue of ordered) {
      if (time < cue.start || time >= cue.start + cue.duration) continue;
      const effect = EFFECT_BY_KEY[cue.effectKey];
      if (!effect) continue;
      const group = this.groupFixtures(cue.groupId);
      const n = group.length;
      const localT = time - cue.start;
      const beat = (localT * bpm) / 60;
      for (let i = 0; i < n; i++) {
        this.sink.fixture = group[i];
        effect.apply(group[i], { t: localT, beat, i, n, p: cue.params, out: this.sink, bands, bpm });
      }
    }

    if (this.manualSpark) {
      for (const fx of this.groupFixtures('sparks')) {
        this.sink.fixture = fx;
        this.sink.trigger(true);
        this.sink.height(0.8);
      }
    }

    this._flush();
    this._renderLaser(time);
  }

  /**
   * Render the top active laser cue (lane 0 wins) on the laser rig, with any
   * keyframed parameters evaluated at the cue-local time (0..1).
   */
  _renderLaser(time) {
    if (!this.laserRig) return;
    let top = null;
    for (const c of this.cues) {
      if (c.kind !== 'laser' || time < c.start || time >= c.start + c.duration) continue;
      if (!top || c.lane < top.lane || (c.lane === top.lane && c.start > top.start)) top = c;
    }
    const pat = top && PATTERN_BY_KEY[top.pattern];
    if (!pat) { this.laserRig.blank(); return; }
    const u = Math.min(1, Math.max(0, (time - top.start) / (top.duration || 1)));
    this.laserRig.show(pat, resolveLaserParams(top, u));
  }

  /** Merge the accumulator to DMX: intensity HTP, colour/position LTP. */
  _flush() {
    for (const fx of this.fixtures) {
      if (!fx.profile) continue;
      const a = this._acc.get(fx);
      if (fx.profile.offsetOf('Dimmer') >= 0) writeAttr(fx, 'Dimmer', a ? a.dim : 0);
      if (a && a.rgb) writeRGB(fx, a.rgb[0], a.rgb[1], a.rgb[2]);
      if (a && a.pan != null) { writeAttr(fx, 'Pan', a.pan); writeAttr(fx, 'Tilt', a.tilt); }
      if (fx.profile.offsetOf('Trigger') >= 0) writeAttr(fx, 'Trigger', a && a.trig ? 1 : 0);
      if (a && a.height != null) writeAttr(fx, 'Height', a.height);
    }
  }
}

export const GROUPS = [
  { id: 'movers', label: 'Movers' },
  { id: 'pars', label: 'LED PARs' },
  { id: 'bars', label: 'Bars' },
  { id: 'lasers', label: 'Lasers' },
  { id: 'sparks', label: 'Cold sparks' },
  { id: 'selection', label: 'Selection' },
  { id: 'all', label: 'All fixtures' },
];
