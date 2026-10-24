// Les autres joueurs d'un salon en ligne, à l'écran. Chacun envoie sa pose (le même échantillon que le peloton, voir
// src/sim/peloton.js) une quinzaine de fois par seconde, datée à l'heure du serveur ; on les affiche avec un léger
// retard (DELAY), entre deux poses reçues : le mouvement reste fluide malgré le réseau.
// De près : vélo allégé, pilote complet, ombre ; au loin, vélo en formes simples. Leur nom flotte au-dessus d'eux.

import * as THREE from 'three';
import { createBikeModel } from './bikeModel.js';
import { tagSprite } from './peloton.js';
import { POSE, POSE_SIZE, FLAG } from '../sim/peloton.js';
import { KITS } from '../net/online.js';

/** Le retard d'affichage (ms) : un peu plus de deux poses. */
export const DELAY = 160;
const NEAR = 40, FAR = 600, SHADOW = 28, TAG = 160;
const KEEP = 3000; // les poses gardées (ms)
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/**
 * Le whip (st.whip, de -1 à 1) : le vélo couché sur le côté en l'air, tourné seul autour des hanches, vers le côté où
 * l'on pousse le stick. Renvoie le style que prend bikeModel.update (dans out), ou null s'il est droit.
 */
const qRoll = new THREE.Quaternion();
export function whipStyle(st, out) {
  const w = st.whip || 0;
  if (Math.abs(w) < 0.01) return null;
  out.q.setFromAxisAngle(Y, -0.5 * w).multiply(qRoll.setFromAxisAngle(Z, -0.95 * w));
  out.pivot.copy(st.hips);
  return out;
}

export function createRemoteRiders(scene) {
  const riders = new Map();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), camPos = new THREE.Vector3(), chest = new THREE.Vector3();

  function build(p, num) {
    const kit = KITS[p.color] || KITS[0];
    const rider = { name: p.name, num, kit };
    const model = createBikeModel({ lod: true, kit, number: num, stance: num % 2 ? 1 : -1 });
    scene.add(model.group);
    const tag = tagSprite(rider, p.name.toUpperCase());
    scene.add(tag);
    const state = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), steer: 0, lean: 0, crashed: null, speed: 0, contacts: 2,
      input: { pedal: 0 }, hips: new THREE.Vector3(0, 1.07, 0.08), crouch: 0,
      wheels: [{ x: 0, spinAngle: 0, contact: true, omega: 0 }, { x: 0, spinAngle: 0, contact: true, omega: 0 }],
    };
    return { id: p.id, style: { q: new THREE.Quaternion(), pivot: new THREE.Vector3() }, key: `${p.name}|${p.color}|${num}`, rider, model, tag, state, buf: [], hist: [], near: true, shadows: true, seen: false };
  }
  function drop(R) { scene.remove(R.model.group); scene.remove(R.tag); R.tag.material.map.dispose(); R.tag.material.dispose(); }

  // La pose au temps t (heure du serveur, ms) : entre les deux poses reçues qui l'encadrent.
  function pose(R, t) {
    const b = R.buf;
    if (!b.length) return false;
    let i = b.length - 1;
    while (i > 0 && b[i].at > t) i--;
    const A = b[i], B = b[Math.min(i + 1, b.length - 1)];
    const u = B.at > A.at ? Math.max(0, Math.min(1, (t - A.at) / (B.at - A.at))) : 0;
    const L = (k) => A.p[k] + (B.p[k] - A.p[k]) * u;
    const st = R.state;
    st.position.set(L(0), L(1), L(2));
    qa.set(A.p[POSE.qx], A.p[POSE.qy], A.p[POSE.qz], A.p[POSE.qw]).normalize();
    qb.set(B.p[POSE.qx], B.p[POSE.qy], B.p[POSE.qz], B.p[POSE.qw]).normalize();
    st.quaternion.slerpQuaternions(qa, qb, u);
    st.steer = L(POSE.steer); st.lean = L(POSE.lean); st.crouch = L(POSE.crouch);
    st.wheels[0].x = L(POSE.suspF); st.wheels[1].x = L(POSE.suspR);
    st.wheels[0].omega = L(POSE.omegaF); st.wheels[1].omega = L(POSE.omegaR);
    st.hips.set(L(POSE.hipsX), L(POSE.hipsY), L(POSE.hipsZ));
    const flags = (u < 0.5 ? A : B).p[POSE.flags];
    st.contacts = flags & FLAG.contacts;
    st.wheels[0].contact = st.wheels[1].contact = st.contacts > 0;
    st.input.pedal = flags & FLAG.pedal ? 1 : 0;
    const dtAB = (B.at - A.at) / 1000;
    st.speed = dtAB > 0 ? Math.hypot(B.p[0] - A.p[0], B.p[2] - A.p[2]) / dtAB : 0;
    st.s = L(POSE.s);
    st.whip = A.p.length > POSE_SIZE && B.p.length > POSE_SIZE ? L(POSE_SIZE) : 0; // (envoyé après la pose)
    return true;
  }

  return {
    riders,
    /** Les joueurs du salon (sauf soi) : on ajoute les nouveaux, on retire les partis, on rhabille ceux qui ont changé. */
    sync(players, you) {
      const want = new Map();
      players.forEach((p, i) => { if (p.id !== you) want.set(p.id, { p, num: i + 1 }); });
      for (const [id, R] of riders) if (!want.has(id)) { drop(R); riders.delete(id); }
      for (const [id, { p, num }] of want) {
        const R = riders.get(id);
        if (R && R.key === `${p.name}|${p.color}|${num}`) continue;
        const N = build(p, num);
        if (R) { N.buf = R.buf; N.hist = R.hist; drop(R); }
        riders.set(id, N);
      }
    },
    /** Une pose reçue (rt : son temps de course, s'il est en course). */
    push(id, at, p, rt) {
      const R = riders.get(id);
      if (!R) return;
      if (R.buf.length && at <= R.buf[R.buf.length - 1].at) return; // (arrivée dans le désordre)
      R.buf.push({ at, p });
      while (R.buf.length > 2 && R.buf[1].at < at - KEEP) R.buf.shift();
      // (les écarts se comptent en temps de course : sur un ordinateur qui rame, la simulation prend du retard sur l'horloge)
      if (Number.isFinite(rt) && rt > 0) R.hist.push(rt, p[POSE.s]);
      R.finished = !!(p[POSE.flags] & FLAG.finished);
    },
    /** Une nouvelle course : on oublie où chacun est passé. */
    resetRace() { for (const R of riders.values()) R.hist.length = 0; },
    /** La distance parcourue par un joueur (sa dernière pose), ou null. */
    sOf(id) { const R = riders.get(id); return R && R.buf.length ? R.buf[R.buf.length - 1].p[POSE.s] : null; },
    /** Le temps de course d'un joueur quand il est passé à la distance s, ou Infinity s'il n'y est pas encore. */
    timeAt(id, s) {
      const R = riders.get(id);
      if (!R) return Infinity;
      const h = R.hist, n = h.length / 2;
      if (!n || h[(n - 1) * 2 + 1] < s) return Infinity;
      let lo = 0, hi = n - 1;
      if (h[1] >= s) return h[0];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h[m * 2 + 1] < s) lo = m; else hi = m; }
      const a = h[lo * 2 + 1], b = h[hi * 2 + 1];
      return h[lo * 2] + (b > a ? (s - a) / (b - a) : 0) * (h[hi * 2] - h[lo * 2]);
    },
    /** t : l'heure du serveur (ms), déjà retardée de DELAY. */
    update(t, dt, camera) {
      camera.getWorldPosition(camPos);
      for (const R of riders.values()) {
        const st = R.state;
        // Rien reçu depuis un moment (déconnecté, ou pas encore sur la piste) : on ne l'affiche pas.
        const fresh = R.buf.length && t - R.buf[R.buf.length - 1].at < 4000 && pose(R, t);
        const dist = fresh ? camPos.distanceTo(st.position) : Infinity;
        const inside = fresh && camPos.distanceTo(chest.copy(Y).applyQuaternion(st.quaternion).multiplyScalar(1.25).add(st.position)) < 0.75;
        const show = dist < FAR && !inside;
        R.model.group.visible = show;
        R.tag.visible = show && dist > 3 && dist < TAG;
        if (!show) continue;
        for (const w of st.wheels) w.spinAngle = (w.spinAngle + w.omega * dt) % (Math.PI * 2);
        const near = dist < NEAR;
        if (near !== R.near) { R.near = near; R.model.setNear(near); }
        const shadows = dist < SHADOW;
        if (shadows !== R.shadows) { R.shadows = shadows; R.model.group.traverse((m) => { if (m.isMesh) m.castShadow = shadows; }); }
        R.model.update(st, dt, false, whipStyle(st, R.style));
        if (R.tag.visible) {
          R.tag.position.copy(st.position).addScaledVector(Y, 1.95);
          const k = THREE.MathUtils.clamp(dist * 0.05, 0.4, 3.2);
          R.tag.scale.set(k, k * 0.22, 1);
          R.tag.material.opacity = 1 - THREE.MathUtils.smoothstep(dist, TAG * 0.75, TAG);
        }
      }
    },
  };
}
