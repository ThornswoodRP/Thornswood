'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'gamemode.js'), 'utf8');
const block = src.slice(src.indexOf('/* BOOKS-START */'), src.indexOf('/* BOOKS-END */'));
const initStart = src.indexOf('(function () {', src.indexOf('/* BOOKS-END */'));
const initializer = src.slice(initStart, src.indexOf('})();', initStart) + 5);
let failures = 0;
function test(name, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-book-review-'));
  const file = path.join(dir, 'books.json');
  let failSave = false;
  const io = Object.create(fs);
  io.renameSync = (...args) => { if (failSave) throw new Error('rename denied'); return fs.renameSync(...args); };
  function make() {
    const ctx = { env: { fs: io, path, privDir: dir, atBox: () => 'whiterun',
      roles: () => ({ business: true, account: 'a' }), nameOf: () => 'Ada',
      find: () => ({ pid: 2, actorId: 2, name: 'Ben' }), offer: () => '', refresh: () => {} } };
    vm.createContext(ctx); vm.runInContext(block + '\nthis.api = thornswoodBooks(env);', ctx);
    return ctx.api;
  }
  const api = make();
  const cmd = line => api.command({ actorId: 1, profileId: 1, parts: line.split(/\s+/) });
  cmd('/book new business Ore');
  const id = api.books()[0].id;
  cmd('/book price ' + id + ' | Iron Ore | 10 | 20');
  cmd('/book submit ' + id);
  try {
    run({ dir, file, api, id, cmd, make, io, fail: () => { failSave = true; },
      resume: () => { failSave = false; }, saved: () => JSON.parse(fs.readFileSync(file, 'utf8')) });
    console.log('PASS ' + name);
  } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('blank price columns and zero preserve their positions', ({ api, id, cmd }) => {
  cmd('/book price ' + id + ' | Iron Ore | | 20');
  assert.strictEqual(api.books()[0].prices[0].buy, null);
  assert.strictEqual(api.books()[0].prices[0].sell, 20);
  cmd('/book price ' + id + ' | Iron Ore | 0 |');
  assert.strictEqual(api.books()[0].prices[0].buy, 0);
  assert.strictEqual(api.books()[0].prices[0].sell, null);
  cmd('/book price ' + id + ' | Iron Ore | | 0');
  assert.strictEqual(api.books()[0].prices[0].buy, null);
  assert.strictEqual(api.books()[0].prices[0].sell, 0);
  assert(!/^Set /.test(cmd('/book price ' + id + ' | Iron Ore | 8 | 9 | 10')));
  assert.strictEqual(api.books()[0].prices[0].sell, 0);
});
test('failed disband keeps live books and submitted prices', ({ api, id, cmd, fail, saved }) => {
  const before = JSON.stringify(saved());
  fail();
  let reply; try { reply = cmd('/book disband ' + id); } catch (e) { reply = e.message; }
  assert(!/^Disbanded /.test(reply));
  assert.strictEqual(api.books().length, 1);
  assert.strictEqual(api.guildPrice('whiterun', 'Iron Ore').buy, 10);
  assert.strictEqual(JSON.stringify(saved()), before);
});
test('failed price edit and failed membership acceptance roll back', ({ api, id, cmd, fail, resume }) => {
  fail();
  let reply; try { reply = cmd('/book price ' + id + ' | Iron Ore | 90 | 100'); } catch (e) { reply = e.message; }
  assert(!/^Set /.test(reply));
  assert.strictEqual(api.books()[0].prices[0].buy, 10);
  resume(); cmd('/book invite ' + id + ' Ben'); fail();
  let accepted; try { accepted = api.accept(2, 'Ben'); } catch (e) { accepted = { ok: false }; }
  assert.strictEqual(accepted.ok, false);
  assert.strictEqual(api.books()[0].members.length, 1);
  resume(); assert.strictEqual(api.accept(2, 'Ben').ok, true, 'the saved offer remains usable');
});
test('failed reload revokes a retained old API', ({ api, dir, file, id }) => {
  fs.writeFileSync(file, '{broken');
  const io = Object.create(fs);
  io.readFileSync = (f, ...args) => f === 'server-settings.json' ? JSON.stringify({ dataDir: path.join(dir, 'served'), privDir: dir }) : fs.readFileSync(f, ...args);
  const ctx = { __thornswoodBooks: api, require: name => name === 'fs' ? io : path,
    log: () => {}, clearInterval: () => {}, setInterval: () => { throw new Error('no timer'); } };
  vm.createContext(ctx); vm.runInContext(block + '\n' + initializer, ctx);
  assert.strictEqual(ctx.__thornswoodBooks, null);
  const reply = api.command({ actorId: 1, profileId: 1, parts: ['/book', 'rename', id, 'Changed'] });
  assert(!/^Renamed /.test(reply));
  assert.strictEqual(api.accept(2, 'Ben').ok, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{broken');
  assert.strictEqual(api.guildPrice('whiterun', 'Iron Ore').buy, null);
});
for (const [name, corrupt] of [
  ['duplicate permission roles', d => d.books[0].roles.push({ name: 'member', perms: ['Prices'] })],
  ['missing default role', d => { d.books[0].roles = []; }],
  ['orphan member role', d => { d.books[0].members[0].role = 'Absent'; }],
  ['missing owner membership', d => { d.books[0].members = []; }],
  ['phantom submitted book', d => { d.ledgers.whiterun.fake = { prices: [{ name: 'Iron Ore', buy: 999, sell: null }] }; }],
  ['wrong submission identity', d => { const id = d.books[0].id; d.ledgers.whiterun[id].book = 'other'; }],
  ['missing submission metadata', d => { const id = d.books[0].id; delete d.ledgers.whiterun[id].at; }],
  ['wrong submission kind', d => { const id = d.books[0].id; d.ledgers.whiterun[id].kind = 'faction'; }]
]) {
  test(name + ' refuses initialization', ({ file, saved, make }) => {
    const d = saved(); corrupt(d); fs.writeFileSync(file, JSON.stringify(d));
    assert.throws(make, /saved book/i);
  });
}
test('renamed books and edited prices retain valid earlier submissions', ({ id, cmd, make }) => {
  cmd('/book rename ' + id + ' Renamed');
  cmd('/book price ' + id + ' | Iron Ore | 90 | 100');
  assert.strictEqual(make().guildPrice('whiterun', 'Iron Ore').buy, 10);
});
process.exitCode = failures ? 1 : 0;
