// Le son. Des prises de son réelles (CC0, Freesound : voir tools/sons.mjs et public/sons/CREDITS.txt) pour ce qui se
// reconnaît à l'oreille — le pneu sur la terre et les cailloux, la roue libre, la chaîne qui claque, le dérapage, le
// public, les cloches, les ambiances —, de la synthèse pour ce qui doit suivre la physique au plus près : le vent (sa
// force et sa couleur suivent la vitesse), les chocs de suspension, le grondement des planches.
//
// Le vélo, entendu depuis le casque :
// - le roulement : deux prises (terre, graviers) mêlées selon le sol de chaque roue, plus fortes et plus brillantes avec
//   la vitesse ; muettes dès que les roues quittent le sol (le silence en l'air dit le saut) ;
// - la roue libre, clic par clic : chaque clic est un vrai clic de la prise, déclenché à la cadence d'un moyeu à 36
//   dents à la vitesse de la roue arrière (accélérer la prise la rendrait aiguë comme un jouet) ; elle se tait quand on
//   pédale, et un petit claquement marque l'engagement ;
// - la chaîne qui claque sur la base : des grains de la prise, sur les chocs et dans les cailloux ;
// - les chocs : un corps grave (la suspension) et un craquement (le pneu), plus forts à la réception d'un saut ;
// - le dérapage, le grondement des disques au freinage appuyé, le vent (un souffle dont la couleur monte avec la
//   vitesse, et le battement grave dans le casque au-delà de 25 km/h).
// Autour : l'ambiance de la piste (forêt, alpage et ses cloches, glacier, côte et cigales, télésiège), le torrent, le
// public (il enfle à l'approche, cloches et cornes), les rivaux qui passent tout près. Les sons placés dans le monde sont
// panoramiqués et assourdis avec la distance. Une réverbération (courte en forêt, longue en montagne) sur les chocs.
// Le navigateur n'autorise le son qu'après une action du joueur : il démarre à la première touche ou au premier clic.

const FILES = ['roule-terre', 'roule-gravier', 'derapage', 'roue-libre', 'chaine', 'chute', 'chute-metal', 'foule', 'foule-arrivee',
  'cloche', 'corne', 'foret', 'alpage', 'cigales', 'mer', 'torrent', 'telesiege', 'pylone', 'cloche-eglise', 'mouettes', 'corbeau'];

/** Les volumes (réglages, touche G). */
export const SOUND_SETTINGS = { master: 0.8, bike: 1, ambience: 1, crowd: 1 };

const CLICK_PERIOD = 0.019; // la cadence des clics dans la prise de la roue libre (s ; mesurée : 52,6 clics/s)
const HUB_TEETH = 36;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Sound {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.track = null;
    const start = () => this.start();
    addEventListener('keydown', start);
    addEventListener('pointerdown', start);
  }

  /** La piste : son ambiance, ses zones de public. */
  setTrack(track) {
    this.track = track;
    const env = track.map.env, zones = [];
    // Le public : à l'arrivée, au départ en ligne, aux sauts et aux pierriers spectaculaires (comme course.js).
    zones.push({ a: track.sFinish - 70, b: track.length, w: 1 });
    if (track.map.peloton && track.map.peloton.cols) zones.push({ a: track.sStart, b: track.sStart + 80, w: 0.9 });
    for (const f of track.features) {
      if (f.type === 'rocks') zones.push({ a: f.a, b: f.b, w: (env.spotCrowd ?? 26) / 40 });
      else if (f.type === 'jump' && (f.kind !== 'table' || f.crowd)) zones.push({ a: f.lipS - 4, b: f.lipS + (f.crowd ? 30 : 16), w: f.crowd ? 1 : (env.spotCrowd ?? 26) / 40 });
    }
    this.zones = zones;
    this.profile = {
      treeline: env.treeline ?? null, snowline: env.snowline ?? null, maquis: env.flora === 'maquis', sea: env.sea || null,
      lift: track.map.lift || null, alpine: env.treeline != null && env.flora !== 'maquis',
      // les cloches du village : à l'entrée du village (L'Avalanche), en arrivant dans les maisons (Le Single)
      bellAt: track.village ? track.village.a : env.flora === 'maquis' ? track.sFinish - 110 : null,
    };
    if (this.ctx) this.buildReverb();
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    // Le bus principal : un compresseur doux qui tient l'ensemble (les chocs passent au-dessus du reste sans saturer).
    this.out = ctx.createDynamicsCompressor();
    this.out.threshold.value = -16; this.out.ratio.value = 3; this.out.attack.value = 0.006; this.out.release.value = 0.25; this.out.knee.value = 8;
    // puis un limiteur : rien ne dépasse -1 dBFS (une grosse réception, une chute, ne saturent pas)
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.12; this.limiter.knee.value = 0;
    // (le compresseur de Web Audio rajoute de lui-même du gain en sortie : on redescend de 1,5 dB pour garder de la marge)
    this.trim = this.gain(ctx.destination, 0.84);
    this.out.connect(this.limiter).connect(this.trim);
    this.master = this.gain(this.out, SOUND_SETTINGS.master);
    this.bikeBus = this.gain(this.master, 1);
    this.ambBus = this.gain(this.master, 1);
    this.crowdBus = this.gain(this.master, 1);
    this.uiBus = this.gain(this.master, 1);
    this.hubBus = this.gain(this.bikeBus, 1); // la roue libre
    this.rattleBus = this.gain(this.bikeBus, 1); // la chaîne qui claque
    this.reverb = ctx.createConvolver();
    this.reverbOut = this.gain(this.master, 0.5);
    this.reverb.connect(this.reverbOut);
    this.buildReverb();
    // Un bruit en boucle, partagé par tous les sons de synthèse.
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;

    // ----- Le vent : un souffle par oreille (décorrélés), et le battement grave dans le casque -----
    this.wind = [-0.7, 0.7].map((pan) => this.noise('lowpass', 400, 0.6, this.bikeBus, pan));
    this.buffet = this.noise('lowpass', 120, 0.9, this.bikeBus);
    // Le grondement des disques au freinage appuyé, la neige qui crisse, les planches qui grondent (synthèse).
    this.howl = this.noise('bandpass', 1150, 9, this.bikeBus);
    this.snow = this.noise('bandpass', 2600, 0.8, this.bikeBus);
    this.plank = this.noise('bandpass', 210, 2.5, this.bikeBus);
    // L'ambiance de haute montagne : un vent lent et large, sans prise (le glacier).
    this.alpineWind = [-0.5, 0.5].map((pan) => this.noise('bandpass', 500, 0.5, this.ambBus, pan));

    this.state = { lastThump: 0, nextGrain: 0, nextClick: 0, wasAir: false, airTime: 0, pedal: false, crowdT: 0, ravenT: 20, gullT: 6, pyloneT: 3, rung: false, finished: 0, duck: 1 };
    this.voices = [0, 1].map(() => ({ tire: null, hub: { next: 0 }, pan: this.ctx.createStereoPanner(), g: this.gain(this.bikeBus, 0), lp: null }));
    for (const v of this.voices) { v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = 6000; v.pan.connect(v.lp).connect(v.g); }
    this.load();
  }

  // ---------- Les briques ----------
  gain(dest, v = 0) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }

  /** Un bruit filtré en boucle (synthèse), muet au départ : { f, g }. */
  noise(type, freq, q, dest, pan = 0) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    let node = src.connect(f).connect(g);
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(dest);
    src.start(0, Math.random() * 2);
    return { f, g, src };
  }

  /** Une prise en boucle (sans couture), qui part d'un point au hasard : { src, g, f, pan }. */
  bed(name, dest, { filter = 'lowpass', freq = 20000, pan = false } = {}) {
    const b = this.buf[name];
    if (!b) return null;
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = b; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    let node = src.connect(f).connect(g);
    let p = null;
    if (pan) { p = ctx.createStereoPanner(); node = node.connect(p); }
    node.connect(dest);
    src.start(0, Math.random() * b.duration);
    return { src, g, f, pan: p };
  }

  /** Un son ponctuel : une prise (ou un extrait : offset, dur), placé (pan), avec une part de réverbération. */
  play(name, { vol = 1, rate = 1, pan = 0, dest = this.bikeBus, offset = 0, dur = null, wet = 0, when = 0, lp = null } = {}) {
    const b = this.buf[name];
    if (!b || !this.ctx) return;
    const ctx = this.ctx, t = Math.max(ctx.currentTime, when || 0);
    const src = ctx.createBufferSource();
    src.buffer = b; src.playbackRate.value = rate;
    const g = ctx.createGain();
    let node = src;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node = node.connect(f); }
    node.connect(g);
    let out = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); out = g.connect(p); }
    out.connect(dest);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; out.connect(w).connect(this.reverb); }
    if (dur) {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.002);
      g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
      src.start(t, offset, dur + 0.01);
    } else { g.gain.value = vol; src.start(t, offset); }
  }

  async load() {
    const base = import.meta.env ? import.meta.env.BASE_URL : '/';
    await Promise.all(FILES.map(async (name) => {
      try {
        const res = await fetch(`${base}sons/${name}.mp3`);
        this.buf[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) { console.warn('Son indisponible :', name, e.message); }
    }));
    // Les lits : le vélo, les ambiances (muets ; update règle leurs volumes).
    this.dirt = this.bed('roule-terre', this.bikeBus);
    this.gravel = this.bed('roule-gravier', this.bikeBus);
    this.skid = this.bed('derapage', this.bikeBus, { filter: 'lowpass', freq: 9000 });
    this.water = this.bed('torrent', this.bikeBus, { filter: 'highpass', freq: 300 });
    this.amb = {
      foret: this.bed('foret', this.ambBus), alpage: this.bed('alpage', this.ambBus), cigales: this.bed('cigales', this.ambBus),
      mer: this.bed('mer', this.ambBus, { freq: 2500 }), torrent: this.bed('torrent', this.ambBus, { pan: true }),
      telesiege: this.bed('telesiege', this.ambBus, { pan: true }),
    };
    this.crowd = this.bed('foule', this.crowdBus);
    this.roar = this.bed('foule-arrivee', this.crowdBus);
    for (const v of this.voices) v.tire = this.bed('roule-terre', v.pan);
    // La phase des clics dans la prise de la roue libre (là où tombent les clics, à CLICK_PERIOD près).
    const hub = this.buf['roue-libre'];
    if (hub) {
      const x = hub.getChannelData(0), sr = hub.sampleRate, P = Math.round(CLICK_PERIOD * sr), acc = new Float32Array(P);
      for (let i = 1; i < x.length; i++) acc[i % P] += Math.abs(x[i] - x[i - 1]);
      let k = 0; for (let i = 1; i < P; i++) if (acc[i] > acc[k]) k = i;
      this.clickPhase = k / sr;
    }
  }

  /** La réverbération de la piste : une réponse synthétique (bruit qui décroît, les aigus plus vite). */
  buildReverb() {
    if (!this.ctx || !this.track) return;
    const p = this.profile, ctx = this.ctx;
    // la forêt : dense et courte ; la montagne : longue et claire ; la côte : entre les deux
    const T = p.maquis ? 1.3 : p.alpine ? 2.6 : 1.5, sr = ctx.sampleRate, n = Math.round(T * sr);
    const ir = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        lp += (w - lp) * 0.08;
        d[i] = t < 0.012 ? 0 : (w * Math.exp(-t * 9 / T) * 0.35 + lp * Math.exp(-t * 4.5 / T) * 1.4) * 0.5;
      }
    }
    this.reverb.buffer = ir;
  }

  // ---------- Les événements ----------
  tone(freq, dur, vol = 0.25, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.uiBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Les bips de la cellule de départ : trois brefs, puis le long. */
  beep(last) { this.tone(last ? 1250 : 1000, last ? 0.7 : 0.14, 0.2, 'sine'); }

  /** Une figure réussie : deux notes discrètes ; et le public, s'il y en a, s'enflamme. */
  trick() {
    this.tone(784, 0.12, 0.08, 'triangle');
    setTimeout(() => this.tone(1175, 0.28, 0.08, 'triangle'), 100);
    if (this.crowdLevel > 0.15) this.cheer(0.8);
  }

  /** Un choc : le corps grave de la suspension qui talonne, le craquement du pneu sur le sol. */
  thump(strength, { land = false } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = clamp(strength, 0, 1.6);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.5 * s, t + 0.004); og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(og).connect(this.bikeBus);
    const w = ctx.createGain(); w.gain.value = 0.25; og.connect(w).connect(this.reverb);
    o.start(t); o.stop(t + 0.25);
    // le craquement : un éclat de la prise de graviers, plus long à la réception
    this.play(land ? 'roule-gravier' : 'roule-terre', { vol: (land ? 1.4 : 0.9) * s, rate: 0.9 + Math.random() * 0.2, offset: Math.random() * 10, dur: land ? 0.22 : 0.09, lp: 2500 + 3000 * s, wet: 0.15 });
    if (s > 0.5) this.grain(0.6 * s); // la chaîne claque
  }

  /** Un grain de la prise de la chaîne (un claquement sur la base). */
  grain(vol) {
    const b = this.buf.chaine;
    if (!b) return;
    this.play('chaine', { vol, rate: 0.9 + Math.random() * 0.25, offset: Math.random() * (b.duration - 0.2), dur: 0.05 + Math.random() * 0.09, pan: (Math.random() - 0.5) * 0.3, dest: this.rattleBus });
  }

  /** La chute : le corps qui roule, le vélo qui claque ; un coup de bois contre un tronc. */
  crash(reason = '') {
    if (!this.ctx) return;
    this.thump(1.3);
    if (/arbre/i.test(reason)) this.woodHit();
    this.play('chute', { vol: 0.9, wet: 0.2 });
    this.play('chute-metal', { vol: 0.7, when: this.ctx.currentTime + 0.09, wet: 0.25, pan: 0.2 });
    this.duck(0.35, 1.2);
  }

  woodHit() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.2);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.bikeBus);
    const w = ctx.createGain(); w.gain.value = 0.4; g.connect(w).connect(this.reverb);
    o.start(t); o.stop(t + 0.4);
  }

  /** L'arrivée : le public rugit, une corne. */
  finish() {
    if (!this.ctx) return;
    this.state.finished = 5;
    this.play('corne', { vol: 0.5, dest: this.crowdBus, pan: -0.5, wet: 0.3, when: this.ctx.currentTime + 0.3 });
    this.cheer(1);
  }

  cheer(amount) { this.state.crowdT = Math.max(this.state.crowdT, 2.5 * amount); }

  /** Baisse l'ambiance un moment (une chute : on n'entend plus que ça). */
  duck(to, dur) { this.state.duck = to; this.state.duckT = dur; }

  // ---------- À chaque image ----------
  /**
   * st : l'état du vélo. o : { camera, s (la distance le long de la piste), phase, nearWater (0 à 1), others (l'état
   * des rivaux et des autres joueurs : position, speed, contacts, wheels, input), dt }.
   */
  update(st, o) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.track) return;
    const ctx = this.ctx, t = ctx.currentTime, S = this.state, dt = Math.min(0.1, o.dt || 0.016);
    const set = (param, v, k = 0.05) => param.setTargetAtTime(v, t, k);
    this.master.gain.value = SOUND_SETTINGS.master;
    set(this.bikeBus.gain, SOUND_SETTINGS.bike, 0.1);
    set(this.crowdBus.gain, SOUND_SETTINGS.crowd, 0.1);
    if (S.duckT > 0) { S.duckT -= dt; if (S.duckT <= 0) S.duck = 1; }
    const riding = o.phase !== 'hut';
    const v = riding ? st.speed : 0, kmh = v * 3.6;
    const [wf, wr] = st.wheels;
    const grounded = st.contacts > 0;
    const cam = o.camera.matrixWorld.elements;
    const here = { x: cam[12], y: cam[13], z: cam[14] };

    // ----- Le vent -----
    const rush = Math.min(0.75, 0.0015 * v * v);
    for (const [i, w] of this.wind.entries()) {
      set(w.g.gain, rush * (0.85 + 0.15 * Math.sin(t * (1.3 + i * 0.4) + i)), 0.08);
      set(w.f.frequency, 350 + v * 55 + i * 60, 0.08);
    }
    const gust = 0.75 + 0.25 * Math.sin(t * 6.3) * Math.sin(t * 2.9 + 1.1);
    set(this.buffet.g.gain, smooth(25, 65, kmh) * 0.35 * gust, 0.05);

    // ----- Le roulement, selon le sol de chaque roue -----
    const mix = { dirt: 0, gravel: 0, snow: 0, plank: 0, water: 0, soft: 0 }; // (soft : l'herbe, le son s'assourdit)
    let nw = 0;
    for (const w of [wf, wr]) {
      if (!w.contact) continue;
      nw++;
      const name = (w.surface || { name: 'terre' }).name;
      if (name === 'cailloux') { mix.gravel += 1; mix.dirt += 0.3; }
      else if (name === 'gravier') mix.gravel += 0.9;
      else if (name === 'roche') { mix.gravel += 0.3; mix.dirt += 0.15; }
      else if (name === 'terre sèche') { mix.dirt += 0.9; mix.gravel += 0.25; }
      else if (name === 'herbe') { mix.dirt += 0.55; mix.soft += 1; }
      else if (name === 'bois') { mix.plank += 1; mix.dirt += 0.1; }
      else if (name === 'neige' || name === 'neige molle') mix.snow += name === 'neige' ? 0.8 : 1.1;
      else if (name === 'pavés') { mix.gravel += 0.45; mix.plank += 0.25; }
      else if (name === 'eau') mix.water += 1;
      else mix.dirt += 1; // terre, racines
    }
    const per = nw ? 1 / 2 : 0;
    const roll = clamp(v / 14, 0, 1.3) ** 0.8;
    const air = !grounded;
    const k = air ? 0.02 : 0.04; // (en l'air, le roulement se tait aussitôt)
    const cut = 900 + 9000 * clamp(v / 12, 0, 1) * (1 - 0.6 * clamp(mix.soft * per, 0, 1));
    if (this.dirt) {
      set(this.dirt.g.gain, mix.dirt * per * roll * 1.9, k);
      set(this.dirt.src.playbackRate, 0.8 + 0.4 * clamp(v / 14, 0, 1.2), 0.1);
      set(this.dirt.f.frequency, cut, 0.1);
    }
    if (this.gravel) {
      set(this.gravel.g.gain, mix.gravel * per * roll * 0.9, k);
      set(this.gravel.src.playbackRate, 0.85 + 0.35 * clamp(v / 14, 0, 1.2), 0.1);
      set(this.gravel.f.frequency, cut * 1.2, 0.1);
    }
    set(this.snow.g.gain, mix.snow * per * roll * 0.12, k);
    set(this.plank.g.gain, mix.plank * per * roll * 0.5, k);
    set(this.plank.f.frequency, 160 + v * 6, 0.1);
    if (this.water) set(this.water.g.gain, mix.water * per * Math.min(1, v / 4) * 1.2, 0.05);
    // Les planches et les pavés : un coup à chaque latte ou chaque pavé (tous les 15 cm).
    if (mix.plank > 0 && v > 1 && Math.random() < dt * v / 0.6) this.thump(0.12 + Math.random() * 0.1);

    // ----- Le dérapage, les disques -----
    const slide = Math.max(wf.contact ? wf.slip : 0, wr.contact ? wr.slip : 0);
    if (this.skid) {
      set(this.skid.g.gain, grounded && v > 1.5 ? Math.min(1.1, Math.max(0, slide - 0.25) * 1.8) * (mix.snow ? 0.4 : 1) : 0, 0.03);
      set(this.skid.src.playbackRate, 0.85 + Math.min(0.4, v / 30), 0.1);
      set(this.skid.f.frequency, mix.soft || mix.snow ? 2500 : 9000, 0.1);
    }
    const inp = st.input || {};
    const brake = Math.max(inp.brakeFront || 0, inp.brakeRear || 0);
    set(this.howl.g.gain, grounded && brake > 0.35 ? (brake - 0.35) * Math.min(1, v / 9) * 0.06 : 0, 0.06);
    set(this.howl.f.frequency, 1050 + 120 * Math.sin(t * 7) + v * 8, 0.05);

    // ----- La roue libre, clic par clic ; l'engagement quand on se remet à pédaler -----
    const pedal = (inp.pedal || 0) > 0 && riding;
    if (pedal && !S.pedal) this.play('roue-libre', { vol: 0.5, offset: (this.clickPhase || 0) + CLICK_PERIOD * Math.floor(Math.random() * 60), dur: 0.012, dest: this.hubBus });
    S.pedal = pedal;
    const omega = Math.abs(wr.omega || 0);
    const clicks = riding && !pedal && omega > 1 ? (HUB_TEETH * omega) / (2 * Math.PI) : 0;
    // (plus il y a de clics par seconde, plus chacun est discret : à vitesse, un bourdonnement sous le roulement ;
    // lent ou en l'air, quand le roulement se tait, on n'entend plus que lui)
    this.hub(S, clicks, Math.min(0.35, 0.19 * Math.sqrt(150 / Math.max(clicks, 40))), this.hubBus);

    // ----- La chaîne qui claque, les chocs, la réception -----
    // (après un saut de position — le retour au dernier point après une chute —, la suspension se tasse : pas de chocs)
    const p0 = st.position;
    if (S.pos && Math.hypot(p0.x - S.pos.x, p0.y - S.pos.y, p0.z - S.pos.z) > 4) { S.quiet = t + 0.6; S.wasAir = false; S.airTime = 0; }
    S.pos = { x: p0.x, y: p0.y, z: p0.z };
    const quiet = t < (S.quiet || 0);
    const shake = air ? 0 : (mix.gravel * 1.6 + mix.dirt * 0.4 + mix.plank) * per * clamp(v / 10, 0, 1.5);
    if (shake > 0.05 && t > S.nextGrain) { this.grain(0.25 + 0.3 * Math.random()); S.nextGrain = t + 0.05 + Math.random() * 0.35 / shake; }
    const hit = Math.max(wf.xdot || 0, wr.xdot || 0);
    if (air) S.airTime += dt;
    if (quiet) { /* rien */ }
    else if (!air && S.wasAir && S.airTime > 0.3) { this.thump(0.6 + Math.min(1, hit / 4), { land: true }); S.lastThump = t; this.duck(0.7, 0.4); }
    else if (hit > 1.6 && t - S.lastThump > 0.12) { S.lastThump = t; this.thump((hit - 1.2) / 3); }
    if (!air) S.airTime = 0;
    S.wasAir = air;

    // ----- L'ambiance -----
    this.ambience(here, { ...o, speed: v }, dt);

    // ----- Le public -----
    let crowd = 0;
    for (const z of this.zones) crowd = Math.max(crowd, z.w * (1 - smooth(0, 45, Math.max(z.a - o.s, o.s - z.b, 0))));
    this.crowdLevel = crowd;
    if (S.crowdT > 0) S.crowdT -= dt;
    if (S.finished > 0) S.finished -= dt;
    const swell = Math.min(1, S.crowdT / 2.5);
    if (this.crowd) set(this.crowd.g.gain, crowd * (0.8 + 0.6 * swell), 0.3);
    if (this.roar) set(this.roar.g.gain, Math.max(0, Math.min(1, S.finished / 2)) * 0.9 + crowd * swell * 0.4, 0.25);
    // des cloches et des cornes, de chaque côté, quand on passe devant le public
    if (riding && crowd > 0.35 && Math.random() < dt * crowd * 0.9) {
      const horn = Math.random() < 0.25;
      this.play(horn ? 'corne' : 'cloche', { vol: (horn ? 0.18 : 0.45) * crowd, rate: horn ? 0.95 + Math.random() * 0.1 : 0.9 + Math.random() * 0.25, pan: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5), dest: this.crowdBus, wet: 0.25, offset: horn ? 0 : Math.random() * 0.5, dur: horn ? null : 0.6 + Math.random() * 0.6 });
    }

    // ----- Les rivaux qui passent tout près : leur roulement et leur roue libre -----
    const near = (o.others || []).map((r) => ({ r, d: Math.hypot(r.position.x - here.x, r.position.y - here.y, r.position.z - here.z) }))
      .filter((n) => n.d < 35).sort((a, b) => a.d - b.d).slice(0, this.voices.length);
    this.voices.forEach((V, i) => {
      const n = near[i];
      if (!n) { set(V.g.gain, 0, 0.1); this.hub(V.hub, 0, 0, V.pan); return; }
      const r = n.r, rv = r.speed || 0, att = 1 / (1 + n.d / 3);
      set(V.g.gain, att * SOUND_SETTINGS.bike, 0.05);
      set(V.pan.pan, this.panOf(r.position, cam), 0.05);
      set(V.lp.frequency, 12000 * Math.exp(-n.d / 25) + 800, 0.05);
      if (V.tire) {
        // (sur la neige, le pneu d'un rival ne gronde pas : il souffle)
        const sn = /neige/.test(this.track.surfaceAt(r.position.x, r.position.z).name);
        set(V.tire.g.gain, r.contacts > 0 ? clamp(rv / 14, 0, 1.3) ** 0.8 * (sn ? 0.5 : 1.6) : 0, 0.03);
        set(V.tire.f.frequency, sn ? 1800 : 20000, 0.1);
        set(V.tire.src.playbackRate, 0.8 + 0.4 * clamp(rv / 14, 0, 1.2), 0.1);
      }
      const om = Math.abs((r.wheels && r.wheels[1] && r.wheels[1].omega) || rv / 0.37);
      this.hub(V.hub, r.input && r.input.pedal ? 0 : (HUB_TEETH * om) / (2 * Math.PI), 0.35, V.pan);
    });
  }

  /** La roue libre d'un vélo (h : son état) : programme les clics à la cadence voulue, un peu en avance. */
  hub(h, rate, vol, dest) {
    const b = this.buf['roue-libre'];
    const t = this.ctx.currentTime;
    if (!b || rate < 4) { h.next = 0; return; }
    if (h.next < t) h.next = t + 0.005;
    const period = 1 / rate, len = Math.min(0.016, period * 1.4);
    const n = Math.floor((b.duration - 0.05) / CLICK_PERIOD);
    while (h.next < t + 0.08) {
      const off = Math.max(0, (this.clickPhase || 0) + CLICK_PERIOD * Math.floor(Math.random() * n) - 0.0015);
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = b;
      g.gain.setValueAtTime(vol * (0.85 + Math.random() * 0.3), h.next);
      g.gain.linearRampToValueAtTime(0, h.next + len);
      src.connect(g).connect(dest);
      src.start(h.next, off, len + 0.002);
      h.next += period * (0.97 + Math.random() * 0.06);
    }
  }

  /** De -1 (à gauche) à 1 (à droite), d'après la caméra. */
  panOf(p, e) {
    const dx = p.x - e[12], dy = p.y - e[13], dz = p.z - e[14], l = Math.hypot(dx, dy, dz) || 1;
    return clamp((dx * e[0] + dy * e[1] + dz * e[2]) / l, -1, 1) * 0.85;
  }

  /** L'ambiance de la piste, selon l'endroit : la forêt, l'alpage, le glacier, la côte, le télésiège, le torrent. */
  ambience(here, o, dt) {
    const p = this.profile, S = this.state, t = this.ctx.currentTime, A = this.amb || {};
    const set = (param, v, k = 0.5) => param.setTargetAtTime(v, t, k);
    // Le vent et le roulement couvrent l'ambiance (à 40 km/h, on n'entend presque plus les oiseaux) ; une chute la
    // fait taire un instant.
    const lvl = SOUND_SETTINGS.ambience * (1 - 0.75 * smooth(4, 40, (o.speed || 0) * 3.6)) * S.duck;
    set(this.ambBus.gain, lvl, 0.15);
    const y = here.y;
    const above = p.treeline != null ? smooth(p.treeline - 30, p.treeline + 30, y) : 0;
    const high = p.snowline != null ? smooth(p.snowline - 150, p.snowline, y) : 0;
    const coast = p.sea ? smooth(-30, -100, y) : 0;
    if (A.foret) set(A.foret.g.gain, (p.maquis ? 0.2 : 0.5) * (1 - above));
    if (A.alpage) set(A.alpage.g.gain, p.alpine ? 0.6 * above * (1 - high) : 0);
    if (A.cigales) set(A.cigales.g.gain, p.maquis ? 0.5 * (1 - 0.5 * coast) : 0);
    if (A.mer) set(A.mer.g.gain, p.sea ? 0.12 + 0.5 * coast : 0);
    const alpineWind = p.alpine ? 0.08 + 0.25 * high : 0;
    for (const [i, w] of this.alpineWind.entries()) {
      set(w.g.gain, alpineWind * (0.7 + 0.3 * Math.sin(t * (0.21 + i * 0.07) + i * 2)), 0.8);
      set(w.f.frequency, 380 + 160 * Math.sin(t * 0.13 + i), 0.8);
    }
    // Le torrent, du côté où il coule.
    if (A.torrent) {
      set(A.torrent.g.gain, (o.nearWater || 0) * 0.9, 0.3);
      if (o.waterDir != null) set(A.torrent.pan.pan, o.waterDir, 0.3);
    }
    // Le télésiège : le câble et les sièges qui passent sur les pylônes, au point le plus proche de la ligne.
    if (p.lift && A.telesiege) {
      const [[ax, az], [bx, bz]] = p.lift, dx = bx - ax, dz = bz - az;
      const u = clamp(((here.x - ax) * dx + (here.z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const q = { x: ax + dx * u, y: here.y + 10, z: az + dz * u }, d = Math.hypot(q.x - here.x, q.z - here.z);
      const e = o.camera.matrixWorld.elements;
      set(A.telesiege.g.gain, 0.8 / (1 + d / 15), 0.3);
      set(A.telesiege.pan.pan, this.panOf(q, e), 0.2);
      if ((S.pyloneT -= dt) < 0 && d < 60) { S.pyloneT = 5 + Math.random() * 6; this.play('pylone', { vol: 0.5 / (1 + d / 15), pan: this.panOf(q, e), dest: this.ambBus, wet: 0.2 }); }
    }
    // Les oiseaux : un corbeau au loin (forêt, montagne), les mouettes près de la mer.
    if ((S.ravenT -= dt) < 0) { S.ravenT = 25 + Math.random() * 40; if (!p.maquis) this.play('corbeau', { vol: 0.25, pan: Math.random() * 1.6 - 0.8, dest: this.ambBus, lp: 3500, wet: 0.5 }); }
    if (p.sea && (S.gullT -= dt) < 0) { S.gullT = 12 + Math.random() * 18; if (coast > 0.3) this.play('mouettes', { vol: 0.25 * coast, pan: Math.random() * 1.6 - 0.8, dest: this.ambBus, lp: 4000, wet: 0.3 }); }
    // Les cloches du village, une fois par descente.
    if (p.bellAt != null && o.phase === 'ride') {
      if (o.s < p.bellAt - 50) S.rung = false;
      else if (!S.rung && o.s > p.bellAt) { S.rung = true; this.play('cloche-eglise', { vol: 0.35, pan: -0.4, dest: this.ambBus, lp: 5000, wet: 0.6 }); }
    }
  }
}
