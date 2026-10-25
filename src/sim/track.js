// La piste : un tracé de descente façon Coupe du monde, construit à partir d'une carte (maps.js).
// Repère : x vers la droite, y vers le haut, la descente part vers -z (l'avant d'un objet three.js).
// Tout est déterministe et sans navigateur : le jeu et les tests construisent exactement la même piste.

import { CatmullRomCurve3, Vector3 } from 'three';
import { rng, vnoise, fbm, clamp, smoothstep } from './noise.js';
import { MAPS } from './maps.js';

export const DS = 0.25; // pas d'échantillonnage du tracé, en mètres
export const RIBBON_HALF = 6; // demi-largeur du maillage fin de la piste
export const TRAIL_HALF = 2.4; // demi-largeur de la partie roulante
export const TAPE_U = 3.4; // la rubalise, de chaque côté
const RIBBON_DU = 0.4;
const TERRAIN_STEP = 1.5;
const G_TRACK = 9.81;

// grip : multiplie le grip du pneu (1 = terre tassée).
export const SURFACES = {
  terre: { name: 'terre', grip: 1.0, crr: 0.02 },
  poussiere: { name: 'terre sèche', grip: 0.88, crr: 0.025 },
  cailloux: { name: 'cailloux', grip: 0.85, crr: 0.04 },
  racines: { name: 'racines', grip: 0.62, crr: 0.03 },
  bois: { name: 'bois', grip: 0.9, crr: 0.015 },
  herbe: { name: 'herbe', grip: 0.75, crr: 0.07 },
  gravier: { name: 'gravier', grip: 0.86, crr: 0.03 }, // la piste au-dessus des arbres : terre et graviers roulants
  roche: { name: 'roche', grip: 1.0, crr: 0.012 }, // une dalle de granit, sèche
  neige: { name: 'neige', grip: 0.72, crr: 0.02 }, // la trace damée du glacier : ça glisse, mais ça file
  neigeMolle: { name: 'neige molle', grip: 0.62, crr: 0.06 }, // à côté de la trace : on s'enfonce et on ralentit
  paves: { name: 'pavés', grip: 0.82, crr: 0.016 },
  eau: { name: 'eau', grip: 0.72, crr: 0.16 }, // le gué : quelques mètres dans le torrent
};

/** mapId : une des cartes de maps.js ('foret' par défaut). */
export function createTrack(seed = 7, mapId = 'foret') {
  const map = MAPS[mapId] || MAPS.foret;
  const rand = rng(seed);
  const CONTROL = map.control;

  // ---------- Le relief naturel ----------
  const natural = map.relief(seed);

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
  const layout = map.layout({ cpS, seg, L });
  const { sStart, sFinish, features, gates, speedTrap, spawnS } = layout;
  for (const f of features) if (f.type === 'jump') f.b = f.a + 40; // provisoire : la vraie longueur vient du profil
  const featureOf = (type) => features.filter((f) => f.type === type);

  // Les racines : des bourrelets en travers, un peu en biais.
  const roots = [];
  for (const [a, b] of layout.roots || []) {
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
  const rockRanges = featureOf('rocks');
  const inRocks = (s, margin = 0) => rockRanges.find((f) => s > f.a - margin && s < f.b + margin);

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
  // (sauf dans une remontée : là, la piste monte vraiment avec le relief)
  const climbs = featureOf('climb');
  const inClimb = (s) => climbs.some((f) => s > f.a && s < f.b);
  for (let i = 1; i < n; i++) if (!inClimb(i * DS)) C[i] = Math.min(C[i], C[i - 1] - 0.015 * DS);
  // Écart entre la piste et le relief naturel : on le reporte sur les côtés pour que la pente suive la piste.
  const D = new Float32Array(n);
  for (let i = 0; i < n; i++) D[i] = C[i] - natural(X[i], Z[i]);
  // Sous un pont, le relief ne suit pas la piste : le ravin reste ouvert. DF est l'écart reporté sur les côtés. (Une
  // passerelle North Shore, style 'shore', est posée sur la piste : le sol reste au niveau de la piste, en dessous.)
  const bridges = featureOf('bridge');
  const DF = D.slice();
  for (const f of bridges) {
    if (f.style === 'shore') continue;
    for (let i = Math.max(0, Math.floor((f.a - 8) / DS)); i <= Math.min(n - 1, Math.ceil((f.b + 8) / DS)); i++) {
      const s = i * DS;
      DF[i] *= 1 - smoothstep(f.a - 7, f.a - 1, s) * (1 - smoothstep(f.b + 1, f.b + 7, s));
    }
  }
  /** 1 sur le tablier d'un pont, 0 ailleurs. */
  const onBridge = (s) => {
    for (const f of bridges) if (s > f.a - 1 && s < f.b + 1) return smoothstep(f.a - 1, f.a + 1, s) * (1 - smoothstep(f.b - 1, f.b + 1, s));
    return 0;
  };
  /** La demi-largeur du tablier du pont en s (1,9 m, ou f.half pour une passerelle étroite). */
  const bridgeHalf = (s) => {
    for (const f of bridges) if (s > f.a - 1 && s < f.b + 1) return f.half ?? 1.9;
    return 1.9;
  };

  // ---------- Les sauts, dessinés d'après la trajectoire ----------
  // On calcule la trajectoire d'un pilote qui décolle à la vitesse prévue. Il passe f.clear mètres au-dessus de l'arête
  // de réception (f.knuckle mètres après la lèvre), puis la réception rejoint sa trajectoire en douceur : à cette vitesse,
  // il se pose sans choc. Plus lent, il se pose sur l'arête ; plus vite, plus bas, sur une pente encore plus raide.
  const baseAt = (s) => {
    const fi = clamp(s / DS, 0, n - 1.0001), i = Math.floor(fi), t = fi - i;
    return C[i] + (C[i + 1] - C[i]) * t;
  };
  // Le raccord ne doit pas écraser le pilote : sa courbure (le changement de pente par mètre) reste sous 0,16. Dans une
  // pente raide, la réception d'un drop finit bien en dessous de la pente, et un raccord trop court devrait remonter
  // pour la rejoindre : on l'allonge.
  const runoutLength = (f, end) => {
    const curv = (Lr) => Math.max(Math.abs((-6 * end.h) / (Lr * Lr) - (4 * end.m) / Lr), Math.abs((6 * end.h) / (Lr * Lr) + (2 * end.m) / Lr));
    let Lr = f.runout ?? 18;
    while (curv(Lr) > 0.16 && Lr < 60) Lr += 1;
    return Lr;
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
    for (let d = 0; d <= 160; d += DS) {
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
          // (sous un ruisseau, le fond est à plat : c'est le lit de l'eau)
          const road = (f.look === 'ruisseau' ? baseAt(lipS + f.knuckle / 2) : baseAt(sd)) + f.dip;
          y = x < f.knuckle / 2 ? yLip + (road - yLip) * smoothstep(0, 1.4, x) : road + (yK - road) * smoothstep(f.knuckle - 1.6, f.knuckle, x);
        }
        h = y - baseAt(sd);
        // Au bout de la réception, on revient à la pente en douceur (f.dig : au plus tard quand la réception passe à
        // f.dig mètres sous la pente, pour ne pas creuser une fosse).
        if (x > touch + lineLen || (f.dig != null && x > touch && h < -f.dig)) {
          end = { d, h, m: (h - prof[prof.length - 1]) / DS };
          end.Lr = runoutLength(f, end);
        }
      } else {
        // Le raccord part avec la pente de la réception (pas de cassure) et rejoint la pente naturelle sur 18 m :
        // à 13 m/s, un changement de pente trop court écrase la suspension.
        const Lr = end.Lr, t = Math.min(1, (d - end.d) / Lr);
        h = end.h * (2 * t ** 3 - 3 * t * t + 1) + end.m * Lr * (t ** 3 - 2 * t * t + t);
        if (d > end.d + Lr) break;
      }
      prof.push(h);
    }
    f.prof = Float32Array.from(prof);
    f.b = f.a + (prof.length - 1) * DS;
    f.lipS = lipS;
    // Un module en bois (look 'bois', façon North Shore) : la lèvre, et pour un gap la réception, sont des planches.
    if (f.look === 'bois') {
      f.wood = [[f.a + 0.5, lipS]];
      if (f.kind === 'gap') f.wood.push([lipS + f.knuckle - 1.2, lipS + touch + lineLen * 0.7]);
      if (f.kind === 'drop') f.wood[0][0] = f.a - 4; // (un tablier qui part de plus loin, à plat, avant de monter)
    }
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
    return { x: lerp(X), z: lerp(Z), tx, tz, rx: -tz, rz: tx, c: lerp(C), bank: lerp(BANK), k: lerp(K), d: lerp(DF) };
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
      // Les marches : des paliers à plat (à la hauteur du début de chaque marche), une contremarche tous les f.step m.
      else if (f.type === 'stairs') h += baseAt(f.a + f.step * Math.floor(d / f.step)) - baseAt(s);
      // Le gué : la piste plonge dans le lit du torrent.
      else if (f.type === 'ford') h -= f.depth * Math.sin((Math.PI * d) / (f.b - f.a)) ** 2;
      // La passerelle North Shore : une rampe de planches, le tablier à f.raise m au-dessus du sol, une rampe pour en
      // redescendre (sur les côtés, le sol reste en bas : c'est l'arête franche du pont qui s'en charge).
      else if (f.type === 'bridge' && f.raise) h += f.raise * smoothstep(0, f.ramp ?? 5, d) * (1 - smoothstep(f.b - f.a - (f.ramp ?? 5), f.b - f.a, d));
    }
    // Les modules s'effacent sur les côtés en pente douce, pour ne pas faire de mur si on passe au bord (sauf une
    // passerelle : son bord est franc, voir trailY).
    h *= 1 - smoothstep(TRAIL_HALF + 0.2, TRAIL_HALF + 2.2, au);
    let bumps = 0;
    for (const r of roots) {
      const dd = s - r.s - r.skew * u;
      if (dd > -0.4 && dd < 0.4 && u > r.u0 && u < r.u1) bumps = Math.max(bumps, r.height * Math.exp(-((dd / r.r) ** 2)));
    }
    const rocksRange = inRocks(s, 1);
    if (rocksRange) {
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
    // Sur un pont, le bord est franc : au-delà du tablier, c'est le ravin.
    const bw = bridges.length ? onBridge(s) : 0, half = bw ? bridgeHalf(s) : 1.9;
    const w = smoothstep(2.9 - bw * (2.9 - half), 4.6 - bw * (3.9 - half), au);
    if (w <= 0) return yt;
    const xx = f.x + u * f.rx, zz = f.z + u * f.rz;
    const hn = terrainHeight(xx, zz, f.d, au) + 0.02;
    return yt + (hn - yt) * w;
  }

  // Le relief autour de la piste : il suit la piste de près, et retrouve la montagne plus loin.
  function terrainHeight(x, z, d, dist) {
    return natural(x, z) + d * (1 - smoothstep(4, 26, dist));
  }

  // Le sol de la piste par tronçons : dalles et ponts sur toute la largeur, graviers en altitude…
  const zones = [
    ...bridges.map((f) => ({ a: f.a, b: f.b, surface: SURFACES.bois, whole: true })),
    ...features.filter((f) => f.wood).flatMap((f) => f.wood.map(([a, b]) => ({ a, b, surface: SURFACES.bois, whole: true }))),
    ...featureOf('slab').map((f) => ({ a: f.a, b: f.b, surface: SURFACES.roche, whole: true })),
    // (la lèvre d'un drop sans autre habillage : une dalle de granit)
    ...featureOf('jump').filter((f) => f.kind === 'drop' && !f.look).map((f) => ({ a: f.a + 0.5, b: f.lipS + 0.4, surface: SURFACES.roche, whole: true })),
    ...featureOf('ford').map((f) => ({ a: f.a, b: f.b, surface: SURFACES.eau, whole: true })),
    ...featureOf('road').map((f) => ({ a: f.a, b: f.b, surface: SURFACES.gravier, whole: true })),
    ...(layout.surfaces || []).map((z) => ({ a: z.a, b: z.b, surface: SURFACES[z.surface], edge: z.edge && SURFACES[z.edge], off: z.off && SURFACES[z.off] })),
  ];
  const zoneAt = (s) => zones.find((z) => s >= z.a && s <= z.b) || null;

  // La largeur balisée : la rubalise à TAPE_U, sauf sur les tronçons larges (le glacier), balisés de piquets plus loin,
  // et dans les passages étroits, où la rubalise serre la trace (un single entre les arbres ou les blocs).
  const wides = layout.wide || [];
  const narrows = layout.narrow || [];
  const NARROW_RAMP = 8; // m : la rubalise se resserre sur cette distance
  /** 1 au cœur d'un passage étroit, 0 hors des passages étroits ; et sa demi-largeur. */
  function narrowAt(s) {
    let k = 0, half = TAPE_U;
    for (const w of narrows) {
      if (s < w.a - NARROW_RAMP || s > w.b + NARROW_RAMP) continue;
      const kk = smoothstep(w.a - NARROW_RAMP, w.a, s) * (1 - smoothstep(w.b, w.b + NARROW_RAMP, s));
      if (kk > k) { k = kk; half = w.half; }
    }
    return { k, half };
  }
  /** La demi-largeur balisée à la distance s. */
  function tapeAt(s) {
    let t = TAPE_U;
    for (const w of wides) {
      if (s < w.a || s > w.b) continue;
      const k = smoothstep(w.a, w.a + (w.open ?? 10), s) * (1 - smoothstep(w.b - (w.close ?? 10), w.b, s));
      t = Math.max(t, TAPE_U + (w.half - TAPE_U) * k);
    }
    const nw = narrowAt(s);
    if (nw.k > 0) t += (Math.min(t, nw.half) - t) * nw.k;
    return t;
  }
  /** La demi-largeur de la trace (la partie roulée, tassée) : plus fine dans un passage étroit. */
  const trailHalfAt = (s) => { const nw = narrowAt(s); return TRAIL_HALF + (Math.max(0.75, nw.half - 0.45) - TRAIL_HALF) * nw.k; };
  // Sur un tronçon large, la trace damée fait plus que la piste habituelle.
  const traceAt = (s) => Math.max(TRAIL_HALF - 0.3, Math.min(5, tapeAt(s) - 3));
  /** La vitesse que s'autorise le pilote auto à la distance s (13 m/s, sauf là où la carte lâche les freins). */
  const vmaxAt = (s) => { for (const f of layout.fast || []) if (s >= f.a && s <= f.b) return f.vmax; return 13; };

  function surfaceAt(x, z) {
    const p = nearest(x, z, null, 0, wides.length ? 4 : 1);
    const s = p.s;
    const th = trailHalfAt(s);
    if (!p.inside || p.dist > th + 0.9) {
      // À côté de la piste : l'herbe, ou ce qui couvre tout le tronçon (la neige du glacier).
      const zone = Number.isFinite(p.dist) ? zoneAt(s) : null;
      return zone && zone.off && p.dist < tapeAt(s) + 6 ? (p.dist < traceAt(s) ? zone.surface : zone.off) : SURFACES.herbe;
    }
    if (s < sStart - 0.5 && s > cpS[0]) return SURFACES.bois;
    if (inRocks(s) && p.dist < TRAIL_HALF + 0.3) return SURFACES.cailloux;
    for (const r of roots) {
      const dd = s - r.s - r.skew * p.u;
      if (dd > -r.r * 1.2 && dd < r.r * 1.2 && p.u > r.u0 && p.u < r.u1) return SURFACES.racines;
    }
    const zone = zoneAt(s);
    if (zone && zone.whole) return zone.surface;
    if (zone && zone.off) return p.dist < traceAt(s) ? zone.surface : zone.edge || zone.surface;
    if (p.dist > th - 0.3) return zone ? zone.edge || zone.surface : SURFACES.poussiere; // les bords de la trace, plus meubles
    return zone ? zone.surface : SURFACES.terre;
  }

  // ---------- Les points où l'on repart après une chute ----------
  // Les portes, plus un point tous les 150 m environ, jamais sur un saut, dans un pierrier ou sur un pont.
  const busy = (s) => features.some((f) => ['jump', 'rocks', 'bridge', 'slab', 'stairs', 'ford'].includes(f.type) && s > f.a - 6 && s < f.b + 2);
  const respawns = gates.slice(0, -1).map((g) => g.s);
  for (let s = sStart + 150; s < sFinish - 60; s += 150) {
    let p = s;
    while (busy(p) && p < s + 60) p += 2;
    if (!busy(p) && respawns.every((r) => Math.abs(r - p) > 40)) respawns.push(p);
  }
  respawns.sort((a, b) => a - b);

  // ---------- Les limites et les arbres ----------
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    xmin = Math.min(xmin, X[i]); xmax = Math.max(xmax, X[i]); zmin = Math.min(zmin, Z[i]); zmax = Math.max(zmax, Z[i]);
  }
  const bounds = { xmin: xmin - 90, xmax: xmax + 90, zmin: zmin - 70, zmax: zmax + 60 };
  const arenaCenter = sample((arena.a + L) / 2);
  const startCenter = sample(cpS[0] + 6);

  // La distance au tracé, approchée (à 3 m près) sur une grille de 6 m, jusqu'à 120 m : pour la bande de relief détaillé
  // des longues pistes, et tout ce qui doit savoir si on est près de la piste sans chercher le point le plus proche.
  const DCELL = 6, DMAX = 120;
  const dnx = Math.ceil((bounds.xmax - bounds.xmin + 2 * DMAX) / DCELL) + 1, dnz = Math.ceil((bounds.zmax - bounds.zmin + 2 * DMAX) / DCELL) + 1;
  const dist = new Float32Array(dnx * dnz).fill(Infinity), distS = new Float32Array(dnx * dnz);
  for (let i = 0; i < n; i += 8) {
    const ci = Math.round((X[i] - bounds.xmin + DMAX) / DCELL), cj = Math.round((Z[i] - bounds.zmin + DMAX) / DCELL), R = Math.ceil(DMAX / DCELL);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const a = ci + di, b = cj + dj;
      if (a < 0 || b < 0 || a >= dnx || b >= dnz) continue;
      const d = Math.hypot(bounds.xmin - DMAX + a * DCELL - X[i], bounds.zmin - DMAX + b * DCELL - Z[i]);
      if (d < dist[b * dnx + a]) { dist[b * dnx + a] = d; distS[b * dnx + a] = i * DS; }
    }
  }
  /** La distance approchée au tracé (Infinity au-delà de 120 m). */
  function trailDist(x, z) {
    const fx = (x - bounds.xmin + DMAX) / DCELL, fz = (z - bounds.zmin + DMAX) / DCELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= dnx - 1 || j >= dnz - 1) return Infinity;
    const tx = fx - i, tz = fz - j, a = dist[j * dnx + i], b = dist[j * dnx + i + 1], c = dist[(j + 1) * dnx + i], d = dist[(j + 1) * dnx + i + 1];
    if (!Number.isFinite(a + b + c + d)) return Math.min(a, b, c, d) + DCELL;
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  /** La distance le long de la piste du point de piste le plus proche, approchée (à la même échelle). */
  function trailS(x, z) {
    const i = Math.round((x - bounds.xmin + DMAX) / DCELL), j = Math.round((z - bounds.zmin + DMAX) / DCELL);
    return i < 0 || j < 0 || i >= dnx || j >= dnz ? 0 : distS[j * dnx + i];
  }
  const FAR = { s: 0, u: 0, dist: Infinity, inside: false }; // « loin de la piste », sans chercher
  // Une longue piste n'a de relief détaillé (et d'arbres, de décor) que dans une bande autour d'elle.
  const band = map.band ?? null;
  /** Un point au hasard : dans le rectangle de la piste, ou dans sa bande. */
  const randomPoint = () => {
    if (band === null) return [bounds.xmin + rand() * (bounds.xmax - bounds.xmin), bounds.zmin + rand() * (bounds.zmax - bounds.zmin)];
    const f = sample(rand() * L), u = (rand() * 2 - 1) * band;
    return [f.x + u * f.rx, f.z + u * f.rz];
  };

  // ---------- Le village : des maisons de pierre de part et d'autre de la ruelle ----------
  const buildings = [];
  if (layout.village) {
    const V = layout.village;
    for (const side of [-1, 1]) {
      for (let s = V.a + rand() * 3; s < V.b; ) {
        const w = 6 + rand() * 4, d = 7 + rand() * 2.5, h = 5.2 + rand() * 3, set = 5.2 + rand() * 1.8;
        const sc = s + w / 2;
        // Pas sur la place de l'arrivée (seulement autour, plus loin), ni trop près de la ruelle dans un virage.
        const onSquare = sc > arena.a + 6;
        const u0 = onSquare ? 15 + rand() * 4 : set;
        const f = sample(sc);
        const cx = f.x + side * (u0 + d / 2) * f.rx, cz = f.z + side * (u0 + d / 2) * f.rz;
        const yaw = Math.atan2(-f.tx, -f.tz);
        // Les coins ne doivent pas toucher la piste.
        let ok = true, ymin = Infinity;
        for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
          const x = cx + a * f.tx + b * side * f.rx, z = cz + a * f.tz + b * side * f.rz;
          const q = nearest(x, z, sc, 40);
          if (q.dist < TAPE_U + 1.2) ok = false;
          ymin = Math.min(ymin, natural(x, z) + D[Math.floor(q.s / DS)] * (1 - smoothstep(4, 26, q.dist)));
        }
        if (ok && rand() > 0.12) buildings.push({ x: cx, z: cz, y: ymin - 0.6, w, d, h: h + 0.6, yaw, side, roof: rand(), hue: rand() });
        s += w + 0.6 + rand() * 3.5;
      }
    }
  }
  const nearBuilding = (x, z, m) => buildings.some((b) => Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) / 2 + m);

  const trees = [];
  // Une carte peut choisir ses essences (kind), leur densité (density) et leur hauteur (height) : voir maps.js.
  const T = map.trees;
  const treeline = T.treeline ?? null;
  // Plus haut, rien que des sapins ; en bas des montagnes, plus de feuillus.
  const sapinShare = (y) => (treeline === null ? 0.82 : 0.6 + 0.4 * smoothstep(treeline - 160, treeline - 40, y));
  const TREE_CELL = 4;
  const treeGrid = new Map();
  for (let k = 0; k < map.trees.tries; k++) {
    const [x, z] = randomPoint();
    if (buildings.length && nearBuilding(x, z, 3)) continue;
    const p = band !== null && trailDist(x, z) > 48 ? FAR : nearest(x, z, null, 0, 5);
    const d = p.dist;
    // La forêt est dense, sauf autour du départ et dans l'aire d'arrivée ; les clairières viennent du bruit.
    const clearing = smoothstep(0.62, 0.75, vnoise(x / 40, z / 40, seed + 21));
    const open = Math.max(
      1 - smoothstep(30, 55, Math.hypot(x - arenaCenter.x, z - arenaCenter.z)),
      1 - smoothstep(18, 34, Math.hypot(x - startCenter.x, z - startCenter.z)),
    );
    const ground = terrainHeight(x, z, d < 30 ? sample(p.s).d : 0, d);
    let prob = T.density ? T.density(d, x, z, clearing, ground) : (d < 5.4 ? 0 : d < 10 ? 0.6 : d < 30 ? 0.3 : 0.12) * (1 - clearing);
    prob *= 1 - open;
    // En montagne, la forêt s'arrête vers une altitude (la limite est irrégulière) ; juste en dessous, les arbres
    // rapetissent, au-dessus il n'en reste que quelques-uns, isolés.
    let stunt = 0;
    if (treeline !== null && prob > 0) {
      const yt = treeline + 16 * fbm(x / 70, z / 70, 2, seed + 41);
      prob *= Math.max(1 - smoothstep(yt - 12, yt + 8, ground), 0.05 * (1 - smoothstep(yt + 8, yt + 50, ground)));
      stunt = smoothstep(yt - 35, yt + 10, ground);
    }
    if (rand() > prob) continue;
    const h = (9 + rand() * 13) * (1 - 0.55 * stunt), r = (0.18 + rand() * 0.22) * (1 - 0.4 * stunt);
    const hue = rand(), pick = rand();
    const kind = T.kind ? T.kind(pick, ground, d) : pick < sapinShare(ground) ? 'sapin' : 'feuillu';
    const t = { x, z, y: ground - 0.15, h: T.height ? T.height(kind, h, hue) : h, r, hue, kind };
    trees.push(t);
    const kk = key(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL));
    let arr = treeGrid.get(kk);
    if (!arr) treeGrid.set(kk, (arr = []));
    arr.push(t);
  }
  // Les passages étroits sont bordés : des troncs (en forêt) ou des blocs (en altitude), juste derrière la rubalise, de
  // chaque côté. Ce sont des obstacles comme les autres : on s'y arrête net. (Un tirage à part : le reste de la forêt
  // ne change pas.)
  const boulders = [];
  {
    const r2 = rng(seed + 977);
    for (const w of narrows) {
      if (!w.edge) continue;
      for (const side of [-1, 1]) {
        for (let s = w.a - 2; s < w.b + 2; s += (w.edge === 'arbres' ? 3.2 : 2.6) + r2() * (w.edge === 'arbres' ? 3.5 : 2.4)) {
          // (un bloc ou un tronc a son rayon : on le pose assez loin pour qu'il ne déborde pas sur la rubalise, et qu'une
          // roue qui la frôle, dans une épingle, ne le touche pas)
          const r = w.edge === 'arbres' ? 0.2 + r2() * 0.2 : 0.45 + r2() * r2() * 0.9;
          const f = sample(s), u = side * (w.half + (w.edge === 'arbres' ? 0.55 + r : 0.45 + r * 0.95) + r2() * (w.edge === 'arbres' ? 1.4 : 0.6));
          const x = f.x + u * f.rx, z = f.z + u * f.rz;
          // (le sol qu'on voit : dans une traversée, la piste est entaillée dans la pente ; côté amont, le relief naturel
          // est plus haut que le bord de la piste, et un tronc posé dessus flotterait)
          const ground = Math.min(terrainHeight(x, z, f.d, Math.abs(u)), trailY(s, u));
          if (w.edge === 'arbres') {
            if (treeNear(x, z, 0.8)) continue;
            const h = 11 + r2() * 12, hue = r2(), pick = r2();
            const kind = T.edgeKind ? T.edgeKind(pick) : pick < 0.85 ? 'sapin' : 'feuillu';
            const t = { x, z, y: ground - 0.15, h: T.height ? T.height(kind, h, hue) : h, r, hue, kind };
            trees.push(t);
            const kk = key(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL));
            let arr = treeGrid.get(kk);
            if (!arr) treeGrid.set(kk, (arr = []));
            arr.push(t);
          } else {
            boulders.push({ x, z, y: ground, r, h: r * (0.9 + r2() * 0.6), s, u, seed: r2() });
          }
        }
      }
    }
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
    if (band !== null) return buildBandTerrain();
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

  // La même grille, mais seulement à moins de `band` mètres de la piste. Renvoie aussi les arêtes du bord (paires de
  // sommets), pour la jupe qui cache la marche avec le relief lointain.
  function buildBandTerrain() {
    const nx = Math.ceil((bounds.xmax - bounds.xmin) / TERRAIN_STEP) + 1;
    const nz = Math.ceil((bounds.zmax - bounds.zmin) / TERRAIN_STEP) + 1;
    const id = new Int32Array(nx * nz).fill(-1);
    const pos = [], trailW = [], sOf = [], dOf = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = bounds.xmin + i * TERRAIN_STEP, z = bounds.zmin + j * TERRAIN_STEP;
      const td = trailDist(x, z);
      if (td > band + TERRAIN_STEP * 2) continue;
      const p = td < 40 ? nearest(x, z, null, 0, 4) : FAR;
      let y = terrainHeight(x, z, p.dist < 30 && Number.isFinite(p.dist) ? sample(p.s).d : 0, p.dist);
      // Sur un tronçon large, on roule aussi à côté de la piste fine : le relief l'épouse (juste dessous), sans marche
      // à son bord. Ailleurs, il passe 25 cm dessous (les modules de la piste sont plus fins que sa grille).
      if (p.inside && p.dist < RIBBON_HALF && tapeAt(p.s) > 5) y = trailY(p.s, clamp(p.u, -RIBBON_HALF, RIBBON_HALF)) - 0.06 * (1 - smoothstep(4.6, RIBBON_HALF, p.dist));
      else if (p.dist < RIBBON_HALF - 0.6 && p.inside) y = Math.min(y, trailY(p.s, clamp(p.u, -RIBBON_HALF, RIBBON_HALF)) - 0.25);
      id[j * nx + i] = pos.length / 3;
      pos.push(x, y, z);
      trailW.push(Number.isFinite(p.dist) ? 1 - smoothstep(3, 9, p.dist) : 0);
      // (pour l'affichage : où l'on est le long de la piste, et à quelle distance)
      if (Number.isFinite(p.dist)) { sOf.push(p.s); dOf.push(p.dist); } else { sOf.push(trailS(x, z)); dOf.push(trailDist(x, z)); }
    }
    const quad = (i, j) => i >= 0 && j >= 0 && i < nx - 1 && j < nz - 1 && id[j * nx + i] >= 0 && id[j * nx + i + 1] >= 0 && id[(j + 1) * nx + i] >= 0 && id[(j + 1) * nx + i + 1] >= 0
      && trailDist(bounds.xmin + (i + 0.5) * TERRAIN_STEP, bounds.zmin + (j + 0.5) * TERRAIN_STEP) < band;
    const indices = [], edges = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      if (!quad(i, j)) continue;
      const a = id[j * nx + i], b = id[j * nx + i + 1], c = id[(j + 1) * nx + i], d = id[(j + 1) * nx + i + 1];
      indices.push(a, c, b, b, c, d);
      // Un côté sans voisin est un bord.
      if (!quad(i, j - 1)) edges.push(a, b);
      if (!quad(i, j + 1)) edges.push(c, d);
      if (!quad(i - 1, j)) edges.push(a, c);
      if (!quad(i + 1, j)) edges.push(b, d);
    }
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(indices), trail: Float32Array.from(trailW), edges: Uint32Array.from(edges), sOf: Float32Array.from(sOf), dOf: Float32Array.from(dOf), nx, nz, band: true };
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
    seed, map: { id: map.id, name: map.name, env: map.env, creek: map.creek || null, peloton: map.peloton || null, lift: map.lift || null, scenery: map.scenery || null }, length: L, count: n, DS, X, Z, TX, TZ, K, C, BANK, D,
    natural, terrainHeight, groundY, trailY, sample, nearest, surfaceAt, featureHeight, tapeAt, trailHalfAt, narrowAt, narrows, vmaxAt, trailDist, trailS, band,
    features, roots, rocks, bridges, onBridge, gates, respawns, speedTrap, sStart, sFinish, spawnS, controlS: cpS,
    bounds, trees, treeNear, boulders, buildings, village: layout.village || null, surfaces: layout.surfaces || [], buildTerrain, buildRibbon,
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
