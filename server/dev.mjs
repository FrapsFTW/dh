// Le serveur des salons en local, sans Cloudflare : les mêmes règles (src/salon.js), branchées sur un serveur
// WebSocket Node. Pour jouer à plusieurs sur sa machine, ou si `wrangler dev` ne démarre pas (sous Windows, il lui faut
// les bibliothèques Visual C++ de Microsoft).
//   node server/dev.mjs [port]      (8787 par défaut, comme wrangler dev)

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { newRoom, handle, leave } from './src/salon.js';

const port = Number(process.argv[2]) || 8787;
const rooms = new Map(); // code → { room, players: Set }

const http = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Downhill : serveur des salons (local).\n'); });
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

http.on('upgrade', (req, socket, head) => {
  const m = req.url.match(/^\/salon\/([A-Za-z0-9]{4,8})$/);
  if (!m) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => join(ws, m[1].toUpperCase()));
});

function join(ws, code) {
  if (!rooms.has(code)) rooms.set(code, { room: newRoom(), players: new Set() });
  const salon = rooms.get(code);
  const me = { id: null, ws };
  salon.players.add(me);
  const send = ({ out }, players) => {
    for (const { to, msg } of out) {
      const text = JSON.stringify(msg);
      for (const p of to === 'me' ? [me] : players) if (p.id && !(to === 'others' && p === me)) p.ws.send(text);
    }
  };
  ws.on('message', (data, binary) => {
    if (binary) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.t === 'keepalive') return ws.send('{"t":"keepalive"}');
    const players = [...salon.players];
    const res = handle(salon.room, players, me, msg, Date.now());
    salon.room = res.room;
    if (res.replaced) { salon.players.delete(res.replaced); res.replaced.ws.close(4000, 'remplacé'); }
    send(res, players);
    if (res.close) ws.close(4001, res.close);
  });
  ws.on('close', () => {
    salon.players.delete(me);
    const players = [...salon.players].filter((p) => p.id);
    const res = leave(salon.room, players, me, Date.now());
    salon.room = res.room;
    send(res, players);
  });
}

http.listen(port, () => console.log(`Serveur des salons : ws://localhost:${port}/salon/<CODE>`));
