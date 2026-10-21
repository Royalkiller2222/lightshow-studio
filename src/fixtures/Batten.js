// Single-colour wash batten. 4-channel layout: Dimmer, Red, Green, Blue.
// An elongated bar that lights one colour across its length and throws a wide
// soft wash downward. Mounts on the truss.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { BattenRGB } from './FixtureProfile.js';
import { createBeamMaterial, createUnitConeGeometry } from '../viz/beam.js';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x26262b, roughness: 0.6, metalness: 0.4,
});

const BAR_LENGTH = 1.4;

export class Batten extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 1, opts.profile ?? BattenRGB);
    this.scene = scene;
    this.beamLength = opts.beamLength ?? 8;
    this.beamAngle = opts.beamAngle ?? 40;

    this.root = new THREE.Group();
    this.root.position.copy(opts.position ?? new THREE.Vector3());
    this.root.userData.fixture = this;
    this.pickRoot = this.root;
    scene.add(this.root);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(BAR_LENGTH, 0.1, 0.12), bodyMaterial);
    this.root.add(housing);

    // Glowing emissive face along the bar.
    this.faceMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const face = new THREE.Mesh(new THREE.BoxGeometry(BAR_LENGTH - 0.06, 0.05, 0.02), this.faceMaterial);
    face.position.y = -0.05;
    this.root.add(face);

    // Wide downward wash beam (its local +Z points down).
    this.emitter = new THREE.Group();
    this.emitter.rotation.x = Math.PI / 2;
    this.root.add(this.emitter);

    this.beamMaterial = createBeamMaterial();
    this.beamMaterial.uniforms.uEdge.value = 1.2; // softer, wash-like glow
    this.beam = new THREE.Mesh(createUnitConeGeometry(28, 0.4), this.beamMaterial);
    this.beam.position.z = 0.06;
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.beam.userData.ignorePick = true;
    this.emitter.add(this.beam);

    this.spot = new THREE.SpotLight(0xffffff, 0, this.beamLength * 2.2, Math.PI / 5, 0.6, 1.0);
    this.spot.castShadow = false;
    this.emitter.add(this.spot);
    this.spotTarget = new THREE.Object3D();
    scene.add(this.spotTarget);
    this.spot.target = this.spotTarget;

    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  update() {
    const r = this.attr01('Red'), g = this.attr01('Green'), b = this.attr01('Blue');
    const level = this.attr01('Dimmer');
    const on = level > 0.003 && Math.max(r, g, b) > 0.003;

    this.faceMaterial.color.setRGB(r * level, g * level, b * level);
    this.beam.visible = on;
    this.spot.visible = on;
    if (!on) return;

    const endRadius = Math.tan(THREE.MathUtils.degToRad(this.beamAngle / 2)) * this.beamLength;
    this.beam.scale.set(endRadius, endRadius, this.beamLength);
    this.beamMaterial.uniforms.uColor.value.setRGB(r, g, b);
    this.beamMaterial.uniforms.uIntensity.value = level * 1.4;

    this.spot.color.setRGB(r, g, b);
    this.spot.intensity = level * 30;
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

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== bodyMaterial) o.material.dispose();
    });
    this.scene.remove(this.root);
    this.scene.remove(this.spotTarget);
  }
}
