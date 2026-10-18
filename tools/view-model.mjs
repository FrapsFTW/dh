// Captures d'un modèle sous plusieurs angles : node tools/view-model.mjs [/chemin/modele.glb] [vues...]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const model = process.argv[2] || '/public/models/bike-raw.glb';
const views = process.argv.slice(3).length ? process.argv.slice(3) : ['side', 'front', 'top', 'persp'];
mkdirSync('shots', { recursive: true });
const server = await createServer({ server: { port: 5191, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const v of views) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on('pageerror', (e) => console.error(e.message)); page.on('console', (m) => console.log('console:', m.text())); page.on('requestfailed', (r) => console.log('failed:', r.url(), r.failure()?.errorText));
    await page.goto(`http://localhost:5191/tools/viewer/?v=${v}&m=${encodeURIComponent(model)}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
    console.log(v, JSON.stringify(await page.evaluate(() => window.__info)));
    await page.screenshot({ path: `shots/model-${v.replace(/[^a-z0-9]+/gi, "-")}.png` });
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
