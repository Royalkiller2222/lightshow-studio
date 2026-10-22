// electron-builder hook (package.json build.onNodeModuleFile).
//
// electron-builder silently drops every dependency's top-level "examples"
// folder, but three.js ships its addons — OrbitControls, TransformControls,
// the bloom/post-processing passes — in three/examples/jsm. Without this hook
// the installed app can't load them and opens to a blank window.

'use strict';

module.exports = function onNodeModuleFile(file) {
  const p = file.replace(/\\/g, '/');
  return p.endsWith('/node_modules/three/examples') || p.includes('/node_modules/three/examples/jsm');
};
