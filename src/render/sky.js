// Le ciel : la couleur de l'air (atmosphere.js, la même que la brume), le soleil, et des nuages qui dérivent.
// Les nuages sont posés sur un plafond, à 2 500 m au-dessus de la piste : plus serrés et plus fins vers l'horizon, où
// l'air les voile ; chacun est éclairé du côté du soleil, gris-bleu dessous, avec un liseré lumineux face au soleil.

import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { atmosphereGLSL } from './atmosphere.js';

export function createSky(atm, { clouds = 0.5 } = {}) {
  const geo = new THREE.SphereGeometry(3000, 64, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uCover: { value: clouds } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // toujours au fond
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCover;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${atmosphereGLSL(atm)}
      float cloudDensity(vec2 p) {
        float base = dh_fbm(p * 0.9);
        float detail = dh_fbm(p * 4.3 + 7.0);
        float c = base * 0.75 + detail * 0.3;
        return smoothstep(1.0 - uCover * 0.9 - 0.08, 1.0 - uCover * 0.9 + 0.22, c);
      }
      void main() {
        vec3 d = normalize(vDir);
        float sd = dot(d, ATM_SUN);
        vec3 col = atm_sky(d);
        // Les nuages, projetés sur leur plafond.
        if (d.y > 0.015) {
          vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
          vec2 uv = d.xz / d.y * 0.42 + wind;
          float dens = cloudDensity(uv);
          if (dens > 0.001) {
            // Éclairé du côté du soleil : on regarde la densité un peu vers lui.
            vec2 toSun = normalize(ATM_SUN.xz + 1e-4) * 0.06;
            float shadow = cloudDensity(uv + toSun);
            float lit = clamp(1.0 - (shadow - dens * 0.6) * 1.4, 0.0, 1.0);
            vec3 sunLit = vec3(1.0, 0.97, 0.92) * 1.15;
            vec3 under = mix(vec3(0.42, 0.47, 0.56), ATM_HORIZON * 0.85, 0.35);
            vec3 cloud = mix(under, sunLit, lit * 0.75 + 0.25 * (1.0 - dens));
            // Le liseré : face au soleil, les bords fins s'illuminent.
            cloud += ATM_GLOW * pow(max(sd, 0.0), 12.0) * (1.0 - dens) * 1.6;
            // L'air voile les nuages lointains (près de l'horizon).
            float far = 1.0 - smoothstep(0.015, 0.3, d.y);
            cloud = mix(cloud, col, far * 0.8);
            col = mix(col, cloud, dens * (1.0 - far * 0.5));
          }
        }
        // Le soleil : le disque, et son halo serré.
        float disc = smoothstep(0.99962, 0.99978, sd);
        col += vec3(1.0, 0.92, 0.8) * (pow(max(sd, 0.0), 220.0) * 1.5) + vec3(30.0, 27.0, 22.0) * disc;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, material: mat, update(camera, t) { mesh.position.copy(camera.position); mat.uniforms.uTime.value = t; } };
}
