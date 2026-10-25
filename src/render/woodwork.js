// Les modules en bois (look 'bois', façon North Shore) : un tablier de planches posées en travers, qui suit exactement le
// profil de la physique (f.wood : les tronçons en bois), des joues de planches sur les côtés jusqu'au sol, des pilotis
// et leurs moises ; au bout d'un drop, le front du tablier, droit, qui tombe jusqu'à la réception ; devant la réception
// d'un gap, le pied de la rampe.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAIL_HALF } from '../sim/track.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const W = TRAIL_HALF + 0.05; // la demi-largeur du tablier : toute la partie roulante

function photo(name, repeat) {
  const loader = new THREE.TextureLoader();
  const load = (part, srgb) => {
    const t = loader.load(`${import.meta.env.BASE_URL}textures/${name}-${part}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: load('couleur', true), normalMap: load('relief', false) };
}

export function createWoodwork(track) {
  const group = new THREE.Group();
  group.name = 'modules en bois';
  const parts = track.features.filter((f) => f.wood);
  if (!parts.length) return { group };
  const deckMat = new THREE.MeshStandardMaterial({ ...photo('bois', 1), color: lin('#f3dcc0'), roughness: 0.85, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: lin('#7a5c3e'), roughness: 0.95 });
  const pos = [], uv = [], idx = [];
  const quad = (a, b, c, d, ua, ub, va, vb) => {
    const k = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(p.x, p.y, p.z);
    uv.push(ua, va, ub, va, ub, vb, ua, vb);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const at = (s, u, dy = 0) => {
    const f = track.sample(s);
    return new THREE.Vector3(f.x + u * f.rx, track.trailY(s, u) + dy, f.z + u * f.rz);
  };
  // Le sol sous le bord du tablier : là où la piste rejoint le relief, un peu plus loin sur le côté.
  const below = (s, u) => at(s, u + Math.sign(u) * 2.2).y - 0.3;
  const posts = [];
  const STEP = 0.25, LAT = [-W, -W / 2, 0, W / 2, W];
  for (const f of parts) {
    for (const [s0, s1] of f.wood) {
      // Le tablier : les planches en travers (la photo a ses planches dans le sens de sa hauteur : le travers de la
      // piste va donc sur v).
      for (let s = s0; s < s1 - 1e-6; s += STEP) {
        const sb = Math.min(s1, s + STEP);
        for (let i = 0; i + 1 < LAT.length; i++) {
          const ua = LAT[i], ub = LAT[i + 1];
          quad(at(s, ua, 0.05), at(sb, ua, 0.05), at(sb, ub, 0.05), at(s, ub, 0.05), s / 2, sb / 2, ua / 2, ub / 2);
        }
        // Les joues, jusqu'au sol.
        for (const u of [-W, W]) {
          const top0 = at(s, u, 0.05), top1 = at(sb, u, 0.05);
          const bot0 = top0.clone(), bot1 = top1.clone();
          bot0.y = Math.min(below(s, u), top0.y - 0.15); bot1.y = Math.min(below(sb, u), top1.y - 0.15);
          quad(bot0, bot1, top1, top0, s / 2, sb / 2, bot0.y / 2, top0.y / 2);
        }
      }
      // Les pilotis, tous les 1,2 m de chaque côté, et une moise en travers sous le tablier.
      for (let s = s0 + 0.3; s < s1; s += 1.2) {
        for (const u of [-W - 0.08, W + 0.08]) {
          const top = at(s, u, 0.05), bot = top.clone();
          bot.y = Math.min(below(s, u), top.y - 0.2) - 0.2;
          posts.push({ a: bot, b: top, r: 0.07 });
        }
      }
      // Le front d'un drop : le bout du tablier tombe droit jusqu'à la réception.
      if (f.kind === 'drop' && Math.abs(s1 - f.lipS) < 0.5) {
        for (let i = 0; i + 1 < LAT.length; i++) {
          const ua = LAT[i], ub = LAT[i + 1];
          const ta = at(s1, ua, 0.05), tb = at(s1, ub, 0.05);
          const ba = at(s1 + 0.6, ua, -0.1), bb = at(s1 + 0.6, ub, -0.1);
          ba.x = ta.x; ba.z = ta.z; bb.x = tb.x; bb.z = tb.z; // (vertical)
          quad(ba, bb, tb, ta, ua / 2, ub / 2, ba.y / 2, ta.y / 2);
        }
      }
      // Devant la réception d'un gap en bois : le pied de la rampe, des planches jusqu'au fond du trou.
      if (f.kind === 'gap' && s0 > f.lipS + 1) {
        for (let i = 0; i + 1 < LAT.length; i++) {
          const ua = LAT[i], ub = LAT[i + 1];
          const ta = at(s0, ua, 0.05), tb = at(s0, ub, 0.05);
          const ba = ta.clone(), bb = tb.clone();
          ba.y = at(s0 - 1.5, ua).y - 0.2; bb.y = at(s0 - 1.5, ub).y - 0.2;
          quad(ba, bb, tb, ta, ua / 2, ub / 2, ba.y / 2, ta.y / 2);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const deck = new THREE.Mesh(g, deckMat);
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);
  if (posts.length) {
    const Y = new THREE.Vector3(0, 1, 0);
    const geos = posts.map(({ a, b, r }) => {
      const len = a.distanceTo(b);
      const c = new THREE.CylinderGeometry(r, r * 1.1, len, 6);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
      c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return c;
    });
    const m = new THREE.Mesh(mergeGeometries(geos), postMat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return { group };
}
