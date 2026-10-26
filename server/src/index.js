// Le serveur des salons, sur Cloudflare : un Worker qui envoie chaque connexion à son salon, et un Durable Object par
// salon (un petit programme qui garde l'état d'un salon et ses connexions, près des joueurs). Les règles sont dans
// salon.js. Le classement mondial a aussi son Durable Object, un par piste et par mode (règles dans classement.js).
//
//   wss://<serveur>/salon/<CODE>                           rejoindre un salon (le crée s'il n'existe pas)
//   GET  https://<serveur>/classement/<piste>/<mode>?id=…  le classement (et la place du pilote id)
//   POST https://<serveur>/classement/<piste>/<mode>       envoyer un temps : {id, name, color, time}
//
// Les connexions « hibernent » quand personne ne parle : le salon peut s'endormir sans les couper (et sans compter du
// temps de calcul). L'état du salon est donc rangé dans son stockage, et chaque connexion porte sa fiche de joueur.

import { DurableObject } from 'cloudflare:workers';
import { newRoom, handle, leave } from './salon.js';
import { boardName, newBoard, submit, view } from './classement.js';

const CODE = /^[A-Z0-9]{4,8}$/;
/** Plus gros message accepté (une pose fait environ 200 octets). */
const MSG_MAX = 2048;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const c = url.pathname.match(/^\/classement\/([a-z]+)\/([a-z]+)$/);
    if (c) {
      // (le jeu est servi ailleurs, sur GitHub Pages : il faut l'autoriser à lire les réponses)
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-headers': 'content-type' } });
      const name = boardName(c[1], c[2]);
      if (!name) return json({ error: 'piste ou mode inconnu' }, 404);
      if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'GET ou POST' }, 405);
      return env.CLASSEMENT.get(env.CLASSEMENT.idFromName(name)).fetch(req);
    }
    const m = url.pathname.match(/^\/salon\/([^/]+)$/);
    if (!m) return new Response('Downhill : serveur des salons.\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('Code de salon invalide', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Il faut une connexion WebSocket', { status: 426 });
    return env.SALON.get(env.SALON.idFromName(code)).fetch(req);
  },
};

export class Salon extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    ctx.blockConcurrencyWhile(async () => { this.room = (await ctx.storage.get('room')) || newRoom(); });
    // (les pings ne réveillent pas le salon : Cloudflare y répond seul)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"keepalive"}', '{"t":"keepalive"}'));
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Les joueurs : la fiche de chaque connexion ouverte. */
  players() {
    return this.ctx.getWebSockets().map((ws) => {
      const p = ws.deserializeAttachment() || { id: null };
      p.ws = ws;
      return p;
    });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MSG_MAX) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const players = this.players();
    const me = players.find((p) => p.ws === ws);
    const before = me.id;
    const res = handle(this.room, players, me, msg, Date.now());
    if (me.id !== before || msg.t === 'profile') ws.serializeAttachment(strip(me));
    if (res.replaced) {
      // La même personne avec une nouvelle connexion : l'ancienne se ferme.
      res.replaced.ws.serializeAttachment({ id: null });
      try { res.replaced.ws.close(4000, 'remplacé'); } catch { /* déjà fermée */ }
    }
    await this.apply(res, players, me);
    if (res.close) try { ws.close(4001, res.close); } catch { /* déjà fermée */ }
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const all = this.players(), me = all.find((p) => p.ws === ws);
    const players = all.filter((p) => p.ws !== ws && p.id);
    await this.apply(leave(this.room, players, me, Date.now()), players, null);
  }

  async apply({ room, out }, players, me) {
    if (room !== this.room) { this.room = room; await this.ctx.storage.put('room', room); }
    for (const { to, msg } of out) {
      const text = JSON.stringify(msg);
      for (const p of to === 'me' ? [me] : players) {
        if (!p || !p.id || (to === 'others' && p === me)) continue;
        try { p.ws.send(text); } catch { /* connexion en train de se fermer */ }
      }
    }
  }
}

const strip = ({ ws, ...p }) => p;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
/** Plus gros envoi de temps accepté. */
const POST_MAX = 512;
/** Un envoi au plus toutes les quelques secondes par adresse (un temps, c'est une manche finie). */
const POST_EVERY = 3000;

/** Le classement d'une piste dans un mode : le meilleur temps de chaque pilote, rangé dans le stockage. */
export class Classement extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.board = null;
    this.lastPost = new Map();
    ctx.blockConcurrencyWhile(async () => { this.board = (await ctx.storage.get('board')) || newBoard(); });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const map = url.pathname.split('/')[2];
    if (req.method === 'GET') return json(view(this.board, url.searchParams.get('id')));
    const ip = req.headers.get('cf-connecting-ip') || '?', now = Date.now();
    if (now - (this.lastPost.get(ip) || 0) < POST_EVERY) return json({ error: 'trop vite' }, 429);
    this.lastPost.set(ip, now);
    if (this.lastPost.size > 5000) this.lastPost.clear();
    const text = await req.text();
    if (text.length > POST_MAX) return json({ error: 'trop long' }, 413);
    let msg;
    try { msg = JSON.parse(text); } catch { return json({ error: 'JSON' }, 400); }
    const res = submit(this.board, msg, map, now);
    if (!res.ok) return json({ error: res.reason }, 400);
    if (res.board !== this.board) { this.board = res.board; await this.ctx.storage.put('board', res.board); }
    return json({ ...view(this.board, msg.id), improved: res.improved });
  }
}
