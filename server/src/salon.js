// Les règles d'un salon, sans Cloudflare autour : qui est l'hôte, la piste et le mode choisis, le départ, les temps.
// Le Durable Object (index.js) ne fait que brancher ces règles sur les connexions ; les tests les essaient seules.
//
// Un salon, c'est quelques potes (MAX_PLAYERS au plus) sur la même piste. L'hôte (le premier arrivé encore là)
// choisit la piste et le mode, puis lance la course : le départ est fixé à une heure du serveur, quelques secondes plus
// tard, pour que tout le monde parte au même GO. Les positions ne font que passer : le serveur les relaie aux autres.

export const MAX_PLAYERS = 8;
/** Le temps entre « Lancer » et le GO : de quoi se placer sur la grille, et le compte à rebours. */
export const START_DELAY = 6000;
export const NAME_MAX = 20;
/** Les couleurs proposées (des tenues, voir src/net/kits.js). */
export const COLORS = 8;
/** Un joueur qui revient dans ce délai (ms) garde sa place d'arrivée, donc son rôle d'hôte (le temps de recharger la page). */
export const REJOIN = 60000;
/** Une pose : les champs d'un échantillon du peloton (voir src/sim/peloton.js), plus quelques-uns de marge. */
const POSE_MAX = 24;

/** Un salon tout neuf : la piste et le mode de celui qui l'ouvre. */
export function newRoom(map = 'foret', mode = 'normal') {
  return { map, mode, race: null, results: {}, nextRace: 1, left: {} };
}

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) || 'Pilote';
const cleanId = (s) => (typeof s === 'string' && /^[a-z0-9]{6,16}$/.test(s) ? s : null);
const word = (s) => (typeof s === 'string' && /^[a-z]{2,16}$/.test(s) ? s : null);

/** L'hôte : le premier arrivé parmi ceux qui sont encore là. */
export function hostOf(players) {
  let h = null;
  for (const p of players) if (p.id && (!h || p.joined < h.joined)) h = p;
  return h ? h.id : null;
}

/** Ce que tout le monde voit du salon. */
export function view(room, players) {
  return {
    map: room.map, mode: room.mode, race: room.race, results: room.results, host: hostOf(players),
    players: players.filter((p) => p.id).sort((a, b) => a.joined - b.joined).map((p) => ({ id: p.id, name: p.name, color: p.color })),
  };
}

/**
 * Un message d'un joueur. players : tous les joueurs connectés (me compris), chacun { id, name, color, joined } ;
 * me : celui qui parle (modifié sur place à son arrivée). Renvoie { room, out } : le salon (le même objet s'il n'a pas
 * changé) et les messages à envoyer, chacun { to: 'all' | 'others' | 'me', msg }, et peut-être close (salon plein).
 */
export function handle(room, players, me, msg, now) {
  const out = [];
  const isHost = () => hostOf(players) === me.id;
  const roomChanged = () => out.push({ to: 'all', msg: { t: 'room', room: view(room, players) } });
  if (!msg || typeof msg !== 'object') return { room, out };

  if (msg.t === 'ping') {
    out.push({ to: 'me', msg: { t: 'pong', c: msg.c, s: now } });
    return { room, out };
  }

  if (msg.t === 'hello') {
    const id = cleanId(msg.id);
    if (!id) return { room, out, close: 'id' };
    // (déjà là : la même personne qui revient, après un rechargement de page par exemple)
    const others = players.filter((p) => p !== me && p.id && p.id !== id);
    if (others.length >= MAX_PLAYERS) return { room, out: [{ to: 'me', msg: { t: 'full' } }], close: 'full' };
    const back = players.find((p) => p !== me && p.id === id);
    const prev = (room.left || {})[id];
    Object.assign(me, {
      id, name: cleanName(msg.name), color: Number.isInteger(msg.color) ? ((msg.color % COLORS) + COLORS) % COLORS : 0,
      joined: back ? back.joined : prev && now - prev.at < REJOIN ? prev.joined : now,
    });
    if (prev) { const { [id]: _, ...left } = room.left; room = { ...room, left }; }
    if (back) back.id = null; // (son ancienne connexion ne compte plus)
    // Le premier venu fixe la piste et le mode.
    if (others.length === 0 && !room.race) {
      room = { ...room, map: word(msg.map) || room.map, mode: word(msg.mode) || room.mode };
    }
    out.push({ to: 'me', msg: { t: 'welcome', you: id, now } });
    roomChanged();
    return { room, out, replaced: back || null };
  }

  if (!me.id) return { room, out }; // rien avant de s'être présenté

  if (msg.t === 'pose') {
    if (!Array.isArray(msg.p) || msg.p.length > POSE_MAX || !msg.p.every((v) => typeof v === 'number' && Number.isFinite(v))) return { room, out };
    // (rt : son temps de course, pour les écarts ; at : l'heure du serveur de la pose, pour l'affichage)
    out.push({ to: 'others', msg: { t: 'pose', id: me.id, at: Number.isFinite(msg.at) ? msg.at : now, rt: Number.isFinite(msg.rt) ? msg.rt : null, p: msg.p } });
    return { room, out };
  }

  if (msg.t === 'profile') {
    me.name = cleanName(msg.name);
    if (Number.isInteger(msg.color)) me.color = ((msg.color % COLORS) + COLORS) % COLORS;
    roomChanged();
    return { room, out };
  }

  if (msg.t === 'config') {
    // L'hôte choisit, pas pendant une course.
    if (!isHost() || racing(room, players, now)) return { room, out };
    room = { ...room, map: word(msg.map) || room.map, mode: word(msg.mode) || room.mode };
    roomChanged();
    return { room, out };
  }

  if (msg.t === 'start') {
    if (!isHost() || racing(room, players, now)) return { room, out };
    const grid = players.filter((p) => p.id).sort((a, b) => a.joined - b.joined).map((p) => p.id);
    room = { ...room, race: { id: room.nextRace, at: now + START_DELAY, grid, map: room.map, mode: room.mode }, results: {}, nextRace: room.nextRace + 1 };
    roomChanged();
    return { room, out };
  }

  if (msg.t === 'finish') {
    const r = room.race;
    if (!r || msg.race !== r.id || !r.grid.includes(me.id) || me.id in room.results) return { room, out };
    if (!(typeof msg.time === 'number' && msg.time > 0 && msg.time < 3600)) return { room, out };
    room = { ...room, results: { ...room.results, [me.id]: msg.time } };
    roomChanged();
    return { room, out };
  }

  if (msg.t === 'abandon') {
    const r = room.race;
    if (!r || !r.grid.includes(me.id) || me.id in room.results) return { room, out };
    room = { ...room, results: { ...room.results, [me.id]: null } };
    roomChanged();
    return { room, out };
  }

  return { room, out };
}

/**
 * Une course est-elle en cours ? Oui tant qu'un partant encore connecté n'a ni temps ni abandon (et au plus une heure).
 * Pendant ce temps, l'hôte ne peut ni changer de piste ni relancer.
 */
export function racing(room, players, now) {
  const r = room.race;
  if (!r || now > r.at + 3600e3) return false;
  const here = new Set(players.map((p) => p.id));
  return r.grid.some((id) => here.has(id) && !(id in room.results));
}

/**
 * Quelqu'un part (gone : sa fiche) : les autres sont prévenus (et peut-être d'un nouvel hôte). On se souvient un moment
 * de son heure d'arrivée, pour le cas où il revient.
 */
export function leave(room, players, gone, now) {
  if (gone && gone.id) {
    const left = {};
    for (const [id, v] of Object.entries(room.left || {})) if (now - v.at < REJOIN) left[id] = v;
    left[gone.id] = { joined: gone.joined, at: now };
    room = { ...room, left };
  }
  return { room, out: [{ to: 'all', msg: { t: 'room', room: view(room, players) } }] };
}
