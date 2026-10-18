// L'habillage de la course : rubalise, cabane de départ, arches de chrono, radar, aire d'arrivée et public,
// protections sur les arbres, panneaux de virage, la route du road gap, et les cailloux et racines de la piste
// (posés exactement là où la physique les a mis).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../sim/noise.js';
import { TAPE_U, TRAIL_HALF } from '../sim/track.js';

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

function personGeometry() {
  // Une silhouette simple, 1,75 m : jambes, buste, bras, tête. Les couleurs viennent des sommets (peau, pantalon),
  // le buste prend la couleur de l'instance (le t-shirt).
  const parts = [];
  const paint = (g, c) => {
    const col = new THREE.Color(c);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const pants = lin('#2b3340'), skin = lin('#d9a786'), shirt = new THREE.Color(1, 1, 1);
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.CylinderGeometry(0.075, 0.065, 0.85, 6); leg.translate(sx, 0.43, 0); parts.push(paint(leg, pants));
  }
  const torso = new THREE.CapsuleGeometry(0.17, 0.38, 3, 8); torso.scale(1, 1, 0.7); torso.translate(0, 1.14, 0); parts.push(paint(torso, shirt));
  for (const sx of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6); arm.translate(0, -0.31, 0); arm.rotateZ(sx * 0.25); arm.translate(sx * 0.22, 1.42, 0); parts.push(paint(arm, shirt));
  }
  const head = new THREE.SphereGeometry(0.115, 10, 8); head.translate(0, 1.6, 0); parts.push(paint(head, skin));
  return mergeGeometries(parts);
}

export function createCourse(sim, sunDir) {
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
  const stakeMats = [];
  const tapePos = [], tapeUV = [], tapeFlex = [], tapeSide = [], tapeIdx = [];
  const sEnd = arena ? arena.a + 4 : track.length;
  for (const sideSign of [-1, 1]) {
    let len = 0, prev = null, base = tapePos.length / 3;
    const spacing = 4;
    for (let s = startRamp.b + 1; s < sEnd; s += spacing) {
      const u = sideSign * TAPE_U;
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
    const count = tapePos.length / 3 - base;
    for (let i = 0; i < count / 2 - 1; i++) {
      const a = base + i * 2;
      tapeIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
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

  // ---------- Les cailloux du pierrier et les racines, là où la physique les a mis ----------
  const rockGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const ps = g.attributes.position, c = [];
    const grey = lin('#9a958b'), dark = lin('#625e57');
    for (let i = 0; i < ps.count; i++) {
      const x = ps.getX(i), y = ps.getY(i), z = ps.getZ(i);
      const n = 1 + 0.22 * fbm(x * 1.7 + 3, z * 1.7 + y, 3, 4);
      ps.setXYZ(i, x * n, Math.max(y, -0.3) * n, z * n);
      const cc = dark.clone().lerp(grey, 0.5 + 0.5 * fbm(x * 4, y * 4 + z, 2, 8));
      c.push(cc.r, cc.g, cc.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  })();
  if (track.rocks.length) {
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), track.rocks.length);
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
  for (const f of track.features.filter((f) => f.type === 'jump' && f.kind === 'drop')) {
    for (let u = -TRAIL_HALF - 0.6; u <= TRAIL_HALF + 0.6; u += 0.9) {
      const fr = frameAt(track, f.lipS - 0.2, u);
      const r = 0.55 + rand() * 0.25;
      q.setFromEuler(new THREE.Euler(0, rand() * 6, 0));
      const m = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
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
    if (gate.kind === 'point') archBanner(gate.s, `INTER ${++inter}`, '#1d5fb8');
  }
  archBanner(track.speedTrap, 'RADAR', '#e0a21b', 4, 3.0);

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
      const pf = frameAt(track, s, side * (TAPE_U + 1.2 + rand() * 3.5));
      if (track.treeNear(pf.pos.x, pf.pos.z, 0.5)) continue;
      addPerson(pf.pos, frameAt(track, s).pos);
    }
  }
  {
    const geo = personGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    mat.userData.time = { value: 0 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = mat.userData.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
transformed.y += max(0.0, sin(uTime * 7.0 + ph)) * 0.05 * step(0.5, fract(ph));
#endif`);
    };
    dynamic.push((t) => { mat.userData.time.value = t; });
    const crowd = new THREE.InstancedMesh(geo, mat, people.length);
    const shirts = ['#d42a1f', '#1d5fb8', '#f2c230', '#2b9348', '#ffffff', '#ff7a1a', '#7b2cbf', '#111111', '#e85d9b', '#4cc9f0'].map(lin);
    people.forEach((pp, i) => {
      q.setFromAxisAngle(up, pp.yaw);
      const sz = 0.92 + rand() * 0.16;
      crowd.setMatrixAt(i, m4.compose(pp.pos, q, sc.set(sz, sz, sz)));
      crowd.setColorAt(i, shirts[Math.floor(pp.hue * shirts.length)]);
    });
    crowd.castShadow = true;
    crowd.computeBoundingSphere();
    group.add(crowd);
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
      const f = frameAt(track, s + 14, side * (TAPE_U + 0.6));
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
