// Waveform generators for the effect engine. `wave` returns 0..1 for a given
// phase (cycles); `fanPhase` spreads phase across a group so chases/fans read.
// Pure and unit-testable.

export const SHAPES = [
  { key: 'sine', label: 'Sine' },
  { key: 'triangle', label: 'Triangle' },
  { key: 'ramp', label: 'Ramp up' },
  { key: 'rampdown', label: 'Ramp down' },
  { key: 'square', label: 'Square / PWM' },
  { key: 'random', label: 'Random' },
];

// Beat-division choices: cycle length in beats (4 = one bar at 4/4).
export const DIVISIONS = [
  { key: 4, label: '1 bar' },
  { key: 2, label: '1/2' },
  { key: 1, label: '1 beat' },
  { key: 0.5, label: '1/8' },
  { key: 0.25, label: '1/16' },
];

export const FANS = [
  { key: 'tail', label: 'Tail' },
  { key: 'symmetric', label: 'Symmetric' },
];

const frac = (x) => x - Math.floor(x);

export function wave(shape, phase, duty = 0.5) {
  const p = frac(phase); // 0..1
  switch (shape) {
    case 'sine': return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
    case 'triangle': return p < 0.5 ? p * 2 : 2 - p * 2;
    case 'ramp': return p;
    case 'rampdown': return 1 - p;
    case 'square': return p < duty ? 1 : 0;
    case 'random': return frac(Math.sin(Math.floor(phase) * 12.9898) * 43758.5453);
    default: return 0;
  }
}

/** Phase offset for fixture i of n, given a total spread (in cycles). */
export function fanPhase(i, n, spread, mode = 'tail') {
  if (n <= 1 || !spread) return 0;
  const f = i / (n - 1); // 0..1 across the group
  if (mode === 'symmetric') return Math.abs(f - 0.5) * 2 * spread;
  return f * spread;
}
