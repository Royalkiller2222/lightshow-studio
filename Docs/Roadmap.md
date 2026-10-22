# Roadmap — status & direction

Status as of the hand-off. `✔` done · `~` partial · `✗` not started · `⊘` dropped
on purpose. See DESIGN_DECISIONS.md for why things were built the way they were.

## Where we are right now

**Active focus: the UI remake** (user-approved Oct 2026 — "user friendly and
simple, with advanced things; pros and beginner friendly"). Each stage ships as
a GitHub Release with an installer. Design choices: DESIGN_DECISIONS "The
interface".

- **Remake Stage 1 — new layout + look — ✔ v0.3.0.** Build / Program
  workspaces, top bar (transport, Simple/Pro, output pill, Ctrl+K search, help),
  resizable/collapsible panels, Studio graphite theme + icon set, floating tools
  and atmosphere on the 3D view, one selection-driven inspector (fixture / cue /
  venue / show), fixture library + patch sheet, pattern/effect library with
  drag-and-drop to the timeline, numeric fixture editing, toasts, "Edited"
  flag. Logo + app icons, NSIS installer, release workflow.
- **Remake Stage 2 — named-track timeline — ✔ v0.4.0.** Named laser / fixture
  tracks (target fixtures per track, mute/solo, rename, reorder, delete);
  clips move between tracks; keyframe curve lanes under open laser tracks,
  aligned to the music; section markers on a bar ruler; zoom / scroll / fit /
  follow-playhead; zoomable waveform; show-file v2 with automatic v1
  migration.
- **Remake Stage 3 — fixture Looks — ✔ v0.5.0.** One clip = a complete look with
  Intensity / Colour / Movement layers, a per-slot look editor, seven
  ready-made presets, effect-onto-look layer swap, show-file v3 (older files
  convert to one-layer looks).
- **Remake Stage 4 — Live workspace — ✗ NEXT.** Section pads from timeline
  markers, brightness/speed/size masters, blackout, sparks, fullscreen.
- Remake Stage 5 — **first run**: welcome screen (Demo / Empty venue / Open +
  Simple or Pro) and a skippable 5-step tour; more empty-state hints.

**The laser track** (BEYOND-style designer) continues after the remake. The
user runs primarily laser shows. The cue system pivoted from per-attribute
fixture cues (found unintuitive) to **laser cues = a vector pattern + 7 "Key
Effect" parameters**. Fixture cues stay for hybrid shows.

- **V2.1 Stage 1 — laser patterns + 7 params as values — ✔ DONE.**
- **V2.1 Stage 2 — per-parameter keyframe envelopes — ✔ DONE.** Laser inspector
  built from one parameter spec (Size to 2×, rotation in degrees, live
  readouts), ◆ key buttons, AE-style keying + Auto-key, an envelope editor
  (add/drag/delete keys, half-beat snapping, linear/smooth/step ease, colour
  strip), key ticks on cue blocks, save/load/undo. The demo laser cue ships
  with a keyframed spin + size swell. See ARCHITECTURE.md "Keyframe envelopes".
- **V2.1 Stage 3 — ✗ after the remake.** Multiple laser projectors/zones,
  bigger pattern library, colour palettes, and an **audio-reactive auto-preset**
  for live song visualizing (it joins the Live workspace).

### Stage 2 follow-ups (small, pick any)
- **Waveform mode per parameter** — BEYOND's "effect based on waveform": a
  parameter driven by an LFO (sine/saw/square, beat-synced) instead of keys.
- **Rotation centre point** — rotate about an offset, not the frame centre.
- **Per-key easing / bezier handles**; HSV colour interpolation as an option.
- **Multi-key editing** — box-select, move several keys, copy/paste envelopes
  between cues.
- **Laser output** — laser cues are visual-only; map them to the LaserProjector's
  DMX channels or real ILDA/galvo output.

## V1 milestones (the original plan) — status

### M1 — DMX core + visualization — ✔
Universe buffers (single source of truth), Art-Net out/in, sACN out, analytic
volumetric beams + haze, moving head, cold spark, parametric room, orbit camera,
playback engine. (The old `DemoShow` generator was replaced by `ShowEngine`.)

### M2 — Patch & fixture library — ~
- FixtureProfile (channel layout as data) — ✔
- Patch view UI (editable universe/address, collision warnings) — ✔
- Drag-and-drop placement (raycast, mirror, snap) + move/rotate gizmo — ✔
- Fixture library (moving head, LED PAR, pixel bar, wash batten, laser, cold
  spark, podium prop) + type registry + dispose — ✔
- Fixture groups — ~ (type-based groups in the engine; no user-defined groups UI)
- GDTF importer — ✗ (deferred; `FixtureProfile` + `registry` are the seam for it)
- Truss & rigging prefabs — ✗ (a podium prop exists; no truss)

### M3 — Audio + timeline + cues — ✔ (mostly)
- Audio import (Web Audio decode, not FFmpeg) + waveform — ✔
- Auto BPM/onset detection + beat grid + snapping — ✔
- Multi-lane timeline + editable cues (add/drag/resize/inspector) — ✔
- Playback engine with waveform effect generators + HTP/LTP merge — ✔
- Frequency-band (bass/mid/high) reactive effects — ✔
- Cue presets/looks + crossfades — ✗ (a V2 item)

### M4 — More fixture types — ~
- Lasers — ✔, and now being made first-class (the pivot above)
- Projector/video object — ⊘ **built then removed** on request (audio-only now)
- Pixel/LED tape & matrices — ✗
- Hazer fixture (drives global haze via DMX) — ✗

### M5 — Show modes — ~
- Project file format + load — ✔ (JSON; **no** zip-with-media bundle yet)
- Autosave — ✗
- Saved cameras + camera keyframes — ✗ (a camera reset button exists)
- Fullscreen perform mode — ✗ (remake Stage 4, Live)

### M6 — Deliverables & polish — ✗
- Offline video (MP4) export — ✗
- Paperwork export (patch sheet, fixture schedule, power) — ✗
- Beam LODs / quality presets — ✗
- Installer + releases — ✔ (NSIS one-click installer; tag → GitHub Actions →
  GitHub Release, since v0.3.0). Code signing — ✗ (needs a certificate).

## Added this cycle (beyond the original milestones)

Undo/redo (whole-project snapshots) · keyboard shortcuts (V/X/C tools, Ctrl+S,
Ctrl+Z/Y, Space, Del, Esc) · full 3-axis rotate gizmo · toggleable house light ·
room-brightness (exposure) control · the shutdown-crash fix · the beam-shader
fix (fresnel cone; cones were invisible before) · load-result status line.

With laser Stage 2: free-running clock loops at the show end (the demo used to
go dark after 16 s) · undo/redo keep the playhead and the open cue · laser
Size/Position 3D-vs-preview mismatch fixed · Space/Ctrl+Z work right after
dragging a slider.

With remake Stage 1 (v0.3.0): `app.js` split into `core/` + `ui/` modules ·
undo also keeps the selected fixture · "Edited" flag + window title · house
light re-hung when a show opens · Ctrl+O open, Ctrl+K search, Ctrl+1/2
workspaces, ? help.

## V2 roadmap (the broader plan the laser work sits inside)

Mostly independent; pick any subset. The laser Stages above are the live part of
V2.1. Leans: **(P)** pre-programmed, **(L)** live/busking.

- **V2.1 — Effect engine (P).** Waveform-driven per-attribute fixture effects —
  ✔ done. Laser cue system (BEYOND) — Stages 1–2 ✔, Stage 3 next.
- **V2.2 — Groups, palettes & presets.** User-defined groups/selection sets;
  colour/position/beam palettes referenced by name; saveable effect presets.
- **V2.3 — Cue & cuelist parity (P).** Per-cue fade in/out + crossfade + delay;
  follow/auto-go; cuelists with tracking.
- **V2.4 — Live control / busking (L).** On-screen executors (faders + flash),
  a programmer (manual overrides, record-to-cue), rate/size masters, MIDI/OSC.
- **V2.5 — Timeline & automation (P).** Timeline zoom/scroll ✔, markers ✔
  (remake Stage 2), parameter keyframes/automation curves (✔ for laser cues;
  fixture cues still static), timecode (SMPTE LTC/MTC) sync.
- **V2.6 — Fixture realism.** Gobo (+rotation), prism, iris, focus/frost, colour
  wheel, CMY/CTO, shutter/strobe; GDTF/MVR import.
- **V2.7 — Output & I/O.** Multi-universe management, sACN priorities, Enttec USB
  Pro (deferred), paperwork export.
- **V2.8 — Platform & polish.** Autosave + recent files + **zipped project-with-
  media** (embed audio); ~~refactor `app.js`~~ (✔ split into core/ + ui/ in the
  remake); a real engine/effects test suite; perf pass for pixel tape/matrices;
  video export; auto-update from GitHub Releases; code signing.

## Deferred on purpose (don't re-propose without reason)

- **No build step / framework / TypeScript build** — breaks one-click install.
- **FFmpeg** — Web Audio covers the common formats; FFmpeg is a heavy native dep.
- **Enttec USB Pro** — needs the `serialport` native module; Art-Net/sACN covers
  modern nodes. Returns as an optional add-on later.
- **Video projector object** — removed on request; the show is audio-only.
