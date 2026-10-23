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

/** ghost : un vélo translucide (le fantôme du record). */
export function createBikeModel({ ghost = false } = {}) {
  const group = new THREE.Group();
  group.name = ghost ? 'fantome' : 'velo';
  let bike = placeholderBike();
  group.add(bike);
  const rider = createRider({ detailedArms: !ghost });
  group.add(rider.group);
  const ghostMat = new THREE.MeshStandardMaterial({ color: lin('#9fd6ff'), emissive: lin('#2a6ea8'), transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.5 });
  const ghostify = (o) => o.traverse((m) => { if (m.isMesh) { m.material = ghostMat; m.castShadow = false; m.receiveShadow = false; } });
  if (ghost) ghostify(group);

  let parts = null;
  const findParts = () => {
    const get = (n) => bike.getObjectByName(n);
    parts = { bras: get('bras'), direction: get('direction'), fourreaux: get('fourreaux'), roueAvant: get('roueAvant'), roueArriere: get('roueArriere') };
    parts.forkRest = parts.fourreaux.position.clone();
    // Le bras oscillant tourne autour de son pivot : la roue arrière monte en décrivant un arc.
    parts.armLength = parts.roueArriere.position.length();
  };
  findParts();

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ready = loader.loadAsync(`${import.meta.env ? import.meta.env.BASE_URL : '/'}models/bike.glb`).then((gltf) => {
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) { o.material.envMapIntensity = 1; o.material.side = THREE.FrontSide; }
    });
    group.remove(bike);
    bike = model;
    group.add(bike);
    if (ghost) ghostify(bike);
    findParts();
    return true;
  }).catch((e) => { console.warn('Modèle du vélo indisponible, vélo de remplacement :', e.message); return false; });

  const steerAxis = new THREE.Vector3(G.forkAxis.x, G.forkAxis.y, G.forkAxis.z).normalize();
  return {
    group,
    rider,
    ready,
    get eye() { return rider.eye; },
    update(state, dt, firstPerson) {
      group.position.copy(state.position);
      group.quaternion.copy(state.quaternion);
      const [wf, wr] = state.wheels;
      // La direction tourne autour de son axe (braquer à droite : rotation négative autour de l'axe, qui monte).
      parts.direction.quaternion.setFromAxisAngle(steerAxis, -state.steer);
      // Les fourreaux et la roue avant remontent le long de la fourche quand elle s'enfonce.
      parts.fourreaux.position.copy(parts.forkRest).addScaledVector(steerAxis, wf.contact ? wf.x : 0);
      parts.bras.rotation.x = -Math.asin(THREE.MathUtils.clamp((wr.contact ? wr.x : 0) / parts.armLength, -1, 1));
      // Les roues tournent (vers l'avant : le haut de la roue part vers -z).
      parts.roueAvant.rotation.x = -wf.spinAngle;
      parts.roueArriere.rotation.x = -wr.spinAngle;
      rider.update(state, dt, firstPerson);
    },
  };
}
