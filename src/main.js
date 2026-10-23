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
import { createBikeModel } from './render/bikeModel.js';
import { createCameraRig, CAMERA_SETTINGS } from './render/cameraRig.js';
import { createPost, SPEED_FX } from './render/post.js';
import { createSpeedParticles } from './render/speedFx.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const wait = () => new Promise((r) => setTimeout(r, 0));
const loading = async (text, f) => { $('loadText').textContent = text; $('loadBar').style.width = `${f * 100}%`; await wait(); await wait(); };

const fmt = (t) => {
  if (!Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
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
// Un record par piste et par mode (les temps ne se comparent pas d'un mode à l'autre). La forêt garde ses anciens records.
const bestKey = (m) => (mapId === 'foret' ? `downhill.record.v3.${m}` : `downhill.record.v3.${mapId}.${m}`);
const loadBest = (m) => { try { return JSON.parse(localStorage.getItem(bestKey(m))) || null; } catch { return null; } };
const saveBest = (m, b) => { try { localStorage.setItem(bestKey(m), JSON.stringify(b)); } catch { /* stockage indisponible */ } };
const MODE_KEY = 'downhill.mode';
const savedMode = (() => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } })();
let mode = [params.get('mode'), savedMode].find((m) => MODE_IDS.includes(m)) || 'normal';

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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
const world = createScene(sim, { low, renderer });
await loading('Préparation du vélo…', 0.75);
const bikeModel = createBikeModel();
world.scene.add(bikeModel.group);
const ghost = createBikeModel({ ghost: true });
ghost.group.visible = false;
world.scene.add(ghost.group);
await Promise.race([bikeModel.ready, new Promise((r) => setTimeout(r, 8000))]);
const camera = new THREE.PerspectiveCamera(CAMERA_SETTINGS.fov, innerWidth / innerHeight, 0.05, 4000);
const rig = createCameraRig(camera, bikeModel, sim);
if (params.get('cam') === 'chase') rig.setMode('chase');
const post = createPost(renderer, world.scene, camera, { low });
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
let phase = auto || params.has('depart') ? 'ride' : 'hut'; // hut (dans la cabane) → countdown → ride → finished
let countdown = 0, lastBeep = 0;
let best = loadBest(mode);
let ghostOn = !!(best && best.trace);
let message = null, messageUntil = 0;
let lastSplits = 0, finishShownAt = 0, shownCrash = null, recordThisRun = false;
const help = $('help');
if (!params.has('nohelp') && !auto) help.classList.remove('hidden');
$('loading').remove();
$('hud').classList.remove('hidden');

// Les repères de la barre de progression : les intermédiaires.
const span = track.sFinish - track.sStart;
for (const g of track.gates) if (g.kind === 'point') { const b = document.createElement('b'); b.style.left = `${((g.s - track.sStart) / span) * 100}%`; $('progBar').appendChild(b); }
const ghostDot = document.createElement('s');
$('progBar').appendChild(ghostDot);

function showMessage(big, small = '', seconds = 1.5, pill = false) {
  message = { big, small, pill };
  messageUntil = performance.now() + seconds * 1000;
}

/** Change de mode : les réglages, le record et son fantôme. La manche recommence. */
function setMode(m) {
  if (!MODE_IDS.includes(m)) return;
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
}
for (const b of document.querySelectorAll('[data-map]')) b.addEventListener('click', () => { if (phase === 'hut' || phase === 'finished') switchMap(b.dataset.map); });
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { if (phase === 'hut' || phase === 'finished') setMode(b.dataset.mode); });
const nextMode = () => MODE_IDS[(MODE_IDS.indexOf(mode) + 1) % MODE_IDS.length];
const startHint = () => `Pédale ou appuie sur A pour lancer le départ · mode ${MODES[mode].name} (M ou LB pour changer)`;
updateModeUI();

function restart() {
  sim.reset();
  rig.reset();
  phase = auto ? 'ride' : 'hut';
  lastSplits = 0; finishShownAt = 0; recordThisRun = false;
  message = null;
  $('results').classList.add('hidden');
  $('splitBox').innerHTML = '';
  if (!auto) showMessage('', startHint(), 9999, true);
}
if (!auto && !params.has('depart')) showMessage('', startHint(), 9999, true);

const HOLD = { steer: 0, brakeFront: 1, brakeRear: 1, pedal: 0, weight: 0, hop: false };
const STOP = { steer: 0, brakeFront: 0.35, brakeRear: 0.6, pedal: 0, weight: -0.3, hop: false };

// ----- Le fantôme : le meilleur run, rejoué au même chrono -----
const ghostState = {
  position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), steer: 0, lean: 0, crashed: null, speed: 0,
  input: { pedal: 0 }, hips: new THREE.Vector3(0, 1.07, 0.08), crouch: 0,
  wheels: [{ x: 0, spinAngle: 0, contact: true, omega: 0 }, { x: 0, spinAngle: 0, contact: true, omega: 0 }],
};
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function updateGhost(dt) {
  const show = ghostOn && best && best.trace && best.trace.length > 2 && phase !== 'finished';
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
  rows.push(['Radar avant le saut final', race.trapSpeed != null ? `${(race.trapSpeed * 3.6).toFixed(1)} km/h` : '–']);
  rows.push(['Vitesse max', `${(race.topSpeed * 3.6).toFixed(1)} km/h`]);
  rows.push(['Chutes et sorties', String(race.crashes)]);
  const tricks = sim.tricks.landed;
  rows.push(['Figures', tricks.length ? tricks.join(', ') : '–']);
  rows.push(['Piste', MAPS[mapId].name]);
  rows.push(['Mode', MODES[mode].name]);
  $('resRows').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('');
  finishShownAt = performance.now() + 1800;
}

// ----- Résolution adaptative : si les images ralentissent, on baisse un peu la résolution -----
let frameAvg = 1 / 60, adaptTimer = 0;
function adaptResolution(dt) {
  if (params.has('shot') || dt <= 0) return;
  frameAvg += (dt - frameAvg) * 0.05;
  adaptTimer += dt;
  if (adaptTimer < 2) return;
  adaptTimer = 0;
  let next = pixelRatio;
  if (frameAvg > 1 / 45) next = Math.max(0.6, pixelRatio - 0.15);
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
function frame(now) {
  // En mode capture (rendu logiciel très lent), on laisse le jeu avancer plus vite que les images.
  const dt = Math.max(0, Math.min(params.has('shot') ? 0.5 : 0.1, (now - last) / 1000));
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
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n < lastBeep && n >= 0) { lastBeep = n; sound.beep(n === 0); if (n > 0) showMessage(String(n), '', 0.9); }
    if (countdown <= 0) { phase = 'ride'; showMessage('GO', '', 0.8); }
  }

  // La physique, à pas fixe.
  const race = sim.race;
  acc += dt;
  let n = 0;
  const maxSteps = params.has('shot') ? 60 : 12;
  while (acc >= STEP && n < maxSteps) {
    let inp;
    if (phase === 'ride') inp = auto ? autopilot(sim, { trick: params.get('figure') }) : control;
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
  bikeModel.update(st, dt, rig.mode === 'fp');
  updateGhost(dt);
  rig.update(st, dt, input.look);
  world.update(st.position, camera, clock);
  drawStartClock();
  drawFinishScreen(dt);
  const nearFinish = Math.max(0, 1 - Math.abs(race.s - track.sFinish) / 70);
  const creek = track.map.creek;
  const nearWater = creek ? 1 - THREE.MathUtils.smoothstep(distToPolyline(creek, st.position.x, st.position.z), 6, 45) : 0;
  sound.update(st, nearFinish, dt, nearWater);
  particles.update(camera, st.velocity, dt);
  post.render(st.speed, dt);

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

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Pour les captures automatiques (tools/shots.mjs).
window.__game = {
  sim, rig,
  setAutopilot(v) { auto = v; if (phase === 'hut') phase = 'ride'; },
  setMode,
  state: () => ({ map: mapId, mode, tricks: sim.tricks.landed.slice(), time: sim.race.time, raceState: sim.race.state, s: sim.race.s, speed: sim.bike.state().speed, crashes: sim.race.crashes, crashed: !!sim.bike.crashed }),
};
