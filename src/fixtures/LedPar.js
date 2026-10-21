// Generic LED PAR / wash - the workhorse static fixture. 5-channel layout:
//   0 Dimmer  1 Red  2 Green  3 Blue  4 Strobe
// No pan/tilt: it points where it's mounted (down by default). Reuses the
// analytic beam cone and adds a strobe gate. Builds its own body geometry.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { LedParRGB } from './FixtureProfile.js';
import { createBeamMaterial, createUnitConeGeometry } from '../viz/beam.js';
import { strobeGate } from '../viz/strobe.js';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x2b2b30, roughness: 0.55, metalness: 0.45,
});

export class LedPar extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 1, opts.profile ?? LedParRGB);

    this.scene = scene;
    this.beamLength = opts.beamLength ?? 9;
    this.beamAngle = opts.beamAngle ?? 26; // wash spread, degrees
    this._t = 0;

    this.root = new THREE.Group();
    this.root.position.copy(opts.position ?? new THREE.Vector3());
    this.root.userData.fixture = this; // raycast hit -> this fixture
    this.pickRoot = this.root;
    scene.add(this.root);

    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.22, 20), bodyMaterial);
    this.root.add(can);

    // Emitter points its local +Z straight down (the cone/spot direction).
    this.emitter = new THREE.Group();
    this.emitter.rotation.x = Math.PI / 2;
    this.root.add(this.emitter);

    this.lensMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), this.lensMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.11;
    this.emitter.add(lens);

    this.beamMaterial = createBeamMaterial();
    this.beam = new THREE.Mesh(createUnitConeGeometry(28, 0.07), this.beamMaterial);
    this.beam.position.z = 0.11;
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.beam.userData.ignorePick = true; // don't grab the fixture by its beam
    this.emitter.add(this.beam);

    this.spot = new THREE.SpotLight(0xffffff, 0, this.beamLength * 2.2, Math.PI / 6, 0.5, 1.0);
    this.spot.castShadow = false;
    this.emitter.add(this.spot);
    this.spotTarget = new THREE.Object3D();
    scene.add(this.spotTarget);
    this.spot.target = this.spotTarget;

    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  update(dt) {
    this._t += dt;

    const r = this.attr01('Red'), g = this.attr01('Green'), b = this.attr01('Blue');
    const level = this.attr01('Dimmer') * strobeGate(this.attr('Strobe'), this._t);
    const on = level > 0.003 && Math.max(r, g, b) > 0.003;

    this.lensMaterial.color.setRGB(r * level, g * level, b * level);
    this.beam.visible = on;
    this.spot.visible = on;
    if (!on) return;

    const endRadius = Math.tan(THREE.MathUtils.degToRad(this.beamAngle / 2)) * this.beamLength;
    this.beam.scale.set(endRadius, endRadius, this.beamLength);
    const u = this.beamMaterial.uniforms;
    u.uColor.value.setRGB(r, g, b);
    u.uIntensity.value = level * 1.6;

    this.spot.color.setRGB(r, g, b);
    this.spot.intensity = level * 20;
    this.spot.angle = THREE.MathUtils.degToRad(this.beamAngle / 2);
    this.emitter.getWorldPosition(this._pos);
    this.emitter.getWorldDirection(this._dir);
    this.spotTarget.position.copy(this._pos).addScaledVector(this._dir, this.beamLength);
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

  /** Remove from the scene and free per-instance GPU resources. */
  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== bodyMaterial) o.material.dispose();
    });
    this.scene.remove(this.root);
    this.scene.remove(this.spotTarget);
  }
}
