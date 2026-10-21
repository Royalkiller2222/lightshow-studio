// Bottom timeline: transport + BPM/beat grid + audio waveform, and an editable
// cue lane. Cues are effect clips you place in time: add one, drag it to move,
// drag its right edge to resize, click to select and tweak in the inspector.
// The ShowEngine plays whatever cues are active at the transport's time.
//
// Laser cues get a BEYOND-style inspector: one row per Key Effect parameter
// (with a ◆ button that keys it at the playhead) and an envelope editor that
// shows the selected parameter's keyframes across the cue's 0–100%.

import { EFFECTS, paramsFor } from '../show/effects.js';
import { SHAPES, DIVISIONS, FANS } from '../show/waveforms.js';
import { GROUPS } from '../show/ShowEngine.js';
import { PATTERNS } from '../laser/patterns.js';
import {
  LASER_PARAMS, PARAM_BY_KEY, EASES, KEY_EPS,
  isAnimated, valueAt, setKey, removeKey, clearKeys, sortKeys, keyTimes,
} from '../laser/envelopes.js';

const ATTR_LABEL = { intensity: 'Intensity', color: 'Colour', position: 'Position' };

const NOAUDIO_WINDOW = 30; // seconds of editable canvas when no track is loaded
const LANES = 5;           // stacked cue tracks; lane 0 (top) wins the LTP merge
const LANE_H = 24;         // px per lane row
const KEY_HIT_PX = 7;      // pointer radius for grabbing a keyframe diamond

export class TimelinePanel {
  constructor(transport, audio, engine, root, { onLoadAudio, onEdit } = {}) {
    this.transport = transport;
    this.audio = audio;
    this.engine = engine;
    this.root = root;
    this.onLoadAudio = onLoadAudio;
    this.onEdit = onEdit; // fired after a cue is added/removed/moved/edited (for undo)
    this.selected = null;
    this._peaks = null;
    this._peakW = 0;

    // Laser inspector state (persists across cue selections).
    this.autoKey = false;     // BEYOND "Enable auto-keying"
    this.envParam = 'size';   // parameter shown in the envelope editor
    this.envSel = null;       // selected keyframe object
    this._sliderHeld = null;  // param whose slider is being dragged (skip live update)

    // Effect dropdown grouped by attribute domain.
    const effOpts = ['intensity', 'color', 'position']
      .map((attr) => {
        const opts = EFFECTS.filter((e) => e.attr === attr)
          .map((e) => `<option value="${e.key}">${e.label}</option>`).join('');
        return `<optgroup label="${ATTR_LABEL[attr]}">${opts}</optgroup>`;
      })
      .join('');
    const grpOpts = GROUPS.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');
    const opt = (list, k = 'key', l = 'label') => list.map((x) => `<option value="${x[k]}">${x[l]}</option>`).join('');
    const ctl = (name, inner) => `<label class="tl-ctl" data-ctl="${name}">${inner}</label>`;

    const lpRows = LASER_PARAMS.map((p) => {
      const input = p.kind === 'color'
        ? `<input type="color" data-lpv="${p.key}" />`
        : `<input type="range" min="${p.min}" max="${p.max}" step="${p.step}" data-lpv="${p.key}" /><span class="tl-lp-val" data-lpval="${p.key}"></span>`;
      return `<div class="tl-lp" data-lp="${p.key}">
          <button type="button" class="tl-key" data-key="${p.key}" title="Set a ${p.label} keyframe at the playhead">◆</button>
          <span class="tl-lp-name" data-pick="${p.key}" title="Show ${p.label} in the envelope editor">${p.label}</span>
          ${input}
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="tl-controls">
        <button type="button" class="tl-btn" data-act="playpause" title="Play / pause">▶</button>
        <button type="button" class="tl-btn" data-act="stop" title="Stop">⏹</button>
        <span class="tl-time" data-role="time">0:00 / 0:00</span>
        <label class="tl-bpm">BPM <input type="number" min="40" max="240" data-role="bpm" value="${transport.bpm}" /></label>
        <button type="button" data-act="load-audio">Load audio</button>
        <span class="tl-name" data-role="audio-name">no track</span>
        <span class="tl-spacer"></span>
        <canvas class="tl-laser-preview" data-role="laser-preview" width="80" height="60" title="Laser output preview"></canvas>
        <button type="button" data-act="add-cue">+ Cue</button>
        <button type="button" data-act="add-laser">+ Laser</button>
        <input type="file" accept="audio/*" data-role="audio-file" hidden />
      </div>
      <canvas class="tl-wave" data-role="wave"></canvas>
      <div class="tl-cuelane" data-role="cuelane"><div class="tl-playhead" data-role="ph"></div></div>
      <div class="tl-inspector" data-role="insp" hidden>
        ${ctl('effectKey', `Effect <select data-ins="effectKey">${effOpts}</select>`)}
        ${ctl('groupId', `Target <select data-ins="groupId">${grpOpts}</select>`)}
        ${ctl('shape', `Shape <select data-ins="shape">${opt(SHAPES)}</select>`)}
        ${ctl('sync', `<input type="checkbox" data-ins="sync" /> Beat-sync`)}
        ${ctl('division', `Div <select data-ins="division">${opt(DIVISIONS)}</select>`)}
        ${ctl('rate', `Rate <input type="range" min="0.05" max="8" step="0.05" data-ins="rate" />`)}
        ${ctl('size', `Size <input type="range" min="0" max="1" step="0.01" data-ins="size" />`)}
        ${ctl('base', `Base <input type="range" min="0" max="1" step="0.01" data-ins="base" />`)}
        ${ctl('spread', `Fan <input type="range" min="0" max="2" step="0.01" data-ins="spread" />`)}
        ${ctl('fan', `Mode <select data-ins="fan">${opt(FANS)}</select>`)}
        ${ctl('dir', `Dir <select data-ins="dir"><option value="1">Fwd</option><option value="-1">Rev</option></select>`)}
        ${ctl('duty', `Duty <input type="range" min="0.05" max="0.95" step="0.01" data-ins="duty" />`)}
        ${ctl('band', `Band <select data-ins="band"><option value="bass">Bass</option><option value="mid">Mid</option><option value="high">High</option></select>`)}
        ${ctl('color', `Colour <input type="color" data-ins="color" />`)}
        ${ctl('color2', `Colour 2 <input type="color" data-ins="color2" />`)}
        ${ctl('pan', `Pan <input type="range" min="0" max="1" step="0.01" data-ins="pan" />`)}
        ${ctl('tilt', `Tilt <input type="range" min="0" max="1" step="0.01" data-ins="tilt" />`)}
        ${ctl('duration', `Len(s) <input type="number" min="0.25" step="0.25" data-ins="duration" class="tl-dur" />`)}
        <button type="button" data-act="del-cue" data-role="del-generic" class="tl-del">Delete</button>
        <div class="tl-laser" data-role="laser-insp" hidden>
          <div class="tl-laser-left">
            <div class="tl-laser-head">
              <label>Pattern <select data-lmeta="pattern">${opt(PATTERNS)}</select></label>
              <label>Len(s) <input type="number" min="0.25" step="0.25" data-lmeta="duration" class="tl-dur" /></label>
              <label title="When on, changing a parameter writes a keyframe at the playhead (animated parameters always do)"><input type="checkbox" data-role="autokey" /> Auto-key</label>
              <button type="button" data-act="del-cue" class="tl-del">Delete</button>
            </div>
            <div class="tl-lparams">${lpRows}</div>
          </div>
          <div class="tl-env">
            <div class="tl-env-bar">
              <span class="tl-env-title" data-role="env-title"></span>
              <label>Ease <select data-role="env-ease">${opt(EASES)}</select></label>
              <button type="button" data-act="env-clear" title="Remove this parameter's keyframes (freezes it at its current value)">Clear keys</button>
              <span class="tl-env-hint">click: add key · drag: move (Shift: no snap) · double-click / Del: remove</span>
            </div>
            <div class="tl-env-wrap"><canvas class="tl-env-canvas" data-role="env" tabindex="0"></canvas></div>
          </div>
        </div>
      </div>`;

    this.$ = (s) => root.querySelector(s);
    this.canvas = this.$('[data-role="wave"]');
    this.cctx = this.canvas.getContext('2d');
    this.lane = this.$('[data-role="cuelane"]');
    this.ph = this.$('[data-role="ph"]');
    this.insp = this.$('[data-role="insp"]');
    this.laserPreview = this.$('[data-role="laser-preview"]');
    this.laserInsp = this.$('[data-role="laser-insp"]');
    this.envCanvas = this.$('[data-role="env"]');
    this.envCtx = this.envCanvas.getContext('2d');

    this._wire();
    transport.onChange(() => this._syncButtons());
    this._syncButtons();
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

  _wire() {
    const audioFile = this.$('[data-role="audio-file"]');

    this.root.addEventListener('click', (e) => {
      const keyBtn = e.target.closest('[data-key]');
      if (keyBtn) { this._keyParam(keyBtn.dataset.key); return; }
      const pick = e.target.closest('[data-pick]');
      if (pick) { this._pickParam(pick.dataset.pick); return; }

      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'playpause') this.transport.toggle();
      else if (act === 'stop') this.transport.stop();
      else if (act === 'load-audio') audioFile.click();
      else if (act === 'add-cue') this._addCue();
      else if (act === 'add-laser') this._addLaserCue();
      else if (act === 'del-cue') this._deleteSelected();
      else if (act === 'env-clear') this._clearEnvelope();
    });

    this.root.addEventListener('change', (e) => {
      const r = e.target.dataset.role;
      if (r === 'bpm') {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v > 0) this.transport.bpm = v;
      } else if (r === 'audio-file' && e.target.files[0]) {
        this.onLoadAudio?.(e.target.files[0]);
      }
    });

    // Fixture-cue inspector edits write straight onto the selected cue.
    this.insp.addEventListener('input', (e) => {
      const key = e.target.dataset.ins;
      const cue = this.selected;
      if (!key || !cue) return;
      const el = e.target;
      if (key === 'effectKey') { cue.effectKey = el.value; cue.params = paramsFor(el.value); this.selectCue(cue); this.renderCues(); }
      else if (key === 'groupId') { cue.groupId = el.value; this.renderCues(); }
      else if (key === 'duration') { cue.duration = Math.max(0.25, parseFloat(el.value) || 0.25); this.renderCues(); }
      else if (key === 'color' || key === 'color2') { cue.params[key] = hexToRgb(el.value); }
      else if (key === 'sync') { cue.params.sync = el.checked; }
      else if (key === 'shape' || key === 'fan' || key === 'band') { cue.params[key] = el.value; }
      else if (key === 'division' || key === 'dir') { cue.params[key] = parseFloat(el.value); }
      else { cue.params[key] = parseFloat(el.value); }
    });

    // Laser-cue inspector edits.
    this.insp.addEventListener('input', (e) => this._onLaserInput(e));

    // 'change' (slider released / select committed) is the undo checkpoint.
    // Laser-specific change handling runs first so the snapshot includes it.
    this.insp.addEventListener('change', (e) => {
      this._onLaserChange(e);
      this.onEdit?.();
    });

    // Don't fight the user: skip live updates on the slider being dragged.
    this.insp.addEventListener('pointerdown', (e) => { if (e.target.dataset.lpv) this._sliderHeld = e.target.dataset.lpv; });
    window.addEventListener('pointerup', () => { this._sliderHeld = null; });

    // Envelope editor.
    this.envCanvas.addEventListener('pointerdown', (e) => this._envPointerDown(e));
    this.envCanvas.addEventListener('dblclick', (e) => this._envDblClick(e));
    this.envCanvas.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopPropagation(); // Del here means "key", never the viewport's selected fixture
      if (this.envSel) this._deleteEnvKey(this.envSel);
    });

    // Waveform click-to-seek.
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.transport.seek(f * this._window());
    });

    // Cue lane: select / move / resize blocks.
    this.lane.addEventListener('pointerdown', (e) => this._onLanePointerDown(e));
  }

  _addCue() {
    const win = this._window();
    const start = Math.min(this.transport.time, Math.max(0, win - 4));
    const cue = this.engine.addCue({ effectKey: 'i-flat', groupId: 'movers', start, duration: Math.min(4, win) });
    this.renderCues();
    this.selectCue(cue);
    this.onEdit?.();
  }

  _addLaserCue() {
    const win = this._window();
    const start = Math.min(this.transport.time, Math.max(0, win - 4));
    const cue = this.engine.addLaserCue({ pattern: 'beam-fan', start, duration: Math.min(4, win) });
    this.renderCues();
    this.selectCue(cue);
    this.onEdit?.();
  }

  _deleteSelected() {
    if (!this.selected) return;
    this.engine.removeCue(this.selected.id);
    this.selectCue(null);
    this.renderCues();
    this.onEdit?.();
  }

  selectCue(cue) {
    this.selected = cue;
    this.envSel = null;
    for (const el of this.lane.querySelectorAll('.tl-cue')) {
      el.classList.toggle('sel', Number(el.dataset.id) === cue?.id);
    }
    const laser = !!cue && cue.kind === 'laser';
    if (!cue) { this.insp.hidden = true; return; }
    this.insp.hidden = false;
    this.laserInsp.hidden = !laser;
    this.$('[data-role="del-generic"]').hidden = laser;

    if (laser) {
      for (const el of this.insp.querySelectorAll('.tl-ctl')) el.hidden = true;
      // Open on an animated parameter if the remembered one isn't animated here.
      if (!isAnimated(cue, this.envParam)) {
        const anim = LASER_PARAMS.find((p) => isAnimated(cue, p.key));
        if (anim) this.envParam = anim.key;
      }
      this._laserRefresh(cue);
      return;
    }

    const p = cue.params;
    const set = (k, v) => { const el = this.$(`[data-ins="${k}"]`); if (el) el.value = v; };
    set('duration', cue.duration);
    this.$('[data-ins="color"]').value = rgbToHex(p.color);
    this.$('[data-ins="effectKey"]').value = cue.effectKey;
    this.$('[data-ins="groupId"]').value = cue.groupId;
    set('shape', p.shape); set('division', p.division); set('rate', p.rate);
    set('size', p.size); set('base', p.base); set('spread', p.spread);
    set('fan', p.fan); set('dir', p.dir); set('duty', p.duty); set('band', p.band);
    set('pan', p.pan); set('tilt', p.tilt);
    this.$('[data-ins="sync"]').checked = !!p.sync;
    this.$('[data-ins="color2"]').value = rgbToHex(p.color2);
    const eff = EFFECTS.find((x) => x.key === cue.effectKey);
    const shown = new Set(['effectKey', 'groupId', 'duration', ...(eff ? eff.controls : [])]);
    for (const el of this.insp.querySelectorAll('.tl-ctl')) el.hidden = !shown.has(el.dataset.ctl);
  }

  renderCues() {
    const win = this._window();
    // Drop existing blocks (keep the playhead element).
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
        label = `◆ ${pat ? pat.label : cue.pattern}`;
        keys = keyTimes(cue).map((t) => `<span class="tl-kf" style="left:${t * 100}%"></span>`).join('');
      } else {
        const eff = EFFECTS.find((x) => x.key === cue.effectKey);
        label = `${eff ? eff.label : cue.effectKey} · ${cue.groupId}`;
      }
      el.innerHTML = `<span class="tl-cue-label">${label}</span>${keys}<span class="tl-cue-grip"></span>`;
      this.lane.appendChild(el);
    }
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

    const move = (ev) => {
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
      if (this.selected === cue) {
        const d = this.$(cue.kind === 'laser' ? '[data-lmeta="duration"]' : '[data-ins="duration"]');
        if (d) d.value = cue.duration;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.onEdit?.(); // moved/resized -> record for undo
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onAudioLoaded() {
    this._peaks = null;
    this.$('[data-role="audio-name"]').textContent = this.audio.name || 'track';
    this.renderCues(); // window changed -> reposition blocks
  }

  /** Snap a time to the beat grid (aligned to the detected downbeat). */
  _snapTime(t) {
    const beatSec = 60 / (this.transport.bpm || 120);
    const off = this.transport.beatOffset || 0;
    return off + Math.round((t - off) / beatSec) * beatSec;
  }

  /** Reflect a (detected or external) BPM in the input. */
  setBpm(v) {
    this.$('[data-role="bpm"]').value = Math.round(v * 10) / 10;
  }

  _syncButtons() {
    this.$('[data-act="playpause"]').textContent = this.transport.playing ? '⏸' : '▶';
  }

  // ---------------------------------------------------------------- laser ---

  /** Cue-local time (0..1) of the playhead, clamped to the cue. */
  _cueU(cue) {
    return clamp01((this.transport.time - cue.start) / (cue.duration || 1));
  }

  /**
   * Where an inspector edit / ◆ press puts its key: exactly at the playhead
   * while paused (so the control shows what you set), quantised to the
   * half-beat grid while playing — tap ◆ on the beat, and a slider drag during
   * playback records at most one key per half-beat instead of one per frame.
   */
  _keyU(cue) {
    const u = this._cueU(cue);
    return this.transport.playing ? this._snapU(cue, u, false) : u;
  }

  /** Snap a key time to the half-beat grid (or the cue ends); Shift = free. */
  _snapU(cue, u, free) {
    u = clamp01(u);
    if (free) return u;
    const step = 30 / (this.transport.bpm || 120); // half a beat, in seconds
    const off = this.transport.beatOffset || 0;
    const abs = cue.start + u * cue.duration;
    const gridU = (off + Math.round((abs - off) / step) * step - cue.start) / cue.duration;
    let best = u, bestD = Infinity;
    for (const cand of [gridU, 0, 1]) {
      if (cand < 0 || cand > 1) continue;
      const d = Math.abs(cand - u);
      if (d < bestD) { bestD = d; best = cand; }
    }
    return best;
  }

  /** Populate the laser inspector from the cue (values at the playhead). */
  _laserRefresh(cue) {
    this.$('[data-lmeta="pattern"]').value = cue.pattern;
    this.$('[data-lmeta="duration"]').value = cue.duration;
    this.$('[data-role="autokey"]').checked = this.autoKey;
    const u = this._cueU(cue);
    for (const spec of LASER_PARAMS) this._showParam(cue, spec, valueAt(cue, spec.key, u), true);
    this._markRows(cue);
  }

  /** Write a param's value into its control (+ readout). */
  _showParam(cue, spec, v, force = false) {
    const el = this.$(`[data-lpv="${spec.key}"]`);
    if (!el || v === undefined) return;
    if (spec.kind === 'color') {
      if (!force && document.activeElement === el) return; // picker open
      const hex = rgbToHex(v);
      if (el.value !== hex) el.value = hex;
      return;
    }
    if (!force && this._sliderHeld === spec.key) return;
    if (Math.abs(parseFloat(el.value) - v) > 1e-6) el.value = v;
    const out = this.$(`[data-lpval="${spec.key}"]`);
    if (out) out.textContent = spec.fmt(v);
  }

  /** Highlight animated params (filled ◆) and the one in the envelope editor. */
  _markRows(cue) {
    for (const row of this.insp.querySelectorAll('.tl-lp')) {
      const key = row.dataset.lp;
      row.classList.toggle('anim', isAnimated(cue, key));
      row.classList.toggle('cur', key === this.envParam);
    }
    const spec = PARAM_BY_KEY[this.envParam];
    const animated = isAnimated(cue, this.envParam);
    this.$('[data-role="env-title"]').textContent = `${spec.label}${animated ? '' : ' (static)'}`;
    const ease = this.$('[data-role="env-ease"]');
    ease.disabled = !animated;
    ease.value = animated ? cue.anim[this.envParam].ease : 'linear';
    this.$('[data-act="env-clear"]').disabled = !animated;
  }

  _onLaserInput(e) {
    const cue = this.selected;
    if (!cue || cue.kind !== 'laser') return;
    const el = e.target;
    if (el.dataset.lmeta === 'pattern') { cue.pattern = el.value; this.renderCues(); return; }
    if (el.dataset.lmeta === 'duration') { cue.duration = Math.max(0.25, parseFloat(el.value) || 0.25); this.renderCues(); return; }
    const key = el.dataset.lpv;
    if (!key) return;
    const spec = PARAM_BY_KEY[key];
    const v = spec.kind === 'color' ? hexToRgb(el.value) : parseFloat(el.value);
    if (isAnimated(cue, key) || this.autoKey) {
      // After Effects-style: once animated, an edit sets a key at the playhead.
      this.envSel = setKey(cue, key, this._keyU(cue), v);
      this.envParam = key;
      this._markRows(cue);
      this.renderCues();
    } else {
      cue.params[key] = v;
    }
    if (spec.kind !== 'color') {
      const out = this.$(`[data-lpval="${key}"]`);
      if (out) out.textContent = spec.fmt(v);
    }
  }

  _onLaserChange(e) {
    const el = e.target;
    if (el.dataset.role === 'autokey') { this.autoKey = el.checked; return; }
    const cue = this.selected;
    if (el.dataset.role === 'env-ease' && cue && isAnimated(cue, this.envParam)) {
      cue.anim[this.envParam].ease = el.value;
    }
  }

  /** ◆ button: key the parameter at the playhead with its current value. */
  _keyParam(key) {
    const cue = this.selected;
    if (!cue || cue.kind !== 'laser') return;
    const u = this._keyU(cue);
    this.envSel = setKey(cue, key, u, valueAt(cue, key, u));
    this.envParam = key;
    this._markRows(cue);
    this.renderCues();
    this.onEdit?.();
  }

  _pickParam(key) {
    if (!this.selected || this.selected.kind !== 'laser') return;
    this.envParam = key;
    this.envSel = null;
    this._markRows(this.selected);
  }

  _clearEnvelope() {
    const cue = this.selected;
    if (!cue || !isAnimated(cue, this.envParam)) return;
    clearKeys(cue, this.envParam, this._cueU(cue));
    this.envSel = null;
    this._laserRefresh(cue);
    this.renderCues();
    this.onEdit?.();
  }

  _deleteEnvKey(k) {
    const cue = this.selected;
    if (!cue) return;
    removeKey(cue, this.envParam, k);
    this.envSel = null;
    this._laserRefresh(cue);
    this.renderCues();
    this.onEdit?.();
  }

  /** While paused, put the playhead on a key so the inspector shows/edits it. */
  _seekToKey(cue, k) {
    if (!this.transport.playing) this.transport.seek(cue.start + k.t * cue.duration);
  }

  // ---- envelope editor geometry ----
  _envGeom() {
    const w = this.envCanvas.clientWidth, h = this.envCanvas.clientHeight;
    return { w, h, l: 10, r: w - 10, t: 10, b: h - 10 };
  }

  _uToX(u, g) { return g.l + u * (g.r - g.l); }
  _xToU(x, g) { return (x - g.l) / ((g.r - g.l) || 1); }
  _vToY(spec, v, g) { return g.b - ((v - spec.min) / (spec.max - spec.min)) * (g.b - g.t); }
  _yToV(spec, y, g) {
    const v = spec.min + ((g.b - y) / ((g.b - g.t) || 1)) * (spec.max - spec.min);
    return Math.min(spec.max, Math.max(spec.min, v));
  }

  _keyY(spec, k, g) {
    return spec.kind === 'color' ? (g.t + g.b) / 2 : this._vToY(spec, Math.min(spec.max, Math.max(spec.min, k.v)), g);
  }

  _envLocal(e) {
    const c = this.envCanvas, r = c.getBoundingClientRect();
    return { x: e.clientX - r.left - c.clientLeft, y: e.clientY - r.top - c.clientTop }; // inside the border
  }

  /** Nearest keyframe of the edited param under the pointer, or null. */
  _envHit(cue, x, y) {
    if (!isAnimated(cue, this.envParam)) return null;
    const spec = PARAM_BY_KEY[this.envParam];
    const g = this._envGeom();
    let best = null, bestD = KEY_HIT_PX * KEY_HIT_PX;
    for (const k of cue.anim[this.envParam].keys) {
      const dx = x - this._uToX(k.t, g), dy = y - this._keyY(spec, k, g);
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = k; }
    }
    return best;
  }

  _envPointerDown(e) {
    const cue = this.selected;
    if (!cue || cue.kind !== 'laser' || e.button !== 0) return;
    this.envCanvas.focus();
    const key = this.envParam;
    const spec = PARAM_BY_KEY[key];
    const g = this._envGeom();
    const p = this._envLocal(e);
    let k = this._envHit(cue, p.x, p.y);
    if (!k) {
      const u = this._snapU(cue, this._xToU(p.x, g), e.shiftKey);
      const v = spec.kind === 'color' ? valueAt(cue, key, u) : this._yToV(spec, p.y, g);
      k = setKey(cue, key, u, v);
      this.renderCues();
    }
    this.envSel = k;
    this._markRows(cue);
    this._seekToKey(cue, k);

    const env = cue.anim[key];
    const move = (ev) => {
      const q = this._envLocal(ev);
      k.t = this._snapU(cue, this._xToU(q.x, g), ev.shiftKey);
      if (spec.kind !== 'color') k.v = this._yToV(spec, q.y, g);
      sortKeys(env);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Dropping a key onto another replaces it (one key per time, as in AE).
      env.keys = env.keys.filter((o) => o === k || Math.abs(o.t - k.t) >= KEY_EPS);
      this._seekToKey(cue, k);
      this.renderCues();
      this.onEdit?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _envDblClick(e) {
    const cue = this.selected;
    if (!cue || cue.kind !== 'laser') return;
    const p = this._envLocal(e);
    const k = this._envHit(cue, p.x, p.y);
    if (k) this._deleteEnvKey(k);
  }

  _drawEnvelope(cue) {
    const c = this.envCanvas;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
      c.width = Math.floor(cssW * dpr); c.height = Math.floor(cssH * dpr);
    }
    const ctx = this.envCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#08080b';
    ctx.fillRect(0, 0, cssW, cssH);

    const key = this.envParam;
    const spec = PARAM_BY_KEY[key];
    const g = this._envGeom();
    const animated = isAnimated(cue, key);

    // Beat grid inside the cue (half-beats faint) — keys snap to these. On a
    // long cue, thin the lines (every 2nd/4th/...) so they stay >= 4px apart.
    const half = 30 / (this.transport.bpm || 120);
    const off = this.transport.beatOffset || 0;
    const end = cue.start + cue.duration;
    const pxHalf = ((g.r - g.l) * half) / (cue.duration || 1);
    let every = 1;
    while (pxHalf * every < 4 && every < 4096) every *= 2;
    for (let n = Math.ceil((cue.start - off) / half / every) * every; pxHalf > 0; n += every) {
      const s = off + n * half;
      if (s > end + 1e-9) break;
      const x = this._uToX((s - cue.start) / cue.duration, g);
      ctx.strokeStyle = n % 2 === 0 ? 'rgba(90,110,150,0.35)' : 'rgba(90,110,150,0.12)';
      ctx.beginPath(); ctx.moveTo(x, g.t); ctx.lineTo(x, g.b); ctx.stroke();
    }

    if (spec.kind === 'color') {
      // Colour: the evaluated colour as a strip; keys sit on its centre line.
      const y0 = g.t + (g.b - g.t) * 0.25, hh = (g.b - g.t) * 0.5;
      const n = Math.max(2, Math.floor(g.r - g.l));
      for (let i = 0; i < n; i++) {
        const v = valueAt(cue, key, i / (n - 1));
        ctx.fillStyle = `rgb(${(v[0] * 255) | 0},${(v[1] * 255) | 0},${(v[2] * 255) | 0})`;
        ctx.fillRect(g.l + i, y0, 1.5, hh);
      }
    } else {
      if (spec.min < 0 && spec.max > 0) { // zero line
        const y = this._vToY(spec, 0, g);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.r, y); ctx.stroke();
      }
      ctx.strokeStyle = animated ? '#6fffb0' : 'rgba(111,255,176,0.35)';
      ctx.lineWidth = 1.5;
      if (!animated) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const N = 160;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = Math.min(spec.max, Math.max(spec.min, valueAt(cue, key, u)));
        const x = this._uToX(u, g), y = this._vToY(spec, v, g);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#5f5f6a';
      ctx.font = '10px Segoe UI, sans-serif';
      ctx.fillText(spec.fmt(spec.max), 2, g.t + 3);
      ctx.fillText(spec.fmt(spec.min), 2, g.b + 3);
    }

    if (animated) {
      for (const k of cue.anim[key].keys) {
        const x = this._uToX(k.t, g), y = this._keyY(spec, k, g);
        ctx.fillStyle = k === this.envSel ? '#ffffff' : '#ffb347';
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#08080b'; ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#55555f';
      ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText('Not animated — click here to add a keyframe, or press ◆', g.l + 30, g.t + 12);
    }

    const now = (this.transport.time - cue.start) / (cue.duration || 1);
    if (now >= 0 && now <= 1) {
      const x = this._uToX(now, g);
      ctx.strokeStyle = '#ff5c7a';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke();
    }
  }

  /** Per-frame: follow the playhead in the laser inspector + redraw envelope. */
  _liveLaser(cue) {
    const u = this._cueU(cue);
    for (const spec of LASER_PARAMS) {
      if (isAnimated(cue, spec.key)) this._showParam(cue, spec, valueAt(cue, spec.key, u));
    }
    this._drawEnvelope(cue);
  }

  // ---------------------------------------------------------------- frame ---

  frame() {
    if (this.selected && this.selected.kind === 'laser' && !this.insp.hidden) this._liveLaser(this.selected);

    const c = this.canvas;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
      c.width = Math.floor(cssW * dpr); c.height = Math.floor(cssH * dpr); this._peaks = null;
    }
    const ctx = this.cctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, cssW, cssH);

    const t = this.transport;
    const win = this._window();
    const mid = cssH / 2;

    if (t.hasAudio) {
      if (!this._peaks || this._peakW !== cssW) {
        this._peaks = this.audio.peaks(Math.max(1, Math.floor(cssW)));
        this._peakW = cssW;
      }
      ctx.strokeStyle = '#3a5a8a';
      ctx.beginPath();
      for (let x = 0; x < cssW; x++) {
        ctx.moveTo(x + 0.5, mid + this._peaks[x * 2] * mid * 0.92);
        ctx.lineTo(x + 0.5, mid + this._peaks[x * 2 + 1] * mid * 0.92);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = '#55555f';
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillText('No track — show clock free-runs. Add cues below; load audio to sync.', 12, mid);
    }

    // beat grid (aligned to the detected downbeat; bars every 4 beats)
    if (win > 0 && t.bpm > 0) {
      const beatSec = 60 / t.bpm;
      const pxPerSec = cssW / win;
      const off = t.beatOffset || 0;
      for (let k = Math.floor(-off / beatSec); ; k++) {
        const s = off + k * beatSec;
        if (s > win) break;
        if (s < 0) continue;
        const x = s * pxPerSec;
        ctx.strokeStyle = ((k % 4) + 4) % 4 === 0 ? 'rgba(120,150,200,0.4)' : 'rgba(90,110,150,0.15)';
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

    this.$('[data-role="time"]').textContent = `${fmt(t.time)} / ${fmt(t.hasAudio ? t.duration : win)}`;
  }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const snap = (v, step) => Math.round(v / step) * step;
function fmt(sec) {
  if (!Number.isFinite(sec)) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex([r, g, b]) {
  const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
