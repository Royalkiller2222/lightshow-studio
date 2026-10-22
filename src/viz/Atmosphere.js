// How the venue *looks* (not what the show does): haze density, room light
// and the house light. One small state object so the viewport sliders, project
// files and undo all go through the same setters.
//
// Haze drives the beam shader's shared uniform (every cone at once) plus a
// gentle scene fog; room light drives tone-mapping exposure as well as the
// ambient fill, because the near-black room barely responds to ambient alone.

import * as THREE from 'three';

export class Atmosphere {
  constructor({ scene, renderer, ambient, houseLight, hazeUniform }) {
    this.scene = scene;
    this.renderer = renderer;
    this.ambient = ambient;
    this.houseLight = houseLight;
    this.hazeUniform = hazeUniform;
    this.listeners = new Set();
    this.haze = 0.6;
    this.brightness = 0.9;
    this.house = false;
    this.setHaze(this.haze);
    this.setBrightness(this.brightness);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  setHaze(v) {
    this.haze = THREE.MathUtils.clamp(v, 0, 1);
    this.hazeUniform.value = this.haze;           // beam cone brightness
    this.scene.fog.density = this.haze * 0.012;   // atmospheric depth behind the beams
    this._emit();
  }

  setBrightness(v) {
    this.brightness = THREE.MathUtils.clamp(v, 0, 2.5);
    this.ambient.intensity = this.brightness;
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.8, 1.9, this.brightness / 2.5);
    this._emit();
  }

  setHouse(on) {
    this.house = !!on;
    this.houseLight.setOn(this.house);
    this._emit();
  }
}
