// Cold spark machine (Sparkular-style). 2-channel layout:
//   0 Trigger (values > 127 fire)
//   1 Spark height
// The height channel becomes a launch speed (v = sqrt(2gh)) so sparks
// physically reach the requested height under gravity.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { ColdSpark2 } from './FixtureProfile.js';

export class ColdSparkMachine extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 37, opts.profile ?? ColdSpark2);
    this.scene = scene;
    this.origin = (opts.position ?? new THREE.Vector3()).clone();
    this.minHeight = 1.5;
    this.maxHeight = 5.0;
    this.max = 600;       // particle pool
    this.rate = 380;      // particles per second while firing
    this._spawnAcc = 0;

    this.positions = new Float32Array(this.max * 3);
    this.velocities = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max); // <= 0 means dead
    for (let i = 0; i < this.max; i++) this.positions[i * 3 + 1] = -1000;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffc878,
      size: 0.05,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.userData.ignorePick = true; // grab the machine body, not sparks
    scene.add(this.points);

    // Machine body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.22, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.7 })
    );
    body.position.copy(this.origin).add(new THREE.Vector3(0, 0.11, 0));
    body.userData.fixture = this; // raycast hit -> this fixture
    this.body = body;
    this.pickRoot = body;
    scene.add(body);

    // Warm flicker that lights the floor around the fountain
    this.glow = new THREE.PointLight(0xffc878, 0, 6, 1.4);
    this.glow.position.copy(this.origin).add(new THREE.Vector3(0, 0.7, 0));
    scene.add(this.glow);
  }

  update(dt) {
    const firing = this.attr('Trigger') > 127;
    const height = THREE.MathUtils.lerp(this.minHeight, this.maxHeight, this.attr01('Height'));
    const launchSpeed = Math.sqrt(2 * 9.81 * height);

    if (firing) {
      this._spawnAcc += this.rate * dt;
      while (this._spawnAcc >= 1) {
        this._spawnAcc -= 1;
        this._spawn(launchSpeed);
      }
      this.glow.intensity = 6 + Math.random() * 5;
    } else {
      this.glow.intensity = Math.max(0, this.glow.intensity - dt * 40);
    }

    const p = this.positions, v = this.velocities;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      v[j + 1] -= 9.81 * dt;
      p[j] += v[j] * dt;
      p[j + 1] += v[j + 1] * dt;
      p[j + 2] += v[j + 2] * dt;
      if (this.life[i] <= 0 || p[j + 1] < 0.02) {
        this.life[i] = 0;
        p[j + 1] = -1000;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  getPosition(target) {
    return target.copy(this.origin);
  }

  /** Move the machine: origin (where new sparks launch), body and glow. */
  setPosition(v) {
    this.origin.copy(v);
    this.body.position.set(v.x, v.y + 0.11, v.z);
    this.glow.position.set(v.x, v.y + 0.7, v.z);
  }

  _rotObject() {
    return this.body;
  }

  /** Remove from the scene and free per-instance GPU resources. */
  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.scene.remove(this.body);
    this.body.geometry.dispose();
    this.body.material.dispose();
    this.scene.remove(this.glow);
  }

  _spawn(speed) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] > 0) continue;
      const j = i * 3;
      this.positions[j] = this.origin.x + (Math.random() - 0.5) * 0.08;
      this.positions[j + 1] = this.origin.y + 0.22;
      this.positions[j + 2] = this.origin.z + (Math.random() - 0.5) * 0.08;
      const spread = 0.11;
      this.velocities[j] = (Math.random() - 0.5) * spread * speed;
      this.velocities[j + 1] = speed * (0.92 + Math.random() * 0.12);
      this.velocities[j + 2] = (Math.random() - 0.5) * spread * speed;
      this.life[i] = 0.7 + Math.random() * 0.8;
      return;
    }
  }
}
