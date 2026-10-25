# Downhill

Une manche de descente VTT chronométrée, comme en Coupe du monde, dans le navigateur. Le vélo est entièrement
simulé : on dose les freins, le poids et l'inclinaison, et c'est le grip des pneus qui décide. Cinq pistes : La Forêt
(884 m), La Grande Combe (2,3 km de haute montagne), L'Avalanche (5 km, du glacier au village), Le Bike Park (des sauts de
toutes les formes, comme à Whistler) et Le Single (un sentier étroit en épingles au-dessus de la mer, sur la
Riviera).

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
| Whip : coucher le vélo, en l'air | stick gauche ↔ | Q D (sans Espace) |
| Figure, en l'air | A maintenu + stick (↓ backflip, ↑ frontflip, ↔ 360) | Espace maintenu + A, E, Q D |
| Pédaler | X ou RB | Z ou ↑ |
| Regarder autour | stick droit | |
| Repartir du dernier point | Y ou B | R |
| Recommencer la manche | Start | Entrée |
| Vue extérieure | Select | C |
| Fantôme du record | | F |
| Changer de mode (avant le départ) | LB | M |
| Changer de piste (avant le départ) | sur l'écran d'aide ou dans les réglages | |
| Réglages de la physique · pilote auto · aide | | G · P · H |

Paramètres d'adresse utiles : `?carte=alpes` (La Grande Combe), `?carte=foret`, `avalanche`, `bikepark` ou `single`, `?mode=normal` ou `?mode=ultra`, `?autopilot` (démo), `?autopilot&figure=backflip` (ou `360`, `frontflip` : le
pilote auto tente la figure au saut d'arrivée), `?cam=chase` (vue extérieure), `?seed=12` (une autre forêt),
`?qualite=basse` (ombres, antialiasing et forêt allégés, pour les petites cartes graphiques), `?depart=600&vitesse=13`
(lancé à 600 m de la cabane). La résolution s'adapte aussi
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

Chaque piste a, dans chaque mode, son record et son fantôme. On choisit le mode sur l'écran d'aide, avec M ou LB avant le départ, ou dans
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

Le **whip** : en l'air, sans se grouper, le stick sur le côté couche le vélo, comme les pros ; relâché, le pilote le
redresse. C'est un geste du pilote : il ne change pas la trajectoire, l'affichage tourne le vélo autour des hanches (et
les autres joueurs le voient en ligne). Un whip franc, redressé avant de se poser, compte comme une figure. Posé
encore couché, on tombe en Ultra-réaliste ; en Normal, le pilote rattrape le vélo, mais la figure ne compte pas.

## Une manche

Comme en course : on part de la cabane après un compte à rebours (trois bips, puis le long), le chrono démarre au
faisceau, les temps intermédiaires s'affichent en vert ou en rouge par rapport au record, un radar mesure la
vitesse avant le saut final. Il faut rester entre les rubalises : plus d'une seconde et demie dehors (trois en Normal)
renvoie en arrière, et le chrono continue. Après une chute ou une sortie, on repart du dernier point de reprise passé
(il y en a un tous les 150 m environ, jamais sur un saut, et jamais au-delà d'une porte qu'on n'a pas passée). Le meilleur temps est enregistré dans le navigateur avec la
trajectoire complète : on peut ensuite courir contre son fantôme (touche F).

### Le départ en ligne

Avec la touche N (ou le bouton de l'écran d'aide), on part en ligne avec vingt rivaux, en rangs de trois sur une
grille juste après l'arche ; le joueur a le dossard 21, au quatrième rang. Le chrono part au GO pour tout le monde. En
haut à droite : la place, et l'écart avec le rival de devant et celui de derrière ; à l'arrivée, le classement. Les
rivaux passent au travers du joueur (pas de collisions). Ce départ a son propre record. Pour l'ouvrir directement :
`?peloton`.

Chaque rival est une descente du pilote automatique, enregistrée à l'avance avec son attaque, son côté de piste
préféré et son temps de réaction (`src/sim/peloton.js`), puis rejouée au même chrono que le joueur. Son engagement
(`attack`) lui fait lâcher les freins bien plus que le pilote auto des tests : plus vite en ligne droite, freinages
plus tardifs, bosses et racines passées lancé, pédalage jusqu'à 47 km/h, sauts abordés à la dernière seconde ;
dans les cailloux, il reste prudent (c'est là qu'on tombe). Il se replace avant un goulet, pas dedans. Il ne
touche jamais la rubalise : sinon, sa descente est refaite. En l'air,
certains font des whips ou des tables ; après la ligne, chacun freine jusqu'à sa place et pose le pied. Si une piste
change, il faut réenregistrer son peloton (le test le signale) :

```sh
node tools/peloton.mjs [piste…]   # → public/peloton/<piste>.bin, une descente par rival, en parallèle
```

## Jouer en ligne

Avec ses potes, jusqu'à huit, chacun sur son ordinateur. Sur l'écran d'accueil (H), « Créer un salon » donne un code
de cinq lettres et un lien à envoyer (`?salon=CODE`) ; les autres l'ouvrent, ou tapent le code. Le premier arrivé est
l'hôte : il choisit la piste (tout le monde la charge) et le mode, puis lance la course. Tout le monde part au même GO,
sur une grille comme le départ en ligne : le compte à rebours est réglé sur l'heure du serveur, que chacun estime au
départ. Pendant la course, on voit les autres rouler (on passe au travers), sa place et l'écart avec celui de devant et
celui de derrière ; à l'arrivée, le classement se complète à mesure que les autres arrivent, et l'hôte relance. Entrée
pendant une course en ligne, c'est abandonner. Le nom et la couleur de la tenue se choisissent dans le salon.

Chacun envoie sa pose (le même échantillon que les rivaux du peloton) quinze fois par seconde ; les autres l'affichent
avec 160 ms de retard, entre deux poses reçues (`src/render/remote.js`). Le serveur des salons (`server/`) ne fait que
garder le salon (les joueurs, l'hôte, la piste, le départ, les temps) et relayer les poses : ses règles sont dans
`server/src/salon.js` (testées par `npm test`), branchées sur un Worker Cloudflare et un Durable Object par salon
(`server/src/index.js`). L'offre gratuite de Cloudflare suffit largement entre potes.

Mettre le serveur en ligne (une fois) :

```sh
cd server
npm install
npx wrangler login     # ouvre le navigateur : se connecter à son compte Cloudflare (gratuit)
npx wrangler deploy    # affiche l'adresse du serveur : https://dh-salons.<compte>.workers.dev
```

Le jeu en ligne joint `wss://dh-salons.downhill.workers.dev` (`SERVEUR`, dans `src/net/online.js`). Pour un autre
serveur : la variable `SERVEUR` du dépôt GitHub (Settings → Secrets and variables → Actions → Variables), que la mise
en ligne passe à la compilation, ou `?serveur=wss://…` dans l'adresse du jeu.

`npm run dev` joint aussi ce serveur. Pour un serveur sur sa machine, `?serveur=local` (`ws://localhost:8787`) :
`node server/dev.mjs` (les mêmes règles, sur
un serveur Node ; après un `npm install` dans `server/`) ou `cd server && npx wrangler dev` (le vrai Worker ; sous Windows, il lui faut les bibliothèques
Visual C++ de Microsoft). Pour essayer à deux sur une machine : deux fenêtres (chaque onglet est un joueur).

## Les pistes

**La Forêt** (884 m, 181 m de dénivelé, environ 1 min 20) : rampe de départ, schuss, virages relevés, bosses à
pomper, épingle, traversée de racines en dévers, pierrier dans la pente raide, drop, deux épingles, deux tables, road
gap au-dessus d'une route forestière, virage final et grand saut d'arrivée.

**La Grande Combe** (2,3 km, 450 m de dénivelé, plus de 3 min 30, cinq intermédiaires). Une longue descente de
montagne en trois tiers, comme à Fort William (2,8 km, 550 m de dénivelé) : un haut découvert et caillouteux, un
milieu en forêt, un bas très rapide.

- En haut, au-dessus des arbres : la cabane sur une crête, une piste de graviers (moins de grip), la dalle de granit
  (plus de grip), le grand pierrier à 40 % et son drop de sortie, puis quatre lacets dans la face, avec des bosses à
  pomper et une table.
- Au milieu, la forêt : le toboggan, droit dans la pente au milieu des racines, la traversée en dévers vers le pont du
  torrent (on entend l'eau), une grande épingle, le pierrier du bois, la marche.
- En bas, l'autoroute : un bike park, la partie la plus rapide, une table, un step-down, un road gap, de grands
  virages relevés, des bosses, et le saut d'arrivée.

**L'Avalanche** (5 km, plus de 1 000 m de dénivelé, environ 7 minutes, cinq intermédiaires). Toute la montagne, du
glacier au village, inspirée de la Megavalanche de l'Alpe d'Huez (20 km, 2 600 m de dénivelé, départ en ligne sur le
glacier du Pic Blanc). Le départ en ligne y est choisi par défaut : sept de front sur la neige.

- Le glacier : 40 m de large, balisé de piquets orange, une trace damée au milieu (on file à 80 km/h) et de la neige
  molle de chaque côté (moins de grip, on ralentit) ; les vagues de neige, de longues ondulations où l'on flotte
  vers 75 km/h ; des séracs et des crevasses sur les bords, un radar en bas.
- L'entonnoir : la neige s'arrête, le couloir se resserre entre les moraines jusqu'au goulet, un single de 100 m
  bordé de blocs (le bouchon de la Megavalanche).
- Les pierriers : trois pierriers, la dalle de granit, le drop du Pic.
- Le balcon : le sentier du balcon, un single en dévers bordé de blocs au-dessus du vide, des blocs, une vraie
  remontée (une vingtaine de mètres, il faut pédaler), le gué du torrent.
- Les lacets : six épingles dans la face, deux pierriers dans les traversées ; les premiers mélèzes, un single entre
  les troncs.
- Le bois : le couloir des sapins (un single entre les troncs, dans les racines), une piste forestière à traverser,
  le bike park et ses tables, le road gap.
- Le village : une ruelle pavée entre les maisons de pierre, une volée de marches, l'arrivée sur la place.

**Le Bike Park** (1,2 km, environ 1 min 40, quatre intermédiaires), comme la A-Line de Whistler, dans les montagnes
de la côte Pacifique : une piste de ski taillée dans une forêt de douglas de 25 à 40 m, couverte d'épilobes roses en
été, le télésiège au-dessus (pylônes, câble, sièges qui tournent, vélos accrochés derrière), des glaciers au loin.
Des berms (des virages relevés, qu'on prend vite) bordés de filets orange, un panneau avant chaque saut, et des sauts
tous différents :

- le kicker en bois (une lèvre de planches sur pilotis), une table, un step-up (on se pose plus haut qu'on n'a
  décollé) ;
- un step-down, le gap en bois façon North Shore (lèvre et réception en planches, un trou entre les deux) ;
- trois doubles, deux buttes de terre et un trou creusé entre elles ;
- des bosses, le drop en bois (un tablier sur pilotis qui finit dans le vide), le road gap ;
- le Big One devant l'arrivée, le plus gros saut du jeu (plus d'une seconde en l'air), pour un backflip, un 360 ou
  un gros whip ; la foule et la tour du speaker du concours de whips. En bas, les chalets de la station.

À côté de la ligne, une passerelle North Shore et son wallride.

**Le Single** (environ 550 m, 1 min 10, trois intermédiaires), comme à Finale Ligure, sur la Riviera : une pente à
38 % au-dessus de la mer, de la terre rouge, du calcaire blanc, des pins maritimes et des chênes verts, le maquis
(genêt, lavande, lentisques), les murets de pierre sèche des anciennes terrasses et leurs oliviers, des maisons
ligures (crépi pastel, tuiles, volets verts) et une chapelle. Le sentier est à peine plus large qu'un guidon : 2,2 m
entre les rubalises presque de bout en bout, des pins qui les frôlent. Sept épingles de 11 m de rayon reliées par des
traversées, des racines, une dalle calcaire, un pierrier bordé de blocs, une petite marche, des marches de pierre.

Une piste aussi longue que L'Avalanche n'a de relief détaillé (avec sa physique), d'arbres et de décor que dans une bande de 60 m
autour d'elle ; au-delà, le relief lointain. Le glacier, la remontée, le gué, les marches et le village sont des
modules de la carte (`src/sim/maps.js`), comme les sauts. Les passages étroits aussi (`narrow`) : la rubalise se
resserre à moins de 3 m, la trace à 1,5 m, et les bords se garnissent de troncs ou de blocs, de vrais obstacles.

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

Chaque piste est décrite dans `src/sim/maps.js` : ses points de passage, son relief, ses modules (sauts, pierriers,
racines, dévers, dalle, pont…), ses portes, sa forêt. `src/sim/track.js` en fait le tracé, le sol et la physique,
identiques à chaque lancement (même graine). Les sauts sont dessinés d'après la trajectoire : la réception suit la
parabole d'un pilote à la vitesse prévue, on se pose en douceur entre environ −15 % et +15 % de cette vitesse au
moins. Le raccord après la réception est allongé tant qu'il écraserait le pilote (dans une pente raide, la
réception d'un drop finit bien sous la pente). Le relief autour suit la piste, sauf sous un pont, et l'aire
d'arrivée est au fond de la vallée.

Pour dessiner une piste : `node tools/plan.mjs alpes` en fait le plan vu de dessus (`shots/plan-alpes.png`, relief
ombré, pente et virages) et `node tools/jumps.mjs alpes` vérifie chaque saut.

## L'affichage

- `src/render/ground.js` : le sol et la piste, un seul matériau fait de photos de sols (`groundLayers.js` :
  prairie, alpage, aiguilles, terre, gravier, roche, pierrier, neige, pavés). Le shader choisit le sol d'après la
  position (forêt, altitude, pente, piste, trace, bords poussiéreux) et mêle les sols selon leur relief : les pierres
  percent la terre, la terre remplit les creux. Chaque photo est décalée par endroits, le motif ne se répète pas. De
  loin, une forêt est la masse sombre de ses cimes. Un relief lointain prolonge la carte.
- `src/render/range.js` : les massifs jusqu'à 20 km (la carte de hauteurs `public/textures/massif.png`, faite par
  `tools/massif.mjs`), posés sur le relief de la carte. Les ombres que les sommets portent les uns sur les autres et
  le creux des vallées sont calculés au lancement ; forêt, alpages, éboulis, roche et neige selon l'altitude, la pente
  et l'exposition. Ils sont dessinés avant la scène proche, avec leur propre profondeur (`post.js`).
- `src/render/atmosphere.js` et `src/render/sky.js` : l'air. La même fonction donne la couleur du ciel et la brume de
  l'éloignement, plus dense dans les vallées, bleutée à l'opposé du soleil, lumineuse face à lui : le lointain se fond
  exactement dans l'horizon. Elle remplace la brume de three.js dans tous les matériaux. Le ciel, avec ses nuages
  éclairés, sert aussi de lumière d'ambiance (une carte d'environnement prise au lancement).
- `src/render/rocks.js` : les rochers (blocs taillés par des plans de fracture, photo de roche projetée sur trois
  plans, lichen ou mousse dessus, pied assombri) et la glace des séracs.
- `src/render/trees.js` : la forêt. Sapins et feuillus générés par EZ-Tree au lancement, dessinés en instances ;
  le vrai modèle jusqu'à 35 m, avec ses ombres ; jusqu'à 70 m, le même arbre au feuillage allégé (une feuille sur
  trois, agrandie), sans ombre ; au-delà, un imposteur (sa photo sur deux plans croisés), et des milliers
  d'imposteurs sur le relief lointain. En montagne, les arbres s'arrêtent à une altitude, en rapetissant.
- `src/render/vegetation.js` : herbes, fleurs, fougères, rochers, troncs couchés. Les touffes ont des bords doux
  (alpha-to-coverage) et s'allument à contre-jour ; en altitude, l'herbe jaunit.
- `src/render/post.js` et `src/render/speedFx.js` : la sensation de vitesse, de 25 à 55 km/h : flou radial et
  légère aberration chromatique sur les bords, vision en tunnel, poussière qui file. La caméra vibre à haute vitesse
  (plus dans les cailloux) et le champ de vision s'ouvre ; le vent gronde dans le casque. Tout se règle avec G.
- `src/render/cameraRig.js` : la vue subjective. La tête amortit les coups que prend le cadre (réceptions, rollers,
  pierriers) et ne suit le vélo que pendant une vraie figure. L'affichage est interpolé entre deux pas de physique
  (`sim.renderState`), pour rester fluide sur un écran à 144 Hz.
- `src/render/course.js` : rubalise, cabane de départ et son horloge, arches, radar, aire d'arrivée, panneaux, le pont
  et le torrent ; le public, en quatre postures (bras levé, téléphone tendu…) ; les maisons du village en photos de
  pierre, de crépi, de lauze et de bois.
- `src/render/woodwork.js` : les modules en bois (`look: 'bois'`) : tablier de planches qui suit le profil, joues,
  pilotis, front du drop.
- `src/render/lift.js` : le télésiège du Bike Park ; `src/render/scenery.js` : ce qui fait l'identité d'une piste
  (`scenery` dans `maps.js`) : filets, panneaux, passerelle North Shore et chalets du Bike Park ; murets, marches de
  pierre, maisons ligures et chapelle du Single.
- Chaque carte choisit dans `maps.js` ses essences (`trees.kind` : sapins, douglas, pins maritimes, chênes verts,
  oliviers), sa flore (`env.flora`), la teinte de ses sols (`env.ground`), son soleil (`env.sun`) et, s'il y a lieu, sa
  mer (`env.sea`).
- `src/render/bikeModel.js` et `src/render/rider.js` : le vélo (le modèle 3D fourni) et le pilote articulé, avec sa
  tenue (maillot à motif, casque intégral et masque, genouillères, dossard). Ses hanches suivent le vélo avec un
  ressort (les jambes amortissent), il reste plus droit que le vélo en virage, la tête regarde où il va, pied extérieur
  en bas dans les virages, pied à terre à l'arrêt.
- `src/render/peloton.js` : les rivaux du départ en ligne : pose interpolée, whips et tables, vélo allégé de près
  (`public/models/bike-lod.glb`, fait par `tools/bike-lod.mjs`), en formes simples au loin, noms des plus proches.
- `src/render/arms.js` : les bras et les mains du pilote, détaillés (`public/models/bras.glb`) : posés sur le cintre à
  chaque image, doigts refermés sur les poignées, maillot et gants peints d'après des zones marquées sur le modèle.
- `src/audio.js` : le son. Des prises réelles (CC0, `public/sons/`) pour ce qui se reconnaît à l'oreille, de la synthèse
  pour ce qui suit la physique de près :
  - le roulement : une prise de terre et une de graviers, mêlées selon le sol de chaque roue, plus fortes et plus
    brillantes avec la vitesse, muettes dès qu'on décolle ; les planches et les pavés grondent, la neige souffle ;
  - la roue libre, clic par clic : chaque clic est un vrai clic, déclenché à la cadence d'un moyeu à 36 dents à la
    vitesse de la roue arrière ; elle se tait quand on pédale ;
  - la chaîne qui claque sur la base (dans les cailloux, sur les chocs), les chocs de suspension (un corps grave et
    un craquement), la réception d'un saut, le dérapage, le grondement des disques, la chute ;
  - le vent : un souffle par oreille dont la couleur monte avec la vitesse, et le battement grave dans le casque ;
  - l'ambiance de chaque piste et de chaque altitude : la forêt, l'alpage et ses cloches, le vent du glacier, la côte
    (cigales, mer, mouettes), le télésiège, le torrent du côté où il coule, les cloches du village ; elle s'efface
    sous le vent quand on va vite ;
  - le public, qui enfle à l'approche, cloches et cornes de chaque côté ; les rivaux qui passent tout près ;
  - une réverbération par piste (courte en forêt, longue en montagne) ; un compresseur et un limiteur : rien ne
    sature. Les volumes se règlent avec G (Son).

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
npm test         # les pistes et la physique : freinages, virages, poids, bunny-hop, sauts, figures, les deux modes,
                 # et le pilote auto qui descend chaque piste sans tomber
npm run shots    # lance le jeu dans Edge sans écran et enregistre des captures dans shots/
npm run trace    # le pilote auto descend la piste et imprime son état
node tools/film.mjs [plan…]   # tourne des plans du peloton image par image (shots/film/, animations WebP)
```

## Crédits

- [three.js](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache 2.0), [lil-gui](https://lil-gui.georgealways.com) (MIT),
  [glTF Transform](https://gltf-transform.dev) et [meshoptimizer](https://github.com/zeux/meshoptimizer) (MIT).
- La physique du vélo s'inspire de [Terrain Rider](https://terrainrider.com).
- Les bras : [fps arms](https://opengameart.org/content/fps-arms-rigged-only) de para (CC0), fait avec
  [MakeHuman](http://www.makehumancommunity.org).
- Les arbres : [EZ-Tree](https://github.com/dgreenheck/ez-tree) de Daniel Greenheck (MIT), écorces CC0 de TextureCan
  et Poly Haven.
- Les sols, les rochers et le village : photos CC0 de [Poly Haven](https://polyhaven.com) (leafy_grass,
  aerial_grass_rock, forest_leaves_04, forest_ground_04, rocky_trail, rock_face_03, gray_rocks, snow_02,
  cobblestone_05, castle_wall_slates, white_rough_plaster, roof_slates_03, weathered_planks), assemblées par
  `tools/ground-textures.mjs`.
- Les sons : des prises CC0 de [Freesound](https://freesound.org), préparées par `tools/sons.mjs` (boucles sans
  couture, niveaux) ; leurs auteurs sont dans `public/sons/CREDITS.txt`.
- L'érosion de `tools/massif.mjs` (désactivée par défaut, `DROPS=700000`) suit Hans Theobald Beyer, « Implementation
  of a method for hydraulic erosion » (2015).
