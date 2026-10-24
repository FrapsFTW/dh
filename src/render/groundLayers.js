// Les couches de sol : une photo CC0 de Poly Haven par sol, et sa taille réelle (en mètres, d'après Poly Haven).
// L'ordre est celui des tableaux de textures (tools/ground-textures.mjs les fabrique) : ne pas le changer sans les
// refaire.
// - avg : la teinte moyenne de la photo (sRGB, mesurée) ; look : celle qu'on veut au jeu. La photo est ramenée à la
//   luminosité voulue (un seul facteur : les nuances restent justes), puis recolor de sa couleur est remplacée par la
//   teinte voulue (le détail reste celui de la photo).
// - rough : la rugosité de la surface.

export const GROUND_LAYERS = [
  { name: 'prairie', id: 'leafy_grass', size: 2, rough: 0.95, avg: [134, 116, 79], look: [92, 114, 50], recolor: 0.7 },
  { name: 'alpage', id: 'aerial_grass_rock', size: 7.5, rough: 0.95, avg: [90, 77, 29], look: [124, 120, 70], recolor: 0.75 },
  { name: 'aiguilles', id: 'forest_leaves_04', size: 1.5, rough: 0.92, avg: [108, 79, 50], look: [100, 74, 48], recolor: 0.4 },
  { name: 'terre', id: 'forest_ground_04', size: 3.15, rough: 0.9, avg: [100, 84, 64], look: [126, 96, 68], recolor: 0.5 },
  { name: 'gravier', id: 'rocky_trail', size: 2, rough: 0.88, avg: [123, 108, 90], look: [128, 120, 108], recolor: 0.5 },
  { name: 'roche', id: 'rock_face_03', size: 2.7, rough: 0.75, avg: [126, 101, 78], look: [124, 120, 114], recolor: 0.75 },
  { name: 'pierrier', id: 'gray_rocks', size: 1.8, rough: 0.82, avg: [110, 103, 92], look: [120, 116, 110], recolor: 0.4 },
  { name: 'neige', id: 'snow_02', size: 2, rough: 0.55, avg: [132, 132, 134], look: [234, 238, 246], recolor: 0.6 },
  { name: 'paves', id: 'cobblestone_05', size: 2.4, rough: 0.7, avg: [119, 110, 91], look: [112, 106, 96], recolor: 0.3 },
];

export const LAYER = Object.fromEntries(GROUND_LAYERS.map((l, i) => [l.name, i]));

/**
 * Le GLSL des couches : la taille, la rugosité, et les deux facteurs de couleur (en linéaire : l'échelle de luminosité,
 * et la teinte voulue, de luminosité 1).
 */
export function layerGLSL() {
  const lin = (v) => Math.pow(v / 255, 2.2);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const f = (x) => x.toFixed(4);
  const v3 = (c) => `vec3(${c.map(f).join(', ')})`;
  const N = GROUND_LAYERS.length;
  const size = [], rough = [], scale = [], tint = [], recolor = [];
  for (const l of GROUND_LAYERS) {
    const a = l.avg.map(lin), t = l.look.map(lin);
    size.push(f(l.size)); rough.push(f(l.rough)); recolor.push(f(l.recolor));
    scale.push(f(lum(t) / lum(a)));
    tint.push(v3(t.map((x) => x / lum(t))));
  }
  return `
const float DH_SIZE[${N}] = float[${N}](${size.join(', ')});
const float DH_ROUGH[${N}] = float[${N}](${rough.join(', ')});
const float DH_RECOLOR[${N}] = float[${N}](${recolor.join(', ')});
const float DH_SCALE[${N}] = float[${N}](${scale.join(', ')});
const vec3 DH_TINT[${N}] = vec3[${N}](${tint.join(', ')});
${GROUND_LAYERS.map((l, i) => `#define L_${l.name.toUpperCase()} ${i}`).join('\n')}
`;
}

/** Les matières du village (Poly Haven, CC0) : public/textures/<nom>-couleur.jpg et <nom>-relief.jpg. */
export const VILLAGE_TEXTURES = {
  pierre: 'castle_wall_slates', // moellons de schiste (2,5 m)
  crepi: 'white_rough_plaster', // crépi à la chaux (1 m)
  lauze: 'roof_slates_03', // toit de lauzes (3 m)
  bois: 'weathered_planks', // planches grisées (2 m)
};
