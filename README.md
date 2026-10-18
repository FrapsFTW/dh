# Downhill

Une manche de descente VTT chronométrée, comme en Coupe du monde, dans le navigateur. Le vélo est entièrement
simulé : on dose les freins, le poids et l'inclinaison, et c'est le grip des pneus qui décide.

## Lancer le jeu

```sh
npm install
npm run dev
```

Puis ouvrir http://localhost:5180. Une manette est fortement conseillée : tout est progressif (gâchettes, sticks).

| | Manette | Clavier (AZERTY) |
|---|---|---|
| Tourner | stick gauche ↔ | Q D ou ← → |
| Poids en avant / en arrière | stick gauche ↕ | E / A |
| Frein avant · frein arrière | gâchette droite · gauche | S ou ↓ (les deux), Maj (l'arrière seul) |
| Se comprimer puis sauter | A (maintenir, relâcher) | Espace (maintenir, relâcher) |
| Figure, en l'air | A maintenu + stick (↓ backflip, ↑ frontflip, ↔ 360) | Espace maintenu + A, E, Q D |
| Pédaler | X ou RB | Z ou ↑ |
| Regarder autour | stick droit | |
| Repartir du dernier point | Y ou B | R |
| Recommencer la manche | Start | Entrée |
| Vue extérieure | Select | C |
| Fantôme du record | | F |
| Changer de mode (avant le départ) | LB | M |
| Réglages de la physique · pilote auto · aide | | G · P · H |

Paramètres d'adresse utiles : `?mode=normal` ou `?mode=ultra`, `?autopilot` (démo), `?autopilot&figure=backflip` (ou `360`, `frontflip` : le
pilote auto tente la figure au saut d'arrivée), `?cam=chase` (vue extérieure), `?seed=12` (une autre forêt),
`?qualite=basse` (ombres et antialiasing allégés, pour les petites cartes graphiques). La résolution s'adapte aussi
toute seule si les images ralentissent.

## Deux modes

La physique est la même dans les deux modes. Le mode **Normal** (par défaut) ajoute ce que ferait d'instinct un bon
pilote et pardonne un peu plus. Le mode **Ultra-réaliste** garde les réglages de Terrain Rider tels quels.

| | Normal | Ultra-réaliste |
|---|---|---|
| Frein avant | dosé : la roue ne bloque pas, le pilote relâche avant de passer par-dessus le guidon | à toi de doser |
| Freiner en l'air | sans effet (pas de roue bloquée à la réception) | la roue se bloque |
| En l'air | le pilote replace le vélo dans l'axe de la réception et finit une rotation lancée | aucune aide |
| Grip | +10 %, l'arrière décroche un peu moins | réglages d'origine |
| Chute sur un choc | perte de 5 m/s en 25 ms | 3 m/s |
| Inclinaison, bascule avant, bascule arrière tolérées | 80°, 62°, 75° | 72°, 54°, 66° |
| Hors des rubalises | 3 s tolérées | 1,5 s |

Chaque mode a son record et son fantôme. On choisit le mode sur l'écran d'aide, avec M ou LB avant le départ, ou dans
les réglages (G).

## Les figures

En l'air, maintenir le bouton de saut groupe le pilote. Son inertie baisse et le moment cinétique se conserve : il
tourne plus vite, comme un plongeur. Le stick règle la rotation : en arrière backflip, en avant frontflip, sur le côté
360. Relâcher le bouton ouvre le pilote et ralentit la rotation. Une figure compte si on reste debout une demi-seconde
après la réception. Elle s'affiche à l'écran et dans les résultats.

Le saut d'arrivée est fait pour ça : plus d'une seconde en l'air à la bonne vitesse, et assez de place sous le vélo
pour que la tête passe. Les tables sont trop courtes.

- En Normal, il suffit de lâcher le bouton une fois la moitié du tour passée : le pilote finit la rotation et se pose.
- En Ultra-réaliste, il faut arrêter la rotation soi-même, en poussant le stick dans l'autre sens sans se dégrouper,
  puis se poser droit. Si le vélo tourne encore en touchant le sol, c'est la chute.

## Une manche

Comme en course : on part de la cabane après un compte à rebours (trois bips, puis le long), le chrono démarre au
faisceau, quatre temps intermédiaires s'affichent en vert ou en rouge par rapport au record, un radar mesure la
vitesse avant le saut final. Il faut rester entre les rubalises : plus d'une seconde et demie dehors renvoie au
dernier point de passage, et le chrono continue. Le meilleur temps est enregistré dans le navigateur avec la
trajectoire complète : on peut ensuite courir contre son fantôme (touche F).

La piste (884 m, 181 m de dénivelé) : rampe de départ, schuss, virages relevés, bosses à pomper, épingle, traversée
de racines en dévers, pierrier dans la pente raide, drop, deux épingles, deux tables, road gap au-dessus d'une route
forestière, virage final et grand saut d'arrivée.

## La physique

Tout est dans `src/sim/bike.js`. Elle reprend l'architecture et les réglages de
[Terrain Rider](https://terrainrider.com) (un jeu de VTT en three.js et Rapier), réécrite ici :

- **Un seul corps rigide, mais le centre de gravité bouge.** Le pilote (70 % de la masse) recule, avance, se décale
  sur le côté, s'accroupit : le centre de gravité suit, la répartition du poids change vraiment. Reculer évite de
  passer par-dessus le guidon dans la pente ; avancer charge la roue avant et aide à tourner.
- **Des roues qui tournent pour de vrai.** Chaque roue a son inertie et sa vitesse de rotation. Les freins sont des
  couples sur les roues : trop de frein bloque la roue. Le pédalage entraîne la roue arrière.
- **Des pneus réalistes.** La déformation du pneu suit le glissement avec une longueur de relaxation, la force vient
  de la formule de Pacejka. Freiner et tourner se partagent le même grip. L'arrière décroche plus facilement que
  l'avant. Une roue plus chargée accroche plus. Le grip dépend du sol (terre, terre sèche, cailloux, racines, bois, herbe).
- **La direction.** Le joueur demande une courbe. Le pilote penche le vélo à l'angle qu'il faut et tient l'équilibre
  en braquant le guidon, comme sur un vrai vélo : l'équilibre n'est pas imposé, il vient du guidon. L'inclinaison
  permise grandit dans un virage relevé (on y passe beaucoup plus vite) et diminue en dévers.
- **La suspension** : 200 mm devant et derrière, ressort, amortisseur en compression et en détente, butée.
- **Les effets gyroscopiques** des roues, et le couple de réaction quand on freine ou qu'on pédale.
- **Le bunny-hop** : maintenir pour se comprimer, relâcher pour sauter. En l'air, le poids fait tourner le vélo.

Ajouts par rapport à Terrain Rider, pour la descente : deux freins séparés, le guidon qui reste droit quand la roue
avant ne porte plus (en l'air, dans les cailloux), un léger amortissement du roulis en l'air, les figures (le pilote groupé change l'inertie du vélo) et les aides du
mode Normal (`src/sim/modes.js`).

Tous les réglages sont modifiables en jeu (touche G).

## La piste

Générée par `src/sim/track.js`, identique à chaque lancement (même graine). Les sauts sont dessinés d'après la
trajectoire : la réception suit la parabole d'un pilote à la vitesse prévue, on se pose en douceur entre environ
−30 % et +20 % de cette vitesse. Le relief autour suit la piste, et l'aire d'arrivée est au fond de la vallée.

## L'affichage

- `src/render/ground.js` : le sol et la piste, un seul matériau procédural (terre tassée, trace, bords poussiéreux,
  traces de freinage, herbe, sous-bois, roche).
- `src/render/vegetation.js` : sapins, feuillus, herbes, fougères, rochers, troncs (en instances, par zones).
- `src/render/course.js` : rubalise, cabane de départ et son horloge, arches, radar, aire d'arrivée, public, panneaux.
- `src/render/sky.js` : ciel, nuages, montagnes à l'horizon.
- `src/render/bikeModel.js` et `src/render/rider.js` : le vélo (le modèle 3D fourni) et le pilote articulé.
- `src/audio.js` : le son, entièrement synthétisé.

## Le vélo

`public/models/bike.glb` est préparé à partir du modèle fourni par `tools/prepare-bike.mjs` : remise à l'échelle,
découpage en pièces mobiles (cadre, direction, fourreaux de fourche, roues), cintre ramené à 80 cm, maillage allégé
(137 000 triangles) et compressé, textures en WebP. 80 Mo au départ, 2,6 Mo à l'arrivée.

```sh
npm run prepare-bike
```

Pour vérifier le découpage : `node tools/view-model.mjs /models/bike.glb "front&parts&steer=25&comp=0.1"` colorie
chaque pièce et braque la direction (captures dans `shots/`).

## Vérifier

```sh
npm test         # la piste et la physique : freinages, virages, poids, bunny-hop, sauts, figures, les deux modes
npm run shots    # lance le jeu dans Edge sans écran et enregistre des captures dans shots/
npm run trace    # le pilote auto descend la piste et imprime son état
```

## Crédits

- [three.js](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache 2.0), [lil-gui](https://lil-gui.georgealways.com) (MIT),
  [glTF Transform](https://gltf-transform.dev) et [meshoptimizer](https://github.com/zeux/meshoptimizer) (MIT).
- La physique du vélo s'inspire de [Terrain Rider](https://terrainrider.com).
