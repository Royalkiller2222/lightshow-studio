// Web Audio playback + waveform peaks. Decodes any browser-supported format
// (mp3/wav/ogg/m4a) via decodeAudioData - no FFmpeg, so the one-click install
// stays intact. An AudioBufferSourceNode can only play once, so we recreate it
// on every play and track position against the AudioContext clock.

export class AudioEngine {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.name = '';
    this._startCtxTime = 0; // ctx.currentTime when playback (re)started
    this._startOffset = 0;  // buffer offset at that moment

    // Spectrum tap for frequency-reactive effects (source -> analyser -> out).
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.7;
    this.analyser.connect(this.ctx.destination);
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** Normalised low/mid/high band levels (0..1) of the audio playing now. */
  bands() {
    if (!this.playing || !this.buffer) return { bass: 0, mid: 0, high: 0 };
    this.analyser.getByteFrequencyData(this._freq);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo, hi, gain) => {
      const i0 = Math.max(1, Math.floor(lo / binHz));
      const i1 = Math.min(this._freq.length - 1, Math.ceil(hi / binHz));
      let sum = 0;
      for (let i = i0; i <= i1; i++) sum += this._freq[i];
      const avg = i1 >= i0 ? sum / (i1 - i0 + 1) / 255 : 0;
      return Math.min(1, avg * gain); // highs are quieter -> more gain
    };
    return { bass: band(20, 150, 1.5), mid: band(150, 2000, 2.2), high: band(2000, 9000, 3.0) };
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  get currentTime() {
    if (!this.buffer) return 0;
    if (this.playing) {
      return Math.min(this._startOffset + (this.ctx.currentTime - this._startCtxTime), this.duration);
    }
    return this._startOffset;
  }

  async load(file) {
    const arr = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
    this.name = file.name;
    this._startOffset = 0;
    this.playing = false;
  }

  /** Load a pre-built AudioBuffer (used by synthesized test tracks). */
  setBuffer(buffer, name = 'synth') {
    this.buffer = buffer;
    this.name = name;
    this._startOffset = 0;
    this.playing = false;
  }

  play() {
    if (!this.buffer || this.playing) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.analyser); // analyser -> destination (set up in ctor)
    this._startCtxTime = this.ctx.currentTime;
    this.source.start(0, Math.min(this._startOffset, this.duration));
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this._startOffset = this.currentTime;
    this._stopSource();
    this.playing = false;
  }

  stop() {
    this._stopSource();
    this.playing = false;
    this._startOffset = 0;
  }

  seek(t) {
    const wasPlaying = this.playing;
    this._stopSource();
    this.playing = false;
    this._startOffset = Math.max(0, Math.min(t, this.duration || 0));
    if (wasPlaying) this.play();
  }

  _stopSource() {
    if (!this.source) return;
    try { this.source.onended = null; this.source.stop(); } catch (_) {}
    this.source.disconnect();
    this.source = null;
  }

  /** min/max peak pairs (length count*2) for waveform drawing. */
  peaks(count) {
    if (!this.buffer || count <= 0) return null;
    const ch = this.buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(ch.length / count));
    const out = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      let min = 1, max = -1;
      const start = i * block;
      const end = Math.min(start + block, ch.length);
      for (let j = start; j < end; j++) {
        const v = ch[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[i * 2] = min;
      out[i * 2 + 1] = max;
    }
    return out;
  }
}
