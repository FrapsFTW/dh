// Trace : fait rouler le vélo sans affichage et imprime son état à intervalles réguliers.
//   node tools/trace.mjs auto 200          (pilote automatique, 200 s)
//   node tools/trace.mjs coast 6 [pas]     (roue libre) · otb · back · rear · turn · hop · pedal
// Variables d'environnement : CARTE=alpes, MODE=normal.
import { initPhysics, createSim, STEP } from '../src/sim/world.js';
import { autopilot } from '../src/sim/autopilot.js';

await initPhysics();
const mode = process.argv[2] || 'coast';
const T = +(process.argv[3] || 8);
const every = +(process.argv[4] || 0.5);
const sim = createSim({ map: process.env.CARTE || 'foret', mode: process.env.MODE || null });
let last = -1;
const deg = (r) => (r * 57.3).toFixed(1);
for (let i = 0; i < T / STEP; i++) {
  const t = i * STEP;
  let inp = { steer: 0, brakeFront: 0, brakeRear: 0, pedal: 0, weight: 0, hop: false };
  if (mode === 'auto') inp = autopilot(sim);
  if (mode === 'otb' && t > 3) inp.brakeFront = 1;
  if (mode === 'back' && t > 3) { inp.brakeFront = 1; inp.weight = -1; }
  if (mode === 'rear' && t > 3) inp.brakeRear = 1;
  if (mode === 'turn' && t > 2) inp.steer = 0.6;
  if (mode === 'hop') inp.hop = t > 2 && t < 2.9;
  if (mode === 'pedal') inp.pedal = 1;
  sim.step(inp);
  const st = sim.bike.state();
  if (Math.floor(t / every) !== last) {
    last = Math.floor(t / every);
    const [f, r] = st.wheels;
    console.log(`t=${t.toFixed(2)} s=${sim.race.s.toFixed(1)} u=${sim.race.u.toFixed(2)} v=${st.speed.toFixed(2)} lean=${deg(st.lean)}/${deg(st.leanTarget)} steer=${deg(st.steer)} bank=${deg(st.bank)} c=${st.contacts} sus=${f.x.toFixed(3)}/${r.x.toFixed(3)} N=${f.load.toFixed(0)}/${r.load.toFixed(0)} roue=${(f.omega * f.radius).toFixed(1)}/${(r.omega * r.radius).toFixed(1)} slip=${f.slip.toFixed(2)}/${r.slip.toFixed(2)} crouch=${st.crouch.toFixed(2)} y=${st.position.y.toFixed(2)} ${f.locked ? 'LOCKF ' : ''}${r.locked ? 'LOCKR ' : ''}${st.crashed ? 'CHUTE:' + st.crashed.reason : ''} ${sim.race.state} ${sim.race.time.toFixed(1)}`);
  }
  if (st.crashed && st.crashed.t > 1) { if (mode === 'auto') sim.respawn(); else break; }
  if (sim.race.state === 'arrivee') { console.log('ARRIVEE', sim.race.time.toFixed(2), 'chutes', sim.race.crashes); break; }
}
