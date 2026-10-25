// Les images des pistes pour le menu : une capture du jeu sur chaque piste, à un bel endroit, en vue extérieure.
//   node tools/menu-images.mjs [piste…]   → public/menu/<piste>.jpg (640 × 360)
// Le rendu est logiciel (pas de carte graphique) : compter une à deux minutes par piste.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

// La vue de chaque piste : où poser le vélo, à quelle vitesse, et combien d'images de jeu avant la capture.
const VIEWS = {
  foret: { query: 'depart=250&vitesse=8', frames: 30 },
  alpes: { query: 'depart=40&vitesse=8', frames: 40 },
  avalanche: { query: 'depart=200&vitesse=10', frames: 30 },
  // (en l'air au-dessus du Big One, vélo couché)
  bikepark: { query: 'depart=1060&vitesse=12&mode=normal&figure=whip', frames: 0, until: "g.sim.race.s > g.sim.track.features.find((f) => f.name === 'le Big One').lipS + 5" },
  single: { query: 'depart=420&vitesse=6', frames: 30 },
};

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
mkdirSync('public/menu', { recursive: true });
const only = process.argv.slice(2);
const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const [map, v] of Object.entries(VIEWS)) {
    if (only.length && !only.includes(map)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.error(map, e.message));
    await page.goto(`http://localhost:5192/?carte=${map}&${v.query}&autopilot&cam=chase&nohelp&nohud&film&shot`);
    await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
    await page.evaluate(({ frames, until }) => {
      const g = window.__game, ok = until ? new Function('g', `return (${until});`) : null;
      for (let n = 0; ok ? !ok(g) && n < 2000 : n < frames; n++) g.fastForward(1 / 60, 1 / 60);
      for (let k = 0; k < 3; k++) g.advance(0.0001); // (quelques images pour les ombres et la caméra)
    }, v);
    const png = await page.screenshot({ timeout: 300000 });
    await sharp(png).resize(640, 360).jpeg({ quality: 82, mozjpeg: true }).toFile(`public/menu/${map}.jpg`);
    console.log(`public/menu/${map}.jpg`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
