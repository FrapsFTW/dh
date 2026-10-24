// Les textures du sol : des photos CC0 de Poly Haven (polyhaven.com), téléchargées en 1K puis empilées en deux
// images, une couche par sol :
// - public/textures/sol-couleur.jpg : la couleur (l'occlusion ambiante y est déjà appliquée, légèrement) ;
// - public/textures/sol-relief.jpg : la normale (x dans R, y dans G, format OpenGL) et la hauteur (B), qui sert à
//   mêler les sols comme dans la nature : les cailloux percent la terre, la terre remplit les creux entre les pierres.
// Le jeu en fait deux tableaux de textures (src/render/groundTextures.js). Les originaux restent dans tools/.cache.
//   node tools/ground-textures.mjs

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GROUND_LAYERS, VILLAGE_TEXTURES } from '../src/render/groundLayers.js';

const SIZE = 1024;
const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools/.cache/textures');
const OUT = path.join(ROOT, 'public/textures');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function download(id, map) {
  const file = path.join(CACHE, `${id}_${map}_1k.jpg`);
  if (fs.existsSync(file)) return file;
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const url = files[map]['1k'].jpg.url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log('  téléchargé', path.basename(file));
  return file;
}

const raw = async (file, channels) => {
  const { data } = await sharp(file).resize(SIZE, SIZE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (channels === 1) { const out = Buffer.alloc(SIZE * SIZE); for (let i = 0; i < out.length; i++) out[i] = data[i * 3]; return out; }
  return data;
};

const N = GROUND_LAYERS.length;
const color = Buffer.alloc(SIZE * SIZE * N * 3), relief = Buffer.alloc(SIZE * SIZE * N * 3);
for (const [k, layer] of GROUND_LAYERS.entries()) {
  console.log(k, layer.id);
  const [diff, nor, disp, ao] = await Promise.all(['Diffuse', 'nor_gl', 'Displacement', 'AO'].map((m) => download(layer.id, m)));
  const [c, n, h, a] = await Promise.all([raw(diff, 3), raw(nor, 3), raw(disp, 1), raw(ao, 1)]);
  // La hauteur étirée sur toute la plage (certaines photos n'en utilisent qu'un tiers).
  let lo = 255, hi = 0;
  for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const o = k * SIZE * SIZE * 3;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const occ = 0.55 + 0.45 * (a[i] / 255);
    for (let ch = 0; ch < 3; ch++) color[o + i * 3 + ch] = Math.round(c[i * 3 + ch] * occ);
    relief[o + i * 3] = n[i * 3];
    relief[o + i * 3 + 1] = n[i * 3 + 1];
    relief[o + i * 3 + 2] = Math.round(((h[i] - lo) / Math.max(1, hi - lo)) * 255);
  }
}
const opts = { raw: { width: SIZE, height: SIZE * N, channels: 3 } };
await sharp(color, opts).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(OUT, 'sol-couleur.jpg'));
await sharp(relief, opts).jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(path.join(OUT, 'sol-relief.jpg'));
for (const f of ['sol-couleur.jpg', 'sol-relief.jpg']) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2), 'Mo');

// Les matières du village, chacune en deux images : la couleur (occlusion appliquée) et la normale.
for (const [name, id] of Object.entries(VILLAGE_TEXTURES)) {
  const [diff, nor, ao] = await Promise.all(['Diffuse', 'nor_gl', 'AO'].map((m) => download(id, m)));
  const [c, a] = await Promise.all([raw(diff, 3), raw(ao, 1)]);
  const col = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) for (let ch = 0; ch < 3; ch++) col[i * 3 + ch] = Math.round(c[i * 3 + ch] * (0.5 + 0.5 * (a[i] / 255)));
  const o = { raw: { width: SIZE, height: SIZE, channels: 3 } };
  await sharp(col, o).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(OUT, `${name}-couleur.jpg`));
  await sharp(nor).resize(SIZE, SIZE).jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(path.join(OUT, `${name}-relief.jpg`));
  console.log(name, id);
}
