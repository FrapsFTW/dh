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
import { setGroundLooks } from './groundLayers.js';
import { NOISE_GLSL } from './glsl.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// Un soleil de fin d'après-midi, assez bas pour des ombres longues sous les sapins (une carte peut en choisir un autre :
// env.sun).
const DEFAULT_SUN = new THREE.Vector3(-0.55, 0.52, 0.4).normalize();
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
  const SUN_DIR = env.sun ? new THREE.Vector3(...env.sun).normalize() : DEFAULT_SUN;
  setGroundLooks(env.ground); // (les teintes des sols de la carte, avant de construire les matériaux)
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

  // ----- La mer (env.sea) : une nappe dans chaque scène, au même niveau (la proche cache le relief sous l'eau, la
  // lointaine les massifs) -----
  let sea = null;
  if (env.sea) {
    sea = seaMaterial();
    const c = track.sample(track.length / 2);
    const viewDistance = env.far ? env.far.radius * 1.5 + 2500 : 4000;
    for (const [sc, r] of [[scene, viewDistance], [farScene, 60000]]) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 96), sea);
      m.rotation.x = -Math.PI / 2;
      m.position.set(c.x, env.sea.level, c.z);
      m.receiveShadow = sc === scene;
      m.name = 'mer';
      sc.add(m);
    }
  }

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
      if (sea) sea.userData.time.value = t;
    },
  };
}

/** La mer : bleu profond, le ciel s'y reflète ; des vagues (la normale ondule), qui s'effacent au loin. */
function seaMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: lin('#0f3a55'), roughness: 0.2, metalness: 0 });
  mat.userData.time = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = mat.userData.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSeaW;\nuniform float uTime;\n${NOISE_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vSeaW.xz;
  float fade = 1.0 - smoothstep(400.0, 6000.0, length(vSeaW - cameraPosition));
  vec2 g = vec2(dh_noise(p * 0.045 + vec2(uTime * 0.05, 0.0)) - dh_noise(p * 0.045 + vec2(3.1, uTime * 0.04)),
    dh_noise(p * 0.13 + vec2(1.7, -uTime * 0.07)) - dh_noise(p * 0.13 + vec2(-uTime * 0.06, 5.3))) * 0.3 * fade;
  normal = normalize(normal + mat3(viewMatrix) * vec3(g.x, 0.0, g.y));
}`);
  };
  mat.customProgramCacheKey = () => 'mer';
  return mat;
}
