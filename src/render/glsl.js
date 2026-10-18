// Morceaux de GLSL partagés : bruit, bosselage procédural.

export const NOISE_GLSL = /* glsl */ `
float dh_hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float dh_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dh_hash(i), b = dh_hash(i + vec2(1.0, 0.0)), c = dh_hash(i + vec2(0.0, 1.0)), d = dh_hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float dh_fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * dh_noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Cailloux : distance au centre de la cellule la plus proche (bruit de Worley).
float dh_cells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(dh_hash(i + g), dh_hash(i + g + 31.7));
    d = min(d, length(g + o - f));
  }
  return d;
}
`;

// Normale bosselée à partir d'une hauteur calculée dans le shader (comme bumpMap, sans texture).
export const BUMP_GLSL = /* glsl */ `
vec3 dh_perturbNormal(vec3 surf_pos, vec3 surf_norm, float h, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec2 dHdxy = vec2(dFdx(h), dFdy(h));
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;
