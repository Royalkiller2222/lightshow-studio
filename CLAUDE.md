# Lightshow Studio — context for Claude Code

3D lightshow designer / DMX previsualizer, built with **Electron + Three.js in
plain JavaScript (ES modules, no build step, no framework)**. Users install it
from a **GitHub Release** (`LightshowStudio-Setup-x.y.z.exe`). It launches with a
working 16-second demo show that loops until you load a track: moving heads
sweeping volumetric beams through haze, plus a laser drawing a keyframed,
spinning tunnel. The moving-head show is real DMX flowing through universe
buffers and out as Art-Net/sACN at 40 Hz. **Laser cues are visual-only today**
(rendered by `LaserRig`; no DMX/ILDA output yet). Cold sparks fire from the
"Hold for sparks" button or a `Cold sparks` cue — the demo doesn't fire them.

> **Read the Docs/ before making non-trivial changes.** The code is easy to pick
> up with a read; the *reasoning* is not. In order:
> - **Docs/DESIGN_DECISIONS.md** — the WHY behind the choices. Read this before
>   "simplifying" anything; several obvious-looking refactors re-break bugs we
>   already fixed (the beam shader especially).
> - **Docs/ARCHITECTURE.md** — data flow, module map, the UI layout, the
>   cue/effect/laser model.
> - **Docs/Roadmap.md** — what's done, and where we're going (UI remake stages,
>   BEYOND-style laser).
> - **Docs/DEV_WORKFLOW.md** — how to run, *verify* and *release* changes (this
>   app is visual; there's a specific verification loop and some real gotchas).

## Hard constraints — do not violate without asking

1. **No build step, no framework, no TypeScript build, no bundler.** Plain ES
   modules loaded via an importmap in `src/index.html`; Three.js comes from
   `node_modules` directly. Users get a one-click installer (electron-builder
   NSIS); developers double-click `Start Lightshow.bat`. Do **not** add
   React/Vue, a bundler, a TS toolchain, or anything that needs a compile step.
2. **Runs on mid-range hardware; stylized-fast over photoreal.** Beams are an
   analytic cone shader, not raymarching. Keep per-frame cost proportional to
   what's on screen.
3. **DMX addresses are 1-based** (1..512), like real fixtures. `UniverseHub` is
   the single source of truth; everything reads from it.
4. **External dependencies stay minimal.** Only `three` (runtime) +
   `electron`/`electron-builder` (dev). No icon fonts or UI kits — icons are
   hand-drawn SVG in `src/ui/icons.js`. Audio decode uses the browser's Web
   Audio API specifically to avoid bundling FFmpeg. Don't add native modules.

## Architecture in one breath

```
Show engine (timeline cues)            External console
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
  (`window.dmxBridge`). Renderer entry / composition root is `src/app.js`.
- **`src/core/`** — `Rig` (fixtures + patch: spawn/place/remove, auto-patching,
  labels) and `project.js` (save/open JSON + whole-snapshot undo `History`).
- **Show engine (`src/show/`)** — `ShowEngine` plays timeline **cues** and merges
  them into the hub each frame. Two cue kinds: **`fixture`** — a *look*: up to
  three layers (intensity / colour / movement), each a waveform effect, see
  `show/looks.js` — and **`laser`** (BEYOND-style vector pattern
  + 7 "Key Effect" parameters, each optionally keyframed).
- **Timeline (`src/timeline/`, `src/audio/`)** — audio clock (`Transport`),
  Web-Audio decode + FFT bands + auto-BPM, `TimelinePanel` (DAW-style: bar
  ruler + markers, waveform, **named tracks** with mute/solo, clips, keyframe
  curve lanes under laser tracks, zoom/scroll) and `CueInspector` (edits the
  selected cue). Cues belong to tracks; `engine.syncTracks()` derives each
  cue's priority (`lane`) and fixture target from its track.
- **`src/laser/`** — vector `patterns.js`, `envelopes.js` (parameter spec + pure
  keyframe math) and `LaserRig.js` (3D beams + the flat galvo preview).
- **UI (`src/ui/`)** — the window is *top bar / [library | 3D view | inspector] /
  bottom area*. `Shell` (Build / Program workspaces, resizable panels,
  Simple/Pro), `TopBar`, `ViewportOverlay`, `Inspector`, `FixtureLibrary`,
  `ContentLibrary`, `PatchSheet`, `CommandPalette` (Ctrl+K), plus `icons.js`,
  `logo.js`, `dom.js`, `overlays.js`. The approved design is in
  DESIGN_DECISIONS "The interface".

## Current strategic direction (important)

Two tracks, both user-approved:

1. **The UI remake** (Oct 2026) — "as user friendly and simple as possible with
   advanced things, pros and beginner friendly". Five stages: **1 new layout +
   look ✔ (v0.3.0)**, **2 named-track timeline with curves under the cue ✔
   (v0.4.0)**, **3 fixture "Looks" with layers ✔ (v0.5.0)**, **4 Live workspace ✔
   (v0.6.0)**, 5 welcome screen + tour (next).
   The design choices were made by the user via multiple-choice — don't
   re-litigate them; see DESIGN_DECISIONS "The interface".
2. **The laser pivot** — a **Pangolin BEYOND-style laser-show designer**. The
   user runs **primarily laser shows**. Laser Stage 1 (patterns + values) and
   Stage 2 (keyframe envelopes) are done; Stage 3 (multiple projectors/zones,
   palettes, an audio-reactive auto-preset) comes after the UI remake. Shows are
   **primarily pre-programmed**, with an auto preset to load for live song
   visualizing. **Fixture cues stay for hybrid shows — don't rip them out.**

See Docs/Roadmap.md.

## Working with this user

- **Before coding: confirm the app runs, then propose a short plan and wait for
  an okay.** When they say "you decide", "keep going" or "begin", state the plan
  in a few lines and proceed.
- **Real forks → ask as a multiple-choice question** with a recommended option
  (and a visual mockup when it's about looks). Don't guess on product
  direction — the laser pivot and the UI remake both came from asking.
- **Find root causes; don't iterate on symptoms.** The invisible-beam bug was
  "fixed" by tuning intensity several times before the real cause (see the beam
  trap in DESIGN_DECISIONS) was found — the user had to call out the loop.
- **Be honest about what you verified.** Say what you tested and how (Node
  check, boot, preview, packaged-app probe), and what you didn't. Visual
  quality matters to them — look at it in the preview before calling a visual
  change done.
- **Every finished stage ships:** bump the version, add a CHANGELOG section,
  commit, push to GitHub, and tag it so CI publishes a Release with the
  installer (the user asked for this). Don't commit half-finished stages.

## Run, verify & release

```bash
npm install      # once
npm start        # launch the Electron app
npm test         # Art-Net/sACN loopback self-test (the only built-in test)
npm run dist     # build the Windows installer into dist/
npm run icons    # regenerate app/installer icons from src/ui/logo.js
```

- **This is a visual app.** `npm test` only covers DMX wiring. For engine/effect
  logic, write throwaway Node scripts (Three.js runs headless in Node for
  non-render use). For visuals, use the browser-preview loop. **Read
  Docs/DEV_WORKFLOW.md before verifying** — there are module-cache, preview and
  packaging gotchas that will waste an hour otherwise.
- **Releasing:** see DEV_WORKFLOW "Releasing" — tag `vX.Y.Z` matching
  `package.json`, push the tag, GitHub Actions does the rest.

## Conventions

- Match the surrounding file's comment density and naming; files lead with a
  short comment explaining the module's job and *why* it exists.
- Effects never write to the hub directly — they write to the engine's **sink**
  (`c.out.dimmer/rgb/panTilt/...`); the engine flushes once per fixture so the
  HTP/LTP merge can apply. See DESIGN_DECISIONS.
- Each fixture carries a `typeKey` (for save/load) and a `dispose()` that frees
  per-instance GPU resources but **not** shared module-level materials.
- **UI:** views render HTML strings and wire events by delegation. Mark
  advanced controls `.pro` (hidden in Simple) or wrap them in `more()` (a "More"
  disclosure, Pro only); tag workspace-specific UI `data-ws-only="build|program"`.
  Colours come from the CSS tokens in `style.css` — never hard-code UI colours in
  JS except show content (beams, curves). Every committed edit calls
  `history.record()` (via the `onCommit`/`onEdit` callbacks).
- **Never use `closest('[data-ws]')`-style lookups for attributes that `<body>`
  also carries** — `body[data-ws]` matched every click once and silently broke
  the whole top bar. Tabs use `data-tab`.
