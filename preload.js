// Secure bridge between the 3D renderer and the DMX I/O in the main process.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dmxBridge', {
  /** Push the latest universe buffers for hardware output. */
  pushUniverses: (list) => ipcRenderer.send('dmx:universes', list),

  /** Update I/O config: { mode, artnetIp, sacn, output } */
  setConfig: (cfg) => ipcRenderer.send('dmx:config', cfg),

  /** Subscribe to incoming Art-Net (External console mode). */
  onArtNetIn: (callback) =>
    ipcRenderer.on('dmx:artnet-in', (_event, msg) => callback(msg)),
});
