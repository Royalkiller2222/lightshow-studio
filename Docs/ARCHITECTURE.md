# Architecture

Companion to **DESIGN_DECISIONS.md** (which covers *why*). This is *what* and
*how*: the module map, the per-frame data flow, and the cue model.

## Process model

- **Main process** (`main.js`): opens the `BrowserWindow`, owns hardware DMX I/O
  on a steady 40 Hz `setInterval`. Mirrors universe buffers pushed from the
  renderer and sends Art-Net/sACN; also runs the Art-Net receiver for External
  mode and forwards incoming DMX to the renderer.
- **Preload** (`preload.js`): `contextBridge` exposes `window.dmxBridge`
  (`pushUniverses`, `setConfig`, `onArtNetIn`). The only renderer↔main channel.
- **Renderer** (`src/app.js` + modules): the 3D scene, show engine, timeline,
  placement tools, UI. This is where almost everything lives.
- **`dmx-io.js`**: pure Node `dgram` Art-Net/sACN senders + Art-Net receiver.
  Covered by `npm test` (loopback round-trip + sACN packet structure).

## Renderer per-frame loop (`src/app.js` → `animate()`)

```
dt = clock.getDelta()
transport.loopEnd = last cue end          // no track: free-run loops over the show
transport.update(dt)                      // advance the master clock
engine.setSelection(editTools.selected)   // feed the "Selection" group
engine.update(transport.time, bpm, audio.bands())
    ├─ fixture cues → write to sink → _flush() merges to UniverseHub
    └─ laser cues   → _renderLaser() evaluates envelopes, drives the LaserRig
                      (which also draws the 2D preview canvas)
for (f of fixtures) f.update(dt)          // fixtures READ the hub, drive 3D
timeline.frame()                          // waveform/beat grid/playhead + live
                                          // laser inspector & envelope editor
controls.update(); composer.render()      // orbit + post (bloom, ACES, output)
```

The renderer also pushes `hub.snapshotForIpc()` to main every 25 ms (internal
mode) for hardware output.

## Module map

```
src/
  app.js                 Renderer entry: scene, wiring, UI handlers, project I/O,
                         undo/redo, keyboard shortcuts, the animate() loop. (Big;
                         a candidate to split into an App module later.)
  index.html             importmap (three, three/addons), DOM, sidebar + timeline.
  style.css              All styling.

  dmx/UniverseHub.js     Single source of truth. get/setChannel(16), applyExternal,
                         snapshotForIpc. 1-based addresses.

  fixtures/
    Fixture.js           Base: hub read helpers (ch/attr by name), position/rotation
                         get/set (_rotObject), mirror link, pickRoot.
    FixtureProfile.js    Channel layout as data + built-in profiles
                         (MovingHeadRGB, ColdSpark2, LedParRGB, BattenRGB,
                         PixelBarRGB, LaserRGB, PodiumProp).
    registry.js          type key -> factory (the add/place/load seam).
    MovingHead / LedPar / Batten / PixelBar / LaserProjector / ColdSpark / Podium
                         Each builds its own geometry, reads attrs, has dispose().

  viz/
    beam.js              Analytic fresnel cone-shell shader + createUnitConeGeometry
                         + shared hazeUniform. (See DESIGN_DECISIONS "beam trap".)
    Room.js              Parametric venue (back-face box + floor grid at 0.5 m).
    HouseLight.js        Toggleable flood (viewport aid, not DMX).
    strobe.js            Pure strobe gate helper.

  show/
    ShowEngine.js        Owns cues + groups. update(): orders cues by lane, applies
                         fixture effects via sink, _flush() (HTP intensity / LTP
                         colour+position), _renderLaser() for laser cues.
    effects.js           Per-attribute fixture effect registry (intensity/colour/
                         position) + waveform-driven apply + sink writers
                         (writeAttr/writeRGB) + paramsFor().
    waveforms.js         wave(shape,phase,duty), SHAPES/DIVISIONS/FANS, fanPhase.

  audio/
    AudioEngine.js       Web-Audio decode, play/pause/seek, peaks() for waveform,
                         bands() (FFT bass/mid/high) for audio-reactive effects.
    bpm.js               analyzeTempo(): onset envelope + autocorrelation +
                         parabolic interp + downbeat offset.

  timeline/
    Transport.js         Master clock (audio time or free-run, looping at
                         loopEnd), bpm, beatOffset.
    TimelinePanel.js     Transport UI, waveform+beat grid canvas, multi-lane cue
                         editor (add/drag/resize), fixture-cue inspector, laser
                         inspector (Key Effect rows + ◆ + auto-key) and the
                         envelope editor canvas, laser preview canvas element.

  laser/
    patterns.js          Vector pattern library (strokes in -1..1 galvo space) +
                         patternSegments(pattern, visiblePoints).
    envelopes.js         LASER_PARAMS (ranges/labels/formats — single source of
                         truth) + pure keyframe math: evalEnvelope, valueAt,
                         resolveLaserParams, setKey/removeKey/clearKeys,
                         keyTimes, loadAnim. No Three.js; Node-testable.
    LaserRig.js          Renders the active laser cue: 3D beams + graphic
                         (additive LineSegments) and a flat 2D preview canvas.

  placement/
    PlacementController.js  Drag-in placement (HTML5 DnD) + ghost preview + snap +
                            mirror.
    EditTools.js            Select/Move/Rotate via TransformControls, blue highlight,
                            mirror transforms.
    placement.js            Pure snap/mirror/placementPoints helpers.

  patch/
    Patch.js             Patch registry (entries, collisions, nextFreeAddress, clear).
    PatchPanel.js        Editable patch table (universe/addr), add/remove, collisions.
```

## The cue model

All cues live in `ShowEngine.cues` and render on the shared timeline. Each cue has
`{ id, kind, start, duration, lane, params }`. Lane 0 is the top priority lane.

### Fixture cue (`kind: 'fixture'`)
`{ effectKey, groupId, params }`. One per-attribute effect from `effects.js`:
- **Intensity:** `i-flat`, `i-wave`, `i-audio`, `i-chase`
- **Colour:** `c-static`, `c-rainbow`, `c-two`
- **Position:** `p-static`, `p-circle`, `p-wave`
- (plus `sparks`)

Shared params (effects use a subset, declared in each effect's `controls`):
`shape, rate, sync, division, size, base, phase, spread, fan, dir, duty, band,
color, color2, pan, tilt`. Effects write via `c.out`; merge is HTP intensity /
LTP colour+position (see DESIGN_DECISIONS).

### Laser cue (`kind: 'laser'`) — the BEYOND model
`{ pattern, params, anim? }`. `params` are the **7 Key Effects as static values**:
`{ size, rotX, rotY, rotZ, posX, posY, color[3], brightness, points, scan }`
(rotation in radians). Ranges/labels live in `LASER_PARAMS` (`envelopes.js`).

- `pattern` → `patterns.js` (beam-fan, cone, tunnel, wave, square, triangle, grid,
  lines, dots, spiral). Each is a list of **strokes** (polylines) in -1..1.
- `LaserRig.show(pattern, params)` transforms the frame: rotZ spins in-plane,
  size scales, pos offsets (independent of size), rotX/rotY tilt the frame plane
  in 3D, then places it at distance `D` in front of the projector. `points`
  (Visible Points) truncates the stroke list; `scan` strides/sparsifies;
  `brightness` = opacity; `color` = line colour. It draws a bright **graphic**
  (LineSegments through frame points) plus faint **beams** (projector origin →
  each point) for the volumetric cone, and mirrors a flat 2D galvo view to the
  preview canvas using the same transform.
- Engine renders the **top active laser cue only** (lane 0 wins) for the single
  projector. Multiple projectors/zones are a Stage 3 item.

### Keyframe envelopes (Stage 2)
```
cue.anim = {
  rotZ: { ease: 'linear', keys: [ { t: 0, v: 0 }, { t: 1, v: 6.283 } ] },
  color:{ ease: 'smooth', keys: [ { t: 0.25, v: [1,0,0.25] }, { t: 0.75, v: [0.1,0.25,1] } ] },
}
```
- `t` is **cue-local, 0..1**; `v` is in the param's stored units (colour = RGB
  0..1 array). Keys are kept sorted; one key per time (`KEY_EPS`).
- Evaluation: before the first / after the last key the value holds; between
  keys `ease` is `linear`, `smooth` (smoothstep) or `step` (hold previous).
- `_renderLaser` computes `u = (time - start) / duration` and passes
  `resolveLaserParams(cue, u)` to the rig — a copy with animated params
  evaluated, or `cue.params` itself if nothing is animated.
- Editing (TimelinePanel): ◆ keys the current value at the playhead; edits to an
  animated param (or any param with **Auto-key** on) write a key at the playhead
  — exact when paused, half-beat-quantised while playing. The envelope editor
  shows the picked param (click a param name): click empty space = add key,
  drag = move (half-beat snap, Shift = free), double-click / Del = remove,
  Ease select, Clear keys (freezes the param at its current value). The cue
  block shows a tick per key time.

## Save/load shape (`app.js`)
```
{ app:'lightshow-studio', version:1,
  room:{w,d,h},
  settings:{ bpm, beatOffset, haze, brightness },
  fixtures:[ { type, universe, startAddress, label, pos:[x,y,z], rot:[x,y,z], mirror:index|null } ],
  cues:[ { kind, effectKey?, groupId?, pattern?, start, duration, lane, params, anim? } ],
  audioName }
```
`applyProject` clears, rebuilds the room/fixtures (relinking mirror pairs by
index), re-adds cues by kind (laser `anim` through `loadAnim()`), applies
settings, and stops the transport. Undo/redo snapshot this same JSON but pass
`keepTransport: true` and re-select the cue at the same index, so the playhead
and the open inspector survive Ctrl+Z.
