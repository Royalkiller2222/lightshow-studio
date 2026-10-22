// The Live workspace: perform the programmed show.
//   left   — section pads, one per timeline marker (+ Start). Click or press 1–9
//            to jump there; Pro can quantise the jump to the next beat or bar
//            so the cut lands on the music.
//   right  — masters: brightness, speed, size, blackout (B), sparks, fullscreen (F).
//   bottom — previous / play / next, what's playing now and next, and a song
//            overview you can click to jump.
// Masters live on engine.masters and are performance controls: they aren't
// saved with the show and aren't undoable.

import { icon } from './icons.js';
import { esc, fmtTime, prefs } from './dom.js';
import { snapTime } from '../timeline/snap.js';

const QUANT = [
  { key: 'now', label: 'Now' },
  { key: 'beat', label: 'Next beat' },
  { key: 'bar', label: 'Next bar' },
];

export class LivePanel {
  /** roots: { sections, masters, bar }; deps: transport, engine, getLength(), onSpark(on), shell */
  constructor(roots, { transport, engine, getLength, onSpark, shell }) {
    this.r = roots;
    this.transport = transport;
    this.engine = engine;
    this.getLength = getLength;
    this.onSpark = onSpark;
    this.quant = prefs.get('live.quant', 'now');
    this.pending = null; // { t, at, i } a queued jump
    this._sig = '';
    this._last = {};

    // ---- sections (left)
    roots.sections.innerHTML = `
      <div class="ph"><span class="ph-title">Sections</span>
        <button type="button" class="btn ghost icon sm" data-act="hide" title="Hide" aria-label="Hide the sections">${icon('panel-left', 'sm')}</button></div>
      <div class="pbody">
        <div class="lv-pads" data-role="pads"></div>
        <div class="pro lv-quant">
          <div class="sec-title">Jump on</div>
          <div class="seg" role="group" aria-label="Jump timing">${QUANT.map((q) => `<button type="button" data-quant="${q.key}">${q.label}</button>`).join('')}</div>
        </div>
        <div class="tip" data-role="pad-tip" style="margin-top:12px">${icon('help', 'sm')}<div>Pads come from the markers on your timeline. Add them in Program with <b>M</b> (Intro, Verse, Drop…). Press <b>1–9</b> to jump.</div></div>
      </div>`;
    roots.sections.querySelector('[data-act="hide"]').addEventListener('click', () => shell.togglePanel('left', false));
    roots.sections.addEventListener('click', (e) => {
      const pad = e.target.closest('[data-pad]');
      if (pad) { this.jump(Number(pad.dataset.pad)); return; }
      const q = e.target.closest('[data-quant]');
      if (q) { this.quant = q.dataset.quant; prefs.set('live.quant', this.quant); this._syncQuant(); }
    });

    // ---- masters (right)
    const fader = (k, label, min, max, step, title) => `
      <label class="lv-fader" title="${title}">
        <span class="lv-fname">${label}<span class="lv-fval" data-mval="${k}"></span></span>
        <input type="range" min="${min}" max="${max}" step="${step}" data-master="${k}" aria-label="${label}" />
      </label>`;
    roots.masters.innerHTML = `
      <div class="ph"><span class="ph-title">Masters</span>
        <button type="button" class="btn ghost icon sm" data-act="hide" title="Hide" aria-label="Hide the masters">${icon('panel-right', 'sm')}</button></div>
      <div class="pbody">
        ${fader('dimmer', 'Brightness', 0, 1, 0.01, 'Scales every light and the laser (double-click to reset)')}
        ${fader('speed', 'Speed', 0.25, 2, 0.05, 'Speeds effects up or down (double-click to reset)')}
        ${fader('size', 'Size', 0, 2, 0.05, 'Laser size and how far movers swing (double-click to reset)')}
        <button type="button" class="btn lv-blackout" data-act="blackout" title="Blackout: kill all light and laser output (B)">${icon('power')}Blackout <kbd>B</kbd></button>
        <button type="button" class="btn spark-btn lv-big" data-act="spark" title="Hold to fire every cold-spark machine">${icon('sparkles')}Hold for sparks</button>
        <button type="button" class="btn lv-big" data-act="fullscreen" title="Fill the screen (F)">${icon('expand')}Fullscreen <kbd>F</kbd></button>
      </div>`;
    roots.masters.querySelector('[data-act="hide"]').addEventListener('click', () => shell.togglePanel('right', false));
    roots.masters.addEventListener('input', (e) => {
      const k = e.target.dataset.master;
      if (k) { this.engine.masters[k] = parseFloat(e.target.value); this.syncMasters(); }
    });
    roots.masters.addEventListener('dblclick', (e) => {
      const k = e.target.dataset.master;
      if (k) { this.engine.masters[k] = 1; this.syncMasters(); }
    });
    roots.masters.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'blackout') this.toggleBlackout();
      else if (act === 'fullscreen') this.toggleFullscreen();
    });
    const spark = roots.masters.querySelector('[data-act="spark"]');
    const fire = (on) => { spark.classList.toggle('on', on); this.onSpark(on); };
    spark.addEventListener('pointerdown', (e) => { spark.setPointerCapture(e.pointerId); fire(true); });
    spark.addEventListener('pointerup', () => fire(false));
    spark.addEventListener('lostpointercapture', () => fire(false));

    // ---- live bar (bottom)
    roots.bar.innerHTML = `
      <div class="lv-bar">
        <div class="lv-transport">
          <button type="button" class="btn ghost icon" data-act="prev" title="Previous section (←)" aria-label="Previous section">${icon('prev')}</button>
          <button type="button" class="tb-play lv-play" data-act="play" title="Play / pause (Space)" aria-label="Play">${icon('play')}</button>
          <button type="button" class="btn ghost icon" data-act="next" title="Next section (→)" aria-label="Next section">${icon('next')}</button>
        </div>
        <div class="lv-now">
          <div class="lv-label">Now</div>
          <div class="lv-name" data-role="now">—</div>
          <div class="lv-next" data-role="next"></div>
        </div>
        <div class="lv-overview">
          <div class="lv-times"><span data-role="time">0:00</span><span data-role="len">0:00</span></div>
          <div class="lv-prog" data-role="prog" title="Click to jump"><div class="lv-fill" data-role="fill"></div></div>
        </div>
      </div>`;
    roots.bar.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'play') this.transport.toggle();
      else if (act === 'prev') this.step(-1);
      else if (act === 'next') this.step(1);
    });
    roots.bar.querySelector('[data-role="prog"]').addEventListener('pointerdown', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.transport.seek(Math.max(0, ((e.clientX - r.left) / r.width) * this.getLength()));
    });

    this._syncQuant();
    this.syncMasters();
  }

  /** Pads: Start (if no marker at 0) + every marker, in time order. */
  sections() {
    const ms = this.engine.markers.slice().sort((a, b) => a.t - b.t);
    return ms.length && ms[0].t < 0.05 ? ms : [{ t: 0, name: 'Start' }, ...ms];
  }

  current(time = this.transport.time) {
    const s = this.sections();
    let i = 0;
    for (let k = 0; k < s.length; k++) if (s[k].t <= time + 1e-3) i = k;
    return i;
  }

  /** Jump to section i — now, or on the next beat / bar while playing. */
  jump(i) {
    const s = this.sections()[i];
    if (!s) return;
    if (this.quant === 'now' || !this.transport.playing) {
      this.pending = null;
      this.transport.seek(s.t);
      if (!this.transport.playing) this.transport.play();
      return;
    }
    const t = this.transport.time;
    const division = this.quant === 'bar' ? 4 : 1;
    let at = snapTime(this.transport, t, division);
    if (at <= t + 0.01) at += (60 / (this.transport.bpm || 120)) * division;
    this.pending = { t: s.t, at, i };
  }

  step(d) {
    const s = this.sections();
    const cur = this.current();
    // "Previous" within the first two seconds of a section goes to the one before.
    const i = d < 0 && this.transport.time - s[cur].t > 2 ? cur : cur + d;
    this.jump(Math.max(0, Math.min(s.length - 1, i)));
  }

  toggleBlackout() {
    this.engine.masters.blackout = !this.engine.masters.blackout;
    this.syncMasters();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  syncMasters() {
    const m = this.engine.masters;
    for (const el of this.r.masters.querySelectorAll('[data-master]')) {
      if (document.activeElement !== el) el.value = m[el.dataset.master];
    }
    const pct = (v) => `${Math.round(v * 100)}%`;
    this.r.masters.querySelector('[data-mval="dimmer"]').textContent = pct(m.dimmer);
    this.r.masters.querySelector('[data-mval="speed"]').textContent = `${m.speed.toFixed(2)}×`;
    this.r.masters.querySelector('[data-mval="size"]').textContent = pct(m.size);
    this.r.masters.querySelector('[data-act="blackout"]').classList.toggle('on', m.blackout);
    document.body.classList.toggle('blackout', m.blackout);
  }

  _syncQuant() {
    for (const b of this.r.sections.querySelectorAll('[data-quant]')) b.setAttribute('aria-pressed', String(b.dataset.quant === this.quant));
  }

  _renderPads(s) {
    this.r.sections.querySelector('[data-role="pads"]').innerHTML = s.map((x, i) => `
      <button type="button" class="lv-pad" data-pad="${i}" title="Jump to ${esc(x.name)}${i < 9 ? ` (${i + 1})` : ''}">
        <span class="lv-key">${i < 9 ? i + 1 : ''}</span>
        <span class="lv-pname">${esc(x.name)}</span>
        <span class="lv-ptime">${fmtTime(x.t, false)}</span>
      </button>`).join('');
    this.r.sections.querySelector('[data-role="pad-tip"]').hidden = s.length > 1;
    this._renderTicks(s);
  }

  _renderTicks(s) {
    const prog = this.r.bar.querySelector('[data-role="prog"]');
    for (const t of prog.querySelectorAll('.lv-tick')) t.remove();
    const len = this.getLength() || 1;
    for (const x of s) {
      const el = document.createElement('div');
      el.className = 'lv-tick';
      el.style.left = `${(x.t / len) * 100}%`;
      el.title = x.name;
      prog.appendChild(el);
    }
  }

  frame() {
    if (!this.r.bar.offsetParent) return; // not in Live
    const s = this.sections();
    const len = this.getLength();
    const sig = `${s.map((x) => `${x.name}@${x.t.toFixed(2)}`).join('|')}|${len.toFixed(1)}`;
    if (sig !== this._sig) { this._sig = sig; this._renderPads(s); }

    const t = this.transport.time;
    if (this.pending && (!this.transport.playing || t >= this.pending.at)) {
      this.transport.seek(this.pending.t);
      this.pending = null;
    }
    const cur = this.current(t);
    for (const pad of this.r.sections.querySelectorAll('[data-pad]')) {
      const i = Number(pad.dataset.pad);
      pad.classList.toggle('on', i === cur);
      pad.classList.toggle('queued', !!this.pending && this.pending.i === i);
    }
    const next = s[cur + 1];
    const set = (role, text) => { const el = this.r.bar.querySelector(`[data-role="${role}"]`); if (el.textContent !== text) el.textContent = text; };
    set('now', s[cur]?.name || '—');
    set('next', this.pending ? `Jumping to ${s[this.pending.i].name} in ${Math.max(0, this.pending.at - t).toFixed(1)} s`
      : next ? `Next: ${next.name} in ${fmtTime(Math.max(0, next.t - t))}` : 'Last section');
    set('time', fmtTime(t, false));
    set('len', fmtTime(len, false));
    this.r.bar.querySelector('[data-role="fill"]').style.width = `${Math.min(100, (t / (len || 1)) * 100)}%`;
    const playing = this.transport.playing;
    if (playing !== this._last.playing) {
      this._last.playing = playing;
      this.r.bar.querySelector('[data-act="play"]').innerHTML = icon(playing ? 'pause' : 'play');
    }
  }
}
