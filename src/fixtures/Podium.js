// A non-DMX stage prop: a speaker's podium / lectern. No channels, no beam -
// it just sits in the venue for scale and staging, and can be moved, rotated,
// and mirrored like any other object.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { PodiumProp } from './FixtureProfile.js';

const shell = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.7, metalness: 0.2 });
const trim = new THREE.MeshStandardMaterial({ color: 0x6a6a76, roughness: 0.5, metalness: 0.4 });

export class Podium extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 1, opts.profile ?? PodiumProp);
    this.scene = scene;

    this.root = new THREE.Group();
    this.root.position.copy(opts.position ?? new THREE.Vector3());
    this.root.userData.fixture = this;
    this.pickRoot = this.root;
    scene.add(this.root);

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.55), trim);
    base.position.y = 0.04;
    this.root.add(base);

    // Tapered column (wider at top), via a 4-sided cylinder.
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 1.0, 4), shell);
    column.rotation.y = Math.PI / 4;
    column.position.y = 0.58;
    this.root.add(column);

    // Slanted reading surface.
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.42), trim);
    top.position.y = 1.12;
    top.rotation.x = -0.32;
    this.root.add(top);
  }

  update() {}

  getPosition(target) {
    return target.copy(this.root.position);
  }

  setPosition(v) {
    this.root.position.copy(v);
  }

  _rotObject() {
    return this.root;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // base/column/top share the two module materials; don't dispose those.
    });
    this.scene.remove(this.root);
  }
}
