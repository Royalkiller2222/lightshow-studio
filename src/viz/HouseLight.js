// Toggleable "house light": a bright source hung at the centre of the venue
// that floods the whole room when on, so you can see the rig/geometry clearly
// (work-light mode). A hemisphere light gives even fill, a point light adds a
// centre hotspot, and a small emissive bulb shows where it hangs. Not a DMX
// fixture — purely a viewport aid.

import * as THREE from 'three';

export class HouseLight {
  constructor(scene) {
    this.scene = scene;
    this.on = false;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.point = new THREE.PointLight(0xfff4e2, 0, 60, 1.0);
    this.group.add(this.point);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a44, 0);
    this.group.add(this.hemi);

    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), this.bulbMat);
    this.group.add(this.bulb);

    this.setRoom(14, 18, 6);
  }

  /** Re-hang the light when the room is resized. */
  setRoom(w, d, h) {
    const y = h - 0.4;
    this.point.position.set(0, y, 0);
    this.point.distance = Math.max(w, d) * 1.8;
    this.hemi.position.set(0, y, 0);
    this.bulb.position.set(0, y, 0);
  }

  setOn(on) {
    this.on = on;
    this.point.intensity = on ? 90 : 0;
    this.hemi.intensity = on ? 2.4 : 0;
    this.bulbMat.color.set(on ? 0xfff4e2 : 0x000000);
  }
}
