// Les caméras : la vue subjective (dans le casque du pilote) et une vue extérieure.
// En vue subjective, la tête du pilote garde l'horizon plus stable que le vélo et regarde vers la sortie des
// virages, comme un vrai pilote ; elle suit aussi les déplacements de son poids. Les bras et les jambes amortissent :
// la tête ne recopie pas chaque coup que prend le cadre (réceptions, rollers, pierriers). Pendant une figure, elle tourne
// avec le vélo (on voit le monde basculer, comme avec une caméra sur le casque).

import * as THREE from 'three';
import { WHIP } from './rider.js';

export const CAMERA_SETTINGS = {
  fov: 76, // champ de vision vertical à l'arrêt (degrés)
  fovSpeed: 16, // degrés ajoutés à pleine vitesse (vers 65 km/h) : la sensation de vitesse
  rollFollow: 0.35, // part de l'inclinaison du vélo que suit la tête (0 = horizon fixe, 1 = collée au vélo)
  pitchFollow: 0.55, // part du tangage du vélo que suit la tête
  lookDown: 9, // le regard porte un peu vers le bas, vers la trajectoire (degrés)
  lookAhead: 0.6, // la tête se tourne vers la sortie du virage
  shake: 0.3, // secousses (0 = aucune) : à baisser si on a le mal des transports
  buzz: 0.4, // vibration rapide à haute vitesse, plus forte dans les cailloux et les racines (0 = aucune)
  stabilize: 0.7, // la tête amortit les mouvements du cadre (0 = caméra soudée au vélo, 1 = très amortie)
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerp = THREE.MathUtils.lerp;

export function createCameraRig(camera, bikeModel, sim) {
  const S = CAMERA_SETTINGS;
  let mode = 'fp';
  let first = true, t = 0, shakeLevel = 0;
  let yaw = 0, pitch = 0, roll = 0, lookYaw = 0, lookPitch = 0;
  const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
  const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const smoothPos = new THREE.Vector3(), headOff = new THREE.Vector3();
  const qBike = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3();
  let flipBlend = 0, fovNow = CAMERA_SETTINGS.fov;

  return {
    get mode() { return mode; },
    toggle() { mode = mode === 'fp' ? 'chase' : 'fp'; first = true; },
    setMode(m) { mode = m; first = true; },
    reset() { first = true; },
    /** look : regard libre (stick droit), en [-1, 1]. */
    update(state, dt, look = { x: 0, y: 0 }) {
      t += dt;
      const speed = state.speed;
      const q = state.quaternion;
      fwd.set(0, 0, -1).applyQuaternion(q);
      const bikeYaw = Math.atan2(-fwd.x, -fwd.z);
      const bikePitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      if (mode === 'fp') {
        // Où regarde le pilote : vers la piste, un peu plus loin.
        const race = sim.race, track = sim.track;
        const ahead = track.sample(race.s + Math.max(7, speed * 0.85));
        const dx = ahead.x - state.position.x, dz = ahead.z - state.position.z;
        const trailYaw = Math.atan2(-dx, -dz);
        const crashed = !!state.crashed;
        const into = crashed ? 0 : THREE.MathUtils.clamp(wrap(trailYaw - bikeYaw), -0.5, 0.5) * S.lookAhead;
        // Regard libre : il revient doucement quand on lâche le stick.
        // (Un lacet positif tourne la tête vers la gauche : stick à droite, lacet négatif.)
        lookYaw += (-look.x * 1.2 - lookYaw) * Math.min(1, dt * (Math.abs(look.x) > 0.05 ? 6 : 2.5));
        lookPitch += (-look.y * 0.6 - lookPitch) * Math.min(1, dt * (Math.abs(look.y) > 0.05 ? 6 : 2.5));
        // En whip, la tête suit le haut du corps, qui suit à moitié le vélo couché (voir rider.js).
        const whip = (state.whip || 0) * WHIP.body;
        const wantYaw = bikeYaw + into + lookYaw - WHIP.yaw * whip;
        const wantPitch = bikePitch * S.pitchFollow - (S.lookDown * Math.PI) / 180 + lookPitch;
        const wantRoll = -state.lean * S.rollFollow - WHIP.roll * whip;
        if (first) { yaw = wantYaw; pitch = wantPitch; roll = wantRoll; }
        // La tête suit le vélo avec du retard, d'autant plus que le cou amortit (le tangage surtout : c'est lui qui
        // secoue le plus aux réceptions).
        const stab = S.stabilize;
        yaw += wrap(wantYaw - yaw) * (1 - Math.exp(-dt * lerp(14, 8, stab)));
        pitch += (wantPitch - pitch) * (1 - Math.exp(-dt * lerp(14, 4, stab)));
        roll += (wantRoll - roll) * (1 - Math.exp(-dt * lerp(10, 5, stab)));

        // Les secousses viennent de la suspension qui travaille.
        const [wf, wr] = state.wheels;
        const hit = Math.min(1, (Math.abs(wf.xdot) + Math.abs(wr.xdot)) * 0.14);
        shakeLevel = Math.max(hit, shakeLevel - dt * 6);
        const a = S.shake * shakeLevel * 0.014;
        // À haute vitesse, le cintre et le casque vibrent : une vibration rapide et irrégulière, comme sur une caméra
        // embarquée. Plus forte sur les cailloux et les racines, presque rien en l'air. Les fréquences restent sous
        // celle des images (au-delà, chaque image tomberait au hasard : la vue sauterait au lieu de vibrer).
        const surf = (wf.surface || wr.surface || {}).name;
        const rough = surf === 'cailloux' ? 1.9 : surf === 'racines' ? 1.5 : surf === 'gravier' ? 1.3 : surf === 'herbe' ? 0.8 : surf === 'roche' ? 0.7 : 1;
        const bz = S.buzz * THREE.MathUtils.smoothstep(speed * 3.6, 25, 70) * rough * (state.contacts > 0 ? 1 : 0.15) * 0.003;
        const n1 = Math.sin(t * 71) + 0.6 * Math.sin(t * 103 + 1.3) + 0.3 * Math.sin(t * 47 + 0.4);
        const n2 = Math.sin(t * 83 + 2.1) + 0.5 * Math.sin(t * 59);
        euler.set(pitch + Math.sin(t * 29) * a + n1 * bz, yaw + Math.sin(t * 23 + 1) * a * 0.4 + n2 * bz * 0.4, roll + Math.sin(t * 26 + 2) * a * 0.3 + n2 * bz * 0.5);
        camera.quaternion.setFromEuler(euler);
        // En figure (vélo renversé ou qui tourne vite en l'air), la tête suit le vélo.
        up.set(0, 1, 0).applyQuaternion(q);
        // Une figure, c'est le vélo qui tourne par rapport à sa trajectoire : pas le nez qui plonge avec elle vers une
        // réception raide (la tête qui suivrait alors le vélo d'un coup secouerait toute la vue).
        const v = state.velocity, vl = v.length();
        const offPath = vl > 2 ? fwd.dot(v) / vl < 0.57 : up.y < 0.5;
        const tricking = !crashed && state.airTime > 0.12 && (offPath || state.angularVelocity.length() > 4.5);
        flipBlend += ((tricking ? 1 : 0) - flipBlend) * Math.min(1, dt * (tricking ? 8 : 3));
        if (flipBlend > 0.002) {
          qBike.copy(q).multiply(qTilt.setFromAxisAngle(X, -(S.lookDown * Math.PI) / 180));
          camera.quaternion.slerp(qBike, flipBlend);
        }

        // Les yeux : dans le casque du pilote.
        eye.copy(bikeModel.eye).applyQuaternion(q).add(state.position);
        // La tête avance avec le vélo, sans retard, mais elle amortit les à-coups du cadre : son balancement d'avant en
        // arrière quand il tangue, et ses sauts verticaux sur les cailloux (au plus 20 cm d'écart).
        tmp.subVectors(eye, state.position);
        if (first) { smoothPos.copy(eye); headOff.copy(tmp); }
        else smoothPos.addScaledVector(state.velocity, dt);
        const kh = 1 - Math.exp(-dt * lerp(40, 10, stab)), kv = 1 - Math.exp(-dt * lerp(40, 9, stab));
        headOff.x += (tmp.x - headOff.x) * kh;
        headOff.z += (tmp.z - headOff.z) * kh;
        smoothPos.x = state.position.x + headOff.x;
        smoothPos.z = state.position.z + headOff.z;
        smoothPos.y += (eye.y - smoothPos.y) * kv;
        smoothPos.y = THREE.MathUtils.clamp(smoothPos.y, eye.y - 0.2, eye.y + 0.2);
        camera.position.copy(smoothPos);
        // Le champ s'ouvre avec la vitesse, en douceur (pas de saut sur une bosse).
        const fov = S.fov + S.fovSpeed * THREE.MathUtils.smoothstep(speed * 3.6, 12, 65);
        fovNow += (fov - fovNow) * Math.min(1, dt * 2.5);
        if (first) fovNow = fov;
        if (Math.abs(camera.fov - fovNow) > 0.01) camera.fov = fovNow;
        camera.near = 0.05;
      } else {
        // Vue extérieure : derrière et au-dessus, lissée. Elle suit la direction du déplacement (pas celle du vélo,
        // qui tourne pendant un 360 ou se renverse pendant un backflip).
        const v = state.velocity;
        if (Math.hypot(v.x, v.z) > 3) tmp.set(v.x, 0, v.z);
        else tmp.set(fwd.x, 0, fwd.z);
        if (tmp.lengthSq() < 1e-4) tmp.set(0, 0, -1);
        tmp.normalize();
        const want = state.position.clone().addScaledVector(tmp, -4.6).add(new THREE.Vector3(0, 2.3, 0));
        const lookAt = state.position.clone().addScaledVector(tmp, 2.5).add(new THREE.Vector3(0, 0.9, 0));
        // Ne pas passer sous le sol.
        const gy = sim.track.groundY(want.x, want.z) + 0.8;
        if (want.y < gy) want.y = gy;
        chasePos.lerp(want, first ? 1 : 1 - Math.exp(-dt * 5));
        chaseLook.lerp(lookAt, first ? 1 : 1 - Math.exp(-dt * 9));
        camera.position.copy(chasePos);
        camera.lookAt(chaseLook);
        camera.fov = 62;
        camera.near = 0.1;
      }
      camera.updateProjectionMatrix();
      first = false;
    },
  };
}
