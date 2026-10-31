// Les règles du classement mondial, sans Cloudflare autour : un tableau par piste et par mode, le meilleur temps de
// chaque pilote. Le Durable Object (index.js) ne fait que les brancher sur les requêtes ; les tests les essaient seules.
//
// Un pilote, c'est un identifiant tiré au hasard par son navigateur (jamais renvoyé aux autres : il sert de clé).
// Le serveur ne rejoue pas la manche : il refuse seulement les temps impossibles, plus rapides que FLOOR.

export const MAPS = ['foret', 'alpes', 'avalanche', 'bikepark', 'single', 'ville'];
export const MODES = ['normal', 'ultra'];
/** Le temps le plus court accepté (s) : environ 60 % du meilleur pilote automatique sur la piste. */
export const FLOOR = { foret: 40, alpes: 108, avalanche: 210, bikepark: 54, single: 32, ville: 35 };
export const CEIL = 1800;
/** Les pilotes gardés par tableau (les plus lents sortent) et ceux qu'on montre. */
export const KEEP = 1000;
export const TOP = 50;
export const NAME_MAX = 20;
export const COLORS = 8;

export const boardName = (map, mode) => (MAPS.includes(map) && MODES.includes(mode) ? `${map}.${mode}` : null);
export const newBoard = () => ({ runs: [] });
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) || 'Pilote';
const cleanId = (s) => (typeof s === 'string' && /^[a-z0-9]{8,16}$/.test(s) ? s : null);

/**
 * Un temps envoyé. Renvoie { board, ok, reason, improved } : improved si c'est le nouveau meilleur temps du pilote
 * (sinon on ne retient que son nom, s'il en a changé).
 */
export function submit(board, msg, map, now) {
  const id = cleanId(msg && msg.id);
  if (!id) return { board, ok: false, reason: 'pilote' };
  const time = Number(msg.time);
  if (!Number.isFinite(time) || time < (FLOOR[map] || 0) || time > CEIL) return { board, ok: false, reason: 'temps' };
  const name = cleanName(msg.name);
  const color = Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS ? msg.color : 0;
  const t = Math.round(time * 1000) / 1000;
  const old = board.runs.find((r) => r.id === id);
  if (old && old.time <= t) {
    if (old.name === name && old.color === color) return { board, ok: true, improved: false };
    return { board: { runs: board.runs.map((r) => (r === old ? { ...r, name, color } : r)) }, ok: true, improved: false };
  }
  const runs = board.runs.filter((r) => r.id !== id);
  runs.push({ id, name, color, time: t, at: now });
  // (à temps égal, le premier à l'avoir fait passe devant)
  runs.sort((a, b) => a.time - b.time || a.at - b.at);
  return { board: { runs: runs.slice(0, KEEP) }, ok: true, improved: true };
}

/** Ce qu'on montre : les TOP premiers, et la place du pilote id avec ses voisins (sans les identifiants des autres). */
export function view(board, id, top = TOP) {
  const show = (r, i) => ({ rank: i + 1, name: r.name, color: r.color, time: r.time, at: r.at, me: r.id === id });
  const i = id ? board.runs.findIndex((r) => r.id === id) : -1;
  return {
    total: board.runs.length,
    top: board.runs.slice(0, top).map(show),
    me: i < 0 ? null : show(board.runs[i], i),
    around: i < 0 ? [] : board.runs.slice(Math.max(0, i - 1), i + 2).map((r, k) => show(r, Math.max(0, i - 1) + k)),
  };
}
