// Captures automatiques : lance le jeu dans Edge (ou Chrome) sans écran, en pilote automatique, et enregistre des images.
//   node tools/shots.mjs              → shots/*.png
//   node tools/shots.mjs rapide       → une seule capture (pour vérifier vite)
// Sert à vérifier que le jeu démarre sans erreur et à voir le rendu sans avoir à jouer.
// Le rendu est logiciel (pas de carte graphique) : c'est lent, d'où les longues attentes.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const executablePath = BROWSERS.find((p) => existsSync(p));
mkdirSync('shots', { recursive: true });
const quick = process.argv[2] === 'rapide';
const only = process.argv[2] && !quick ? process.argv[2] : null; // node tools/shots.mjs backflip : une seule série

const server = await createServer({ server: { port: 5190, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let failed = false;
const jobs = quick
  ? [['premiere-personne', '?autopilot&shot', [12, 75]], ['vue-exterieure', '?autopilot&shot&cam=chase', [7, 78.5]]]
  : [
    ['premiere-personne', '?autopilot&shot', [6, 24, 34, 62, 80]],
    ['vue-exterieure', '?autopilot&shot&cam=chase', [9, 44, 74]],
    ['aide', '?shot', [1]],
    ['backflip', '?autopilot&shot&cam=chase&mode=normal&figure=backflip', [75.95, 76.25, 76.55, 78]],
    ['backflip-casque', '?autopilot&shot&mode=normal&figure=backflip', [76.25]],
  ];
try {
  for (const [name, query, waits] of jobs) {
    if (only && !name.startsWith(only)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name}: ${m.text()}`); });
    const t0 = Date.now();
    await page.goto(`http://localhost:5190/${query}`);
    await page.waitForFunction(() => window.__game, null, { timeout: 240000 });
    console.log(`${name} : chargé en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    let elapsed = 0;
    for (const w of waits) {
      // On attend en temps de jeu (le rendu logiciel est lent : le jeu tourne au ralenti).
      await page.waitForFunction((target) => window.__game.sim.race.time >= target || window.__game.sim.race.state === 'arrivee', w, { timeout: 600000 }).catch(() => {});
      elapsed = w;
      const st = await page.evaluate(() => window.__game.state());
      const file = `shots/${name}-${elapsed}s.png`;
      await page.screenshot({ path: file });
      console.log(file, JSON.stringify(st));
    }
    const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
    console.log(`${name}: ~${fps.toFixed(1)} images/s (rendu logiciel, sans carte graphique)`);
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) { console.error('Erreurs dans la page :\n' + errors.join('\n')); process.exit(1); }
if (failed) process.exit(1);
