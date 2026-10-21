// Channel layout decoupled from fixture scripts. A profile says *what* lives
// at *which* offset (and whether it's 8- or 16-bit); the fixture script says
// what the values mean physically. This is the asset a GDTF import will
// produce later, and what the Patch view and paperwork export read from.
//
// Offsets are 0-based from a fixture's start address. A 16-bit attribute
// occupies offset and offset+1 (coarse, fine), like real fixtures on the wire.

export class FixtureProfile {
  constructor({ name, channels }) {
    this.name = name;
    this.channels = channels.map((c) => ({ name: c.name, offset: c.offset, bits: c.bits ?? 8 }));

    this._byName = new Map();
    for (const c of this.channels) this._byName.set(c.name, c);

    // Footprint = highest occupied slot (so 16-bit tails are counted).
    let count = 0;
    for (const c of this.channels) count = Math.max(count, c.offset + (c.bits === 16 ? 2 : 1));
    this.channelCount = count;
  }

  /** 0-based offset of a named attribute, or -1 if the profile lacks it. */
  offsetOf(name) {
    const c = this._byName.get(name);
    return c ? c.offset : -1;
  }

  has(name) {
    return this._byName.has(name);
  }
}

// ---- Built-in profiles (single source of truth for the demo rig) ----

export const MovingHeadRGB = new FixtureProfile({
  name: 'Moving Head (RGB, 9ch)',
  channels: [
    { name: 'Pan', offset: 0, bits: 16 },
    { name: 'Tilt', offset: 2, bits: 16 },
    { name: 'Dimmer', offset: 4 },
    { name: 'Red', offset: 5 },
    { name: 'Green', offset: 6 },
    { name: 'Blue', offset: 7 },
    { name: 'Zoom', offset: 8 },
  ],
});

export const ColdSpark2 = new FixtureProfile({
  name: 'Cold Spark (2ch)',
  channels: [
    { name: 'Trigger', offset: 0 },
    { name: 'Height', offset: 1 },
  ],
});

export const LedParRGB = new FixtureProfile({
  name: 'LED PAR (RGB, 5ch)',
  channels: [
    { name: 'Dimmer', offset: 0 },
    { name: 'Red', offset: 1 },
    { name: 'Green', offset: 2 },
    { name: 'Blue', offset: 3 },
    { name: 'Strobe', offset: 4 },
  ],
});

export const BattenRGB = new FixtureProfile({
  name: 'Wash Batten (RGB, 4ch)',
  channels: [
    { name: 'Dimmer', offset: 0 },
    { name: 'Red', offset: 1 },
    { name: 'Green', offset: 2 },
    { name: 'Blue', offset: 3 },
  ],
});

// Pixel bar: a master dimmer then N cells of R/G/B (named R1/G1/B1, R2...).
export const PIXEL_BAR_CELLS = 8;
export const PixelBarRGB = (() => {
  const channels = [{ name: 'Dimmer', offset: 0 }];
  for (let i = 0; i < PIXEL_BAR_CELLS; i++) {
    const base = 1 + i * 3;
    channels.push(
      { name: `R${i + 1}`, offset: base },
      { name: `G${i + 1}`, offset: base + 1 },
      { name: `B${i + 1}`, offset: base + 2 }
    );
  }
  return new FixtureProfile({ name: `Pixel Bar (${PIXEL_BAR_CELLS}-cell, ${1 + PIXEL_BAR_CELLS * 3}ch)`, channels });
})();

export const LaserRGB = new FixtureProfile({
  name: 'Laser (fan, 6ch)',
  channels: [
    { name: 'Dimmer', offset: 0 },
    { name: 'Red', offset: 1 },
    { name: 'Green', offset: 2 },
    { name: 'Blue', offset: 3 },
    { name: 'Speed', offset: 4 },
    { name: 'Spread', offset: 5 },
  ],
});

// A non-DMX stage prop: zero channels, so it never takes a patch address.
export const PodiumProp = new FixtureProfile({ name: 'Podium (prop)', channels: [] });
