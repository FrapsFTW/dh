// Le monde physique : le sol (relief + piste), les arbres, le vélo, et la boucle à pas fixe.

import RAPIER from '@dimforge/rapier3d-compat';
import { createTrack } from './track.js';
import { Bike, GROUPS, DEFAULT_PARAMS } from './bike.js';
import { Race } from './race.js';
import { MODES, modeParams } from './modes.js';
import { Tricks } from './tricks.js';

export const STEP = 1 / 120;

let ready = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

/** mode : 'normal' ou 'ultra' (voir modes.js). Sans mode, les réglages de Terrain Rider (ceux de l'Ultra-réaliste). */
export function createSim({ seed = 7, mode = null, params = mode ? modeParams(mode) : { ...DEFAULT_PARAMS } } = {}) {
  const track = createTrack(seed);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  const terrain = track.buildTerrain();
  const ribbon = track.buildRibbon();
  const groundHandles = new Set();
  for (const m of [terrain, ribbon]) {
    const c = world.createCollider(
      RAPIER.ColliderDesc.trimesh(m.positions, m.indices).setFriction(0.8).setCollisionGroups(GROUPS.ground),
    );
    groundHandles.add(c.handle);
  }
  const treeHandles = new Set();
  for (const t of track.trees) {
    const c = world.createCollider(
      RAPIER.ColliderDesc.cylinder(t.h / 2, t.r).setTranslation(t.x, t.y + t.h / 2, t.z).setCollisionGroups(GROUPS.trees),
    );
    treeHandles.add(c.handle);
  }

  const bike = new Bike(world, track, params);
  const race = new Race(track);
  const tricks = new Tricks();
  if (mode) race.outTime = MODES[mode].outTime;
  const events = new RAPIER.EventQueue(true);

  // La pose du vélo, pour le fantôme : position, orientation, direction, suspensions.
  const pose = () => {
    const t = bike.body.translation(), r = bike.body.rotation();
    const [wf, wr] = bike.wheels;
    return [t.x, t.y, t.z, r.x, r.y, r.z, r.w, bike.steer, wf.x, wr.x, bike.lean || 0, bike.crouch, bike.hips.z];
  };

  const sim = {
    track, world, bike, race, tricks, params, terrain, ribbon, time: 0, mode: mode || 'ultra',
    /** Change de mode : les réglages et la tolérance hors balisage. */
    setMode(m) {
      sim.mode = m;
      Object.assign(params, modeParams(m));
      race.outTime = MODES[m].outTime;
      bike.setMass();
    },
    reset() {
      race.reset();
      tricks.reset();
      bike.placeOnTrack(track.spawnS);
    },
    respawn() {
      bike.placeOnTrack(race.respawnS());
      race.onRespawn();
      tricks.air = null;
      tricks.pending = null;
    },
    /** Un pas de physique de 1/120 s. */
    step(input) {
      bike.applyForces(input, STEP);
      world.step(events);
      let riderHit = null;
      const rider = bike.riderCollider.handle;
      events.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const other = h1 === rider ? h2 : h2 === rider ? h1 : null;
        if (other === null) return;
        if (treeHandles.has(other)) riderHit = 'arbre';
        else if (groundHandles.has(other)) riderHit = riderHit || 'sol';
      });
      bike.afterStep(STEP, riderHit);
      tricks.update(bike, STEP);
      const lv = bike.body.linvel();
      race.update(STEP, bike.body.translation(), Math.hypot(lv.x, lv.y, lv.z), !!bike.crashed, pose);
      sim.time += STEP;
    },
  };
  sim.reset();
  return sim;
}
