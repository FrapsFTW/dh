// Les commandes : manette (recommandée, tout est progressif) et clavier (AZERTY ou QWERTY, par position des touches).
//
// Manette : stick gauche = tourner (gauche/droite) et poids (avant/arrière), gâchette droite = frein avant,
// gâchette gauche = frein arrière, A = se comprimer puis sauter (maintenir, relâcher), X ou RB = pédaler,
// stick droit = regarder autour, Y ou B = repartir du dernier point, Start = recommencer, Select = caméra,
// LB = changer de mode (avant le départ). En l'air, A maintenu = se grouper pour une figure, le stick choisit laquelle.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v, target, up, down, dt) => {
  const rate = Math.abs(target) > Math.abs(v) ? up : down;
  const d = target - v;
  return v + clamp(d, -rate * dt, rate * dt);
};
const dead = (v, dz = 0.1) => (Math.abs(v) < dz ? 0 : (Math.sign(v) * (Math.abs(v) - dz)) / (1 - dz));

// e.code désigne la position physique : KeyW est le Z d'un clavier AZERTY, KeyA son Q, KeyQ son A.
const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  pedal: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  brakeRear: ['ShiftLeft', 'ShiftRight'],
  weightBack: ['KeyQ'],
  weightFwd: ['KeyE'],
  hop: ['Space'],
};
const ACTIONS = {
  respawn: ['KeyR'],
  restart: ['Enter', 'Backspace'],
  camera: ['KeyC'],
  help: ['KeyH', 'Escape'],
  settings: ['KeyG'],
  autopilot: ['KeyP'],
  ghost: ['KeyF'],
  peloton: ['KeyN'],
  mode: ['Semicolon', 'KeyM'], // la touche M d'un clavier AZERTY, ou d'un QWERTY
};
// Manette au format standard (Xbox, PlayStation…).
const PAD = { hop: 0, respawnB: 1, pedal: 2, respawn: 3, mode: 4, pedalRB: 5, brakeRear: 6, brakeFront: 7, camera: 8, restart: 9 };

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.padPrev = [];
    this.kb = { steer: 0, brakeFront: 0, brakeRear: 0, weight: 0 };
    this.usingPad = false;
    this.padName = '';
    this.look = { x: 0, y: 0 };
    addEventListener('keydown', (e) => {
      // (pas quand on tape dans un champ : les réglages, son nom dans le salon en ligne)
      if (e.target && e.target.closest && e.target.closest('.lil-gui, input')) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
      this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  any(codes) { return codes.some((c) => this.down.has(c)); }

  /** Lit les commandes. `control` va au vélo, `actions` sont les appuis du moment (repartir, caméra…). */
  read(dt) {
    const actions = {};
    for (const [name, codes] of Object.entries(ACTIONS)) if (codes.some((c) => this.pressed.has(c))) actions[name] = true;
    if (this.pressed.has('Space') || this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) actions.start = true;
    this.pressed.clear();

    // Clavier : on adoucit le tout-ou-rien pour pouvoir doser en tapotant.
    const k = this.kb;
    const steerT = (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0);
    k.steer = approach(k.steer, steerT * 0.8, 2.2, 5, dt);
    const brake = this.any(KEYS.brake);
    k.brakeFront = approach(k.brakeFront, brake ? 0.55 : 0, 2.5, 8, dt);
    k.brakeRear = approach(k.brakeRear, brake || this.any(KEYS.brakeRear) ? 0.8 : 0, 4, 8, dt);
    const wT = (this.any(KEYS.weightFwd) ? 1 : 0) - (this.any(KEYS.weightBack) ? 1 : 0);
    k.weight = approach(k.weight, wT, 3, 3, dt);
    let control = {
      steer: k.steer, brakeFront: k.brakeFront, brakeRear: k.brakeRear,
      pedal: this.any(KEYS.pedal) ? 1 : 0, weight: k.weight, hop: this.any(KEYS.hop),
    };
    this.look.x = 0; this.look.y = 0;

    // Manette.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (pad) {
      this.padName = pad.id;
      const btn = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const was = (i) => this.padPrev[i] || 0;
      const hit = (i) => btn(i) > 0.5 && was(i) <= 0.5;
      const sx = dead(pad.axes[0] || 0, 0.08);
      const sy = dead(pad.axes[1] || 0, 0.12);
      const padControl = {
        steer: Math.sign(sx) * Math.pow(Math.abs(sx), 1.35), // plus fin au centre
        brakeFront: btn(PAD.brakeFront),
        brakeRear: btn(PAD.brakeRear),
        pedal: Math.max(btn(PAD.pedal), btn(PAD.pedalRB)) > 0.5 ? 1 : 0,
        weight: -sy, // stick vers l'avant : le poids passe devant
        hop: btn(PAD.hop) > 0.5,
      };
      const active = Math.abs(sx) + Math.abs(sy) + padControl.brakeFront + padControl.brakeRear + padControl.pedal + (padControl.hop ? 1 : 0) > 0.05;
      if (active) this.usingPad = true;
      if (this.usingPad) {
        control = padControl;
        this.look.x = dead(pad.axes[2] || 0, 0.15);
        this.look.y = dead(pad.axes[3] || 0, 0.15);
      }
      if (hit(PAD.respawn) || hit(PAD.respawnB)) actions.respawn = true;
      if (hit(PAD.restart)) actions.restart = true;
      if (hit(PAD.camera)) actions.camera = true;
      if (hit(PAD.mode)) actions.mode = true;
      if (hit(PAD.pedal) || hit(PAD.pedalRB) || hit(PAD.hop)) actions.start = true;
      this.padPrev = pad.buttons.map((b) => b.value);
    }
    return { control, actions };
  }
}
