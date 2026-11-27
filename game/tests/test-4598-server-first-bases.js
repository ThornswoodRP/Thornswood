// test-4598-server-first-bases.js
//
// A press on a chopping block or an ore vein waits for the server (#4598).
//
// WHAT WAS WRONG. The client blocked a press by record type alone, so a
// chopping block (furniture that is no bench) and an ore vein (an activator
// with MineOreScript) started on the presser's own machine before the server
// answered. chopWood then undid a refused swing with swingEnd (#842), the
// band-aid this replaces. skymp#166 (on the engine pin) has the client take a
// list of bases from the server and block every reference of them.
//
// WHAT THIS RUNS, out of the built game/gamemode.js:
//   S  the serverFirstBases block: the packet it sends, to whom and when;
//   C  the real chopWood: a refused press undoes nothing, a refused fall of
//      the axe in a running session ends it, an allowed press still chops;
//   M  the real mineOre: a refused press on a vein sends nothing at all, and
//      the vein is on the list, so the client never ran its script.
//
//     node game/tests/test-4598-server-first-bases.js
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', 'gamemode.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function cut(from, end) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const firstBlock = cut('(function serverFirstBases() {', '\n})();\n');
const blocksLine = /^const CHOPPING_BLOCKS = \[[^\]]*\];$/m.exec(src);
const chopWoodSrc = cut('function chopWood(actorId, refrId, fromSwing) {', '\n}\n');
const mineOreSrc = cut('function mineOre(actorId, refrId, baseDesc) {', '\n}\n');

yes('S0 the gamemode sends the bases that wait for the server (serverFirstBases)', !!firstBlock);
yes('S0 CHOPPING_BLOCKS, chopWood and mineOre are in the gamemode', !!blocksLine && !!chopWoodSrc && !!mineOreSrc);

const BLOCKS = blocksLine ? new Function(blocksLine[0].replace(/^const CHOPPING_BLOCKS = /, 'return ').replace(/;$/, ''))() : [];
// Three veins, one of them in a plugin this load order does not have.
const ORES = { '1001:Skyrim.esm': { name: 'Iron Ore' }, '1002:Skyrim.esm': { name: 'Gold Ore' }, '9:Missing.esp': { name: 'Moon Ore' } };
function idOf(desc) {
  const m = /^([0-9a-f]+):(.+)$/i.exec(desc);
  if (!m) { return 0; }
  if (m[2] === 'Missing.esp') { return 0; }
  return parseInt(m[1], 16) + (m[2] === 'Dragonborn.esm' ? 0x04000000 : 0);
}

// ------------------------------------------------------------------ S
if (firstBlock && blocksLine) {
  const users = { 0xff000a01: 7, 0xff000a02: 8 };
  const guid = { 7: 'g-first', 8: 'g-second' };
  let online = [0xff000a01];
  const sent = [];
  const timers = [];
  const mp = {
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return online.slice(); } throw new Error(key); },
    getUserByActor: function (a) { return Object.prototype.hasOwnProperty.call(users, a) && online.indexOf(a) >= 0 ? users[a] : -1; },
    getUserGuid: function (u) { return guid[u]; },
    sendCustomPacket: function (u, text) { sent.push({ u: u, packet: JSON.parse(text) }); }
  };
  const G = {};
  const run = new Function('mp', 'idOf', 'CHOPPING_BLOCKS', 'ORES_BY_BASE', 'guard', 'log', 'globalThis', 'setInterval', 'clearInterval',
    firstBlock + '\nreturn globalThis.__thornswoodServerFirst;');
  const api = run(mp, idOf, BLOCKS, ORES, function (n, f) { return f; }, function () { }, G,
    function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; }, function () { });
  const want = BLOCKS.map(idOf).filter(Boolean).concat([0x1001, 0x1002]);
  yes('S1 the list is every chopping block and every vein that is loaded (' + (api && api.bases.length) + ')',
      !!api && api.bases.length === want.length && want.every(function (id) { return api.bases.indexOf(id) >= 0; }));
  yes('S1 and nothing from a plugin that is not loaded', !!api && api.bases.indexOf(0) < 0 && api.bases.indexOf(9) < 0);
  yes('S2 it is told on a timer, and nothing is sent at load', timers.length === 1 && sent.length === 0);
  timers[0].f();
  yes('S3 a connection is sent the packet the client reads (skymp#166)', sent.length === 1 && sent[0].u === 7 &&
      sent[0].packet.customPacketType === 'serverFirstBases' && Array.isArray(sent[0].packet.bases) &&
      sent[0].packet.bases.length === want.length);
  timers[0].f(); timers[0].f();
  yes('S4 once: the same connection is not sent it again', sent.length === 1);
  online = [0xff000a01, 0xff000a02];
  timers[0].f();
  yes('S5 somebody who joins is sent it', sent.length === 2 && sent[1].u === 8);
  guid[7] = 'g-first-again';
  timers[0].f();
  yes('S6 a new connection behind the same character is sent it again, since the client forgot it', sent.length === 3 && sent[2].u === 7);
  online = [0xff000a02];
  timers[0].f();
  online = [0xff000a01, 0xff000a02];
  timers[0].f();
  yes('S7 back after leaving is a connection of its own, and is sent it', sent.length === 4 && sent[3].u === 7);
}

// ------------------------------------------------------------------ C
if (chopWoodSrc) {
  function rig(o) {
    const r = { ends: [], given: [], CHOP_AT: {} };
    const fn = new Function('blockIsOff', 'halfGate', 'toolGate', 'addItem', 'ITEMS', 'swingEnd', 'CHOP_AT', 'economyGathered',
      'creditWork', 'wearTool', 'notify', 'say', 'ALLOW', 'Date', chopWoodSrc + '\nreturn chopWood;');
    r.chop = fn(function () { return o.off || null; }, function () { return o.half || null; }, function () { return o.tool || null; },
      function (a, d, n) { if (o.noWood) { return false; } r.given.push(n); return true; }, { firewood: 'wood' },
      function (a) { r.ends.push(a); }, r.CHOP_AT, function () { }, function () { return ''; }, function () { return ''; },
      function () { }, function () { }, { thornswoodAllow: true }, { now: function () { return 1; } });
    return r;
  }
  const A = 0x14000001, B = 0x000b3949;
  [['C1 not a woodworker', { half: 'Only a woodworker who took Woodwright.' }],
   ['C2 no axe', { tool: 'You need a Woodcutter\'s Axe.' }],
   ['C3 a block nobody works', { off: 'Solitude' }],
   ['C4 no firewood in this load order', { noWood: true }]].forEach(function (c) {
    const r = rig(c[1]);
    const said = r.chop(A, B, false);
    yes(c[0] + ': the press is refused with its sentence and undoes nothing (' + r.ends.length + ' ends)',
        typeof said === 'string' && said.length > 0 && r.ends.length === 0 && r.given.length === 0 && !r.CHOP_AT[A]);
    const s = rig(c[1]);
    s.chop(A, B, true);
    yes(c[0] + ', refused on a fall of the axe: the running session is ended', s.ends.length === 1 && s.ends[0] === A);
  });
  const ok = rig({});
  const allowed = ok.chop(A, B, false);
  yes('C5 an allowed press still chops: two firewood, a session, and nothing ended',
      allowed && allowed.thornswoodAllow === true && ok.given[0] === 2 && !!ok.CHOP_AT[A] && ok.ends.length === 0);
}

// ------------------------------------------------------------------ M
if (mineOreSrc) {
  const calls = [];
  const mp = new Proxy({}, { get: function (t, k) { return function () { calls.push(k); }; } });
  const SESSION = {};
  const fn = new Function('mp', 'isVein', 'ORES_BY_BASE', 'ORE_ONE_PLACE', 'globalThis', 'classGate', 'toolGate', 'MINE_SESSION',
    mineOreSrc + '\nreturn mineOre;');
  [['M1 not a miner', function () { return 'Only a miner works a seam.'; }, function () { return null; }],
   ['M2 no pickaxe', function () { return null; }, function () { return 'You need a pickaxe.'; }]].forEach(function (c) {
    calls.length = 0;
    const mine = fn(mp, function (d) { return !!ORES[d]; }, ORES, [], {}, c[1], c[2], SESSION);
    const said = mine(0x14000001, 0x5000, '1001:Skyrim.esm');
    yes(c[0] + ': refused with its sentence, and the server sends nothing that starts a swing (' + calls.join(',') + ')',
        typeof said === 'string' && said.length > 0 && calls.length === 0 && !SESSION[0x14000001]);
  });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
