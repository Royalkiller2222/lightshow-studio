// The Program workspace's timeline: the song (load audio, waveform, beat grid)
// and the cue lanes. Cues are clips you place in time — drag one from the
// library (or use the + buttons), drag it to move or change lane, drag its
// right edge to resize, click it to edit it in the inspector. Transport
// controls live in the top bar; cue editing lives in CueInspector.

import { EFFECTS } from '../show/effects.js';
import { GROUPS } from '../show/ShowEngine.js';
import { PATTERNS } from '../laser/patterns.js';
import { keyTimes } from '../laser/envelopes.js';
import { icon } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { effectShortName } from './CueInspector.js';

export const DND_TYPE = 'application/x-lightshow'; // library -> timeline drag payload

const NOAUDIO_WINDOW = 30; // seconds of editable canvas when no track is loaded
const LANES = 5;           // stacked cue lanes; lane 0 (top) wins the LTP merge
const LANE_H = 24;         // px per lane row
const DEFAULT_LEN = 4;     // seconds for a newly added cue

export class TimelinePanel {
  /**
   * @param {object} opts
   *   onLoadAudio(file), onEdit() (undo checkpoint), onSelect(cue|null),
   *   onCueMoved(cue) (dragged/resized — refresh the inspector's length)
   */
  constructor(transport, audio, engine, root, { onLoadAudio, onEdit, onSelect, onCueMoved } = {}) {
    this.transport = transport;
    this.audio = audio;
    this.engine = engine;
    this.root = root;
    this.onLoadAudio = onLoadAudio;
    this.onEdit = onEdit;
    this.onSelect = onSelect;
    this.onCueMoved = onCueMoved;
    this.selected = null;
    this._peaks = null;
    this._peakW = 0;

    root.innerHTML = `
      <div class="tl-toolbar">
        <button type="button" class="btn sm" data-act="load-audio" title="Load a song (mp3, wav, ogg, m4a) — its tempo is detected automatically">${icon('music', 'sm')}Load song</button>
        <span class="tl-track"><span class="nm none" data-role="audio-name">No song loaded — the clock runs free</span></span>
        <span class="tl-spacer"></span>
        <span class="tl-hint" data-role="hint">Drag patterns and effects here from the library</span>
        <button type="button" class="btn sm" data-act="add-laser" title="Add a laser cue at the playhead">${icon('plus', 'sm')}Laser cue</button>
        <button type="button" class="btn sm" data-act="add-cue" title="Add a fixture cue at the playhead">${icon('plus', 'sm')}Fixture cue</button>
        <input type="file" accept="audio/*" data-role="audio-file" hidden />
      </div>
      <div class="tl-wave-wrap"><canvas class="tl-wave" data-role="wave" title="Click to move the playhead"></canvas></div>
      <div class="tl-cuelane" data-role="cuelane"><div class="tl-playhead" data-role="ph"></div></div>`;

    this.$ = (s) => root.querySelector(s);
    this.canvas = this.$('[data-role="wave"]');
    this.cctx = this.canvas.getContext('2d');
    this.lane = this.$('[data-role="cuelane"]');
    this.ph = this.$('[data-role="ph"]');

    this._wire();
    this.renderCues();
  }

  _window() {
    if (this.transport.hasAudio && this.transport.duration > 0) return this.transport.duration;
    // No track: size the window to the longest cue (+pad) so every cue's right
    // edge — and its resize grip — stays on screen and reachable.
    let end = 0;
    for (const c of this.engine.cues) end = Math.max(end, c.start + c.duration);
    return Math.max(NOAUDIO_WINDOW, end + 4);
  }

  /** Show length the top bar displays (song length, or the editable window). */
  get length() { return this._window(); }

  /** Open the file picker for a song (also used by the inspector and commands). */
  pickAudio() { this.$('[data-role="audio-file"]').click(); }

  _wire() {
    const audioFile = this.$('[data-role="audio-file"]');
    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'load-audio') audioFile.click();
      else if (act === 'add-cue') this.addFixtureCueAt('i-flat');
      else if (act === 'add-laser') this.addLaserCueAt('beam-fan');
    });
    audioFile.addEventListener('change', () => {
      if (audioFile.files[0]) this.onLoadAudio?.(audioFile.files[0]);
      audioFile.value = '';
    });

    // Waveform click-to-seek.
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.transport.seek(f * this._window());
    });

    // Cue lane: select / move / resize blocks.
    this.lane.addEventListener('pointerdown', (e) => this._onLanePointerDown(e));

    // Drop patterns/effects from the library.
    this.lane.addEventListener('dragover', (e) => this._onDragOver(e));
    this.lane.addEventListener('dragleave', (e) => { if (!this.lane.contains(e.relatedTarget)) this._clearGhost(); });
    this.lane.addEventListener('drop', (e) => this._onDrop(e));
  }

  // ------------------------------------------------------------ adding cues
  /** Lowest lane with room for [start, start+dur), else the top lane. */
  _freeLane(start, dur) {
    for (let l = 0; l < LANES; l++) {
      const clash = this.engine.cues.some((c) => c.lane === l && c.start < start + dur && start < c.start + c.duration);
      if (!clash) return l;
    }
    return 0;
  }

  _placement(time, lane) {
    const win = this._window();
    const start = Math.max(0, Math.min(time ?? this.transport.time, Math.max(0, win - DEFAULT_LEN)));
    const duration = Math.min(DEFAULT_LEN, win);
    return { start, duration, lane: lane ?? this._freeLane(start, duration) };
  }

  addLaserCueAt(pattern, time, lane) {
    const cue = this.engine.addLaserCue({ pattern, ...this._placement(time, lane) });
    this._added(cue);
    return cue;
  }

  addFixtureCueAt(effectKey, time, lane) {
    const groupId = effectKey === 'sparks' ? 'sparks' : 'movers';
    const cue = this.engine.addCue({ effectKey, groupId, ...this._placement(time, lane) });
    this._added(cue);
    return cue;
  }

  _added(cue) {
    this.renderCues();
    this.selectCue(cue);
    this.onEdit?.();
  }

  deleteCue(cue) {
    if (!cue) return;
    this.engine.removeCue(cue.id);
    if (this.selected === cue) this.selectCue(null);
    this.renderCues();
    this.onEdit?.();
  }

  // ------------------------------------------------------------ drag & drop
  _dropPoint(e) {
    const r = this.lane.getBoundingClientRect();
    const win = this._window();
    const t = this._snapTime(((e.clientX - r.left) / r.width) * win);
    const lane = Math.max(0, Math.min(LANES - 1, Math.floor((e.clientY - r.top) / LANE_H)));
    return { time: Math.max(0, Math.min(t, Math.max(0, win - DEFAULT_LEN))), lane, win };
  }

  _onDragOver(e) {
    if (!e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const { time, lane, win } = this._dropPoint(e);
    if (!this._ghost) {
      this._ghost = document.createElement('div');
      this._ghost.className = 'tl-drop-ghost';
      this.lane.appendChild(this._ghost);
      this.lane.classList.add('drop-ok');
    }
    this._ghost.style.left = `${(time / win) * 100}%`;
    this._ghost.style.width = `${(Math.min(DEFAULT_LEN, win) / win) * 100}%`;
    this._ghost.style.top = `${lane * LANE_H + 2}px`;
  }

  _clearGhost() {
    this._ghost?.remove();
    this._ghost = null;
    this.lane.classList.remove('drop-ok');
  }

  _onDrop(e) {
    if (!e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    const { time, lane } = this._dropPoint(e);
    this._clearGhost();
    let item;
    try { item = JSON.parse(e.dataTransfer.getData(DND_TYPE)); } catch { return; }
    if (item.kind === 'pattern') this.addLaserCueAt(item.key, time, lane);
    else if (item.kind === 'effect') this.addFixtureCueAt(item.key, time, lane);
  }

  // -------------------------------------------------------------- selection
  selectCue(cue) {
    this.selected = cue;
    for (const el of this.lane.querySelectorAll('.tl-cue')) {
      el.classList.toggle('sel', Number(el.dataset.id) === cue?.id);
    }
    this.onSelect?.(cue);
  }

  renderCues() {
    const win = this._window();
    for (const el of this.lane.querySelectorAll('.tl-cue')) el.remove();
    for (const cue of this.engine.cues) {
      const el = document.createElement('div');
      const isLaser = cue.kind === 'laser';
      el.className = 'tl-cue' + (isLaser ? ' tl-cue-laser' : '') + (this.selected && this.selected.id === cue.id ? ' sel' : '');
      el.dataset.id = cue.id;
      el.style.left = (cue.start / win) * 100 + '%';
      el.style.width = Math.max(1.2, (cue.duration / win) * 100) + '%';
      el.style.top = (cue.lane * LANE_H + 2) + 'px';
      el.style.height = (LANE_H - 4) + 'px';
      let label, keys = '';
      if (isLaser) {
        const pat = PATTERNS.find((x) => x.key === cue.pattern);
        label = pat ? pat.label : cue.pattern;
        keys = keyTimes(cue).map((t) => `<span class="tl-kf" style="left:${t * 100}%"></span>`).join('');
      } else {
        const eff = EFFECTS.find((x) => x.key === cue.effectKey);
        const grp = GROUPS.find((g) => g.id === cue.groupId);
        label = `${effectShortName(eff)} · ${grp ? grp.label : cue.groupId}`;
      }
      el.title = label;
      el.innerHTML = `<span class="tl-cue-label">${esc(label)}</span>${keys}<span class="tl-cue-grip" title="Drag to change the length"></span>`;
      this.lane.appendChild(el);
    }
    const hint = this.$('[data-role="hint"]');
    hint.hidden = this.engine.cues.length > 0;
  }

  _onLanePointerDown(e) {
    const block = e.target.closest('.tl-cue');
    if (!block) { this.selectCue(null); return; }
    const cue = this.engine.cues.find((c) => c.id === Number(block.dataset.id));
    if (!cue) return;
    this.selectCue(cue);

    const laneW = this.lane.clientWidth;
    const laneRect = this.lane.getBoundingClientRect();
    const win = this._window();
    const perPx = win / laneW;
    const resize = e.target.classList.contains('tl-cue-grip');
    const startX = e.clientX;
    const origStart = cue.start, origDur = cue.duration;
    const beat = 60 / (this.transport.bpm || 120);
    let moved = false;

    const move = (ev) => {
      moved = true;
      const dt = (ev.clientX - startX) * perPx;
      if (resize) {
        cue.duration = Math.max(0.25, Math.min(win - cue.start, snap(origDur + dt, beat)));
      } else {
        cue.start = Math.max(0, Math.min(win - cue.duration, this._snapTime(origStart + dt)));
        // Vertical drag moves the cue between lanes.
        cue.lane = Math.max(0, Math.min(LANES - 1, Math.floor((ev.clientY - laneRect.top) / LANE_H)));
        block.style.top = (cue.lane * LANE_H + 2) + 'px';
      }
      block.style.left = (cue.start / win) * 100 + '%';
      block.style.width = Math.max(1.2, (cue.duration / win) * 100) + '%';
      this.onCueMoved?.(cue);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) this.onEdit?.(); // moved/resized -> record for undo
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onAudioLoaded() {
    this._peaks = null;
    const nm = this.$('[data-role="audio-name"]');
    nm.textContent = this.audio.name || 'Song';
    nm.classList.remove('none');
    nm.title = this.audio.name || '';
    this.renderCues(); // window changed -> reposition blocks
  }

  /** Snap a time to the beat grid (aligned to the detected downbeat). */
  _snapTime(t) {
    const beatSec = 60 / (this.transport.bpm || 120);
    const off = this.transport.beatOffset || 0;
    return off + Math.round((t - off) / beatSec) * beatSec;
  }

  // ------------------------------------------------------------------ frame
  frame() {
    const c = this.canvas;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
      c.width = Math.floor(cssW * dpr); c.height = Math.floor(cssH * dpr); this._peaks = null;
    }
    const ctx = this.cctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, cssW, cssH);

    const t = this.transport;
    const win = this._window();
    const mid = cssH / 2;

    if (t.hasAudio) {
      if (!this._peaks || this._peakW !== cssW) {
        this._peaks = this.audio.peaks(Math.max(1, Math.floor(cssW)));
        this._peakW = cssW;
      }
      ctx.strokeStyle = '#3c5f94';
      ctx.beginPath();
      for (let x = 0; x < cssW; x++) {
        ctx.moveTo(x + 0.5, mid + this._peaks[x * 2] * mid * 0.92);
        ctx.lineTo(x + 0.5, mid + this._peaks[x * 2 + 1] * mid * 0.92);
      }
      ctx.stroke();
    }

    // beat grid (aligned to the detected downbeat; bars every 4 beats)
    if (win > 0 && t.bpm > 0) {
      const beatSec = 60 / t.bpm;
      const pxPerSec = cssW / win;
      const off = t.beatOffset || 0;
      const every = pxPerSec * beatSec < 4 ? 4 : 1; // very long songs: bars only
      for (let k = Math.floor(-off / beatSec); ; k++) {
        const s = off + k * beatSec;
        if (s > win) break;
        if (s < 0) continue;
        const bar = ((k % 4) + 4) % 4 === 0;
        if (!bar && every > 1) continue;
        const x = s * pxPerSec;
        ctx.strokeStyle = bar ? 'rgba(120,150,200,0.38)' : 'rgba(90,110,150,0.14)';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke();
      }
    }

    // playhead (waveform + cue lane)
    const f = t.time / (win || 1);
    const px = f * cssW;
    ctx.strokeStyle = '#ff5c7a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, cssH); ctx.stroke();
    ctx.lineWidth = 1;
    this.ph.style.left = f * 100 + '%';
  }
}

const snap = (v, step) => Math.round(v / step) * step;
