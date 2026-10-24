// Tests des règles d'un salon en ligne (server/src/salon.js), sans réseau : npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, handle, leave, hostOf, racing, MAX_PLAYERS, START_DELAY, REJOIN } from '../server/src/salon.js';

/** Un salon de test : des joueurs, et ce que chacun a reçu. */
function salon(map = 'foret', mode = 'normal') {
  const s = { room: newRoom(), players: [], inbox: new Map(), now: 1000 };
  s.say = (me, msg) => {
    const res = handle(s.room, s.players, me, msg, s.now);
    s.room = res.room;
    if (res.replaced) s.players = s.players.filter((p) => p !== res.replaced);
    for (const { to, msg: m } of res.out) {
      for (const p of to === 'me' ? [me] : s.players) {
        if (!p.id || (to === 'others' && p === me)) continue;
        if (!s.inbox.has(p)) s.inbox.set(p, []);
        s.inbox.get(p).push(m);
      }
    }
    return res;
  };
  s.join = (id, name = id, extra = {}) => {
    const me = { id: null };
    s.players.push(me);
    s.say(me, { t: 'hello', id, name, color: 1, map, mode, ...extra });
    s.now += 10;
    return me;
  };
  s.last = (p, t) => (s.inbox.get(p) || []).filter((m) => m.t === t).at(-1);
  return s;
}

test('salon : le premier arrivé est l\'hôte et fixe la piste ; les suivants le rejoignent', () => {
  const s = salon('avalanche', 'ultra');
  const a = s.join('aaaaaa', 'Alice'), b = s.join('bbbbbb', 'Bob', { map: 'alpes' });
  assert.equal(hostOf(s.players), 'aaaaaa');
  assert.equal(s.room.map, 'avalanche');
  assert.equal(s.room.mode, 'ultra');
  const view = s.last(b, 'room').room;
  assert.deepEqual(view.players.map((p) => p.name), ['Alice', 'Bob']);
  assert.equal(view.host, 'aaaaaa');
  assert.ok(s.last(a, 'welcome') && s.last(b, 'welcome'));
});

test('salon : seul l\'hôte change la piste et lance la course, avec un départ commun dans le futur', () => {
  const s = salon();
  const a = s.join('aaaaaa'), b = s.join('bbbbbb');
  s.say(b, { t: 'config', map: 'alpes' });
  assert.equal(s.room.map, 'foret');
  s.say(a, { t: 'config', map: 'alpes', mode: 'ultra' });
  assert.equal(s.room.map, 'alpes');
  s.say(b, { t: 'start' });
  assert.equal(s.room.race, null);
  s.say(a, { t: 'start' });
  const r = s.room.race;
  assert.equal(r.at, s.now + START_DELAY);
  assert.deepEqual(r.grid, ['aaaaaa', 'bbbbbb']);
  assert.equal(r.map, 'alpes');
  // Pendant la course, ni nouvelle piste ni nouveau départ.
  s.say(a, { t: 'config', map: 'foret' });
  assert.equal(s.room.map, 'alpes');
  s.say(a, { t: 'start' });
  assert.equal(s.room.race.id, r.id);
});

test('salon : les temps d\'arrivée, et la course finie quand tous les partants ont fini ou abandonné', () => {
  const s = salon();
  const a = s.join('aaaaaa'), b = s.join('bbbbbb');
  s.say(a, { t: 'start' });
  const id = s.room.race.id;
  assert.ok(racing(s.room, s.players, s.now));
  s.say(a, { t: 'finish', race: id, time: 71.5 });
  s.say(a, { t: 'finish', race: id, time: 60 }); // un seul temps par course
  s.say(b, { t: 'finish', race: id + 1, time: 50 }); // pas une autre course
  assert.deepEqual(s.room.results, { aaaaaa: 71.5 });
  assert.ok(racing(s.room, s.players, s.now));
  s.say(b, { t: 'abandon' });
  assert.ok(!racing(s.room, s.players, s.now));
  s.say(a, { t: 'start' });
  assert.equal(s.room.race.id, id + 1);
  assert.deepEqual(s.room.results, {});
});

test('salon : la course ne reste pas bloquée par un partant parti', () => {
  const s = salon();
  const a = s.join('aaaaaa'), b = s.join('bbbbbb');
  s.say(a, { t: 'start' });
  s.say(a, { t: 'finish', race: s.room.race.id, time: 70 });
  s.players = s.players.filter((p) => p !== b);
  assert.ok(!racing(s.room, s.players, s.now));
});

test('salon : les positions passent aux autres, pas à soi ; une pose malformée est ignorée', () => {
  const s = salon();
  const a = s.join('aaaaaa'), b = s.join('bbbbbb');
  s.say(a, { t: 'pose', at: 5, rt: 1.5, p: [1, 2, 3] });
  assert.deepEqual(s.last(b, 'pose'), { t: 'pose', id: 'aaaaaa', at: 5, rt: 1.5, p: [1, 2, 3] });
  assert.equal(s.last(a, 'pose'), undefined);
  s.say(a, { t: 'pose', p: ['x'] });
  s.say(a, { t: 'pose', p: new Array(100).fill(0) });
  assert.equal(s.inbox.get(b).filter((m) => m.t === 'pose').length, 1);
});

test('salon : le même joueur qui revient (page rechargée) remplace son ancienne connexion et garde sa place', () => {
  const s = salon();
  const a = s.join('aaaaaa'), b = s.join('bbbbbb');
  const a2 = s.join('aaaaaa', 'Alice');
  assert.equal(s.players.length, 2);
  assert.equal(hostOf(s.players), 'aaaaaa');
  assert.deepEqual(s.last(b, 'room').room.players.map((p) => p.id), ['aaaaaa', 'bbbbbb']);
  assert.ok(a2.joined < b.joined);
  assert.equal(a.id, null);
});

test("salon : l'hôte qui recharge sa page (changement de piste) reste l'hôte, s'il revient vite", () => {
  const s = salon();
  const a = s.join('aaaaaa'), b = s.join('bbbbbb');
  const gone = (p) => { s.players = s.players.filter((x) => x !== p); s.room = leave(s.room, s.players, p, s.now).room; };
  gone(a);
  assert.equal(hostOf(s.players), 'bbbbbb'); // (le temps qu'il revienne)
  s.now += 5000;
  s.join('aaaaaa');
  assert.equal(hostOf(s.players), 'aaaaaa');
  // Parti trop longtemps : il revient comme un nouveau.
  gone(s.players.find((p) => p.id === 'aaaaaa'));
  s.now += REJOIN + 1;
  s.join('aaaaaa');
  assert.equal(hostOf(s.players), 'bbbbbb');
  void b;
});

test('salon : plein au-delà de MAX_PLAYERS ; noms nettoyés', () => {
  const s = salon();
  for (let i = 0; i < MAX_PLAYERS; i++) s.join(`joueur${i}`);
  const me = { id: null };
  s.players.push(me);
  const res = s.say(me, { t: 'hello', id: 'deborde', name: 'X' });
  assert.equal(res.close, 'full');
  const t = salon();
  const p = t.join('cccccc', '  <b>Très long nom de pilote vraiment</b>  ');
  assert.ok(!/[<>]/.test(p.name));
  assert.ok(p.name.length <= 20);
  assert.equal(t.join('dddddd', '   ').name, 'Pilote');
});
