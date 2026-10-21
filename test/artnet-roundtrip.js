// Loopback self-test: starts the real Art-Net receiver, sends a known
// universe through the real sender on 127.0.0.1, and verifies the bytes
// arrive intact. Also sanity-checks the sACN packet structure.
// Run with: npm test

'use strict';

const { ArtNetSender, ArtNetReceiver, SacnSender } = require('../dmx-io.js');

let failed = false;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
}

// --- sACN packet structure (no listener needed; inspect the buffer) ---
const sacn = new SacnSender('Test');
sacn.packet[111] = 1;
sacn.packet.writeUInt16BE(7, 113);
check('sACN packet is 638 bytes', sacn.packet.length === 638);
check('sACN ACN identifier', sacn.packet.toString('ascii', 4, 13) === 'ASC-E1.17');
check('sACN root flags/length', sacn.packet.readUInt16BE(16) === (0x7000 | 622));
check('sACN framing flags/length', sacn.packet.readUInt16BE(38) === (0x7000 | 600));
check('sACN DMP flags/length', sacn.packet.readUInt16BE(115) === (0x7000 | 523));
check('sACN property count 513', sacn.packet.readUInt16BE(123) === 513);

// --- Art-Net round trip over localhost ---
const TEST_UNIVERSE = 3;
const payload = new Uint8Array(512);
for (let i = 0; i < 512; i++) payload[i] = (i * 7 + 13) & 0xff;

const timeout = setTimeout(() => {
  check('Art-Net round trip (timed out)', false);
  finish();
}, 3000);

let receiver;
try {
  receiver = new ArtNetReceiver((universe, data) => {
    clearTimeout(timeout);
    check('Art-Net universe id round trip', universe === TEST_UNIVERSE);
    let same = data.length === 512;
    for (let i = 0; same && i < 512; i++) same = data[i] === payload[i];
    check('Art-Net 512-byte payload round trip', same);
    finish();
  });
} catch (e) {
  check(`Art-Net receiver bind (${e.message})`, false);
  finish();
}

const sender = new ArtNetSender('127.0.0.1');
const sendTimer = setInterval(() => sender.send(TEST_UNIVERSE, payload), 50);

function finish() {
  clearInterval(sendTimer);
  sender.close();
  sacn.close();
  if (receiver) receiver.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 100);
}
