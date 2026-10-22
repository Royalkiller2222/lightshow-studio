// The Program workspace's timeline, built like a DAW:
//   ruler   — bars, section markers (double-click to add, drag to move), the playhead
//   song    — the waveform of the loaded track (zooms with the view)
//   tracks  — named tracks ("Laser 1", "Movers · Colour"…), each a row of cue clips.
//             The header has mute / solo; laser tracks open to show one curve lane
//             per animated Key Effect, lined up with the music, where keyframes
//             are added / dragged / deleted directly.
// The view zooms (Ctrl+wheel, the +/- buttons, Fit) and scrolls (Shift+wheel,
// the scrollbar, or following the playhead). Cue editing lives in CueInspector;
// track and marker editing in the Inspector. All show data lives on the engine.

import { EFFECTS } from '../show/effects.js';
import { GROUPS } from '../show/ShowEngine.js';
import { PATTERNS } from '../laser/patterns.js';
import {
  LASER_PARAMS, PARAM_BY_KEY, KEY_EPS,
  keyTimes, isAnimated, valueAt, setKey, removeKey, sortKeys,
} from '../laser/envelopes.js';
import { icon } from '../ui/icons.js';
import { esc, clamp } from '../ui/dom.js';
import { effectShortName } from './CueInspector.js';
import { snapTime, snapKeyU } from './snap.js';

export const DND_TYPE = 'application/x-lightshow'; // library -> timeline drag payload

const NOAUDIO_WINDOW = 30; // seconds of editable timeline when no song is loaded
const DEFAULT_LEN = 4;     // seconds for a newly added cue
const HIT = 7;             // px radius for grabbing a keyframe / marker
const MAX_PPS = 400;       // most zoomed-in: px per second

const ATTR_NAME = { intensity: 'Intensity', color: 'Colour', position: 'Movement' };

export class TimelinePanel {
  /**
   * opts: onLoadAudio(file), onEdit() (undo checkpoint),
   *       onSelect(kind: 'cue'|'track'|'marker'|null, obj),
   *       onCueMoved(cue) (dragged/resized), onCurveChange(cue) (keys edited here)
   */
  constructor(transport, audio, engine, root, opts = {}) {
    this.transport = transport;
    this.audio = audio;
    this.engine = engine;
    this.root = root;
    this.o = opts;
    if (!engine.markers) engine.markers = [];

    this.selected = null;        // cue
    this.selectedTrack = null;
    this.selectedMarker = null;
    this.curveFocus = null;      // { trackId, key } — lane shown even if not animated
    this.curveSel = null;        // { cue, key, k } — selected keyframe in a curve lane
    this.pps = 0;                // px per second (0 = not laid out yet -> fit)
    this.t0 = 0;                 // time at the left edge of the view
    this._lanes = [];            // curve lanes: { canvas, track, key }
    this._wave = { key: '', peaks: null };

    root.innerHTML = `
      <div class="tl-toolbar">
        <button type="button" class="btn sm" data-act="load-audio" title="Load a song (mp3, wav, ogg, m4a) — its tempo is detected automatically">${icon('music', 'sm')}Load song</button>
        <span class="tl-track"><span class="nm none" data-role="audio-name">No song loaded — the clock runs free</span></span>
        <span class="tl-spacer"></span>
        <span class="tl-hint" data-role="hint"></span>
        <button type="button" class="btn sm" data-act="add-marker" title="Add a section marker at the playhead (M)">${icon('flag', 'sm')}Marker</button>
        <button type="button" class="btn sm" data-act="add-laser-track" title="Add a laser track">${icon('plus', 'sm')}Laser track</button>
        <button type="button" class="btn sm" data-act="add-fixture-track" title="Add a fixture track">${icon('plus', 'sm')}Fixture track</button>
        <span class="tl-zoom">
          <button type="button" class="btn ghost icon sm" data-act="zoom-out" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out">${icon('minus', 'sm')}</button>
          <button type="button" class="btn ghost icon sm" data-act="zoom-in" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in">${icon('plus', 'sm')}</button>
          <button type="button" class="btn ghost sm" data-act="fit" title="Fit the whole show">Fit</button>
        </span>
        <input type="file" accept="audio/*" data-role="audio-file" hidden />
      </div>
      <div class="tl-row tl-ruler-row">
        <div class="tl-corner muted small" data-role="corner">Bars</div>
        <div class="tl-cv"><canvas data-role="ruler" title="Click to move the playhead · double-click to add a marker"></canvas></div>
      </div>
      <div class="tl-row tl-song-row">
        <div class="tl-corner" title="The song">${icon('music', 'sm')}<span data-role="song-label">Song</span></div>
        <div class="tl-cv"><canvas data-role="wave" title="Click to move the playhead"></canvas></div>
      </div>
      <div class="tl-trackwrap">
        <div class="tl-tracks" data-role="tracks"></div>
        <div class="tl-ph" data-role="ph"></div>
      </div>
      <div class="tl-row tl-hbar">
        <div class="tl-corner"></div>
        <div class="tl-hscroll" data-role="hscroll"><div data-role="hspace"></div></div>
      </div>`;

    this.$ = (s) => root.querySelector(s);
    this.ruler = this.$('[data-role="ruler"]');
    this.wave = this.$('[data-role="wave"]');
    this.tracksEl = this.$('[data-role="tracks"]');
    this.ph = this.$('[data-role="ph"]');
    this.hscroll = this.$('[data-role="hscroll"]');
    this.hspace = this.$('[data-role="hspace"]');

    this._wire();
    this.render();
  }

  // ===================================================================== view
  _window() {
    if (this.transport.hasAudio && this.transport.duration > 0) return this.transport.duration;
    // No song: the window grows to the last cue (+pad) so every clip's resize
    // grip stays reachable.
    let end = 0;
    for (const c of this.engine.cues) end = Math.max(end, c.start + c.duration);
    for (const m of this.engine.markers) end = Math.max(end, m.t);
    return Math.max(NOAUDIO_WINDOW, end + 4);
  }

  /** Show length the top bar displays. */
  get length() { return this._window(); }

  get bodyW() { return this.ruler.clientWidth; }
  get span() { return this.pps > 0 ? this.bodyW / this.pps : this._window(); }
  x(t) { return (t - this.t0) * this.pps; }
  t(x) { return this.t0 + x / this.pps; }

  _minPps() { return this.bodyW > 0 ? (this.bodyW / this._window()) * 0.5 : 1; }

  fit() {
    if (!this.bodyW) return;
    this.pps = this.bodyW / this._window();
    this.t0 = 0;
    this._viewChanged();
  }

  /** Zoom by `factor`, keeping time `at` (default: view centre) under the same pixel. */
  zoom(factor, at = null) {
    if (!this.bodyW) return;
    const anchorT = at ?? this.t(this.bodyW / 2);
    const ax = this.x(anchorT);
    this.pps = clamp(this.pps * factor, this._minPps(), MAX_PPS);
    this.t0 = anchorT - ax / this.pps;
    this._viewChanged();
  }

  scrollBy(seconds) { this.t0 += seconds; this._viewChanged(); }

  _clampView() {
    const maxT0 = Math.max(0, this._window() - this.span * 0.9);
    this.t0 = clamp(this.t0, 0, maxT0);
  }

  _viewChanged() {
    this._clampView();
    this._syncScrollbar();
    this._layoutClips();
  }

  _syncScrollbar() {
    const total = Math.max(this.bodyW, (this._window() + this.span * 0.1) * this.pps);
    this.hspace.style.width = `${Math.round(total)}px`;
    this._syncingScroll = true;
    this.hscroll.scrollLeft = this.t0 * this.pps;
    this._syncingScroll = false;
  }

  // ================================================================== wiring
  _wire() {
    const audioFile = this.$('[data-role="audio-file"]');
    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'load-audio') audioFile.click();
      else if (act === 'add-marker') this.addMarker();
      else if (act === 'add-laser-track') this.addTrack('laser');
      else if (act === 'add-fixture-track') this.addTrack('fixture');
      else if (act === 'zoom-in') this.zoom(1.5);
      else if (act === 'zoom-out') this.zoom(1 / 1.5);
      else if (act === 'fit') this.fit();
    });
    audioFile.addEventListener('change', () => {
      if (audioFile.files[0]) this.o.onLoadAudio?.(audioFile.files[0]);
      audioFile.value = '';
    });

    this.hscroll.addEventListener('scroll', () => {
      if (this._syncingScroll || !this.pps) return;
      this.t0 = this.hscroll.scrollLeft / this.pps;
      this._clampView();
      this._layoutClips();
    });

    // Wheel: Ctrl = zoom at the cursor; Shift (or over the ruler/song) = scroll in time.
    const onWheel = (e, timeAxis) => {
      if (!this.pps) return;
      const r = this.ruler.getBoundingClientRect();
      if (e.ctrlKey) {
        e.preventDefault();
        this.zoom(Math.exp(-e.deltaY * 0.0015), this.t(e.clientX - r.left));
      } else if (timeAxis || e.shiftKey) {
        e.preventDefault();
        this.scrollBy(((e.shiftKey ? e.deltaY : (e.deltaX || e.deltaY)) / this.pps));
      }
    };
    this.ruler.addEventListener('wheel', (e) => onWheel(e, true), { passive: false });
    this.wave.addEventListener('wheel', (e) => onWheel(e, true), { passive: false });
    this.tracksEl.addEventListener('wheel', (e) => onWheel(e, false), { passive: false });

    this.wave.addEventListener('pointerdown', (e) => this._scrub(e, this.wave));
    this.ruler.addEventListener('pointerdown', (e) => this._onRulerDown(e));
    this.ruler.addEventListener('dblclick', (e) => {
      const r = this.ruler.getBoundingClientRect();
      if (!this._markerAt(e.clientX - r.left)) this.addMarker(snapTime(this.transport, this.t(e.clientX - r.left)));
    });

    this.tracksEl.addEventListener('pointerdown', (e) => this._onTracksDown(e));
    this.tracksEl.addEventListener('click', (e) => this._onTracksClick(e));
    this.tracksEl.addEventListener('dblclick', (e) => this._onTracksDblClick(e));
    this.tracksEl.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.matches('canvas')) {
        e.preventDefault();
        e.stopPropagation(); // Del in a curve lane means "this keyframe"
        if (this.curveSel) this._deleteKey(this.curveSel);
      }
    });

    this.tracksEl.addEventListener('dragover', (e) => this._onDragOver(e));
    this.tracksEl.addEventListener('dragleave', (e) => { if (!this.tracksEl.contains(e.relatedTarget)) this._clearGhost(); });
    this.tracksEl.addEventListener('drop', (e) => this._onDrop(e));

    new ResizeObserver(() => { if (this.bodyW && !this.pps) this.fit(); else if (this.pps) this._viewChanged(); }).observe(this.ruler);
  }

  // ================================================================ tracks
  _defaultTrackName(kind, groupId = 'movers', attr = null) {
    if (kind === 'laser') {
      const n = this.engine.tracks.filter((t) => t.kind === 'laser').length + 1;
      return `Laser ${n}`;
    }
    const g = GROUPS.find((x) => x.id === groupId);
    return attr ? `${g ? g.label : 'Fixtures'} · ${ATTR_NAME[attr] || 'Effect'}` : (g ? g.label : 'Fixtures');
  }

  addTrack(kind, { groupId = 'movers', attr = null, select = true } = {}) {
    const track = this.engine.addTrack({ kind, groupId, name: this._defaultTrackName(kind, groupId, attr), open: kind === 'laser' });
    this.render();
    if (select) this.selectTrack(track);
    this.o.onEdit?.();
    return track;
  }

  deleteTrack(track) {
    if (!track) return;
    if (this.selected && this.selected.track === track.id) this.selectCue(null);
    if (this.selectedTrack === track) this.selectTrack(null);
    this.engine.removeTrack(track.id);
    this.render();
    this.o.onEdit?.();
  }

  moveTrack(track, delta) {
    this.engine.moveTrack(track.id, delta);
    this.render();
    this.o.onEdit?.();
  }

  // ================================================================== cues
  _overlaps(trackId, start, dur, except = null) {
    return this.engine.cues.some((c) => c !== except && c.track === trackId && c.start < start + dur && start < c.start + c.duration);
  }

  /** Where a double-clicked library item goes: the selected track if it fits, else a free one, else a new one. */
  _trackFor(kind, start, dur, groupHint = null) {
    const ok = (t) => t && t.kind === kind && (kind === 'laser' || !groupHint || t.groupId === groupHint);
    if (ok(this.selectedTrack)) return this.selectedTrack;
    if (this.selected) { const t = this.engine.trackOf(this.selected); if (ok(t) && !this._overlaps(t.id, start, dur)) return t; }
    const fits = this.engine.tracks.filter(ok);
    return fits.find((t) => !this._overlaps(t.id, start, dur)) || fits[0] || null;
  }

  _placement(time) {
    const win = this._window();
    const start = Math.max(0, Math.min(time ?? this.transport.time, Math.max(0, win - DEFAULT_LEN)));
    return { start, duration: Math.min(DEFAULT_LEN, win) };
  }

  addLaserCueAt(pattern, time, trackId) {
    const { start, duration } = this._placement(time);
    let track = trackId != null ? this.engine.tracks.find((t) => t.id === trackId) : this._trackFor('laser', start, duration);
    if (!track) track = this.engine.addTrack({ kind: 'laser', name: this._defaultTrackName('laser'), open: true });
    const cue = this.engine.addLaserCue({ pattern, start, duration, track: track.id });
    this._added(cue);
    return cue;
  }

  addFixtureCueAt(effectKey, time, trackId) {
    const { start, duration } = this._placement(time);
    const eff = EFFECTS.find((e) => e.key === effectKey);
    const group = effectKey === 'sparks' ? 'sparks' : null;
    let track = trackId != null ? this.engine.tracks.find((t) => t.id === trackId) : this._trackFor('fixture', start, duration, group);
    if (!track) {
      const groupId = group || 'movers';
      track = this.engine.addTrack({ kind: 'fixture', groupId, name: this._defaultTrackName('fixture', groupId, effectKey === 'sparks' ? null : eff?.attr) });
    }
    const cue = this.engine.addCue({ effectKey, groupId: track.groupId, start, duration, track: track.id });
    this._added(cue);
    return cue;
  }

  _added(cue) {
    this.render();
    this.selectCue(cue);
    this.o.onEdit?.();
  }

  deleteCue(cue) {
    if (!cue) return;
    this.engine.removeCue(cue.id);
    if (this.selected === cue) this.selectCue(null);
    this.render();
    this.o.onEdit?.();
  }

  // =============================================================== markers
  addMarker(t = this.transport.time) {
    const m = { t: Math.max(0, t), name: `Marker ${this.engine.markers.length + 1}` };
    this.engine.markers.push(m);
    this.engine.markers.sort((a, b) => a.t - b.t);
    this.selectMarker(m);
    this.o.onEdit?.();
    return m;
  }

  deleteMarker(m) {
    const i = this.engine.markers.indexOf(m);
    if (i < 0) return;
    this.engine.markers.splice(i, 1);
    if (this.selectedMarker === m) this.selectMarker(null);
    this.o.onEdit?.();
  }

  _markerAt(x) {
    let best = null, bestD = HIT;
    for (const m of this.engine.markers) {
      const d = Math.abs(this.x(m.t) - x);
      if (d <= bestD) { bestD = d; best = m; }
    }
    return best;
  }

  // ============================================================= selection
  selectCue(cue) {
    this.selected = cue;
    if (cue) {
      this.selectedTrack = null;
      this.selectedMarker = null;
      if (cue.kind === 'laser') this.curveFocus = { trackId: cue.track, key: this.curveFocus?.key || 'size' };
    }
    this.curveSel = null;
    this._markSelection();
    this.o.onSelect?.(cue ? 'cue' : null, cue);
  }

  selectTrack(track) {
    this.selectedTrack = track;
    if (track) { this.selected = null; this.selectedMarker = null; }
    this._markSelection();
    this.o.onSelect?.(track ? 'track' : null, track);
  }

  selectMarker(m) {
    this.selectedMarker = m;
    if (m) { this.selected = null; this.selectedTrack = null; }
    this._markSelection();
    this.o.onSelect?.(m ? 'marker' : null, m);
  }

  _markSelection() {
    for (const el of this.tracksEl.querySelectorAll('.tl-cue')) el.classList.toggle('sel', Number(el.dataset.id) === this.selected?.id);
    for (const el of this.tracksEl.querySelectorAll('.trk')) el.classList.toggle('sel', Number(el.dataset.track) === this.selectedTrack?.id);
  }

  /** Open a laser cue's track and show the `key` curve lane (from the inspector). */
  focusCurve(cue, key) {
    const track = this.engine.trackOf(cue);
    if (!track || track.kind !== 'laser') return;
    this.curveFocus = { trackId: track.id, key };
    if (!track.open) track.open = true;
    this.render();
  }

  // ================================================================ render
  /** Rebuild the track rows (after data changes). Clip positions come from the view. */
  render() {
    const tracks = this.engine.tracks;
    const rows = tracks.map((t) => this._trackHtml(t)).join('');
    this.tracksEl.innerHTML = `${rows}
      <div class="trk-add" data-role="newtrack">${icon('plus', 'sm')}${tracks.length ? 'Drop a pattern or effect here to start a new track' : 'Drag a laser pattern or an effect from the library here to start your first track'}</div>`;
    this._lanes = [...this.tracksEl.querySelectorAll('canvas[data-lane]')].map((canvas) => ({
      canvas,
      track: tracks.find((t) => t.id === Number(canvas.dataset.track)),
      key: canvas.dataset.lane,
    }));
    this._layoutClips();
    this._markSelection();
    const hint = this.$('[data-role="hint"]');
    hint.textContent = this.engine.cues.length ? '' : 'Drag patterns and effects here from the library';
  }

  /** Back-compat name used by the rest of the app. */
  renderCues() { this.render(); }

  _lanesFor(track) {
    if (track.kind !== 'laser' || !track.open) return [];
    const cues = this.engine.cues.filter((c) => c.track === track.id);
    const keys = LASER_PARAMS.filter((p) => cues.some((c) => isAnimated(c, p.key)) || (this.curveFocus?.trackId === track.id && this.curveFocus.key === p.key));
    return keys.length ? keys : [PARAM_BY_KEY.size];
  }

  _trackHtml(t) {
    const laser = t.kind === 'laser';
    const g = GROUPS.find((x) => x.id === t.groupId);
    const lanes = this._lanesFor(t).map((p) => `
      <div class="crv${this.curveFocus?.trackId === t.id && this.curveFocus.key === p.key ? ' cur' : ''}">
        <div class="crv-head" data-pick-curve="${p.key}" data-track="${t.id}" title="${esc(p.label)} keyframes for this track">${icon('diamond', 'sm')}${esc(p.label)}</div>
        <div class="crv-body"><canvas data-lane="${p.key}" data-track="${t.id}" tabindex="0" aria-label="${esc(p.label)} curve"></canvas></div>
      </div>`).join('');
    return `
      <div class="trk${laser ? ' laser' : ''}${t.mute ? ' muted' : ''}" data-track="${t.id}">
        <div class="trk-head" data-track-head="${t.id}" title="Click to edit the track · double-click to rename">
          ${laser ? `<button type="button" class="trk-chev" data-act-trk="open" title="${t.open ? 'Hide' : 'Show'} keyframe curves" aria-label="Toggle curves">${icon(t.open ? 'chev-down' : 'chev-right', 'sm')}</button>` : '<span class="trk-chev"></span>'}
          <span class="trk-ico">${icon(laser ? 'laser' : 'moving-head', 'sm')}</span>
          <span class="trk-txt" title="${esc(t.name)}${laser || !g ? '' : ` — drives ${esc(g.label)}`}"><span class="trk-name">${esc(t.name)}</span>${laser || !g || t.name.includes(g.label) ? '' : `<span class="trk-sub">${esc(g.label)}</span>`}</span>
          <button type="button" class="trk-btn" data-act-trk="mute" aria-pressed="${t.mute}" title="Mute this track">M</button>
          <button type="button" class="trk-btn solo" data-act-trk="solo" aria-pressed="${t.solo}" title="Solo: play only soloed tracks">S</button>
        </div>
        <div class="trk-body" data-track-body="${t.id}"></div>
      </div>${lanes}`;
  }

  /** Position every clip for the current zoom/scroll (cheap; called on view changes). */
  _layoutClips() {
    if (!this.pps) return;
    const bodies = new Map([...this.tracksEl.querySelectorAll('[data-track-body]')].map((b) => [Number(b.dataset.trackBody), b]));
    for (const b of bodies.values()) b.replaceChildren();
    const viewEnd = this.t0 + this.span;
    for (const cue of this.engine.cues) {
      const body = bodies.get(cue.track);
      if (!body || cue.start > viewEnd || cue.start + cue.duration < this.t0) continue;
      body.appendChild(this._clipEl(cue));
    }
  }

  _clipEl(cue) {
    const el = document.createElement('div');
    const laser = cue.kind === 'laser';
    el.className = 'tl-cue' + (laser ? ' tl-cue-laser' : '') + (this.selected === cue ? ' sel' : '');
    el.dataset.id = cue.id;
    this._placeClip(el, cue);
    let label, keys = '';
    if (laser) {
      const pat = PATTERNS.find((x) => x.key === cue.pattern);
      label = pat ? pat.label : cue.pattern;
      keys = keyTimes(cue).map((t) => `<span class="tl-kf" style="left:${t * 100}%"></span>`).join('');
    } else {
      label = effectShortName(EFFECTS.find((x) => x.key === cue.effectKey));
    }
    el.title = `${label} — drag to move (Shift: no snap), drag the right edge to resize`;
    el.innerHTML = `<span class="tl-cue-label">${esc(label)}</span>${keys}<span class="tl-cue-grip"></span>`;
    return el;
  }

  _placeClip(el, cue) {
    el.style.left = `${this.x(cue.start)}px`;
    el.style.width = `${Math.max(6, cue.duration * this.pps)}px`;
  }

  // ======================================================== track pointer
  _onTracksDown(e) {
    if (e.button !== 0) return;
    const lane = e.target.closest('canvas[data-lane]');
    if (lane) { this._onLaneDown(e, lane); return; }
    if (e.target.closest('[data-act-trk]')) return; // header buttons handle click
    const clip = e.target.closest('.tl-cue');
    if (clip) { this._onClipDown(e, clip); return; }
    const body = e.target.closest('[data-track-body]');
    if (body) {
      // Empty track space: deselect and move the playhead there.
      this.selectCue(null);
      const r = body.getBoundingClientRect();
      this.transport.seek(Math.max(0, this.t(e.clientX - r.left)));
    }
  }

  _onTracksClick(e) {
    const btn = e.target.closest('[data-act-trk]');
    const head = e.target.closest('[data-track-head]');
    const pick = e.target.closest('[data-pick-curve]');
    if (pick) {
      const track = this.engine.tracks.find((t) => t.id === Number(pick.dataset.track));
      this.curveFocus = { trackId: track.id, key: pick.dataset.pickCurve };
      this.render();
      this.o.onCurvePick?.(pick.dataset.pickCurve);
      return;
    }
    if (!head) return;
    const track = this.engine.tracks.find((t) => t.id === Number(head.dataset.trackHead));
    if (!track) return;
    if (btn) {
      const act = btn.dataset.actTrk;
      if (act === 'open') track.open = !track.open;
      else if (act === 'mute') track.mute = !track.mute;
      else if (act === 'solo') track.solo = !track.solo;
      this.render();
      this.o.onEdit?.();
      this.o.onSelect?.(this.selectedTrack ? 'track' : (this.selected ? 'cue' : null), this.selectedTrack || this.selected);
      return;
    }
    this.selectTrack(track);
  }

  _onTracksDblClick(e) {
    const name = e.target.closest('.trk-name');
    if (name) { this._rename(name); return; }
    const lane = e.target.closest('canvas[data-lane]');
    if (lane) this._onLaneDblClick(e, lane);
  }

  _rename(nameEl) {
    const head = nameEl.closest('[data-track-head]');
    const track = this.engine.tracks.find((t) => t.id === Number(head.dataset.trackHead));
    if (!track) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'trk-rename';
    input.value = track.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== track.name) { track.name = v; this.o.onEdit?.(); }
      this.render();
      this.o.onSelect?.(this.selectedTrack ? 'track' : (this.selected ? 'cue' : null), this.selectedTrack || this.selected);
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  _trackUnder(clientX, clientY, kind) {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el && el.closest('.trk');
    const track = row && this.engine.tracks.find((t) => t.id === Number(row.dataset.track));
    return track && track.kind === kind ? track : null;
  }

  _onClipDown(e, clip) {
    const cue = this.engine.cues.find((c) => c.id === Number(clip.dataset.id));
    if (!cue) return;
    this.selectCue(cue);
    const resize = e.target.classList.contains('tl-cue-grip');
    const startX = e.clientX;
    const origStart = cue.start, origDur = cue.duration;
    const win = this._window();
    const beat = 60 / (this.transport.bpm || 120);
    let moved = false;
    const move = (ev) => {
      moved = true;
      const dt = (ev.clientX - startX) / this.pps;
      if (resize) {
        const d = origDur + dt;
        cue.duration = Math.max(0.25, Math.min(win - cue.start, ev.shiftKey ? d : Math.round(d / beat) * beat || 0.25));
      } else {
        const s = origStart + dt;
        cue.start = Math.max(0, Math.min(win - cue.duration, ev.shiftKey ? s : snapTime(this.transport, s)));
        // Dragging up/down moves the clip to another track of the same kind.
        const target = this._trackUnder(ev.clientX, ev.clientY, cue.kind);
        if (target && target.id !== cue.track) {
          cue.track = target.id;
          this.engine.syncTracks();
          this.tracksEl.querySelector(`[data-track-body="${target.id}"]`)?.appendChild(clip);
        }
      }
      this._placeClip(clip, cue);
      this.o.onCueMoved?.(cue);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { this.render(); this.o.onEdit?.(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ========================================================== ruler & song
  _scrub(e, canvas) {
    if (e.button !== 0 || !this.pps) return;
    const r = canvas.getBoundingClientRect();
    const seek = (ev) => this.transport.seek(Math.max(0, this.t(ev.clientX - r.left)));
    seek(e);
    const up = () => { window.removeEventListener('pointermove', seek); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', seek);
    window.addEventListener('pointerup', up);
  }

  _onRulerDown(e) {
    if (e.button !== 0 || !this.pps) return;
    const r = this.ruler.getBoundingClientRect();
    const m = this._markerAt(e.clientX - r.left);
    if (!m) { this._scrub(e, this.ruler); return; }
    this.selectMarker(m);
    if (!this.transport.playing) this.transport.seek(m.t);
    let moved = false;
    const move = (ev) => {
      moved = true;
      const t = Math.max(0, this.t(ev.clientX - r.left));
      m.t = ev.shiftKey ? t : snapTime(this.transport, t);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { this.engine.markers.sort((a, b) => a.t - b.t); this.o.onEdit?.(); this.o.onSelect?.('marker', m); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ============================================================ curve lanes
  _laneGeom(canvas) {
    const h = canvas.clientHeight;
    return { t: 5, b: h - 5 };
  }

  _vToY(spec, v, g) { return g.b - ((clamp(v, spec.min, spec.max) - spec.min) / (spec.max - spec.min)) * (g.b - g.t); }
  _yToV(spec, y, g) { return clamp(spec.min + ((g.b - y) / ((g.b - g.t) || 1)) * (spec.max - spec.min), spec.min, spec.max); }
  _keyY(spec, k, g) { return spec.kind === 'color' ? (g.t + g.b) / 2 : this._vToY(spec, k.v, g); }

  _cueAtTime(trackId, t) {
    const hits = this.engine.cues.filter((c) => c.track === trackId && c.kind === 'laser' && t >= c.start && t <= c.start + c.duration);
    return hits.find((c) => c === this.selected) || hits[0] || null;
  }

  _laneHit(cue, key, x, y, canvas) {
    if (!isAnimated(cue, key)) return null;
    const spec = PARAM_BY_KEY[key];
    const g = this._laneGeom(canvas);
    let best = null, bestD = HIT * HIT;
    for (const k of cue.anim[key].keys) {
      const dx = x - this.x(cue.start + k.t * cue.duration), dy = y - this._keyY(spec, k, g);
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = k; }
    }
    return best;
  }

  _onLaneDown(e, canvas) {
    const trackId = Number(canvas.dataset.track);
    const key = canvas.dataset.lane;
    const spec = PARAM_BY_KEY[key];
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const cue = this._cueAtTime(trackId, this.t(px));
    canvas.focus();
    if (!cue) { this.curveSel = null; return; }
    if (cue !== this.selected) this.selectCue(cue);
    this.curveFocus = { trackId, key };
    const g = this._laneGeom(canvas);
    let k = this._laneHit(cue, key, px, py, canvas);
    if (!k) {
      const u = snapKeyU(this.transport, cue, (this.t(px) - cue.start) / cue.duration, e.shiftKey);
      const v = spec.kind === 'color' ? valueAt(cue, key, u) : this._yToV(spec, py, g);
      k = setKey(cue, key, u, v);
    }
    this.curveSel = { cue, key, k };
    if (!this.transport.playing) this.transport.seek(cue.start + k.t * cue.duration);
    this.o.onCurveChange?.(cue);
    const env = cue.anim[key];
    const move = (ev) => {
      const qx = ev.clientX - r.left, qy = ev.clientY - r.top;
      k.t = snapKeyU(this.transport, cue, (this.t(qx) - cue.start) / cue.duration, ev.shiftKey);
      if (spec.kind !== 'color') k.v = this._yToV(spec, qy, g);
      sortKeys(env);
      this.o.onCurveChange?.(cue);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Dropping a key onto another replaces it (one key per time).
      env.keys = env.keys.filter((o) => o === k || Math.abs(o.t - k.t) >= KEY_EPS);
      if (!this.transport.playing) this.transport.seek(cue.start + k.t * cue.duration);
      this.render();
      this.o.onCurveChange?.(cue);
      this.o.onEdit?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _onLaneDblClick(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const cue = this._cueAtTime(Number(canvas.dataset.track), this.t(e.clientX - r.left));
    if (!cue) return;
    const k = this._laneHit(cue, canvas.dataset.lane, e.clientX - r.left, e.clientY - r.top, canvas);
    if (k) this._deleteKey({ cue, key: canvas.dataset.lane, k });
  }

  _deleteKey({ cue, key, k }) {
    removeKey(cue, key, k);
    this.curveSel = null;
    this.render();
    this.o.onCurveChange?.(cue);
    this.o.onEdit?.();
  }

  // ============================================================ drag & drop
  _dropTarget(e, item) {
    const kind = item ? (item.kind === 'pattern' ? 'laser' : 'fixture') : null;
    const row = e.target.closest('.trk');
    const track = row && this.engine.tracks.find((t) => t.id === Number(row.dataset.track));
    const r = this.ruler.getBoundingClientRect();
    const t = Math.max(0, snapTime(this.transport, this.t(e.clientX - r.left)));
    return { track: track && (!kind || track.kind === kind) ? track : null, time: t };
  }

  _onDragOver(e) {
    if (!e.dataTransfer.types.includes(DND_TYPE) || !this.pps) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // The payload can't be read during dragover, so any track is a candidate;
    // the drop decides (wrong-kind tracks fall through to a new track).
    const { track, time } = this._dropTarget(e, null);
    const newRow = this.$('[data-role="newtrack"]');
    newRow?.classList.toggle('drop', !track);
    if (!this._ghost) { this._ghost = document.createElement('div'); this._ghost.className = 'tl-drop-ghost'; }
    if (track) {
      const body = this.tracksEl.querySelector(`[data-track-body="${track.id}"]`);
      if (this._ghost.parentNode !== body) body.appendChild(this._ghost);
      this._ghost.style.left = `${this.x(time)}px`;
      this._ghost.style.width = `${DEFAULT_LEN * this.pps}px`;
    } else {
      this._ghost.remove();
    }
  }

  _clearGhost() {
    this._ghost?.remove();
    this._ghost = null;
    this.$('[data-role="newtrack"]')?.classList.remove('drop');
  }

  _onDrop(e) {
    if (!e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    let item;
    try { item = JSON.parse(e.dataTransfer.getData(DND_TYPE)); } catch { this._clearGhost(); return; }
    const { track, time } = this._dropTarget(e, item);
    this._clearGhost();
    if (item.kind === 'pattern') {
      const t = track || this.engine.addTrack({ kind: 'laser', name: this._defaultTrackName('laser'), open: true });
      this.addLaserCueAt(item.key, time, t.id);
    } else if (item.kind === 'effect') {
      let t = track;
      if (!t) {
        const eff = EFFECTS.find((x) => x.key === item.key);
        const groupId = item.key === 'sparks' ? 'sparks' : 'movers';
        t = this.engine.addTrack({ kind: 'fixture', groupId, name: this._defaultTrackName('fixture', groupId, item.key === 'sparks' ? null : eff?.attr) });
      }
      this.addFixtureCueAt(item.key, time, t.id);
    }
  }

  // ================================================================= audio
  pickAudio() { this.$('[data-role="audio-file"]').click(); }

  onAudioLoaded() {
    this._wave.key = '';
    const nm = this.$('[data-role="audio-name"]');
    nm.textContent = this.audio.name || 'Song';
    nm.classList.remove('none');
    nm.title = this.audio.name || '';
    this.$('[data-role="song-label"]').textContent = this.audio.name || 'Song';
    this.fit();
  }

  /** Snap a time to the beat grid (aligned to the detected downbeat). */
  _snapTime(t) { return snapTime(this.transport, t); }

  // ================================================================= frame
  _sizeCanvas(c) {
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) { c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /** Beat grid lines in [0, w): bars strong, beats faint, thinned when crowded. */
  _grid(ctx, w, h, strong = 'rgba(120,150,200,0.30)', faint = 'rgba(90,110,150,0.12)') {
    const beat = 60 / (this.transport.bpm || 120);
    const off = this.transport.beatOffset || 0;
    const pxBeat = beat * this.pps;
    let every = 1;
    while (pxBeat * every < 6 && every < 4096) every *= 2;
    const first = Math.ceil((this.t0 - off) / beat / every) * every;
    for (let k = first; ; k += every) {
      const s = off + k * beat;
      const x = this.x(s);
      if (x > w) break;
      if (s < 0) continue;
      const bar = ((k % 4) + 4) % 4 === 0;
      ctx.strokeStyle = bar ? strong : faint;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
    }
  }

  _drawRuler() {
    const s = this._sizeCanvas(this.ruler);
    if (!s) return;
    const { ctx, w, h } = s;
    ctx.fillStyle = '#111418';
    ctx.fillRect(0, 0, w, h);
    const beat = 60 / (this.transport.bpm || 120);
    const off = this.transport.beatOffset || 0;
    const bar = beat * 4;
    const pxBar = bar * this.pps;
    let every = 1;
    while (pxBar * every < 44 && every < 4096) every *= 2;
    ctx.font = '10.5px "Segoe UI", sans-serif';
    const first = Math.max(0, Math.ceil((this.t0 - off) / bar / every) * every);
    for (let b = first; ; b += every) {
      const t = off + b * bar;
      const x = this.x(t);
      if (x > w) break;
      ctx.strokeStyle = 'rgba(140,160,200,0.45)';
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, h - 9); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
      ctx.fillStyle = '#7d8592';
      ctx.fillText(String(b + 1), x + 3, h - 11);
    }
    // markers
    for (const m of this.engine.markers) {
      const x = this.x(m.t);
      if (x < -120 || x > w) continue;
      const sel = m === this.selectedMarker;
      ctx.fillStyle = sel ? '#ffd27a' : '#e0a43a';
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x, 2); ctx.lineTo(x + 8, 5); ctx.lineTo(x, 9); ctx.fill();
      ctx.fillRect(x - 0.5, 2, 1.5, h - 2);
      ctx.fillStyle = sel ? '#ffe2a8' : '#c9b48a';
      ctx.fillText(m.name, x + 10, 10);
    }
    this._playheadLine(ctx, h, 2);
  }

  _drawWave() {
    const s = this._sizeCanvas(this.wave);
    if (!s) return;
    const { ctx, w, h } = s;
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, w, h);
    const mid = h / 2;
    if (this.transport.hasAudio) {
      const key = `${this.t0.toFixed(4)}|${this.pps.toFixed(4)}|${w}`;
      if (this._wave.key !== key) {
        this._wave.peaks = this.audio.peaksRange(this.t0, this.t0 + w / this.pps, Math.max(1, Math.floor(w)));
        this._wave.key = key;
      }
      const p = this._wave.peaks;
      if (p) {
        ctx.strokeStyle = '#3c5f94';
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          ctx.moveTo(x + 0.5, mid + p[x * 2] * mid * 0.92);
          ctx.lineTo(x + 0.5, mid + p[x * 2 + 1] * mid * 0.92);
        }
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#4f5763';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillText('Load a song to see its waveform — tempo and beats are detected for you', 10, mid + 4);
    }
    this._grid(ctx, w, h);
    this._playheadLine(ctx, h, 2);
  }

  _playheadLine(ctx, h, width) {
    const x = this.x(this.transport.time);
    ctx.strokeStyle = '#ff5c7a';
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.lineWidth = 1;
  }

  _drawLane({ canvas, track, key }) {
    const s = this._sizeCanvas(canvas);
    if (!s || !track) return;
    const { ctx, w, h } = s;
    const spec = PARAM_BY_KEY[key];
    const g = this._laneGeom(canvas);
    const focused = this.curveFocus?.trackId === track.id && this.curveFocus.key === key;
    ctx.fillStyle = focused ? '#0e1512' : '#0b0d10';
    ctx.fillRect(0, 0, w, h);
    this._grid(ctx, w, h, 'rgba(120,150,200,0.16)', 'rgba(90,110,150,0.06)');
    for (const cue of this.engine.cues) {
      if (cue.track !== track.id) continue;
      const x0 = this.x(cue.start), x1 = this.x(cue.start + cue.duration);
      if (x1 < 0 || x0 > w) continue;
      const sel = cue === this.selected;
      ctx.fillStyle = sel ? 'rgba(35,168,118,0.14)' : 'rgba(35,168,118,0.06)';
      ctx.fillRect(x0, 0, x1 - x0, h);
      const animated = isAnimated(cue, key);
      const a = Math.max(0, Math.floor(x0)), b = Math.min(w, Math.ceil(x1));
      if (spec.kind === 'color') {
        for (let x = a; x < b; x += 2) {
          const v = valueAt(cue, key, (this.t(x) - cue.start) / cue.duration);
          ctx.fillStyle = `rgb(${(v[0] * 255) | 0},${(v[1] * 255) | 0},${(v[2] * 255) | 0})`;
          ctx.fillRect(x, g.t + (g.b - g.t) * 0.3, 2, (g.b - g.t) * 0.4);
        }
      } else {
        ctx.strokeStyle = animated ? (sel ? '#5fe0ac' : 'rgba(95,224,172,0.7)') : 'rgba(95,224,172,0.3)';
        ctx.lineWidth = 1.5;
        if (!animated) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let x = a; x <= b; x += 2) {
          const v = valueAt(cue, key, clamp((this.t(x) - cue.start) / cue.duration, 0, 1));
          const y = this._vToY(spec, v, g);
          if (x === a) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }
      if (animated) {
        for (const k of cue.anim[key].keys) {
          const x = this.x(cue.start + k.t * cue.duration), y = this._keyY(spec, k, g);
          ctx.fillStyle = this.curveSel?.k === k ? '#ffffff' : '#f0a742';
          ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#0b0d10'; ctx.stroke();
        }
      }
      // clip edges
      ctx.strokeStyle = 'rgba(95,224,172,0.25)';
      ctx.beginPath(); ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, h); ctx.moveTo(x1 - 0.5, 0); ctx.lineTo(x1 - 0.5, h); ctx.stroke();
    }
    if (spec.kind !== 'color') {
      ctx.fillStyle = '#4f5763';
      ctx.font = '9.5px "Segoe UI", sans-serif';
      ctx.fillText(spec.fmt(spec.max), 3, 11);
      ctx.fillText(spec.fmt(spec.min), 3, h - 3);
    }
    this._playheadLine(ctx, h, 1);
  }

  frame() {
    if (!this.root.offsetParent || !this.bodyW) return; // workspace hidden
    if (!this.pps) this.fit();
    // Follow the playhead while playing (page forward when it leaves the view).
    const t = this.transport.time;
    if (this.transport.playing && (t > this.t0 + this.span * 0.97 || t < this.t0)) {
      this.t0 = Math.max(0, t - this.span * 0.05);
      this._viewChanged();
    }
    this._drawRuler();
    this._drawWave();
    for (const lane of this._lanes) this._drawLane(lane);
    const x = this.x(t);
    const inView = x >= 0 && x <= this.bodyW;
    this.ph.hidden = !inView; // (the line starts at the header column, set in CSS)
    if (inView) this.ph.style.transform = `translateX(${x}px)`;
  }
}
