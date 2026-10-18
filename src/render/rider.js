// Le pilote, fait de formes simples mais articulé : bassin là où la physique met ses hanches (on voit le poids
// passer devant ou derrière), bras jusqu'aux poignées (qui tournent avec le guidon), jambes jusqu'aux pédales,
// casque intégral. Les articulations sont calculées par IK à deux segments.
// Repère : celui du vélo (voir src/sim/geometry.js).

import * as THREE from 'three';
import { GEOMETRY } from '../sim/geometry.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const UP = new THREE.Vector3(0, 1, 0);
const NEUTRAL_HIPS = new THREE.Vector3(0, GEOMETRY.bottomBracket.y + 0.72, GEOMETRY.bottomBracket.z - 0.11);

export const RIDER = {
  thigh: 0.45, shin: 0.46, upperArm: 0.31, forearm: 0.3, spine: 0.52, neck: 0.12,
  shoulderHalf: 0.19, hipHalf: 0.1,
};

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

export function createRider() {
  const group = new THREE.Group();
  group.name = 'pilote';
  const jersey = new THREE.MeshStandardMaterial({ color: lin('#b3352b'), roughness: 0.85 });
  const jerseyDark = new THREE.MeshStandardMaterial({ color: lin('#222831'), roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: lin('#2a2f38'), roughness: 0.85 });
  const glove = new THREE.MeshStandardMaterial({ color: lin('#1e1f22'), roughness: 0.7 });
  const gloveAccent = new THREE.MeshStandardMaterial({ color: lin('#d63a2a'), roughness: 0.6 });
  const shoe = new THREE.MeshStandardMaterial({ color: lin('#30343a'), roughness: 0.7 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: lin('#f0f0ee'), roughness: 0.35, metalness: 0.05 });
  const visorMat = new THREE.MeshStandardMaterial({ color: lin('#15171a'), roughness: 0.2, metalness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: lin('#1a1c20'), roughness: 0.6 });

  // Un segment de membre : capsule de longueur 1, étirée entre deux points à chaque image.
  const limb = (r, mat, r2 = r) => {
    const g = new THREE.CylinderGeometry(r2, r, 1, 10, 1);
    g.translate(0, 0.5, 0);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const ball = (r, mat) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat); m.castShadow = true; group.add(m); return m; };
  const place = (m, a, b) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    m.scale.set(1, Math.max(len, 1e-3), 1);
  };

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 4, 12), jersey);
  torso.scale.set(1.15, 1, 0.8);
  torso.castShadow = true;
  group.add(torso);
  const pelvis = ball(0.15, pants);
  pelvis.scale.set(1.15, 0.8, 0.9);
  const neck = limb(0.055, jerseyDark);
  // Le casque intégral : la coque, la mentonnière, la visière, le masque.
  const head = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), helmetMat);
  shell.scale.set(0.95, 1, 1.12);
  shell.castShadow = true;
  const chin = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.04, 8, 16, Math.PI), helmetMat);
  chin.rotation.set(Math.PI / 2 + 0.3, 0, 0);
  chin.position.set(0, -0.08, -0.06);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.1), helmetMat);
  peak.position.set(0, 0.09, -0.17);
  peak.rotation.x = 0.25;
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.04), visorMat);
  goggles.position.set(0, 0.0, -0.155);
  head.add(shell, chin, peak, goggles);
  group.add(head);

  const side = [-1, 1];
  const parts = side.map(() => ({
    upperArm: limb(0.05, jersey, 0.045), forearm: limb(0.04, jersey, 0.034),
    hand: ball(0.042, glove), cuff: limb(0.04, gloveAccent),
    thigh: limb(0.085, pants, 0.07), shin: limb(0.06, pants, 0.052),
    knee: ball(0.07, pad), foot: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.27), shoe),
  }));
  for (const p of parts) { p.foot.castShadow = true; group.add(p.foot); p.hand.scale.set(1, 0.8, 1.3); }

  const v = () => new THREE.Vector3();
  const hips = v(), shoulders = v(), shoulder = v(), hipJ = v(), elbow = v(), knee = v(), hand = v(), foot = v(), headPos = v(), tmp = v(), tmp2 = v();
  const torsoDir = v(), qTmp = new THREE.Quaternion();
  const steerAxis = new THREE.Vector3(GEOMETRY.forkAxis.x, GEOMETRY.forkAxis.y, GEOMETRY.forkAxis.z).normalize();
  const pivot = new THREE.Vector3(0, GEOMETRY.steerPivot.y, GEOMETRY.steerPivot.z);
  const grips = side.map((s) => new THREE.Vector3(s * GEOMETRY.grips.halfWidth, GEOMETRY.grips.y, GEOMETRY.grips.z));
  const BB = new THREE.Vector3(0, GEOMETRY.bottomBracket.y, GEOMETRY.bottomBracket.z);
  let crank = 0;

  return {
    group,
    head,
    /** Les yeux, dans le repère du vélo (pour la caméra subjective). */
    eye: new THREE.Vector3(),
    headForward: new THREE.Vector3(0, 0, -1),
    update(st, dt, firstPerson) {
      // Le bassin : la position des hanches calculée par la physique.
      hips.copy(st.hips);
      // Le buste penche vers le cintre ; plus les hanches reculent, plus il s'allonge.
      const gripCenter = tmp.set(0, GEOMETRY.grips.y, GEOMETRY.grips.z);
      torsoDir.set(0, gripCenter.y + 0.36 - hips.y, gripCenter.z + 0.06 - hips.z).normalize();
      shoulders.copy(hips).addScaledVector(torsoDir, RIDER.spine);
      torso.position.copy(hips).addScaledVector(torsoDir, RIDER.spine * 0.5);
      torso.quaternion.setFromUnitVectors(UP, torsoDir);
      pelvis.position.copy(hips);
      pelvis.quaternion.copy(torso.quaternion);
      // La tête regarde devant : au-dessus des épaules, un peu en avant.
      headPos.copy(shoulders).add(tmp2.set(0, RIDER.neck + 0.08, -0.07));
      place(neck, shoulders, headPos);
      head.position.copy(headPos);
      head.rotation.set(0.15, 0, 0);
      // La caméra subjective : en retrait du cintre, comme une caméra embarquée (on voit le cintre et les gants),
      // et elle suit les déplacements du poids du pilote.
      this.eye.set(0, GEOMETRY.grips.y + 0.5 + (hips.y - NEUTRAL_HIPS.y) * 0.8, GEOMETRY.grips.z + 0.46 + (hips.z - NEUTRAL_HIPS.z) * 0.9);

      // Le guidon tourne autour de l'axe de direction : les poignées aussi.
      qTmp.setFromAxisAngle(steerAxis, -st.steer);
      // Les pédales : à plat pour descendre, en rond quand on pédale.
      const pedaling = st.input && st.input.pedal > 0 && !st.crashed;
      if (pedaling) crank += dt * Math.max(4, Math.abs(st.wheels[1].omega) * 0.45);
      else crank += (Math.round(crank / Math.PI) * Math.PI - crank) * Math.min(1, dt * 4);

      side.forEach((s, i) => {
        const P = parts[i];
        // Les bras.
        // En vue subjective, les épaules sont sous la caméra : les bras partent des coins bas de l'image.
        if (firstPerson) shoulder.copy(this.eye).add(tmp2.set(s * 0.21, -0.3, 0.06));
        else shoulder.copy(shoulders).add(tmp2.set(s * RIDER.shoulderHalf, -0.03, 0));
        hand.copy(grips[i]).sub(pivot).applyQuaternion(qTmp).add(pivot);
        solveTwoBone(shoulder, hand, RIDER.upperArm, RIDER.forearm, tmp2.set(s * 0.9, -0.2, 0.25), elbow);
        place(P.upperArm, shoulder, elbow);
        place(P.forearm, elbow, hand);
        place(P.cuff, tmp.copy(hand).lerp(elbow, 0.28), tmp2.copy(hand).lerp(elbow, 0.12));
        P.hand.position.copy(hand).add(tmp.set(0, 0.012, 0));
        P.hand.quaternion.copy(qTmp);
        // Les jambes : un pied sur chaque pédale.
        const a = crank + (s > 0 ? 0 : Math.PI);
        foot.set(s * 0.13, BB.y + Math.sin(a) * 0.17 + 0.04, BB.z - Math.cos(a) * 0.17);
        hipJ.copy(hips).add(tmp.set(s * RIDER.hipHalf, -0.04, 0));
        solveTwoBone(hipJ, foot, RIDER.thigh, RIDER.shin, tmp2.set(s * 0.25, 0.3, -1), knee);
        place(P.thigh, hipJ, knee);
        place(P.shin, knee, foot);
        P.knee.position.copy(knee);
        P.foot.position.copy(foot).add(tmp.set(0, -0.01, -0.03));
      });
      // En vue subjective, on ne voit que les bras et les jambes (la caméra est dans le casque).
      head.visible = torso.visible = neck.visible = pelvis.visible = !firstPerson;
    },
  };
}
