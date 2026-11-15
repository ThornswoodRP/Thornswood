'use strict';
// #3196: after a reload of the gamemode in a running server, the engine calls
// globalThis.__thornswoodGamemodeLoaded with {reload, clientScriptsChanged}
// (fork, ts/gamemodeLoad.ts). The gamemode asks the people on to log in again
// only when a reload changed the scripts their games were sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'gamemode.js'), 'utf8');
const at = src.indexOf('A RELOAD THAT CHANGED WHAT THE GAMES RUN (#3196)');
assert.ok(at > 0, 'the hook is in gamemode.js');
const from = src.indexOf('g.__thornswoodGamemodeLoaded = function', at);
const to = src.indexOf('\n  };\n', from) + 5;
assert.ok(from > at && to > from, 'the hook is one function');
const hook = src.slice(from, to);

let failed = 0;
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
function run(online) {
  const said = [], logged = [];
  const box = { g: {}, mp: { get(id, key) { if (id === 0 && key === 'onlinePlayers') return online; throw new Error('no ' + key); } },
    log: (...a) => logged.push(a.join(' ')), broadcast: t => said.push(t) };
  vm.createContext(box);
  vm.runInContext(hook, box);
  return { hook: box.g.__thornswoodGamemodeLoaded, said, logged };
}

check('a reload that changed the scripts asks everybody on to log in again', () => {
  const r = run([0x14, 0x15]);
  r.hook({ reload: true, clientScriptsChanged: true });
  assert.equal(r.said.length, 1);
  assert.match(r.said[0], /Log out and back in/);
  assert.match(r.logged.join('\n'), /asked 2 people to log in again/);
});
for (const load of [{ reload: true, clientScriptsChanged: false }, { reload: false, clientScriptsChanged: false }, undefined]) {
  check('nothing is said for ' + JSON.stringify(load), () => {
    const r = run([0x14]);
    r.hook(load);
    assert.deepEqual(r.said, []);
    assert.deepEqual(r.logged, []);
  });
}
check('an unreadable list of who is on still says it, to whoever broadcast reaches', () => {
  const r = run(null);
  r.hook({ reload: true, clientScriptsChanged: true });
  assert.equal(r.said.length, 1);
  assert.match(r.logged.join('\n'), /asked 0 people/);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
