// Le télésiège du Bike Park : un débrayable à quatre places, comme ceux qui montent les vélos dans les bike parks de la
// côte Pacifique. Pylônes tubulaires galvanisés (une protection orange au pied, là où l'on roule), leurs balanciers, le
// câble qui fait sa chaînette d'un pylône à l'autre, les sièges qui montent d'un côté et redescendent de l'autre, des
// vélos accrochés derrière ceux qui montent, et les deux gares.
// line : [[x, z] en bas, [x, z] en haut] (voir maps.js). Rien de tout cela ne touche la physique : les pylônes se
// tiennent loin de la piste, le câble assez haut au-dessus des sauts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const GAP = 2.7; // le câble montant et le câble descendant, de part et d'autre de l'axe (m)
const SPACING = 30; // entre deux sièges (m)
const SPEED = 5; // la vitesse du câble (m/s)
const HANG = 2.5; // du câble à l'assise (m)
const STATION_Y = 5.4; // la hauteur du câble dans les gares (m)

/** Une boîte, posée dans une géométrie à fusionner. */
function box(sx, sy, sz, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}
function tube(r, len, x, y, z, axis = 'y') {
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// Un siège, dans son repère : le câble à l'origine, +z vers l'arrière du siège (il avance vers -z), +x de côté.
function chairGeometries() {
  const frame = mergeGeometries([
    box(0.12, 0.2, 0.3, 0, -0.05, 0), // la pince sur le câble
    tube(0.035, HANG - 0.3, 0, -HANG / 2, 0.05), // la suspente
    tube(0.03, 2.3, 0, -HANG + 0.2, 0.05, 'x'), // la barre sous le siège
    tube(0.025, 2.2, 0, -HANG + 1.05, -0.35, 'x'), // le garde-corps, relevé au-dessus des têtes
    box(0.04, 0.85, 0.04, -1.08, -HANG + 0.62, -0.15), box(0.04, 0.85, 0.04, 1.08, -HANG + 0.62, -0.15),
    tube(0.02, 2.0, 0, -HANG - 0.45, -0.55, 'x'), // le repose-pieds
  ]);
  const seat = mergeGeometries([
    box(2.2, 0.08, 0.55, 0, -HANG + 0.12, -0.05), // l'assise
    box(2.2, 0.62, 0.07, 0, -HANG + 0.45, 0.25, -0.25), // le dossier
  ]);
  // Le porte-vélo, derrière le dossier, et un vélo de descente pendu par la roue avant.
  const rack = mergeGeometries([box(1.9, 0.05, 0.05, 0, -HANG + 0.55, 0.5), box(0.05, 0.6, 0.05, 0, -HANG + 0.3, 0.5)]);
  const wheel = (y, z) => { const g = new THREE.TorusGeometry(0.34, 0.035, 6, 18); g.rotateY(Math.PI / 2); g.translate(0.45, y, z); return g; };
  const bike = mergeGeometries([
    wheel(-HANG + 0.25, 0.62), wheel(-HANG - 0.85, 0.75),
    tube(0.03, 1.15, 0.45, -HANG - 0.3, 0.72), tube(0.025, 0.7, 0.45, -HANG - 0.2, 0.92),
  ]);
  return { frame, seat, rack, bike };
}

export function createLift(track, line) {
  const group = new THREE.Group();
  group.name = 'telesiege';
  const A = new THREE.Vector2(...line[0]), B = new THREE.Vector2(...line[1]);
  const dir = B.clone().sub(A), len = dir.length();
  dir.normalize();
  const side = new THREE.Vector2(-dir.y, dir.x);
  const at = (d, u = 0) => new THREE.Vector2(A.x + dir.x * d + side.x * u, A.y + dir.y * d + side.y * u);
  const ground = (d) => Math.max(...[-GAP - 1, 0, GAP + 1].map((u) => { const p = at(d, u); return track.groundY(p.x, p.y); }));
  // Au-dessus de la piste, plus haut : on y saute.
  const overTrail = (d) => { const p = at(d), n = track.nearest(p.x, p.y, null, 0, 3); return n.dist < track.tapeAt(n.s) + 6; };

  // ----- Les pylônes, tous les 70 m environ, jamais sur la piste -----
  const nT = Math.max(2, Math.round(len / 70));
  const supports = [{ d: 0, y: track.groundY(A.x, A.y) + STATION_Y, station: true }];
  for (let i = 1; i < nT; i++) {
    let d = (len * i) / nT;
    for (let k = 0; k < 12 && overTrail(d); k++) d += 5;
    supports.push({ d, h: 11 });
  }
  supports.push({ d: len, y: track.groundY(B.x, B.y) + STATION_Y, station: true });
  const topOf = (s) => s.top ?? (s.station ? s.y : ground(s.d) + s.h);
  // Le câble entre deux appuis : une chaînette (une parabole qui pend de 2 % de la portée).
  const cableY = (d) => {
    let i = 0;
    while (i < supports.length - 2 && supports[i + 1].d < d) i++;
    const a = supports[i], b = supports[i + 1], t = (d - a.d) / (b.d - a.d);
    return topOf(a) + (topOf(b) - topOf(a)) * t - 4 * 0.02 * (b.d - a.d) * t * (1 - t);
  };
  // Assez de place sous les sièges : on rehausse les pylônes voisins là où il en manque (9 m, 13 m au-dessus de la piste).
  for (let pass = 0; pass < 8; pass++) {
    let worst = null;
    for (let d = 12; d < len - 12; d += 4) {
      const lack = (overTrail(d) ? 13 : 9) - (cableY(d) - ground(d));
      if (lack > 0 && (!worst || lack > worst.lack)) worst = { d, lack };
    }
    if (!worst) break;
    for (const s of supports) if (!s.station && Math.abs(s.d - worst.d) < 80) s.h = Math.min(24, s.h + worst.lack + 0.5);
  }
  for (const s of supports) s.top = topOf(s); // (désormais fixe : les sièges le relisent à chaque image)

  // ----- Les matières -----
  const steel = new THREE.MeshStandardMaterial({ color: lin('#9aa3a8'), roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: lin('#2a2e33'), roughness: 0.55, metalness: 0.3 });
  const padMat = new THREE.MeshStandardMaterial({ color: lin('#e0451b'), roughness: 0.75 });
  const seatMat = new THREE.MeshStandardMaterial({ color: lin('#1f4f8a'), roughness: 0.6 });
  const concrete = new THREE.MeshStandardMaterial({ color: lin('#a7a39b'), roughness: 0.95 });
  const white = new THREE.MeshStandardMaterial({ color: lin('#dfe2e4'), roughness: 0.6 });
  const bikeMat = new THREE.MeshStandardMaterial({ color: lin('#26282c'), roughness: 0.5, metalness: 0.3 });

  const yaw = Math.atan2(dir.x, dir.y); // le repère d'un pylône : +z vers le haut de la ligne
  const place = (mesh, d, y, u = 0) => {
    const p = at(d, u);
    mesh.position.set(p.x, y, p.y);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // ----- Les pylônes : le fût, le bras, les balanciers sous chaque câble, la protection au pied -----
  for (const s of supports) {
    if (s.station) continue;
    const g0 = track.groundY(at(s.d).x, at(s.d).y), top = topOf(s), h = top - g0;
    place(new THREE.Mesh(mergeGeometries([tube(0.42, h + 0.4, 0, h / 2 - 0.2, 0), tube(0.3, 0.6, 0, h + 0.3, 0)]), steel), s.d, g0);
    place(new THREE.Mesh(mergeGeometries([
      box(2 * GAP + 1.0, 0.45, 0.5, 0, h + 0.55, 0), // le bras
      box(0.35, 0.3, 2.2, -GAP, h + 0.12, 0), box(0.35, 0.3, 2.2, GAP, h + 0.12, 0), // les balanciers
      box(0.06, 0.06, 2.4, 0, h + 1.2, 0.0), // la passerelle d'entretien
    ]), dark), s.d, g0);
    place(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.4, 14).translate(0, 1.2, 0), padMat), s.d, g0);
    place(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.8).translate(0, 0.1, 0), concrete), s.d, g0);
  }

  // ----- Les gares : la poutre du volant (la grande roue où le câble fait demi-tour), son capot, le quai -----
  for (const [d, end] of [[0, -1], [len, 1]]) {
    const g0 = track.groundY(at(d).x, at(d).y);
    const L = 15;
    // (le capot s'étend vers l'extérieur de la ligne : le volant est au bout)
    const c = d + end * (L / 2 - 3);
    place(new THREE.Mesh(box(2 * GAP + 2.6, 2.4, L, 0, STATION_Y + 0.9, 0), white), c, g0);
    place(new THREE.Mesh(box(2 * GAP + 3.4, 0.25, L + 1.2, 0, STATION_Y + 2.25, 0), dark), c, g0);
    place(new THREE.Mesh(mergeGeometries([tube(0.55, STATION_Y, 0, STATION_Y / 2, -L / 2 + 3), tube(0.55, STATION_Y, 0, STATION_Y / 2, L / 2 - 3)]), dark), c, g0);
    // Le quai d'embarquement, en planches, et la cabane du liftier.
    place(new THREE.Mesh(box(2 * GAP + 3, 0.3, 9, 0, 0.15, 0), concrete), d - end * 4, g0);
    place(new THREE.Mesh(box(2.4, 2.6, 2.4, 0, 1.3, 0), white), d - end * 2, g0, GAP + 3.4);
    place(new THREE.Mesh(box(2.8, 0.2, 2.8, 0, 2.7, 0), dark), d - end * 2, g0, GAP + 3.4);
  }

  // ----- Le câble : des tronçons de 6 m, montant et descendant, et le demi-tour autour du volant -----
  const cablePts = [];
  for (const u of [GAP, -GAP]) {
    const pts = [];
    for (let d = 0; d <= len; d += 6) pts.push([d, u]);
    pts.push([len, u]);
    cablePts.push(pts);
  }
  const segs = [];
  for (const pts of cablePts) for (let i = 0; i + 1 < pts.length; i++) {
    const [d0, u0] = pts[i], [d1, u1] = pts[i + 1];
    const p0 = at(d0, u0), p1 = at(d1, u1);
    segs.push([new THREE.Vector3(p0.x, cableY(d0), p0.y), new THREE.Vector3(p1.x, cableY(d1), p1.y)]);
  }
  const cable = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 5), dark, segs.length);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), mid = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
    segs.forEach(([a, b], i) => {
      v.subVectors(b, a);
      q.setFromUnitVectors(Y, v.clone().normalize());
      cable.setMatrixAt(i, m.compose(mid.addVectors(a, b).multiplyScalar(0.5), q, s.set(1, v.length(), 1)));
    });
  }
  group.add(cable);

  // ----- Les sièges : une boucle (on monte à droite de l'axe, on redescend à gauche), qui avance -----
  const geo = chairGeometries();
  const loop = 2 * len + 2 * Math.PI * GAP;
  const n = Math.floor(loop / SPACING);
  const meshes = [[geo.frame, steel], [geo.seat, seatMat], [geo.rack, dark], [geo.bike, bikeMat]].map(([g, mat]) => {
    const im = new THREE.InstancedMesh(g, mat, n);
    im.castShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    group.add(im);
    return im;
  });
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), hide = new THREE.Vector3(0, 0, 0), pos = new THREE.Vector3();
  const qUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI); // vers le haut de la ligne
  const qDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  // Un siège à l'abscisse w de la boucle : sa position, son orientation, et s'il monte.
  const chairAt = (w) => {
    w = ((w % loop) + loop) % loop;
    if (w < len) { const p = at(w, GAP); pos.set(p.x, cableY(w), p.y); return { q: qUp, up: true }; }
    w -= len;
    const half = Math.PI * GAP;
    if (w < half) { // le demi-tour en haut
      const a = w / GAP, p = at(len + Math.sin(a) * GAP * 0.6, Math.cos(a) * GAP);
      pos.set(p.x, cableY(len), p.y);
      return { q: a < Math.PI / 2 ? qUp : qDown, up: true };
    }
    w -= half;
    if (w < len) { const d = len - w, p = at(d, -GAP); pos.set(p.x, cableY(d), p.y); return { q: qDown, up: false }; }
    w -= len;
    const a = w / GAP, p = at(-Math.sin(a) * GAP * 0.6, -Math.cos(a) * GAP);
    pos.set(p.x, cableY(0), p.y);
    return { q: a < Math.PI / 2 ? qDown : qUp, up: false };
  };
  const update = (t) => {
    for (let i = 0; i < n; i++) {
      const c = chairAt(t * SPEED + i * SPACING);
      m4.compose(pos, q4.copy(c.q), one);
      meshes[0].setMatrixAt(i, m4); meshes[1].setMatrixAt(i, m4); meshes[2].setMatrixAt(i, m4);
      // (un vélo derrière un siège sur deux qui montent)
      meshes[3].setMatrixAt(i, c.up && i % 2 === 0 ? m4 : m4.compose(pos, q4, hide));
    }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update, supports: supports.map((s) => ({ ...at(s.d), top: topOf(s) })) };
}
