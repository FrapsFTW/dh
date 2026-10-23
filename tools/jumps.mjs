// Vérifie chaque saut d'une carte : choc à la réception selon la vitesse au décollage (même calcul que les tests).
//   node tools/jumps.mjs alpes
import { createTrack } from '../src/sim/track.js';
const t = createTrack(7, process.argv[2]);
const y = (s) => t.trailY(s, 0);
for (const f of t.features.filter((f) => f.type === 'jump')) {
  const lip = f.lipS, sl = (y(lip) - y(lip - 0.25)) / 0.25;
  const out = [];
  for (const k of [0.7, 0.85, 1, 1.15, 1.25]) {
    const v = f.speed * k, c = 1 / Math.sqrt(1 + sl * sl), vx = v * c, vy = v * sl * c;
    let impact = null, at = 0, air = 0;
    for (let x = 0.3; x < 45 && impact === null; x += 0.05) {
      const tt = x / vx, yy = y(lip) + 0.02 + vy * tt - 4.905 * tt * tt;
      if (yy > y(lip + x)) continue;
      const gs = (y(lip + x + 0.3) - y(lip + x - 0.3)) / 0.6, ts = (vy - 9.81 * tt) / vx;
      impact = Math.abs(Math.sin(Math.atan(ts) - Math.atan(gs))) * Math.hypot(vx, vy - 9.81 * tt);
      at = x; air = tt;
    }
    out.push(`${v.toFixed(1)} m/s → ${impact?.toFixed(1)} (${at.toFixed(1)} m, ${air.toFixed(2)} s)`);
  }
  console.log(`${f.name.padEnd(18)} s=${f.lipS.toFixed(0)} pente lèvre ${(Math.atan(sl) * 57.3).toFixed(0)}° : ${out.join(' · ')}`);
}
