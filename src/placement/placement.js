// Pure geometry helpers for fixture placement: grid snapping and left/right
// mirroring across the venue centre (x = 0, the room is centred on the
// origin). Plain {x, y, z} in and out, so they unit-test without a WebGL
// context and stay shared between drag-in placement and live repositioning.

export function snapToGrid(v, grid) {
  if (!grid || grid <= 0) return v;
  return Math.round(v / grid) * grid;
}

/** Snap x and z to the grid; y (mount height) passes through untouched. */
export function snapPoint(p, grid) {
  return { x: snapToGrid(p.x, grid), y: p.y, z: snapToGrid(p.z, grid) };
}

/** Reflect a point across the venue centre line (x = 0). */
export function mirrorX(p) {
  return { x: -p.x, y: p.y, z: p.z };
}

/**
 * Snapped placement points for a drop. With mirror on and an off-centre point
 * it returns the point and its x-mirror; a point on the centre line (within
 * epsilon) would mirror onto itself, so a single point is returned instead.
 */
export function placementPoints(p, { mirror = true, grid = 0.5, epsilon = 1e-3 } = {}) {
  const s = snapPoint(p, grid);
  if (!mirror || Math.abs(s.x) <= epsilon) return [s];
  return [s, mirrorX(s)];
}
