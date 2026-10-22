// Renderer entry and composition root: builds the 3D scene, the DMX core, the
// rig, the show engine and the UI, wires them together, and runs the frame
// loop. Behaviour lives in the modules; this file only connects them.
//
//   top bar ─ workspaces (Build / Program), transport, Simple/Pro, output
//   left    ─ Build: fixture library · Program: pattern + effect library
//   centre  ─ the 3D view + floating tools / atmosphere / laser preview
//   right   ─ inspector (selected fixture or cue, else venue / show)
//   bottom  ─ Build: patch sheet · Program: timeline

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
import { Atmosphere } from './viz/Atmosphere.js';
import { ShowEngine } from './show/ShowEngine.js';
import { EFFECTS } from './show/effects.js';
import { Patch } from './patch/Patch.js';
import { FIXTURE_TYPES, fixtureType } from './fixtures/registry.js';
import { PlacementController } from './placement/PlacementController.js';
import { EditTools } from './placement/EditTools.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { analyzeTempo } from './audio/bpm.js';
import { Transport } from './timeline/Transport.js';
import { TimelinePanel } from './timeline/TimelinePanel.js';
import { CueInspector, effectShortName } from './timeline/CueInspector.js';
import { LaserRig } from './laser/LaserRig.js';
import { PATTERNS } from './laser/patterns.js';
import { Rig } from './core/Rig.js';
import { serializeProject, applyProject, History } from './core/project.js';
import { Shell, WORKSPACES } from './ui/Shell.js';
import { TopBar } from './ui/TopBar.js';
import { ViewportOverlay } from './ui/ViewportOverlay.js';
import { Inspector } from './ui/Inspector.js';
import { FixtureLibrary } from './ui/FixtureLibrary.js';
import { ContentLibrary } from './ui/ContentLibrary.js';
import { PatchSheet } from './ui/PatchSheet.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { toast } from './ui/overlays.js';
import { isTypingTarget, prefs } from './ui/dom.js';

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
const CAMERA_HOME = { pos: new THREE.Vector3(11, 7.5, 14), target: new THREE.Vector3(0, 1.8, 0) };
camera.position.copy(CAMERA_HOME.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(CAMERA_HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.52;

// Room fill light — the Room light control drives its intensity so a dark
// venue can be lit enough to see geometry without flooding the beams.
const ambient = new THREE.AmbientLight(0x6a6a78, 0.9);
scene.add(ambient);

// ---------- DMX core + venue ----------
const hub = new UniverseHub();
const room = new Room(scene);
room.build(14, 18, 6);
const houseLight = new HouseLight(scene);
const atmosphere = new Atmosphere({ scene, renderer, ambient, houseLight, hazeUniform });

// ---------- Rig ----------
const patch = new Patch();
const rig = new Rig({ hub, scene, patch });
rig.seedDemo();
const fixtures = rig.fixtures;

// ---------- Show engine + the demo show ----------
const engine = new ShowEngine(hub, fixtures);
// A default look on the movers (intensity + colour + movement, stacked
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
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.5, 0.82));
composer.addPass(new OutputPass());

let lastW = 0, lastH = 0;
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h || (w === lastW && h === lastH)) return;
  lastW = w; lastH = h;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------- DMX output (bridge to the main process) ----------
const bridge = window.dmxBridge ?? null;
const output = {
  mode: 'internal',
  artnetIp: prefs.get('output.ip', '127.0.0.1'),
  sacn: prefs.get('output.sacn', false),
};
function pushConfig() {
  hub.mode = output.mode;
  bridge?.setConfig({ mode: output.mode, artnetIp: output.artnetIp, sacn: output.sacn });
}
function setOutput(change) {
  Object.assign(output, change);
  prefs.set('output.ip', output.artnetIp);
  prefs.set('output.sacn', output.sacn);
  pushConfig();
}
if (bridge) {
  bridge.onArtNetIn(({ universe, data }) => hub.applyExternal(universe, data));
  // Mirror universe state to the main process for its steady 40 Hz output tick.
  setInterval(() => {
    if (hub.mode === 'internal') bridge.pushUniverses(hub.snapshotForIpc());
  }, 25);
}
pushConfig();

// ---------- Audio / transport ----------
const audio = new AudioEngine();
const transport = new Transport(audio);

// ---------- UI ----------
const shell = new Shell();
let history = null; // assigned in the Project section below
const commit = () => history?.record();
const project = { name: 'Demo show' };

const editTools = new EditTools({
  canvas, camera, controls, scene, fixtures, grid: 0.5,
  onChange: commit,
  onSelect: (fx) => onFixtureSelected(fx),
});
rig.onRemoved = (fx) => editTools.onFixtureRemoved(fx);

const placement = new PlacementController({
  canvas, camera, controls, scene, fixtures, fixtureType,
  onPlace: (key, points) => {
    const made = rig.place(key, points);
    if (!made.length) { toast('Universe 1 is full — remove a fixture to make room.', { kind: 'error' }); return; }
    editTools.select(made[0]);
    commit();
  },
  grid: 0.5,
  trussY: 5.4,
  getMirror: () => fixtureLibrary.mirror,
});

const cueInspector = new CueInspector({
  transport, engine,
  onChange: () => timeline.renderCues(),
  onCommit: commit,
  onDelete: (cue) => timeline.deleteCue(cue),
});

const timeline = new TimelinePanel(transport, audio, engine, document.getElementById('timeline'), {
  onLoadAudio: loadSong,
  onEdit: commit,
  onSelect: (cue) => onCueSelected(cue),
  onCueMoved: () => cueInspector.refreshMeta(),
});

const overlay = new ViewportOverlay(document.getElementById('overlay'), {
  atmosphere,
  onTool: setTool,
  onCameraReset: resetCamera,
  onSpark: (on) => { engine.manualSpark = on; },
  onAtmosphereCommit: commit,
  hasSparks: () => fixtures.some((f) => f.profile && f.profile.has('Trigger')),
  fixtureCount: () => fixtures.length,
});
controls.addEventListener('start', () => overlay.cameraMoved());

// Laser projector: renders the active laser cue as 3D beams + the flat preview.
const laserRig = new LaserRig(scene, { previewCanvas: overlay.laserCanvas });
engine.laserRig = laserRig;

const fixtureLibrary = new FixtureLibrary(document.getElementById('lib-build'), {
  types: FIXTURE_TYPES,
  shell,
  onAdd: addFixture,
  onDragStart: (key) => placement.setPendingType(key),
  onDragEnd: () => placement.setPendingType(null),
});

new ContentLibrary(document.getElementById('lib-program'), {
  shell,
  onAddPattern: (key) => timeline.addLaserCueAt(key),
  onAddEffect: (key) => timeline.addFixtureCueAt(key),
});

const patchSheet = new PatchSheet(document.getElementById('patchsheet'), {
  patch, rig, shell, fixtureType,
  onSelect: (fx) => editTools.select(fx),
  onRemove: removeFixture,
  onCommit: commit,
});

const inspector = new Inspector(document.getElementById('inspector'), {
  shell, patch, rig, room, editTools, cueInspector, transport, audio, engine, fixtureType,
  getProjectName: () => project.name,
  onCommit: commit,
  onRoomChange: setRoom,
  onRemoveFixture: removeFixture,
  onSelectFixture: (fx) => editTools.select(fx),
  onLoadSong: () => timeline.pickAudio(),
});

const topBar = new TopBar(document.getElementById('topbar'), {
  transport, shell,
  getDuration: () => timeline.length,
  actions: {
    open: openProject,
    save: saveProject,
    undo: () => history.undo(),
    redo: () => history.redo(),
    search: () => palette.open(),
    setBpm,
    playPause: () => transport.toggle(),
    stop: () => transport.stop(),
  },
  output: { get: () => output, set: setOutput },
});

const palette = new CommandPalette(commands);

// ---------- Selection -> inspector ----------
// The inspector follows the most recent pick: clicking a cue shows the cue,
// clicking a fixture shows the fixture; with nothing selected it shows the
// workspace's default (venue in Build, show in Program).
let lastPicked = null;
function updateInspector() {
  const cue = shell.workspace === 'program' ? timeline.selected : null;
  const fx = editTools.selected;
  if (cue && (lastPicked === 'cue' || !fx)) inspector.show({ kind: 'cue', cue });
  else if (fx) inspector.show({ kind: 'fixture', fx });
  else inspector.show(null);
}
function onFixtureSelected(fx) {
  if (fx) lastPicked = 'fixture';
  patchSheet.setSelected(fx);
  updateInspector();
}
function onCueSelected(cue) {
  if (cue) lastPicked = 'cue';
  updateInspector();
}
shell.onChange(() => updateInspector());

// ---------- Actions ----------
function setTool(mode) {
  editTools.setMode(mode);
  overlay.setTool(mode);
}

function resetCamera() {
  camera.position.copy(CAMERA_HOME.pos);
  controls.target.copy(CAMERA_HOME.target);
  controls.update();
}

function setBpm(v) {
  transport.bpm = v;
  topBar.syncBpm();
  commit();
}

function setRoom(w, d, h) {
  room.build(w, d, h);
  houseLight.setRoom(w, d, h);
  placement.setTrussY(h - 0.6); // hang drag-placed fixtures just below the ceiling
  commit();
}

function addFixture(key) {
  const fx = rig.spawn(key);
  if (!fx) { toast('Universe 1 is full — remove a fixture to make room.', { kind: 'error' }); return; }
  editTools.select(fx);
  commit();
}

function removeFixture(fx) {
  rig.remove(fx);
  commit();
}

/** Del: the cue in the inspector if one is shown, else the selected fixture. */
function deleteSelection() {
  if (inspector.target?.kind === 'cue') timeline.deleteCue(inspector.target.cue);
  else if (editTools.selected) removeFixture(editTools.selected);
}

function deselectAll() {
  editTools.deselect();
  timeline.selectCue(null);
}

async function loadSong(file) {
  try {
    await audio.load(file);
    transport.pause();
    transport.seek(0);
    // Auto-detect tempo + downbeat so the grid and snapping line up.
    const { bpm, offset } = analyzeTempo(audio.buffer);
    transport.bpm = bpm;
    transport.beatOffset = offset;
    topBar.syncBpm();
    timeline.onAudioLoaded();
    commit();
    toast(`Loaded "${audio.name}" — ${Math.round(bpm * 10) / 10} BPM detected`, { kind: 'ok' });
  } catch (e) {
    console.warn('Audio load failed:', e.message);
    toast(`Couldn't load that song: ${e.message}`, { kind: 'error' });
  }
}

// ---------- Project: save / open / undo ----------
const ctx = { room, houseLight, placement, rig, patch, engine, transport, audio, atmosphere, timeline, editTools };

history = new History({
  snapshot: () => JSON.stringify(serializeProject(ctx)),
  // Keep the playhead, the open cue and the selected fixture across undo/redo —
  // edits happen at the playhead / on the selection, so jumping to 0 or
  // clearing the inspector would lose the user's place. Cue and patch order are
  // stable in the snapshot, so an index finds the same object again (or
  // nothing, if the undo removed it).
  restore: (json) => {
    const cueIdx = engine.cues.indexOf(timeline.selected);
    const fxIdx = patch.entries.findIndex((e) => e.fixture === editTools.selected);
    const picked = lastPicked;
    applyProject(ctx, JSON.parse(json), { keepTransport: true });
    if (fxIdx >= 0 && patch.entries[fxIdx]) editTools.select(patch.entries[fxIdx].fixture);
    if (cueIdx >= 0 && engine.cues[cueIdx]) timeline.selectCue(engine.cues[cueIdx]);
    lastPicked = picked;
    updateInspector();
    topBar.syncBpm();
  },
});
history.onChange(() => {
  topBar.setHistory(history.canUndo, history.canRedo);
  topBar.setDirty(history.dirty);
  document.title = `${history.dirty ? '• ' : ''}${project.name} — Lightshow Studio`;
  patchSheet.render(); // mirror links aren't patch events; keep the twin column current
  editTools.refresh(); // re-glow the twin and re-seat the gizmo after inspector edits / undo
  // (the inspector re-renders itself when what it shows changes — see Inspector.frame)
});
history.reset();
topBar.setProject(project.name);

function saveProject() {
  const blob = new Blob([JSON.stringify(serializeProject(ctx), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[\\/:*?"<>|]+/g, '-') || 'show'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  history.markSaved();
  toast(`Saved "${a.download}"`, { kind: 'ok' });
}

const projFile = document.createElement('input');
projFile.type = 'file';
projFile.accept = '.json,application/json';
projFile.hidden = true;
document.body.appendChild(projFile);
function openProject() { projFile.click(); }
projFile.addEventListener('change', async () => {
  const file = projFile.files[0];
  projFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    applyProject(ctx, data);
    project.name = file.name.replace(/\.json$/i, '');
    topBar.setProject(project.name);
    topBar.syncBpm();
    history.reset();
    const nFix = (data.fixtures || []).length;
    const nCue = (data.cues || []).length;
    const song = data.audioName ? ` Load "${data.audioName}" again to hear it.` : '';
    toast(`Opened "${file.name}": ${nFix} fixture${nFix === 1 ? '' : 's'}, ${nCue} cue${nCue === 1 ? '' : 's'}.${song}`, { kind: 'ok', ms: 5000 });
  } catch (e) {
    console.error('Project load failed:', e);
    toast(`Couldn't open "${file.name}": ${e.message}`, { kind: 'error', ms: 5000 });
  }
});

// ---------- Commands (Ctrl+K) ----------
function commands() {
  const list = [];
  const add = (group, title, run, keys = '', when = null) => list.push({ group, title, run, keys, when });
  add('Show', 'Play / pause', () => transport.toggle(), 'Space');
  add('Show', 'Stop and go to the start', () => transport.stop());
  add('Show', 'Load a song…', () => timeline.pickAudio());
  add('File', 'Save the show', saveProject, 'Ctrl+S');
  add('File', 'Open a show…', openProject, 'Ctrl+O');
  add('Edit', 'Undo', () => history.undo(), 'Ctrl+Z');
  add('Edit', 'Redo', () => history.redo(), 'Ctrl+Y');
  add('Edit', 'Delete the selection', deleteSelection, 'Del');
  add('Edit', 'Deselect', deselectAll, 'Esc');
  for (const w of WORKSPACES) add('Go to', `${w.label} workspace`, () => shell.setWorkspace(w.id), w.keys);
  for (const t of FIXTURE_TYPES) add('Add fixture', t.label, () => { shell.setWorkspace('build'); addFixture(t.key); });
  for (const p of PATTERNS) add('Add laser cue', p.label, () => { shell.setWorkspace('program'); timeline.addLaserCueAt(p.key); });
  for (const e of EFFECTS) add('Add fixture cue', effectShortName(e) + (e.attr === 'color' ? ' (colour)' : e.attr === 'position' ? ' (movement)' : ''), () => { shell.setWorkspace('program'); timeline.addFixtureCueAt(e.key); });
  add('Tools', 'Select tool', () => setTool('select'), 'V');
  add('Tools', 'Move tool', () => setTool('move'), 'X');
  add('Tools', 'Rotate tool', () => setTool('rotate'), 'C');
  add('View', 'Reset the camera', resetCamera);
  add('View', 'House light on', () => { atmosphere.setHouse(true); commit(); }, '', () => !atmosphere.house);
  add('View', 'House light off', () => { atmosphere.setHouse(false); commit(); }, '', () => atmosphere.house);
  add('View', 'Show / hide the library', () => shell.togglePanel('left'));
  add('View', 'Show / hide the inspector', () => shell.togglePanel('right'));
  add('View', 'Show / hide the timeline or patch sheet', () => shell.togglePanel('bottom'));
  add('View', 'Switch to Simple mode', () => shell.setPro(false), '', () => shell.pro);
  add('View', 'Switch to Pro mode', () => shell.setPro(true), '', () => !shell.pro);
  add('Output', 'Output settings…', () => topBar.openOutput());
  add('Help', 'Keyboard shortcuts', () => topBar.openHelp(), '?');
  return list;
}

// ---------- Keyboard shortcuts ----------
window.addEventListener('keydown', (e) => {
  if (palette.isOpen) return; // the palette handles its own keys
  const typing = isTypingTarget(e.target);
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (ctrl && k === 's') { e.preventDefault(); saveProject(); return; }
  if (ctrl && k === 'o') { e.preventDefault(); openProject(); return; }
  if (ctrl && k === 'k') { e.preventDefault(); palette.open(); return; }
  if (typing) return; // let text fields keep their keys (incl. native text undo)

  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); return; }
  const ws = ctrl && WORKSPACES[Number(k) - 1];
  if (ws) { e.preventDefault(); shell.setWorkspace(ws.id); return; }
  if (ctrl || e.altKey) return;

  switch (k) {
    case 'v': setTool('select'); break;
    case 'x': setTool('move'); break;
    case 'c': setTool('rotate'); break;
    case ' ': e.preventDefault(); transport.toggle(); break; // also stops a focused button re-clicking
    case 'escape': deselectAll(); break;
    case '?': topBar.openHelp(); break;
    case '/': if (e.shiftKey) topBar.openHelp(); else return; break; // '?' on layouts that report the base key
    case 'delete': case 'backspace':
      if (e.target.tagName !== 'INPUT') deleteSelection(); // never from a focused slider
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
  cueInspector.frame();
  inspector.frame();
  topBar.frame();
  overlay.frame();
  overlay.setLaserState(laserRig.active ? 'live' : 'idle');

  controls.update();
  resize();
  composer.render();
}
animate();
