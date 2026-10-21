# Roadmap — status & direction

Status as of the hand-off. `✔` done · `~` partial · `✗` not started · `⊘` dropped
on purpose. See DESIGN_DECISIONS.md for why things were built the way they were.

## Where we are right now

**Active focus: a Pangolin BEYOND-style laser-show designer.** The user runs
primarily laser shows. The cue system is pivoting from per-attribute fixture cues
(found unintuitive) to **laser cues = a vector pattern + 7 "Key Effect"
parameters**. Fixture cues stay for hybrid shows.

- **V2.1 Stage 1 — laser patterns + 7 params as values — ✔ DONE.**
- **V2.1 Stage 2 — per-parameter keyframe envelopes — ✔ DONE.** Laser inspector
  built from one parameter spec (Size to 2×, rotation in degrees, live
  readouts), ◆ key buttons, AE-style keying + Auto-key, an envelope editor
  (add/drag/delete keys, half-beat snapping, linear/smooth/step ease, colour
  strip), key ticks on cue blocks, save/load/undo. The demo laser cue ships
  with a keyframed spin + size swell. See ARCHITECTURE.md "Keyframe envelopes".
- **V2.1 Stage 3 — ✗ NEXT.** Multiple laser projectors/zones, bigger pattern
  library, colour palettes, and an **audio-reactive auto-preset** for live song
  visualizing.

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
- Saved cameras + camera keyframes — ✗
- Fullscreen perform mode — ✗

### M6 — Deliverables & polish — ✗
- Offline video (MP4) export — ✗
- Paperwork export (patch sheet, fixture schedule, power) — ✗
- Beam LODs / quality presets — ✗
- `.exe` build profile — ~ (electron-builder `dist` config present; `npm run dist`)

## Added this cycle (beyond the original milestones)

Undo/redo (whole-project snapshots) · keyboard shortcuts (V/X/C tools, Ctrl+S,
Ctrl+Z/Y, Space, Del, Esc) · full 3-axis rotate gizmo · toggleable house light ·
room-brightness (exposure) control · the shutdown-crash fix · the beam-shader
fix (fresnel cone; cones were invisible before) · load-result status line.

With Stage 2: free-running clock loops at the show end (the demo used to go dark
after 16 s) · undo/redo keep the playhead and the open cue · timeline panel
sized by content (an open inspector used to squeeze the waveform to 0 px) ·
laser Size/Position 3D-vs-preview mismatch fixed · Space/Ctrl+Z work right after
dragging a slider.

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
- **V2.5 — Timeline & automation (P).** Timeline zoom/scroll, markers, parameter
  keyframes/automation curves (✔ for laser cues via Stage 2; fixture cues
  still static), timecode (SMPTE LTC/MTC) sync.
- **V2.6 — Fixture realism.** Gobo (+rotation), prism, iris, focus/frost, colour
  wheel, CMY/CTO, shutter/strobe; GDTF/MVR import.
- **V2.7 — Output & I/O.** Multi-universe management, sACN priorities, Enttec USB
  Pro (deferred), paperwork export.
- **V2.8 — Platform & polish.** Autosave + recent files + **zipped project-with-
  media** (embed audio); refactor `app.js` into an `App` module; a real
  engine/effects test suite; perf pass for pixel tape/matrices; video export.

## Deferred on purpose (don't re-propose without reason)

- **No build step / framework / TypeScript build** — breaks one-click install.
- **FFmpeg** — Web Audio covers the common formats; FFmpeg is a heavy native dep.
- **Enttec USB Pro** — needs the `serialport` native module; Art-Net/sACN covers
  modern nodes. Returns as an optional add-on later.
- **Video projector object** — removed on request; the show is audio-only.
