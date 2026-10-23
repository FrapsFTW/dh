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

/**
 * Trois rangées de montagnes autour de la piste, la plus lointaine enneigée. scale : la taille du massif (1 en forêt).
 * En haute montagne (scale > 1), l'air est plus limpide : de vrais sommets, des couloirs, des glaciers, et une brume
 * d'éloignement calculée ici (le brouillard de la scène les effacerait), avec un éclairage doux du soleil (sunDir).
 */
export function createMountains(center, baseY, scale = 1, sunDir = new THREE.Vector3(0, 1, 0)) {
  const group = new THREE.Group();
  const rand = rng(77);
  const alpine = scale > 1;
  const layers = alpine
    ? [
      { r: 900 * scale, h: 420, jag: 0.7, snow: 1e9, color: '#3b4a37', seg: 260, haze: 0.45, flank: 0.3 },
      { r: 1250 * scale, h: 820, jag: 0.9, snow: 640, color: '#4f5a5e', seg: 300, haze: 0.56, flank: 0.35 },
      { r: 1700 * scale, h: 1350, jag: 1.1, snow: 820, color: '#626d78', seg: 340, haze: 0.66, flank: 0.4 },
    ]
    : [
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
      const ridge = alpine
        ? Math.max(0.12, 0.5 + n * 0.9 + Math.pow(Math.max(0, fbm(Math.cos(a) * 9 + off, Math.sin(a) * 9, 3, 4)), 1.5) * 0.9)
        : Math.max(0.05, 0.55 + n * 1.1 + Math.pow(Math.abs(Math.sin(a * 7 + off)), 6) * 0.25);
      const top = baseY + L.h * ridge;
      for (let k = 0; k <= rows; k++) {
        const f = k / rows; // 0 en bas, 1 au sommet
        const rr = L.r * (1 + (1 - f) * (L.flank || 0.12));
        const y = baseY - 120 + (top - baseY + 120) * Math.pow(f, 0.8);
        pos.push(center.x + Math.cos(a) * rr, y, center.z + Math.sin(a) * rr);
        const c = base.clone();
        if (alpine) {
          // Des couloirs (des bandes plus sombres dans la pente), la neige qui descend dans les creux.
          const gully = fbm(a * 60 + off, f * 2, 2, 12);
          c.multiplyScalar(0.8 + 0.35 * (gully * 0.5 + 0.5));
          const sl = L.snow + gully * 120;
          if (y > baseY + sl * 0.6) c.lerp(rock, Math.min(1, (y - baseY - sl * 0.6) / (sl * 0.3)));
          if (y > baseY + sl) c.lerp(snow, Math.min(1, (y - baseY - sl) / 60));
        } else {
          if (y > baseY + L.snow * 0.55) c.lerp(rock, Math.min(1, (y - baseY - L.snow * 0.55) / (L.snow * 0.4)));
          if (y > baseY + L.snow) c.lerp(snow, Math.min(1, (y - baseY - L.snow) / 80));
        }
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
    let mat;
    if (alpine) {
      // Éclairé une fois pour toutes : la face tournée vers le soleil plus claire, l'autre dans une ombre bleutée,
      // puis la brume de l'éloignement.
      const nrm = g.attributes.normal, n = new THREE.Vector3(), toC = new THREE.Vector3(), shadow = new THREE.Color(0.55, 0.62, 0.78);
      for (let v = 0; v < nrm.count; v++) {
        n.fromBufferAttribute(nrm, v);
        toC.set(center.x - pos[v * 3], 0, center.z - pos[v * 3 + 2]);
        if (n.dot(toC) < 0) n.negate(); // la face qu'on voit, tournée vers la piste
        const lit = Math.max(0, n.dot(sunDir));
        const c = new THREE.Color(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
        c.multiply(shadow.clone().lerp(new THREE.Color(1.25, 1.18, 1.05), lit)).multiplyScalar(0.75 + 0.25 * Math.max(0, n.y));
        c.lerp(SKY.fog, L.haze);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    } else mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
