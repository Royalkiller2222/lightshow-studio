// Laser pattern library — BEYOND-style vector frames. Each pattern is a list of
// "strokes" (polylines) in normalised galvo space (-1..1). The laser rig draws
// the strokes as bright additive lines and the beams that form them. Pure data.

function circle(n, r = 1) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}

function polygon(sides, r = 1, rot = 0) {
  const pts = [];
  for (let i = 0; i <= sides; i++) { const a = rot + (i / sides) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}

function wave(cycles, n, amp = 0.8) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const x = (i / n) * 2 - 1; pts.push([x, Math.sin(x * Math.PI * cycles) * amp]); }
  return pts;
}

function fan(count, half = 0.9) {
  const strokes = [];
  for (let i = 0; i < count; i++) {
    const a = -half + (count === 1 ? half : (i / (count - 1)) * 2 * half);
    strokes.push([[0, -1], [Math.sin(a), -1 + Math.cos(a) * 2]]);
  }
  return strokes;
}

export const PATTERNS = [
  { key: 'beam-fan', label: 'Beam fan', strokes: fan(9, 0.8) },
  { key: 'cone', label: 'Cone (circle)', strokes: [circle(64)] },
  { key: 'tunnel', label: 'Tunnel', strokes: [circle(48, 1), circle(48, 0.66), circle(48, 0.33)] },
  { key: 'wave', label: 'Wave', strokes: [wave(2, 96)] },
  { key: 'square', label: 'Square', strokes: [polygon(4, 1, Math.PI / 4)] },
  { key: 'triangle', label: 'Triangle', strokes: [polygon(3, 1, Math.PI / 2)] },
  {
    key: 'grid', label: 'Grid',
    strokes: [
      [[-1, -0.6], [1, -0.6]], [[-1, 0], [1, 0]], [[-1, 0.6], [1, 0.6]],
      [[-0.6, -1], [-0.6, 1]], [[0, -1], [0, 1]], [[0.6, -1], [0.6, 1]],
    ],
  },
  {
    key: 'lines', label: 'Scan lines',
    strokes: [[[-1, -0.5], [1, -0.5]], [[-1, 0], [1, 0]], [[-1, 0.5], [1, 0.5]]],
  },
  {
    key: 'dots', label: 'Dot field',
    strokes: (() => {
      const s = [];
      for (let y = -0.8; y <= 0.8; y += 0.4) for (let x = -0.8; x <= 0.8; x += 0.4) s.push([[x, y], [x + 0.02, y]]);
      return s;
    })(),
  },
  { key: 'spiral', label: 'Spiral', strokes: [(() => { const p = []; for (let i = 0; i <= 160; i++) { const t = i / 160; const a = t * Math.PI * 8; const r = t; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; })()] },
];

export const PATTERN_BY_KEY = Object.fromEntries(PATTERNS.map((p) => [p.key, p]));

/** Flatten strokes into [{a,b}] segment pairs, honouring visible-points (0..1). */
export function patternSegments(pattern, visible = 1) {
  const segs = [];
  for (const stroke of pattern.strokes) {
    for (let i = 0; i < stroke.length - 1; i++) segs.push([stroke[i], stroke[i + 1]]);
  }
  const keep = Math.max(1, Math.round(segs.length * Math.max(0, Math.min(1, visible))));
  return segs.slice(0, keep);
}
