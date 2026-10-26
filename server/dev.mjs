// Le serveur des salons en local, sans Cloudflare : les mêmes règles (src/salon.js), branchées sur un serveur
// WebSocket Node. Pour jouer à plusieurs sur sa machine, ou si `wrangler dev` ne démarre pas (sous Windows, il lui faut
// les bibliothèques Visual C++ de Microsoft).
//   node server/dev.mjs [port]      (8787 par défaut, comme wrangler dev)

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { newRoom, handle, leave } from './src/salon.js';
import { boardName, newBoard, submit, view } from './src/classement.js';

const port = Number(process.argv[2]) || 8787;
const rooms = new Map(); // code → { room, players: Set }
const boards = new Map(); // piste.mode → classement (en mémoire : il repart de zéro à chaque lancement)

const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const c = url.pathname.match(/^\/classement\/([a-z]+)\/([a-z]+)$/);
  const reply = (status, o) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' });
    res.end(o === undefined ? '' : JSON.stringify(o));
  };
  if (c) {
    const name = boardName(c[1], c[2]);
    if (req.method === 'OPTIONS') return reply(204);
    if (!name) return reply(404, { error: 'piste ou mode inconnu' });
    const board = boards.get(name) || newBoard();
    if (req.method === 'GET') return reply(200, view(board, url.searchParams.get('id')));
    let text = '';
    req.on('data', (d) => { text += d; });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(text); } catch { return reply(400, { error: 'JSON' }); }
      const r = submit(board, msg, c[1], Date.now());
      if (!r.ok) return reply(400, { error: r.reason });
      boards.set(name, r.board);
      reply(200, { ...view(r.board, msg.id), improved: r.improved });
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Downhill : serveur des salons (local).\n');
});
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
