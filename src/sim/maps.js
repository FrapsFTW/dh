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
  // (le menu : le genre de la piste, sa longueur et sa durée)
  tag: 'Forêt · technique',
  stats: '884 m · 1 min 20',
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
  // L'air de la forêt est humide : une brume assez dense. Autour, des collines boisées.
  env: { treeline: null, haze: 3.2e-4, hazeHeight: 700, far: { radius: 700, step: 12 }, range: { height: 520, top: 140, ramp: 700, scale: 0.3 } },
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
  // (le menu : le genre de la piste, sa longueur et sa durée)
  tag: 'Haute montagne · longue',
  stats: '2,3 km · 3 min 30',
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
        { type: 'jump', kind: 'table', name: "saut d'arrivée", a: seg(70, 71, 0.35), lipLen: 5, lipH: 2.2, knuckle: 8, clear: 1.6, speed: 9.8, touchLen: 3, lineLen: 10, landFlatten: 0.3, runout: 20 },
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
  env: { treeline: 275, snowline: 640, haze: 9e-5, hazeHeight: 1300, far: { radius: 1350, step: 14 }, range: { height: 2100, top: 260, ramp: 1800, scale: 0.75 } },
};

// ---------------------------------------------------------------------------------------------------------------
// L'Avalanche : toute la montagne, du glacier au village, inspirée de la Megavalanche de l'Alpe d'Huez.
//   Le glacier (départ en ligne, 40 m de large, balisé de piquets) · l'entonnoir de la moraine · les pierriers ·
//   le balcon dans l'alpage, sa remontée et le gué · les lacets jusqu'à la forêt · le bois et le bike park ·
//   la ruelle du village et l'arrivée sur la place.
// ---------------------------------------------------------------------------------------------------------------
const AV = {
  // la cabane (pour le contre-la-montre), puis le glacier : une grande courbe à droite, une à gauche
  glacier: [[0, 74], [0, 58], [0, 20], [2, -60], [10, -140], [30, -220], [58, -300], [72, -380], [66, -460], [44, -540], [18, -610], [0, -680], [-12, -740]],
  // l'entonnoir : la neige s'arrête, le couloir se resserre entre les moraines
  entonnoir: [[-20, -800], [-34, -860], [-40, -930], [-30, -1000], [-38, -1060], [-62, -1110]],
  // les pierriers, la dalle, le drop du Pic
  pierriers: [[-90, -1160], [-110, -1220], [-112, -1290], [-96, -1350], [-100, -1420], [-124, -1480], [-140, -1550], [-132, -1620]],
  // le balcon : à flanc vers l'est, la remontée en biais dans la pente, le gué, puis la descente vers les lacets
  balcon: [[-110, -1670], [-60, -1700], [0, -1720], [70, -1740], [140, -1760], [200, -1772], [262, -1756], [312, -1730], [352, -1708],
    [400, -1716], [450, -1736], [510, -1766], [566, -1800], [608, -1824], [636, -1846], [644, -1866]],
  // les lacets : six épingles dans la face, on entre dans les mélèzes à mi-hauteur
  lacets: [[628, -1880], [604, -1886], [590, -1900], [602, -1912], [628, -1916], [660, -1924], [690, -1936],
    [714, -1948], [720, -1964], [708, -1976], [682, -1980], [650, -1988], [620, -2000],
    [596, -2012], [590, -2028], [602, -2040], [628, -2044], [660, -2052], [690, -2064],
    [714, -2076], [720, -2092], [708, -2104], [682, -2108], [650, -2116], [620, -2128],
    [596, -2140], [590, -2156], [602, -2168], [628, -2172], [664, -2184], [700, -2200]],
  // le bois : le single des racines, la première piste forestière, le bike park, le road gap
  bois: [[730, -2240], [740, -2300], [724, -2360], [696, -2410], [690, -2470], [706, -2530], [730, -2590], [736, -2650], [716, -2700],
    [686, -2740], [650, -2770], [620, -2810], [616, -2860], [640, -2900], [670, -2930], [676, -2970], [650, -3000], [616, -3020],
    [596, -3060], [610, -3100], [640, -3130], [660, -3170], [656, -3220], [636, -3260], [610, -3290]],
  // le village : la ruelle, les marches, la place
  village: [[590, -3320], [576, -3360], [570, -3400], [572, -3440], [580, -3480], [586, -3520], [588, -3560]],
};
const AV_CONTROL = Object.values(AV).flat();
/** L'indice du premier point de chaque tronçon dans AV_CONTROL. */
const AVI = (() => { const o = {}; let i = 0; for (const [k, v] of Object.entries(AV)) { o[k] = i; i += v.length; } return o; })();
// Le torrent : il descend de l'alpage, passe à gué sous le balcon et file vers l'ouest, loin des lacets et du bois.
const AV_CREEK = [[470, -1430], [462, -1540], [454, -1650], [450, -1736], [432, -1820], [402, -1950], [362, -2100], [300, -2300], [250, -2500], [200, -2800], [160, -3200]];
// L'axe du glacier, pour sa cuvette.
const AV_GLACIER = [...AV.glacier.slice(1), ...AV.entonnoir.slice(0, 3)];
const AV_COARSE = AV_CONTROL.filter((_, i) => i % 3 === 0);

const avalanche = {
  id: 'avalanche',
  name: "L'Avalanche",
  // (le menu : le genre de la piste, sa longueur et sa durée)
  tag: 'Glacier · départ en ligne',
  stats: '5,3 km · 7 min',
  blurb: "5,3 km, plus de 1 000 m de dénivelé, environ 7 minutes. Départ en ligne sur le glacier, l'entonnoir, les pierriers, le balcon et sa remontée, six épingles, le bois et son bike park, la ruelle du village.",
  control: AV_CONTROL,
  creek: AV_CREEK,
  // Le relief n'est construit qu'à 60 m autour de la piste (au-delà, le relief lointain) : 5 km de piste, sinon c'est
  // un rectangle de 4 km sur 1 qu'il faudrait mailler.
  band: 60,
  relief(seed) {
    const S = (a, b, z) => smoothstep(a, b, z);
    // La pente de la montagne selon l'altitude : le sommet, le glacier (27 %), l'entonnoir (23 %), les pierriers (27 %),
    // la face du balcon (33 %), la face des lacets (45 %), la forêt (31 %), le village (16 %), le fond de vallée.
    const slope = (z) => 0.04 + 0.12 * S(-3500, -3460, z) + 0.15 * S(-3310, -3270, z) + 0.14 * S(-2220, -2180, z)
      - 0.12 * S(-1880, -1840, z) - 0.06 * S(-1680, -1640, z) - 0.04 * S(-1140, -1100, z) + 0.04 * S(-740, -700, z)
      + 0.18 * S(80, 120, z);
    const Z0 = -4600, Z1 = 2800;
    const table = new Float32Array(Z1 - Z0 + 1);
    for (let i = 1; i < table.length; i++) table[i] = table[i - 1] + slope(Z0 + i - 0.5);
    const profile = (z) => {
      const f = Math.max(0, Math.min(table.length - 1.001, z - Z0)), i = Math.floor(f);
      return table[i] + (table[i + 1] - table[i]) * (f - i);
    };
    // La distance à la piste (grossière) varie lentement : une grille de 25 m suffit, et coûte bien moins cher.
    const GX0 = -2600, GZ0 = -4800, GS = 25, gnx = 260, gnz = 320;
    const farGrid = new Float32Array(gnx * gnz);
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) farGrid[j * gnx + i] = distToPolyline(AV_COARSE, GX0 + i * GS, GZ0 + j * GS);
    const coarseDist = (x, z) => {
      const fx = Math.max(0, Math.min(gnx - 1.001, (x - GX0) / GS)), fz = Math.max(0, Math.min(gnz - 1.001, (z - GZ0) / GS));
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const a = farGrid[j * gnx + i], b = farGrid[j * gnx + i + 1], c = farGrid[(j + 1) * gnx + i], d = farGrid[(j + 1) * gnx + i + 1];
      return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    };
    return (x, z) => {
      // Le glacier : une cuvette lisse entre deux bords qui remontent ; plus bas, les moraines en bourrelets.
      const dg = z > -1250 ? distToPolyline(AV_GLACIER, x, z) : 1e4;
      const onGlacier = S(-800, -720, z);
      const trough = 0.0028 * dg * dg / (1 + (dg / 85) ** 2) * S(-1000, -850, z);
      const moraine = 3.2 * Math.exp(-(((dg - 30) / 9) ** 2)) * S(-1160, -1080, z) * (1 - S(-760, -700, z));
      const smooth = 1 - 0.8 * onGlacier * (1 - smoothstep(70, 130, dg));
      // Loin de la piste, de grands reliefs : la montagne autour, pas un plan incliné.
      const far = smoothstep(90, 650, coarseDist(x, z));
      const alpine = S(-2300, -2150, z);
      const creek = x > 140 && x < 490 && z < -1410 && z > -3220 ? distToPolyline(AV_CREEK, x, z) : 1e4;
      const gully = creek < 8 ? 2.2 * (1 - smoothstep(1.2, 6.5, creek)) * S(-1560, -1600, z) * (1 - 0.75 * Math.exp(-(((z + 1736) / 30) ** 2))) : 0;
      // Le village : des terrasses plus douces autour de la place.
      return profile(z) + trough + moraine
        + smooth * (5.0 * fbm(x / 90, z / 90, 4, seed) + 0.8 * fbm(x / 14, z / 14, 2, seed + 5) + 1.4 * alpine * fbm(x / 26, z / 26, 2, seed + 11))
        + 0.6 * onGlacier * fbm(x / 40, z / 40, 2, seed + 17)
        + far * 110 * fbm(x / 560, z / 560, 4, seed + 31) - gully;
    };
  },
  layout({ cpS, seg, L }) {
    const g = (k, i) => cpS[AVI[k] + i];
    const sg = (k, i, f) => seg(AVI[k] + i, AVI[k] + i + 1, f);
    const sStart = cpS[1] + 1;
    const sFinish = g('village', 5) - 6;
    const sVillage = g('village', 0) - 6;
    return {
      sStart,
      sFinish,
      spawnS: cpS[0] + 3,
      speedTrap: g('glacier', 9), // le radar, au bas du glacier : la vitesse de pointe
      features: [
        { type: 'startRamp', a: cpS[0], b: sStart, height: 1.6 },
        // ----- Le glacier -----
        // Les vagues de neige : de longues ondulations, qu'on prend lancé ; vers 75 km/h, on flotte sur les crêtes.
        { type: 'rollers', name: 'les vagues de neige', a: g('glacier', 3), b: g('glacier', 7), height: 0.6, wave: 24, speed: 17 },
        { type: 'rollers', name: 'le replat bosselé', a: g('glacier', 10) - 20, b: g('glacier', 11) + 10, height: 0.35, wave: 9 },
        // ----- L'entonnoir et les pierriers -----
        { type: 'brakeBumps', a: g('entonnoir', 1) - 16, b: g('entonnoir', 1) + 2 },
        { type: 'rocks', name: 'premier pierrier', a: sg('entonnoir', 3, 0.3), b: sg('entonnoir', 4, 0.2) },
        { type: 'rocks', name: 'pierrier des Séracs', a: sg('pierriers', 0, 0.4), b: sg('pierriers', 2, 0.3) },
        { type: 'slab', name: 'la dalle', a: sg('pierriers', 3, 0.15), b: sg('pierriers', 3, 0.85) },
        { type: 'rocks', name: 'second pierrier', a: sg('pierriers', 5, 0.1), b: sg('pierriers', 6, 0.5) },
        { type: 'jump', kind: 'drop', name: 'drop du Pic', a: sg('pierriers', 6, 0.7), lipLen: 3, lipH: 0.4, knuckle: 0.4, clear: 1.2, speed: 8.5, dig: 1.5 },
        // ----- Le balcon -----
        { type: 'offCamber', a: sg('balcon', 1, 0.3), b: sg('balcon', 3, 0.6), bank: -0.1 },
        { type: 'rocks', name: 'les blocs du balcon', a: sg('balcon', 4, 0.15), b: sg('balcon', 4, 0.75) },
        { type: 'climb', name: 'la remontée', a: g('balcon', 5) - 10, b: g('balcon', 8) + 20 },
        { type: 'ford', name: 'le gué', a: g('balcon', 10) - 5, b: g('balcon', 10) + 5, depth: 0.25 },
        { type: 'rollers', a: sg('balcon', 11, 0.2), b: sg('balcon', 12, 0.8), height: 0.45, wave: 8 },
        { type: 'brakeBumps', a: g('balcon', 14) - 12, b: g('balcon', 14) + 2 },
        // ----- Les lacets : deux pierriers dans les traversées -----
        { type: 'rocks', name: 'pierrier des lacets', a: sg('lacets', 10, 0.15), b: sg('lacets', 11, 0.85) },
        { type: 'rocks', name: 'les dalles brisées', a: sg('lacets', 22, 0.15), b: sg('lacets', 23, 0.85) },
        // ----- Le bois -----
        { type: 'road', name: 'piste forestière', a: sg('bois', 8, 0.5) - 3, b: sg('bois', 8, 0.5) + 3 },
        { type: 'brakeBumps', a: g('bois', 10) - 12, b: g('bois', 10) + 2 },
        { type: 'jump', kind: 'table', name: 'table du bike park', a: sg('bois', 16, 0.3), lipLen: 5, lipH: 1.0, knuckle: 4.5, clear: 0.55, speed: 10.5, dig: 1.5, landFlatten: 0.15 },
        { type: 'jump', kind: 'table', name: 'table', a: sg('bois', 18, 0.4), lipLen: 5, lipH: 1.0, knuckle: 4.5, clear: 0.55, speed: 10.5, dig: 1.5, landFlatten: 0.15 },
        { type: 'jump', kind: 'gap', name: 'road gap', a: sg('bois', 21, 0.3), lipLen: 6, lipH: 1.1, knuckle: 6, clear: 0.9, touchLen: 5, dip: -1.3, speed: 12, dig: 2, landFlatten: 0.1 },
        // ----- Le village -----
        { type: 'stairs', name: 'les marches', a: sg('village', 2, 0.3), b: sg('village', 2, 0.3) + 9, step: 0.9 },
        { type: 'arena', a: sg('village', 4, 0.6), b: L },
      ],
      // Les racines : sous les premiers mélèzes (après la dernière épingle), et le single raide du bois.
      roots: [[g('lacets', 28) + 4, g('bois', 0) - 4], [g('bois', 1), sg('bois', 5, 0.5)], [g('bois', 9), sg('bois', 10, 0.8)]],
      surfaces: [
        // La neige damée sur la trace, molle à côté : tout le glacier, jusqu'à l'entonnoir.
        { a: sStart, b: g('entonnoir', 0) + 10, surface: 'neige', edge: 'neigeMolle', off: 'neigeMolle' },
        { a: g('entonnoir', 0) + 10, b: g('balcon', 2), surface: 'gravier', edge: 'gravier' },
        { a: sVillage, b: L, surface: 'paves', edge: 'paves' },
      ],
      // La largeur balisée : 40 m sur le glacier, qui se resserre dans l'entonnoir.
      wide: [{ a: sStart + 4, b: g('entonnoir', 0) + 150, half: 20, open: 14, close: 150 }],
      // Les passages étroits : moins de 3 m entre les rubalises, bordés de blocs en altitude, de troncs en forêt. Le goulet
      // arrive juste après le glacier, comme le bouchon de la Megavalanche.
      narrow: [
        { name: 'le goulet des moraines', a: g('entonnoir', 1) + 34, b: g('entonnoir', 3) - 10, half: 1.35, edge: 'blocs' },
        { name: 'le sentier du balcon', a: sg('balcon', 1, 0.4), b: sg('balcon', 3, 0.9), half: 1.25, edge: 'blocs' },
        { name: 'les premiers mélèzes', a: g('lacets', 28) + 8, b: g('bois', 0) - 4, half: 1.3, edge: 'arbres' },
        { name: 'le couloir des sapins', a: g('bois', 2) + 5, b: g('bois', 4) - 5, half: 1.2, edge: 'arbres' },
      ],
      // La vitesse que s'autorise le pilote auto (sur le glacier, on lâche les freins).
      fast: [{ a: sStart, b: g('glacier', 10), vmax: 21 }],
      village: { a: sVillage, b: sFinish + 25 },
      gates: [
        { kind: 'depart', s: sStart },
        { kind: 'point', s: g('entonnoir', 1) + 20 },
        { kind: 'point', s: g('balcon', 0) },
        { kind: 'point', s: g('balcon', 12) },
        { kind: 'point', s: g('bois', 1) },
        { kind: 'point', s: g('bois', 14) },
        { kind: 'arrivee', s: sFinish },
      ],
    };
  },
  trees: { tries: 110000, treeline: 500 },
  // Le décor : la limite des arbres à mi-hauteur des lacets, la neige éternelle au-dessus du glacier (lui a la sienne),
  // le massif autour, un air limpide, et le relief lointain jusqu'à 4 200 m du milieu (jusqu'au pied du massif : sinon on
  // verrait le ciel entre les deux, comme un lac).
  // L'air de haute montagne est limpide : on voit les sommets à 20 km, bleutés.
  env: { treeline: 500, snowline: 960, haze: 4.5e-5, hazeHeight: 1800, far: { radius: 4200, step: 26 }, range: { height: 2700, top: 450, ramp: 2500 } },
  // Le départ en ligne : sept de front sur le glacier.
  peloton: { cols: 7, colGap: 2.6, rowGap: 3.4, offset: 24, default: true },
};

// ---------------------------------------------------------------------------------------------------------------
// Le Bike Park : une ligne de gros sauts, comme dans les bike parks des montagnes de la côte Pacifique (la A-Line de
// Whistler) : une piste de ski taillée dans une forêt de douglas immenses, un télésiège qui remonte les vélos, des
// sauts lissés à la machine, des virages relevés bordés de filets, une passerelle en bois.
//   la ligne des trois tables · berm · step-down et le grand gap · berm · les doubles · berm · bosses et road gap ·
//   le Big One, le plus gros saut du jeu, devant l'arrivée. Les virages sont des berms : relevés, on les prend vite.
// ---------------------------------------------------------------------------------------------------------------
// Le télésiège : la gare du bas près de l'arrivée, celle du haut à côté de la cabane de départ.
const BP_LIFT = [[-48, -1052], [52, 22]];

const bikepark = {
  id: 'bikepark',
  name: 'Le Bike Park',
  // (le menu : le genre de la piste, sa longueur et sa durée)
  tag: 'Bike park · gros sauts',
  stats: '1,2 km · 1 min 40',
  blurb: "1,2 km, environ 1 min 40, comme la A-Line de Whistler : une piste de ski taillée dans une forêt de douglas, le télésiège au-dessus, des berms bordés de filets. Des modules de toutes les formes : dalle de granit, kicker en bois, table, step-up, step-down, passerelle North Shore perchée, gap en bois, doubles, gap du ruisseau, drop du rocher, drop en bois, road gap, et le Big One devant l'arrivée. En l'air, couche le vélo (whip).",
  lift: BP_LIFT,
  scenery: 'bikepark',
  control: [
    // la cabane, et la ligne des trois tables
    [0, 40], [0, 24], [0, 0], [8, -40], [22, -90], [38, -140], [52, -185], [62, -215],
    // berm
    [72, -238], [70, -262], [54, -276],
    // le step-down et le grand gap
    [30, -300], [5, -340], [-20, -385], [-42, -430], [-56, -462],
    // berm
    [-68, -485], [-64, -510], [-46, -522],
    // les doubles
    [-20, -545], [8, -590], [32, -640], [48, -680],
    // berm
    [58, -702], [52, -726], [34, -738],
    // les bosses et le road gap
    [10, -760], [-12, -800], [-26, -840], [-32, -875],
    // le Big One et l'arrivée
    [-30, -910], [-22, -950], [-18, -990], [-16, -1030], [-16, -1070],
  ],
  // Une pente régulière (21 %), qui s'adoucit en bas dans le fond de vallée de l'arrivée.
  relief(seed) {
    const SLOPE = 0.21, VALLEY_Z = 1010;
    const valley = (z) => SLOPE * z + (SLOPE - 0.04) * 10 * softplus(-(z + VALLEY_Z) / 10);
    return (x, z) => valley(z) + 4.0 * fbm(x / 90, z / 90, 4, seed) + 0.5 * fbm(x / 16, z / 16, 2, seed + 5) + 0.0004 * x * x
      + 60 * smoothstep(250, 900, Math.abs(x)) * fbm(x / 400, z / 400, 3, seed + 31);
  },
  layout({ cpS, seg, L }) {
    const sStart = cpS[1] + 1;
    const sFinish = cpS[33] - 4;
    // Les sauts du bike park : de grosses tables bien dessinées, de la place pour voler (et pour un whip).
    const table = (name, a, speed, more = {}) => ({ type: 'jump', kind: 'table', name, a, lipLen: 5, lipH: 1.4, knuckle: 6.5, clear: 0.7, touchLen: 4, speed, dig: 2, landFlatten: 0.15, ...more });
    return {
      sStart,
      sFinish,
      spawnS: cpS[0] + 3,
      speedTrap: cpS[30] + 2, // juste avant le Big One
      features: [
        { type: 'startRamp', a: cpS[0], b: sStart, height: 1.6 },
        // ----- Le haut : une dalle de granit à dévaler, un kicker en bois, une table, un step-up -----
        // (la dalle : le granit de la côte, poli par les glaciers, qu'on descend sans freiner, comme à Whistler)
        { type: 'slab', name: 'la dalle de granit', a: seg(2, 3, 0.15), b: seg(2, 3, 0.9) },
        // (le kicker : une lèvre de planches sur pilotis, raide et courte ; on se pose sur la table en terre)
        table('le kicker en bois', seg(3, 4, 0.2), 10.5, { lipH: 1.1, knuckle: 5, look: 'bois' }),
        table('deuxième table', seg(4, 5, 0.55), 11.5),
        // (le step-up : on décolle d'une lèvre raide et on se pose plus haut, au sommet d'une butte, avant de redescendre)
        { type: 'jump', kind: 'gap', name: 'step-up', look: 'trou', a: seg(5, 6, 0.8), lipLen: 4.5, lipH: 1.9, knuckle: 4.5, clear: 0.5, touchLen: 3, lineLen: 4, dip: -0.4, speed: 11.5, landFlatten: 0.1, runout: 22 },
        { type: 'brakeBumps', a: cpS[8] - 14, b: cpS[8] + 2 },
        // ----- Le step-down, la passerelle et le gap North Shore : lèvre et réception en planches, un trou entre les deux -----
        // (la passerelle : un tablier de planches de 2,2 m de large, perché à 1,2 m, sans garde-corps ; on y monte et on
        // en descend par des rampes)
        { type: 'jump', kind: 'drop', name: 'step-down', look: 'terre', a: seg(11, 12, 0.3), lipLen: 4, lipH: 0.7, knuckle: 2, clear: 0.8, touchLen: 4.5, speed: 11, dig: 1.5, landFlatten: 0.15 },
        { type: 'bridge', style: 'shore', name: 'la passerelle North Shore', a: seg(12, 13, 0.15), b: seg(12, 13, 0.8), half: 1.1, raise: 1.2 },
        { type: 'jump', kind: 'gap', name: 'le gap en bois', look: 'bois', a: seg(13, 14, 0.15), lipLen: 6, lipH: 1.6, knuckle: 8, clear: 0.9, touchLen: 5, dip: -1.4, speed: 13, dig: 2.5, landFlatten: 0.15 },
        { type: 'brakeBumps', a: cpS[16] - 14, b: cpS[16] + 2 },
        // ----- Les doubles : deux bosses de terre à franchir d'un coup, un trou creusé entre les deux buttes ; puis le
        // même au-dessus d'un ruisseau -----
        ...[[19, 20, 0.2], [20, 21, 0.25], [21, 22, 0.2]].map(([i, j, t], k) => ({ type: 'jump', kind: 'gap', name: k < 2 ? 'double' : 'le gap du ruisseau', look: k < 2 ? 'trou' : 'ruisseau', a: seg(i, j, t), lipLen: 4.5, lipH: 1.3 + 0.15 * k, knuckle: 5.5 + 0.25 * k, clear: 0.6, touchLen: 3, lineLen: 6, dip: k < 2 ? -0.9 : -1.5, speed: 11.5 + 0.3 * k, dig: 2, landFlatten: 0.15, runout: 14 })),
        { type: 'brakeBumps', a: cpS[23] - 12, b: cpS[23] + 2 },
        // ----- Le drop du rocher (une lèvre de granit), les bosses, le drop en bois (un tablier de planches sur pilotis, qui
        // finit dans le vide) et le road gap -----
        { type: 'jump', kind: 'drop', name: 'le drop du rocher', a: seg(25, 26, 0.05), lipLen: 4, lipH: 0.9, knuckle: 2, clear: 0.9, touchLen: 4, speed: 9.5, dig: 1.5, landFlatten: 0.15 },
        { type: 'rollers', a: seg(26, 27, 0.12), b: seg(26, 27, 0.5), height: 0.55, wave: 9 },
        { type: 'jump', kind: 'drop', name: 'le drop en bois', look: 'bois', a: seg(26, 27, 0.75), lipLen: 4, lipH: 1.1, knuckle: 1.5, clear: 1.0, touchLen: 4, speed: 8.5, dig: 1.5, landFlatten: 0.15 },
        { type: 'jump', kind: 'gap', name: 'road gap', a: seg(28, 29, 0.0), lipLen: 6, lipH: 1.3, knuckle: 7, clear: 0.9, touchLen: 5, dip: -1.3, speed: 12, dig: 2.5, landFlatten: 0.15 },
        // ----- Le Big One -----
        // Le plus gros saut du jeu : près d'une seconde et demie en l'air, de quoi tenter un backflip, un 360 ou un gros
        // whip. La réception pardonne d'arriver un peu trop vite.
        { type: 'jump', kind: 'table', name: 'le Big One', a: cpS[30] + 8, lipLen: 7, lipH: 2.6, knuckle: 9, clear: 1.4, speed: 12.2, touchLen: 4, lineLen: 10, landFlatten: 0.25, runout: 18, crowd: 90 },
        { type: 'arena', a: seg(32, 33, 0.75), b: L },
      ],
      gates: [
        { kind: 'depart', s: sStart },
        { kind: 'point', s: cpS[9] },
        { kind: 'point', s: cpS[17] },
        { kind: 'point', s: cpS[24] },
        { kind: 'point', s: cpS[30] },
        { kind: 'arrivee', s: sFinish },
      ],
      // Ici, on lâche les freins : le pilote auto s'autorise 55 km/h entre les sauts.
      fast: [{ a: sStart, b: sFinish, vmax: 15 }],
    };
  },
  // La forêt de la côte : des douglas de 25 à 40 m, serrés, quelques feuillus ; la piste de ski est une large saignée
  // aux bords irréguliers (avec quelques arbres isolés), et la ligne du télésiège la sienne.
  trees: {
    tries: 30000,
    density(d, x, z) {
      if (d < 5.4 || distToPolyline(BP_LIFT, x, z) < 9 + 3 * fbm(x / 30, z / 30, 2, 67)) return 0;
      const run = 17 + 9 * fbm(x / 50, z / 50, 2, 61);
      return d < run ? 0.012 : 0.5 * smoothstep(run, run + 5, d);
    },
    kind: (r) => (r < 0.88 ? 'douglas' : 'feuillu'),
    height: (kind, h) => (kind === 'douglas' ? 12 + h * 1.25 : h * 0.9),
  },
  // Le décor : la forêt jusqu'à mi-pente, au-dessus la roche et les glaciers de la chaîne côtière ; un air limpide.
  env: {
    treeline: 260, snowline: 520, haze: 8e-5, hazeHeight: 1400,
    far: { radius: 1300, step: 14 }, range: { height: 2600, top: 320, ramp: 1600, scale: 0.8 },
    flora: 'epilobe',
    spotCrowd: 5, // (un jour ordinaire au bike park : quelques pilotes regardent ; la foule est au Big One)
    banners: ['WHIP-OFF', 'BIKE PARK', 'LIGNE DES SAUTS', 'SEND IT', 'BIG ONE', 'CÔTE PACIFIQUE'],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Le Single : un sentier de la Riviera, comme à Finale Ligure, à peine plus large qu'un guidon, qui descend en épingles
// vers la mer : terre rouge, calcaire, pins maritimes, chênes verts, murets de pierre sèche, oliviers en bas.
//   Balisé serré presque de bout en bout : les troncs frôlent la rubalise. Des racines, une dalle calcaire, un pierrier,
//   une petite marche, des marches de pierre.
// ---------------------------------------------------------------------------------------------------------------
// Les épingles : des traversées presque à plat en travers de la pente (cap à ±H du sens de la pente), reliées par des
// demi-tours de R m de rayon. Le tracé est calculé (droites et arcs, un point tous les 5 m) : la courbe passe exactement
// par ce dessin. SINGLE_MARKS garde le premier point de chaque traversée et de chaque épingle.
const SINGLE_TURNS = 7;
const SINGLE_SEA = -200; // l'altitude de la mer
const SINGLE_MARKS = { legs: [], turns: [] };
const SINGLE_CONTROL = (() => {
  const H = 1.2, R = 11, LEG = 30;
  const pts = [[0, 30], [0, 16]];
  let x = 0, z = 16, h = 0; // h : le cap, depuis le sens de la pente (-z), positif vers +x
  const step = (ds, dh) => { x += Math.sin(h + dh / 2) * ds; z -= Math.cos(h + dh / 2) * ds; h += dh; pts.push([x, z]); };
  const line = (len) => { const n = Math.max(1, Math.round(len / 5)); for (let k = 0; k < n; k++) step(len / n, 0); };
  const arc = (to) => { const len = Math.abs(to - h) * R, n = Math.max(2, Math.round(len / 5)), dh = (to - h) / n; for (let k = 0; k < n; k++) step(len / n, dh); };
  line(24);
  arc(-H);
  for (let i = 0; i < SINGLE_TURNS; i++) {
    SINGLE_MARKS.legs.push(pts.length - 1);
    line(LEG);
    SINGLE_MARKS.turns.push(pts.length - 1);
    arc(i % 2 ? -H : H);
  }
  SINGLE_MARKS.legs.push(pts.length - 1);
  line(LEG);
  arc(0);
  line(70);
  return pts;
})();

const single = {
  id: 'single',
  name: 'Le Single',
  // (le menu : le genre de la piste, sa longueur et sa durée)
  tag: 'Riviera · sentier étroit',
  stats: '550 m · 1 min 10',
  blurb: "Environ 550 m, 1 min 10. Un sentier de la Riviera, comme à Finale Ligure : terre rouge, calcaire blanc, pins maritimes et chênes verts, la mer en contrebas. À peine plus large qu'un guidon, sept épingles entre les murets de pierre sèche : racines, dalle calcaire, pierrier, une petite marche, des marches de pierre.",
  control: SINGLE_CONTROL,
  scenery: 'riviera',
  // Une pente raide (38 %) au-dessus de la mer, qui s'adoucit en bas, dans les oliviers. Plus loin, hors de la piste,
  // le vallon descend jusqu'à la côte (la mer est à SINGLE_SEA m), entre deux crêtes qui finissent en caps.
  relief(seed) {
    const SLOPE = 0.38, VALLEY_Z = 288;
    const valley = (z) => SLOPE * z + (SLOPE - 0.05) * 8 * softplus(-(z + VALLEY_Z) / 8);
    // (au-delà de 200 m de part et d'autre, les crêtes montent en pente régulière, pas sans fin)
    const sides = (x) => { const a = Math.abs(x); return a < 200 ? 0.0005 * x * x : 20 + 0.2 * (a - 200); };
    const coast = (z) => { const t = Math.max(0, -(z + 430)); return 0.14 * t * t / (t + 60); };
    return (x, z) => valley(z) - coast(z) + 3.0 * fbm(x / 70, z / 70, 4, seed) + 0.6 * fbm(x / 12, z / 12, 2, seed + 5) + sides(x);
  },
  layout({ cpS, seg, L }) {
    const n = cpS.length;
    const leg = (i, f) => seg(SINGLE_MARKS.legs[i], SINGLE_MARKS.legs[i] + 6, f); // le long de la traversée i (30 m)
    const turn = (i) => cpS[SINGLE_MARKS.turns[i]] + 8; // le milieu de l'épingle i
    const sStart = cpS[1] + 1;
    const sFinish = cpS[n - 4];
    return {
      sStart,
      sFinish,
      spawnS: cpS[0] + 3,
      speedTrap: cpS[n - 8],
      features: [
        { type: 'startRamp', a: cpS[0], b: sStart, height: 1.6 },
        { type: 'brakeBumps', a: turn(0) - 18, b: turn(0) - 9 },
        { type: 'brakeBumps', a: turn(2) - 18, b: turn(2) - 9 },
        // La dalle calcaire : du rocher blanc, lisse, qui accroche (on la passe sans freiner).
        { type: 'slab', name: 'la dalle calcaire', a: leg(1, 0.3), b: leg(1, 0.85) },
        { type: 'rocks', name: 'le pierrier', a: leg(3, 0.1), b: leg(3, 0.85) },
        // Les marches de pierre : des ressauts de calcaire, une marche tous les 2 m.
        { type: 'stairs', name: 'les marches de pierre', a: leg(6, 0.55), b: leg(6, 0.55) + 9, step: 2 },
        { type: 'brakeBumps', a: turn(4) - 18, b: turn(4) - 9 },
        { type: 'jump', kind: 'drop', name: 'la marche', a: leg(5, 0.15), lipLen: 3, lipH: 0.4, knuckle: 0.6, clear: 0.9, speed: 6.5, dig: 1.2, runout: 12 },
        { type: 'arena', a: cpS[n - 7], b: L },
      ],
      // Des racines de pin dans presque toutes les traversées.
      roots: [[leg(0, 0.1), leg(0, 0.9)], [leg(1, 0.05), leg(1, 0.25)], [leg(2, 0.1), leg(2, 0.6)], [leg(4, 0.1), leg(4, 0.9)], [leg(6, 0.1), leg(6, 0.45)], [leg(7, 0.1), leg(7, 0.7)]],
      // Le sentier, balisé serré : 2,2 m entre les rubalises (2,4 m dans le pierrier, entre les blocs).
      narrow: [
        // (après la grille du départ en ligne : sept rangs de trois, sur une vingtaine de mètres)
        { name: 'le single', a: sStart + 40, b: leg(3, 0.1), half: 1.1, edge: 'arbres' },
        { name: 'le pierrier', a: leg(3, 0.1), b: leg(3, 0.85), half: 1.2, edge: 'blocs' },
        { name: 'le single', a: leg(3, 0.85), b: cpS[n - 9], half: 1.1, edge: 'arbres' }, // (jusqu'au radar)
      ],
      // Sur un sentier si serré, le pilote auto ne dépasse pas 25 km/h.
      fast: [{ a: 0, b: L, vmax: 7 }],
      gates: [
        { kind: 'depart', s: sStart },
        { kind: 'point', s: leg(2, 0.5) },
        { kind: 'point', s: leg(4, 0.5) },
        { kind: 'point', s: leg(6, 0.5) },
        { kind: 'arrivee', s: sFinish },
      ],
    };
  },
  // La forêt de la Riviera : pins maritimes et chênes verts ; en bas, sur les terrasses, des oliviers. Les troncs qui
  // bordent le sentier sont des pins : leur fût est nu, rien dans la figure du pilote.
  trees: {
    tries: 30000,
    // Une forêt claire, au soleil, moins serrée que celle des Alpes ; en bas, les oliveraies, des arbres espacés sur
    // les terrasses, la vue dégagée sur la mer.
    density: (d, x, z, clearing, y) => (y < -80 ? (d < 7 ? 0 : 0.06) : (d < 5.4 ? 0 : d < 10 ? 0.3 : d < 30 ? 0.2 : 0.12) * (1 - 0.8 * clearing)),
    // (les chênes verts et les oliviers ont un houppier large et bas : pas à moins de 9 m du sentier)
    kind: (r, y, d) => (d < 9 ? 'pin' : y < -80 ? (r < 0.75 ? 'olivier' : r < 0.9 ? 'pin' : 'chene') : r < 0.55 ? 'pin' : 'chene'),
    height: (kind, h) => (kind === 'pin' ? h * 0.85 : kind === 'chene' ? 3.5 + h * 0.3 : 3 + h * 0.15),
    edgeKind: () => 'pin',
  },
  // Le décor : la mer au sud (devant, en descendant), un soleil haut et chaud, peu de nuages, l'air un peu laiteux du
  // bord de mer ; les Alpes ligures derrière. Les sols : terre rouge, calcaire, herbes sèches. Un sentier nature : pas
  // de protections sur les troncs, pas de panneaux de virage.
  env: {
    treeline: 420, haze: 1.5e-4, hazeHeight: 600, clouds: 0.18,
    far: { radius: 1700, step: 14 }, range: { height: 1100, top: 260, ramp: 1600, scale: 0.45 },
    sea: { level: SINGLE_SEA, dir: [0, -1], open: 1.2 },
    sun: [-0.45, 0.78, 0.42], pads: false, chevrons: false,
    // (des troncs tout le long du sentier, trois ou quatre traversées à portée : le détail un peu plus près)
    treeDetail: { near: 28, mid: 55 },
    ground: { terre: [150, 84, 54], prairie: [152, 140, 80], aiguilles: [134, 96, 62], roche: [196, 190, 176], pierrier: [182, 176, 164], gravier: [178, 164, 142] },
    flora: 'maquis',
    banners: ['RIVIERA', 'FINALE', 'ENDURO', 'SENTIERO', 'TERRA ROSSA', 'IL MARE'],
  },
};

export const MAPS = { foret, alpes, avalanche, bikepark, single };
export const MAP_IDS = Object.keys(MAPS);
