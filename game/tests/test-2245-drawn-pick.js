'use strict';
/*
  test-2245-drawn-pick.js

  #2245: mining with the pickaxe already drawn skipped the animation and still
  gave ore. Skyrim refuses an idle like IdlePickaxeEnter while a weapon is
  out, and unequipping the drawn pick leaves fists raised, which is still
  drawn. The swing script (built by swingScript in game/gamemode.js and run on
  the player's own machine) now sheathes a drawn weapon, waits
  SWING_SHEATHE_MS, and only then unequips the pick and plays the idle, and
  not at all if a newer message (an end) came in meanwhile.

  THE FAKE GAME. The real script string is built and run as the client runs
  it, against a pretend Skyrim Platform that records every call, with
  Utility.wait as a promise this test resolves by hand. Each case is a fresh
  ctx.state, the way a fresh client starts.
*/
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function done() { console.log(''); console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

const a = src.indexOf('function swingScript() {');
const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
const consts = {};
['SWING_SHEATHE_MS'].forEach(function (k) {
  const m = new RegExp('const ' + k + ' = (\\d+);').exec(src);
  consts[k] = m ? Number(m[1]) : undefined;
});
yes('S0 swingScript and SWING_SHEATHE_MS are in the gamemode', a >= 0 && b > a && consts.SWING_SHEATHE_MS > 0);
if (!(a >= 0 && b > a)) { done(); }
const script = new Function('SWING_SHEATHE_MS', src.slice(a, b + 2) + '\nreturn swingScript();')(consts.SWING_SHEATHE_MS || 1000);
const run = new Function('ctx', script);

const PICK = 0xe3c16;
function game(opts) {
  const calls = [];
  const waits = [];
  const player = { drawn: !!opts.drawn, worn: !!opts.worn };
  const pc = {
    equipItem: function (f) { calls.push('equip ' + f.id.toString(16)); player.worn = true; },
    unequipItem: function (f) { calls.push('unequip ' + f.id.toString(16)); player.worn = false; }
  };
  const actor = {
    isWeaponDrawn: function () { return player.drawn; },
    sheatheWeapon: function () { calls.push('sheathe'); player.drawn = false; },
    isEquipped: function () { return player.worn; }
  };
  const sp = {
    Game: { getPlayer: function () { return pc; }, getFormEx: function (id) { return { id: id }; } },
    Form: { from: function (f) { return f; } },
    Actor: { from: function () { return actor; } },
    Debug: { sendAnimationEvent: function (who, ev) { calls.push('anim ' + ev); } },
    Utility: { wait: function (s) {
      calls.push('wait ' + s);
      let res; const p = new Promise(function (r) { res = r; });
      waits.push(res); return p;
    } }
  };
  const state = {};
  return { calls: calls, waits: waits, player: player,
    frame: function (value) { run({ value: value, state: state, sp: sp }); },
    flush: async function () { while (waits.length) { waits.shift()(); await new Promise(function (r) { setImmediate(r); }); } } };
}
const START = function (at) { return { at: at, anim: 'IdlePickaxeEnter', stop: 'IdleChairExitStart', free: 'IdleForceDefaultState', hold: true, tool: PICK }; };
const END = function (at) { return { at: at, end: true, stop: 'IdleChairExitStart', free: 'IdleForceDefaultState', tool: PICK }; };

(async function () {
  // D: the done-when. Pick drawn: sheathe, wait, then unequip and the idle.
  {
    const g = game({ drawn: true, worn: true });
    g.frame(START(1));
    yes('D1 a drawn weapon is sheathed first, and the idle waits: ' + g.calls.join(', '),
        g.calls[0] === 'sheathe' && g.calls[1] === 'wait ' + (consts.SWING_SHEATHE_MS / 1000) && g.calls.indexOf('anim IdlePickaxeEnter') < 0);
    g.frame(START(1));
    yes('D2 the next frame with the same message does nothing', g.calls.length === 2);
    await g.flush();
    yes('D3 after the sheathe the pick comes off and the idle plays: ' + g.calls.join(', '),
        g.calls.slice(2).join(',') === 'unequip e3c16,anim IdlePickaxeEnter');
    g.frame(END(2));
    yes('D4 the end puts the pick back, as #611 does', g.calls.indexOf('equip e3c16') > 0 && g.calls.indexOf('anim IdleChairExitStart') > 0);
  }
  // U: not drawn: exactly the old order, no sheathe, no wait.
  {
    const g = game({ drawn: false, worn: true });
    g.frame(START(1));
    yes('U1 with nothing drawn the idle plays at once, as before: ' + g.calls.join(', '),
        g.calls.join(',') === 'unequip e3c16,anim IdlePickaxeEnter');
  }
  {
    const g = game({ drawn: false, worn: false });
    g.frame(START(1));
    yes('U2 a pick only in the pack is not touched', g.calls.join(',') === 'anim IdlePickaxeEnter');
  }
  // E: the spell ends while the sheathe is still going: the idle never starts.
  {
    const g = game({ drawn: true, worn: true });
    g.frame(START(1));
    g.frame(END(2));
    await g.flush();
    yes('E1 an end inside the sheathe means no idle at all: ' + g.calls.join(', '), g.calls.indexOf('anim IdlePickaxeEnter') < 0);
    yes('E2 and the end still sends its exit', g.calls.indexOf('anim IdleChairExitStart') > 0);
  }
  // T: a client that cannot answer isWeaponDrawn behaves as before.
  {
    const g = game({ drawn: false, worn: true });
    const s2 = script;
    yes('T1 the drawn check is guarded, so a throw falls back to the old start', /catch \(e\) \{ drawn = false; \}/.test(s2));
  }
  // M: the mining start still holds the swing with the owned pick.
  yes('M1 mining still holds the swing with its pickaxe',
      /swing\(actorId, SWING_MINE, function \(\) \{ lands\(\); \}, \{ hold: true, tool: pick \}\)/.test(src));
  done();
})();
