// Electron main process: opens the window and runs DMX hardware I/O on a
// steady 40 Hz tick, independent from the renderer's frame rate (mirrors the
// dedicated-thread design from the Unity version).

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { ArtNetSender, ArtNetReceiver, SacnSender } = require('./dmx-io.js');

let win = null;
let artnetIn = null;
let outputTick = null;

// Latest universe buffers pushed from the renderer (the source of truth
// lives in the renderer's UniverseHub; this is the output-side mirror).
const universes = new Map(); // id -> Uint8Array(512)

const config = {
  mode: 'internal',        // 'internal' = we generate DMX, 'external' = console drives us
  artnetIp: '127.0.0.1',
  sacn: false,
  output: true,
};

const artnetOut = new ArtNetSender(config.artnetIp);
const sacnOut = new SacnSender();

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: '#0a0a0c',
    title: 'Lightshow Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // Art-Net input: lets any console drive the visualizer (External mode).
  try {
    artnetIn = new ArtNetReceiver((universe, data) => {
      if (config.mode !== 'external') return;
      if (win && !win.isDestroyed()) {
        win.webContents.send('dmx:artnet-in', { universe, data });
      }
    });
  } catch (e) {
    console.warn('Art-Net input unavailable (port 6454 busy?):', e.message);
  }

  // 40 Hz hardware output tick.
  outputTick = setInterval(() => {
    if (!config.output || config.mode !== 'internal') return;
    for (const [id, data] of universes) {
      artnetOut.send(id, data);
      if (config.sacn) sacnOut.send(id, data);
    }
  }, 25);
});

ipcMain.on('dmx:universes', (_e, list) => {
  for (const u of list) universes.set(u.id, u.data);
});

ipcMain.on('dmx:config', (_e, cfg) => {
  Object.assign(config, cfg);
  if (cfg.artnetIp) artnetOut.setTarget(cfg.artnetIp);
});

app.on('window-all-closed', () => {
  // Stop the output tick before closing sockets, or the next tick would call
  // send() on a closed dgram socket and crash the main process on the way out.
  if (outputTick) { clearInterval(outputTick); outputTick = null; }
  artnetOut.close();
  sacnOut.close();
  if (artnetIn) artnetIn.close();
  app.quit();
});
