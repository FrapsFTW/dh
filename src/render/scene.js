// La scène affichée : ciel, montagnes, sol, forêt, habillage de course, lumière.
// Elle se construit à partir des mêmes maillages que la physique : ce qu'on voit est ce sur quoi on roule.

import * as THREE from 'three';
import { createSky, createMountains, SKY } from './sky.js';
import { createGround } from './ground.js';
import { createVegetation } from './vegetation.js';
import { createForest } from './trees.js';
import { createCourse } from './course.js';

// Un soleil de fin d'après-midi, assez bas pour des ombres longues sous les sapins.
const SUN_DIR = new THREE.Vector3(-0.55, 0.52, 0.4).normalize();

export function createScene(sim, { low = false, renderer } = {}) {
  const { track } = sim;
  const env = track.map.env;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY.fog, env.fog ?? 0.0011);
  scene.background = SKY.fog.clone();

  // ----- Lumière -----
  const hemi = new THREE.HemisphereLight(new THREE.Color('#cfe2f5').convertSRGBToLinear(), new THREE.Color('#6b5d3e').convertSRGBToLinear(), 1.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff1da').convertSRGBToLinear(), 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 2048 : 4096, low ? 2048 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // ----- Ciel et horizon -----
  const sky = createSky(SUN_DIR);
  scene.add(sky.mesh);
  const mid = track.sample(track.length / 2);
  scene.add(createMountains(new THREE.Vector3(mid.x, 0, mid.z), track.trailY(track.length, 0) - 30, env.mountains ?? 1, SUN_DIR));

  // ----- Sol, forêt, habillage -----
  const ground = createGround(sim);
  scene.add(ground.terrainMesh, ground.ribbonMesh);
  if (ground.far) scene.add(ground.far);
  const vegetation = createVegetation(track, ground.forestAt);
  scene.add(vegetation.group);
  const forest = createForest(track, renderer, { low });
  scene.add(forest.group);
  const course = createCourse(sim, SUN_DIR);
  scene.add(course.group);

  const tmp = new THREE.Vector3();
  return {
    scene,
    sun,
    course,
    forest,
    update(focus, camera, t) {
      // Le soleil suit le pilote : ses ombres restent nettes là où on regarde. On cale sa position sur la grille
      // des texels d'ombre pour qu'elles ne scintillent pas.
      const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
      tmp.copy(focus);
      tmp.x = Math.round(tmp.x / texel) * texel; tmp.z = Math.round(tmp.z / texel) * texel;
      sun.position.copy(tmp).addScaledVector(SUN_DIR, 150);
      sun.target.position.copy(tmp);
      sky.update(camera, t);
      vegetation.update(t, camera);
      forest.update(camera, t);
      course.update(t);
    },
  };
}
