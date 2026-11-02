'use strict';
/*
  test-3166-first-steps.js

  #3166: a new character's first hour. Patrick, 22 October: a short guide on
  the K panel and a short NPC quest in the start town, and the basic tool for
  the profession they pick. The guide is the errand's steps: choose a class
  and a profession (the pick hands the tool), speak to the Cook of the town's
  Merchant's Guild, find the notice board, do one piece of your own work, and
  go back to the Cook.

  The WHOLE of game/gamemode.js runs here, loaded the way the fork loads it
  (a fresh module each time, over the same globalThis and mp), over a
  stand-in server whose characters are change forms. Lines reach it the way
  they reach the real one: the front plugin's and the K panel's lines are
  posted to the voice service and the server polls them off it (/commands),
  and what it says goes back to the voice service (/say), so this hands it
  lines and reads what it said.

    A  the arrival begins the steps, says where they are, and the K panel
       carries all five, none done, naming the Cook's building and the town;
       a character made before this is shown nothing
    B  E on the Cook: from out of reach nothing; in reach the errand and the
       Cook step ticks; E on another person in reach, or on the Cook lying
       dead, is nothing; the Cook again says what is still to do
    R  a relog, a reload and a restart in the middle keep every step
    C  the notice board ticks the board step; its drop box does not
    D  work before a class is nothing; the picks tick the pick step and hand
       the tool; one piece of work ticks the work step
    E  back at the Cook: the last line names the guild's trader of their own
       trade, the steps are done and off the panel, and the Cook says nothing
       more
    H  Put this away takes the steps off the panel, says so once, and the
       Cook has nothing to say after it
    U  the K panel page itself, in a stand-in document: First steps first and
       opened on once, one card a step with its tick, no Confirm, Put this
       away sends the pick, and not while creating
    Z  no timer threw

  Read only, apart from its own temp folder, which it removes.

      node tests\test-3166-first-steps.js
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const REPO_DIR = path.join(__dirname, '..');
const SRC = path.resolve(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'));
const UI = path.join(REPO_DIR, 'game', 'ui', 'thornswood-skills.js');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');
const ui = fs.readFileSync(UI, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-steps-'));
function done() {
  process.chdir(START);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// ------------------------------------------------------------ the folder --
['data', 'private', 'world'].forEach(function (d) { fs.mkdirSync(path.join(dir, d)); });
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({
  dataDir: 'data', privDir: 'private', port: 7777, name: 'first steps', loadOrder: [],
  thornswoodRequirePass: false
}));
process.chdir(dir);

let clock = Date.UTC(2026, 9, 26, 12, 0, 0);
class FakeDate extends Date {
  constructor(...a) { if (a.length) { super(...a); } else { super(clock); } }
  static now() { return clock; }
}

// The town's guild Cook, read out of the same file the server reads.
const TRADERS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'merchant-traders.json'), 'utf8').replace(/^﻿/, '')).byRef;
function traderOf(hold, role) {
  for (const ref in TRADERS) { if (TRADERS[ref].bookHold === hold && TRADERS[ref].role === role) { return Object.assign({ ref: ref }, TRADERS[ref]); } }
  return null;
}
const WCOOK = traderOf('whiterun', 'Cook'), RCOOK = traderOf('riften', 'Cook'), WSMITH = traderOf('whiterun', 'Smith');
yes('P0 the guild lists a Cook in Whiterun and in Riften, and a Smith in Whiterun', !!WCOOK && !!RCOOK && !!WSMITH);
if (!WCOOK || !RCOOK || !WSMITH) { done(); }
function idOfRef(ref) { return parseInt(ref.split(':')[0], 16); }
const COOK = idOfRef(WCOOK.ref), RIFTEN_COOK = idOfRef(RCOOK.ref);
const OTHER = idOfRef(traderOf('whiterun', 'Alchemist').ref);
const NAMES = JSON.parse(/const BUILDING_NAME = (\{.*\});/.exec(gm)[1]);
const COOK_AT = NAMES[WCOOK.cell];
yes('P0 the building the Whiterun Cook stands in has a name: ' + COOK_AT, !!COOK_AT);

// ------------------------------------------------------------- the world --
const ME = 0xff000800, PID = 1000;     // new, arrives in Whiterun
const OLD = 0xff000802, OLD_PID = 1002; // made before this, in the world
const NEW2 = 0xff000803, PID2 = 1003;  // new, arrives in Riften, puts the steps away
function newcomer(pid, name) {
  return {
    profileId: pid, pos: [0, 0, 0], angle: [0, 0, 0], worldOrCellDesc: '3c:Skyrim.esm',
    appearance: { name: name, raceId: 0x13746, isFemale: false }, isDead: false,
    thornswoodChargen: { stage: 'choosing', at: clock - 60000, faceDone: clock - 60000 },
    inventory: { entries: [{ baseId: 0xf, count: 40 }] },
    equipment: { inv: { entries: [] } },
    baseDesc: '7:Skyrim.esm'
  };
}
let store = new Map();
store.set(ME, newcomer(PID, 'Tester'));
store.set(NEW2, newcomer(PID2, 'Second'));
store.set(OLD, {
  profileId: OLD_PID, pos: [1000, 2000, 64], angle: [0, 0, 10], worldOrCellDesc: '1a26f:Skyrim.esm',
  appearance: { name: 'Elder', raceId: 0x13746, isFemale: false }, isDead: false,
  thornswoodChargen: { stage: 'done', at: 1, destination: 'whiterun' },
  thornswoodCharacter: { prof: 'smith', v: 1 },
  inventory: { entries: [{ baseId: 0xf, count: 25 }] }, equipment: { inv: { entries: [] } },
  baseDesc: '7:Skyrim.esm'
});
const COOK_POS = WCOOK.pos.slice(0, 3);
store.set(COOK, { pos: COOK_POS.slice(), worldOrCellDesc: WCOOK.cell, baseDesc: '13ba3:Skyrim.esm' });
store.set(OTHER, { pos: [COOK_POS[0] + 100, COOK_POS[1], COOK_POS[2]], worldOrCellDesc: WCOOK.cell, baseDesc: '13ba4:Skyrim.esm' });
store.set(RIFTEN_COOK, { pos: RCOOK.pos.slice(0, 3), worldOrCellDesc: RCOOK.cell, baseDesc: '13369:Skyrim.esm' });
let online = [ME, NEW2, OLD];

/* The lines waiting on the voice service, and every line the server said. */
let waiting = [];
let saidLines = [];
function send(pid, text) { waiting.push({ profileId: pid, text: text, proven: true }); proc.run(2000); }
function heard(pid) { return saidLines.filter(function (s) { return s.profileId === pid; }).map(function (s) { return s.text; }); }

function makeMp() {
  const base = {
    get: function (id, k) {
      if (id === 0 && k === 'onlinePlayers') { return online.slice(); }
      const row = store.get(id);
      if (!row) { return undefined; }
      if (k === 'locationalData') { return { cellOrWorldDesc: row.worldOrCellDesc, pos: copy(row.pos), rot: copy(row.angle) }; }
      return copy(row[k]);
    },
    set: function (id, k, v) {
      const row = store.get(id) || {};
      if (k === 'locationalData') { row.worldOrCellDesc = v.cellOrWorldDesc; row.pos = copy(v.pos); row.angle = copy(v.rot); }
      else { row[k] = copy(v); }
      store.set(id, row);
    },
    makeProperty: function () { }, makeEventSource: function () { },
    getNeighborsByPosition: function () { return online.slice(); },
    callPapyrusFunction: function () { return undefined; },
    getDescFromId: function (id) { return (id >>> 0).toString(16) + ':Skyrim.esm'; },
    getIdFromDesc: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d)); return m ? parseInt(m[1], 16) : 0; },
    sendCustomPacket: function () { },
    findFormsByPropertyValue: function () { return []; },
    place: function () { return 0; },
    lookupEspmRecordById: function () { return { record: null }; },
    getEspmLoadOrder: function () { return ['Skyrim.esm', 'Update.esm']; },
    getServerSettings: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8')); },
    getUserByActor: function (a) { return online.indexOf(a); },
    getActorByUser: function (u) { return online[u] || 0; },
    getUserGuid: function (u) { return 'guid-' + u; },
    setRaceMenuOpen: function () { },
    writeFileWhole: function (f, text) { fs.writeFileSync(f, text); },
    clear: function () { }
  };
  return new Proxy(base, {
    get: function (t, k) {
      if (k in t) { return t[k]; }
      if (typeof k === 'string' && !/^on/.test(k)) { return function () { return undefined; }; }
      return undefined;
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}

/* The voice service on loopback: /commands hands over what is waiting, /say is kept. */
function fakeHttp() {
  function request(opts, cb) {
    const r = {
      on: function () { return r; }, setTimeout: function () { return r; }, destroy: function () { }, write: function () { },
      end: function (body) {
        const where = String((opts && opts.path) || '');
        if (where === '/say' && body) { try { saidLines.push(JSON.parse(body)); } catch (e) { } }
        if (where.indexOf('/commands') === 0 && typeof cb === 'function') {
          const list = waiting.splice(0);
          const h = {};
          const res = { statusCode: 200, on: function (ev, fn) { h[ev] = fn; return res; }, setEncoding: function () { } };
          cb(res);
          if (h.data) { h.data(JSON.stringify({ commands: list })); }
          if (h.end) { h.end(); }
        }
      }
    };
    return r;
  }
  return { request: request, get: request, createServer: function () { return { listen: function () { }, on: function () { } }; } };
}
const HTTP = fakeHttp();
function fakeRequire(name) {
  if (name === 'http' || name === 'https') { return HTTP; }
  if (name === 'child_process') { return { exec: function () { }, spawn: function () { return { on: function () { } }; } }; }
  return require(name);
}

function load(p) {
  const m = { exports: {} };
  vm.runInContext('(function (exports, require, module, __filename, __dirname) {' + gm + '\n})',
                  p.box, { filename: 'gamemode.js' })
    .call(m.exports, m.exports, fakeRequire, m, SRC, path.dirname(SRC));
}

function boot() {
  const timers = [];
  const box = {
    mp: makeMp(), require: fakeRequire, process: process, Buffer: Buffer,
    console: { log: function () { }, error: function () { }, warn: function () { }, info: function () { } },
    setInterval: function (fn, ms) { const t = { fn: fn, every: Number(ms) || 1000, at: clock + (Number(ms) || 1000) }; timers.push(t); return t; },
    clearInterval: function (t) { if (t) { t.gone = true; } },
    setTimeout: function (fn, ms) { const t = { fn: fn, at: clock + (Number(ms) || 0) }; t.unref = function () { return t; }; timers.push(t); return t; },
    clearTimeout: function (t) { if (t) { t.gone = true; } },
    setImmediate: function (fn) { timers.push({ fn: fn, at: clock }); },
    Date: FakeDate, URL: URL, TextEncoder: TextEncoder, TextDecoder: TextDecoder
  };
  box.globalThis = box;
  vm.createContext(box);
  const p = { box: box, threw: [] };
  p.run = function (ms) {
    const end = clock + ms;
    for (;;) {
      let next = null;
      for (let i = 0; i < timers.length; i++) {
        if (!timers[i].gone && (!next || timers[i].at < next.at)) { next = timers[i]; }
      }
      if (!next || next.at > end) { break; }
      clock = Math.max(clock, next.at);
      if (next.every) { next.at += next.every; } else { next.gone = true; }
      try { next.fn(); } catch (e) { p.threw.push(e && e.message); }
    }
    clock = end;
  };
  try { load(p); } catch (e) { p.err = e; }
  return p;
}
function saved() { return new Map(JSON.parse(JSON.stringify(Array.from(store.entries())))); }

let proc = boot();
yes('P1 the whole gamemode loads over the stand-in' + (proc.err ? ' (it threw: ' + proc.err.message + ')' : ''), !proc.err);
if (proc.err) { done(); }
proc.run(30000);
yes('P1 the first steps block is loaded', !!proc.box.__thornswoodFirstSteps);

function rec(id) { return store.get(id).thornswoodFirstSteps; }
function panel(id) {
  const C = proc.box.__thornswoodCharacter;
  C.writeState(id, C.stateOf(id), true);
  return store.get(id).thornswoodCharacter.panel;
}
function steps(id) { const v = panel(id).firstSteps; return v ? v.steps : null; }
function stepDone(id) {
  const out = {};
  (steps(id) || []).forEach(function (s) { out[s.key] = s.done; });
  return out;
}
function press(pid, npc) { send(pid, '/merchant e ' + npc.toString(16)); }
function cookSaid(pid, since) { return heard(pid).slice(since).filter(function (t) { return /^The Cook says: /.test(t); }); }

// ------------------------------------------------------------ A. arrival --
send(PID, '/pick town whiterun');
const r0 = rec(ME);
yes('A1 choosing Whiterun ends creation and begins the first steps there (' + JSON.stringify(r0) + ')',
    store.get(ME).thornswoodChargen.stage === 'done' && !!r0 && r0.v === 1 && r0.town === 'whiterun' && r0.since > 0 &&
    !r0.took && !r0.board && !r0.work && !r0.done && !r0.hidden);
yes('A1 and one line says where they are, after the welcome (' + heard(PID).join(' | ') + ')',
    heard(PID).filter(function (t) { return t === 'Your first steps in Whiterun are on the panel behind K.'; }).length === 1 &&
    heard(PID).indexOf('Welcome to Whiterun Hold, Safe Travels.') >= 0 &&
    heard(PID).indexOf('Welcome to Whiterun Hold, Safe Travels.') < heard(PID).indexOf('Your first steps in Whiterun are on the panel behind K.'));
const sentAtArrival = store.get(ME).thornswoodCharacter.panel;
yes('A2 the panel written at the arrival already carries the steps', !!sentAtArrival && !!sentAtArrival.firstSteps && !sentAtArrival.creating);
const s0 = steps(ME);
yes('A2 five steps, in order, none done (' + (s0 || []).map(function (s) { return s.key + ':' + s.done; }).join(', ') + ')',
    !!s0 && s0.map(function (s) { return s.key; }).join(',') === 'pick,cook,board,work,back' && s0.every(function (s) { return s.done === false; }));
yes('A2 each has a name and the server\'s words, the Cook\'s naming ' + COOK_AT + ' and the board\'s naming Whiterun',
    !!s0 && s0.every(function (s) { return typeof s.name === 'string' && s.name && typeof s.text === 'string' && s.text; }) &&
    s0[1].text.indexOf('the Cook at ' + COOK_AT) >= 0 && s0[4].text.indexOf('the Cook at ' + COOK_AT) >= 0 &&
    s0[2].text.indexOf('notice board in Whiterun') >= 0 && /tool/.test(s0[0].text) &&
    panel(ME).firstSteps.town === 'Whiterun');
yes('A3 a character made before this has no first steps, on the panel or on the character',
    !panel(OLD).firstSteps && !store.get(OLD).thornswoodFirstSteps);
send(PID2, '/pick town riften');
yes('A3 the second newcomer begins in Riften', !!rec(NEW2) && rec(NEW2).town === 'riften');

// -------------------------------------------------------------- B. the Cook --
let at = heard(PID).length;
press(PID, COOK);
yes('B1 E on the Cook from the start spot, out of reach, is nothing', cookSaid(PID, at).length === 0 && !rec(ME).took);
store.get(ME).worldOrCellDesc = WCOOK.cell;
store.get(ME).pos = [COOK_POS[0] + 150, COOK_POS[1] + 150, COOK_POS[2]];
at = heard(PID).length;
press(PID, OTHER);
yes('B2 E on somebody else in reach is nothing', cookSaid(PID, at).length === 0 && !rec(ME).took);
store.get(COOK).isDead = true;
press(PID, COOK);
yes('B2 a Cook lying dead says nothing', cookSaid(PID, at).length === 0 && !rec(ME).took);
store.get(COOK).isDead = false;
press(PID, COOK);
const first = cookSaid(PID, at);
yes('B3 E on the Cook in reach gives the errand (' + first.join(' | ') + ')',
    first.length === 1 && /New to Whiterun\?/.test(first[0]) && /notice board/.test(first[0]) && /your own work/.test(first[0]) &&
    /come back/.test(first[0]) && rec(ME).took > 0);
yes('B3 and the Cook step is ticked on the panel', stepDone(ME).cook === true && stepDone(ME).board === false);
at = heard(PID).length;
press(PID, COOK);
const notYet = cookSaid(PID, at);
yes('B4 the Cook again says what is still to do (' + notYet.join(' | ') + ')',
    notYet.length === 1 && notYet[0] === 'The Cook says: "Not yet. You still have to find the notice board and do a piece of your own work."');

// ----------------------------------------------- R. relog, reload, restart --
const keep = JSON.stringify(rec(ME));
online = online.filter(function (a) { return a !== ME; });
proc.run(10 * 60000);
online.push(ME);
proc.run(60000);
yes('R1 a relog keeps every step', JSON.stringify(rec(ME)) === keep && stepDone(ME).cook === true);
load(proc);
proc.run(60000);
yes('R2 a reload keeps every step', JSON.stringify(rec(ME)) === keep && stepDone(ME).cook === true);
const threwBefore = proc.threw.slice();
store = saved();
online = [];
proc = boot();
proc.threw = threwBefore.concat(proc.threw);
proc.run(30000);
online = [ME, NEW2, OLD];
proc.run(60000);
yes('R3 a restart keeps every step', !proc.err && JSON.stringify(rec(ME)) === keep && stepDone(ME).cook === true);

// ------------------------------------------------------------ C. the board --
const FAKE_BOARD = 0xff0b0001, FAKE_BOX = 0xff0b0002;
const prop = proc.box.__thornswoodProperty;
const realBoard = prop.boardActivated;
prop.boardActivated = function (refrId, actorId) {
  if (refrId === FAKE_BOARD) { return 'board'; }
  if (refrId === FAKE_BOX) { return 'box'; }
  return realBoard(refrId, actorId);
};
store.set(FAKE_BOARD, { baseDesc: '1:Skyrim.esm' });
store.set(FAKE_BOX, { baseDesc: '2:Skyrim.esm' });
proc.box.mp.onActivate(FAKE_BOX, ME);
yes('C1 the drop box beside the board is not the board', !rec(ME).board && stepDone(ME).board === false);
proc.box.mp.onActivate(FAKE_BOARD, ME);
yes('C2 the notice board ticks the board step', rec(ME).board > 0 && stepDone(ME).board === true);

// ------------------------------------------------------- D. picks and work --
const C = proc.box.__thornswoodCharacter;
C.credit(ME, 'mine');
yes('D1 work with no class to stand in is not counted, and ticks nothing', !rec(ME).work && stepDone(ME).work === false);
at = heard(PID).length;
send(PID, '/pick class miner');
yes('D2 the class alone does not tick the pick step', stepDone(ME).pick === false);
yes('D2 and the class pick hands the tool (' + heard(PID).slice(at).join(' | ') + ')', /pickaxe/i.test(heard(PID).slice(at).join(' ')));
send(PID, '/pick profession smith platewright');
yes('D3 class and profession tick the pick step', C.stateOf(ME).cls === 'miner' && C.stateOf(ME).prof === 'smith' && stepDone(ME).pick === true);
C.credit(ME, 'mine');
yes('D4 one piece of work ticks the work step', rec(ME).work > 0 && stepDone(ME).work === true);

// ------------------------------------------------------------- E. back --
at = heard(PID).length;
press(PID, COOK);
const last = cookSaid(PID, at);
const smithAt = NAMES[WSMITH.cell] || WSMITH.locationName;
yes('E1 back at the Cook it is finished, naming the guild\'s Smith at ' + smithAt + ' (' + last.join(' | ') + ')',
    last.length === 1 && /found your feet/.test(last[0]) && last[0].indexOf('The guild\'s Smith is at ' + smithAt) >= 0 &&
    /Welcome to Whiterun\./.test(last[0]) && rec(ME).done > 0);
yes('E2 and the steps are off the panel', !panel(ME).firstSteps);
at = heard(PID).length;
press(PID, COOK);
yes('E3 the Cook says nothing more after it', cookSaid(PID, at).length === 0);

// ------------------------------------------------------------- H. put away --
yes('H0 the second newcomer\'s panel has the steps, the Cook\'s in Riften',
    !!steps(NEW2) && steps(NEW2)[1].text.indexOf(NAMES[RCOOK.cell] || RCOOK.locationName) >= 0);
at = heard(PID2).length;
send(PID2, '/pick firststeps hide');
yes('H1 Put this away takes the steps off the panel and says so once (' + heard(PID2).slice(at).join(' | ') + ')',
    rec(NEW2).hidden > 0 && !panel(NEW2).firstSteps &&
    heard(PID2).slice(at).filter(function (t) { return /^Put away\./.test(t); }).length === 1);
at = heard(PID2).length;
send(PID2, '/pick firststeps hide');
yes('H2 a second press says nothing', heard(PID2).slice(at).length === 0);
store.get(NEW2).worldOrCellDesc = RCOOK.cell;
store.get(NEW2).pos = RCOOK.pos.slice(0, 3);
at = heard(PID2).length;
press(PID2, RIFTEN_COOK);
yes('H3 and the Cook has nothing to say to them after it', cookSaid(PID2, at).length === 0);

// ------------------------------------------------------ U. the K panel page --
{
  const told = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
      set: function (v) { n._text = String(v); n.children = []; }
    });
    n.appendChild = function (c) { n.children.push(c); return c; };
    n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
    return n;
  }
  const docu = {
    head: node('head'), body: node('body'),
    createElement: function (tag) {
      const n = node(tag);
      Object.defineProperty(n, 'innerHTML', { set: function () {
        const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
        n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
                 '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
      } });
      return n;
    },
    createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
  };
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function (to, m) { told.push(m); } },
                thornswoodNet: { say: function () { } } };
  const box = { window: win, document: docu, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
  const api = win.thornswoodSkills;
  yes('U0 the K panel runs in a stand-in document', ran && !!api);
  if (!api) { done(); }
  const root = docu.body.children[0];
  const nav = root._q['.nav'], body = root._q['.body'], confirmBtn = root._q['[data-act="confirm"]'];
  const navNames = function () {
    return nav.children.filter(function (r) { return /navrow/.test(r.className); }).map(function (r) { return r.children[0].textContent; });
  };
  const all = function (n, out) { out = out || []; out.push(n); n.children.forEach(function (c) { all(c, out); }); return out; };
  const cards = function () { return all(body).filter(function (n) { return /^card\b/.test(n.className) && n.children.length && /name/.test(n.children[0].className); }); };

  // A newcomer half way through: the Whiterun steps as the server sends them.
  const shown = { profession: 'smith', 'class': null, half: 'platewright', ranks: {}, tree: {}, placed: {}, points: 0,
                  creating: false, towns: [],
                  firstSteps: { town: 'Whiterun', steps: s0.map(function (s, i) { return Object.assign({}, s, { done: i === 1 }); }) } };
  api.open();
  api.setData(null, { panel: shown });
  yes('U1 First steps is first in the list (' + navNames().join(', ') + ')', navNames()[0] === 'First steps');
  yes('U1 and the panel opened on it, with one card a step in the server\'s words (' + body.textContent.slice(0, 120) + '...)',
      cards().length === 5 && cards()[1].className.indexOf('mine') >= 0 && cards()[0].className.indexOf('mine') < 0 &&
      body.textContent.indexOf(s0[1].text) >= 0 && /1 of 5 done/.test(nav.textContent));
  yes('U2 there is no Confirm on it', confirmBtn.style.display === 'none');
  const away = all(body).filter(function (n) { return /\bact\b/.test(n.className) && n.textContent === 'Put this away'; });
  away[0] && away[0].onclick({ stopPropagation: function () { } });
  yes('U3 Put this away sends the pick, and nothing else (' + told.filter(function (m) { return /^skills:pick/.test(m); }).join(' | ') + ')',
      away.length === 1 && told.filter(function (m) { return /^skills:pick/.test(m); }).join('|') === 'skills:pick firststeps hide');
  const navRow = function (name) { return nav.children.filter(function (r) { return /navrow/.test(r.className) && r.children[0].textContent === name; })[0]; };
  navRow('Profession').onclick();
  api.setData(null, { panel: Object.assign({}, shown, { points: 1 }) });
  yes('U4 it opens on First steps once, not on every arrival of the panel', body.textContent.indexOf(s0[1].text) < 0);
  api.setData(null, { panel: Object.assign({}, shown, { creating: true }) });
  yes('U5 not while creating', navNames().indexOf('First steps') < 0);
  api.setData(null, { panel: Object.assign({}, shown, { firstSteps: undefined }) });
  yes('U6 and gone once the server stops sending it', navNames().indexOf('First steps') < 0);
}

// ------------------------------------------------- W. the words on the page --
{
  const doc = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'creation.md'), 'utf8').split(CR).join('');
  const towns = ['whiterun', 'riften', 'solitude', 'windhelm', 'markarth', 'falkreath', 'morthal', 'dawnstar', 'winterhold'];
  const rows = towns.map(function (t) {
    const cook = traderOf(t, 'Cook');
    const name = t.charAt(0).toUpperCase() + t.slice(1);
    return { t: name, at: cook ? (NAMES[cook.cell] || cook.locationName) : '' };
  });
  const wrong = rows.filter(function (r) { return !r.at || doc.indexOf('| ' + r.t + ' | ' + r.at + ' |') < 0; });
  yes('W creation.md names the building each start town\'s Cook stands in, as the trader list and the building names have it' +
      (wrong.length ? ' (not: ' + wrong.map(function (r) { return r.t + ' ' + r.at; }).join(', ') + ')' : ''), wrong.length === 0);
}

// -------------------------------------------------------------- Z. timers --
yes('Z no timer threw' + (proc.threw.length ? ': ' + proc.threw.slice(0, 3).join(' | ') : ''), proc.threw.length === 0);
done();
