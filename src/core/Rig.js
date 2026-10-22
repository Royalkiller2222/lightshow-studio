// The rig: every fixture in the venue plus its patch entry. Adding a fixture
// auto-patches it to the first free addresses in universe 1 (so beginners
// never have to think about DMX); removing one tears down its 3D objects and
// unlinks its mirror twin. Labels ("Moving head 3") come from per-type counters.

import * as THREE from 'three';
import { fixtureType } from '../fixtures/registry.js';

export class Rig {
  constructor({ hub, scene, patch }) {
    this.hub = hub;
    this.scene = scene;
    this.patch = patch;
    this.fixtures = [];      // live array shared with the engine, tools and renderer loop
    this.typeCounters = {};  // per-type counters for default names
    this.onRemoved = null;   // (fx) => void — lets the edit tools drop a stale selection
  }

  /** The demo rig the app launches with: four movers on the truss + a spark pair. */
  seedDemo() {
    for (let i = 0; i < 4; i++) {
      this.spawn('moving-head', new THREE.Vector3(-4.5 + i * 3, 5.4, -3), { startAddress: 1 + i * 9 });
    }
    const l = this.spawn('cold-spark', new THREE.Vector3(-3, 0, -6.5), { startAddress: 37, label: 'Cold spark L' });
    const r = this.spawn('cold-spark', new THREE.Vector3(3, 0, -6.5), { startAddress: 37, label: 'Cold spark R' });
    // The spark pair shares address 37 on purpose (both fire together).
    l.mirror = r; r.mirror = l;
  }

  /**
   * Create a fixture of `typeKey`. With no position it fans across the room so
   * repeated adds don't stack. Returns null if universe 1 has no room left.
   */
  spawn(typeKey, position = null, { startAddress = null, label = null } = {}) {
    const type = fixtureType(typeKey);
    if (!type) return null;
    const n = (this.typeCounters[typeKey] = (this.typeCounters[typeKey] ?? 0) + 1);
    let pos = position;
    if (!pos) {
      const x = (((n - 1) % 8) - 3.5) * 1.6;
      pos = type.onTruss ? new THREE.Vector3(x, 5.4, -3) : new THREE.Vector3(x, 0, -6.5);
    }
    const fx = type.create(this.hub, this.scene, { universe: 1, position: pos });
    fx.typeKey = typeKey;
    if (fx.channelCount > 0) {
      const addr = startAddress ?? this.patch.nextFreeAddress(1, fx.channelCount);
      if (addr == null) {
        fx.dispose?.();
        this.typeCounters[typeKey]--;
        return null; // universe 1 is full
      }
      fx.startAddress = addr;
    }
    this.fixtures.push(fx);
    this.patch.addFixture(fx, label ?? `${type.label} ${n}`);
    return fx;
  }

  /** Place one fixture per point (drag-drop). Two points = a linked mirror pair. */
  place(typeKey, points) {
    const made = points.map((p) => this.spawn(typeKey, new THREE.Vector3(p.x, p.y, p.z))).filter(Boolean);
    if (made.length === 2) {
      made[0].mirror = made[1];
      made[1].mirror = made[0];
    }
    return made;
  }

  remove(fx) {
    const index = this.patch.entries.findIndex((e) => e.fixture === fx);
    if (index < 0) return;
    this.patch.remove(index);
    this.onRemoved?.(fx); // clear selection/gizmo before teardown
    if (fx.mirror) fx.mirror.mirror = null; // unlink the surviving twin
    const i = this.fixtures.indexOf(fx);
    if (i >= 0) this.fixtures.splice(i, 1);
    fx.dispose?.();
  }

  labelOf(fx) {
    return this.patch.entries.find((e) => e.fixture === fx)?.label ?? 'Fixture';
  }

  hasType(pred) { return this.fixtures.some(pred); }

  /** Remove everything (project load). */
  clear() {
    for (const fx of this.fixtures.slice()) { this.onRemoved?.(fx); fx.dispose?.(); }
    this.fixtures.length = 0;
    this.patch.clear();
    for (const k of Object.keys(this.typeCounters)) delete this.typeCounters[k];
  }

  /** Rebuild one fixture from a saved project entry. */
  restore(f) {
    const type = fixtureType(f.type);
    if (!type) return null;
    const pos = Array.isArray(f.pos) ? f.pos : [0, 0, 0];
    const fx = type.create(this.hub, this.scene, { universe: f.universe, position: new THREE.Vector3(...pos) });
    fx.startAddress = f.startAddress;
    fx.typeKey = f.type;
    if (Array.isArray(f.rot)) fx.setRotation(f.rot);
    else if (typeof f.yaw === 'number') fx.setRotation([0, f.yaw, 0]); // back-compat
    this.fixtures.push(fx);
    this.patch.addFixture(fx, f.label);
    this.typeCounters[f.type] = (this.typeCounters[f.type] ?? 0) + 1;
    return fx;
  }
}
