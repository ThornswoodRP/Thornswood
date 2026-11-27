// test-6071-work-steps-say-who.js
//
//     node tests/test-6071-work-steps-say-who.js
//
// #6071: creditWork in the class and profession gates swallowed a throw from
// the party bonus (soc.workBonus) in an empty catch, so that piece of work
// paid no bonus with nothing in the log. The tiredness step (needs.worked)
// lost its catch in #4955. Now each step's throw goes up to the event's
// guard, which logs its message, and the message names the person and the
// work, with the original stack in it.
//
// This runs the REAL creditWork out of game/gamemode.js with a needs block
// and a social block that throw on request. Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8')).split(String.fromCharCode(13)).join('');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
const i = src.indexOf('function creditWork(actorId, key, n) {');
const k = src.indexOf('const PARTY_BANK = {};', i);
const GATE = i >= 0 && k >= 0 ? src.slice(i, k + 'const PARTY_BANK = {};'.length) : null;
yes('creditWork is in gamemode.js', !!GATE);
yes('no empty catch is left in creditWork', !!GATE && !/catch\s*\(\s*\w+\s*\)\s*\{\s*\}/.test(GATE));
if (!GATE) { done(); return; }

const ME = 0xff000001;

function rig(opts) {
  const credited = [];
  const g = { console: { log: function () { } } };
  vm.createContext(g);
  g.globalThis = g;
  g.log = function () { };
  g.notify = function () { };
  g.say = function () { };
  g.__thornswoodNeeds = {
    worked: function () { if (opts.tiredThrows) { throw new Error('needs broke'); } return null; }
  };
  g.__thornswoodSocial = {
    workBonus: function () { if (opts.bonusThrows) { throw new Error('social broke'); } return opts.bonus || 1; }
  };
  g.__thornswoodCharacter = {
    credit: function (id, key) { credited.push(key); return null; }
  };
  vm.runInContext(GATE + '\nconst MASTER_BANK = {};\nglobalThis.__creditWork = creditWork;', g, { filename: 'gamemode.js (gates)' });
  return { work: g.__creditWork, credited: credited };
}

function thrown(r, key) {
  try { r.work(ME, key); return null; } catch (e) { return e; }
}

{
  const r = rig({ bonusThrows: true });
  const e = thrown(r, 'mine');
  yes('a party bonus that throws is not swallowed', !!e);
  const m = e ? String(e.message) : '';
  yes('its message names the party bonus, the person and the work (' + m.split('\n')[0] + ')',
      m.indexOf('party bonus') >= 0 && m.indexOf('ff000001') >= 0 && m.indexOf('mine') >= 0);
  yes('its message keeps what threw', m.indexOf('social broke') >= 0);
}
{
  const r = rig({ tiredThrows: true });
  const e = thrown(r, 'chop');
  const m = e ? String(e.message) : '';
  yes('a tiredness step that throws names the tiredness, the person and the work (' + m.split('\n')[0] + ')',
      !!e && m.indexOf('tiredness') >= 0 && m.indexOf('ff000001') >= 0 && m.indexOf('chop') >= 0 && m.indexOf('needs broke') >= 0);
}
{
  const r = rig({ bonus: 2 });
  const e = thrown(r, 'mine');
  yes('with the party together, one piece of work is paid two pieces', !e && r.credited.length === 2);
}
{
  const r = rig({});
  const e = thrown(r, 'mine');
  yes('alone, one piece of work is paid one piece', !e && r.credited.length === 1);
}
done();
