// La forêt : des arbres générés par EZ-Tree (github.com/dgreenheck/ez-tree, MIT ; écorces CC0 de TextureCan et
// Poly Haven), allégés, puis dessinés en instances.
// - Quelques variantes (sapins, feuillus), générées au lancement à une hauteur de 1 : chaque arbre de la piste en
//   prend une, à sa taille, tournée et teintée au hasard.
// - Près du pilote (et devant lui), le vrai modèle, avec ses ombres ; un peu plus loin, le même arbre au feuillage
//   allégé (une feuille sur trois, agrandie) ; au-delà, un imposteur : deux plans croisés portant la photo de la
//   variante, prise au lancement. Les listes sont refaites à chaque image (2 000 à 3 000
//   arbres : c'est très rapide), ce qui garde un seul appel de dessin par variante.
// - En montagne, sur le relief lointain, des milliers d'imposteurs fixes, là où ce relief est boisé.

import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { rng, fbm, smoothstep } from '../sim/noise.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// Les variantes de chaque essence : un modèle EZ-Tree, une graine, et ses retouches (opts : la forme de l'essence).
const VARIANTS = {
  sapin: [
    { preset: 'Pine Medium', seed: 13977 },
    { preset: 'Pine Medium', seed: 4201 },
    { preset: 'Pine Medium', seed: 77031 },
    { preset: 'Pine Large', seed: 23015 },
    { preset: 'Pine Large', seed: 9150 },
  ],
  feuillu: [
    { preset: 'Oak Medium', seed: 3109 },
    { preset: 'Ash Medium', seed: 5512 },
    { preset: 'Ash Medium', seed: 61 },
  ],
  // La forêt de la côte Pacifique (Le Bike Park) : douglas et pruches, très hauts, sombres, au houppier étroit et
  // pointu, branches basses retombantes.
  douglas: [
    { preset: 'Pine Large', seed: 31337, opts: (o) => { o.branch.length[1] *= 0.5; o.branch.children[0] = 130; o.branch.start[1] = 0.2; } },
    { preset: 'Pine Large', seed: 8086, opts: (o) => { o.branch.length[1] *= 0.45; o.branch.children[0] = 120; o.branch.start[1] = 0.25; } },
    { preset: 'Pine Medium', seed: 2718, opts: (o) => { o.branch.length[1] *= 0.55; o.branch.children[0] = 110; o.branch.start[1] = 0.18; } },
  ],
  // La Riviera (Le Single) : le pin maritime, un long fût nu et penché, le houppier tout en haut, étalé en parasol.
  pin: [
    { preset: 'Pine Medium', seed: 1607, opts: pinMaritime(0.62, 0.12) },
    { preset: 'Pine Medium', seed: 4410, opts: pinMaritime(0.55, 0.18) },
    { preset: 'Pine Medium', seed: 9021, opts: pinMaritime(0.68, 0.08) },
  ],
  // Le chêne vert : bas, trapu, un houppier rond et dense, de petites feuilles vert sombre.
  chene: [
    { preset: 'Oak Small', seed: 512, opts: chenevert(1) },
    { preset: 'Oak Medium', seed: 77, opts: chenevert(0.8) },
    { preset: 'Oak Small', seed: 3141, opts: chenevert(1.2) },
  ],
  // L'olivier des terrasses : un tronc court et tordu, des feuilles étroites, gris argenté.
  olivier: [
    { preset: 'Oak Small', seed: 4242, opts: olivier(0.35) },
    { preset: 'Oak Small', seed: 1789, opts: olivier(0.5) },
  ],
};

function pinMaritime(start, lean) {
  return (o) => {
    o.branch.levels = 2;
    o.branch.start[1] = start; // le fût nu, jusqu'aux deux tiers
    o.branch.children[0] = 30;
    o.branch.angle[1] = 66; // les charpentières montent en s'écartant
    o.branch.length[1] = 34;
    o.branch.radius[1] = 0.45;
    o.branch.gnarliness[0] = lean; // un fût qui ondule
    o.branch.gnarliness[1] = 0.18;
    o.branch.children[1] = 4;
    o.branch.angle[2] = 48;
    o.branch.length[2] = 9;
    o.branch.start[2] = 0.35;
    o.branch.force.strength = 0.012;
    o.leaves.count = 18;
    o.leaves.size = 2.7;
    o.leaves.angle = 30;
    o.leaves.start = 0.2;
  };
}

function chenevert(spread) {
  return (o) => {
    o.branch.start[1] = 0.28;
    o.branch.length[0] *= 0.75;
    o.branch.length[1] *= spread;
    o.branch.children[0] = 7;
    o.leaves.count = 24;
    o.leaves.size *= 0.85;
    o.leaves.tint = 0xffffff;
  };
}

function olivier(twist) {
  return (o) => {
    o.branch.length[0] = 16;
    o.branch.gnarliness[0] = 0.32;
    o.branch.twist[0] = twist;
    o.branch.radius[0] = 1.5;
    o.branch.start[1] = 0.32;
    o.branch.children[0] = 5;
    o.branch.angle[1] = 42;
    o.branch.gnarliness[1] = 0.25;
    o.leaves.type = 'ash'; // (des folioles étroites, comme les feuilles de l'olivier)
    o.leaves.count = 26;
    o.leaves.size *= 1.1;
    o.leaves.tint = 0xffffff;
  };
}

// L'allure de chaque essence : la teinte des feuilles et de l'écorce, combien de feuilles on garde (et de combien on les
// agrandit), la hauteur par rapport à celle que donne la piste, le vent, et la hauteur des arbres du relief lointain.
const LOOKS = {
  sapin: { leaf: '#dbe6c8', keep: 0.85, grow: 1.3, height: 1, wind: 0.008, far: 13 },
  feuillu: { leaf: '#e2ead0', keep: 0.6, grow: 1.22, height: 0.8, wind: 0.012, far: 10 },
  douglas: { leaf: '#93ad88', bark: '#b3a497', keep: 0.85, grow: 1.3, height: 1, wind: 0.006, far: 28 },
  pin: { leaf: '#d9e0b4', bark: '#c9a98e', keep: 0.75, grow: 1.25, height: 1, wind: 0.01, far: 14 },
  chene: { leaf: '#9fac84', bark: '#a8a49c', keep: 0.7, grow: 1.15, height: 1, wind: 0.01, far: 8 },
  olivier: { leaf: '#c3cdb4', bark: '#b5ad9f', keep: 0.7, grow: 1.1, height: 1, wind: 0.012, far: 6 },
};
const lookOf = (kind) => LOOKS[kind] || LOOKS.sapin;

function generate(v, kind, low) {
  const tree = new Tree();
  tree.loadPreset(v.preset);
  const o = tree.options;
  o.seed = v.seed;
  if (v.opts) v.opts(o);
  // Moins de facettes sur les branches : on ne les voit jamais de près, et il y a des centaines d'arbres.
  for (let l = 1; l <= 3; l++) {
    o.branch.sections[l] = Math.max(3, Math.round(o.branch.sections[l] * 0.5));
    o.branch.segments[l] = Math.max(3, Math.round(o.branch.segments[l] * 0.66));
  }
  o.branch.segments[0] = Math.min(o.branch.segments[0], 8);
  // Moins de feuilles, plus grandes : presque le même volume pour moins de triangles. Les conifères en gardent plus :
  // c'est leur masse d'aiguilles qui les rend vivants (sinon on ne voit que des branches nues).
  const L = lookOf(kind);
  o.leaves.count = Math.max(4, Math.round(o.leaves.count * L.keep * (low ? 0.7 : 1)));
  o.leaves.size *= L.grow;
  tree.generate();
  return tree;
}

/** Ramène une géométrie à une hauteur de 1, pied à l'origine. */
function normalize(geometries) {
  const box = new THREE.Box3();
  for (const g of geometries) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const h = box.max.y - box.min.y;
  const m = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h).multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
  for (const g of geometries) { g.applyMatrix4(m); g.computeBoundingSphere(); }
  return { width: (box.max.x - box.min.x) / h, depth: (box.max.z - box.min.z) / h };
}

// Le vent : le haut de l'arbre balance, chaque arbre à son rythme (sa position fait la phase).
function addWind(mat, uniforms, amount) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
        #else
          float ph = 0.0;
        #endif
        float h2 = transformed.y * transformed.y;
        float sway = (sin(uTime * 1.1 + ph) + 0.35 * sin(uTime * 2.7 + ph * 1.7)) * ${amount.toFixed(4)} * h2;
        float flutter = sin(uTime * 7.0 + ph + transformed.x * 40.0 + transformed.z * 33.0) * ${(amount * 0.25).toFixed(4)} * h2;
        transformed.x += sway + flutter;
        transformed.z += sway * 0.6 - flutter;`);
  };
  mat.customProgramCacheKey = () => `vent-${amount}`;
}

// Les normales du feuillage : vers l'extérieur de la couronne, pas celles des petits plans des feuilles. La lumière
// tombe alors sur une masse, comme sur un vrai arbre, au lieu de scintiller feuille par feuille.
function foliageNormals(g) {
  const p = g.attributes.position;
  const n = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), (p.getY(i) - 0.55) * 0.7 + 0.35, p.getZ(i)).normalize();
    n.set([v.x, v.y, v.z], i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

/**
 * Le feuillage allégé, pour la distance moyenne : une feuille sur `keep` (chaque feuille d'EZ-Tree est un double panneau,
 * 8 sommets et 12 indices), agrandie autour de son point d'attache pour garder le même volume. La silhouette ne
 * change pas : ce sont les mêmes feuilles, moins nombreuses.
 */
function thinLeaves(geo, keep) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  const leaves = p.count / 8, kept = Math.ceil(leaves / keep), grow = Math.sqrt(keep) * 0.92;
  const pos = new Float32Array(kept * 24), nrm = new Float32Array(kept * 24), uvs = new Float32Array(kept * 16), idx = [];
  let o = 0;
  for (let l = 0; l < leaves; l += keep, o++) {
    const b = l * 8;
    // Le point d'attache : le milieu du bas du premier panneau (sommets 1 et 2).
    const ax = (p.getX(b + 1) + p.getX(b + 2)) / 2, ay = (p.getY(b + 1) + p.getY(b + 2)) / 2, az = (p.getZ(b + 1) + p.getZ(b + 2)) / 2;
    for (let v = 0; v < 8; v++) {
      const i = o * 8 + v;
      pos[i * 3] = ax + (p.getX(b + v) - ax) * grow;
      pos[i * 3 + 1] = ay + (p.getY(b + v) - ay) * grow;
      pos[i * 3 + 2] = az + (p.getZ(b + v) - az) * grow;
      nrm[i * 3] = n.getX(b + v); nrm[i * 3 + 1] = n.getY(b + v); nrm[i * 3 + 2] = n.getZ(b + v);
      uvs[i * 2] = uv.getX(b + v); uvs[i * 2 + 1] = uv.getY(b + v);
    }
    const g = o * 8;
    idx.push(g, g + 1, g + 2, g, g + 2, g + 3, g + 4, g + 5, g + 6, g + 4, g + 6, g + 7);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** La photo d'une variante, de face, sur fond transparent : la texture de son imposteur. */
function captureImpostor(renderer, bark, leaves, size) {
  const W = 256, H = 512;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(0.3, 1, 0.6); scene.add(key);
  const b = new THREE.Mesh(bark.geometry, bark.material), l = new THREE.Mesh(leaves.geometry, leaves.material);
  scene.add(b, l);
  const half = Math.max(size.width, size.depth) * 0.5 * 1.04;
  const cam = new THREE.OrthographicCamera(-half, half, 1.02, -0.01, -10, 10);
  cam.position.set(0, 0, 2); cam.lookAt(0, 0, 0);
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), tone: renderer.toneMapping };
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x2f4a2a, 0); // fond transparent, teinte proche du feuillage (pas de liseré clair)
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.color, prev.alpha);
  renderer.toneMapping = prev.tone;
  return { texture: rt.texture, halfWidth: half };
}

/** Deux plans croisés, pied à l'origine, de hauteur 1. */
function impostorGeometry(halfWidth) {
  const parts = [0, Math.PI / 2].map((a) => {
    const g = new THREE.PlaneGeometry(halfWidth * 2, 1.03);
    g.translate(0, 0.505, 0);
    g.rotateY(a);
    return g;
  });
  const pos = [], uv = [], nrm = [], idx = [];
  let base = 0;
  for (const g of parts) {
    pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array);
    for (let i = 0; i < g.attributes.position.count; i++) nrm.push(0, 1, 0); // lumière douce, comme une masse de feuillage
    idx.push(...Array.from(g.index.array, (k) => k + base));
    base += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Une variante prête à dessiner : géométries ramenées à une hauteur de 1, matériaux de l'écorce et des feuilles. */
export function buildVariant(v, kind, low, uniforms) {
  const tree = generate(v, kind, low);
  const L = lookOf(kind);
  const barkGeo = tree.branchesMesh.geometry, leafGeo = tree.leavesMesh.geometry;
  const size = normalize([barkGeo, leafGeo]);
  foliageNormals(leafGeo);
  const src = tree.branchesMesh.material, srcLeaf = tree.leavesMesh.material;
  const barkMat = new THREE.MeshStandardMaterial({
    map: src.map, normalMap: src.normalMap, aoMap: src.aoMap, roughnessMap: src.roughnessMap, roughness: 1, color: lin(L.bark || '#cfc4b6'),
  });
  addWind(barkMat, uniforms, 0.006);
  const leafMat = new THREE.MeshStandardMaterial({ map: srcLeaf.map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85, color: lin(L.leaf) });
  addWind(leafMat, uniforms, L.wind);
  const midLeafGeo = thinLeaves(leafGeo, 3);
  return { kind, barkGeo, leafGeo, midLeafGeo, barkMat, leafMat, size, tris: (barkGeo.index.count + leafGeo.index.count) / 3, midTris: (barkGeo.index.count + midLeafGeo.index.count) / 3 };
}

/** Pour les essais : les variantes d'une essence. */
export const treeVariants = (kind) => VARIANTS[kind];

export function createForest(track, renderer, { low = false } = {}) {
  const group = new THREE.Group();
  group.name = 'foret';
  const uniforms = { uTime: { value: 0 } };
  // (une piste bordée d'arbres serrés, en épingles, en a beaucoup à portée : elle peut rapprocher ces distances,
  // env.treeDetail)
  const detail = track.map.env.treeDetail || {};
  const NEAR = low ? 22 : detail.near ?? 35; // jusqu'où on dessine le vrai modèle
  const MID = low ? 45 : detail.mid ?? 70; // puis son feuillage allégé, jusqu'ici (au-delà, l'imposteur)
  const rand = rng(track.seed + 77);

  // ----- Les variantes (des seules essences de la piste) -----
  const kinds = {};
  const used = new Set(track.trees.map((t) => (VARIANTS[t.kind] ? t.kind : 'sapin')));
  for (const kind of used) kinds[kind] = VARIANTS[kind].map((v) => buildVariant(v, kind, low, uniforms));

  // ----- Chaque arbre de la piste : sa variante, sa taille, son orientation, sa teinte -----
  const trees = track.trees.map((t) => {
    const list = kinds[t.kind] || kinds.sapin;
    const variant = list[Math.floor(t.hue * 997) % list.length];
    const h = t.h * lookOf(t.kind).height;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rand() - 0.5) * 0.05));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y - 0.1, t.z), q, new THREE.Vector3(h, h, h));
    const v = 0.82 + rand() * 0.3;
    const color = new THREE.Color(v * (0.94 + t.hue * 0.12), v, v * (1.02 - t.hue * 0.1));
    return { x: t.x, z: t.z, variant, matrix: m, color };
  });
  const perVariant = new Map();
  for (const t of trees) { if (!perVariant.has(t.variant)) perVariant.set(t.variant, []); perVariant.get(t.variant).push(t); }

  // ----- Les arbres du relief lointain (même règle que sa teinte de forêt, voir ground.js) -----
  const env = track.map.env, farTrees = new Map();
  if (env.far) {
    const B = track.bounds, c = track.sample(track.length / 2), R = env.far.radius * 0.85, tl = env.treeline ?? 1e5;
    const all = Object.values(kinds).flat();
    for (let k = 0; k < (low ? 9000 : 22000); k++) {
      const x = c.x + (rand() * 2 - 1) * R, z = c.z + (rand() * 2 - 1) * R;
      if (Math.hypot(x - c.x, z - c.z) > R) continue;
      // (pas là où il y a déjà la vraie forêt : le rectangle de la piste, ou sa bande)
      if (track.band !== null ? track.trailDist(x, z) < track.band + 4 : x > B.xmin - 4 && x < B.xmax + 4 && z > B.zmin - 4 && z < B.zmax + 4) continue;
      const y = track.natural(x, z) - 1.2;
      if (env.sea && y < env.sea.level + 4) continue; // (pas dans la mer)
      const dens = (1 - smoothstep(tl - 30, tl + 5, y)) * smoothstep(0.3, 0.6, fbm(x / 160, z / 160, 3, 5) * 0.5 + 0.75);
      if (rand() > dens * 0.8) continue;
      const variant = all[Math.floor(rand() * all.length)];
      const h = lookOf(variant.kind).far * (0.7 + rand() * 0.6) * (1 - 0.4 * smoothstep(tl - 40, tl, y));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.3), new THREE.Vector3(h, h, h));
      if (!farTrees.has(variant)) farTrees.set(variant, []);
      farTrees.get(variant).push(m);
    }
  }

  // ----- Les instances : vrai modèle et imposteur, une paire par variante -----
  const slots = [];
  for (const [variant, list] of perVariant) {
    const bark = new THREE.InstancedMesh(variant.barkGeo, variant.barkMat, list.length);
    const leaves = new THREE.InstancedMesh(variant.leafGeo, variant.leafMat, list.length);
    const midBark = new THREE.InstancedMesh(variant.barkGeo, variant.barkMat, list.length);
    const midLeaves = new THREE.InstancedMesh(variant.midLeafGeo, variant.leafMat, list.length);
    for (const mesh of [bark, leaves, midBark, midLeaves]) {
      // (à mi-distance, pas d'ombre portée : elle tomberait hors de la zone nette, et coûterait autant que l'arbre)
      mesh.castShadow = mesh === bark || mesh === leaves;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // la liste suit la caméra
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
    }
    // L'imposteur est photographié quand les textures d'écorce et de feuilles sont chargées (elles arrivent après).
    const impMat = new THREE.MeshStandardMaterial({ alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    addWind(impMat, uniforms, 0.006);
    const half = Math.max(variant.size.width, variant.size.depth) * 0.5 * 1.04;
    const far = new THREE.InstancedMesh(impostorGeometry(half), impMat, list.length);
    far.frustumCulled = false;
    far.count = 0;
    far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(far);
    // Les imposteurs fixes du relief lointain.
    const distant = farTrees.get(variant);
    let fixed = null;
    if (distant) {
      fixed = new THREE.InstancedMesh(far.geometry, impMat, distant.length);
      distant.forEach((m, i) => fixed.setMatrixAt(i, m));
      fixed.computeBoundingSphere();
      fixed.visible = false;
      group.add(fixed);
    }
    // Les teintes, une fois pour toutes (dans l'ordre de la liste ; on recopie au besoin).
    const maps = [variant.barkMat.map, variant.leafMat.map].filter(Boolean);
    slots.push({
      list, bark, leaves, midBark, midLeaves, far, ready: false,
      tryCapture() {
        if (!maps.every((m) => m.image && m.image.width > 0)) return;
        impMat.map = captureImpostor(renderer, { geometry: variant.barkGeo, material: variant.barkMat }, { geometry: variant.leafGeo, material: variant.leafMat }, variant.size).texture;
        impMat.needsUpdate = true;
        this.ready = true;
        if (fixed) fixed.visible = true;
      },
    });
  }

  const tmpColor = new THREE.Color();
  const fwd = new THREE.Vector3(), last = { x: Infinity, z: 0, fx: 0, fz: 0 };
  let detailed = 0, mid = 0;
  return {
    group,
    get stats() { return { variants: slots.length, detailed, mid, trianglesPerTree: Object.values(kinds).flat().map((k) => Math.round(k.tris)), midTriangles: Object.values(kinds).flat().map((k) => Math.round(k.midTris)) }; },
    /**
     * Qui est dessiné en détail, qui en imposteur. Les listes ne sont refaites que si la caméra a bougé d'un mètre ou
     * tourné (à 50 km/h, une image sur quatre) : sur une piste de 10 000 arbres, c'est ce qui coûte le plus.
     */
    update(camera, t) {
      uniforms.uTime.value = t;
      camera.getWorldDirection(fwd);
      const cx = camera.position.x, cz = camera.position.z;
      const fx = fwd.x, fz = fwd.z, fl = Math.hypot(fx, fz) || 1;
      const turned = (fx * last.fx + fz * last.fz) / fl < 0.997;
      if (Math.hypot(cx - last.x, cz - last.z) < 1 && !turned && slots.every((s) => s.ready)) return;
      Object.assign(last, { x: cx, z: cz, fx: fx / fl, fz: fz / fl });
      detailed = 0; mid = 0;
      for (const s of slots) {
        if (!s.ready) s.tryCapture();
        let n = 0, nm = 0, nf = 0;
        for (const tr of s.list) {
          const dx = tr.x - cx, dz = tr.z - cz, d2 = dx * dx + dz * dz;
          const d = Math.sqrt(d2);
          // Derrière la caméra, seuls les arbres proches comptent (leurs ombres, et ce qu'on voit en tournant la tête).
          const ahead = (dx * fx + dz * fz) / fl;
          if (ahead < -Math.max(25, d * 0.15) && d > 25) continue;
          if (d < NEAR) {
            s.bark.setMatrixAt(n, tr.matrix); s.leaves.setMatrixAt(n, tr.matrix);
            s.bark.setColorAt(n, tmpColor.copy(tr.color)); s.leaves.setColorAt(n, tr.color);
            n++;
          } else if (d < MID) {
            s.midBark.setMatrixAt(nm, tr.matrix); s.midLeaves.setMatrixAt(nm, tr.matrix);
            s.midBark.setColorAt(nm, tmpColor.copy(tr.color)); s.midLeaves.setColorAt(nm, tr.color);
            nm++;
          } else {
            s.far.setMatrixAt(nf, tr.matrix); s.far.setColorAt(nf, tr.color);
            nf++;
          }
        }
        s.bark.count = s.leaves.count = n; s.midBark.count = s.midLeaves.count = nm;
        s.far.count = s.ready ? nf : 0;
        detailed += n; mid += nm;
        for (const m of [s.bark, s.leaves, s.midBark, s.midLeaves, s.far]) {
          m.instanceMatrix.needsUpdate = true;
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
        }
      }
    },
  };
}
