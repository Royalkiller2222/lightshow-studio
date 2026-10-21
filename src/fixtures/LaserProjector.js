// DMX laser projector. 6-channel layout: Dimmer, Red, Green, Blue, Speed,
// Spread. Emits a cone/fan of thin bright lines that sweep (rotate) over time;
// Speed sets the rotation rate, Spread the cone half-angle. We visualise DMX
// lasers as line beams + bloom (ILDA control is out of scope). Truss-mounted,
// points down over the floor.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { LaserRGB } from './FixtureProfile.js';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x1b1b20, roughness: 0.5, metalness: 0.5,
});

const LINES = 26;
const LENGTH = 11;
const MIN_HALF = THREE.MathUtils.degToRad(5);
const MAX_HALF = THREE.MathUtils.degToRad(40);

export class LaserProjector extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 1, opts.profile ?? LaserRGB);
    this.scene = scene;
    this._sweep = 0;
    this._half = -1; // forces a geometry build on first update

    this.root = new THREE.Group();
    this.root.position.copy(opts.position ?? new THREE.Vector3());
    this.root.userData.fixture = this;
    this.pickRoot = this.root;
    scene.add(this.root);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), bodyMaterial);
    this.root.add(body);

    // Bright lens dot at the emission point.
    this.lensMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), this.lensMaterial);
    lens.position.y = -0.08;
    this.root.add(lens);

    // Sweeping fan of lines. The emitter spins about Y independently of the
    // fixture's mount yaw (which lives on `root`).
    this.emitter = new THREE.Group();
    this.emitter.position.y = -0.08;
    this.root.add(this.emitter);

    this._positions = new Float32Array(LINES * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fan = new THREE.LineSegments(geo, this.lineMaterial);
    this.fan.frustumCulled = false;
    this.fan.userData.ignorePick = true;
    this.fan.visible = false;
    this.emitter.add(this.fan);
  }

  _rebuildFan(half) {
    const p = this._positions;
    const sinH = Math.sin(half);
    const cosH = Math.cos(half);
    for (let i = 0; i < LINES; i++) {
      const a = (i / LINES) * Math.PI * 2;
      const j = i * 6;
      p[j] = 0; p[j + 1] = 0; p[j + 2] = 0; // origin
      p[j + 3] = sinH * Math.cos(a) * LENGTH; // cone around -Y
      p[j + 4] = -cosH * LENGTH;
      p[j + 5] = sinH * Math.sin(a) * LENGTH;
    }
    this.fan.geometry.attributes.position.needsUpdate = true;
    this._half = half;
  }

  update(dt) {
    const level = this.attr01('Dimmer');
    const r = this.attr01('Red'), g = this.attr01('Green'), b = this.attr01('Blue');
    const peak = Math.max(r, g, b);
    const on = level > 0.003 && peak > 0.003;

    this.lensMaterial.color.setRGB(r * level, g * level, b * level);
    this.fan.visible = on;
    if (!on) return;

    const half = MIN_HALF + (MAX_HALF - MIN_HALF) * this.attr01('Spread');
    if (Math.abs(half - this._half) > 1e-3) this._rebuildFan(half);

    this._sweep += (0.2 + 2.6 * this.attr01('Speed')) * dt;
    this.emitter.rotation.y = this._sweep;

    // Normalise hue, drive brightness with the dimmer.
    this.lineMaterial.color.setRGB(r / peak, g / peak, b / peak);
    this.lineMaterial.opacity = Math.min(1, level * 0.95);
  }

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
      if (o.material && o.material !== bodyMaterial) o.material.dispose();
    });
    this.scene.remove(this.root);
  }
}
