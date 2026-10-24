// Un pilote automatique simple : il suit le tracé et freine avant les virages.
// Il sert aux tests (la piste est-elle faisable ?) et à la démo (touche P).
// Il a exactement les mêmes commandes que le joueur : la courbe voulue, les freins, le pédalage, le poids.
// opts.trick ('backflip', 'frontflip', '360') : il tente une figure au saut d'arrivée (démo du mode Normal).
// opts.pace (1 par défaut) : plus ou moins d'attaque en virage et dans les zones lentes (les rivaux du peloton).
// opts.line(s) : l'écart au milieu de la piste qu'il vise à la distance s, en mètres (sa trajectoire à lui).
// opts.boost et la suite (pedalTo, jumpLead, steerMax, gripMax, look…) : l'engagement des rivaux (peloton.js, attack).

import { clamp, G } from './bike.js';
import { smoothstep } from './noise.js';
import { STEP } from './world.js';

const BRAKE_DECEL = 2.0; // décélération sur laquelle il compte pour freiner avant un virage (m/s²)
const TURN_GRIP = 0.4; // accélération latérale qu'il s'autorise en virage (en g, plus le dévers)

export function autopilot(sim, opts = {}) {
  const { bike, race, track } = sim;
  const st = bike.state();
  const v = Math.hypot(st.velocity.x, st.velocity.z);
  const q = st.quaternion;
  let fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;

  // Poursuite d'un point du tracé, assez proche pour ne pas couper les virages.
  const Ld = 5 + v * (opts.look ?? 0.6);
  const look = track.sample(race.s + Ld);
  if (opts.line) { const u = opts.line(race.s + Ld); look.x += look.rx * u; look.z += look.rz * u; }
  const pace = opts.pace || 1;
  // boost : l'engagement d'un vrai pilote (les rivaux) : il roule plus vite en ligne droite et passe les cailloux, les
  // racines et les bosses plus lancé que le pilote auto prudent des tests (1).
  const boost = opts.boost || 1;
  // (dans les cailloux, les racines et les bosses, même les meilleurs forcent moins qu'en ligne droite)
  const rp = Math.min(pace, 1) * (1 + (boost - 1) * 0.35);
  const dx = look.x - st.position.x, dz = look.z - st.position.z;
  const err = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz); // > 0 : le point est à droite
  const curvature = (2 * Math.sin(err)) / Math.max(Math.hypot(dx, dz), 1);
  const kmax = curvature > 0 ? bike.kappaMax.right : bike.kappaMax.left;
  // Des réactions douces : consigne limitée et lissée (un pilote ne donne pas de coups de guidon).
  const mem = (sim._autopilot ||= { steer: 0 });
  const steerMax = opts.steerMax ?? 0.8;
  const want = st.airTime > 0 ? 0 : clamp(curvature / Math.max(kmax, 1e-4), -steerMax, steerMax);
  mem.steer += (want - mem.steer) * Math.min(1, STEP / 0.12); // il est appelé à chaque pas de physique
  const steer = mem.steer;

  // Vitesse visée : assez lente pour chaque virage à venir, en tenant compte de la distance pour freiner. Dans une
  // pente raide, la gravité mange une partie du freinage : il faut s'y prendre plus tôt.
  // (sur le glacier, la carte lui permet d'aller bien plus vite : il regarde alors plus loin pour freiner à temps)
  let vmax = opts.vmax || track.vmaxAt(race.s) * boost;
  const horizon = v > 14.5 ? 160 : 90;
  const y0 = track.trailY(race.s, 0);
  // (un rival freine plus tard et plus fort, sauf dans les pentes raides, où la gravité mange le freinage)
  const strong = BRAKE_DECEL * (1 + (boost - 1) * (opts.brakeBoost ?? 0));
  const decelTo = (d) => {
    if (d < 1) return BRAKE_DECEL;
    const g = (G * (y0 - track.trailY(race.s + d, 0))) / d;
    const decel = strong + (BRAKE_DECEL - strong) * smoothstep(1.5, 2.8, g);
    return clamp(decel + 2 - g, 0.6, decel);
  };
  // (un rival compte aussi le dévers, qui le ralentit : penché vers l'extérieur, le vélo tourne moins)
  const camber = (b) => (boost > 1 ? Math.max(b, -0.3) : Math.max(0, b));
  for (let d = 0; d < horizon; d += 2) {
    const f = track.sample(race.s + d);
    const k = Math.abs(f.k);
    const lat = Math.min(TURN_GRIP * pace * (1 + (boost - 1) * (opts.turnBoost ?? 0)), opts.gripMax ?? Infinity) + camber(Math.sign(f.k) * f.bank) * 0.6; // un virage relevé se passe plus vite
    const vTurn = Math.sqrt((lat * G) / Math.max(k, 1e-3));
    vmax = Math.min(vmax, Math.sqrt(vTurn * vTurn + 2 * decelTo(d) * d));
  }
  // Dans les cailloux, il ralentit et recule son poids ; sur les bosses, il ralentit aussi. Il freine assez tôt pour
  // y arriver à la bonne vitesse.
  // (les racines font décoller : là, même les rivaux gardent la prudence du pilote auto)
  const inRocks = track.features.some((f) => f.type === 'rocks' && race.s > f.a - 15 && race.s < f.b);
  const inRoots = track.roots.some((r) => r.s > race.s - 2 && r.s < race.s + 20);
  const rough = inRocks || inRoots;
  if (inRocks) vmax = Math.min(vmax, 9 * rp);
  const rootV = 9 * Math.min(pace, 1) * (1 + (boost - 1) * (opts.rootBoost ?? 0));
  if (inRoots) vmax = Math.min(vmax, rootV);
  // Les prochaines racines : un rival, plus lancé, freine à temps pour y arriver à la bonne vitesse.
  let nextRoot = Infinity;
  if (boost > 1) for (const r of track.roots) if (r.s >= race.s + 20 && r.s < nextRoot) nextRoot = r.s;
  if (nextRoot < race.s + 20 + horizon) {
    const d = nextRoot - 20 - race.s;
    vmax = Math.min(vmax, Math.sqrt(rootV ** 2 + 2 * decelTo(d) * d));
  }
  // Des bosses : 8,5 m/s, sauf celles qui ont leur vitesse (de longues vagues, qu'on prend lancé).
  const rollers = track.features.find((f) => f.type === 'rollers' && race.s > f.a - 25 && race.s < f.b);
  const rollP = Math.min(pace, 1) * (1 + (boost - 1) * (opts.rollerBoost ?? 0.35));
  if (rollers) vmax = Math.min(vmax, (rollers.speed ?? 8.5) * rollP);
  for (const f of track.features) {
    const slow = f.type === 'rocks' ? [9 * rp, 15] : f.type === 'rollers' ? [(f.speed ?? 8.5) * rollP, 25] : null;
    if (!slow) continue;
    const d = f.a - slow[1] - race.s;
    if (d > 0 && d < horizon) vmax = Math.min(vmax, Math.sqrt(slow[0] ** 2 + 2 * decelTo(d) * d));
  }
  const lead = opts.jumpLead ?? 40;
  // Avant un saut, juste la bonne vitesse (et, de plus loin, de quoi freiner jusqu'à elle).
  for (const f of track.features) {
    if (!f.speed || f.a - lead <= race.s || f.a - lead > race.s + horizon) continue;
    const d = f.a - lead - race.s;
    vmax = Math.min(vmax, Math.sqrt(f.speed ** 2 + 2 * decelTo(d) * d));
  }
  const jump = track.features.find((f) => f.speed && race.s > f.a - lead && race.s < f.a + 4);
  // (la vitesse prévue est celle de la lèvre : la montée de la lèvre en coûte un peu)
  if (jump) {
    const rise = jump.lipS ? Math.max(0, track.trailY(jump.lipS, 0) - track.trailY(race.s, 0)) : 0;
    vmax = Math.min(vmax, Math.sqrt(jump.speed ** 2 + 2 * G * rise * (race.s < jump.lipS ? 1 : 0)));
  }
  vmax = Math.max(4, vmax);
  const over = v - vmax;
  const brake = clamp(over * 0.35, 0, 1) * (1 - 0.7 * Math.abs(steer)); // penché, le grip sert à tourner
  const [wf, wr] = st.wheels; // jamais de frein sur une roue en l'air : elle se bloquerait

  // En l'air : aligner le vélo sur la pente de la réception, avec le poids.
  // (un rival qui redémarre garde le poids au centre : en arrière, il se cabrerait en pédalant)
  let weight = rough && (boost === 1 || v > 4) ? -0.4 : -brake * 0.9;
  if (st.contacts === 0) {
    const ahead = race.s + v * 0.35;
    const groundPitch = Math.atan((track.trailY(ahead + 2, 0) - track.trailY(ahead - 2, 0)) / 4);
    const fy = 2 * (q.y * q.z - q.w * q.x); // composante verticale de l'avant du vélo
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
    const w = st.angularVelocity, pitchRate = w.x * rx + w.y * ry + w.z * rz;
    weight = clamp((Math.asin(clamp(-fy, -1, 1)) - groundPitch) * 3 + pitchRate * 0.6, -1, 1);
  }
  // Démo (mode Normal) : une figure au saut d'arrivée. Groupé, stick à fond, lâché passé la moitié du tour.
  let hop = false;
  const air = sim.tricks && sim.tricks.air, finish = opts.trick && track.features.find((f) => f.name === "saut d'arrivée");
  // Un seul essai par passage : pas de deuxième figure sur un rebond de la réception.
  if (finish && race.s < finish.lipS - 1) mem.trick = 'prêt';
  if (finish && mem.trick === 'prêt' && air && Math.abs(race.s - finish.lipS) < 2) mem.trick = 'en cours';
  if (mem.trick === 'en cours' && !air) mem.trick = 'fait';
  if (mem.trick === 'en cours') {
    const turned = opts.trick === '360' ? Math.abs(air.yaw) : Math.abs(air.pitch);
    if (turned < 4.2) {
      hop = true;
      if (opts.trick === '360') return { steer: 1, brakeFront: 0, brakeRear: 0, pedal: 0, weight: 0, hop };
      weight = opts.trick === 'frontflip' ? 1 : -1;
    }
  }
  return {
    steer,
    brakeFront: wf.grounded && st.airTime === 0 ? clamp(brake * 0.55, 0, 0.5) : 0,
    brakeRear: wr.grounded && st.airTime === 0 ? clamp(brake * 0.8, 0, 0.8) : 0,
    pedal: st.contacts > 0 && v < (jump ? vmax - 0.3 : rough ? Math.min(vmax - 2, 9) : Math.min(vmax - (opts.pedalTo ? 1 : 2), opts.pedalTo ?? 9)) ? 1 : 0, // relance avant un saut ; jamais en l'air (la roue s'emballerait)
    weight,
    hop,
  };
}
