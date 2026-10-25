// Le jeu : le déroulé d'une manche (cabane, compte à rebours, course, arrivée), le chrono, le fantôme, les figures,
// les deux modes (Normal, Ultra-réaliste), les pistes, l'affichage.

import * as THREE from 'three';
import GUI from 'lil-gui';
import { initPhysics, createSim, STEP } from './sim/world.js';
import { MODES, MODE_IDS, modeParams } from './sim/modes.js';
import { MAPS, MAP_IDS, distToPolyline } from './sim/maps.js';
import { autopilot } from './sim/autopilot.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { createScene } from './render/scene.js';
import { loadGroundTextures } from './render/groundTextures.js';
import { loadMassif } from './render/range.js';
import { createBikeModel } from './render/bikeModel.js';
import { createCameraRig, CAMERA_SETTINGS } from './render/cameraRig.js';
import { createPost, SPEED_FX } from './render/post.js';
import { createSpeedParticles } from './render/speedFx.js';
import { loadPeloton, createPeloton } from './render/peloton.js';
import { PLAYER, gridSlots, poseOf } from './sim/peloton.js';
import { joinSalon, serverUrl, newCode, validCode, playerId, KITS } from './net/online.js';
import { createRemoteRiders, DELAY, whipStyle } from './render/remote.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const wait = () => new Promise((r) => setTimeout(r, 0));
const loading = async (text, f) => { $('loadText').textContent = text; $('loadBar').style.width = `${f * 100}%`; await wait(); await wait(); };

const fmt = (t) => {
  if (!Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
// Le jeu en ligne : ?salon=CODE rejoint un salon (voir src/net/online.js).
const salonCode = validCode(params.get('salon')) ? params.get('salon').toUpperCase() : null;
const fmtDelta = (d) => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
// La piste : ?carte=alpes, sinon la dernière choisie. En changer recharge la page (tout est reconstruit).
const MAP_KEY = 'downhill.carte';
const savedMap = (() => { try { return localStorage.getItem(MAP_KEY); } catch { return null; } })();
const mapId = [params.get('carte'), savedMap].find((m) => MAP_IDS.includes(m)) || 'foret';
function switchMap(m) {
  if (!MAP_IDS.includes(m) || m === mapId) return;
  try { localStorage.setItem(MAP_KEY, m); } catch { /* stockage indisponible */ }
  const q = new URLSearchParams(location.search);
  q.set('carte', m);
  location.search = q.toString();
}
// Un record par piste et par mode (les temps ne se comparent pas d'un mode à l'autre), et à part en départ en ligne
// (le chrono y part au GO, sur la grille). La forêt garde ses anciens records.
let pelotonOn = false;
let net = null; // le salon en ligne (src/net/online.js), ou null
let netRace = null; // la course en ligne où je suis partant : { id, at (heure du serveur du GO), slot, n }
const myHist = []; // (temps, distance) de ma course en ligne, pour l'écart avec celui de derrière
function isHost() { return !!(net && net.room && net.room.host === net.you); }
const bestKey = (m) => `${mapId === 'foret' ? `downhill.record.v3.${m}` : `downhill.record.v3.${mapId}.${m}`}${pelotonOn || netRace ? '.peloton' : ''}`;
const loadBest = (m) => { try { return JSON.parse(localStorage.getItem(bestKey(m))) || null; } catch { return null; } };
const saveBest = (m, b) => { try { localStorage.setItem(bestKey(m), JSON.stringify(b)); } catch { /* stockage indisponible */ } };
const MODE_KEY = 'downhill.mode';
const savedMode = (() => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } })();
let mode = [params.get('mode'), savedMode].find((m) => MODE_IDS.includes(m)) || 'normal';

// Les photos du sol se chargent pendant qu'on construit la piste.
const groundTextures = loadGroundTextures();
const massif = loadMassif();
await loading('Démarrage du moteur physique…', 0.05);
await initPhysics();
await loading(`Construction de la piste : ${MAPS[mapId].name}…`, 0.15);
const sim = createSim({ seed: Number(params.get('seed')) || 7, mode, map: mapId });
const track = sim.track;
// Pour les captures et les essais : ?depart=600&vitesse=13 pose le vélo lancé à 600 m de la cabane, chrono parti.
if (params.has('depart')) {
  const s0 = Number(params.get('depart'));
  sim.bike.placeOnTrack(s0, Number(params.get('vitesse')) || 10);
  sim.race.state = 'course';
  sim.race.s = s0;
  sim.race.next = track.gates.filter((g) => g.s < s0).length;
}

// ----- Affichage -----
await loading('Plantation de la forêt…', 0.4);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
const low = params.get('qualite') === 'basse';
const maxRatio = params.has('shot') || low ? 1 : Math.min(devicePixelRatio, 1.75);
let pixelRatio = maxRatio;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// AgX : des hautes lumières qui se fondent comme sur une photo (la neige au soleil ne vire pas au jaune ni au cyan).
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.5;
const world = createScene(sim, { low, renderer, groundTextures: await groundTextures, massif: await massif });
await loading('Préparation du vélo…', 0.75);
const bikeModel = createBikeModel();
world.scene.add(bikeModel.group);
const ghost = createBikeModel({ ghost: true });
ghost.group.visible = false;
world.scene.add(ghost.group);
await Promise.race([bikeModel.ready, new Promise((r) => setTimeout(r, 8000))]);
// Le peloton : vingt rivaux pour le départ en ligne (?peloton, touche N), s'il a été enregistré pour cette piste.
await loading('Le peloton prend place…', 0.85);
// Le choix est retenu par piste ; sans choix, la piste décide (L'Avalanche part en ligne, comme la vraie course).
const PELOTON_KEY = `downhill.peloton.${mapId}`;
const pelotonRuns = await loadPeloton(mapId);
const peloton = pelotonRuns ? createPeloton(world.scene, pelotonRuns) : null;
const grid = gridSlots(track);
{
  const saved = (() => { try { return localStorage.getItem(PELOTON_KEY); } catch { return null; } })();
  pelotonOn = !!peloton && !params.has('depart') && !salonCode && (params.has('peloton') ? params.get('peloton') !== '0' : saved !== null ? saved === '1' : !!(track.map.peloton && track.map.peloton.default));
}
let goTime = null; // sim.time au GO du départ en ligne
const camera = new THREE.PerspectiveCamera(CAMERA_SETTINGS.fov, innerWidth / innerHeight, 0.05, world.viewDistance);
const rig = createCameraRig(camera, bikeModel, sim);
if (params.get('cam') === 'chase') rig.setMode('chase');
const post = createPost(renderer, world.scene, camera, { low, farScene: world.farScene });
const particles = createSpeedParticles();
world.scene.add(particles.object);
post.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
// Tous les matériaux compilés maintenant (arbres, fougères, public…) : sinon chacun se compile la première fois qu'il
// entre dans le champ, et l'image se fige un instant (en entrant dans la forêt, par exemple).
await loading('Préparation des matériaux…', 0.95);
await renderer.compileAsync(world.scene, camera);
await renderer.compileAsync(world.farScene, camera);
await loading('C\'est parti', 1);

// ----- Réglages en jeu (touche G) -----
const gui = new GUI({ title: 'Réglages (G)' });
const P = sim.params;
const modeChoice = { mode };
gui.add(modeChoice, 'mode', Object.fromEntries(MODE_IDS.map((m) => [MODES[m].name, m]))).name('Mode').onChange((m) => setMode(m));
gui.add({ carte: mapId }, 'carte', Object.fromEntries(MAP_IDS.map((m) => [MAPS[m].name, m]))).name('Piste (recharge)').onChange(switchMap);
const fSusp = gui.addFolder('Suspension');
fSusp.add(P, 'springMaxForce', 800, 2500, 10).name('Ressort en fin de course (N)');
fSusp.add(P, 'damperBump', 100, 1500, 10).name('Amortisseur compression');
fSusp.add(P, 'damperRebound', 100, 1500, 10).name('Amortisseur détente');
const fTire = gui.addFolder('Pneus et freins');
fTire.add(P, 'gripScale', 0.5, 1.5, 0.01).name('Grip (×)');
fTire.add(P, 'pacejkaB', 5, 20, 0.1).name('Pneu : raideur (B)');
fTire.add(P, 'relaxationLength', 0.05, 0.5, 0.01).name('Longueur de relaxation (m)');
fTire.add(P, 'sideSlipRear', 0.5, 8, 0.1).name('L\'arrière décroche (×)');
fTire.add(P, 'brakeTorqueFront', 100, 1200, 10).name('Frein avant (N·m)');
fTire.add(P, 'brakeTorqueRear', 100, 1200, 10).name('Frein arrière (N·m)');
const fRider = gui.addFolder('Pilote');
fRider.add(P, 'maxLeanDeg', 15, 50, 1).name('Inclinaison max sur le plat (°)');
fRider.add(P, 'leanErrorGain', 0.5, 6, 0.05).name('Équilibre : correction');
fRider.add(P, 'leanRateGain', 0, 3, 0.05).name('Équilibre : amorti');
fRider.add(P, 'maxLeanRateDeg', 30, 300, 5).name('Vitesse d\'inclinaison (°/s)');
fRider.add(P, 'reachFwd', 0, 0.6, 0.01).name('Poids vers l\'avant (m)');
fRider.add(P, 'reachBack', 0, 0.9, 0.01).name('Poids vers l\'arrière (m)');
fRider.add(P, 'airPitchTorque', 0, 400, 5).name('Rotation en l\'air (N·m)');
fRider.add(P, 'hopMaxImpulse', 100, 600, 5).name('Bunny-hop (N·s)');
const fTricks = gui.addFolder('Figures et aides');
fTricks.add(P, 'trickPitchRate', 2, 14, 0.1).name('Vitesse de flip (rad/s)');
fTricks.add(P, 'trickSpinRate', 2, 14, 0.1).name('Vitesse de 360 (rad/s)');
fTricks.add(P, 'tuckInertia', 0, 0.6, 0.01).name('Groupé : inertie en moins');
fTricks.add(P, 'brakeAssist', 0, 1, 0.05).name('Aide au freinage');
fTricks.add(P, 'airAssist', 0, 1, 0.05).name('Aide en l\'air');
fTricks.add(P, 'crashImpactSpeed', 2, 10, 0.1).name('Chute : choc (m/s)');
const fCam = gui.addFolder('Caméra');
fCam.add(CAMERA_SETTINGS, 'fov', 50, 110, 1).name('Champ de vision');
fCam.add(CAMERA_SETTINGS, 'fovSpeed', 0, 30, 1).name('Élargi avec la vitesse');
fCam.add(CAMERA_SETTINGS, 'rollFollow', 0, 1, 0.05).name('La tête suit l\'inclinaison');
fCam.add(CAMERA_SETTINGS, 'lookAhead', 0, 1.5, 0.05).name('Regard vers la sortie');
fCam.add(CAMERA_SETTINGS, 'lookDown', -5, 25, 1).name('Regard vers le bas (°)');
fCam.add(CAMERA_SETTINGS, 'shake', 0, 1.5, 0.05).name('Secousses');
fCam.add(CAMERA_SETTINGS, 'buzz', 0, 2, 0.05).name('Vibration à haute vitesse');
fCam.add(CAMERA_SETTINGS, 'stabilize', 0, 1, 0.05).name('Stabilisation de la tête');
const fFx = gui.addFolder('Effets de vitesse');
fFx.add(SPEED_FX, 'from', 10, 50, 1).name('À partir de (km/h)');
fFx.add(SPEED_FX, 'to', 30, 90, 1).name('Au maximum à (km/h)');
fFx.add(SPEED_FX, 'blur', 0, 2, 0.05).name('Flou sur les bords');
fFx.add(SPEED_FX, 'aberration', 0, 2, 0.05).name('Aberration chromatique');
fFx.add(SPEED_FX, 'tunnel', 0, 2, 0.05).name('Vision en tunnel');
gui.add({ reset() { Object.assign(P, modeParams(mode)); gui.controllersRecursive().forEach((c) => c.updateDisplay()); } }, 'reset').name('Valeurs du mode');
gui.close();
gui.hide();

// ----- État du jeu -----
const input = new Input();
const sound = new Sound();
let auto = params.has('autopilot');
let phase = auto || params.has('depart') ? 'ride' : 'hut'; // hut (dans la cabane, ou sur la grille) → countdown → ride → finished
let countdown = 0, lastBeep = 0;
/** Le joueur au départ : dans la cabane, ou à sa place sur la grille du départ en ligne. */
function placeStart() {
  sim.reset();
  goTime = null;
  if (!pelotonOn && !netRace) return;
  const g = netRace ? gridSlots(track, netRace.n)[netRace.slot] : grid[PLAYER.slot];
  sim.bike.placeOnTrack(g.s, 0, g.u);
  // La grille est après l'arche : le chrono partira au GO, pas en la franchissant.
  Object.assign(sim.race, { s: g.s, u: g.u, reached: g.s, next: track.gates.findIndex((x) => x.kind !== 'depart' && x.s > g.s) });
}
if (pelotonOn) {
  placeStart();
  phase = auto ? 'countdown' : 'hut';
  countdown = 3.999; lastBeep = 4;
}
let best = loadBest(mode);
let ghostOn = !!(best && best.trace);
let message = null, messageUntil = 0;
let lastSplits = 0, finishShownAt = 0, shownCrash = null, recordThisRun = false;
const help = $('help');
if (!params.has('nohelp') && !auto) help.classList.remove('hidden');
$('loading').remove();
if (!params.has('nohud')) $('hud').classList.remove('hidden'); // ?nohud : l'image seule (captures)

// Les repères de la barre de progression : les intermédiaires.
const span = track.sFinish - track.sStart;
for (const g of track.gates) if (g.kind === 'point') { const b = document.createElement('b'); b.style.left = `${((g.s - track.sStart) / span) * 100}%`; $('progBar').appendChild(b); }
const ghostDot = document.createElement('s');
$('progBar').appendChild(ghostDot);
// Les rivaux sur la barre de progression : un trait à la couleur de leur maillot.
const rivalDots = (peloton ? peloton.riders : []).map((R) => {
  const d = document.createElement('u');
  d.style.background = R.run.rider.kit.jersey;
  $('progBar').appendChild(d);
  return d;
});

function showMessage(big, small = '', seconds = 1.5, pill = false) {
  message = { big, small, pill };
  messageUntil = performance.now() + seconds * 1000;
}

/** Change de mode : les réglages, le record et son fantôme. La manche recommence. */
function setMode(m, fromRoom = false) {
  if (!MODE_IDS.includes(m)) return;
  if (net && !fromRoom) {
    if (!isHost()) { showMessage('', 'En ligne, c\'est l\'hôte qui choisit le mode', 1.8, true); modeChoice.mode = mode; return; }
    net.send({ t: 'config', mode: m });
  }
  mode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* stockage indisponible */ }
  sim.setMode(m);
  modeChoice.mode = m;
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  best = loadBest(m);
  ghostOn = !!(best && best.trace);
  restart();
  if (!auto) showMessage(MODES[m].name, startHint(), 9999, true);
  updateModeUI();
}
function updateModeUI() {
  $('modeTag').textContent = MODES[mode].name.toUpperCase();
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
  $('modeBlurb').textContent = MODES[mode].blurb;
  for (const b of document.querySelectorAll('[data-map]')) b.classList.toggle('on', b.dataset.map === mapId);
  $('mapBlurb').textContent = MAPS[mapId].blurb;
  for (const b of document.querySelectorAll('[data-start]')) {
    b.classList.toggle('on', (b.dataset.start === 'peloton') === pelotonOn);
    b.disabled = (b.dataset.start === 'peloton' && !peloton) || !!net;
  }
  // (en ligne, la piste et le mode sont ceux de l'hôte)
  for (const b of document.querySelectorAll('[data-map], [data-mode]')) b.disabled = !!net && !isHost();
  $('startBlurb').textContent = net ? "En ligne : départ commun sur la grille, donné par l'hôte du salon (sans le peloton)."
    : !peloton ? 'Pas encore de peloton sur cette piste.'
    : pelotonOn ? `Départ en ligne avec ${peloton.riders.length} rivaux. Le chrono part au GO pour tout le monde ; tu as le dossard ${PLAYER.num}, au rang ${Math.floor(PLAYER.slot / ((track.map.peloton && track.map.peloton.cols) || 3)) + 1} de la grille. Ils passent au travers de toi.`
      : 'Seul contre le chrono, départ dans la cabane.';
  $('rank').classList.toggle('hidden', !pelotonOn && !netRace);
}
/** Départ en ligne ou contre la montre. La manche recommence. */
function setPeloton(on) {
  if (!peloton || on === pelotonOn || (on && net)) return;
  pelotonOn = on;
  try { localStorage.setItem(PELOTON_KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
  best = loadBest(mode);
  ghostOn = !!(best && best.trace);
  restart();
  if (!auto) showMessage(on ? 'Départ en ligne' : 'Contre la montre', startHint(), 9999, true);
  updateModeUI();
}
for (const b of document.querySelectorAll('[data-start]')) b.addEventListener('click', () => { if (phase === 'hut' || phase === 'finished') setPeloton(b.dataset.start === 'peloton'); });
for (const b of document.querySelectorAll('[data-map]')) b.addEventListener('click', () => {
  if (phase !== 'hut' && phase !== 'finished') return;
  // En ligne : l'hôte change la piste du salon, et tout le monde la charge (voir onRoom).
  if (net) { if (isHost() && b.dataset.map !== mapId) net.send({ t: 'config', map: b.dataset.map }); return; }
  switchMap(b.dataset.map);
});
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { if (phase === 'hut' || phase === 'finished') setMode(b.dataset.mode); });
const nextMode = () => MODE_IDS[(MODE_IDS.indexOf(mode) + 1) % MODE_IDS.length];
const startHint = () => (net ? `En ligne, salon ${net.code} : l'hôte lance la course (H pour le salon) · en attendant, pédale pour rouler seul`
  : pelotonOn
  ? `Départ en ligne : pédale ou appuie sur A, le compte à rebours part pour tout le monde · N : contre la montre`
  : `Pédale ou appuie sur A pour lancer le départ · mode ${MODES[mode].name} (M ou LB pour changer)${peloton ? ' · N : départ en ligne' : ''}`);
updateModeUI();

/** Une nouvelle manche ; online : la course en ligne où l'on part (sinon, on quitte celle en cours). */
function restart(online = null) {
  // (quitter une course en ligne avant l'arrivée, c'est abandonner)
  if (netRace && net && netRace !== online && phase !== 'finished') net.send({ t: 'abandon' });
  if (!!online !== !!netRace) {
    netRace = online;
    best = loadBest(mode);
    ghostOn = !online && !!(best && best.trace);
  } else netRace = online;
  placeStart();
  rig.reset();
  phase = online ? 'countdown' : auto ? (pelotonOn ? 'countdown' : 'ride') : 'hut';
  if (phase === 'countdown') { countdown = online ? (online.at - net.now()) / 1000 : 3.999; lastBeep = online ? 99 : 4; }
  lastSplits = 0; finishShownAt = 0; recordThisRun = false;
  message = null;
  myHist.length = 0;
  $('results').classList.add('hidden');
  $('splitBox').innerHTML = '';
  if (online) help.classList.add('hidden');
  else if (!auto) showMessage('', startHint(), 9999, true);
  updateModeUI();
}
if (!auto && !params.has('depart')) showMessage('', startHint(), 9999, true);

const HOLD = { steer: 0, brakeFront: 1, brakeRear: 1, pedal: 0, weight: 0, hop: false };
const myWhip = { q: new THREE.Quaternion(), pivot: new THREE.Vector3() }; // le vélo couché en l'air (voir render/remote.js)
const STOP = { steer: 0, brakeFront: 0.35, brakeRear: 0.6, pedal: 0, weight: -0.3, hop: false };

// ----- Le fantôme : le meilleur run, rejoué au même chrono -----
const ghostState = {
  position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), steer: 0, lean: 0, crashed: null, speed: 0,
  input: { pedal: 0 }, hips: new THREE.Vector3(0, 1.07, 0.08), crouch: 0,
  wheels: [{ x: 0, spinAngle: 0, contact: true, omega: 0 }, { x: 0, spinAngle: 0, contact: true, omega: 0 }],
};
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function updateGhost(dt) {
  const show = ghostOn && !pelotonOn && !netRace && best && best.trace && best.trace.length > 2 && phase !== 'finished';
  ghost.group.visible = !!show;
  ghostDot.style.display = show ? '' : 'none';
  if (!show) return;
  const tr = best.trace;
  const f = Math.min(tr.length - 1.001, Math.max(0, (sim.race.state === 'course' ? sim.race.time : 0) / 0.1));
  const i = Math.floor(f), t = f - i, a = tr[i], b = tr[i + 1];
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  const prev = ghostState.position.clone();
  ghostState.position.set(L(0), L(1), L(2));
  ghostState.quaternion.copy(qa.set(a[3], a[4], a[5], a[6]).slerp(qb.set(b[3], b[4], b[5], b[6]), t));
  ghostState.steer = L(7); ghostState.wheels[0].x = L(8); ghostState.wheels[1].x = L(9); ghostState.lean = L(10);
  ghostState.hips.set(0, 1.07 - L(11) * 0.2, L(12));
  const v = dt > 0 ? prev.distanceTo(ghostState.position) / dt : 0;
  for (const w of ghostState.wheels) w.spinAngle = (w.spinAngle + (v / 0.365) * dt) % (Math.PI * 2);
  ghost.update(ghostState, dt, false);
  const near = track.nearest(ghostState.position.x, ghostState.position.z, null, 0, 3);
  ghostDot.style.left = `${Math.max(0, Math.min(1, (near.s - track.sStart) / span)) * 100}%`;
}

// ----- Les écrans dans le décor : l'horloge du départ, l'écran géant de l'arrivée -----
function drawStartClock() {
  const c = world.course.startClock;
  if (!c) return;
  const ctx = c.canvas.getContext('2d');
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, 256, 128);
  let text = '', color = '#ffcf33';
  if (phase === 'countdown') { text = countdown > 0.5 ? String(Math.ceil(countdown - 0.5)) : 'GO'; color = countdown > 0.5 ? '#ff4b3a' : '#3ddc6a'; }
  else if (sim.race.state === 'course' || sim.race.state === 'arrivee') { text = fmt(sim.race.time); color = '#3ddc6a'; }
  else text = 'PRÊT';
  ctx.fillStyle = color;
  ctx.font = `900 ${text.length > 4 ? 52 : 92}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  c.tex.needsUpdate = true;
  // Le portillon s'ouvre au départ.
  const target = phase === 'hut' || phase === 'countdown' ? 0 : -Math.PI / 2.2;
  c.gate.rotation.x += (target - c.gate.rotation.x) * 0.2;
}
let screenTimer = 0;
function drawFinishScreen(dt) {
  const s = world.course.finishScreen;
  screenTimer -= dt;
  if (!s || screenTimer > 0) return;
  screenTimer = 0.1;
  const ctx = s.canvas.getContext('2d');
  ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#c4161c'; ctx.fillRect(0, 0, 512, 44);
  ctx.fillStyle = '#fff'; ctx.font = '900 30px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('COUPE DES ALPES · DH', 16, 23);
  const r = sim.race;
  ctx.font = '900 92px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = r.state === 'arrivee' ? (recordThisRun ? '#3ddc6a' : '#ffffff') : '#ffcf33';
  ctx.fillText(r.state === 'pret' ? '-:--.--' : fmt(r.time), 256, 130);
  ctx.font = '700 28px system-ui, sans-serif'; ctx.fillStyle = '#aab4c0';
  ctx.fillText(best ? `RECORD ${fmt(best.time)}` : 'PAS ENCORE DE RECORD', 256, 214);
  s.tex.needsUpdate = true;
}

// ----- Intermédiaires et arrivée -----
function onSplit() {
  const race = sim.race;
  const i = race.splits.length - 1, t = race.splits[i];
  const isFinish = race.state === 'arrivee';
  const ref = best && best.splits ? best.splits[i] : null;
  const row = document.createElement('div');
  row.className = 'split';
  row.innerHTML = `<span class="n">${isFinish ? 'ARRIVÉE' : `INTER ${i + 1}`}</span><span class="t tab">${fmt(t)}</span>${ref != null ? `<span class="d tab ${t - ref < 0 ? 'ahead' : 'behind'}">${fmtDelta(t - ref)}</span>` : ''}`;
  const box = $('splitBox');
  box.appendChild(row);
  while (box.children.length > 7) box.removeChild(box.firstChild);
}

// ----- Le classement du départ en ligne -----
const shortName = (name) => `${name[0]}. ${name.split(' ').slice(1).join(' ')}`;
const fmtGap = (g) => `${g < 0 ? '−' : '+'}${Math.abs(g).toFixed(1)}`;
/** Tout le monde, du premier au dernier : les arrivés à leur temps, puis les autres selon la distance parcourue. */
function standings(t) {
  const race = sim.race;
  const rows = peloton.progress(t).map((p) => ({ run: p.run, num: p.run.num, name: p.run.rider.name, s: p.s, finish: p.finished ? p.run.finish : null }));
  rows.push({ me: true, num: PLAYER.num, name: 'Toi', s: race.s, finish: race.state === 'arrivee' ? race.time : null });
  rows.sort((a, b) => (a.finish != null || b.finish != null ? (a.finish ?? Infinity) - (b.finish ?? Infinity) : b.s - a.s));
  return rows;
}
let rankTimer = 0;
function updateRank(t, dt) {
  if (netRace) return updateOnlineRank(dt);
  if (!pelotonOn) return;
  if ((rankTimer -= dt) > 0 && !film) return;
  rankTimer = 0.15;
  const race = sim.race, rows = standings(t), i = rows.findIndex((r) => r.me);
  const chip = (r) => `<i style="background:${r.run.rider.kit.jersey}">${r.num}</i>`;
  let html = `<div class="pos"><span>PLACE</span><b class="tab">${i + 1}</b><span>/ ${rows.length}</span></div>`;
  if (race.state === 'course' && t > 0) {
    // Les écarts : depuis quand celui de devant est passé ici, dans combien de temps celui de derrière y sera.
    const ahead = rows[i - 1], behind = rows[i + 1];
    if (ahead && ahead.run) html += `<div class="gap">${chip(ahead)}<span>${shortName(ahead.name)}</span><b class="tab behindT">${fmtGap(t - peloton.timeAt(ahead.run, race.s))}</b></div>`;
    if (behind && behind.run) {
      const g = peloton.timeAt(behind.run, race.s) - t;
      if (Number.isFinite(g)) html += `<div class="gap">${chip(behind)}<span>${shortName(behind.name)}</span><b class="tab aheadT">${fmtGap(-g)}</b></div>`;
    }
  }
  $('rank').innerHTML = html;
  peloton.progress(t).forEach((p, k) => { rivalDots[k].style.left = `${Math.max(0, Math.min(1, (p.s - track.sStart) / span)) * 100}%`; });
}

function onFinish() {
  const race = sim.race;
  const record = !best || race.time < best.time;
  recordThisRun = record && !auto;
  if (recordThisRun) {
    best = { time: race.time, splits: race.splits.slice(), trace: race.trace.map((p) => p.map((v) => Math.round(v * 1000) / 1000)), trap: race.trapSpeed, top: race.topSpeed };
    saveBest(mode, best);
  }
  $('resTitle').textContent = recordThisRun ? 'NOUVEAU RECORD' : 'ARRIVÉE';
  $('resTime').textContent = fmt(race.time);
  const prev = recordThisRun ? null : best;
  $('resDelta').innerHTML = prev ? `<span class="${race.time - prev.time < 0 ? 'ahead' : 'behind'}" style="padding:2px 8px">${fmtDelta(race.time - prev.time)}</span> sur le record` : (recordThisRun ? 'Le fantôme rejouera cette manche.' : '');
  const rows = [];
  race.splits.forEach((t, i) => {
    const ref = prev && prev.splits ? prev.splits[i] : null;
    rows.push([i === race.splits.length - 1 ? 'Arrivée' : `Intermédiaire ${i + 1}`, `${fmt(t)}${ref != null ? `  (${fmtDelta(t - ref)})` : ''}`]);
  });
  rows.push(['Radar', race.trapSpeed != null ? `${(race.trapSpeed * 3.6).toFixed(1)} km/h` : '–']);
  rows.push(['Vitesse max', `${(race.topSpeed * 3.6).toFixed(1)} km/h`]);
  rows.push(['Chutes et sorties', String(race.crashes)]);
  const tricks = sim.tricks.landed;
  rows.push(['Figures', tricks.length ? tricks.join(', ') : '–']);
  rows.push(['Piste', MAPS[mapId].name]);
  rows.push(['Mode', MODES[mode].name]);
  let classement = '';
  if (netRace) {
    net.send({ t: 'finish', race: netRace.id, time: race.time });
    classement = `<div id="olResults">${onlineClassement()}</div>`;
    onlineTitle();
  } else if (pelotonOn) {
    // Le classement final : on connaît déjà le temps de chaque rival.
    const all = peloton.riders.map((R) => ({ num: R.run.num, name: R.run.rider.name, t: R.run.finish, kit: R.run.rider.kit.jersey }));
    all.push({ num: PLAYER.num, name: 'Toi', t: race.time, kit: '#b3352b', me: true });
    all.sort((a, b) => a.t - b.t);
    const pos = all.findIndex((r) => r.me);
    $('resTitle').textContent = `${recordThisRun ? 'NOUVEAU RECORD · ' : ''}PLACE ${pos + 1} SUR ${all.length}`;
    const keep = new Set([0, 1, 2, pos - 1, pos, pos + 1].filter((k) => k >= 0 && k < all.length));
    let lastK = -1;
    classement = '<div class="classement">';
    for (const k of [...keep].sort((a, b) => a - b)) {
      if (k > lastK + 1) classement += '<div class="dots">⋯</div>';
      const r = all[k];
      classement += `<div class="crow${r.me ? ' me' : ''}"><span class="p tab">${k + 1}</span><i style="background:${r.kit}">${r.num}</i><span class="nm">${r.me ? 'Toi' : r.name}</span><b class="tab">${fmt(r.t)}</b><span class="d tab">${k ? `+${(r.t - all[0].t).toFixed(2)}` : ''}</span></div>`;
      lastK = k;
    }
    classement += '</div>';
  }
  $('resRows').innerHTML = classement + rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('');
  finishShownAt = performance.now() + 1800;
  updateOnlineUI();
}

// ----- Le jeu en ligne : le salon, la course avec départ commun -----
const remote = createRemoteRiders(world.scene);
const remoteDots = new Map();
const SEND_RATE = 15; // poses envoyées par seconde
let sendTimer = 0, seenRace = null;
const NAME_KEY = 'downhill.nom', COLOR_KEY = 'downhill.couleur';
const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
let myName = stored(NAME_KEY) || '';
let myColor = Number(stored(COLOR_KEY));
if (!Number.isInteger(myColor) || myColor < 0 || myColor >= KITS.length || stored(COLOR_KEY) === null) { myColor = Math.floor(Math.random() * KITS.length); store(COLOR_KEY, myColor); }
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const playerNo = (id) => (net && net.room ? net.room.players.findIndex((p) => p.id === id) + 1 : 0);
const chipOf = (p, cls = '') => `<i class="${cls}" style="background:${(KITS[p.color] || KITS[0]).jersey}">${playerNo(p.id)}</i>`;
/** La course du salon est-elle en cours (un partant encore là n'a ni temps ni abandon) ? */
function roomRacing(room) {
  const r = room && room.race;
  if (!r) return false;
  const here = new Set(room.players.map((p) => p.id));
  return r.grid.some((id) => here.has(id) && !(id in room.results));
}

function goOnline(code) {
  if (net) return;
  if (pelotonOn) { pelotonOn = false; restart(); }
  const q = new URLSearchParams(location.search);
  q.set('salon', code);
  history.replaceState(null, '', `${location.pathname}?${q}`);
  net = joinSalon({ url: serverUrl(params), code, id: playerId(), name: myName || 'Pilote', color: myColor, map: mapId, mode });
  net.on('room', onRoom).on('pose', (id, at, p, rt) => remote.push(id, at, p, rt)).on('status', updateOnlineUI);
  updateOnlineUI();
  updateModeUI();
  if (phase === 'hut') showMessage('', startHint(), 9999, true);
}
function leaveOnline() {
  if (!net) return;
  if (netRace && phase !== 'finished') net.send({ t: 'abandon' });
  net.close();
  net = null;
  remote.sync([], null);
  for (const d of remoteDots.values()) d.remove();
  remoteDots.clear();
  const q = new URLSearchParams(location.search);
  q.delete('salon');
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  restart();
  updateOnlineUI();
}

/** Le salon a changé : les joueurs, la piste, le mode, le départ, les temps. */
function onRoom(room) {
  remote.sync(room.players, net.you);
  // Les traits des autres sur la barre de progression.
  for (const [id, d] of remoteDots) if (!room.players.some((p) => p.id === id)) { d.remove(); remoteDots.delete(id); }
  for (const p of room.players) {
    if (p.id === net.you) continue;
    if (!remoteDots.has(p.id)) { const d = document.createElement('u'); $('progBar').appendChild(d); remoteDots.set(p.id, d); }
    remoteDots.get(p.id).style.background = (KITS[p.color] || KITS[0]).jersey;
  }
  // La piste de l'hôte (la page se recharge, et revient dans le salon).
  if (room.map !== mapId && MAP_IDS.includes(room.map) && !(netRace && phase !== 'finished')) { switchMap(room.map); return; }
  if (room.mode !== mode && MODE_IDS.includes(room.mode) && !netRace) setMode(room.mode, true);
  // Un nouveau départ.
  const r = room.race;
  if (r && r.id !== seenRace) {
    const first = seenRace === null;
    seenRace = r.id;
    const slot = r.grid.indexOf(net.you);
    if (slot >= 0 && r.map === mapId && r.at > net.now() - 500) {
      remote.resetRace();
      restart({ id: r.id, at: r.at, slot, n: r.grid.length });
    } else if (slot >= 0 && !(net.you in room.results) && first) net.send({ t: 'abandon' }); // (revenu après le départ)
  }
  if (netRace && phase === 'finished' && $('olResults')) { $('olResults').innerHTML = onlineClassement(); onlineTitle(); }
  updateOnlineUI();
  updateModeUI();
}

/** Les partants de la course en ligne, du premier au dernier : les arrivés à leur temps, puis selon la distance. */
function onlineStandings() {
  const room = net.room, race = sim.race;
  const rows = [];
  for (const id of room.race.grid) {
    const p = room.players.find((x) => x.id === id);
    const me = id === net.you;
    const res = room.results[id];
    const finish = me && race.state === 'arrivee' ? race.time : typeof res === 'number' ? res : null;
    rows.push({ id, me, p: p || { id, name: 'Parti', color: 7 }, gone: !p, out: res === null, finish, s: me ? race.s : remote.sOf(id) ?? 0 });
  }
  rows.sort((a, b) => (a.out !== b.out ? a.out - b.out : a.finish != null || b.finish != null ? (a.finish ?? Infinity) - (b.finish ?? Infinity) : b.s - a.s));
  return rows;
}
function onlineClassement() {
  if (!net || !net.room || !net.room.race) return '';
  const rows = onlineStandings(), lead = rows[0] && rows[0].finish;
  let html = '<div class="classement">';
  rows.forEach((r, k) => {
    const right = r.finish != null ? fmt(r.finish) : r.out ? 'abandon' : r.gone ? 'parti' : 'en course…';
    const gap = r.finish != null && k && lead != null ? `+${(r.finish - lead).toFixed(2)}` : '';
    html += `<div class="crow${r.me ? ' me' : ''}"><span class="p tab">${r.finish != null ? k + 1 : ''}</span>${chipOf(r.p)}<span class="nm">${r.me ? 'Toi' : esc(r.p.name)}</span><b class="tab">${right}</b><span class="d tab">${gap}</span></div>`;
  });
  return html + '</div>';
}
function updateOnlineRank(dt) {
  if ((rankTimer -= dt) > 0) return;
  rankTimer = 0.15;
  if (!net || !net.room || !net.room.race) return;
  const race = sim.race, rows = onlineStandings(), i = rows.findIndex((r) => r.me);
  let html = `<div class="pos"><span>PLACE</span><b class="tab">${i + 1}</b><span>/ ${rows.length}</span></div>`;
  if (race.state === 'course' && race.time > 0) {
    // Celui de devant : depuis quand il est passé ici. Celui de derrière : combien de temps après moi il est passé là où il est.
    const ahead = rows[i - 1], behind = rows[i + 1];
    if (ahead && !ahead.out) {
      const at = remote.timeAt(ahead.id, race.s);
      if (Number.isFinite(at)) html += `<div class="gap">${chipOf(ahead.p, 'ol')}<span>${esc(ahead.p.name)}</span><b class="tab behindT">${fmtGap(race.time - at)}</b></div>`;
    }
    if (behind && !behind.out && behind.finish == null && behind.s > track.sStart) {
      const mine = myTimeAt(behind.s), theirs = remote.timeAt(behind.id, behind.s);
      if (Number.isFinite(mine) && Number.isFinite(theirs)) html += `<div class="gap">${chipOf(behind.p, 'ol')}<span>${esc(behind.p.name)}</span><b class="tab aheadT">${fmtGap(-(theirs - mine))}</b></div>`;
    }
  }
  $('rank').innerHTML = html;
}
/** Mon temps de course quand j'étais à la distance s (Infinity si je n'y suis pas encore passé). */
function myTimeAt(s) {
  const h = myHist, n = h.length / 2;
  if (!n || h[(n - 1) * 2 + 1] < s) return Infinity;
  let lo = 0, hi = n - 1;
  if (h[1] >= s) return h[0];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h[m * 2 + 1] < s) lo = m; else hi = m; }
  const a = h[lo * 2 + 1], b = h[hi * 2 + 1];
  return h[lo * 2] + (b > a ? (s - a) / (b - a) : 0) * (h[hi * 2] - h[lo * 2]);
}

/** Le titre de l'écran d'arrivée : ma place (provisoire tant que d'autres roulent). */
function onlineTitle() {
  const rows = onlineStandings(), i = rows.findIndex((r) => r.me);
  $('resTitle').textContent = `${recordThisRun ? 'NOUVEAU RECORD · ' : ''}PLACE ${i + 1} SUR ${rows.length}`;
}

/** Le salon sur l'écran d'accueil, et le bouton de relance sur l'écran d'arrivée. */
function updateOnlineUI() {
  $('olOff').classList.toggle('hidden', !!net);
  $('olOn').classList.toggle('hidden', !net);
  $('resOnline').classList.toggle('hidden', !net);
  $('resGo').textContent = net ? 'Entrée ou Start : rouler seul en attendant · H : le salon' : 'Entrée ou Start : nouvelle manche · F : affronter ton fantôme';
  if (!net) return;
  const room = net.room, host = isHost(), racingNow = roomRacing(room);
  $('olCodeShow').textContent = net.code;
  $('olStatus').textContent = { connexion: 'connexion…', ok: `connecté${net.rtt != null ? ` · ${Math.round(net.rtt)} ms` : ''}`, 'coupé': 'connexion perdue, on réessaie…', plein: 'salon plein (8 joueurs au plus)' }[net.status] || '';
  if (!room) { $('olPlayers').innerHTML = ''; return; }
  $('olPlayers').innerHTML = room.players.map((p) => {
    const res = room.race && room.race.grid.includes(p.id) ? room.results[p.id] : undefined;
    const st = !room.race || !room.race.grid.includes(p.id) ? '' : res === null ? 'abandon' : typeof res === 'number' ? fmt(res) : racingNow ? 'en course' : '';
    return `<div class="pl">${chipOf(p)}<span>${esc(p.name)}${p.id === net.you ? ' (toi)' : ''}</span><em>${p.id === room.host ? 'HÔTE' : ''}${st ? ` · ${st}` : ''}</em></div>`;
  }).join('');
  const ready = net.status === 'ok' && !racingNow;
  for (const id of ['olStart', 'olAgain']) {
    $(id).classList.toggle('hidden', !host);
    $(id).disabled = !ready;
  }
  $('olStart').textContent = racingNow ? 'Course en cours…' : room.race ? 'Nouvelle course' : 'Lancer la course';
  const hostName = (room.players.find((p) => p.id === room.host) || {}).name || '';
  const wait = racingNow ? 'Course en cours : tu partiras à la prochaine.' : `${esc(hostName)} choisit la piste et lance la course.`;
  $('olInfo').innerHTML = host ? (room.players.length < 2 ? 'Envoie le lien à tes potes. Tu peux aussi lancer seul.' : 'Tu choisis la piste et le mode, puis tu lances.') : wait;
  $('olAgainInfo').innerHTML = host ? (racingNow ? 'Attends que tout le monde soit arrivé.' : '') : wait;
}

// Le formulaire du salon.
$('olName').value = myName;
$('olName').addEventListener('change', () => {
  myName = $('olName').value.trim().slice(0, 20);
  store(NAME_KEY, myName);
  if (net) net.setProfile(myName || 'Pilote', myColor);
});
for (const [i, k] of KITS.entries()) {
  const b = document.createElement('b');
  b.style.background = k.jersey;
  b.title = k.label;
  b.addEventListener('click', () => {
    myColor = i;
    store(COLOR_KEY, i);
    for (const x of $('olColors').children) x.classList.toggle('on', x === b);
    if (net) net.setProfile(myName || 'Pilote', myColor);
  });
  b.classList.toggle('on', i === myColor);
  $('olColors').appendChild(b);
}
$('olCreate').addEventListener('click', () => goOnline(newCode()));
$('olJoin').addEventListener('click', () => {
  const c = $('olCode').value.trim().toUpperCase();
  if (validCode(c)) goOnline(c); else $('olCode').focus();
});
$('olCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('olJoin').click(); });
$('olLeave').addEventListener('click', leaveOnline);
$('olCopy').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?salon=${net.code}&carte=${mapId}`; // (la piste : pas de rechargement en arrivant)
  try { await navigator.clipboard.writeText(link); $('olCopy').textContent = 'Lien copié !'; } catch { prompt('Le lien du salon :', link); }
  setTimeout(() => { $('olCopy').textContent = 'Copier le lien'; }, 1600);
});
for (const id of ['olStart', 'olAgain']) $(id).addEventListener('click', () => { if (isHost()) net.send({ t: 'start' }); });
updateOnlineUI();
if (salonCode) goOnline(salonCode);

// ----- Résolution adaptative : si les images ralentissent, on baisse un peu la résolution -----
let frameAvg = 1 / 60, adaptTimer = 0;
function adaptResolution(dt) {
  if (params.has('shot') || dt <= 0) return;
  frameAvg += (dt - frameAvg) * 0.1;
  adaptTimer += dt;
  // (chaque seconde ; franchement si l'image rame, doucement pour remonter)
  if (adaptTimer < 1) return;
  adaptTimer = 0;
  let next = pixelRatio;
  if (frameAvg > 1 / 32) next = Math.max(0.6, pixelRatio - 0.25);
  else if (frameAvg > 1 / 45) next = Math.max(0.6, pixelRatio - 0.15);
  else if (frameAvg < 1 / 75) next = Math.min(maxRatio, pixelRatio + 0.1);
  if (Math.abs(next - pixelRatio) > 0.01) {
    pixelRatio = next;
    renderer.setPixelRatio(pixelRatio);
    post.composer.setPixelRatio(pixelRatio);
    post.setSize(innerWidth, innerHeight);
  }
}

// ----- La boucle -----
let acc = 0, last = performance.now(), clock = 0;
// Mode film (?film, pour tools/film.mjs) : le jeu n'avance que sur demande, d'un pas fixe à chaque image.
const film = params.has('film');
let filmDt = 0, tv = null;
// La mise en scène des captures : temps du peloton imposé, joueur immobile ou caché.
const stage = { pelT: null, freeze: false, hidePlayer: false };
function frame(now) {
  // En mode capture (rendu logiciel très lent), on laisse le jeu avancer plus vite que les images.
  const dt = film ? filmDt : Math.max(0, Math.min(params.has('shot') ? 0.5 : 0.1, (now - last) / 1000));
  last = now;
  adaptResolution(dt);
  clock += dt;
  const { control, actions } = input.read(dt);

  if (actions.help) help.classList.toggle('hidden');
  if (actions.settings) gui._hidden ? (gui.show(), gui.open()) : gui.hide();
  if (actions.camera) rig.toggle();
  if (actions.ghost) { ghostOn = !ghostOn; showMessage('', ghostOn ? (best && best.trace ? 'Fantôme du record affiché' : 'Pas encore de record à rejouer') : 'Fantôme masqué', 1.5, true); if (phase === 'finished') restart(); }
  if (actions.autopilot) { auto = !auto; if (phase === 'hut') phase = 'ride'; showMessage('', auto ? 'Pilote automatique' : 'À toi', 1.5, true); }
  if (actions.restart) restart();
  if (actions.peloton) {
    if (phase === 'hut' || phase === 'finished') setPeloton(!pelotonOn);
    else showMessage('', 'Le départ se choisit avant la manche (Entrée pour recommencer)', 1.8, true);
  }
  if (actions.mode) {
    if (phase === 'hut' || phase === 'finished') setMode(nextMode());
    else showMessage('', 'Le mode se change avant le départ (Entrée pour recommencer)', 1.8, true);
  }
  if (actions.respawn && phase === 'ride') { sim.respawn(); rig.reset(); }

  // Le départ : on lance le compte à rebours depuis la cabane.
  if (phase === 'hut' && (actions.start || control.pedal || control.hop)) {
    phase = 'countdown'; countdown = 3.999; lastBeep = 4; help.classList.add('hidden'); message = null;
  }
  if (phase === 'countdown') {
    countdown = netRace ? (netRace.at - net.now()) / 1000 : countdown - dt;
    const n = Math.ceil(countdown);
    if (n < lastBeep && n >= 0) {
      lastBeep = n;
      if (n <= 3) { sound.beep(n === 0); if (n > 0) showMessage(String(n), '', 0.9); }
      else showMessage('', `Départ dans ${n} s`, 1.1, true);
    }
    if (countdown <= 0) {
      phase = 'ride';
      showMessage('GO', '', 0.8);
      if (pelotonOn || netRace) { sim.race.startMass(); goTime = sim.time; }
    }
  }

  // La physique, à pas fixe.
  const race = sim.race;
  acc += dt;
  let n = 0;
  const maxSteps = params.has('shot') ? 60 : 12;
  while (acc >= STEP && n < maxSteps) {
    let inp;
    if (stage.freeze) inp = HOLD;
    else if (phase === 'ride') inp = auto ? autopilot(sim, { trick: params.get('figure') }) : control;
    else if (phase === 'finished') inp = STOP;
    else inp = HOLD;
    sim.step(inp);
    acc -= STEP;
    n++;
  }
  if (n === maxSteps) acc = 0;

  // Chute, sortie de piste : on repart du dernier point.
  const crash = sim.bike.crashed;
  if (crash && crash !== shownCrash) { shownCrash = crash; showMessage(`${crash.reason} !`, 'Retour au dernier point…', 1.6); sound.thump(1.2); }
  if (crash && crash.t > 1.6) { sim.respawn(); rig.reset(); }
  if (race.out && !crash) { showMessage('Hors piste', 'Il faut rester entre les rubalises', 1.8); sim.respawn(); rig.reset(); }
  if (race.missed) showMessage('Porte manquée', 'R ou Y pour repartir du dernier point', 0.3);

  // Les figures réussies.
  for (const e of sim.tricks.events.splice(0)) {
    if (e.failed) continue; // la chute a déjà son message
    showMessage(`${e.name} !`, '', 1.6);
    sound.trick();
  }

  if (race.splits.length > lastSplits) { lastSplits = race.splits.length; onSplit(); }
  if (race.state === 'arrivee' && phase !== 'finished') { phase = 'finished'; onFinish(); }
  if (phase === 'finished' && finishShownAt && now > finishShownAt) { $('results').classList.remove('hidden'); finishShownAt = 0; }

  // Affichage.
  const st = sim.renderState(acc / STEP);
  bikeModel.update(st, dt, rig.mode === 'fp', whipStyle(st, myWhip));
  updateGhost(dt);
  rig.update(st, dt, input.look);
  // Caméra de bord de piste (captures) : posée, elle suit un rival ou le joueur. Posée avant les rivaux (qui en ont
  // besoin pour leur niveau de détail), tournée vers sa cible après.
  if (tv) camera.position.set(...tv.pos);
  // Les rivaux, au même instant que le vélo affiché (entre deux pas de physique).
  const pelT = stage.pelT != null ? stage.pelT : goTime === null ? 0 : Math.max(0, sim.time - goTime - (1 - acc / STEP) * STEP);
  bikeModel.group.visible = !stage.hidePlayer;
  if (peloton) {
    if (pelotonOn) peloton.update(pelT, dt, camera);
    else peloton.setVisible(false);
  }
  if (tv) {
    const target = tv.follow === 'joueur' ? st.position : peloton.riders.find((R) => R.run.num === tv.follow).state.position;
    tv.look = tv.look ? tv.look.lerp(target, 1 - Math.exp(-dt * 8)) : target.clone();
    camera.lookAt(tv.look.x, tv.look.y + 1, tv.look.z);
    camera.fov = tv.fov || 40;
    camera.updateProjectionMatrix();
  }
  if (net) {
    sendTimer -= dt;
    // (pas depuis la cabane : tout le monde y est au même endroit ; on se voit sur la grille et en course)
    if (sendTimer <= 0 && net.status === 'ok' && phase !== 'hut') {
      sendTimer += 1 / SEND_RATE;
      if (sendTimer < 0) sendTimer = 0;
      net.send({ t: 'pose', at: Math.round(net.now()), rt: netRace && race.state === 'course' ? Math.round(race.time * 1000) / 1000 : null, p: [...poseOf(sim), sim.bike.whip].map((v) => Math.round(v * 1e4) / 1e4) });
    }
    remote.update(net.now() - DELAY, dt, camera);
    if (netRace && race.state === 'course' && (!myHist.length || race.time - myHist[myHist.length - 2] > 0.1)) myHist.push(race.time, race.s);
    for (const [id, d] of remoteDots) {
      const sR = remote.sOf(id);
      d.style.display = sR == null ? 'none' : '';
      if (sR != null) d.style.left = `${Math.max(0, Math.min(1, (sR - track.sStart) / span)) * 100}%`;
    }
  }
  updateRank(pelT, dt);
  world.update(st.position, camera, clock);
  drawStartClock();
  drawFinishScreen(dt);
  const nearFinish = Math.max(0, 1 - Math.abs(race.s - track.sFinish) / 70);
  const creek = track.map.creek;
  const nearWater = creek ? 1 - THREE.MathUtils.smoothstep(distToPolyline(creek, st.position.x, st.position.z), 6, 45) : 0;
  sound.update(st, nearFinish, dt, nearWater);
  particles.update(camera, st.velocity, dt);
  if (!stage.noRender) post.render(st.speed, dt);

  $('chrono').textContent = fmt(race.state === 'pret' ? 0 : race.time);
  $('best').textContent = best ? `Record ${MODES[mode].name} ${fmt(best.time)}` : '';
  $('speedV').textContent = Math.round(st.speed * 3.6);
  $('speedU').textContent = auto ? 'KM/H · AUTO' : 'KM/H';
  $('progFill').style.width = `${Math.max(0, Math.min(1, (race.s - track.sStart) / span)) * 100}%`;
  $('progRight').textContent = race.trapSpeed != null ? `Radar ${(race.trapSpeed * 3.6).toFixed(1)} km/h` : `${Math.max(0, track.sFinish - race.s).toFixed(0)} m`;
  $('progLeft').textContent = race.crashes ? `Chutes : ${race.crashes}` : 'Départ';
  const msgEl = $('message');
  if (message && now < messageUntil) {
    msgEl.innerHTML = `${message.big ? `<div class="big">${message.big}</div>` : ''}${message.small ? `<div class="${message.pill ? 'pill' : 'small'}">${message.small}</div>` : ''}`;
  } else msgEl.textContent = '';
  const ctl = st.input;
  const setBar = (id, v, center) => {
    const el = $(id);
    if (center) { el.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`; el.style.width = `${Math.abs(v) * 50}%`; } else el.style.width = `${v * 100}%`;
  };
  setBar('b-steer', ctl.steer || 0, true);
  setBar('b-front', ctl.brakeFront || 0);
  setBar('b-rear', ctl.brakeRear || 0);
  setBar('b-weight', ctl.weight || 0, true);
  setBar('b-hop', Math.max(st.hopCharge || 0, st.tuck || 0));
  const [wf, wr] = st.wheels;
  $('surface').textContent = `Sol : ${wf.surface ? wf.surface.name : '–'}${wf.locked ? ' · avant bloquée' : ''}${wr.locked ? ' · arrière bloquée' : ''}${!wf.locked && wf.sliding ? ' · l\'avant glisse' : ''}${!wr.locked && wr.sliding ? ' · l\'arrière glisse' : ''}`;
  $('pad').textContent = input.padName ? `Manette détectée : ${input.padName}` : 'Branche une manette et appuie sur un bouton pour qu\'elle soit détectée.';

  if (!film) requestAnimationFrame(frame);
}
if (!film) requestAnimationFrame(frame);

// Pour les captures automatiques (tools/shots.mjs).
window.__game = {
  sim, rig, world, camera,
  setAutopilot(v) { auto = v; if (phase === 'hut') phase = 'ride'; },
  setMode,
  peloton,
  /** Mode film : avance le jeu de dt secondes et dessine une image. */
  advance(dt) { filmDt = dt; frame(performance.now()); },
  /** Mode film : avance de `seconds` sans rien dessiner (pour arriver vite au bon moment). */
  fastForward(seconds, dt = 0.1) {
    stage.noRender = true;
    for (let t = 0; t < seconds; t += dt) { filmDt = dt; frame(performance.now()); }
    stage.noRender = false;
  },
  /** Caméra de bord de piste : { pos: [x, y, z], follow: dossard ou 'joueur', fov }, ou null. */
  setTV(v) { tv = v; },
  stage,
  /** Affiche le peloton même avec ?depart (captures). */
  showPeloton() { if (peloton) { pelotonOn = true; updateModeUI(); } },
  start() { if (phase === 'hut') { phase = 'countdown'; countdown = 3.999; lastBeep = 4; help.classList.add('hidden'); message = null; } },
  /** Mesure : ce que dessine une image (toutes passes : ombres, lointain, scène) et le temps de mise à jour du décor. */
  perf() {
    renderer.info.autoReset = false;
    renderer.info.reset();
    filmDt = 1 / 60; frame(performance.now());
    const { calls, triangles } = renderer.info.render;
    renderer.info.autoReset = true;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) world.update(sim.bike.state().position, camera, i / 60);
    // Par objet (sans tenir compte du champ de vision) : les triangles de ce qui est affiché.
    const parts = {};
    for (const sc of [world.scene, world.farScene]) sc.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      let p = o, name = '';
      while (p && !name) { name = p.name; p = p.parent; }
      const key = (name || '?') + (o.castShadow ? ' (ombre)' : '');
      parts[key] = (parts[key] || 0) + tris;
    });
    const top = Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}`);
    return { calls, triangles, decorMs: (performance.now() - t0) / 20, arbres: world.forest.stats, top };
  },
  net: () => net, remote,
  state: () => ({ phase, online: net ? { status: net.status, room: net.room, you: net.you, netRace } : null, map: mapId, mode, tricks: sim.tricks.landed.slice(), time: sim.race.time, raceState: sim.race.state, s: sim.race.s, speed: sim.bike.state().speed, crashes: sim.race.crashes, crashed: !!sim.bike.crashed }),
};
