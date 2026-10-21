# Dev workflow & verification

This app is **visual and stateful**, and `npm test` only covers the DMX wire.
Here's the verification loop that actually works, plus the gotchas that will burn
an hour if you don't know them.

## The three verification tiers

1. **Pure logic → Node throwaway script.** Three.js runs headless in Node for
   non-render use (geometry, materials, math, the engine's write path). Build a
   fake hub and/or a real `THREE.Scene`, exercise the thing, assert.
   ```js
   // _check.mjs — run: node _check.mjs ; delete it after
   import * as THREE from 'three';
   import { ShowEngine } from './src/show/ShowEngine.js';
   import { MovingHeadRGB } from './src/fixtures/FixtureProfile.js';
   const buf = new Uint8Array(512);
   const hub = { mode:'internal',
     setChannel(u,a,v){ buf[a-1]=v&255; },
     setChannel16(u,a,v){ buf[a-1]=(v>>8)&255; buf[a]=v&255; },
     getUniverse(){ return buf; } };
   const fx = { hub, universe:1, startAddress:1, profile: MovingHeadRGB };
   const eng = new ShowEngine(hub, [fx]);
   // ...addCue, eng.update(time,bpm,bands), read buf[...] by profile offset
   ```
   This is how effects, the HTP/LTP merge, waveforms, bpm detection, laser
   patterns, keyframe envelopes (`envelopes.js` has no Three.js at all), the
   `Transport` loop, fixture dispose, and project round-trips were verified.
   `LaserRig` also runs headless: pass a real `THREE.Scene` and a fake preview
   canvas whose `getContext()` records `moveTo/lineTo` — that's how the 3D frame
   was checked against the 2D preview. Fast and reliable. **Prefer this** for
   anything non-visual. Keep these scripts **outside the repo** (a scratch
   folder) and import the modules by `file:///` URL.

2. **DMX wiring → `npm test`.** Art-Net loopback + sACN packet structure. Keep it
   green; it's the one committed test.

3. **Startup sanity → hidden Electron boot.** Launch the app hidden, wait, grep
   the logs for uncaught errors, kill it.
   ```powershell
   $p = Start-Process -FilePath "node_modules\.bin\electron.cmd" -ArgumentList ".","--enable-logging" `
        -PassThru -RedirectStandardError "be.log" -RedirectStandardOutput "bo.log" -WindowStyle Hidden
   Start-Sleep -Seconds 8
   if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; Get-Process electron -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue }
   Get-Content be.log,bo.log | Select-String "Uncaught|SyntaxError|TypeError|ReferenceError"
   Remove-Item be.log,bo.log
   ```
   A clean renderer load (the module graph parsed, `animate()` ran) shows **no**
   such lines. The one benign line you'll always see is the Chromium
   "Network service crashed, restarting service" notice on Windows — ignore it.

## Visual verification — the browser preview loop

The whole app renders in a plain browser (Electron-only `window.dmxBridge` is
guarded, so the scene + show still run). Serve the **app folder** (the one with
`src/` and `node_modules/`) and open **`/src/index.html`** — the importmap's
`../node_modules/...` paths resolve from `src/`. (If you serve one level up,
as in the old nested layout, the page is `/lightshow-studio/src/index.html`.)

- **Where `launch.json` goes:** the preview tool reads `.claude/launch.json` from
  the *session's* project folder, which may be a parent of the app folder. If
  `preview_start` can't find it, the error names the exact path it expects.
  Point the config at a server script kept outside the repo and pass the folder
  to serve as an argument (the server below takes `port` and `root`).
- **Size the viewport first:** the preview pane defaults to ~800×600, where the
  timeline inspectors wrap and look broken. Emulate e.g. 1440×900 before judging
  layout, and reset to desktop afterwards.
- **Drive the UI with real clicks, read state from the DOM.** App objects are
  module-scoped (no globals), so verify via what's rendered: the laser
  inspector's readouts (`[data-lpval]`), `.tl-lp.anim` / `.tl-lp.cur` classes,
  and the `.tl-kf` ticks on a laser cue block (`style.left` = key time %).

### Gotcha 1 — ES-module caching (the big one)
Python's `http.server` sends no `Cache-Control`, so the browser caches each ES
module as "fresh" from the file's *original* mtime and **never re-fetches your
edits** — even across reloads and HTML cache-busting (the relative import URL is
unchanged). Symptoms: your change to `beam.js`/`effects.js` "does nothing."

Fix: serve with a **threaded, no-cache** server (single-threaded stalls serving
the many module files → chrome-error):
```python
# nocache_server.py  (keep outside the repo; usage: py -3 nocache_server.py 8099 <app folder>)
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma','no-cache'); self.send_header('Expires','0'); super().end_headers()
    def log_message(self,*a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
root = sys.argv[2] if len(sys.argv) > 2 else '.'
ThreadingHTTPServer(('127.0.0.1', port), partial(H, directory=root)).serve_forever()
```
If a specific module *still* serves stale (its cache entry predates the no-cache
server), temporarily append `?v=x` to **every** import of it (e.g. all importers
of `beam.js`, so they stay one module instance and share `hazeUniform`), verify,
then revert the `?v=`.

### Gotcha 2 — the demo pulses, so single screenshots are unreliable
The show animates; a random frame may catch a beat trough or beams pointed away.
Easiest: pause (Space, or the ⏸ button) and click the waveform to seek to a good
instant — the whole show, laser envelopes included, is a pure function of
transport time. For raw fixture rendering, expose a temporary debug hook
(`window.hub`, `window.__dbg`), switch Mode to **external** to freeze the
engine, and inject a known bright frame with `hub.setChannel/setChannel16`.
**Remove every `window.__*` hook before finishing** (grep for `window.__` /
`window.hub`).

### Gotcha 2b — shortcuts are ignored while a text field has focus
The global shortcuts (Space, Ctrl+Z/Y, Del, V/X/C) skip keys while a text-like
`<input>`, `<select>` or `<textarea>` (or a checkbox) is focused, so fields keep
native editing/undo. Sliders and colour swatches don't count — Space and Ctrl+Z
work right after dragging one. If a scripted test's keypress "does nothing",
check `document.activeElement` first.

### Gotcha 3 — the preview screenshot tool is flaky
It intermittently times out (30 s) even when the page is fine. When it does,
verify via `preview_eval` instead: read DOM state, or read the laser preview
canvas pixels (`getImageData`) to confirm something is drawing, or read DMX from
an exposed `hub`. Restarting the preview server sometimes unsticks it.

## Cleanup discipline (every session)

Before you consider work done:
- Remove temp debug hooks: `grep -rn "window.__" src/` must be empty.
- Remove the preview scaffolding: the `.claude/launch.json` you created (wherever
  the preview tool wanted it — don't delete other files in that `.claude/`) and
  any server script you put inside a project folder.
- Remove any `?v=` cache-bust tags you added to imports.
- Remove stray `*.log` from boot checks.
- Re-run `npm test` and one boot check on the clean tree.

## Memory files (Claude Code persistent memory)

Two memory notes from the prior project carry the same lessons; keep them in sync
with this doc:
- **project-root-nested** — the app is in `lightshow-studio/`, not the working-dir
  root. (Moot if the new repo root *is* `lightshow-studio/`.)
- **preview-module-caching** — the caching + DMX-injection gotchas above.
