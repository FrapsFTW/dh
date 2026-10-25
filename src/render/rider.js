// Le pilote : bassin là où la physique met ses hanches (on voit le poids passer devant ou derrière), bras jusqu'aux
// poignées (qui tournent avec le guidon), jambes jusqu'aux pédales, casque intégral et masque. Les articulations sont
// calculées par IK à deux segments. Le même pilote sert au joueur et aux rivaux du peloton, chacun avec sa tenue.
//
// L'animation, au-delà de la physique :
// - le vélo bouge sous le pilote : ses hanches suivent le vélo avec un ressort, les jambes amortissent les réceptions ;
// - en virage, il reste plus droit que le vélo, la tête regarde où il va et garde l'horizon ;
// - en roue libre, pédales à plat, et pied extérieur en bas dans les virages ; en pédalant, le buste se balance ;
// - arrêté (sur la grille, après l'arrivée), il pose le pied gauche par terre ;
// - en l'air, le joueur et les rivaux peuvent coucher le vélo (whip, table) : le vélo tourne autour des hanches, mains
//   et pieds suivent, le haut du corps à moitié.
// Le joueur a en plus les bras détaillés de arms.js (mains refermées sur les poignées) ; ceux d'ici servent le temps
// qu'ils chargent, et aux rivaux.
// Repère : celui du vélo (voir src/sim/geometry.js).

import * as THREE from 'three';
import { GEOMETRY } from '../sim/geometry.js';
import { createDetailedArms } from './arms.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const UP = new THREE.Vector3(0, 1, 0);
const NEUTRAL_HIPS = new THREE.Vector3(0, GEOMETRY.bottomBracket.y + 0.72, GEOMETRY.bottomBracket.z - 0.11);
// Les yeux en vue subjective, pilote au neutre : au-dessus et en retrait du cintre, comme une caméra sur le casque.
const EYE = new THREE.Vector3(0, 1.575, 0.23);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Le whip à fond (st.whip = ±1) : le vélo tourné autour des hanches, en lacet puis couché (rad) ; body : la part de
 * cette rotation que suit le haut du corps (et, en vue subjective, la tête et la caméra).
 */
export const WHIP = { yaw: 0.5, roll: 0.95, body: 0.5 };

export const RIDER = {
  thigh: 0.45, shin: 0.46, upperArm: 0.31, forearm: 0.3, spine: 0.52, neck: 0.12,
  shoulderHalf: 0.19, hipHalf: 0.1,
};

/** La tenue du joueur (celle des bras détaillés de arms.js). */
export const PLAYER_KIT = { jersey: '#b3352b', jersey2: '#1b1d22', pattern: 'epaules', pants: '#2a2f38', helmet: '#f0f0ee', helmet2: '#b3352b', gloves: '#3a3d44', pack: false, lens: '#c8792a' };

/** Place le genou ou le coude : racine A, cible T, longueurs l1 et l2, côté vers lequel il plie (pole). */
export function solveTwoBone(A, T, l1, l2, pole, out) {
  const d = new THREE.Vector3().subVectors(T, A);
  let dist = d.length();
  const maxD = l1 + l2 - 1e-3;
  if (dist > maxD) { d.multiplyScalar(maxD / dist); dist = maxD; }
  const dir = d.clone().normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0).addScaledVector(dir, -dir.y);
  perp.normalize();
  return out.copy(A).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
}

// ---------- Les formes ----------

// Les matières, partagées par tous les pilotes : les couleurs sont dans les sommets.
let MATS = null;
function materials() {
  if (MATS) return MATS;
  MATS = {
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
    shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 }),
    rubber: new THREE.MeshStandardMaterial({ color: lin('#17191d'), roughness: 0.65 }),
    lens: new Map(),
  };
  return MATS;
}
function lensMat(hex) {
  const m = materials().lens;
  if (!m.has(hex)) m.set(hex, new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.12, metalness: 0.85, emissive: lin(hex), emissiveIntensity: 0.08 }));
  return m.get(hex);
}

/** Peint les sommets d'une forme : paint(y, x, z) renvoie la couleur (THREE.Color) du point. */
function paint(geo, fn) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Un membre : tube arrondi aux deux bouts, de longueur len le long de +y, du rayon r0 au rayon r1, avec un galbe
 * (bulge) vers le premier tiers.
 */
function limbGeometry(len, r0, r1, bulge = 0, segs = 12) {
  const pts = [];
  const c0 = r0 * 0.7, c1 = r1 * 0.7;
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; pts.push(new THREE.Vector2(r0 * Math.sin(a), -c0 * Math.cos(a))); }
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t + bulge * Math.sin(Math.PI * Math.min(1, t * 1.6)) ** 2, t * len));
  }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; pts.push(new THREE.Vector2(r1 * Math.cos(a), len + c1 * Math.sin(a))); }
  return new THREE.LatheGeometry(pts, segs);
}

/** Le buste, du bassin (y = 0, les hanches) au cou, aplati d'avant en arrière plus tard. */
function torsoGeometry() {
  const prof = [[-0.13, 0], [-0.115, 0.07], [-0.08, 0.115], [-0.02, 0.13], [0.06, 0.127], [0.15, 0.12], [0.26, 0.133], [0.35, 0.148], [0.43, 0.146], [0.49, 0.125], [0.535, 0.08], [0.555, 0.04], [0.56, 0]];
  return new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 18);
}

// Le dossard : un numéro peint sur une toile.
function numberTexture(num, { bg = '#f6f6f2', fg = '#111', w = 128, h = 96, border = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
  g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.72)}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), w / 2, h * 0.56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * kit : la tenue (voir PLAYER_KIT). number : le dossard (plaque sur le cintre et numéro dans le dos), ou null.
 * stance : le pied devant en roue libre (1 le droit, -1 le gauche). detailedArms : les bras détaillés (joueur).
 */
export function createRider({ detailedArms = false, kit = PLAYER_KIT, number = null, stance = 1 } = {}) {
  const M = materials();
  const K = Object.fromEntries(Object.entries(kit).filter(([, v]) => typeof v === 'string' && v[0] === '#').map(([k, v]) => [k, lin(v)]));
  const pad = lin('#1a1c20'), sole = lin('#101114'), shoeTop = lin('#2c3036');
  const group = new THREE.Group();
  group.name = 'pilote';
  const small = []; // les détails qu'on cache au loin
  const add = (geo, mat, isSmall = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    group.add(m);
    if (isSmall) small.push(m);
    return m;
  };

  // Le buste : maillot, avec son motif, et le haut du short.
  const torsoGeo = paint(torsoGeometry(), (x, y, z) => {
    if (y < 0.035) return K.pants;
    const front = z < 0, a = Math.atan2(x, -z); // 0 devant, ±π dans le dos
    switch (kit.pattern) {
      case 'epaules': return y > 0.4 ? K.jersey2 : K.jersey;
      case 'bandes': return (y > 0.25 && y < 0.31) || (y > 0.34 && y < 0.37) ? K.jersey2 : K.jersey;
      case 'diagonale': return front && Math.abs(a * 0.09 + (y - 0.27)) < 0.045 ? K.jersey2 : K.jersey;
      default: return y > 0.5 || y < 0.07 ? K.jersey2 : K.jersey;
    }
  });
  const torso = add(torsoGeo, M.cloth);
  // Les épaules et le cou.
  const shoulderGeo = paint(new THREE.SphereGeometry(0.06, 12, 10), () => (kit.pattern === 'epaules' ? K.jersey2 : K.jersey));
  const neck = add(paint(limbGeometry(0.1, 0.05, 0.045, 0, 10), () => K.jersey2), M.cloth);
  // Le dos : le numéro, et parfois un sac à dos.
  let backNum = null;
  if (number != null) {
    backNum = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.13), new THREE.MeshStandardMaterial({ map: numberTexture(number), roughness: 0.9 }));
    group.add(backNum);
    small.push(backNum);
  }
  let pack = null;
  if (kit.pack) {
    pack = add(paint(new THREE.CapsuleGeometry(0.1, 0.16, 4, 10), (x, y, z) => (Math.abs(x) > 0.075 ? K.jersey2 : lin('#26292e'))), M.cloth);
    pack.scale.set(1.15, 1, 0.55);
  }

  // Le casque intégral : coque à bande centrale, mentonnière, visière, masque et sa sangle.
  const head = new THREE.Group();
  const shellGeo = paint(new THREE.SphereGeometry(0.15, 22, 16), (x, y, z) => {
    if (Math.abs(x) < 0.028 && y > 0.02) return K.helmet2;
    if (y < -0.02 && z > 0.06 && Math.abs(y + 0.05) < 0.018) return K.helmet2;
    return K.helmet;
  });
  const shell = new THREE.Mesh(shellGeo, M.shell);
  shell.scale.set(0.9, 0.95, 1.16);
  shell.position.z = 0.012;
  shell.castShadow = true;
  // La mentonnière : un arc devant le bas du visage, qui avance nettement.
  const chin = new THREE.Mesh(paint(new THREE.TorusGeometry(0.11, 0.04, 10, 22, Math.PI), (x, y) => (Math.abs(x) < 0.03 && y > 0.09 ? K.helmet2 : K.helmet)), M.shell);
  chin.rotation.set(-Math.PI / 2 - 0.25, 0, 0);
  chin.position.set(0, -0.07, -0.03);
  chin.scale.set(1, 1.25, 1);
  chin.castShadow = true;
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), M.rubber);
  vent.position.set(0, -0.1, -0.185);
  vent.rotation.x = 0.35;
  // La visière, au bord avant de la coque, relevée.
  const peak = new THREE.Mesh(paint(new THREE.BoxGeometry(0.2, 0.01, 0.085), () => K.helmet2), M.shell);
  peak.position.set(0, 0.06, -0.185);
  peak.rotation.x = 0.38;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.058, 20, 1, true, Math.PI - 0.85, 1.7), lensMat(kit.lens || '#3b7bd9'));
  lens.position.set(0, 0.005, 0.0);
  lens.scale.set(0.98, 1, 1.12);
  const strap = new THREE.Mesh(paint(new THREE.TorusGeometry(0.149, 0.009, 6, 28), () => K.jersey2), M.cloth);
  strap.rotation.x = Math.PI / 2;
  strap.position.y = 0.005;
  strap.scale.set(0.95, 1.14, 1);
  head.add(shell, chin, vent, peak, lens, strap);
  small.push(vent, strap);
  group.add(head);

  // Les membres. Les manches longues finissent dans les gants ; genouillères sur les tibias.
  const side = [-1, 1];
  const parts = side.map(() => {
    const upperArm = add(paint(limbGeometry(RIDER.upperArm, 0.056, 0.047, 0.004), (x, y) => (kit.pattern === 'epaules' && y < 0.1 ? K.jersey2 : K.jersey)), M.cloth);
    const forearm = add(paint(limbGeometry(RIDER.forearm, 0.05, 0.04, 0.004), (x, y) => (y > RIDER.forearm - 0.05 ? K.gloves : y > RIDER.forearm - 0.07 ? K.jersey2 : K.jersey)), M.cloth);
    const hand = add(paint(new THREE.CapsuleGeometry(0.036, 0.055, 4, 10), (x, y, z) => (z > 0.02 ? K.gloves : K.gloves.clone().multiplyScalar(0.7))), M.cloth, false);
    const thigh = add(paint(limbGeometry(RIDER.thigh, 0.085, 0.064, 0.008), (x, y) => (y > RIDER.thigh - 0.03 ? K.pants.clone().multiplyScalar(0.75) : K.pants)), M.cloth);
    const shin = add(paint(limbGeometry(RIDER.shin, 0.06, 0.04, 0.012), (x, y) => (y < 0.24 ? pad : K.pants.clone().lerp(pad, 0.5))), M.cloth);
    const kneePad = add(paint(new THREE.SphereGeometry(0.066, 12, 10), () => pad), M.cloth, true);
    kneePad.scale.set(0.95, 1.2, 0.75);
    const shoulderBall = add(shoulderGeo, M.cloth);
    const elbowBall = add(paint(new THREE.SphereGeometry(0.05, 10, 8), () => K.jersey), M.cloth);
    const foot = add(paint(new THREE.CapsuleGeometry(0.045, 0.17, 4, 10), (x, y) => (y < -0.015 ? sole : shoeTop)), M.cloth);
    foot.geometry.rotateX(Math.PI / 2);
    foot.scale.set(1.05, 0.8, 1);
    return { upperArm, forearm, hand, thigh, shin, kneePad, shoulderBall, elbowBall, foot };
  });
  // La plaque de cadre sur le cintre (rivaux) : elle tourne avec le guidon.
  let plate = null;
  if (number != null) {
    plate = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.16), new THREE.MeshStandardMaterial({ map: numberTexture(number, { border: '#1d1f24' }), roughness: 0.6, side: THREE.DoubleSide }));
    group.add(plate);
    small.push(plate);
  }

  // ---------- L'animation ----------
  const v = () => new THREE.Vector3();
  const hips = v(), shoulders = v(), shoulder = v(), hipJ = v(), elbow = v(), knee = v(), hand = v(), foot = v(), headPos = v(), tmp = v(), tmp2 = v();
  const tX = v(), tY = v(), tZ = v(), basis = new THREE.Matrix4(), qTmp = new THREE.Quaternion(), qInv = new THREE.Quaternion();
  const steerAxis = new THREE.Vector3(GEOMETRY.forkAxis.x, GEOMETRY.forkAxis.y, GEOMETRY.forkAxis.z).normalize();
  const pivot = new THREE.Vector3(0, GEOMETRY.steerPivot.y, GEOMETRY.steerPivot.z);
  const grips = side.map((s) => new THREE.Vector3(s * GEOMETRY.grips.halfWidth, GEOMETRY.grips.y, GEOMETRY.grips.z));
  const plateLocal = new THREE.Vector3(0, GEOMETRY.grips.y + 0.075, GEOMETRY.grips.z - 0.045);
  const plateTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3);
  const BB = new THREE.Vector3(0, GEOMETRY.bottomBracket.y, GEOMETRY.bottomBracket.z);
  const arms = detailedArms ? createDetailedArms(group) : null;
  const shoulderMid = v(), worldUp = v(), hipsWorld = v(), hipsVel = v(), want = v();
  let crank = stance > 0 ? 0 : Math.PI, footDown = 0, headYaw = 0, first = true;

  /** Oriente une forme : son +y de a vers b, son +x vers `side` (redressé), et l'étire si besoin à la bonne longueur. */
  const orient = (m, a, b, sideRef, len = 0) => {
    tY.subVectors(b, a);
    const d = tY.length();
    tY.divideScalar(d || 1);
    tX.copy(sideRef).addScaledVector(tY, -sideRef.dot(tY));
    if (tX.lengthSq() < 1e-6) tX.set(1, 0, 0).addScaledVector(tY, -tY.x);
    tX.normalize();
    tZ.crossVectors(tX, tY);
    m.quaternion.setFromRotationMatrix(basis.makeBasis(tX, tY, tZ));
    m.position.copy(a);
    if (len) m.scale.y = Math.max(0.6, d / len);
  };
  const RIGHT = new THREE.Vector3(1, 0, 0), FWD = new THREE.Vector3(0, 0, -1);
  const tq = new THREE.Quaternion(), qBody = new THREE.Quaternion(), sideBody = new THREE.Vector3(), eye0 = new THREE.Vector3();

  const api = {
    group,
    head,
    /** Les yeux, dans le repère du vélo (pour la caméra subjective). */
    eye: new THREE.Vector3(),
    headForward: new THREE.Vector3(0, 0, -1),
    /** 0 à 1 : le pied gauche posé par terre (le vélo s'incline un peu de ce côté : voir bikeModel.js). */
    get footDown() { return footDown; },
    /** Cache les petits détails (au loin). */
    setDetail(full) { for (const m of small) m.visible = full; },
    setShadows(on) { group.traverse((m) => { if (m.isMesh) m.castShadow = on; }); },
    /**
     * st : l'état du vélo (celui de la physique, ou rejoué). style : { q, pivot }, une rotation du vélo seul autour
     * des hanches, en l'air (whip, table), ou null.
     */
    update(st, dt, firstPerson, style = null) {
      const q = st.quaternion, p = st.position;
      const speed = st.speed != null ? st.speed : 0;
      const pedaling = st.input && st.input.pedal > 0 && !st.crashed;
      const xf = (P) => (style ? P.sub(style.pivot).applyQuaternion(style.q).add(style.pivot) : P);
      // Couché en whip, le haut du corps suit à moitié le vélo (il se penche et se tourne avec lui) : sinon la poignée
      // du bas part hors de portée des bras. En vue subjective, la tête aussi (la caméra : voir cameraRig.js).
      if (style) qBody.identity().slerp(style.q, WHIP.body);
      const xfBody = (P) => (style ? P.sub(style.pivot).applyQuaternion(qBody).add(style.pivot) : P);
      qInv.copy(q).invert();
      worldUp.copy(UP).applyQuaternion(qInv);

      // Les pédales : en rond quand on pédale ; sinon à plat, et pied extérieur en bas dans les virages.
      if (pedaling) crank += dt * Math.max(4, Math.abs(st.wheels[1].omega) * 0.45);
      else {
        const turn = st.steer || 0;
        const target = Math.abs(turn) > 0.07 && speed > 3 ? (turn > 0 ? Math.PI / 2 : -Math.PI / 2) : stance > 0 ? 0 : Math.PI;
        crank += wrap(target - crank) * Math.min(1, dt * 5);
      }
      // Arrêté, il pose le pied.
      const stopped = speed < 0.5 && !pedaling && !st.crashed && !firstPerson;
      footDown += ((stopped ? 1 : 0) - footDown) * Math.min(1, dt * 4);

      // Le bassin : les hanches de la physique, que le corps suit avec un ressort (le vélo bouge sous lui).
      want.copy(st.hips);
      if (pedaling) want.x += Math.sin(crank) * 0.02;
      want.x -= footDown * 0.05; want.y -= footDown * 0.06;
      tmp.copy(want).applyQuaternion(q).add(p);
      if (first || dt <= 0 || hipsWorld.distanceToSquared(tmp) > 1) { hipsWorld.copy(tmp); hipsVel.set(0, 0, 0); first = false; }
      else {
        const n = Math.min(20, Math.ceil(dt / 0.008)), h = dt / n, w = 20, z = 0.85;
        for (let i = 0; i < n; i++) {
          tmp2.subVectors(tmp, hipsWorld).multiplyScalar(w * w).addScaledVector(hipsVel, -2 * z * w);
          hipsVel.addScaledVector(tmp2, h);
          hipsWorld.addScaledVector(hipsVel, h);
        }
      }
      hips.copy(hipsWorld).sub(p).applyQuaternion(qInv);
      hips.x = THREE.MathUtils.clamp(hips.x, want.x - 0.05, want.x + 0.05);
      hips.y = THREE.MathUtils.clamp(hips.y, want.y - 0.13, want.y + 0.05);
      hips.z = THREE.MathUtils.clamp(hips.z, want.z - 0.08, want.z + 0.08);

      // Le buste penche vers le cintre ; plus les hanches reculent, plus il s'allonge. En virage, il reste plus droit
      // que le vélo ; en pédalant, il se balance.
      tmp.set(0, GEOMETRY.grips.y + 0.36 - hips.y, GEOMETRY.grips.z + 0.06 - hips.z).normalize();
      shoulders.copy(hips).addScaledVector(tmp, RIDER.spine);
      shoulders.x += worldUp.x * RIDER.spine * 0.45 + (pedaling ? Math.sin(crank) * 0.04 : 0);
      tmp.subVectors(shoulders, hips).normalize();
      shoulders.copy(hips).addScaledVector(tmp, RIDER.spine);
      xfBody(shoulders);
      orient(torso, hips, shoulders, style ? sideBody.copy(RIGHT).applyQuaternion(qBody) : RIGHT);
      torso.scale.set(1.18, 1, 0.78);
      const bX = tX.clone(), bY = tY.clone(), bZ = tZ.clone(); // le repère du buste
      if (backNum) { backNum.position.copy(hips).addScaledVector(bY, 0.33).addScaledVector(bZ, 0.118 + (pack ? 0.06 : 0)); backNum.quaternion.copy(torso.quaternion); if (pack) backNum.position.addScaledVector(bY, -0.17); }
      if (pack) { pack.position.copy(hips).addScaledVector(bY, 0.3).addScaledVector(bZ, 0.12); pack.quaternion.copy(torso.quaternion); }

      // La tête : au-dessus des épaules, un peu en avant ; elle regarde où il va et garde l'horizon.
      headPos.copy(shoulders).addScaledVector(bY, RIDER.neck * 0.6).add(tmp2.set(0, 0.08, -0.07));
      orient(neck, tmp.copy(shoulders).addScaledVector(bY, -0.02), headPos, RIGHT);
      head.position.copy(headPos);
      headYaw += (THREE.MathUtils.clamp((st.steer || 0) * 1.6, -0.6, 0.6) - headYaw) * Math.min(1, dt * 6);
      tY.copy(UP).lerp(worldUp, 0.7).normalize();
      tZ.set(-Math.sin(headYaw), 0.22, Math.cos(headYaw)); // l'arrière de la tête (on regarde vers -z, un peu en bas)
      tZ.addScaledVector(tY, -tZ.dot(tY)).normalize();
      tX.crossVectors(tY, tZ);
      head.quaternion.setFromRotationMatrix(basis.makeBasis(tX, tY, tZ));
      // La caméra subjective : en retrait du cintre, comme une caméra embarquée (on voit le cintre et les gants),
      // et elle suit les déplacements du poids du pilote (ceux de la physique, sans le ressort : la caméra a le sien).
      eye0.set(0, EYE.y + (st.hips.y - NEUTRAL_HIPS.y) * 0.8, EYE.z + (st.hips.z - NEUTRAL_HIPS.z) * 0.9);
      xfBody(this.eye.copy(eye0));

      // Le guidon tourne autour de l'axe de direction : les poignées aussi.
      qTmp.setFromAxisAngle(steerAxis, -(st.steer || 0));
      if (plate) {
        plate.position.copy(plateLocal).sub(pivot).applyQuaternion(qTmp).add(pivot);
        xf(plate.position);
        plate.quaternion.copy(qTmp).multiply(plateTilt);
        if (style) plate.quaternion.premultiply(style.q);
      }

      side.forEach((s, i) => {
        const P = parts[i];
        // Les bras. En vue subjective, les épaules sont sous la caméra : les bras partent des coins bas de l'image.
        if (firstPerson) xfBody(shoulder.copy(eye0).add(tmp2.set(s * 0.21, -0.3, 0.06)));
        else shoulder.copy(shoulders).addScaledVector(bX, s * RIDER.shoulderHalf).addScaledVector(bY, -0.04);
        hand.copy(grips[i]).sub(pivot).applyQuaternion(qTmp).add(pivot);
        xf(hand);
        tmp2.set(s * 0.55, -0.5, 0.45);
        if (style) tmp2.applyQuaternion(qBody);
        solveTwoBone(shoulder, hand, RIDER.upperArm, RIDER.forearm, tmp2, elbow);
        tmp.set(s, 0, 0);
        orient(P.upperArm, shoulder, elbow, tmp, RIDER.upperArm);
        orient(P.forearm, elbow, hand, tmp, RIDER.forearm);
        P.shoulderBall.position.copy(shoulder);
        P.elbowBall.position.copy(elbow);
        P.hand.position.copy(hand).add(tmp2.set(0, 0.008, 0));
        P.hand.quaternion.copy(qTmp).multiply(tq.setFromAxisAngle(FWD, Math.PI / 2));
        if (style) P.hand.quaternion.premultiply(style.q);

        // Les jambes : un pied sur chaque pédale (ou le gauche par terre).
        const a = crank + (s > 0 ? 0 : Math.PI);
        foot.set(s * 0.13, BB.y + Math.sin(a) * 0.17 + 0.04, BB.z - Math.cos(a) * 0.17);
        xf(foot);
        if (s < 0 && footDown > 0.001) foot.lerp(tmp.set(-0.4, 0.05, BB.z + 0.02), footDown);
        hipJ.copy(hips).addScaledVector(bX, s * RIDER.hipHalf).addScaledVector(bY, -0.04);
        solveTwoBone(hipJ, foot, RIDER.thigh, RIDER.shin, tmp2.set(s * 0.25, 0.3, -1), knee);
        tmp.set(1, 0, 0);
        orient(P.thigh, hipJ, knee, tmp, RIDER.thigh);
        orient(P.shin, knee, foot, tmp, RIDER.shin);
        // La genouillère, devant le genou.
        P.kneePad.quaternion.copy(P.shin.quaternion);
        P.kneePad.position.copy(knee).addScaledVector(tZ, -0.035).addScaledVector(tY, 0.07);
        P.foot.position.copy(foot).add(tmp.set(0, -0.012, -0.035));
        P.foot.quaternion.set(0, 0, 0, 1);
        if (style) P.foot.quaternion.copy(style.q);
      });
      // En vue subjective, on ne voit que les bras et les jambes (la caméra est dans le casque).
      const body = !firstPerson;
      head.visible = torso.visible = neck.visible = body;
      if (pack) pack.visible = body;
      if (backNum) backNum.visible = body;
      for (const P of parts) P.shoulderBall.visible = body;
      if (arms && arms.loaded) {
        // Les épaules : sous la caméra en vue subjective (les bras partent des coins bas de l'image), sinon sur le buste.
        if (firstPerson) xfBody(shoulderMid.copy(eye0).add(tmp.set(0, -0.3, 0.06)));
        else shoulderMid.copy(shoulders).addScaledVector(bY, -0.04);
        arms.update(shoulderMid, qTmp, style, style ? qBody : null);
        for (const P of parts) P.upperArm.visible = P.forearm.visible = P.hand.visible = P.elbowBall.visible = P.shoulderBall.visible = false;
      }
    },
  };
  return api;
}
