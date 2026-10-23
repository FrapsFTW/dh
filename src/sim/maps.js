// Les cartes : chaque piste est un tracé (points de passage), un relief, et la liste de ses modules.
// track.js en fait le maillage, la physique et le décor ; rien ici ne dépend du navigateur.
//
// Une carte donne :
//   control : les points de passage (x, z), du haut vers le bas (la descente part vers -z) ;
//   relief(seed) : la montagne avant la piste, une fonction (x, z) → hauteur ;
//   layout({ cpS, seg, L }) : où sont le départ, l'arrivée, les modules, les racines, les portes (cpS[i] est la
//     distance du i-ème point de passage le long du tracé ; seg(i, j, f) une distance entre deux points) ;
//   trees : la densité de la forêt et, en montagne, la limite des arbres ;
//   env : ce que l'affichage doit savoir (limite des arbres, montagnes à l'horizon).

import { fbm, smoothstep } from './noise.js';

const softplus = (v) => (v > 20 ? v : Math.log1p(Math.exp(v)));

// ---------------------------------------------------------------------------------------------------------------
// La Forêt : la première piste, courte et dense, façon Coupe du monde en forêt.
//   cabane de départ et rampe · schuss · virages relevés · bosses à pomper · épingle · traversée de racines en dévers
//   · pierrier dans la pente raide · drop · deux épingles · deux tables · road gap · virage final · saut d'arrivée.
// ---------------------------------------------------------------------------------------------------------------
const foret = {
  id: 'foret',
  name: 'La Forêt',
  blurb: '884 m, 181 m de dénivelé, environ 1 min 20. Courte et dense, en forêt : épingles, racines, pierrier, drop, road gap.',
  control: [
    [0, 34], [0, 18], [0, -20], [3, -55], [16, -80], [40, -92], [72, -100], [96, -110], [104, -124], [96, -137],
    [70, -146], [42, -154], [18, -168], [6, -190], [2, -222], [-2, -252], [-10, -272], [-32, -286], [-58, -294],
    [-70, -306], [-62, -320], [-36, -330], [-8, -338], [8, -354], [12, -384], [8, -420], [0, -452], [-4, -482],
    [4, -512], [20, -532], [26, -556], [26, -596], [26, -630],
  ],
  // La pente générale (30 %) s'adoucit en bas, dans le fond de vallée (sous z = -575) où se trouve l'aire d'arrivée.
  relief(seed) {
    const SLOPE = 0.3, VALLEY_Z = 575;
    const valley = (z) => SLOPE * z + (SLOPE - 0.05) * 8 * softplus(-(z + VALLEY_Z) / 8);
    return (x, z) => valley(z) + 5.0 * fbm(x / 80, z / 80, 4, seed) + 0.7 * fbm(x / 14, z / 14, 2, seed + 5) + 0.0005 * x * x;
  },
  layout({ cpS, seg, L }) {
    const sStart = cpS[1] + 1; // la ligne de départ, au pied de la rampe
    return {
      sStart,
      sFinish: cpS[31] - 4,
      spawnS: cpS[0] + 3, // dans la cabane de départ
      speedTrap: cpS[29] + 2, // juste avant le saut d'arrivée
      features: [
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
      ],
      // Les racines : dans la traversée en dévers et sous les sapins.
      roots: [[seg(9, 10, 0.3), seg(12, 13, 0.2)], [seg(19, 20, 0.6), seg(21, 22, 0.5)]],
      gates: [
        { kind: 'depart', s: sStart },
        { kind: 'point', s: seg(9, 10, 0.2) },
        { kind: 'point', s: seg(17, 18, 0.3) },
        { kind: 'point', s: seg(25, 26, 0.3) },
        { kind: 'arrivee', s: cpS[31] - 4 },
      ],
    };
  },
  trees: { tries: 26000 },
  env: { treeline: null, mountains: 1 },
};

// ---------------------------------------------------------------------------------------------------------------
// La Grande Combe : une longue descente de montagne, en trois tiers comme à Fort William.
//   En haut, au-dessus des arbres : la crête, la dalle, le grand pierrier, les lacets dans la face.
//   Au milieu, la forêt : le toboggan dans les racines, le pont du torrent, le pierrier du bois, la marche.
//   En bas, l'autoroute : un bike park rapide, virages relevés, tables, step-down, road gap, saut d'arrivée.
// ---------------------------------------------------------------------------------------------------------------
const ALP_CONTROL = [
  // la cabane, sur la crête, et la crête
  [0, 46], [0, 30], [0, 0], [-5, -35], [-4, -70], [8, -100], [24, -128], [26, -158], [14, -186], [-2, -210],
  // le grand pierrier, droit dans la pente
  [-12, -240], [-20, -270],
  // les lacets dans la face
  [-40, -288], [-74, -298], [-98, -310], [-104, -326], [-92, -338], [-66, -342],
  [-20, -350], [30, -360], [66, -370], [84, -384], [80, -400], [60, -408],
  [14, -414], [-28, -424], [-56, -436], [-74, -450], [-76, -466], [-60, -478], [-28, -484],
  [10, -492], [42, -502], [58, -520],
  // le toboggan, à l'entrée du bois
  [56, -548], [48, -580], [40, -610],
  // la traversée des racines et le pont du torrent
  [20, -628], [-12, -638], [-45, -644], [-80, -652], [-108, -666], [-120, -690], [-108, -715], [-78, -728],
  // le pierrier du bois, la marche
  [-54, -746], [-42, -772], [-40, -800], [-48, -828], [-72, -854], [-100, -876], [-114, -902], [-102, -928], [-68, -942], [-28, -954],
  // l'autoroute
  [8, -970], [40, -990], [62, -1018], [58, -1048], [30, -1068], [-10, -1082], [-50, -1098], [-84, -1118], [-96, -1148],
  [-80, -1176], [-44, -1192], [-4, -1206], [30, -1224], [44, -1250], [34, -1280], [12, -1302], [-2, -1328],
  [-6, -1360], [-6, -1400], [-6, -1435],
];

// Le torrent : il naît sous les lacets, passe sous le pont et file vers l'est, loin de la piste.
const CREEK = [[-50, -560], [-48, -605], [-45, -644], [-20, -680], [20, -720], [90, -830], [160, -970], [230, -1130], [300, -1320], [380, -1570]];

export function distToPolyline(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}

const alpes = {
  id: 'alpes',
  name: 'La Grande Combe',
  blurb: "2,3 km, 450 m de dénivelé, plus de 3 min 30. En haut, la crête au-dessus des arbres, la dalle, le grand pierrier et les lacets ; puis le toboggan dans les racines et le pont du torrent ; en bas, l'autoroute du bike park et ses sauts.",
  control: ALP_CONTROL,
  creek: CREEK,
  relief(seed) {
    const S = (a, b, z) => smoothstep(a, b, z);
    // La pente de la montagne selon l'altitude : la crête (30 %), la face (46 %), la forêt (36 %), le bike park (20 %),
    // le fond de vallée ; au-dessus de la cabane, le sommet se redresse.
    const slope = (z) => 0.03 + 0.17 * S(-1350, -1315, z) + 0.16 * S(-960, -930, z) + 0.10 * S(-540, -510, z)
      - 0.16 * S(-215, -185, z) + 0.25 * S(50, 90, z);
    const Z0 = -2600, Z1 = 2600;
    const table = new Float32Array(Z1 - Z0 + 1);
    for (let i = 1; i < table.length; i++) table[i] = table[i - 1] + slope(Z0 + i - 0.5);
    const profile = (z) => {
      const f = Math.max(0, Math.min(table.length - 1.001, z - Z0)), i = Math.floor(f);
      return table[i] + (table[i + 1] - table[i]) * (f - i);
    };
    // La crête : en haut, la piste suit une arête, le terrain tombe des deux côtés.
    const RIDGE = [[0, 200], [0, 40], [0, 0], [-5, -35], [-4, -70], [8, -100], [24, -128], [26, -158], [14, -186], [-2, -210], [-12, -260]];
    const ridgeX = (z) => {
      for (let i = 0; i + 1 < RIDGE.length; i++) {
        const [x0, z0] = RIDGE[i], [x1, z1] = RIDGE[i + 1];
        if (z <= z0 && z >= z1) return x0 + ((x1 - x0) * (z0 - z)) / (z0 - z1);
      }
      return z > 0 ? 0 : -12;
    };
    const softabs = (v, k) => Math.sqrt(v * v + k * k) - k;
    // Loin de la piste, de grands reliefs : la montagne autour, pas un plan incliné.
    const bx0 = -150, bx1 = 120, bz0 = -1460, bz1 = 70;
    return (x, z) => {
      const ridge = 0.3 * softabs(x - ridgeX(z), 14) * S(-260, -175, z);
      const alpine = S(-560, -470, z);
      const out = Math.hypot(Math.max(bx0 - x, 0, x - bx1), Math.max(bz0 - z, 0, z - bz1));
      const far = smoothstep(80, 600, out);
      const creek = distToPolyline(CREEK, x, z);
      const gully = creek < 8 ? 2.4 * (1 - smoothstep(1.2, 6.5, creek)) * smoothstep(-565, -590, z) : 0;
      return profile(z) - ridge + 0.00035 * x * x / (1 + (x / 700) ** 2)
        + 5.0 * fbm(x / 90, z / 90, 4, seed) + 0.8 * fbm(x / 14, z / 14, 2, seed + 5)
        + 1.4 * alpine * fbm(x / 26, z / 26, 2, seed + 11)
        + far * 90 * fbm(x / 520, z / 520, 4, seed + 31) - gully;
    };
  },
  layout({ cpS, seg, L }) {
    const sStart = cpS[1] + 1;
    const sFinish = cpS[73] - 4;
    return {
      sStart,
      sFinish,
      spawnS: cpS[0] + 3,
      speedTrap: cpS[70] + 2,
      features: [
        { type: 'startRamp', a: cpS[0], b: sStart, height: 1.6 },
        // ----- En haut, au-dessus des arbres -----
        { type: 'brakeBumps', a: cpS[3] - 14, b: cpS[3] + 2 },
        { type: 'slab', name: 'la dalle', a: seg(5, 6, 0.1), b: seg(5, 6, 0.85) },
        { type: 'rocks', name: 'grand pierrier', a: seg(9, 10, 0.6), b: seg(11, 12, 0.1) },
        { type: 'jump', kind: 'drop', name: 'drop du pierrier', a: seg(11, 12, 0.3), lipLen: 3, lipH: 0.4, knuckle: 0.4, clear: 1.2, speed: 8.5, dig: 1.5 },
        { type: 'brakeBumps', a: cpS[13] - 4, b: cpS[13] + 12 },
        { type: 'rollers', a: seg(17, 18, 0.1), b: seg(18, 19, 0.8), height: 0.45, wave: 8 },
        { type: 'brakeBumps', a: cpS[20] - 16, b: cpS[20] - 1 },
        { type: 'jump', kind: 'table', name: 'table des lacets', a: seg(24, 25, 0.2), lipLen: 5, lipH: 0.9, knuckle: 4, clear: 0.5, speed: 9.5, dig: 2.5, landFlatten: 0.15 },
        { type: 'brakeBumps', a: cpS[26] - 8, b: cpS[26] + 6 },
        { type: 'offCamber', a: seg(30, 31, 0.2), b: seg(31, 32, 0.3), bank: -0.12 },
        // ----- La forêt -----
        { type: 'offCamber', a: seg(36, 37, 0.6), b: seg(38, 39, 0.5), bank: -0.1 },
        { type: 'bridge', name: 'pont du torrent', a: cpS[39] - 9, b: cpS[39] + 9 },
        { type: 'brakeBumps', a: cpS[41] - 14, b: cpS[41] },
        { type: 'rocks', name: 'pierrier du bois', a: seg(44, 45, 0.6), b: seg(46, 47, 0.1) },
        { type: 'jump', kind: 'drop', name: 'la marche', a: seg(48, 49, 0.2), lipLen: 3, lipH: 0.5, knuckle: 1, clear: 1.1, touchLen: 4.5, speed: 8, dig: 1, landFlatten: 0.15 },
        { type: 'brakeBumps', a: cpS[50] - 12, b: cpS[50] + 2 },
        // ----- L'autoroute -----
        { type: 'jump', kind: 'table', name: 'table', a: seg(53, 54, 0.15), lipLen: 5, lipH: 1.0, knuckle: 4.5, clear: 0.55, speed: 10.5, dig: 1.5, landFlatten: 0.15 },
        { type: 'jump', kind: 'drop', name: 'step-down', look: 'terre', a: seg(54, 55, 0.45), lipLen: 4, lipH: 0.7, knuckle: 2, clear: 0.8, touchLen: 4.5, speed: 11, dig: 1.5, landFlatten: 0.15 },
        { type: 'brakeBumps', a: cpS[57] - 10, b: cpS[57] + 2 },
        { type: 'jump', kind: 'gap', name: 'road gap', a: seg(59, 60, 0.25), lipLen: 6, lipH: 1.1, knuckle: 6, clear: 0.9, touchLen: 5, dip: -1.3, speed: 12, dig: 3, landFlatten: 0.15 },
        { type: 'brakeBumps', a: cpS[62] - 12, b: cpS[62] + 2 },
        { type: 'rollers', a: seg(64, 65, 0.5), b: seg(65, 66, 0.7), height: 0.5, wave: 9 },
        { type: 'brakeBumps', a: cpS[67] - 12, b: cpS[67] + 2 },
        { type: 'jump', kind: 'table', name: "saut d'arrivée", a: seg(70, 71, 0.35), lipLen: 5, lipH: 2.2, knuckle: 8, clear: 1.6, speed: 10, touchLen: 3, lineLen: 10, landFlatten: 0.3, runout: 20 },
        { type: 'arena', a: seg(72, 73, 0.75), b: L },
      ],
      // Les racines : dans le toboggan, dans la traversée vers le pont, et sous les grands sapins.
      roots: [[cpS[34] - 12, seg(35, 36, 0.45)], [seg(36, 37, 0.7), seg(38, 39, 0.6)], [seg(46, 47, 0.4), seg(47, 48, 0.8)]],
      // Au-dessus des arbres, la piste est caillouteuse.
      surfaces: [{ a: sStart, b: cpS[33], surface: 'gravier', edge: 'gravier' }],
      gates: [
        { kind: 'depart', s: sStart },
        { kind: 'point', s: cpS[12] + 14 },
        { kind: 'point', s: cpS[30] },
        { kind: 'point', s: cpS[44] },
        { kind: 'point', s: seg(55, 56, 0.7) },
        { kind: 'point', s: cpS[65] },
        { kind: 'arrivee', s: sFinish },
      ],
    };
  },
  trees: { tries: 70000, treeline: 275 },
  // Le décor : la limite des arbres et la neige (altitudes), le massif autour (1,7 fois celui de la forêt), un air
  // plus limpide, et le relief lointain jusqu'à 1 350 m du milieu de la piste.
  env: { treeline: 275, snowline: 640, mountains: 1.7, fog: 0.0004, far: { radius: 1350, step: 14 } },
};

export const MAPS = { foret, alpes };
export const MAP_IDS = Object.keys(MAPS);
