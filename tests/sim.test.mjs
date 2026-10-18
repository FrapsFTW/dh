// Tests de la simulation, sans navigateur : npm test.
// Ils vérifient que la piste est cohérente et que le vélo se comporte comme un vélo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { initPhysics, createSim, STEP } from '../src/sim/world.js';
import { createTrack } from '../src/sim/track.js';
import { autopilot } from '../src/sim/autopilot.js';
import { trickName } from '../src/sim/tricks.js';

await initPhysics();

const idle = { steer: 0, brakeFront: 0, brakeRear: 0, pedal: 0, weight: 0, hop: false };
const run = (sim, seconds, input) => {
  for (let i = 0; i < seconds / STEP; i++) sim.step(typeof input === 'function' ? input(i * STEP) : input);
};
const heading = (st) => {
  const f = new Vector3(0, 0, -1).applyQuaternion(st.quaternion);
  return Math.atan2(f.x, -f.z); // > 0 quand on tourne vers la droite
};

test('la piste est toujours la même pour une même graine', () => {
  const a = createTrack(7), b = createTrack(7);
  assert.equal(a.length, b.length);
  assert.equal(a.trees.length, b.trees.length);
  assert.equal(a.trailY(123.4, 1.2), b.trailY(123.4, 1.2));
});

test('la piste est faisable : virages assez larges, portes dans l\'ordre, aucun arbre sur la piste', () => {
  const t = createTrack(7);
  let kmax = 0;
  for (const k of t.K) kmax = Math.max(kmax, Math.abs(k));
  assert.ok(1 / kmax > 9, `virage le plus serré : ${(1 / kmax).toFixed(1)} m`);
  for (let i = 1; i < t.gates.length; i++) assert.ok(t.gates[i].s > t.gates[i - 1].s);
  assert.equal(t.gates[0].kind, 'depart');
  assert.equal(t.gates.at(-1).kind, 'arrivee');
  for (const tree of t.trees) assert.ok(t.nearest(tree.x, tree.z, null, 0, 2).dist > 5, 'un arbre est sur la piste');
});

test('la piste suit la montagne : jamais de tranchée ni de remblai de plus de 3 m', () => {
  const t = createTrack(7);
  for (const d of t.D) assert.ok(Math.abs(d) < 3, `écart ${d.toFixed(1)} m`);
});

test('chaque saut se passe à sa vitesse prévue : on se pose sans choc', () => {
  const t = createTrack(7);
  const y = (s) => t.trailY(s, 0);
  for (const f of t.features.filter((f) => f.type === 'jump')) {
    const lip = f.lipS, sl = (y(lip) - y(lip - 0.25)) / 0.25;
    for (const k of [0.85, 1, 1.15]) {
      const v = f.speed * k, c = 1 / Math.sqrt(1 + sl * sl), vx = v * c, vy = v * sl * c;
      let impact = null;
      for (let x = 0.3; x < 45 && impact === null; x += 0.05) {
        const tt = x / vx, yy = y(lip) + 0.02 + vy * tt - 4.905 * tt * tt;
        if (yy > y(lip + x)) continue;
        const gs = (y(lip + x + 0.3) - y(lip + x - 0.3)) / 0.6, ts = (vy - 9.81 * tt) / vx;
        impact = Math.abs(Math.sin(Math.atan(ts) - Math.atan(gs))) * Math.hypot(vx, vy - 9.81 * tt);
      }
      assert.ok(impact !== null && impact < 5.5, `${f.name} à ${v.toFixed(1)} m/s : choc ${impact?.toFixed(1)} m/s`);
    }
  }
});

test('sur la piste on roule sur de la terre, à côté sur de l\'herbe', () => {
  const t = createTrack(7);
  const f = t.sample(120);
  assert.equal(t.surfaceAt(f.x, f.z).name, 'terre');
  assert.equal(t.surfaceAt(f.x + 7 * f.rx, f.z + 7 * f.rz).name, 'herbe');
});

test('on sort de la cabane en pédalant, puis en roue libre le vélo descend tout droit ; le chrono part à la ligne', () => {
  const sim = createSim();
  run(sim, 2, { ...idle, pedal: 1 });
  run(sim, 3, idle);
  const st = sim.bike.state();
  assert.equal(st.crashed, null);
  assert.ok(st.speed > 5, `vitesse ${st.speed.toFixed(1)} m/s`);
  assert.ok(Math.abs(st.lean) < 0.1, `inclinaison ${(st.lean * 57.3).toFixed(1)}°`);
  assert.equal(st.contacts, 2);
  assert.equal(sim.race.state, 'course');
});

test('au repos, la suspension s\'enfonce d\'environ un tiers de sa course (le sag)', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 15);
  run(sim, 0.8, { ...idle, brakeFront: 0.6, brakeRear: 0.6 });
  const [f, r] = sim.bike.state().wheels;
  const avg = (f.x + r.x) / 2 / 0.2;
  assert.ok(avg > 0.2 && avg < 0.45, `enfoncement moyen ${(avg * 100).toFixed(0)} %`);
});

test('les roues tournent : en roue libre, leur vitesse au sol est celle du vélo', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 15, 8);
  run(sim, 1, idle);
  const st = sim.bike.state();
  for (const w of st.wheels) assert.ok(Math.abs(w.omega * w.radius - st.forwardSpeed) < 0.4, `${w.name} : ${(w.omega * w.radius).toFixed(2)} contre ${st.forwardSpeed.toFixed(2)} m/s`);
});

test('frein avant à fond dans la pente : par-dessus le guidon', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 20, 8);
  run(sim, 2, { ...idle, brakeFront: 1 });
  assert.equal(sim.bike.crashed?.reason, 'Par-dessus le guidon');
});

test('frein arrière à fond : la roue bloque et dérape, mais on reste debout', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 20, 7);
  let locked = false;
  run(sim, 1.5, () => { locked ||= sim.bike.wheels[1].locked; return { ...idle, brakeRear: 1 }; });
  assert.ok(locked, 'la roue arrière a bloqué');
  assert.equal(sim.bike.crashed, null);
});

test('les deux freins dosés, poids en arrière : on s\'arrête dans la pente sans tomber', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 20, 8);
  run(sim, 3, { ...idle, brakeFront: 0.35, brakeRear: 0.5, weight: -0.8 });
  assert.equal(sim.bike.crashed, null);
  assert.ok(sim.bike.state().speed < 2.5, `vitesse ${sim.bike.state().speed.toFixed(1)} m/s`);
});

test('pencher à droite fait tourner à droite', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 20, 8);
  const h0 = heading(sim.bike.state());
  run(sim, 1.0, { ...idle, steer: 0.5 });
  const st = sim.bike.state();
  assert.equal(st.crashed, null);
  assert.ok(st.lean > 0.12, `inclinaison ${(st.lean * 57.3).toFixed(1)}°`);
  assert.ok(heading(st) - h0 > 0.15, `cap ${(((heading(st) - h0) * 180) / Math.PI).toFixed(1)}°`);
});

test('reculer son poids retarde le passage par-dessus le guidon', () => {
  const brakeUntilCrash = (weight) => {
    const sim = createSim();
    sim.bike.placeOnTrack(sim.track.sStart + 20, 8);
    let t = 0;
    while (!sim.bike.crashed && t < 4) { sim.step({ ...idle, brakeFront: 0.8, weight }); t += STEP; }
    return t;
  };
  assert.ok(brakeUntilCrash(-1) > brakeUntilCrash(0) + 0.2, 'le poids en arrière tient plus longtemps');
});

test('bunny-hop : maintenir puis relâcher fait décoller les deux roues', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 20, 6);
  run(sim, 0.5, idle);
  run(sim, 0.9, { ...idle, hop: true });
  let air = 0;
  run(sim, 1, () => { if (sim.bike.contacts === 0) air += STEP; return idle; });
  assert.ok(air > 0.3, `${air.toFixed(2)} s en l'air`);
  assert.equal(sim.bike.crashed, null);
});

test('le pilote automatique tient sur des descentes légèrement différentes', { timeout: 600000 }, () => {
  // La physique est chaotique : de toutes petites différences changent la suite. On vérifie que la piste
  // et le pilote automatique ne tiennent pas à un fil.
  for (let k = 0; k < 3; k++) {
    const sim = createSim();
    sim.params.gripScale = 1 + (k - 1) * 0.004;
    for (let i = 0; i < k * 11; i++) sim.step({ ...idle, brakeFront: 1, brakeRear: 1 });
    let t = 0;
    while (sim.race.state !== 'arrivee' && t < 200) {
      sim.step(autopilot(sim));
      if (sim.bike.crashed && sim.bike.crashed.t > 1) sim.respawn();
      if (sim.race.out) sim.respawn();
      t += STEP;
    }
    assert.equal(sim.race.state, 'arrivee', `run ${k} : arrêté à ${sim.race.s.toFixed(0)} m`);
    assert.ok(sim.race.crashes <= 1, `run ${k} : ${sim.race.crashes} chutes`);
  }
});

test('le pilote automatique descend toute la piste', { timeout: 300000 }, () => {
  const sim = createSim();
  let t = 0;
  while (sim.race.state !== 'arrivee' && t < 200) {
    sim.step(autopilot(sim));
    if (sim.bike.crashed && sim.bike.crashed.t > 1) sim.respawn();
    t += STEP;
  }
  assert.equal(sim.race.state, 'arrivee', `arrêté à ${sim.race.s.toFixed(0)} m sur ${sim.track.length.toFixed(0)}`);
  assert.equal(sim.race.splits.length, sim.track.gates.length - 1);
  assert.ok(sim.race.crashes <= 2, `${sim.race.crashes} chutes`);
  console.log(`  pilote auto : ${sim.race.time.toFixed(1)} s, ${sim.race.crashes} chute(s)`);
});

// ---------- Les modes et les figures ----------

test('les noms des figures', () => {
  assert.equal(trickName(Math.PI * 2 - 0.5, 0), 'Backflip');
  assert.equal(trickName(-Math.PI * 2, 0.2), 'Frontflip');
  assert.equal(trickName(0.3, Math.PI * 2), '360');
  assert.equal(trickName(Math.PI * 4, -Math.PI * 2), 'Double backflip 360');
  assert.equal(trickName(Math.PI, Math.PI), null);
});

test('mode Normal : frein avant à fond dans la pente, le pilote dose et reste sur le vélo', () => {
  const sim = createSim({ mode: 'normal' });
  sim.bike.placeOnTrack(sim.track.sStart + 20, 8);
  let lockedF = false;
  run(sim, 3, () => { lockedF ||= sim.bike.wheels[0].locked; return { ...idle, brakeFront: 1 }; });
  assert.equal(sim.bike.crashed, null);
  assert.ok(!lockedF, 'la roue avant n\'a pas bloqué');
  assert.ok(sim.bike.state().speed < 5, `vitesse ${sim.bike.state().speed.toFixed(1)} m/s`);
});

test('un appui commencé en l\'air ne déclenche pas de bunny-hop en retombant', () => {
  const sim = createSim();
  sim.bike.placeOnTrack(sim.track.sStart + 20, 6);
  run(sim, 0.5, idle);
  run(sim, 0.9, { ...idle, hop: true });
  run(sim, 0.02, idle); // le bunny-hop part
  run(sim, 1.2, { ...idle, hop: true }); // appuyé en l'air, maintenu après la réception
  run(sim, 0.3, idle); // relâché au sol : rien
  let air = 0;
  run(sim, 0.6, () => { if (sim.bike.contacts === 0) air += STEP; return idle; });
  assert.ok(air < 0.05, `${air.toFixed(2)} s en l'air`);
});

/**
 * Amène le vélo au saut d'arrivée avec le pilote auto, comprimé sur la lèvre (bouton de saut maintenu), puis fait une
 * figure : `hold(st, air)` dit quoi faire en l'air.
 */
function trickOnFinishJump(mode, hold) {
  const sim = createSim({ mode });
  const jump = sim.track.features.find((f) => f.name === 'saut d\'arrivée');
  sim.race.next = 4; sim.race.state = 'course';
  sim.bike.placeOnTrack(jump.lipS - 60, 11);
  sim.race.s = jump.lipS - 60;
  let inAir = false;
  for (let t = 0; t < 12 && sim.race.s < jump.b + 5; t += STEP) {
    let inp = autopilot(sim);
    const st = sim.bike.state();
    if (st.contacts === 0 && sim.race.s > jump.lipS - 1) inAir = true;
    if (inAir) inp = { ...inp, ...hold(st, sim.tricks.air) };
    else if (sim.race.s > jump.lipS - 1.5) inp = { ...inp, hop: true, weight: 0, steer: 0 }; // comprimé sur la lèvre
    sim.step(inp);
    if (sim.bike.crashed) break;
  }
  return sim;
}

test('mode Normal : backflip au saut d\'arrivée (groupé, stick en arrière, lâché après un demi-tour)', () => {
  for (const release of [3.5, 4.5, 5.5]) {
    let done = false;
    const sim = trickOnFinishJump('normal', (st, air) => {
      if (air && air.pitch > release) done = true;
      return done ? { hop: false, weight: 0 } : { hop: true, weight: -1, steer: 0 };
    });
    assert.equal(sim.bike.crashed, null, `lâché à ${release} rad : ${sim.bike.crashed?.reason}`);
    assert.deepEqual(sim.tricks.landed, ['Backflip'], `lâché à ${release} rad`);
  }
});

test('mode Normal : 360 au saut d\'arrivée', () => {
  let done = false;
  const sim = trickOnFinishJump('normal', (st, air) => {
    if (air && Math.abs(air.yaw) > 4) done = true;
    return done ? { hop: false, steer: 0 } : { hop: true, steer: 1, weight: 0 };
  });
  assert.equal(sim.bike.crashed, null, sim.bike.crashed?.reason);
  assert.deepEqual(sim.tricks.landed, ['360']);
});

test('mode Ultra-réaliste : un backflip qui tourne encore à la réception se termine par terre ; arrêté à temps, il passe', () => {
  let done = false;
  const sloppy = trickOnFinishJump('ultra', (st, air) => {
    if (air && air.pitch > 4.5) done = true;
    return done ? { hop: false, weight: 0 } : { hop: true, weight: -1, steer: 0 };
  });
  assert.ok(sloppy.bike.crashed, 'sans arrêter la rotation, on tombe');
  done = false;
  const clean = trickOnFinishJump('ultra', (st, air) => {
    if (air && air.pitch > 4.7) done = true;
    if (!done) return { hop: true, weight: -1, steer: 0 };
    // Toujours groupé, stick dans l'autre sens pour freiner la rotation, puis on s'ouvre.
    return st.contacts === 0 && st.angularVelocity.length() > 2.5 ? { hop: true, weight: 1, steer: 0 } : { hop: false };
  });
  assert.equal(clean.bike.crashed, null, clean.bike.crashed?.reason);
  assert.deepEqual(clean.tricks.landed, ['Backflip']);
});

test('mode Normal : le pilote automatique descend toute la piste', { timeout: 300000 }, () => {
  const sim = createSim({ mode: 'normal' });
  let t = 0;
  while (sim.race.state !== 'arrivee' && t < 200) {
    sim.step(autopilot(sim));
    if (sim.bike.crashed && sim.bike.crashed.t > 1) sim.respawn();
    t += STEP;
  }
  assert.equal(sim.race.state, 'arrivee', `arrêté à ${sim.race.s.toFixed(0)} m`);
  assert.equal(sim.race.crashes, 0, `${sim.race.crashes} chutes`);
  console.log(`  pilote auto, mode Normal : ${sim.race.time.toFixed(1)} s`);
});
