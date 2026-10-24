// Le serveur des salons, sur Cloudflare : un Worker qui envoie chaque connexion à son salon, et un Durable Object par
// salon (un petit programme qui garde l'état d'un salon et ses connexions, près des joueurs). Les règles sont dans
// salon.js.
//
//   wss://<serveur>/salon/<CODE>   rejoindre un salon (le crée s'il n'existe pas)
//
// Les connexions « hibernent » quand personne ne parle : le salon peut s'endormir sans les couper (et sans compter du
// temps de calcul). L'état du salon est donc rangé dans son stockage, et chaque connexion porte sa fiche de joueur.

import { DurableObject } from 'cloudflare:workers';
import { newRoom, handle, leave } from './salon.js';

const CODE = /^[A-Z0-9]{4,8}$/;
/** Plus gros message accepté (une pose fait environ 200 octets). */
const MSG_MAX = 2048;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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
