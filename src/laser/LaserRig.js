// A laser projector: renders the active frame two ways (per the chosen "Both"
// mode) — bright additive 3D beams + graphic shot into the venue, and a flat
// 2D galvo preview drawn to a canvas. Transformed by the cue's 7 parameters:
// Size, Rotation X/Y/Z, Position X/Y, Colour, Brightness, Visible Points, Scan.

import * as THREE from 'three';
import { patternSegments } from './patterns.js';

const MAXSEG = 2048;
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

export class LaserRig {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.D = opts.distance ?? 11;     // frame distance from the projector
    this.span = opts.span ?? 4.2;     // half-size of the frame at full Size
    this.previewCanvas = opts.previewCanvas || null;

    this.group = new THREE.Group();
    this.group.position.copy(opts.position ?? new THREE.Vector3(0, 5.2, -7.5));
    this.group.rotation.x = opts.tilt ?? 0.32; // aim forward + slightly down
    scene.add(this.group);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.5, metalness: 0.5 })
    );
    this.group.add(body);

    this._gpos = new Float32Array(MAXSEG * 2 * 3);
    this._bpos = new Float32Array(MAXSEG * 2 * 2 * 3);

    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(this._gpos, 3));
    this.gMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.graphic = new THREE.LineSegments(gGeo, this.gMat);
    this.graphic.frustumCulled = false;
    this.group.add(this.graphic);

    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(this._bpos, 3));
    this.bMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beams = new THREE.LineSegments(bGeo, this.bMat);
    this.beams.frustumCulled = false;
    this.group.add(this.beams);

    this.blank();
  }

  blank() {
    this.graphic.geometry.setDrawRange(0, 0);
    this.beams.geometry.setDrawRange(0, 0);
    this.gMat.opacity = 0;
    this.bMat.opacity = 0;
    this._frame = null;
    this._clearPreview();
  }

  /** Render `pattern` transformed by params `p` (the 7 laser parameters). */
  show(pattern, p) {
    const segs = patternSegments(pattern, p.points ?? 1);
    const stride = Math.max(1, Math.round((1 - (p.scan ?? 1)) * 6)); // low scan rate -> sparser/dotted
    const cz = Math.cos(p.rotZ || 0), sz = Math.sin(p.rotZ || 0);
    _m.makeRotationFromEuler(_e.set(p.rotX || 0, p.rotY || 0, 0));
    const span = this.span;
    const size = p.size ?? 1;

    // Same galvo-space transform as the 2D preview: spin, scale, then offset —
    // Position is independent of Size (BEYOND semantics), then map to metres.
    const to3D = (pt, out) => {
      let X = pt[0] * cz - pt[1] * sz;
      let Y = pt[0] * sz + pt[1] * cz;
      X = X * size + (p.posX || 0); Y = Y * size + (p.posY || 0);
      out.set(X * span, Y * span, 0).applyMatrix4(_m);
      out.z += this.D;
      return out;
    };

    const G = this._gpos, B = this._bpos;
    let gi = 0, bi = 0;
    for (let s = 0; s < segs.length; s += stride) {
      if (gi / 6 >= MAXSEG) break;
      const va = to3D(segs[s][0], _va), ax = va.x, ay = va.y, az = va.z;
      const vb = to3D(segs[s][1], _vb), bx = vb.x, by = vb.y, bz = vb.z;
      G[gi++] = ax; G[gi++] = ay; G[gi++] = az; G[gi++] = bx; G[gi++] = by; G[gi++] = bz;
      B[bi++] = 0; B[bi++] = 0; B[bi++] = 0; B[bi++] = ax; B[bi++] = ay; B[bi++] = az;
      B[bi++] = 0; B[bi++] = 0; B[bi++] = 0; B[bi++] = bx; B[bi++] = by; B[bi++] = bz;
    }
    this.graphic.geometry.setDrawRange(0, gi / 3);
    this.graphic.geometry.attributes.position.needsUpdate = true;
    this.beams.geometry.setDrawRange(0, bi / 3);
    this.beams.geometry.attributes.position.needsUpdate = true;

    const [r, g, b] = p.color || [1, 1, 1];
    const br = p.brightness ?? 1;
    this.gMat.color.setRGB(r, g, b); this.gMat.opacity = Math.min(1, br);
    this.bMat.color.setRGB(r, g, b); this.bMat.opacity = 0.13 * br;
    this.group.visible = true;

    this._frame = { segs, p, stride, cz, sz, size };
    this._drawPreview();
  }

  // ---- flat 2D galvo preview ----
  _clearPreview() {
    const c = this.previewCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, c.width, c.height);
  }

  _drawPreview() {
    const c = this.previewCanvas;
    if (!c || !this._frame) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, w, h);
    const { segs, p, stride, cz, sz, size } = this._frame;
    const [r, g, b] = p.color || [1, 1, 1];
    const br = p.brightness ?? 1;
    ctx.strokeStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${Math.min(1, br)})`;
    ctx.lineWidth = 1.5;
    const map = (pt) => {
      let X = pt[0] * cz - pt[1] * sz, Y = pt[0] * sz + pt[1] * cz;
      X = (X * size + (p.posX || 0)); Y = (Y * size + (p.posY || 0));
      return [w / 2 + X * w * 0.45, h / 2 - Y * h * 0.45];
    };
    ctx.beginPath();
    for (let s = 0; s < segs.length; s += stride) {
      const [ax, ay] = map(segs[s][0]); const [bx, by] = map(segs[s][1]);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }
}
