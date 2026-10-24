// Tournage : des plans du peloton, image par image, à pas fixe (le rendu logiciel est trop lent pour filmer en temps
// réel). Chaque plan donne des images JPEG, et une animation WebP s'il en a plusieurs.
//   node tools/film.mjs [plan…]      → shots/film/<plan>/*.jpg et shots/film/<plan>.webp
//   CARTE=avalanche node tools/film.mjs depart   (La Grande Combe par défaut)
// Le saut, le virage et l'arrivée sont choisis d'après le peloton enregistré (public/peloton/<carte>.bin).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import sharp from 'sharp';
import { createTrack } from '../src/sim/track.js';
import { decodePeloton, gridSlots, POSE, POSE_SIZE } from '../src/sim/peloton.js';
import { airs } from '../src/render/peloton.js';

const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const W = +(process.env.W || 960), H = +(process.env.H || 540), FPS = 24;

// ---------- Les moments à filmer, trouvés dans les données ----------
const MAP = process.env.CARTE || 'alpes';
const track = createTrack(7, MAP);
const runs = decodePeloton(new Uint8Array(readFileSync(`public/peloton/${MAP}.bin`)));
const wide = !!(track.map.peloton && track.map.peloton.cols); // une grille large (le glacier)
const front = gridSlots(track)[0].s;
const at = (run, t, k) => run.d[Math.min(run.count - 1, Math.round(t * 10)) * POSE_SIZE + k];
const timeAt = (run, s) => { for (let j = 0; j < run.count; j++) if (run.d[j * POSE_SIZE + POSE.s] >= s) return j / 10; return Infinity; };
// Le plus beau whip : le plus long en l'air.
let whip = null;
for (const run of runs) for (const a of airs(run)) if (a.kind === 'whip' && (!whip || (a.t1 - a.t0) * a.amp > (whip.a.t1 - whip.a.t0) * whip.a.amp)) whip = { run, a };
const whipS = at(whip.run, (whip.a.t0 + whip.a.t1) / 2, POSE.s);
// Un virage serré là où le peloton est encore groupé (vers 12 s de course) ; la caméra à l'intérieur.
const sorted = runs.map((r) => ({ r, s: at(r, 12, POSE.s) })).sort((a, b) => a.s - b.s);
const mid = sorted[Math.floor(sorted.length / 2)];
let turnS = mid.s, kmax = 0;
for (let s = mid.s - 20; s < mid.s + 60; s += 1) if (Math.abs(track.sample(s).k) > kmax) { kmax = Math.abs(track.sample(s).k); turnS = s; }
const inside = (() => {
  const a = track.sample(turnS - 6), b = track.sample(turnS + 6), c = track.sample(turnS);
  return Math.sign(((a.x + b.x) / 2 - c.x) * c.rx + ((a.z + b.z) / 2 - c.z) * c.rz) || 1;
})();
const turnT = timeAt(mid.r, turnS);
const lastFinish = Math.max(...runs.map((r) => r.finish));
console.log(`whip : n° ${whip.run.num} à ${whipS.toFixed(0)} m (${whip.a.t0.toFixed(1)}–${whip.a.t1.toFixed(1)} s) · virage à ${turnS.toFixed(0)} m, rayon ${(1 / kmax).toFixed(0)} m, n° ${mid.r.num} y passe à ${turnT.toFixed(1)} s`);

// Dans la page : la caméra de bord de piste à (s, u) du tracé, h mètres au-dessus du sol.
const tvAt = (s, u, h, follow, fov = 40) => `(() => { const t = __game.sim.track, f = t.sample(${s}); __game.setTV({ pos: [f.x + f.rx * ${u}, t.trailY(${s}, ${u}) + ${h}, f.z + f.rz * ${u}], follow: ${JSON.stringify(follow)}, fov: ${fov} }); })()`;
// Le joueur posé à l'écart, immobile et caché, le temps de filmer les rivaux ailleurs sur la piste.
const away = (s) => `?carte=${MAP}&film&shot&nohud&nohelp&depart=${s.toFixed(0)}&vitesse=0`;
const stageOnly = `(() => { __game.showPeloton(); Object.assign(__game.stage, { freeze: true, hidePlayer: true }); })()`;
const range = (t0, t1) => Array.from({ length: Math.round((t1 - t0) * FPS) }, (_, i) => t0 + i / FPS);

/**
 * Les plans. query : l'adresse ; setup : code exécuté dans la page ; pre : [pas, nombre] d'avance sans garder les
 * images ; frames : nombre d'images à garder, dt : leur pas ; times : sinon, le temps du peloton de chaque image.
 */
const SCENES = {
  // Le premier rang sur la grille, pied à terre : les tenues de près.
  portrait: { query: `?carte=${MAP}&peloton&film&shot&nohud&nohelp`, setup: tvAt(front + 6, 0.9, 1.25, 2, 30), pre: [0.1, 20], frames: 1, dt: 0.04 },
  // Le joueur sur la grille, vue extérieure, avec l'affichage (place, rivaux sur la barre de progression).
  grille: { query: `?carte=${MAP}&peloton&film&shot&nohelp&cam=chase`, pre: [0.1, 20], frames: 1, dt: 0.04 },
  // Le GO : le peloton s'élance, vu du bord de la grille.
  depart: { query: `?carte=${MAP}&peloton&film&shot&nohud&nohelp&autopilot`, setup: wide ? tvAt(front + 4, -11, 1.4, 3, 46) : tvAt(front + 7, -3.6, 1.3, 5, 40), pre: [0.25, 14], frames: 72, dt: 1 / FPS },
  // Dans le peloton, en vue subjective, cinq secondes après le GO.
  casque: { query: `?carte=${MAP}&peloton&film&shot&nohelp&autopilot`, pre: [0.25, 36], frames: 1, dt: 0.04 },
  // Le même moment de l'extérieur.
  exterieur: { query: `?carte=${MAP}&peloton&film&shot&nohud&nohelp&autopilot&cam=chase`, pre: [0.25, 34], frames: 1, dt: 0.04 },
  // Un whip, vu de côté.
  whip: { query: away(whipS - 40), setup: `${stageOnly};${tvAt(whipS + 2, -whip.a.dir * 8, 2.4, whip.run.num, 20)}`, times: range(whip.a.t0 - 0.8, whip.a.t1 + 0.5) },
  // Le peloton dans un virage, vu de l'intérieur.
  virage: { query: away(turnS - 40), setup: `${stageOnly};${tvAt(turnS, inside * 6.5, 1.7, mid.r.num, 46)}`, times: range(turnT - 1.8, turnT + 1.2) },
  // L'aire d'arrivée : tout le monde arrêté, pied à terre.
  arrivee: { query: away(track.sFinish + 30), setup: `${stageOnly};${tvAt(track.sFinish + 37, 2.5, 2.6, 7, 52)}`, times: [lastFinish + 7, lastFinish + 7.04, lastFinish + 7.08] },
  // L'écran d'arrivée avec le classement (La Forêt, plus courte : toute la manche en avance rapide).
  resultats: { query: '?carte=foret&peloton&film&shot&nohelp&autopilot', ff: 95, frames: 1, dt: 0.04 },
};

const scenes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: BROWSERS.find((p) => existsSync(p)), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  for (const name of scenes) {
    const sc = SCENES[name];
    if (!sc) { console.error(`plan inconnu : ${name}`); continue; }
    const out = `${MAP === 'alpes' ? '' : MAP + '-'}${name}`; // (les plans d'une autre piste ne remplacent pas ceux de La Grande Combe)
    const dir = `shots/film/${out}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    const t0 = Date.now();
    await page.goto(`http://localhost:5192/${sc.query}`);
    await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
    if (sc.setup) await page.evaluate(sc.setup);
    if (sc.pre) for (let i = 0; i < sc.pre[1]; i++) await page.evaluate((dt) => __game.advance(dt), sc.pre[0]);
    if (sc.ff) {
      await page.evaluate((s) => __game.fastForward(s), sc.ff);
      await new Promise((r) => setTimeout(r, 2500)); // l'écran d'arrivée s'affiche 1,8 s après la ligne
    }
    const times = sc.times || Array.from({ length: sc.frames }, () => null);
    for (let i = 0; i < times.length; i++) {
      if (times[i] != null) await page.evaluate((t) => { __game.stage.pelT = t; }, times[i]);
      await page.evaluate((dt) => __game.advance(dt), sc.dt || 1 / FPS);
      await page.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 86, timeout: 300000 });
    }
    console.log(`${name} : ${times.length} image(s) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await page.close();
    if (times.length > 2) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => `${dir}/${f}`);
      await sharp(files, { join: { animated: true } }).webp({ quality: 72, delay: Math.round(1000 / FPS), loop: 0 }).toFile(`shots/film/${out}.webp`);
      console.log(`  → shots/film/${out}.webp`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) { console.error('Erreurs dans la page :\n' + errors.join('\n')); process.exit(1); }
