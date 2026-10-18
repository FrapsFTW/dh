import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // chemins relatifs : le jeu marche aussi dans un sous-dossier (GitHub Pages, /dh/)
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 }, // Rapier embarque son moteur (wasm) dans le JS
  server: { port: 5180 },
  preview: { port: 5181 },
});
