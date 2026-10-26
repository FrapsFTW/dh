// Le classement mondial : le meilleur temps de chaque pilote, par piste et par mode, gardé par le serveur des salons
// (server/src/classement.js). Seules les manches en contre la montre comptent, sans pilote automatique ni réglages
// de la physique retouchés (main.js en décide).

/** L'adresse du classement, à côté de celle des salons (wss://… → https://…). */
export const boardUrl = (server, map, mode) => `${server.replace(/^ws/, 'http')}/classement/${map}/${mode}`;

/** Qui on est pour le classement : un identifiant tiré une fois pour toutes par ce navigateur (jamais montré aux autres). */
export function pilotId() {
  try {
    let id = localStorage.getItem('downhill.pilote');
    if (!/^[a-z0-9]{8,16}$/.test(id || '')) {
      id = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 14).padEnd(10, '0');
      localStorage.setItem('downhill.pilote', id);
    }
    return id;
  } catch { return null; }
}

async function call(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: ctl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

/** Le classement : { total, top: [{rank, name, color, time, me}], me, around }. */
export const fetchBoard = (server, map, mode, id) => call(`${boardUrl(server, map, mode)}${id ? `?id=${id}` : ''}`);

/** Envoie un temps (en text/plain : pas de requête préalable du navigateur), renvoie le classement à jour. */
export const sendTime = (server, map, mode, run) =>
  call(boardUrl(server, map, mode), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(run) });
