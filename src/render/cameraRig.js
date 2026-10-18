// Les caméras : la vue subjective (dans le casque du pilote) et une vue extérieure.
// En vue subjective, la tête du pilote garde l'horizon plus stable que le vélo et regarde vers la sortie des
// virages, comme un vrai pilote ; elle suit aussi les déplacements de son poids. Pendant une figure, elle tourne
// avec le vélo (on voit le monde basculer, comme avec une caméra sur le casque).

import * as THREE from 'three';

export const CAMERA_SETTINGS = {
  fov: 76, // champ de vision vertical à l'arrêt (degrés)
  fovSpeed: 12, // degrés ajoutés à pleine vitesse : la sensation de vitesse
  rollFollow: 0.35, // part de l'inclinaison du vélo que suit la tête (0 = horizon fixe, 1 = collée au vélo)
  pitchFollow: 0.55, // part du tangage du vélo que suit la tête
  lookDown: 9, // le regard porte un peu vers le bas, vers la trajectoire (degrés)
  lookAhead: 0.6, // la tête se tourne vers la sortie du virage
  shake: 0.6, // secousses (0 = aucune) : à baisser si on a le mal des transports
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createCameraRig(camera, bikeModel, sim) {
  const S = CAMERA_SETTINGS;
  let mode = 'fp';
  let first = true, t = 0, shakeLevel = 0;
  let yaw = 0, pitch = 0, roll = 0, lookYaw = 0, lookPitch = 0;
  const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
  const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const smoothPos = new THREE.Vector3();
  const qBike = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3();
  let flipBlend = 0;

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
        lookYaw += (look.x * 1.2 - lookYaw) * Math.min(1, dt * (Math.abs(look.x) > 0.05 ? 6 : 2.5));
        lookPitch += (-look.y * 0.6 - lookPitch) * Math.min(1, dt * (Math.abs(look.y) > 0.05 ? 6 : 2.5));
        const wantYaw = bikeYaw + into + lookYaw;
        const wantPitch = bikePitch * S.pitchFollow - (S.lookDown * Math.PI) / 180 + lookPitch;
        const wantRoll = -state.lean * S.rollFollow;
        if (first) { yaw = wantYaw; pitch = wantPitch; roll = wantRoll; }
        const k = 1 - Math.exp(-dt * 14);
        yaw += wrap(wantYaw - yaw) * k;
        pitch += (wantPitch - pitch) * k;
        roll += (wantRoll - roll) * (1 - Math.exp(-dt * 10));

        // Les secousses viennent de la suspension qui travaille.
        const [wf, wr] = state.wheels;
        const hit = Math.min(1, (Math.abs(wf.xdot) + Math.abs(wr.xdot)) * 0.18);
        shakeLevel = Math.max(hit, shakeLevel - dt * 5);
        const a = S.shake * shakeLevel * 0.018;
        euler.set(pitch + Math.sin(t * 61) * a, yaw + Math.sin(t * 47 + 1) * a * 0.5, roll + Math.sin(t * 53 + 2) * a * 0.4);
        camera.quaternion.setFromEuler(euler);
        // En figure (vélo renversé ou qui tourne vite en l'air), la tête suit le vélo.
        up.set(0, 1, 0).applyQuaternion(q);
        const tricking = !crashed && state.airTime > 0 && (up.y < 0.85 || state.angularVelocity.length() > 3);
        flipBlend += ((tricking ? 1 : 0) - flipBlend) * Math.min(1, dt * (tricking ? 8 : 3));
        if (flipBlend > 0.002) {
          qBike.copy(q).multiply(qTilt.setFromAxisAngle(X, -(S.lookDown * Math.PI) / 180));
          camera.quaternion.slerp(qBike, flipBlend);
        }

        // Les yeux : dans le casque du pilote.
        eye.copy(bikeModel.eye).applyQuaternion(q).add(state.position);
        if (first) smoothPos.copy(eye);
        smoothPos.lerp(eye, 1 - Math.exp(-dt * 40));
        camera.position.copy(smoothPos);
        const fov = S.fov + S.fovSpeed * Math.min(1, speed / 18);
        if (Math.abs(camera.fov - fov) > 0.01) camera.fov = fov;
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
