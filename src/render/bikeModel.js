// Le vélo affiché : le modèle 3D fourni (public/models/bike.glb, préparé par tools/prepare-bike.mjs), découpé en
// pièces mobiles, et le pilote. Tant que le modèle charge (ou s'il manque), un vélo fait de formes simples le remplace.
//
// Pièces mobiles : la direction (cintre, fourche) tourne autour de l'axe de direction, les fourreaux de fourche
// coulissent avec la roue avant, les deux roues tournent et suivent leur suspension.
// Repère : celui du vélo (voir src/sim/geometry.js) : origine au sol entre les roues, -z vers l'avant.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GEOMETRY } from '../sim/geometry.js';
import { createRider } from './rider.js';

const G = GEOMETRY;
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

/** Un vélo de remplacement en formes simples, avec les mêmes pièces que le modèle. */
function placeholderBike() {
  const root = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: lin('#1c1c1f'), roughness: 0.5, metalness: 0.3 });
  const tireMat = new THREE.MeshStandardMaterial({ color: lin('#202020'), roughness: 0.95 });
  const goldMat = new THREE.MeshStandardMaterial({ color: lin('#c9a24a'), roughness: 0.3, metalness: 0.8 });
  const tube = (a, b, r, mat, parent) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true;
    parent.add(m);
  };
  const wheel = (r) => {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.TorusGeometry(r - 0.035, 0.035, 10, 40), tireMat);
    t.rotation.y = Math.PI / 2;
    t.castShadow = true;
    g.add(t);
    return g;
  };
  const cadre = new THREE.Group(); cadre.name = 'cadre';
  const bb = [0, G.bottomBracket.y, G.bottomBracket.z], head = [0, G.steerPivot.y - 0.05, G.steerPivot.z + 0.02];
  tube(bb, head, 0.035, frameMat, cadre);
  tube(bb, [0, 0.9, 0.3], 0.03, frameMat, cadre);
  tube([0, 0.9, 0.3], head, 0.028, frameMat, cadre);
  tube(bb, [0, G.rearAxle.y, G.rearAxle.z], 0.022, frameMat, cadre);
  tube([0, 0.85, 0.32], [0, G.rearAxle.y, G.rearAxle.z], 0.018, frameMat, cadre);
  root.add(cadre);
  const bras = new THREE.Group(); bras.name = 'bras';
  bras.position.set(0, G.swingPivot.y, G.swingPivot.z);
  root.add(bras);
  const roueArriere = wheel(G.rearRadius); roueArriere.name = 'roueArriere';
  roueArriere.position.set(0, G.rearAxle.y - G.swingPivot.y, G.rearAxle.z - G.swingPivot.z);
  bras.add(roueArriere);
  const direction = new THREE.Group(); direction.name = 'direction';
  direction.position.set(0, G.steerPivot.y, G.steerPivot.z);
  root.add(direction);
  const fourreaux = new THREE.Group(); fourreaux.name = 'fourreaux';
  fourreaux.position.set(0, G.frontAxle.y - G.steerPivot.y, G.frontAxle.z - G.steerPivot.z);
  direction.add(fourreaux);
  const roueAvant = wheel(G.frontRadius); roueAvant.name = 'roueAvant';
  fourreaux.add(roueAvant);
  for (const s of [-1, 1]) tube([s * 0.06, 0, 0], [s * 0.06, -fourreaux.position.y - 0.25, -fourreaux.position.z + 0.0], 0.02, goldMat, fourreaux);
  tube([-G.grips.barEnd, 0.06, 0.04], [G.grips.barEnd, 0.06, 0.04], 0.016, frameMat, direction);
  return root;
}

// Les modèles chargés une fois pour toutes (chaque vélo en fait une copie qui partage maillages et textures).
const models = new Map();
function loadModel(file) {
  if (!models.has(file)) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    models.set(file, loader.loadAsync(`${import.meta.env ? import.meta.env.BASE_URL : '/'}models/${file}`).then((g) => g.scene));
  }
  return models.get(file).then((scene) => scene.clone(true));
}

/**
 * ghost : un vélo translucide (le fantôme du record). lod : le vélo allégé de près et le vélo en formes simples au
 * loin (les rivaux du peloton, voir setNear). kit, number, stance : la tenue, le dossard et le pied devant du pilote.
 */
export function createBikeModel({ ghost = false, lod = false, kit, number = null, stance = 1 } = {}) {
  const group = new THREE.Group();
  group.name = ghost ? 'fantome' : lod ? 'rival' : 'velo';
  const rider = createRider({ detailedArms: !ghost && !lod, kit, number, stance });
  group.add(rider.group);
  const ghostMat = new THREE.MeshStandardMaterial({ color: lin('#9fd6ff'), emissive: lin('#2a6ea8'), transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.5 });
  const ghostify = (o) => o.traverse((m) => { if (m.isMesh) { m.material = ghostMat; m.castShadow = false; m.receiveShadow = false; } });

  // Un vélo et ses pièces mobiles.
  const variant = (root) => {
    const get = (n) => root.getObjectByName(n);
    const parts = { root, bras: get('bras'), direction: get('direction'), fourreaux: get('fourreaux'), roueAvant: get('roueAvant'), roueArriere: get('roueArriere') };
    parts.forkRest = parts.fourreaux.position.clone();
    // Le bras oscillant tourne autour de son pivot : la roue arrière monte en décrivant un arc.
    parts.armLength = parts.roueArriere.position.length();
    return parts;
  };
  const simple = variant(placeholderBike());
  group.add(simple.root);
  let detailed = null, near = true;
  const active = () => (detailed && (near || !lod) ? detailed : simple);
  if (ghost) ghostify(group);

  const ready = loadModel(lod ? 'bike-lod.glb' : 'bike.glb').then((model) => {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = !lod;
      if (o.material && !lod) { o.material.envMapIntensity = 1; o.material.side = THREE.FrontSide; }
    });
    if (ghost) ghostify(model);
    detailed = variant(model);
    group.add(model);
    return true;
  }).catch((e) => { console.warn('Modèle du vélo indisponible, vélo de remplacement :', e.message); return false; });

  const steerAxis = new THREE.Vector3(G.forkAxis.x, G.forkAxis.y, G.forkAxis.z).normalize();
  const Z = new THREE.Vector3(0, 0, 1), qLean = new THREE.Quaternion(), tmp = new THREE.Vector3();
  return {
    group,
    rider,
    ready,
    get eye() { return rider.eye; },
    /** Les rivaux : le vélo détaillé de près, en formes simples au loin (et le pilote sans ses petits détails). */
    setNear(v) {
      if (v === near) return;
      near = v;
      rider.setDetail(v);
    },
    /** style : { q, pivot }, le vélo seul tourné autour des hanches en l'air (voir rider.js), ou null. */
    update(state, dt, firstPerson, style = null) {
      group.position.copy(state.position);
      group.quaternion.copy(state.quaternion);
      // Arrêté, pied gauche à terre : le vélo penche un peu de ce côté (autour de la ligne des roues, qui restent au sol).
      if (rider.footDown > 0.001) group.quaternion.multiply(qLean.setFromAxisAngle(Z, rider.footDown * 0.09));
      const P = active();
      if (detailed) detailed.root.visible = P === detailed;
      simple.root.visible = P === simple;
      if (style) {
        P.root.quaternion.copy(style.q);
        P.root.position.copy(style.pivot).sub(tmp.copy(style.pivot).applyQuaternion(style.q));
      } else if (P.root.position.lengthSq() || P.root.quaternion.w < 1) {
        P.root.position.set(0, 0, 0);
        P.root.quaternion.set(0, 0, 0, 1);
      }
      const [wf, wr] = state.wheels;
      // La direction tourne autour de son axe (braquer à droite : rotation négative autour de l'axe, qui monte).
      P.direction.quaternion.setFromAxisAngle(steerAxis, -state.steer);
      // Les fourreaux et la roue avant remontent le long de la fourche quand elle s'enfonce.
      P.fourreaux.position.copy(P.forkRest).addScaledVector(steerAxis, wf.contact ? wf.x : 0);
      P.bras.rotation.x = -Math.asin(THREE.MathUtils.clamp((wr.contact ? wr.x : 0) / P.armLength, -1, 1));
      // Les roues tournent (vers l'avant : le haut de la roue part vers -z).
      P.roueAvant.rotation.x = -wf.spinAngle;
      P.roueArriere.rotation.x = -wr.spinAngle;
      rider.update(state, dt, firstPerson, style);
    },
  };
}
