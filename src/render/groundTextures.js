// Les photos du sol (voir groundLayers.js et tools/ground-textures.mjs) : deux images où les sols sont empilés, dont
// on fait deux tableaux de textures, une couche par sol. À charger avant de construire la scène.

import * as THREE from 'three';
import { GROUND_LAYERS } from './groundLayers.js';

async function arrayTexture(url, srgb) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.width, N = GROUND_LAYERS.length, H = img.height / N;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = new Uint8Array(ctx.getImageData(0, 0, W, img.height).data.buffer);
  const tex = new THREE.DataArrayTexture(data, W, H, N);
  tex.format = THREE.RGBAFormat;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** { color, relief } : les deux tableaux de textures (couleur en sRGB ; normale et hauteur). */
export async function loadGroundTextures() {
  const base = import.meta.env.BASE_URL;
  const [color, relief] = await Promise.all([arrayTexture(`${base}textures/sol-couleur.jpg`, true), arrayTexture(`${base}textures/sol-relief.jpg`, false)]);
  return { color, relief };
}
