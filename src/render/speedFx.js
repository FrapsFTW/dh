// Poussière et pollen dans l'air, autour de la caméra. Immobiles (ils flottent à peine), ce sont eux qui défilent :
// à vitesse de course, chaque grain laisse une courte traînée, comme sur une vidéo embarquée. Ils n'apparaissent
// qu'au-dessus d'environ 30 km/h.

import * as THREE from 'three';
import { rng } from '../sim/noise.js';

const N = 520;
const BOX = { x: 11, yDown: 1.5, yUp: 3.5, z: 11 }; // la boîte autour de la caméra où vivent les grains
const SHUTTER = 0.02; // durée de « pose » des traînées (s)

export function createSpeedParticles() {
  const rand = rng(91);
  const pos = new Float32Array(N * 2 * 3);
  const col = new Float32Array(N * 2 * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 2;

  // Chaque grain : sa position dans le monde, une petite dérive, sa couleur et son éclat.
  const grains = Array.from({ length: N }, () => ({
    p: new THREE.Vector3(),
    drift: new THREE.Vector3((rand() - 0.5) * 0.4, (rand() - 0.3) * 0.15, (rand() - 0.5) * 0.4),
    shade: rand() < 0.75 ? [1, 0.93, 0.8] : [0.95, 0.97, 1], // poussière dorée, quelques graines blanches
    bright: 0.35 + rand() * 0.65,
    placed: false,
  }));
  const cam = new THREE.Vector3(), rel = new THREE.Vector3(), tail = new THREE.Vector3();
  let amount = 0;

  function place(g, around) {
    g.p.set(around.x + (rand() * 2 - 1) * BOX.x, around.y - BOX.yDown + rand() * (BOX.yDown + BOX.yUp), around.z + (rand() * 2 - 1) * BOX.z);
    g.placed = true;
  }

  return {
    object: lines,
    /** velocity : celle du pilote (m/s, monde) ; speed en m/s. */
    update(camera, velocity, dt) {
      camera.getWorldPosition(cam);
      const speed = velocity.length();
      const want = THREE.MathUtils.smoothstep(speed * 3.6, 28, 55);
      amount += (want - amount) * Math.min(1, dt * 2.5);
      lines.visible = amount > 0.01;
      if (!lines.visible) { for (const g of grains) g.placed = false; return; }
      for (let i = 0; i < N; i++) {
        const g = grains[i];
        if (!g.placed) place(g, cam);
        g.p.addScaledVector(g.drift, dt);
        // Sortis de la boîte : ils réapparaissent de l'autre côté (donc devant, puisqu'on avance).
        rel.subVectors(g.p, cam);
        if (rel.x > BOX.x) g.p.x -= 2 * BOX.x; else if (rel.x < -BOX.x) g.p.x += 2 * BOX.x;
        if (rel.z > BOX.z) g.p.z -= 2 * BOX.z; else if (rel.z < -BOX.z) g.p.z += 2 * BOX.z;
        if (rel.y > BOX.yUp) g.p.y -= BOX.yDown + BOX.yUp; else if (rel.y < -BOX.yDown) g.p.y += BOX.yDown + BOX.yUp;
        // La traînée : là où était le grain, vu de la caméra, il y a un instant.
        tail.copy(g.p).addScaledVector(velocity, SHUTTER);
        pos.set([g.p.x, g.p.y, g.p.z, tail.x, tail.y, tail.z], i * 6);
        // Plus visibles près de la caméra ; la queue de la traînée s'efface.
        const d = rel.length();
        // (trop près, un grain ferait une grande rayure : on l'efface aussi)
        const a = amount * g.bright * THREE.MathUtils.clamp(1.3 - d / 9, 0, 1) * THREE.MathUtils.smoothstep(d, 0.8, 2.2) * 0.5;
        const [r, gg, b] = g.shade;
        col.set([r, gg, b, a, r, gg, b, 0], i * 8);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}
