// Prépare le vélo fourni (un GLB brut de 80 Mo, d'un seul tenant) pour le jeu :
//   node tools/prepare-bike.mjs [source.glb]   → public/models/bike.glb
//
// - remet le modèle dans le repère du jeu : mètres (×1,72), -z vers l'avant, +y vers le haut, sol à y = 0,
//   origine à mi-chemin entre les axes de roues (voir src/sim/geometry.js) ;
// - le découpe en pièces mobiles : roue avant, roue arrière, bras oscillant (il pivote avec la suspension arrière),
//   direction (fourche + cintre), fourreaux de fourche (ils coulissent avec la roue avant), cadre ;
// - ramène le cintre à 80 cm (le modèle a un cintre de 93 cm) ;
// - allège le maillage (pièce par pièce, puis compression meshopt) et les textures (WebP), pour que le jeu se charge vite.
//
// Les cotes de découpe ont été relevées sur des vues orthographiques du modèle (tools/ortho-shot.mjs).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { weld, prune, dedup, textureCompress, compactPrimitive, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, readdirSync, statSync } from 'node:fs';

const SRC = process.argv[2] || readdirSync('.').find((f) => f.endsWith('.glb'));
const OUT = 'public/models/bike.glb';
const S = 1.72; // échelle
// Repère du modèle (après sa rotation de 90° autour de x) : +x vers l'avant, +y vers le haut, sol à y = 0.
const FRONT_AXLE = [0.369, 0.212], REAR_AXLE = [-0.378, 0.211];
const X_MID = (FRONT_AXLE[0] + REAR_AXLE[0]) / 2;
const STEER_PIVOT = [0.15, 0.59]; // haut de la douille
const SWING_PIVOT = [-0.12, 0.235]; // pivot principal du bras oscillant, près du pédalier
const BAR_HALF = 0.4, BAR_KEEP = 0.06; // cintre ramené à 80 cm, sans toucher à la potence

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();
const srcNode = root.listNodes().find((n) => n.getMesh());
const srcMesh = srcNode.getMesh();
const srcPrim = srcMesh.listPrimitives()[0];
const nRaw = srcPrim.getAttribute('POSITION').getCount();
console.log(`source : ${SRC} (${(statSync(SRC).size / 1e6).toFixed(0)} Mo), ${nRaw} sommets`);

// ---------- 1. Repère du modèle, puis repère du jeu ----------
const qn = srcNode.getRotation();
if (Math.abs(qn[0] - Math.SQRT1_2) > 1e-3 || Math.abs(qn[3] - Math.SQRT1_2) > 1e-3) throw new Error('rotation du nœud inattendue : ' + qn);
srcNode.setRotation([0, 0, 0, 1]);
const toModel = (x, y, z) => [x, -z, y]; // la rotation de 90° autour de x du nœud d'origine
const toGame = (m) => [m[2] * S, m[1] * S, -(m[0] - X_MID) * S];
const posA = srcPrim.getAttribute('POSITION'), nrmA = srcPrim.getAttribute('NORMAL'), tanA = srcPrim.getAttribute('TANGENT');
const model = new Float32Array(nRaw * 3); // positions dans le repère du modèle, pour le découpage
{
  const p = posA.getArray(), nr = nrmA ? nrmA.getArray() : null, tg = tanA ? tanA.getArray() : null;
  for (let i = 0; i < nRaw; i++) {
    const m = toModel(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    model.set(m, i * 3);
    p.set(toGame(m), i * 3);
    if (nr) { const v = toModel(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]); nr.set([v[2], v[1], -v[0]], i * 3); }
    if (tg) { const v = toModel(tg[i * 4], tg[i * 4 + 1], tg[i * 4 + 2]); tg.set([v[2], v[1], -v[0]], i * 4); }
  }
  posA.setArray(p);
}

// ---------- 2. Découpage, triangle par triangle (d'après son centre) ----------
const axisX = (y) => 0.145 + ((0.585 - y) * (0.17 - 0.145)) / (0.585 - 0.49); // l'axe de direction, vu de côté
const wheelAt = (axle, x, y, z, front) => {
  const d = Math.hypot(x - axle[0], y - axle[1]);
  // Côté fourreau (vers le haut et l'arrière), le pont de fourche et le garde-boue frôlent le pneu : on serre les cotes.
  const ang = (Math.atan2(y - axle[1], x - axle[0]) * 180) / Math.PI;
  const tight = front && ang > 95 && ang < 140;
  return d > 0.032 && d < (tight ? 0.2145 : 0.218) && Math.abs(z) < (tight ? 0.0205 : 0.024);
};
function classify(x, y, z) {
  if (wheelAt(FRONT_AXLE, x, y, z, true)) return 'roueAvant';
  if (wheelAt(REAR_AXLE, x, y, z, false)) return 'roueArriere';
  const ax = axisX(y);
  const steer = (y > 0.585 && x > 0.09)
    || (y >= 0.49 && y <= 0.585 && x > ax && (Math.abs(z) > 0.017 || x > ax + 0.012))
    || (y < 0.49 && x > 0.172);
  if (steer) return y < 0.39 && x > 0.2 ? 'fourreaux' : 'direction';
  // Le bras oscillant : bases, haubans, moyeu, cassette, dérailleur, étrier arrière.
  if (x < -0.16 && y < 0.335) return 'bras';
  return 'cadre';
}
const idx = srcPrim.getIndices().getArray();
const parts = { cadre: [], bras: [], direction: [], fourreaux: [], roueAvant: [], roueArriere: [] };
for (let t = 0; t < idx.length; t += 3) {
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < 3; k++) { const v = idx[t + k] * 3; cx += model[v]; cy += model[v + 1]; cz += model[v + 2]; }
  parts[classify(cx / 3, cy / 3, cz / 3)].push(idx[t], idx[t + 1], idx[t + 2]);
}
for (const [k, v] of Object.entries(parts)) console.log(`  ${k.padEnd(12)} ${v.length / 3} triangles`);

// ---------- 3. Une primitive par pièce, chacune autour de son pivot ----------
const g = (m) => toGame(m); // pivots, repère du jeu
const PIVOTS = {
  cadre: [0, 0, 0],
  bras: g([SWING_PIVOT[0], SWING_PIVOT[1], 0]),
  roueArriere: g([REAR_AXLE[0], REAR_AXLE[1], 0]),
  direction: g([STEER_PIVOT[0], STEER_PIVOT[1], 0]),
  fourreaux: g([FRONT_AXLE[0], FRONT_AXLE[1], 0]),
  roueAvant: g([FRONT_AXLE[0], FRONT_AXLE[1], 0]),
};
const scene = root.listScenes()[0];
for (const n of scene.listChildren()) scene.removeChild(n);
const bike = doc.createNode('velo');
scene.addChild(bike);
const buffer = root.listBuffers()[0];
const nodes = {};
for (const [name, list] of Object.entries(parts)) {
  const prim = srcPrim.clone();
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buffer));
  compactPrimitive(prim);
  const pa = prim.getAttribute('POSITION'), arr = pa.getArray().slice();
  const pv = PIVOTS[name];
  for (let i = 0; i < arr.length; i += 3) {
    // Le cintre : on rapproche les poignées de l'axe (pas la potence ni la fourche).
    if (name === 'direction' && arr[i + 1] > 0.99 && Math.abs(arr[i]) > BAR_KEEP) {
      const s = Math.sign(arr[i]);
      arr[i] = s * (BAR_KEEP + (Math.abs(arr[i]) - BAR_KEEP) * ((BAR_HALF - BAR_KEEP) / (0.27 * S - BAR_KEEP)));
    }
    arr[i] -= pv[0]; arr[i + 1] -= pv[1]; arr[i + 2] -= pv[2];
  }
  pa.setArray(arr);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  nodes[name] = doc.createNode(name).setMesh(mesh);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
nodes.cadre.setTranslation([0, 0, 0]);
nodes.bras.setTranslation(PIVOTS.bras);
nodes.roueArriere.setTranslation(sub(PIVOTS.roueArriere, PIVOTS.bras));
nodes.direction.setTranslation(PIVOTS.direction);
nodes.fourreaux.setTranslation(sub(PIVOTS.fourreaux, PIVOTS.direction));
nodes.roueAvant.setTranslation([0, 0, 0]);
bike.addChild(nodes.cadre).addChild(nodes.bras).addChild(nodes.direction);
nodes.bras.addChild(nodes.roueArriere);
nodes.direction.addChild(nodes.fourreaux);
nodes.fourreaux.addChild(nodes.roueAvant);
srcMesh.dispose();
srcNode.dispose();

// Le matériau : on retire le réglage « speculaire ×2 » du modèle brut, qui le rend trop brillant.
for (const mat of root.listMaterials()) mat.setExtension('KHR_materials_specular', null);
for (const ext of root.listExtensionsUsed()) if (ext instanceof KHRMaterialsSpecular) ext.dispose();

// ---------- 4. Allègement ----------
await MeshoptSimplifier.ready;
await doc.transform(weld(), prune(), dedup());
const RATIOS = { cadre: 0.055, bras: 0.08, direction: 0.12, fourreaux: 0.1, roueAvant: 0.06, roueArriere: 0.06 };
await doc.transform((d) => Promise.all(d.getRoot().listMeshes().map(async (m) => {
  const ratio = RATIOS[m.getName()] || 0.15;
  const { simplifyPrimitive } = await import('@gltf-transform/functions');
  for (const p of m.listPrimitives()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.001, lockBorder: true });
})));
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /baseColor/, resize: [2048, 2048], quality: 86 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!baseColor)/, resize: [1024, 1024], quality: 90 }),
);
let tris = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
// Compression du maillage (EXT_meshopt_compression) : le jeu le décode avec MeshoptDecoder.
await MeshoptEncoder.ready;
io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
mkdirSync('public/models', { recursive: true });
await io.write(OUT, doc);
console.log(`→ ${OUT} : ${tris} triangles, ${(statSync(OUT).size / 1e6).toFixed(1)} Mo`);
