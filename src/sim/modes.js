// Les modes de jeu. La physique est la même : le mode Normal ajoute ce que ferait d'instinct un bon pilote
// (doser le frein avant, replacer le vélo en l'air) et pardonne un peu plus (grip, chocs, sorties de balisage).
// Le mode Ultra-réaliste garde les réglages de Terrain Rider tels quels.

import { DEFAULT_PARAMS } from './bike.js';

export const MODES = {
  normal: {
    name: 'Normal',
    blurb: 'Réaliste, mais le pilote t\'aide : il dose le frein avant, replace le vélo en l\'air et encaisse mieux les chocs.',
    outTime: 3, // secondes tolérées hors du balisage
    params: {
      gripScale: 1.1,
      sideSlipRear: 3.2, // l'arrière décroche un peu moins vite
      brakeAssist: 1,
      airAssist: 1,
      airAssistFreq: 5,
      airAssistMaxTorque: 450,
      trickPitchRate: 8.5,
      trickSpinRate: 8,
      trickPitchTorque: 450,
      trickSpinTorque: 280,
      crashImpactSpeed: 5,
      crashLeanDeg: 80,
      crashNoseDownDeg: 62,
      crashNoseUpDeg: 75,
    },
  },
  ultra: {
    name: 'Ultra-réaliste',
    blurb: 'Aucune aide : roues qui bloquent, passage par-dessus le guidon, réception à faire soi-même.',
    outTime: 1.5,
    params: {},
  },
};

export const MODE_IDS = Object.keys(MODES);

/** Les réglages complets d'un mode. */
export function modeParams(mode) {
  return { ...DEFAULT_PARAMS, ...(MODES[mode] || MODES.ultra).params };
}
