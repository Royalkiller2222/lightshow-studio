import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { UniverseHub } from './dmx/UniverseHub.js';
import { hazeUniform } from './viz/beam.js';
import { Room } from './viz/Room.js';
import { HouseLight } from './viz/HouseLight.js';
import { MovingHead } from './fixtures/MovingHead.js';
import { ColdSparkMachine } from './fixtures/ColdSpark.js';
import { ShowEngine } from './show/ShowEngine.js';
import { Patch } from './patch/Patch.js';
import { PatchPanel } from './patch/PatchPanel.js';
import { FIXTURE_TYPES, fixtureType } from './fixtures/registry.js';
import { PlacementController } from './placement/PlacementController.js';
import { EditTools } from './placement/EditTools.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { analyzeTempo } from './audio/bpm.js';
import { Transport } from './timeline/Transport.js';
import { TimelinePanel } from './timeline/TimelinePanel.js';
import { LaserRig } from './laser/LaserRig.js';
import { loadAnim } from './laser/envelopes.js';

// ---------- Renderer / scene ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0c);
// Haze drives this: more haze => thicker air, so beam cones read as volume.
// Beam materials don't sample fog, so cones stay bright while the room behind
// them fades — the "light scattering through haze" look.
scene.fog = new THREE.FogExp2(0x15151f, 0);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(11, 7.5, 14);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52;

// Room fill light — the "Room brightness" slider drives its intensity so a
// dark venue can be lit enough to see geometry without flooding the beams.
const ambient = new THREE.AmbientLight(0x6a6a78, 0.9);
scene.add(ambient);

// ---------- DMX core ----------
const hub = new UniverseHub();

// ---------- Venue ----------
const room = new Room(scene);
room.build(14, 18, 6);
const houseLight = new HouseLight(scene);

// ---------- Fixtures + patch ----------
const fixtures = [];
const patch = new Patch();

for (let i = 0; i < 4; i++) {
  const mh = new MovingHead(hub, scene, {
    universe: 1,
    startAddress: 1 + i * 9, // 1, 10, 19, 28
    position: new THREE.Vector3(-4.5 + i * 3, 5.4, -3),
    beamLength: 12,
  });
  mh.typeKey = 'moving-head';
  fixtures.push(mh);
  patch.addFixture(mh, `Moving head ${i + 1}`);
}

const sparkL = new ColdSparkMachine(hub, scene, { universe: 1, startAddress: 37, position: new THREE.Vector3(-3, 0, -6.5) });
const sparkR = new ColdSparkMachine(hub, scene, { universe: 1, startAddress: 37, position: new THREE.Vector3(3, 0, -6.5) });
sparkL.typeKey = 'cold-spark'; sparkR.typeKey = 'cold-spark';
fixtures.push(sparkL, sparkR);
patch.addFixture(sparkL, 'Cold spark L');
patch.addFixture(sparkR, 'Cold spark R');

// Per-type counters seed naming for fixtures added later via the UI.
const typeCounters = { 'moving-head': 4, 'cold-spark': 2 };

function spawnFixture(typeKey, position = null) {
  const type = fixtureType(typeKey);
  if (!type) return null;
  const n = (typeCounters[typeKey] = (typeCounters[typeKey] ?? 0) + 1);

  // No explicit spot (the Add button): fan across the room so they don't stack.
  let pos = position;
  if (!pos) {
    const x = (((n - 1) % 8) - 3.5) * 1.6;
    pos = type.onTruss ? new THREE.Vector3(x, 5.4, -3) : new THREE.Vector3(x, 0, -6.5);
  }

  const fx = type.create(hub, scene, { universe: 1, position: pos });
  fx.typeKey = typeKey;

  // Props (0 channels) take no DMX address; everything else auto-patches.
  if (fx.channelCount > 0) {
    const addr = patch.nextFreeAddress(1, fx.channelCount);
    if (addr == null) {
      fx.dispose?.();
      typeCounters[typeKey]--;
      return null; // universe 1 is full
    }
    fx.startAddress = addr;
  }
  fixtures.push(fx);
  patch.addFixture(fx, `${type.label} ${n}`);
  return fx;
}

// Place one fixture per point (drag-drop). Two points = a mirror pair: link
// them so repositioning one moves the other symmetrically.
function placeFixtures(typeKey, points) {
  const made = points.map((p) => spawnFixture(typeKey, new THREE.Vector3(p.x, p.y, p.z))).filter(Boolean);
  if (made.length === 2) {
    made[0].mirror = made[1];
    made[1].mirror = made[0];
  }
  history?.record();
}

function removeFixtureAt(index) {
  const entry = patch.entries[index];
  if (!entry) return;
  const fx = entry.fixture;
  patch.remove(index);
  if (fx) {
    editTools?.onFixtureRemoved(fx); // clear selection/gizmo before teardown
    if (fx.mirror) fx.mirror.mirror = null; // unlink the surviving twin
    const i = fixtures.indexOf(fx);
    if (i >= 0) fixtures.splice(i, 1);
    fx.dispose?.();
  }
  history?.record();
}

/** Delete the fixture currently selected in the viewport (Delete key). */
function deleteSelectedFixture() {
  const fx = editTools?.selected;
  if (!fx) return;
  const idx = patch.entries.findIndex((e) => e.fixture === fx);
  if (idx >= 0) removeFixtureAt(idx);
}

// ---------- Playback engine ----------
const engine = new ShowEngine(hub, fixtures);
// Seed a default look on the movers (intensity + colour + movement, stacked
// per-attribute) so the rig is alive on launch and shows the layering model.
engine.addCue({ effectKey: 'i-flat', groupId: 'movers', start: 0, duration: 16, lane: 2 });
const seedColor = engine.addCue({ effectKey: 'c-rainbow', groupId: 'movers', start: 0, duration: 16, lane: 1 });
seedColor.params.division = 4; seedColor.params.spread = 1;
const seedMove = engine.addCue({ effectKey: 'p-wave', groupId: 'movers', start: 0, duration: 16, lane: 0 });
seedMove.params.size = 0.6; seedMove.params.division = 4; seedMove.params.spread = 0.5; seedMove.params.tilt = 0.72;
// A BEYOND-style laser cue (vector pattern + the 7 parameters) on its own lane,
// with two keyframed Key Effects: a full spin and a size swell across the cue.
const seedLaser = engine.addLaserCue({ pattern: 'tunnel', start: 0, duration: 16, lane: 3 });
seedLaser.params.color = [0.2, 1, 0.5];
seedLaser.anim = {
  rotZ: { ease: 'linear', keys: [{ t: 0, v: 0 }, { t: 1, v: 2 * Math.PI }] },
  size: { ease: 'smooth', keys: [{ t: 0, v: 0.6 }, { t: 0.5, v: 1.2 }, { t: 1, v: 0.6 }] },
};

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width === Math.floor(w * renderer.getPixelRatio())) {
    // height may still differ; cheap guard is fine either way
  }
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- Bridge to main process (DMX hardware I/O) ----------
const bridge = window.dmxBridge ?? null;

if (bridge) {
  bridge.onArtNetIn(({ universe, data }) => hub.applyExternal(universe, data));
  // Mirror universe state to the main process for the 40 Hz hardware tick.
  setInterval(() => {
    if (hub.mode === 'internal') bridge.pushUniverses(hub.snapshotForIpc());
  }, 25);
}

function pushConfig() {
  if (!bridge) return;
  bridge.setConfig({
    mode: hub.mode,
    artnetIp: ui.artnetIp.value.trim() || '127.0.0.1',
    sacn: ui.sacn.checked,
  });
}

// ---------- UI ----------
const ui = {
  mode: document.getElementById('mode'),
  artnetIp: document.getElementById('artnet-ip'),
  sacn: document.getElementById('sacn'),
  haze: document.getElementById('haze'),
  brightness: document.getElementById('brightness'),
  houseLight: document.getElementById('house-light'),
  bpm: document.getElementById('bpm'),
  roomW: document.getElementById('room-w'),
  roomD: document.getElementById('room-d'),
  roomH: document.getElementById('room-h'),
  applyRoom: document.getElementById('apply-room'),
  fire: document.getElementById('fire'),
  status: document.getElementById('status'),
};

ui.mode.addEventListener('change', () => {
  hub.mode = ui.mode.value;
  setStatus();
  pushConfig();
});
ui.artnetIp.addEventListener('change', pushConfig);
ui.sacn.addEventListener('change', pushConfig);
function applyHaze(v) {
  hazeUniform.value = v;          // beam cone brightness
  scene.fog.density = v * 0.012;  // gentle atmospheric depth behind the beams
}
ui.haze.addEventListener('input', () => applyHaze(parseFloat(ui.haze.value)));
applyHaze(parseFloat(ui.haze.value)); // sync fog to the slider's initial value

function applyBrightness(v) {
  ambient.intensity = v;                                          // fill light
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.8, 1.9, v / 2.5); // lifts the whole image
}
ui.brightness.addEventListener('input', () => applyBrightness(parseFloat(ui.brightness.value)));
applyBrightness(parseFloat(ui.brightness.value));
ui.houseLight.addEventListener('change', () => houseLight.setOn(ui.houseLight.checked));
ui.bpm.addEventListener('change', () => {
  const v = parseFloat(ui.bpm.value);
  if (Number.isFinite(v) && v > 0) { transport.bpm = v; history?.record(); } // single BPM source; timeline grid + demo follow
});
ui.applyRoom.addEventListener('click', () => {
  const w = parseFloat(ui.roomW.value);
  const d = parseFloat(ui.roomD.value);
  const h = parseFloat(ui.roomH.value);
  if ([w, d, h].every((v) => Number.isFinite(v) && v >= 3)) {
    room.build(w, d, h);
    houseLight.setRoom(w, d, h);
    placement?.setTrussY(h - 0.6); // hang drag-placed fixtures just below the ceiling
    history?.record();
  }
});
ui.fire.addEventListener('pointerdown', () => (engine.manualSpark = true));
ui.fire.addEventListener('pointerup', () => (engine.manualSpark = false));
ui.fire.addEventListener('pointerleave', () => (engine.manualSpark = false));

function setStatus() {
  ui.status.textContent =
    hub.mode === 'internal'
      ? 'Internal show -> Art-Net out (universe 1, 40 Hz)'
      : 'Listening for your console on Art-Net universe 1...';
}
setStatus();
pushConfig();

// ---------- Patch panel + viewport placement ----------
let placement;
let editTools;
let history = null; // assigned in the Project section below
const patchPanel = new PatchPanel(patch, document.getElementById('patch'), {
  fixtureTypes: FIXTURE_TYPES,
  onAdd: (key) => { spawnFixture(key); history?.record(); },
  onRemove: removeFixtureAt,
  onDragStart: (key) => placement?.setPendingType(key),
  onDragEnd: () => placement?.setPendingType(null),
});

placement = new PlacementController({
  canvas,
  camera,
  controls,
  scene,
  fixtures,
  fixtureType,
  onPlace: placeFixtures,
  grid: 0.5,
  trussY: 5.4,
  getMirror: () => patchPanel.mirror,
});

// Select / Move / Rotate tools + the toolbar that switches between them.
editTools = new EditTools({
  canvas, camera, controls, scene, fixtures, grid: 0.5,
  onChange: () => history?.record(),
});
const toolButtons = Array.from(document.querySelectorAll('.tool'));
function setTool(mode) {
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === mode));
  editTools.setMode(mode);
}
for (const btn of toolButtons) btn.addEventListener('click', () => setTool(btn.dataset.tool));

// ---------- Audio / timeline ----------
const audio = new AudioEngine();
const transport = new Transport(audio);
transport.bpm = parseFloat(ui.bpm.value) || transport.bpm;

const timeline = new TimelinePanel(transport, audio, engine, document.getElementById('timeline'), {
  onLoadAudio: async (file) => {
    try {
      await audio.load(file);
      transport.pause();
      transport.seek(0);
      // Auto-detect tempo + downbeat so the grid and snapping line up.
      const { bpm, offset } = analyzeTempo(audio.buffer);
      transport.bpm = bpm;
      transport.beatOffset = offset;
      ui.bpm.value = Math.round(bpm * 10) / 10;
      timeline.setBpm(bpm);
      timeline.onAudioLoaded();
      history?.record();
    } catch (e) {
      console.warn('Audio load failed:', e.message);
    }
  },
  onEdit: () => history?.record(),
});

// Laser projector: renders the active laser cue as 3D beams + a flat preview.
const laserRig = new LaserRig(scene, { previewCanvas: timeline.laserPreview });
engine.laserRig = laserRig;

// ---------- Project save / load ----------
// JSON snapshot of the show: room, fixtures (type/patch/position/rotation/mirror),
// cues, and settings. Audio isn't embedded (binary) — its name is stored as a
// reminder and the track is re-imported on load.
function serializeProject() {
  const order = patch.entries.map((e) => e.fixture);
  const idx = new Map(order.map((f, i) => [f, i]));
  const v = new THREE.Vector3();
  return {
    app: 'lightshow-studio', version: 1,
    room: { w: room.size.width, d: room.size.depth, h: room.size.height },
    settings: { bpm: transport.bpm, beatOffset: transport.beatOffset, haze: parseFloat(ui.haze.value), brightness: parseFloat(ui.brightness.value) },
    fixtures: patch.entries.map((e) => {
      const fx = e.fixture;
      fx.getPosition(v);
      return {
        type: fx.typeKey, universe: fx.universe, startAddress: fx.startAddress, label: e.label,
        pos: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)], rot: fx.getRotation().map((r) => +r.toFixed(4)),
        mirror: fx.mirror && idx.has(fx.mirror) ? idx.get(fx.mirror) : null,
      };
    }),
    cues: engine.cues.map((c) => ({
      kind: c.kind, effectKey: c.effectKey, groupId: c.groupId, pattern: c.pattern,
      start: c.start, duration: c.duration, lane: c.lane,
      params: { ...c.params, color: [...c.params.color] },
      anim: c.anim ? structuredClone(c.anim) : undefined, // laser keyframe envelopes
    })),
    audioName: audio.name || null,
  };
}

function clearProject() {
  editTools.deselect();
  for (const fx of fixtures.slice()) fx.dispose?.();
  fixtures.length = 0;
  patch.clear();
  engine.cues.length = 0;
  for (const k of Object.keys(typeCounters)) delete typeCounters[k];
}

function restoreFixture(f) {
  const type = fixtureType(f.type);
  if (!type) return null;
  const pos = Array.isArray(f.pos) ? f.pos : [0, 0, 0];
  const fx = type.create(hub, scene, { universe: f.universe, position: new THREE.Vector3(...pos) });
  fx.startAddress = f.startAddress;
  fx.typeKey = f.type;
  if (Array.isArray(f.rot)) fx.setRotation(f.rot);
  else if (typeof f.yaw === 'number') fx.setRotation([0, f.yaw, 0]); // back-compat

  fixtures.push(fx);
  patch.addFixture(fx, f.label);
  typeCounters[f.type] = (typeCounters[f.type] ?? 0) + 1;
  return fx;
}

function applyProject(data, { keepTransport = false } = {}) {
  if (!data || data.app !== 'lightshow-studio' || !Array.isArray(data.fixtures)) {
    throw new Error('not a Lightshow Studio project file');
  }
  clearProject();

  const r = data.room || { w: 14, d: 18, h: 6 };
  room.build(r.w, r.d, r.h);
  placement?.setTrussY(r.h - 0.6);

  const made = data.fixtures.map(restoreFixture);
  data.fixtures.forEach((f, i) => {
    if (f.mirror != null && made[i] && made[f.mirror]) made[i].mirror = made[f.mirror];
  });

  for (const c of data.cues || []) {
    const cue = c.kind === 'laser'
      ? engine.addLaserCue({ pattern: c.pattern, start: c.start, duration: c.duration, lane: c.lane ?? 0 })
      : engine.addCue({ effectKey: c.effectKey, groupId: c.groupId, start: c.start, duration: c.duration, lane: c.lane ?? 0 });
    if (c.params) cue.params = { ...cue.params, ...c.params, color: [...(c.params.color || cue.params.color)] };
    const anim = c.kind === 'laser' ? loadAnim(c.anim) : undefined;
    if (anim) cue.anim = anim;
  }

  const s = data.settings || {};
  if (Number.isFinite(s.bpm)) { transport.bpm = s.bpm; ui.bpm.value = s.bpm; timeline.setBpm(s.bpm); }
  if (Number.isFinite(s.beatOffset)) transport.beatOffset = s.beatOffset;
  if (Number.isFinite(s.haze)) { ui.haze.value = s.haze; applyHaze(s.haze); }
  if (Number.isFinite(s.brightness)) { ui.brightness.value = s.brightness; applyBrightness(s.brightness); }

  if (!keepTransport) transport.stop();
  timeline.selectCue(null); // cues were recreated; drop stale selection
  timeline.renderCues();
}

function doSave() {
  const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'lightshow-project.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('proj-save').addEventListener('click', doSave);
const projFile = document.getElementById('proj-file');
document.getElementById('proj-load').addEventListener('click', () => projFile.click());
const projStatus = document.getElementById('proj-status');
projFile.addEventListener('change', async () => {
  const file = projFile.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    applyProject(data);
    history.reset();
    const nFix = (data.fixtures || []).length;
    const nCue = (data.cues || []).length;
    projStatus.textContent = `Loaded "${file.name}": ${nFix} fixture${nFix === 1 ? '' : 's'}, ${nCue} cue${nCue === 1 ? '' : 's'}.`;
    projStatus.style.color = '';
  } catch (e) {
    console.error('Project load failed:', e);
    projStatus.textContent = `Load failed: ${e.message}`;
    projStatus.style.color = '#ff8585';
  }
  projFile.value = '';
});

// ---------- Undo / redo (whole-show snapshots) ----------
// Reuses the project serializer: each committed edit snapshots the show; undo/
// redo re-apply a snapshot. Simple and covers fixtures, cues, room and settings.
history = {
  past: [], future: [], present: null, applying: false,
  reset() { this.past.length = 0; this.future.length = 0; this.present = JSON.stringify(serializeProject()); },
  record() {
    if (this.applying) return;
    const snap = JSON.stringify(serializeProject());
    if (snap === this.present) return;
    if (this.present != null) this.past.push(this.present);
    if (this.past.length > 100) this.past.shift();
    this.present = snap;
    this.future.length = 0;
  },
  undo() {
    if (!this.past.length) return;
    this.future.push(this.present);
    this.present = this.past.pop();
    this._apply();
  },
  redo() {
    if (!this.future.length) return;
    this.past.push(this.present);
    this.present = this.future.pop();
    this._apply();
  },
  _apply() {
    // Keep the playhead and the open cue across undo/redo — keyframe editing
    // is done at the playhead, so jumping to 0 or closing the inspector would
    // lose the user's place. Cue order is stable in the snapshot, so the index
    // finds the same cue (or nothing, if the undo removed it).
    const selIdx = engine.cues.indexOf(timeline.selected);
    this.applying = true;
    try { applyProject(JSON.parse(this.present), { keepTransport: true }); } finally { this.applying = false; }
    if (selIdx >= 0 && engine.cues[selIdx]) timeline.selectCue(engine.cues[selIdx]);
  },
};
history.reset();

// Record settings tweaks as discrete undo steps (on commit, not every drag).
ui.haze.addEventListener('change', () => history.record());
ui.brightness.addEventListener('change', () => history.record());

// ---------- Keyboard shortcuts ----------
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  // Text-entry fields keep their keys (incl. native text undo). Sliders and
  // colour swatches don't type, so Space/Ctrl+Z still work right after you drag
  // one — the laser inspector is mostly sliders. Checkboxes keep Space.
  const typing = tag === 'textarea' || tag === 'select' ||
    (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'color');
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (ctrl && k === 's') { e.preventDefault(); doSave(); return; }
  if (typing) return; // let fields handle their own keys (incl. native text undo)

  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); return; }

  switch (k) {
    case 'v': setTool('select'); break;
    case 'x': setTool('move'); break;
    case 'c': setTool('rotate'); break;
    case ' ': e.preventDefault(); transport.toggle(); break;
    case 'delete': case 'backspace':
      if (tag !== 'input') deleteSelectedFixture(); // never from a focused slider
      break;
    default: return;
  }
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  // No track loaded: the free-running clock loops over the show (last cue end).
  transport.loopEnd = engine.cues.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  transport.update(dt);
  // Feed the current viewport selection to the "Selection" cue group.
  const sel = editTools.selected;
  engine.setSelection(sel ? (sel.mirror ? [sel, sel.mirror] : [sel]) : []);
  engine.update(transport.time, transport.bpm, audio.bands());

  for (const f of fixtures) f.update(dt);
  timeline.frame();

  controls.update();
  resize();
  composer.render();
}
animate();
