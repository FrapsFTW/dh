// Le sous-bois : herbes, fleurs, fougères, rochers, troncs couchés (les arbres sont dans trees.js).
// Tout est en instances, regroupées par zones de 80 m : ce qui est hors du champ n'est pas dessiné, les herbes et les
// fleurs pas au-delà de 220 m, les rochers pas au-delà de 900 m. En montagne, au-dessus des arbres, des blocs plus gros
// et plus nombreux.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm, smoothstep } from '../sim/noise.js';
import { TRAIL_HALF } from '../sim/track.js';
import { rockGeometry, rockMaterial } from './rocks.js';

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

// ---------- Les textures des touffes (dessinées une fois au lancement) ----------

/**
 * Une texture de touffe dessinée sur un canevas. Les pixels transparents prennent la couleur des brins voisins : sinon,
 * en s'éloignant, le filtrage mêle du noir aux brins et l'herbe se cerne de sombre.
 */
function cardTexture(draw, size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  draw(ctx, size);
  const src = ctx.getImageData(0, 0, size, size).data;
  const data = new Uint8Array(size * size * 4);
  // (à l'endroit : la ligne du bas du dessin est le pied de la touffe, v = 0)
  for (let y = 0; y < size; y++) data.set(src.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  // Le remplissage : on étend la couleur des pixels pleins, de proche en proche.
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) filled[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  for (let pass = 0; pass < 24; pass++) {
    const next = filled.slice();
    let changed = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (!filled[j]) continue;
        r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; n++;
      }
      if (n) { data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n; next[i] = 1; changed++; }
    }
    filled.set(next);
    if (!changed) break;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Un brin : effilé, courbé, plus sombre au pied qu'à la pointe (de l'ombre, pas du noir). */
function blade(ctx, S, rand, x0, h, w, bend, base, tip) {
  const steps = 8, left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + bend * t * t, y = S - h * t;
    const half = (w / 2) * (1 - t) ** 0.8;
    const dx = 2 * bend * t, dy = -h;
    const l = Math.hypot(dx, dy);
    left.push([x - (dy / l) * half, y + (dx / l) * half]);
    right.push([x + (dy / l) * half, y - (dx / l) * half]);
  }
  const g = ctx.createLinearGradient(x0, S, x0 + bend, S - h);
  g.addColorStop(0, base);
  g.addColorStop(0.55, tip.mid);
  g.addColorStop(1, tip.end);
  ctx.fillStyle = g;
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

function drawGrass(flowers) {
  return (ctx, S) => {
    const rand = rng(flowers ? 5 : 3);
    for (let i = 0; i < 150; i++) {
      const x0 = S * (0.12 + rand() * 0.76), h = S * (0.3 + rand() * rand() * 0.68 + 0.02), bend = (rand() - 0.5) * S * 0.4;
      const dry = rand() < 0.16;
      const hue = dry ? 44 + rand() * 10 : 72 + rand() * 22, sat = dry ? 30 + rand() * 12 : 38 + rand() * 18;
      const l = dry ? 48 + rand() * 14 : 30 + rand() * 16;
      blade(ctx, S, rand, x0, h, S * (0.012 + rand() * 0.016), bend,
        `hsl(${hue + 6}, ${sat - 6}%, ${l * 0.55}%)`, { mid: `hsl(${hue}, ${sat}%, ${l}%)`, end: `hsl(${hue - 6}, ${sat + 4}%, ${l * 1.18}%)` });
    }
    // Quelques épis.
    for (let i = 0; i < 6; i++) {
      const x = S * (0.2 + rand() * 0.6), y = S * (0.05 + rand() * 0.25);
      ctx.strokeStyle = `hsl(${50 + rand() * 10}, 28%, ${55 + rand() * 10}%)`;
      ctx.lineWidth = S * 0.004;
      ctx.beginPath(); ctx.moveTo(x, S); ctx.quadraticCurveTo(x + (rand() - 0.5) * S * 0.1, y + S * 0.3, x + (rand() - 0.5) * S * 0.06, y); ctx.stroke();
      ctx.fillStyle = `hsl(${46 + rand() * 8}, 32%, ${58 + rand() * 10}%)`;
      ctx.beginPath(); ctx.ellipse(x, y, S * 0.008, S * 0.035, (rand() - 0.5) * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    if (flowers) {
      const colors = ['#f2dc5d', '#fbfbf4', '#b98bd4', '#e9e7c9', '#f0a35a'];
      for (let i = 0; i < 12; i++) {
        const x = S * (0.15 + rand() * 0.7), y = S * (0.12 + rand() * 0.38);
        ctx.strokeStyle = 'hsl(85, 35%, 30%)';
        ctx.lineWidth = S * 0.005;
        ctx.beginPath(); ctx.moveTo(x + (rand() - 0.5) * S * 0.05, S); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = colors[i % colors.length];
        const r = S * (0.007 + rand() * 0.006);
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 1.05) * r * 1.3, y + Math.sin(k * 1.05) * r * 0.9, r, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#d8a020';
        ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
}

function drawFern(ctx, S) {
  const rand = rng(11);
  for (let f = 0; f < 8; f++) {
    const a = -Math.PI / 2 + (f - 3.5) * 0.3 + (rand() - 0.5) * 0.15;
    const len = S * (0.55 + rand() * 0.35);
    const x0 = S / 2, y0 = S;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const droop = t * t * 0.9 * Math.sign(Math.cos(a)) * 0.6;
      pts.push([x0 + Math.cos(a + droop) * len * t, y0 + Math.sin(a + droop * 0.3) * len * t + t * t * S * 0.25]);
    }
    ctx.strokeStyle = 'hsl(90, 35%, 24%)';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    for (let i = 2; i < 24; i++) {
      const [x, y] = pts[i], [x2, y2] = pts[i + 1];
      const dx = x2 - x, dy = y2 - y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, w = (1 - i / 24) * S * 0.1 + S * 0.012;
      for (const side of [-1, 1]) {
        ctx.fillStyle = `hsl(${86 + rand() * 18}, ${42 + rand() * 15}%, ${26 + rand() * 16}%)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + nx * w * side * 0.7 + dx * 0.4, y + ny * w * side * 0.7 + dy * 0.4, x + nx * w * side + dx * 0.9, y + ny * w * side + dy * 0.9);
        ctx.lineTo(x + dx * 0.6, y + dy * 0.6);
        ctx.fill();
      }
    }
  }
}

/**
 * Le matériau des touffes : bords doux (alpha-to-coverage, avec l'antialiasing de la scène), le vent, et la lumière du
 * soleil qui traverse les brins quand on le regarde en face (l'herbe s'allume à contre-jour).
 */
function windMaterial(map, sunDir, color = 0xffffff) {
  const mat = new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
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
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
// Au loin, les brins fins s'effacent dans les petites versions de la texture : on garde leur couverture.
diffuseColor.a *= 1.0 + 0.5 * clamp(log2(max(length(fwidth(vMapUv * 512.0)), 1.0)), 0.0, 4.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 sunV = normalize((viewMatrix * vec4(${sunDir.x.toFixed(4)}, ${sunDir.y.toFixed(4)}, ${sunDir.z.toFixed(4)}, 0.0)).xyz);
  float back = pow(max(dot(normalize(-vViewPosition), sunV), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.93, 0.75) * back * 1.4;
}`);
  };
  mat.customProgramCacheKey = () => 'touffe';
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
      this.meshes.push({ mesh, cx: t.cx, cz: t.cz, range: kind.range ?? (kind.near ? 220 : 0) });
    }
  }
}

export function createVegetation(track, forestAt, { sunDir = new THREE.Vector3(0, 1, 0), groundTextures = null } = {}) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rand = rng(track.seed + 404);
  const tiles = new Tiles();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  const bark = new THREE.MeshStandardMaterial({ color: lin('#4a3829'), roughness: 1 });
  const kinds = {};

  // ----- Le sous-bois : herbes, fleurs, fougères, le long de la piste et dans les prairies -----
  const grassMat = windMaterial(cardTexture(drawGrass(false)), sunDir);
  const flowerMat = windMaterial(cardTexture(drawGrass(true)), sunDir);
  const fernMat = windMaterial(cardTexture(drawFern), sunDir);
  const tuft = tuftGeometry();
  kinds.grass = { geometry: tuft, material: grassMat, near: true };
  kinds.flowers = { geometry: tuft, material: flowerMat, near: true };
  kinds.fern = { geometry: tuft, material: fernMat, near: true };
  const B = track.bounds;
  const winds = [grassMat, flowerMat, fernMat];
  // Au hasard dans le rectangle de la piste, ou dans sa bande (les longues pistes).
  const anywhere = () => {
    if (track.band === null) return [B.xmin + rand() * (B.xmax - B.xmin), B.zmin + rand() * (B.zmax - B.zmin)];
    const f = track.sample(rand() * track.length), u = (rand() * 2 - 1) * track.band;
    return [f.x + u * f.rx, f.z + u * f.rz];
  };
  // Pas d'herbe sur la neige (le glacier, ou au-dessus de la limite des neiges), ni dans le village.
  const snowline = track.map.env.snowline ?? 1e5;
  const snowZones = track.surfaces.filter((z) => z.surface === 'neige');
  const nearHouse = (x, z, m) => track.buildings.some((b) => Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) / 2 + m);
  const bare = (x, z, near) => {
    if (snowZones.length && track.trailDist(x, z) < 110 && snowZones.some((zz) => { const ss = track.trailS(x, z); return ss > zz.a - 20 && ss < zz.b + 20; })) return true;
    if (track.groundY(x, z) > snowline - 40) return true;
    if (track.village && Number.isFinite(near.dist) && near.s > track.village.a - 4 && near.s < track.village.b && near.dist < 5) return true;
    return track.buildings.length > 0 && nearHouse(x, z, 1);
  };
  // Une piste plus longue a plus de sous-bois (la même densité le long de la piste).
  const more = track.length > 1000 ? track.length / 884 : 1;
  const treeline = track.map.env.treeline ?? null;
  const DRY = new THREE.Color(1.12, 0.98, 0.6), dryTint = new THREE.Color();
  let placed = 0;
  for (let k = 0; k < 90000 * more && placed < 26000 * more; k++) {
    // Surtout près de la piste : c'est là qu'on regarde.
    let x, z;
    if (rand() < 0.75) {
      const ss = rand() * track.length, f = track.sample(ss);
      const side = rand() < 0.5 ? -1 : 1;
      const u = side * (TRAIL_HALF + 0.6 + Math.pow(rand(), 1.6) * 26);
      x = f.x + u * f.rx; z = f.z + u * f.rz;
    } else [x, z] = anywhere();
    const near = track.nearest(x, z, null, 0, 3);
    if (near.dist < TRAIL_HALF + 0.5 && near.inside) continue;
    if (bare(x, z, near)) continue;
    const forest = forestAt(x, z);
    const n = fbm(x / 9, z / 9, 2, 31) * 0.5 + 0.5;
    let kind;
    if (forest > 0.45) { if (rand() > 0.55) continue; kind = 'fern'; }
    else kind = n > 0.62 && rand() < 0.5 ? 'flowers' : rand() < 0.12 ? 'fern' : 'grass';
    const y = track.groundY(x, z);
    const size = kind === 'fern' ? 0.7 + rand() * 0.6 : 0.35 + rand() * 0.45 + (1 - forest) * 0.15;
    q.setFromAxisAngle(up, rand() * Math.PI);
    col.setScalar(0.75 + rand() * 0.4);
    // En altitude, l'herbe est rase et jaunie ; sous les arbres, plus sombre.
    if (treeline !== null) col.multiply(dryTint.setRGB(1, 1, 1).lerp(DRY, smoothstep(treeline - 80, treeline + 30, y)));
    col.multiplyScalar(1 - 0.3 * forest);
    tiles.add(kind, x, z, m4.compose(p.set(x, y - 0.03, z), q, s.set(size * (kind === 'fern' ? 1.5 : 1.2), size, size * (kind === 'fern' ? 1.5 : 1.2))), col);
    placed++;
  }

  // ----- Les rochers et les troncs couchés -----
  const rockMat = rockMaterial(groundTextures, { moss: treeline === null ? 0.55 : 0.35, alpine: treeline !== null });
  const ROCKS = ['rockA', 'rockB', 'rockC', 'rockD'];
  ROCKS.forEach((name, i) => { kinds[name] = { geometry: rockGeometry(i + 1, { detail: 2, cuts: 5 + i }), material: rockMat, castShadow: true, receiveShadow: true, range: 900 }; });
  const rockCount = Math.round(1400 * more * (treeline === null ? 1 : 1.8));
  for (let k = 0; k < rockCount; k++) {
    let x, z;
    if (rand() < 0.7) {
      const ss = rand() * track.length, f = track.sample(ss), side = rand() < 0.5 ? -1 : 1;
      const u = side * (TRAIL_HALF + 1.4 + rand() * 14);
      x = f.x + u * f.rx; z = f.z + u * f.rz;
    } else [x, z] = anywhere();
    const near = track.nearest(x, z, null, 0, 3);
    if (near.dist < TRAIL_HALF + 1.2 && near.inside) continue;
    if (track.buildings.length && nearHouse(x, z, 2)) continue;
    if (track.band !== null && Number.isFinite(near.dist) && near.dist < track.tapeAt(near.s) + 1.5) continue; // (le couloir du glacier)
    if (snowZones.length && track.trailDist(x, z) < 110 && snowZones.some((zz) => { const ss = track.trailS(x, z); return ss > zz.a - 20 && ss < zz.b + 10; })) continue; // (pas de cailloux sur la neige)
    if (track.treeNear(x, z, 0.6)) continue;
    let r = 0.15 + Math.pow(rand(), 2.5) * 1.3;
    const y = track.groundY(x, z);
    if (treeline !== null) {
      // L'alpage : des blocs de granit éboulés, parfois énormes ; jamais sur la piste.
      r *= 1 + 1.3 * smoothstep(treeline - 20, treeline + 20, y);
      if (near.inside) r = Math.min(r, Math.max(0.15, (near.dist - TRAIL_HALF - 0.8) * 0.9));
    }
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 6.3, (rand() - 0.5) * 0.4));
    tiles.add(ROCKS[Math.floor(rand() * ROCKS.length)], x, z, m4.compose(p.set(x, y - r * 0.25, z), q, s.set(r * (1 + rand() * 0.6), r, r * (1 + rand() * 0.4))));
  }
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  logGeo.rotateZ(Math.PI / 2);
  kinds.log = { geometry: logGeo, material: bark, castShadow: true, receiveShadow: true };
  for (let k = 0; k < 220 * more; k++) {
    const [x, z] = anywhere();
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
      for (const e of tiles.meshes) if (e.range) e.mesh.visible = Math.hypot(e.cx - cx, e.cz - cz) < e.range + TILE * 0.71;
    },
  };
}
