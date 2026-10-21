// 9-channel RGB moving head. Channel layout (offsets from start address):
//   0 Pan coarse   1 Pan fine
//   2 Tilt coarse  3 Tilt fine
//   4 Dimmer
//   5 Red  6 Green  7 Blue
//   8 Zoom (beam angle)
// Pan/tilt are slewed at motor-like max speeds, so console snaps become
// believable sweeps. Builds its own body geometry - nothing to assemble.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { MovingHeadRGB } from './FixtureProfile.js';
import { createBeamMaterial, createUnitConeGeometry } from '../viz/beam.js';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x2b2b30, roughness: 0.55, metalness: 0.45,
});

function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export class MovingHead extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 1, opts.profile ?? MovingHeadRGB);

    this.panRange = opts.panRange ?? 540;
    this.tiltRange = opts.tiltRange ?? 270;
    this.maxPanSpeed = 280;   // deg/s
    this.maxTiltSpeed = 220;
    this.minBeamAngle = 8;    // deg
    this.maxBeamAngle = 42;
    this.beamLength = opts.beamLength ?? 12;
    this.pan = 0;
    this.tilt = 0;

    this.scene = scene;

    // --- Body: base -> yoke -> head (hangs from its mounting point) ---
    this.base = new THREE.Group();
    this.base.position.copy(opts.position ?? new THREE.Vector3());
    this.base.userData.fixture = this; // raycast hit -> this fixture
    this.pickRoot = this.base;
    scene.add(this.base);

    const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 20), bodyMaterial);
    this.base.add(baseMesh);

    this.yoke = new THREE.Group();
    this.yoke.position.y = -0.16;
    this.base.add(this.yoke);
    const armGeo = new THREE.BoxGeometry(0.045, 0.3, 0.11);
    const armL = new THREE.Mesh(armGeo, bodyMaterial);
    const armR = new THREE.Mesh(armGeo, bodyMaterial);
    armL.position.set(-0.165, -0.05, 0);
    armR.position.set(0.165, -0.05, 0);
    this.yoke.add(armL, armR);

    this.head = new THREE.Group();
    this.head.position.y = -0.12;
    this.yoke.add(this.head);
    this.head.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.36), bodyMaterial));

    // Emissive lens that glows with the beam color
    this.lensMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 20), this.lensMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.185;
    this.head.add(lens);

    // --- Volumetric beam along the head's +Z ---
    this.beamMaterial = createBeamMaterial();
    this.beam = new THREE.Mesh(createUnitConeGeometry(28, 0.06), this.beamMaterial);
    this.beam.position.z = 0.185;
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.beam.userData.ignorePick = true; // don't grab the fixture by its beam
    this.head.add(this.beam);

    // --- Real light for pools on the floor/props ---
    this.spot = new THREE.SpotLight(0xffffff, 0, this.beamLength * 2.2, Math.PI / 8, 0.45, 1.0);
    this.spot.castShadow = false;
    this.head.add(this.spot);
    this.spotTarget = new THREE.Object3D();
    scene.add(this.spotTarget);
    this.spot.target = this.spotTarget;

    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  getPosition(target) {
    return target.copy(this.base.position);
  }

  setPosition(v) {
    this.base.position.copy(v);
  }

  _rotObject() {
    return this.base;
  }

  /** Remove from the scene and free per-instance GPU resources. */
  dispose() {
    this.base.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== bodyMaterial) o.material.dispose();
    });
    this.scene.remove(this.base);
    this.scene.remove(this.spotTarget);
  }

  update(dt) {
    // Mechanics
    const targetPan = (this.attr16('Pan') / 65535 - 0.5) * this.panRange;
    const targetTilt = (this.attr16('Tilt') / 65535 - 0.5) * this.tiltRange;
    this.pan = moveTowards(this.pan, targetPan, this.maxPanSpeed * dt);
    this.tilt = moveTowards(this.tilt, targetTilt, this.maxTiltSpeed * dt);
    this.yoke.rotation.y = THREE.MathUtils.degToRad(this.pan);
    this.head.rotation.x = THREE.MathUtils.degToRad(this.tilt);

    // Photometrics
    const dimmer = this.attr01('Dimmer');
    const r = this.attr01('Red'), g = this.attr01('Green'), b = this.attr01('Blue');
    const beamAngle = THREE.MathUtils.lerp(this.minBeamAngle, this.maxBeamAngle, this.attr01('Zoom'));
    const on = dimmer > 0.003 && Math.max(r, g, b) > 0.003;

    this.lensMaterial.color.setRGB(r * dimmer, g * dimmer, b * dimmer);
    this.beam.visible = on;
    this.spot.visible = on;
    if (!on) return;

    const endRadius = Math.tan(THREE.MathUtils.degToRad(beamAngle / 2)) * this.beamLength;
    this.beam.scale.set(endRadius, endRadius, this.beamLength);
    const u = this.beamMaterial.uniforms;
    u.uColor.value.setRGB(r, g, b);
    u.uIntensity.value = dimmer * 1.8;

    this.spot.color.setRGB(r, g, b);
    this.spot.intensity = dimmer * 22;
    this.spot.angle = THREE.MathUtils.degToRad(beamAngle / 2);
    this.head.getWorldPosition(this._pos);
    this.head.getWorldDirection(this._dir);
    this.spotTarget.position.copy(this._pos).addScaledVector(this._dir, this.beamLength);
  }
}
