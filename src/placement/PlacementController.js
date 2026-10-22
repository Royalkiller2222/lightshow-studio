// Viewport placement: drag a fixture card from the Build library into the
// venue to create it (mirrored across centre by default, snapped to the grid).
// A ghost preview shows where things will land. Repositioning existing
// fixtures is handled by the Move/Rotate gizmo in EditTools.

import * as THREE from 'three';
import { placementPoints } from './placement.js';

export class PlacementController {
  constructor({ canvas, camera, controls, scene, fixtures, fixtureType, onPlace, grid = 0.5, trussY = 5.4, getMirror = () => true }) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.scene = scene;
    this.fixtures = fixtures; // same array app mutates; stays current
    this.fixtureType = fixtureType;
    this.onPlace = onPlace;
    this.grid = grid;
    this.trussY = trussY;
    this.getMirror = getMirror;

    this.raycaster = new THREE.Raycaster();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this._pendingType = null; // type key cached on dragstart (DnD data isn't readable during dragover)

    this._buildPreview();

    canvas.addEventListener('dragover', (e) => this._onDragOver(e));
    canvas.addEventListener('drop', (e) => this._onDrop(e));
    canvas.addEventListener('dragleave', () => this._hidePreview());
  }

  setPendingType(key) {
    this._pendingType = key || null;
  }

  setTrussY(y) {
    this.trussY = y;
  }

  // ---- preview markers ----
  _buildPreview() {
    this.preview = new THREE.Group();
    this.preview.visible = false;

    const disc = (color) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.32, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      return m;
    };
    this.discA = disc(0x66ccff);
    this.discB = disc(0xff9966);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, -40),
      new THREE.Vector3(0, 0.02, 40),
    ]);
    this.centerLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x4a6a8a, transparent: true, opacity: 0.55 }));

    this.preview.add(this.discA, this.discB, this.centerLine);
    this.scene.add(this.preview);
  }

  _showPreview(point, mirror) {
    const pts = placementPoints(point, { mirror, grid: this.grid });
    this.preview.visible = true;
    this.discA.position.set(pts[0].x, 0.02, pts[0].z);
    this.discB.visible = pts.length > 1;
    if (pts.length > 1) this.discB.position.set(pts[1].x, 0.02, pts[1].z);
    this.centerLine.visible = mirror;
  }

  _hidePreview() {
    this.preview.visible = false;
  }

  // ---- raycasting helpers ----
  _ndcFrom(e) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this._ndc;
  }

  _floorPoint(e) {
    this.raycaster.setFromCamera(this._ndcFrom(e), this.camera);
    const p = this.raycaster.ray.intersectPlane(this.floor, this._hit);
    return p ? { x: p.x, y: 0, z: p.z } : null;
  }

  // ---- drag-in placement ----
  _onDragOver(e) {
    // Only fixture drags (which announce their type on dragstart) drop here —
    // library patterns/effects belong on the timeline, not in the venue.
    if (!this._pendingType) { this._hidePreview(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const fp = this._floorPoint(e);
    if (!fp) return this._hidePreview();
    const type = this._pendingType ? this.fixtureType(this._pendingType) : null;
    fp.y = type && type.onTruss ? this.trussY : 0;
    this._showPreview(fp, this.getMirror());
  }

  _onDrop(e) {
    e.preventDefault();
    const key = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || this._pendingType;
    this._pendingType = null;
    this._hidePreview();

    const type = this.fixtureType(key);
    const fp = this._floorPoint(e);
    if (!type || !fp) return;
    fp.y = type.onTruss ? this.trussY : 0;
    const pts = placementPoints(fp, { mirror: this.getMirror(), grid: this.grid });
    this.onPlace(key, pts);
  }
}
