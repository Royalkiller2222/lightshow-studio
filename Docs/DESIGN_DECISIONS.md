# Design decisions — the WHY (read before refactoring)

This file exists because the code reads fine on its own, but several choices look
"wrong" or "over-complicated" until you know what they're protecting against.
Each entry is **Decision → Why → Don't undo it because…**. If you're about to
simplify something and it's listed here, that simplification probably re-breaks a
bug or a constraint we already dealt with.

---

## Platform & constraints

### No build step / no framework / no bundler
- **Decision:** Plain ES modules via an importmap in `src/index.html`; Three from
  `node_modules/three/build/three.module.js`; addons from
  `node_modules/three/examples/jsm/`. No React, no TS build, no Webpack/Vite.
- **Why:** The product ships to non-developers who double-click
  `Start Lightshow.bat`. First run does `npm install` + fetches the Electron
  runtime and just works. A build toolchain would break the one-click promise and
  add maintenance.
- **Don't undo:** Adding a bundler/framework is the single biggest way to make
  this app un-shippable to its actual users. If you need a dev convenience, find
  one that doesn't require an install-time compile.

### Audio decode uses Web Audio, not FFmpeg
- **Decision:** `AudioEngine` decodes with `AudioContext.decodeAudioData`.
- **Why:** Chromium (Electron) decodes mp3/wav/ogg/m4a natively. FFmpeg would be a
  heavy native dependency that complicates the one-click install (same reason
  Enttec USB / `serialport` is deferred).
- **Don't undo:** Only reach for FFmpeg if the user explicitly needs a format
  Chromium can't decode, and even then keep it optional.

---

## DMX core

### UniverseHub is the single source of truth; fixtures read by address
- **Decision:** All channel state lives in `UniverseHub` (1-based, `Uint8Array(512)`
  per universe). Fixtures only know their `universe`+`startAddress` and read
  channel values; they resolve attributes by **name** via `FixtureProfile`
  (`attr('Pan')`), not by magic offset numbers.
- **Why:** Mirrors a real DMX wire. The payoff: **External-console mode drives the
  3D scene with zero extra code** — whether the bytes came from our show engine
  or from QLC+/grandMA over Art-Net, fixtures read them the same way. And decoupling
  channel layout into `FixtureProfile` is what lets a future GDTF importer, the
  patch UI, and paperwork export all read one source.
- **Don't undo:** Don't let fixtures hold their own copy of state or write DMX
  back "for convenience"; don't hardcode channel offsets in fixture scripts again.

### Main process runs a steady 40 Hz output tick, separate from render
- **Decision:** `main.js` mirrors the universe buffers and sends Art-Net/sACN on
  its own `setInterval(25ms)`, independent of the renderer's `requestAnimationFrame`.
- **Why:** A render stall (GC, a heavy frame) must **not** cause gaps in DMX
  output — that would strobe real fixtures. The renderer pushes buffers over IPC;
  the main process paces the wire.
- **Don't undo:** Don't move DMX output into the renderer loop.

### Shutdown: clear the tick before closing sockets (+ guarded sends)
- **Decision:** `window-all-closed` calls `clearInterval(outputTick)` **before**
  `artnetOut.close()`. Senders set `ready=false` in `close()` and wrap
  `socket.send` in try/catch.
- **Why:** The 40 Hz tick was firing once more after the dgram socket closed →
  `ERR_SOCKET_DGRAM_NOT_RUNNING` → an Electron error dialog on exit (reported by
  the user). Three layers of defense so it can't recur.
- **Don't undo:** Keep the ordering and the guards.

---

## Fixtures & placement

### FixtureProfile: channel layout is data, not code
- **Decision:** `FixtureProfile` is `{ name, channels:[{name, offset, bits}] }`.
  Fixtures resolve `attr('Dimmer')` etc. through it; the base `Fixture` exposes
  `attr/attr01/attr16`.
- **Why:** See UniverseHub above — one source of channel truth, GDTF-ready.
- **Don't undo:** This is the seam GDTF import plugs into. Keep it.

### Fixture type registry (`registry.js`)
- **Decision:** `FIXTURE_TYPES` maps a type key → `{ label, onTruss, create(hub, scene, opts) }`.
- **Why:** The "Add fixture" UI, drag-placement, and save/load all go through this
  one seam, so nothing special-cases where a fixture came from. GDTF import will
  register types here too. Every fixture also gets a `typeKey` for serialization.

### dispose() frees per-instance resources but not shared materials
- **Decision:** Each fixture's `dispose()` removes its scene objects and disposes
  geometries/per-instance materials, but **skips module-level shared materials**
  (e.g. `bodyMaterial` shared across all moving heads).
- **Why:** Disposing a shared material would break every other fixture of that
  type. Needed so add/remove doesn't leak *or* corrupt.
- **Don't undo:** Don't "tidy up" by disposing everything in a blanket traverse.

### Selection highlight = material swap, not emissive mutation
- **Decision:** On select, `EditTools` swaps each body mesh's `.material` to a
  shared blue `HILITE` material and restores the originals on deselect. Beams and
  spark points carry `userData.ignorePick`.
- **Why:** Mutating `bodyMaterial.emissive` would light up **all** fixtures that
  share that material. Swapping the per-mesh reference is isolated. `ignorePick`
  means you grab the fixture body, not its (large, invisible-ish) beam cone.
- **Don't undo:** Don't set emissive on shared materials to highlight.

### Placement: mirror-by-default across x=0, snap to 0.5 m
- **Decision:** Drag-in placement mirrors across the venue centre (x=0) by
  default; snaps to a 0.5 m grid. Mirror pairs are linked (`fx.mirror`) so moving
  or rotating one moves/reflects the twin.
- **Why:** The venue is centred on the origin, so x=0 is the natural symmetry
  axis — a standard lighting convention. 0.5 m matches the room floor grid.
  Mirror-rotation reflects as **(pitch, -yaw, -roll)** across the YZ plane.
- **Don't undo:** The room is centred on origin on purpose; keep it.

### Move/Rotate use a Three.js TransformControls gizmo, rotation is full 3-axis
- **Decision:** `EditTools` uses `TransformControls` for Move (X/Y/Z) and Rotate
  (X/Y/Z rings, snapped to 45°), driven through a proxy object. Rotation is a full
  Euler `[x,y,z]` on every fixture (`_rotObject()` in the base class).
- **Why:** Standard 3D-editor feel, discoverable. It started yaw-only (the ask was
  "rotate at 45°") and was widened to 3 axes when the user wanted it. The
  pointerdown listener is **window capture-phase** so grabbing a fixture pre-empts
  OrbitControls before it starts an orbit.
- **Gotcha:** `scene.add(transformControls)` is valid in three r0.165 (the helper
  split came later). Project files store rotation as `rot:[x,y,z]` (old `yaw`
  number still loads via back-compat).

---

## The beam shader (the trap)

### Beams are a fresnel cone shell, and the fragment must NOT read distance-from-axis
- **Decision:** `src/viz/beam.js` renders a unit **cone shell** (lateral surface,
  apex ring + end ring) with a **fresnel** fragment (bright toward the silhouette)
  and `computeVertexNormals()` on the geometry.
- **Why / the trap:** The original shader computed `radial = f(length(vPosOS.xy)/radiusAtZ)`.
  On a cone *shell*, every fragment sits exactly at the cone radius → `r ≡ 1` →
  `radial ≡ 0` → **the beams multiplied to zero and never rendered at all.** This
  was the actual cause of the "haze does nothing / no cones" bug. There is no
  per-fragment "distance from the beam axis" available on a shell, so the
  brightness comes from a fresnel term instead.
- **Don't undo:** If you "simplify" the beam shader back to reading radial distance
  from `position.xy`, the cones go invisible again. The geometry is a shell; you
  cannot sample interior radius. Keep the normals + fresnel.
- Intensity values were tuned against ACES tonemapping + bloom and the
  Room-brightness exposure control; big changes there wash the cones out.

---

## Audio / timeline / clock

### Transport is the master clock; one BPM source of truth
- **Decision:** `Transport.time` follows `AudioEngine.currentTime` when a track is
  loaded, else free-runs. BPM lives on the transport; both the sidebar BPM input
  and the timeline BPM input write `transport.bpm`, and the engine reads it.
- **Why:** Demo is alive on launch with no track; locks to the song when loaded.
  Two BPM inputs diverging was a real bug — single source fixes it.

### With no track, the free-running clock loops at the show's end
- **Decision:** `app.js` sets `transport.loopEnd` = the last cue's end every
  frame; with no audio loaded, `Transport.update` wraps to 0 there.
- **Why:** The seed show is 16 s long, and the free-run clock used to run forever
  — the app went dark after 16 s and the playhead walked off the timeline. "It
  launches with a working show" is a core promise. With a track loaded the audio
  clock rules and stops at the track's end as before.

### Auto-BPM: onset autocorrelation + parabolic interpolation
- **Decision:** `src/audio/bpm.js` builds a rectified energy-onset envelope
  (~200 fps), autocorrelates over 70–180 BPM, then **parabolic-interpolates the
  peak** for sub-BPM precision, and finds a downbeat offset.
- **Why:** Integer-frame autocorrelation lag quantizes badly at higher tempos
  (128→126.5). Parabolic interpolation on the peak recovers ~±1 BPM. The downbeat
  offset aligns the beat grid and cue snapping to the actual music.

### Timeline window grows to fit cues (so resize grips stay reachable)
- **Decision:** With no audio, the timeline window = `max(30, longestCueEnd + 4)`.
  Seeded cues have **finite** durations (16 s), not 3600 s.
- **Why:** A 3600 s seed cue put its right-edge resize grip off-screen (reported
  bug). Finite durations + a growing window keep every cue's grip reachable and
  let you drag-extend a cue past the default window without a track loaded.

### The timeline panel is sized by its content; the waveform is a fixed 64 px
- **Decision:** `#timeline` has no fixed height — toolbar + 64 px waveform + lanes
  + whichever inspector is open. The 3D view takes the rest of the window.
- **Why:** It used to be a fixed 300 px with a flexible waveform. Once the laser
  preview made the toolbar taller, opening any inspector squeezed the waveform to
  **0 px** (and the envelope editor needs ~150 px more). The view resizing when an
  inspector opens is the lesser evil — it's how most editors behave.
- **Don't undo:** Don't put a fixed height back on `#timeline`, and keep the
  envelope canvas absolutely positioned inside `.tl-env-wrap` — a canvas in a
  flex column feeds its backing-store size back into layout and grows.

---

## The cue & effect model (this is where the design is still moving)

### Why the fixture-cue model is "per-attribute" — and why the user found it unintuitive
- **What it is:** A fixture cue runs **one** per-attribute effect — Intensity
  *or* Colour *or* Position (`effects.js`, grouped by `attr`). Effects are
  waveform-driven (shape / rate / beat-sync division / size / base / phase / fan /
  direction / duty). You build a "look" by **stacking** an intensity + colour +
  position cue on different lanes.
- **Why it was built this way:** It's the console-correct attribute model and it's
  powerful (independent per-attribute automation, clean HTP/LTP merge).
- **Why the user pushed back:** A single cue is never a complete look — a lone
  Colour cue shows nothing (no brightness), so you must mentally compose 2–3 cues.
  Too steep a mental model for this user's workflow. **This is the friction that
  triggered the laser pivot.** Keep this context: don't "fix" it by collapsing
  effects back into monolithic looks — that was the *old* model we moved away from
  for a different reason (it couldn't layer).

### Merge: intensity = HTP, colour/position = LTP (automatic, per attribute)
- **Decision:** Effects write to the engine **sink** (`c.out.dimmer/rgb/panTilt`).
  The engine accumulates per fixture and flushes once: **intensity takes the max
  across cues (HTP)**, colour/position take the last writer in lane order (LTP,
  lane 0 = top wins).
- **Why:** Standard console behaviour — a base wash at 40% plus a beat-pulse layer
  should ride to 100% on the beat and stay at 40% between (HTP), not get replaced
  down to 0. Colour/position want a single owner (LTP). This replaced an earlier
  per-cue HTP toggle; making it automatic-per-attribute is more correct and less
  for the user to think about.
- **Don't undo:** Effects must not write the hub directly; they go through the
  sink so the merge can apply. The flush is also the per-frame blackout (a fixture
  no cue touched reads 0).

### Groups are resolved by fixture type (for now)
- **Decision:** `ShowEngine.groupFixtures('movers'|'pars'|'bars'|'lasers'|'sparks'|'selection'|'all')`.
- **Why:** Good enough until user-defined groups land (a V2 item). "Selection" =
  the current viewport selection (fed in each frame).

### The laser pivot — cue = pattern, effects = BEYOND's 7 "Key Effects"
- **Decision:** A `kind:'laser'` cue is a **vector pattern** (`src/laser/patterns.js`)
  plus seven parameters as values: **Size, Rotation X/Y/Z, Position X/Y, Colour,
  Brightness, Visible Points, Scan Rate**. `LaserRig` renders the top active laser
  cue as **both** 3D beams-into-the-venue **and** a flat 2D galvo preview canvas.
- **Why:** The user wants parity with **Pangolin BEYOND** (they shared a
  screenshot). In BEYOND, a cue is laser *content* and effects are modifiers you
  keyframe. That model is far more intuitive for a laser show than stacking
  per-attribute fixture cues: one cue = one complete pattern you tune in place.
  The 7 parameters are exactly BEYOND's "Key effect" list.
- **Rendering choice — "Both":** the user explicitly chose both the 3D volumetric
  beams (fits our venue + haze) and the flat galvo preview (BEYOND's projector
  windows). Not either/or.
- **Status:** **Stage 1 done** (patterns + 7 params as *values* + render + timeline
  + save/load). **Stage 2 done** (keyframe envelopes — see below). Stage 3 =
  multiple projectors/zones + palettes + an audio-reactive auto-preset for live
  song visualizing.
- **Don't undo:** Fixture cues stay for hybrid shows. The laser system is the
  strategic focus; build toward BEYOND, don't collapse the two cue kinds together
  prematurely.
- **Laser cues are visual-only.** Nothing writes laser cues to DMX or ILDA yet;
  the `LaserProjector` *fixture* is a separate DMX-driven model. Bridging the two
  (laser cue → DMX laser channels, or real ILDA/galvo output) is open.

### Size and Position are independent (same transform in 3D and in the preview)
- **Decision:** Both `LaserRig` paths transform a galvo point as rotate-Z →
  `X*size + posX` → (3D only) tilt by rotX/rotY and map to metres.
- **Why:** Stage 1's 3D path added the position *before* scaling, so in the venue
  Position moved with Size while the 2D preview didn't — the two views disagreed.
  BEYOND semantics: Position is where the frame sits, Size scales it in place.
  A Node check compares the 3D buffer against the preview's canvas calls.

### Keyframe envelopes are an overlay on static params (`cue.anim`)
- **Decision:** `cue.params` keeps a plain static value for every parameter;
  `cue.anim[key] = { ease, keys:[{t, v}] }` (optional) overrides it while the cue
  plays. `resolveLaserParams(cue, u)` returns `cue.params` itself when nothing is
  animated.
- **Why:** The earlier plan was polymorphic params (a scalar *or* a keys object).
  That would make every consumer type-check (`LaserRig`, the inspector, the
  `{...params}` copies in save/undo). With an overlay, old saves load unchanged,
  `LaserRig` still only sees numbers, an un-animated cue costs nothing per frame,
  and removing an envelope just freezes its current value back into `params`.
- **Don't undo:** Don't fold envelopes into `params`.

### Key time is normalised 0..1 across the cue
- **Decision:** `t` = fraction of the cue (BEYOND's 0–100% "effect based on
  time" strip), not seconds.
- **Why:** Moving a cue carries its animation with it, and resizing a cue to fit
  the music stretches the animation to fit too — the common case when you extend
  a cue. Trade-off: after a resize, keys no longer sit exactly on the beats they
  were snapped to. Snapping is done against the absolute beat grid at edit time.

### Keying works like After Effects, plus BEYOND's auto-key
- **Decision:** Once a parameter is animated, changing it in the inspector writes
  a key at the playhead; it never silently edits the hidden base value. The ◆
  button keys the current value explicitly (the "start animating" gesture). The
  **Auto-key** toggle (BEYOND's "Enable auto-keying") makes edits to static
  parameters key too. Animated parameters' sliders follow the playhead live.
- **Why:** Without this, moving the slider of an animated parameter would change
  `params` while the envelope keeps overriding it — "I moved it and nothing
  happened". Paused edits key *exactly* at the playhead so the control keeps the
  value you set; edits and ◆ presses **during playback** quantise to the
  half-beat grid, so tapping ◆ lands on the beat and a slider drag records at
  most one key per half-beat instead of one per frame.

### Envelope editing details
- **One key per time:** `setKey` updates a key within `KEY_EPS` (0.3% of the cue)
  rather than inserting; dropping a dragged key onto another replaces it (AE).
- **Snapping:** keys snap to the half-beat grid aligned to the detected downbeat
  (`beatOffset`), and to the cue's ends; **Shift** = free. Laser hits land on
  beats and half-beats, and this matches cue snapping to beats.
- **Seek on key:** while paused, pressing or releasing a key moves the playhead
  to it, so the inspector shows and edits that key's value.
- **Ease is per envelope** (`linear` / `smooth` / `step`), not per key. That covers
  the BEYOND basics; per-key bezier handles are a later refinement.
- **Colour interpolates in RGB** (simple, predictable). HSV interpolation sweeps
  through hues, which could become an option.
- **Del on the focused envelope never reaches the global handler**, which would
  otherwise delete the fixture selected in the viewport.

### `LASER_PARAMS` is the single source of truth for laser parameters
- **Decision:** `src/laser/envelopes.js` declares each parameter's key, label,
  range, step and display format. The inspector rows, the envelope editor's
  value axis and `loadAnim` (save-file sanitising) are all built from it.
- **Why:** In Stage 1 the laser inspector reused the fixture sliders: Size was
  capped at 1 (a laser zooms *up*, so the range is now 0–2), and rotation showed
  raw radians with no readout. Rotation is **stored in radians** (what `LaserRig`
  consumes, so saves need no migration) and **displayed in degrees**.

---

## Project persistence & undo

### Save/load = JSON snapshot; audio is NOT embedded
- **Decision:** `serializeProject()`/`applyProject()` round-trip room + fixtures
  (type/patch/pos/rot/mirror) + cues (fixture and laser) + settings to JSON. Audio
  is re-imported on load (only its name is stored). Load shows a status line
  ("Loaded N fixtures, M cues").
- **Why:** JSON is simple and already drives undo. Embedding audio needs a zip
  container (a later item). The status line exists because a silent load failure
  (or loading an old/empty file) looked like "cues vanished" — now you see exactly
  what the file contained. Old files without cues are almost always an older save
  or the wrong `lightshow-project (N).json`.

### Undo/redo = whole-project snapshots (not a command pattern)
- **Decision:** `history` snapshots the full serialized project on each committed
  edit; undo/redo re-applies a snapshot (100 deep).
- **Why:** Reuses the serializer, so it covers everything (fixtures, cues, room,
  BPM, haze/brightness, laser envelopes) with a one-line `history.record()` hook
  per action. Simple and robust for this scale.
- **Undo keeps your place:** undo/redo call `applyProject(..., { keepTransport:
  true })` and re-select the cue at the same index (cue order is stable in the
  snapshot). Keyframes are edited at the playhead, so jumping to 0 and closing
  the inspector on every Ctrl+Z (the old behaviour) lost the user's place.
  Loading a file still stops the transport.
- Saved envelopes go through `loadAnim()` (drops unknown parameters and malformed
  keys, clamps and sorts) on both load and undo, so a hand-edited file can't
  break playback.

---

## Smaller but non-obvious choices

- **House light** (`src/viz/HouseLight.js`) is a viewport aid, **not** a DMX
  fixture — a toggleable flood (hemisphere + point + bulb) so you can see the rig.
  It doesn't touch the hub.
- **Room brightness** drives tone-mapping **exposure** + ambient, not just ambient
  — the room shell material is near-black, so ambient alone barely changes it.
- **Haze** drives the beam shader's `uHaze` (shared uniform across all beam
  materials) **and** a gentle scene fog. The shared-uniform trick means one slider
  moves every beam.
- **Cold sparks share address 37 on purpose** (a mirrored pair). The patch panel
  flags it as a collision because surfacing overlapping addresses is correct — real
  consoles warn too. It's not a bug.
