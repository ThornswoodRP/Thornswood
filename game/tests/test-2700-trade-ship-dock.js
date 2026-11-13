'use strict';
/*
  test-2700-trade-ship-dock.js

      node game/tests/test-2700-trade-ship-dock.js

  #2700, trade ships: Patrick's five answers (18 Oct 2026, 11:30 AM MT, via
  Smeagle) wired into the world. Holds game\trade-ship-dock.js and the trade
  ships block of game\gamemode.js to them:

    P  the module: the panel's words, a voyage as long as its route says, the
       next arrival, coin, the one charter call, a staff draft and what it
       proposes, what a person sees at a dock, take and the days (#511)
    W  the block, started as the server starts it with a fake world: E on a
       crate opens the dock and never the container; a staff draft at a crate
       confirmed against the list it was proposed on; a load refused for no
       charter, for coin and for a full hold before the pack is touched; a
       load, a voyage and an arrival on their own; a collect and a take back,
       each through a receipt; an overdue ship docked at start
    X  #511, Patrick's answers of 22 Oct 2026: anyone at a docked hold takes
       from it, written as taken with their character and shown to staff;
       a hold at sea opens for nobody; what nobody collects goes into the
       port's hold drop box under the recipient's name after the staff
       list's days, and the hold is free again; a box that will not take it
       leaves it aboard and the clock waits an hour, not a spin
    R  the routes in: mp.onActivate asks the block first, /ship is a word and
       never one a player is told to type, the Office page offers staff the
       panel
    U  the bundles in gamemode.js are the two modules as they are

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const T = require('../../game/trade-cargo.js');
const D = require('../../game/trade-ship-dock.js');

const REPO = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function throws(what, fn, re) {
  let msg = null;
  try { fn(); } catch (e) { msg = String(e && e.message); }
  yes(what + (msg ? ' (' + msg + ')' : ''), msg !== null && (!re || re.test(msg)));
}

const IRON = 0x5ace4, SALT = 0x34cdf, GOLD = 15;
const CELL = '3c:Skyrim.esm';
const ROUTES = {
  v: 1,
  ports: [
    { key: 'solitude', name: 'Solitude docks', hold: 'solitude', world: CELL, pos: [0, 0, 0], crate: '1a001:Skyrim.esm' },
    { key: 'windhelm', name: 'Windhelm docks', hold: 'windhelm', world: CELL, pos: [5000, 0, 0], crate: '1a002:Skyrim.esm' }
  ],
  routes: [
    { from: 'solitude', to: 'windhelm', minutes: 90, crew: [] },
    { from: 'windhelm', to: 'solitude', minutes: 120 }
  ]
};
/* The Trading Company's rule as #2687 has it: mayCharter(who, terms), who { company, staff }. */
function companyRule(log) {
  return {
    terms: function () { return { charter: 'company' }; },
    mayCharter: function (who, terms) {
      if (log) { log.push({ who: who, terms: terms }); }
      if (terms.charter === 'anyone') { return true; }
      if (terms.charter === 'staff') { return who.staff === true; }
      return who.company === true || who.staff === true;
    }
  };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2700-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

try {
  // ================================================================== P
  const code = fs.readFileSync(path.join(REPO, 'game', 'trade-ship-dock.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  yes('P0 the module touches nothing: no require, no world, no timer', !/require\(|\bmp\.|setTimeout|Date\.now/.test(code));
  yes('P1 a load reads whole', JSON.stringify(D.parse(['/ship', 'load', 'ship-1', '5ace4', '0', '3', 'ff000a01'])) ===
      JSON.stringify({ verb: 'load', hold: 'ship-1', base: IRON, nth: 0, count: 3, forActor: 0xff000a01 }));
  yes('P2 a word it does not know is said, not guessed', !!D.parse(['/ship', 'sink']).why && !!D.parse(['/ship', 'load', 'ship-1', 'x']).why);
  const routes = T.checkRoutes(ROUTES);
  yes('P3 a voyage takes the minutes staff gave its route', JSON.stringify(D.voyage(routes, 'solitude', 'windhelm', 1000)) === JSON.stringify({ at: 1000, arriveAt: 1000 + 90 * 60000 }) &&
      D.voyage(routes, 'windhelm', 'solitude', 0).arriveAt === 120 * 60000);
  throws('P4 and there is no voyage staff did not write', function () { D.voyage(routes, 'windhelm', 'dawnstar', 0); }, /No ship sails/);
  yes('P5 the next arrival is the earliest at sea, none when none sails',
      D.nextArrival({ holds: { a: { sailing: { arriveAt: 50 } }, b: { sailing: null }, c: { sailing: { arriveAt: 20 } } } }) === 20 &&
      D.nextArrival({ holds: { b: { sailing: null } } }) === null);
  yes('P6 coin is base 0xF and nothing else', D.isCoin(GOLD) && !D.isCoin(IRON));
  const calls = [];
  yes('P7 the Trading Company role charters, by mayCharter(who, terms)', D.charterOf(companyRule(calls), { company: true, staff: false }).may === true &&
      calls.length === 1 && JSON.stringify(calls[0].who) === '{"company":true,"staff":false}' && calls[0].terms.charter === 'company');
  yes('P8 an admin testing charters, anybody else is told why', D.charterOf(companyRule(), { staff: true }).may === true &&
      /Only those the Trading Company charters/.test(D.charterOf(companyRule(), {}).why));
  yes('P9 with no company rule running nobody charters, and it says so', D.charterOf(undefined, { company: true, staff: true }).may === false &&
      /not running/.test(D.charterOf(null, {}).why));
  yes('P10 a company rule that throws charters nobody', D.charterOf({ mayCharter: function () { throw new Error('bad terms'); }, terms: function () { return {}; } }, { company: true }).may === false);
  const tcPath = path.join(REPO, 'game', 'trading-company.js');
  if (fs.existsSync(tcPath)) {
    // #2687 on the base: the same cases against the real rule.
    const TC = require(tcPath);
    const terms = TC.loadTerms(fs.readFileSync(path.join(REPO, 'game', 'data', 'trading-company.json'), 'utf8'));
    const real = { mayCharter: TC.mayCharter, terms: function () { return terms; } };
    yes('P11 against game\\trading-company.js: the company charters, nobody else', D.charterOf(real, { company: true }).may && !D.charterOf(real, {}).may);
  } else {
    yes('P11 game\\trading-company.js (#2687) is not on this base yet; P7 to P10 hold its signature', true);
  }

  const crate = { desc: '1b009:Skyrim.esm', world: CELL, pos: [9000, 1, 2] };
  let draft = D.editDraft(T, routes, null, ['port', 'dawnstar', 'dawnstar', 'Dawnstar', 'quay'], crate);
  yes('P12 a port at the crate staff opened: its name, hold, world, place and crate', draft.ports[2].key === 'dawnstar' && draft.ports[2].name === 'Dawnstar quay' &&
      draft.ports[2].crate === crate.desc && draft.ports[2].pos[0] === 9000 && routes.ports.length === 2);
  throws('P13 no port without a crate opened', function () { D.editDraft(T, routes, null, ['port', 'x', 'riften', 'X'], null); }, /Open the crate first/);
  throws('P14 a container that is not the world\'s own is not a dock', function () { D.editDraft(T, routes, null, ['port', 'x', 'riften', 'X'], { desc: 'ff000123', world: CELL, pos: [0, 0, 0] }); }, /world's own/);
  throws('P15 one crate is one port\'s', function () { D.editDraft(T, routes, null, ['port', 'x', 'riften', 'X'], { desc: '1A001:Skyrim.esm', world: CELL, pos: [0, 0, 0] }); }, /already the dock of solitude/);
  draft = D.editDraft(T, routes, draft, ['route', 'windhelm', 'dawnstar', '45'], null);
  draft = D.editDraft(T, routes, draft, ['route', 'solitude', 'windhelm', '100'], null);
  yes('P16 a route added and a leg retimed, in the draft only', draft.routes.length === 3 && draft.routes[0].minutes === 100 && routes.routes[0].minutes === 90);
  throws('P17 a route of no minutes is refused whole', function () { D.editDraft(T, routes, draft, ['route', 'dawnstar', 'solitude', '0'], null); }, /Route/);
  yes('P18 reset is the list in force', JSON.stringify(D.editDraft(T, routes, draft, ['reset'], null)) === JSON.stringify(routes));

  const ships = T.createTradeCargo({ ports: ['solitude', 'windhelm'], routes: routes.routes });
  const reg = { routes: routes, ships: ships, state: ships.empty() };
  ships.open(reg.state, 'ship-1', 'solitude');
  const sv = D.staffView(T, reg, draft, crate);
  yes('P19 the server proposes: every change, nothing stranded, confirmable', sv.mode === 'staff' && sv.canConfirm &&
      sv.changes.some(function (c) { return /Add the port Dawnstar quay/.test(c); }) && sv.changes.some(function (c) { return /takes 100 minutes, not 90/.test(c); }) &&
      sv.base === D.baseOf(routes));
  const strand = D.editDraft(T, routes, null, ['unport', 'solitude'], null);
  const sv2 = D.staffView(T, reg, strand, null);
  yes('P20 a draft that strands a ship is shown, and cannot be confirmed', !sv2.canConfirm && /ship-1 is at solitude/.test(sv2.strands[0]));

  const A = { actor: 0xff000a01, profile: 5001 }, B = { actor: 0xff000a02, profile: 5002 }, C = { actor: 0xff000a03, profile: 5003 };
  ships.load(reg.state, 'ship-1', { by: A, for: B, receipt: 'p1', entry: { baseId: IRON, count: 3 } });
  ships.load(reg.state, 'ship-1', { by: C, for: C, receipt: 'p2', entry: { baseId: SALT, count: 2 } });
  const pack = [{ baseId: IRON, nth: 0, count: 9, name: 'Iron Ingot' }, { baseId: GOLD, nth: 0, count: 50, name: 'Gold' }];
  const dv = D.dockView({ reg: reg, port: 'solitude', viewer: A, charter: { may: true, why: '' }, pack: pack, people: [A, Object.assign({ name: 'Onund' }, B)],
                          nameOf: function () { return 'Onund'; }, now: 0 });
  const h = dv.holds[0];
  yes('P21 at a dock: the ship, lines used of 24, every line aboard shown, whose it is only to whom it concerns (#511)', dv.mode === 'dock' && h.used === 2 && h.max === 24 &&
      h.lines.length === 2 && h.lines[0].forName === 'Onund' && h.lines[1].forName === 'someone else' && !('others' in h));
  yes('P22 the loader may take it back where it was loaded, nobody collects at the port it left', h.lines[0].canReturn && !h.lines[0].canCollect && !h.lines[0].canTake);
  yes('P22b and anybody else\'s line, they may take (Patrick, 22 Oct: A)', h.lines[1].canTake && !h.lines[1].canCollect && !h.lines[1].canReturn);
  yes('P23 gold is never offered as cargo', dv.pack.length === 1 && dv.pack[0].base === '5ace4');
  yes('P24 a charterer may load and sail where staff wrote a route', h.canLoad && h.sail.length === 1 && h.sail[0].to === 'windhelm' && h.sail[0].minutes === 90);
  const nv = D.dockView({ reg: reg, port: 'solitude', viewer: B, charter: { may: false, why: 'no' }, pack: pack, people: [B], now: 0 });
  yes('P25 without a charter: no load, no sail, no pack, and the why', !nv.holds[0].canLoad && !nv.holds[0].sail.length && !nv.pack.length && nv.charter.why === 'no');
  const stranger = D.dockView({ reg: reg, port: 'solitude', viewer: { actor: 0xff000a09, profile: 5009 }, charter: { may: false, why: 'no' }, pack: [], people: [],
                                nameOf: function () { return 'Onund'; }, now: 0 });
  yes('P26 a stranger sees every line aboard, may take each, and never whose it is (#511)', stranger.holds[0].lines.length === 2 &&
      stranger.holds[0].lines.every(function (l) { return l.canTake && !l.canCollect && !l.canReturn && l.forName === 'someone else'; }));
  const asStaff = D.dockView({ reg: reg, port: 'solitude', viewer: { actor: 0xff000a09, profile: 5009 }, staff: true, charter: { may: true, why: '' }, pack: [], people: [],
                               nameOf: function () { return 'Onund'; }, now: 0 });
  yes('P27 staff at a dock see whose each line is', asStaff.holds[0].lines.every(function (l) { return l.forName === 'Onund'; }));
  yes('P28 take is a panel word, like collect', JSON.stringify(D.parse(['/ship', 'take', 'ship-1', '2', '1'])) === '{"verb":"take","hold":"ship-1","line":2,"count":1}' &&
      !!D.parse(['/ship', 'take', 'ship-1', 'x', '1']).why);
  const dd = D.editDraft(T, routes, null, ['days', '3'], null);
  yes('P29 staff set the days cargo waits in the draft only', dd.uncollectedDays === 3 && routes.uncollectedDays === 7 &&
      D.waitOf(dd) === 3 * 86400000 && D.waitOf(routes) === 7 * 86400000);
  throws('P30 days that are not whole days from 1 to 60 are refused', function () { D.editDraft(T, routes, null, ['days', '90'], null); }, /1 to 60/);
  const tb = ships.begin(reg.state, 'ship-1', 2, 1, 'taken', A, 77);
  ships.finish(reg.state, 'ship-1', tb.out, 'pc1');
  const tl0 = D.takenOf(reg, { nameOf: function (pty) { return pty.actor === A.actor ? 'Brynja' : ''; }, itemName: function () { return 'Salt Pile'; } });
  yes('P31 what was taken, for staff: the ship, the piece, how many, by which character, when', tl0.length === 1 && tl0[0].hold === 'ship-1' &&
      tl0[0].item === 'Salt Pile' && tl0[0].count === 1 && tl0[0].by === 'Brynja' && tl0[0].at === 77);
  const sv5 = D.staffView(T, reg, dd, null, { nameOf: function () { return 'Brynja'; } });
  yes('P32 and staff see it with the days in force and drafted', sv5.taken.length === 1 && sv5.inForce.days === 7 && sv5.draft.days === 3 &&
      sv5.changes.some(function (c) { return /after 3 days, not 7/.test(c); }));

  // ================================================================== W
  const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
  const a = gm.indexOf('// ==== thornswood trade ships ====');
  const z = gm.indexOf('// ==== end thornswood trade ships ====');
  const blockSrc = gm.slice(a, z);
  const ACT = { a: 0xff000a01, b: 0xff000a02, staff: 0xff000a05 };
  const PID = {}; PID[ACT.a] = 5001; PID[ACT.b] = 5002; PID[ACT.staff] = 5005;
  const CRATE = { solitude: 0x1a001, windhelm: 0x1a002, other: 0x1b009 };

  function start(dir, opt) {
    opt = opt || {};
    const clock = opt.clock || { now: 1000000 };
    const store = {}, logged = [], timers = [];
    function put(id, k, v) { (store[id] = store[id] || {})[k] = JSON.parse(JSON.stringify(v)); }
    put(ACT.a, 'inventory', { entries: [{ baseId: IRON, count: 40 }, { baseId: GOLD, count: 100 }, { baseId: SALT, count: 40, health: 1.2 }] });
    put(ACT.b, 'inventory', { entries: [] });
    put(ACT.staff, 'inventory', { entries: [] });
    [ACT.a, ACT.b, ACT.staff].forEach(function (id) {
      put(id, 'profileId', PID[id]); put(id, 'worldOrCellDesc', CELL); put(id, 'pos', [10, 0, 0]);
      put(id, 'appearance', { name: id === ACT.a ? 'Brynja' : id === ACT.b ? 'Onund' : 'Staff' });
    });
    put(CRATE.solitude, 'worldOrCellDesc', CELL); put(CRATE.solitude, 'pos', [0, 0, 0]);
    put(CRATE.windhelm, 'worldOrCellDesc', CELL); put(CRATE.windhelm, 'pos', [5000, 0, 0]);
    put(CRATE.other, 'worldOrCellDesc', CELL); put(CRATE.other, 'pos', [9000, 1, 2]);
    const box = {
      console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
      require: require, Buffer: Buffer, JSON: JSON, Math: Math,
      Date: { now: function () { return clock.now; } },
      setTimeout: function (fn, ms) { const t = { fn: fn, ms: ms, live: true }; timers.push(t); return t; },
      clearTimeout: function (t) { if (t) { t.live = false; } },
      log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
      kindIsContainer: function (desc) { return desc === 'container'; },
      __thornswoodIsStaff: function (pid) { return pid === 5005; },
      __thornswoodIsAdmin: function () { return false; },
      __thornswoodIsCompany: function (pid) { return pid === 5001; },
      mp: {
        getServerSettings: function () { return { privDir: 'private', thornswoodTradeShips: true }; },
        get: function (id, k) {
          if (k === 'onlinePlayers') { return [ACT.a, ACT.b, ACT.staff]; }
          const v = (store[id] || {})[k];
          return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
        },
        set: function (id, k, v) { put(id, k, v); },
        getDescFromId: function (id) { return id === CRATE.solitude ? '1a001:Skyrim.esm' : id === CRATE.windhelm ? '1a002:Skyrim.esm' : id === CRATE.other ? '1b009:Skyrim.esm' : ''; },
        makeProperty: function () { }
      }
    };
    if (opt.company !== false) { box.__thornswoodCompany = companyRule(opt.calls); }
    if (opt.property) { box.__thornswoodProperty = opt.property; }
    box.globalThis = box;
    vm.createContext(box);
    const back = process.cwd();
    process.chdir(dir);
    try { vm.runInContext(require('../../tests/fixtures/ordinary-quest-items') + blockSrc, box, { filename: 'gamemode.js (trade ships)' }); } finally { process.chdir(back); }
    const ts = box.__thornswoodTradeShips;
    return {
      box: box, ts: ts, store: store, timers: timers, clock: clock, logged: logged,
      say: function (actor, line) { process.chdir(dir); try { return ts.command(line.split(' '), actor, PID[actor]); } finally { process.chdir(back); } },
      press: function (actor, ref, base) { process.chdir(dir); try { return ts.activated(ref, actor, base || 'crate'); } finally { process.chdir(back); } },
      fire: function () { const t = timers.filter(function (x) { return x.live; }).pop(); if (t) { t.live = false; process.chdir(dir); try { t.fn(); } finally { process.chdir(back); } } return t; },
      view: function (actor) { return (store[actor] || {}).thornswoodShipView; },
      pack: function (actor) { return store[actor].inventory.entries; },
      disk: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'trade-cargo.json'), 'utf8')); }
    };
  }
  function server(name, register) {
    const dir = path.join(scratch, name);
    fs.mkdirSync(path.join(dir, 'private'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));
    if (register !== undefined) { fs.writeFileSync(path.join(dir, 'private', 'trade-cargo.json'), register); }
    return dir;
  }
  function count(entries, base) { return entries.filter(function (e) { return e.baseId === base; }).reduce(function (n, e) { return n + e.count; }, 0); }

  let r0 = T.adoptRoutes(T.openRegister(null), ROUTES);
  r0.ships.open(r0.state, 'ship-1', 'solitude');
  const text = T.saveRegister(r0);

  const d1 = server('world', text);
  const calls2 = [];
  const w = start(d1, { calls: calls2 });
  yes('W1 E on a port\'s crate opens the dock, never the container', w.press(ACT.a, CRATE.solitude) === true &&
      w.view(ACT.a).open === true && w.view(ACT.a).mode === 'dock' && w.view(ACT.a).port.key === 'solitude');
  yes('W2 any other container goes on as a container', w.press(ACT.a, CRATE.other, 'container') === false);
  const before = JSON.stringify(w.pack(ACT.a));
  w.say(ACT.a, '/ship load ship-1 f 0 10 ' + ACT.b.toString(16));
  yes('W3 coin is refused before the pack is touched (' + w.view(ACT.a).note + ')', /Coin is not cargo/.test(w.view(ACT.a).note) && JSON.stringify(w.pack(ACT.a)) === before);
  w.say(ACT.a, '/ship load ship-1 5ace4 0 10 ' + ACT.b.toString(16));
  const line1 = w.disk().cargo.holds['ship-1'].lines['1'];
  yes('W4 a load: ten out of the pack and aboard for Onund, through a debit receipt, on disk', count(w.pack(ACT.a), IRON) === 30 && line1.aboard === 10 &&
      line1.for.actor === ACT.b && line1.by.profile === 5001 && /^debit:/.test(line1.receipt));
  yes('W5 the charter was asked once a load, as mayCharter(who, terms)', calls2.length >= 1 && JSON.stringify(calls2[calls2.length - 1].who) === '{"company":true,"staff":false}');
  w.say(ACT.a, '/ship load ship-1 34cdf 0 1 ' + ACT.a.toString(16));
  yes('W6 every field of a stack goes aboard with it', w.disk().cargo.holds['ship-1'].lines['2'].entry.health === 1.2);

  w.press(ACT.b, CRATE.solitude);
  const bBefore = JSON.stringify(w.pack(ACT.b));
  w.say(ACT.b, '/ship sail ship-1 windhelm');
  yes('W7 without the Trading Company\'s charter nobody sails, and is told why', /Only those the Trading Company charters/.test(w.view(ACT.b).note) && !w.disk().cargo.holds['ship-1'].sailing);
  yes('W8 and sees what is aboard, who it is for only where it concerns them, and no pack to load', w.view(ACT.b).holds[0].lines.length === 2 &&
      w.view(ACT.b).holds[0].lines[0].forName === 'you' && w.view(ACT.b).holds[0].lines[1].forName === 'someone else' &&
      w.view(ACT.b).pack.length === 0 && JSON.stringify(w.pack(ACT.b)) === bBefore);

  for (let i = 0; i < 22; i++) { w.say(ACT.a, '/ship load ship-1 5ace4 0 1 ' + ACT.a.toString(16)); }
  yes('W9 one hold carries 24 lines', Object.keys(w.disk().cargo.holds['ship-1'].lines).length === 24 && w.view(ACT.a).holds[0].used === 24 && !w.view(ACT.a).holds[0].canLoad);
  const full = count(w.pack(ACT.a), IRON);
  w.say(ACT.a, '/ship load ship-1 5ace4 0 1 ' + ACT.a.toString(16));
  yes('W10 the 25th is refused before the pack is touched', /The hold is full/.test(w.view(ACT.a).note) && count(w.pack(ACT.a), IRON) === full);

  w.clock.now = 2000000;
  yes('W10b a dock left this long asks for the crate again', /press its crate/.test(w.say(ACT.a, '/ship sail ship-1 windhelm')));
  w.press(ACT.a, CRATE.solitude);
  w.say(ACT.a, '/ship sail ship-1 windhelm');
  const sail = w.disk().cargo.holds['ship-1'].sailing;
  const live = w.timers.filter(function (t) { return t.live; });
  yes('W11 it sails for as long as staff gave the route, and the clock waits for it', !!sail && sail.at === 2000000 && sail.arriveAt === 2000000 + 90 * 60000 &&
      live.length === 1 && live[0].ms === 60 * 60 * 1000);
  w.fire();
  yes('W12 an hour in, it is still at sea and the clock waits again', !!w.disk().cargo.holds['ship-1'].sailing && w.timers.filter(function (t) { return t.live; }).length === 1);
  w.clock.now = sail.arriveAt;
  w.fire();
  yes('W13 at its time it docks on its own, with nobody confirming', w.disk().cargo.holds['ship-1'].sailing === null && w.disk().cargo.holds['ship-1'].port === 'windhelm' &&
      w.logged.some(function (l) { return /1 ship\(s\) docked/.test(l); }));

  w.say(ACT.b, '/ship collect ship-1 1 4');
  yes('W14 at Windhelm the dock is Windhelm\'s crate, so Onund must press it first', /press its crate/.test(w.say(ACT.b, '/ship collect ship-1 1 4')) && count(w.pack(ACT.b), IRON) === 0);
  w.store[ACT.b].pos = [5010, 0, 0];
  w.press(ACT.b, CRATE.windhelm);
  yes('W15 Onund sees what came for him', w.view(ACT.b).holds[0].lines.some(function (l) { return l.canCollect && l.count === 10; }));
  w.say(ACT.b, '/ship collect ship-1 1 4');
  const out = w.disk().cargo.holds['ship-1'].outs[0];
  yes('W16 a collect: four into his pack, the out finished with a credit receipt', count(w.pack(ACT.b), IRON) === 4 && out.how === 'delivered' && /^credit:/.test(out.receipt) &&
      w.disk().cargo.holds['ship-1'].lines['1'].aboard === 6);
  w.store[ACT.a].pos = [5010, 0, 0];
  w.press(ACT.a, CRATE.windhelm);
  w.say(ACT.a, '/ship collect ship-1 1 1');
  yes('W17 nobody else collects it', /Only the person it is for/.test(w.view(ACT.a).note) && count(w.pack(ACT.b), IRON) === 4);
  w.store[ACT.b].pos = [3000, 0, 0];
  yes('W18 walking away from the crate ends the dock', /press its crate/.test(w.say(ACT.b, '/ship collect ship-1 1 1')) && w.view(ACT.b).open === false);

  // Staff: the draft at a crate, the proposal and the confirm.
  yes('W19 only staff open the ports and routes', /Only staff/.test(w.say(ACT.a, '/ship staff')));
  w.say(ACT.staff, '/ship staff');
  yes('W20 staff see the list in force, and no crate yet', w.view(ACT.staff).mode === 'staff' && w.view(ACT.staff).inForce.ports.length === 2 && w.view(ACT.staff).crate === null);
  w.store[ACT.staff].pos = [9000, 0, 0];
  w.press(ACT.staff, CRATE.other, 'container');
  w.say(ACT.staff, '/ship draft port dawnstar dawnstar Dawnstar quay');
  w.say(ACT.staff, '/ship draft route windhelm dawnstar 45');
  const sv3 = w.view(ACT.staff);
  yes('W21 a port at the crate staff just opened, and a route, are a draft and change nothing', sv3.draft.ports.length === 3 && sv3.draft.routes.length === 3 &&
      w.disk().routes.ports.length === 2 && sv3.canConfirm && sv3.changes.length === 2);
  w.say(ACT.staff, '/ship confirm stale.base');
  yes('W22 a confirm against another list is refused', /changed since/.test(w.view(ACT.staff).note) && w.disk().routes.ports.length === 2);
  w.say(ACT.staff, '/ship confirm ' + sv3.base);
  const inForce = w.disk().routes;
  yes('W23 confirmed: the list in force, written, the crate its dock', inForce.ports.length === 3 && inForce.ports[2].crate === '1b009:Skyrim.esm' &&
      inForce.routes.some(function (r) { return r.from === 'windhelm' && r.to === 'dawnstar' && r.minutes === 45; }) &&
      w.logged.some(function (l) { return /staff confirmed the ship list: 3 port\(s\), 3 route\(s\)/.test(l); }));
  w.say(ACT.staff, '/ship add dawnstar');
  yes('W24 staff put a ship at a port', w.disk().cargo.holds['ship-2'].port === 'dawnstar');
  w.press(ACT.staff, CRATE.other, 'container');
  yes('W25 the new crate is a dock now, not a container', w.view(ACT.staff).mode === 'dock' && w.view(ACT.staff).port.key === 'dawnstar');

  // Take back where it was loaded.
  const d2 = server('return', text);
  const w2 = start(d2);
  w2.press(ACT.a, CRATE.solitude);
  w2.say(ACT.a, '/ship load ship-1 5ace4 0 5 ' + ACT.b.toString(16));
  w2.say(ACT.a, '/ship return ship-1 1 5');
  yes('W26 the loader takes it back at the port it was loaded, through a receipt', count(w2.pack(ACT.a), IRON) === 40 &&
      w2.disk().cargo.holds['ship-1'].outs[0].how === 'returned' && /^credit:/.test(w2.disk().cargo.holds['ship-1'].outs[0].receipt));

  // No company rule running.
  const d3 = server('no-company', text);
  const w3 = start(d3, { company: false });
  w3.press(ACT.a, CRATE.solitude);
  w3.say(ACT.a, '/ship load ship-1 5ace4 0 5 ' + ACT.b.toString(16));
  yes('W27 with no Trading Company rule running nobody loads, the pack untouched', /not running/.test(w3.view(ACT.a).note) && count(w3.pack(ACT.a), IRON) === 40);

  // A restart after the ship was due.
  const r9 = T.adoptRoutes(T.openRegister(null), ROUTES);
  r9.ships.open(r9.state, 'ship-1', 'solitude');
  r9.ships.load(r9.state, 'ship-1', { by: { actor: ACT.a, profile: 5001 }, for: { actor: ACT.b, profile: 5002 }, receipt: 'x1', entry: { baseId: IRON, count: 1 } });
  r9.ships.depart(r9.state, 'ship-1', 'windhelm', 10, 20);
  const d4 = server('overdue', T.saveRegister(r9));
  const w4 = start(d4, { clock: { now: 500 } });
  yes('W28 a ship that came due while the server was down docks as it starts', w4.disk().cargo.holds['ship-1'].port === 'windhelm' && w4.disk().cargo.holds['ship-1'].sailing === null);
  const all = w.logged.concat(w2.logged, w3.logged, w4.logged).join('\n');
  yes('W29 the log never says a form id or a profile id', [ACT.a, ACT.b, ACT.staff].every(function (n) { return all.indexOf(n.toString(16)) < 0 && all.indexOf(String(n)) < 0; }) &&
      ['5001', '5002', '5005'].every(function (p) { return all.indexOf(p) < 0; }));

  // ================================================================== X
  const DAY = 24 * 60 * 60 * 1000;
  const PA = { actor: ACT.a, profile: 5001 }, PB = { actor: ACT.b, profile: 5002 };
  function shipped(answer) {
    const calls = [];
    return { calls: calls, boxShipped: function (hold, entry, forName, from) { calls.push({ hold: hold, entry: entry, forName: forName, from: from }); return answer; } };
  }
  const rx = T.adoptRoutes(T.openRegister(null), ROUTES);
  rx.ships.open(rx.state, 'ship-1', 'solitude');
  rx.ships.load(rx.state, 'ship-1', { by: PA, for: PB, receipt: 'x1', entry: { baseId: IRON, count: 5 } });
  rx.ships.load(rx.state, 'ship-1', { by: PA, for: PA, receipt: 'x2', entry: { baseId: SALT, count: 3 } });
  rx.ships.depart(rx.state, 'ship-1', 'windhelm', 10, 20);
  rx.ships.open(rx.state, 'ship-2', 'windhelm');
  rx.ships.load(rx.state, 'ship-2', { by: PB, for: PA, receipt: 'x3', entry: { baseId: IRON, count: 2 } });
  rx.ships.depart(rx.state, 'ship-2', 'solitude', 10, 10 + 365 * DAY);
  const xtext = T.saveRegister(rx);

  const bx = shipped(7);
  const wx = start(server('take', xtext), { clock: { now: 1000 }, property: bx });
  yes('X1 the ship docks as the server starts, landed then', wx.disk().cargo.holds['ship-1'].landed === 1000 && wx.disk().cargo.holds['ship-2'].landed === null);
  wx.store[ACT.b].pos = [5010, 0, 0];
  wx.press(ACT.b, CRATE.windhelm);
  const seen = wx.view(ACT.b).holds[0].lines.filter(function (l) { return l.line === 2; })[0];
  yes('X2 Onund sees Brynja\'s salt aboard, not whose it is, and may take it', !!seen && seen.canTake && seen.forName === 'someone else' && seen.count === 3);
  wx.say(ACT.b, '/ship take ship-1 2 2');
  const tk = wx.disk().cargo.holds['ship-1'].outs.filter(function (o) { return o.how === 'taken'; })[0];
  yes('X3 he takes two: in his pack, and the manifest says taken, by his character, through a receipt', wx.view(ACT.b).note === 'Taken.' && count(wx.pack(ACT.b), SALT) === 2 &&
      !!tk && tk.count === 2 && tk.who.actor === ACT.b && tk.who.profile === 5002 && /^credit:/.test(tk.receipt));
  wx.say(ACT.b, '/ship take ship-2 3 1');
  yes('X4 a hold at sea is at no dock, so nobody opens it', /not at this dock/.test(wx.view(ACT.b).note) && count(wx.pack(ACT.b), IRON) === 0 &&
      wx.disk().cargo.holds['ship-2'].lines['3'].aboard === 2);
  wx.say(ACT.staff, '/ship staff');
  const tl = wx.view(ACT.staff).taken;
  yes('X5 staff see what was taken, from which ship, by which character', tl.length === 1 && tl[0].hold === 'ship-1' && tl[0].by === 'Onund' && tl[0].count === 2 && tl[0].at === 1000);
  yes('X6 and the days cargo waits, 7 by default', wx.view(ACT.staff).inForce.days === 7);
  const lx = wx.timers.filter(function (t) { return t.live; });
  yes('X7 the clock waits an hour at most for the seventh day', lx.length === 1 && lx[0].ms === 60 * 60 * 1000);
  wx.clock.now = 1000 + 7 * DAY - 1;
  wx.fire();
  yes('X8 a moment short of seven days nothing moves', bx.calls.length === 0 && wx.disk().cargo.holds['ship-1'].lines['1'].aboard === 5);
  wx.clock.now = 1000 + 7 * DAY;
  wx.fire();
  const outs = wx.disk().cargo.holds['ship-1'].outs.filter(function (o) { return o.how === 'left'; });
  yes('X9 at seven days both lines go into Windhelm\'s drop box, each under its recipient\'s name', bx.calls.length === 2 &&
      bx.calls.every(function (c) { return c.hold === 'windhelm'; }) &&
      bx.calls.some(function (c) { return c.forName === 'Onund' && c.entry.baseId === IRON && c.entry.count === 5; }) &&
      bx.calls.some(function (c) { return c.forName === 'Brynja' && c.entry.baseId === SALT && c.entry.count === 1; }));
  yes('X10 the manifest says left, through a box receipt, and nothing is aboard or pending', outs.length === 2 && outs.every(function (o) { return /^box:/.test(o.receipt); }) &&
      T.countsOf(T.openRegister(JSON.stringify(wx.disk()))).pending === 0 &&
      wx.disk().cargo.holds['ship-1'].lines['1'].aboard === 0 && wx.disk().cargo.holds['ship-1'].lines['2'].aboard === 0);
  wx.press(ACT.b, CRATE.windhelm);
  yes('X11 and the ship is free again: no line used', wx.view(ACT.b).holds[0].used === 0 && wx.view(ACT.b).holds[0].lines.length === 0);
  yes('X12 the log says how many, never who', wx.logged.some(function (l) { return /2 line\(s\) nobody collected went into the drop box/.test(l); }) &&
      wx.logged.every(function (l) { return l.indexOf('Onund') < 0 && l.indexOf('Brynja') < 0; }));
  wx.say(ACT.staff, '/ship draft days 0');
  yes('X13 staff set the days: none is refused', /whole number from 1 to 60/.test(wx.view(ACT.staff).note));
  wx.say(ACT.staff, '/ship draft days 3');
  const sv4 = wx.view(ACT.staff);
  yes('X14 three is a draft, and the proposal says so', sv4.draft.days === 3 && sv4.changes.some(function (c) { return /after 3 days, not 7/.test(c); }) && sv4.canConfirm);
  wx.say(ACT.staff, '/ship confirm ' + sv4.base);
  yes('X15 confirmed, it is in force on disk', wx.disk().routes.uncollectedDays === 3);

  const bad = shipped(0);
  const wy = start(server('box-refused', xtext), { clock: { now: 1000 }, property: bad });
  wy.clock.now = 1000 + 7 * DAY;
  wy.fire();
  yes('X16 a drop box that will not take it leaves every piece aboard, nothing pending', bad.calls.length === 2 &&
      wy.disk().cargo.holds['ship-1'].lines['1'].aboard === 5 && T.countsOf(T.openRegister(JSON.stringify(wy.disk()))).pending === 0);
  wy.clock.now = 1000 + 7 * DAY + 2 * 60 * 60 * 1000;
  for (let i = 0; i < 5; i++) { wy.fire(); }
  yes('X17 and is not tried again on a clock: hours on, the box was asked nothing more', bad.calls.length === 2 &&
      wy.disk().cargo.holds['ship-1'].lines['1'].aboard === 5);
  wy.say(ACT.staff, '/ship add windhelm');
  for (let i = 0; i < 5 && bad.calls.length === 2; i++) { wy.fire(); }
  yes('X17b the next change to the register that goes through looks at it again', bad.calls.length === 4 &&
      wy.disk().cargo.holds['ship-1'].lines['1'].aboard === 5);
  const wz = start(server('no-boxes', xtext), { clock: { now: 1000 } });
  wz.clock.now = 1000 + 7 * DAY;
  wz.fire();
  yes('X18 with no drop boxes running, it waits aboard and the log says so', wz.disk().cargo.holds['ship-1'].lines['1'].aboard === 5 &&
      wz.logged.some(function (l) { return /drop boxes are not running/.test(l); }));

  const old = JSON.parse(xtext);
  old.cargo.holds['ship-2'].sailing = null; old.cargo.holds['ship-2'].port = 'windhelm';
  delete old.cargo.holds['ship-2'].landed;
  const oldText = JSON.stringify(old);
  const wo = start(server('before-landed', oldText), { clock: { now: 4000 } });
  yes('X19 a register whose ship does not say when it landed is refused whole, not carried over (alpha), and left as it was',
      wo.logged.some(function (l) { return /could not be read \(Hold ship-2's landing cannot be verified/.test(l); }) &&
      JSON.stringify(wo.disk()) === JSON.stringify(old));
  const allx = wx.logged.concat(wy.logged, wz.logged, wo.logged).join('\n');
  yes('X20 the log never says a form id or a profile id', [ACT.a, ACT.b, ACT.staff].every(function (n) { return allx.indexOf(n.toString(16)) < 0 && allx.indexOf(String(n)) < 0; }) &&
      ['5001', '5002', '5005'].every(function (p) { return allx.indexOf(p) < 0; }));

  // ================================================================== R
  const onAct = gm.slice(gm.indexOf("mp.onActivate = guard('onActivate'"), gm.indexOf('const shut = benchGate(casterRefrId, baseDesc);'));
  yes('R1 mp.onActivate asks the dock first and answers false for a crate', /shipsDock\.activated\(refrId, casterRefrId, baseDesc\)\) \{\s*return false;/.test(onAct));
  const WORDS = new Function('return ' + /const WORDS = (\[[\s\S]*?\]);/.exec(gm)[1])();
  const PW = /PLAYER_WORDS = (\[[\s\S]*?\]);/.exec(gm);
  yes('R2 /ship is a word, and not one a player is told to type', WORDS.indexOf('/ship') >= 0 && !!PW && PW[1].indexOf("'/ship'") < 0);
  yes('R3 the word reaches the dock', /if \(word === '\/ship'\) \{[\s\S]{0,400}shipsApi\.command\(parts, actorId, profileId\)/.test(gm));
  const skills = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-skills.js'), 'utf8');
  yes('R4 the Office page offers staff Ports and routes while the ships are on', /if \(o\.ships\) wrap\.appendChild\(officeShips\(\)\)/.test(skills) &&
      /officeButton\('Ports and routes', '\/ship staff'\)/.test(skills) && /ships: staff && !!\(g\.__thornswoodTradeShips && g\.__thornswoodTradeShips\.command\)/.test(gm));
  const front = fs.readFileSync(path.join(REPO, 'game', 'plugins', 'thornswood-front.js'), 'utf8');
  yes('R5 the front plugin loads the panel and lets its focus go', /'thornswood-ship\.js'[,\]]/.test(front) && /ship: 'thornswoodShip'/.test(front) &&
      /'ship:closed'\) \{ T\.claimFocus\('ship', false\)/.test(front));

  // ================================================================== U
  const u = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-TradeCargoGamemode.js'), '--check'], { encoding: 'utf8' });
  yes('U1 the bundles in gamemode.js are game\\trade-cargo.js and game\\trade-ship-dock.js as they are' + (u.status ? ': ' + (u.stderr || '').split('\n')[0] : ''), u.status === 0);
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
}
done();
