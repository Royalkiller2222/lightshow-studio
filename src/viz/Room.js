// Parametric venue: a back-face box (so the camera always sees into the
// room from any angle, dollhouse-style) plus a floor grid for orientation.
// Rebuild with new dimensions at any time from the UI.

import * as THREE from 'three';

export class Room {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.size = { width: 0, depth: 0, height: 0 };
  }

  build(width = 14, depth = 18, height = 6) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }

    this.group = new THREE.Group();

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({
        color: 0x202028,
        roughness: 0.92,
        metalness: 0.0,
        side: THREE.BackSide,
      })
    );
    shell.position.y = height / 2;
    this.group.add(shell);

    // 0.5 m cells so the grid reads as the placement snap step.
    const gridSize = Math.min(width, depth);
    const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / 0.5), 0x2e2e34, 0x232328);
    grid.position.y = 0.01;
    this.group.add(grid);

    this.scene.add(this.group);
    this.size = { width, depth, height };
  }
}
