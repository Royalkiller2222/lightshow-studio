// Show files and undo/redo.
//
// A project is a JSON snapshot: room, fixtures (type/patch/position/rotation/
// mirror), cues (fixture and laser, incl. keyframe envelopes) and settings.
// Audio isn't embedded — its name is stored as a reminder and the song is
// re-loaded by hand. Undo/redo re-apply whole-project snapshots: simple, and
// it covers everything with one record() call per committed edit.

import * as THREE from 'three';
import { loadAnim } from '../laser/envelopes.js';

/**
 * ctx: { room, houseLight, placement, rig, patch, engine, transport, audio,
 *        atmosphere, timeline, editTools }
 */
export function serializeProject(ctx) {
  const { room, patch, engine, transport, audio, atmosphere } = ctx;
  const order = patch.entries.map((e) => e.fixture);
  const idx = new Map(order.map((f, i) => [f, i]));
  const v = new THREE.Vector3();
  return {
    app: 'lightshow-studio', version: 1,
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
    cues: engine.cues.map((c) => ({
      kind: c.kind, effectKey: c.effectKey, groupId: c.groupId, pattern: c.pattern,
      start: c.start, duration: c.duration, lane: c.lane,
      params: { ...c.params, color: [...c.params.color] },
      anim: c.anim ? structuredClone(c.anim) : undefined, // laser keyframe envelopes
    })),
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

  const r = data.room || { w: 14, d: 18, h: 6 };
  room.build(r.w, r.d, r.h);
  houseLight.setRoom(r.w, r.d, r.h);
  placement.setTrussY(r.h - 0.6);

  const made = data.fixtures.map((f) => rig.restore(f));
  data.fixtures.forEach((f, i) => {
    if (f.mirror != null && made[i] && made[f.mirror]) made[i].mirror = made[f.mirror];
  });

  for (const c of data.cues || []) {
    const cue = c.kind === 'laser'
      ? engine.addLaserCue({ pattern: c.pattern, start: c.start, duration: c.duration, lane: c.lane ?? 0 })
      : engine.addCue({ effectKey: c.effectKey, groupId: c.groupId, start: c.start, duration: c.duration, lane: c.lane ?? 0 });
    if (c.params) cue.params = { ...cue.params, ...c.params, color: [...(c.params.color || cue.params.color)] };
    const anim = c.kind === 'laser' ? loadAnim(c.anim) : undefined;
    if (anim) cue.anim = anim;
  }

  const s = data.settings || {};
  if (Number.isFinite(s.bpm)) transport.bpm = s.bpm;
  if (Number.isFinite(s.beatOffset)) transport.beatOffset = s.beatOffset;
  if (Number.isFinite(s.haze)) atmosphere.setHaze(s.haze);
  if (Number.isFinite(s.brightness)) atmosphere.setBrightness(s.brightness);
  if (typeof s.house === 'boolean') atmosphere.setHouse(s.house);

  if (!keepTransport) transport.stop();
  timeline.selectCue(null); // cues were recreated; drop stale selection
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
