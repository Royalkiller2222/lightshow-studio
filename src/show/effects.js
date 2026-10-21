// Per-attribute effect generators. Each effect targets ONE attribute domain —
// Intensity, Colour, or Position — and writes to the sink via c.out. The engine
// merges across cues automatically: intensity is HTP (brightest wins), colour
// and position are LTP (top lane wins). Build a "look" by stacking an intensity
// + colour + position cue.
//
// Effects are waveform-driven: rate (beat-synced or Hz), size (amount), base
// (floor), phase, group fanning, direction, and duty are shared params; each
// effect lists the `controls` it actually uses so the inspector shows only
// those.

import { wave, fanPhase } from './waveforms.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hsv2rgb(h) {
  const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

// ---- profile-aware DMX writers (used by the engine's flush) ----
export function writeAttr(fix, name, v01) {
  if (!fix.profile) return;
  const off = fix.profile.offsetOf(name);
  if (off < 0) return;
  const ch = fix.profile.channels.find((c) => c.name === name);
  const addr = fix.startAddress + off;
  if (ch && ch.bits === 16) fix.hub.setChannel16(fix.universe, addr, Math.round(clamp01(v01) * 65535));
  else fix.hub.setChannel(fix.universe, addr, Math.round(clamp01(v01) * 255));
}

export function writeRGB(fix, r, g, b) {
  writeAttr(fix, 'Red', r); writeAttr(fix, 'Green', g); writeAttr(fix, 'Blue', b);
  for (let i = 1; fix.profile && fix.profile.offsetOf(`R${i}`) >= 0; i++) {
    writeAttr(fix, `R${i}`, r); writeAttr(fix, `G${i}`, g); writeAttr(fix, `B${i}`, b);
  }
}

// Phase (in cycles) for this fixture at this moment: rate (beat-synced or Hz),
// global phase, group fan, and direction.
function phaseOf(c) {
  const p = c.p;
  const rateHz = p.sync ? (c.bpm / 60) / (p.division || 1) : (p.rate || 1);
  return c.t * rateHz * (p.dir || 1) + (p.phase || 0) + fanPhase(c.i, c.n, p.spread || 0, p.fan || 'tail');
}

// ---- effect registry ----
export const EFFECTS = [
  // Intensity
  {
    key: 'i-flat', label: 'Intensity · Flat', attr: 'intensity',
    controls: ['size'], defaults: { size: 1 },
    apply(_f, c) { c.out.dimmer(c.p.size); },
  },
  {
    key: 'i-wave', label: 'Intensity · Wave', attr: 'intensity',
    controls: ['shape', 'sync', 'division', 'rate', 'size', 'base', 'spread', 'fan', 'dir', 'duty'],
    defaults: { shape: 'rampdown', base: 0, size: 1 },
    apply(_f, c) { c.out.dimmer(clamp01(c.p.base + c.p.size * wave(c.p.shape, phaseOf(c), c.p.duty))); },
  },
  {
    key: 'i-audio', label: 'Intensity · Audio band', attr: 'intensity',
    controls: ['band', 'size', 'base'], defaults: { band: 'bass', base: 0.04, size: 1 },
    apply(_f, c) { const lvl = c.bands ? (c.bands[c.p.band] || 0) : 0; c.out.dimmer(clamp01(c.p.base + c.p.size * lvl)); },
  },
  {
    key: 'i-chase', label: 'Intensity · Chase', attr: 'intensity',
    controls: ['sync', 'division', 'rate', 'size', 'base', 'dir'],
    defaults: { base: 0.05, size: 1, division: 1 },
    apply(_f, c) {
      const rateHz = c.p.sync ? (c.bpm / 60) / (c.p.division || 1) : (c.p.rate || 1);
      const step = Math.floor(c.t * rateHz * (c.p.dir || 1));
      const active = ((step % c.n) + c.n) % c.n;
      c.out.dimmer(c.i === active ? c.p.size : c.p.base);
    },
  },
  // Colour
  {
    key: 'c-static', label: 'Colour · Static', attr: 'color',
    controls: ['color'], defaults: { color: [1, 1, 1] },
    apply(_f, c) { c.out.rgb(c.p.color[0], c.p.color[1], c.p.color[2]); },
  },
  {
    key: 'c-rainbow', label: 'Colour · Rainbow', attr: 'color',
    controls: ['sync', 'division', 'rate', 'spread', 'fan', 'dir'],
    defaults: { division: 4, spread: 1 },
    apply(_f, c) { const [r, g, b] = hsv2rgb((phaseOf(c) % 1 + 1) % 1); c.out.rgb(r, g, b); },
  },
  {
    key: 'c-two', label: 'Colour · Two-colour', attr: 'color',
    controls: ['color', 'color2', 'shape', 'sync', 'division', 'rate', 'spread', 'fan', 'dir', 'duty'],
    defaults: { color: [1, 0, 0], color2: [0, 0.3, 1], division: 4 },
    apply(_f, c) {
      const w = wave(c.p.shape, phaseOf(c), c.p.duty);
      const a = c.p.color, b = c.p.color2;
      c.out.rgb(a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w);
    },
  },
  // Position
  {
    key: 'p-static', label: 'Position · Static', attr: 'position',
    controls: ['pan', 'tilt'], defaults: { pan: 0.5, tilt: 0.6 },
    apply(_f, c) { c.out.panTilt(c.p.pan, c.p.tilt); },
  },
  {
    key: 'p-circle', label: 'Position · Circle', attr: 'position',
    controls: ['sync', 'division', 'rate', 'size', 'spread', 'fan', 'dir'],
    defaults: { size: 0.7, division: 4, spread: 1 },
    apply(_f, c) {
      const ph = phaseOf(c) * Math.PI * 2;
      c.out.panTilt(0.5 + c.p.size * 0.5 * Math.cos(ph), 0.55 + c.p.size * 0.35 * Math.sin(ph));
    },
  },
  {
    key: 'p-wave', label: 'Position · Wave', attr: 'position',
    controls: ['shape', 'sync', 'division', 'rate', 'size', 'spread', 'fan', 'dir', 'tilt'],
    defaults: { shape: 'sine', size: 0.6, division: 4 },
    apply(_f, c) {
      const bi = (wave(c.p.shape, phaseOf(c), c.p.duty) - 0.5) * 2;
      c.out.panTilt(0.5 + c.p.size * 0.5 * bi, c.p.tilt);
    },
  },
  // Sparks (trigger attribute)
  {
    key: 'sparks', label: 'Cold sparks', attr: 'intensity',
    controls: ['size'], defaults: { size: 0.8 },
    apply(_f, c) { c.out.trigger(true); c.out.height(c.p.size); },
  },
];

export const EFFECT_BY_KEY = Object.fromEntries(EFFECTS.map((e) => [e.key, e]));

export function defaultParams() {
  return {
    shape: 'sine', rate: 1, sync: true, division: 1, size: 1, base: 0, phase: 0,
    spread: 0, fan: 'tail', dir: 1, duty: 0.5, band: 'bass',
    color: [0.2, 0.6, 1], color2: [1, 0.2, 0.5], pan: 0.5, tilt: 0.6,
  };
}

/** Fresh params for an effect: base defaults overlaid with the effect's, arrays cloned. */
export function paramsFor(key) {
  const eff = EFFECT_BY_KEY[key];
  const p = { ...defaultParams(), ...(eff ? eff.defaults : {}) };
  p.color = [...p.color];
  p.color2 = [...p.color2];
  return p;
}
