// Empreinte d'une piste (pour vérifier qu'un remaniement du générateur ne la change pas) :
//   node tools/fingerprint.mjs [carte]
import { createTrack } from '../src/sim/track.js';
const t = createTrack(7, process.argv[2]);
let h = 0;
const add = (v) => { h = (Math.imul(h ^ Math.round(v * 1000), 2654435761) >>> 0); };
for (let s = 0; s < t.length; s += 0.37) for (const u of [-5, -2, 0, 1.3, 4]) add(t.trailY(s, u));
for (const tr of t.trees) { add(tr.x); add(tr.z); add(tr.y); add(tr.h); }
for (const g of t.gates) add(g.s);
const ter = t.buildTerrain();
for (let i = 0; i < ter.positions.length; i += 97) add(ter.positions[i]);
for (let s = 0; s < t.length; s += 3.1) { const f = t.sample(s); add(t.surfaceAt(f.x + 0.5 * f.rx, f.z + 0.5 * f.rz).grip); }
console.log(JSON.stringify({ length: +t.length.toFixed(2), trees: t.trees.length, gates: t.gates.map((g) => +g.s.toFixed(2)), hash: h }));
