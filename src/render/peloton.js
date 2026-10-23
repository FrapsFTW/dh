// Le peloton à l'écran : les vingt rivaux rejoués (voir src/sim/peloton.js), chacun avec son vélo, sa tenue et son
// dossard. Leur pose est interpolée entre les échantillons (dix par seconde) : la position suit une courbe, pas des
// segments. En l'air, certains couchent le vélo (whip) ou le mettent à plat (table) : on connaît la durée de chaque
// saut à l'avance, le vélo revient droit avant la réception.
// De près : vélo allégé, pilote complet, ombre et nom au-dessus de la tête. Au loin : vélo en formes simples ; plus
// loin encore, rien. Un rival que la caméra traverse disparaît le temps de passer (sinon on verrait l'intérieur de son
// casque).

import * as THREE from 'three';
import { createBikeModel } from './bikeModel.js';
import { decodePeloton, POSE, POSE_SIZE, PELOTON_RATE, FLAG, sAt } from '../sim/peloton.js';
import { rng } from '../sim/noise.js';

const NEAR = 40, FAR = 260, SHADOW = 28, TAG = 30, TAGS = 6;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** Les sauts d'une descente (plus de 0,45 s en l'air), et ce que le rival y fait. */
export function airs(run) {
  const out = [], r = rng(run.num * 97 + 3), st = run.rider.style;
  let t0 = null;
  for (let i = 0; i < run.count; i++) {
    const inAir = (run.d[i * POSE_SIZE + POSE.flags] & FLAG.contacts) === 0;
    if (inAir && t0 === null) t0 = i / PELOTON_RATE;
    if (!inAir && t0 !== null) {
      const t1 = i / PELOTON_RATE, T = t1 - t0;
      if (T > 0.45) {
        const roll = r();
        const kind = roll < st.whip ? 'whip' : roll < st.whip + st.table ? 'table' : null;
        if (kind) out.push({ t0, t1, kind, dir: r() < 0.5 ? -1 : 1, amp: Math.min(1, (T - 0.35) / 0.5) * (0.7 + 0.3 * r()) });
      }
      t0 = null;
    }
  }
  return out;
}

// Le nom au-dessus du casque.
function tagSprite(rider) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  const short = `${rider.name.split(' ')[0][0]}. ${rider.name.split(' ').slice(1).join(' ').toUpperCase()}`;
  g.fillStyle = 'rgba(10,12,16,0.62)';
  g.beginPath(); g.roundRect(2, 6, 252, 44, 10); g.fill();
  g.fillStyle = rider.kit.jersey; g.fillRect(12, 14, 34, 28);
  g.fillStyle = '#fff'; g.font = '800 22px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(rider.num), 29, 29);
  g.textAlign = 'left'; g.font = '700 21px system-ui, sans-serif';
  g.fillText(short, 56, 29);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.center.set(0.5, 0);
  return s;
}

/** Charge le peloton d'une piste (null s'il n'y en a pas). */
export async function loadPeloton(mapId) {
  const base = import.meta.env ? import.meta.env.BASE_URL : '/';
  const res = await fetch(`${base}peloton/${mapId}.bin`).catch(() => null);
  if (!res || !res.ok) return null;
  return decodePeloton(new Uint8Array(await res.arrayBuffer()));
}

export function createPeloton(scene, runs) {
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const riders = runs.map((run) => {
    const model = createBikeModel({ lod: true, kit: run.rider.kit, number: run.rider.num, stance: run.num % 3 ? 1 : -1 });
    scene.add(model.group);
    const tag = tagSprite(run.rider);
    scene.add(tag);
    const state = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), steer: 0, lean: 0, crashed: null, speed: 0, contacts: 2,
      input: { pedal: 0 }, hips: new THREE.Vector3(), crouch: 0,
      wheels: [{ x: 0, spinAngle: Math.random() * 6, contact: true, omega: 0 }, { x: 0, spinAngle: Math.random() * 6, contact: true, omega: 0 }],
    };
    return { run, model, tag, state, airs: airs(run), near: true, shadows: true, style: { q: new THREE.Quaternion(), pivot: new THREE.Vector3() } };
  });

  // La pose d'un rival au temps t.
  function pose(R, t) {
    const { d, count } = R.run, st = R.state;
    const f = Math.max(0, Math.min(count - 1.0001, t * PELOTON_RATE));
    const i = Math.floor(f), u = f - i;
    const at = (j, k) => d[Math.max(0, Math.min(count - 1, j)) * POSE_SIZE + k];
    // La position : une courbe de Catmull-Rom par les échantillons voisins.
    for (let k = 0; k < 3; k++) {
      const p0 = at(i - 1, k), p1 = at(i, k), p2 = at(i + 1, k), p3 = at(i + 2, k);
      const v = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
      st.position.setComponent(k, v);
    }
    qa.set(at(i, POSE.qx), at(i, POSE.qy), at(i, POSE.qz), at(i, POSE.qw)).normalize();
    qb.set(at(i + 1, POSE.qx), at(i + 1, POSE.qy), at(i + 1, POSE.qz), at(i + 1, POSE.qw)).normalize();
    st.quaternion.slerpQuaternions(qa, qb, u);
    const L = (k) => at(i, k) + (at(i + 1, k) - at(i, k)) * u;
    st.steer = L(POSE.steer); st.lean = L(POSE.lean); st.crouch = L(POSE.crouch);
    st.wheels[0].x = L(POSE.suspF); st.wheels[1].x = L(POSE.suspR);
    st.wheels[0].omega = L(POSE.omegaF); st.wheels[1].omega = L(POSE.omegaR);
    st.hips.set(L(POSE.hipsX), L(POSE.hipsY), L(POSE.hipsZ));
    const flags = at(u < 0.5 ? i : i + 1, POSE.flags);
    st.contacts = flags & FLAG.contacts;
    st.wheels[0].contact = st.wheels[1].contact = st.contacts > 0;
    st.input.pedal = flags & FLAG.pedal ? 1 : 0;
    tmpA.set(at(i, 0), at(i, 1), at(i, 2)); tmpB.set(at(i + 1, 0), at(i + 1, 1), at(i + 1, 2));
    st.speed = tmpA.distanceTo(tmpB) * PELOTON_RATE;
    st.finished = !!(flags & FLAG.finished);
  }

  // Le vélo couché en l'air : nul au décollage, au plus fort vers le milieu du saut, revenu droit aux quatre cinquièmes.
  const qy = new THREE.Quaternion(), qz = new THREE.Quaternion();
  function style(R, t) {
    const a = R.airs.find((x) => t > x.t0 && t < x.t1);
    if (!a) return null;
    const u = (t - a.t0) / (a.t1 - a.t0);
    if (u > 0.8) return null;
    const e = Math.sin(Math.PI * (u / 0.8)) ** 2 * a.amp;
    const yaw = a.kind === 'whip' ? 0.5 : 0.12, roll = a.kind === 'whip' ? 0.45 : 0.62;
    R.style.q.copy(qy.setFromAxisAngle(Y, yaw * e * a.dir)).multiply(qz.setFromAxisAngle(Z, roll * e * a.dir));
    R.style.pivot.copy(R.state.hips);
    return R.style;
  }

  const camPos = new THREE.Vector3(), chest = new THREE.Vector3();
  return {
    riders,
    /** t : le temps depuis le GO (0 sur la grille). */
    update(t, dt, camera) {
      camera.getWorldPosition(camPos);
      // Les noms : seulement les plus proches, pour ne pas encombrer.
      for (const R of riders) {
        pose(R, t);
        R.dist = camPos.distanceTo(R.state.position);
        // La caméra dans le pilote (vue casque, vue extérieure qui le traverse) : mesuré à hauteur de poitrine.
        R.inside = camPos.distanceTo(chest.copy(Y).applyQuaternion(R.state.quaternion).multiplyScalar(1.25).add(R.state.position)) < 0.75;
      }
      const named = new Set(riders.filter((R) => R.dist > 3 && R.dist < TAG).sort((a, b) => a.dist - b.dist).slice(0, TAGS));
      for (const R of riders) {
        const st = R.state;
        for (const w of st.wheels) w.spinAngle = (w.spinAngle + w.omega * dt) % (Math.PI * 2);
        const dist = R.dist;
        // Visible jusqu'à FAR ; pas quand la caméra le traverse.
        const show = dist < FAR && !R.inside;
        R.model.group.visible = show;
        R.tag.visible = show && named.has(R);
        if (!show) continue;
        const near = dist < NEAR;
        if (near !== R.near) { R.near = near; R.model.setNear(near); }
        const shadows = dist < SHADOW;
        if (shadows !== R.shadows) { R.shadows = shadows; R.model.group.traverse((m) => { if (m.isMesh) m.castShadow = shadows; }); }
        R.model.update(st, dt, false, style(R, t));
        if (R.tag.visible) {
          R.tag.position.copy(st.position).addScaledVector(Y, 1.95);
          const k = THREE.MathUtils.clamp(dist * 0.05, 0.4, 2.4);
          R.tag.scale.set(k * 1.0, k * 0.22, 1);
          R.tag.material.opacity = 1 - THREE.MathUtils.smoothstep(dist, TAG * 0.7, TAG);
        }
      }
    },
    /** Où en est chaque rival au temps t : sa distance parcourue (et s'il est arrivé). */
    progress(t) { return riders.map((R) => ({ run: R.run, s: sAt(R.run, t), finished: t >= R.run.finish })); },
    /** Le temps auquel un rival est passé à la distance s (pour les écarts). */
    timeAt(run, s) {
      const { d, count } = run;
      let lo = 0, hi = count - 1;
      if (d[hi * POSE_SIZE + 3] < s) return Infinity;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m * POSE_SIZE + 3] < s) lo = m; else hi = m; }
      const a = d[lo * POSE_SIZE + 3], b = d[hi * POSE_SIZE + 3];
      return (lo + (b > a ? (s - a) / (b - a) : 0)) / PELOTON_RATE;
    },
    setVisible(v) { for (const R of riders) { R.model.group.visible = v; R.tag.visible = v && R.tag.visible; } },
  };
}
