// Le son, entièrement synthétisé (Web Audio) : bips du départ, vent, roulement des pneus selon le sol, cliquetis
// de la roue libre, pneu qui glisse, chocs de suspension, chute, public à l'arrivée, torrent près du pont.
// Le navigateur n'autorise le son qu'après une action du joueur : il démarre à la première touche ou au premier clic.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    const start = () => this.start();
    addEventListener('keydown', start, { once: false });
    addEventListener('pointerdown', start, { once: false });
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
    // Un bruit blanc en boucle, partagé par tous les sons de frottement.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 2; }
    this.noiseBuf = buf;
    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.wind = loop('lowpass', 400, 0.7);
    this.tire = loop('bandpass', 500, 0.9);
    this.skid = loop('bandpass', 1800, 2.5);
    this.crowd = loop('bandpass', 900, 0.6);
    this.rumble = loop('lowpass', 140, 0.8); // le vent qui tape dans le casque, à haute vitesse
    this.stream = loop('bandpass', 1500, 0.4); // le torrent : un souffle d'eau qui bouillonne
    // La roue libre : un cliquetis dont la fréquence suit la roue arrière.
    const hub = ctx.createOscillator();
    hub.type = 'square';
    const hubF = ctx.createBiquadFilter(); hubF.type = 'bandpass'; hubF.Q.value = 3;
    const hubG = ctx.createGain(); hubG.gain.value = 0;
    hub.connect(hubF).connect(hubG).connect(this.master);
    hub.start();
    this.hub = { osc: hub, f: hubF, g: hubG };
  }

  tone(freq, dur, vol = 0.25, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Un coup sourd (choc de suspension, réception, chute). */
  thump(strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180 + strength * 250;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, strength) * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + strength * 0.12);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.4);
  }

  beep(last) { this.tone(last ? 1320 : 880, last ? 0.55 : 0.16, 0.22, 'triangle'); }

  /** Une figure réussie : deux notes qui montent. */
  trick() {
    this.tone(784, 0.13, 0.16, 'triangle');
    setTimeout(() => this.tone(1175, 0.32, 0.16, 'triangle'), 110);
  }

  /** nearWater : de 0 (loin) à 1 (au bord du torrent). */
  update(st, nearFinish, dt, nearWater = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, k = 0.06;
    const v = st.speed;
    const [wf, wr] = st.wheels;
    const grounded = st.contacts > 0;
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, 0.0012 * v * v), t, k);
    this.wind.f.frequency.setTargetAtTime(300 + v * 45, t, k);
    // À haute vitesse, le vent bat dans le casque : un grondement grave qui palpite.
    const kmh = v * 3.6, gust = 0.75 + 0.25 * Math.sin(t * 6.3) * Math.sin(t * 2.9 + 1.1);
    this.rumble.g.gain.setTargetAtTime(Math.min(0.45, Math.max(0, (kmh - 25) / 40)) * 0.45 * gust, t, 0.05);
    // Le roulement : plus fort et plus aigu sur les cailloux et les racines.
    const surf = (wf.surface || wr.surface || { name: 'terre' }).name;
    const rough = surf === 'cailloux' ? 2.2 : surf === 'racines' ? 1.6 : surf === 'gravier' ? 1.4 : surf === 'herbe' ? 0.7 : surf === 'bois' ? 1.3 : surf === 'roche' ? 0.8 : 1;
    this.tire.g.gain.setTargetAtTime(grounded ? Math.min(0.35, v * 0.022 * rough) : 0, t, 0.03);
    this.tire.f.frequency.setTargetAtTime(220 + v * 30 * rough, t, k);
    const slide = Math.max(wf.contact ? wf.slip : 0, wr.contact ? wr.slip : 0);
    this.skid.g.gain.setTargetAtTime(grounded && v > 1.5 ? Math.min(0.28, Math.max(0, slide - 0.25) * 0.6) : 0, t, 0.03);
    // La roue libre : seulement quand on ne pédale pas.
    const coasting = !(st.input && st.input.pedal > 0) && Math.abs(wr.omega) > 2;
    this.hub.osc.frequency.setTargetAtTime(Math.abs(wr.omega) * 16, t, 0.05);
    this.hub.f.frequency.setTargetAtTime(Math.abs(wr.omega) * 16, t, 0.05);
    this.hub.g.gain.setTargetAtTime(coasting ? Math.min(0.05, Math.abs(wr.omega) * 0.002) : 0, t, 0.05);
    this.crowd.g.gain.setTargetAtTime(nearFinish * 0.22, t, 0.3);
    const gurgle = 0.8 + 0.2 * Math.sin(t * 4.1) * Math.sin(t * 6.7 + 2);
    this.stream.g.gain.setTargetAtTime(nearWater * 0.2 * gurgle, t, 0.2);
    this.stream.f.frequency.setTargetAtTime(1300 + 500 * gurgle, t, 0.1);
    // Les chocs : quand la suspension s'enfonce vite.
    const hit = Math.max(wf.xdot || 0, wr.xdot || 0);
    if (hit > 1.6 && (!this._lastThump || t - this._lastThump > 0.12)) { this._lastThump = t; this.thump((hit - 1.2) / 3); }
  }
}
