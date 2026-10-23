// Le sous-bois : herbes, fleurs, fougères, rochers, troncs couchés (les arbres sont dans trees.js).
// Tout est en instances, regroupées par zones de 80 m : ce qui est hors du champ n'est pas dessiné, les herbes et les
// fleurs pas au-delà de 220 m. En montagne, au-dessus des arbres, des blocs plus gros et plus nombreux.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm, smoothstep } from '../sim/noise.js';
import { TRAIL_HALF } from '../sim/track.js';

const TILE = 80;
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// ---------- Les géométries ----------

/** Une touffe : trois cartes croisées, normales vers le haut (éclairage doux, comme de l'herbe). */
function tuftGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2);
    g.translate(0, 0.5, 0);
    g.rotateY((k / 3) * Math.PI);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const c = [];
  const grey = lin('#8a857c'), dark = lin('#5b5752'), lichen = lin('#7d8a55');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.28 * fbm(x * 1.6 + seed, z * 1.6 + y * 1.3, 3, seed);
    const flat = y < -0.2 ? 0.6 : 1; // assis sur le sol
    p.setXYZ(i, x * n, y * n * 0.75 * flat, z * n);
    const t = fbm(x * 3 + seed, y * 3 + z * 2, 2, seed + 1) * 0.5 + 0.5;
    const cc = dark.clone().lerp(grey, t);
    if (y > 0.4 && t > 0.6) cc.lerp(lichen, 0.5);
    c.push(cc.r, cc.g, cc.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- Les textures des touffes (dessinées une fois au lancement) ----------

function canvasTexture(draw, size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function drawGrass(flowers) {
  return (ctx, S) => {
    const rand = rng(flowers ? 5 : 3);
    for (let i = 0; i < 70; i++) {
      const x0 = S * (0.2 + rand() * 0.6), h = S * (0.45 + rand() * 0.5), bend = (rand() - 0.5) * S * 0.35;
      const g = ctx.createLinearGradient(0, S, 0, S - h);
      const light = 30 + rand() * 25;
      g.addColorStop(0, `hsl(${85 + rand() * 20}, 32%, ${light * 0.45}%)`);
      g.addColorStop(1, `hsl(${72 + rand() * 25}, 34%, ${light * 0.85}%)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(x0, S);
      ctx.quadraticCurveTo(x0 + bend * 0.3, S - h * 0.6, x0 + bend, S - h);
      ctx.stroke();
    }
    if (flowers) {
      for (let i = 0; i < 9; i++) {
        const x = S * (0.15 + rand() * 0.7), y = S * (0.1 + rand() * 0.35);
        ctx.fillStyle = ['#f3e36a', '#ffffff', '#c58ad8', '#f0f0d0'][i % 4];
        for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 1.26) * 4, y + Math.sin(k * 1.26) * 4, 3.4, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  };
}

function drawFern(ctx, S) {
  const rand = rng(11);
  for (let f = 0; f < 7; f++) {
    const a = -Math.PI / 2 + (f - 3) * 0.32 + (rand() - 0.5) * 0.15;
    const len = S * (0.55 + rand() * 0.35);
    const x0 = S / 2, y0 = S;
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const droop = t * t * 0.9 * Math.sign(Math.cos(a)) * 0.6;
      pts.push([x0 + Math.cos(a + droop) * len * t, y0 + Math.sin(a + droop * 0.3) * len * t + t * t * S * 0.25]);
    }
    ctx.strokeStyle = '#3d5a22';
    ctx.lineWidth = 2;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    for (let i = 2; i < 20; i++) {
      const [x, y] = pts[i], [x2, y2] = pts[i + 1];
      const dx = x2 - x, dy = y2 - y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, w = (1 - i / 20) * S * 0.09 + 3;
      ctx.fillStyle = `hsl(${88 + rand() * 18}, ${45 + rand() * 15}%, ${22 + rand() * 14}%)`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + nx * w * side * 0.7 + dx * 0.4, y + ny * w * side * 0.7 + dy * 0.4, x + nx * w * side + dx * 0.9, y + ny * w * side + dy * 0.9);
        ctx.lineTo(x + dx * 0.6, y + dy * 0.6);
        ctx.fill();
      }
    }
  }
}

function windMaterial(map, color = 0xffffff) {
  const mat = new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  mat.userData.time = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
#else
  float ph = 0.0;
#endif
  float sway = (sin(uTime * 1.9 + ph) + 0.4 * sin(uTime * 4.3 + ph * 2.1)) * 0.07 * position.y * position.y;
  transformed.x += sway;
  transformed.z += sway * 0.6;`);
  };
  return mat;
}

// ---------- Placement ----------

class Tiles {
  constructor() { this.map = new Map(); }
  add(name, x, z, matrix, color) {
    const k = `${name}|${Math.floor(x / TILE)}|${Math.floor(z / TILE)}`;
    let t = this.map.get(k);
    if (!t) this.map.set(k, (t = { name, matrices: [], colors: [], cx: (Math.floor(x / TILE) + 0.5) * TILE, cz: (Math.floor(z / TILE) + 0.5) * TILE }));
    t.matrices.push(matrix.clone());
    if (color) t.colors.push(color.clone());
  }
  build(group, kinds) {
    this.meshes = [];
    for (const t of this.map.values()) {
      const kind = kinds[t.name];
      const mesh = new THREE.InstancedMesh(kind.geometry, kind.material, t.matrices.length);
      t.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (t.colors.length) t.colors.forEach((c, i) => mesh.setColorAt(i, c));
      mesh.castShadow = !!kind.castShadow;
      mesh.receiveShadow = !!kind.receiveShadow;
      mesh.computeBoundingSphere();
      group.add(mesh);
      this.meshes.push({ mesh, cx: t.cx, cz: t.cz, near: !!kind.near });
    }
  }
}

export function createVegetation(track, forestAt) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rand = rng(track.seed + 404);
  const tiles = new Tiles();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  const bark = new THREE.MeshStandardMaterial({ color: lin('#4a3829'), roughness: 1 });
  const kinds = {};

  // ----- Le sous-bois : herbes, fleurs, fougères, le long de la piste et dans les prairies -----
  const grassMat = windMaterial(canvasTexture(drawGrass(false)));
  const flowerMat = windMaterial(canvasTexture(drawGrass(true)));
  const fernMat = windMaterial(canvasTexture(drawFern));
  const tuft = tuftGeometry();
  kinds.grass = { geometry: tuft, material: grassMat, near: true };
  kinds.flowers = { geometry: tuft, material: flowerMat, near: true };
  kinds.fern = { geometry: tuft, material: fernMat, near: true };
  const B = track.bounds;
  const winds = [grassMat, flowerMat, fernMat];
  // Une piste plus longue a plus de sous-bois (la même densité le long de la piste).
  const more = track.length > 1000 ? track.length / 884 : 1;
  const treeline = track.map.env.treeline ?? null;
  let placed = 0;
  for (let k = 0; k < 90000 * more && placed < 26000 * more; k++) {
    // Surtout près de la piste : c'est là qu'on regarde.
    let x, z;
    if (rand() < 0.75) {
      const ss = rand() * track.length, f = track.sample(ss);
      const side = rand() < 0.5 ? -1 : 1;
      const u = side * (TRAIL_HALF + 0.6 + Math.pow(rand(), 1.6) * 26);
      x = f.x + u * f.rx; z = f.z + u * f.rz;
    } else {
      x = B.xmin + rand() * (B.xmax - B.xmin); z = B.zmin + rand() * (B.zmax - B.zmin);
    }
    const near = track.nearest(x, z, null, 0, 3);
    if (near.dist < TRAIL_HALF + 0.5 && near.inside) continue;
    const forest = forestAt(x, z);
    const n = fbm(x / 9, z / 9, 2, 31) * 0.5 + 0.5;
    let kind;
    if (forest > 0.45) { if (rand() > 0.55) continue; kind = 'fern'; }
    else kind = n > 0.62 && rand() < 0.5 ? 'flowers' : rand() < 0.12 ? 'fern' : 'grass';
    const y = track.groundY(x, z);
    const size = kind === 'fern' ? 0.7 + rand() * 0.6 : 0.35 + rand() * 0.45 + (1 - forest) * 0.15;
    q.setFromAxisAngle(up, rand() * Math.PI);
    col.setScalar(0.75 + rand() * 0.4);
    tiles.add(kind, x, z, m4.compose(p.set(x, y - 0.03, z), q, s.set(size * (kind === 'fern' ? 1.5 : 1.2), size, size * (kind === 'fern' ? 1.5 : 1.2))), col);
    placed++;
  }

  // ----- Les rochers et les troncs couchés -----
  kinds.rockA = { geometry: rockGeometry(1), material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), castShadow: true, receiveShadow: true };
  kinds.rockB = { geometry: rockGeometry(2), material: kinds.rockA.material, castShadow: true, receiveShadow: true };
  const rockCount = Math.round(1400 * more * (treeline === null ? 1 : 1.8));
  for (let k = 0; k < rockCount; k++) {
    let x, z;
    if (rand() < 0.7) {
      const ss = rand() * track.length, f = track.sample(ss), side = rand() < 0.5 ? -1 : 1;
      const u = side * (TRAIL_HALF + 1.4 + rand() * 14);
      x = f.x + u * f.rx; z = f.z + u * f.rz;
    } else { x = B.xmin + rand() * (B.xmax - B.xmin); z = B.zmin + rand() * (B.zmax - B.zmin); }
    const near = track.nearest(x, z, null, 0, 3);
    if (near.dist < TRAIL_HALF + 1.2 && near.inside) continue;
    if (track.treeNear(x, z, 0.6)) continue;
    let r = 0.15 + Math.pow(rand(), 2.5) * 1.3;
    const y = track.groundY(x, z);
    if (treeline !== null) {
      // L'alpage : des blocs de granit éboulés, parfois énormes ; jamais sur la piste.
      r *= 1 + 1.3 * smoothstep(treeline - 20, treeline + 20, y);
      if (near.inside) r = Math.min(r, Math.max(0.15, (near.dist - TRAIL_HALF - 0.8) * 0.9));
    }
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 6.3, (rand() - 0.5) * 0.4));
    tiles.add(rand() < 0.5 ? 'rockA' : 'rockB', x, z, m4.compose(p.set(x, y - r * 0.25, z), q, s.set(r * (1 + rand() * 0.6), r, r * (1 + rand() * 0.4))));
  }
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  logGeo.rotateZ(Math.PI / 2);
  kinds.log = { geometry: logGeo, material: bark, castShadow: true, receiveShadow: true };
  for (let k = 0; k < 220 * more; k++) {
    const x = B.xmin + rand() * (B.xmax - B.xmin), z = B.zmin + rand() * (B.zmax - B.zmin);
    const near = track.nearest(x, z, null, 0, 3);
    if (near.dist < 7 || forestAt(x, z) < 0.3) continue;
    const len = 3 + rand() * 6, r = 0.12 + rand() * 0.15;
    q.setFromEuler(new THREE.Euler(0, rand() * 6.3, (rand() - 0.5) * 0.15));
    tiles.add('log', x, z, m4.compose(p.set(x, track.groundY(x, z) + r * 0.6, z), q, s.set(len, r, r)));
  }

  tiles.build(group, kinds);
  return {
    group,
    update(t, camera) {
      for (const m of winds) m.userData.time.value = t;
      if (!camera) return;
      const cx = camera.position.x, cz = camera.position.z;
      for (const e of tiles.meshes) if (e.near) e.mesh.visible = Math.hypot(e.cx - cx, e.cz - cz) < 220 + TILE * 0.71;
    },
  };
}
