// Les plantes du sous-bois : des scans de Poly Haven (public/plantes/*.glb, préparés par tools/plantes.mjs). Chaque
// espèce a plusieurs plantes (ses variantes). De près, on dessine les vraies plantes en 3D ; au loin, des cartes
// croisées qui portent leur image, rendue au lancement depuis les mêmes modèles (un « imposteur » par variante).
// Le passage de l'un à l'autre se fait plante par plante, à la même distance (uNear), dans les shaders.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const base = () => (import.meta.env ? import.meta.env.BASE_URL : '/');

/** Une géométrie en flottants, dans le repère de la plante (le GLB est quantifié : positions entières, nœud mis à l'échelle). */
function plainGeometry(mesh) {
  mesh.updateWorldMatrix(true, false);
  const src = mesh.geometry, g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.attributes[name], n = a.itemSize, arr = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) arr[i * n + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  g.setIndex(src.index.clone());
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  // Le vent : un poids par sommet, nul au pied, qui croît comme le carré de la hauteur (en mètres de la plante).
  const h = Math.max(0.02, g.boundingBox.max.y), p = g.attributes.position, sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) sway[i] = (Math.max(0, p.getY(i)) / h) ** 2 * h;
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  g.computeBoundingSphere();
  return g;
}

/** Charge les espèces demandées : { nom: { variants: [{ geometry, w, h }], map } }. Une espèce qui manque est ignorée. */
export async function loadPlants(names) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const out = {};
  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`${base()}plantes/${name}.glb`);
      const variants = [];
      let map = null;
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        map = map || o.material.map;
        const geometry = plainGeometry(o), bb = geometry.boundingBox;
        variants.push({ geometry, w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h: bb.max.y });
      });
      map.anisotropy = 4;
      out[name] = { variants, map };
    } catch (e) {
      console.warn(`plantes : ${name} introuvable`, e);
    }
  }));
  return out;
}

/**
 * Les imposteurs des espèces : chaque variante vue de côté, dans une case d'un même atlas (cols × rows cases ; v.cell
 * dit laquelle). La carte qui la porte a ses proportions (w × h) : la case est remplie en entier.
 */
export function bakeImpostors(renderer, list, cell = 256) {
  const all = list.flatMap((sp) => sp.variants.map((v) => ({ v, sp })));
  const cols = Math.min(all.length, 8), rows = Math.ceil(all.length / cols);
  const rt = new THREE.WebGLRenderTarget(cols * cell, rows * cell, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace, samples: 4 });
  const mats = new Map(list.map((sp) => {
    const mat = new THREE.MeshBasicMaterial({ map: sp.map, alphaTest: 0.5, side: THREE.DoubleSide });
    // (ce qui passe est opaque : la carte au loin refait le seuil sur cette transparence-là)
    mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a = 1.0;'); };
    return [sp, mat];
  }));
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, 0, -10, 10);
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear };
  renderer.setRenderTarget(rt);
  // Le fond : la couleur moyenne d'un feuillage, transparent (les petites versions de la texture n'y prennent pas de noir).
  renderer.setClearColor(new THREE.Color(0.1, 0.13, 0.05), 0);
  renderer.autoClear = false;
  renderer.clear();
  rt.scissorTest = true;
  all.forEach(({ v, sp }, i) => {
    const m = new THREE.Mesh(v.geometry, mats.get(sp));
    scene.add(m);
    cam.left = -v.w / 2; cam.right = v.w / 2; cam.top = v.h; cam.bottom = 0;
    cam.updateProjectionMatrix();
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    rt.viewport.set(x, y, cell, cell);
    rt.scissor.set(x, y, cell, cell);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    scene.remove(m);
    v.cell = i;
  });
  renderer.autoClear = prev.auto;
  renderer.setClearColor(prev.color, prev.alpha);
  renderer.setRenderTarget(prev.target);
  for (const mat of mats.values()) mat.dispose();
  return { texture: rt.texture, cols, rows, target: rt };
}
