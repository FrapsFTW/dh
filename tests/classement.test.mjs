// Tests des règles du classement mondial (server/src/classement.js), sans réseau : npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardName, newBoard, submit, view, FLOOR, KEEP } from '../server/src/classement.js';

const run = (id, time, name = id) => ({ id, time, name, color: 2 });

test('un tableau par piste et par mode connus', () => {
  assert.equal(boardName('single', 'ultra'), 'single.ultra');
  assert.equal(boardName('lune', 'normal'), null);
  assert.equal(boardName('foret', 'facile'), null);
});

test('les meilleurs devant, un seul temps par pilote : son meilleur', () => {
  let b = newBoard();
  b = submit(b, run('aaaaaaaa', 80), 'foret', 1).board;
  b = submit(b, run('bbbbbbbb', 75), 'foret', 2).board;
  let r = submit(b, run('aaaaaaaa', 90), 'foret', 3);
  assert.equal(r.ok, true);
  assert.equal(r.improved, false);
  assert.equal(r.board.runs.length, 2);
  r = submit(r.board, run('aaaaaaaa', 70), 'foret', 4);
  assert.equal(r.improved, true);
  const v = view(r.board, 'aaaaaaaa');
  assert.deepEqual(v.top.map((x) => x.time), [70, 75]);
  assert.equal(v.total, 2);
  assert.equal(v.me.rank, 1);
  assert.equal(v.me.me, true);
});

test('à temps égal, le premier à l\'avoir fait passe devant', () => {
  let b = newBoard();
  b = submit(b, run('premier1', 70, 'Premier'), 'foret', 1).board;
  b = submit(b, run('second22', 70, 'Second'), 'foret', 2).board;
  assert.deepEqual(view(b, null).top.map((x) => x.name), ['Premier', 'Second']);
});

test('un temps plus lent garde le meilleur, mais retient le nouveau nom', () => {
  let b = submit(newBoard(), run('aaaaaaaa', 70, 'Avant'), 'foret', 1).board;
  b = submit(b, run('aaaaaaaa', 80, 'Après'), 'foret', 2).board;
  assert.deepEqual(view(b, 'aaaaaaaa').me, { rank: 1, name: 'Après', color: 2, time: 70, at: 1, me: true });
});

test('les temps impossibles et les identifiants douteux sont refusés', () => {
  const b = newBoard();
  assert.equal(submit(b, run('aaaaaaaa', FLOOR.single - 1), 'single', 1).reason, 'temps');
  assert.equal(submit(b, run('aaaaaaaa', NaN), 'single', 1).reason, 'temps');
  assert.equal(submit(b, run('aaaaaaaa', 99999), 'single', 1).reason, 'temps');
  assert.equal(submit(b, run('A', 60), 'single', 1).reason, 'pilote');
  assert.equal(submit(b, run('<script>', 60), 'single', 1).reason, 'pilote');
  assert.equal(submit(b, { id: 'aaaaaaaa', time: 60, name: '<b>x</b>', color: 99 }, 'single', 1).board.runs[0].name, 'bx/b');
});

test('on ne montre ni les identifiants des autres, ni plus que le haut du tableau, mais sa place et ses voisins', () => {
  let b = newBoard();
  for (let i = 0; i < 80; i++) b = submit(b, run(`pilote${String(i).padStart(2, '0')}`, 60 + i), 'foret', i).board;
  const v = view(b, 'pilote64');
  assert.equal(v.top.length, 50);
  assert.ok(v.top.every((x) => !('id' in x) && x.me === false));
  assert.equal(v.me.rank, 65);
  assert.deepEqual(v.around.map((x) => x.rank), [64, 65, 66]);
  assert.deepEqual(view(b, 'pilote00').around.map((x) => x.rank), [1, 2]);
  assert.equal(view(b, 'inconnu1').me, null);
});

test('le tableau garde les KEEP meilleurs', () => {
  let b = { runs: Array.from({ length: KEEP }, (_, i) => ({ id: `p${i}aaaaaaa`, name: 'x', color: 0, time: 60 + i, at: 0 })) };
  b = submit(b, run('rapide00', 50), 'foret', 1).board;
  assert.equal(b.runs.length, KEEP);
  assert.equal(b.runs[0].id, 'rapide00');
});
