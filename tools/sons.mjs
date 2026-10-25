// Les sons enregistrés : des prises de son CC0 de Freesound (freesound.org), choisies pour leur qualité (notes et
// téléchargements), téléchargées en aperçu MP3, puis préparées pour le jeu dans public/sons/ :
// - une boucle : le passage le plus régulier (ou le plus fourni) de la prise, à la durée voulue, et sans couture : sa
//   fin est fondue dans son début (fondu à puissance constante), si bien qu'on peut la rejouer en boucle à l'infini ;
// - un son ponctuel : de l'attaque à l'extinction, avec un court fondu de sortie ;
// - le niveau : les boucles à -20 dBFS efficaces, les sons ponctuels à -1 dBFS en crête ; le mélange se fait au jeu.
// Les originaux restent dans tools/.cache/sons. La liste des prises et de leurs auteurs : public/sons/CREDITS.txt.
//   node tools/sons.mjs

import fs from 'node:fs';
import path from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import { Mp3Encoder } from '@breezystack/lamejs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools/.cache/sons');
const OUT = path.join(ROOT, 'public/sons');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// nom : [id Freesound, auteur, id de l'auteur, ce qu'on en fait, réglages]
//   boucle : { dur, choix: 'regulier' (le passage le plus stable) | 'fourni' (le plus dense) , stereo }
//   ponctuel : { max (durée au plus) }
export const SONS = {
  // ----- Le vélo -----
  'roule-terre': [218301, 'SpliceSound', 1480854, 'boucle', { dur: 12, choix: 'regulier' }],
  'roule-gravier': [321851, 'GordoH', 3204902, 'boucle', { dur: 12, choix: 'regulier' }],
  derapage: [437537, 'prsvl', 2896087, 'boucle', { dur: 1.6, choix: 'fourni' }],
  'roue-libre': [274481, 'yurkobb', 2023784, 'boucle', { dur: 1.9, choix: 'regulier' }],
  chaine: [441256, 'EpicWizard', 2291325, 'boucle', { dur: 8, choix: 'regulier' }],
  'chute-metal': [534161, 'bouncyballblue', 11531251, 'ponctuel', { max: 1.3 }],
  chute: [78483, '1sticky8', 1226546, 'ponctuel', { max: 3 }],
  // ----- La course -----
  foule: [365132, 'SoundsExciting', 3279490, 'boucle', { dur: 10, choix: 'fourni', stereo: true }],
  'foule-arrivee': [130568, 'benfree', 2024417, 'boucle', { dur: 14, choix: 'fourni', stereo: true }],
  cloche: [189785, 'dnewtonjr', 2800743, 'ponctuel', { max: 1.6 }],
  corne: [414208, 'jacksonacademyashmore', 6938106, 'ponctuel', { max: 1.6 }],
  // ----- Les lieux -----
  foret: [385280, 'bajko', 2341984, 'boucle', { dur: 30, choix: 'fourni', stereo: true }],
  alpage: [517468, 'Astounded', 10201334, 'boucle', { dur: 30, choix: 'fourni', stereo: true }],
  cigales: [422048, 'Nimlos', 4710044, 'boucle', { dur: 14, choix: 'regulier', stereo: true }],
  mer: [531015, 'Noted451', 9818404, 'boucle', { dur: 25, choix: 'fourni', stereo: true }],
  torrent: [376192, 'piermic', 3874114, 'boucle', { dur: 20, choix: 'regulier', stereo: true }],
  telesiege: [263134, 'dmartinp', 2174585, 'boucle', { dur: 20, choix: 'regulier', stereo: true }],
  pylone: [519459, 'andriiperevodchyk', 2669559, 'ponctuel', { max: 4 }],
  'cloche-eglise': [425172, 'Audeption', 8323418, 'ponctuel', { max: 12 }],
  mouettes: [510917, 'Lydmakeren', 11157357, 'ponctuel', { max: 8 }],
  corbeau: [66763, 'Bidone', 706955, 'ponctuel', { max: 2.1 }],
};

async function download(id, userId) {
  const file = path.join(CACHE, `${id}.mp3`);
  if (fs.existsSync(file)) return file;
  const url = `https://cdn.freesound.org/previews/${Math.floor(id / 1000)}/${id}_${userId}-hq.mp3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
const rmsOf = (chs, a, b) => { let s = 0, n = 0; for (const c of chs) for (let i = a; i < b; i++) { s += c[i] * c[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };

/** Le passage de `len` échantillons : le plus régulier (énergie stable par tranches de 100 ms) ou le plus fourni. */
function pickLoop(chs, sr, len, choix) {
  const N = chs[0].length, frame = Math.round(sr * 0.1), margin = Math.round(sr * 0.3);
  if (N <= len + 2 * margin) return Math.max(0, Math.floor((N - len) / 2));
  const frames = [];
  for (let i = 0; i + frame <= N; i += frame) frames.push(rmsOf(chs, i, i + frame));
  const nf = Math.floor(len / frame);
  let best = margin, bestScore = -Infinity;
  for (let a = margin; a + len + margin <= N; a += Math.round(sr * 0.25)) {
    const f0 = Math.floor(a / frame), w = frames.slice(f0, f0 + nf).map(db);
    const mean = w.reduce((s, v) => s + v, 0) / w.length;
    const sd = Math.sqrt(w.reduce((s, v) => s + (v - mean) ** 2, 0) / w.length);
    // (régulier : peu d'écart, sans trou ; fourni : du niveau, sans pic isolé)
    const holes = w.filter((v) => v < mean - 12).length;
    const score = choix === 'regulier' ? -sd - holes : mean - 0.5 * sd - holes;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/** Un son ponctuel : de l'attaque (10 ms avant de franchir 10 % de la crête) à l'extinction (-45 dB sous la crête). */
function pickShot(chs, sr, maxLen) {
  const N = chs[0].length;
  let peak = 0;
  for (const c of chs) for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(c[i]));
  let a = 0;
  while (a < N && chs.every((c) => Math.abs(c[a]) < peak * 0.1)) a++;
  a = Math.max(0, a - Math.round(sr * 0.01));
  const frame = Math.round(sr * 0.02);
  let b = Math.min(N, a + Math.round(maxLen * sr));
  while (b - frame > a + frame && db(rmsOf(chs, b - frame, b)) < db(peak) - 45) b -= frame;
  return [a, b];
}

function encode(chs, sr, kbps) {
  const enc = new Mp3Encoder(chs.length, sr, kbps), parts = [], BLOCK = 1152;
  const toInt = (c) => { const o = new Int16Array(c.length); for (let i = 0; i < c.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))); return o; };
  const ints = chs.map(toInt);
  for (let i = 0; i < ints[0].length; i += BLOCK) {
    const buf = chs.length === 2 ? enc.encodeBuffer(ints[0].subarray(i, i + BLOCK), ints[1].subarray(i, i + BLOCK)) : enc.encodeBuffer(ints[0].subarray(i, i + BLOCK));
    if (buf.length) parts.push(Buffer.from(buf));
  }
  parts.push(Buffer.from(enc.flush()));
  return Buffer.concat(parts);
}

const decoder = new MPEGDecoder();
await decoder.ready;
const credits = ['Les sons enregistrés du jeu : des prises de son de Freesound (freesound.org), toutes sous licence', 'Creative Commons 0 (domaine public). Merci à leurs auteurs.', ''];
for (const [name, [id, user, userId, mode, opt]] of Object.entries(SONS)) {
  const file = await download(id, userId);
  const { channelData, sampleRate: sr } = decoder.decode(new Uint8Array(fs.readFileSync(file)));
  await decoder.reset(); // (pour la prise suivante)
  let chs = opt.stereo && channelData.length > 1 ? channelData.slice(0, 2) : [channelData.length > 1 ? channelData[0].map((v, i) => (v + channelData[1][i]) / 2) : channelData[0]];
  let a, b;
  let xf = 0;
  if (mode === 'boucle') {
    // (on prend xf de plus : la fin, fondue dans le début)
    xf = Math.round(Math.min(0.6, opt.dur * 0.15) * sr);
    const len = Math.min(chs[0].length - xf, Math.round(opt.dur * sr));
    a = pickLoop(chs, sr, len + xf, opt.choix); b = a + len;
    chs = chs.map((c) => {
      const o = c.slice(a, b);
      for (let i = 0; i < xf; i++) { const t = (i / xf) * Math.PI / 2; o[i] = c[a + i] * Math.sin(t) + c[b + i] * Math.cos(t); }
      return o;
    });
  } else {
    [a, b] = pickShot(chs, sr, opt.max);
    chs = chs.map((c) => c.slice(a, b));
  }
  // Le niveau.
  const N = chs[0].length;
  let peak = 0;
  for (const c of chs) for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(c[i]));
  const rms = rmsOf(chs, 0, N);
  // (une prise aux crêtes très marquées, comme des graviers qui craquent, gagne jusqu'à 8 dB de plus : ses crêtes
  // passent alors dans un limiteur doux, au-dessus de 0,7)
  const gain = mode === 'boucle' ? Math.min(10 ** (-20 / 20) / rms, 2.5 * 0.95 / peak) : 0.89 / peak;
  const soft = (x) => { const a = Math.abs(x), t = 0.7; return a <= t ? x : Math.sign(x) * (t + (1 - t) * Math.tanh((a - t) / (1 - t))); };
  // Les bords d'un son ponctuel : 5 ms à l'attaque, 60 ms à l'extinction (une boucle n'en a pas : elle est sans couture).
  const fin = mode === 'boucle' ? 0 : Math.round(sr * 0.06), deb = mode === 'boucle' ? 0 : Math.round(sr * 0.005);
  for (const c of chs) for (let i = 0; i < N; i++) {
    let g = gain;
    if (i < deb) g *= i / deb;
    if (fin && i > N - fin) g *= (N - i) / fin;
    c[i] = soft(c[i] * g);
  }
  const mp3 = encode(chs, sr, chs.length === 2 ? 128 : 96);
  fs.writeFileSync(path.join(OUT, `${name}.mp3`), mp3);
  console.log(`${name.padEnd(14)} ${mode.padEnd(8)} ${(N / sr).toFixed(1).padStart(5)} s depuis ${(a / sr).toFixed(1).padStart(6)} s, ${chs.length === 2 ? 'stéréo' : 'mono  '}, ${(db(rmsOf(chs, 0, N))).toFixed(1)} dBFS, ${(mp3.length / 1024).toFixed(0)} Ko`);
  if (process.env.APERCU) fs.writeFileSync(path.join(CACHE, `${name}.f32`), Buffer.from(chs[0].buffer, chs[0].byteOffset, chs[0].byteLength));
  credits.push(`${name}.mp3 : « ${id} » de ${user}, https://freesound.org/people/${user}/sounds/${id}/`);
}
decoder.free();
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), credits.join('\n') + '\n');
