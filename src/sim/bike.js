// Le vélo et son pilote. La physique suit celle de Terrain Rider (terrainrider.com), réécrite ici :
//
// - Vélo et pilote forment un seul corps rigide (Rapier), mais le centre de gravité bouge : le pilote se recule,
//   s'avance, se décale sur le côté, s'accroupit. Le déplacer change vraiment la répartition du poids.
// - Les deux roues tournent pour de vrai : chacune a son inertie, sa vitesse de rotation, son frein (un couple),
//   et le pédalage entraîne la roue arrière. Un frein trop fort bloque la roue.
// - Le pneu : sa déformation (la « bande de roulement ») suit le glissement avec une longueur de relaxation, et la
//   force vient de la formule de Pacejka. Freiner et tourner se partagent le même grip. L'arrière décroche plus
//   facilement que l'avant. Plus une roue est chargée, plus elle accroche : peser sur l'avant aide à tourner.
// - La direction : le joueur demande une courbe, le pilote penche le vélo à l'angle qu'il faut et tient l'équilibre
//   en braquant le guidon (un régulateur sur l'écart d'inclinaison). L'équilibre n'est pas imposé : il vient du guidon,
//   comme sur un vrai vélo. L'inclinaison permise grandit dans un virage relevé et diminue en dévers.
// - Les effets gyroscopiques des roues et le couple de réaction quand on freine ou qu'on pédale.
// - Le bunny-hop : maintenir pour se comprimer, relâcher pour sauter.
// - Les figures : en l'air, bouton de saut maintenu, le pilote se groupe. Son inertie baisse, le moment cinétique se
//   conserve : il tourne plus vite (comme un plongeur), et le stick lance un backflip ou un 360.
// - Les aides du mode Normal (voir modes.js) : le pilote dose son frein avant, et replace le vélo en l'air.
//
// Repère du vélo (voir geometry.js) : origine au sol entre les roues, -z vers l'avant, +y vers le haut, +x à droite.

import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { clamp, smoothstep } from './noise.js';
import { GEOMETRY } from './geometry.js';

export { clamp };
export const G = 9.81;
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;

// Groupes de collision : bit 0 le vélo, bit 1 le sol, bit 2 les arbres.
export const GROUPS = {
  bike: (0x0001 << 16) | 0x0006,
  ground: (0x0002 << 16) | 0x0001,
  trees: (0x0004 << 16) | 0x0001,
  wheelRay: (0x0001 << 16) | 0x0002, // les roues ne voient que le sol
};

/**
 * Tous les réglages, modifiables en jeu (touche G). Les valeurs par défaut sont celles de Terrain Rider : c'est le
 * mode Ultra-réaliste. Le mode Normal en change quelques-uns (modes.js).
 */
export const DEFAULT_PARAMS = {
  mass: 90, // vélo + pilote
  riderFraction: 0.7, // part de la masse qui bouge avec le pilote
  comHeight: 0.91, // centre de gravité, pilote en position neutre (au-dessus du sol, vélo détendu)
  comZ: 0.07, // un peu en arrière du milieu : 45 % du poids sur l'avant
  angularDamping: 2, // au sol seulement ; en l'air, rien ne freine la rotation
  // Suspension (par roue)
  springMaxForce: 1400, // force du ressort en fin de course : environ 30 % d'enfoncement au repos (le sag)
  damperBump: 500, // amortisseur en compression (N·s/m)
  damperRebound: 600, // en détente
  damperMaxForce: 3000,
  bumpStopRate: 25000, // au-delà de la course : la butée
  bottomOutDamperGain: 8,
  // Roues et pneus
  wheelMass: 2,
  wheelInertiaFactor: 0.75,
  pacejkaB: 12.5,
  pacejkaC: 2.05,
  pacejkaD: 1.05,
  pacejkaE: 0.97,
  relaxationLength: 0.15, // distance que le pneu met à prendre sa déformation (m)
  treadBeta: 0.25,
  sideSlipFront: 0.94,
  sideSlipRear: 4, // l'arrière décroche plus vite : on peut le faire glisser
  gripLoadGain: 0.75,
  gripLoadRange: 0.4,
  gripComBias: 0.35,
  gripScale: 1,
  rollingResistance: 0.015,
  dragCdA: 0.5,
  // Freins et pédalage
  brakeTorqueFront: 550, // N·m
  brakeTorqueRear: 550,
  pedalTorque: 200,
  pedalTopSpeedKmh: 65,
  // Direction
  steerMaxDeg: 45,
  steerRateDeg: 560,
  steerAccelLoadedDeg: 120000,
  steerAccelUnloadedDeg: 3000, // roue avant en l'air : le guidon ne fouette pas
  steerSmoothTime: 0.04,
  leanErrorGain: 2.95, // braquage par radian d'écart d'inclinaison
  leanRateGain: 1,
  maxFeedbackDeg: 36,
  feedbackReserveDeg: 8,
  maxLeanRateDeg: 120,
  maxLeanDeg: 30, // inclinaison permise sur le plat ; plus dans un virage relevé
  leanBudgetMinDeg: 15,
  leanBudgetMaxDeg: 55,
  leanHardCeilDeg: 85,
  bankTime: 0.25,
  // Le pilote
  reachFwd: 0.3, // jusqu'où il avance ses hanches (m)
  reachBack: 0.65, // jusqu'où il les recule
  shiftSide: 0.19,
  turnShift: 0.019,
  balanceLookahead: 0.006,
  shiftRate: 1.4, // vitesse de ses mouvements (m/s)
  stabilityDrop: 0.18, // il se baisse quand ça va vite ou que ça descend fort
  airPitchTorque: 140, // en l'air, il fait tourner le vélo sous lui (N·m)
  airRollDamping: 40, // en l'air, son corps freine le roulis pris sur un choc (N·m·s)
  // Bunny-hop
  hopChargeTime: 0.9,
  hopTapCharge: 0.01,
  hopMinImpulse: 125,
  hopMaxImpulse: 345,
  hopNosePitch: 10,
  hopLeanPitch: 35,
  hopSpin: 35,
  // Figures : en l'air, groupé (bouton de saut maintenu), le pilote fait tourner le vélo avec le stick.
  trickPitchRate: 8.5, // vitesse de rotation visée en backflip ou frontflip, stick à fond (rad/s)
  trickSpinRate: 7, // en 360
  trickPitchTorque: 340, // ce que le pilote peut fournir pour y arriver (N·m)
  trickSpinTorque: 160,
  tuckInertia: 0.35, // groupé, le vélo et le pilote ont 35 % d'inertie en moins en tangage
  // Aides au pilotage (mode Normal ; à zéro en Ultra-réaliste)
  brakeAssist: 0, // le pilote dose le frein avant : la roue ne bloque pas, il relâche avant de basculer, pas de frein en l'air
  airAssist: 0, // en l'air, il replace le vélo dans l'axe de la réception
  airAssistFreq: 4.5, // vitesse de ce replacement (rad/s)
  airAssistMaxTorque: 260,
  // À l'arrêt, le pilote pose le pied
  balanceAssistFade: 1 / 3.6,
  balanceAssistK: 900,
  balanceAssistC: 180,
  // Chute : perte de vitesse brutale
  crashImpactSpeed: 3,
  crashImpactWindow: 0.025,
  crashLeanDeg: 72, // couché sur le côté
  crashNoseDownDeg: 54, // par-dessus le guidon
  crashNoseUpDeg: 66, // looping arrière
};

const GEO = GEOMETRY;
const CRANK = { y: GEO.bottomBracket.y, z: GEO.bottomBracket.z };
const HIPS_AHEAD = -0.11; // hanches en avant du pédalier (le haut du corps penche sur le cintre)
const EXT_NEUTRAL = 0.72, EXT_STANDING = 0.76, EXT_CROUCHED = 0.52;
const READY_CROUCH = 0.62;
const TIRE_HALF_WIDTH = 0.015, TIRE_CROWN = 0.035;
const SIDE_SUPPORT_MIN = 0.2, SIDE_SUPPORT_FULL = 0.55, SIDEWALL_MAX = 0.4, OFF_AXIS_BETA = 0.25;

const v3 = () => new Vector3();

function magicFormula(P, s) {
  const a = P.pacejkaB * Math.min(Math.abs(s), 1);
  return P.pacejkaD * Math.sin(P.pacejkaC * Math.atan(a - P.pacejkaE * (a - Math.atan(a))));
}

export class Bike {
  constructor(world, track, params = DEFAULT_PARAMS) {
    this.world = world;
    this.track = track;
    this.P = params;

    const desc = RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setCanSleep(false);
    this.body = world.createRigidBody(desc);
    // Le cadre : il touche le sol si la suspension talonne au-delà de tout, ou dans un arbre.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 0.16, 0.42).setTranslation(0, 0.62, 0.05).setDensity(0).setFriction(0.6).setCollisionGroups(GROUPS.bike),
      this.body,
    );
    // Le pilote (buste et tête) : s'il touche le sol ou un arbre, c'est la chute.
    this.riderCollider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.24, 0.19)
        .setTranslation(0, 1.42, -0.06)
        .setRotation(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.75))
        .setDensity(0)
        .setFriction(0.7)
        .setCollisionGroups(GROUPS.bike)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    const makeWheel = (front) => {
      const radius = front ? GEO.frontRadius : GEO.rearRadius;
      return {
        name: front ? 'avant' : 'arriere',
        front,
        radius,
        inertia: params.wheelInertiaFactor * params.wheelMass * radius * radius,
        anchorLocal: new Vector3(GEO[front ? 'frontAnchor' : 'rearAnchor'].x, GEO[front ? 'frontAnchor' : 'rearAnchor'].y, GEO[front ? 'frontAnchor' : 'rearAnchor'].z),
        travel: front ? GEO.frontTravel : GEO.rearTravel,
        shape: new RAPIER.RoundCylinder(TIRE_HALF_WIDTH, radius - TIRE_CROWN, TIRE_CROWN),
        tread: { forward: 0, side: 0 },
        // État lisible (affichage, tests)
        contact: false, x: 0, xdot: 0, prevX: 0, load: 0, omega: 0, spinAngle: 0, slip: 0,
        locked: false, sliding: false, surface: null, point: v3(), normal: new Vector3(0, 1, 0), center: v3(),
      };
    };
    this.wheels = [makeWheel(true), makeWheel(false)];
    this.forkAxisLocal = new Vector3(GEO.forkAxis.x, GEO.forkAxis.y, GEO.forkAxis.z).normalize();
    this.steerTiltCos = clamp(this.forkAxisLocal.y, 0.3, 1);

    this.input = { steer: 0, brakeFront: 0, brakeRear: 0, pedal: 0, weight: 0, hop: false };
    this.crashed = null; // null, ou { reason, t }
    this.contacts = 0;
    this.airTime = 0;
    this.impact = [];

    // Le pilote, dans le repère du vélo : où sont ses hanches (pour l'affichage) et de combien il déplace la masse.
    this.neutralHips = new Vector3(0, CRANK.y + EXT_NEUTRAL, CRANK.z + HIPS_AHEAD);
    this.hips = this.neutralHips.clone();
    this.hipsTarget = v3();
    this.foreAft = 0;
    this.riderOffset = v3();
    this.comLocal = new Vector3(0, params.comHeight, params.comZ);
    this.baseCom = this.comLocal.clone();

    // Vecteurs de travail (pas d'allocation à chaque pas).
    this._q = new Quaternion(); this._qi = new Quaternion(); this._sq = new Quaternion(); this._cq = new Quaternion();
    this._F = v3(); this._U = v3(); this._R = v3(); this._vel = v3(); this._av = v3(); this._tmp = v3(); this._tmp2 = v3();
    this._bflat = v3(); this._rflat = v3(); this._bank = v3(); this._com = v3(); this._axis = v3(); this._wf = v3();
    this._ffwd = v3(); this._faxle = v3(); this._raxle = v3(); this._torque = v3(); this._Lf = v3(); this._Lr = v3();
    this._anchor = v3(); this._dir = v3(); this._axle = v3(); this._origin = v3(); this._n = v3(); this._A = v3();
    this._rel = v3(); this._vc = v3(); this._L = v3(); this._S = v3(); this._f = v3(); this._c1 = v3(); this._c2 = v3();
    this._unitY = new Vector3(0, 1, 0);
    this._tire = { fx: 0, fy: 0, slip: 0 };
    this._invI = v3();
    this._qt = new Quaternion(); this._m4 = new Matrix4(); this._e = v3(); this._gate = v3();
    this._land = { found: false, timer: 0, n: new Vector3(0, 1, 0) };
    this.reset();
  }

  reset() {
    for (const w of this.wheels) {
      w.omega = 0; w.x = 0; w.prevX = 0; w.xdot = 0; w.tread.forward = 0; w.tread.side = 0; w.slip = 0;
      w.contact = false; w.grounded = false; w.locked = false; w.sliding = false; w.load = 0;
    }
    this.steer = 0; this.steerRate = 0; this.steerTargetFiltered = 0; this.frontGrip = 0;
    this.kappa = 0; this.leanTarget = 0; this.lean = 0; this.bank = 0;
    this.kappaMax = { left: 0, right: 0 };
    this.stance = 0; this.crouch = 0; this.stabilityDrop = 0;
    this.hopCharge = 0; this.hopWasHeld = false; this.hopExtend = 0;
    this.hips.copy(this.neutralHips); this.foreAft = 0; this.riderOffset.set(0, 0, 0);
    this.crashed = null; this.airTime = 0; this.contacts = 0; this.impact.length = 0;
    this.grounded = false; this.tuck = 0; this.hopArmed = true; this.stuckTime = 0;
    this._land.found = false; this._land.timer = 0;
    this.setMass();
  }

  /** Masse, centre de gravité (qui suit le pilote) et inertie du corps rigide. */
  setMass() {
    const P = this.P;
    const L = GEO.wheelbase, h = 1.2, w = 0.2, m = P.mass;
    this.baseCom.set(0, P.comHeight, P.comZ);
    this.comLocal.copy(this.baseCom).addScaledVector(this.riderOffset, P.riderFraction);
    const k = this.tuckScale(this.tuck || 0);
    this.inertia = { x: k.x * (m / 12) * (h * h + L * L), y: k.y * (m / 12) * (w * w + L * L), z: k.z * (m / 12) * (w * w + h * h) };
    this.body.setAdditionalMassProperties(m, this.comLocal, this.inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    // Répartition du poids au repos, d'après la position du centre de gravité.
    this.staticLoad = this.loadShare(this.baseCom.z);
  }

  /** Groupé, le pilote ramène sa masse vers le centre : l'inertie baisse (moins autour de l'axe vertical). */
  tuckScale(tuck) {
    const a = this.P.tuckInertia * tuck;
    return { x: 1 - a, y: 1 - 0.5 * a, z: 1 - a };
  }

  loadShare(comZ) {
    const m = this.P.mass * G;
    const toFront = Math.max(comZ - GEO.frontAxle.z, 0.05), toRear = Math.max(GEO.rearAxle.z - comZ, 0.05);
    return { front: (m * toRear) / (toFront + toRear), rear: (m * toFront) / (toFront + toRear) };
  }

  /** Replace le vélo à l'arrêt (ou lancé à `speed` m/s) sur le tracé, à la distance `s`. */
  placeOnTrack(s, speed = 0) {
    const f = this.track.sample(s);
    const ahead = this.track.sample(s + 2);
    const y0 = this.track.trailY(s, 0), y1 = this.track.trailY(s + 2, 0);
    const fwd = new Vector3(ahead.x - f.x, y1 - y0, ahead.z - f.z).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(fwd.x, 0, fwd.z).normalize());
    const pitch = Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z));
    q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
    this.reset();
    // Posé avec les suspensions à leur enfoncement de repos : l'origine (le sol, vélo détendu) passe sous le sol.
    const sag = 0.3 * GEO.frontTravel;
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const pos = new Vector3(f.x, y0, f.z).addScaledVector(up, -sag + 0.02);
    this.body.setTranslation(pos, true);
    this.body.setRotation(q, true);
    this.body.setLinvel(fwd.clone().multiplyScalar(speed), true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for (const w of this.wheels) { w.x = sag; w.prevX = sag; w.omega = speed / w.radius; }
  }

  /** À appeler avant chaque world.step : calcule et applique toutes les forces. */
  applyForces(input, dt) {
    const P = this.P, b = this.body;
    const crashed = !!this.crashed;
    this.input = input;
    const inp = crashed ? { steer: 0, brakeFront: 0.4, brakeRear: 0.8, pedal: 0, weight: 0, hop: false } : input;
    b.resetForces(true);
    b.resetTorques(true);

    const t = b.translation(), r = b.rotation(), lv = b.linvel(), av = b.angvel();
    const q = this._q.set(r.x, r.y, r.z, r.w);
    const qi = this._qi.copy(q).invert();
    const F = this._F.set(0, 0, -1).applyQuaternion(q);
    const U = this._U.set(0, 1, 0).applyQuaternion(q);
    const R = this._R.set(1, 0, 0).applyQuaternion(q);
    const vel = this._vel.set(lv.x, lv.y, lv.z);
    const omegaBody = this._av.set(av.x, av.y, av.z);
    const vF = vel.dot(F); // vitesse vers l'avant
    const v2 = vF * vF;

    // ----- Groupé en l'air : le moment cinétique se conserve, moins d'inertie fait tourner plus vite -----
    const tuckWant = !crashed && !this.grounded && inp.hop ? 1 : 0;
    const tuckPrev = this.tuck;
    if (!crashed) this.tuck += clamp(tuckWant - this.tuck, -dt * 5, dt * 14);
    if (!crashed && this.tuck !== tuckPrev) {
      const k0 = this.tuckScale(tuckPrev), k1 = this.tuckScale(this.tuck);
      const wl = this._tmp.copy(omegaBody).applyQuaternion(qi);
      wl.set(wl.x * (k0.x / k1.x), wl.y * (k0.y / k1.y), wl.z * (k0.z / k1.z)).applyQuaternion(q);
      b.setAngvel(wl, true);
      omegaBody.copy(wl);
    }

    // ----- Inclinaison, et dévers du sol sous les roues -----
    const bflat = this._bflat.set(F.x, 0, F.z);
    if (bflat.lengthSq() < 1e-6) bflat.set(0, 0, -1);
    bflat.normalize();
    const rflat = this._rflat.set(-bflat.z, 0, bflat.x); // la droite, à l'horizontale
    const lean = Math.atan2(-R.y, R.dot(rflat)); // > 0 penché à droite
    const leanRate = omegaBody.dot(bflat);
    const bankN = this._bank.set(0, 0, 0);
    for (const w of this.wheels) if (w.grounded) bankN.addScaledVector(w.normal, Math.max(w.load, 1));
    if (bankN.lengthSq() > 1e-9) {
      bankN.normalize();
      const target = Math.atan2(bankN.dot(rflat), Math.max(bankN.y, 1e-4)); // > 0 : le sol remonte vers la gauche (virage à droite relevé)
      this.bank += (target - this.bank) * (1 - Math.exp(-dt / P.bankTime));
    }

    // ----- La courbe demandée, et l'inclinaison qu'elle réclame -----
    const steerMax = P.steerMaxDeg * DEG;
    const kGeom = (Math.tan(steerMax - P.feedbackReserveDeg * DEG) * this.steerTiltCos) / GEO.wheelbase;
    const budget = (side) => clamp(P.maxLeanDeg * DEG + side * this.bank, P.leanBudgetMinDeg * DEG, P.leanBudgetMaxDeg * DEG);
    const ceil = (side) => Math.min(P.leanBudgetMaxDeg * DEG + Math.max(side * this.bank, 0), P.leanHardCeilDeg * DEG);
    const comH = Math.max(this.comLocal.y, 0.2);
    const shiftLean = Math.atan((P.riderFraction * P.turnShift) / comH);
    const kRight = Math.min(kGeom, (G * Math.tan(Math.min(budget(1) + shiftLean, ceil(1)))) / Math.max(v2, 1e-3));
    const kLeft = Math.min(kGeom, (G * Math.tan(Math.min(budget(-1) + shiftLean, ceil(-1)))) / Math.max(v2, 1e-3));
    this.kappaMax.right = kRight; this.kappaMax.left = kLeft;
    const steerIn = crashed ? 0 : clamp(inp.steer, -1, 1);
    const kCmd = steerIn * (steerIn > 0 ? kRight : kLeft); // > 0 : virage à droite
    // En l'air, la courbe ne change pas : on ne prépare pas un virage sans appui.
    const kRate = this.airTime > 0.05 ? 0 : (P.maxLeanRateDeg * DEG * G) / Math.max(v2, G * GEO.wheelbase);
    this.kappa += clamp(kCmd - this.kappa, -kRate * dt, kRate * dt);
    this.kappa = clamp(this.kappa, -kLeft, kRight);
    const leanCurve = Math.atan((v2 * this.kappa) / G);
    const leanNorm = clamp(leanCurve / (P.maxLeanDeg * DEG), -1, 1);
    const turnHips = this.grounded ? P.turnShift * leanNorm : 0; // les hanches rentrent dans le virage
    this.leanTarget = leanCurve - Math.atan((P.riderFraction * turnHips) / comH);
    const leanErr = lean - this.leanTarget;

    // ----- Le pilote : où il met ses hanches, donc le centre de gravité -----
    if (!crashed) {
      this.updateStance(inp, dt);
      const maxSideLean = Math.atan((P.riderFraction * P.shiftSide) / comH);
      const a = clamp(leanErr + leanRate * P.balanceLookahead, -maxSideLean, maxSideLean);
      const balanceHips = this.grounded ? -(comH / P.riderFraction) * Math.tan(a) : 0; // trop penché à droite : il se décale à gauche
      const ext = lerp(lerp(EXT_NEUTRAL, EXT_STANDING, this.stance), EXT_CROUCHED, this.crouch);
      const p = this.grounded ? F.y : 0; // dans la pente, il reste vertical : ses hanches reculent par rapport au vélo
      const m = Math.sqrt(Math.max(0, 1 - p * p));
      const weight = clamp(inp.weight, -1, 1);
      const reach = weight * (weight >= 0 ? P.reachFwd : P.reachBack); // > 0 : vers l'avant
      const target = this.hipsTarget.set(
        this.neutralHips.x + clamp(turnHips + balanceHips, -P.shiftSide, P.shiftSide),
        CRANK.y + m * ext,
        CRANK.z + HIPS_AHEAD - p * ext - reach,
      );
      const step = this._tmp.copy(target).sub(this.hips);
      const maxStep = P.shiftRate * dt;
      const len = step.length();
      const k = len > maxStep ? maxStep / len : 1;
      this.hips.addScaledVector(step, k);
      this.foreAft += clamp((-reach - this.foreAft) * k, -maxStep, maxStep);
      if (this.grounded) {
        const speedF = smoothstep(10 / 3.6, 50 / 3.6, Math.abs(vF));
        const inclF = smoothstep(5, 35, Math.asin(clamp(Math.abs(F.y), 0, 1)) / DEG);
        const drop = P.stabilityDrop * (1 - (1 - speedF) * (1 - inclF));
        this.stabilityDrop += (drop - this.stabilityDrop) * (1 - Math.exp(-dt / 0.25));
      }
      this.riderOffset.set(
        this.hips.x - this.neutralHips.x,
        -this.stabilityDrop / P.riderFraction - (EXT_NEUTRAL - EXT_CROUCHED) * this.crouch,
        this.foreAft,
      );
      this.setMass();
    }
    const com = this._com.copy(this.comLocal).applyQuaternion(q).add(t);

    // ----- Le guidon : la courbe voulue, plus la correction d'équilibre -----
    let steerTarget = 0;
    if (!crashed) {
      const ffMax = steerMax - P.feedbackReserveDeg * DEG;
      const ff = clamp(Math.atan((this.kappa * GEO.wheelbase) / this.steerTiltCos), -ffMax, ffMax);
      const fbMax = P.maxFeedbackDeg * DEG;
      // La correction d'équilibre ne sert que si la roue avant porte : sinon (en l'air, roue avant délestée),
      // le pilote garde le guidon droit pour la reprise d'appui.
      const fb = clamp(P.leanErrorGain * leanErr + P.leanRateGain * leanRate, -fbMax, fbMax) * this.frontGrip;
      const air = smoothstep(0.02, 0.08, this.airTime);
      steerTarget = clamp((ff + fb) * (1 - air), -steerMax, steerMax);
    }
    this.steerTargetFiltered += (steerTarget - this.steerTargetFiltered) * (1 - Math.exp(-dt / Math.max(P.steerSmoothTime, 1e-4)));
    this.steerTargetFiltered = clamp(this.steerTargetFiltered, -steerMax, steerMax);
    const maxRate = P.steerRateDeg * DEG;
    const wantRate = clamp(this.steerTargetFiltered - this.steer, -maxRate * dt, maxRate * dt) / dt;
    const [wf, wr] = this.wheels;
    const frontLoaded = clamp(wf.load / Math.max(this.staticLoad.front, 1), 0, 1);
    // Appui de la roue avant, lissé : il s'établit vite et se perd un peu moins vite (rebonds sur les cailloux).
    const fg = smoothstep(0, 0.35, frontLoaded);
    this.frontGrip += (fg - this.frontGrip) * (1 - Math.exp(-dt / (fg > this.frontGrip ? 0.02 : 0.06)));
    const steerAcc = lerp(P.steerAccelUnloadedDeg, P.steerAccelLoadedDeg, frontLoaded) * DEG;
    this.steerRate += clamp(wantRate - this.steerRate, -steerAcc * dt, steerAcc * dt);
    this.steer = clamp(this.steer + this.steerRate * dt, -steerMax, steerMax);

    // ----- Pédalage et freins -----
    let drive = 0;
    if (!crashed && inp.pedal > 0) {
      const wheelSpeed = wr.omega * wr.radius;
      const slipCut = Math.abs(wheelSpeed) < 0.5 / 3.6 ? 1 : clamp(vF / wheelSpeed, 0, 1);
      const speedCut = clamp((Math.max(vF, wheelSpeed) * 3.6) / P.pedalTopSpeedKmh, 0, 1);
      drive = clamp(inp.pedal, 0, 1) * P.pedalTorque * (1 - speedCut) * slipCut;
    }
    let brakeF = clamp(inp.brakeFront, 0, 1) * P.brakeTorqueFront;
    let brakeR = clamp(inp.brakeRear, 0, 1) * P.brakeTorqueRear;
    if (P.brakeAssist > 0) {
      // Le pilote sent l'arrière se délester : il relâche l'avant avant de passer par-dessus le guidon.
      // Et il ne freine pas en l'air : les roues ne touchent pas le sol bloquées.
      const rearShare = wr.load / Math.max(this.staticLoad.rear, 1);
      const guard = wr.grounded ? smoothstep(0.06, 0.4, rearShare) : wf.grounded ? 0.3 : 0;
      brakeF *= lerp(1, guard, P.brakeAssist);
      if (!wr.grounded) brakeR *= 1 - P.brakeAssist;
    }
    // À l'arrêt sur le plat, sans pédaler, le pilote garde le vélo immobile.
    const speed = vel.length();
    if (wf.grounded && wr.grounded && speed < 0.5 && Math.abs(F.y) <= P.rollingResistance && !(inp.pedal > 0.01)) {
      brakeR = Math.max(brakeR, P.brakeTorqueRear * (1 - speed / 0.5));
    }

    // ----- Les roues -----
    const omegaF0 = wf.omega, omegaR0 = wr.omega;
    const axis = this._axis.copy(this.forkAxisLocal).applyQuaternion(q).normalize();
    const frontFwd = this._ffwd.copy(F).applyQuaternion(this._sq.setFromAxisAngle(axis, -this.steer)).normalize();
    const frontAxle = this._faxle.crossVectors(axis, frontFwd).normalize();
    const rearAxle = this._raxle.crossVectors(U, F).normalize();
    const live = this.loadShare(this.comLocal.z);
    const invMass = b.invMass();
    // Inertie inverse dans le repère du vélo (Rapier, lui, réordonne ses axes principaux).
    this._invI.set(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    this.contacts = 0;
    this.simWheel(wf, { anchorLocal: wf.anchorLocal, axis, wheelFwd: frontFwd, motor: 0, brake: brakeF, antiLock: P.brakeAssist, sideSlip: P.sideSlipFront, staticLoad: this.staticLoad.front, liveLoad: live.front, com, q, qi, t, invMass, speed, dt });
    this.simWheel(wr, { anchorLocal: wr.anchorLocal, axis: U, wheelFwd: F, motor: drive, brake: brakeR, antiLock: 0, sideSlip: P.sideSlipRear, staticLoad: this.staticLoad.rear, liveLoad: live.rear, com, q, qi, t, invMass, speed, dt });
    this.grounded = wf.grounded || wr.grounded;
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // ----- Résistance au roulement et de l'air -----
    if (this.grounded) {
      // Chaque sol roule plus ou moins bien (la terre tassée sert de référence : l'herbe freine bien plus).
      const crr = (w) => (w.surface ? w.surface.crr / 0.02 : 1) * P.rollingResistance;
      const resist = wf.load * crr(wf) + wr.load * crr(wr);
      const roll = -Math.sign(vF) * Math.min(resist, (Math.abs(vF) * P.mass) / dt);
      const n = bankN.lengthSq() > 0 ? bankN : this._unitY;
      const roadFwd = this._tmp.copy(F).addScaledVector(n, -F.dot(n)).normalize();
      b.addForce(roadFwd.multiplyScalar(roll), true);
    }
    b.addForce(this._tmp.copy(vel).multiplyScalar(-0.5 * 1.225 * P.dragCdA * speed), true);
    b.setAngularDamping(this.grounded && !crashed ? P.angularDamping : 0);

    // ----- Couples des roues sur le cadre : réaction (freins, pédalage, pneu) et effet gyroscopique -----
    const Lf = this._Lf.copy(frontAxle).multiplyScalar(wf.inertia * wf.omega);
    const Lr = this._Lr.copy(rearAxle).multiplyScalar(wr.inertia * wr.omega);
    const torque = this._torque.copy(frontAxle).multiplyScalar((-wf.inertia * (wf.omega - omegaF0)) / dt)
      .addScaledVector(rearAxle, (-wr.inertia * (wr.omega - omegaR0)) / dt);
    torque.sub(this._tmp.copy(omegaBody).cross(this._tmp2.copy(Lf).add(Lr)));
    torque.sub(this._tmp.copy(axis).multiplyScalar(-this.steerRate).cross(Lf));

    if (!crashed) {
      this.updateHop(inp, U, R, dt);
      if (this.grounded) {
        // À très basse vitesse, le pilote tient le vélo debout (un pied par terre).
        const fade = Math.max(0, 1 - Math.abs(vF) / P.balanceAssistFade);
        if (fade > 0) torque.addScaledVector(bflat, fade * (-P.balanceAssistK * leanErr - P.balanceAssistC * leanRate));
      } else {
        const weight = clamp(inp.weight, -1, 1);
        if (this.tuck > 0.02) {
          // Groupé : le stick règle la vitesse de rotation. En arrière, backflip ; en avant, frontflip ; sur le côté, 360.
          // Stick au neutre, il ne fait rien : la rotation continue sur sa lancée.
          const wl = this._tmp.copy(omegaBody).applyQuaternion(qi);
          const steerIn = clamp(inp.steer, -1, 1), I = this.inertia;
          if (Math.abs(weight) > 0.15) torque.addScaledVector(R, this.tuck * clamp(I.x * 10 * (-weight * P.trickPitchRate - wl.x), -P.trickPitchTorque, P.trickPitchTorque));
          if (Math.abs(steerIn) > 0.15) torque.addScaledVector(U, this.tuck * clamp(I.y * 10 * (-steerIn * P.trickSpinRate - wl.y), -P.trickSpinTorque, P.trickSpinTorque));
        } else {
          // En l'air, il fait basculer le vélo sous lui : poids en avant, le nez plonge.
          torque.addScaledVector(R, -weight * P.airPitchTorque);
        }
        torque.addScaledVector(F, -P.airRollDamping * omegaBody.dot(F));
        if (P.airAssist > 0) {
          // L'aide laisse libre l'axe que le joueur commande (le tangage pour un flip, le lacet pour un 360) et tient les autres.
          const flipCmd = Math.abs(weight) > 0.15 ? this.tuck : 0, spinCmd = Math.abs(inp.steer) > 0.15 ? this.tuck : 0;
          const gate = this._gate.set(1 - Math.max(flipCmd, 0.8 * Math.abs(weight) * (1 - this.tuck)), 1 - spinCmd, 1).multiplyScalar(P.airAssist);
          this.airAssist(torque, q, qi, t, vel, omegaBody, gate, dt);
        }
      }
    }
    b.addTorque(torque, true);
    this.lean = lean;
  }

  /**
   * Mode Normal : en l'air, le pilote replace le vélo pour la réception. Il vise l'axe de sa trajectoire, dans la
   * pente du sol là où il va se poser, roues à plat. Après une figure, il finit la rotation dans le sens où elle va.
   */
  airAssist(torque, q, qi, t, vel, omega, gate, dt) {
    if (this.airTime < 0.06) return;
    const P = this.P, land = this._land, track = this.track;
    // Où il va se poser : la parabole, recalculée dix fois par seconde.
    land.timer -= dt;
    if (land.timer <= 0) {
      land.timer = 0.1;
      land.found = false;
      for (let tt = 0.05; tt < 3; tt += 0.05) {
        const x = t.x + vel.x * tt, z = t.z + vel.z * tt, y = t.y + vel.y * tt - 0.5 * G * tt * tt;
        if (y > track.groundY(x, z)) continue;
        const e = 0.6;
        const dx = track.groundY(x + e, z) - track.groundY(x - e, z);
        const dz = track.groundY(x, z + e) - track.groundY(x, z - e);
        land.n.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
        land.found = true;
        break;
      }
      if (!land.found) land.n.set(0, 1, 0);
    }
    // Orientation visée : l'avant dans le sens du déplacement, posé sur la pente de la réception.
    const n = land.n;
    const Ft = this._f.set(vel.x, 0, vel.z);
    if (Ft.lengthSq() < 0.25) return;
    Ft.normalize().addScaledVector(n, -Ft.dot(n)).normalize();
    const Rt = this._c1.crossVectors(Ft, n).normalize();
    const Ut = this._c2.crossVectors(Rt, Ft);
    this._m4.makeBasis(Rt, Ut, this._e.copy(Ft).negate());
    const qt = this._qt.setFromRotationMatrix(this._m4);
    // L'écart, en axe × angle, dans le repère du vélo.
    const qe = qt.multiply(this._sq.copy(q).invert());
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const sinHalf = Math.hypot(qe.x, qe.y, qe.z);
    const angle = 2 * Math.atan2(sinHalf, qe.w);
    const err = this._e.set(qe.x, qe.y, qe.z).multiplyScalar(sinHalf > 1e-6 ? angle / sinHalf : 0).applyQuaternion(qi);
    const wl = this._tmp2.copy(omega).applyQuaternion(qi);
    const wn = P.airAssistFreq, I = this.inertia;
    // Il vise une vitesse de rotation proportionnelle à l'écart : une rotation lancée vers la bonne position continue.
    const out = this._c1.set(
      I.x * 2 * wn * (wn * err.x - wl.x),
      I.y * 2 * wn * (wn * err.y - wl.y),
      I.z * 2 * wn * (wn * err.z - wl.z),
    );
    out.set(out.x * gate.x, out.y * gate.y, out.z * gate.z);
    const mag = out.length(), max = P.airAssistMaxTorque;
    if (mag > max) out.multiplyScalar(max / mag);
    torque.add(out.applyQuaternion(q));
  }

  /** Une roue : suspension le long de son axe, rotation, pneu. */
  simWheel(w, o) {
    const P = this.P, b = this.body, dt = o.dt;
    const r = w.radius, I = w.inertia;
    const anchor = this._anchor.copy(o.anchorLocal).applyQuaternion(o.q).add(o.t);
    const dir = this._dir.copy(o.axis).negate();
    const axle = this._axle.copy(o.axis).cross(o.wheelFwd).normalize();
    const castRot = this._cq.setFromUnitVectors(this._unitY, axle);
    const origin = this._origin.copy(anchor).addScaledVector(o.axis, r);
    const hit = this.world.castShape(origin, castRot, dir, w.shape, 0, r + w.travel, true, undefined, GROUPS.wheelRay, undefined, b);
    w.omega += (o.motor / I) * dt;

    let n = null, along = -Infinity, sidewall = false;
    if (hit) {
      n = this._n.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
      if (n.y < 0) n.negate();
      along = n.dot(o.axis);
      sidewall = Math.abs(n.dot(axle)) < SIDEWALL_MAX;
    }
    if (hit && (along > SIDE_SUPPORT_MIN || sidewall)) {
      // Suspension : enfoncement, ressort linéaire, amortisseur, butée en fin de course.
      const ext = hit.time_of_impact - r;
      const x = w.travel - Math.min(ext, w.travel);
      w.x = clamp(x, 0, w.travel);
      w.contact = true;
      const xdot = (x - w.prevX) / dt;
      w.xdot = xdot;
      const spring = P.springMaxForce * Math.min(x / w.travel, 1);
      const over = Math.max(x - w.travel, 0);
      const coef = xdot > 0 ? P.damperBump : P.damperRebound;
      const bottom = over > 0 ? 1 + P.bottomOutDamperGain * (over / w.travel) : 1;
      const dmax = Math.min(P.damperMaxForce, (Math.max(o.staticLoad / G, 1) * Math.abs(xdot)) / dt);
      const damp = clamp(xdot * coef * bottom, -dmax, dmax);
      const Nsusp = Math.max(0, spring + damp + over * P.bumpStopRate);
      w.prevX = x;

      const A = this._A.set(hit.witness1.x, hit.witness1.y, hit.witness1.z);
      const rel = this._rel.copy(A).sub(o.com);
      const pv = b.velocityAtPoint(A);
      const vc = this._vc.set(pv.x, pv.y, pv.z);
      // Contre une face presque verticale (marche, rocher), la suspension ne travaille plus : le pneu bute.
      const support = smoothstep(SIDE_SUPPORT_MIN, SIDE_SUPPORT_FULL, along);
      let Noff = 0;
      if (support < 1 && sidewall) {
        // Juste de quoi annuler la vitesse qui rentre dans l'obstacle, plus un peu pour en ressortir.
        const pen = clamp(-ext, 0, 0.5 * r);
        Noff = (Math.max(0, -vc.dot(n)) + (OFF_AXIS_BETA * pen) / dt) / (dt * Math.max(this.invContactMass(rel, n, o), 1e-6));
      }
      const N = lerp(Noff, Nsusp, support);
      w.load = N;
      // La roue touche, mais ne porte que si la suspension pousse : sinon, elle est en l'air.
      w.grounded = N > 1;
      if (w.grounded) this.contacts++;
      w.point.copy(A);
      w.normal.copy(n);
      b.addForceAtPoint(this._tmp.copy(n).multiplyScalar(N), A, true);

      // Repère du pneu au sol : longitudinal L, latéral S (vers la gauche).
      const L = this._L.copy(axle).cross(n);
      const proj = this._f.copy(o.wheelFwd).addScaledVector(n, -o.wheelFwd.dot(n));
      if (L.lengthSq() < 1e-6) L.copy(proj);
      else if (support > 0) L.normalize().lerp(proj.normalize(), support);
      if (L.lengthSq() < 1e-6) L.copy(o.wheelFwd);
      L.normalize();
      const S = this._S.copy(n).cross(L).normalize();
      const vFwd = vc.dot(L), vSide = vc.dot(S);
      w.vGround = vFwd;

      // Grip : le sol, et la charge (plus une roue est chargée, plus elle accroche).
      const surf = this.track.surfaceAt(A.x, A.z);
      w.surface = surf;
      const loadRatio = lerp(N / o.staticLoad, o.liveLoad / o.staticLoad, P.gripComBias);
      const grip = clamp(1 + P.gripLoadGain * (loadRatio - 1), 1 - P.gripLoadRange, 1 + P.gripLoadRange) * surf.grip * P.gripScale;
      // Si le frein tient la roue au-delà de ce que le pneu peut transmettre, la roue est bloquée : pas de souplesse en rotation.
      const stopTorque = Math.abs((w.omega * I) / dt);
      const extraBrake = Math.max(o.brake - stopTorque, 0);
      const tireTorque = Math.max(P.pacejkaD * N * grip * r, 1e-6);
      // Freinage dosé (mode Normal) : jamais plus que ce que le pneu peut transmettre, la roue continue de tourner.
      if (o.antiLock > 0) o.brake = Math.min(o.brake, lerp(o.brake, 0.85 * tireTorque, o.antiLock));
      const free = clamp(1 - extraBrake / tireTorque, 0, 1);
      const tire = this.tireForce(w, {
        vFwd, vSide, omega: w.omega, radius: r, load: N, grip, sideSlip: o.sideSlip, dt,
        invMassFwd: this.invContactMass(rel, L, o) + (free * r * r) / I,
        invMassSide: this.invContactMass(rel, S, o),
      });
      w.slip = tire.slip;
      b.addForceAtPoint(this._tmp.copy(L).multiplyScalar(tire.fx).addScaledVector(S, tire.fy), A, true);
      w.omega -= ((tire.fx * r) / I) * dt;
      w.sliding = tire.slip > 0.35;
    } else {
      w.contact = false; w.grounded = false; w.x = 0; w.prevX = 0; w.xdot = 0; w.load = 0; w.slip = 0; w.sliding = false;
      w.tread.forward = 0; w.tread.side = 0;
      w.omega *= 1 - Math.min(1, dt * 0.3);
      if (o.antiLock > 0) o.brake *= 1 - o.antiLock;
    }
    // Le frein retient la roue : il peut l'arrêter net (roue bloquée).
    let hold = clamp(w.omega * I, -o.brake * dt, o.brake * dt);
    // Freinage dosé : le pilote garde la roue qui tourne, 15 % de glissement au plus.
    if (o.antiLock > 0 && w.grounded && w.omega > 0 && w.vGround > 0) hold = Math.min(hold, Math.max(0, (w.omega - (0.85 * w.vGround) / r) * I));
    w.omega -= hold / I;
    w.locked = o.brake > 0 && w.grounded && Math.abs(w.omega) < 0.05 && o.speed > 1;
    w.spinAngle = (w.spinAngle + w.omega * dt) % (Math.PI * 2);
    // Position de l'axe de roue (affichage).
    w.center.copy(anchor).addScaledVector(dir, w.travel - w.x);
  }

  /** Masse apparente au point de contact, dans la direction donnée (translation + rotation du corps). */
  invContactMass(rel, dirW, o) {
    const rl = this._c1.copy(rel).applyQuaternion(o.qi);
    const dl = this._c2.copy(dirW).applyQuaternion(o.qi);
    const c = rl.cross(dl);
    const iI = this._invI;
    return o.invMass + c.x * c.x * iI.x + c.y * c.y * iI.y + c.z * c.z * iI.z;
  }

  /** Le pneu : la déformation suit le glissement (longueur de relaxation), la force vient de Pacejka. */
  tireForce(w, c) {
    const P = this.P, out = this._tire, tr = w.tread;
    if (c.load <= 0) { tr.forward = 0; tr.side = 0; out.fx = 0; out.fy = 0; out.slip = 0; return out; }
    const relax = P.relaxationLength;
    const a = Math.max(c.sideSlip, 1e-4);
    const slipLong = c.omega * c.radius - c.vFwd; // la roue tourne plus vite que le sol : elle pousse
    const slipSide = -c.vSide * a;
    const rolled = Math.max(Math.abs(c.omega * c.radius), Math.abs(c.vFwd)) * c.dt;
    const decay = Math.min(rolled / relax, 1);
    let u = tr.forward + (slipLong * c.dt) / relax - decay * tr.forward;
    let s = tr.side + (slipSide * c.dt) / relax - decay * tr.side;
    let mag = Math.hypot(u, s);
    if (mag > 1) { u /= mag; s /= mag; mag = 1; }
    tr.forward = u; tr.side = s;
    if (mag < 1e-9) { out.fx = 0; out.fy = 0; out.slip = 0; return out; }
    const pu = u / mag, ps = s / mag;
    const mf = magicFormula(P, mag);
    let force = mf * c.load * c.grip;
    // Jamais plus que ce qui annulerait le glissement en un pas : le pneu accroche sans trembler, même à l'arrêt.
    const stiffness = P.pacejkaB * P.pacejkaC * P.pacejkaD;
    const deflect = (mf / stiffness) * relax * (pu * pu + (ps * ps) / a);
    const slipVel = slipLong * pu - c.vSide * ps;
    const invM = pu * pu * c.invMassFwd + ps * ps * c.invMassSide;
    const stop = (slipVel + (P.treadBeta * deflect) / c.dt) / (c.dt * Math.max(invM, 1e-9));
    if (force > stop) force = Math.max(stop, 0);
    out.fx = force * pu;
    out.fy = force * ps;
    out.slip = mag;
    return out;
  }

  /** Accroupi (en absorbant, en préparant un saut), debout, ou assis pour pédaler. */
  updateStance(inp, dt) {
    const P = this.P;
    const [wf, wr] = this.wheels;
    const moving = Math.abs(this.body.linvel().x) + Math.abs(this.body.linvel().z) > 0.6;
    const pedaling = this.grounded && inp.pedal > 0.1 && inp.brakeFront + inp.brakeRear < 0.25 && this.hopCharge === 0;
    this.stance += clamp((moving && !pedaling ? 1 : 0) - this.stance, -dt * 2.5, dt * 2.5);
    const comp = Math.max(wf.x / wf.travel, wr.x / wr.travel);
    let target = this.grounded ? clamp((comp - 0.4) * 2, 0, 1) : Math.max(Math.min(0.35, this.airTime * 1.2), this.tuck);
    if (this.hopCharge > 0) target = Math.max(target, READY_CROUCH);
    if (this.hopExtend > 0) target = 0;
    const rate = this.hopExtend > 0 ? 30 : target > this.crouch ? 14 : 4;
    this.crouch += (target - this.crouch) * Math.min(1, dt * rate);
  }

  /** Bunny-hop : maintenir pour se comprimer, relâcher pour sauter. Plus on a chargé, plus on monte. */
  updateHop(inp, U, R, dt) {
    const P = this.P;
    const released = this.hopWasHeld && !inp.hop;
    // Un appui commencé en l'air sert aux figures : il ne déclenche pas de bunny-hop en retombant.
    if (inp.hop && !this.hopWasHeld) this.hopArmed = this.grounded;
    if (inp.hop && this.grounded && this.hopArmed) this.hopCharge = Math.min(1, this.hopCharge + dt / P.hopChargeTime);
    if (released) {
      if (this.grounded && this.hopArmed) {
        const c = Math.max(this.hopCharge, P.hopTapCharge);
        const imp = lerp(P.hopMinImpulse, P.hopMaxImpulse, c);
        this.body.applyImpulse({ x: U.x * imp, y: U.y * imp, z: U.z * imp }, true);
        const pitch = c * (P.hopNosePitch - clamp(inp.weight, -1, 1) * P.hopLeanPitch); // l'avant décolle en premier
        const spin = -c * clamp(inp.steer, -1, 1) * P.hopSpin;
        this.body.applyTorqueImpulse({ x: R.x * pitch + U.x * spin, y: R.y * pitch + U.y * spin, z: R.z * pitch + U.z * spin }, true);
        this.hopExtend = 0.3;
      }
      this.hopCharge = 0;
    }
    this.hopWasHeld = !!inp.hop;
    if (!inp.hop) this.hopArmed = true;
    this.hopExtend = Math.max(0, this.hopExtend - dt);
  }

  /** À appeler après world.step : détecte les chutes. */
  afterStep(dt, riderHit) {
    if (this.crashed) { this.crashed.t += dt; return; }
    const P = this.P;
    const r = this.body.rotation();
    const q = this._q.set(r.x, r.y, r.z, r.w);
    const F = this._F.set(0, 0, -1).applyQuaternion(q);
    const U = this._U.set(0, 1, 0).applyQuaternion(q);
    const t = this.body.translation();
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);

    // Un choc : la vitesse chute de plus de 3 m/s en 25 ms.
    const n = Math.max(1, Math.round(P.crashImpactWindow / dt)) + 1;
    this.impact.push(speed);
    if (this.impact.length > n) this.impact.shift();
    if (this.impact.some((s) => s - speed > P.crashImpactSpeed)) return this.crash(riderHit === 'arbre' ? 'Dans un arbre' : 'Choc');
    if (riderHit) return this.crash(riderHit === 'arbre' ? 'Dans un arbre' : 'Chute');
    // En l'air, toutes les orientations sont permises (figures) : c'est la réception qui juge.
    if (this.contacts > 0) {
      // Couché sur le côté, ou à l'envers.
      if (Math.abs(this.lean) > P.crashLeanDeg * DEG || U.y < -0.25) return this.crash('Chute');
      // Basculer vers l'avant ou vers l'arrière par rapport au sol.
      const nrm = this._tmp.set(0, 0, 0);
      for (const w of this.wheels) if (w.grounded) nrm.add(w.normal);
      nrm.normalize();
      const nose = F.dot(nrm);
      if (nose < -Math.sin(P.crashNoseDownDeg * DEG)) return this.crash('Par-dessus le guidon');
      if (nose > Math.sin(P.crashNoseUpDeg * DEG)) return this.crash('Looping arrière');
    }
    // Immobilisé sans appui sur les roues (couché sur le cadre) : c'est une chute.
    this.stuckTime = this.contacts === 0 && speed < 1 ? this.stuckTime + dt : 0;
    if (this.stuckTime > 1.5) return this.crash('Chute');
    // La roue avant contre un tronc.
    const front = this.wheels[0].center;
    if (this.track.treeNear(front.x, front.z, 0.3)) return this.crash('Dans un arbre');
    if (t.y < -400) return this.crash('Perdu');
  }

  crash(reason) {
    this.crashed = { reason, t: 0 };
  }

  /** Un résumé lisible de l'état, pour l'affichage, la caméra et les tests. */
  state() {
    const b = this.body, t = b.translation(), r = b.rotation(), lv = b.linvel(), av = b.angvel();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const F = new Vector3(0, 0, -1).applyQuaternion(q);
    return {
      angularVelocity: new Vector3(av.x, av.y, av.z),
      position: new Vector3(t.x, t.y, t.z),
      quaternion: q,
      velocity: new Vector3(lv.x, lv.y, lv.z),
      speed: Math.hypot(lv.x, lv.y, lv.z),
      forwardSpeed: lv.x * F.x + lv.y * F.y + lv.z * F.z,
      steer: this.steer,
      lean: this.lean || 0,
      leanTarget: this.leanTarget || 0,
      bank: this.bank,
      contacts: this.contacts,
      airTime: this.airTime,
      wheels: this.wheels,
      hips: this.hips,
      crouch: this.crouch,
      hopCharge: this.hopCharge,
      tuck: this.tuck,
      com: this.comLocal,
      crashed: this.crashed,
      input: this.input,
    };
  }
}
