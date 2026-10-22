// Beat-grid snapping shared by the timeline (clips, markers, curve keys) and
// the cue inspector (keys set while playing). The grid is aligned to the
// detected downbeat (transport.beatOffset). Pure functions.

/** Snap an absolute time to the grid; `division` = beats per step (1 = beat, 0.5 = half-beat). */
export function snapTime(transport, t, division = 1) {
  const step = (60 / (transport.bpm || 120)) * division;
  const off = transport.beatOffset || 0;
  return off + Math.round((t - off) / step) * step;
}

/**
 * Snap a cue-local key time u (0..1) to the half-beat grid or the cue's ends,
 * whichever is closer; `free` (Shift) skips snapping.
 */
export function snapKeyU(transport, cue, u, free = false) {
  u = Math.min(1, Math.max(0, u));
  if (free) return u;
  const abs = cue.start + u * cue.duration;
  const gridU = (snapTime(transport, abs, 0.5) - cue.start) / cue.duration;
  let best = u, bestD = Infinity;
  for (const cand of [gridU, 0, 1]) {
    if (cand < 0 || cand > 1) continue;
    const d = Math.abs(cand - u);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
}
