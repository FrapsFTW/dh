// L'air : la couleur du ciel et la brume de l'éloignement (la perspective atmosphérique), calculées par la même
// fonction, si bien que le relief lointain se fond exactement dans l'horizon.
// - La brume est plus dense en bas qu'en haut (elle décroît avec l'altitude, comme l'air) ; on intègre sa densité le
//   long du regard. Elle éteint plus le bleu que le rouge de ce qui est loin, et ajoute la lumière que l'air diffuse :
//   bleutée à l'opposé du soleil, chaude et lumineuse face à lui.
// - Elle remplace la brume de three.js dans tous les matériaux (setupAtmosphere, avant le premier rendu).

import * as THREE from 'three';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const v3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
const f = (x) => x.toFixed(7);

/**
 * Les réglages de l'air d'une carte. env.haze : la densité de la brume au pied (par mètre) ; env.hazeHeight : son
 * épaisseur (m) ; base : l'altitude du pied (le bas de la piste).
 */
export function atmosphereParams(env, base, sunDir) {
  return {
    sun: sunDir.clone().normalize(),
    zenith: lin('#2f63b0'),
    horizon: lin('#b9cde0'),
    warm: lin('#f3dcb6'), // l'horizon face au soleil
    glow: lin('#ffe2b0'),
    ground: lin('#7f8c94'), // sous l'horizon, quand rien ne le cache
    density: env.haze ?? 1.0e-4,
    height: env.hazeHeight ?? 1400,
    base,
  };
}

/** Le GLSL de l'air : atm_sky(direction) et atm_apply(couleur, point, œil). */
export function atmosphereGLSL(p) {
  return /* glsl */ `
const vec3 ATM_SUN = vec3(${f(p.sun.x)}, ${f(p.sun.y)}, ${f(p.sun.z)});
const vec3 ATM_ZENITH = ${v3(p.zenith)};
const vec3 ATM_HORIZON = ${v3(p.horizon)};
const vec3 ATM_WARM = ${v3(p.warm)};
const vec3 ATM_GLOW = ${v3(p.glow)};
const vec3 ATM_GROUND = ${v3(p.ground)};
const float ATM_DENSITY = ${f(p.density)};
const float ATM_HEIGHT = ${f(p.height)};
const float ATM_BASE = ${f(p.base)};

// La lumière du ciel dans une direction (sans le disque du soleil).
vec3 atm_sky(vec3 d) {
  float e = clamp(d.y, -1.0, 1.0);
  float sd = dot(d, ATM_SUN);
  vec2 hd = normalize(d.xz + 1e-5), hs = normalize(ATM_SUN.xz + 1e-5);
  float toward = max(dot(hd, hs), 0.0);
  vec3 hor = mix(ATM_HORIZON, ATM_WARM, pow(toward, 3.0) * 0.75);
  float up = max(e, 0.0);
  vec3 col = mix(hor, ATM_ZENITH, pow(up, 0.42));
  // Sous l'horizon : le voile s'assombrit un peu (ce qu'on y voit est de la brume au-dessus des vallées).
  col = mix(col, mix(hor, ATM_GROUND, 0.5), smoothstep(0.0, -0.25, e));
  // La lumière diffusée vers l'avant autour du soleil (Henyey-Greenstein), plus forte près de l'horizon.
  float g = 0.76;
  float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * sd, 1.5) * 0.08;
  col += ATM_GLOW * mie * (0.35 + 0.65 * (1.0 - up));
  return col;
}

// La perspective atmosphérique : ce qu'on voit au point P, depuis l'œil O.
vec3 atm_apply(vec3 col, vec3 P, vec3 O) {
  vec3 v = P - O;
  float dist = length(v);
  vec3 d = v / max(dist, 1e-3);
  float k = d.y * dist / ATM_HEIGHT;
  float shape = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  float od = ATM_DENSITY * exp(-(O.y - ATM_BASE) / ATM_HEIGHT) * dist * shape;
  vec3 T = exp(-od * vec3(0.86, 1.0, 1.2));
  // La lumière que l'air renvoie vers l'œil : celle de l'horizon dans cette direction.
  vec3 L = atm_sky(normalize(vec3(d.x, max(d.y, 0.0) * 0.35, d.z)));
  return col * T + L * (1.0 - T);
}
`;
}

/** Remplace la brume de three.js par l'air (à appeler avant de compiler le moindre matériau). */
export function setupAtmosphere(p) {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmWorld;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  // Le point dans le monde, depuis sa position vue par la caméra (la vue est une rotation et une translation).
  vAtmWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmWorld;
  ${atmosphereGLSL(p)}
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = atm_apply(gl_FragColor.rgb, vAtmWorld, cameraPosition);
#endif`;
}
