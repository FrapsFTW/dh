// Le plan d'une piste, vu de dessus : relief ombré, courbes de niveau, tracé coloré selon la pente, points de passage,
// portes et modules. Imprime aussi, tronçon par tronçon, la pente, le virage le plus serré et l'écart au relief.
//   node tools/plan.mjs alpes            → shots/plan-alpes.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { createTrack } from '../src/sim/track.js';

const id = process.argv[2] || 'foret';
const t0 = Date.now();
const t = createTrack(7, id);
console.log(`${t.map.name} : construite en ${Date.now() - t0} ms`);
const y = (s) => t.trailY(s, 0);
const cps = t.controlS;
console.log('pt      s      x      z      y   pente moy  max   rayon min   écart relief');
for (let i = 0; i < cps.length; i++) {
  const a = cps[i], b = cps[i + 1] ?? t.length;
  let gmax = 0, rmin = Infinity, dmin = Infinity, dmax = -Infinity;
  for (let s = a; s < b; s += 1) {
    gmax = Math.max(gmax, (y(s) - y(s + 4)) / 4);
    const f = t.sample(s);
    rmin = Math.min(rmin, 1 / Math.max(Math.abs(f.k), 1e-4));
    dmin = Math.min(dmin, f.d); dmax = Math.max(dmax, f.d);
  }
  const f = t.sample(a);
  const g = b > a ? (y(a) - y(b)) / (b - a) : 0;
  console.log(`${String(i).padStart(2)} ${a.toFixed(0).padStart(6)} ${f.x.toFixed(0).padStart(6)} ${f.z.toFixed(0).padStart(6)} ${y(a).toFixed(1).padStart(6)}   ${(g * 100).toFixed(0).padStart(4)} %  ${(gmax * 100).toFixed(0).padStart(4)} %   ${rmin > 999 ? '   –' : rmin.toFixed(1).padStart(6)} m   ${dmin.toFixed(1)} … ${dmax.toFixed(1)} m`);
}
let kmax = 0;
for (const k of t.K) kmax = Math.max(kmax, Math.abs(k));
let dAbs = 0;
for (const d of t.D) dAbs = Math.max(dAbs, Math.abs(d));
console.log(`longueur ${t.length.toFixed(0)} m · départ→arrivée ${(t.sFinish - t.sStart).toFixed(0)} m · dénivelé ${(y(t.sStart) - y(t.sFinish)).toFixed(0)} m · virage le plus serré ${(1 / kmax).toFixed(1)} m · écart max au relief ${dAbs.toFixed(2)} m · ${t.trees.length} arbres`);
console.log('modules :', t.features.map((f) => `${f.name || f.type} ${f.a.toFixed(0)}–${f.b.toFixed(0)}`).join(' · '));
console.log('portes :', t.gates.map((g) => g.s.toFixed(0)).join(' '));

// ----- L'image -----
const B = t.bounds, SC = 1.2; // pixels par mètre
const W = Math.round((B.xmax - B.xmin) * SC), H = Math.round((B.zmax - B.zmin) * SC);
const img = Buffer.alloc(W * H * 3);
const nat = (x, z) => t.natural(x, z);
let ymin = Infinity, ymax = -Infinity;
const hs = new Float32Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = B.xmin + i / SC, z = B.zmax - j / SC;
  const h = nat(x, z);
  hs[j * W + i] = h; ymin = Math.min(ymin, h); ymax = Math.max(ymax, h);
}
const treeline = t.map.env.treeline;
for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
  const h = hs[j * W + i];
  const dx = hs[j * W + i + 1] - hs[j * W + i - 1], dz = hs[(j - 1) * W + i] - hs[(j + 1) * W + i];
  const shade = Math.max(0.35, Math.min(1.25, 0.85 - (dx - dz) * SC * 0.35));
  const contour = Math.abs(((h % 10) + 10) % 10 - 5) > 4.6 ? 0.7 : 1;
  let r = 120, g = 150, b = 95; // prairie
  if (treeline != null && h > treeline) { r = 165; g = 160; b = 130; }
  const o = (j * W + i) * 3;
  img[o] = Math.min(255, r * shade * contour); img[o + 1] = Math.min(255, g * shade * contour); img[o + 2] = Math.min(255, b * shade * contour);
}
const px = (x) => ((x - B.xmin) * SC).toFixed(1), pz = (z) => ((B.zmax - z) * SC).toFixed(1);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
for (const tr of t.trees) svg += `<circle cx="${px(tr.x)}" cy="${pz(tr.z)}" r="${(tr.h / 9).toFixed(1)}" fill="#1f3d1a" opacity="0.7"/>`;
if (t.map.creek) svg += `<polyline points="${t.map.creek.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="none" stroke="#3c8fd6" stroke-width="3"/>`;
for (let s = 0; s < t.length - 2; s += 2) {
  const a = t.sample(s), b = t.sample(s + 2);
  const g = (y(s) - y(s + 2)) / 2;
  const col = g > 0.35 ? '#ff2a1a' : g > 0.25 ? '#ff8a1a' : g > 0.15 ? '#ffd21a' : g > 0.06 ? '#ffffff' : '#7fd0ff';
  svg += `<line x1="${px(a.x)}" y1="${pz(a.z)}" x2="${px(b.x)}" y2="${pz(b.z)}" stroke="${col}" stroke-width="4"/>`;
}
for (const f of t.features) {
  const a = t.sample(f.a);
  const col = f.type === 'jump' ? '#ff00d0' : f.type === 'rocks' ? '#555' : f.type === 'bridge' ? '#8a5a2b' : '#0050ff';
  svg += `<circle cx="${px(a.x)}" cy="${pz(a.z)}" r="5" fill="${col}" stroke="#000"/><text x="${+px(a.x) + 7}" y="${+pz(a.z) + 4}" font-size="11" font-family="sans-serif" fill="#000">${f.name || f.type}</text>`;
}
for (const gte of t.gates) {
  const a = t.sample(gte.s);
  svg += `<rect x="${+px(a.x) - 5}" y="${+pz(a.z) - 5}" width="10" height="10" fill="#1d5fb8" stroke="#fff"/>`;
}
cps.forEach((s, i) => {
  const a = t.sample(s);
  svg += `<text x="${+px(a.x) - 14}" y="${+pz(a.z) - 6}" font-size="10" font-family="sans-serif" fill="#002" font-weight="bold">${i}</text>`;
});
svg += '</svg>';
mkdirSync('shots', { recursive: true });
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(`shots/plan-${id}.png`);
console.log(`shots/plan-${id}.png (${W}×${H}) · relief ${ymin.toFixed(0)} à ${ymax.toFixed(0)} m`);
