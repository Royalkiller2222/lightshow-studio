// The top bar: project name, file + undo actions, workspace tabs, transport
// (play / stop / time / BPM), Simple-Pro switch, the output status pill (opens
// the Art-Net / sACN settings), command search and help. It owns no state of
// its own — it reads the transport/shell and calls back into the app.

import { icon } from './icons.js';
import { logoSvg } from './logo.js';
import { esc, fmtTime } from './dom.js';
import { Popover } from './overlays.js';
import { WORKSPACES } from './Shell.js';

export class TopBar {
  /**
   * @param {HTMLElement} root
   * @param {object} deps
   *   transport, shell,
   *   getDuration(): seconds shown after the playhead time,
   *   actions: { open, save, undo, redo, search, setBpm(v), playPause, stop },
   *   output: { get(): {mode, artnetIp, sacn}, set(patch) }
   */
  constructor(root, { transport, shell, getDuration, actions, output }) {
    this.root = root;
    this.transport = transport;
    this.shell = shell;
    this.getDuration = getDuration;
    this.actions = actions;
    this.output = output;
    this._last = { time: '', dur: '', playing: null };

    const tabs = WORKSPACES.map((w) => `
      <button type="button" role="tab" data-tab="${w.id}" title="${esc(w.hint)} (${w.keys})">${icon(w.icon, 'sm')}${esc(w.label)}</button>`).join('');

    root.innerHTML = `
      <div class="tb-brand" title="Lightshow Studio">
        ${logoSvg({ id: 'tbmark', cls: 'tb-mark' })}
        <span class="tb-project" data-role="project">Untitled show</span>
        <span class="tb-dirty" data-role="dirty" hidden>Edited</span>
      </div>
      <span class="tb-div"></span>
      <div class="tb-group">
        <button type="button" class="btn ghost icon" data-act="open" title="Open a show (Ctrl+O)" aria-label="Open a show">${icon('open')}</button>
        <button type="button" class="btn ghost icon" data-act="save" title="Save the show (Ctrl+S)" aria-label="Save the show">${icon('save')}</button>
        <button type="button" class="btn ghost icon" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
        <button type="button" class="btn ghost icon" data-act="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${icon('redo')}</button>
      </div>
      <div class="seg tb-tabs" role="tablist" aria-label="Workspace">${tabs}</div>
      <span class="tb-flex"></span>
      <div class="tb-transport">
        <button type="button" class="tb-play" data-act="play" title="Play / pause (Space)" aria-label="Play">${icon('play')}</button>
        <button type="button" class="btn ghost icon" data-act="stop" title="Stop and go back to the start" aria-label="Stop">${icon('stop', 'sm')}</button>
        <div class="tb-time" title="Playhead / show length"><b data-role="time">0:00.0</b><span data-role="dur">/ 0:00</span></div>
        <label class="tb-bpm" title="Tempo in beats per minute. Loading a song detects it.">
          <input type="number" min="40" max="240" step="0.1" data-role="bpm" aria-label="Tempo (BPM)" /> BPM
        </label>
      </div>
      <span class="tb-flex"></span>
      <div class="seg" role="group" aria-label="Interface detail">
        <button type="button" data-mode="simple" title="Simple: just the essentials">Simple</button>
        <button type="button" data-mode="pro" title="Pro: every control; advanced ones sit under 'More'">Pro</button>
      </div>
      <button type="button" class="tb-output" data-role="output" aria-haspopup="dialog" title="DMX output settings">
        <span class="dot"></span><span data-role="out-label">Art-Net</span><span class="ip" data-role="out-ip"></span>${icon('chev-down', 'sm')}
      </button>
      <button type="button" class="tb-search" data-act="search" title="Search every command (Ctrl+K)">${icon('search', 'sm')}<span class="lbl">Search</span><kbd>Ctrl K</kbd></button>
      <button type="button" class="btn ghost icon" data-role="help" title="Shortcuts and help (?)" aria-label="Help">${icon('help')}</button>`;

    this.$ = (s) => root.querySelector(s);
    this.bpmInput = this.$('[data-role="bpm"]');
    this.playBtn = this.$('[data-act="play"]');
    this.timeEl = this.$('[data-role="time"]');
    this.durEl = this.$('[data-role="dur"]');

    // (Tabs use data-tab, not data-ws: <body data-ws> is an ancestor of every
    // button, so closest('[data-ws]') would match the body for any click.)
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { shell.setWorkspace(tab.dataset.tab); return; }
      const mode = e.target.closest('[data-mode]');
      if (mode) { shell.setPro(mode.dataset.mode === 'pro'); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'play') actions.playPause();
      else if (act === 'stop') actions.stop();
      else if (act && actions[act]) actions[act]();
    });
    this.bpmInput.addEventListener('change', () => {
      const v = parseFloat(this.bpmInput.value);
      if (Number.isFinite(v) && v >= 20 && v <= 300) actions.setBpm(v);
      this.syncBpm();
    });
    this.bpmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.bpmInput.blur(); });

    this._buildOutputPopover();
    this._buildHelpPopover();

    transport.onChange(() => this._syncPlay());
    shell.onChange(() => this.syncShell());
    this.syncShell();
    this.syncBpm();
    this.syncOutput();
    this._syncPlay();
  }

  // ---------------------------------------------------------------- output
  _buildOutputPopover() {
    const box = document.createElement('div');
    box.innerHTML = `
      <h3>Output</h3>
      <label class="prop"><span class="name">Send Art-Net to</span><span class="ctl"><input type="text" data-out="ip" spellcheck="false" /></span></label>
      <div class="pro">
        <label class="prop"><span class="name">This app</span><span class="ctl"><select data-out="mode">
          <option value="internal">Plays the show (sends DMX)</option>
          <option value="external">Follows a console (previz)</option>
        </select></span></label>
        <label class="prop"><span class="name">sACN (E1.31)</span><span class="ctl"><input type="checkbox" class="switch" data-out="sacn" /><span class="muted small">also send multicast</span></span></label>
      </div>
      <p data-role="out-note"></p>`;
    this.outBox = box;
    const commitIp = () => {
      const ip = box.querySelector('[data-out="ip"]').value.trim() || '127.0.0.1';
      this.output.set({ artnetIp: ip });
      this.syncOutput();
    };
    box.querySelector('[data-out="ip"]').addEventListener('change', commitIp);
    box.querySelector('[data-out="ip"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') commitIp(); });
    box.querySelector('[data-out="mode"]').addEventListener('change', (e) => { this.output.set({ mode: e.target.value }); this.syncOutput(); });
    box.querySelector('[data-out="sacn"]').addEventListener('change', (e) => { this.output.set({ sacn: e.target.checked }); this.syncOutput(); });
    this.outPop = new Popover(this.$('[data-role="output"]'), box, { label: 'Output settings', onOpen: () => this.syncOutput() });
  }

  syncOutput() {
    const o = this.output.get();
    const pill = this.$('[data-role="output"]');
    const external = o.mode === 'external';
    pill.classList.toggle('listening', external);
    this.$('[data-role="out-label"]').textContent = external ? 'Following console' : (o.sacn ? 'Art-Net + sACN' : 'Art-Net');
    this.$('[data-role="out-ip"]').textContent = external ? 'universe 1' : o.artnetIp;
    pill.title = external
      ? 'Listening for a console on Art-Net universe 1 — click to change'
      : `Sending universe 1 at 40 Hz to ${o.artnetIp}${o.sacn ? ' (+ sACN)' : ''} — click to change`;
    const b = this.outBox;
    const ip = b.querySelector('[data-out="ip"]');
    if (document.activeElement !== ip) ip.value = o.artnetIp;
    b.querySelector('[data-out="mode"]').value = o.mode;
    b.querySelector('[data-out="sacn"]').checked = !!o.sacn;
    b.querySelector('[data-role="out-note"]').textContent = external
      ? 'Your console drives the 3D fixtures over Art-Net universe 1. The timeline is paused while following.'
      : 'Use 127.0.0.1 to watch the output in QLC+ on this computer, your node\'s IP for a real rig, or x.x.x.255 to broadcast. Windows Firewall must allow the app.';
  }

  // ------------------------------------------------------------------ help
  _buildHelpPopover() {
    const k = (keys, desc) => `<span class="k">${keys.split('+').map((x) => `<kbd>${esc(x)}</kbd>`).join('')}</span><span class="d">${esc(desc)}</span>`;
    const box = document.createElement('div');
    box.innerHTML = `
      <h3>Shortcuts</h3>
      <div class="keys">
        <span class="hd">Anywhere</span>
        ${k('Space', 'Play / pause')}
        ${k('Ctrl+K', 'Search every command')}
        ${k('Ctrl+Z', 'Undo')}${k('Ctrl+Y', 'Redo')}
        ${k('Ctrl+S', 'Save the show')}${k('Ctrl+O', 'Open a show')}
        ${k('Ctrl+1', 'Build workspace')}${k('Ctrl+2', 'Program workspace')}
        <span class="hd">3D view</span>
        ${k('V', 'Select tool')}${k('X', 'Move tool')}${k('C', 'Rotate tool')}
        ${k('Del', 'Delete the selected fixture or cue')}${k('Esc', 'Deselect')}
        <span class="hd">Mouse</span>
        <span class="k muted small">Left-drag</span><span class="d">Orbit the camera</span>
        <span class="k muted small">Right-drag</span><span class="d">Pan</span>
        <span class="k muted small">Scroll</span><span class="d">Zoom</span>
      </div>`;
    this.helpPop = new Popover(this.$('[data-role="help"]'), box, { label: 'Shortcuts' });
  }

  openHelp() { this.helpPop.open(); }
  openOutput() { this.outPop.open(); }

  // ------------------------------------------------------------- sync bits
  syncShell() {
    for (const b of this.root.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === this.shell.workspace));
    for (const b of this.root.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'pro') === this.shell.pro));
  }

  syncBpm() {
    if (document.activeElement !== this.bpmInput) this.bpmInput.value = Math.round(this.transport.bpm * 10) / 10;
  }

  setProject(name) {
    const el = this.$('[data-role="project"]');
    el.textContent = name || 'Untitled show';
    el.title = name || 'Untitled show';
  }

  setDirty(dirty) { this.$('[data-role="dirty"]').hidden = !dirty; }

  setHistory(canUndo, canRedo) {
    this.$('[data-act="undo"]').classList.toggle('dim', !canUndo);
    this.$('[data-act="redo"]').classList.toggle('dim', !canRedo);
  }

  _syncPlay() {
    const playing = this.transport.playing;
    if (playing === this._last.playing) return;
    this._last.playing = playing;
    this.playBtn.innerHTML = icon(playing ? 'pause' : 'play');
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  /** Per-frame: the clock readout (only touches the DOM when text changes). */
  frame() {
    const t = fmtTime(this.transport.time);
    if (t !== this._last.time) { this.timeEl.textContent = t; this._last.time = t; }
    const d = `/ ${fmtTime(this.getDuration(), false)}`;
    if (d !== this._last.dur) { this.durEl.textContent = d; this._last.dur = d; }
    this._syncPlay();
  }
}
