// Le post-traitement : un léger étalonnage (contraste, saturation, teinte chaude), et la sensation de vitesse.
// Comme dans les vidéos embarquées et les meilleurs jeux de descente, la vitesse se lit sur les bords de l'image :
// flou radial, légère aberration chromatique, vignette qui se resserre et couleurs qui s'éteignent, tandis que le
// centre (là où on regarde) reste net. Tout monte progressivement de 25 à 55 km/h. Puis le tone mapping filmique.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const SPEED_FX = {
  from: 25, // km/h : les effets commencent
  to: 55, // km/h : ils sont au maximum (la piste plafonne vers 55)
  blur: 1, // force du flou radial
  aberration: 1, // force de l'aberration chromatique
  tunnel: 1, // vignette et désaturation des bords
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uBlur: { value: 1 },
    uAberration: { value: 1 },
    uTunnel: { value: 1 },
    uVignette: { value: 0.3 },
    uAspect: { value: 1 },
    uCenter: { value: new THREE.Vector2(0.5, 0.56) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed, uBlur, uAberration, uTunnel, uVignette, uAspect;
    uniform vec2 uCenter;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - uCenter;
      float r = length(c * vec2(uAspect, 1.0));
      float edge = smoothstep(0.22, 0.85, r);
      // Flou radial : vers le point de fuite, seulement sur les bords, d'autant plus qu'on va vite.
      float blur = uSpeed * uBlur * edge * 0.026;
      // Aberration chromatique : le rouge et le bleu s'écartent un peu sur les bords.
      float ab = uSpeed * uAberration * edge * edge * 0.006;
      float jitter = hash(vUv * 731.0) ; // décale les échantillons : pas d'escalier dans le flou
      vec3 col = vec3(0.0);
      const int N = 10;
      for (int i = 0; i < N; i++) {
        float k = (float(i) + jitter) / float(N);
        vec2 uv = vUv - c * blur * k;
        col.r += texture2D(tDiffuse, uv - c * ab).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv + c * ab).b;
      }
      col /= float(N);
      // Étalonnage : un peu plus de saturation et de contraste, ombres légèrement froides, hautes lumières chaudes.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.16 - 0.35 * uSpeed * uTunnel * edge);
      col *= mix(vec3(0.96, 0.99, 1.05), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.8, l));
      // Vignette, qui se resserre avec la vitesse (vision en tunnel).
      float v = uVignette + 0.28 * uSpeed * uTunnel;
      col *= 1.0 - v * smoothstep(0.42 - 0.12 * uSpeed * uTunnel, 1.0, r);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Le rendu de la scène en deux temps : d'abord le lointain (le ciel, les massifs), avec sa propre caméra (même point de
// vue, mais une profondeur qui va de 20 m à 60 km), puis, la profondeur effacée, la scène proche par-dessus. Chaque
// partie garde ainsi une précision de profondeur à son échelle.
class LayeredRenderPass extends Pass {
  constructor(scene, camera, farScene) {
    super();
    this.scene = scene; this.camera = camera; this.farScene = farScene;
    this.farCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 20, 60000);
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    if (this.farScene) {
      const c = this.camera, f = this.farCamera;
      c.updateMatrixWorld();
      c.matrixWorld.decompose(f.position, f.quaternion, f.scale);
      if (f.fov !== c.fov || f.aspect !== c.aspect) { f.fov = c.fov; f.aspect = c.aspect; f.updateProjectionMatrix(); }
      renderer.render(this.farScene, f);
      renderer.clearDepth();
    }
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

export function createPost(renderer, scene, camera, { low = false, farScene = null } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new LayeredRenderPass(scene, camera, farScene));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  let amount = 0;
  return {
    composer,
    setSize(w, h) { composer.setSize(w, h); grade.uniforms.uAspect.value = w / h; },
    /** speed en m/s ; dt pour lisser (les effets ne claquent pas sur une bosse). */
    render(speed, dt = 1 / 60) {
      const kmh = speed * 3.6;
      const want = THREE.MathUtils.smoothstep(kmh, SPEED_FX.from, SPEED_FX.to);
      amount += (want - amount) * Math.min(1, dt * 3);
      const u = grade.uniforms;
      u.uSpeed.value = amount;
      u.uBlur.value = SPEED_FX.blur;
      u.uAberration.value = SPEED_FX.aberration;
      u.uTunnel.value = SPEED_FX.tunnel;
      composer.render();
    },
  };
}
