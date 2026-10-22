// The right-hand panel: one place to edit whatever is selected.
//   fixture selected  -> name, position, facing, mirror twin, DMX patch (Pro)
//   cue selected      -> the CueInspector (fixture effect or laser Key Effects)
//   nothing selected  -> Build: the venue (room size, rig summary)
//                        Program: the show (song, tempo, cue summary)
// Views are plain HTML re-rendered when what they show changes; live values
// (a fixture being dragged by the gizmo) update in place each frame.

import * as THREE from 'three';
import { icon, fixtureIcon } from './icons.js';
import { esc, more, fmtTime } from './dom.js';
import { mirrorX } from '../placement/placement.js';

const DEG = 180 / Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;

export class Inspector {
  /**
   * deps: shell, patch, rig, room, editTools, cueInspector, transport, audio,
   *       engine, fixtureType(key), getProjectName(), onCommit(),
   *       onRoomChange(w, d, h), onRemoveFixture(fx), onSelectFixture(fx),
   *       onLoadSong(), groups (fixture groups for track targets),
   *       onTrackChange(track), onMoveTrack(track, ±1), onDeleteTrack(track),
   *       onMarkerChange(marker), onDeleteMarker(marker)
   */
  constructor(root, deps) {
    this.root = root;
    this.d = deps;
    this.target = null; // { kind: 'fixture', fx } | { kind: 'cue', cue } | null
    this._sig = '';
    this._v = new THREE.Vector3();

    root.innerHTML = `
      <div class="ph">
        <span class="ph-title" data-role="title">Inspector</span>
        <button type="button" class="btn ghost icon sm" data-act="hide" title="Hide the inspector (double-click the divider to bring it back)" aria-label="Hide the inspector">${icon('panel-right', 'sm')}</button>
      </div>
      <div class="pbody" data-role="body"></div>`;
    this.body = root.querySelector('[data-role="body"]');
    root.querySelector('[data-act="hide"]').addEventListener('click', () => deps.shell.togglePanel('right', false));

    this.body.addEventListener('change', (e) => this._onChange(e));
    this.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[type="text"], input[type="number"]')) e.target.blur();
    });
    this.body.addEventListener('click', (e) => this._onClick(e));
  }

  /** Show a target (or the workspace default when null). */
  show(target) {
    this.target = target;
    this._sig = '';
    this._render();
  }

  /** Re-render if the shown object changed shape (rename, repatch, counts…). */
  refresh() { this._sig = ''; this._render(); }

  _signature() {
    const t = this.target;
    const d = this.d;
    if (t?.kind === 'cue') return `cue:${t.cue.id}`;
    if (t?.kind === 'track') {
      const tr = t.track;
      const n = d.engine.cues.filter((c) => c.track === tr.id).length;
      return `track:${tr.id}|${tr.name}|${tr.groupId}|${tr.mute}|${tr.solo}|${d.engine.tracks.indexOf(tr)}|${n}`;
    }
    if (t?.kind === 'marker') return `marker:${t.marker.name}|${t.marker.t.toFixed(3)}|${d.engine.markers.indexOf(t.marker)}`;
    if (t?.kind === 'fixture') {
      const e = d.patch.entries.find((x) => x.fixture === t.fx);
      const flags = d.patch.collisions();
      const i = d.patch.entries.indexOf(e);
      return `fx:${e ? `${e.label}|${e.universe}|${e.startAddress}|${flags[i]}` : 'gone'}|${t.fx.mirror ? d.rig.labelOf(t.fx.mirror) : '-'}`;
    }
    const ws = d.shell.workspace;
    if (ws === 'build') {
      const s = d.room.size;
      return `venue:${s.width}x${s.depth}x${s.height}|${d.patch.entries.length}|${d.patch.entries.reduce((n, e) => n + e.channelCount, 0)}`;
    }
    const laser = d.engine.cues.filter((c) => c.kind === 'laser').length;
    return `show:${d.audio.name || ''}|${d.transport.hasAudio ? d.transport.duration.toFixed(1) : '-'}|${d.transport.bpm}|${(d.transport.beatOffset || 0).toFixed(3)}|${laser}|${d.engine.cues.length}|${d.engine.tracks.length}|${d.engine.markers.length}|${d.getProjectName()}`;
  }

  _render() {
    const sig = this._signature();
    if (sig === this._sig) return;
    this._sig = sig;
    const t = this.target;
    if (t?.kind === 'cue') {
      if (this.d.cueInspector.el.parentNode !== this.body) {
        this.body.replaceChildren(this.d.cueInspector.el);
      }
      this.d.cueInspector.show(t.cue);
      return;
    }
    this.d.cueInspector.show(null);
    if (t?.kind === 'track') {
      if (!this.d.engine.tracks.includes(t.track)) { this.target = null; this._sig = ''; this._render(); return; }
      this.body.innerHTML = this._trackHtml(t.track);
      return;
    }
    if (t?.kind === 'marker') {
      if (!this.d.engine.markers.includes(t.marker)) { this.target = null; this._sig = ''; this._render(); return; }
      this.body.innerHTML = this._markerHtml(t.marker);
      return;
    }
    if (t?.kind === 'fixture') {
      if (!this.d.patch.entries.some((e) => e.fixture === t.fx)) { this.target = null; this._sig = ''; this._render(); return; }
      this.body.innerHTML = this._fixtureHtml(t.fx);
      this._fxLive(true);
      return;
    }
    this.body.innerHTML = this.d.shell.workspace === 'build' ? this._venueHtml() : this._showHtml();
  }

  // ---------------------------------------------------------------- fixture
  _fixtureHtml(fx) {
    const d = this.d;
    const idx = d.patch.entries.findIndex((e) => e.fixture === fx);
    const e = d.patch.entries[idx];
    const type = d.fixtureType(fx.typeKey);
    const clash = d.patch.collisions()[idx];
    const twin = fx.mirror;
    const num = (key, label, title) => `<label title="${title}"><span>${label}</span><input type="number" step="0.5" data-fx="${key}" aria-label="${title}" /></label>`;
    const angle = (key, label) => `<label class="prop"><span class="name">${label}</span><span class="ctl"><input type="number" step="45" data-fx="${key}" style="width:80px" /><span class="muted small">degrees</span></span></label>`;
    const end = e.startAddress + e.channelCount - 1;

    const dmx = e.channelCount === 0
      ? '<p class="muted small" style="margin:0">A prop — it takes no DMX channels.</p>'
      : `<label class="prop"><span class="name">Universe</span><span class="ctl"><input type="number" min="1" data-fx="universe" value="${e.universe}" style="width:80px" /></span></label>
         <label class="prop"><span class="name">Start address</span><span class="ctl"><input type="number" min="1" max="512" data-fx="address" value="${e.startAddress}" style="width:80px" /></span></label>
         <div class="prop"><span class="name">Channels</span><span class="ctl muted">${e.startAddress}–${end} · ${e.channelCount} ch</span></div>
         <div class="prop"><span class="name">Profile</span><span class="ctl muted small">${esc(e.profileName)}</span></div>
         ${clash ? `<p class="warn-text small" style="display:flex;gap:6px;margin:4px 0 0">${icon('warning', 'sm')}Shares channels with another fixture.</p>` : ''}`;

    return `
      <div class="ihead">
        <div class="badge">${fixtureIcon(fx.typeKey)}</div>
        <div class="txt">
          <div class="kicker">${esc(type ? type.label : 'Fixture')}</div>
          <input type="text" class="ititle-input" data-fx="label" value="${esc(e.label)}" aria-label="Fixture name" spellcheck="false" />
        </div>
      </div>
      <div class="sec">
        <div class="sec-title">Position <span class="muted" style="font-weight:400">metres</span></div>
        <div class="xyz">
          ${num('px', 'X', 'Left / right (0 = centre line)')}
          ${num('py', 'Y', 'Height above the floor')}
          ${num('pz', 'Z', 'Back / front (negative = towards the back wall)')}
        </div>
      </div>
      <div class="sec">
        ${angle('ry', 'Facing')}
        ${more('fixture-rotation', angle('rx', 'Tilt') + angle('rz', 'Roll'), 'More rotation')}
      </div>
      <div class="sec">
        <div class="sec-title">Mirror</div>
        ${twin
          ? `<div class="prop"><span class="name">Twin</span><span class="ctl"><button type="button" class="btn sm" data-act="twin" title="Select the twin">${icon('link', 'sm')}${esc(d.rig.labelOf(twin))}</button></span></div>
             <p class="muted small" style="margin:2px 0 0">Moving or rotating one mirrors the other across the centre line.</p>
             <div class="pro" style="margin-top:6px"><button type="button" class="btn sm ghost" data-act="unlink">Unlink the pair</button></div>`
          : '<p class="muted small" style="margin:0">Not mirrored. Turn on "Place mirrored pairs" in the library to place fixtures as twins.</p>'}
      </div>
      <div class="sec pro">
        <div class="sec-title">DMX</div>
        ${dmx}
      </div>
      <div class="ifoot"><button type="button" class="btn danger" data-act="remove">${icon('trash', 'sm')}Remove fixture</button></div>`;
  }

  /** Copy the live position/rotation into the fields (skips the one being typed in). */
  _fxLive(force = false) {
    const fx = this.target?.fx;
    if (!fx) return;
    fx.getPosition(this._v);
    const rot = fx.getRotation();
    const vals = { px: this._v.x, py: this._v.y, pz: this._v.z, rx: rot[0] * DEG, ry: rot[1] * DEG, rz: rot[2] * DEG };
    for (const [k, v] of Object.entries(vals)) {
      const el = this.body.querySelector(`[data-fx="${k}"]`);
      if (!el || (!force && document.activeElement === el)) continue;
      const text = String(r2(v));
      if (el.value !== text) el.value = text;
    }
  }

  _applyTransform(fx) {
    const q = (k) => parseFloat(this.body.querySelector(`[data-fx="${k}"]`)?.value);
    const p = new THREE.Vector3(q('px'), q('py'), q('pz'));
    if ([p.x, p.y, p.z].every(Number.isFinite)) {
      fx.setPosition(p);
      if (fx.mirror) fx.mirror.setPosition(mirrorX({ x: p.x, y: p.y, z: p.z }));
    }
    const cur = fx.getRotation();
    const rot = ['rx', 'ry', 'rz'].map((k, i) => { const v = q(k); return Number.isFinite(v) ? v / DEG : cur[i]; });
    fx.setRotation(rot);
    // Mirror across the venue centre (x=0): keep pitch, negate yaw and roll.
    if (fx.mirror) fx.mirror.setRotation([rot[0], -rot[1], -rot[2]]);
    this.d.editTools.refresh();
  }

  // ------------------------------------------------------------------ track
  _trackHtml(tr) {
    const d = this.d;
    const laser = tr.kind === 'laser';
    const n = d.engine.cues.filter((c) => c.track === tr.id).length;
    const i = d.engine.tracks.indexOf(tr);
    const groups = d.groups.map((g) => `<option value="${g.id}"${g.id === tr.groupId ? ' selected' : ''}>${esc(g.label)}</option>`).join('');
    return `
      <div class="ihead">
        <div class="badge ${laser ? 'laser' : 'fixture'}">${icon(laser ? 'laser' : 'moving-head')}</div>
        <div class="txt">
          <div class="kicker">${laser ? 'Laser track' : 'Fixture track'}</div>
          <input type="text" class="ititle-input" data-trk="name" value="${esc(tr.name)}" aria-label="Track name" spellcheck="false" />
        </div>
      </div>
      <div class="sec">
        ${laser ? '' : `<label class="prop"><span class="name">Fixtures</span><span class="ctl"><select data-trk="group">${groups}</select></span></label>`}
        <label class="prop"><span class="name">Mute</span><span class="ctl"><input type="checkbox" class="switch" data-trk="mute" ${tr.mute ? 'checked' : ''} /></span></label>
        <label class="prop"><span class="name">Solo</span><span class="ctl"><input type="checkbox" class="switch" data-trk="solo" ${tr.solo ? 'checked' : ''} /><span class="muted small">play only soloed tracks</span></span></label>
        <div class="prop"><span class="name">Cues</span><span class="ctl">${n}</span></div>
      </div>
      <div class="sec">
        <div class="sec-title">Order</div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn sm" data-act="trk-up" ${i === 0 ? 'disabled' : ''}>${icon('up', 'sm')}Move up</button>
          <button type="button" class="btn sm" data-act="trk-down" ${i === d.engine.tracks.length - 1 ? 'disabled' : ''}>${icon('down', 'sm')}Move down</button>
        </div>
        <p class="muted small" style="margin:6px 0 0">${laser ? 'When two laser cues overlap, the higher track is the one you see.' : 'Where tracks drive the same fixtures, the higher track wins colour and position; brightness takes the brightest.'}</p>
      </div>
      <div class="ifoot"><button type="button" class="btn danger" data-act="trk-delete">${icon('trash', 'sm')}Delete track${n ? ` and its ${n} cue${n === 1 ? '' : 's'}` : ''}</button></div>`;
  }

  // ----------------------------------------------------------------- marker
  _markerHtml(m) {
    const t = this.d.transport;
    const beat = 60 / (t.bpm || 120);
    const bar = Math.floor((m.t - (t.beatOffset || 0)) / (beat * 4)) + 1;
    return `
      <div class="ihead">
        <div class="badge" style="color:var(--warn)">${icon('flag')}</div>
        <div class="txt">
          <div class="kicker">Marker</div>
          <input type="text" class="ititle-input" data-mk="name" value="${esc(m.name)}" aria-label="Marker name" spellcheck="false" />
        </div>
      </div>
      <div class="sec">
        <div class="prop"><span class="name">Position</span><span class="ctl">${fmtTime(m.t)} <span class="muted small">bar ${Math.max(1, bar)}</span></span></div>
        <label class="prop pro"><span class="name">Exact time</span><span class="ctl"><input type="number" step="0.01" min="0" data-mk="t" value="${r2(m.t)}" style="width:90px" /><span class="muted small">seconds</span></span></label>
        <div style="margin-top:8px"><button type="button" class="btn sm" data-act="mk-go">${icon('play', 'sm')}Go to marker</button></div>
      </div>
      <div class="tip">${icon('help', 'sm')}<div>Markers name the sections of your song (Intro, Drop…). Drag them on the ruler; double-click the ruler to add one. In the Live workspace they'll become pads.</div></div>
      <div class="ifoot"><button type="button" class="btn danger" data-act="mk-delete">${icon('trash', 'sm')}Delete marker</button></div>`;
  }

  // ------------------------------------------------------------------ venue
  _venueHtml() {
    const d = this.d;
    const s = d.room.size;
    const n = d.patch.entries.length;
    const ch = d.patch.entries.reduce((sum, e) => sum + e.channelCount, 0);
    const dim = (k, label, v, title) => `<label title="${title}"><span>${label}</span><input type="number" min="3" max="200" step="0.5" data-room="${k}" value="${v}" /></label>`;
    return `
      <div class="ihead">
        <div class="badge">${icon('build')}</div>
        <div class="txt"><div class="kicker">Venue</div><div class="ititle">Room and rig</div></div>
      </div>
      <div class="sec">
        <div class="sec-title">Room size <span class="muted" style="font-weight:400">metres</span></div>
        <div class="xyz">
          ${dim('w', 'W', s.width, 'Width')}
          ${dim('d', 'D', s.depth, 'Depth')}
          ${dim('h', 'H', s.height, 'Height')}
        </div>
      </div>
      <div class="sec">
        <div class="sec-title">Rig</div>
        <div class="prop"><span class="name">Fixtures</span><span class="ctl">${n}</span></div>
        <div class="prop pro"><span class="name">DMX channels</span><span class="ctl">${ch} <span class="muted small">used</span></span></div>
      </div>
      <div class="tip">${icon('help', 'sm')}<div>Drag fixtures from the library into the room, or click <b>+</b> on a card. Click a fixture in the view to edit it here.</div></div>`;
  }

  // ------------------------------------------------------------------- show
  _showHtml() {
    const d = this.d;
    const t = d.transport;
    const laser = d.engine.cues.filter((c) => c.kind === 'laser').length;
    const fixture = d.engine.cues.length - laser;
    return `
      <div class="ihead">
        <div class="badge">${icon('program')}</div>
        <div class="txt"><div class="kicker">Show</div><div class="ititle">${esc(d.getProjectName())}</div></div>
      </div>
      <div class="sec">
        <div class="sec-title">Song</div>
        <div class="prop"><span class="name">Track</span><span class="ctl ${d.audio.name ? '' : 'muted'}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.audio.name || 'None — the clock runs free')}</span></div>
        ${t.hasAudio ? `<div class="prop"><span class="name">Length</span><span class="ctl">${fmtTime(t.duration, false)}</span></div>` : ''}
        <div class="prop"><span class="name">Tempo</span><span class="ctl">${r2(t.bpm)} BPM</span></div>
        <label class="prop pro"><span class="name">First beat at</span><span class="ctl"><input type="number" step="0.01" min="0" data-show="offset" value="${r2(t.beatOffset || 0)}" style="width:80px" /><span class="muted small">seconds</span></span></label>
        <div style="margin-top:8px"><button type="button" class="btn sm" data-act="load-song">${icon('music', 'sm')}${t.hasAudio ? 'Replace song' : 'Load song'}</button></div>
      </div>
      <div class="sec">
        <div class="sec-title">Timeline</div>
        <div class="prop"><span class="name">Tracks</span><span class="ctl">${d.engine.tracks.length}</span></div>
        <div class="prop"><span class="name">Laser cues</span><span class="ctl">${laser}</span></div>
        <div class="prop"><span class="name">Looks</span><span class="ctl">${fixture}</span></div>
        <div class="prop"><span class="name">Markers</span><span class="ctl">${d.engine.markers.length}</span></div>
      </div>
      <div class="tip">${icon('help', 'sm')}<div>Drag a laser pattern or an effect from the library onto a track (or below the tracks to start a new one), then click the clip to edit it here. Click a track's name to edit the track.</div></div>`;
  }

  // ------------------------------------------------------------------ events
  _onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const tr = this.target?.track;
    const mk = this.target?.marker;
    if (tr && act === 'trk-up') return this.d.onMoveTrack(tr, -1);
    if (tr && act === 'trk-down') return this.d.onMoveTrack(tr, 1);
    if (tr && act === 'trk-delete') return this.d.onDeleteTrack(tr);
    if (mk && act === 'mk-go') return this.d.transport.seek(mk.t);
    if (mk && act === 'mk-delete') return this.d.onDeleteMarker(mk);
    const fx = this.target?.fx;
    if (act === 'remove' && fx) this.d.onRemoveFixture(fx);
    else if (act === 'twin' && fx?.mirror) this.d.onSelectFixture(fx.mirror);
    else if (act === 'unlink' && fx?.mirror) {
      fx.mirror.mirror = null;
      fx.mirror = null;
      this.d.onCommit();
      this.refresh();
    } else if (act === 'load-song') this.d.onLoadSong();
  }

  _onChange(e) {
    const el = e.target;
    const d = this.d;
    if (el.dataset.room) {
      const v = (k) => parseFloat(this.body.querySelector(`[data-room="${k}"]`).value);
      const w = v('w'), dd = v('d'), h = v('h');
      if ([w, dd, h].every((x) => Number.isFinite(x) && x >= 3)) d.onRoomChange(w, dd, h);
      this.refresh();
      return;
    }
    if (el.dataset.trk && this.target?.track) {
      const tr = this.target.track;
      const k = el.dataset.trk;
      if (k === 'name') { const v = el.value.trim(); if (v) tr.name = v; }
      else if (k === 'group') tr.groupId = el.value;
      else if (k === 'mute') tr.mute = el.checked;
      else if (k === 'solo') tr.solo = el.checked;
      d.onTrackChange(tr);
      this._render();
      return;
    }
    if (el.dataset.mk && this.target?.marker) {
      const m = this.target.marker;
      if (el.dataset.mk === 'name') { const v = el.value.trim(); if (v) m.name = v; }
      else { const v = parseFloat(el.value); if (Number.isFinite(v) && v >= 0) m.t = v; }
      d.onMarkerChange(m);
      this._render();
      return;
    }
    if (el.dataset.show === 'offset') {
      const off = parseFloat(el.value);
      if (Number.isFinite(off) && off >= 0) { d.transport.beatOffset = off; d.onCommit(); }
      this.refresh();
      return;
    }
    const fx = this.target?.fx;
    const k = el.dataset.fx;
    if (!fx || !k) return;
    const idx = d.patch.entries.findIndex((x) => x.fixture === fx);
    if (k === 'label') {
      const name = el.value.trim();
      if (name) d.patch.rename(idx, name);
      else el.value = d.patch.entries[idx].label;
    } else if (k === 'universe' || k === 'address') {
      d.patch.repatch(idx, k === 'universe' ? { universe: parseInt(el.value, 10) } : { startAddress: parseInt(el.value, 10) });
    } else {
      this._applyTransform(fx);
    }
    d.onCommit();
    this._render();
  }

  /** Per-frame: live fixture transform; re-render when the shown data changed. */
  frame() {
    if (!this.d.shell.isOpen('right')) return;
    this._render();
    if (this.target?.kind === 'fixture') this._fxLive();
  }
}
