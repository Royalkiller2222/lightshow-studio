// The playback engine. It owns the timeline's tracks, cues and markers, and
// the fixture groups. Each frame it blacks out, then evaluates every cue active
// at the transport's time and merges them into the UniverseHub: intensity HTP
// (brightest wins), colour/position LTP (the higher track wins). Fixture cues
// are looks (layers of effects); the top active laser cue drives the laser.

import { EFFECT_BY_KEY, EFFECTS, writeAttr, writeRGB } from './effects.js';
import { makeLayer, normalizeLayers } from './looks.js';
import { PATTERN_BY_KEY } from '../laser/patterns.js';
import { resolveLaserParams } from '../laser/envelopes.js';

let _id = 1;
let _tid = 1;

/** "Rainbow · Wave" — a default name from a look's layers. */
export function lookName(layers) {
  const names = (layers || []).map((l) => {
    const e = EFFECTS.find((x) => x.key === l.effectKey);
    if (!e) return null;
    const i = e.label.indexOf(' · ');
    return i >= 0 ? e.label.slice(i + 3) : e.label;
  }).filter(Boolean);
  return names.length ? names.join(' · ') : 'Empty look';
}

/** Default values for the 7 laser-cue parameters (BEYOND-style). */
export function laserParams() {
  return { size: 1, rotX: 0, rotY: 0, rotZ: 0, posX: 0, posY: 0, color: [0.1, 1, 0.4], brightness: 1, points: 1, scan: 1 };
}

export class ShowEngine {
  constructor(hub, fixtures) {
    this.hub = hub;
    this.fixtures = fixtures; // live array (shared with app)
    this.cues = [];
    // Named timeline tracks, top first. A cue belongs to one track (cue.track =
    // track id); the track decides its target fixtures (fixture tracks), its
    // priority (cue.lane = track index: top track wins LTP / the laser) and
    // whether it plays (mute / solo).
    this.tracks = [];
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

  // ---------------------------------------------------------------- tracks
  addTrack({ name, kind = 'fixture', groupId = 'movers', mute = false, solo = false, open = false, index = null } = {}) {
    const track = { id: _tid++, name: name || (kind === 'laser' ? 'Laser' : 'Fixtures'), kind, groupId: kind === 'laser' ? null : groupId, mute, solo, open };
    if (index == null || index >= this.tracks.length) this.tracks.push(track);
    else this.tracks.splice(Math.max(0, index), 0, track);
    this.syncTracks();
    return track;
  }

  removeTrack(id) {
    const i = this.tracks.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tracks.splice(i, 1);
    this.cues = this.cues.filter((c) => c.track !== id);
    this.syncTracks();
  }

  moveTrack(id, delta) {
    const i = this.tracks.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.tracks.length) return;
    const [t] = this.tracks.splice(i, 1);
    this.tracks.splice(j, 0, t);
    this.syncTracks();
  }

  trackOf(cue) { return this.tracks.find((t) => t.id === cue.track) || null; }

  /** Re-derive each cue's priority (lane = track index) and fixture target from its track. */
  syncTracks() {
    const idx = new Map(this.tracks.map((t, i) => [t.id, i]));
    for (const c of this.cues) {
      if (!idx.has(c.track)) continue;
      c.lane = idx.get(c.track);
      const t = this.tracks[c.lane];
      if (c.kind === 'fixture' && t.groupId) c.groupId = t.groupId;
    }
  }

  /** Mute / solo: with any track soloed, only soloed tracks play. */
  audible(cue) {
    const t = this.trackOf(cue);
    if (!t) return true;
    return this.tracks.some((x) => x.solo) ? t.solo : !t.mute;
  }

  // ------------------------------------------------------------------ cues
  /**
   * A fixture cue is a *look*: up to three layers (intensity / colour /
   * movement), each one effect with its own params (see looks.js). Pass
   * `layers`, or a single `effectKey` for a one-layer look.
   */
  addCue({ effectKey = 'i-flat', layers = null, name = null, groupId = 'movers', start = 0, duration = 4, lane = 0, track = null } = {}) {
    const ls = normalizeLayers(layers || [makeLayer(effectKey)]);
    const cue = { id: _id++, kind: 'fixture', name: name || lookName(ls), layers: ls, groupId, start, duration, lane, track };
    this.cues.push(cue);
    if (track != null) this.syncTracks();
    return cue;
  }

  /** A BEYOND-style laser cue: a vector pattern + the 7 laser parameters. */
  addLaserCue({ pattern = 'beam-fan', start = 0, duration = 4, lane = 0, track = null } = {}) {
    const cue = { id: _id++, kind: 'laser', pattern, start, duration, lane, track, params: laserParams() };
    this.cues.push(cue);
    if (track != null) this.syncTracks();
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
      if (cue.kind !== 'fixture' || !this.audible(cue)) continue;
      const group = this.groupFixtures(cue.groupId);
      const n = group.length;
      const localT = time - cue.start;
      const beat = (localT * bpm) / 60;
      for (const layer of cue.layers) {
        const effect = EFFECT_BY_KEY[layer.effectKey];
        if (!effect) continue;
        for (let i = 0; i < n; i++) {
          this.sink.fixture = group[i];
          effect.apply(group[i], { t: localT, beat, i, n, p: layer.params, out: this.sink, bands, bpm });
        }
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
      if (!this.audible(c)) continue;
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
