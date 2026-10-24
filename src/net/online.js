// Le jeu en ligne : la connexion au salon (server/), l'heure du serveur, et les tenues des joueurs.
//
// Tout passe par un salon, désigné par un code de cinq lettres (?salon=CODE dans l'adresse) : on y retrouve ses potes,
// l'hôte choisit la piste et lance la course. Le départ est donné à une heure du serveur : chacun estime l'écart entre
// son horloge et celle du serveur (net.now()), et part au même GO que les autres.

/** Le serveur des salons sur Cloudflare (server/, npx wrangler deploy). */
const SERVEUR = 'wss://dh-salons.downhill.workers.dev';
/**
 * Le serveur à joindre : ?serveur=… (?serveur=local : node server/dev.mjs sur sa machine), sinon celui de la compilation
 * (VITE_SERVEUR), sinon celui de Cloudflare.
 */
export function serverUrl(params) {
  const fromEnv = import.meta.env && import.meta.env.VITE_SERVEUR;
  const asked = params.get('serveur') === 'local' ? `ws://${location.hostname || 'localhost'}:8787` : params.get('serveur');
  const url = asked || fromEnv || SERVEUR;
  return url.replace(/\/+$/, '');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // (sans I, O, 0, 1 : on les confond en les dictant)
export const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{4,8}$/.test(c.toUpperCase());

/** Qui on est : un identifiant par onglet (deux onglets, deux joueurs), qui survit au rechargement de la page. */
export function playerId() {
  try {
    let id = sessionStorage.getItem('downhill.joueur');
    if (!id) { id = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); sessionStorage.setItem('downhill.joueur', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 12).padEnd(10, '0'); }
}

/** Les tenues des joueurs en ligne (même format que celles du peloton), une par couleur. */
export const KITS = [
  { label: 'Rouge', jersey: '#d7261e', jersey2: '#ffffff', pattern: 'epaules', pants: '#16181d', helmet: '#ffffff', helmet2: '#d7261e', gloves: '#d7261e', pack: false },
  { label: 'Bleu', jersey: '#1f5fd6', jersey2: '#ffd21f', pattern: 'bandes', pants: '#101828', helmet: '#ffd21f', helmet2: '#1f5fd6', gloves: '#1f5fd6', pack: false },
  { label: 'Vert', jersey: '#1e9e4a', jersey2: '#0d1a12', pattern: 'diagonale', pants: '#0d1a12', helmet: '#0d1a12', helmet2: '#1e9e4a', gloves: '#1e9e4a', pack: false },
  { label: 'Jaune', jersey: '#ffcc12', jersey2: '#141414', pattern: 'epaules', pants: '#141414', helmet: '#141414', helmet2: '#ffcc12', gloves: '#141414', pack: false },
  { label: 'Orange', jersey: '#ff6a13', jersey2: '#1d2633', pattern: 'bandes', pants: '#1d2633', helmet: '#ff6a13', helmet2: '#1d2633', gloves: '#1d2633', pack: false },
  { label: 'Violet', jersey: '#7a3fc4', jersey2: '#f2f2ef', pattern: 'diagonale', pants: '#221a2e', helmet: '#f2f2ef', helmet2: '#7a3fc4', gloves: '#7a3fc4', pack: false },
  { label: 'Rose', jersey: '#ff3d9a', jersey2: '#111318', pattern: 'uni', pants: '#111318', helmet: '#111318', helmet2: '#ff3d9a', gloves: '#ff3d9a', pack: false },
  { label: 'Blanc', jersey: '#f4f4f0', jersey2: '#222831', pattern: 'epaules', pants: '#222831', helmet: '#222831', helmet2: '#f4f4f0', gloves: '#222831', pack: false },
];

/**
 * Rejoint un salon. Renvoie net : net.on(type, fn) pour 'room' (le salon a changé), 'pose' (la position d'un autre),
 * 'status' (connexion, ok, coupé, plein) ; net.send(msg) ; net.now() (l'heure du serveur, en ms) ; net.room ; net.you.
 * La connexion se refait seule si elle tombe.
 */
export function joinSalon({ url, code, id, name, color, map, mode }) {
  const handlers = {};
  const emit = (t, ...a) => (handlers[t] || []).forEach((f) => f(...a));
  const net = {
    code, you: id, room: null, status: 'connexion', profile: { name, color },
    on(t, f) { (handlers[t] ||= []).push(f); return net; },
    send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    now: () => Date.now() + offset,
    setProfile(n, c) { net.profile = { name: n, color: c }; net.send({ t: 'profile', name: n, color: c }); },
    close() { closed = true; clearInterval(pinger); if (ws) ws.close(1000); },
  };
  let ws = null, closed = false, retry = 0, offset = 0, pinger = null;
  // L'heure du serveur : on garde la mesure faite avec l'aller-retour le plus court (la moins faussée par le réseau).
  const clock = [];
  const ping = () => net.send({ t: 'ping', c: Date.now() });
  const setStatus = (s) => { net.status = s; emit('status', s); };

  function open() {
    setStatus('connexion');
    ws = new WebSocket(`${url}/salon/${code}`);
    ws.onopen = () => {
      retry = 0;
      net.send({ t: 'hello', id, name: net.profile.name, color: net.profile.color, map, mode });
      for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'pong') {
        const t = Date.now(), rtt = t - msg.c;
        clock.push({ rtt, offset: msg.s + rtt / 2 - t });
        if (clock.length > 12) clock.shift();
        offset = clock.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
        net.rtt = rtt;
      } else if (msg.t === 'welcome') {
        if (!clock.length) offset = msg.now - Date.now();
        setStatus('ok');
      } else if (msg.t === 'room') {
        net.room = msg.room;
        emit('room', msg.room);
      } else if (msg.t === 'pose') emit('pose', msg.id, msg.at, msg.p, msg.rt);
      else if (msg.t === 'full') setStatus('plein');
    };
    ws.onclose = (e) => {
      if (closed || e.code === 4000) return; // (fermée exprès, ou remplacée par un autre onglet du même joueur)
      if (e.code === 4001) { setStatus('plein'); return; }
      setStatus('coupé');
      setTimeout(open, Math.min(10000, 1000 * 2 ** retry++));
    };
  }
  open();
  pinger = setInterval(ping, 15000);
  return net;
}
