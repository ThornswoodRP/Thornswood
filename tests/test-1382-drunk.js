// test-1382-drunk.js
//
//     node tests/test-1382-drunk.js
//
// #1382, docs/systems/drink.md: "Drunk, from the third ale until you sleep or
// the 45 minutes pass: the client draws a sway and a soft edge." Patrick,
// 12 Oct 2026, decision 3: a small drunk screen effect of our own in the
// content plugin.
//
// Root cause: nothing kept whether somebody was drunk, nothing told the
// client, and no record drew it. The server keeps drunk on the needs record
// (NEEDS.ale.drunkFrom), the needs HUD script hands it to the front plugin's
// globalThis.thornswoodLook, and the front plugin applies the content
// plugin's ThornswoodDrunkImod. Since #3153 the same hook carries high,
// hangover and withdrawal (Patrick, 22 Oct 2026: "I also want visual
// affects"), each with a record of its own.
//
// Drives the real needs block and the real HUD script, and reads the
// committed plugin and front plugin. Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const front = fs.readFileSync(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const A = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const B = '// ==== end thornswood needs ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;

function rig() {
  const store = {};
  const online = [];
  const clock = { now: 1000000000000 };
  const g = {};
  const Fake = {
    makeProperty: function () { },
    getDescFromId: function () { return ''; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'worldOrCellDesc') { return 'cell:X.esm'; }
      return store[id];
    },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const api = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval', 'guard', 'notify', 'say',
    'var FOODS = { items: { "34c5e:Skyrim.esm": { k: "ale" } } }; function idOf(d) { return parseInt(d, 16); }\n' +
    block + '\nreturn globalThis.__thornswoodNeeds;')(
    g, Fake, { now: function () { return clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; }, function () { }, function () { });
  g.__thornswoodHurt = { exposed: function () { return false; }, careChanged: function () { } };
  api.clock = clock;
  api.online = online;
  api.store = store;
  return api;
}

const MIN = 60000;
const ME = 0xff000001;
const ALE = 0x34c5e;
let r = null;
try { r = block ? rig() : null; } catch (e) { console.log('  (' + e.message + ')'); }
yes('the needs block runs', !!r);

if (r) {
  yes('drunk is from the third ale', r.NEEDS.ale.drunkFrom === 3);
  r.online.push(ME); r.store[ME] = r.fresh(); r.settle(ME);
  r.consumed(ME, ALE); r.consumed(ME, ALE);
  yes('two ales are not drunk', r.store[ME].drunk === false);
  r.consumed(ME, ALE);
  yes('the third is', r.store[ME].drunk === true);
  yes('and a read keeps it', r.read(ME).drunk === true);
  r.clock.now += 30 * MIN; r.settle(ME);
  yes('still drunk 30 minutes on', r.store[ME].drunk === true);
  r.clock.now += 16 * MIN; r.settle(ME);
  yes('and not once the 45 minutes pass', r.store[ME].drunk === false);

  // A night in a bed ends it: three ales, lie down, log out, come back after a night.
  const r2 = rig();
  r2.online.push(ME); r2.store[ME] = r2.fresh(); r2.settle(ME);
  r2.consumed(ME, ALE); r2.consumed(ME, ALE); r2.consumed(ME, ALE);
  const n = r2.read(ME); n.resting = 'bed'; r2.store[ME] = n;
  r2.online.length = 0; r2.tick(); r2.clock.now += 30 * MIN; r2.online.push(ME); r2.settle(ME);
  yes('a night in a bed, back inside the 45 minutes: not drunk, and the count starts over',
    r2.store[ME].drunk === false && r2.store[ME].ale === 0);
}

// The HUD script hands the look to the front plugin, once per change (#3153).
function lift(name) {
  const at = src.indexOf('function ' + name + '()', a);
  if (at < 0) { return null; }
  const end = src.indexOf('\n  }', at);
  return end > 0 ? src.slice(at, end + 4) : null;
}
const hud = lift('hudScript');
yes('the needs HUD script is in the needs block', !!hud && src.indexOf('function hudScript()', a) < b);
if (r) {
  const r3 = rig();
  r3.online.push(ME); r3.store[ME] = r3.fresh(); r3.settle(ME);
  r3.consumed(ME, ALE); r3.consumed(ME, ALE);
  yes('two ales: no look on the record', r3.store[ME].look === '');
  r3.consumed(ME, ALE);
  yes('the third: the record says drunk for the HUD', r3.store[ME].look === 'drunk');
}
if (hud) {
  const made = new Function(hud + '\nreturn hudScript();')();
  const told = [];
  const state = {};
  const ctx = function (v) {
    return { value: Object.assign({ food: 60, drink: 60, rest: 60, temp: 50 }, v), state: state,
             sp: { browser: { executeJavaScript: function () { } }, Debug: { notification: function () { } } } };
  };
  delete globalThis.thornswoodLook;
  new Function('ctx', made)(ctx({ look: 'drunk' }));
  yes('with no hook yet, nothing is marked as handed over', state.thornswoodLook === undefined);
  globalThis.thornswoodLook = function (look) { told.push(look); };
  new Function('ctx', made)(ctx({ look: 'drunk' }));
  new Function('ctx', made)(ctx({ look: 'drunk' }));
  yes('once the hook is there it is told drunk, once', told.length === 1 && told[0] === 'drunk');
  new Function('ctx', made)(ctx({ look: 'hangover' }));
  yes('told when it turns to a hangover', told.length === 2 && told[1] === 'hangover');
  new Function('ctx', made)(ctx({ look: '' }));
  yes('and told when it ends', told.length === 3 && told[2] === '');
  delete globalThis.thornswoodLook;
}

// The front plugin applies the content plugin's own records, one per look.
const looks = /const LOOKS = (\{[^}]*\});/.exec(front);
let LOOKS = null;
try { LOOKS = looks ? new Function('return ' + looks[1])() : null; } catch (e) { LOOKS = null; }
yes('the front plugin defines the hook', front.indexOf('globalThis.thornswoodLook = function') !== -1);
yes('and names a record for drunk, high, hangover and withdrawal',
  !!LOOKS && ['drunk', 'high', 'hangover', 'withdrawal'].every(function (k) { return typeof LOOKS[k] === 'number'; }));
yes('and draws with applyCrossFade and takes it off with removeCrossFade',
  front.indexOf('mod.applyCrossFade(LOOK_FADE)') !== -1 && front.indexOf('ImageSpaceModifier.removeCrossFade(LOOK_FADE)') !== -1);
const esp = fs.readFileSync(path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp'));
const imads = {};
{
  let p = 24 + esp.readUInt32LE(4);
  while (p + 24 <= esp.length) {
    const size = esp.readUInt32LE(p + 4);
    const isGroup = esp.toString('latin1', p, p + 4) === 'GRUP';
    if (isGroup && esp.toString('latin1', p + 8, p + 12) === 'IMAD') {
      let q = p + 24;
      while (q < p + size) {
        const rs = esp.readUInt32LE(q + 4);
        imads[esp.readUInt32LE(q + 12)] = esp.slice(q + 24, q + 24 + rs);
        q += 24 + rs;
      }
    }
    p += isGroup ? size : 24 + size;
  }
}
const names = { drunk: 'ThornswoodDrunkImod', high: 'ThornswoodHighImod', hangover: 'ThornswoodHangoverImod',
                withdrawal: 'ThornswoodWithdrawalImod' };
for (const k in names) {
  const imad = LOOKS ? imads[(5 << 24) | LOOKS[k]] : null;
  yes('the ' + k + ' record it names is the plugin\'s ' + names[k], !!imad && imad.indexOf(names[k]) === 6);
  if (imad) {
    const at = imad.indexOf('DNAM');
    yes('and it is not animatable, so it holds while applied', at > 0 && imad.readUInt32LE(at + 6) === 0);
  }
}
const drunkImad = LOOKS ? imads[(5 << 24) | LOOKS.drunk] : null;
if (drunkImad) {
  const tnam = drunkImad.indexOf('TNAM');
  yes('and the drunk one tints nothing', tnam > 0 && drunkImad.readFloatLE(tnam + 6 + 16) === 0 && drunkImad.readFloatLE(tnam + 6 + 36) === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
