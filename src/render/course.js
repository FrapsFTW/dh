// L'habillage de la course : rubalise (ou piquets sur un glacier), cabane de départ, arches de chrono, radar, aire
// d'arrivée et public, protections sur les arbres, panneaux de virage, les routes, et les cailloux et racines de la
// piste (posés exactement là où la physique les a mis). Sur L'Avalanche : séracs, gué, maisons du village, fontaine.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../sim/noise.js';
import { TAPE_U, TRAIL_HALF } from '../sim/track.js';
import { rockGeometry, rockMaterial, iceMaterial } from './rocks.js';
import { NOISE_GLSL } from './glsl.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { tex: t, canvas: cv };
}

/** Une banderole : texte blanc sur fond de couleur, avec une bande plus sombre en bas. */
function bannerTexture(text, bg, fg = '#ffffff', w = 1024, h = 192) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, h * 0.84, w, h * 0.16);
    ctx.fillStyle = fg;
    ctx.font = `900 ${Math.round(h * 0.56)}px "Arial Black", Impact, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h * 0.46, w * 0.92);
  }).tex;
}

/** Repère local d'un point de la piste : position au sol, avant, droite. */
function frameAt(track, s, u = 0) {
  const f = track.sample(s);
  return {
    pos: new THREE.Vector3(f.x + u * f.rx, track.trailY(s, u), f.z + u * f.rz),
    fwd: new THREE.Vector3(f.tx, 0, f.tz),
    right: new THREE.Vector3(f.rx, 0, f.rz),
    yaw: Math.atan2(-f.tx, -f.tz),
  };
}

// Un spectateur, 1,75 m environ, en quatre postures (bras le long du corps, mains sur les hanches, un bras levé qui
// encourage, le téléphone tendu pour filmer). Des volumes tournés (bassin, buste, épaules, cuisses, mollets), des mains,
// des chaussures, des cheveux ou une casquette. Les couleurs viennent des sommets ; l'attribut « veste » dit ce qui
// prend la couleur de chacun (la veste), le reste garde la sienne (peau, pantalon, cheveux).
const SKINS = ['#e0b394', '#c99671', '#8d5a3b', '#f0c9aa'].map(lin);
const PANTS = ['#2a3446', '#1d1f24', '#5d5444', '#3c4f6b'].map(lin);
const HAIR = ['#2a1d14', '#5a3a1e', '#b48a52', '#1a1a1a'].map(lin);
function personGeometry(pose, look) {
  const parts = [];
  const paint = (g, c, jacket = 0) => {
    const n = g.attributes.position.count, arr = new Float32Array(n * 3), m = new Float32Array(n).fill(jacket);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.setAttribute('jacket', new THREE.BufferAttribute(m, 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  // Un volume tourné d'après un profil [[rayon, hauteur], …], aplati en profondeur.
  const lathe = (profile, depth = 0.72, seg = 12) => {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    g.scale(1, 1, depth);
    return g;
  };
  // Un membre : un tronc de cône d'un point à un autre.
  const limb = (a, b, ra, rb) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(rb, ra, len, 8, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
  };
  const ball = (p, r, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 10, 8); g.scale(sx, sy, sz); g.translate(p.x, p.y, p.z); return g; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const skin = SKINS[look % SKINS.length], pants = PANTS[(look >> 1) % PANTS.length], hair = HAIR[(look + 1) % HAIR.length], white = new THREE.Color(1, 1, 1);
  const shoe = lin('#2b2b2b');

  // Les jambes, un peu écartées, et les chaussures.
  for (const s of [-1, 1]) {
    const hip = V(s * 0.095, 0.93, 0), knee = V(s * 0.11, 0.5, 0.02), ankle = V(s * 0.12, 0.09, 0);
    paint(limb(hip, knee, 0.085, 0.058), pants);
    paint(ball(knee, 0.058), pants);
    paint(limb(knee, ankle, 0.058, 0.042), pants);
    const foot = new THREE.BoxGeometry(0.1, 0.08, 0.26, 1, 1, 2); foot.translate(s * 0.12, 0.045, 0.05); paint(foot, shoe);
  }
  // Le bassin et le buste (la veste), le cou.
  paint(lathe([[0.001, 0.86], [0.15, 0.88], [0.165, 0.98], [0.15, 1.04]]), pants);
  paint(lathe([[0.15, 1.0], [0.145, 1.08], [0.165, 1.22], [0.19, 1.36], [0.185, 1.43], [0.11, 1.48], [0.001, 1.49]]), white, 1);
  paint(limb(V(0, 1.45, 0), V(0, 1.55, 0.01), 0.05, 0.048), skin);
  // La tête, et des cheveux ou une casquette.
  paint(ball(V(0, 1.64, 0.01), 0.1, 0.95, 1.18, 1.05), skin);
  if (look % 3 === 2) {
    const cap = new THREE.SphereGeometry(0.106, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5); cap.scale(1, 0.8, 1.05); cap.translate(0, 1.67, 0.005); paint(cap, white, 1);
    const visor = new THREE.CylinderGeometry(0.08, 0.08, 0.012, 10, 1, false, -Math.PI / 2, Math.PI); visor.scale(1, 1, 1.1); visor.translate(0, 1.672, 0.07); paint(visor, white, 1);
  } else {
    const h = new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62); h.scale(0.97, 1.15, 1.06); h.translate(0, 1.645, -0.008); paint(h, hair);
  }
  // Les bras selon la posture.
  const arm = (s, elbow, wrist) => {
    const sh = V(s * 0.2, 1.42, 0);
    paint(ball(sh, 0.062), white, 1);
    paint(limb(sh, elbow, 0.058, 0.046), white, 1);
    paint(ball(elbow, 0.046), white, 1);
    paint(limb(elbow, wrist, 0.046, 0.036), white, 1);
    paint(ball(wrist.clone().add(V(0, -0.02, 0)), 0.042, 0.8, 1.2, 0.9), skin);
  };
  for (const s of [-1, 1]) {
    if (pose === 0) arm(s, V(s * 0.24, 1.14, -0.01), V(s * 0.23, 0.86, 0.04));
    else if (pose === 1) arm(s, V(s * 0.36, 1.16, -0.04), V(s * 0.17, 1.0, 0.03));
    else if (pose === 2) {
      if (s === 1) arm(s, V(0.3, 1.66, 0.05), V(0.33, 1.92, 0.08));
      else arm(s, V(-0.24, 1.14, -0.01), V(-0.23, 0.86, 0.04));
    } else {
      // Le téléphone, tendu à hauteur des yeux.
      arm(s, V(s * 0.17, 1.28, 0.24), V(s * 0.045, 1.5, 0.4));
      if (s === 1) { const ph = new THREE.BoxGeometry(0.075, 0.14, 0.012); ph.translate(0, 1.55, 0.42); paint(ph, lin('#1b1c1f')); }
    }
  }
  return mergeGeometries(parts);
}

export function createCourse(sim, sunDir, { groundTextures = null } = {}) {
  const { track } = sim;
  const group = new THREE.Group();
  group.name = 'course';
  const rand = rng(track.seed + 202);
  const dynamic = []; // ce qui bouge (rubalise au vent, écrans)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const arena = track.features.find((f) => f.type === 'arena');
  const startRamp = track.features.find((f) => f.type === 'startRamp');

  const wood = new THREE.MeshStandardMaterial({ color: lin('#8a6a46'), roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: lin('#5a4330'), roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ color: lin('#c9ccd1'), roughness: 0.4, metalness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: lin('#1c1d20'), roughness: 0.6 });

  // ---------- La rubalise ----------
  const stripes = canvasTex(64, 16, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8231b';
    for (let x = -h; x < w + h; x += 32) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 16, h); ctx.lineTo(x + 16 + h, 0); ctx.lineTo(x + h, 0); ctx.fill(); }
  }, true).tex;
  const tapeMat = new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 0.6 });
  tapeMat.userData.time = { value: 0 };
  tapeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = tapeMat.userData.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float flex;\nattribute vec3 side;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float w = sin(uTime * 7.0 + position.x * 0.9 + position.z * 0.7) + 0.5 * sin(uTime * 13.0 + position.z * 2.1);
transformed += side * w * 0.035 * flex;
transformed.y += w * 0.01 * flex;`);
  };
  dynamic.push((t) => { tapeMat.userData.time.value = t; });
  const stakeGeo = new THREE.CylinderGeometry(0.018, 0.022, 1.0, 5); stakeGeo.translate(0, 0.5, 0);
  const stakeMats = [], poleMats = [];
  const tapePos = [], tapeUV = [], tapeFlex = [], tapeSide = [], tapeIdx = [];
  const sEnd = arena ? arena.a + 4 : track.length;
  // Sur un pont, ce sont ses garde-corps : la rubalise s'interrompt.
  const nearBridge = (s) => track.bridges.some((f) => s > f.a - 3 && s < f.b + 3);
  for (const sideSign of [-1, 1]) {
    let len = 0, prev = null, base = tapePos.length / 3;
    const spacing = 4;
    const closeRun = () => {
      const count = tapePos.length / 3 - base;
      for (let i = 0; i < count / 2 - 1; i++) {
        const a = base + i * 2;
        tapeIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      base = tapePos.length / 3;
      prev = null;
    };
    for (let s = startRamp.b + 1; s < sEnd; s += spacing) {
      if (nearBridge(s)) { if (prev) closeRun(); continue; }
      // Un tronçon large (le glacier) : des piquets orange tous les 8 m, sans rubalise.
      const tw = track.tapeAt(s);
      if (tw > 5.5) {
        if (prev) closeRun();
        if (Math.round(s / spacing) % 2 === 0) {
          const fr = frameAt(track, s, sideSign * tw);
          poleMats.push(m4.compose(fr.pos, q.setFromAxisAngle(up, rand() * 6), sc.set(1, 0.95 + rand() * 0.1, 1)).clone());
        }
        continue;
      }
      const u = sideSign * tw;
      const fr = frameAt(track, s, u);
      stakeMats.push(m4.compose(fr.pos, q.identity(), sc.set(1, 0.9 + rand() * 0.15, 1)).clone());
      const top = fr.pos.clone().add(new THREE.Vector3(0, 0.82, 0));
      if (prev) {
        // Quatre petits segments par portée, avec un peu de mou au milieu.
        for (let k = 1; k <= 4; k++) {
          const t = k / 4;
          const pt = prev.clone().lerp(top, t);
          pt.y -= Math.sin(t * Math.PI) * 0.05;
          len += prev.distanceTo(top) / 4;
          const flex = Math.sin(t * Math.PI);
          for (const dy of [0, 0.055]) { tapePos.push(pt.x, pt.y + dy, pt.z); tapeUV.push(len / 0.6, dy > 0 ? 1 : 0); tapeFlex.push(flex); tapeSide.push(fr.right.x, 0, fr.right.z); }
        }
      } else {
        for (const dy of [0, 0.055]) { tapePos.push(top.x, top.y + dy, top.z); tapeUV.push(0, dy > 0 ? 1 : 0); tapeFlex.push(0); tapeSide.push(fr.right.x, 0, fr.right.z); }
      }
      prev = top;
    }
    closeRun();
  }
  const tapeGeo = new THREE.BufferGeometry();
  tapeGeo.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3));
  tapeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tapeUV, 2));
  tapeGeo.setAttribute('flex', new THREE.Float32BufferAttribute(tapeFlex, 1));
  tapeGeo.setAttribute('side', new THREE.Float32BufferAttribute(tapeSide, 3));
  tapeGeo.setIndex(tapeIdx);
  tapeGeo.computeVertexNormals();
  const tape = new THREE.Mesh(tapeGeo, tapeMat);
  tape.castShadow = true;
  group.add(tape);
  const stakes = new THREE.InstancedMesh(stakeGeo, new THREE.MeshStandardMaterial({ color: lin('#e8e8e4'), roughness: 0.5 }), stakeMats.length);
  stakeMats.forEach((m, i) => stakes.setMatrixAt(i, m));
  stakes.castShadow = true;
  group.add(stakes);
  if (poleMats.length) {
    // Les piquets de balisage : orange, la tête noire, 1,6 m.
    const poleGeo = new THREE.CylinderGeometry(0.025, 0.03, 1.6, 6);
    poleGeo.translate(0, 0.8, 0);
    const pc = [], orange = lin('#f06a12'), dark = lin('#16181b');
    for (let i = 0; i < poleGeo.attributes.position.count; i++) { const c = poleGeo.attributes.position.getY(i) > 1.35 ? dark : orange; pc.push(c.r, c.g, c.b); }
    poleGeo.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), poleMats.length);
    poleMats.forEach((m, i) => poles.setMatrixAt(i, m));
    poles.castShadow = true;
    group.add(poles);
  }

  // ---------- Les cailloux du pierrier et les racines, là où la physique les a mis ----------
  const rockGeo = rockGeometry(11, { detail: 2, cuts: 6 });
  const rockMat = rockMaterial(groundTextures, { moss: 0.15, alpine: track.map.env.treeline != null });
  const wetRock = rockMaterial(groundTextures, { moss: 0, wet: true });
  if (track.rocks.length) {
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, track.rocks.length);
    track.rocks.forEach((rk, i) => {
      const fr = frameAt(track, rk.s, rk.u);
      // Le sommet du caillou à la hauteur de la bosse de la physique.
      q.setFromAxisAngle(up, rk.seed * 20);
      rocks.setMatrixAt(i, m4.compose(p.copy(fr.pos).add(new THREE.Vector3(0, -rk.h * 0.12, 0)), q, sc.set(rk.r * 0.95, rk.h * 1.15, rk.r * 0.9)));
    });
    rocks.castShadow = rocks.receiveShadow = true;
    group.add(rocks);
  }
  const rootGeos = [];
  for (const r of track.roots) {
    const pts = [];
    for (let u = r.u0 - 0.4; u <= r.u1 + 0.4; u += 0.25) {
      const s = r.s + r.skew * u;
      const f = track.sample(s);
      const inside = u >= r.u0 && u <= r.u1;
      const y = track.trailY(s, u) - (inside ? r.r * 0.75 : r.r * 1.6);
      pts.push(new THREE.Vector3(f.x + u * f.rx, y, f.z + u * f.rz));
    }
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    rootGeos.push(new THREE.TubeGeometry(curve, pts.length * 2, r.r * 0.85, 6, false));
  }
  if (rootGeos.length) {
    const roots = new THREE.Mesh(mergeGeometries(rootGeos), new THREE.MeshStandardMaterial({ color: lin('#5b4632'), roughness: 0.8 }));
    roots.castShadow = roots.receiveShadow = true;
    group.add(roots);
  }

  // ---------- La lèvre du drop : une dalle de rocher ----------
  for (const f of track.features.filter((f) => f.type === 'jump' && f.kind === 'drop' && f.look !== 'terre')) {
    for (let u = -TRAIL_HALF - 0.6; u <= TRAIL_HALF + 0.6; u += 0.9) {
      const fr = frameAt(track, f.lipS - 0.2, u);
      const r = 0.55 + rand() * 0.25;
      q.setFromEuler(new THREE.Euler(0, rand() * 6, 0));
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.copy(fr.pos).add(new THREE.Vector3(0, -0.62, 0));
      m.quaternion.copy(q);
      m.scale.set(r, 0.62, r * 0.8);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------- La route forestière du road gap ----------
  const gravel = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9a8f80'; ctx.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < 2600; i++) {
      const v = 110 + r() * 90;
      ctx.fillStyle = `rgb(${v},${v * 0.95},${v * 0.88})`;
      ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.8 + r() * 2.2, 0, 7); ctx.fill();
    }
  }, true).tex;
  gravel.repeat.set(1, 1);
  for (const f of track.features.filter((f) => f.type === 'jump' && f.kind === 'gap')) {
    const sRoad = f.lipS + f.knuckle / 2;
    const fr = frameAt(track, sRoad);
    const pos = [], uv = [], idx = [];
    const half = 2.1, L = 70, n = 140;
    for (let i = 0; i <= n; i++) {
      const t = -L / 2 + (i / n) * L;
      for (const w of [-half, half]) {
        const x = fr.pos.x + fr.right.x * t + fr.fwd.x * w, z = fr.pos.z + fr.right.z * t + fr.fwd.z * w;
        pos.push(x, track.groundY(x, z) + 0.05, z);
        uv.push(w / 4, t / 4);
      }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    road.receiveShadow = true;
    group.add(road);
  }

  // ---------- Les ponts : tablier en planches, garde-corps, pieux jusqu'au lit du torrent, culées en pierre ----------
  const plankTex = canvasTex(256, 256, (ctx, w2, h2) => {
    for (let i = 0; i < 8; i++) {
      const v = 112 + ((i * 37) % 44);
      ctx.fillStyle = `rgb(${v + 18},${v * 0.8},${v * 0.56})`; ctx.fillRect(0, i * 32, w2, 30);
      ctx.fillStyle = 'rgba(40,25,10,0.65)'; ctx.fillRect(0, i * 32 + 30, w2, 2);
      ctx.fillStyle = 'rgba(30,20,10,0.5)';
      for (const x of [18, w2 - 22]) { ctx.beginPath(); ctx.arc(x, i * 32 + 15, 2.2, 0, 7); ctx.fill(); } // les clous
    }
  }, true).tex;
  for (const f of track.bridges) {
    const HALF = 1.9, a = f.a - 1.5, b = f.b + 1.5;
    const deckY = (s, u) => track.trailY(s, Math.max(-1.7, Math.min(1.7, u))) + 0.05;
    // Le tablier, et ses rives (une poutre de 30 cm de chaque côté).
    const dpos = [], duv = [], didx = [];
    let k = 0;
    for (let s = a; s <= b + 0.01; s += 0.5, k++) {
      for (const [u, dy] of [[-HALF, -0.3], [-HALF, 0], [HALF, 0], [HALF, -0.3]]) {
        const fr = frameAt(track, s, u);
        dpos.push(fr.pos.x, deckY(s, u) + dy, fr.pos.z); duv.push(u / 3.8 + 0.5 + dy, s / 2);
      }
      if (k > 0) {
        const o = (k - 1) * 4;
        for (const [p0, p1] of [[0, 1], [1, 2], [2, 3]]) didx.push(o + p0, o + p1, o + p0 + 4, o + p1, o + p1 + 4, o + p0 + 4);
      }
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
    dgeo.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
    dgeo.setIndex(didx);
    dgeo.computeVertexNormals();
    const deck = new THREE.Mesh(dgeo, new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.85, side: THREE.DoubleSide }));
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    // Les garde-corps : un poteau tous les 1,6 m, une main courante et une lisse.
    const posts = [];
    for (const side of [-1, 1]) {
      const top = [], mid = [];
      for (let s = a + 0.3; s <= b - 0.2; s += 1.6) {
        const fr = frameAt(track, s, side * (HALF - 0.08));
        const y0 = deckY(s, side * HALF);
        posts.push(m4.compose(p.set(fr.pos.x, y0 + 0.52, fr.pos.z), q.identity(), sc.set(1, 1, 1)).clone());
        top.push(new THREE.Vector3(fr.pos.x, y0 + 1.04, fr.pos.z));
        mid.push(new THREE.Vector3(fr.pos.x, y0 + 0.55, fr.pos.z));
      }
      for (const [pts, r] of [[top, 0.05], [mid, 0.035]]) {
        const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, r, 6), woodDark);
        rail.castShadow = true;
        group.add(rail);
      }
    }
    const postGeo = new THREE.BoxGeometry(0.11, 1.08, 0.11);
    const postMesh = new THREE.InstancedMesh(postGeo, woodDark, posts.length);
    posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
    postMesh.castShadow = true;
    group.add(postMesh);
    // Les pieux, jusqu'au lit du torrent, et une traverse sous le tablier.
    for (const t of [0.3, 0.7]) {
      const s = f.a + (f.b - f.a) * t;
      for (const side of [-1, 1]) {
        const fr = frameAt(track, s, side * 1.45);
        const top = deckY(s, side * 1.45) - 0.3, bottom = track.natural(fr.pos.x, fr.pos.z) - 0.4;
        const h = Math.max(0.5, top - bottom);
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, h, 8), woodDark);
        pile.position.set(fr.pos.x, bottom + h / 2, fr.pos.z);
        pile.castShadow = true;
        group.add(pile);
      }
      const fr = frameAt(track, s);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 0.2), woodDark);
      beam.position.set(fr.pos.x, deckY(s, 0) - 0.42, fr.pos.z);
      beam.rotation.y = fr.yaw;
      group.add(beam);
    }
    // Les culées : de gros blocs aux deux bouts, de chaque côté.
    for (const s of [f.a - 1, f.b + 1]) {
      for (const side of [-1, 1]) {
        for (let k2 = 0; k2 < 3; k2++) {
          const fr = frameAt(track, s + (rand() - 0.5) * 2, side * (2.3 + rand() * 1.2));
          const r = 0.6 + rand() * 0.5;
          const m = new THREE.Mesh(rockGeo, rockMat);
          m.position.copy(fr.pos).add(new THREE.Vector3(0, -r * 0.4, 0));
          m.rotation.y = rand() * 6;
          m.scale.set(r, r * 0.8, r);
          m.castShadow = m.receiveShadow = true;
          group.add(m);
        }
      }
    }
  }

  // ---------- Le torrent : de l'eau qui file au fond de son ravin ----------
  if (track.map.creek) {
    const pts = track.map.creek.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const N = Math.ceil(curve.getLength() / 2);
    const wpos = [], wuv = [], widx = [];
    let along = 0, prevP = null, rows = 0, run = 0; // run : rangées d'affilée (le torrent peut sortir de la bande et y revenir)
    for (let i = 0; i <= N; i++) {
      const c = curve.getPointAt(i / N), tg = curve.getTangentAt(i / N);
      if (prevP) along += prevP.distanceTo(c);
      prevP = c.clone();
      // Seulement sur le relief détaillé (au-delà, le relief lointain est trop grossier pour son ravin).
      const B = track.bounds;
      const out = track.band !== null ? track.trailDist(c.x, c.z) > track.band - 4 : c.x < B.xmin + 3 || c.x > B.xmax - 3 || c.z < B.zmin + 3 || c.z > B.zmax - 3;
      if (out) { if (rows && track.band === null) break; run = 0; continue; }
      const nx = tg.z, nz = -tg.x;
      for (const w of [-1.3, 1.3]) {
        const x = c.x + nx * w, z = c.z + nz * w;
        // (sur une piste en bande, jamais à plus de 10 cm au-dessus du sol : au gué, la piste passe plus bas que le lit)
        const wy = track.natural(c.x, c.z) + 0.3;
        wpos.push(x, track.band !== null ? Math.min(wy, track.groundY(x, z) + 0.1) : wy, z);
        wuv.push(w / 2.6 + 0.5, along);
      }
      if (run > 0) { const o = (rows - 1) * 2; widx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      rows++; run++;
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    wgeo.setIndex(widx);
    wgeo.computeVertexNormals();
    const water = new THREE.MeshStandardMaterial({ color: lin('#5d8a8f'), roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    water.userData.time = { value: 0 };
    water.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = water.userData.time;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFlow;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFlow = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vFlow;\n' + NOISE_GLSL)
        .replace('#include <color_fragment>', `#include <color_fragment>
// L'écume qui file vers l'aval, plus blanche sur les bords et entre les pierres.
vec2 fp = vec2(vFlow.x * 3.0, vFlow.y * 0.6 - uTime * 2.2);
float foam = smoothstep(0.62, 0.85, dh_noise(fp * vec2(2.0, 1.0)) * 0.6 + dh_noise(fp * 4.0 + 3.0) * 0.4);
foam = max(foam, smoothstep(0.35, 0.5, abs(vFlow.x - 0.5)) * 0.6);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.96), foam * 0.8);
diffuseColor.a = mix(diffuseColor.a, 1.0, foam);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 rp = vec2(vFlow.x * 2.0, vFlow.y * 0.8 - uTime * 2.5);
normal = normalize(normal + vec3(dh_noise(rp) - 0.5, 0.0, dh_noise(rp + 7.0) - 0.5) * 0.6);`);
    };
    dynamic.push((t) => { water.userData.time.value = t; });
    const stream = new THREE.Mesh(wgeo, water);
    stream.receiveShadow = true;
    stream.name = 'torrent';
    group.add(stream);
  }

  // ---------- Les portes : arches et banderoles ----------
  const archBanner = (s, text, color, half = 4.2, height = 3.4) => {
    const g = new THREE.Group();
    const fr = frameAt(track, s);
    for (const side of [-1, 1]) {
      const pp = frameAt(track, s, side * half).pos;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, height + 0.6, 10), metal);
      post.position.copy(pp).add(new THREE.Vector3(0, (height + 0.6) / 2, 0));
      post.castShadow = true;
      g.add(post);
      // La cellule de chronométrage, sur le poteau.
      const cell = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), black);
      cell.position.copy(pp).add(new THREE.Vector3(0, 0.75, 0));
      g.add(cell);
    }
    const tex = bannerTexture(text, color);
    // Une banderole très large répète son texte (sinon il serait étiré).
    if (2 * half > 12) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = Math.round((2 * half) / 7); }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2 * half, 0.75, 0.05), [black, black, black, black, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })]);
    banner.position.copy(fr.pos).add(new THREE.Vector3(0, height + 0.35, 0));
    banner.rotation.y = fr.yaw;
    banner.castShadow = true;
    g.add(banner);
    group.add(g);
    return g;
  };
  let inter = 0;
  for (const gate of track.gates) {
    if (gate.kind === 'point') archBanner(gate.s, `INTER ${++inter}`, '#1d5fb8', Math.max(4.2, track.tapeAt(gate.s) + 0.8));
  }
  archBanner(track.speedTrap, 'RADAR', '#e0a21b', Math.max(4, track.tapeAt(track.speedTrap) + 0.8), 3.0);

  // ---------- La cabane de départ ----------
  {
    const s0 = startRamp.a + 0.5, s1 = startRamp.b - 9;
    const fr = frameAt(track, (s0 + s1) / 2);
    const len = s1 - s0 + 1, w = 3.6, hgt = 3.0;
    const floorY = track.trailY(s0 + 2, 0);
    const hut = new THREE.Group();
    hut.position.set(fr.pos.x, floorY, fr.pos.z);
    hut.rotation.y = fr.yaw;
    const box = (sx, sy, sz, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; hut.add(m); return m; };
    box(0.12, hgt, len, -w / 2, hgt / 2, 0, wood);
    box(0.12, hgt, len, w / 2, hgt / 2, 0, wood);
    box(w + 0.12, hgt, 0.12, 0, hgt / 2, len / 2, wood);
    box(w + 0.8, 0.14, len + 1.2, 0, hgt + 0.05, 0.2, woodDark);
    box(w, 2.0, 0.05, 0, -1.0, len / 2 - 0.05, woodDark); // sous le plancher
    // Les piliers sous la rampe.
    for (const z of [-len / 2 + 0.3, 0, len / 2 - 0.3]) for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) box(0.16, 2.2, 0.16, x, -1.1, z, woodDark);
    // Le portillon de départ et l'horloge.
    const gate = box(w - 0.3, 0.08, 0.08, 0, 0.65, -len / 2 + 0.2, new THREE.MeshStandardMaterial({ color: lin('#d42a1f'), roughness: 0.5 }));
    gate.name = 'portillon';
    const clock = canvasTex(256, 128, () => {});
    const clockMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: clock.tex, toneMapped: false }));
    clockMesh.position.set(-w / 2 + 0.08, 2.0, -len / 2 + 0.9);
    clockMesh.rotation.y = Math.PI / 2;
    hut.add(clockMesh);
    const title = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, 0.6), new THREE.MeshStandardMaterial({ map: bannerTexture('DÉPART', '#1f8a3b'), roughness: 0.7 }));
    title.position.set(0, hgt - 0.2, -len / 2 - 0.02);
    title.rotation.y = Math.PI;
    hut.add(title);
    const title2 = title.clone(); title2.rotation.y = 0; title2.position.z = -len / 2 + 0.01; hut.add(title2);
    group.add(hut);
    // La rampe en planches, posée sur la piste.
    const planks = canvasTex(256, 256, (ctx, w2, h2) => {
      for (let i = 0; i < 8; i++) { const v = 120 + ((i * 37) % 40); ctx.fillStyle = `rgb(${v + 20},${v * 0.8},${v * 0.55})`; ctx.fillRect(0, i * 32, w2, 30); ctx.fillStyle = 'rgba(40,25,10,0.6)'; ctx.fillRect(0, i * 32 + 30, w2, 2); }
    }, true).tex;
    const rpos = [], ruv = [], ridx = [];
    let k = 0;
    for (let s = startRamp.a; s <= startRamp.b - 0.3; s += 0.25, k++) {
      for (const u of [-1.7, 1.7]) {
        const f = frameAt(track, s, u);
        rpos.push(f.pos.x, f.pos.y + 0.03, f.pos.z); ruv.push(u / 3.4 + 0.5, s / 2);
      }
      if (k > 0) { const a = (k - 1) * 2; ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
    rgeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
    rgeo.setIndex(ridx);
    rgeo.computeVertexNormals();
    const ramp = new THREE.Mesh(rgeo, new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85, side: THREE.DoubleSide }));
    ramp.receiveShadow = true;
    group.add(ramp);
    // L'horloge de départ : le jeu y écrit le compte à rebours.
    group.userData.startClock = { canvas: clock.canvas, tex: clock.tex, gate };
  }

  // ---------- L'arrivée : arche gonflable, écran, barrières, public, drapeaux ----------
  const people = [];
  const addPerson = (pos, faceTo) => people.push({ pos: pos.clone(), yaw: Math.atan2(faceTo.x - pos.x, faceTo.z - pos.z) + (rand() - 0.5) * 0.6, hue: rand() });
  {
    const fr = frameAt(track, track.sFinish);
    const arch = new THREE.Group();
    const archMat = new THREE.MeshStandardMaterial({ color: lin('#c4161c'), roughness: 0.55 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.55, 14, 40, Math.PI), archMat);
    torus.castShadow = true;
    arch.add(torus);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.1), new THREE.MeshStandardMaterial({ map: bannerTexture('ARRIVÉE', '#c4161c'), roughness: 0.7, side: THREE.DoubleSide }));
    sign.position.set(0, 4.8, 0.58);
    arch.add(sign);
    const sign2 = sign.clone(); sign2.position.z = -0.58; arch.add(sign2);
    arch.position.copy(fr.pos);
    arch.rotation.y = fr.yaw;
    group.add(arch);
    // La ligne au sol.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -fr.yaw;
    line.position.copy(fr.pos).add(new THREE.Vector3(0, 0.06, 0));
    group.add(line);
    // L'écran géant : le jeu y affiche le temps.
    const screen = canvasTex(512, 256, () => {});
    const sfr = frameAt(track, track.sFinish + 14, 11);
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
    screenMesh.position.copy(sfr.pos).add(new THREE.Vector3(0, 4.2, 0));
    screenMesh.lookAt(frameAt(track, track.sFinish - 25).pos.add(new THREE.Vector3(0, 2, 0)));
    group.add(screenMesh);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.3, 2.8, 0.3), black);
    frame.position.copy(screenMesh.position); frame.quaternion.copy(screenMesh.quaternion); frame.translateZ(-0.18);
    frame.castShadow = true;
    group.add(frame);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), metal);
    legs.position.copy(sfr.pos).add(new THREE.Vector3(0, 1.5, 0));
    group.add(legs);
    group.userData.finishScreen = { canvas: screen.canvas, tex: screen.tex };

    // Barrières le long des 70 derniers mètres, banderoles et public derrière.
    const fenceGeo = new THREE.BoxGeometry(0.04, 1.1, 2.4);
    const bannersTxt = ['COUPE DES ALPES', 'DESCENTE', 'ALTITUDE 1800', 'FULL GAZ', 'TOUT SCHUSS', 'LA PISTE NOIRE'];
    const bannerCols = ['#1d5fb8', '#c4161c', '#202020', '#e0a21b', '#1f8a3b', '#6b2fb3'];
    const bannerTexs = bannersTxt.map((t, i) => new THREE.MeshStandardMaterial({ map: bannerTexture(t, bannerCols[i], '#ffffff', 1024, 160), roughness: 0.7 }));
    const fenceMats = [];
    let bi = 0;
    for (let s = track.sFinish - 60; s < track.length - 3; s += 2.5) {
      for (const side of [-1, 1]) {
        const f = frameAt(track, s, side * (TAPE_U + 0.3));
        q.setFromAxisAngle(up, f.yaw);
        fenceMats.push(m4.compose(p.copy(f.pos).add(new THREE.Vector3(0, 0.55, 0)), q, sc.set(1, 1, 1)).clone());
        if (((s / 2.5) | 0) % 2 === 0) {
          const b = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), bannerTexs[bi++ % bannerTexs.length]);
          b.position.copy(f.pos).add(new THREE.Vector3(0, 0.62, 0)).addScaledVector(f.right, -side * 0.04);
          b.rotation.y = f.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
          group.add(b);
        }
        // Le public, sur trois rangs.
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const pf = frameAt(track, s + (rand() - 0.5) * 2, side * (TAPE_U + 1.0 + k * 0.8 + rand() * 0.4));
          addPerson(pf.pos, frameAt(track, s).pos);
        }
      }
    }
    const fences = new THREE.InstancedMesh(fenceGeo, metal, fenceMats.length);
    fenceMats.forEach((m, i) => fences.setMatrixAt(i, m));
    fences.castShadow = true;
    group.add(fences);
    // Des drapeaux.
    const flagCols = ['#c4161c', '#1d5fb8', '#ffffff', '#e0a21b'];
    for (let k = 0; k < 10; k++) {
      const side = k % 2 ? 1 : -1;
      const f = frameAt(track, track.sFinish - 50 + k * 8, side * (TAPE_U + 4 + rand() * 3));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5, 6), metal);
      pole.position.copy(f.pos).add(new THREE.Vector3(0, 2.5, 0));
      group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.4, 1, 6), new THREE.MeshStandardMaterial({ color: lin(flagCols[k % 4]), side: THREE.DoubleSide, roughness: 0.8 }));
      flag.position.copy(f.pos).add(new THREE.Vector3(0.45, 3.6, 0));
      flag.rotation.y = rand() * 6;
      flag.castShadow = true;
      group.add(flag);
    }
  }
  // Du public aussi aux endroits spectaculaires : drop, road gap, pierrier.
  for (const f of track.features) {
    if (!(f.type === 'rocks' || (f.type === 'jump' && f.kind !== 'table'))) continue;
    const s0 = f.type === 'rocks' ? f.a : f.lipS - 4, s1 = f.type === 'rocks' ? f.b : f.lipS + 16;
    for (let k = 0; k < 26; k++) {
      const s = s0 + rand() * (s1 - s0), side = rand() < 0.5 ? -1 : 1;
      const pf = frameAt(track, s, side * (track.tapeAt(s) + 1.2 + rand() * 3.5));
      if (track.treeNear(pf.pos.x, pf.pos.z, 0.5)) continue;
      addPerson(pf.pos, frameAt(track, s).pos);
    }
  }
  // ---------- Le départ en ligne : une banderole d'un piquet à l'autre, devant la grille, et du public ----------
  if (track.map.peloton && track.map.peloton.cols) {
    const sB = track.gates[0].s + (track.map.peloton.offset ?? 4) + 3 * (track.map.peloton.rowGap ?? 3.2) + 2;
    const half = track.tapeAt(sB) - 0.5;
    archBanner(sB, "L'AVALANCHE · DÉPART", '#c4161c', half, 3.2);
    for (let k = 0; k < 90; k++) {
      const s = track.sStart + 10 + rand() * 70, side = rand() < 0.5 ? -1 : 1;
      const pf = frameAt(track, s, side * (track.tapeAt(s) + 1.5 + rand() * 6));
      addPerson(pf.pos, frameAt(track, s).pos);
    }
  }

  // ---------- Le glacier : des séracs, blocs de glace anguleux groupés en chutes sur ses bords ----------
  // Un bloc : de la glace débitée par des plans de fracture, plus haute que large ; le dessus enneigé, des flancs de
  // glace bleutée (voir rocks.js). Trois formes, pour que les amas ne se répètent pas.
  const snowZone = track.surfaces.find((z) => z.surface === 'neige');
  if (snowZone) {
    const iceGeos = [21, 22, 23].map((seed) => {
      // (des plans de fracture profonds et presque verticaux : des faces de glace nettes)
      const g = rockGeometry(seed, { detail: 2, cuts: 11, rough: 0.05, flat: -0.6, depth: [0.4, 0.7], stretch: 0.95 });
      g.translate(0, 0.5, 0);
      return g;
    });
    const iceMat = iceMaterial(groundTextures);
    const iceMats = [];
    for (let c = 0; c < 26; c++) {
      // Une chute de séracs : un amas de blocs, au bord du glacier.
      const s0 = snowZone.a + 60 + rand() * (snowZone.b - snowZone.a - 80), side = rand() < 0.5 ? -1 : 1;
      const u0 = side * (track.tapeAt(s0) + 16 + rand() * 22);
      for (let k = 0, nk = 5 + Math.floor(rand() * 7); k < nk; k++) {
        const s = s0 + (rand() - 0.5) * 22, u = u0 + (rand() - 0.5) * 16;
        if (Math.abs(u) < track.tapeAt(s) + 8) continue;
        const fr = frameAt(track, s, u);
        const y = track.groundY(fr.pos.x, fr.pos.z);
        const r = 1.4 + Math.pow(rand(), 1.5) * 3.2, hgt = r * (1.4 + rand() * 1.4);
        iceMats.push(m4.compose(p.set(fr.pos.x, y - 0.6, fr.pos.z), q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.35, rand() * 6, (rand() - 0.5) * 0.35)), sc.set(r * 1.15, hgt * 0.7, r * (0.85 + rand() * 0.4))).clone());
      }
    }
    iceGeos.forEach((geo, gi) => {
      const mine = iceMats.filter((_, i) => i % iceGeos.length === gi);
      const ice = new THREE.InstancedMesh(geo, iceMat, mine.length);
      mine.forEach((m, i) => ice.setMatrixAt(i, m));
      ice.castShadow = ice.receiveShadow = true;
      ice.name = 'séracs';
      group.add(ice);
    });
  }

  // ---------- Les pistes forestières qu'on traverse ----------
  const roadStrip = (sRoad, half = 2.2, L = 90) => {
    const fr = frameAt(track, sRoad);
    const pos = [], uv = [], idx = [], n = 90;
    for (let i = 0; i <= n; i++) {
      const t = -L / 2 + (i / n) * L;
      for (const w of [-half, half]) {
        const x = fr.pos.x + fr.right.x * t + fr.fwd.x * w, z = fr.pos.z + fr.right.z * t + fr.fwd.z * w;
        pos.push(x, track.groundY(x, z) + 0.05, z);
        uv.push(w / 4, t / 4);
      }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    road.receiveShadow = true;
    group.add(road);
  };
  for (const f of track.features.filter((f) => f.type === 'road')) roadStrip((f.a + f.b) / 2);

  // ---------- Le gué : le torrent coule en travers de la piste ----------
  for (const f of track.features.filter((f) => f.type === 'ford')) {
    const sm = (f.a + f.b) / 2, fr = frameAt(track, sm);
    // L'axe du torrent au gué (le segment de son tracé le plus proche), et un ruban d'eau posé sur le sol, dans cet axe.
    let dir = new THREE.Vector3(fr.right.x, 0, fr.right.z);
    if (track.map.creek) {
      let best = Infinity;
      const C = track.map.creek;
      for (let i = 0; i + 1 < C.length; i++) {
        const d = Math.hypot((C[i][0] + C[i + 1][0]) / 2 - fr.pos.x, (C[i][1] + C[i + 1][1]) / 2 - fr.pos.z);
        if (d < best) { best = d; dir = new THREE.Vector3(C[i + 1][0] - C[i][0], 0, C[i + 1][1] - C[i][1]).normalize(); }
      }
    }
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const wpos = [], wuv = [], widx = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = -12 + (24 * i) / n;
      for (const w of [-0.9, 0.9]) {
        const x = fr.pos.x + dir.x * t + side.x * w, z = fr.pos.z + dir.z * t + side.z * w;
        wpos.push(x, track.groundY(x, z) + 0.04, z);
        wuv.push(w / 1.8 + 0.5, t);
      }
      if (i < n) { const k = i * 2; widx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    g.setIndex(widx);
    g.computeVertexNormals();
    const water = group.getObjectByName('torrent');
    const ford = new THREE.Mesh(g, water ? water.material : new THREE.MeshStandardMaterial({ color: lin('#5d8a8f'), roughness: 0.12, transparent: true, opacity: 0.85 }));
    ford.name = 'gué';
    ford.receiveShadow = true;
    group.add(ford);
    // Quelques galets de part et d'autre.
    for (let k = 0; k < 14; k++) {
      const side = rand() < 0.5 ? -1 : 1, u = side * (track.tapeAt(sm) + 0.5 + rand() * 4), ds = (rand() - 0.5) * (f.b - f.a + 4);
      const x = fr.pos.x + fr.right.x * u + fr.fwd.x * ds, z = fr.pos.z + fr.right.z * u + fr.fwd.z * ds;
      const r = 0.25 + rand() * 0.45;
      const m = new THREE.Mesh(rockGeo, wetRock);
      m.position.set(x, track.groundY(x, z) - r * 0.3, z);
      m.scale.set(r, r * 0.6, r * 0.9);
      m.rotation.y = rand() * 6;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------- Le village : maisons de pierre ou crépies, toits de lauze, volets, fontaine sur la place ----------
  if (track.buildings.length) {
    // Des photos (Poly Haven, CC0 ; voir groundLayers.js) : la couleur et le relief. Les coordonnées de texture des murs
    // comptent un tour tous les 3 m, celles des toits tous les 1,5 m : on répète chaque photo à sa taille réelle.
    const loader = new THREE.TextureLoader();
    const photo = (name, repeat) => {
      const load = (part, srgb) => {
        const t = loader.load(`${import.meta.env.BASE_URL}textures/${name}-${part}.jpg`);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      return { map: load('couleur', true), normalMap: load('relief', false) };
    };
    const stone = photo('pierre', 3 / 2.5), plaster = photo('crepi', 3 / 1.4), slate = photo('lauze', 1.5 / 3), wood = photo('bois', 3 / 2);
    // Une vitre : presque noire (l'intérieur est sombre), elle ne renvoie le ciel qu'en biais.
    const windowMat = new THREE.MeshStandardMaterial({ color: lin('#1c2228'), roughness: 0.04, metalness: 0 });
    const frameMat = new THREE.MeshStandardMaterial({ color: lin('#e9e4d8'), roughness: 0.7 });
    const frameGeos = [];
    // Des volets peints, sur du bois usé.
    const shutterCols = ['#5d8a68', '#8a6a4c', '#5a7491', '#a2493c'].map((c) => new THREE.MeshStandardMaterial({ ...wood, color: lin(c), roughness: 0.85 }));
    const wallMats = [new THREE.MeshStandardMaterial({ ...stone, roughness: 0.95 }), new THREE.MeshStandardMaterial({ ...plaster, color: lin('#efe4d0'), roughness: 0.95 })];
    const roofMat = new THREE.MeshStandardMaterial({ ...slate, roughness: 0.8, side: THREE.DoubleSide });
    const wallGeos = [[], []], roofGeos = [], winGeos = [], shutGeos = [[], [], [], []];
    const mat4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    for (const b of track.buildings) {
      const yawQ = new THREE.Quaternion().setFromAxisAngle(up, b.yaw);
      const place = (g, x, y, z) => g.applyMatrix4(mat4.compose(new THREE.Vector3(x, y, z).applyQuaternion(yawQ).add(new THREE.Vector3(b.x, b.y, b.z)), yawQ, one));
      // Les murs : la profondeur en travers de la ruelle (x), la largeur le long (z).
      const wg = new THREE.BoxGeometry(b.d, b.h, b.w);
      const uv = wg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.max(b.d, b.w)) / 3, (uv.getY(i) * b.h) / 3);
      wallGeos[b.hue < 0.6 ? 0 : 1].push(place(wg, 0, b.h / 2, 0));
      // Le toit à deux pans, le faîte le long de la ruelle, qui déborde un peu.
      const rh = 2 + b.roof * 1.6, ox = b.d / 2 + 0.5, oz = b.w / 2 + 0.4;
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute([-ox, 0, -oz, 0, rh, -oz, ox, 0, -oz, -ox, 0, oz, 0, rh, oz, ox, 0, oz], 3));
      rg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, rh, 0, 0, oz, 0, oz, rh, oz, 0].map((x) => x / 1.5), 2));
      rg.setIndex([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4, 0, 2, 1, 3, 4, 5]);
      rg.computeVertexNormals();
      roofGeos.push(place(rg, 0, b.h, 0));
      // Les fenêtres et leurs volets, sur les deux longs côtés.
      for (const face of [-1, 1]) {
        const x = face * (b.d / 2 + 0.02);
        for (let fl = 0; fl < (b.h > 6.5 ? 2 : 1); fl++) {
          for (let k = -1; k <= 1; k += 2) {
            const z = k * b.w * 0.25, y = 1.6 + fl * 2.6;
            // L'encadrement clair, puis la vitre en retrait de quelques centimètres.
            // (un cadre : quatre montants autour de la vitre)
            frameGeos.push(place(new THREE.BoxGeometry(0.06, 0.11, 0.98), x, y + 0.585, z), place(new THREE.BoxGeometry(0.06, 0.11, 0.98), x, y - 0.585, z));
            frameGeos.push(place(new THREE.BoxGeometry(0.06, 1.28, 0.11), x, y, z - 0.435), place(new THREE.BoxGeometry(0.06, 1.28, 0.11), x, y, z + 0.435));
            winGeos.push(place(new THREE.BoxGeometry(0.03, 1.06, 0.76), x, y, z));
            frameGeos.push(place(new THREE.BoxGeometry(0.09, 0.05, 0.76), x, y, z), place(new THREE.BoxGeometry(0.09, 1.06, 0.05), x, y, z));
            shutGeos[Math.floor(b.roof * 3.999)].push(place(new THREE.BoxGeometry(0.08, 1.15, 0.36), x, y, z - 0.6), place(new THREE.BoxGeometry(0.08, 1.15, 0.36), x, y, z + 0.6));
          }
        }
      }
    }
    const addMerged = (geos, mat) => { if (!geos.length) return; const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = m.receiveShadow = true; group.add(m); };
    addMerged(wallGeos[0], wallMats[0]); addMerged(wallGeos[1], wallMats[1]); addMerged(roofGeos, roofMat); addMerged(winGeos, windowMat); addMerged(frameGeos, frameMat);
    shutGeos.forEach((g, i) => addMerged(g, shutterCols[i]));

    // La fontaine sur la place, à côté de l'arrivée.
    const fr = frameAt(track, track.sFinish + 14, -9);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.7, 20, 1, true), wallMats[0]);
    basin.position.copy(fr.pos).add(new THREE.Vector3(0, 0.35, 0));
    const water = group.getObjectByName('torrent');
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.45, 20), water ? water.material : windowMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.copy(fr.pos).add(new THREE.Vector3(0, 0.55, 0));
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.8, 10), wallMats[0]);
    pillar.position.copy(fr.pos).add(new THREE.Vector3(0, 0.9, 0));
    for (const m of [basin, pillar]) { m.castShadow = m.receiveShadow = true; group.add(m); }
    group.add(pool);

    // Le public dans la ruelle, entre les maisons.
    const V = track.village;
    for (let k = 0; k < 140; k++) {
      const s = V.a + rand() * (track.sFinish - 60 - V.a), side = rand() < 0.5 ? -1 : 1;
      const pf = frameAt(track, s, side * (track.tapeAt(s) + 0.9 + rand() * 1.2));
      if (track.buildings.some((b) => Math.hypot(pf.pos.x - b.x, pf.pos.z - b.z) < Math.max(b.w, b.d) / 2 + 0.6)) continue;
      addPerson(pf.pos, frameAt(track, s).pos);
    }
  }

  {
    const geos = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => personGeometry(k % 4, k));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    mat.userData.time = { value: 0 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = mat.userData.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float jacket;')
        // Seule la veste prend la couleur de chacun.
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(color.rgb, vColor.rgb, jacket);')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
transformed.y += max(0.0, sin(uTime * 7.0 + ph)) * 0.05 * step(0.5, fract(ph));
#endif`);
    };
    dynamic.push((t) => { mat.userData.time.value = t; });
    // Des vestes de montagne : quelques couleurs vives, beaucoup de teintes sourdes.
    const shirts = ['#c8352a', '#2d5e9e', '#e0b23a', '#3f7d4e', '#e8e6df', '#e26a2c', '#5b4b8a', '#26282c', '#7d8a95', '#8a6a4a', '#34536b', '#a33c5c'].map(lin);
    geos.forEach((geo, gi) => {
      const mine = people.filter((_, i) => i % geos.length === gi);
      if (!mine.length) return;
      const crowd = new THREE.InstancedMesh(geo, mat, mine.length);
      mine.forEach((pp, i) => {
        q.setFromAxisAngle(up, pp.yaw);
        const sz = 0.92 + rand() * 0.16;
        crowd.setMatrixAt(i, m4.compose(pp.pos, q, sc.set(sz, sz, sz)));
        crowd.setColorAt(i, shirts[Math.floor(pp.hue * shirts.length)]);
      });
      crowd.castShadow = true;
      crowd.computeBoundingSphere();
      group.add(crowd);
    });
  }

  // ---------- Protections sur les arbres proches de la piste, panneaux avant les virages ----------
  {
    const padMats = [];
    for (const t of track.trees) {
      const near = track.nearest(t.x, t.z, null, 0, 2);
      if (near.dist > 7.5 || !near.inside) continue;
      padMats.push(m4.compose(p.set(t.x, t.y + 0.15, t.z), q.identity(), sc.set(t.r + 0.12, 1, t.r + 0.12)).clone());
    }
    const padGeo = new THREE.CylinderGeometry(1, 1, 1.9, 12); padGeo.translate(0, 0.95, 0);
    const pads = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ color: lin('#e0451b'), roughness: 0.7 }), Math.max(1, padMats.length));
    padMats.forEach((m, i) => pads.setMatrixAt(i, m));
    pads.count = padMats.length;
    pads.castShadow = true;
    group.add(pads);

    const chev = canvasTex(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#f2c230'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111';
      for (let k = 0; k < 3; k++) { const x = 40 + k * 70; ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x + 45, h / 2); ctx.lineTo(x, h - 14); ctx.lineTo(x + 22, h - 14); ctx.lineTo(x + 67, h / 2); ctx.lineTo(x + 22, 14); ctx.fill(); }
    }).tex;
    const signMat = new THREE.MeshStandardMaterial({ map: chev, roughness: 0.6 });
    let last = -100;
    for (let s = 30; s < track.length - 40; s += 2) {
      const k = track.sample(s + 12).k;
      if (Math.abs(k) < 0.045 || s - last < 40) continue;
      last = s;
      const side = -Math.sign(k); // à l'extérieur du virage
      const f = frameAt(track, s + 14, side * (track.tapeAt(s + 14) + 0.6));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), signMat);
      board.position.copy(f.pos).add(new THREE.Vector3(0, 1.1, 0));
      board.rotation.y = f.yaw + Math.PI;
      if (k < 0) board.scale.x = -1; // la flèche indique le sens du virage
      group.add(board);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5), metal);
      post.position.copy(f.pos).add(new THREE.Vector3(0, 0.55, 0));
      group.add(post);
    }
  }

  return {
    group,
    startClock: group.userData.startClock,
    finishScreen: group.userData.finishScreen,
    update(t) { for (const f of dynamic) f(t); },
  };
}
