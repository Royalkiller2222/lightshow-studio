# Changelog

Each `## vX.Y.Z` section below becomes the notes of that version's GitHub
Release (see `.github/workflows/release.yml`). Newest first.

## v0.3.0 — 2026-10-21

The first installable release: a redesigned interface, laser keyframes, and a
new logo.

**Install:** download `LightshowStudio-Setup-0.3.0.exe` below and run it. It
installs for your Windows user (no admin needed), adds Start-menu and desktop
shortcuts, and opens the app. Windows may show "Windows protected your PC"
because the installer isn't code-signed yet; click **More info → Run anyway**.

### New interface
- **Workspaces.** *Build* is for setting up the venue, fixtures and patch.
  *Program* is for the timeline and cues. Switch with the tabs in the top bar
  or Ctrl+1 / Ctrl+2.
- **One inspector.** Whatever you select (a fixture, a cue, or nothing) is
  edited in the panel on the right. With nothing selected it shows the venue
  (Build) or the show (Program).
- **Libraries you drag from.**
  - Fixtures drag into the venue (as mirrored pairs by default).
  - Laser patterns (with real thumbnails) and fixture effects drag onto the
    timeline.
  - Double-click any library item to add it at the playhead.
- **Simple and Pro.** Simple shows just the essentials. Pro adds DMX
  addresses, extra rotation and effect details, with advanced controls under
  "More".
- **Ctrl+K command search.** Find any action by name ("add tunnel", "house
  light", "save").
- **Transport in the top bar.** Play/pause, stop, the clock and the tempo are
  always visible, along with the output status (click it for the Art-Net and
  sACN settings).
- **Tools on the 3D view.** Select, Move and Rotate float on the view, next to
  haze, room light, house light, a camera reset, the laser preview and the
  cold-spark button.
- **Edit fixtures by number.** Name, position, facing, rotation, mirror twin
  and DMX patch are all editable in the inspector.
- **Resizable panels.** Drag the dividers to resize; double-click one to hide
  its panel. Sizes are remembered per workspace.
- **Small comforts.**
  - "Edited" appears in the top bar when you have unsaved changes.
  - Notifications confirm when a show is saved or opened.
  - The window title shows the show's name.
  - Undo keeps your playhead, selected cue and selected fixture.

### Laser keyframes
- Every laser Key Effect (size, rotation, position, colour, brightness,
  tilt, visible points, scan rate) can be animated across a cue. Press ◆ to set
  a keyframe at the playhead, or turn on Auto-key.
- A curve editor for each effect:
  - Click to add a keyframe, drag to move it (snaps to half-beats; hold Shift
    for free placement).
  - Double-click or press Del to remove a keyframe.
  - Choose linear, smooth or step easing.
- The demo laser now spins and swells.

### Fixes
- The demo no longer goes dark after 16 seconds: without a song, the show
  loops.
- Laser Position no longer moves with Size in the 3D view (it already didn't
  in the preview).
- Space and Ctrl+Z work right after dragging a slider.
- Opening a show with a different room size now moves the house light up to
  the new ceiling.

### Under the hood
- Logo and app icons. The colourful beam fan is the window, taskbar and
  installer icon.
- Releases are built and published automatically when a version tag is
  pushed.
