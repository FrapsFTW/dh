// Tests de la simulation, sans navigateur : npm test.
// Ils vérifient que la piste est cohérente et que le vélo se comporte comme un vélo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { initPhysics, createSim, STEP } from '../src/sim/world.js';
import { createTrack } from '../src/sim/track.js';
import { autopilot } from '../src/sim/autopilot.js';
import { trickName } from '../src/sim/tricks.js';
import { MAP_IDS } from '../src/sim/maps.js';
import { readFileSync, existsSync } from 'node:fs';
import { ROSTER, decodePeloton, gridSlots, riderSlot, POSE, POSE_SIZE } from '../src/sim/peloton.js';

await initPhysics();

const idle = { steer: 0, brakeFront: 0, brakeRear: 0, pedal: 0, weight: 0, hop: false };
const run = (sim, seconds, input) => {
  for (let i = 0; i < seconds / STEP; i++) sim.step(typeof input === 'function' ? input(i * STEP) : input);
};
const heading = (st) => {
  const f = new Vector3(0, 0, -1).applyQuaternion(st.quaternion);
  return Math.atan2(f.x, -f.z); // > 0 quand on tourne vers la droite
};

const tracks = Object.fromEntries(MAP_IDS.map((m) => [m, createTrack(7, m)]));

test('chaque piste est toujours la même pour une même graine', () => {
  for (const m of MAP_IDS) {
    const a = tracks[m], b = createTrack(7, m);
    assert.equal(a.length, b.length);
    assert.equal(a.trees.length, b.trees.length);
    assert.equal(a.trailY(123.4, 1.2), b.trailY(123.4, 1.2));
  }
});

test('chaque piste est faisable : virages assez larges, portes dans l\'ordre, aucun arbre sur la piste', () => {
  for (const m of MAP_IDS) {
    const t = tracks[m];
    let kmax = 0;
    for (const k of t.K) kmax = Math.max(kmax, Math.abs(k));
    assert.ok(1 / kmax > 9, `${m} : virage le plus serré ${(1 / kmax).toFixed(1)} m`);
    for (let i = 1; i < t.gates.length; i++) assert.ok(t.gates[i].s > t.gates[i - 1].s);
    assert.equal(t.gates[0].kind, 'depart');
    assert.equal(t.gates.at(-1).kind, 'arrivee');
    // (à plus de 5 m de l'axe ; dans un passage étroit, les troncs qui le bordent restent derrière la rubalise)
    for (const tree of t.trees) {
      const p = t.nearest(tree.x, tree.z, null, 0, 2);
      assert.ok(p.dist > (t.narrowAt(p.s).k > 0 ? t.tapeAt(p.s) + tree.r : 5), `${m} : un arbre est sur la piste, à ${p.dist.toFixed(1)} m de l'axe`);
    }
  }
});

test('chaque piste suit la montagne : jamais de tranchée ni de remblai de plus de 3 m', () => {
  for (const m of MAP_IDS) for (const d of tracks[m].D) assert.ok(Math.abs(d) < 3, `${m} : écart ${d.toFixed(1)} m`);
});

test('les sauts ne creusent pas de fosse : la réception reste à moins de 4 m sous la pente', () => {
  for (const m of MAP_IDS) {
    for (const f of tracks[m].features.filter((f) => f.type === 'jump')) {
      assert.ok(Math.min(...f.prof) > -4, `${m}, ${f.name} : creux de ${Math.min(...f.prof).toFixed(1)} m`);
    }
  }
});

test('chaque saut se passe à sa vitesse prévue : on se pose sans choc', () => {
  for (const t of Object.values(tracks)) {
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
      assert.ok(impact !== null && impact < 5.5, `${t.map.id}, ${f.name} à ${v.toFixed(1)} m/s : choc ${impact?.toFixed(1)} m/s`);
    }
  }
  }
});

test('sur la piste on roule sur de la terre, à côté sur de l\'herbe', () => {
  const t = tracks.foret;
  const f = t.sample(120);
  assert.equal(t.surfaceAt(f.x, f.z).name, 'terre');
  assert.equal(t.surfaceAt(f.x + 7 * f.rx, f.z + 7 * f.rz).name, 'herbe');
});

test('La Grande Combe : graviers en altitude, granit sur la dalle, planches sur le pont, terre en forêt', () => {
  const t = tracks.alpes;
  const at = (s) => { const f = t.sample(s); return t.surfaceAt(f.x, f.z).name; };
  const mid = (type) => { const f = t.features.find((f) => f.type === type); return (f.a + f.b) / 2; };
  assert.equal(at(100), 'gravier');
  assert.equal(at(mid('slab')), 'roche');
  assert.equal(at(mid('bridge')), 'bois');
  assert.equal(at(1600), 'terre');
  // Sous le pont, le ravin reste ouvert : à 4 m du milieu, on est bien plus bas que le tablier.
  const s = mid('bridge');
  assert.ok(t.trailY(s, 4) < t.trailY(s, 0) - 1, `ravin ${(t.trailY(s, 0) - t.trailY(s, 4)).toFixed(2)} m sous le tablier`);
});

test('La Grande Combe : pas d\'arbres au-dessus de la limite de la forêt, la forêt en dessous', () => {
  const t = tracks.alpes, tl = t.map.env.treeline;
  assert.equal(t.trees.filter((tr) => tr.y > tl + 50).length, 0);
  const low = t.trees.filter((tr) => tr.y < tl - 40).length;
  assert.ok(low > 3000, `${low} arbres en forêt`);
});

test('après une chute, on repart du dernier point de reprise passé, jamais au-delà de la prochaine porte', () => {
  const sim = createSim({ map: 'alpes' });
  const { race, track } = sim;
  for (const p of track.respawns) assert.ok(!track.features.some((f) => f.type === 'jump' && p > f.a - 3 && p < f.b), `point de reprise sur un saut : ${p}`);
  race.state = 'course';
  race.next = 2; // porte 1 passée
  race.reached = 640;
  const s = race.respawnS();
  assert.ok(s > track.gates[1].s + 1 && s < 640, `repart à ${s.toFixed(0)} m`);
  race.reached = 5000;
  assert.ok(race.respawnS() < track.gates[2].s, 'jamais au-delà de la prochaine porte');
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
  sim.race.next = sim.track.gates.length - 1; sim.race.state = 'course';
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

/**
 * Le whip, sur le Big One du Bike Park : le pilote auto amène le vélo, puis en l'air le stick sur le côté couche le vélo ;
 * relâché à `release` s de vol (jamais si null), il se redresse.
 */
function whipOnBigOne(mode, release) {
  const sim = createSim({ map: 'bikepark', mode });
  const jump = sim.track.features.find((f) => f.name === 'le Big One');
  sim.race.next = sim.track.gates.length - 1; sim.race.state = 'course';
  sim.bike.placeOnTrack(jump.lipS - 60, 12);
  sim.race.s = jump.lipS - 60;
  let inAir = false, most = 0;
  for (let t = 0; t < 12 && sim.race.s < jump.b + 5; t += STEP) {
    let inp = autopilot(sim);
    const st = sim.bike.state();
    if (st.contacts === 0 && sim.race.s > jump.lipS - 1) inAir = true;
    if (inAir && st.contacts === 0) inp = { ...inp, steer: release === null || st.airTime < release ? 1 : 0, hop: false };
    sim.step(inp);
    most = Math.max(most, Math.abs(sim.bike.whip));
    if (sim.bike.crashed) break;
  }
  return { sim, most };
}

test("le whip : en l'air, le stick sur le côté couche le vélo ; redressé avant de se poser, c'est une figure", () => {
  for (const mode of ['normal', 'ultra']) {
    const { sim, most } = whipOnBigOne(mode, 0.55);
    assert.ok(most > 0.9, `${mode} : couché à ${(most * 100).toFixed(0)} % seulement`);
    assert.equal(sim.bike.crashed, null, `${mode} : ${sim.bike.crashed?.reason}`);
    assert.deepEqual(sim.tricks.landed, ['Whip'], mode);
  }
});

test('le whip : posé encore couché, on tombe en Ultra-réaliste ; en Normal, le pilote rattrape le vélo', () => {
  const ultra = whipOnBigOne('ultra', null).sim;
  assert.equal(ultra.bike.crashed?.reason, 'Whip pas rattrapé');
  const normal = whipOnBigOne('normal', null).sim;
  assert.equal(normal.bike.crashed, null, normal.bike.crashed?.reason);
  assert.deepEqual(normal.tricks.landed, [], 'pas de figure pour un whip posé couché');
});

// ---------- Les nouvelles pistes : Le Bike Park, Le Single ----------

for (const map of ['bikepark', 'single']) {
  for (const mode of ['ultra', 'normal']) {
    test(`${map === 'bikepark' ? 'Le Bike Park' : 'Le Single'}, mode ${mode === 'ultra' ? 'Ultra-réaliste' : 'Normal'} : le pilote automatique descend toute la piste sans tomber ni sortir`, { timeout: 600000 }, () => {
      const sim = createSim({ map, mode });
      let t = 0, outs = 0;
      while (sim.race.state !== 'arrivee' && t < 300) {
        sim.step(autopilot(sim));
        if (sim.bike.crashed && sim.bike.crashed.t > 1) sim.respawn();
        if (sim.race.out) { outs++; sim.respawn(); }
        t += STEP;
      }
      assert.equal(sim.race.state, 'arrivee', `arrêté à ${sim.race.s.toFixed(0)} m sur ${sim.track.length.toFixed(0)}`);
      assert.equal(sim.race.splits.length, sim.track.gates.length - 1);
      assert.equal(sim.race.crashes, 0, `${sim.race.crashes} chutes`);
      assert.equal(outs, 0, `${outs} sorties du balisage`);
      console.log(`  pilote auto, ${map}, ${mode} : ${sim.race.time.toFixed(1)} s`);
    });
  }
}

test("Le Bike Park : de gros sauts (plus d'une demi-seconde en l'air à leur vitesse), le Big One le plus long", () => {
  const t = tracks.bikepark, y = (s) => t.trailY(s, 0);
  const airtime = (f) => {
    const lip = f.lipS, sl = (y(lip) - y(lip - 0.25)) / 0.25, c = 1 / Math.sqrt(1 + sl * sl), vx = f.speed * c, vy = f.speed * sl * c;
    for (let x = 0.3; x < 60; x += 0.05) { const tt = x / vx; if (y(lip) + vy * tt - 4.905 * tt * tt <= y(lip + x)) return tt; }
    return Infinity;
  };
  const jumps = t.features.filter((f) => f.type === 'jump' && f.kind !== 'drop');
  assert.ok(jumps.length >= 8, `${jumps.length} sauts`);
  for (const f of jumps) assert.ok(airtime(f) > 0.6, `${f.name} : ${airtime(f).toFixed(2)} s`);
  const big = jumps.find((f) => f.name === 'le Big One');
  for (const f of jumps) if (f !== big) assert.ok(airtime(big) > airtime(f), `${f.name} vole plus longtemps que le Big One`);
});

test('Le Bike Park : des sauts de toutes les formes, comme dans un vrai bike park', () => {
  const t = tracks.bikepark, y = (s) => t.trailY(s, 0);
  const at = (s) => { const f = t.sample(s); return t.surfaceAt(f.x, f.z).name; };
  const jumps = t.features.filter((f) => f.type === 'jump');
  // Des tables, des gaps, des drops ; en terre, en bois, creusés.
  for (const kind of ['table', 'gap', 'drop']) assert.ok(jumps.some((f) => f.kind === kind), kind);
  const wood = jumps.filter((f) => f.look === 'bois');
  assert.ok(wood.length >= 3, `${wood.length} modules en bois`);
  for (const f of wood) assert.equal(at((f.a + f.lipS) / 2), 'bois', `${f.name} : la lèvre est en planches`);
  assert.ok(jumps.filter((f) => f.look === 'trou').length >= 3, 'des doubles creusés');
  // Le step-up : on se pose plus haut qu'on n'a décollé.
  const up = jumps.find((f) => f.name === 'step-up');
  assert.ok(y(up.lipS + up.knuckle + 1) > y(up.lipS) + 0.5, 'le step-up');
  // Le gap du ruisseau : le fond du trou est à plat (le lit de l'eau).
  const creek = jumps.find((f) => f.look === 'ruisseau');
  assert.ok(creek && Math.abs(y(creek.lipS + creek.knuckle / 2 - 0.5) - y(creek.lipS + creek.knuckle / 2 + 0.5)) < 0.02, 'le lit du ruisseau');
  // Le drop du rocher : une lèvre de granit.
  const rock = jumps.find((f) => f.kind === 'drop' && !f.look);
  assert.equal(at(rock.lipS - 1), 'roche', 'la lèvre du drop du rocher');
  // La dalle de granit, et la passerelle North Shore : en planches, perchée à plus d'un mètre au-dessus du sol voisin, étroite.
  const slab = t.features.find((f) => f.type === 'slab');
  assert.equal(at((slab.a + slab.b) / 2), 'roche', 'la dalle de granit');
  const shore = t.bridges.find((f) => f.style === 'shore'), sm = (shore.a + shore.b) / 2;
  assert.equal(at(sm), 'bois', 'la passerelle est en planches');
  assert.ok(t.trailY(sm, 0) - t.trailY(sm, shore.half + 1.2) > 1, 'la passerelle est perchée');
  assert.ok(shore.half * 2 < 2.5, 'la passerelle est étroite');
});

test('Le Single : une dalle calcaire et des marches de pierre', () => {
  const t = tracks.single, y = (s) => t.trailY(s, 0);
  const at = (s) => { const f = t.sample(s); return t.surfaceAt(f.x, f.z).name; };
  const slab = t.features.find((f) => f.type === 'slab'), stairs = t.features.find((f) => f.type === 'stairs');
  assert.equal(at((slab.a + slab.b) / 2), 'roche');
  // Chaque marche : un palier, puis un ressaut de plus de 15 cm.
  for (let s = stairs.a + stairs.step; s < stairs.b; s += stairs.step) assert.ok(y(s - 0.1) - y(s + 0.1) > 0.15, `marche à ${s.toFixed(0)} m`);
});

test('Le Single : balisé à moins de 2,5 m de large sur presque toute la descente, en épingles serrées', () => {
  const t = tracks.single;
  let narrow = 0, n = 0;
  for (let s = t.sStart; s < t.sFinish; s += 1) { n++; if (t.tapeAt(s) * 2 < 2.5) narrow++; }
  assert.ok(narrow / n > 0.85, `étroit sur ${((narrow / n) * 100).toFixed(0)} % seulement`);
  let hairpins = 0, inTurn = false;
  for (const k of t.K) { const tight = Math.abs(k) > 1 / 14; if (tight && !inTurn) hairpins++; inTurn = tight; }
  assert.ok(hairpins >= 7, `${hairpins} épingles`);
  assert.ok(t.sFinish - t.sStart < 700, 'une petite piste');
});

// ---------- La Grande Combe ----------

for (const mode of ['ultra', 'normal']) {
  test(`La Grande Combe, mode ${mode === 'ultra' ? 'Ultra-réaliste' : 'Normal'} : le pilote automatique descend toute la piste sans tomber`, { timeout: 600000 }, () => {
    const sim = createSim({ map: 'alpes', mode });
    let t = 0;
    while (sim.race.state !== 'arrivee' && t < 400) {
      sim.step(autopilot(sim));
      if (sim.bike.crashed && sim.bike.crashed.t > 1) sim.respawn();
      if (sim.race.out) sim.respawn();
      t += STEP;
    }
    assert.equal(sim.race.state, 'arrivee', `arrêté à ${sim.race.s.toFixed(0)} m sur ${sim.track.length.toFixed(0)}`);
    assert.equal(sim.race.splits.length, sim.track.gates.length - 1);
    assert.equal(sim.race.crashes, 0, `${sim.race.crashes} chutes`);
    console.log(`  pilote auto, La Grande Combe, ${mode} : ${sim.race.time.toFixed(1)} s`);
  });
}

// ---------- Le peloton ----------

test('le peloton enregistré correspond à chaque piste : vingt rivaux, partis de leur place, arrivés sans sortir du balisage', () => {
  for (const m of MAP_IDS) {
    const file = `public/peloton/${m}.bin`;
    if (!existsSync(file)) continue;
    const t = tracks[m], runs = decodePeloton(new Uint8Array(readFileSync(file)));
    const slots = gridSlots(t);
    assert.equal(runs.length, ROSTER.length, m);
    runs.forEach((r, i) => {
      // Parti de sa place sur la grille (sinon la piste a changé : node tools/peloton.mjs pour réenregistrer).
      const f = t.sample(slots[riderSlot(i)].s), u = slots[riderSlot(i)].u;
      assert.ok(Math.hypot(r.d[0] - (f.x + f.rx * u), r.d[2] - (f.z + f.rz * u)) < 0.5, `${m}, n° ${r.num} : pas parti de sa place (piste modifiée ?)`);
      assert.ok(r.finish > 0 && r.d[(r.count - 1) * POSE_SIZE + POSE.s] >= t.sFinish, `${m}, n° ${r.num} : pas arrivé`);
      // (le balisage : la rubalise, ou les piquets d'un tronçon large)
      let worst = -Infinity, at = 0;
      for (let j = 0; j < r.count; j++) {
        const q = t.nearest(r.d[j * POSE_SIZE], r.d[j * POSE_SIZE + 2], r.d[j * POSE_SIZE + 3], 25);
        const over = Math.abs(q.u) - t.tapeAt(q.s);
        if (over > worst) { worst = over; at = q.s; }
      }
      assert.ok(worst < 0, `${m}, n° ${r.num} : ${worst.toFixed(1)} m au-delà du balisage à ${at.toFixed(0)} m`);
    });
  }
});

// ---------- L'Avalanche ----------

test("L'Avalanche : neige damée et molle sur le glacier, gravier, eau au gué, gravier sur la piste forestière, pavés au village", () => {
  const t = tracks.avalanche;
  const at = (s, u = 0) => { const f = t.sample(s); return t.surfaceAt(f.x + u * f.rx, f.z + u * f.rz).name; };
  const mid = (type) => { const f = t.features.find((f) => f.type === type); return (f.a + f.b) / 2; };
  assert.equal(at(300), 'neige');
  assert.equal(at(300, 12), 'neige molle');
  assert.equal(at(1400 + 30), 'gravier');
  assert.equal(at(mid('ford')), 'eau');
  assert.equal(at(mid('road')), 'gravier');
  assert.equal(at(t.sFinish - 40), 'pavés');
});

test("L'Avalanche : 40 m de large sur le glacier, la remontée monte vraiment, des marches au village", () => {
  const t = tracks.avalanche;
  assert.equal(t.tapeAt(300), 20);
  assert.ok(t.tapeAt(1400) < 3.5);
  const climb = t.features.find((f) => f.type === 'climb');
  let lo = Infinity, hi = -Infinity;
  for (let s = climb.a; s < climb.b; s += 1) { lo = Math.min(lo, t.trailY(s, 0)); hi = Math.max(hi, t.trailY(s, 0)); }
  const rise = t.trailY(climb.b - 20, 0) - t.trailY(climb.a + 10, 0);
  assert.ok(rise > 15, `la remontée monte de ${rise.toFixed(1)} m`);
  const st = t.features.find((f) => f.type === 'stairs');
  let riser = 0;
  for (let s = st.a; s < st.b; s += 0.05) riser = Math.max(riser, t.trailY(s, 0) - t.trailY(s + 0.05, 0));
  assert.ok(riser > 0.1 && riser < 0.35, `contremarche de ${riser.toFixed(2)} m`);
});

test("L'Avalanche : quatre passages étroits, bordés de blocs ou de troncs, jamais sur la trace", () => {
  const t = tracks.avalanche;
  assert.equal(t.narrows.length, 4);
  for (const w of t.narrows) {
    const mid = (w.a + w.b) / 2;
    assert.ok(t.tapeAt(mid) < 1.5, `${w.name} : rubalise à ${t.tapeAt(mid).toFixed(2)} m`);
    assert.ok(t.trailHalfAt(mid) < 1, `${w.name} : trace de ${(2 * t.trailHalfAt(mid)).toFixed(2)} m`);
    // La haie : de chaque côté, derrière la rubalise, et rien sur la trace.
    const edge = w.edge === 'blocs'
      ? t.boulders.filter((b) => b.s > w.a && b.s < w.b)
      : t.trees.filter((tr) => { const p = t.nearest(tr.x, tr.z, null, 0, 3); return p.s > w.a && p.s < w.b && p.dist < 4; });
    assert.ok(edge.length > 20, `${w.name} : ${edge.length} obstacles`);
    for (const o of edge) {
      const p = t.nearest(o.x, o.z, null, 0, 3);
      assert.ok(p.dist - (o.r || 0) > t.tapeAt(p.s) - 0.05, `${w.name} : un obstacle à ${p.dist.toFixed(2)} m de l'axe`);
    }
  }
  // Ailleurs, la rubalise est à sa place habituelle.
  assert.ok(Math.abs(t.tapeAt(2600) - 3.4) < 1e-6);
});

test("L'Avalanche : les maisons du village sont hors du balisage", () => {
  const t = tracks.avalanche;
  assert.ok(t.buildings.length > 15, `${t.buildings.length} maisons`);
  for (const b of t.buildings) {
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    for (const [a, d] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // (le repère de la maison : x en travers de la ruelle, z le long)
      const lx = (a * b.d) / 2, lz = (d * b.w) / 2;
      const x = b.x + lx * c + lz * sn, z = b.z - lx * sn + lz * c;
      assert.ok(t.nearest(x, z, null, 0, 4).dist > 4, 'une maison touche la piste');
    }
  }
});

for (const mode of ['ultra', 'normal']) {
  test(`L'Avalanche, mode ${mode === 'ultra' ? 'Ultra-réaliste' : 'Normal'} : le pilote automatique descend toute la piste sans tomber`, { timeout: 900000 }, () => {
    const sim = createSim({ map: 'avalanche', mode });
    let t = 0;
    while (sim.race.state !== 'arrivee' && t < 700) {
      sim.step(autopilot(sim));
      if (sim.bike.crashed && sim.bike.crashed.t > 1) sim.respawn();
      if (sim.race.out) sim.respawn();
      t += STEP;
    }
    assert.equal(sim.race.state, 'arrivee', `arrêté à ${sim.race.s.toFixed(0)} m sur ${sim.track.length.toFixed(0)}`);
    assert.equal(sim.race.splits.length, sim.track.gates.length - 1);
    assert.equal(sim.race.crashes, 0, `${sim.race.crashes} chutes`);
    console.log(`  pilote auto, L'Avalanche, ${mode} : ${sim.race.time.toFixed(1)} s`);
  });
}
