// Le sol : le relief et la piste, avec le même matériau (pas de raccord visible entre les deux).
// Ce sont des photos de sols (Poly Haven, CC0 : voir groundLayers.js), choisies dans le shader à partir de la position :
// herbe en prairie, aiguilles sous les sapins, roche dans les pentes raides, terre sur la piste, plus sombre et lisse
// dans la trace, poussiéreuse sur les bords, des cailloux en altitude, un pierrier, des dalles. Les sols se mêlent
// selon leur relief (les pierres percent la terre, la terre remplit les creux), et chaque photo est décalée par
// endroits pour qu'on ne voie jamais le motif se répéter.
// En montagne, au-dessus de la limite des arbres : alpage ras et jauni, éboulis, affleurements, piste caillouteuse ;
// au loin, un relief simplifié jusqu'à l'horizon, enneigé sur les sommets. Sur un glacier : la neige, des crevasses
// bleues loin du couloir, la trace damée et striée par la dameuse. Dans un village : des pavés.

import * as THREE from 'three';
import { NOISE_GLSL, BUMP_GLSL } from './glsl.js';
import { layerGLSL } from './groundLayers.js';
import { smoothstep, fbm } from '../sim/noise.js';

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

const groundChunk = (low) => /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uGroundC, uGroundN;
uniform float uTreeline, uSnowline;
varying vec3 vWPos;
varying vec3 vWN;
varying float vForest;
varying vec3 vTrail; // x : u (mètres, travers de la piste), y : s (le long), z : la demi-largeur de la trace (0 hors piste)
varying float vRocky; // 1 dans un pierrier
varying float vSlab; // 1 sur une dalle de granit
varying float vSnow; // 1 sur un glacier
varying float vCrev; // 1 là où il peut y avoir des crevasses (le glacier, loin du couloir)
varying float vCobble; // 1 sur les pavés d'un village
${NOISE_GLSL}
${BUMP_GLSL}
${layerGLSL()}

// Le point et ses dérivées à l'écran ; l'indice qui décale les photos par endroits.
vec2 gq, gdx, gdy;
vec3 gP, gPx, gPy;
float gk;
// Ce qu'on accumule, couche après couche : la couleur, la normale de la photo (xy), sa hauteur, la rugosité.
vec3 gCol;
vec2 gT;
float gHt, gR;

// Une couche, ramenée à la teinte voulue. Chaque photo est lue deux fois, avec deux décalages qui changent tous les
// dix mètres environ, et fondue de l'une à l'autre : le motif ne se répète pas.
void dh_sample(int L, vec2 uv, vec2 dx, vec2 dy, out vec4 c, out vec4 n) {
  float layer = float(L);
#if ${low ? 1 : 0}
  c = textureGrad(uGroundC, vec3(uv, layer), dx, dy);
  n = textureGrad(uGroundN, vec3(uv, layer), dx, dy);
#else
  float l = gk * 6.0 + layer * 0.37;
  float ia = floor(l), f = fract(l);
  vec2 oa = sin(vec2(3.0, 7.0) * ia) * 7.31, ob = sin(vec2(3.0, 7.0) * (ia + 1.0)) * 7.31;
  vec4 ca = textureGrad(uGroundC, vec3(uv + oa, layer), dx, dy);
  vec4 cb = textureGrad(uGroundC, vec3(uv + ob, layer), dx, dy);
  vec4 na = textureGrad(uGroundN, vec3(uv + oa, layer), dx, dy);
  vec4 nb = textureGrad(uGroundN, vec3(uv + ob, layer), dx, dy);
  float t = smoothstep(0.2, 0.8, f - 0.1 * dot(ca.rgb - cb.rgb, vec3(1.0)));
  c = mix(ca, cb, t);
  n = mix(na, nb, t);
#endif
  vec3 cs = c.rgb * DH_SCALE[L];
  c.rgb = mix(cs, dot(cs, vec3(0.2126, 0.7152, 0.0722)) * DH_TINT[L], DH_RECOLOR[L]);
}

// Pose une couche par-dessus les précédentes, sur une part w : là où elle est plus haute que ce qui est dessous, elle
// recouvre plus tôt (des pierres qui percent), là où elle est plus basse, plus tard (de la terre dans les creux).
void dh_blend(int L, float w, vec3 tint, vec4 c, vec4 n) {
  float a = smoothstep(0.1, 0.9, w + (n.b - gHt) * 0.9 * clamp(w * (1.0 - w) * 4.0, 0.0, 1.0));
  gCol = mix(gCol, c.rgb * tint, a);
  gT = mix(gT, n.xy * 2.0 - 1.0, a);
  gHt = mix(gHt, n.b, a);
  gR = mix(gR, DH_ROUGH[L], a);
}
void dh_put(int L, float w, vec3 tint) {
  if (w < 0.004) return;
  float sz = DH_SIZE[L];
  vec4 c, n;
  dh_sample(L, gq / sz, gdx / sz, gdy / sz, c, n);
  dh_blend(L, w, tint, c, n);
}
// La roche, projetée sur les trois plans (elle couvre les pentes raides, où une projection d'en haut s'étirerait).
void dh_putRock(int L, float w, vec3 tint, vec3 N) {
  if (w < 0.004) return;
  float sz = DH_SIZE[L];
  vec3 bw = pow(abs(N), vec3(4.0));
  bw /= bw.x + bw.y + bw.z;
  vec4 c = vec4(0.0), n = vec4(0.0), c1, n1;
  float used = 0.0;
  if (bw.y > 0.04) { dh_sample(L, gP.xz / sz, gPx.xz / sz, gPy.xz / sz, c1, n1); c += c1 * bw.y; n += n1 * bw.y; used += bw.y; }
  if (bw.x > 0.04) { dh_sample(L, gP.zy / sz, gPx.zy / sz, gPy.zy / sz, c1, n1); c += c1 * bw.x; n += n1 * bw.x; used += bw.x; }
  if (bw.z > 0.04) { dh_sample(L, gP.xy / sz, gPx.xy / sz, gPy.xy / sz, c1, n1); c += c1 * bw.z; n += n1 * bw.z; used += bw.z; }
  dh_blend(L, w, tint, c / used, n / used);
}

// Couleur, rugosité, normale (dans le monde) du sol en un point, et une petite hauteur pour les reliefs dessinés ici
// (crevasses, stries de la dameuse, ornières).
void dh_ground(out vec3 col, out float rough, out float h, out vec3 nW) {
  gP = vWPos; gPx = dFdx(gP); gPy = dFdy(gP);
  vec2 q = gP.xz;
  gq = q; gdx = gPx.xz; gdy = gPy.xz;
  vec3 N = normalize(vWN);
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);
  float m1 = dh_fbm(q * 0.035);
  float m2 = dh_noise(q * 0.45);
  float m3 = dh_noise(q * 3.1);
  gk = dh_noise(q * 0.09);
  gCol = vec3(0.0); gT = vec2(0.0); gHt = 0.5; gR = 1.0;
  h = 0.0;

  // Les étendues : prairie (des plaques plus sèches), alpage au-dessus des arbres, aiguilles sous les sapins,
  // éboulis, roche dans les pentes raides, neige des sommets.
  float dry = smoothstep(0.58, 0.82, dh_fbm(q * 0.08 + 5.0));
  float wf = smoothstep(0.12, 0.65, vForest + (m2 - 0.5) * 0.25);
  float alp = smoothstep(uTreeline - 25.0, uTreeline + 25.0, gP.y + (m1 - 0.5) * 40.0);
  float scree = smoothstep(0.62, 0.8, dh_fbm(q * 0.03 + 21.0) + slope * 0.4) * alp;
  float wr = smoothstep(0.45 - 0.14 * alp, 0.65 - 0.14 * alp, slope + (m2 - 0.5) * 0.2);
  float snow = smoothstep(uSnowline, uSnowline + 70.0, gP.y + (m1 - 0.5) * 120.0) * (1.0 - smoothstep(0.45, 0.7, slope));
  dh_put(L_PRAIRIE, 1.0, mix(vec3(1.0), vec3(1.3, 1.12, 0.72), dry * 0.6) * (0.84 + 0.32 * m1));
  dh_put(L_ALPAGE, alp, vec3(0.88 + 0.3 * m1));
  dh_put(L_AIGUILLES, wf, vec3(0.88 + 0.25 * m1));
  dh_put(L_PIERRIER, scree, vec3(0.95 + 0.1 * m1));
  dh_putRock(L_ROCHE, wr, vec3(0.9 + 0.2 * m1), N);
  dh_put(L_NEIGE, snow, vec3(1.0));
  // De loin, une forêt est la masse sombre de ses cimes, pas le sol sous les arbres.
  float canopy = wf * smoothstep(120.0, 400.0, length(gP - cameraPosition)) * (1.0 - snow);
  gCol = mix(gCol, vec3(0.026, 0.045, 0.022) * (0.75 + 0.5 * m1) * (0.85 + 0.3 * m2), canopy);
  gT *= 1.0 - canopy;

  // Le glacier : de la neige partout, ridée par le vent, bleutée dans les creux ; des crevasses loin du couloir.
  if (vSnow > 0.0) {
    float drift = dh_noise(q * vec2(0.09, 0.35) + 2.0) * 0.6 + dh_noise(q * 0.9) * 0.4;
    dh_put(L_NEIGE, vSnow, mix(vec3(0.86, 0.91, 1.0), vec3(1.0), smoothstep(0.25, 0.8, drift)));
    float crack = vCrev * smoothstep(0.045, 0.0, abs(dh_noise(q * vec2(0.035, 0.16) + 11.0) - 0.5)) * smoothstep(0.35, 0.6, dh_noise(q * 0.02 + 4.0));
    gCol = mix(gCol, vec3(0.13, 0.32, 0.5), crack);
    gR = mix(gR, 0.3, crack);
    h += (drift * 0.8 - crack * 2.0) * vSnow;
  }

  // La piste.
  if (vTrail.z > 0.0) {
    float u = vTrail.x, s = vTrail.y, au = abs(u);
    float edge = (dh_noise(vec2(s * 0.6, u * 0.8)) - 0.5) * 0.9 + (m3 - 0.5) * 0.3;
    float th = vTrail.z; // (plus fine dans un passage étroit)
    float onTrail = 1.0 - smoothstep(th - 0.1, th + 1.0, au + edge);
    // La trace (le milieu) : plus sombre et tassée ; les bords poussiéreux ; des traces de pneus dans la pente.
    float line = 1.0 - smoothstep(0.25, 1.1, abs(u - (dh_noise(vec2(s * 0.05, 3.0)) - 0.5) * 0.8));
    float dust = smoothstep(min(0.9, th * 0.6), th, au + edge * 0.6);
    float streak = dh_noise(vec2(u * 7.0, s * 0.12));
    vec3 tt = mix(vec3(1.0), vec3(1.2, 1.14, 1.04), dust) * mix(1.0, 0.78, line) * (0.9 + 0.18 * streak);
    // Terre en forêt, avec des passages caillouteux ; graviers en altitude.
    dh_put(L_TERRE, onTrail, tt);
    dh_put(L_GRAVIER, onTrail * max(alp, 0.45 * smoothstep(0.55, 0.8, dh_fbm(q * 0.05 + 13.0))), tt);
    gR = mix(gR, gR * 0.86, line * onTrail);
    // Le pierrier, et la dalle de granit.
    dh_put(L_PIERRIER, vRocky * smoothstep(0.0, 0.4, 1.0 - au / 3.2), vec3(1.0));
    float slabW = vSlab * (1.0 - smoothstep(th + 0.6, th + 2.2, au + edge));
    dh_putRock(L_ROCHE, slabW, vec3(1.08), N);
    // Sur le glacier, la trace est de la neige damée, striée par la dameuse et creusée d'ornières par les pneus.
    if (vSnow > 0.0) {
      float cord = 0.5 + 0.5 * sin(u * 34.0 + dh_noise(vec2(s * 0.02, 1.0)) * 6.0);
      float ruts = smoothstep(0.55, 0.95, dh_noise(vec2(u * 3.5, s * 0.03))) * (1.0 - smoothstep(3.0, 5.0, au));
      float snowT = vSnow * (1.0 - smoothstep(4.6, 5.9, au + edge));
      dh_put(L_NEIGE, snowT, vec3(0.97, 0.98, 1.0) * (0.95 + 0.05 * cord) * (1.0 - 0.12 * ruts));
      gR = mix(gR, 0.42, snowT);
      h += (cord * 0.15 - ruts * 0.8) * snowT;
    }
    // Les pavés du village, usés et plus sombres au milieu, là où tout le monde passe.
    if (vCobble > 0.0) dh_put(L_PAVES, vCobble * (1.0 - smoothstep(3.6, 4.4, au + edge * 0.3)), vec3(1.0 - 0.15 * line));
  }

  col = gCol;
  rough = gR;
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
  nW = normalize(N * sqrt(max(0.05, 1.0 - dot(gT, gT))) + T * gT.x - B * gT.y);
}
`;

/** Le matériau du sol. tex : les photos (loadGroundTextures) ; low : une seule lecture par photo. */
function groundMaterial(env, tex, low) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    uTreeline: { value: env.treeline ?? 1e5 }, uSnowline: { value: env.snowline ?? 1e5 },
    uGroundC: { value: tex.color }, uGroundN: { value: tex.relief },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float forest;
attribute vec3 trailInfo;
attribute float rocky;
attribute float slab;
attribute vec3 extra; // x : glacier, y : crevasses, z : pavés
varying vec3 vWPos;
varying vec3 vWN;
varying float vForest;
varying vec3 vTrail;
varying float vRocky;
varying float vSlab;
varying float vSnow;
varying float vCrev;
varying float vCobble;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);
vForest = forest;
vTrail = trailInfo;
vRocky = rocky;
vSlab = slab;
vSnow = extra.x;
vCrev = extra.y;
vCobble = extra.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${groundChunk(low)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gColor; float gRough; float gH; vec3 gN;
dh_ground(gColor, gRough, gH, gN);
diffuseColor.rgb = gColor;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mat3(viewMatrix) * gN) * faceDirection;
float bumpFade = 1.0 - smoothstep(6.0, 40.0, length(vViewPosition));
normal = dh_perturbNormal(-vViewPosition, normal, gH * 0.012 * bumpFade, faceDirection);`);
  };
  mat.customProgramCacheKey = () => `sol-${low}`;
  return mat;
}

/** Les deux maillages du sol, prêts à afficher. tex : les photos du sol (loadGroundTextures). */
export function createGround(sim, tex, { low = false } = {}) {
  const { track, terrain, ribbon } = sim;
  const env = track.map.env;
  const material = () => groundMaterial(env, tex, low);
  const forestAt = forestDensity(track);
  // Les tronçons de neige (le glacier) et de pavés (le village), d'après les sols de la carte, fondus sur 30 et 3 m.
  const zoneW = (surf, fade) => {
    const zs = track.surfaces.filter((z) => z.surface === surf);
    return (s) => { let w = 0; for (const z of zs) w = Math.max(w, smoothstep(z.a - fade, z.a, s) * (1 - smoothstep(z.b, z.b + fade, s))); return w; };
  };
  const snowAt = zoneW('neige', 30), cobbleAt = zoneW('paves', 3);

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
  // Le glacier et ses crevasses sur le relief (seulement pour le relief en bande, qui sait où il est le long de la piste).
  const tExtra = new Float32Array(nT * 3);
  if (terrain.sOf) for (let i = 0; i < nT; i++) {
    const sn = snowAt(terrain.sOf[i]);
    tExtra[i * 3] = sn * (1 - smoothstep(55, 75, terrain.dOf[i]));
    tExtra[i * 3 + 1] = sn * smoothstep(24, 34, terrain.dOf[i]);
  }
  tg.setAttribute('extra', new THREE.BufferAttribute(tExtra, 3));
  tg.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(tg, material());
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
    rTrail[i * 3] = u; rTrail[i * 3 + 1] = s; rTrail[i * 3 + 2] = track.trailHalfAt(s);
    for (const f of rocks) rRocky[i] = Math.max(rRocky[i], smoothstep(f.a - 1, f.a + 2, s) * (1 - smoothstep(f.b - 2, f.b + 1, s)));
    for (const f of slabs) rSlab[i] = Math.max(rSlab[i], smoothstep(f.a - 1, f.a + 1, s) * (1 - smoothstep(f.b - 1, f.b + 1, s)));
  }
  rg.setAttribute('forest', new THREE.BufferAttribute(rForest, 1));
  rg.setAttribute('trailInfo', new THREE.BufferAttribute(rTrail, 3));
  rg.setAttribute('rocky', new THREE.BufferAttribute(rRocky, 1));
  rg.setAttribute('slab', new THREE.BufferAttribute(rSlab, 1));
  const rExtra = new Float32Array(nR * 3);
  for (let i = 0; i < nR; i++) { const s = ribbon.uv[i * 2 + 1]; rExtra[i * 3] = snowAt(s); rExtra[i * 3 + 2] = cobbleAt(s); }
  rg.setAttribute('extra', new THREE.BufferAttribute(rExtra, 3));
  rg.computeVertexNormals();
  const ribbonMat = material();
  ribbonMat.polygonOffset = true;
  ribbonMat.polygonOffsetFactor = -1;
  ribbonMat.polygonOffsetUnits = -2;
  const ribbonMesh = new THREE.Mesh(rg, ribbonMat);
  ribbonMesh.receiveShadow = true;

  const far = env.far ? createFarTerrain(track, terrain, env, material) : null;
  return { terrainMesh, ribbonMesh, forestAt, far };
}

/**
 * Le relief lointain, jusqu'à l'horizon : la même montagne (track.natural), en grandes mailles, sans physique. Sous le
 * relief détaillé, il est abaissé (il ne doit jamais percer) ; une jupe borde le relief détaillé pour cacher la marche.
 */
function createFarTerrain(track, terrain, env, material) {
  const B = track.bounds, R = env.far.radius, STEP = env.far.step || 14;
  const c = track.sample(track.length / 2);
  const n = Math.ceil((2 * R) / STEP) + 1;
  const pos = new Float32Array(n * n * 3), forest = new Float32Array(n * n);
  const x0 = c.x - R, z0 = c.z - R;
  const tl = env.treeline ?? 1e5;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP;
    // Distance à l'intérieur du relief détaillé (négative dehors) : le rectangle de la piste, ou sa bande.
    const inside = terrain.band ? track.band - track.trailDist(x, z) : Math.min(x - B.xmin, B.xmax - x, z - B.zmin, B.zmax - z);
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
  g.setAttribute('extra', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material());
  mesh.name = 'relief lointain';

  // La jupe : le bord du relief détaillé, prolongé de 6 m vers le bas (le tour du rectangle, ou chaque arête du bord
  // de la bande).
  const { nx, nz, positions } = terrain;
  const pairs = [];
  if (terrain.edges) for (let e = 0; e < terrain.edges.length; e += 2) pairs.push([terrain.edges[e], terrain.edges[e + 1]]);
  else {
    const edge = [];
    for (let i = 0; i < nx; i++) edge.push(i);
    for (let j = 1; j < nz; j++) edge.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) edge.push((nz - 1) * nx + i);
    for (let j = nz - 2; j >= 0; j--) edge.push(j * nx);
    for (let e = 0; e + 1 < edge.length; e++) pairs.push([edge[e], edge[e + 1]]);
  }
  const sp = new Float32Array(pairs.length * 4 * 3), sIdx = [];
  pairs.forEach(([ka, kb], e) => {
    [[ka, 0], [ka, -6], [kb, 0], [kb, -6]].forEach(([k, dy], o) => {
      sp[(e * 4 + o) * 3] = positions[k * 3]; sp[(e * 4 + o) * 3 + 1] = positions[k * 3 + 1] + dy; sp[(e * 4 + o) * 3 + 2] = positions[k * 3 + 2];
    });
    const a = e * 4;
    sIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  });
  const nSkirt = pairs.length * 4;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('forest', new THREE.BufferAttribute(new Float32Array(nSkirt), 1));
  sg.setAttribute('trailInfo', new THREE.BufferAttribute(new Float32Array(nSkirt * 3), 3));
  sg.setAttribute('rocky', new THREE.BufferAttribute(new Float32Array(nSkirt), 1));
  sg.setAttribute('slab', new THREE.BufferAttribute(new Float32Array(nSkirt), 1));
  sg.setAttribute('extra', new THREE.BufferAttribute(new Float32Array(nSkirt * 3), 3));
  sg.setIndex(sIdx);
  sg.computeVertexNormals();
  const skirtMat = material();
  skirtMat.side = THREE.DoubleSide;
  const group = new THREE.Group();
  group.add(mesh, new THREE.Mesh(sg, skirtMat));
  return group;
}
