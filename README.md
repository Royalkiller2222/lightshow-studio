# Lightshow Studio — Electron + Three.js

3D lightshow designer / DMX previsualizer. No game engine, no editor, no
scene assembly: the entire app is code, and it launches with a working show.

> **Working on the code?** Start with [`CLAUDE.md`](CLAUDE.md) and the
> [`Docs/`](Docs/) folder — especially [`Docs/DESIGN_DECISIONS.md`](Docs/DESIGN_DECISIONS.md)
> (the *why* behind the choices) and [`Docs/Roadmap.md`](Docs/Roadmap.md)
> (what's done and where it's going).

## Run it (one-time setup: install Node.js)

1. Install **Node.js LTS** from https://nodejs.org (one installer, defaults fine).
2. Double-click **`Start Lightshow.bat`**.
   (First run downloads dependencies — a minute or two — then the app opens.)

That's it. You'll see a dark venue with four moving heads sweeping colored
volumetric beams through haze on a 126 BPM grid, and a laser drawing a spinning,
breathing tunnel. The 16-second demo loops until you load a track. The
moving-head show is real DMX data flowing through universe buffers and out as
Art-Net at 40 Hz (laser cues are visual-only for now).

Manual alternative: open a terminal in this folder, `npm install`, `npm start`.

## What's in the window

- **Mode** — `Internal show` plays the built-in demo. `External console`
  makes the app listen on Art-Net universe 1 so QLC+, grandMA onPC, ONYX or
  any other console drives the 3D fixtures directly (the previz feature).
- **Art-Net target IP** — `127.0.0.1` to test locally (watch it in QLC+),
  your node's IP for a real rig, or `x.x.x.255` for broadcast.
- **sACN** — also stream E1.31 multicast (better for many-universe rigs).
- **Haze density** — the master atmosphere control; beams exist because
  light scatters in haze.
- **Room W/D/H** — custom venue size, rebuilt live.
- **Hold to fire cold sparks** — manual spark trigger (or put a *Cold sparks*
  cue on the timeline).
- **Timeline** (bottom) — load audio (BPM is detected), add fixture cues
  (`+ Cue`) or laser cues (`+ Laser`), drag to move / change lane, drag the
  right edge to resize. Select a laser cue to pick its pattern and edit its Key
  Effects (Size, Rotation, Position, Colour, Brightness, Points, Scan): the ◆
  buttons and the envelope editor keyframe them across the cue.

Camera: left-drag orbit, right-drag pan, scroll zoom.

Windows Firewall will ask for permission on first launch — allow it, or no
DMX flows.

## Patch (demo rig)

| Fixture | Universe | Address | Channels |
|---|---|---|---|
| Moving head 1–4 | 1 | 1 / 10 / 19 / 28 | Pan, Pan fine, Tilt, Tilt fine, Dimmer, R, G, B, Zoom |
| Cold sparks (pair) | 1 | 37 | Trigger (>127 fires), Height |

## Verify the DMX output

Install [QLC+](https://qlcplus.org) (free). With the target IP at
`127.0.0.1`, open its DMX monitor on Art-Net universe 1 — you'll see all 38
channels animating at 40 Hz. Flip the app to External mode and QLC+ faders
will move the 3D fixtures instead.

## Build a standalone .exe

```
npm run dist
```

Produces a portable `Lightshow Studio.exe` in `dist/` via electron-builder.
No installer needed; copy it anywhere.

## Architecture (carried over from the design doc)

The renderer owns the **UniverseHub** — thread-safe-by-design single source
of truth for all DMX channel state. Writers: the show engine (playing the
timeline's cues) in Internal mode, or incoming Art-Net in External mode. Readers: every fixture (they only know their patch
address and react to channel values, like real fixtures on the wire) and the
Electron **main process**, which mirrors the buffers and runs hardware output
on its own steady 40 Hz tick — so a render hitch never strobes your rig.

```
UI / ShowEngine (timeline cues)             External console
            |                                     |
            v                                     v  (Art-Net in, port 6454)
        UniverseHub  <---------------------------- 
        /         \
       v           v
 3D fixtures    Main process ---> Art-Net / sACN out ---> nodes & rig
 (beams, sparks)
```

The volumetric beams are analytic cone shaders (no raymarching): radial +
axial falloff, apex and camera-proximity fades, dither against banding,
additive blending, ACES tonemapping + bloom. Cost scales with beam pixels on
screen — dozens of fixtures run fine on mid-range GPUs.

## Self-test

`npm test` runs a loopback check: the real Art-Net sender transmits a known
512-byte universe to the real receiver over localhost and verifies every
byte, plus validates the sACN packet structure.

## Notes

- **Enttec USB Pro** support is deferred: it needs the `serialport` native
  module, which complicates the one-click install. Art-Net/sACN covers
  modern nodes; cheap Art-Net gateways bridge to 5-pin DMX. It returns as an
  optional add-on in a later milestone.
- Beam-vs-geometry soft intersection (depth fade) is a planned polish pass;
  in a dark venue the current look is already close.

See `Docs/Roadmap.md` for where every confirmed feature lands.
