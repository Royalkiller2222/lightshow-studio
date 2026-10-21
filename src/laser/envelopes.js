// Keyframe envelopes for laser-cue parameters — BEYOND's "Key effect" model.
// A cue's `params` hold static base values; `cue.anim[key]` (optional) holds a
// keyframe envelope that overrides the base while the cue plays. Key time `t`
// is normalised 0..1 across the cue (BEYOND's "effect based on time" 0–100%
// strip), so resizing a cue stretches its animation with it. Pure functions —
// unit-testable in Node without Three.js.

const DEG = Math.PI / 180;

function fmtDeg(v) { return `${Math.round(v / DEG)}°`; }
function fmtNum(v) { return v.toFixed(2); }
function fmtPct(v) { return `${Math.round(v * 100)}%`; }

/**
 * Single source of truth for laser parameter ranges, labels and display.
 * Values are stored in the units LaserRig consumes (rotation in radians) and
 * only formatted for display (degrees), so saved projects need no migration.
 */
export const LASER_PARAMS = [
  { key: 'size', label: 'Size', min: 0, max: 2, step: 0.01, fmt: fmtNum },
  { key: 'rotX', label: 'Rot X', min: -Math.PI, max: Math.PI, step: DEG, fmt: fmtDeg },
  { key: 'rotY', label: 'Rot Y', min: -Math.PI, max: Math.PI, step: DEG, fmt: fmtDeg },
  { key: 'rotZ', label: 'Rot Z', min: -2 * Math.PI, max: 2 * Math.PI, step: DEG, fmt: fmtDeg },
  { key: 'posX', label: 'Pos X', min: -1, max: 1, step: 0.01, fmt: fmtNum },
  { key: 'posY', label: 'Pos Y', min: -1, max: 1, step: 0.01, fmt: fmtNum },
  { key: 'brightness', label: 'Bright', min: 0, max: 1, step: 0.01, fmt: fmtPct },
  { key: 'points', label: 'Points', min: 0.02, max: 1, step: 0.01, fmt: fmtPct },
  { key: 'scan', label: 'Scan', min: 0.1, max: 1, step: 0.01, fmt: fmtPct },
  { key: 'color', label: 'Colour', kind: 'color' },
];

export const PARAM_BY_KEY = Object.fromEntries(LASER_PARAMS.map((p) => [p.key, p]));

export const EASES = [
  { key: 'linear', label: 'Linear' },
  { key: 'smooth', label: 'Smooth' },
  { key: 'step', label: 'Step' },
];

/** Keys closer than this (fraction of the cue) are treated as the same key. */
export const KEY_EPS = 0.003;

const clone = (v) => (Array.isArray(v) ? [...v] : v);

function lerp(a, b, f) {
  if (Array.isArray(a)) return a.map((x, i) => x + (b[i] - x) * f);
  return a + (b - a) * f;
}

/** Value of an envelope at cue-local time u (0..1). Holds before/after the ends. */
export function evalEnvelope(env, u) {
  const keys = env.keys;
  if (!keys.length) return undefined;
  if (u <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (u >= last.t) return last.v;
  let i = 1;
  while (keys[i].t < u) i++; // keys[i-1].t < u <= keys[i].t
  const a = keys[i - 1], b = keys[i];
  if (env.ease === 'step') return a.v;
  let f = (u - a.t) / (b.t - a.t || 1);
  if (env.ease === 'smooth') f = f * f * (3 - 2 * f);
  return lerp(a.v, b.v, f);
}

export function isAnimated(cue, key) {
  const env = cue.anim && cue.anim[key];
  return !!(env && env.keys && env.keys.length);
}

/** Value of `key` at u: the envelope if animated, else the static base value. */
export function valueAt(cue, key, u) {
  return isAnimated(cue, key) ? evalEnvelope(cue.anim[key], u) : cue.params[key];
}

/**
 * The cue's params with every animated parameter evaluated at u. Returns the
 * cue's own params object (no copy) when nothing is animated.
 */
export function resolveLaserParams(cue, u) {
  const anim = cue.anim;
  if (!anim) return cue.params;
  let out = null;
  for (const key in anim) {
    if (!isAnimated(cue, key)) continue;
    if (!out) out = { ...cue.params };
    out[key] = evalEnvelope(anim[key], u);
  }
  return out || cue.params;
}

/** Insert a key at u, or update the key already there. Returns the key object. */
export function setKey(cue, key, u, v) {
  if (!cue.anim) cue.anim = {};
  let env = cue.anim[key];
  if (!env) env = cue.anim[key] = { ease: 'linear', keys: [] };
  const t = Math.min(1, Math.max(0, u));
  let k = env.keys.find((x) => Math.abs(x.t - t) < KEY_EPS);
  if (k) {
    k.v = clone(v);
  } else {
    k = { t, v: clone(v) };
    env.keys.push(k);
    sortKeys(env);
  }
  return k;
}

/** Remove one key; removing the last key returns the param to static at its value. */
export function removeKey(cue, key, k) {
  const env = cue.anim && cue.anim[key];
  if (!env) return;
  const i = env.keys.indexOf(k);
  if (i >= 0) env.keys.splice(i, 1);
  if (!env.keys.length) {
    cue.params[key] = clone(k.v);
    delete cue.anim[key];
  }
}

/** Drop a param's envelope, freezing the param at its value at u. */
export function clearKeys(cue, key, u) {
  if (!isAnimated(cue, key)) return;
  cue.params[key] = clone(evalEnvelope(cue.anim[key], u));
  delete cue.anim[key];
}

export function sortKeys(env) {
  env.keys.sort((a, b) => a.t - b.t);
}

/**
 * Sanitised copy of a saved `cue.anim`: unknown params and malformed keys are
 * dropped, times clamped, keys sorted. Returns undefined when nothing is left.
 */
export function loadAnim(anim) {
  if (!anim || typeof anim !== 'object') return undefined;
  const out = {};
  for (const key in anim) {
    const spec = PARAM_BY_KEY[key];
    const env = anim[key];
    if (!spec || !env || !Array.isArray(env.keys)) continue;
    const okV = spec.kind === 'color'
      ? (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
      : Number.isFinite;
    const keys = env.keys
      .filter((k) => k && Number.isFinite(k.t) && okV(k.v))
      .map((k) => ({ t: Math.min(1, Math.max(0, k.t)), v: clone(k.v) }));
    if (!keys.length) continue;
    out[key] = { ease: EASES.some((e) => e.key === env.ease) ? env.ease : 'linear', keys };
    sortKeys(out[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Sorted, de-duplicated key times across every animated param (cue-block diamonds). */
export function keyTimes(cue) {
  if (!cue.anim) return [];
  const ts = [];
  for (const key in cue.anim) for (const k of cue.anim[key].keys) ts.push(k.t);
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => i === 0 || t - ts[i - 1] > KEY_EPS);
}
