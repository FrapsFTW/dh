// Les bras du pilote, détaillés : le modèle CC0 « fps arms » de para (OpenGameArt, fait avec MakeHuman), subdivisé et
// préparé dans Blender (public/models/bras.glb). Ils sont posés sur le cintre à chaque image : IK de l'épaule au
// poignet, main orientée sur la poignée, chaque phalange enroulée autour d'elle, pouce dessous.
// L'habillage vient des sommets : leur couleur porte un code de zone (rouge = code / 15 : 0 manche, 1 épaule, 5 dos du
// gant, 6 paume, 7 coque, 8 insert). La distance au poignet le long du bras, calculée au chargement, permet au shader
// de tracer le revers du gant (5 cm), sa patte et les liserés de la manche, nets quelle que soit la taille des triangles.
// Repère : celui du vélo (voir src/sim/geometry.js).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GEOMETRY } from '../sim/geometry.js';
import { solveTwoBone } from './rider.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

// La tenue : manches rouges (celles du maillot), épaules et bout de manche noirs, liseré blanc ; gants anthracite à
// paume grise, coque rouge sur les jointures.
export const KIT = { jersey: '#b3352b', panel: '#1b1d22', stripe: '#f2f2ef', cuff: '#1d1e22', glove: '#3a3d44', palm: '#5b5f66', patch: '#62666f', gloveAccent: '#d63a2a' };
const ZONES = ['jersey', 'panel', 'stripe', 'cuff', 'gloveAccent', 'glove', 'palm', 'gloveAccent', 'patch'];

// La trame du maillot : une petite carte de normales tissée, répétée sur la manche.
function weaveNormalMap() {
  const N = 128, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x / N) * 32 * Math.PI, w = (y / N) * 32 * Math.PI;
    const over = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
    const dx = over ? Math.cos(u) * 0.5 : 0, dy = over ? 0 : Math.cos(w) * 0.5;
    const i = (y * N + x) * 4;
    img.data[i] = 128 + dx * 110; img.data[i + 1] = 128 + dy * 110; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  return t;
}

// Le revers du gant, sa patte et les liserés, d'après la distance au poignet (vArmD, en mètres). En vue subjective, on
// ne voit qu'une dizaine de centimètres d'avant-bras : un revers court laisse voir la manche.
function addSleeveBands(mat, kit) {
  const u = { uCuff: { value: lin(kit.cuff) }, uStrap: { value: lin(kit.gloveAccent) }, uStripe: { value: lin(kit.stripe) }, uPanel: { value: lin(kit.panel) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float armD;\nvarying float vArmD;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArmD = armD;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vArmD;
        uniform vec3 uCuff, uStrap, uStripe, uPanel;
        float bandOf(float a, float b, float d, float aa) { return smoothstep(a - aa, a + aa, d) * (1.0 - smoothstep(b - aa, b + aa, d)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float aa = fwidth(vArmD) * 1.2 + 1e-4;
          vec3 c = diffuseColor.rgb;
          c = mix(c, uPanel, bandOf(0.06, 0.078, vArmD, aa));
          c = mix(c, uStripe, bandOf(0.05, 0.06, vArmD, aa));
          c = mix(c, uCuff, 1.0 - smoothstep(0.05 - aa, 0.05 + aa, vArmD));
          c = mix(c, uStrap, bandOf(0.018, 0.03, vArmD, aa));
          diffuseColor.rgb = c;
        }`);
  };
  mat.customProgramCacheKey = () => 'manche-bandes';
}

/**
 * Charge les bras et les ajoute à `parent` (le groupe du pilote, dans le repère du vélo). Renvoie { ready, update }.
 * update(shoulderMid, steerQ) : shoulderMid, le milieu des épaules, et steerQ, la rotation du cintre (repère du vélo).
 */
export function createDetailedArms(parent, kit = KIT) {
  const state = { loaded: false };
  const url = `${import.meta.env ? import.meta.env.BASE_URL : '/'}models/bras.glb`;
  const ready = new GLTFLoader().loadAsync(url).then((gltf) => {
    const root = gltf.scene;
    root.rotation.y = Math.PI; // le modèle regarde vers +z ; le vélo roule vers -z
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const clothMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.18, 0.18, 0.2), normalMap: weaveNormalMap(), normalScale: new THREE.Vector2(0.08, 0.08) });
    addSleeveBands(clothMat, kit);
    const gloveMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, clearcoat: 0.08, clearcoatRoughness: 0.7, sheen: 0.15, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.15, 0.15, 0.16) });
    const C = ZONES.map((z) => lin(kit[z]));
    for (const m of meshes) {
      const col = m.geometry.attributes.color;
      let gloveVerts = 0;
      for (let i = 0; i < col.count; i++) {
        const zone = Math.round(col.getX(i) * 15);
        if (zone >= 5) gloveVerts++;
        const c = C[zone] || C[0];
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
      m.material = gloveVerts > col.count / 2 ? gloveMat : clothMat; // la partie gant : surtout des sommets de gant
      m.castShadow = true;
      m.frustumCulled = false; // l'os de la main bouge : la boîte du modèle au repos ne vaut rien
    }
    const skeleton = meshes[0].skeleton;
    const bones = {};
    skeleton.bones.forEach((b) => { bones[b.name] = b; bones[b.name.replace(/[^A-Za-z0-9_]/g, '')] = b; });
    const bone = (n) => bones[n] || bones[n.replace(/[^A-Za-z0-9_]/g, '')];
    const FINGERS = ['index', 'middle', 'ring', 'pinky'];
    const arm = {};
    for (const S of ['R', 'L']) {
      arm[S] = {
        s: S === 'R' ? 1 : -1,
        upper: bone(`upper_arm.${S}`), fore: bone(`forearm.${S}`), foreEnd: bone(`forearm.${S}_end`), hand: bone(`hand.${S}`), handCtl: bone(`hand.${S}.control`),
        fingers: FINGERS.map((f) => [1, 2, 3].map((k) => bone(`f_${f}.0${k}.${S}`))),
        ends: FINGERS.map((f) => bone(`f_${f}.03.${S}_end`)),
        thumb: [1, 2, 3].map((k) => bone(`thumb.0${k}.${S}`)), thumbEnd: bone(`thumb.03.${S}_end`),
      };
    }
    // Mesuré une fois, au repos (le modèle n'est pas encore dans la scène : son repère est celui du vélo).
    const wp = (b, out = v()) => out.setFromMatrixPosition(b.matrixWorld);
    for (const a of Object.values(arm)) {
      a.L1 = wp(a.upper).distanceTo(wp(a.fore));
      a.L2 = wp(a.fore).distanceTo(wp(a.foreEnd));
    }
    const mid0 = wp(arm.R.upper).add(wp(arm.L.upper)).multiplyScalar(0.5).sub(root.position);
    // La distance au poignet, le long du bras, pour les bandes de la manche : chaque sommet, au repos, est projeté sur
    // l'avant-bras ou sur le haut du bras (le plus proche des deux), du côté de la main la plus proche.
    skeleton.update();
    const seg = (p, a, b) => {
      const ab = v().subVectors(b, a), t = THREE.MathUtils.clamp(v().subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
      return { t, d: p.distanceTo(a.clone().addScaledVector(ab, t)) };
    };
    const chain = Object.values(arm).map((a) => ({ S: wp(a.upper), E: wp(a.fore), W: wp(a.foreEnd), L1: a.L1, L2: a.L2 }));
    const p = v();
    for (const m of meshes) {
      const n = m.geometry.attributes.position.count, armD = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        m.getVertexPosition(i, p);
        m.localToWorld(p);
        const c = chain[0].W.distanceTo(p) + chain[0].E.distanceTo(p) < chain[1].W.distanceTo(p) + chain[1].E.distanceTo(p) ? chain[0] : chain[1];
        const f = seg(p, c.E, c.W), u = seg(p, c.S, c.E);
        armD[i] = f.d <= u.d ? (1 - f.t) * c.L2 : c.L2 + (1 - u.t) * c.L1;
      }
      m.geometry.setAttribute('armD', new THREE.BufferAttribute(armD, 1));
    }
    Object.assign(state, { root, meshes, arm, mid0, rest: new Map(skeleton.bones.map((b) => [b, b.quaternion.clone()])), loaded: true });
    parent.add(root);
    return true;
  }).catch((e) => { console.warn('Bras détaillés indisponibles :', e.message); return false; });

  // ----- La pose -----
  const worldPos = (b, out = v()) => out.setFromMatrixPosition(b.matrixWorld);
  const worldQuat = (o, out = new THREE.Quaternion()) => { o.updateWorldMatrix(true, false); return o.getWorldQuaternion(out); };
  const _a = v(), _b = v(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
  // Oriente un os pour que la tête de tipBone vise la cible, par la plus petite rotation.
  function aim(b, target, tipBone) {
    b.updateWorldMatrix(true, true);
    const head = worldPos(b, _a), from = worldPos(tipBone, _b).sub(head).normalize();
    _q.setFromUnitVectors(from, v().subVectors(target, head).normalize());
    const wq = worldQuat(b).premultiply(_q);
    worldQuat(b.parent, _pq).invert();
    b.quaternion.copy(_pq.multiply(wq));
    b.updateWorldMatrix(false, true);
  }
  // Oriente un os d'après deux directions : la sienne et une direction de côté.
  function orient(b, dirRest, sideRest, dirWant, sideWant) {
    const m1 = new THREE.Matrix4().makeBasis(dirRest, sideRest, v().crossVectors(dirRest, sideRest));
    const s2 = sideWant.clone().addScaledVector(dirWant, -sideWant.dot(dirWant)).normalize();
    const m2 = new THREE.Matrix4().makeBasis(dirWant, s2, v().crossVectors(dirWant, s2));
    const wq = worldQuat(b).premultiply(new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.clone().transpose())));
    worldQuat(b.parent, _pq).invert();
    b.quaternion.copy(_pq.multiply(wq));
    b.updateWorldMatrix(false, true);
  }
  // Point du cercle autour de la poignée (rayon R) à la distance len de P. Les doigts s'enroulent vers l'avant puis
  // dessous (dir = -1) ; le pouce passe dessous depuis l'arrière, dans l'autre sens (dir = +1).
  const wrapCircle = (P, len, R, center, barX, barY, barZ, dir = -1) => {
    const rel = v().subVectors(P, center); const along = rel.dot(barX); rel.addScaledVector(barX, -along);
    const ang = Math.atan2(rel.dot(barY), -rel.dot(barZ));
    let best = ang, bestErr = Infinity;
    const q = v();
    for (let k = 1; k <= 48; k++) {
      const t = ang + dir * (k / 48) * 2.2;
      q.copy(center).addScaledVector(barY, Math.sin(t) * R).addScaledVector(barZ, -Math.cos(t) * R).addScaledVector(barX, along);
      const err = Math.abs(q.distanceTo(P) - len);
      if (err < bestErr) { bestErr = err; best = t; }
    }
    return center.clone().addScaledVector(barY, Math.sin(best) * R).addScaledVector(barZ, -Math.cos(best) * R).addScaledVector(barX, along);
  };

  const G = GEOMETRY;
  const pivot = v(0, G.steerPivot.y, G.steerPivot.z);
  const parentQ = new THREE.Quaternion(), barQ = new THREE.Quaternion();
  return {
    ready,
    get loaded() { return state.loaded; },
    set visible(on) { if (state.root) state.root.visible = on; },
    update(shoulderMid, steerQ) {
      if (!state.loaded) return;
      const { root, arm, mid0, rest } = state;
      for (const [b, q] of rest) b.quaternion.copy(q);
      root.position.copy(shoulderMid).sub(mid0);
      root.updateWorldMatrix(true, true);
      // Les cibles sont calculées dans le repère du vélo, puis passées dans celui du monde (celui des os).
      const M = parent.matrixWorld;
      parent.getWorldQuaternion(parentQ);
      barQ.copy(parentQ).multiply(steerQ);
      const barX = v(1, 0, 0).applyQuaternion(barQ), barY = v(0, 1, 0).applyQuaternion(barQ), barZ = v(0, 0, 1).applyQuaternion(barQ);
      for (const a of Object.values(arm)) {
        const s = a.s;
        const grip = v(s * G.grips.halfWidth, G.grips.y, G.grips.z).sub(pivot).applyQuaternion(steerQ).add(pivot).applyMatrix4(M);
        // La main au repos : du poignet aux jointures du majeur, et de l'index vers l'auriculaire.
        const wrist0 = worldPos(a.hand), mid0f = worldPos(a.fingers[1][0]), idx0 = worldPos(a.fingers[0][0]), pnk0 = worldPos(a.fingers[3][0]);
        const handLen = wrist0.distanceTo(mid0f);
        const dirRest = v().subVectors(mid0f, wrist0).normalize();
        const sideRest = v().subVectors(pnk0, idx0); sideRest.addScaledVector(dirRest, -sideRest.dot(dirRest)).normalize();
        // Les jointures sur le dessus de la poignée, un peu vers l'avant ; le poignet derrière et au-dessus.
        const rk = G.grips.radius + 0.011, kAng = 62 * DEG, rise = 0.42;
        const knuckles = grip.clone().addScaledVector(barY, Math.sin(kAng) * rk).addScaledVector(barZ, -Math.cos(kAng) * rk);
        const wrist = knuckles.clone().addScaledVector(v().addScaledVector(barZ, Math.cos(rise)).addScaledVector(barY, Math.sin(rise)).normalize(), handLen);
        // Le bras jusqu'au poignet, coudes sortis et un peu bas.
        const shoulder = worldPos(a.upper);
        const elbow = solveTwoBone(shoulder, wrist, a.L1, a.L2, v(s * 0.6, -0.5, 0.4).applyQuaternion(parentQ), v());
        aim(a.upper, elbow, a.fore);
        aim(a.fore, wrist, a.foreEnd);
        a.handCtl.position.copy(a.handCtl.parent.worldToLocal(wrist.clone())); // la main pend d'un os de contrôle
        a.handCtl.updateWorldMatrix(false, true);
        orient(a.hand, dirRest, sideRest, v().subVectors(knuckles, wrist).normalize(), barX.clone().multiplyScalar(s));
        // Chaque phalange vise un point du cercle autour de la poignée.
        a.fingers.forEach((chain, fi) => {
          const R = G.grips.radius + (fi === 3 ? 0.0085 : 0.0098);
          chain.forEach((b, k) => {
            const tipB = k < 2 ? chain[k + 1] : a.ends[fi];
            b.updateWorldMatrix(true, true);
            const P = worldPos(b);
            aim(b, wrapCircle(P, P.distanceTo(worldPos(tipB)), R, grip, barX, barY, barZ), tipB);
          });
        });
        a.thumb.forEach((b, k) => {
          const tipB = k < 2 ? a.thumb[k + 1] : a.thumbEnd;
          b.updateWorldMatrix(true, true);
          const P = worldPos(b);
          aim(b, wrapCircle(P, P.distanceTo(worldPos(tipB)), G.grips.radius + 0.01, grip, barX, barY, barZ, 1), tipB);
        });
      }
    },
  };
}
