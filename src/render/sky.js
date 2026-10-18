// Le ciel (dégradé, soleil, nuages qui dérivent) et les montagnes à l'horizon.

import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { rng, fbm } from '../sim/noise.js';

const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();
export const SKY = {
  zenith: C('#3b6fb4'),
  horizon: C('#c6d8e6'),
  haze: C('#efe0c4'), // l'horizon côté soleil, plus chaud
  fog: C('#bccfdc'),
};

export function createSky(sunDir) {
  const geo = new THREE.SphereGeometry(3000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: sunDir.clone().normalize() },
      uZenith: { value: SKY.zenith }, uHorizon: { value: SKY.horizon }, uHaze: { value: SKY.haze },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // toujours au fond
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uZenith, uHorizon, uHaze;
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        float sd = max(dot(d, uSun), 0.0);
        vec3 hor = mix(uHorizon, uHaze, pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0) * 0.8);
        vec3 col = mix(hor, uZenith, pow(clamp(e, 0.0, 1.0), 0.5));
        if (e < 0.0) col = hor;
        // Nuages : projetés sur un plafond, plus fins vers l'horizon.
        if (e > 0.01) {
          vec2 uv = d.xz / (e + 0.08) * 0.7 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = dh_fbm(uv * 1.3);
          float cover = smoothstep(0.52, 0.78, c) * smoothstep(0.01, 0.25, e);
          float shade = 0.72 + 0.4 * smoothstep(0.45, 0.85, dh_fbm(uv * 1.3 + vec2(0.03, 0.05)));
          vec3 cloud = mix(vec3(0.62, 0.66, 0.72), vec3(1.05, 1.02, 0.98), shade) + vec3(1.0, 0.85, 0.6) * pow(sd, 6.0) * 0.6;
          col = mix(col, cloud, cover * 0.92);
        }
        // Le soleil et son halo.
        col += vec3(1.0, 0.86, 0.62) * (pow(sd, 8.0) * 0.25 + pow(sd, 90.0) * 0.8);
        col += vec3(12.0, 10.5, 8.0) * smoothstep(0.99955, 0.99975, sd);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, update(camera, t) { mesh.position.copy(camera.position); mat.uniforms.uTime.value = t; } };
}

/** Trois rangées de montagnes autour de la piste, la plus lointaine enneigée. */
export function createMountains(center, baseY) {
  const group = new THREE.Group();
  const rand = rng(77);
  const layers = [
    { r: 850, h: 260, jag: 1.0, snow: 2000, color: '#2f4430', seg: 220 },
    { r: 1250, h: 520, jag: 1.4, snow: 430, color: '#3e4e50', seg: 260 },
    { r: 1750, h: 900, jag: 1.8, snow: 560, color: '#5b6672', seg: 300 },
  ];
  const rock = new THREE.Color('#77736d').convertSRGBToLinear(), snow = new THREE.Color('#f2f4f7').convertSRGBToLinear();
  for (const L of layers) {
    const pos = [], col = [], idx = [];
    const base = new THREE.Color(L.color).convertSRGBToLinear();
    const off = rand() * 100;
    const rows = 6;
    for (let i = 0; i <= L.seg; i++) {
      const a = (i / L.seg) * Math.PI * 2;
      // La crête : du bruit, plus des pics.
      const n = fbm(Math.cos(a) * 3 * L.jag + off, Math.sin(a) * 3 * L.jag + off, 5, 9);
      const ridge = Math.max(0.05, 0.55 + n * 1.1 + Math.pow(Math.abs(Math.sin(a * 7 + off)), 6) * 0.25);
      const top = baseY + L.h * ridge;
      for (let k = 0; k <= rows; k++) {
        const f = k / rows; // 0 en bas, 1 au sommet
        const rr = L.r * (1 + (1 - f) * 0.12);
        const y = baseY - 120 + (top - baseY + 120) * Math.pow(f, 0.8);
        pos.push(center.x + Math.cos(a) * rr, y, center.z + Math.sin(a) * rr);
        const c = base.clone();
        if (y > baseY + L.snow * 0.55) c.lerp(rock, Math.min(1, (y - baseY - L.snow * 0.55) / (L.snow * 0.4)));
        if (y > baseY + L.snow) c.lerp(snow, Math.min(1, (y - baseY - L.snow) / 80));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < L.seg; i++) for (let k = 0; k < rows; k++) {
      const a = i * (rows + 1) + k, b = a + rows + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
