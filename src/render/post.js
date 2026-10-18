// Le post-traitement : un léger étalonnage (contraste, saturation, teinte chaude), un vignettage,
// et un flou radial sur les bords de l'image quand on va vite. Puis le tone mapping filmique.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uVignette: { value: 0.32 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed, uVignette, uAspect;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      // Flou radial : seulement sur les bords, et seulement vite.
      float blur = uSpeed * smoothstep(0.3, 0.8, r) * 0.012;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 6; i++) col += texture2D(tDiffuse, vUv - c * blur * float(i)).rgb;
      col /= 6.0;
      // Étalonnage : un peu plus de saturation et de contraste, des ombres légèrement froides, des hautes lumières chaudes.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.1);
      col *= mix(vec3(0.96, 0.99, 1.05), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.8, l));
      // Vignettage.
      col *= 1.0 - uVignette * smoothstep(0.35, 0.95, r);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { low = false } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer,
    setSize(w, h) { composer.setSize(w, h); grade.uniforms.uAspect.value = w / h; },
    render(speed) {
      grade.uniforms.uSpeed.value = THREE.MathUtils.clamp((speed - 11) / 10, 0, 1);
      composer.render();
    },
  };
}
