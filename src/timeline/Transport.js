// The master show clock. When an audio track is loaded it follows the audio
// engine's position; otherwise it free-runs so the demo still animates with no
// track loaded. Everything time-based (the show engine, the beat grid, video)
// reads `time` / `beat` from here.

export class Transport {
  constructor(audio = null) {
    this.audio = audio;
    this.bpm = 126;
    this.beatOffset = 0; // seconds to the first downbeat (from BPM detection)
    this.playing = true; // free-run on launch so the demo is alive immediately
    this._freeTime = 0;
    this.loopEnd = 0;    // with no track, free-run wraps here (the show's end) so it never runs dark
    this.listeners = new Set();
  }

  get hasAudio() { return !!(this.audio && this.audio.buffer); }
  get duration() { return this.hasAudio ? this.audio.duration : 0; }
  get time() { return this.hasAudio ? this.audio.currentTime : this._freeTime; }
  get beat() { return ((this.time - this.beatOffset) * this.bpm) / 60; }

  update(dt) {
    if (this.playing && !this.hasAudio) {
      this._freeTime += dt;
      if (this.loopEnd > 0 && this._freeTime >= this.loopEnd) { this._freeTime = 0; this._emit(); }
    }
    // Stop at the natural end of an audio track.
    if (this.playing && this.hasAudio && this.audio.currentTime >= this.audio.duration - 1e-3) {
      this.pause();
    }
  }

  play() {
    this.playing = true;
    if (this.hasAudio) this.audio.play();
    this._emit();
  }

  pause() {
    this.playing = false;
    if (this.hasAudio) this.audio.pause();
    this._emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  stop() {
    this.playing = false;
    if (this.hasAudio) this.audio.stop(); else this._freeTime = 0;
    this._emit();
  }

  seek(t) {
    const clamped = this.hasAudio ? Math.max(0, Math.min(t, this.duration)) : Math.max(0, t);
    if (this.hasAudio) this.audio.seek(clamped); else this._freeTime = clamped;
    this._emit();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const f of this.listeners) f(this); }
}
