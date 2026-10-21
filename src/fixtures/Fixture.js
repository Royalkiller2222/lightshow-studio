// Base class for anything driven by DMX. A fixture only knows its patch
// (universe + start address) and reads channels from the hub - exactly like
// a real fixture listening on the wire. This is why external-console mode
// drives the 3D scene with zero extra code.

export class Fixture {
  constructor(hub, universe = 1, startAddress = 1, profile = null) {
    this.hub = hub;
    this.universe = universe;
    this.startAddress = startAddress;
    this.profile = profile;
    this.mirror = null;   // linked symmetric twin, if placed as a mirror pair
    this.pickRoot = null; // Object3D raycast against to grab this fixture
  }

  // Position in world space. Subclasses back these with their root object;
  // the placement controller uses them to move fixtures (and their mirrors).
  getPosition(target) {
    return target.set(0, 0, 0);
  }

  setPosition(_v) {}

  // Mounting rotation as a full Euler [x, y, z] in radians. Subclasses return
  // the Object3D whose rotation is the mount orientation; the Rotate gizmo
  // drives all three axes (snapped to 45°).
  _rotObject() { return null; }

  getRotation() {
    const o = this._rotObject();
    return o ? [o.rotation.x, o.rotation.y, o.rotation.z] : [0, 0, 0];
  }

  setRotation(e) {
    const o = this._rotObject();
    if (o) o.rotation.set(e[0] || 0, e[1] || 0, e[2] || 0);
  }

  /** Channel footprint, from the profile (1 if profile-less). */
  get channelCount() {
    return this.profile ? this.profile.channelCount : 1;
  }

  /** 8-bit channel read. Offset is 0-based from the start address. */
  ch(offset) {
    const index = this.startAddress - 1 + offset;
    if (index < 0 || index > 511) return 0;
    return this.hub.getUniverse(this.universe)[index];
  }

  /** Normalized 0..1 read. */
  ch01(offset) {
    return this.ch(offset) / 255;
  }

  /** 16-bit read: coarse at offset, fine at offset+1. */
  ch16(offset) {
    return (this.ch(offset) << 8) | this.ch(offset + 1);
  }

  // --- Profile-aware reads: address channels by attribute name, not number ---

  _off(name) {
    const off = this.profile ? this.profile.offsetOf(name) : -1;
    if (off < 0) throw new Error(`${this.constructor.name}: no '${name}' channel in profile`);
    return off;
  }

  /** 8-bit read of a named profile attribute. */
  attr(name) {
    return this.ch(this._off(name));
  }

  /** Normalized 0..1 read of a named profile attribute. */
  attr01(name) {
    return this.ch01(this._off(name));
  }

  /** 16-bit read of a named profile attribute (coarse + fine). */
  attr16(name) {
    return this.ch16(this._off(name));
  }

  /** Called every rendered frame. dt in seconds. */
  update(dt) {}
}
