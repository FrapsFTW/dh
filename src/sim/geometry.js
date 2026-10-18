// La géométrie du vélo, mesurée sur le modèle 3D (public/models/bike.glb, préparé par tools/prepare-bike.mjs).
// La physique et l'affichage partagent ces cotes : ce qu'on voit est ce qui roule.
//
// Repère du vélo : origine au sol, à mi-chemin entre les deux roues, -z vers l'avant, +y vers le haut, +x à droite.
// Les cotes sont celles du vélo détendu (suspensions sorties), roues posées sur y = 0.

const DEG = Math.PI / 180;

export const GEOMETRY = {
  modelScale: 1.72, // le modèle fourni est à l'échelle 1/1,72
  frontAxle: { y: 0.366, z: -0.642 },
  rearAxle: { y: 0.363, z: 0.642 },
  frontRadius: 0.368, // 29 pouces devant
  rearRadius: 0.363,
  headAngle: 63 * DEG, // angle de direction d'un vélo de descente
  steerPivot: { y: 1.015, z: -0.266 }, // un point de l'axe de direction (le haut de la douille)
  bottomBracket: { y: 0.35, z: 0.19 }, // le pédalier
  swingPivot: { y: 0.404, z: 0.199 }, // le pivot du bras oscillant (affichage)
  grips: { y: 1.075, z: -0.23, halfWidth: 0.41 }, // les poignées (le cintre fait 82 cm)
  frontTravel: 0.2, // 200 mm de débattement à l'avant et à l'arrière
  rearTravel: 0.2,
};

const G = GEOMETRY;
G.wheelbase = G.rearAxle.z - G.frontAxle.z;
// L'axe de direction, vers le haut : incliné vers l'arrière.
G.forkAxis = { x: 0, y: Math.sin(G.headAngle), z: Math.cos(G.headAngle) };
// Points d'ancrage des suspensions : la position de l'axe de roue quand la suspension est entièrement comprimée.
G.frontAnchor = { x: 0, y: G.frontAxle.y + G.forkAxis.y * G.frontTravel, z: G.frontAxle.z + G.forkAxis.z * G.frontTravel };
G.rearAnchor = { x: 0, y: G.rearAxle.y + G.rearTravel, z: G.rearAxle.z };
