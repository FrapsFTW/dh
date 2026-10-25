// Le public : les spectateurs de public/models/public.glb (préparés par tools/public.mjs, d'après les « Background
// Posed Humans » de Quaternius, CC0). Chaque pose est une géométrie ; chaque sommet dit sa partie du corps (part :
// 0 peau, 1 haut, 2 pantalon, 3 chaussures, 4 cheveux), et combien il bouge quand on salue (wave). Le haut prend la couleur de l'instance ; la peau, le pantalon,
// les chaussures et les cheveux sont tirés au sort pour chacun, d'après sa position (dans le shader).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const base = () => (import.meta.env ? import.meta.env.BASE_URL : '/');

/** Les poses : [{ geometry, name, sitting }], ou null si le modèle manque (le jeu garde alors ses spectateurs simples). */
export async function loadCrowd() {
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${base()}models/public.glb`);
    gltf.scene.updateMatrixWorld(true);
    const poses = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // (le GLB est quantifié : en flottants, dans le repère du spectateur)
      const src = o.geometry, g = new THREE.BufferGeometry();
      for (const [from, to, n] of [['position', 'position', 3], ['normal', 'normal', 3], ['_part', 'part', 1], ['_wave', 'wave', 1]]) {
        const a = src.attributes[from], arr = new Float32Array(a.count * n);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) arr[i * n + k] = a.getComponent(i, k);
        g.setAttribute(to, new THREE.BufferAttribute(arr, n));
      }
      g.setIndex(src.index.clone());
      g.applyMatrix4(o.matrixWorld);
      g.computeBoundingSphere();
      poses.push({ geometry: g, name: o.name, sitting: /Sitting/.test(o.name) });
    });
    return poses.length ? poses : null;
  } catch (e) {
    console.warn('public : modèle introuvable', e);
    return null;
  }
}

// Les couleurs tirées au sort : peaux, pantalons (jeans, noirs, beiges, shorts de montagne), chaussures, cheveux.
const SKINS = ['#e9c1a0', '#d9a77f', '#c08a62', '#8d5a3b', '#5c3a26', '#f0cfb4'];
const PANTS = ['#2a3446', '#3c4f6b', '#1d1f24', '#5d5444', '#6b6457', '#2f3a2c', '#4a4f57', '#7a6a55'];
const SHOES = ['#2b2b2b', '#4a3a2a', '#d8d8d4', '#1b2a44', '#7a2a22'];
const HAIR = ['#2a1d14', '#5a3a1e', '#b48a52', '#1a1a1a', '#8a5a2e', '#c9b48a', '#9a9a96'];
const glslColors = (name, list) => `const vec3 ${name}[${list.length}] = vec3[](${list.map((h) => { const c = lin(h); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; }).join(', ')});`;

/**
 * Le matériau du public. bounce : ils sautillent (pas ceux qui sont assis). time : l'horloge partagée.
 */
export function crowdMaterial(time, { bounce = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
attribute float part;
attribute float wave;
${glslColors('SKINS', SKINS)}
${glslColors('PANTS', PANTS)}
${glslColors('SHOES', SHOES)}
${glslColors('HAIRS', HAIR)}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_INSTANCING
{
  float h = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  if (part < 0.5) vColor.rgb = SKINS[int(h * ${SKINS.length}.0)];
  else if (part > 1.5 && part < 2.5) vColor.rgb = PANTS[int(fract(h * 7.31) * ${PANTS.length}.0)];
  else if (part > 2.5 && part < 3.5) vColor.rgb = SHOES[int(fract(h * 3.17) * ${SHOES.length}.0)];
  else if (part > 3.5) vColor.rgb = HAIRS[int(fract(h * 13.7) * ${HAIR.length}.0)];
}
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  // Le bras levé salue, le poing encourage : la main va et vient, l'épaule bouge à peine.
  float ph = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 1.3, w = sin(uTime * (5.5 + 2.0 * fract(ph)) + ph);
  transformed.x += wave * w * 0.16;
  transformed.y += wave * max(0.0, w) * 0.05;
}
${bounce ? `{
  // Certains sautillent, chacun à son rythme.
  float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
  transformed.y += max(0.0, sin(uTime * (6.0 + 2.0 * fract(ph * 3.1)) + ph)) * 0.06 * step(0.55, fract(ph));
}` : ''}
#endif`);
  };
  mat.customProgramCacheKey = () => `public-${bounce}`;
  return mat;
}
