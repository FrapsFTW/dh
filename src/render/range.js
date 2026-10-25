// Les massifs autour de la piste, jusqu'à 20 km : un vrai relief (la carte de hauteurs de tools/massif.mjs), posé sur
// le relief de la carte, qu'il prolonge sans marche au bord du relief lointain.
// - Un maillage en anneaux, de plus en plus larges avec la distance (le détail est là où on le voit).
// - Les ombres que les sommets portent les uns sur les autres, et le creux des vallées (moins de ciel), calculés une fois
//   au lancement : c'est ce qui donne leur volume aux montagnes, bien plus que l'éclairage seul.
// - Les matières selon l'altitude, la pente et l'exposition : forêt, alpages, éboulis, roche, neige (qui tient plus
//   longtemps sur les faces à l'ombre).
// Les massifs sont dessinés à part, avant le reste (voir post.js) : leur échelle (des dizaines de kilomètres) ruinerait la
// précision de profondeur de la scène proche.

import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { smoothstep } from '../sim/noise.js';

const CELL = 40; // m, une cellule de la carte de hauteurs
export const RANGE_RADIUS = 20000;

/** La carte de hauteurs des massifs : { N, h } (h de 0 à 1). */
export async function loadMassif() {
  const res = await fetch(`${import.meta.env.BASE_URL}textures/massif.png`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const N = bmp.width;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, N, N).data;
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;
  return { N, h };
}

/**
 * Les massifs de la carte. env.range : { height : la hauteur des sommets au-dessus de leur socle (m), top : le plus haut
 * que monte le socle au-dessus du départ (m), ramp : la distance sur laquelle ils sortent du relief de la carte (m),
 * scale : la taille des massifs (1 : une grande arête tous les 8 à 10 km ; moins pour des collines) }.
 */
export function createRange(track, massif, { sunDir, low = false } = {}) {
  const env = track.map.env, R = env.range || {};
  const c = track.sample(track.length / 2);
  const r0 = env.far.radius - (env.far.step || 14), r1 = RANGE_RADIUS;
  const height = R.height ?? 2400, ramp = R.ramp ?? 2500, sea = env.sea;
  const base = track.trailY(track.length, 0) - 120, top = track.trailY(0, 0) + (R.top ?? 150);
  const { N, h: M } = massif;
  const cell = CELL * (R.scale ?? 1), half = (N * cell) / 2;
  const massifAt = (x, z) => {
    // (au-delà de ses bords, la carte se répète en miroir : pas de couture)
    const mirror = (f) => { const p = 2 * (N - 1), u = ((f % p) + p) % p; return Math.min(N - 1.001, u < N - 1 ? u : p - u); };
    const fx = mirror((x - c.x + half) / cell), fz = mirror((z - c.z + half) / cell);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * N + i;
    return (M[k] * (1 - u) + M[k + 1] * u) * (1 - v) + (M[k + N] * (1 - u) + M[k + N + 1] * u) * v;
  };
  // La hauteur : le relief de la carte près du bord, puis les massifs sur un socle qui suit ce relief (borné : loin de
  // la piste, la fonction de relief n'a plus de sens).
  const heightAt = (x, z) => {
    const r = Math.hypot(x - c.x, z - c.z);
    const w = smoothstep(r0, r0 + ramp, r);
    const nat = track.natural(x, z);
    const floor = Math.min(top, Math.max(base, nat));
    // (le relief de la carte, vite ramené sur le socle : il monterait sans fin)
    const natC = nat + (floor - nat) * smoothstep(r0, r0 + ramp * 0.35, r);
    const rim = 0.35 * smoothstep(r1 * 0.72, r1, r); // une couronne de sommets ferme l'horizon
    let y = natC - 3 + w * (floor + height * (massifAt(x, z) + rim) - natC + 3);
    // Face à la mer (env.sea), pas de massif : le relief plonge sous l'eau (les bords du secteur font des caps).
    if (sea) {
      const toward = ((x - c.x) * sea.dir[0] + (z - c.z) * sea.dir[1]) / Math.max(r, 1);
      const m = smoothstep(Math.cos(sea.open + 0.2), Math.cos(sea.open - 0.2), toward) * smoothstep(r0 * 0.4, r0, r);
      y += (Math.min(y, sea.level - 30) - y) * m;
    }
    return y - (r * r) / (2 * 6371000); // la rondeur de la Terre
  };

  // ----- Une grille grossière des hauteurs, pour les ombres et le creux des vallées -----
  const G = 120, gn = Math.ceil((2 * r1) / G) + 1, gx0 = c.x - r1, gz0 = c.z - r1;
  const grid = new Float32Array(gn * gn);
  for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) grid[j * gn + i] = heightAt(gx0 + i * G, gz0 + j * G);
  const gridAt = (x, z) => {
    const fx = (x - gx0) / G, fz = (z - gz0) / G;
    if (fx < 0 || fz < 0 || fx >= gn - 1 || fz >= gn - 1) return -1e9;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * gn + i;
    return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + gn] * (1 - u) + grid[k + gn + 1] * u) * v;
  };
  // Le creux : la hauteur moyenne alentour (sur ~500 m), comparée à celle du point.
  const blur = new Float32Array(gn * gn), tmp = new Float32Array(gn * gn), B = 4;
  for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) {
    let s = 0, n = 0;
    for (let d = -B; d <= B; d++) { const ii = i + d; if (ii >= 0 && ii < gn) { s += grid[j * gn + ii]; n++; } }
    tmp[j * gn + i] = s / n;
  }
  for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) {
    let s = 0, n = 0;
    for (let d = -B; d <= B; d++) { const jj = j + d; if (jj >= 0 && jj < gn) { s += tmp[jj * gn + i]; n++; } }
    blur[j * gn + i] = s / n;
  }
  const blurAt = (x, z) => {
    const i = Math.min(gn - 1, Math.max(0, Math.round((x - gx0) / G))), j = Math.min(gn - 1, Math.max(0, Math.round((z - gz0) / G)));
    return blur[j * gn + i];
  };

  // ----- Le maillage en anneaux -----
  const A = low ? 512 : 1024, NR = low ? 80 : 128;
  const count = A * NR;
  const pos = new Float32Array(count * 3), shade = new Float32Array(count * 2);
  const sun = sunDir.clone().normalize();
  const sh = Math.hypot(sun.x, sun.z), sx = sun.x / sh, sz = sun.z / sh, rise = sun.y / sh;
  for (let k = 0; k < NR; k++) {
    const r = r0 * Math.pow(r1 / r0, k / (NR - 1));
    for (let a = 0; a < A; a++) {
      const ang = (a / A) * Math.PI * 2;
      const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
      const y = heightAt(x, z);
      const o = k * A + a;
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      // L'ombre, douce : on remonte vers le soleil ; la pénombre vient du relief qui passe le plus près du rayon.
      let lit = 1;
      for (let t = 40; t < 14000; t = t * 1.07 + 30) {
        const gy = gridAt(x + sx * t, z + sz * t);
        if (gy < -1e8) break;
        lit = Math.min(lit, (y + 4 + rise * t - gy) / (t * 0.035));
        if (lit <= 0) { lit = 0; break; }
      }
      shade[o * 2] = Math.max(0, Math.min(1, lit));
      shade[o * 2 + 1] = Math.max(0.45, Math.min(1.12, 1 + (y - blurAt(x, z)) / 260));
    }
  }
  const idx = new Uint32Array((NR - 1) * A * 6);
  let p = 0;
  for (let k = 0; k < NR - 1; k++) for (let a = 0; a < A; a++) {
    const i0 = k * A + a, i1 = k * A + ((a + 1) % A), i2 = i0 + A, i3 = i1 + A;
    idx[p++] = i0; idx[p++] = i1; idx[p++] = i2;
    idx[p++] = i1; idx[p++] = i3; idx[p++] = i2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('shade', new THREE.BufferAttribute(shade, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, rangeMaterial(env, sun));
  mesh.frustumCulled = false;
  mesh.name = 'massifs';
  return { mesh, heightAt };
}

function rangeMaterial(env, sun) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const forestAll = env.treeline == null; // une carte de forêt : des collines boisées
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 shade;
varying vec2 vShade;
varying vec3 vRW;
varying vec3 vRN;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vShade = shade;
vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vShade;
varying vec3 vRW;
varying vec3 vRN;
${NOISE_GLSL}
const float TREELINE = ${(forestAll ? 1e5 : env.treeline).toFixed(1)};
const float SNOWLINE = ${(env.snowline ?? 1e5).toFixed(1)};
const vec3 SUN = vec3(${sun.x.toFixed(4)}, ${sun.y.toFixed(4)}, ${sun.z.toFixed(4)});
// Le petit relief qu'on ne modélise pas (arêtes, ravines), en mètres.
float rh(vec2 p) { return dh_fbm(p * 0.0045) * 110.0 + dh_fbm(p * 0.019 + 3.0) * 26.0; }
vec3 rN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 q = vRW.xz;
  vec3 N0 = normalize(vRN);
  vec2 e = vec2(9.0, 0.0);
  vec2 g = vec2(rh(q + e.xy) - rh(q - e.xy), rh(q + e.yx) - rh(q - e.yx)) / 18.0;
  rN = normalize(N0 + vec3(-g.x, 0.0, -g.y) * 0.9);
  float slope = 1.0 - rN.y;
  float n1 = dh_fbm(q * 0.0011), n2 = dh_fbm(q * 0.006 + 9.0), n3 = dh_noise(q * 0.04);
  float alt = vRW.y + (n1 - 0.5) * 260.0;
  // La roche : gris chaud, en bancs (des strates), plus claire sur les arêtes.
  float strata = 0.5 + 0.5 * sin(vRW.y * 0.045 + n2 * 7.0);
  vec3 rock = mix(vec3(0.115, 0.105, 0.095), vec3(0.24, 0.215, 0.185), n2) * (0.8 + 0.25 * strata) * (0.85 + 0.3 * n3);
  // Les éboulis au pied des parois, plus clairs ; les alpages ; la forêt, sombre.
  vec3 scree = vec3(0.24, 0.23, 0.21) * (0.85 + 0.3 * n3);
  vec3 meadow = mix(vec3(0.085, 0.11, 0.035), vec3(0.17, 0.16, 0.07), n1) * (0.85 + 0.3 * n3);
  vec3 forest = vec3(0.022, 0.042, 0.02) * (0.75 + 0.5 * n2);
  float steep = smoothstep(0.32, 0.52, slope + (n2 - 0.5) * 0.25);
  float wForest = (1.0 - smoothstep(TREELINE - 80.0, TREELINE + 40.0, alt)) * (1.0 - smoothstep(0.5, 0.7, slope + (n3 - 0.5) * 0.2));
  vec3 col = mix(meadow, scree, smoothstep(0.18, 0.34, slope) * smoothstep(TREELINE, TREELINE + 300.0, alt));
  col = mix(col, forest, wForest);
  col = mix(col, rock, max(steep, smoothstep(TREELINE + 500.0, TREELINE + 900.0, alt) * smoothstep(0.15, 0.3, slope)));
  // La neige : au-dessus de sa limite, pas dans les parois ; plus bas sur les faces à l'ombre, en coulées dans les
  // ravines.
  float shadeSide = 1.0 - max(dot(normalize(vec3(rN.x, 0.0, rN.z) + 1e-4), normalize(vec3(SUN.x, 0.0, SUN.z))), 0.0);
  float sl = SNOWLINE - 220.0 * shadeSide + (n2 - 0.5) * 300.0;
  float snow = smoothstep(sl, sl + 160.0, alt) * (1.0 - smoothstep(0.55, 0.78, slope + (n3 - 0.5) * 0.3));
  snow = max(snow, smoothstep(sl + 300.0, sl + 600.0, alt) * smoothstep(0.55, 0.75, n3 + 0.3 * (1.0 - slope)) * 0.85);
  col = mix(col, vec3(0.80, 0.83, 0.88) * (0.94 + 0.08 * n3), snow);
  diffuseColor.rgb = col;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mat3(viewMatrix) * rN);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.directDiffuse *= vShade.x;
reflectedLight.directSpecular *= vShade.x;
reflectedLight.indirectDiffuse *= vShade.y;`);
  };
  mat.customProgramCacheKey = () => 'massifs';
  return mat;
}
