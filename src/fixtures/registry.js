// Maps a user-facing fixture type to a factory that builds the right visual
// class with its default profile. The "Add fixture" control reads this list,
// and the GDTF importer (later milestone) will register imported types here
// the same way - so the rest of the app never special-cases fixture origins.

import { MovingHead } from './MovingHead.js';
import { ColdSparkMachine } from './ColdSpark.js';
import { LedPar } from './LedPar.js';
import { Batten } from './Batten.js';
import { PixelBar } from './PixelBar.js';
import { LaserProjector } from './LaserProjector.js';
import { Podium } from './Podium.js';

export const FIXTURE_TYPES = [
  {
    key: 'moving-head',
    label: 'Moving head',
    onTruss: true, // hangs from the rig vs. sits on the floor
    create: (hub, scene, opts) => new MovingHead(hub, scene, { beamLength: 12, ...opts }),
  },
  {
    key: 'led-par',
    label: 'LED PAR',
    onTruss: true,
    create: (hub, scene, opts) => new LedPar(hub, scene, opts),
  },
  {
    key: 'pixel-bar',
    label: 'Pixel bar',
    onTruss: true,
    create: (hub, scene, opts) => new PixelBar(hub, scene, opts),
  },
  {
    key: 'batten',
    label: 'Wash batten',
    onTruss: true,
    create: (hub, scene, opts) => new Batten(hub, scene, opts),
  },
  {
    key: 'laser',
    label: 'Laser',
    onTruss: true,
    create: (hub, scene, opts) => new LaserProjector(hub, scene, opts),
  },
  {
    key: 'cold-spark',
    label: 'Cold spark',
    onTruss: false,
    create: (hub, scene, opts) => new ColdSparkMachine(hub, scene, opts),
  },
  {
    key: 'podium',
    label: 'Podium (prop)',
    onTruss: false,
    create: (hub, scene, opts) => new Podium(hub, scene, opts),
  },
];

export function fixtureType(key) {
  return FIXTURE_TYPES.find((t) => t.key === key) ?? null;
}
