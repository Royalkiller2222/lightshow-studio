// Shared strobe model for fixtures with a strobe channel. Pure functions of
// (channel value, time) so they're trivial to reason about and test: a low
// value means steady (no strobe), and higher values ramp the flash rate.

const OPEN = 8;      // <= this 8-bit value: no strobe, lamp steady
const MIN_HZ = 1;    // slowest strobe
const MAX_HZ = 20;   // fastest strobe

/** Flash rate in Hz for an 8-bit strobe channel value (0 = steady). */
export function strobeHz(value) {
  if (value <= OPEN) return 0;
  const t = (value - OPEN) / (255 - OPEN);
  return MIN_HZ + (MAX_HZ - MIN_HZ) * t;
}

/**
 * Brightness multiplier (0 or 1) for a 50%-duty strobe at time `t` seconds.
 * Returns 1 (lamp open) when the channel is below the strobe threshold.
 */
export function strobeGate(value, t) {
  const hz = strobeHz(value);
  if (hz <= 0) return 1;
  return (t * hz) % 1 < 0.5 ? 1 : 0;
}
