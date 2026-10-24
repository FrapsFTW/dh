// La scène affichée : ciel, massifs, sol, forêt, habillage de course, lumière.
// Elle se construit à partir des mêmes maillages que la physique : ce qu'on voit est ce sur quoi on roule.
// Deux scènes : le lointain (ciel, massifs jusqu'à 20 km), dessiné d'abord, et la scène proche (voir post.js).
// La lumière d'ambiance vient du ciel lui-même (une carte d'environnement prise au lancement) : bleutée d'en haut,
// chaude du côté du soleil, sombre d'en bas.

import * as THREE from 'three';
import { createSky } from './sky.js';
import { atmosphereParams, setupAtmosphere } from './atmosphere.js';
import { createRange } from './range.js';
import { createGround } from './ground.js';
import { createVegetation } from './vegetation.js';
import { createForest } from './trees.js';
import { createCourse } from './course.js';

// Un soleil de fin d'après-midi, assez bas pour des ombres longues sous les sapins.
const SUN_DIR = new THREE.Vector3(-0.55, 0.52, 0.4).normalize();
const SUN_COLOR = new THREE.Color('#fff0d8').convertSRGBToLinear();

/** La lumière d'ambiance : le ciel vu depuis la piste, au-dessus d'un sol sombre. */
function skyEnvironment(renderer, atm, clouds) {
  const envScene = new THREE.Scene();
  envScene.add(createSky(atm, { clouds }).mesh);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2900, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.075, 0.08, 0.055) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -40;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.04, 0.1, 10000).texture;
  pmrem.dispose();
  return tex;
}

export function createScene(sim, { low = false, renderer, groundTextures, massif } = {}) {
  const { track } = sim;
  const env = track.map.env;
  const atm = atmosphereParams(env, track.trailY(track.length, 0) - 60, SUN_DIR);
  setupAtmosphere(atm);
  const clouds = env.clouds ?? 0.45;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1, 2); // (allume la brume dans les matériaux : c'est l'air d'atmosphere.js)
  const farScene = new THREE.Scene();
  farScene.fog = scene.fog;

  // ----- Lumière -----
  const envMap = skyEnvironment(renderer, atm, clouds);
  scene.environment = farScene.environment = envMap;
  scene.environmentIntensity = farScene.environmentIntensity = 1.0;
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 2048 : 4096, low ? 2048 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const farSun = new THREE.DirectionalLight(SUN_COLOR, 3.6);
  farSun.position.copy(SUN_DIR);
  farScene.add(farSun);

  // ----- Ciel et massifs -----
  const sky = createSky(atm, { clouds });
  farScene.add(sky.mesh);
  if (massif && env.far) farScene.add(createRange(track, massif, { sunDir: SUN_DIR, low }).mesh);

  // ----- Sol, forêt, habillage -----
  const ground = createGround(sim, groundTextures, { low });
  scene.add(ground.terrainMesh, ground.ribbonMesh);
  if (ground.far) scene.add(ground.far);
  const vegetation = createVegetation(track, ground.forestAt, { sunDir: SUN_DIR, groundTextures });
  scene.add(vegetation.group);
  const forest = createForest(track, renderer, { low });
  scene.add(forest.group);
  const course = createCourse(sim, SUN_DIR, { groundTextures });
  scene.add(course.group);

  const tmp = new THREE.Vector3();
  return {
    scene,
    farScene,
    sun,
    course,
    forest,
    /** Jusqu'où la scène proche doit être dessinée (m). */
    viewDistance: env.far ? env.far.radius * 1.5 + 2500 : 4000,
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
      course.update(t, camera);
    },
  };
}
