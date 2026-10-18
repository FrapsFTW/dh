// Vues orthographiques graduées d'un modèle, pour relever des cotes (axes de roues, douille…) :
//   node tools/ortho-shot.mjs nom "m=/models/bike.glb&box=x0,x1,y0,y1&axis=z&step=0.05&size=1600x900" [nom2 "…"]
// axis : z vue de côté, x de face, y de dessus ; slab=d0,d1 ne garde qu'une tranche. Captures dans shots/.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const jobs = process.argv.slice(2);
  for (let i = 0; i < jobs.length; i += 2) {
    const [name, query] = [jobs[i], jobs[i + 1]];
    const m = /size=(\d+)x(\d+)/.exec(query);
    const page = await browser.newPage({ viewport: { width: m ? +m[1] : 1600, height: m ? +m[2] : 900 } });
    page.on('pageerror', (e) => console.error(e.message));
    await page.goto(`http://localhost:5192/tools/viewer/ortho.html?${query}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
    await page.screenshot({ path: `shots/${name}.png` });
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
