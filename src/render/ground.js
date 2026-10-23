// Le sol : le relief et la piste, avec le même matériau procédural (pas de raccord visible entre les deux).
// Tout est calculé dans le shader à partir de la position : herbe et fleurs sèches en prairie, aiguilles et mousse
// sous les sapins, roche dans les pentes raides ; sur la piste, terre tassée, trace plus sombre au milieu,
// bords poussiéreux, traces de freinage, cailloux dans les pierriers, dalles de granit.
// En montagne, au-dessus de la limite des arbres : alpage ras et jauni, éboulis, affleurements, piste caillouteuse ;
// au loin, un relief simplifié jusqu'à l'horizon, enneigé sur les sommets.

import * as THREE from 'three';
import { NOISE_GLSL, BUMP_GLSL } from './glsl.js';
import { TRAIL_HALF } from '../sim/track.js';
import { smoothstep, fbm } from '../sim/noise.js';

const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();
export const GROUND_COLORS = {
  grassA: C('#53722a'), grassB: C('#7a9338'), grassDry: C('#a39a58'),
  needles: C('#5e4229'), moss: C('#3c5223'),
  dirt: C('#99714c'), dirtDark: C('#6a4a31'), dust: C('#bc9d74'),
  rock: C('#8c877e'), rockDark: C('#5d5953'),
};

/** Densité de forêt (0 à 1), lissée, sur une grille de 2 m : partagée par le relief et la piste. */
export function forestDensity(track) {
  const B = track.bounds, cell = 2;
  const nx = Math.ceil((B.xmax - B.xmin) / cell) + 1, nz = Math.ceil((B.zmax - B.zmin) / cell) + 1;
  const grid = new Float32Array(nx * nz);
  const R = 4; // cellules (8 m)
  for (const t of track.trees) {
    const ci = Math.round((t.x - B.xmin) / cell), cj = Math.round((t.z - B.zmin) / cell);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const w = Math.exp(-(di * di + dj * dj) / 8);
      grid[j * nx + i] += w;
    }
  }
  const at = (x, z) => {
    const fx = (x - B.xmin) / cell, fz = (z - B.zmin) / cell;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const a = grid[j * nx + i], b = grid[j * nx + i + 1], c = grid[(j + 1) * nx + i], d = grid[(j + 1) * nx + i + 1];
    const v = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    return Math.min(1, v / 2.2);
  };
  return at;
}

const groundChunk = /* glsl */ `
uniform vec3 uGrassA, uGrassB, uGrassDry, uNeedles, uMoss, uDirt, uDirtDark, uDust, uRock, uRockDark;
uniform float uTreeline, uSnowline;
varying vec3 vWPos;
varying vec3 vWN;
varying float vForest;
varying vec3 vTrail; // x : u (mètres, travers de la piste), y : s (le long), z : 1 si on est sur la piste
varying float vRocky; // 1 dans un pierrier
varying float vSlab; // 1 sur une dalle de granit
${NOISE_GLSL}
${BUMP_GLSL}

// Couleur, rugosité et petite hauteur (pour le bosselage) du sol en un point.
void dh_ground(out vec3 col, out float rough, out float h) {
  vec2 q = vWPos.xz;
  float slope = 1.0 - clamp(vWN.y, 0.0, 1.0);
  float m1 = dh_fbm(q * 0.035);
  float m2 = dh_noise(q * 0.45);
  float m3 = dh_noise(q * 3.1);
  float m4 = dh_noise(q * 11.0);

  // Prairie : deux verts, des plaques d'herbe sèche, du grain.
  vec3 grass = mix(uGrassA, uGrassB, smoothstep(0.3, 0.72, m1));
  grass = mix(grass, uGrassDry, smoothstep(0.58, 0.82, dh_fbm(q * 0.08 + 5.0)) * 0.7);
  grass *= 0.78 + 0.32 * m3 + 0.12 * m4;
  // Sous-bois : aiguilles et mousse.
  vec3 floorC = mix(uNeedles, uMoss, smoothstep(0.38, 0.66, dh_fbm(q * 0.11 + 9.0)));
  floorC *= 0.75 + 0.4 * m3;
  float wf = smoothstep(0.12, 0.65, vForest + (m2 - 0.5) * 0.25);
  // L'alpage, au-dessus des arbres : herbe rase et jaunie, plaques de terre, éboulis gris.
  float alp = smoothstep(uTreeline - 25.0, uTreeline + 25.0, vWPos.y + (m1 - 0.5) * 40.0);
  vec3 pasture = mix(uGrassDry * vec3(1.02, 0.97, 0.86), uGrassA * vec3(1.05, 1.0, 0.8), smoothstep(0.3, 0.75, dh_fbm(q * 0.05 + 3.0)));
  pasture *= 0.8 + 0.3 * m3 + 0.1 * m4;
  float scree = smoothstep(0.62, 0.8, dh_fbm(q * 0.03 + 21.0) + slope * 0.4) * alp;
  pasture = mix(pasture, mix(uRockDark, uRock, dh_noise(q * 2.3)) * (0.9 + 0.3 * (1.0 - dh_cells(q * 1.7))), scree);
  grass = mix(grass, pasture, alp);
  col = mix(grass, floorC, wf);
  rough = 1.0;
  h = (m4 * 0.5 + m3 * 0.5) * mix(0.6, 1.0, wf);
  h = mix(h, (1.0 - dh_cells(q * 1.7)) * 1.3, scree);

  // Roche dans les pentes raides (plus tôt en altitude, où la terre est mince).
  float wr = smoothstep(0.45 - 0.14 * alp, 0.65 - 0.14 * alp, slope + (m2 - 0.5) * 0.2);
  vec3 rock = mix(uRockDark, uRock, smoothstep(0.3, 0.7, dh_fbm(q * 0.6))) * (0.85 + 0.25 * m4);
  col = mix(col, rock, wr);
  h = mix(h, dh_fbm(q * 2.0) * 1.6, wr);

  // La neige des sommets (au loin), qui ne tient pas dans les pentes les plus raides.
  float snow = smoothstep(uSnowline, uSnowline + 70.0, vWPos.y + (m1 - 0.5) * 120.0) * (1.0 - smoothstep(0.45, 0.7, slope));
  col = mix(col, vec3(0.92, 0.94, 0.98), snow);

  // La piste.
  if (vTrail.z > 0.0) {
    float u = vTrail.x, s = vTrail.y, au = abs(u);
    float edge = (dh_noise(vec2(s * 0.6, u * 0.8)) - 0.5) * 0.9 + (m3 - 0.5) * 0.3;
    float onTrail = 1.0 - smoothstep(${(TRAIL_HALF - 0.1).toFixed(2)}, ${(TRAIL_HALF + 1.0).toFixed(2)}, au + edge);
    // Terre : plus sombre et tassée dans la trace (le milieu), poussiéreuse et claire sur les bords.
    float line = 1.0 - smoothstep(0.25, 1.1, abs(u - (dh_noise(vec2(s * 0.05, 3.0)) - 0.5) * 0.8));
    vec3 dirt = mix(uDirt, uDust, smoothstep(0.9, ${TRAIL_HALF.toFixed(2)}, au + edge * 0.6));
    dirt = mix(dirt, uDirtDark, line * 0.75);
    // En altitude, la terre est grise de graviers.
    dirt = mix(dirt, mix(uRock, uDust, 0.3) * (0.8 + 0.3 * m4 + 0.15 * m3), alp * 0.75);
    // Les traces de pneus et de freinage, dans le sens de la descente.
    float streak = dh_noise(vec2(u * 7.0, s * 0.12));
    dirt *= 0.86 + 0.22 * streak + 0.12 * m3;
    float pebbles = 1.0 - dh_cells(q * 6.0);
    dirt = mix(dirt, uRock * (0.9 + 0.25 * alp), smoothstep(0.55 - 0.1 * alp, 0.8, pebbles) * (0.35 + 0.3 * alp) * (1.0 - line * (1.0 - 0.5 * alp)));
    // Le pierrier : des pierres claires serrées, de la terre sombre dans les joints.
    float cob = dh_cells(q * 2.6);
    vec3 cobble = mix(uRock * (0.9 + 0.3 * dh_noise(q * 5.0)), uDirtDark, smoothstep(0.55, 0.85, cob));
    float rocky = vRocky, slab = vSlab;
    dirt = mix(dirt, cobble, rocky * smoothstep(0.0, 0.4, 1.0 - au / 3.2));
    // La dalle : du granit clair, lisse, veiné de fissures sombres et de lichen.
    float crack = smoothstep(0.03, 0.0, abs(dh_noise(q * vec2(0.35, 1.4)) - 0.5)) + smoothstep(0.025, 0.0, abs(dh_noise(q * 0.9 + 7.0) - 0.5));
    vec3 granite = mix(uRock * 1.15, uRock * 0.9, dh_fbm(q * 1.5)) * (0.92 + 0.12 * m4);
    granite = mix(granite, vec3(0.62, 0.64, 0.5) * uRock, smoothstep(0.65, 0.8, dh_fbm(q * 0.7 + 4.0)) * 0.6);
    granite = mix(granite, uRockDark * 0.5, clamp(crack, 0.0, 1.0) * 0.8);
    float slabW = slab * (1.0 - smoothstep(${(TRAIL_HALF + 0.6).toFixed(2)}, ${(TRAIL_HALF + 2.2).toFixed(2)}, au + edge));
    dirt = mix(dirt, granite, slabW);
    col = mix(col, dirt, max(onTrail, slabW));
    rough = mix(rough, mix(mix(0.95, 0.82, line), 0.6, slabW), max(onTrail, slabW));
    h = mix(h, mix(pebbles * 0.7 + streak * 0.3 + rocky * (1.0 - cob) * 1.5, 0.15 * dh_fbm(q * 3.0) - crack * 0.6, slabW), max(onTrail, slabW));
  }
}
`;

function groundMaterial(env = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = { uTreeline: { value: env.treeline ?? 1e5 }, uSnowline: { value: env.snowline ?? 1e5 } };
  for (const [k, v] of Object.entries(GROUND_COLORS)) uniforms['u' + k[0].toUpperCase() + k.slice(1)] = { value: v };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float forest;
attribute vec3 trailInfo;
attribute float rocky;
attribute float slab;
varying vec3 vWPos;
varying vec3 vWN;
varying float vForest;
varying vec3 vTrail;
varying float vRocky;
varying float vSlab;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);
vForest = forest;
vTrail = trailInfo;
vRocky = rocky;
vSlab = slab;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${groundChunk}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gCol; float gRough; float gH;
dh_ground(gCol, gRough, gH);
diffuseColor.rgb = gCol;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float bumpFade = 1.0 - smoothstep(6.0, 40.0, length(vViewPosition));
normal = dh_perturbNormal(-vViewPosition, normal, gH * 0.012 * bumpFade, faceDirection);`);
  };
  return mat;
}

/** Les deux maillages du sol, prêts à afficher. */
export function createGround(sim) {
  const { track, terrain, ribbon } = sim;
  const forestAt = forestDensity(track);

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(terrain.positions, 3));
  tg.setIndex(new THREE.BufferAttribute(terrain.indices, 1));
  const nT = terrain.positions.length / 3;
  const tForest = new Float32Array(nT), tTrail = new Float32Array(nT * 3), tRocky = new Float32Array(nT);
  for (let i = 0; i < nT; i++) tForest[i] = forestAt(terrain.positions[i * 3], terrain.positions[i * 3 + 2]);
  tg.setAttribute('forest', new THREE.BufferAttribute(tForest, 1));
  tg.setAttribute('trailInfo', new THREE.BufferAttribute(tTrail, 3));
  tg.setAttribute('rocky', new THREE.BufferAttribute(tRocky, 1));
  tg.setAttribute('slab', new THREE.BufferAttribute(new Float32Array(nT), 1));
  tg.computeVertexNormals();
  const env = track.map.env;
  const terrainMesh = new THREE.Mesh(tg, groundMaterial(env));
  terrainMesh.receiveShadow = true;

  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
  rg.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
  const nR = ribbon.positions.length / 3;
  const rForest = new Float32Array(nR), rTrail = new Float32Array(nR * 3), rRocky = new Float32Array(nR), rSlab = new Float32Array(nR);
  const rocks = track.features.filter((f) => f.type === 'rocks'), slabs = track.features.filter((f) => f.type === 'slab');
  for (let i = 0; i < nR; i++) {
    const x = ribbon.positions[i * 3], z = ribbon.positions[i * 3 + 2];
    const u = ribbon.uv[i * 2], s = ribbon.uv[i * 2 + 1];
    rForest[i] = forestAt(x, z);
    rTrail[i * 3] = u; rTrail[i * 3 + 1] = s; rTrail[i * 3 + 2] = 1;
    for (const f of rocks) rRocky[i] = Math.max(rRocky[i], smoothstep(f.a - 1, f.a + 2, s) * (1 - smoothstep(f.b - 2, f.b + 1, s)));
    for (const f of slabs) rSlab[i] = Math.max(rSlab[i], smoothstep(f.a - 1, f.a + 1, s) * (1 - smoothstep(f.b - 1, f.b + 1, s)));
  }
  rg.setAttribute('forest', new THREE.BufferAttribute(rForest, 1));
  rg.setAttribute('trailInfo', new THREE.BufferAttribute(rTrail, 3));
  rg.setAttribute('rocky', new THREE.BufferAttribute(rRocky, 1));
  rg.setAttribute('slab', new THREE.BufferAttribute(rSlab, 1));
  rg.computeVertexNormals();
  const ribbonMat = groundMaterial(env);
  ribbonMat.polygonOffset = true;
  ribbonMat.polygonOffsetFactor = -1;
  ribbonMat.polygonOffsetUnits = -2;
  const ribbonMesh = new THREE.Mesh(rg, ribbonMat);
  ribbonMesh.receiveShadow = true;

  const far = env.far ? createFarTerrain(track, terrain, env) : null;
  return { terrainMesh, ribbonMesh, forestAt, far };
}

/**
 * Le relief lointain, jusqu'à l'horizon : la même montagne (track.natural), en grandes mailles, sans physique. Sous le
 * relief détaillé, il est abaissé (il ne doit jamais percer) ; une jupe borde le relief détaillé pour cacher la marche.
 */
function createFarTerrain(track, terrain, env) {
  const B = track.bounds, R = env.far.radius, STEP = env.far.step || 14;
  const c = track.sample(track.length / 2);
  const n = Math.ceil((2 * R) / STEP) + 1;
  const pos = new Float32Array(n * n * 3), forest = new Float32Array(n * n);
  const x0 = c.x - R, z0 = c.z - R;
  const tl = env.treeline ?? 1e5;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP;
    // Distance à l'intérieur du relief détaillé (négative dehors).
    const inside = Math.min(x - B.xmin, B.xmax - x, z - B.zmin, B.zmax - z);
    const y = track.natural(x, z) - 1.2 - 5 * smoothstep(0, 40, inside);
    const o = (j * n + i) * 3;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    // De loin, la forêt est une teinte : dense sous la limite des arbres, en taches.
    forest[j * n + i] = (1 - smoothstep(tl - 30, tl + 5, y)) * smoothstep(0.3, 0.6, fbm(x / 160, z / 160, 3, 5) * 0.5 + 0.75);
  }
  const idx = [];
  const inR = (i, j) => Math.hypot(x0 + i * STEP - c.x, z0 + j * STEP - c.z) < R;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    if (!inR(i, j) && !inR(i + 1, j + 1)) continue;
    const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('forest', new THREE.BufferAttribute(forest, 1));
  g.setAttribute('trailInfo', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute('rocky', new THREE.BufferAttribute(new Float32Array(n * n), 1));
  g.setAttribute('slab', new THREE.BufferAttribute(new Float32Array(n * n), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, groundMaterial(env));
  mesh.name = 'relief lointain';

  // La jupe : le bord du relief détaillé, prolongé de 6 m vers le bas.
  const { nx, nz, positions } = terrain;
  const edge = [];
  for (let i = 0; i < nx; i++) edge.push(i);
  for (let j = 1; j < nz; j++) edge.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) edge.push((nz - 1) * nx + i);
  for (let j = nz - 2; j >= 0; j--) edge.push(j * nx);
  const sp = new Float32Array(edge.length * 2 * 3), sIdx = [];
  edge.forEach((k, e) => {
    for (const [o, dy] of [[0, 0], [1, -6]]) {
      sp[(e * 2 + o) * 3] = positions[k * 3]; sp[(e * 2 + o) * 3 + 1] = positions[k * 3 + 1] + dy; sp[(e * 2 + o) * 3 + 2] = positions[k * 3 + 2];
    }
    if (e + 1 < edge.length) { const a = e * 2; sIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('forest', new THREE.BufferAttribute(new Float32Array(edge.length * 2), 1));
  sg.setAttribute('trailInfo', new THREE.BufferAttribute(new Float32Array(edge.length * 6), 3));
  sg.setAttribute('rocky', new THREE.BufferAttribute(new Float32Array(edge.length * 2), 1));
  sg.setAttribute('slab', new THREE.BufferAttribute(new Float32Array(edge.length * 2), 1));
  sg.setIndex(sIdx);
  sg.computeVertexNormals();
  const skirtMat = groundMaterial(env);
  skirtMat.side = THREE.DoubleSide;
  const group = new THREE.Group();
  group.add(mesh, new THREE.Mesh(sg, skirtMat));
  return group;
}
