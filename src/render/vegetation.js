// Le sous-bois : herbes, fleurs, fougères, arbrisseaux, rochers, troncs couchés (les arbres sont dans trees.js).
// Les plantes sont des scans (plants.js) : de près en 3D, au loin en cartes qui portent leur image. Chaque carte a sa
// flore : la forêt et l'alpage des Alpes ; la côte Pacifique (Le Bike Park : fougères, arbrisseaux, épilobes) ; le
// maquis de la Riviera (Le Single : buissons, bruyères, genêt, lavande, herbe sèche).
// Tout est en instances, regroupées par zones : ce qui est hors du champ n'est pas dessiné, les plantes pas au-delà de
// 220 m, les rochers pas au-delà de 900 m. En montagne, au-dessus des arbres, des blocs plus gros et plus nombreux.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, fbm, smoothstep } from '../sim/noise.js';
import { TRAIL_HALF } from '../sim/track.js';
import { rockGeometry, rockMaterial } from './rocks.js';
import { bakeImpostors } from './plants.js';

const TILE = 80, TILE_NEAR = 24;

// Les espèces scannées (public/plantes) : l'échelle de chacune (les scans sont à la taille de la plante scannée, souvent
// jeune) ; big : elle porte une ombre ; wide : elle est large et à hauteur de guidon (on la garde derrière la rubalise,
// hors de la figure du pilote).
export const SPECIES = {
  fougere: { scale: [1.5, 2.3], big: true, shadow: true },
  herbe: { scale: [1.8, 2.8] },
  'herbe-seche': { scale: [2, 3.1] },
  pissenlit: { scale: [1.8, 2.6] },
  ficaire: { scale: [1.6, 2.3] },
  empodium: { scale: [1.5, 2.1] },
  ortie: { scale: [2.8, 3.8] },
  bardane: { scale: [2.4, 3.4] },
  oseille: { scale: [3.5, 5] },
  arbrisseau: { scale: [1.6, 2.5], big: true },
  myrtille: { scale: [2.4, 3.4] },
  myrte: { scale: [0.9, 1.5], big: true, wide: true, shadow: true },
  bruyere: { scale: [1.2, 1.9], big: true, wide: true },
  gazania: { scale: [1.6, 2.3] },
};
/** Les espèces de chaque flore (env.flora ; sans flore, les Alpes). */
export function floraSpecies(flora) {
  if (flora === 'maquis') return ['herbe-seche', 'myrte', 'bruyere', 'gazania', 'empodium'];
  if (flora === 'epilobe') return ['fougere', 'herbe', 'arbrisseau', 'myrtille', 'oseille', 'pissenlit'];
  return ['fougere', 'herbe', 'herbe-seche', 'pissenlit', 'ficaire', 'empodium', 'ortie', 'bardane', 'oseille'];
}
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// ---------- Les géométries ----------

/** Une touffe : trois cartes croisées, normales vers le haut (éclairage doux, comme de l'herbe). */
function tuftGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2);
    g.translate(0, 0.5, 0);
    g.rotateY((k / 3) * Math.PI);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

// ---------- Les textures des touffes (dessinées une fois au lancement) ----------

/**
 * Une texture de touffe dessinée sur un canevas. Les pixels transparents prennent la couleur des brins voisins : sinon,
 * en s'éloignant, le filtrage mêle du noir aux brins et l'herbe se cerne de sombre.
 */
function cardTexture(draw, size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  draw(ctx, size);
  const src = ctx.getImageData(0, 0, size, size).data;
  const data = new Uint8Array(size * size * 4);
  // (à l'endroit : la ligne du bas du dessin est le pied de la touffe, v = 0)
  for (let y = 0; y < size; y++) data.set(src.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  // Le remplissage : on étend la couleur des pixels pleins, de proche en proche.
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) filled[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  for (let pass = 0; pass < 24; pass++) {
    const next = filled.slice();
    let changed = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (!filled[j]) continue;
        r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; n++;
      }
      if (n) { data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n; next[i] = 1; changed++; }
    }
    filled.set(next);
    if (!changed) break;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Un brin : effilé, courbé, plus sombre au pied qu'à la pointe (de l'ombre, pas du noir). */
function blade(ctx, S, rand, x0, h, w, bend, base, tip) {
  const steps = 8, left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + bend * t * t, y = S - h * t;
    const half = (w / 2) * (1 - t) ** 0.8;
    const dx = 2 * bend * t, dy = -h;
    const l = Math.hypot(dx, dy);
    left.push([x - (dy / l) * half, y + (dx / l) * half]);
    right.push([x + (dy / l) * half, y - (dx / l) * half]);
  }
  const g = ctx.createLinearGradient(x0, S, x0 + bend, S - h);
  g.addColorStop(0, base);
  g.addColorStop(0.55, tip.mid);
  g.addColorStop(1, tip.end);
  ctx.fillStyle = g;
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** L'herbe (dryShare : la part des brins secs ; plus au soleil du Midi). */
function drawGrass(flowers, dryShare = 0.16) {
  return (ctx, S) => {
    const rand = rng(flowers ? 5 : 3);
    for (let i = 0; i < 150; i++) {
      const x0 = S * (0.12 + rand() * 0.76), h = S * (0.3 + rand() * rand() * 0.68 + 0.02), bend = (rand() - 0.5) * S * 0.4;
      const dry = rand() < dryShare;
      const hue = dry ? 44 + rand() * 10 : 72 + rand() * 22, sat = dry ? 30 + rand() * 12 : 38 + rand() * 18;
      const l = dry ? 48 + rand() * 14 : 30 + rand() * 16;
      blade(ctx, S, rand, x0, h, S * (0.012 + rand() * 0.016), bend,
        `hsl(${hue + 6}, ${sat - 6}%, ${l * 0.55}%)`, { mid: `hsl(${hue}, ${sat}%, ${l}%)`, end: `hsl(${hue - 6}, ${sat + 4}%, ${l * 1.18}%)` });
    }
    // Quelques épis.
    for (let i = 0; i < 6; i++) {
      const x = S * (0.2 + rand() * 0.6), y = S * (0.05 + rand() * 0.25);
      ctx.strokeStyle = `hsl(${50 + rand() * 10}, 28%, ${55 + rand() * 10}%)`;
      ctx.lineWidth = S * 0.004;
      ctx.beginPath(); ctx.moveTo(x, S); ctx.quadraticCurveTo(x + (rand() - 0.5) * S * 0.1, y + S * 0.3, x + (rand() - 0.5) * S * 0.06, y); ctx.stroke();
      ctx.fillStyle = `hsl(${46 + rand() * 8}, 32%, ${58 + rand() * 10}%)`;
      ctx.beginPath(); ctx.ellipse(x, y, S * 0.008, S * 0.035, (rand() - 0.5) * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    if (flowers) {
      const colors = ['#f2dc5d', '#fbfbf4', '#b98bd4', '#e9e7c9', '#f0a35a'];
      for (let i = 0; i < 12; i++) {
        const x = S * (0.15 + rand() * 0.7), y = S * (0.12 + rand() * 0.38);
        ctx.strokeStyle = 'hsl(85, 35%, 30%)';
        ctx.lineWidth = S * 0.005;
        ctx.beginPath(); ctx.moveTo(x + (rand() - 0.5) * S * 0.05, S); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = colors[i % colors.length];
        const r = S * (0.007 + rand() * 0.006);
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(x + Math.cos(k * 1.05) * r * 1.3, y + Math.sin(k * 1.05) * r * 0.9, r, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#d8a020';
        ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
}

function drawFern(ctx, S) {
  const rand = rng(11);
  for (let f = 0; f < 8; f++) {
    const a = -Math.PI / 2 + (f - 3.5) * 0.3 + (rand() - 0.5) * 0.15;
    const len = S * (0.55 + rand() * 0.35);
    const x0 = S / 2, y0 = S;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const droop = t * t * 0.9 * Math.sign(Math.cos(a)) * 0.6;
      pts.push([x0 + Math.cos(a + droop) * len * t, y0 + Math.sin(a + droop * 0.3) * len * t + t * t * S * 0.25]);
    }
    ctx.strokeStyle = 'hsl(90, 35%, 24%)';
    ctx.lineWidth = S * 0.006;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    for (let i = 2; i < 24; i++) {
      const [x, y] = pts[i], [x2, y2] = pts[i + 1];
      const dx = x2 - x, dy = y2 - y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, w = (1 - i / 24) * S * 0.1 + S * 0.012;
      for (const side of [-1, 1]) {
        ctx.fillStyle = `hsl(${86 + rand() * 18}, ${42 + rand() * 15}%, ${26 + rand() * 16}%)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + nx * w * side * 0.7 + dx * 0.4, y + ny * w * side * 0.7 + dy * 0.4, x + nx * w * side + dx * 0.9, y + ny * w * side + dy * 0.9);
        ctx.lineTo(x + dx * 0.6, y + dy * 0.6);
        ctx.fill();
      }
    }
  }
}

/** Une tige droite, un peu penchée, de (x0, S) jusqu'à la hauteur h ; renvoie le point à la fraction t. */
function stem(ctx, S, x0, h, lean, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x0, S); ctx.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.5, x0 + lean, S - h); ctx.stroke();
  return (t) => [x0 + lean * t * t, S - h * t];
}

// L'épilobe (Le Bike Park) : de hautes tiges aux feuilles étroites, l'épi rose magenta en haut, boutons plus sombres au
// bout. C'est elle qui couvre les pistes de ski de la côte Pacifique en été.
// Une seule tige par carte (on les plante en touffes) : de longues feuilles étroites qui montent en spirale, les
// capsules rougeâtres sous les fleurs, les fleurs à quatre pétales, puis les boutons vers la pointe.
function drawFireweed(ctx, S) {
  const rand = rng(21);
  const x0 = S * 0.5, h = S * 0.97, lean = S * 0.03;
  const at = stem(ctx, S, x0, h, lean, 'hsl(350, 28%, 30%)', S * 0.011);
  for (let j = 0; j < 30; j++) { // les feuilles, de plus en plus petites vers le haut, tournées vers le ciel
    const t = 0.06 + (j / 30) * 0.58, [x, y] = at(t), side = j % 2 ? 1 : -1, len = S * (0.2 - t * 0.17) * (0.8 + rand() * 0.4);
    const ang = side * (0.75 + rand() * 0.35), dark = 22 + rand() * 9 + t * 8;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2 + ang);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `hsl(${98 + rand() * 10}, 32%, ${dark}%)`); g.addColorStop(1, `hsl(${92 + rand() * 10}, 38%, ${dark + 9}%)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.45, -S * 0.016, len, 0); ctx.quadraticCurveTo(len * 0.45, S * 0.016, 0, 0); ctx.fill();
    ctx.strokeStyle = `hsla(90, 25%, ${dark + 18}%, 0.6)`; ctx.lineWidth = S * 0.002;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke();
    ctx.restore();
  }
  for (let j = 0; j < 8; j++) { // les capsules, fines et rouges, dressées sous les fleurs
    const [x, y] = at(0.6 + j * 0.012), side = j % 2 ? 1 : -1;
    ctx.strokeStyle = `hsl(${352 + rand() * 8}, 40%, ${30 + rand() * 8}%)`; ctx.lineWidth = S * 0.005;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * S * 0.03, y - S * 0.07); ctx.stroke();
  }
  for (let j = 0; j < 22; j++) { // les fleurs : quatre pétales roses autour d'un cœur plus pâle
    const t = 0.66 + (j / 22) * 0.22, [x, y] = at(t), side = j % 2 ? 1 : -1;
    const fx = x + side * S * (0.025 + rand() * 0.025), fy = y + (rand() - 0.5) * S * 0.01, r = S * (0.017 + rand() * 0.006);
    for (let p = 0; p < 4; p++) {
      const a = p * Math.PI / 2 + rand() * 0.4;
      ctx.fillStyle = `hsl(${318 + rand() * 12}, ${52 + rand() * 14}%, ${50 + rand() * 12}%)`;
      ctx.beginPath(); ctx.ellipse(fx + Math.cos(a) * r * 0.8, fy + Math.sin(a) * r * 0.55, r * 0.75, r * 0.5, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'hsl(320, 30%, 82%)';
    ctx.beginPath(); ctx.arc(fx, fy, r * 0.25, 0, Math.PI * 2); ctx.fill();
  }
  for (let j = 0; j < 12; j++) { // les boutons, serrés, vers la pointe
    const t = 0.88 + (j / 12) * 0.12, [x, y] = at(t), side = j % 2 ? 1 : -1;
    ctx.fillStyle = `hsl(${335 + rand() * 8}, 42%, ${30 + rand() * 10}%)`;
    ctx.beginPath(); ctx.ellipse(x + side * S * 0.012, y, S * 0.008, S * 0.014, side * 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

// Le genêt (la Riviera) : un buisson de tiges vertes, raides, couvertes de petites fleurs jaune vif.
function drawBroom(ctx, S) {
  const rand = rng(23);
  for (let k = 0; k < 40; k++) {
    const x0 = S * (0.42 + (rand() - 0.5) * 0.25), h = S * (0.45 + rand() * 0.5), lean = (rand() - 0.5) * S * 0.75;
    const at = stem(ctx, S, x0, h, lean, `hsl(${95 + rand() * 15}, ${30 + rand() * 12}%, ${22 + rand() * 10}%)`, S * (0.004 + rand() * 0.003));
    for (let j = 0; j < 9; j++) {
      const t = 0.45 + rand() * 0.55, [x, y] = at(t);
      ctx.fillStyle = `hsl(${46 + rand() * 8}, ${80 + rand() * 15}%, ${52 + rand() * 12}%)`;
      ctx.beginPath(); ctx.ellipse(x, y, S * 0.011, S * 0.008, rand() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// La lavande : une touffe gris-vert, des tiges fines et leurs épis violets.
function drawLavender(ctx, S) {
  const rand = rng(25);
  for (let i = 0; i < 90; i++) {
    const x0 = S * (0.25 + rand() * 0.5), h = S * (0.15 + rand() * 0.2);
    blade(ctx, S, rand, x0, h, S * 0.01, (rand() - 0.5) * S * 0.3, 'hsl(95, 12%, 26%)', { mid: 'hsl(100, 14%, 44%)', end: 'hsl(105, 16%, 56%)' });
  }
  for (let k = 0; k < 34; k++) {
    const x0 = S * (0.3 + rand() * 0.4), h = S * (0.4 + rand() * 0.35), lean = (rand() - 0.5) * S * 0.55;
    const at = stem(ctx, S, x0, h, lean, 'hsl(100, 14%, 38%)', S * 0.003);
    for (let j = 0; j < 7; j++) {
      const [x, y] = at(0.82 + j * 0.026);
      ctx.fillStyle = `hsl(${262 + rand() * 16}, ${36 + rand() * 14}%, ${42 + rand() * 12}%)`;
      ctx.beginPath(); ctx.ellipse(x, y, S * 0.008, S * 0.011, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Le lentisque, l'arbousier : un buisson rond et dense de petites feuilles vert sombre, luisantes.
function drawShrub(ctx, S) {
  const rand = rng(27);
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI, r = Math.sqrt(rand());
    const x = S * 0.5 + Math.cos(a) * r * S * 0.46, y = S - Math.sin(a) * r * S * 0.8;
    const l = 16 + rand() * 18 + (1 - y / S) * 14; // plus clair en haut, au soleil
    ctx.fillStyle = `hsl(${88 + rand() * 25}, ${24 + rand() * 16}%, ${l}%)`;
    ctx.beginPath(); ctx.ellipse(x, y, S * 0.014, S * 0.008, rand() * 3, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Le matériau des plantes : bords doux (alpha-to-coverage, avec l'antialiasing de la scène), le vent, et la lumière du
 * soleil qui traverse les feuilles quand on le regarde en face (l'herbe s'allume à contre-jour). Trois sortes :
 * - 'carte' : une touffe dessinée (trois cartes croisées, hauteur 0 à 1) ;
 * - 'plante' : une plante scannée en 3D (son attribut sway dit comment elle plie), dessinée jusqu'à uNear mètres ;
 * - 'imposteur' : sa carte au loin, au-delà de uNear, ou uNearBig pour une grande plante (l'attribut aCell dit sa case
 *   dans l'atlas, et si elle est grande ; uGrid la taille de l'atlas).
 * Les normales des feuilles penchent vers le ciel (normalUp) : un feuillage s'éclaire en masse, pas feuille à feuille.
 */
function windMaterial(map, sunDir, { mode = 'carte', near = null, nearBig = null, grid = null, normalUp = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  mat.userData.time = { value: 0 };
  const vertex = (shader) => {
    shader.uniforms.uTime = mat.userData.time;
    if (near) shader.uniforms.uNear = near;
    if (nearBig) shader.uniforms.uNearBig = nearBig;
    if (grid) shader.uniforms.uGrid = { value: grid };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
${mode !== 'carte' ? 'uniform float uNear;' : ''}
${mode === 'plante' ? 'attribute float sway;' : ''}
${mode === 'imposteur' ? 'attribute vec2 aCell;\nuniform vec2 uGrid;\nuniform float uNearBig;' : ''}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), ${normalUp.toFixed(2)}));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
#else
  float ph = 0.0;
#endif
  float wave = sin(uTime * 1.9 + ph) + 0.4 * sin(uTime * 4.3 + ph * 2.1);
  float sw = ${mode === 'plante' ? '0.09 * sway' : '0.07 * position.y * position.y'} * wave;
  transformed.x += sw;
  transformed.z += sw * 0.6;
#ifdef USE_INSTANCING
${mode === 'plante' ? '  if (distance((modelMatrix * instanceMatrix[3]).xz, cameraPosition.xz) > uNear) transformed = vec3(0.0);' : ''}
${mode === 'imposteur' ? '  if (distance((modelMatrix * instanceMatrix[3]).xz, cameraPosition.xz) < (aCell.y > 0.5 ? uNearBig : uNear)) transformed = vec3(0.0);' : ''}
#endif`);
    if (mode === 'imposteur') shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
vMapUv = (vec2(mod(aCell.x, uGrid.x), floor(aCell.x / uGrid.x)) + uv) / uGrid;`);
  };
  mat.onBeforeCompile = (shader) => {
    vertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
// Au loin, les brins fins s'effacent dans les petites versions de la texture : on garde leur couverture.
diffuseColor.a *= 1.0 + 0.5 * clamp(log2(max(length(fwidth(vMapUv * 512.0)), 1.0)), 0.0, 4.0);`)
      // (une feuille vue de dos garde sa normale : elle est éclairée comme celles d'en face)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal *= faceDirection;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 sunV = normalize((viewMatrix * vec4(${sunDir.x.toFixed(4)}, ${sunDir.y.toFixed(4)}, ${sunDir.z.toFixed(4)}, 0.0)).xyz);
  float back = pow(max(dot(normalize(-vViewPosition), sunV), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.93, 0.75) * back * 1.4;
}`);
  };
  mat.customProgramCacheKey = () => `touffe-${mode}-${normalUp}`;
  if (mode === 'plante') {
    // L'ombre : la même plante, qui plie et disparaît de la même façon.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
    depth.onBeforeCompile = vertex;
    depth.customProgramCacheKey = () => 'touffe-ombre';
    mat.userData.depth = depth;
  }
  return mat;
}

// ---------- Placement ----------

// Les instances, par zones : des carrés (size m de côté), ou ce que dit `zone` (les plantes en 3D : des tronçons de piste).
// Une zone se dessine selon la distance de la caméra à son centre, moins son rayon.
class Tiles {
  constructor(size = TILE) { this.size = size; this.map = new Map(); }
  add(name, x, z, matrix, color, cell = null, zone = null) {
    const S = this.size, k = `${name}|${zone ?? `${Math.floor(x / S)}|${Math.floor(z / S)}`}`;
    let t = this.map.get(k);
    if (!t) this.map.set(k, (t = { name, matrices: [], colors: [], cells: [], xs: [], zs: [] }));
    t.matrices.push(matrix.clone());
    t.xs.push(x); t.zs.push(z);
    if (color) t.colors.push(color.clone());
    if (cell !== null) t.cells.push(...cell);
  }
  build(group, kinds) {
    this.meshes = [];
    for (const t of this.map.values()) {
      const kind = kinds[t.name];
      const cx = t.xs.reduce((a, b) => a + b, 0) / t.xs.length, cz = t.zs.reduce((a, b) => a + b, 0) / t.zs.length;
      const half = 2 + Math.max(...t.xs.map((x, i) => Math.hypot(x - cx, t.zs[i] - cz)));
      // (une version plus simple au loin, si la sorte en a une : kind.far, à partir de kind.lod mètres)
      const make = (geometry) => {
        if (t.cells.length) {
          geometry = geometry.clone();
          geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(t.cells), 2));
        }
        const mesh = new THREE.InstancedMesh(geometry, kind.material, t.matrices.length);
        t.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        if (t.colors.length) t.colors.forEach((c, i) => mesh.setColorAt(i, c));
        mesh.castShadow = !!kind.castShadow;
        mesh.receiveShadow = !!kind.receiveShadow;
        if (kind.material.userData.depth) mesh.customDepthMaterial = kind.material.userData.depth;
        mesh.computeBoundingSphere();
        mesh.name = t.name;
        group.add(mesh);
        return mesh;
      };
      this.meshes.push({ mesh: make(kind.geometry), far: kind.far ? make(kind.far) : null, lod: kind.lod ?? Infinity, cx, cz, range: kind.range ?? (kind.near ? 220 : 0), within: kind.within ?? null, beyond: kind.beyond ?? null, half });
    }
  }
}

export function createVegetation(track, forestAt, { sunDir = new THREE.Vector3(0, 1, 0), groundTextures = null, plants = {}, renderer = null, low = false } = {}) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rand = rng(track.seed + 404);
  const tiles = new Tiles(), nearTiles = new Tiles(TILE_NEAR);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  const bark = new THREE.MeshStandardMaterial({ color: lin('#4a3829'), roughness: 1 });
  const kinds = {};

  // ----- Le sous-bois : herbes, fleurs, fougères, le long de la piste et dans les prairies -----
  // La flore de la carte (env.flora) : 'epilobe' (Le Bike Park), 'maquis' (Le Single), sinon les Alpes.
  const flora = track.map.env.flora || null;
  const tuft = tuftGeometry();
  // Les plantes scannées : chaque variante en 3D de près (jusqu'à NEAR mètres, NEAR_BIG pour les grandes), et au loin
  // une carte, toutes espèces dans le même atlas (une seule instance par zone).
  const NEAR = { value: low ? 16 : 22 }, NEAR_BIG = { value: low ? 24 : 36 };
  const species = {};
  let atlas = null;
  for (const name of floraSpecies(flora)) if (plants[name] && renderer) species[name] = plants[name];
  if (Object.keys(species).length) {
    atlas = bakeImpostors(renderer, Object.values(species));
    for (const [name, sp] of Object.entries(species)) {
      const big = !!SPECIES[name].big;
      const mat = windMaterial(sp.map, sunDir, { mode: 'plante', near: big ? NEAR_BIG : NEAR, normalUp: /herbe/.test(name) ? 0.85 : 0.45 });
      sp.variants.forEach((v, i) => { kinds[`${name}#${i}`] = { geometry: v.geometry, material: mat, within: big ? NEAR_BIG : NEAR, castShadow: !!SPECIES[name].shadow && !low }; });
    }
    kinds.imposteurs = { geometry: tuft, material: windMaterial(atlas.texture, sunDir, { mode: 'imposteur', near: NEAR, nearBig: NEAR_BIG, grid: new THREE.Vector2(atlas.cols, atlas.rows) }), near: true, beyond: NEAR };
  }
  // Les touffes dessinées : les fleurs de la carte qui n'ont pas de scan (épilobe, genêt, lavande), et de quoi remplacer
  // une espèce qui n'a pas pu se charger.
  const cards = { grass: () => drawGrass(false, flora === 'maquis' ? 0.6 : 0.16), fern: () => drawFern, epilobe: () => drawFireweed, genet: () => drawBroom, lavande: () => drawLavender, shrub: () => drawShrub };
  const cardKind = (name) => {
    if (!kinds[name]) kinds[name] = { geometry: tuft, material: windMaterial(cardTexture(cards[name]()), sunDir), near: true };
    return name;
  };
  const B = track.bounds;
  // Au hasard dans le rectangle de la piste, ou dans sa bande (les longues pistes).
  const anywhere = () => {
    if (track.band === null) return [B.xmin + rand() * (B.xmax - B.xmin), B.zmin + rand() * (B.zmax - B.zmin)];
    const f = track.sample(rand() * track.length), u = (rand() * 2 - 1) * track.band;
    return [f.x + u * f.rx, f.z + u * f.rz];
  };
  // Pas d'herbe sur la neige (le glacier, ou au-dessus de la limite des neiges), ni dans le village.
  const snowline = track.map.env.snowline ?? 1e5;
  const snowZones = track.surfaces.filter((z) => z.surface === 'neige');
  const nearHouse = (x, z, m) => track.buildings.some((b) => Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) / 2 + m);
  const bare = (x, z, near) => {
    if (snowZones.length && track.trailDist(x, z) < 110 && snowZones.some((zz) => { const ss = track.trailS(x, z); return ss > zz.a - 20 && ss < zz.b + 20; })) return true;
    if (track.groundY(x, z) > snowline - 40) return true;
    if (track.village && Number.isFinite(near.dist) && near.s > track.village.a - 4 && near.s < track.village.b && near.dist < 5) return true;
    // (une place pavée : rien ne pousse, jusqu'au bout du quai)
    if (track.village && track.village.plaza != null && track.trailDist(x, z) < 45 && track.trailS(x, z) > track.village.plaza) return true;
    return track.buildings.length > 0 && nearHouse(x, z, 1);
  };
  // Une piste plus longue a plus de sous-bois (la même densité le long de la piste).
  const more = track.length > 1000 ? track.length / 884 : 1;
  const treeline = track.map.env.treeline ?? null;
  const DRY = new THREE.Color(1.12, 0.98, 0.6), dryTint = new THREE.Color();
  // Le bord de ce qui se roule : la trace, ou la dalle de roche (elle déborde de la trace de 2 m).
  const slabs = track.features.filter((f) => f.type === 'slab');
  const edgeAt = (ss) => track.trailHalfAt(ss) + (slabs.some((f) => ss > f.a - 2 && ss < f.b + 2) ? 2.4 : 0.3);
  let placed = 0;
  const counts = {};
  for (let k = 0; k < (low ? 90000 : 200000) * more && placed < (low ? 26000 : 56000) * more; k++) {
    // Surtout près de la piste : c'est là qu'on regarde.
    let x, z;
    if (rand() < 0.75) {
      const ss = rand() * track.length, f = track.sample(ss);
      const side = rand() < 0.5 ? -1 : 1;
      const u = side * (track.trailHalfAt(ss) + 0.5 + Math.pow(rand(), 1.6) * 26);
      x = f.x + u * f.rx; z = f.z + u * f.rz;
    } else [x, z] = anywhere();
    const near = track.nearest(x, z, null, 0, 3);
    if (near.inside && near.dist < track.trailHalfAt(near.s) + 0.4) continue; // (jusqu'au bord de la trace, même étroite)
    if (bare(x, z, near)) continue;
    const forest = forestAt(x, z);
    const n = fbm(x / 9, z / 9, 2, 31) * 0.5 + 0.5, r = rand();
    const y = track.groundY(x, z);
    // (en altitude, l'herbe des Alpes devient rase et sèche)
    const alpine = treeline !== null && flora === null && y > treeline - 60 + rand() * 80;
    let kind;
    if (flora === 'maquis') {
      // Le maquis : sous les pins, des buissons et des bruyères ; au soleil, l'herbe sèche, le genêt et la lavande par
      // plaques, des fleurs jaunes et orange.
      if (forest > 0.45) { if (r > 0.85) continue; kind = r < 0.3 ? 'myrte' : r < 0.55 ? 'bruyere' : 'herbe-seche'; }
      else if (n > 0.6) kind = r < 0.35 ? 'genet' : r < 0.7 ? 'lavande' : r < 0.85 ? 'gazania' : 'empodium';
      else kind = r < 0.14 ? 'myrte' : r < 0.32 ? 'bruyere' : 'herbe-seche';
    } else if (flora === 'epilobe') {
      // La côte Pacifique : un sous-bois de fougères et d'arbrisseaux ; dans la piste de ski, des nappes d'épilobes.
      if (forest > 0.45) { if (r > 0.65) continue; kind = r < 0.32 ? 'fougere' : r < 0.45 ? 'arbrisseau' : r < 0.55 ? 'myrtille' : 'oseille'; }
      else if (n > 0.6 && r < 0.3) kind = 'epilobe';
      else kind = r < 0.08 ? 'fougere' : r < 0.14 ? 'arbrisseau' : r < 0.2 ? 'pissenlit' : 'herbe';
    } else if (forest > 0.45) {
      // La forêt des Alpes : des fougères, de l'oseille des bois, des orties et des bardanes au bord des clairières.
      if (r > 0.7) continue;
      kind = r < 0.42 ? 'fougere' : r < 0.52 ? 'oseille' : r < 0.57 ? 'ortie' : r < 0.62 ? 'bardane' : 'herbe';
    } else if (n > 0.62 && r < 0.5) kind = alpine ? (r < 0.25 ? 'empodium' : 'pissenlit') : r < 0.2 ? 'pissenlit' : r < 0.35 ? 'ficaire' : 'empodium';
    else kind = alpine ? (r < 0.55 ? 'herbe-seche' : 'herbe') : r < 0.06 ? 'fougere' : r < 0.09 ? 'bardane' : 'herbe';
    // (une espèce sans scan chargé : une touffe dessinée)
    const sp = species[kind];
    if (!sp && SPECIES[kind]) kind = cardKind(kind === 'fougere' ? 'fern' : SPECIES[kind].big ? 'shrub' : 'grass');
    else if (!sp) cardKind(kind);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    col.setScalar(0.8 + rand() * 0.35);
    // En altitude, l'herbe est rase et jaunie ; sous les arbres, plus sombre.
    if (treeline !== null) col.multiply(dryTint.setRGB(1, 1, 1).lerp(DRY, smoothstep(treeline - 80, treeline + 30, y)));
    col.multiplyScalar(1 - 0.3 * forest);
    if (sp) {
      // Les petites plantes poussent en touffes : quelques pieds autour du premier.
      const clump = SPECIES[kind].big ? 1 : 2 + Math.floor(rand() * 4);
      let x1 = x, z1 = z, y1 = y;
      for (let j = 0; j < clump; j++) {
        const v = Math.floor(rand() * sp.variants.length), V = sp.variants[v], [a, b] = SPECIES[kind].scale;
        const size = (a + rand() * (b - a)) * (kind === 'herbe' ? 0.8 + 0.4 * (1 - forest) : 1);
        if (j) {
          const ang = rand() * Math.PI * 2, d = (0.3 + rand() * 0.5) * V.w * size;
          x1 = x + Math.cos(ang) * d; z1 = z + Math.sin(ang) * d; y1 = track.groundY(x1, z1);
        }
        // Une plante large, à hauteur de guidon : derrière la rubalise, pas dans la figure du pilote ; les autres
        // débordent au plus jusqu'au bord de la trace.
        const reach = (V.w * size) / 2, nr = j ? track.nearest(x1, z1, null, 0, 3) : near;
        if (Number.isFinite(nr.dist) && nr.dist < (SPECIES[kind].wide ? track.tapeAt(nr.s) + 0.3 + reach : edgeAt(nr.s) + reach * 0.5)) continue;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        p.set(x1, y1 - 0.02, z1);
        // (de près, par tronçons de 20 m de piste : c'est le long de la piste qu'elles sont ; plus loin, par carrés. Un
        // tronçon se dessine en entier dès qu'il approche : plus il est court, moins on calcule de plantes pour rien)
        nearTiles.add(`${kind}#${v}`, x1, z1, m4.compose(p, q, s.setScalar(size)), col, null, nr.dist < 25 ? `s${Math.floor(nr.s / 20)}` : null);
        tiles.add('imposteurs', x1, z1, m4.compose(p, q, s.set(V.w * size, V.h * size, V.w * size)), col, [V.cell, SPECIES[kind].big ? 1 : 0]);
        counts[kind] = (counts[kind] || 0) + 1;
      }
    } else if (kind === 'epilobe') {
      // Les épilobes : des tiges seules, en touffes serrées, de 0,9 à 1,6 m.
      const n = 3 + Math.floor(rand() * 5);
      for (let j = 0; j < n; j++) {
        const x1 = x + (rand() - 0.5) * 1.2, z1 = z + (rand() - 0.5) * 1.2, h = 0.9 + rand() * 0.7;
        const nr = j ? track.nearest(x1, z1, null, 0, 3) : near;
        if (Number.isFinite(nr.dist) && nr.dist < track.trailHalfAt(nr.s) + 0.5) continue;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        tiles.add(kind, x1, z1, m4.compose(p.set(x1, track.groundY(x1, z1) - 0.03, z1), q, s.set(h * 0.42, h, h * 0.42)), col);
      }
    } else {
      const big = kind === 'fern' || kind === 'shrub' || kind === 'genet';
      const size = kind === 'epilobe' ? 0.9 + rand() * 0.7 : big ? 0.7 + rand() * 0.6 : 0.35 + rand() * 0.45 + (1 - forest) * 0.15;
      if ((kind === 'shrub' || kind === 'genet') && Number.isFinite(near.dist) && near.dist < track.tapeAt(near.s) + 0.3 + size * 0.75) continue;
      tiles.add(kind, x, z, m4.compose(p.set(x, y - 0.03, z), q, s.set(size * (big ? 1.5 : 1.2), size, size * (big ? 1.5 : 1.2))), col);
    }
    placed++;
  }
  const winds = [...new Set(Object.values(kinds).map((k) => k.material))];

  // ----- Les rochers et les troncs couchés -----
  const rockMat = rockMaterial(groundTextures, { moss: flora === 'maquis' ? 0.1 : treeline === null ? 0.55 : 0.35, alpine: treeline !== null });
  const ROCKS = ['rockA', 'rockB', 'rockC', 'rockD'];
  ROCKS.forEach((name, i) => { kinds[name] = { geometry: rockGeometry(i + 1, { detail: 2, cuts: 5 + i }), far: rockGeometry(i + 1, { detail: 1, cuts: 5 + i }), lod: 120, material: rockMat, castShadow: true, receiveShadow: true, range: 900 }; });
  const rockCount = Math.round(1400 * more * (treeline === null ? 1 : 1.8));
  for (let k = 0; k < rockCount; k++) {
    let x, z;
    if (rand() < 0.7) {
      const ss = rand() * track.length, f = track.sample(ss), side = rand() < 0.5 ? -1 : 1;
      const u = side * (TRAIL_HALF + 1.4 + rand() * 14);
      x = f.x + u * f.rx; z = f.z + u * f.rz;
    } else [x, z] = anywhere();
    const near = track.nearest(x, z, null, 0, 3);
    if (near.inside && near.dist < Math.max(track.trailHalfAt(near.s) + 1.2, track.tapeAt(near.s) + 0.3)) continue;
    if (track.buildings.length && nearHouse(x, z, 2)) continue;
    if (track.map.scenery === 'ville' && track.trailDist(x, z) < 45) continue; // (pas de rochers dans les rues ni sur le quai)
    if (track.band !== null && Number.isFinite(near.dist) && near.dist < track.tapeAt(near.s) + 1.5) continue; // (le couloir du glacier)
    if (snowZones.length && track.trailDist(x, z) < 110 && snowZones.some((zz) => { const ss = track.trailS(x, z); return ss > zz.a - 20 && ss < zz.b + 10; })) continue; // (pas de cailloux sur la neige)
    if (track.treeNear(x, z, 0.6)) continue;
    let r = 0.15 + Math.pow(rand(), 2.5) * 1.3;
    const y = track.groundY(x, z);
    if (treeline !== null) {
      // L'alpage : des blocs de granit éboulés, parfois énormes ; jamais sur la piste.
      r *= 1 + 1.3 * smoothstep(treeline - 20, treeline + 20, y);
      if (near.inside) r = Math.min(r, Math.max(0.15, (near.dist - TRAIL_HALF - 0.8) * 0.9));
    }
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 6.3, (rand() - 0.5) * 0.4));
    tiles.add(ROCKS[Math.floor(rand() * ROCKS.length)], x, z, m4.compose(p.set(x, y - r * 0.25, z), q, s.set(r * (1 + rand() * 0.6), r, r * (1 + rand() * 0.4))));
  }
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  logGeo.rotateZ(Math.PI / 2);
  kinds.log = { geometry: logGeo, material: bark, castShadow: true, receiveShadow: true };
  for (let k = 0; k < 220 * more; k++) {
    const [x, z] = anywhere();
    const near = track.nearest(x, z, null, 0, 3);
    if (near.dist < 7 || forestAt(x, z) < 0.3) continue;
    const len = 3 + rand() * 6, r = 0.12 + rand() * 0.15;
    q.setFromEuler(new THREE.Euler(0, rand() * 6.3, (rand() - 0.5) * 0.15));
    tiles.add('log', x, z, m4.compose(p.set(x, track.groundY(x, z) + r * 0.6, z), q, s.set(len, r, r)));
  }

  tiles.build(group, kinds);
  nearTiles.build(group, kinds);
  const all = [...tiles.meshes, ...nearTiles.meshes];
  return {
    group,
    /** Les plantes en 3D jusqu'à cette distance (m), en cartes au-delà ; combien de pieds de chaque espèce. */
    near: NEAR,
    counts,
    atlas,
    update(t, camera) {
      for (const m of winds) m.userData.time.value = t;
      if (!camera) return;
      const cx = camera.position.x, cz = camera.position.z;
      for (const e of all) {
        const d = Math.hypot(e.cx - cx, e.cz - cz);
        // (within : les plantes en 3D, que de près ; les cartes des plantes, pas dans une zone toute proche)
        const shown = (!e.range || d < e.range + e.half) && (!e.within || d < e.within.value + e.half) && (!e.beyond || d > e.beyond.value - e.half);
        e.mesh.visible = shown && d < e.lod + e.half;
        if (e.far) e.far.visible = shown && d >= e.lod + e.half;
      }
    },
  };
}
