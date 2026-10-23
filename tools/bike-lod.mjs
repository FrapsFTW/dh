// Le vélo allégé des rivaux du peloton : le même modèle que celui du joueur (public/models/bike.glb), avec dix fois
// moins de triangles et des textures plus petites. Vu à quelques mètres, la différence ne se voit pas.
//   node tools/bike-lod.mjs   → public/models/bike-lod.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, textureCompress, meshopt, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const RATIO = { roueAvant: 0.06, roueArriere: 0.06, cadre: 0.1, bras: 0.1, direction: 0.1, fourreaux: 0.12 };
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('public/models/bike.glb');
let before = 0, after = 0;
const tris = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
await doc.transform(weld());
for (const node of doc.getRoot().listNodes()) {
  const m = node.getMesh();
  if (!m) continue;
  const ratio = RATIO[node.getName()] ?? 0.1;
  for (const p of m.listPrimitives()) {
    before += tris(p);
    simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.03, lockBorder: false });
    after += tris(p);
  }
}
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write('public/models/bike-lod.glb', doc);
console.log(`vélo allégé : ${before} → ${Math.round(after)} triangles`);
