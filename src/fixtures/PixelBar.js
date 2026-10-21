// Pixel bar: a master Dimmer then N cells of R/G/B, each its own emissive
// segment and downward beam - so chases and rainbows run across the bar.
// Mounts on the truss.

import * as THREE from 'three';
import { Fixture } from './Fixture.js';
import { PixelBarRGB, PIXEL_BAR_CELLS } from './FixtureProfile.js';
import { createBeamMaterial, createUnitConeGeometry } from '../viz/beam.js';

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x222227, roughness: 0.6, metalness: 0.4,
});

const BAR_LENGTH = 1.7;

export class PixelBar extends Fixture {
  constructor(hub, scene, opts = {}) {
    super(hub, opts.universe ?? 1, opts.startAddress ?? 1, opts.profile ?? PixelBarRGB);
    this.scene = scene;
    this.cells = PIXEL_BAR_CELLS;
    this.beamLength = opts.beamLength ?? 6;
    this.beamAngle = opts.beamAngle ?? 16;

    this.root = new THREE.Group();
    this.root.position.copy(opts.position ?? new THREE.Vector3());
    this.root.userData.fixture = this;
    this.pickRoot = this.root;
    scene.add(this.root);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(BAR_LENGTH, 0.1, 0.12), bodyMaterial);
    this.root.add(housing);

    // Emitter points cell beams straight down (local +Z -> world -Y).
    this.emitter = new THREE.Group();
    this.emitter.rotation.x = Math.PI / 2;
    this.root.add(this.emitter);

    this.cellMaterials = [];
    this.beamMaterials = [];
    this.beams = [];
    const endRadius = Math.tan(THREE.MathUtils.degToRad(this.beamAngle / 2)) * this.beamLength;

    for (let i = 0; i < this.cells; i++) {
      const x = (i / (this.cells - 1) - 0.5) * (BAR_LENGTH - 0.2);

      const cellMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const cell = new THREE.Mesh(new THREE.BoxGeometry(BAR_LENGTH / this.cells - 0.03, 0.05, 0.02), cellMat);
      cell.position.set(x, -0.05, 0);
      this.root.add(cell);
      this.cellMaterials.push(cellMat);

      const beamMat = createBeamMaterial();
      const beam = new THREE.Mesh(createUnitConeGeometry(20, 0.06), beamMat);
      beam.position.set(x, 0, 0.05);
      beam.scale.set(endRadius, endRadius, this.beamLength);
      beam.visible = false;
      beam.frustumCulled = false;
      beam.userData.ignorePick = true;
      this.emitter.add(beam);
      this.beamMaterials.push(beamMat);
      this.beams.push(beam);
    }
  }

  update() {
    const master = this.attr01('Dimmer');
    for (let i = 0; i < this.cells; i++) {
      const r = this.attr01(`R${i + 1}`) * master;
      const g = this.attr01(`G${i + 1}`) * master;
      const b = this.attr01(`B${i + 1}`) * master;
      const on = Math.max(r, g, b) > 0.003;

      this.cellMaterials[i].color.setRGB(r, g, b);
      this.beams[i].visible = on;
      if (!on) continue;
      const u = this.beamMaterials[i].uniforms;
      u.uColor.value.setRGB(
        r / Math.max(r, g, b, 1e-4),
        g / Math.max(r, g, b, 1e-4),
        b / Math.max(r, g, b, 1e-4)
      );
      u.uIntensity.value = Math.max(r, g, b) * 1.6;
    }
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
