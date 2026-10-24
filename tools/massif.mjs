// Le relief des massifs autour des pistes : une carte de hauteurs de 41 km de côté, faite une fois pour toutes.
// - Des arêtes (bruit « ridged multifractal » de Musgrave, sur du bruit de gradient), déformées pour qu'elles
//   serpentent ;
// - en option (DROPS=700000), l'érosion : des centaines de milliers de gouttes de pluie ruissellent, arrachent de la
//   matière dans les pentes et la déposent plus bas (d'après Hans Theobald Beyer, « Implementation of a method for
//   hydraulic erosion », 2015, et l'adaptation de Sebastian Lague). À cette résolution, elle creuse surtout des
//   cuvettes : la carte livrée s'en passe.
// Sortie : public/textures/massif.png, la hauteur sur 16 bits : l'octet fort en rouge, le faible en vert (un navigateur
// ne lit les images qu'en 8 bits par canal) ; 0 = le pied, 65535 = le plus haut sommet.
//   node tools/massif.mjs [aperçu.jpg]       (l'aperçu : la carte vue de dessus, ombrée)

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const N = 1024; // cellules de côté (40 m chacune)
const SEED = 1789;

// ----- Bruit de gradient (Perlin) -----
const perm = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  let s = SEED;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1.41, -1.41, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1.41, -1.41];
function perlin(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const X = ix & 255, Y = iy & 255;
  const g = (i, j, dx, dy) => { const h = perm[perm[X + i] + Y + j] & 7; return GX[h] * dx + GY[h] * dy; };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = g(0, 0, fx, fy), b = g(1, 0, fx - 1, fy), c = g(0, 1, fx, fy - 1), d = g(1, 1, fx - 1, fy - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 0.7;
}
function fbm(x, y, oct) {
  let a = 0, b = 0.5;
  for (let i = 0; i < oct; i++) { a += b * perlin(x, y); x = x * 2.03 + 31.7; y = y * 2.03 - 11.3; b *= 0.5; }
  return a;
}
function ridgedMF(x, y, oct) {
  let result = 0, weight = 1, f = 1;
  for (let i = 0; i < oct; i++) {
    let s = 1 - Math.abs(perlin(x * f + i * 19.1, y * f - i * 7.7));
    s *= s * weight;
    weight = Math.min(1, Math.max(0, s * 2));
    result += s * Math.pow(f, -1.05);
    f *= 2.07;
  }
  return result;
}

// ----- Le relief de départ -----
const H = new Float32Array(N * N);
const t0 = Date.now();
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = i / N * 4.2, y = j / N * 4.2; // 4,2 unités de bruit sur 41 km : une grande arête tous les 8 à 10 km
  const wx = x + 0.45 * fbm(x * 0.6 + 3.1, y * 0.6, 4), wy = y + 0.45 * fbm(x * 0.6, y * 0.6 - 8.2, 4);
  const massif = 0.55 + 0.45 * Math.tanh(1.8 * fbm(x * 0.35 + 5, y * 0.35, 3) + 0.2);
  const r = ridgedMF(wx, wy, 6) / 1.75;
  // Des fonds de vallée larges et plats, des sommets qui se dressent.
  H[j * N + i] = massif * Math.pow(Math.max(0, r), 2.1) + 0.015 * fbm(x * 6, y * 6, 3);
}
console.log('relief de départ', Date.now() - t0, 'ms');

// ----- L'érosion -----
const DROPS = +(process.env.DROPS ?? 0), RADIUS = 3;
const inertia = 0.05, capacityK = 4, minCap = 0.01, depositK = 0.3, erodeK = 0.3, evaporate = 0.01, gravity = 4, life = 40;
// Le pinceau d'érosion : les cellules autour d'une goutte, pondérées.
const brush = [];
{
  let sum = 0;
  for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    const d = Math.hypot(dx, dy);
    if (d < RADIUS) { brush.push([dx, dy, 1 - d / RADIUS]); sum += 1 - d / RADIUS; }
  }
  for (const b of brush) b[2] /= sum;
}
let rs = SEED * 7 + 1;
const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
function heightGrad(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy, k = iy * N + ix;
  const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
  return [a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, (b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u];
}
// Les hauteurs vont de 0 à 1 sur 1 024 cellules : on les ramène à des pentes réalistes pour l'eau.
const SCALE = 260;
for (let i = 0; i < N * N; i++) H[i] *= SCALE;
const t1 = Date.now();
for (let n = 0; n < DROPS; n++) {
  let x = RADIUS + rnd() * (N - 2 * RADIUS - 2), y = RADIUS + rnd() * (N - 2 * RADIUS - 2);
  let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
  for (let step = 0; step < life; step++) {
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
    const [h, gx, gy] = heightGrad(x, y);
    dx = dx * inertia - gx * (1 - inertia);
    dy = dy * inertia - gy * (1 - inertia);
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) break;
    dx /= len; dy /= len;
    x += dx; y += dy;
    if (x < RADIUS || y < RADIUS || x >= N - RADIUS - 1 || y >= N - RADIUS - 1) break;
    const dh = heightGrad(x, y)[0] - h;
    const cap = Math.max(-dh * speed * water * capacityK, minCap);
    const k = iy * N + ix;
    if (sediment > cap || dh > 0) {
      // Dépôt : dans le creux qu'on vient de quitter.
      const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositK;
      sediment -= amount;
      H[k] += amount * (1 - u) * (1 - v); H[k + 1] += amount * u * (1 - v); H[k + N] += amount * (1 - u) * v; H[k + N + 1] += amount * u * v;
    } else {
      // Érosion : autour de la goutte, jamais plus que la pente.
      const amount = Math.min((cap - sediment) * erodeK, -dh);
      for (const [bx, by, w] of brush) {
        const kk = (iy + by) * N + ix + bx;
        const take = Math.min(H[kk], amount * w);
        H[kk] -= take;
        sediment += take;
      }
    }
    speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
    water *= 1 - evaporate;
  }
}
console.log('érosion', DROPS, 'gouttes', Date.now() - t1, 'ms');
for (let i = 0; i < N * N; i++) H[i] /= SCALE;

// ----- Sortie -----
let lo = Infinity, hi = -Infinity;
for (const v of H) { if (v < lo) lo = v; if (v > hi) hi = v; }
const out = Buffer.alloc(N * N * 3);
for (let i = 0; i < N * N; i++) {
  const v = Math.round(((H[i] - lo) / (hi - lo)) * 65535);
  out[i * 3] = v >> 8; out[i * 3 + 1] = v & 255;
}
const ROOT = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(ROOT, 'public/textures'), { recursive: true });
await sharp(out, { raw: { width: N, height: N, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(ROOT, 'public/textures/massif.png'));
console.log('massif.png', (fs.statSync(path.join(ROOT, 'public/textures/massif.png')).size / 1e6).toFixed(2), 'Mo');

// Un aperçu ombré (vue de dessus), si on le demande.
if (process.argv[2]) {
  const img = Buffer.alloc(N * N * 3), L = [-0.55, 0.52, 0.4], ln = Math.hypot(...L);
  const cell = 40, hm = 3000 / (hi - lo);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const ddx = (H[j * N + i + 1] - H[j * N + i - 1]) * hm / (2 * cell), ddz = (H[(j + 1) * N + i] - H[(j - 1) * N + i]) * hm / (2 * cell);
    const nl = Math.hypot(ddx, 1, ddz);
    const lam = Math.max(0, (-ddx * L[0] + L[1] - ddz * L[2]) / (nl * ln));
    const h = (H[j * N + i] - lo) / (hi - lo), k = (j * N + i) * 3;
    const c = h > 0.6 && 1 / nl > 0.75 ? [0.95, 0.95, 1] : [0.4 + 0.3 * h, 0.42 + 0.2 * h, 0.35 + 0.25 * h];
    for (let ch = 0; ch < 3; ch++) img[k + ch] = Math.min(255, 255 * c[ch] * (0.2 + 0.95 * lam));
  }
  await sharp(img, { raw: { width: N, height: N, channels: 3 } }).jpeg().toFile(process.argv[2]);
}
