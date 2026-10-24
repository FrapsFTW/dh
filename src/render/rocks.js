// Les rochers : blocs fracturés et matière photographique, partagés par le sous-bois et l'habillage de la piste.
// - La forme : une sphère taillée par quelques plans de fracture (des faces planes, des arêtes vives, comme un bloc
//   de granit débité), puis usée par un peu de bruit, le pied aplati pour qu'elle repose sur le sol.
// - La matière : la photo de roche du sol (groundLayers.js), projetée sur les trois plans du monde (une texture
//   enroulée sur une sphère s'étirerait), du lichen ou de la mousse sur le dessus, le pied assombri là où il touche
//   la terre.

import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../sim/noise.js';
import { layerGLSL } from './groundLayers.js';
import { NOISE_GLSL } from './glsl.js';

/** Un bloc, de rayon ~1, posé sur y = -0.3 environ. seed : sa forme ; cuts : le nombre de plans de fracture. */
export function rockGeometry(seed, { detail = 3, cuts = 7, rough = 0.12, flat = -0.32, depth = [0.5, 0.85], stretch = 0.82 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const rand = rng(seed * 7919 + 13);
  const planes = [];
  for (let k = 0; k < cuts; k++) {
    const n = new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.8, rand() * 2 - 1).normalize();
    planes.push([n, depth[0] + rand() * (depth[1] - depth[0])]);
  }
  const p = g.attributes.position, v = new THREE.Vector3(), col = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    for (const [n, d] of planes) {
      const t = v.dot(n) - d;
      if (t > 0) v.addScaledVector(n, -t * 0.94);
    }
    const w = fbm(v.x * 1.8 + seed, v.z * 1.8 + v.y * 1.3, 3, seed);
    v.multiplyScalar(1 + rough * w + 0.025 * fbm(v.x * 7 + seed, v.y * 7 - v.z * 5, 2, seed + 3));
    if (v.y < flat) v.y = flat + (v.y - flat) * 0.15;
    p.setXYZ(i, v.x, v.y * stretch, v.z);
    // Une teinte par bloc, un peu de variation dans la masse (les veines).
    const t = 0.86 + 0.16 * fbm(v.x * 3 + seed, v.y * 3 + v.z * 2, 2, seed + 1);
    col.push(t, t * 0.99, t * 0.97);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return toCreasedNormals(g, THREE.MathUtils.degToRad(38));
}

/**
 * Le matériau des rochers. tex : les photos du sol (loadGroundTextures) ; moss : la part de mousse sur le dessus
 * (0 à 1 ; en altitude, ce sont des lichens jaunes) ; wet : plus sombre et brillant (le gué).
 */
export function rockMaterial(tex, { moss = 0.4, alpine = false, wet = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: wet ? 0.35 : 0.82, metalness: 0 });
  if (!tex) return mat;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundC = { value: tex.color };
    shader.uniforms.uGroundN = { value: tex.relief };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vRockW;
varying vec3 vRockN;
varying float vRockY;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
{
  vec4 rw = vec4(transformed, 1.0);
  vec3 rn = objectNormal;
#ifdef USE_INSTANCING
  rw = instanceMatrix * rw;
  rn = mat3(instanceMatrix) * rn;
#endif
  vRockW = (modelMatrix * rw).xyz;
  vRockN = normalize(mat3(modelMatrix) * rn);
  vRockY = position.y;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uGroundC, uGroundN;
varying vec3 vRockW;
varying vec3 vRockN;
varying float vRockY;
${NOISE_GLSL}
${layerGLSL()}
vec3 rockNW;
// La roche projetée sur un plan : sa couleur (ramenée à la teinte voulue) et sa normale (xy).
void rockSample(vec2 uv, out vec3 c, out vec2 n) {
  vec4 a = texture(uGroundC, vec3(uv, float(L_ROCHE)));
  vec4 b = texture(uGroundN, vec3(uv, float(L_ROCHE)));
  vec3 cs = a.rgb * DH_SCALE[L_ROCHE];
  c = mix(cs, dot(cs, vec3(0.2126, 0.7152, 0.0722)) * DH_TINT[L_ROCHE], DH_RECOLOR[L_ROCHE]);
  n = b.xy * 2.0 - 1.0;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 N = normalize(vRockN);
  vec3 w = pow(abs(N), vec3(4.0));
  w /= w.x + w.y + w.z;
  float sz = 1.0 / DH_SIZE[L_ROCHE] * 1.4;
  vec3 cx, cy, cz; vec2 nx, ny, nz;
  rockSample(vRockW.zy * sz, cx, nx);
  rockSample(vRockW.xz * sz, cy, ny);
  rockSample(vRockW.xy * sz, cz, nz);
  vec3 c = cx * w.x + cy * w.y + cz * w.z;
  // Les normales des trois projections, ramenées dans le monde (chacune sur son plan).
  vec3 tn = vec3(0.0, nx.y, nx.x) * sign(N.x) * w.x + vec3(ny.x, 0.0, -ny.y) * w.y + vec3(nz.x, nz.y, 0.0) * w.z;
  rockNW = normalize(N + vec3(tn.x * (1.0 - abs(N.x)), tn.y * (1.0 - abs(N.y)), tn.z * (1.0 - abs(N.z))) * 1.2);
  // Mousse ou lichen sur le dessus, par taches.
  float top = smoothstep(0.45, 0.85, rockNW.y) * smoothstep(0.35, 0.65, dh_noise(vRockW.xz * 1.7) * 0.6 + dh_noise(vRockW.xz * 6.0) * 0.4);
  vec3 mossC = ${alpine ? 'vec3(0.33, 0.31, 0.14)' : 'vec3(0.10, 0.15, 0.04)'};
  c = mix(c, mossC * (0.8 + 0.4 * dh_noise(vRockW.xz * 11.0)), top * ${moss.toFixed(2)});
  // Le pied, dans l'ombre de la terre.
  c *= 0.55 + 0.45 * smoothstep(-0.32, 0.05, vRockY);
  ${wet ? 'c *= 0.6;' : ''}
  diffuseColor.rgb *= c;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mat3(viewMatrix) * rockNW);`);
  };
  mat.customProgramCacheKey = () => `roche-${moss}-${alpine}-${wet}`;
  return mat;
}

/**
 * La glace des séracs : la neige sur le dessus, des flancs de glace bleutée, striés des couches de poussière que le
 * glacier a accumulées, et la lumière qui traverse la glace (plus bleue dans les creux et à l'ombre).
 */
export function iceMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 });
  if (!tex) return mat;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundC = { value: tex.color };
    shader.uniforms.uGroundN = { value: tex.relief };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vIceW;
varying vec3 vIceN;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
{
  vec4 rw = vec4(transformed, 1.0);
  vec3 rn = objectNormal;
#ifdef USE_INSTANCING
  rw = instanceMatrix * rw;
  rn = mat3(instanceMatrix) * rn;
#endif
  vIceW = (modelMatrix * rw).xyz;
  vIceN = normalize(mat3(modelMatrix) * rn);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uGroundC, uGroundN;
varying vec3 vIceW;
varying vec3 vIceN;
${NOISE_GLSL}
${layerGLSL()}
vec3 iceNW;
float iceTop;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 N = normalize(vIceN);
  vec3 w = pow(abs(N), vec3(4.0));
  w /= w.x + w.y + w.z;
  float sz = 1.0 / DH_SIZE[L_NEIGE];
  vec4 cx = texture(uGroundC, vec3(vIceW.zy * sz, float(L_NEIGE))), cy = texture(uGroundC, vec3(vIceW.xz * sz, float(L_NEIGE))), cz = texture(uGroundC, vec3(vIceW.xy * sz, float(L_NEIGE)));
  vec4 nx = texture(uGroundN, vec3(vIceW.zy * sz, float(L_NEIGE))), ny = texture(uGroundN, vec3(vIceW.xz * sz, float(L_NEIGE))), nz = texture(uGroundN, vec3(vIceW.xy * sz, float(L_NEIGE)));
  vec3 snowTex = (cx.rgb * w.x + cy.rgb * w.y + cz.rgb * w.z) * DH_SCALE[L_NEIGE];
  vec3 tn = vec3(0.0, nx.y * 2.0 - 1.0, nx.x * 2.0 - 1.0) * sign(N.x) * w.x + vec3(ny.x * 2.0 - 1.0, 0.0, 1.0 - ny.y * 2.0) * w.y + vec3(nz.x * 2.0 - 1.0, nz.y * 2.0 - 1.0, 0.0) * w.z;
  iceNW = normalize(N + tn * 0.8);
  iceTop = smoothstep(0.78, 0.92, N.y + (dh_noise(vIceW.xz * 2.0) - 0.5) * 0.15);
  // Les flancs : glace, des bandes de poussière presque horizontales, ondulées.
  float band = smoothstep(0.85, 1.0, sin(vIceW.y * 3.1 + dh_noise(vIceW.xz * 0.4) * 5.0) * 0.5 + 0.5);
  vec3 ice = mix(vec3(0.52, 0.70, 0.80), vec3(0.70, 0.82, 0.88), dh_noise(vIceW.xz * 0.9 + vIceW.y)) * (0.8 + 0.25 * dot(snowTex, vec3(0.33)));
  ice = mix(ice, vec3(0.36, 0.38, 0.38), band * 0.45);
  vec3 snow = snowTex * vec3(0.97, 0.98, 1.0);
  diffuseColor.rgb = mix(ice, snow, iceTop);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.4, 0.65, iceTop);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mat3(viewMatrix) * iceNW);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// La lumière qui traverse la glace : un bleu profond, sur les flancs.
totalEmissiveRadiance += vec3(0.02, 0.09, 0.15) * (1.0 - iceTop);`);
  };
  mat.customProgramCacheKey = () => 'glace';
  return mat;
}
