// Enregistre le peloton d'une piste : la descente de chacun des vingt rivaux, par le pilote automatique.
//   node tools/peloton.mjs [piste…]      (toutes les pistes sans argument)  → public/peloton/<piste>.bin
// Un rival qui tombe ou sort du balisage recommence avec un peu moins d'attaque et une autre trajectoire.
// Les descentes tournent en parallèle (une par cœur, à peu près).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

if (isMainThread) {
  const { MAP_IDS } = await import('../src/sim/maps.js');
  const { ROSTER, encodePeloton } = await import('../src/sim/peloton.js');
  const maps = process.argv.slice(2).length ? process.argv.slice(2) : MAP_IDS;
  mkdirSync('public/peloton', { recursive: true });
  for (const map of maps) {
    const t0 = Date.now();
    const queue = ROSTER.map((_, i) => i), runs = [];
    const n = Math.max(1, Math.min(queue.length, cpus().length - 2));
    await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { map } });
      const feed = () => (queue.length ? w.postMessage(queue.shift()) : w.terminate().then(resolve));
      w.on('message', (r) => {
        runs.push(r);
        const rider = ROSTER.find((x) => x.num === r.num);
        console.log(`  ${map} · ${String(r.num).padStart(2)} ${rider.name.padEnd(16)} ${r.finish.toFixed(2)} s${r.tries > 1 ? ` (${r.tries} essais, attaque ${r.pace.toFixed(3)})` : ''}`);
        feed();
      });
      w.on('error', reject);
      w.on('online', feed);
    })));
    runs.sort((a, b) => a.num - b.num);
    const bytes = encodePeloton(runs);
    writeFileSync(`public/peloton/${map}.bin`, bytes);
    const times = runs.map((r) => r.finish).sort((a, b) => a - b);
    console.log(`${map} : ${runs.length} rivaux, de ${times[0].toFixed(1)} à ${times.at(-1).toFixed(1)} s, ${(bytes.length / 1024).toFixed(0)} Ko, en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} else {
  const { initPhysics, createSim } = await import('../src/sim/world.js');
  const { ROSTER, recordRider, gridSlots, riderSlot } = await import('../src/sim/peloton.js');
  await initPhysics();
  const sim = createSim({ map: workerData.map, mode: 'normal' });
  const slots = gridSlots(sim.track);
  parentPort.on('message', (i) => {
    const rider = ROSTER[i];
    let pace = rider.pace, r = null, tries = 0;
    while (!r && tries < 8) {
      tries++;
      r = recordRider(sim, rider, slots[riderSlot(i)], { pace, seed: rider.num * 31 + 7 + tries * 1000 });
      if (!r) pace *= 0.97;
    }
    if (!r) throw new Error(`${rider.name} n'arrive pas en bas sans tomber`);
    parentPort.postMessage({ ...r, tries });
  });
}
