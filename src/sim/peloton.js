// Le peloton : vingt rivaux qui partent en ligne avec le joueur. Chacun est une descente du pilote automatique,
// enregistrée à l'avance (tools/peloton.mjs → public/peloton/<piste>.bin) avec son niveau, sa trajectoire et son temps
// de réaction, puis rejouée au même chrono que le joueur. Ils ne se touchent pas : on passe au travers.
//
// Ce module ne dépend pas de l'affichage : il sert à l'outil d'enregistrement, aux tests et au jeu.

import { autopilot } from './autopilot.js';
import { STEP } from './world.js';
import { rng } from './noise.js';

/**
 * Les rivaux. pace : attaque en virage (1 = le pilote auto des tests) ; line : leur côté préféré de la piste (m) ;
 * react : temps de réaction au GO (s) ; style : ce qu'ils font en l'air (whip : vélo couché de côté, table : vélo à plat,
 * 0 = rien) ; kit : leurs couleurs (maillot, motif, pantalon, casque, gants, sac à dos).
 */
export const ROSTER = [
  { num: 1, name: 'Théo Varenne', pace: 1.1, line: -0.6, react: 0.12, style: { whip: 0.9, table: 0.2 }, kit: { jersey: '#1f4fbf', jersey2: '#f2f2ef', pattern: 'epaules', pants: '#15171c', helmet: '#f2f2ef', helmet2: '#1f4fbf', gloves: '#1f4fbf', pack: false } },
  { num: 2, name: 'Lisa Chabert', pace: 1.09, line: 0.5, react: 0.15, style: { whip: 0.4, table: 0.7 }, kit: { jersey: '#e6007e', jersey2: '#111318', pattern: 'bandes', pants: '#111318', helmet: '#111318', helmet2: '#e6007e', gloves: '#111318', pack: false } },
  { num: 3, name: 'Jonas Kessler', pace: 1.08, line: 0.9, react: 0.2, style: { whip: 0.7, table: 0 }, kit: { jersey: '#ffd21f', jersey2: '#151515', pattern: 'diagonale', pants: '#151515', helmet: '#151515', helmet2: '#ffd21f', gloves: '#ffd21f', pack: false } },
  { num: 4, name: 'Maël Dufresne', pace: 1.07, line: -1, react: 0.18, style: { whip: 0.2, table: 0.9 }, kit: { jersey: '#0f8a5f', jersey2: '#e9e4d8', pattern: 'epaules', pants: '#2b2f36', helmet: '#e9e4d8', helmet2: '#0f8a5f', gloves: '#e9e4d8', pack: false } },
  { num: 5, name: 'Inès Vidal', pace: 1.06, line: 0.2, react: 0.14, style: { whip: 0.6, table: 0.3 }, kit: { jersey: '#ff6a13', jersey2: '#1d2633', pattern: 'bandes', pants: '#1d2633', helmet: '#ff6a13', helmet2: '#1d2633', gloves: '#1d2633', pack: false } },
  { num: 6, name: 'Nico Paletti', pace: 1.05, line: -0.3, react: 0.25, style: { whip: 1, table: 0 }, kit: { jersey: '#c8102e', jersey2: '#ffffff', pattern: 'diagonale', pants: '#ffffff', helmet: '#ffffff', helmet2: '#c8102e', gloves: '#c8102e', pack: false } },
  { num: 7, name: 'Aurélien Brac', pace: 1.04, line: 1.1, react: 0.3, style: { whip: 0, table: 0.5 }, kit: { jersey: '#4a5d23', jersey2: '#d9cfb0', pattern: 'uni', pants: '#3a3f2a', helmet: '#3a3f2a', helmet2: '#d9cfb0', gloves: '#3a3f2a', pack: true } },
  { num: 8, name: 'Emma Lindqvist', pace: 1.04, line: -0.8, react: 0.16, style: { whip: 0.5, table: 0.5 }, kit: { jersey: '#6ec6ff', jersey2: '#0c2340', pattern: 'epaules', pants: '#0c2340', helmet: '#0c2340', helmet2: '#6ec6ff', gloves: '#6ec6ff', pack: false } },
  { num: 9, name: 'Hugo Marchal', pace: 1.03, line: 0.6, react: 0.22, style: { whip: 0.3, table: 0 }, kit: { jersey: '#2d2d2d', jersey2: '#c6ff00', pattern: 'bandes', pants: '#2d2d2d', helmet: '#c6ff00', helmet2: '#2d2d2d', gloves: '#c6ff00', pack: false } },
  { num: 10, name: 'Léa Fontanel', pace: 1.02, line: -0.1, react: 0.2, style: { whip: 0, table: 0.6 }, kit: { jersey: '#7b2d8e', jersey2: '#f4c430', pattern: 'diagonale', pants: '#25202b', helmet: '#f4c430', helmet2: '#7b2d8e', gloves: '#25202b', pack: true } },
  { num: 11, name: 'Tom Achard', pace: 1.01, line: 1.2, react: 0.35, style: { whip: 0.8, table: 0 }, kit: { jersey: '#00a19a', jersey2: '#ffffff', pattern: 'uni', pants: '#1a1d22', helmet: '#1a1d22', helmet2: '#00a19a', gloves: '#ffffff', pack: false } },
  { num: 12, name: 'Clara Reymond', pace: 1, line: -1.2, react: 0.28, style: { whip: 0, table: 0.3 }, kit: { jersey: '#f7f3e8', jersey2: '#b3352b', pattern: 'epaules', pants: '#b3352b', helmet: '#b3352b', helmet2: '#f7f3e8', gloves: '#f7f3e8', pack: true } },
  { num: 13, name: 'Yanis Belaïd', pace: 0.99, line: 0.3, react: 0.4, style: { whip: 0.6, table: 0.2 }, kit: { jersey: '#ff2e3b', jersey2: '#ffd21f', pattern: 'bandes', pants: '#141414', helmet: '#141414', helmet2: '#ff2e3b', gloves: '#ff2e3b', pack: false } },
  { num: 14, name: 'Zoé Perrin', pace: 0.98, line: -0.5, react: 0.3, style: { whip: 0, table: 0 }, kit: { jersey: '#a7d8de', jersey2: '#40576b', pattern: 'uni', pants: '#40576b', helmet: '#ffffff', helmet2: '#a7d8de', gloves: '#40576b', pack: true } },
  { num: 15, name: 'Matteo Galli', pace: 0.97, line: 0.8, react: 0.45, style: { whip: 0.4, table: 0 }, kit: { jersey: '#005b96', jersey2: '#ff9e1b', pattern: 'diagonale', pants: '#0b1f33', helmet: '#ff9e1b', helmet2: '#005b96', gloves: '#0b1f33', pack: false } },
  { num: 16, name: 'Finn Doherty', pace: 0.96, line: -0.9, react: 0.38, style: { whip: 0.2, table: 0.2 }, kit: { jersey: '#3c8d2f', jersey2: '#ffffff', pattern: 'bandes', pants: '#ffffff', helmet: '#3c8d2f', helmet2: '#ffffff', gloves: '#3c8d2f', pack: true } },
  { num: 17, name: 'Nina Rossat', pace: 0.95, line: 0, react: 0.5, style: { whip: 0, table: 0.4 }, kit: { jersey: '#d4a5a5', jersey2: '#3b3b58', pattern: 'epaules', pants: '#3b3b58', helmet: '#3b3b58', helmet2: '#d4a5a5', gloves: '#d4a5a5', pack: true } },
  { num: 18, name: 'Axel Duval', pace: 0.94, line: 1, react: 0.42, style: { whip: 0.3, table: 0 }, kit: { jersey: '#5c5f66', jersey2: '#ff6a13', pattern: 'uni', pants: '#2a2c30', helmet: '#5c5f66', helmet2: '#ff6a13', gloves: '#2a2c30', pack: false } },
  { num: 19, name: 'Kenji Moreau', pace: 0.93, line: -0.4, react: 0.55, style: { whip: 0, table: 0 }, kit: { jersey: '#fafafa', jersey2: '#111111', pattern: 'diagonale', pants: '#111111', helmet: '#111111', helmet2: '#fafafa', gloves: '#111111', pack: true } },
  { num: 20, name: 'Paul Sarrazin', pace: 0.92, line: 0.7, react: 0.6, style: { whip: 0, table: 0.2 }, kit: { jersey: '#8c1c13', jersey2: '#e8c547', pattern: 'bandes', pants: '#33231f', helmet: '#e8c547', helmet2: '#8c1c13', gloves: '#33231f', pack: true } },
];

/** Le dossard du joueur, et sa place sur la grille (rang 4, au milieu). */
export const PLAYER = { num: 21, slot: 10 };

const COLS = [-1.5, 0, 1.5], ROW_GAP = 3.2;

/**
 * Les places sur la grille, juste après l'arche de départ : rangs de trois, le premier devant. Une carte large peut en
 * demander plus de front (map.peloton : cols, colGap, rowGap, et offset, la distance de l'arche au dernier rang).
 */
export function gridSlots(track, count = ROSTER.length + 1) {
  const cfg = track.map.peloton || {};
  const cols = cfg.cols ? Array.from({ length: cfg.cols }, (_, i) => (i - (cfg.cols - 1) / 2) * cfg.colGap) : COLS;
  const gap = cfg.rowGap || ROW_GAP;
  const rows = Math.ceil(count / cols.length);
  const front = track.gates[0].s + (cfg.offset ?? 4) + (rows - 1) * gap;
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols.length), col = i % cols.length;
    slots.push({ s: front - row * gap, u: cols[col] * (row % 2 ? 0.95 : 1) });
  }
  return slots;
}

/** La place de chaque rival sur la grille (la place du joueur est réservée). */
export function riderSlot(index) {
  return index < PLAYER.slot ? index : index + 1;
}

/**
 * La trajectoire d'un rival : son côté préféré, qui ondule lentement, ramené au milieu sur les sauts, les ponts et les
 * pierriers (là où tout le monde passe au même endroit). Sur un tronçon large (le glacier), il garde à peu près sa
 * place de la grille (gridU), et rejoint les autres quand le couloir se resserre.
 */
/**
 * L'engagement d'un rival (voir autopilot.js) : plus il attaque, plus il roule vite en ligne droite, freine tard,
 * enroule les virages et passe les bosses lancé. Il pédale jusqu'à 47 km/h, arrive au saut à sa vitesse 15 m avant
 * (pas 40), braque plus franchement et regarde plus loin devant lui (sans quoi, à 50 km/h, il zigzague). Dans les
 * cailloux, il reste presque aussi prudent que le pilote auto (c'est là qu'on tombe). Du plus lent au plus rapide,
 * de 1,11 à 1,4.
 */
export const attack = (pace) => ({
  boost: 1 + (pace - 0.85) * 1.6, turnBoost: 1, rootBoost: 0.8, brakeBoost: 2.5, rollerBoost: 1.6,
  pedalTo: 13, jumpLead: 15, steerMax: 0.95, gripMax: 0.55, look: 0.75,
});

export function lineFor(track, rider, seed, gridU = 0) {
  const r = rng(seed);
  const w1 = 35 + r() * 40, w2 = 90 + r() * 60, p1 = r() * 6.28, p2 = r() * 6.28;
  const narrow = track.features.filter((f) => f.type === 'jump' || f.type === 'bridge' || f.type === 'rocks' || f.type === 'slab');
  return (s) => {
    let u = rider.line * 0.8 + 0.55 * Math.sin(s / w1 + p1) + 0.35 * Math.sin(s / w2 + p2);
    let k = 1;
    for (const f of narrow) {
      const d = s < f.a ? f.a - s : s > f.b ? s - f.b : 0;
      k = Math.min(k, Math.min(1, d / 12));
    }
    if (track.onBridge && track.onBridge(s)) k = 0;
    u *= k;
    u = Math.max(-1.5, Math.min(1.5, u));
    // (la largeur qui vient, pas seulement celle d'ici : on se replace avant un goulet, pas dedans)
    let tape = track.tapeAt(s);
    for (let d = 6; d <= 30; d += 6) tape = Math.min(tape, track.tapeAt(s + d));
    if (tape > 4) {
      const w = Math.min(1, (tape - 3.4) / 12);
      u = u * (1 - w) + w * (gridU * 0.9 + 2.5 * Math.sin(s / w1 + p1));
      u = Math.max(-(tape - 2), Math.min(tape - 2, u));
    }
    // Dans un passage étroit, chacun reste entre les rubalises.
    const lim = Math.max(0.2, tape - 0.9);
    return Math.max(-lim, Math.min(lim, u));
  };
}

// ---------- Enregistrement ----------

const RATE = 10; // échantillons par seconde
const HOLD = { steer: 0, brakeFront: 1, brakeRear: 1, pedal: 0, weight: 0, hop: false };

/**
 * Les champs d'un échantillon, et leur précision dans le fichier : les quatre premiers en flottants, les autres en
 * entiers 16 bits (valeur × échelle).
 */
const FIELDS = [
  ['x'], ['y'], ['z'], ['s'],
  ['qx', 1e4], ['qy', 1e4], ['qz', 1e4], ['qw', 1e4],
  ['steer', 1e4], ['suspF', 1e4], ['suspR', 1e4], ['lean', 1e4], ['crouch', 1e4],
  ['hipsX', 1e4], ['hipsY', 1e4], ['hipsZ', 1e4],
  ['omegaF', 100], ['omegaR', 100], ['flags', 1],
];
const NF = FIELDS.length, NFLOAT = 4;
const SAMPLE_BYTES = NFLOAT * 4 + (NF - NFLOAT) * 2;
/** L'indice de chaque champ dans un échantillon décodé. */
export const POSE = Object.fromEntries(FIELDS.map(([k], i) => [k, i]));
/** Les drapeaux : roues au sol (0 à 2), pédale, freine, arrivé. */
export const FLAG = { contacts: 3, pedal: 4, brake: 8, finished: 16 };
export { RATE as PELOTON_RATE, NF as POSE_SIZE };

/** La pose du vélo et de son pilote en ce moment, au format d'un échantillon (FIELDS). Sert aussi au jeu en ligne. */
export function poseOf(sim) {
  const b = sim.bike, t = b.body.translation(), r = b.body.rotation(), [wf, wr] = b.wheels, inp = b.input || {};
  const flags = Math.min(2, b.contacts) | (inp.pedal > 0 ? FLAG.pedal : 0)
    | ((inp.brakeFront || 0) + (inp.brakeRear || 0) > 0.15 ? FLAG.brake : 0) | (sim.race.state === 'arrivee' ? FLAG.finished : 0);
  return [t.x, t.y, t.z, sim.race.s, r.x, r.y, r.z, r.w, b.steer, wf.x, wr.x, b.lean || 0, b.crouch || 0,
    b.hips.x, b.hips.y, b.hips.z, wf.omega, wr.omega, flags];
}

/** Place un vélo sur sa place de grille et laisse les suspensions se poser, freins serrés. */
export function placeOnGrid(sim, slot) {
  sim.reset();
  sim.bike.placeOnTrack(slot.s, 0, slot.u);
  sim.race.s = slot.s;
  sim.race.u = slot.u;
  sim.race.reached = slot.s;
  // La grille est après l'arche : le chrono partira au GO, pas en la franchissant.
  sim.race.next = sim.track.gates.findIndex((g) => g.kind !== 'depart' && g.s > slot.s);
  for (let i = 0; i < 1.5 / STEP; i++) sim.step(HOLD);
}

/**
 * Enregistre la descente d'un rival : du GO jusqu'à l'arrêt après l'arrivée. Renvoie null s'il tombe ou sort du
 * balisage (l'outil réessaie alors avec moins d'attaque).
 */
export function recordRider(sim, rider, slot, { pace = rider.pace, seed = rider.num * 31 + 7, maxTime = 900 } = {}) {
  placeOnGrid(sim, slot);
  sim._autopilot = null;
  const line = lineFor(sim.track, rider, seed, slot.u);
  const pose = [];
  const push = () => pose.push(poseOf(sim));
  sim.race.startMass();
  push();
  // Après la ligne, chacun va s'arrêter à sa place dans l'aire d'arrivée (pas tous au même endroit).
  let stopS = Infinity;
  const stopU = (((rider.num * 3) % 5) - 2) * 1.3;
  const stopLine = () => stopU;
  let finish = null, after = 0, still = 0, next = 1 / RATE;
  for (let t = 0; t < maxTime; t += STEP) {
    let inp;
    if (finish !== null) {
      const v = sim.bike.state().speed, vWant = Math.sqrt(2 * 4 * Math.max(0, stopS - sim.race.s));
      inp = { ...autopilot(sim, { pace, line: stopLine }), pedal: 0, weight: -0.3 };
      if (v < 0.6) inp = HOLD;
      else if (sim.race.s >= stopS) Object.assign(inp, { brakeFront: 0.45, brakeRear: 0.8, weight: -0.6 });
      else { inp.brakeFront = Math.min(0.5, Math.max(0, (v - vWant) * 0.3)); inp.brakeRear = Math.min(0.8, Math.max(0, (v - vWant) * 0.5)); }
    } else if (t < rider.react) inp = HOLD;
    else inp = autopilot(sim, { pace, line, ...attack(pace) });
    sim.step(inp);
    if (sim.bike.crashed || sim.race.out || sim.race.missed) return null;
    // Un rival ne touche jamais la rubalise (le joueur, lui, a un demi-mètre de tolérance) : sinon, on refait sa descente.
    if (finish === null && sim.race.state === 'course' && Math.abs(sim.race.u) > sim.track.tapeAt(sim.race.s) - 0.1) return null;
    // (sur l'horloge de la descente : le chrono, lui, s'arrête à l'arrivée)
    if (t + STEP + 1e-9 >= next) { push(); next += 1 / RATE; }
    if (finish === null && sim.race.state === 'arrivee') {
      finish = sim.race.time;
      // Sa place : là où il peut s'arrêter sans piler (4 m/s² de freinage), plus ou moins loin selon chacun.
      stopS = Math.min(sim.track.length - 3, sim.race.s + sim.bike.state().speed ** 2 / 9 + 2 + ((rider.num * 7) % 6) * 2.5);
    }
    // On garde l'arrêt complet (pied à terre) : une seconde et demie immobile, quinze secondes au plus.
    if (finish !== null) {
      after += STEP;
      still = sim.bike.state().speed < 0.3 ? still + STEP : 0;
      if (still > 1.5 || after > 15) break;
    }
  }
  if (finish === null) return null;
  return { num: rider.num, finish, pace, pose };
}

// ---------- Format binaire ----------
// En-tête : 'PLTN', version, nombre de rivaux. Puis pour chacun : dossard, nombre d'échantillons, temps d'arrivée,
// puis ses échantillons.

const MAGIC = 0x4e544c50; // 'PLTN'

export function encodePeloton(runs) {
  let bytes = 12;
  for (const r of runs) bytes += 12 + r.pose.length * SAMPLE_BYTES;
  const dv = new DataView(new ArrayBuffer(bytes));
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, runs.length, true);
  let o = 12;
  for (const r of runs) {
    dv.setUint32(o, r.num, true); dv.setUint32(o + 4, r.pose.length, true); dv.setFloat32(o + 8, r.finish, true);
    o += 12;
    for (const p of r.pose) {
      for (let k = 0; k < NF; k++) {
        if (k < NFLOAT) { dv.setFloat32(o, p[k], true); o += 4; }
        else { dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(p[k] * FIELDS[k][1]))), true); o += 2; }
      }
    }
  }
  return new Uint8Array(dv.buffer);
}

/** Lit un fichier de peloton : pour chaque rival, ses échantillons à la suite dans un tableau plat (POSE_SIZE valeurs chacun). */
export function decodePeloton(bytes) {
  const dv = new DataView(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 2) throw new Error('fichier de peloton invalide');
  const n = dv.getUint32(8, true);
  const runs = [];
  let o = 12;
  for (let i = 0; i < n; i++) {
    const num = dv.getUint32(o, true), count = dv.getUint32(o + 4, true), finish = dv.getFloat32(o + 8, true);
    o += 12;
    const d = new Float32Array(count * NF);
    for (let j = 0; j < count * NF; j++) {
      const k = j % NF;
      if (k < NFLOAT) { d[j] = dv.getFloat32(o, true); o += 4; }
      else { d[j] = dv.getInt16(o, true) / FIELDS[k][1]; o += 2; }
    }
    runs.push({ num, finish, count, d, rider: ROSTER.find((r) => r.num === num) });
  }
  return runs;
}

/** La distance parcourue par un rival au temps t (pour le classement et la barre de progression). */
export function sAt(run, t) {
  const f = Math.max(0, Math.min(run.count - 1.001, t * RATE));
  const i = Math.floor(f), a = run.d[i * NF + 3], b = run.d[(i + 1) * NF + 3];
  return a + (b - a) * (f - i);
}
