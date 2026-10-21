// DMX network I/O for the Electron main process.
// Art-Net output, Art-Net input (external console mode), sACN (E1.31) output.
// Pure Node.js (dgram) - no native modules, nothing to compile.

'use strict';

const dgram = require('dgram');
const crypto = require('crypto');

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;

/** Sends ArtDMX packets. One instance serves every universe. */
class ArtNetSender {
  constructor(targetIp = '127.0.0.1') {
    this.target = targetIp;
    this.seq = new Map(); // per-universe sequence counters
    this.ready = false;

    this.packet = Buffer.alloc(18 + 512);
    this.packet.write('Art-Net\0', 0, 'ascii');
    this.packet[8] = 0x00; this.packet[9] = 0x50;   // OpDmx 0x5000 little-endian
    this.packet[10] = 0x00; this.packet[11] = 14;   // protocol version 14
    this.packet[16] = 0x02; this.packet[17] = 0x00; // data length 512 big-endian

    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (e) => console.warn('[artnet out]', e.message));
    this.socket.bind(() => {
      try { this.socket.setBroadcast(true); } catch (_) {}
      this.ready = true;
    });
  }

  setTarget(ip) { this.target = ip; }

  /** @param {number} universe @param {Uint8Array} data up to 512 channel bytes */
  send(universe, data) {
    if (!this.ready) return;
    let s = (this.seq.get(universe) || 0) + 1;
    if (s > 255) s = 1;
    this.seq.set(universe, s);

    this.packet[12] = s;                              // sequence
    this.packet[13] = 0;                              // physical port
    this.packet[14] = universe & 0xff;                // SubUni
    this.packet[15] = (universe >> 8) & 0x7f;         // Net
    this.packet.fill(0, 18);
    this.packet.set(data.subarray(0, 512), 18);

    try {
      this.socket.send(this.packet, ARTNET_PORT, this.target);
    } catch (_) {
      // socket closed mid-shutdown
    }
  }

  close() {
    this.ready = false;
    try { this.socket.close(); } catch (_) {}
  }
}

/** Listens on UDP 6454 so external consoles (QLC+, grandMA, ONYX...) can drive us. */
class ArtNetReceiver {
  /** @param {(universe: number, data: Uint8Array) => void} onDmx */
  constructor(onDmx) {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('message', (msg) => {
      if (msg.length < 20) return;
      if (msg.toString('ascii', 0, 8) !== 'Art-Net\0') return;
      if (msg[8] !== 0x00 || msg[9] !== 0x50) return; // only ArtDMX

      const universe = msg[14] | ((msg[15] & 0x7f) << 8);
      let length = (msg[16] << 8) | msg[17];
      length = Math.min(length, 512, msg.length - 18);
      if (length <= 0) return;

      onDmx(universe, new Uint8Array(msg.buffer, msg.byteOffset + 18, length));
    });
    this.socket.on('error', (e) => console.warn('[artnet in]', e.message));
    this.socket.bind(ARTNET_PORT);
  }

  close() { try { this.socket.close(); } catch (_) {} }
}

/**
 * Streams sACN (ANSI E1.31) to the per-universe multicast group
 * 239.255.hi.lo : 5568. Better than Art-Net for many-universe rigs
 * (pixel tape). Universe IDs must be 1..63999.
 */
class SacnSender {
  constructor(sourceName = 'Lightshow Studio') {
    const p = this.packet = Buffer.alloc(638);

    // Root layer
    p.writeUInt16BE(0x0010, 0);                 // preamble size
    p.writeUInt16BE(0x0000, 2);                 // postamble size
    p.write('ASC-E1.17\0\0\0', 4, 'ascii');     // ACN packet identifier
    this._flagsLen(16, 638 - 16);
    p.writeUInt32BE(0x00000004, 18);            // VECTOR_ROOT_E131_DATA
    crypto.randomBytes(16).copy(p, 22);         // CID, stable per session

    // Framing layer
    this._flagsLen(38, 638 - 38);
    p.writeUInt32BE(0x00000002, 40);            // VECTOR_E131_DATA_PACKET
    p.write(sourceName.slice(0, 63), 44, 'utf8');
    p[108] = 100;                               // priority
    p.writeUInt16BE(0, 109);                    // sync address
    p[112] = 0;                                 // options

    // DMP layer
    this._flagsLen(115, 638 - 115);
    p[117] = 0x02;                              // VECTOR_DMP_SET_PROPERTY
    p[118] = 0xa1;                              // address & data type
    p.writeUInt16BE(0, 119);                    // first property address
    p.writeUInt16BE(1, 121);                    // address increment
    p.writeUInt16BE(513, 123);                  // property count (start code + 512)
    p[125] = 0x00;                              // DMX start code

    this.seq = 0;
    this.ready = false;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (e) => console.warn('[sacn out]', e.message));
    this.socket.bind(() => {
      try { this.socket.setMulticastTTL(4); } catch (_) {}
      this.ready = true;
    });
  }

  _flagsLen(offset, length) {
    this.packet.writeUInt16BE(0x7000 | (length & 0x0fff), offset);
  }

  /** @param {number} universe 1..63999 @param {Uint8Array} data */
  send(universe, data) {
    if (!this.ready) return;
    if (universe < 1 || universe > 63999) return;
    this.seq = (this.seq + 1) & 0xff;
    this.packet[111] = this.seq;
    this.packet.writeUInt16BE(universe, 113);
    this.packet.fill(0, 126);
    this.packet.set(data.subarray(0, 512), 126);

    const group = `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
    try {
      this.socket.send(this.packet, SACN_PORT, group);
    } catch (_) {
      // socket closed mid-shutdown
    }
  }

  close() {
    this.ready = false;
    try { this.socket.close(); } catch (_) {}
  }
}

module.exports = { ArtNetSender, ArtNetReceiver, SacnSender, ARTNET_PORT, SACN_PORT };
