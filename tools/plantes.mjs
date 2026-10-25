// Les plantes du sous-bois : des scans de Poly Haven (polyhaven.com, tous en CC0), préparés pour le jeu :
//   node tools/plantes.mjs   → public/plantes/<nom>.glb, et public/plantes/CREDITS.txt
//
// Pour chaque espèce, le modèle en définition 1k :
// - chaque plante du scan devient une variante, posée à l'origine (pied au sol, centrée), dans son nœud ;
//   un scan d'un seul tenant (plusieurs plantes alignées) est coupé là où il y a un vide entre elles ;
// - allégée (meshoptimizer, en gardant les coordonnées de texture), jusqu'à un nombre de triangles par plante ;
// - la texture : couleur et transparence réunies dans un WebP (la transparence de Poly Haven est une image à part) ;
// - le maillage compressé (EXT_meshopt_compression) : le jeu le décode avec MeshoptDecoder.
// Les originaux restent dans tools/.cache/plantes.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools/.cache/plantes');
const OUT = path.join(ROOT, 'public/plantes');
fs.mkdirSync(OUT, { recursive: true });

// nom : id Poly Haven, triangles par plante au plus, plantes à écarter (d'après leur nom), taille de la texture, erreur
// permise en allégeant (en part de la taille de la plante : plus pour un buisson dense, qui part de très haut)
export const ESPECES = {
  fougere: { id: 'fern_02', tris: 550 },
  herbe: { id: 'grass_medium_01', tris: 160, skip: /tiny|small|mid_[bc]|large_b|tall_c/ },
  'herbe-seche': { id: 'grass_medium_02', tris: 200 },
  pissenlit: { id: 'dandelion_01', tris: 450 },
  ficaire: { id: 'celandine_01', tris: 350 },
  empodium: { id: 'flower_empodium', tris: 300 },
  ortie: { id: 'nettle_plant', tris: 550, skip: /small_b/ },
  bardane: { id: 'weed_plant_02', tris: 400 },
  oseille: { id: 'shrub_sorrel_01', tris: 220, skip: /_[g-k]$/ },
  arbrisseau: { id: 'shrub_03', tris: 450 },
  myrtille: { id: 'shrub_04', tris: 500, split: true },
  bruyere: { id: 'wild_rooibos_bush', tris: 600, skip: /_a$/ },
  gazania: { id: 'flower_gazania', tris: 400, skip: /_[a-d]_/ },
  myrte: { id: 'othonna_cerarioides', tris: 900, err: 0.3, skip: /_[abg]$/ },
};

async function download(id) {
  const dir = path.join(CACHE, id);
  fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
  const info = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const meta = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  const get = async (url, file) => {
    if (fs.existsSync(file)) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} : ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  };
  const g = info.gltf['1k'].gltf;
  await get(g.url, path.join(dir, `${id}.gltf`));
  for (const [k, v] of Object.entries(g.include)) await get(v.url, path.join(dir, k));
  await get(info.Alpha['1k'].png.url, path.join(dir, 'alpha.png'));
  return { file: path.join(dir, `${id}.gltf`), dir, authors: Object.keys(meta.authors || {}), name: meta.name };
}

/** Les plantes du scan : pour chaque nœud, ses triangles dans le repère du monde (positions, normales, uv). */
function readPlants(doc, skip) {
  const plants = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || (skip && skip.test(node.getName()))) continue;
    const W = node.getWorldMatrix();
    const pos = [], nrm = [], uv = [], idx = [];
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TEXCOORD_0');
      const base = pos.length / 3, p = [], n = [], t = [];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, p); N.getElement(i, n); T.getElement(i, t);
        pos.push(W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13], W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]);
        const nx = W[0] * n[0] + W[4] * n[1] + W[8] * n[2], ny = W[1] * n[0] + W[5] * n[1] + W[9] * n[2], nz = W[2] * n[0] + W[6] * n[1] + W[10] * n[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nrm.push(nx / l, ny / l, nz / l);
        uv.push(t[0], t[1]);
      }
      const I = prim.getIndices().getArray();
      for (let i = 0; i < I.length; i++) idx.push(base + I[i]);
    }
    plants.push({ name: node.getName(), pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx) });
  }
  return plants;
}

/** Un scan d'un seul tenant : on le coupe le long de son plus grand côté, là où un vide de 3 cm sépare les plantes. */
function splitRow(plant) {
  const { pos, idx } = plant;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  const ax = mx[0] - mn[0] > mx[2] - mn[2] ? 0 : 2;
  // Les triangles, rangés par leur étendue le long de l'axe ; une coupure là où aucun ne chevauche.
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]].map((i) => pos[i * 3 + ax]);
    tris.push({ t, a: Math.min(...v), b: Math.max(...v) });
  }
  tris.sort((p, q) => p.a - q.a);
  const groups = [[]];
  let reach = -Infinity;
  for (const tr of tris) {
    if (groups.at(-1).length && tr.a > reach + 0.03) groups.push([]);
    groups.at(-1).push(tr.t);
    reach = Math.max(reach, tr.b);
  }
  return groups.filter((g) => g.length > 40).map((g, k) => {
    const list = new Uint32Array(g.length * 3);
    g.forEach((t, i) => list.set(idx.subarray(t, t + 3), i * 3));
    return { ...plant, name: `${plant.name}_${k}`, idx: list };
  });
}

/** Ne garde que les sommets utilisés ; pied au sol (y = 0), centrée en x et z. */
function compact(plant) {
  const remap = new Map(), pos = [], nrm = [], uv = [];
  const idx = new Uint32Array(plant.idx.length);
  for (let i = 0; i < plant.idx.length; i++) {
    const v = plant.idx[i];
    if (!remap.has(v)) {
      remap.set(v, pos.length / 3);
      pos.push(plant.pos[v * 3], plant.pos[v * 3 + 1], plant.pos[v * 3 + 2]);
      nrm.push(plant.nrm[v * 3], plant.nrm[v * 3 + 1], plant.nrm[v * 3 + 2]);
      uv.push(plant.uv[v * 2], plant.uv[v * 2 + 1]);
    }
    idx[i] = remap.get(v);
  }
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  const c = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] -= c[k];
  return { name: plant.name, pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

/** Allège une plante jusqu'à `tris` triangles, en gardant ses coordonnées de texture (les feuilles restent en place). */
function simplify(plant, tris, err = 0.08) {
  if (plant.idx.length / 3 <= tris) return plant;
  const n = plant.pos.length / 3, attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) attrs.set([plant.uv[i * 2], plant.uv[i * 2 + 1], plant.nrm[i * 3], plant.nrm[i * 3 + 1], plant.nrm[i * 3 + 2]], i * 5);
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(plant.idx, plant.pos, 3, attrs, 5, [1.5, 1.5, 0.3, 0.3, 0.3], null, tris * 3, err);
  return compact({ ...plant, idx });
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const credits = ['Les plantes du sous-bois : des scans de Poly Haven (polyhaven.com), sous licence Creative Commons 0', '(domaine public). Merci à leurs auteurs.', ''];
for (const [nom, esp] of Object.entries(ESPECES)) {
  const src = await download(esp.id);
  const srcDoc = await io.read(src.file);
  let plants = readPlants(srcDoc, esp.skip);
  if (esp.split) plants = plants.flatMap(splitRow);
  plants = plants.map(compact).map((p) => simplify(p, esp.tris, esp.err));

  // La texture : la couleur, et la transparence en quatrième canal.
  const texDir = path.join(src.dir, 'textures');
  const diff = fs.readdirSync(texDir).find((f) => /_diff_/.test(f));
  const size = esp.tex || 1024;
  // (la transparence de Poly Haven est sur 16 bits : on assemble les quatre canaux à la main, sur 8 bits)
  const alpha = await sharp(path.join(src.dir, 'alpha.png')).resize(size, size).extractChannel(0).raw({ depth: 'uchar' }).toBuffer();
  const rgb = await sharp(path.join(texDir, diff)).resize(size, size).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i]; }
  const webp = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 88, alphaQuality: 95 }).toBuffer();
  const srcMat = srcDoc.getRoot().listMaterials()[0];

  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const tex = doc.createTexture(nom).setImage(webp).setMimeType('image/webp');
  const mat = doc.createMaterial(nom).setBaseColorTexture(tex).setAlphaMode('MASK').setAlphaCutoff(srcMat.getAlphaCutoff() || 0.5)
    .setDoubleSided(true).setRoughnessFactor(0.85).setMetallicFactor(0);
  const scene = doc.createScene(nom);
  let total = 0;
  for (const p of plants) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = doc.createPrimitive().setMaterial(mat).setIndices(acc('SCALAR', p.idx))
      .setAttribute('POSITION', acc('VEC3', p.pos)).setAttribute('NORMAL', acc('VEC3', p.nrm)).setAttribute('TEXCOORD_0', acc('VEC2', p.uv));
    scene.addChild(doc.createNode(p.name).setMesh(doc.createMesh(p.name).addPrimitive(prim)));
    total += p.idx.length / 3;
  }
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `${nom}.glb`);
  await io.write(out, doc);
  console.log(`${nom.padEnd(12)} ${esp.id.padEnd(18)} ${String(plants.length).padStart(2)} plantes, ${String(Math.round(total / plants.length)).padStart(4)} triangles chacune, ${plants.map((p) => p.size[1].toFixed(2)).join('/')} m de haut, ${(fs.statSync(out).size / 1024).toFixed(0)} Ko`);
  credits.push(`${nom}.glb : « ${src.name} » (${src.authors.join(', ')}), https://polyhaven.com/a/${esp.id}`);
}
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), credits.join('\n') + '\n');
