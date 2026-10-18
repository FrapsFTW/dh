// La piste : un tracé de descente façon Coupe du monde, dans une pente boisée.
// Repère : x vers la droite, y vers le haut, la descente part vers -z (l'avant d'un objet three.js).
// Tout est déterministe et sans navigateur : le jeu et les tests construisent exactement la même piste.
//
// Le déroulé, du haut vers le bas :
//   cabane de départ et rampe · schuss · virages relevés · bosses à pomper · épingle · traversée de racines en dévers
//   · pierrier dans la pente raide · drop · deux épingles · deux tables · road gap · virage final · saut d'arrivée.

import { CatmullRomCurve3, Vector3 } from 'three';
import { rng, vnoise, fbm, clamp, smoothstep } from './noise.js';

export const DS = 0.25; // pas d'échantillonnage du tracé, en mètres
export const RIBBON_HALF = 6; // demi-largeur du maillage fin de la piste
export const TRAIL_HALF = 2.4; // demi-largeur de la partie roulante
export const TAPE_U = 3.4; // la rubalise, de chaque côté
const RIBBON_DU = 0.4;
const TERRAIN_STEP = 1.5;
const SLOPE = 0.3; // pente générale de la montagne (30 %)
const VALLEY_Z = 575; // en dessous de z = -575, le fond de vallée
const G_TRACK = 9.81;

// Points de passage du tracé (x, z), du haut vers le bas.
const CONTROL = [
  [0, 34], [0, 18], [0, -20], [3, -55], [16, -80], [40, -92], [72, -100], [96, -110], [104, -124], [96, -137],
  [70, -146], [42, -154], [18, -168], [6, -190], [2, -222], [-2, -252], [-10, -272], [-32, -286], [-58, -294],
  [-70, -306], [-62, -320], [-36, -330], [-8, -338], [8, -354], [12, -384], [8, -420], [0, -452], [-4, -482],
  [4, -512], [20, -532], [26, -556], [26, -596], [26, -630],
];

// grip : multiplie le grip du pneu (1 = terre tassée).
export const SURFACES = {
  terre: { name: 'terre', grip: 1.0, crr: 0.02 },
  poussiere: { name: 'terre sèche', grip: 0.88, crr: 0.025 },
  cailloux: { name: 'cailloux', grip: 0.85, crr: 0.04 },
  racines: { name: 'racines', grip: 0.62, crr: 0.03 },
  bois: { name: 'bois', grip: 0.9, crr: 0.015 },
  herbe: { name: 'herbe', grip: 0.75, crr: 0.07 },
};

export function createTrack(seed = 7) {
  const rand = rng(seed);

  // ---------- Le relief naturel ----------
  // La pente s'adoucit en bas, dans le fond de vallée où se trouve l'aire d'arrivée.
  const softplus = (v) => (v > 20 ? v : Math.log1p(Math.exp(v)));
  const valley = (z) => SLOPE * z + (SLOPE - 0.05) * 8 * softplus(-(z + VALLEY_Z) / 8);
  const natural = (x, z) =>
    valley(z) + 5.0 * fbm(x / 80, z / 80, 4, seed) + 0.7 * fbm(x / 14, z / 14, 2, seed + 5) + 0.0005 * x * x;

  // ---------- Le tracé, échantillonné tous les 25 cm ----------
  const curve = new CatmullRomCurve3(CONTROL.map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal');
  const length = curve.getLength();
  const n = Math.ceil(length / DS) + 1;
  const pts = curve.getSpacedPoints(n - 1);
  const X = new Float32Array(n), Z = new Float32Array(n), TX = new Float32Array(n), TZ = new Float32Array(n);
  for (let i = 0; i < n; i++) { X[i] = pts[i].x; Z[i] = pts[i].z; }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz) || 1;
    TX[i] = dx / l; TZ[i] = dz / l;
  }
  const L = (n - 1) * DS;

  const boxSmooth = (src, radius) => {
    const out = new Float32Array(src.length);
    let acc = 0, cnt = 0;
    for (let i = -radius; i < src.length + radius; i++) {
      const add = i + radius, rem = i - radius - 1;
      if (add >= 0 && add < src.length) { acc += src[add]; cnt++; }
      if (rem >= 0 && rem < src.length) { acc -= src[rem]; cnt--; }
      if (i >= 0 && i < src.length) out[i] = acc / cnt;
    }
    return out;
  };

  // Courbure signée (positive dans un virage à droite), lissée.
  let K = new Float32Array(n);
  const span = 8;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - span), b = Math.min(n - 1, i + span);
    const cross = TZ[a] * TX[b] - TX[a] * TZ[b];
    K[i] = -cross / ((b - a) * DS || 1);
  }
  K = boxSmooth(boxSmooth(K, 20), 20);

  // Distance de chaque point de passage le long du tracé.
  const cpS = CONTROL.map(([x, z]) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = (x - X[i]) ** 2 + (z - Z[i]) ** 2; if (d < bd) { bd = d; bi = i; } }
    return bi * DS;
  });
  const seg = (a, b, f) => cpS[a] + (cpS[b] - cpS[a]) * f;

  // ---------- Les modules de la piste ----------
  const sStart = cpS[1] + 1; // la ligne de départ, au pied de la rampe
  const sFinish = cpS[31] - 4;
  const features = [
    { type: 'startRamp', a: cpS[0], b: sStart, height: 1.6 },
    { type: 'brakeBumps', a: cpS[3] - 18, b: cpS[3] + 2 },
    { type: 'rollers', a: seg(5, 6, 0.1), b: seg(6, 7, 0.55), height: 0.45, wave: 8 },
    { type: 'brakeBumps', a: seg(7, 8, 0.0), b: seg(7, 8, 0.6) },
    { type: 'offCamber', a: seg(9, 10, 0.4), b: seg(11, 12, 0.3), bank: -0.13 },
    { type: 'rocks', a: seg(13, 14, 0.3), b: seg(14, 15, 0.8) },
    { type: 'jump', kind: 'drop', name: 'drop', a: seg(14, 15, 0.86), lipLen: 3, lipH: 0.35, knuckle: 0.3, clear: 1.1, speed: 7.5 },
    { type: 'brakeBumps', a: seg(18, 19, 0.0), b: seg(18, 19, 0.7) },
    { type: 'jump', kind: 'table', name: 'table', a: seg(23, 24, 0.55), lipLen: 5, lipH: 1.0, knuckle: 4.5, clear: 0.55, speed: 10.5 },
    { type: 'jump', kind: 'table', name: 'table', a: seg(24, 25, 0.7), lipLen: 5, lipH: 1.1, knuckle: 5, clear: 0.6, speed: 11 },
    { type: 'jump', kind: 'gap', name: 'road gap', a: seg(26, 27, 0.25), lipLen: 6, lipH: 1.3, knuckle: 7, clear: 0.7, dip: -1.3, speed: 12 },
    { type: 'brakeBumps', a: seg(28, 29, 0.2), b: seg(28, 29, 0.85) },
    // Le saut d'arrivée, le plus gros : une lèvre raide, plus d'une seconde en l'air et un plateau bas, de quoi tenter
    // un backflip ou un 360 (la tête passe sous le vélo : il faut de la place). La réception, un peu moins raide que
    // la trajectoire, pardonne d'arriver trop vite.
    { type: 'jump', kind: 'table', name: 'saut d\'arrivée', a: cpS[29] + 8, lipLen: 5, lipH: 2.2, knuckle: 8, clear: 1.6, speed: 10, touchLen: 3, lineLen: 4, landFlatten: 0.45, runout: 14 },
    { type: 'arena', a: seg(30, 31, 0.75), b: L },
  ];
  for (const f of features) if (f.type === 'jump') f.b = f.a + 40; // provisoire : la vraie longueur vient du profil
  const featureOf = (type) => features.filter((f) => f.type === type);

  // Les racines : des bourrelets en travers, un peu en biais, dans la traversée en dévers et sous les sapins.
  const roots = [];
  for (const [a, b] of [[seg(9, 10, 0.3), seg(12, 13, 0.2)], [seg(19, 20, 0.6), seg(21, 22, 0.5)]]) {
    for (let s = a + 2; s < b - 2; s += 1.2 + rand() * 3.5) {
      roots.push({ s, skew: (rand() - 0.5) * 1.1, height: 0.05 + rand() * 0.05, r: 0.06 + rand() * 0.05, u0: -3 + rand() * 1.5, u1: 1.5 + rand() * 1.5 });
    }
  }
  // Le pierrier : des blocs posés dans la pente, et quelques gros à éviter.
  const rocks = [];
  for (const f of featureOf('rocks')) {
    for (let s = f.a + 1; s < f.b - 1; s += 0.35 + rand() * 0.6) {
      const big = rand() < 0.08;
      rocks.push({ s, u: (rand() * 2 - 1) * (TRAIL_HALF + 0.2), r: big ? 0.5 + rand() * 0.3 : 0.18 + rand() * 0.22, h: big ? 0.2 + rand() * 0.12 : 0.05 + rand() * 0.1, seed: rand() });
    }
  }
  rocks.sort((a, b) => a.s - b.s);
  const rocksRange = featureOf('rocks')[0];

  // Inclinaison des virages : relevés selon la courbure, sauf en dévers.
  const BANK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * DS;
    let b = clamp(K[i] * 7, -0.55, 0.55);
    for (const f of features) {
      if (f.type !== 'offCamber') continue;
      const w = smoothstep(f.a, f.a + 6, s) * (1 - smoothstep(f.b - 6, f.b, s));
      b = b * (1 - w) + f.bank * w;
    }
    BANK[i] = b;
  }

  // Hauteur de la ligne de la piste : le relief, lissé, qui descend toujours un peu ; l'aire d'arrivée est à plat.
  let C = new Float32Array(n);
  for (let i = 0; i < n; i++) C[i] = natural(X[i], Z[i]);
  C = boxSmooth(boxSmooth(C, 36), 36);
  const arena = featureOf('arena')[0];
  const iArena = Math.floor(arena.a / DS);
  for (let i = iArena; i < n; i++) {
    const s = i * DS;
    const w = smoothstep(arena.a, arena.a + 18, s);
    C[i] = C[i] * (1 - w) + (C[iArena] - 0.04 * (s - arena.a)) * w; // presque plat, juste de quoi rouler
  }
  for (let i = 1; i < n; i++) C[i] = Math.min(C[i], C[i - 1] - 0.015 * DS);
  // Écart entre la piste et le relief naturel : on le reporte sur les côtés pour que la pente suive la piste.
  const D = new Float32Array(n);
  for (let i = 0; i < n; i++) D[i] = C[i] - natural(X[i], Z[i]);

  // ---------- Les sauts, dessinés d'après la trajectoire ----------
  // On calcule la trajectoire d'un pilote qui décolle à la vitesse prévue. Il passe f.clear mètres au-dessus de l'arête
  // de réception (f.knuckle mètres après la lèvre), puis la réception rejoint sa trajectoire en douceur : à cette vitesse,
  // il se pose sans choc. Plus lent, il se pose sur l'arête ; plus vite, plus bas, sur une pente encore plus raide.
  const baseAt = (s) => {
    const fi = clamp(s / DS, 0, n - 1.0001), i = Math.floor(fi), t = fi - i;
    return C[i] + (C[i + 1] - C[i]) * t;
  };
  for (const f of features) {
    if (f.type !== 'jump') continue;
    const lipS = f.a + f.lipLen;
    const baseSlope = baseAt(lipS + 0.5) - baseAt(lipS - 0.5);
    const lipSlope = f.kind === 'drop' ? baseSlope + 0.03 : baseSlope + (f.lipH * 1.6) / f.lipLen;
    const cos2 = 1 / (1 + lipSlope * lipSlope);
    const yLip = baseAt(lipS) + f.lipH;
    const traj = (x) => yLip + lipSlope * x - (G_TRACK * x * x) / (2 * f.speed * f.speed * cos2);
    const touch = f.knuckle + (f.touchLen ?? (f.kind === 'drop' ? 2.5 : 3)); // là où la réception rejoint la trajectoire
    // Après le point de contact, la réception continue tout droit, dans la pente de la trajectoire : plus on va vite,
    // plus on se pose loin, sur une pente plus raide que sa trajectoire.
    const slopeT = traj(touch + 0.01) - traj(touch);
    const lineLen = f.lineLen ?? (f.kind === 'drop' ? 6 : f.kind === 'gap' ? 14 : 11);
    const landSlope = slopeT * 100 + (f.landFlatten || 0); // un peu moins raide que la trajectoire : on se pose plus tôt si on va trop vite
    const landing = (x) => (x <= touch ? traj(x) - f.clear * (1 - smoothstep(f.knuckle, touch, x)) : traj(touch) + landSlope * (x - touch));
    const yK = landing(f.knuckle);
    const prof = [];
    let end = null;
    for (let d = 0; d <= 100; d += DS) {
      const sd = f.a + d;
      let h;
      if (d < f.lipLen) {
        h = f.kind === 'drop' ? f.lipH * smoothstep(0, f.lipLen * 0.8, d) : f.lipH * Math.pow(d / f.lipLen, 1.6);
      } else if (end === null) {
        const x = d - f.lipLen;
        let y;
        if (x >= f.knuckle) y = landing(x);
        else if (f.kind === 'table') y = yLip + ((yK - yLip) * x) / f.knuckle; // le plateau, de la lèvre à l'arête
        else if (f.kind === 'drop') y = yLip + (yK - yLip) * smoothstep(0, f.knuckle, x); // la marche
        else {
          // Le trou : on descend vite dans la route, on remonte vite au pied de la réception.
          const road = baseAt(sd) + f.dip;
          y = x < f.knuckle / 2 ? yLip + (road - yLip) * smoothstep(0, 1.4, x) : road + (yK - road) * smoothstep(f.knuckle - 1.6, f.knuckle, x);
        }
        h = y - baseAt(sd);
        // Au bout de la réception, on revient à la pente en douceur.
        if (x > touch + lineLen) end = { d, h, m: (h - prof[prof.length - 1]) / DS };
      } else {
        // Le raccord part avec la pente de la réception (pas de cassure) et rejoint la pente naturelle sur 18 m :
        // à 13 m/s, un changement de pente trop court écrase la suspension.
        const Lr = f.runout ?? 18, t = Math.min(1, (d - end.d) / Lr);
        h = end.h * (2 * t ** 3 - 3 * t * t + 1) + end.m * Lr * (t ** 3 - 2 * t * t + t);
        if (d > end.d + Lr) break;
      }
      prof.push(h);
    }
    f.prof = Float32Array.from(prof);
    f.b = f.a + (prof.length - 1) * DS;
    f.lipS = lipS;
  }

  // ---------- Recherche du point le plus proche sur le tracé ----------
  const CELL = 8;
  const grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const project = (x, z, i) => {
    // Affine l'échantillon i en projetant sur le segment voisin.
    let best = null;
    for (const j of [i - 1, i]) {
      if (j < 0 || j + 1 >= n) continue;
      const ax = X[j], az = Z[j], bx = X[j + 1] - ax, bz = Z[j + 1] - az;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
      const px = ax + bx * t, pz = az + bz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (!best || d2 < best.d2) best = { d2, s: (j + t) * DS, px, pz };
    }
    if (!best) best = { d2: (x - X[i]) ** 2 + (z - Z[i]) ** 2, s: i * DS, px: X[i], pz: Z[i] };
    const f = sample(best.s);
    const u = (x - f.x) * f.rx + (z - f.z) * f.rz;
    const along = (x - f.x) * f.tx + (z - f.z) * f.tz;
    return { s: best.s, u, dist: Math.sqrt(best.d2), inside: Math.abs(along) < 0.6 };
  };
  /** Le point du tracé le plus proche. Avec `hint`, ne cherche qu'autour de cette distance (évite de sauter d'un lacet à l'autre). */
  function nearest(x, z, hint = null, window = 30, maxRing = 6) {
    let bi = -1, bd = Infinity;
    if (hint !== null) {
      const a = Math.max(0, Math.floor((hint - window) / DS)), b = Math.min(n - 1, Math.ceil((hint + window) / DS));
      for (let i = a; i <= b; i++) {
        const d = (x - X[i]) ** 2 + (z - Z[i]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
    } else {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let r = 1; r <= maxRing && bi < 0; r++) {
        for (let ix = -r; ix <= r; ix++) for (let iz = -r; iz <= r; iz++) {
          const arr = grid.get(key(cx + ix, cz + iz));
          if (!arr) continue;
          for (const i of arr) {
            const d = (x - X[i]) ** 2 + (z - Z[i]) ** 2;
            if (d < bd) { bd = d; bi = i; }
          }
        }
        // Un résultat trouvé dans un carré de r cases autour du point est exact jusqu'à r·CELL mètres.
        if (bi >= 0 && Math.sqrt(bd) > r * CELL && r < maxRing) bi = -1, bd = Infinity;
      }
    }
    if (bi < 0) return { s: 0, u: 0, dist: Infinity, inside: false };
    return project(x, z, bi);
  }

  function sample(s) {
    const f = clamp(s / DS, 0, n - 1.0001);
    const i = Math.floor(f), t = f - i;
    const lerp = (A) => A[i] + (A[i + 1] - A[i]) * t;
    let tx = lerp(TX), tz = lerp(TZ);
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: lerp(X), z: lerp(Z), tx, tz, rx: -tz, rz: tx, c: lerp(C), bank: lerp(BANK), k: lerp(K), d: lerp(D) };
  }

  function featureHeight(s, u) {
    let h = 0;
    const au = Math.abs(u);
    for (const f of features) {
      if (s < f.a || s > f.b) continue;
      const d = s - f.a;
      if (f.type === 'jump') h += profileAt(f.prof, d);
      else if (f.type === 'rollers') h += f.height * Math.sin((Math.PI * d) / f.wave) ** 2 * smoothstep(0, 4, d) * (1 - smoothstep(f.b - f.a - 4, f.b - f.a, d));
      else if (f.type === 'brakeBumps') h += 0.035 * Math.sin((2 * Math.PI * d) / 0.95) ** 2 * smoothstep(0, 3, d) * (1 - smoothstep(f.b - f.a - 2, f.b - f.a, d));
      else if (f.type === 'startRamp') h += f.height * (1 - smoothstep(f.b - 9, f.b, s));
    }
    // Les modules s'effacent sur les côtés en pente douce, pour ne pas faire de mur si on passe au bord.
    h *= 1 - smoothstep(TRAIL_HALF + 0.2, TRAIL_HALF + 2.2, au);
    let bumps = 0;
    for (const r of roots) {
      const dd = s - r.s - r.skew * u;
      if (dd > -0.4 && dd < 0.4 && u > r.u0 && u < r.u1) bumps = Math.max(bumps, r.height * Math.exp(-((dd / r.r) ** 2)));
    }
    if (rocksRange && s > rocksRange.a - 1 && s < rocksRange.b + 1) {
      const lo = lowerBound(rocks, s - 1);
      for (let k = lo; k < rocks.length && rocks[k].s < s + 1; k++) {
        const rk = rocks[k];
        const q = ((s - rk.s) ** 2 + (u - rk.u) ** 2) / (rk.r * rk.r);
        if (q < 1) bumps = Math.max(bumps, rk.h * Math.pow(1 - q, 0.6));
      }
      // Entre les blocs, un lit de cailloux.
      const v = Math.max(0, vnoise(s * 1.4, u * 1.4 + 50, seed + 9) - 0.55) * 2;
      bumps = Math.max(bumps, 0.05 * v * smoothstep(rocksRange.a, rocksRange.a + 2, s) * (1 - smoothstep(rocksRange.b - 2, rocksRange.b, s)));
    }
    return h + bumps * (1 - smoothstep(TRAIL_HALF + 0.4, TRAIL_HALF + 1.2, au));
  }

  /** Hauteur du sol de la piste au point (s, u) du tracé. */
  function trailY(s, u) {
    const f = sample(s);
    const au = Math.abs(u);
    const uc = clamp(u, -2.8, 2.8);
    // Le profil en travers : légèrement creusé au milieu (la trace), relevé dans les virages.
    const rut = -0.05 * Math.exp(-((u / 1.1) ** 2));
    const yt = f.c - uc * Math.tan(f.bank) + rut + featureHeight(s, u);
    const w = smoothstep(2.9, 4.6, au);
    if (w <= 0) return yt;
    const xx = f.x + u * f.rx, zz = f.z + u * f.rz;
    const hn = terrainHeight(xx, zz, f.d, au) + 0.02;
    return yt + (hn - yt) * w;
  }

  // Le relief autour de la piste : il suit la piste de près, et retrouve la montagne plus loin.
  function terrainHeight(x, z, d, dist) {
    return natural(x, z) + d * (1 - smoothstep(4, 26, dist));
  }

  function surfaceAt(x, z) {
    const p = nearest(x, z, null, 0, 1);
    if (!p.inside || p.dist > TRAIL_HALF + 0.9) return SURFACES.herbe;
    const s = p.s;
    if (s < sStart - 0.5 && s > cpS[0]) return SURFACES.bois;
    if (rocksRange && s > rocksRange.a && s < rocksRange.b && p.dist < TRAIL_HALF + 0.3) return SURFACES.cailloux;
    for (const r of roots) {
      const dd = s - r.s - r.skew * p.u;
      if (dd > -r.r * 1.2 && dd < r.r * 1.2 && p.u > r.u0 && p.u < r.u1) return SURFACES.racines;
    }
    if (p.dist > TRAIL_HALF - 0.3) return SURFACES.poussiere; // les bords de la trace, plus meubles
    return SURFACES.terre;
  }

  // ---------- Les portes ----------
  const gates = [
    { kind: 'depart', s: sStart },
    { kind: 'point', s: seg(9, 10, 0.2) },
    { kind: 'point', s: seg(17, 18, 0.3) },
    { kind: 'point', s: seg(25, 26, 0.3) },
    { kind: 'arrivee', s: sFinish },
  ];
  const speedTrap = cpS[29] + 2; // juste avant le saut d'arrivée
  const spawnS = cpS[0] + 3; // dans la cabane de départ

  // ---------- Les limites et les arbres ----------
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    xmin = Math.min(xmin, X[i]); xmax = Math.max(xmax, X[i]); zmin = Math.min(zmin, Z[i]); zmax = Math.max(zmax, Z[i]);
  }
  const bounds = { xmin: xmin - 90, xmax: xmax + 90, zmin: zmin - 70, zmax: zmax + 60 };
  const arenaCenter = sample((arena.a + L) / 2);
  const startCenter = sample(cpS[0] + 6);

  const trees = [];
  const TREE_CELL = 4;
  const treeGrid = new Map();
  for (let k = 0; k < 26000; k++) {
    const x = bounds.xmin + rand() * (bounds.xmax - bounds.xmin);
    const z = bounds.zmin + rand() * (bounds.zmax - bounds.zmin);
    const p = nearest(x, z, null, 0, 5);
    const d = p.dist;
    // La forêt est dense, sauf autour du départ et dans l'aire d'arrivée ; les clairières viennent du bruit.
    const clearing = smoothstep(0.62, 0.75, vnoise(x / 40, z / 40, seed + 21));
    const open = Math.max(
      1 - smoothstep(30, 55, Math.hypot(x - arenaCenter.x, z - arenaCenter.z)),
      1 - smoothstep(18, 34, Math.hypot(x - startCenter.x, z - startCenter.z)),
    );
    let prob = d < 5.4 ? 0 : d < 10 ? 0.6 : d < 30 ? 0.3 : 0.12;
    prob *= (1 - clearing) * (1 - open);
    if (rand() > prob) continue;
    const h = 9 + rand() * 13, r = 0.18 + rand() * 0.22;
    const t = { x, z, y: terrainHeight(x, z, d < 30 ? sample(p.s).d : 0, d) - 0.15, h, r, hue: rand(), kind: rand() < 0.82 ? 'sapin' : 'feuillu' };
    trees.push(t);
    const kk = key(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL));
    let arr = treeGrid.get(kk);
    if (!arr) treeGrid.set(kk, (arr = []));
    arr.push(t);
  }
  /** Le tronc le plus proche à moins de `radius` mètres, ou null. */
  function treeNear(x, z, radius) {
    const cx = Math.floor(x / TREE_CELL), cz = Math.floor(z / TREE_CELL);
    let best = null, bd = Infinity;
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const arr = treeGrid.get(key(cx + ix, cz + iz));
      if (!arr) continue;
      for (const t of arr) {
        const d = Math.hypot(x - t.x, z - t.z) - t.r;
        if (d < radius && d < bd) { bd = d; best = t; }
      }
    }
    return best;
  }

  /** Hauteur du sol n'importe où (le relief, ou la piste si on est dessus). */
  function groundY(x, z) {
    const p = nearest(x, z, null, 0, 4);
    if (p.dist < RIBBON_HALF - 0.5 && p.inside) return trailY(p.s, clamp(p.u, -RIBBON_HALF, RIBBON_HALF));
    return terrainHeight(x, z, p.dist < 30 ? sample(p.s).d : 0, p.dist);
  }

  // ---------- Les maillages (partagés par l'affichage et la physique) ----------
  function buildTerrain() {
    const nx = Math.ceil((bounds.xmax - bounds.xmin) / TERRAIN_STEP) + 1;
    const nz = Math.ceil((bounds.zmax - bounds.zmin) / TERRAIN_STEP) + 1;
    const positions = new Float32Array(nx * nz * 3);
    const trail = new Float32Array(nx * nz); // 1 sur la piste, 0 loin d'elle : sert à l'affichage
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = bounds.xmin + i * TERRAIN_STEP, z = bounds.zmin + j * TERRAIN_STEP;
      const p = nearest(x, z, null, 0, 4);
      let y = terrainHeight(x, z, p.dist < 30 && Number.isFinite(p.dist) ? sample(p.s).d : 0, p.dist);
      if (p.dist < RIBBON_HALF - 0.6 && p.inside) y = Math.min(y, trailY(p.s, clamp(p.u, -RIBBON_HALF, RIBBON_HALF)) - 0.25);
      const o = (j * nx + i) * 3;
      positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
      trail[j * nx + i] = Number.isFinite(p.dist) ? 1 - smoothstep(3, 9, p.dist) : 0;
    }
    const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let k = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
    return { positions, indices, trail, nx, nz };
  }

  function buildRibbon() {
    const rows = n, cols = Math.round((2 * RIBBON_HALF) / RIBBON_DU) + 1;
    const positions = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2); // (u, s) en mètres : sert aux textures
    for (let r = 0; r < rows; r++) {
      const s = r * DS, f = sample(s);
      for (let c = 0; c < cols; c++) {
        const u = -RIBBON_HALF + c * RIBBON_DU;
        const o = (r * cols + c) * 3;
        positions[o] = f.x + u * f.rx; positions[o + 1] = trailY(s, u); positions[o + 2] = f.z + u * f.rz;
        uv[(r * cols + c) * 2] = u; uv[(r * cols + c) * 2 + 1] = s;
      }
    }
    const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      // Le tracé descend vers -z et u croît vers la droite : cet ordre donne des faces tournées vers le haut.
      indices[k++] = a; indices[k++] = b; indices[k++] = cc;
      indices[k++] = b; indices[k++] = d; indices[k++] = cc;
    }
    return { positions, uv, indices, rows, cols };
  }

  return {
    seed, length: L, count: n, DS, X, Z, TX, TZ, K, C, BANK, D,
    natural, terrainHeight, groundY, trailY, sample, nearest, surfaceAt, featureHeight,
    features, roots, rocks, gates, speedTrap, sStart, sFinish, spawnS, controlS: cpS,
    bounds, trees, treeNear, buildTerrain, buildRibbon,
  };
}

function profileAt(prof, d) {
  const fi = d / DS;
  const i = Math.floor(fi);
  if (i < 0 || i >= prof.length - 1) return 0;
  return prof[i] + (prof[i + 1] - prof[i]) * (fi - i);
}

function lowerBound(arr, s) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].s < s) lo = m + 1; else hi = m; }
  return lo;
}
