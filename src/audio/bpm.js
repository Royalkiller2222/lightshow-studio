// Lightweight tempo + downbeat estimation from a decoded AudioBuffer. Builds a
// rectified energy-onset envelope, autocorrelates it across a musical tempo
// range to find BPM, then finds the beat phase (offset, in seconds) that best
// lines up with the onsets. Good enough to seed the grid; the user fine-tunes.
//
// Works on anything shaped like an AudioBuffer: { sampleRate, getChannelData() }.

export function analyzeTempo(buffer, { min = 70, max = 180 } = {}) {
  const { env, fps } = onsetEnvelope(buffer);
  if (env.length < fps * 2) return { bpm: 120, offset: 0 }; // too short to judge
  const bpm = detectBpm(env, fps, min, max);
  const offset = detectOffset(env, fps, bpm);
  return { bpm: Math.round(bpm * 10) / 10, offset };
}

function onsetEnvelope(buffer) {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const hop = Math.max(1, Math.floor(sr * 0.005)); // ~5 ms frames -> ~200 fps
  const frames = Math.floor(ch.length / hop);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let j = 0; j < hop; j++) { const s = ch[start + j]; sum += s * s; }
    const e = Math.sqrt(sum / hop);
    env[f] = e > prev ? e - prev : 0; // rectified energy increase = onset
    prev = e;
  }
  return { env, fps: sr / hop };
}

function detectBpm(env, fps, min, max) {
  const lagMin = Math.max(1, Math.floor((60 / max) * fps));
  const lagMax = Math.min(env.length - 2, Math.ceil((60 / min) * fps));
  const corr = new Float32Array(lagMax + 2);
  let bestLag = lagMin, bestScore = -1;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let c = 0;
    const n = env.length - lag;
    for (let i = 0; i < n; i++) c += env[i] * env[i + lag];
    c /= n;
    corr[lag] = c;
    if (c > bestScore) { bestScore = c; bestLag = lag; }
  }
  // Parabolic interpolation around the peak for sub-frame (sub-BPM) precision.
  let lag = bestLag;
  if (bestLag > lagMin && bestLag < lagMax) {
    const a = corr[bestLag - 1], b = corr[bestLag], c = corr[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const delta = (0.5 * (a - c)) / denom;
      if (Math.abs(delta) < 1) lag = bestLag + delta;
    }
  }
  return 60 / (lag / fps);
}

function detectOffset(env, fps, bpm) {
  const period = (60 / bpm) * fps; // frames per beat
  const beats = Math.floor(env.length / period);
  if (beats < 2) return 0;
  let bestOff = 0, bestScore = -1;
  const steps = 32;
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * period;
    let sum = 0;
    for (let b = 0; b < beats; b++) {
      const idx = Math.round(phase + b * period);
      if (idx < env.length) sum += env[idx];
    }
    if (sum > bestScore) { bestScore = sum; bestOff = phase / fps; }
  }
  return bestOff;
}
