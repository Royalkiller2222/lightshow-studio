// Select / Move / Rotate tools for fixtures in the viewport.
//
// - Click a fixture's body to select it; it (and its mirror twin) tint blue.
// - Move mode shows a translate gizmo (X/Y/Z arrows), snapped to the grid.
// - Rotate mode shows X/Y/Z rings snapped to 45°.
// Transforms drive the live fixture via its setPosition/setRotation, and the
// mirror twin follows symmetrically (mirrored x, negated yaw and roll).
// onSelect(fx|null) tells the inspector and patch sheet what is selected.
//
// The gizmo is driven through a proxy Object3D so it never fights a fixture's
// internal structure. Picking ignores beams/sparks (userData.ignorePick); the
// capture-phase pointerdown lets a selecting click pre-empt OrbitControls.

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mirrorX } from './placement.js';

const HILITE = new THREE.MeshStandardMaterial({
  color: 0x14325f, emissive: 0x2a7bff, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.2,
});

export class EditTools {
  constructor({ canvas, camera, controls, scene, fixtures, grid = 0.5, onChange = null, onSelect = null }) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.scene = scene;
    this.fixtures = fixtures;
    this.onChange = onChange; // fired when a gizmo move/rotate is committed
    this.onSelect = onSelect; // fired when the selection changes (fx or null)

    this.mode = 'select';
    this.selected = null;
    this._highlighted = []; // { mesh, mat }

    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._v = new THREE.Vector3();

    this.proxy = new THREE.Object3D();
    scene.add(this.proxy);

    this.tc = new TransformControls(camera, canvas);
    this.tc.setTranslationSnap(grid);
    this.tc.setRotationSnap(THREE.MathUtils.degToRad(45));
    this.tc.setSize(0.9);
    this.tc.visible = false;
    this.tc.enabled = false;
    this.tc.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.onChange?.(); // drag finished -> record for undo
    });
    this.tc.addEventListener('objectChange', () => this._applyProxy());
    scene.add(this.tc);

    window.addEventListener('pointerdown', (e) => this._onPointerDown(e), true);
    // Esc-to-deselect is handled by the app's shortcut handler (it knows when
    // focus is in a text field).
  }

  setMode(mode) {
    this.mode = mode;
    this._attachGizmo();
  }

  _onPointerDown(e) {
    if (e.target !== this.canvas || e.button !== 0) return;
    if (this.tc.axis) return; // a gizmo handle is under the cursor — let TransformControls drive
    const fx = this._pick(e);
    if (fx) {
      this.select(fx);
      e.stopPropagation(); // a selecting click shouldn't also orbit the camera
    } else {
      this.deselect();
    }
  }

  _pick(e) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const roots = this.fixtures.map((f) => f.pickRoot).filter(Boolean);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      if (h.object.userData.ignorePick) continue;
      let o = h.object;
      while (o) {
        if (o.userData.fixture) return o.userData.fixture;
        o = o.parent;
      }
    }
    return null;
  }

  select(fx) {
    const changed = this.selected !== fx;
    if (changed) {
      this._clearSelection();
      this.selected = fx;
      this._highlight(fx);
      if (fx.mirror) this._highlight(fx.mirror);
    }
    this._attachGizmo();
    if (changed) this.onSelect?.(fx);
  }

  deselect() {
    const had = this.selected !== null;
    this._clearSelection();
    if (had) this.onSelect?.(null);
  }

  _clearSelection() {
    this._clearHighlight();
    this.selected = null;
    this.tc.detach();
    this.tc.visible = false;
    this.tc.enabled = false;
  }

  /** Re-sync the gizmo after the fixture was moved some other way (inspector, undo). */
  refresh() {
    if (!this.selected) return;
    // A mirror link made/broken elsewhere changes which bodies glow.
    this._clearHighlight();
    this._highlight(this.selected);
    if (this.selected.mirror) this._highlight(this.selected.mirror);
    this._attachGizmo();
  }

  /** Drop selection if the removed fixture (or its twin) was selected. */
  onFixtureRemoved(fx) {
    if (this.selected === fx || (this.selected && this.selected.mirror === fx)) this.deselect();
  }

  _attachGizmo() {
    if (!this.selected || this.mode === 'select') {
      this.tc.detach();
      this.tc.visible = false;
      this.tc.enabled = false;
      return;
    }
    this.selected.getPosition(this._v);
    this.proxy.position.copy(this._v);
    const r = this.selected.getRotation();
    this.proxy.rotation.set(r[0], r[1], r[2]);
    this.tc.attach(this.proxy);
    this.tc.setMode(this.mode === 'rotate' ? 'rotate' : 'translate');
    this.tc.showX = true; this.tc.showY = true; this.tc.showZ = true; // all axes
    this.tc.visible = true;
    this.tc.enabled = true;
  }

  _applyProxy() {
    const fx = this.selected;
    if (!fx) return;
    if (this.mode === 'rotate') {
      const e = [this.proxy.rotation.x, this.proxy.rotation.y, this.proxy.rotation.z];
      fx.setRotation(e);
      // Mirror across the venue centre (x=0): negate yaw and roll, keep pitch.
      if (fx.mirror) fx.mirror.setRotation([e[0], -e[1], -e[2]]);
    } else {
      const p = this.proxy.position;
      fx.setPosition(p);
      if (fx.mirror) fx.mirror.setPosition(mirrorX({ x: p.x, y: p.y, z: p.z }));
    }
  }

  _highlight(fx) {
    fx.pickRoot.traverse((o) => {
      if (o.isMesh && !o.userData.ignorePick) {
        this._highlighted.push({ mesh: o, mat: o.material });
        o.material = HILITE;
      }
    });
  }

  _clearHighlight() {
    for (const { mesh, mat } of this._highlighted) mesh.material = mat;
    this._highlighted.length = 0;
  }
}
