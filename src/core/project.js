// Show files and undo/redo.
//
// A project is a JSON snapshot: room, fixtures (type/patch/position/rotation/
// mirror), timeline tracks, cues (fixture and laser, incl. keyframe envelopes),
// section markers and settings. Version-1 files (anonymous lanes, no tracks)
// are converted on open by tracksFromLanes().
// Audio isn't embedded — its name is stored as a reminder and the song is
// re-loaded by hand. Undo/redo re-apply whole-project snapshots: simple, and
// it covers everything with one record() call per committed edit.

import * as THREE from 'three';
import { loadAnim } from '../laser/envelopes.js';
import { EFFECT_BY_KEY } from '../show/effects.js';
import { GROUPS } from '../show/ShowEngine.js';

export const PROJECT_VERSION = 2; // 2: named tracks + markers (1: anonymous lanes)

const ATTR_NAME = { intensity: 'Intensity', color: 'Colour', position: 'Movement' };

/**
 * Version-1 files had five anonymous lanes. Turn every lane into named tracks:
 * one per (lane, laser | fixture group), in lane order (lane 0 = top = wins),
 * named from what's on it ("Laser 1", "Movers · Colour"). Pure; returns the
 * tracks and, per cue, the index of its track.
 */
export function tracksFromLanes(cues) {
  const tracks = [];
  const byKey = new Map();
  const index = new Array(cues.length);
  const order = cues.map((c, i) => ({ c, i })).sort((a, b) => (a.c.lane ?? 0) - (b.c.lane ?? 0) || a.i - b.i);
  for (const { c, i } of order) {
    const laser = c.kind === 'laser';
    const groupId = laser ? null : (c.groupId || 'movers');
    const key = `${c.lane ?? 0}|${laser ? 'laser' : groupId}`;
    if (!byKey.has(key)) {
      byKey.set(key, tracks.length);
      tracks.push({ kind: laser ? 'laser' : 'fixture', groupId, attrs: new Set(), open: laser });
    }
    const ti = byKey.get(key);
    if (!laser) tracks[ti].attrs.add(c.effectKey === 'sparks' ? 'sparks' : EFFECT_BY_KEY[c.effectKey]?.attr);
    index[i] = ti;
  }
  let lasers = 0;
  for (const t of tracks) {
    if (t.kind === 'laser') t.name = `Laser ${++lasers}`;
    else {
      const g = GROUPS.find((x) => x.id === t.groupId);
      const attr = t.attrs.size === 1 ? [...t.attrs][0] : null;
      t.name = attr && ATTR_NAME[attr] ? `${g ? g.label : 'Fixtures'} · ${ATTR_NAME[attr]}` : (g ? g.label : 'Fixtures');
    }
    delete t.attrs;
  }
  return { tracks, index };
}

/**
 * ctx: { room, houseLight, placement, rig, patch, engine, transport, audio,
 *        atmosphere, timeline, editTools }
 */
export function serializeProject(ctx) {
  const { room, patch, engine, transport, audio, atmosphere } = ctx;
  const order = patch.entries.map((e) => e.fixture);
  const idx = new Map(order.map((f, i) => [f, i]));
  const v = new THREE.Vector3();
  const trackIdx = new Map(engine.tracks.map((t, i) => [t.id, i]));
  return {
    app: 'lightshow-studio', version: PROJECT_VERSION,
    room: { w: room.size.width, d: room.size.depth, h: room.size.height },
    settings: {
      bpm: transport.bpm, beatOffset: transport.beatOffset,
      haze: atmosphere.haze, brightness: atmosphere.brightness, house: atmosphere.house,
    },
    fixtures: patch.entries.map((e) => {
      const fx = e.fixture;
      fx.getPosition(v);
      return {
        type: fx.typeKey, universe: fx.universe, startAddress: fx.startAddress, label: e.label,
        pos: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)], rot: fx.getRotation().map((r) => +r.toFixed(4)),
        mirror: fx.mirror && idx.has(fx.mirror) ? idx.get(fx.mirror) : null,
      };
    }),
    tracks: engine.tracks.map((t) => ({ name: t.name, kind: t.kind, groupId: t.groupId, mute: t.mute, solo: t.solo, open: t.open })),
    cues: engine.cues.map((c) => ({
      kind: c.kind, effectKey: c.effectKey, groupId: c.groupId, pattern: c.pattern,
      start: c.start, duration: c.duration, track: trackIdx.get(c.track) ?? 0,
      params: { ...c.params, color: [...c.params.color] },
      anim: c.anim ? structuredClone(c.anim) : undefined, // laser keyframe envelopes
    })),
    markers: (engine.markers || []).map((m) => ({ t: m.t, name: m.name })).sort((x, y) => x.t - y.t),
    audioName: audio.name || null,
  };
}

/** Replace the current show with `data`. Throws on a file that isn't a project. */
export function applyProject(ctx, data, { keepTransport = false } = {}) {
  if (!data || data.app !== 'lightshow-studio' || !Array.isArray(data.fixtures)) {
    throw new Error('not a Lightshow Studio show file');
  }
  const { room, houseLight, placement, rig, engine, transport, atmosphere, timeline, editTools } = ctx;
  editTools.deselect();
  rig.clear();
  engine.cues.length = 0;
  engine.tracks.length = 0;
  engine.markers = (data.markers || [])
    .filter((m) => m && Number.isFinite(m.t))
    .map((m) => ({ t: Math.max(0, m.t), name: String(m.name || 'Marker') }))
    .sort((a, b) => a.t - b.t);

  const r = data.room || { w: 14, d: 18, h: 6 };
  room.build(r.w, r.d, r.h);
  houseLight.setRoom(r.w, r.d, r.h);
  placement.setTrussY(r.h - 0.6);

  const made = data.fixtures.map((f) => rig.restore(f));
  data.fixtures.forEach((f, i) => {
    if (f.mirror != null && made[i] && made[f.mirror]) made[i].mirror = made[f.mirror];
  });

  // Tracks: saved ones (v2), or derived from the old lanes (v1).
  const cues = data.cues || [];
  let savedTracks = Array.isArray(data.tracks) ? data.tracks : null;
  let cueTrack;
  if (savedTracks) {
    cueTrack = cues.map((c) => c.track ?? 0);
  } else {
    const m = tracksFromLanes(cues);
    savedTracks = m.tracks;
    cueTrack = m.index;
  }
  const made2 = savedTracks.map((t) => engine.addTrack({
    name: t.name, kind: t.kind === 'laser' ? 'laser' : 'fixture', groupId: t.groupId || 'movers',
    mute: !!t.mute, solo: !!t.solo, open: !!t.open,
  }));
  // A cue pointing at a missing / wrong-kind track gets a fresh track of its kind.
  const trackFor = (c, i) => {
    const t = made2[cueTrack[i]];
    const kind = c.kind === 'laser' ? 'laser' : 'fixture';
    if (t && t.kind === kind) return t;
    const fresh = engine.addTrack({ kind, groupId: c.groupId || 'movers', name: kind === 'laser' ? 'Laser' : 'Fixtures' });
    made2.push(fresh);
    return fresh;
  };

  cues.forEach((c, i) => {
    const track = trackFor(c, i).id;
    const cue = c.kind === 'laser'
      ? engine.addLaserCue({ pattern: c.pattern, start: c.start, duration: c.duration, track })
      : engine.addCue({ effectKey: c.effectKey, groupId: c.groupId, start: c.start, duration: c.duration, track });
    if (c.params) cue.params = { ...cue.params, ...c.params, color: [...(c.params.color || cue.params.color)] };
    const anim = c.kind === 'laser' ? loadAnim(c.anim) : undefined;
    if (anim) cue.anim = anim;
  });
  engine.syncTracks();

  const s = data.settings || {};
  if (Number.isFinite(s.bpm)) transport.bpm = s.bpm;
  if (Number.isFinite(s.beatOffset)) transport.beatOffset = s.beatOffset;
  if (Number.isFinite(s.haze)) atmosphere.setHaze(s.haze);
  if (Number.isFinite(s.brightness)) atmosphere.setBrightness(s.brightness);
  if (typeof s.house === 'boolean') atmosphere.setHouse(s.house);

  if (!keepTransport) transport.stop();
  // Cues/tracks/markers were recreated; drop stale selections.
  timeline.selectedTrack = null;
  timeline.selectedMarker = null;
  timeline.selectCue(null);
  timeline.renderCues();
}

/** Undo/redo over whole-project snapshots (JSON strings). */
export class History {
  constructor({ snapshot, restore, limit = 100 }) {
    this.snapshot = snapshot;
    this.restore = restore;
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.present = null;
    this.saved = null;     // snapshot at the last save/open, for the "Edited" flag
    this.applying = false;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get dirty() { return this.present !== this.saved; }

  /** Forget history; the current show becomes the clean baseline. */
  reset() {
    this.past.length = 0;
    this.future.length = 0;
    this.present = this.snapshot();
    this.saved = this.present;
    this._emit();
  }

  markSaved() { this.saved = this.present; this._emit(); }

  /** Snapshot after a committed edit (no-op if nothing changed). */
  record() {
    if (this.applying) return;
    const snap = this.snapshot();
    if (snap === this.present) return;
    if (this.present != null) this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = snap;
    this.future.length = 0;
    this._emit();
  }

  undo() {
    if (!this.past.length) return;
    this.future.push(this.present);
    this.present = this.past.pop();
    this._apply();
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(this.present);
    this.present = this.future.pop();
    this._apply();
  }

  _apply() {
    this.applying = true;
    try { this.restore(this.present); } finally { this.applying = false; }
    this._emit();
  }
}
