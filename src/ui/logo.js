// The Lightshow Studio mark: a fan of coloured beams fired from a bright
// diamond emitter (the ◆ keyframe) on a graphite tile. One generator feeds the
// top bar, the window icon and the installer icons (scripts/make-icons.js), so
// the brand is identical everywhere. `small` is a bolder 3-beam cut for 16–32 px,
// where five thin beams would smear together.

const FULL = [
  { a: -50, c: '#ff4fa3' },
  { a: -25, c: '#a06bff' },
  { a: 0, c: '#4d8dff' },
  { a: 25, c: '#2fd6f0' },
  { a: 50, c: '#3ee09a' },
];
const SMALL = [
  { a: -36, c: '#ff4fa3' },
  { a: 0, c: '#4d8dff' },
  { a: 36, c: '#2fd6f0' },
];

const f = (n) => +n.toFixed(2);

/** SVG markup for the mark (viewBox 0 0 64 64). `id` keeps gradient ids unique per page. */
export function logoSvg({ small = false, id = 'lsm', size = null, cls = '' } = {}) {
  const cx = 32;
  const cy = small ? 46 : 47;
  const len = 56;
  const half = small ? 8.5 : 5.4;
  const beams = small ? SMALL : FULL;

  let defs = `
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#202734"/><stop offset="1" stop-color="#0b0d12"/>
    </linearGradient>
    <radialGradient id="${id}-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="0.35" stop-color="#cfe2ff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="${id}-clip"><rect x="2" y="2" width="60" height="60" rx="${small ? 12 : 14.5}"/></clipPath>`;
  let rays = '';
  beams.forEach((b, i) => {
    const t = (b.a * Math.PI) / 180;
    const tx = cx + len * Math.sin(t);
    const ty = cy - len * Math.cos(t);
    const nx = Math.cos(t) * half;
    const ny = Math.sin(t) * half;
    defs += `<linearGradient id="${id}-b${i}" gradientUnits="userSpaceOnUse" x1="${cx}" y1="${cy}" x2="${f(tx)}" y2="${f(ty)}">
      <stop offset="0" stop-color="${b.c}" stop-opacity="1"/>
      <stop offset="1" stop-color="${b.c}" stop-opacity="${small ? 0.5 : 0.1}"/>
    </linearGradient>`;
    rays += `<polygon points="${cx},${cy} ${f(tx - nx)},${f(ty - ny)} ${f(tx + nx)},${f(ty + ny)}" fill="url(#${id}-b${i})" style="mix-blend-mode:screen"/>`;
  });

  const r = small ? 6.2 : 5;
  const diamond = `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
  const dims = size ? ` width="${size}" height="${size}"` : '';

  return `<svg class="${cls}" viewBox="0 0 64 64"${dims} xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>${defs}</defs>
  <rect x="2" y="2" width="60" height="60" rx="${small ? 12 : 14.5}" fill="url(#${id}-bg)"/>
  <g clip-path="url(#${id}-clip)" style="isolation:isolate">${rays}</g>
  <circle cx="${cx}" cy="${cy}" r="${small ? 12 : 11}" fill="url(#${id}-glow)"/>
  <path d="${diamond}" fill="#ffffff"/>
  <rect x="2.5" y="2.5" width="59" height="59" rx="${small ? 11.5 : 14}" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
</svg>`;
}
