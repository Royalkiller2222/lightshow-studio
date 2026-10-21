// Stylized volumetric beam - the same analytic technique as the Unity
// version, ported to GLSL: a unit cone mesh, additive blending, radial +
// axial falloff, apex fade, camera-proximity fade, and dither to kill
// banding. No raymarching, so cost scales with beam pixels on screen -
// dozens of beams run fine on mid-range GPUs.

import * as THREE from 'three';

/** Global haze density, shared by every beam material. */
export const hazeUniform = { value: 0.6 };

// The mesh is a cone *shell* (lateral surface only), so we can't read a
// "distance from axis" per fragment - every surface point sits at the cone
// radius. Instead we glow toward the silhouette with a fresnel term (the angle
// between the view ray and the surface normal): edges where we look along the
// shell read bright, the face-on middle reads dim, which reads as a soft
// volumetric cone. Additive + double-sided so front and back faces accumulate.
const VERT = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  varying float vAxial;
  void main() {
    vAxial = position.z;            // unit cone: 0 at apex, 1 at the far end
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vViewNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uEdge;
  uniform float uAxialFalloff;
  uniform float uCameraFade;
  uniform float uHaze;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  varying float vAxial;

  void main() {
    float z = clamp(vAxial, 0.0, 1.0);
    float axial    = pow(clamp(1.0 - z, 0.0, 1.0), uAxialFalloff); // dims along the throw
    float apexFade = smoothstep(0.0, 0.04, z);                     // no hot point at the lens
    float camFade  = clamp(-vViewPos.z / uCameraFade, 0.0, 1.0);   // fade when flying through

    vec3 V = normalize(-vViewPos);
    vec3 N = normalize(vViewNormal);
    float fres = pow(1.0 - abs(dot(V, N)), uEdge); // bright toward the silhouette
    float body = 0.18 + 0.42 * fres;               // soft fill + glowing edge

    float energy = uIntensity * body * axial * apexFade * camFade * clamp(uHaze, 0.0, 1.0);
    vec3 col = uColor * energy;

    // Interleaved gradient noise dither against banding
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    col *= 0.94 + 0.06 * dither;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createBeamMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 1.0 },
      uEdge: { value: 1.6 },
      uAxialFalloff: { value: 1.1 },
      uCameraFade: { value: 0.7 },
      uHaze: hazeUniform, // shared object: one slider moves every beam
    },
  });
}

/**
 * Unit cone: ring at z=0 with apexRadius (the lens), ring at z=1 with
 * radius 1. Zoom and throw are pure transform scale - the mesh is never
 * rebuilt.
 */
export function createUnitConeGeometry(segments = 28, apexRadius = 0.06) {
  const verts = new Float32Array((segments + 1) * 2 * 3);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const i0 = i * 3;
    const i1 = (segments + 1 + i) * 3;
    verts[i0] = cos * apexRadius; verts[i0 + 1] = sin * apexRadius; verts[i0 + 2] = 0;
    verts[i1] = cos;              verts[i1 + 1] = sin;              verts[i1 + 2] = 1;
  }

  const index = [];
  for (let i = 0; i < segments; i++) {
    const a0 = i, a1 = i + 1;
    const b0 = segments + 1 + i, b1 = segments + 2 + i;
    index.push(a0, b0, a1, a1, b0, b1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals(); // fresnel beam shader needs outward normals
  return geo;
}
