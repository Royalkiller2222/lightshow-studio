// The single source of truth for live DMX channel state.
// Writers: the demo/playback engine (internal mode) or incoming Art-Net
// (external mode). Readers: every 3D fixture, plus the IPC pump that mirrors
// state to the main process for hardware output.
// Channel addresses are 1-based (1..512), like real fixtures.

export class UniverseHub {
  constructor() {
    /** 'internal' = app generates DMX, 'external' = console drives us */
    this.mode = 'internal';
    this.universes = new Map(); // id -> Uint8Array(512)
  }

  getUniverse(id) {
    let u = this.universes.get(id);
    if (!u) {
      u = new Uint8Array(512);
      this.universes.set(id, u);
    }
    return u;
  }

  setChannel(universe, address, value) {
    if (address < 1 || address > 512) return;
    this.getUniverse(universe)[address - 1] = value & 0xff;
  }

  /** 16-bit value: coarse at address, fine at address+1. */
  setChannel16(universe, address, value) {
    this.setChannel(universe, address, value >> 8);
    this.setChannel(universe, address + 1, value & 0xff);
  }

  getChannel(universe, address) {
    if (address < 1 || address > 512) return 0;
    return this.getUniverse(universe)[address - 1];
  }

  /** Incoming console data (only honored in external mode). */
  applyExternal(universe, data) {
    if (this.mode !== 'external') return;
    this.getUniverse(universe).set(data.subarray(0, 512));
  }

  /** Payload for the IPC pump to the main process. */
  snapshotForIpc() {
    const list = [];
    for (const [id, data] of this.universes) list.push({ id, data });
    return list;
  }
}
