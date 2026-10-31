// Ce qui fait l'identité d'une piste, au-delà du relief et de la forêt (map.scenery) :
// - 'bikepark' (Le Bike Park, comme la A-Line de Whistler) : les filets orange à l'extérieur des virages relevés, un
//   panneau avant chaque saut, le grand panneau du départ, une passerelle de bois façon North Shore et son wallride à
//   côté de la ligne, la tour du speaker au Big One.
// - 'riviera' (Le Single, comme à Finale Ligure) : les murets de pierre sèche des anciennes terrasses (le sentier
//   passe par leurs brèches), des maisons ligures (crépi pastel, tuiles, volets verts) en bas, et une chapelle.
// - 'ville' (Les Ruelles) : les maisons peintes, les marches, les murets, les rues à sauter, le passage voûté (plus bas).
// Rien ici ne touche la physique : tout se tient à l'écart de la rubalise.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../sim/noise.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

/** La distance au segment [[x, z], [x, z]]. */
function distToSegment([[ax, az], [bx, bz]], x, z) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Une photo de public/textures (couleur et relief), répétée à sa taille réelle. */
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

function frameAt(track, s, u = 0) {
  const f = track.sample(s);
  return {
    pos: new THREE.Vector3(f.x + u * f.rx, track.trailY(s, u), f.z + u * f.rz),
    fwd: new THREE.Vector3(f.tx, 0, f.tz),
    right: new THREE.Vector3(f.rx, 0, f.rz),
    yaw: Math.atan2(-f.tx, -f.tz),
  };
}

/** Un mesh fusionné, qui porte et reçoit les ombres. */
function solid(geos, mat) {
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Une boîte orientée (lacet yaw), posée en (x, y, z) : y est le bas de la boîte. */
function boxAt(sx, sy, sz, x, y, z, yaw = 0, tilt = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(0, sy / 2, 0);
  if (tilt) g.rotateX(tilt);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

export function createScenery(track) {
  const group = new THREE.Group();
  group.name = 'decor';
  const kind = track.map.scenery;
  if (kind === 'bikepark') bikePark(track, group);
  if (kind === 'riviera') riviera(track, group);
  if (kind === 'ville') ville(track, group);
  return { group };
}

// ---------------------------------------------------------------------------------------------------------------
// Le Bike Park
// ---------------------------------------------------------------------------------------------------------------
function bikePark(track, group) {
  const rand = rng(track.seed + 515);
  const wood = new THREE.MeshStandardMaterial({ ...photo('bois', 1), color: lin('#c9a77f'), roughness: 0.9 });
  const post = new THREE.MeshStandardMaterial({ color: lin('#6b5137'), roughness: 0.95 });

  // ----- Les filets : à l'extérieur des virages relevés, des poteaux et un filet orange tendu entre eux -----
  const netTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 5;
    for (let k = -w; k < 2 * w; k += 32) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k, h); ctx.lineTo(k + h, 0); ctx.stroke();
    }
    ctx.fillStyle = '#ff6a1a'; ctx.fillRect(0, 0, w, 10); // la ralingue du haut
  }, true);
  const netMat = new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  const netPos = [], netUv = [], netIdx = [], posts = [];
  const NET_H = 1.7;
  let run = null;
  const flush = () => { run = null; };
  for (let s = track.sStart + 20; s < track.sFinish - 10; s += 2.5) {
    const k = track.sample(s).k;
    if (Math.abs(k) < 1 / 26) { flush(); continue; }
    const side = -Math.sign(k), u = side * (track.tapeAt(s) + 1.1);
    const f = frameAt(track, s, u);
    posts.push(f.pos.clone());
    const base = netPos.length / 3;
    netPos.push(f.pos.x, f.pos.y + 0.1, f.pos.z, f.pos.x, f.pos.y + NET_H, f.pos.z);
    netUv.push(s / 2.5, 0, s / 2.5, 1.3);
    if (run && run.side === side) netIdx.push(base - 2, base - 1, base, base - 1, base + 1, base);
    run = { side };
  }
  if (netIdx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(netPos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(netUv, 2));
    g.setIndex(netIdx);
    g.computeVertexNormals();
    const net = new THREE.Mesh(g, netMat);
    net.castShadow = true;
    group.add(net);
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, NET_H + 0.3, 6).translate(0, (NET_H + 0.3) / 2 - 0.2, 0), post, posts.length);
    posts.forEach((p, i) => pm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    pm.castShadow = true;
    group.add(pm);
  }

  // ----- Les panneaux : avant chaque saut, son nom et sa difficulté (losange noir : pour pilotes confirmés) -----
  const diamond = (ctx, x, y, r, n = 1) => {
    ctx.fillStyle = '#111';
    for (let i = 0; i < n; i++) {
      const cx = x + (i - (n - 1) / 2) * r * 2.1;
      ctx.beginPath(); ctx.moveTo(cx, y - r); ctx.lineTo(cx + r, y); ctx.lineTo(cx, y + r); ctx.lineTo(cx - r, y); ctx.closePath(); ctx.fill();
    }
  };
  const signBoard = (lines, n, w = 512, h = 320) => canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8611a'; ctx.fillRect(0, 0, w, h * 0.16); ctx.fillRect(0, h * 0.92, w, h * 0.08);
    diamond(ctx, w / 2, h * 0.36, h * 0.12, n);
    ctx.fillStyle = '#16181b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((t, i) => {
      ctx.font = `900 ${Math.round(h * (i ? 0.1 : 0.16))}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.fillText(t, w / 2, h * (0.62 + i * 0.16), w * 0.9);
    });
  });
  const signGeo = [];
  const addSign = (s, u, tex, bw, bh, height) => {
    const f = frameAt(track, s, u);
    const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.05), [post, post, post, post, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), post]);
    board.position.copy(f.pos).add(new THREE.Vector3(0, height, 0));
    board.rotation.y = f.yaw; // (la face avant regarde vers le haut de la piste, vers qui arrive)
    board.castShadow = true;
    group.add(board);
    for (const o of bw > 2 ? [-bw / 2 + 0.2, bw / 2 - 0.2] : [0]) {
      const p = f.pos.clone().addScaledVector(f.right, o);
      signGeo.push(boxAt(0.1, height + bh / 2, 0.1, p.x, p.y - 0.2, p.z, f.yaw));
    }
  };
  const named = { table: 'TABLE', gap: 'GAP', drop: 'DROP' };
  let last = -1e9;
  for (const f of track.features) {
    if (f.type !== 'jump' || f.lipS - last < 25) continue;
    last = f.lipS;
    const big = f.name === 'le Big One';
    const label = big ? 'BIG ONE' : f.name === 'step-down' ? 'STEP-DOWN' : f.name === 'road gap' ? 'ROAD GAP' : named[f.kind] || 'SAUT';
    const s = f.lipS - 22, side = rand() < 0.5 ? -1 : 1;
    addSign(s, side * (track.tapeAt(s) + 1.3), signBoard([label, big ? 'PILOTES EXPERTS' : 'GROS SAUT'], big ? 2 : 1), 0.9, 0.56, 1.4);
  }
  // Le grand panneau du départ.
  addSign(track.sStart + 8, track.tapeAt(track.sStart + 8) + 2.2, signBoard(['LIGNE DES SAUTS', 'TABLES · GAPS · BERMS · 1,2 KM', 'PILOTES EXPERTS'], 2, 1024, 560), 3.2, 1.75, 1.9);
  if (signGeo.length) group.add(solid(signGeo, post));

  // ----- La passerelle North Shore : des planches posées sur des rondins, qui montent puis redescendent, à côté de la
  // ligne ; au bout, un wallride (un mur de planches presque vertical) -----
  {
    // Une ligne droite, assez longue, loin des sauts.
    let best = null;
    for (let s = track.sStart + 60; s < track.sFinish - 120; s += 10) {
      let ok = true;
      for (let d = 0; d < 60 && ok; d += 5) if (Math.abs(track.sample(s + d).k) > 1 / 60) ok = false;
      if (ok && !track.features.some((f) => f.type === 'jump' && f.lipS > s - 30 && f.lipS < s + 80)) { best = s; break; }
    }
    if (best !== null) {
      const side = 1, deck = [], piles = [];
      const u0 = side * (track.tapeAt(best) + 7);
      const L = 46;
      for (let d = 0; d < L; d += 1.2) {
        const s = best + d, f = frameAt(track, s, u0 + side * Math.sin(d / 9) * 1.5);
        const h = 0.4 + 1.6 * Math.sin((Math.PI * d) / L); // elle monte jusqu'à 2 m au milieu
        deck.push(boxAt(0.24 * 4, 0.06, 1.1, f.pos.x, f.pos.y + h, f.pos.z, f.yaw + Math.PI / 2));
        if (Math.round(d / 1.2) % 2 === 0) for (const o of [-0.45, 0.45]) {
          const p = f.pos.clone().addScaledVector(f.right, o);
          piles.push(boxAt(0.14, h + 0.3, 0.14, p.x, p.y - 0.3, p.z, f.yaw));
        }
      }
      // Le wallride : 6 m de long, 3,5 m de haut, incliné à 75°, tourné vers la passerelle.
      const f = frameAt(track, best + L + 6, u0 + side * 4);
      deck.push(boxAt(6, 3.5, 0.12, f.pos.x, f.pos.y, f.pos.z, f.yaw + Math.PI / 2, 0.26));
      for (const o of [-2.6, 0, 2.6]) {
        const p = f.pos.clone().addScaledVector(f.fwd, o).addScaledVector(f.right, side * 0.8);
        piles.push(boxAt(0.16, 3.3, 0.16, p.x, p.y, p.z, f.yaw + Math.PI / 2, -0.35));
      }
      group.add(solid(deck, wood), solid(piles, post));
    }
  }

  // ----- Le pied des pistes : des chalets de la station autour de l'arrivée (bardage de bois, soubassement de pierre,
  // toit de tôle à deux pans, grandes baies vitrées) -----
  {
    const cladding = new THREE.MeshStandardMaterial({ ...photo('bois', 1), color: lin('#ffd9ae'), roughness: 0.9, side: THREE.DoubleSide });
    const stone = new THREE.MeshStandardMaterial({ ...photo('pierre', 1), color: lin('#c9c4ba'), roughness: 0.95 });
    const roof = new THREE.MeshStandardMaterial({ color: lin('#71807a'), roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide });
    const glass = new THREE.MeshStandardMaterial({ color: lin('#1a2329'), roughness: 0.05 });
    const walls = [], bases = [], roofs = [], panes = [], spots = [];
    for (let k = 0; k < 500 && spots.length < 5; k++) {
      const s = track.sFinish - 60 + rand() * 90, side = rand() < 0.5 ? -1 : 1;
      const w = 12 + rand() * 6, d = 9 + rand() * 4, h = 6 + rand() * 3;
      const f = frameAt(track, Math.min(s, track.length - 1), side * (track.tapeAt(s) + 12 + rand() * 26));
      const r = Math.hypot(w, d) / 2 + 1;
      const near = track.nearest(f.pos.x, f.pos.z, null, 0, 3);
      if (near.dist < track.tapeAt(near.s) + r + 4 || track.treeNear(f.pos.x, f.pos.z, r)) continue;
      if (track.map.lift && distToSegment(track.map.lift, f.pos.x, f.pos.z) < r + 6) continue;
      if (spots.some((o) => Math.hypot(o.x - f.pos.x, o.z - f.pos.z) < o.r + r + 3)) continue;
      spots.push({ x: f.pos.x, z: f.pos.z, r });
      const y = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => track.groundY(f.pos.x + (a * w) / 2, f.pos.z + (b * d) / 2)));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(f.pos.x, y, f.pos.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw + (rand() < 0.5 ? 0 : Math.PI / 2)), new THREE.Vector3(1, 1, 1));
      bases.push(new THREE.BoxGeometry(w + 0.3, 2, d + 0.3).translate(0, 0, 0).applyMatrix4(m));
      walls.push(new THREE.BoxGeometry(w, h - 1, d).translate(0, (h - 1) / 2 + 1, 0).applyMatrix4(m));
      // Le toit à deux pans, raide (la neige), qui déborde de 1 m ; le faîte dans la longueur.
      const rw = w / 2 + 1, rd = d / 2 + 1, rh = d * 0.42;
      const P = [[-rw, h, -rd], [rw, h, -rd], [rw, h + rh, 0], [-rw, h + rh, 0], [rw, h, rd], [-rw, h, rd]];
      const rp = [];
      for (const t of [[0, 1, 2], [0, 2, 3], [3, 2, 4], [3, 4, 5]]) for (const i of t) rp.push(...P[i]);
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      rg.computeVertexNormals();
      roofs.push(rg.applyMatrix4(m));
      // Les pignons, en bois.
      for (const sx of [-1, 1]) {
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.Float32BufferAttribute([sx * w / 2, h, -d / 2, sx * w / 2, h, d / 2, sx * w / 2, h + rh - 0.2, 0], 3));
        pg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, d / 2, 0, d / 4, rh / 2], 2));
        pg.setIndex(sx > 0 ? [0, 2, 1] : [0, 1, 2]);
        pg.computeVertexNormals();
        walls.push(pg.toNonIndexed().applyMatrix4(m));
      }
      // Les baies vitrées, sur les deux longues façades, et une au pignon.
      for (const sz of [-1, 1]) for (let i = 0; i < Math.floor(w / 3.2); i++) {
        const x = -w / 2 + 1.6 + i * 3.2;
        panes.push(new THREE.BoxGeometry(2.2, 2.4, 0.08).translate(x, 2.9, sz * (d / 2 + 0.03)).applyMatrix4(m));
        if (h > 7) panes.push(new THREE.BoxGeometry(2.2, 1.6, 0.08).translate(x, 6, sz * (d / 2 + 0.03)).applyMatrix4(m));
      }
      panes.push(new THREE.BoxGeometry(0.08, 2.6, d * 0.5).translate(w / 2 + 0.03, h + 0.4, 0).applyMatrix4(m));
    }
    const nonIdx = (gs) => gs.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; });
    if (walls.length) group.add(solid(nonIdx(walls), cladding), solid(bases, stone), solid(roofs, roof), solid(panes, glass));
  }

  // ----- La tour du speaker au Big One : un échafaudage, une plateforme, une banderole -----
  const big = track.features.find((f) => f.name === 'le Big One');
  if (big) {
    const s = big.lipS + 14, side = -1;
    const f = frameAt(track, s, side * (track.tapeAt(s) + 6));
    const steel = new THREE.MeshStandardMaterial({ color: lin('#b9bec4'), roughness: 0.45, metalness: 0.6 });
    const geos = [];
    const H = 6;
    for (const a of [-1.3, 1.3]) for (const b of [-1.3, 1.3]) {
      const p = f.pos.clone().addScaledVector(f.fwd, a).addScaledVector(f.right, b);
      geos.push(boxAt(0.08, H + 1.1, 0.08, p.x, p.y - 0.2, p.z));
    }
    for (const y of [2, 4, H]) geos.push(boxAt(2.7, 0.08, 2.7, f.pos.x, f.pos.y + y, f.pos.z, f.yaw));
    group.add(solid(geos, steel));
    const tex = canvasTex(1024, 192, (ctx, w, h) => {
      ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff6a1a'; ctx.font = `900 ${h * 0.56}px "Arial Black", Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('WHIP-OFF', w / 2, h * 0.5);
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.55), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    banner.position.copy(f.pos).add(new THREE.Vector3(0, H + 0.6, 0)).addScaledVector(f.right, -side * 1.36);
    banner.rotation.y = f.yaw + Math.PI / 2;
    group.add(banner);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// La Riviera (Le Single)
// ---------------------------------------------------------------------------------------------------------------
function riviera(track, group) {
  const rand = rng(track.seed + 616);
  const B = track.bounds;
  const stoneMat = new THREE.MeshStandardMaterial({ ...photo('pierre', 1), color: lin('#efe6d6'), roughness: 0.95, side: THREE.DoubleSide });

  // ----- Les murets des terrasses : en travers de la pente (le long des courbes de niveau), tous les 7 à 9 m en bas
  // (les oliviers), plus espacés et en ruine plus haut. Le sentier passe par leurs brèches. -----
  {
    const pos = [], uv = [], idx = [];
    const quad = (a, b, c, d, u0, u1, v0, v1) => {
      const k = pos.length / 3;
      for (const p of [a, b, c, d]) pos.push(p.x, p.y, p.z);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    };
    const T = 0.5; // l'épaisseur
    for (let z = B.zmax - 20; z > B.zmin + 6; ) {
      const yRef = track.natural(0, z);
      const terraces = yRef < -60; // les oliviers : des terrasses partout
      const ruin = terraces ? 0.08 : 0.45;
      let prev = null;
      for (let x = B.xmin + 4; x < B.xmax - 4; x += 1) {
        const zz = z + 2.2 * fbm(x / 35, z / 35, 2, 91);
        const near = track.nearest(x, zz, null, 0, 3);
        const keep = near.dist > track.tapeAt(near.s) + 1.2 && near.dist < 75 && !track.treeNear(x, zz, 0.15)
          && fbm(x / 9, z / 9, 2, 93) > ruin * 2 - 1;
        if (!keep) { prev = null; continue; }
        const g = track.groundY(x, zz);
        const h = 0.75 + 0.45 * (fbm(x / 6, z / 6, 2, 95) * 0.5 + 0.5);
        const cur = { x, z: zz, g, h };
        if (prev) {
          // (deux points : le pied et le haut, devant puis derrière)
          const P = (p, dz, y) => new THREE.Vector3(p.x, y, p.z + dz);
          const u0 = prev.x / 2, u1 = x / 2;
          quad(P(prev, -T / 2, prev.g - 0.3), P(cur, -T / 2, cur.g - 0.3), P(cur, -T / 2, cur.g + cur.h), P(prev, -T / 2, prev.g + prev.h), u0, u1, 0, (prev.h + 0.3) / 2);
          quad(P(cur, T / 2, cur.g - 0.3), P(prev, T / 2, prev.g - 0.3), P(prev, T / 2, prev.g + prev.h), P(cur, T / 2, cur.g + cur.h), u1, u0, 0, (prev.h + 0.3) / 2);
          quad(P(prev, -T / 2, prev.g + prev.h), P(cur, -T / 2, cur.g + cur.h), P(cur, T / 2, cur.g + cur.h), P(prev, T / 2, prev.g + prev.h), u0, u1, 0, T / 2);
        }
        prev = cur;
      }
      z -= terraces ? 7 + rand() * 2 : 13 + rand() * 6;
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const walls = new THREE.Mesh(g, stoneMat);
      walls.castShadow = walls.receiveShadow = true;
      walls.name = 'murets';
      group.add(walls);
    }
  }

  // ----- Les marches de pierre : sur chaque ressaut, une rangée de blocs de calcaire, le dessus au ras de la marche -----
  {
    const geos = [], r2 = rng(track.seed + 717);
    for (const f of track.features.filter((f) => f.type === 'stairs')) {
      for (let s = f.a + f.step; s < f.b - 0.01; s += f.step) {
        const top = track.trailY(s - 0.1, 0), low = track.trailY(s + 0.1, 0);
        for (let u = -1.6; u < 1.6; u += 0.55 + r2() * 0.25) {
          const fr = frameAt(track, s, u + 0.25);
          const h = top - low + 0.25, w = 0.45 + r2() * 0.3;
          // (le bloc : son front sur l'arête de la marche, sa profondeur vers l'amont)
          const g = new THREE.BoxGeometry(w, h, 0.5, 2, 1, 1);
          g.translate(0, h / 2, 0.25);
          g.rotateY(fr.yaw);
          g.translate(fr.pos.x, track.trailY(s - 0.1, u + 0.25) - h + 0.02, fr.pos.z);
          geos.push(g);
        }
      }
    }
    if (geos.length) group.add(solid(geos, new THREE.MeshStandardMaterial({ ...photo('pierre', 1), color: lin('#f1ebdd'), roughness: 0.9 })));
  }

  // ----- Les maisons ligures, en bas : crépi ocre, rose ou jaune, toit de tuiles, volets verts -----
  const plaster = photo('crepi', 1 / 1.4);
  const colors = ['#f6d6a4', '#f4c0a6', '#f8e6ab', '#f3dcc2', '#efb595'];
  const wallMats = colors.map((c) => new THREE.MeshStandardMaterial({ ...plaster, color: lin(c), roughness: 0.95 }));
  const tiles = canvasTex(256, 256, (ctx, w, h) => {
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 24) {
      const g = ctx.createLinearGradient(x, 0, x + 24, 0);
      const l = 40 + ((x * 7 + y * 3) % 9);
      g.addColorStop(0, `hsl(16, 52%, ${l - 12}%)`); g.addColorStop(0.5, `hsl(18, 58%, ${l + 6}%)`); g.addColorStop(1, `hsl(16, 52%, ${l - 14}%)`);
      ctx.fillStyle = g; ctx.fillRect(x, y, 24, 32);
      ctx.fillStyle = 'rgba(40,15,5,0.35)'; ctx.fillRect(x, y + 29, 24, 3);
    }
  }, true);
  const roofMat = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.75, side: THREE.DoubleSide });
  const shutterMat = new THREE.MeshStandardMaterial({ color: lin('#3f6b4a'), roughness: 0.8 });
  const sillMat = new THREE.MeshStandardMaterial({ color: lin('#f2ece0'), roughness: 0.85 });
  const wallGeos = colors.map(() => []), roofGeos = [], shutGeos = [], sillGeos = [];
  const house = (x, z, y, w, d, h, yaw, ci, bell = false) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    const wg = new THREE.BoxGeometry(w, h + 1, d).translate(0, (h + 1) / 2 - 1, 0);
    const uvA = wg.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (uvA.getX(i) * Math.max(w, d)) / 3, (uvA.getY(i) * (h + 1)) / 3);
    wallGeos[ci].push(wg.applyMatrix4(m));
    // Le toit à quatre pans, peu pentu, qui déborde.
    const rw = w / 2 + 0.45, rd = d / 2 + 0.45, rh = Math.min(w, d) * 0.22, rr = Math.max(0, w / 2 - d / 2);
    const P = [[-rw, h, -rd], [rw, h, -rd], [rw, h, rd], [-rw, h, rd], [-rr, h + rh, 0], [rr, h + rh, 0]];
    const tri = [[0, 1, 5], [0, 5, 4], [1, 2, 5], [2, 3, 4], [2, 4, 5], [3, 0, 4]];
    const rp = [], ru = [];
    for (const t of tri) for (const k of t) { rp.push(...P[k]); ru.push(P[k][0] / 2.5, (P[k][2] + P[k][1]) / 2.5); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    rg.computeVertexNormals();
    roofGeos.push(rg.applyMatrix4(m));
    // Les fenêtres : des volets fermés (ou à demi), un rebord blanc ; deux ou trois par façade et par étage.
    const floors = Math.max(1, Math.floor(h / 2.9));
    for (const [fw, nz, sx] of [[w, d / 2, 1], [w, -d / 2, 1], [d, w / 2, 0], [d, -w / 2, 0]]) {
      const nwin = Math.max(1, Math.floor(fw / 2.6));
      for (let fl = 0; fl < floors; fl++) for (let i = 0; i < nwin; i++) {
        const a = -fw / 2 + (fw / nwin) * (i + 0.5), yy = 1.2 + fl * 2.9;
        const local = (gx, gy, gz) => (sx ? new THREE.Vector3(a + gx, yy + gy, nz + Math.sign(nz) * gz) : new THREE.Vector3(nz + Math.sign(nz) * gz, yy + gy, a + gx));
        const g = new THREE.BoxGeometry(sx ? 0.9 : 0.06, 1.3, sx ? 0.06 : 0.9);
        g.translate(...local(0, 0.65, 0.03).toArray());
        shutGeos.push(g.applyMatrix4(m));
        const sg = new THREE.BoxGeometry(sx ? 1.1 : 0.12, 0.08, sx ? 0.12 : 1.1);
        sg.translate(...local(0, -0.04, 0.05).toArray());
        sillGeos.push(sg.applyMatrix4(m));
      }
    }
    if (bell) { // le clocheton de la chapelle
      const bg = new THREE.BoxGeometry(1.6, 3.2, 1.6).translate(w / 2 - 1, h + 1.6, 0);
      wallGeos[ci].push(bg.applyMatrix4(m));
      const cap = new THREE.ConeGeometry(1.25, 1.6, 4).rotateY(Math.PI / 4).translate(w / 2 - 1, h + 4, 0);
      roofGeos.push(cap.toNonIndexed().applyMatrix4(m));
    }
  };
  // Autour de l'aire d'arrivée, à l'écart de la piste et des arbres ; la chapelle sur un replat, plus haut.
  const sF = track.sFinish, spots = [];
  let placed = 0;
  for (let k = 0; k < 400 && placed < 9; k++) {
    const s = sF - 70 + rand() * 95, side = rand() < 0.5 ? -1 : 1;
    const w = 7 + rand() * 4, d = 6 + rand() * 3, h = 5.6 + rand() * 3.4;
    const f = frameAt(track, Math.min(s, track.length - 1), side * (track.tapeAt(s) + 9 + rand() * 30));
    const r = Math.hypot(w, d) / 2 + 1;
    const near = track.nearest(f.pos.x, f.pos.z, null, 0, 3);
    if (near.dist < track.tapeAt(near.s) + r + 3 || track.treeNear(f.pos.x, f.pos.z, r)) continue;
    if (spots.some((o) => Math.hypot(o.x - f.pos.x, o.z - f.pos.z) < o.r + r + 1.5)) continue;
    spots.push({ x: f.pos.x, z: f.pos.z, r });
    const y = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => track.groundY(f.pos.x + (a * w) / 2, f.pos.z + (b * d) / 2)));
    house(f.pos.x, f.pos.z, y, w, d, h, f.yaw + (rand() - 0.5) * 0.3, placed % colors.length);
    placed++;
  }
  for (let k = 0; k < 400; k++) {
    const s = 160 + rand() * 260, side = rand() < 0.5 ? -1 : 1;
    const f = frameAt(track, s, side * (track.tapeAt(s) + 18 + rand() * 25));
    const near = track.nearest(f.pos.x, f.pos.z, null, 0, 3);
    if (near.dist < track.tapeAt(near.s) + 12 || track.treeNear(f.pos.x, f.pos.z, 7)) continue;
    house(f.pos.x, f.pos.z, track.groundY(f.pos.x, f.pos.z) - 0.4, 9, 5.5, 6.5, f.yaw + Math.PI / 2, 3, true);
    break;
  }
  wallGeos.forEach((geos, i) => { if (geos.length) group.add(solid(geos, wallMats[i])); });
  if (roofGeos.length) group.add(solid(roofGeos.map((g) => (g.index ? g.toNonIndexed() : g)), roofMat));
  if (shutGeos.length) group.add(solid(shutGeos, shutterMat), solid(sillGeos, sillMat));
}

// ---------------------------------------------------------------------------------------------------------------
// 'ville' (Les Ruelles) : les maisons peintes qui bordent la descente (posées par la piste : track.buildings, ce sont
// aussi des obstacles), leurs fenêtres, volets, portes et balcons, quelques fresques ; les marches de pierre et leurs
// rampes, les murets des drops, les rues qu'on saute (asphalte, voitures garées), le passage voûté, les câbles et les
// fanions en travers des ruelles, des lanternes ; l'église en haut, des barques en bas.
// ---------------------------------------------------------------------------------------------------------------
function ville(track, group) {
  const rand = rng(track.seed + 818);
  const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const plaster = photo('crepi', 1 / 1.4);
  // Les couleurs des maisons : vives, comme dans les villes des collines au-dessus des ports du Pacifique.
  const COLORS = ['#e8473b', '#f2b134', '#3a8fd6', '#2fb37a', '#f07ca8', '#8a5bd1', '#f4e3c1', '#35c0c9', '#ff8c42', '#cfd84a', '#f6f1e7', '#5b6fd6'];
  const WHITE = 10;
  const wallMats = COLORS.map((c) => new THREE.MeshStandardMaterial({ ...plaster, color: lin(c), roughness: 0.95 }));
  const trimMat = new THREE.MeshStandardMaterial({ ...plaster, color: lin('#f3eee4'), roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: lin('#1b2329'), roughness: 0.08 });
  const ironMat = new THREE.MeshStandardMaterial({ color: lin('#222326'), roughness: 0.6, metalness: 0.4 });
  const doorMat = new THREE.MeshStandardMaterial({ ...photo('bois', 1), color: lin('#7a4a2c'), roughness: 0.85 });
  const SHUT = ['#2f6b4a', '#1f4f8a', '#a63b2c', '#f2ece0', '#2a8a8a', '#3b3b3b'];
  const shutMats = SHUT.map((c) => new THREE.MeshStandardMaterial({ color: lin(c), roughness: 0.7 }));
  const stoneMat = new THREE.MeshStandardMaterial({ ...photo('pierre', 1), color: lin('#d9d3c7'), roughness: 0.95, side: THREE.DoubleSide });
  const tiles = canvasTex(256, 256, (ctx, w, h) => {
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 24) {
      const g = ctx.createLinearGradient(x, 0, x + 24, 0);
      const l = 40 + ((x * 7 + y * 3) % 9);
      g.addColorStop(0, `hsl(14, 50%, ${l - 12}%)`); g.addColorStop(0.5, `hsl(17, 56%, ${l + 6}%)`); g.addColorStop(1, `hsl(14, 50%, ${l - 14}%)`);
      ctx.fillStyle = g; ctx.fillRect(x, y, 24, 32);
      ctx.fillStyle = 'rgba(40,15,5,0.35)'; ctx.fillRect(x, y + 29, 24, 3);
    }
  }, true);
  const roofMat = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.75, side: THREE.DoubleSide });
  // Des fresques peintes sur quelques façades.
  const PAL = ['#ffcf3f', '#ff5a4e', '#2bb3d6', '#38c07a', '#ff8fc2', '#6e4bd8', '#ffffff', '#152238'];
  const murals = [0, 1, 2, 3].map((k) => new THREE.MeshStandardMaterial({ roughness: 0.9, map: canvasTex(512, 256, (ctx, w, h) => {
    const r = rng(40 + k);
    ctx.fillStyle = PAL[k + 3]; ctx.fillRect(0, 0, w, h);
    if (k === 0) { // un soleil et des vagues
      ctx.fillStyle = PAL[0]; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.4, 70, 0, 7); ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = PAL[(i + 1) % 7]; ctx.lineWidth = 14; ctx.beginPath();
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h * 0.62 + i * 20 + Math.sin(x / 30 + i) * 10);
        ctx.stroke();
      }
    } else if (k === 1) { // des bandes en zigzag
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = PAL[i % 7]; ctx.beginPath();
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, i * 30 + ((x / 32) % 2) * 18);
        for (let x = w; x >= 0; x -= 32) ctx.lineTo(x, i * 30 + 26 + ((x / 32) % 2) * 18);
        ctx.fill();
      }
    } else if (k === 2) { // un visage, des confettis
      for (let i = 0; i < 40; i++) { ctx.fillStyle = PAL[Math.floor(r() * 7)]; ctx.beginPath(); ctx.arc(r() * w, r() * h, 6 + r() * 16, 0, 7); ctx.fill(); }
      ctx.fillStyle = PAL[0]; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 90, 110, 0, 0, 7); ctx.fill();
      ctx.fillStyle = PAL[7]; for (const x of [-35, 35]) { ctx.beginPath(); ctx.arc(w / 2 + x, h / 2 - 20, 14, 0, 7); ctx.fill(); }
      ctx.strokeStyle = PAL[1]; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(w / 2, h / 2 + 20, 40, 0.2, Math.PI - 0.2); ctx.stroke();
    } else { // des cercles et des triangles
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = PAL[Math.floor(r() * 7)];
        const x = r() * w, y = r() * h, s = 20 + r() * 60;
        ctx.beginPath();
        if (r() < 0.5) ctx.arc(x, y, s / 2, 0, 7); else { ctx.moveTo(x, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.lineTo(x - s / 2, y + s / 2); }
        ctx.fill();
      }
    }
  }) }));

  const walls = COLORS.map(() => []), trims = [], roofs = [], glass = [], irons = [], doors = [], shuts = SHUT.map(() => []), stones = [];
  const muralGeos = murals.map(() => []);

  // ----- Les maisons -----
  for (const b of track.buildings) {
    const q = new THREE.Quaternion().setFromAxisAngle(up, b.yaw);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y, b.z), q, one);
    const put = (g, arr) => arr.push(g.applyMatrix4(m));
    // (plus hautes qu'il ne faut pour l'obstacle : deux à quatre étages au-dessus de la rue)
    const H = b.h + 1.5 + b.hue * 4;
    const wg = new THREE.BoxGeometry(b.d, H, b.w).translate(0, H / 2, 0);
    const uvA = wg.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (uvA.getX(i) * Math.max(b.d, b.w)) / 3, (uvA.getY(i) * H) / 3);
    put(wg, walls[Math.floor(b.hue * 7919) % COLORS.length]);
    // Le toit : en terrasse, bordé d'une corniche claire (deux maisons sur trois), sinon de tuiles à deux pans.
    if (b.roof < 0.66) put(new THREE.BoxGeometry(b.d + 0.25, 0.35, b.w + 0.25).translate(0, H + 0.1, 0), trims);
    else {
      const rh = 1.4 + b.roof, ox = b.d / 2 + 0.4, oz = b.w / 2 + 0.3;
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute([-ox, 0, -oz, 0, rh, -oz, ox, 0, -oz, -ox, 0, oz, 0, rh, oz, ox, 0, oz], 3));
      rg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, rh, 0, 0, oz, 0, oz, rh, oz, 0].map((x) => x / 1.5), 2));
      rg.setIndex([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4, 0, 2, 1, 3, 4, 5]);
      rg.computeVertexNormals();
      put(rg.translate(0, H, 0).toNonIndexed(), roofs);
    }
    // Les façades sur les rues : celle qui donne sur la piste (côté -side, x local), et celle de derrière, sur la venelle.
    const shutArr = shuts[Math.floor(b.roof * 9973) % SHUT.length];
    for (const face of [-b.side, b.side]) {
      const fx = face * (b.d / 2);
      // Le sol de la rue devant la façade : les étages se règlent sur lui.
      const fw = new THREE.Vector3(fx + face * 0.6, 0, 0).applyQuaternion(q);
      const gy = track.groundY(b.x + fw.x, b.z + fw.z) - b.y;
      const nwin = Math.max(1, Math.floor(b.w / 2.5));
      const onTrack = face === -b.side && !b.row;
      for (let fl = 0; fl < 6; fl++) {
        const yy = gy + 1.4 + fl * 2.8;
        if (yy + 1.4 > H - 0.4) break;
        if (yy < 0.6) continue;
        for (let i = 0; i < nwin; i++) {
          const zc = -b.w / 2 + (b.w / nwin) * (i + 0.5);
          // Au rez-de-chaussée : une porte au milieu, sous un linteau clair.
          if (fl === 0 && i === Math.floor(nwin / 2)) {
            put(new THREE.BoxGeometry(0.12, 2.2, 1.1).translate(fx + face * 0.03, gy + 1.05, zc), doors);
            put(new THREE.BoxGeometry(0.14, 0.18, 1.4).translate(fx + face * 0.04, gy + 2.25, zc), trims);
            continue;
          }
          put(new THREE.BoxGeometry(0.06, 1.35, 1.0).translate(fx + face * 0.02, yy + 0.6, zc), trims); // l'encadrement
          put(new THREE.BoxGeometry(0.06, 1.15, 0.8).translate(fx + face * 0.035, yy + 0.6, zc), glass);
          if (rand() < 0.7) for (const k of [-1, 1]) put(new THREE.BoxGeometry(0.07, 1.25, 0.42).translate(fx + face * 0.05, yy + 0.6, zc + k * 0.66), shutArr);
          // Un balcon de fer forgé, aux étages.
          if (fl > 0 && rand() < (onTrack ? 0.3 : 0.12)) {
            put(new THREE.BoxGeometry(0.75, 0.1, 1.5).translate(fx + face * 0.38, yy - 0.15, zc), trims);
            put(new THREE.BoxGeometry(0.05, 0.05, 1.5).translate(fx + face * 0.74, yy + 0.8, zc), irons);
            for (let k = -3; k <= 3; k++) put(new THREE.BoxGeometry(0.03, 0.9, 0.03).translate(fx + face * 0.74, yy + 0.35, zc + k * 0.24), irons);
            for (const k of [-1, 1]) put(new THREE.BoxGeometry(0.72, 0.05, 0.04).translate(fx + face * 0.38, yy + 0.8, zc + k * 0.74), irons);
          }
        }
      }
      // Une fresque, sur quelques façades de la piste.
      if (onTrack && b.w > 7 && rand() < 0.16) {
        const mh = Math.min(3.6, H - gy - 3.2), mw = b.w * 0.75;
        if (mh > 1.8) put(new THREE.PlaneGeometry(mw, mh).rotateY(face * Math.PI / 2).translate(fx + face * 0.09, gy + 0.5 + mh / 2, 0), muralGeos[Math.floor(rand() * murals.length)]);
      }
    }
  }

  // ----- Les marches : des blocs de pierre d'une façade à l'autre, le dessus de chaque marche au ras du sol -----
  const rail = (a, b, r = 0.025) => {
    const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  for (const f of track.features.filter((f) => f.type === 'stairs')) {
    for (let s0 = f.a; s0 < f.b - 0.01; s0 += f.step) {
      const s1 = Math.min(f.b, s0 + f.step), fr = frameAt(track, (s0 + s1) / 2), half = track.tapeAt(s0) + 1.1;
      // (le dessus juste au-dessus du sol de la piste, sur toute la largeur : la trace est un peu creusée au milieu)
      const top = Math.max(...[-2, -1, 0, 1, 2].map((u) => track.trailY(s0 + 0.05, u))) + 0.02;
      stones.push(new THREE.BoxGeometry(half * 2, 0.7, s1 - s0 + 0.04).translate(0, -0.35, 0).rotateY(fr.yaw).translate(fr.pos.x, top, fr.pos.z));
      // le nez de la marche, en pierre claire : on voit où elle tombe
      const nose = frameAt(track, s1 - 0.09);
      trims.push(new THREE.BoxGeometry(half * 2, 0.08, 0.2).rotateY(fr.yaw).translate(nose.pos.x, top - 0.035, nose.pos.z));
    }
    // La rampe de fer, de chaque côté, sur des poteaux tous les 2 m.
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = f.a; s <= f.b + 0.01; s += 2) {
        const fr = frameAt(track, s, side * (track.tapeAt(s) + 0.35));
        const head = fr.pos.clone().add(new THREE.Vector3(0, 0.95, 0));
        irons.push(rail(fr.pos, head, 0.03));
        if (prev) irons.push(rail(prev, head));
        prev = head;
      }
    }
  }

  // ----- Les murets des drops : la face de pierre sous la lèvre, et un chapeau de pierre -----
  for (const f of track.features.filter((f) => f.type === 'jump' && f.look === 'muret')) {
    const half = track.tapeAt(f.lipS) + 1.1, fr = frameAt(track, f.lipS + 0.15);
    const top = track.trailY(f.lipS - 0.05, 0) + 0.03, bottom = track.trailY(f.lipS + f.knuckle + 0.6, 0) - 0.3;
    stones.push(new THREE.BoxGeometry(half * 2, top - bottom, 0.5).translate(0, (top - bottom) / 2, 0).rotateY(fr.yaw).translate(fr.pos.x, bottom, fr.pos.z));
    trims.push(new THREE.BoxGeometry(half * 2, 0.12, 0.6).rotateY(fr.yaw).translate(fr.pos.x, top - 0.06, fr.pos.z));
  }

  // ----- Les rues qu'on saute : de l'asphalte, une ligne blanche, des voitures garées -----
  const asphalt = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3c3d40'; ctx.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 4000; i++) { const v = 40 + r() * 50; ctx.fillStyle = `rgb(${v},${v},${v + 3})`; ctx.fillRect(r() * w, r() * h, 1.5, 1.5); }
    ctx.fillStyle = '#e8e4d8'; ctx.fillRect(w / 2 - 4, 0, 8, h / 2);
  }, true);
  const carCols = ['#c62f2f', '#f2f2ee', '#2b4f8c', '#e3b23c', '#1f1f22', '#7fa7b8', '#3f7a52'].map((c) => new THREE.MeshStandardMaterial({ color: lin(c), roughness: 0.35, metalness: 0.3 }));
  const carGeos = carCols.map(() => []), tyres = [];
  for (const f of track.features.filter((f) => f.type === 'jump' && f.look === 'rue')) {
    const sRoad = f.lipS + f.knuckle / 2, fr = frameAt(track, sRoad);
    const half = Math.min(2.6, f.knuckle / 2 - 0.3), L = 60, n = 120;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = -L / 2 + (i / n) * L;
      for (const w of [-half, half]) {
        const x = fr.pos.x + fr.right.x * t + fr.fwd.x * w, z = fr.pos.z + fr.right.z * t + fr.fwd.z * w;
        pos.push(x, track.groundY(x, z) + 0.04, z);
        uv.push(w / (2 * half) + 0.5, t / 6);
      }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    road.receiveShadow = true;
    group.add(road);
    // Des voitures garées le long de la rue, loin de la piste.
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1, t = side * (track.tapeAt(sRoad) + 3.5 + rand() * 12);
      const x = fr.pos.x + fr.right.x * t + fr.fwd.x * (half - 1.1), z = fr.pos.z + fr.right.z * t + fr.fwd.z * (half - 1.1);
      if (track.insideBuilding(x, z, 2.2)) continue;
      const cm = new THREE.Matrix4().compose(new THREE.Vector3(x, track.groundY(x, z), z), new THREE.Quaternion().setFromAxisAngle(up, fr.yaw + Math.PI / 2), one);
      const arr = carGeos[Math.floor(rand() * carCols.length)];
      arr.push(new THREE.BoxGeometry(1.75, 0.7, 4.1).translate(0, 0.6, 0).applyMatrix4(cm));
      arr.push(new THREE.BoxGeometry(1.55, 0.55, 2.1).translate(0, 1.22, -0.2).applyMatrix4(cm));
      glass.push(new THREE.BoxGeometry(1.58, 0.42, 2.0).translate(0, 1.22, -0.2).applyMatrix4(cm));
      for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) tyres.push(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12).rotateZ(Math.PI / 2).translate(wx, 0.33, wz).applyMatrix4(cm));
    }
  }

  // ----- Le passage voûté : la rue passe sous une maison -----
  for (const f of track.features.filter((f) => f.type === 'arch')) {
    const sm = (f.a + f.b) / 2, fr = frameAt(track, sm), len = f.b - f.a;
    const pitch = Math.atan2(track.trailY(f.a, 0) - track.trailY(f.b, 0), len);
    const half = track.tapeAt(sm) + 0.6, base = 2.3;
    const am = new THREE.Matrix4().compose(fr.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, fr.yaw, 0, 'YXZ')), one);
    // la voûte, les deux murs qui la portent, et la maison au-dessus
    stones.push(new THREE.CylinderGeometry(half, half, len, 18, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, base, 0).toNonIndexed().applyMatrix4(am));
    for (const side of [-1, 1]) stones.push(new THREE.BoxGeometry(0.5, base + 0.6, len).translate(side * (half + 0.25), (base + 0.6) / 2 - 0.6, 0).applyMatrix4(am));
    walls[1].push(new THREE.BoxGeometry(half * 2 + 1.6, 4.5, len + 0.6).translate(0, base + half + 2.2, 0).applyMatrix4(am));
    trims.push(new THREE.BoxGeometry(half * 2 + 1.9, 0.3, len + 0.9).translate(0, base + half + 4.5, 0).applyMatrix4(am));
  }

  // ----- Les câbles et les fanions, d'une façade à l'autre ; des lanternes aux murs -----
  const cablePts = [], flagPos = [], flagCol = [];
  const flagCols = ['#e8473b', '#f2b134', '#3a8fd6', '#2fb37a', '#f07ca8', '#ffffff'].map((c) => new THREE.Color(c).convertSRGBToLinear());
  for (let s = track.sStart + 20; s < track.sFinish - 30; s += 9 + rand() * 7) {
    if (track.features.some((f) => f.type === 'arch' && s > f.a - 3 && s < f.b + 3)) continue;
    const u = track.tapeAt(s) + 1.2;
    const a = frameAt(track, s, -u).pos, b = frameAt(track, s + (rand() - 0.5) * 3, u).pos;
    const ya = Math.max(a.y, b.y) + 5 + rand() * 1.8, sag = 0.4 + rand() * 0.3;
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, ya - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t)); }
    for (let i = 0; i < 12; i++) cablePts.push(pts[i], pts[i + 1]);
    // Une fois sur deux, des fanions accrochés au câble.
    if (rand() < 0.55) {
      for (let i = 0; i < 12; i++) {
        const p0 = pts[i], p1 = pts[i + 1], mid = p0.clone().lerp(p1, 0.5);
        flagPos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, mid.x, mid.y - 0.42, mid.z);
        const c = flagCols[(i + Math.floor(s)) % flagCols.length];
        for (let k = 0; k < 3; k++) flagCol.push(c.r, c.g, c.b);
      }
    }
  }
  if (cablePts.length) group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cablePts), new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
  if (flagPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flagPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(flagCol, 3));
    g.computeVertexNormals();
    const flags = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }));
    flags.castShadow = true;
    group.add(flags);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: lin('#fff1c8'), emissive: lin('#ffcf7a'), emissiveIntensity: 0.6, roughness: 0.4 });
  const lamps = [];
  for (let s = track.sStart + 25, side = 1; s < track.sFinish - 30; s += 14 + rand() * 8, side = -side) {
    const fr = frameAt(track, s, side * (track.tapeAt(s) + 0.9));
    const wx = fr.pos.x + fr.right.x * side * 0.9, wz = fr.pos.z + fr.right.z * side * 0.9;
    if (!track.insideBuilding(wx, wz, 0.1)) continue; // (accrochée à une façade)
    const y = fr.pos.y + 3.6;
    irons.push(rail(new THREE.Vector3(wx, y + 0.3, wz), new THREE.Vector3(fr.pos.x, y + 0.3, fr.pos.z), 0.03));
    lamps.push(new THREE.BoxGeometry(0.24, 0.36, 0.24).translate(fr.pos.x, y, fr.pos.z));
    irons.push(new THREE.ConeGeometry(0.22, 0.2, 4).rotateY(Math.PI / 4).translate(fr.pos.x, y + 0.28, fr.pos.z));
  }

  // ----- L'église, au-dessus du départ : une façade blanche, un clocher, un toit de tuiles -----
  {
    const f0 = track.sample(track.controlS[0]);
    const cx = f0.x - f0.tx * 22, cz = f0.z - f0.tz * 22, yaw = Math.atan2(-f0.tx, -f0.tz);
    const y = Math.min(...[[-7, -10], [7, -10], [7, 10], [-7, 10]].map(([a, b]) => track.groundY(cx + a, cz + b))) - 0.5;
    const cm = new THREE.Matrix4().compose(new THREE.Vector3(cx, y, cz), new THREE.Quaternion().setFromAxisAngle(up, yaw), one);
    walls[WHITE].push(new THREE.BoxGeometry(12, 11, 18).translate(0, 5.5, 0).applyMatrix4(cm));
    walls[WHITE].push(new THREE.BoxGeometry(4.5, 22, 4.5).translate(4.5, 11, -7.5).applyMatrix4(cm));
    roofs.push(new THREE.ConeGeometry(3.6, 4, 4).rotateY(Math.PI / 4).translate(4.5, 24, -7.5).toNonIndexed().applyMatrix4(cm));
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute([-6.4, 0, -9.3, 0, 3.4, -9.3, 6.4, 0, -9.3, -6.4, 0, 9.3, 0, 3.4, 9.3, 6.4, 0, 9.3], 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 3, 0, 0, 6, 0, 6, 3, 6, 0], 2));
    rg.setIndex([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4, 0, 2, 1, 3, 4, 5]);
    rg.computeVertexNormals();
    roofs.push(rg.translate(0, 11, 0).toNonIndexed().applyMatrix4(cm));
    // la grande porte, la rosace, les ouvertures des cloches (la façade regarde la descente : -z local)
    doors.push(new THREE.BoxGeometry(2.2, 3.6, 0.2).translate(-1.5, 1.8, -9.05).applyMatrix4(cm));
    glass.push(new THREE.CylinderGeometry(1.1, 1.1, 0.2, 20).rotateX(Math.PI / 2).translate(-1.5, 7, -9.05).applyMatrix4(cm));
    for (const [x, z, ry] of [[4.5, -9.8, 0], [4.5, -5.2, 0], [2.2, -7.5, Math.PI / 2], [6.8, -7.5, Math.PI / 2]]) glass.push(new THREE.BoxGeometry(1.4, 2.4, 0.2).rotateY(ry).translate(x, 18, z).applyMatrix4(cm));
  }

  // ----- Le quai : une place pavée de part et d'autre de la piste (droite ici), jusqu'au mur qui tombe dans le port -----
  if (track.village && track.village.plaza != null) {
    const f = track.sample(track.village.plaza + 1), HALF = 40, LEN = track.length - track.village.plaza + 18;
    const pavers = canvasTex(512, 512, (ctx, w, h) => {
      const r = rng(23);
      ctx.fillStyle = '#4a4640'; ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = 118 + r() * 42;
        ctx.fillStyle = `rgb(${v},${v * 0.95},${v * 0.88})`;
        ctx.fillRect(x * 64 + (y % 2) * 32 + 2, y * 64 + 2, 60, 60);
        if (y % 2 && x === 7) ctx.fillRect(2 - 32, y * 64 + 2, 60, 60);
      }
    }, true);
    const paving = new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.95 });
    for (const side of [-1, 1]) {
      const pos = [], uv = [], idx = [], nu = 22, nt = Math.ceil(LEN / 2);
      for (let i = 0; i <= nt; i++) for (let j = 0; j <= nu; j++) {
        const t = (i / nt) * LEN, u = side * (4.2 + (j / nu) * (HALF - 4.2));
        const x = f.x + f.tx * t + f.rx * u, z = f.z + f.tz * t + f.rz * u;
        pos.push(x, track.groundY(x, z) + 0.1, z);
        uv.push(u / 2.4, t / 2.4);
      }
      for (let i = 0; i < nt; i++) for (let j = 0; j < nu; j++) {
        const a = i * (nu + 1) + j, b = a + 1, c = a + nu + 1, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, paving);
      m.receiveShadow = true;
      group.add(m);
    }
    // Le bout du quai : la bande sous la fin de la piste, et le mur de pierre, jusqu'à l'eau.
    const yEnd = track.groundY(f.x + f.tx * LEN, f.z + f.tz * LEN) + 0.1, yaw = Math.atan2(-f.tx, -f.tz);
    const seaLevel = track.map.env.sea ? track.map.env.sea.level : yEnd - 6;
    stones.push(new THREE.BoxGeometry(HALF * 2, yEnd - seaLevel + 2, 1.2).translate(0, -(yEnd - seaLevel + 2) / 2, 0).rotateY(yaw).translate(f.x + f.tx * LEN, yEnd, f.z + f.tz * LEN));
  }

  // ----- Le port : des barques sur l'eau, au large du quai -----
  const sea = track.map.env.sea;
  if (sea) {
    const hullCols = ['#f2f2ee', '#2b6cb0', '#c0392b', '#2fa36b', '#f1c40f'].map((c) => new THREE.MeshStandardMaterial({ color: lin(c), roughness: 0.6 }));
    const fl = track.sample(track.length - 1);
    for (let k = 0; k < 14; k++) {
      const x = fl.x + (rand() - 0.5) * 140, z = fl.z - 50 - rand() * 110;
      if (track.groundY(x, z) > sea.level - 0.5) continue;
      const bm = new THREE.Matrix4().compose(new THREE.Vector3(x, sea.level, z), new THREE.Quaternion().setFromAxisAngle(up, rand() * 6), one);
      const L = 5 + rand() * 4;
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.6, L, 8, 1).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.1, 0).applyMatrix4(bm), hullCols[k % hullCols.length]);
      hull.castShadow = true;
      group.add(hull);
      if (k % 2) group.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.6).translate(0, 0.9, -0.5).applyMatrix4(bm), hullCols[0]));
    }
  }

  // (la pierre : ses coordonnées de texture en mètres, d'après la position, pour qu'elle ne soit pas étirée sur une
  // marche de 5 m de large)
  const worldUV = (g, size) => {
    g = g.index ? g.toNonIndexed() : g;
    const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
      if (ny > 0.6) uv.setXY(i, x / size, z / size);
      else uv.setXY(i, (nx > 0.7 ? z : x) / size, y / size);
    }
    return g;
  };
  for (let i = 0; i < stones.length; i++) stones[i] = worldUV(stones[i], 1.6);
  walls.forEach((g, i) => { if (g.length) group.add(solid(g, wallMats[i])); });
  shuts.forEach((g, i) => { if (g.length) group.add(solid(g, shutMats[i])); });
  muralGeos.forEach((g, i) => { if (g.length) { const mm = new THREE.Mesh(mergeGeometries(g), murals[i]); mm.receiveShadow = true; group.add(mm); } });
  for (const [g, mat] of [[trims, trimMat], [roofs, roofMat], [glass, glassMat], [irons, ironMat], [doors, doorMat], [stones, stoneMat], [tyres, ironMat], [lamps, lampMat]]) {
    if (g.length) group.add(solid(g.map((x) => (x.index ? x.toNonIndexed() : x)), mat));
  }
  carGeos.forEach((g, i) => { if (g.length) group.add(solid(g.map((x) => (x.index ? x.toNonIndexed() : x)), carCols[i])); });
}
