'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const budget = require('../game/scene-reward-budget');
const DAY = 86400000, T = 2000000000000;
const clone = value => JSON.parse(JSON.stringify(value));
const good = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };
const refused = result => assert.equal(result.ok, false, JSON.stringify(result));
let cases = 0;
function test(name, run) { run(); cases++; }

test('reservation pays original terms exactly once after JSON recreation', () => {
  const a = good(budget.reserve(undefined, 'q-first', 40, T));
  assert.equal(a.token, 1);
  const state = clone(a.next), before = clone(state);
  assert.equal(good(budget.inspect(state, T)).availableGold, 110);
  const done = good(budget.complete(state, 'q-first', a.token, T + 1));
  assert.equal(done.gold, 40);
  assert.deepEqual(state, before);
  assert.equal(good(budget.inspect(done.next, T + 1)).paidGold, 40);
  refused(budget.complete(done.next, 'q-first', a.token, T + 2));
});
test('shared reservations prevent promising more than the allowance', () => {
  const a = good(budget.reserve(undefined, 'q-first', 100, T));
  refused(budget.reserve(a.next, 'q-second', 51, T));
  const b = good(budget.reserve(a.next, 'q-second', 50, T));
  const view = good(budget.inspect(b.next, T));
  assert.equal(view.reservedGold, 150); assert.equal(view.availableGold, 0);
  const done = good(budget.complete(b.next, 'q-second', b.token, T + DAY * 10));
  assert.equal(done.gold, 50);
  assert.equal(good(budget.inspect(done.next, T + DAY * 10)).reservedGold, 100);
  refused(budget.reserve(done.next, 'q-third', 10, T + DAY * 10));
});
test('half-open payout boundary and backward clock', () => {
  const a = good(budget.reserve(undefined, 'q-first', 150, T));
  const b = good(budget.complete(a.next, 'q-first', a.token, T));
  refused(budget.reserve(b.next, 'q-next', 10, T + DAY - 1));
  const c = good(budget.reserve(b.next, 'q-next', 150, T + DAY));
  assert.deepEqual(c.next.paid, []);
  refused(budget.inspect(c.next, T + DAY - 1));
  refused(budget.cancel(c.next, 'q-next', c.token, T));
});
test('stale completion or cancellation cannot consume a replacement reservation', () => {
  const a = good(budget.reserve(undefined, 'q-first', 10, T));
  const b = good(budget.cancel(a.next, 'q-first', a.token, T));
  const c = good(budget.reserve(b.next, 'q-first', 20, T));
  assert.ok(c.token > a.token);
  refused(budget.complete(c.next, 'q-first', a.token, T));
  refused(budget.cancel(c.next, 'q-first', a.token, T));
  assert.equal(good(budget.complete(c.next, 'q-first', c.token, T)).gold, 20);
});
test('open limit, duplicate ID and exhausted counter preserve existing reservations', () => {
  let state;
  for (const id of ['q-a', 'q-b', 'q-c']) state = good(budget.reserve(state, id, 10, T)).next;
  refused(budget.reserve(state, 'q-d', 10, T));
  refused(budget.reserve(state, 'q-a', 10, T));
  const exhausted = clone(state); exhausted.serial = Number.MAX_SAFE_INTEGER;
  const freed = good(budget.cancel(exhausted, 'q-c', exhausted.held['q-c'].token, T)).next;
  refused(budget.reserve(freed, 'q-d', 10, T));
  assert.equal(good(budget.complete(freed, 'q-a', freed.held['q-a'].token, T)).gold, 10);
});
test('invalid request data never coerces and state stays detached', () => {
  const state = good(budget.reserve(undefined, 'q-first', 20, T)).next, before = clone(state);
  let effects = 0;
  const hostile = {toString() { effects++; return 'q-next'; }, valueOf() { effects++; return 10; }};
  for (const id of ['', 'wolf', 'q-A', 'q-a\n', 'q-' + 'a'.repeat(47), hostile]) refused(budget.reserve(state, id, 10, T));
  for (const gold of [0, 9, 151, 10.5, NaN, Infinity, '10', hostile]) refused(budget.reserve(state, 'q-next', gold, T));
  for (const time of [0, -1, T - 1, T + 0.5, '2000000000000', NaN, Infinity, hostile]) refused(budget.inspect(state, time));
  assert.equal(effects, 0); assert.deepEqual(state, before);
  const done = good(budget.complete(state, 'q-first', state.held['q-first'].token, T));
  done.next.paid[0][1] = 150;
  assert.deepEqual(state, before);
});
test('saved corruption refuses before expiry can conceal it', () => {
  const base = good(budget.reserve(undefined, 'q-first', 100, T)).next;
  const corruptions = [
    null, [], {}, {...base, v: 2}, {...base, extra: 1}, {...base, clock: '2000000000000'},
    {...base, serial: 0}, {...base, serial: -1}, {...base, paid: [[T, 51]]},
    {...base, paid: [[T + 1, 10]]}, {...base, paid: [[T, 9]]},
    {...base, held: {'q-first': {gold: 100, at: T + 1, token: 1}}},
    {...base, held: {'q-first': {gold: 100, at: T, token: 1, extra: 1}}},
    {...base, held: {'q-first': {gold: 100, at: T, token: '1'}}},
    {...base, held: {wolf: {gold: 100, at: T, token: 1}}},
    {...base, serial: 2, held: {'q-a': {gold: 10, at: T, token: 1}, 'q-b': {gold: 10, at: T, token: 1}}},
    {...base, paid: [[T - 1, 10], [T - 2, 10]]},
    {...base, serial: 20, held: {}, paid: Array.from({length: 16}, () => [T, 10])},
    {...base, serial: 0, held: {}, paid: [[T, 10]]}
  ];
  for (const state of corruptions) {
    const before = clone(state);
    for (const time of [T, T + DAY * 2]) {
      refused(budget.inspect(state, time));
      refused(budget.reserve(state, 'q-next', 10, time));
      refused(budget.complete(state, 'q-first', 1, time));
      refused(budget.cancel(state, 'q-first', 1, time));
    }
    assert.deepEqual(state, before);
  }
});
test('inherited, accessor, symbol and sparse fields are not accounting evidence', () => {
  const base = good(budget.reserve(undefined, 'q-first', 10, T)).next;
  const values = [], field = {...base};
  let effects = 0;
  Object.defineProperty(field, 'clock', {enumerable: true, get() { effects++; return T; }});
  values.push(field, Object.create(base), {...base, [Symbol('unknown')]: true});
  const held = Object.create(base.held); values.push({...base, held});
  const row = {...base.held['q-first']};
  Object.defineProperty(row, 'gold', {enumerable: true, get() { effects++; return 10; }});
  values.push({...base, held: {'q-first': row}});
  const paid = Array(1); values.push({...base, paid});
  const pair = [T, 10];
  Object.defineProperty(pair, '1', {enumerable: true, get() { effects++; return 10; }});
  values.push({...base, serial: 2, paid: [pair]});
  const extra = [[T, 10]]; extra.note = 1; values.push({...base, serial: 2, paid: extra});
  for (const state of values) refused(budget.inspect(state, T));
  assert.equal(effects, 0);
  const ownNull = Object.assign(Object.create(null), base);
  assert.equal(good(budget.inspect(ownNull, T)).reservedGold, 10);
});
test('fifteen ten-gold payouts exhaust the window and expire together', () => {
  let state;
  for (let i = 0; i < 15; i++) {
    const held = good(budget.reserve(state, 'q-' + i, 10, T));
    state = good(budget.complete(held.next, 'q-' + i, held.token, T)).next;
  }
  assert.equal(state.paid.length, 15);
  refused(budget.reserve(state, 'q-next', 10, T + DAY - 1));
  const next = good(budget.reserve(state, 'q-next', 150, T + DAY));
  assert.equal(next.next.paid.length, 0); assert.equal(next.token, 16);
});
test('small operation sequences obey conservation through recreation', () => {
  let paths = 0;
  function visit(state, now, paid, depth) {
    const view = good(budget.inspect(state, now));
    const active = paid.filter(row => row[0] > now - DAY).reduce((sum, row) => sum + row[1], 0);
    assert.equal(view.paidGold, active);
    assert.ok(view.paidGold + view.reservedGold <= 150);
    if (!depth) { paths++; return; }
    for (const key of ['q-a', 'q-b']) {
      const proposed = budget.reserve(state, key, 50, now);
      if (proposed.ok) visit(clone(proposed.next), now, paid, depth - 1);
      const held = state && state.held[key];
      if (held) {
        const done = good(budget.complete(state, key, held.token, now));
        assert.equal(done.gold, held.gold);
        visit(clone(done.next), now, paid.concat([[now, done.gold]]), depth - 1);
        visit(clone(good(budget.cancel(state, key, held.token, now)).next), now, paid, depth - 1);
      }
    }
    visit(state && clone(state), now + DAY, paid, depth - 1);
  }
  visit(undefined, T, [], 5);
  assert.ok(paths > 100);
});
test('the runtime bundle exposes the reviewed accounting implementation', () => {
  const source=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')),vm=require('node:vm'),context={require,Buffer};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('// MERCHANT TRADING BUNDLE BEGIN'),source.indexOf('// MERCHANT TRADING BUNDLE END'))+
    '\nglobalThis.accounting=MERCHANT_TRADING.sceneBudget;',context);
  const actual=context.accounting.reserve(undefined,'q-budget-parity',40,T);
  assert.deepEqual(clone(actual),budget.reserve(undefined,'q-budget-parity',40,T));
  const done=context.accounting.complete(actual.next,'q-budget-parity',actual.token,T+1);
  assert.equal(done.ok,true);assert.equal(done.gold,40);assert.deepEqual(clone(done.next.paid),[[T+1,40]]);
});
console.log('PASS ' + cases + ' scene accounting groups, malformed-state matrix, exhaustive sequences and runtime parity');
