// Le chrono : départ, points de passage dans l'ordre, radar de vitesse, arrivée.
// Comme en course : il faut rester entre les rubalises. Sortir du balisage plus d'un instant renvoie au dernier point
// de passage, et le chrono continue de tourner.

import { TAPE_U } from './track.js';

const GATE_HALF_WIDTH = 7; // on doit passer à moins de 7 m du centre de la piste

export class Race {
  constructor(track) {
    this.track = track;
    this.gates = track.gates;
    this.outTime = 1.5; // secondes tolérées hors du balisage (selon le mode)
    this.reset();
  }

  reset() {
    this.state = 'pret'; // pret → course → arrivee
    this.time = 0;
    this.next = 0; // la prochaine porte à passer
    this.splits = [];
    this.s = this.track.spawnS;
    this.u = 0;
    this.missed = false;
    this.crashes = 0;
    this.outside = 0;
    this.out = false; // dehors depuis trop longtemps : il faut repartir du dernier point
    this.trapSpeed = null;
    this.topSpeed = 0;
    this.trace = []; // positions toutes les 0,1 s, pour le fantôme
  }

  update(dt, pos, speed, crashed, pose) {
    const near = this.track.nearest(pos.x, pos.z, this.s, 25);
    const prevS = this.s;
    if (Number.isFinite(near.dist) && near.dist < 30) {
      this.s = near.s;
      this.u = near.u;
    }
    if (this.state === 'course') {
      this.time += dt;
      this.topSpeed = Math.max(this.topSpeed, speed);
      if (pose && this.time - (this.trace.length - 1) * 0.1 >= 0.1) this.trace.push(pose());
      if (this.trapSpeed === null && prevS < this.track.speedTrap && this.s >= this.track.speedTrap) this.trapSpeed = speed;
    }
    if (crashed || this.state === 'arrivee') return;
    // Le balisage.
    if (this.state === 'course' && Math.abs(this.u) > TAPE_U + 0.5) this.outside += dt;
    else this.outside = Math.max(0, this.outside - dt * 2);
    if (this.outside > this.outTime) this.out = true;

    const gate = this.gates[this.next];
    if (!gate || this.s < gate.s) return;
    if (Math.abs(this.u) > GATE_HALF_WIDTH) {
      // Passé à côté de la porte : la course n'est plus valable jusqu'à un retour au dernier point.
      this.missed = true;
      return;
    }
    if (gate.kind === 'depart') { this.state = 'course'; this.trace.length = 0; if (pose) this.trace.push(pose()); }
    else this.splits.push(this.time);
    this.next++;
    if (gate.kind === 'arrivee') this.state = 'arrivee';
  }

  /** Où repartir après une chute : juste après la dernière porte passée, ou dans la cabane de départ. */
  respawnS() {
    if (this.next === 0) return this.track.spawnS;
    return this.gates[this.next - 1].s + 1;
  }

  onRespawn() {
    this.s = this.respawnS();
    this.missed = false;
    this.out = false;
    this.outside = 0;
    if (this.state === 'course') this.crashes++;
    if (this.next === 0) this.time = 0;
  }
}
