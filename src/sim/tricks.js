// Les figures : on compte la rotation du vélo pendant chaque saut, et on la valide si le pilote reste debout
// une demi-seconde après la réception.

const TURN = Math.PI * 2;
const TOLERANCE = 1.2; // une rotation à 70° près compte (la trajectoire fait déjà plonger le nez)

/** Le nom d'une figure d'après les rotations cumulées (radians), ou null s'il n'y en a pas. */
export function trickName(pitch, yaw) {
  const flips = Math.floor((Math.abs(pitch) + TOLERANCE) / TURN);
  const spins = Math.floor((Math.abs(yaw) + TOLERANCE) / TURN);
  const parts = [];
  if (flips > 0) parts.push(`${flips === 2 ? 'Double ' : flips > 2 ? `${flips}× ` : ''}${pitch > 0 ? 'backflip' : 'frontflip'}`);
  if (spins > 0) parts.push(String(spins * 360));
  if (!parts.length) return null;
  const name = parts.join(' ');
  return name[0].toUpperCase() + name.slice(1);
}

export class Tricks {
  constructor() { this.reset(); }

  reset() {
    this.air = null; // le saut en cours
    this.pending = null; // posée, en attente de validation
    this.landed = []; // les figures réussies pendant la manche
    this.events = []; // { name } réussie, ou { name, failed: true } ratée : lues par l'affichage
  }

  update(bike, dt) {
    const pending = this.pending;
    if (pending) {
      if (bike.crashed) { this.events.push({ name: pending.name, failed: true }); this.pending = null; }
      else if ((pending.t += dt) > 0.5) { this.landed.push(pending.name); this.events.push({ name: pending.name }); this.pending = null; }
    }
    if (bike.crashed) {
      if (this.air) { const name = trickName(this.air.pitch, this.air.yaw); if (name) this.events.push({ name, failed: true }); }
      this.air = null;
      return;
    }
    if (!bike.grounded) {
      const a = (this.air ||= { pitch: 0, yaw: 0, time: 0, whip: 0 });
      a.whip = Math.max(a.whip, Math.abs(bike.whip || 0));
      // Vitesses de rotation dans le repère du vélo : tangage autour de sa droite, lacet autour de son haut.
      const r = bike.body.rotation(), w = bike.body.angvel();
      const qx = r.x, qy = r.y, qz = r.z, qw = r.w;
      const Rx = 1 - 2 * (qy * qy + qz * qz), Ry = 2 * (qx * qy + qw * qz), Rz = 2 * (qx * qz - qw * qy);
      const Ux = 2 * (qx * qy - qw * qz), Uy = 1 - 2 * (qx * qx + qz * qz), Uz = 2 * (qy * qz + qw * qx);
      a.pitch += (w.x * Rx + w.y * Ry + w.z * Rz) * dt;
      a.yaw += (w.x * Ux + w.y * Uy + w.z * Uz) * dt;
      a.time += dt;
    } else if (this.air) {
      // (un whip franc, redressé à temps, compte aussi, s'il n'y a pas de rotation)
      const name = this.air.time > 0.3 ? trickName(this.air.pitch, this.air.yaw) || (this.air.whip > 0.6 && Math.abs(bike.whip || 0) < 0.45 ? 'Whip' : null) : null;
      if (name) this.pending = { name, t: 0 };
      this.air = null;
    }
  }
}
