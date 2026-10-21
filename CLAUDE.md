# Lightshow Studio — context for Claude Code

3D lightshow designer / DMX previsualizer, built with **Electron + Three.js in
plain JavaScript (ES modules, no build step, no framework)**. It launches with a
working 16-second demo show that loops until you load a track: moving heads
sweeping volumetric beams through haze, plus a laser drawing a keyframed,
spinning tunnel. The moving-head show is real DMX flowing through universe
buffers and out as Art-Net/sACN at 40 Hz. **Laser cues are visual-only today**
(rendered by `LaserRig`; no DMX/ILDA output yet). Cold sparks fire from the
"Hold to fire" button or a `Cold sparks` cue — the demo doesn't fire them.

> **Read the Docs/ before making non-trivial changes.** The code is easy to pick
> up with a read; the *reasoning* is not. In order:
> - **Docs/DESIGN_DECISIONS.md** — the WHY behind the choices. Read this before
>   "simplifying" anything; several obvious-looking refactors re-break bugs we
>   already fixed (the beam shader especially).
> - **Docs/ARCHITECTURE.md** — data flow, module map, the cue/effect/laser model.
> - **Docs/Roadmap.md** — what's done, and where we're going (BEYOND-style laser).
> - **Docs/DEV_WORKFLOW.md** — how to run and *verify* changes (this app is
>   visual; there's a specific verification loop and some real gotchas).

## Hard constraints — do not violate without asking

1. **No build step, no framework, no TypeScript build, no bundler.** Plain ES
   modules loaded via an importmap in `src/index.html`; Three.js comes from
   `node_modules` directly. The whole point is one-click install (double-click
   `Start Lightshow.bat`) on a non-developer's Windows machine. Do **not** add
   React/Vue, a bundler, a TS toolchain, or anything that needs a compile step.
2. **Runs on mid-range hardware; stylized-fast over photoreal.** Beams are an
   analytic cone shader, not raymarching. Keep per-frame cost proportional to
   what's on screen.
3. **DMX addresses are 1-based** (1..512), like real fixtures. `UniverseHub` is
   the single source of truth; everything reads from it.
4. **External dependencies stay minimal.** Currently only `three` (runtime) +
   `electron`/`electron-builder` (dev). Audio decode uses the browser's Web
   Audio API specifically to avoid bundling FFmpeg. Don't add native modules.

## Architecture in one breath

```
UI / ShowEngine (internal mode)        External console
        |                                    |  (Art-Net in, UDP 6454)
        v                                    v
     UniverseHub  (1-based Uint8Array(512) per universe) <-----
     /         \
    v           v
 3D fixtures   Electron main process ---> Art-Net / sACN out (steady 40 Hz tick)
 (beams, sparks, laser graphics)
```

- **`src/dmx/UniverseHub.js`** — single source of truth for all DMX channel
  state. Writers: the show engine (internal mode) or incoming Art-Net (external
  mode). Readers: every fixture + the IPC pump to the main process.
- **Fixtures (`src/fixtures/`)** extend `Fixture.js` and only know their patch
  address; they react to channel values **by attribute name** (`attr('Pan')`),
  resolved through a `FixtureProfile`. This is why External-console mode drives
  the 3D scene with zero extra code — same read path for internal and external.
- **`main.js` + `dmx-io.js`** — Art-Net/sACN out + Art-Net in on a **steady
  40 Hz tick in the main process**, independent of the renderer frame rate, so a
  render hitch never strobes the rig. Bridged via `preload.js`
  (`window.dmxBridge`). Renderer entry is `src/app.js`.
- **Show engine (`src/show/`)** — `ShowEngine` plays timeline **cues** and merges
  them into the hub each frame. Two cue kinds: **`fixture`** (per-attribute
  effects on moving heads/pars/bars) and **`laser`** (BEYOND-style vector pattern
  + 7 "Key Effect" parameters, each optionally keyframed). See the cue-model
  section in ARCHITECTURE.
- **Timeline (`src/timeline/`, `src/audio/`)** — audio clock (`Transport`),
  Web-Audio decode + FFT bands + auto-BPM, and the bottom `TimelinePanel`
  (waveform, beat grid, multi-lane cue editor, fixture-cue inspector, and the
  laser inspector with its keyframe envelope editor).
- **`src/laser/`** — the laser subsystem: vector `patterns.js`, `envelopes.js`
  (parameter spec + pure keyframe math) and `LaserRig.js` (renders the active
  laser cue as 3D beams + a flat 2D galvo preview).

## Current strategic direction (important)

We are mid-pivot toward a **Pangolin BEYOND-style laser-show designer**. The user
runs **primarily laser shows**. The old per-attribute fixture-cue model
(intensity/color/position as separate cues) was found **unintuitive** and is
being superseded by the laser-cue model (a cue = a pattern; effects = the 7 "Key
Effects"). **Fixture cues still exist for hybrid shows — do not rip them out, and
do not "fix" the per-attribute model by reverting it to monolithic looks.** The
laser path is the future: Stage 1 (patterns + values) and Stage 2 (keyframe
envelopes) are done; Stage 3 (multiple projectors/zones, palettes, an
audio-reactive auto-preset) is next. The user wants shows **primarily
pre-programmed**, with an auto preset they can load for live song visualizing.
See Docs/Roadmap.md.

## Working with this user

- **Before coding: confirm the app runs, then propose a short plan and wait for
  an okay.** When they say "you decide", "keep going" or "begin", state the plan
  in a few lines and proceed.
- **Real forks → ask as a multiple-choice question** with a recommended option.
  Don't guess on product direction (the laser pivot came from asking).
- **Find root causes; don't iterate on symptoms.** The invisible-beam bug was
  "fixed" by tuning intensity several times before the real cause (see the beam
  trap in DESIGN_DECISIONS) was found — the user had to call out the loop.
- **Be honest about what you verified.** Say what you tested and how (Node
  check, boot, preview), and what you didn't. Visual quality matters to them —
  look at it in the preview before calling a visual change done.
- **Don't commit or init git unless asked.**

## Run & verify

```bash
npm install      # once
npm start        # launch the Electron app
npm test         # Art-Net/sACN loopback self-test (the only built-in test)
```

- `Start Lightshow.bat` is the end-user one-click launcher (installs deps,
  fetches the Electron runtime, self-heals, then `npx electron .`).
- **This is a visual app.** `npm test` only covers DMX wiring. For engine/effect
  logic, write throwaway Node scripts (Three.js runs headless in Node for
  non-render use). For visuals, use the browser-preview loop. **Read
  Docs/DEV_WORKFLOW.md before verifying** — there are module-cache and
  screenshot gotchas that will waste an hour otherwise.

## Conventions

- Match the surrounding file's comment density and naming; files lead with a
  short comment explaining the module's job and *why* it exists.
- Effects never write to the hub directly — they write to the engine's **sink**
  (`c.out.dimmer/rgb/panTilt/...`); the engine flushes once per fixture so the
  HTP/LTP merge can apply. See DESIGN_DECISIONS.
- Each fixture carries a `typeKey` (for save/load) and a `dispose()` that frees
  per-instance GPU resources but **not** shared module-level materials.
