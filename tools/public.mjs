// Le public : les « Background Posed Humans » de Quaternius (quaternius.com, CC0), préparés pour le jeu :
//   node tools/public.mjs   → public/models/public.glb
//
// Des femmes et des hommes en pied, dans des poses de spectateurs (debout, mains sur les hanches, la main levée, les
// mains sur les yeux, le nez en l'air, assis dans l'herbe, assis à encourager), et leurs coiffures. Le pack est sur le
// Google Drive de Quaternius ; les fichiers sont téléchargés une fois pour toutes. Pour chaque pose :
// - le corps, mis à l'échelle (1,75 m environ), pied au sol, face vers +z ;
// - une coiffure posée sur la tête : la tête d'une pose est celle de la pose debout, déplacée et tournée (on retrouve
//   ce mouvement d'après ses sommets, qui sont les mêmes d'une pose à l'autre) ;
// - pour chaque sommet, la partie du corps (_PART : 0 peau, 1 haut, 2 pantalon, 3 chaussures, 4 cheveux) : le jeu
//   habille chacun à sa façon ; et combien il bouge quand le spectateur salue ou encourage (_WAVE, de 0 à 1).
// Les originaux (OBJ) restent dans tools/.cache/public.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools/.cache/public');
const OUT = path.join(ROOT, 'public/models/public.glb');
const DRIVE = 'https://drive.google.com/uc?export=download&id=';

// Les fichiers (sur le Google Drive de Quaternius, lien de quaternius.com/packs/backgroundposedhumans.html).
const FILES = {
  'Male_Standing.obj': '1sYxmvLuMH9CkwwLGyTAhZsN_-tFIhbHu',
  'Male_Standing_Hips.obj': '1QWmxUAwW2c0kBdvxxVkyYBn3gZOUY5_d',
  'Male_Standing_Waving.obj': '1hUF5EuBSqa5iVigsfhK3nkalybBuZsF7',
  'Male_Standing_CoveringEyes.obj': '1FF0qNA7cOEVWGM8XQzzKP7EC4nC1xH99',
  'Male_LookingUp.obj': '1V6pTUYjzt3cDD3XyexNvBRzW79HSkO8-',
  'Male_Sitting.obj': '183uU-nqxzQJP1N1ykKOXVbjdHwdEaBs_',
  'Male_Sitting_Cheering.obj': '1D_lhGqSOj9nxLJ4T3ksDvx20uBzXpoSl',
  'Female_Standing.obj': '13oLeT8urbcq_6W2C1cQq49tqTLKuG69b',
  'Female_Standing_Hips.obj': '1zWqorz5XIv6nEPY44dQuCSn62EhtKmg7',
  'Woman_Standing_Waving.obj': '1q3UmkWXYQTI33SybQvMfnNAyrp9rPRE3',
  'Female_Standing_CoveringEyes.obj': '1Ta4NtjZzYPmzC75DMUwbn-oWZdu0Eg3g',
  'Female_Sitting.obj': '1tsH40mlqGXeI7igey4i_gMDKx2wvTGRn',
  'Female_Sitting_Cheering.obj': '1QV2hODdvt1Ta0kCwfd0Vw7Z6vt6Myhuk',
  'Male_Hairstyle_1.obj': '1ITsZj3OhCHyIx9va025Drd6USpYn7ZUp',
  'Male_Hairstyle_2.obj': '14IMfxxeZ3ZeACgnFKwCDFzDxh0r6I1Hr',
  'Male_Hairstyle_3.obj': '1-kf_HYqtQooOZ3p7Sj1p9TNPOqbI3tXH',
  'Male_Hairstyle_4.obj': '13vGhD_V_-YBkOXtepJIE2c9yHZBwiLcw',
  'Female_Hairstyle_1.obj': '1lLF_OUcoF3aBsEIXo9UYK8NMFANB5JXh',
  'Female_Hairstyle_2.obj': '1DTsBUtMrOccNjRwvKrRduip3RlQgGPyC',
  'Female_Hairstyle_3.obj': '1PHH3gNXkP_OhmwULVrJfLueR-MDveBf9',
  'Female_Hairstyle_4.obj': '1oz8XIhZF5bVqxr7xkjyr8Ec41tjGnPmP',
};
// Les poses gardées, et deux coiffures pour chacune (le public en a ainsi quatre par sexe).
const POSES = [
  ['Male_Standing', [1, 3]], ['Male_Standing_Hips', [2, 4]], ['Male_Standing_Waving', [3, 1]],
  ['Male_Standing_CoveringEyes', [4, 2]], ['Male_LookingUp', [1, 2]], ['Male_Sitting', [3, 4]], ['Male_Sitting_Cheering', [2, 1]],
  ['Female_Standing', [1, 4]], ['Female_Standing_Hips', [2, 3]], ['Woman_Standing_Waving', [3, 1]],
  ['Female_Standing_CoveringEyes', [4, 2]], ['Female_Sitting', [2, 4]], ['Female_Sitting_Cheering', [3, 2]],
];
const PART = { Skin: 0, Shirt: 1, Pants: 2, Shoes: 3, Hair: 4, 'Hair.001': 4, HairTie: 4 };
const SCALE = 1.75 / 3.78; // la pose debout des hommes : 3,78 unités sans les cheveux

async function get(name) {
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const res = await fetch(DRIVE + FILES[name]);
    if (!res.ok) throw new Error(`${name} : ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file, 'utf8');
}

/** Un OBJ : les sommets d'origine (v, pour retrouver la tête d'une pose à l'autre) et les triangles, par matériau. */
function parseObj(text) {
  const v = [], vn = [], verts = [], idx = [], key = new Map();
  let part = 0;
  for (const line of text.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push(t.slice(1, 4).map(Number));
    else if (t[0] === 'vn') vn.push(t.slice(1, 4).map(Number));
    else if (t[0] === 'usemtl') part = PART[t[1]] ?? 1;
    else if (t[0] === 'f') {
      const ids = t.slice(1).map((c) => {
        const [a, , n] = c.split('/').map((x) => (x ? Number(x) - 1 : -1));
        const k = `${a}/${n}/${part}`;
        if (!key.has(k)) { key.set(k, verts.length); verts.push({ v: a, n, part }); }
        return key.get(k);
      });
      for (let i = 1; i + 1 < ids.length; i++) idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return { v, vn, verts, idx };
}

// ---------- Un peu d'algèbre : le mouvement rigide qui amène un nuage de points sur un autre (Kabsch) ----------
const centroid = (P) => P.reduce((c, p) => [c[0] + p[0] / P.length, c[1] + p[1] / P.length, c[2] + p[2] / P.length], [0, 0, 0]);
/** La rotation (matrice 3×3, lignes) qui amène au mieux A sur B (centrés), par itérations de Horn sur le quaternion. */
function bestRotation(A, B) {
  const ca = centroid(A), cb = centroid(B);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < A.length; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += (A[i][r] - ca[r]) * (B[i][c] - cb[c]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  // Le plus grand vecteur propre de N (puissances itérées, décalées pour qu'il domine).
  let q = [1, 0, 0, 0];
  const shift = 4 * Math.max(...N.flat().map(Math.abs));
  for (let it = 0; it < 200; it++) {
    const r = N.map((row, i) => row.reduce((s, x, j) => s + x * q[j], 0) + shift * q[i]);
    const l = Math.hypot(...r);
    q = r.map((x) => x / l);
  }
  const [w, x, y, z] = q;
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  return { R, ca, cb };
}
const apply = ({ R, ca, cb }, p) => {
  const d = [p[0] - ca[0], p[1] - ca[1], p[2] - ca[2]];
  return [0, 1, 2].map((r) => R[r][0] * d[0] + R[r][1] * d[1] + R[r][2] * d[2] + cb[r]);
};
const rotate = ({ R }, n) => [0, 1, 2].map((r) => R[r][0] * n[0] + R[r][1] * n[1] + R[r][2] * n[2]);

/** La tête d'une pose debout : les sommets de peau au-dessus du cou. */
function headOf(obj) {
  const skin = new Set(obj.verts.filter((x) => x.part === 0).map((x) => x.v));
  const top = Math.max(...[...skin].map((i) => obj.v[i][1]));
  return [...skin].filter((i) => obj.v[i][1] > top - 0.55);
}

await MeshoptEncoder.ready;
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('public');
const mat = doc.createMaterial('public').setRoughnessFactor(0.85).setMetallicFactor(0);
const ref = {}; // la pose debout de chaque sexe : sa tête
for (const sex of ['Male', 'Female']) {
  const o = parseObj(await get(`${sex}_Standing.obj`));
  const head = headOf(o);
  ref[sex] = { o, head, center: centroid(head.map((i) => o.v[i])), top: Math.max(...head.map((i) => o.v[i][1])) };
}
let total = 0;
for (const [pose, hairs] of POSES) {
  const sex = pose.startsWith('Male') ? 'Male' : 'Female';
  const body = parseObj(await get(`${pose}.obj`));
  const R0 = ref[sex];
  // Le bras qui salue (ou le poing qui encourage) : chaque sommet bouge d'autant qu'il s'écarte de la pose de repos (la
  // main, tout ; l'épaule, presque rien). Sans le même maillage, ce qui dépasse sur le côté au-dessus des épaules.
  const wave = new Float32Array(body.v.length);
  const rest = /Waving/.test(pose) ? `${sex}_Standing` : /Cheering/.test(pose) ? pose.replace('_Cheering', '') : null;
  if (rest) {
    const r = parseObj(await get(`${rest}.obj`));
    if (r.v.length === body.v.length) {
      const d = body.v.map((p, i) => Math.hypot(p[0] - r.v[i][0], p[1] - r.v[i][1], p[2] - r.v[i][2]));
      const max = Math.max(...d);
      d.forEach((x, i) => { wave[i] = Math.max(0, x / max - 0.15) / 0.85; });
    } else {
      const top = Math.max(...body.v.map((p) => p[1]));
      body.v.forEach((p, i) => { if (Math.abs(p[0] - R0.center[0]) > 0.3 && p[1] > R0.center[1] - 0.6) wave[i] = Math.min(1, (p[1] - (R0.center[1] - 0.6)) / (top - R0.center[1] + 0.6)); });
    }
  }
  // Le mouvement de la tête depuis la pose debout : d'après ses sommets si le maillage est le même, sinon (quelques
  // poses des femmes) une simple translation : la tête est la peau à la hauteur de celle de la pose debout, dans l'axe
  // du corps (pas la main levée au-dessus).
  let move;
  if (body.v.length === R0.o.v.length) move = bestRotation(R0.head.map((i) => R0.o.v[i]), R0.head.map((i) => body.v[i]));
  else {
    const hips = centroid(body.verts.filter((x) => x.part === 2).map((x) => body.v[x.v]));
    const axis = body.verts.filter((x) => x.part === 0 && Math.hypot(body.v[x.v][0] - hips[0], body.v[x.v][2] - hips[2]) < 0.3).map((x) => body.v[x.v]);
    const head = axis.filter((p) => p[1] > R0.top - 0.55 && p[1] < R0.top + 0.05);
    const c = centroid(head), top = Math.max(...head.map((p) => p[1]));
    move = { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ca: R0.center, cb: [c[0], R0.center[1] + top - R0.top, c[2]] };
  }
  for (const h of hairs) {
    const hair = parseObj(await get(`${sex}_Hairstyle_${h}.obj`));
    // La coiffure, centrée sur la tête de la pose debout (son sommet un peu au-dessus du crâne), puis suivant la tête.
    const hb = hair.v.reduce((b, p) => ({ min: b.min.map((m, k) => Math.min(m, p[k])), max: b.max.map((m, k) => Math.max(m, p[k])) }), { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
    const off = [R0.center[0] - (hb.min[0] + hb.max[0]) / 2, R0.top + 0.06 - hb.max[1], R0.center[2] - (hb.min[2] + hb.max[2]) / 2];
    const pos = [], nrm = [], part = [], idx = [], waves = [];
    for (const x of body.verts) { pos.push(...body.v[x.v]); nrm.push(...(body.vn[x.n] || [0, 1, 0])); part.push(x.part); waves.push(wave[x.v]); }
    for (const i of body.idx) idx.push(i);
    const base = body.verts.length;
    for (const x of hair.verts) {
      const p = hair.v[x.v];
      pos.push(...apply(move, [p[0] + off[0], p[1] + off[1], p[2] + off[2]]));
      nrm.push(...rotate(move, hair.vn[x.n] || [0, 1, 0]));
      part.push(4);
      waves.push(0);
    }
    for (const i of hair.idx) idx.push(base + i);
    // Pied au sol, à l'échelle.
    let minY = Infinity;
    for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
    for (let i = 0; i < pos.length; i += 3) { pos[i] *= SCALE; pos[i + 1] = (pos[i + 1] - minY) * SCALE; pos[i + 2] *= SCALE; }
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = doc.createPrimitive().setMaterial(mat).setIndices(acc('SCALAR', new Uint16Array(idx)))
      .setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
      .setAttribute('_PART', acc('SCALAR', new Float32Array(part))).setAttribute('_WAVE', acc('SCALAR', new Float32Array(waves)));
    const name = `${pose}_${h}`;
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
    total += idx.length / 3;
    console.log(`${name.padEnd(32)} ${idx.length / 3} triangles${body.v.length === R0.o.v.length ? '' : ' (tête : translation)'}`);
  }
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT, doc);
console.log(`→ ${path.relative(ROOT, OUT)} : ${POSES.length * 2} spectateurs, ${Math.round(total / POSES.length / 2)} triangles en moyenne, ${(fs.statSync(OUT).size / 1024).toFixed(0)} Ko`);
