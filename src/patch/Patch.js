// Central registry of every patched fixture: which profile sits at which
// universe and start address. Pure bookkeeping - it never reads or writes DMX
// values (that's the hub's job). Drives the patch sheet and the fixture
// inspector; GDTF import, fixture groups, and paperwork export will read from
// it later.

export class Patch {
  constructor() {
    this.entries = []; // { label, universe, startAddress, channelCount, profileName }
    this.listeners = new Set();
  }

  add({ label, universe, startAddress, profile, fixture = null }) {
    this.entries.push({
      label,
      universe,
      startAddress,
      channelCount: profile?.channelCount ?? 1,
      profileName: profile?.name ?? 'Unknown',
      fixture, // live fixture this entry patches, so edits drive the scene
    });
    this._emit();
  }

  /** Register straight from a live fixture (reads its patch + profile). */
  addFixture(fixture, label) {
    this.add({
      label,
      universe: fixture.universe,
      startAddress: fixture.startAddress,
      profile: fixture.profile,
      fixture,
    });
  }

  /**
   * Re-patch an entry (and its live fixture). Universe is floored to an
   * integer >= 1; start address is clamped so the channel footprint fits
   * inside 1..512. Ignores non-finite inputs (keeps the current value).
   */
  repatch(index, { universe, startAddress } = {}) {
    const e = this.entries[index];
    if (!e) return;

    if (Number.isFinite(universe)) {
      e.universe = Math.max(1, Math.floor(universe));
      if (e.fixture) e.fixture.universe = e.universe;
    }
    if (Number.isFinite(startAddress)) {
      const maxStart = 512 - e.channelCount + 1;
      e.startAddress = Math.min(Math.max(1, Math.floor(startAddress)), maxStart);
      if (e.fixture) e.fixture.startAddress = e.startAddress;
    }
    this._emit();
  }

  /** Rename an entry (the fixture's display name). */
  rename(index, label) {
    const e = this.entries[index];
    if (!e || !label) return;
    e.label = label;
    this._emit();
  }

  /** Remove every entry (used when loading a project). */
  clear() {
    this.entries.length = 0;
    this._emit();
  }

  /** Drop an entry (e.g. the user removed its fixture). Returns it, or null. */
  remove(index) {
    if (index < 0 || index >= this.entries.length) return null;
    const [removed] = this.entries.splice(index, 1);
    this._emit();
    return removed;
  }

  /**
   * Lowest start address in a universe where a footprint of `channelCount`
   * fits without overlapping any existing entry, or null if the universe is
   * too full.
   */
  nextFreeAddress(universe, channelCount) {
    const spans = this.entries
      .filter((e) => e.universe === universe)
      .map((e) => [e.startAddress, e.startAddress + e.channelCount - 1]);
    for (let start = 1; start + channelCount - 1 <= 512; start++) {
      const end = start + channelCount - 1;
      if (!spans.some(([s, e]) => start <= e && s <= end)) return start;
    }
    return null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  /**
   * Per-entry collision flags, aligned with this.entries: an entry is flagged
   * when its address span overlaps another entry in the same universe.
   */
  collisions() {
    const flags = this.entries.map(() => false);
    for (let i = 0; i < this.entries.length; i++) {
      for (let j = i + 1; j < this.entries.length; j++) {
        const a = this.entries[i];
        const b = this.entries[j];
        if (a.universe !== b.universe) continue;
        const aEnd = a.startAddress + a.channelCount - 1;
        const bEnd = b.startAddress + b.channelCount - 1;
        if (a.startAddress <= bEnd && b.startAddress <= aEnd) {
          flags[i] = true;
          flags[j] = true;
        }
      }
    }
    return flags;
  }
}
