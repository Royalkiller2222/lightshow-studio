// Looks: a fixture cue is one complete look made of up to three layers —
// Intensity, Colour and Movement — each running one effect from effects.js.
// Layers in a look touch different attributes, so they never fight; across
// tracks the engine still merges intensity HTP and colour/movement LTP.
//
// LOOKS are the ready-made presets in the library. Pure data + helpers.

import { EFFECT_BY_KEY, paramsFor } from './effects.js';

/** Layer slots in display order, and which effect attribute fills each. */
export const SLOTS = [
  { key: 'intensity', label: 'Intensity' },
  { key: 'color', label: 'Colour' },
  { key: 'position', label: 'Movement' },
];

/** The slot an effect belongs in (cold sparks drive intensity-like triggers). */
export function slotOf(effectKey) {
  return EFFECT_BY_KEY[effectKey]?.attr || 'intensity';
}

/** A layer: an effect + its own params (fresh copies, safe to mutate). */
export function makeLayer(effectKey, overrides = {}) {
  const params = { ...paramsFor(effectKey), ...overrides };
  for (const k of ['color', 'color2']) if (Array.isArray(params[k])) params[k] = [...params[k]];
  return { effectKey, params };
}

/** Keep one layer per slot, in slot order (later layers replace earlier ones). */
export function normalizeLayers(layers) {
  const bySlot = {};
  for (const l of layers || []) if (l && EFFECT_BY_KEY[l.effectKey]) bySlot[slotOf(l.effectKey)] = l;
  return SLOTS.map((s) => bySlot[s.key]).filter(Boolean);
}

/** Put `layer` into its slot (replacing what was there). */
export function setLayer(cue, layer) {
  cue.layers = normalizeLayers([...(cue.layers || []).filter((l) => slotOf(l.effectKey) !== slotOf(layer.effectKey)), layer]);
}

export function removeSlot(cue, slot) {
  cue.layers = (cue.layers || []).filter((l) => slotOf(l.effectKey) !== slot);
}

const W = [1, 1, 1];
export const LOOKS = [
  {
    key: 'rainbow-wave', name: 'Rainbow wave', hint: 'Full brightness, rainbow fan, slow pan wave',
    layers: [['i-flat'], ['c-rainbow', { division: 4, spread: 1 }], ['p-wave', { size: 0.6, division: 4, spread: 0.5, tilt: 0.72 }]],
  },
  {
    key: 'bass-hits', name: 'Bass hits', hint: 'Flashes on the kick, deep red',
    layers: [['i-audio', { band: 'bass', base: 0.02 }], ['c-static', { color: [1, 0.08, 0.15] }], ['p-static', { pan: 0.5, tilt: 0.55 }]],
  },
  {
    key: 'circle-chase', name: 'Circle chase', hint: 'One-by-one chase, two colours, circling',
    layers: [['i-chase', { division: 1, base: 0.08 }], ['c-two', { color: [0, 0.6, 1], color2: [1, 0, 0.8] }], ['p-circle', { size: 0.6, division: 4, spread: 1 }]],
  },
  {
    key: 'pulse-sweep', name: 'Pulse sweep', hint: 'Beat pulse fanned across the rig, cyan sweep',
    layers: [['i-wave', { shape: 'rampdown', division: 1, spread: 1 }], ['c-static', { color: [0.1, 0.9, 1] }], ['p-wave', { size: 0.8, division: 2, spread: 1, tilt: 0.6 }]],
  },
  {
    key: 'warm-wash', name: 'Warm wash', hint: 'Steady amber, pointed down',
    layers: [['i-flat', { size: 0.85 }], ['c-static', { color: [1, 0.55, 0.15] }], ['p-static', { pan: 0.5, tilt: 0.75 }]],
  },
  {
    key: 'strobe-white', name: 'White strobe', hint: 'Fast white flashes',
    layers: [['i-wave', { shape: 'square', division: 0.25, duty: 0.2 }], ['c-static', { color: W }]],
  },
  {
    key: 'spark-burst', name: 'Spark burst', hint: 'Fires the cold-spark machines',
    layers: [['sparks', { size: 0.8 }]], group: 'sparks',
  },
];

export const LOOK_BY_KEY = Object.fromEntries(LOOKS.map((l) => [l.key, l]));

/** Fresh layers for a preset. */
export function lookLayers(key) {
  const look = LOOK_BY_KEY[key];
  return look ? normalizeLayers(look.layers.map(([e, o]) => makeLayer(e, o))) : [];
}
