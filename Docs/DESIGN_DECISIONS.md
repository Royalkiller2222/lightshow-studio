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
  loaded, else free-runs. BPM lives on the transport; the one BPM field (top bar)
  writes `transport.bpm`, and the engine and beat grid read it.
- **Why:** Demo is alive on launch with no track; locks to the song when loaded.
  Two BPM inputs (sidebar + timeline) diverging was a real bug — single source
  fixes it, and the remake reduced it to a single field.

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

### Canvases sit absolutely inside a sized wrapper
- **Decision:** Every timeline canvas — ruler, waveform, curve lanes
  (`.tl-cv`, `.crv-body`) — is `position:absolute; inset:0` inside a wrapper
  whose size comes from layout.
- **Why:** A canvas in a flex column feeds its backing-store size (which we set
  from its CSS size × devicePixelRatio) back into layout and grows every frame;
  before the remake that squeezed the waveform to 0 px and ballooned the curve
  editor to 350 px.
- **Don't undo:** Keep canvases out of the flex/grid size calculation.

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
(Since v0.4.0 keys are edited in the timeline's curve lanes — see "Keyframe
curves live under the track"; these rules carried over unchanged.)
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
- **Del on a focused curve lane never reaches the global handler**, which would
  otherwise delete the selected cue, track or fixture.

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
- **Decision:** `serializeProject()`/`applyProject()` (`src/core/project.js`)
  round-trip room + fixtures (type/patch/pos/rot/mirror) + cues (fixture and
  laser) + settings to JSON. Audio is re-imported on load (only its name is
  stored). Opening a file shows a notification ("Opened x: N fixtures, M cues",
  plus a reminder to re-load the song); the file name becomes the show name.
- **Why:** JSON is simple and already drives undo. Embedding audio needs a zip
  container (a later item). The notification exists because a silent load failure
  (or loading an old/empty file) looked like "cues vanished" — now you see exactly
  what the file contained. Old files without cues are almost always an older save
  or the wrong `lightshow-project (N).json`.
- Output settings (Art-Net IP, sACN) are **not** in the show file — they belong
  to the computer/network, so they're remembered per machine instead.

### Undo/redo = whole-project snapshots (not a command pattern)
- **Decision:** `history` snapshots the full serialized project on each committed
  edit; undo/redo re-applies a snapshot (100 deep).
- **Why:** Reuses the serializer, so it covers everything (fixtures, cues, room,
  BPM, haze/brightness, laser envelopes) with a one-line `history.record()` hook
  per action. Simple and robust for this scale.
- **Undo keeps your place:** undo/redo call `applyProject(..., { keepTransport:
  true })` and re-select the cue and the fixture at the same index (cue and
  patch order are stable in the snapshot). Edits happen at the playhead / on the
  selection, so jumping to 0 and clearing the inspector on every Ctrl+Z (the old
  behaviour) lost the user's place. Loading a file still stops the transport.
- **"Edited" flag:** `History` remembers the snapshot at the last save/open;
  "Edited" (and a • in the window title) shows whenever the current snapshot
  differs — undoing back to the saved state clears it, which a simple "changed
  since save" boolean wouldn't.
- Saved envelopes go through `loadAnim()` (drops unknown parameters and malformed
  keys, clamps and sorts) on both load and undo, so a hand-edited file can't
  break playback.

---

## The interface (V2 remake, Oct 2026)

The user asked for the app to be "as user friendly and simple as possible with
advanced things — pros and beginner friendly". Every choice below was made by
the user from multiple-choice options after seeing a mockup; the recommended
option won each time. **Don't re-litigate these** — refine within them.

### Workspaces: Build / Program (Live later), one shared 3D view
- **Decision:** Tabs in the top bar switch the *task*: Build (fixture library,
  fixture/venue inspector, patch sheet) and Program (pattern + effect library,
  cue inspector, timeline). The 3D view never changes. Live arrives in remake
  Stage 4 ("perform the programmed show": section pads from markers, masters,
  blackout, sparks, fullscreen); the auto-preset joins it in laser Stage 3.
- **Why:** Beginners follow the tabs left to right; pros jump straight to the
  one they need. Each screen only shows what that task needs, instead of one
  sidebar holding everything. The tab doesn't exist until its content does — no
  "coming soon" UI.
- **How:** all panels are mounted once; CSS hides `[data-ws-only]` content for
  other workspaces. Panel sizes are remembered *per workspace* (Build wants a
  wide library; Program a tall timeline).

### Simple / Pro = a global switch *and* "More" rows
- **Decision:** Simple shows the essentials only; Pro shows everything, with
  rarely-used controls inside collapsible "More" rows that remember being open.
  `.pro` = only in Pro; `more()` = a "More" disclosure (Pro only).
- **What counts as Pro today:** DMX universe/address/channels (fixtures are
  auto-patched, so beginners never need them), extra rotation axes, laser
  tilt X/Y, visible points, scan rate, auto-key and easing, fixture-effect
  waveform details, the beat-offset field, external-console mode and sACN.
- **Why:** The user chose "Both". A switch alone hides features people later
  can't find; More rows alone still crowd beginners. Default is Pro until the
  welcome screen (remake Stage 5) asks.

### Look: "Studio graphite"
- **Decision:** Neutral dark greys with a single blue accent (`--accent`).
  Colour is reserved for show content — beams, laser green, fixture-cue blue,
  keyframe amber, the pink playhead.
- **Why:** Chosen over "Neon club" and "Laser green": the UI must never compete
  with the show being designed, and it reads as a calm pro tool.

### One inspector, driven by selection
- **Decision:** The right panel edits whatever was picked most recently — a
  cue or a fixture (from the 3D view or a patch-sheet row). With nothing
  selected it shows the workspace default: Venue (room size, rig summary) in
  Build, Show (song, tempo, cue counts) in Program.
- **Why:** "One place to edit" is the core beginner affordance; the old UI
  split settings between a long sidebar and a strip under the timeline. The
  cue editor is a single persistent element the inspector re-parents, so its
  state (curve parameter, auto-key) survives switching selections.

### Libraries + drag and drop everywhere
- **Decision:** Build's library is fixture cards (drag into the venue, `+`, or
  double-click). Program's library is laser patterns drawn as real thumbnails
  from the pattern data, plus fixture effects; drag onto a timeline lane (drop
  position snaps to the beat, lane under the cursor), or double-click / Enter
  to add at the playhead in the first free lane.
- **Why:** Direct manipulation is the most learnable interaction; thumbnails
  beat names for picking a pattern. Each drop target ignores the other kind of
  drag (patterns can't land in the venue).

### Ctrl+K command search
- **Why:** Beginners find features by describing them ("add tunnel", "house
  light"); pros get keyboard access to everything without menus. Every command
  shows its shortcut, which teaches the shortcuts.

### Output settings live behind the status pill
- **Decision:** The top bar shows a status pill ("Art-Net 127.0.0.1", amber when
  following a console); clicking it opens the settings. Mode and sACN are Pro.
- **Why:** Set once per venue, glanced at constantly — status in view, settings
  out of the way. Remembered per computer, not per show.

### Atmosphere and tools float on the 3D view
- **Decision:** Select/Move/Rotate + camera reset (top-left), haze / room light /
  house light (top-right), "Hold for sparks" + a mouse hint (bottom-left), the
  laser preview (bottom-right, Program).
- **Why:** These change how you *see* or *touch* the venue, so they sit on it.
  The camera hint disappears for good after the first orbit; the sparks button
  only appears when the rig has spark machines.

### Named tracks (remake Stage 2, v0.4.0)
- **Decision:** The timeline is a list of tracks (`engine.tracks`, top first).
  A cue belongs to one track (`cue.track` = track id). A track has a kind
  (laser / fixture), a name, and — for fixture tracks — the fixtures it drives
  (`groupId`), plus mute / solo / open.
- **The target lives on the track**, not the cue: "drop it on the Movers track"
  is how beginners think, and it's DAW-familiar for pros. The engine still reads
  `cue.groupId` and `cue.lane`; `engine.syncTracks()` derives both from the
  track (lane = track index), so the HTP/LTP merge and "top laser wins" didn't
  have to change. **Call `syncTracks()` after any track/cue reassignment.**
- **Tracks are layers, so several may drive the same fixtures.** Higher track
  wins colour/position; brightness is still HTP. (Before Looks, a mover look
  needed three tracks; since v0.5.0 one look clip covers all three.)
- **Clips may overlap within a track** (later-starting wins, as lanes did) —
  not forbidden, so moving things around never fails.
- **Mute / solo:** any solo means only soloed tracks play (`engine.audible()`).
- **Why:** The anonymous 5 lanes made every cue pick its own target and gave
  no way to name, mute or reorder parts of a show.

### Keyframe curves live under the track, lined up with the music
- **Decision:** A laser track opens into one curve lane per animated Key
  Effect (+ the parameter you last focused). Lanes span the whole timeline; each
  laser cue on the track draws its own envelope inside its time range. Keys are
  edited in place (click to add, drag, double-click / Del). The inspector keeps
  the ◆ buttons, values, ease and Clear; clicking a parameter name or ◆ opens
  its lane (`timeline.focusCurve`).
- **Why:** The user chose "curves under the cue, aligned to the music" — hitting
  a beat or a drop is the whole point of keyframing, and the narrow inspector
  canvas couldn't show that. Key times are still cue-normalised (0..1), so the
  envelope model and snapping (`timeline/snap.js`) didn't change.

### Zoom, scroll and follow
- **Decision:** The timeline view is `t0` (left-edge time) + `pps` (px/s).
  Ctrl+wheel zooms about the cursor, Shift+wheel / the scrollbar / the wheel over
  the ruler scroll, Fit shows everything; while playing the view pages forward
  when the playhead leaves it. The waveform asks `AudioEngine.peaksRange()` for
  only the visible slice (cached per view), so zooming in shows detail.
- Clip positions are recomputed from the view on every change (`_layoutClips`);
  rows are rebuilt only when data changes (`render`). Cheap at show sizes.

### Section markers
- **Decision:** `engine.markers = [{t, name}]` (kept sorted), drawn as flags on
  the ruler; add with M / the Marker button / double-click the ruler; drag to
  move (beat snap, Shift free); edit in the inspector.
- **Why:** Songs have sections; naming them is how both beginners and pros
  navigate a show — and they become the Live workspace's section pads (Stage 4).

### Show file version 2
- **Decision:** `version: 2` adds `tracks` and `markers`; each cue stores its
  track index. Opening a v1 file runs `tracksFromLanes()`: one track per (old
  lane, laser | fixture group), named from its content ("Laser 1",
  "Movers · Colour"), in lane order so priorities are unchanged. A cue whose
  track is missing or the wrong kind gets a fresh track instead of failing.
- **Don't undo:** Never drop v1 support silently — users have v0.3.0 files.

### Looks: a fixture cue is a complete look made of layers (remake Stage 3, v0.5.0)
- **Decision:** A fixture cue is `{ kind:'fixture', name, layers:[{effectKey,
  params}] }` with at most one layer per slot — Intensity, Colour, Movement
  (`show/looks.js`: `SLOTS`, `slotOf`, `makeLayer`, `setLayer`,
  `normalizeLayers`). The engine applies every layer of an active look to the
  track's fixtures through the same sink, so the HTP/LTP merge across tracks is
  unchanged. Seven ready-made presets (`LOOKS`) sit in the library.
- **Why:** The user found the per-attribute model unintuitive ("a lone Colour
  cue shows nothing") and chose "Looks with layers" over keeping separate cues.
  This is **not** a return to the old monolithic looks: each layer is still an
  independent waveform effect, and looks on different tracks still layer
  (brightest intensity wins; the higher track wins colour/movement).
- **Editing:** the inspector shows one section per slot (effect picker incl.
  "None" + that effect's controls; advanced under More). Dropping a single
  effect onto a look replaces that slot. A look named automatically
  ("Flat · Rainbow · Wave") keeps following its layers until the user renames it.
- **Files:** version 3 stores `layers` + `name`; v1/v2 fixture cues
  (`effectKey` + `params`) open as one-layer looks.
- **Placement:** double-clicked library items go to a track with room at the
  playhead, else onto a **new** track — a clip stacked exactly on another is
  invisible and confusing.

### Not now (decided, coming in later remake stages)
The Live workspace (Stage 4), welcome screen + 5-step tour (Stage 5). See
Roadmap.

---

## Shipping

### Releases: tag → GitHub Actions → installer on a GitHub Release
- **Decision:** Every finished stage bumps `package.json`'s version, adds a
  `## vX.Y.Z` section to `CHANGELOG.md`, and pushes a `vX.Y.Z` tag. The
  `release.yml` workflow (windows-latest) runs `npm test`, builds the NSIS
  installer and publishes it with `gh release create` — the notes are that
  CHANGELOG section.
- **Why:** The user wants every update as "an exe they install". Building in CI
  needs no tokens or extra tools on the developer's machine (the workflow's own
  `GITHUB_TOKEN` publishes) and is reproducible. Only first-party actions
  (`actions/checkout`, `actions/setup-node`) and the preinstalled `gh` CLI.
  The workflow fails fast if the tag doesn't match `package.json`.

### Installer: NSIS one-click, per-user
- **Decision:** `oneClick`, `perMachine: false`, desktop + Start-menu shortcuts,
  launches when done. Artifact `LightshowStudio-Setup-<version>.exe`.
- **Why:** "Just run an exe they install" — no wizard pages, no admin prompt.
- **Known:** it isn't code-signed (a certificate costs money), so SmartScreen
  warns on first run; README and release notes explain "More info → Run anyway".

### electron-builder drops `three/examples` unless told not to
- **Decision:** `build.onNodeModuleFile` points at `scripts/builder-include.js`,
  which force-includes `node_modules/three/examples/jsm`.
- **Why:** electron-builder hard-codes skipping every dependency's top-level
  `examples` folder — and three ships its addons (OrbitControls,
  TransformControls, bloom passes) there. Without the hook the packaged app
  opens to a blank window. A `files` pattern does **not** override this.
- **Don't undo:** Keep the hook (and check the packaged app after any
  dependency change — see DEV_WORKFLOW "Verify the packaged app").

### The logo
- **Decision:** A fan of coloured beams fired from a white diamond emitter (the
  ◆ keyframe symbol) on a graphite tile. `src/ui/logo.js` generates it: the full
  5-beam mark, and a bolder 3-beam cut for 16–32 px where thin beams smear.
  `npm run icons` rasterises it with Electron's own Chromium into
  `build/icon.ico` (BMP entries ≤128 px + PNG 256, the layout every Windows
  tool incl. NSIS accepts), `build/icon.png`, `build/icon.svg` and the window
  icon `src/assets/icon.png`.
- **Why:** Laser show identity (beams + keyframes), readable at taskbar size,
  and one source of truth so the top-bar mark, window icon and installer icon
  never drift apart. No image libraries needed.

---

## Smaller but non-obvious choices

- **House light** (`src/viz/HouseLight.js`) is a viewport aid, **not** a DMX
  fixture — a toggleable flood (hemisphere + point + bulb) so you can see the rig.
  It doesn't touch the hub. Opening a show re-hangs it for the show's room.
- **Room brightness** drives tone-mapping **exposure** + ambient, not just ambient
  — the room shell material is near-black, so ambient alone barely changes it.
- **Haze** drives the beam shader's `uHaze` (shared uniform across all beam
  materials) **and** a gentle scene fog. The shared-uniform trick means one slider
  moves every beam.
- **Cold sparks share address 37 on purpose** (a mirrored pair, now also
  mirror-linked so moving one moves the other). The patch sheet flags it as a
  collision (Pro) because surfacing overlapping addresses is correct — real
  consoles warn too. It's not a bug.
- **Atmosphere** (haze, room light, house light) is one `Atmosphere` object so
  the viewport sliders, show files and undo all go through the same setters.
- **Shortcuts stand down only in text fields.** Space / Ctrl+Z / V-X-C still
  work right after dragging a slider or picking a colour (the laser inspector is
  mostly sliders); Del never deletes from a focused slider. Esc deselects only
  when you're not typing (it used to clear a fixture mid-rename).
