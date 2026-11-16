// test-1394-fares.js
//
// #1394. A carriage or ferry fare is taken out of the pack and counted on the
// ledger of the hold the ride leaves from. A pack that is short does not ride
// and loses nothing. The fare is moved, never created, and it is not the
// driver's purse. The route list is the collection's own drivers, and there
// is no word that skips standing at one. Fast travel stays off. Solitude's
// carriage is Solitude's, a ride that started at the embassy included.
// The fares are Patrick's answers on #1394 (4 Oct), and E on a driver opens
// a panel of his stops rather than an answer in the chat (#1635,
// game/tests/test-1635-ride-panel.js).
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
const front = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const GOLD = 0x0000000F;
const block = slice(gm, '// ==== thornswood carriages ====', '// ==== end thornswood carriages ====');
const takeSrc = slice(gm, '  function takeGold(actorId, amount) {', '\n  }\n');
const depositSrc = slice(gm, '  var LEDGER_HOLDS = [', '\n  }\n');
yes('the carriages block is in the gamemode', block !== null);
yes('takeGold and deposit are in the property block', !!takeSrc && !!depositSrc && depositSrc.indexOf('function deposit(') > 0);

const boxSrc = ['  function dropboxOf(hold) {', '  function boxLog(hold, row) {',
                '  function boxFare(hold, amount, reason) {'].map(function (f) { return slice(gm, f, '\n  }\n'); });
// What each hold's drop box holds of fares (#2298: a fare goes into the box as real gold, not onto the ledger).
function fareBox(dropbox) {
  function row(k) {
    const d = dropbox[k];
    const r = d && d.items && d.items.filter(function (i) { return i.kind === 'fare'; })[0];
    return r ? r.count : undefined;
  }
  return new Proxy({}, {
    get: function (t, k) { return typeof k === 'string' ? row(k) : undefined; },
    ownKeys: function () { return Object.keys(dropbox).filter(function (k) { return row(k) !== undefined; }); },
    getOwnPropertyDescriptor: function (t, k) {
      return row(k) === undefined ? undefined : { enumerable: true, configurable: true, value: row(k) };
    }
  });
}
/* The real takeGold, deposit and boxFare, over a ledger and drop boxes the test can read.
   funds here is the fares in each hold's box; ledger is the fee ledger, which a fare never touches. */
function ledger(mp) {
  const funds = {};
  const dropbox = {};
  const saved = [];
  const fn = new Function('mp', 'funds', 'save', 'plog', 'GOLD_ID', 'dropbox', 'BOX_LOG_KEEP',
    takeSrc + '\n' + depositSrc + '\n' + boxSrc.join('\n') +
    '\nreturn { takeGold: takeGold, deposit: deposit, boxFare: boxFare, LEDGER_HOLDS: LEDGER_HOLDS };');
  const api = fn(mp, funds, function () { saved.push(JSON.stringify(dropbox)); }, function () { }, GOLD, dropbox, 500);
  api.ledger = funds;
  api.funds = fareBox(dropbox);
  api.saved = saved;
  return api;
}

/* A pretend world: a few forms the server can read and set. */
function world() {
  const forms = {};
  const sets = [];
  const refs = {};
  const mp = {
    getIdFromDesc: function (desc) { return refs[desc] || 0; },
    get: function (id, key) {
      const f = forms[id];
      if (!f) { throw new Error('no form ' + id); }
      if (key === 'worldOrCellDesc') { return f.cell; }
      if (key === 'pos') { return f.pos.slice(); }
      if (key === 'baseDesc') { return f.base || ''; }
      if (key === 'inventory') { return { entries: f.inv.map(function (e) { return Object.assign({}, e); }) }; }
      if (key === 'profileId') { return f.pid || -1; }
      throw new Error('no property ' + key);
    },
    set: function (id, key, value) {
      sets.push({ id: id, key: key, value: JSON.parse(JSON.stringify(value)) });
      const f = forms[id];
      if (!f) { throw new Error('no form ' + id); }
      if (key === 'inventory') { f.inv = value.entries.map(function (e) { return Object.assign({}, e); }); return; }
      if (key === 'locationalData') {
        if (f.failMove) { throw new Error('the move failed'); }
        f.cell = value.cellOrWorldDesc;
        f.pos = value.pos.slice();
        return;
      }
      // The ride panel's view, its owner's only (#1635).
      if (key === 'thornswoodRideView') { f.view = JSON.parse(JSON.stringify(value)); return; }
      throw new Error('set ' + key);
    }
  };
  return { forms: forms, sets: sets, mp: mp, refs: refs };
}

function gold(f) {
  let n = 0;
  f.inv.forEach(function (e) { if (e.baseId === GOLD) { n += e.count; } });
  return n;
}

let clock = 1000000;
function rig(extraProp) {
  const w = world();
  const L = ledger(w.mp);
  const box = {
    mp: w.mp, console: { log: function () { } },
    Date: { now: function () { return clock; } }
  };
  box.globalThis = box;
  box.__thornswoodProperty = Object.assign({ takeGold: L.takeGold, deposit: L.deposit, boxFare: L.boxFare }, extraProp || {});
  vm.runInNewContext(block, box);
  return { w: w, L: L, C: box.__thornswoodCarriages, box: box };
}

let C0 = null;
if (block && takeSrc && depositSrc) {
  try { C0 = rig().C; } catch (e) { console.log('the block would not run: ' + e); }
}
yes('the block runs and registers itself', !!C0 && Array.isArray(C0.STOPS));

if (C0) {
  const S = C0.STOPS;
  const by = function (key) { return C0.stopByKey(key); };
  // The stops a driver stands at, and the ones nobody drives from (#1394,
  // read out of CFTO.esp on 11 Oct: the villages, the Hearthfire homes, the
  // Thalmor Embassy and the small ferry landings).
  const D = S.filter(function (s) { return !!s.driver; });
  const V = S.filter(function (s) { return !s.driver; });

  // ------------------------------------------------------------ the list
  const pop = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'npc-population.json'), 'utf8'));
  const workers = pop.npcs.filter(function (n) { return n.role === 'transport'; });
  const BOOK = { Whiterun: 'whiterun', Haafingar: 'solitude', 'the Rift': 'riften', 'the Reach': 'markarth',
    Eastmarch: 'windhelm', Falkreath: 'falkreath', Hjaalmarch: 'morthal', 'the Pale': 'dawnstar',
    Winterhold: 'winterhold', Solstheim: 'ravenrock' };
  yes('every carriage and ferry worker in the population data has a stop, ' + workers.length + ' of them',
    workers.length === D.length && workers.every(function (n) {
      return D.some(function (s) { return s.ref === n.ref; });
    }));
  const drift = D.filter(function (s) {
    const n = workers.filter(function (w) { return w.ref === s.ref; })[0];
    if (!n) { return true; }
    const close = [0, 1, 2].every(function (i) { return Math.abs(n.pos[i] - s.pos[i]) <= 0.1; });
    return n.base !== s.base || n.world !== s.world || !close || BOOK[n.hold] !== s.hold ||
      n.name !== s.driver;
  });
  yes('every stop is its driver as the data has him: base, world, spot, hold and name' +
    (drift.length ? ' (not: ' + drift.map(function (s) { return s.key; }).join(', ') + ')' : ''), drift.length === 0);
  const keys = {}, bases = {};
  S.forEach(function (s) { keys[s.key] = (keys[s.key] || 0) + 1; });
  D.forEach(function (s) { bases[s.base] = (bases[s.base] || 0) + 1; });
  yes('no two stops share a key or a driver', Object.keys(keys).length === S.length && Object.keys(bases).length === D.length);

  // ------------------------------------------------------------ nobody drives from
  yes('26 stops nobody drives from: 19 by carriage and 7 ferry landings', V.length === 26 &&
    V.filter(function (s) { return s.line === 'carriage'; }).length === 19);
  yes('each lands on the mod\'s own marker, and has no driver, base or reference of its own',
    V.every(function (s) { return /^[0-9a-f]+:CFTO\.esp$/.test(s.marker) && !s.base && !s.ref; }));
  yes('each has a world and a point', V.every(function (s) {
    return (s.world === '3c:Skyrim.esm' || s.world === C0.SOLSTHEIM) && s.pos.length === 3 &&
      s.pos.every(Number.isFinite) && Number.isFinite(s.rot);
  }));
  yes('no two of them land on the same marker on the same line', V.every(function (a) {
    return V.filter(function (b) { return b.line === a.line && b.marker === a.marker; }).length === 1;
  }));
  const at = function (key, hold, marker) { const s = by(key); return !!s && !s.driver && s.hold === hold && s.marker === marker; };
  yes('the mod\'s holds: Riverwood and Rorikstead are Whiterun\'s, Karthwasten the Reach\'s, Nightgate Inn and Heljarchen Hall the Pale\'s',
    at('carriage:riverwood', 'whiterun', 'b6e4e:CFTO.esp') && at('carriage:rorikstead', 'whiterun', 'b6e55:CFTO.esp') &&
    at('carriage:karthwasten', 'markarth', 'b6e50:CFTO.esp') && at('carriage:nightgateinn', 'dawnstar', 'b6e59:CFTO.esp') &&
    at('carriage:heljarchenhall', 'dawnstar', 'cb328:CFTO.esp'));
  yes('the embassy and Dragon Bridge are under Haafingar\'s carriage, Windstad Manor under Hjaalmarch\'s, Lakeview Manor under Falkreath\'s',
    at('carriage:thalmorembassy', 'solitude', 'b6e54:CFTO.esp') && at('carriage:dragonbridge', 'solitude', 'b6e53:CFTO.esp') &&
    at('carriage:windstadmanor', 'morthal', 'cb327:CFTO.esp') && at('carriage:lakeviewmanor', 'falkreath', 'cb326:CFTO.esp'));
  yes('the landings sit on the water the mod puts them on: Windstad and Frostflow the coast, Honeyside Lake Honrich, Lakeview and Ilinalta\'s Deep Lake Ilinalta, Bujold\'s Retreat and Northshore Solstheim',
    at('coast:windstadmanor', 'morthal', '14c86:CFTO.esp') && at('coast:frostflowlighthouse', 'winterhold', '38411:CFTO.esp') &&
    at('honrich:honeyside', 'riften', '14c8e:CFTO.esp') && at('ilinalta:lakeviewmanor', 'falkreath', '14c7e:CFTO.esp') &&
    at('ilinalta:ilinaltasdeep', 'falkreath', '3840e:CFTO.esp') && at('solstheim:bujoldsretreat', 'ravenrock', '3840d:CFTO.esp') &&
    at('solstheim:northshorelanding', 'ravenrock', '3840c:CFTO.esp') && by('solstheim:northshorelanding').world === C0.SOLSTHEIM);
  yes('Riverwood is where the mod\'s marker stands', by('carriage:riverwood').pos.join() === [23877.3, -42735.3, -25.0].join());
  yes('nobody rides from a stop nobody drives from', V.every(function (v) {
    return S.every(function (s) { return C0.fare(v, s) === 0; }) && C0.destinations(v).length === 0;
  }));
  const L0 = ledger(world().mp);
  yes('every stop\'s hold is one of the ten ledgers', S.every(function (s) { return L0.LEDGER_HOLDS.indexOf(s.hold) >= 0; }));
  yes('every stop is on a line the block knows', S.every(function (s) { return !!C0.LINES[s.line]; }));
  const carriages = D.filter(function (s) { return s.line === 'carriage'; });
  const nine = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm', 'falkreath', 'morthal', 'dawnstar', 'winterhold'];
  yes('a carriage in every hold: nine, one in each mainland hold',
    carriages.length === 9 && nine.every(function (h) { return carriages.filter(function (s) { return s.hold === h; }).length === 1; }));
  const isle = D.filter(function (s) { return s.world === C0.SOLSTHEIM; });
  yes('the stops on Solstheim are the island ferry\'s three and the Northern Maiden\'s Raven Rock, all Raven Rock\'s',
    isle.length === 4 && isle.every(function (s) { return s.hold === 'ravenrock'; }) &&
    isle.filter(function (s) { return s.line === 'solstheim'; }).length === 3 && !!by('maiden:ravenrock') &&
    isle.indexOf(by('maiden:ravenrock')) >= 0);
  yes('Solitude\'s carriage, ferry and lighthouse are all Solitude\'s',
    by('carriage:solitude').hold === 'solitude' && by('coast:solitude').hold === 'solitude' &&
    by('coast:solitudelighthouse').hold === 'solitude');

  // ------------------------------------------------------------ the fares
  yes('a carriage between two holds is 20', C0.fare(by('carriage:whiterun'), by('carriage:solitude')) === 20);
  yes('every carriage ride on the list is 20', carriages.every(function (a) {
    return carriages.every(function (b) { return a === b ? C0.fare(a, b) === 0 : C0.fare(a, b) === 20; });
  }));
  yes('a ferry is 10', C0.fare(by('coast:solitude'), by('coast:windhelm')) === 10 &&
    C0.fare(by('honrich:riften'), by('honrich:ivarstead')) === 10 &&
    C0.fare(by('ilinalta:halfmoonmill'), by('ilinalta:guardianstones')) === 10);
  yes('the Northern Maiden is 40 each way: the crossing between the mainland and Solstheim',
    C0.fare(by('maiden:windhelm'), by('maiden:ravenrock')) === 40 &&
    C0.fare(by('maiden:ravenrock'), by('maiden:windhelm')) === 40);
  yes('the Solstheim ferry is 10 between any two of its stops, Raven Rock included (Patrick, 4 Oct)',
    C0.fare(by('solstheim:ravenrock'), by('solstheim:skaalvillage')) === 10 &&
    C0.fare(by('solstheim:telmithryn'), by('solstheim:ravenrock')) === 10 &&
    C0.fare(by('solstheim:skaalvillage'), by('solstheim:telmithryn')) === 10);
  yes('a carriage to a stop in the same hold is 10, and between holds 20',
    C0.fare(by('carriage:whiterun'), by('carriage:riverwood')) === 10 &&
    C0.fare(by('carriage:whiterun'), by('carriage:rorikstead')) === 10 &&
    C0.fare(by('carriage:whiterun'), by('carriage:karthwasten')) === 20 &&
    C0.fare(by('carriage:solitude'), by('carriage:thalmorembassy')) === 10 &&
    C0.fare(by('carriage:whiterun'), by('carriage:riften')) === 20);
  yes('a ferry to a landing is 10 like any ferry', C0.fare(by('coast:dawnstar'), by('coast:frostflowlighthouse')) === 10 &&
    C0.fare(by('solstheim:ravenrock'), by('solstheim:northshorelanding')) === 10 &&
    C0.fare(by('honrich:riften'), by('honrich:honeyside')) === 10);
  yes('a ride off its own line is not on the list',
    C0.fare(by('carriage:whiterun'), by('coast:solitude')) === 0 &&
    C0.fare(by('coast:windhelm'), by('maiden:ravenrock')) === 0);
  yes('no carriage goes to Solstheim', carriages.every(function (c) {
    return C0.destinations(c).every(function (d) { return d.world !== C0.SOLSTHEIM; });
  }));
  yes('a ferryman goes to every other stop on his water',
    C0.destinations(by('coast:dawnstar')).length === 8 && C0.destinations(by('honrich:riften')).length === 3 &&
    C0.destinations(by('ilinalta:guardianstones')).length === 4 && C0.destinations(by('solstheim:ravenrock')).length === 4);
  yes('every carriage driver goes to every village and home as well as the other eight holds',
    carriages.every(function (c) { return C0.destinations(c).length === 27; }));

  // ------------------------------------------------------------ riding
  const ME = 0x14, PID = 7;
  function person(r, at, coins, dx) {
    r.w.forms[ME] = { cell: at.world, pos: [at.pos[0] + (dx || 0), at.pos[1], at.pos[2]], pid: PID,
      inv: coins ? [{ baseId: GOLD, count: coins }, { baseId: 0x12eb7, count: 1 }] : [{ baseId: 0x12eb7, count: 1 }] };
    return r.w.forms[ME];
  }
  function moves(r) { return r.w.sets.filter(function (x) { return x.key === 'locationalData'; }); }
  function say(r, words) {
    const out = [];
    r.C.command(words.split(' '), ME, PID, function (pid, text) { out.push(text); });
    return out.join(' | ');
  }

  // A short pack.
  {
    const r = rig();
    const me = person(r, by('carriage:whiterun'), 19, 100);
    const was = me.pos.slice();
    const line = say(r, '/ride solitude');
    yes('a short pack is told the fare and that nothing was taken', /20 gold and you do not have it\. Nothing was taken/.test(line));
    yes('a short pack keeps every coin', gold(me) === 19);
    yes('a short pack does not move', moves(r).length === 0 && me.pos.join() === was.join() && me.cell === '3c:Skyrim.esm');
    yes('and the ledger is untouched', !r.L.funds.whiterun && r.L.saved.length === 0);
    const r2 = rig();
    const broke = person(r2, by('carriage:whiterun'), 0, 50);
    yes('an empty pack does not ride either', /do not have it/.test(say(r2, '/ride solitude')) && moves(r2).length === 0 && gold(broke) === 0);
  }

  // A ride.
  {
    const r = rig();
    const me = person(r, by('carriage:whiterun'), 50, 120);
    const line = say(r, '/ride solitude');
    yes('a ride says what it cost and where it went', line === 'You pay the 20 gold fare and ride to Solitude.');
    yes('the fare left the pack', gold(me) === 30);
    // Since #2298 a fare goes into the departure hold's drop box, as real gold.
    yes('the fare is in the departure hold\'s drop box afterwards, and saved', r.L.funds.whiterun === 20 && r.L.saved.length === 1 &&
      JSON.parse(r.L.saved[0]).whiterun.items[0].count === 20);
    yes('and in no other box, and never on the fee ledger', Object.keys(r.L.funds).join() === 'whiterun' &&
      !r.L.ledger.whiterun);
    yes('the coin was moved, not made: pack and ledger still add to 50', gold(me) + r.L.funds.whiterun === 50);
    const t = by('carriage:solitude');
    yes('one move, onto Solitude\'s carriage stop', moves(r).length === 1 && me.cell === t.world &&
      me.pos.join() === t.pos.join());
    yes('nothing was set on anybody but the rider', r.w.sets.every(function (x) { return x.id === ME; }));
    yes('the other items in the pack are untouched', me.inv.some(function (e) { return e.baseId === 0x12eb7 && e.count === 1; }));
    yes('the rider is now at Solitude\'s stop and cannot ride Solitude again',
      /No ride to solitude/.test(say(r, '/ride solitude')) && gold(me) === 30);
    const second = say(r, '/ride whiterun');
    yes('and a ride back goes onto Solitude\'s ledger', /ride to Whiterun/.test(second) && r.L.funds.solitude === 20 && r.L.funds.whiterun === 20 && gold(me) === 10);
  }

  // The driver's purse.
  {
    const r = rig();
    const DRIVER = 0xff000a01;
    const t = by('carriage:whiterun');
    r.w.forms[DRIVER] = { cell: t.world, pos: t.pos.slice(), base: t.base, inv: [{ baseId: GOLD, count: 5 }] };
    person(r, t, 25, 60);
    say(r, '/ride e ' + DRIVER.toString(16));
    say(r, '/ride markarth');
    yes('the fare is not the driver\'s purse: his pack is as it was', gold(r.w.forms[DRIVER]) === 5 && r.L.funds.whiterun === 20);
  }

  // No word skips the driver.
  {
    const r = rig();
    const me = person(r, by('carriage:whiterun'), 100, 5000);
    const line = say(r, '/ride solitude');
    yes('away from any driver, /ride refuses', /Walk up to a carriage or ferry driver first/.test(line));
    yes('and takes nothing and moves nobody', gold(me) === 100 && moves(r).length === 0 && !r.L.funds.whiterun);
    const r2 = rig();
    person(r2, by('carriage:whiterun'), 100, 401);
    yes('401 from the driver\'s spot is out of reach', /Walk up to a carriage/.test(say(r2, '/ride solitude')) && moves(r2).length === 0);
    const r3 = rig();
    person(r3, by('carriage:whiterun'), 100, 399);
    yes('399 is in reach', /ride to Solitude/.test(say(r3, '/ride solitude')));
    const r4 = rig();
    const there = person(r4, by('carriage:whiterun'), 100, 0);
    there.cell = 'somewhere:Else.esp';
    yes('the right numbers in another cell are not the stop', /Walk up to a carriage/.test(say(r4, '/ride solitude')));
  }

  // What the driver offers, and what is not on the list.
  {
    const r = rig();
    const me = person(r, by('carriage:whiterun'), 100, 10);
    const offer = say(r, '/ride');
    const v = me.view || {};
    const fares = (v.stops || []).map(function (s) { return s.name + ' ' + s.fare; });
    yes('/ride alone at a driver opens his panel of stops and fares, and says nothing in the chat', offer === '' &&
      v.open === true && v.driver === 'Bjorlam' && v.what === 'the carriage' && v.from === 'Whiterun' &&
      fares.indexOf('Solitude 20') >= 0 && fares.indexOf('Winterhold 20') >= 0 && fares.length === 27 &&
      fares.indexOf('Riverwood 10') >= 0 && fares.indexOf('Rorikstead 10') >= 0 && fares.indexOf('Karthwasten 20') >= 0 &&
      !fares.some(function (f) { return /^Whiterun/.test(f); }) && v.ledger === 'Whiterun');
    yes('a stop on another line is refused', /No ride to raven rock/.test(say(r, '/ride raven rock')) &&
      /No ride to honeyside/.test(say(r, '/ride honeyside')));
    yes('a stop the list does not have is refused', /No ride to/.test(say(r, '/ride high hrothgar')) &&
      /No ride to/.test(say(r, '/ride icewater jetty')));
    yes('and none of that took gold or moved anybody', gold(me) === 100 && moves(r).length === 0 && !r.L.funds.whiterun);
    yes('the start of one name is enough', /ride to Markarth/.test(say(r, '/ride mark')));
  }

  // A village in the same hold.
  {
    const r = rig();
    const me = person(r, by('carriage:whiterun'), 15, 10);
    const line = say(r, '/ride riverwood');
    const t = by('carriage:riverwood');
    yes('Whiterun\'s carriage to Riverwood is 10 onto Whiterun\'s ledger', line === 'You pay the 10 gold fare and ride to Riverwood.' &&
      r.L.funds.whiterun === 10 && gold(me) === 5);
    yes('and puts you down on the mod\'s Riverwood marker', moves(r).length === 1 && me.cell === t.world && me.pos.join() === t.pos.join());
    yes('nobody drives from Riverwood, so there is no ride back from where you landed', /Walk up to a carriage/.test(say(r, '/ride whiterun')) &&
      gold(me) === 5);
  }

  // Solitude's carriage is Solitude's.
  {
    const r = rig({ holdStanding: function () { return 'embassy'; } });
    const me = person(r, by('carriage:solitude'), 40, 30);
    say(r, '/ride whiterun');
    yes('a ride from Solitude\'s carriage, walked to from the embassy, is on Solitude\'s ledger',
      r.L.funds.solitude === 20 && !r.L.funds.embassy && !r.L.funds.whiterun && gold(me) === 20);
    const r2 = rig();
    person(r2, by('coast:solitudelighthouse'), 10, 0);
    say(r2, '/ride dawnstar');
    yes('the lighthouse ferry is Solitude\'s too, at 10', r2.L.funds.solitude === 10);
    const L1 = ledger(world().mp);
    yes('the embassy has no ledger to put a fare on', L1.deposit('embassy', 20, 'test') === false && !L1.funds.embassy);
  }

  // Raven Rock.
  {
    const r = rig();
    const me = person(r, by('maiden:windhelm'), 40, 0);
    say(r, '/ride raven rock');
    yes('Windhelm to Raven Rock is 40 onto Windhelm\'s ledger', r.L.funds.windhelm === 40 && gold(me) === 0);
    yes('and lands on Solstheim', me.cell === '800:Dragonborn.esm');
    me.inv = [{ baseId: GOLD, count: 39 }];
    yes('39 does not cross back', /40 gold and you do not have it/.test(say(r, '/ride windhelm')) && me.cell === '800:Dragonborn.esm');
    me.inv = [{ baseId: GOLD, count: 45 }];
    say(r, '/ride windhelm');
    yes('40 does, onto Raven Rock\'s ledger', r.L.funds.ravenrock === 40 && gold(me) === 5 && me.cell === '3c:Skyrim.esm');
  }

  // Pressing E on a driver who has wandered off his spot.
  {
    const r = rig();
    const t = by('carriage:whiterun');
    const DRIVER = 0xff000123, OTHER = 0xff000777;
    r.w.forms[DRIVER] = { cell: t.world, pos: [t.pos[0] + 450, t.pos[1], t.pos[2]], base: t.base, inv: [] };
    r.w.forms[OTHER] = { cell: t.world, pos: [t.pos[0] + 700, t.pos[1], t.pos[2]], base: '13bbf:Skyrim.esm', inv: [] };
    const me = person(r, t, 60, 700);
    yes('700 from the spot and no press is not a stop', /Walk up to a carriage/.test(say(r, '/ride solitude')));
    yes('a press on somebody who is not a driver says nothing', say(r, '/ride e ' + OTHER.toString(16)) === '');
    const offer = say(r, '/ride e ' + DRIVER.toString(16));
    yes('a press on the driver opens his panel', offer === '' && !!me.view && me.view.open === true &&
      me.view.driver === 'Bjorlam' && me.view.stops.length === 27);
    yes('and then the ride goes from him', /ride to Solitude/.test(say(r, '/ride solitude')) && r.L.funds.whiterun === 20 && gold(me) === 40);

    const r2 = rig();
    r2.w.forms[DRIVER] = { cell: t.world, pos: [t.pos[0] + 450, t.pos[1], t.pos[2]], base: t.base, inv: [] };
    person(r2, t, 60, 1100);
    yes('a press from 650 away is told to walk up', /Walk up to Bjorlam/.test(say(r2, '/ride e ' + DRIVER.toString(16))) &&
      /Walk up to a carriage/.test(say(r2, '/ride solitude')));

    /*
      A press lasts while that driver is in reach, however long the panel
      has been open (#1635), and is forgotten once he is out of it.
    */
    const r3 = rig();
    r3.w.forms[DRIVER] = { cell: t.world, pos: [t.pos[0] + 450, t.pos[1], t.pos[2]], base: t.base, inv: [] };
    const me3 = person(r3, t, 60, 700);
    say(r3, '/ride e ' + DRIVER.toString(16));
    clock += 10 * 60 * 1000;
    me3.pos[0] = t.pos[0] + 5000;
    yes('a press is forgotten once you are out of his reach', /Walk up to a carriage/.test(say(r3, '/ride solitude')) && moves(r3).length === 0);
    me3.pos[0] = t.pos[0] + 700;
    yes('and walking back to him without a new press does not bring the old one back',
      /Walk up to a carriage/.test(say(r3, '/ride solitude')) && moves(r3).length === 0);
    const r4 = rig();
    r4.w.forms[DRIVER] = { cell: t.world, pos: [t.pos[0] + 450, t.pos[1], t.pos[2]], base: t.base, inv: [] };
    const me4 = person(r4, t, 60, 700);
    say(r4, '/ride e ' + DRIVER.toString(16));
    clock += 10 * 60 * 1000;
    yes('a press ten minutes old still counts while he is in reach, so a panel left open still rides',
      /ride to Solitude/.test(say(r4, '/ride solitude')) && r4.L.funds.whiterun === 20 && gold(me4) === 40);
  }

  // A driver standing off his spot, on his own placed reference.
  {
    const r = rig();
    const t = by('carriage:whiterun');
    const REF = 0x123456;
    r.w.refs[t.ref] = REF;
    r.w.forms[REF] = { cell: t.world, pos: [t.pos[0] + 450, t.pos[1], t.pos[2]], base: t.base, inv: [] };
    const me = person(r, t, 60, 750);
    yes('a driver off his spot is found where he stands now, without a press',
      /ride to Solitude/.test(say(r, '/ride solitude')) && r.L.funds.whiterun === 20 && gold(me) === 40);
    const r2 = rig();
    r2.w.refs[t.ref] = REF;
    r2.w.forms[REF] = { cell: t.world, pos: [t.pos[0] + 450, t.pos[1], t.pos[2]], base: t.base, inv: [] };
    person(r2, t, 60, 900);
    yes('and 450 from him is still too far', /Walk up to a carriage/.test(say(r2, '/ride solitude')) && moves(r2).length === 0);
  }

  // The move fails.
  {
    const r = rig();
    const me = person(r, by('honrich:riften'), 50, 0);
    me.failMove = true;
    const line = say(r, '/ride ivarstead');
    yes('a move that fails takes nothing', /nothing was taken/.test(line) && gold(me) === 50);
    yes('and puts nothing on the ledger', !r.L.funds.riften && r.L.saved.length === 0);
  }

  // The pack could pay, and then the server could not write it.
  {
    const r = rig({ takeGold: function () { return false; } });
    const at = by('honrich:riften');
    const me = person(r, at, 50, 0);
    const line = say(r, '/ride ivarstead');
    yes('a fare that cannot be taken is no ride: back at the stop they left',
      /ride did not go/.test(line) && me.cell === at.world && me.pos.join() === at.pos.join() && moves(r).length === 2);
    yes('with every coin and nothing on the ledger', gold(me) === 50 && !r.L.funds.riften);
  }

  // Nobody in the world.
  {
    const r = rig();
    const out = [];
    r.C.command(['/ride', 'solitude'], 0, PID, function (pid, text) { out.push(text); });
    yes('no character, no ride', /not in the world/.test(out.join()));
  }

  // The ledger itself.
  {
    const L = ledger(world().mp);
    yes('deposit takes a whole number onto a known hold, and saves', L.deposit('Whiterun', 20, 'test') === true &&
      L.ledger.whiterun === 20 && L.saved.length === 1);
    yes('deposit refuses nothing, less than nothing and part of a coin',
      L.deposit('whiterun', 0, 'x') === false && L.deposit('whiterun', -5, 'x') === false &&
      L.deposit('whiterun', 2.5, 'x') === false && L.deposit('whiterun', 'ten', 'x') === false && L.ledger.whiterun === 20);
    yes('deposit refuses a hold that is not one of the ten', L.deposit('__proto__', 5, 'x') === false &&
      L.deposit('', 5, 'x') === false && L.deposit('skyrim', 5, 'x') === false && L.saved.length === 1);
    // A fare into the box (#2298): the same whole numbers and the same ten holds.
    yes('boxFare puts a whole number into a known hold\'s box, and saves', L.boxFare('Whiterun', 20, 'test') === true &&
      L.funds.whiterun === 20 && L.saved.length === 2);
    yes('boxFare refuses nothing, less than nothing, part of a coin and a hold that is not one of the ten',
      L.boxFare('whiterun', 0, 'x') === false && L.boxFare('whiterun', 2.5, 'x') === false &&
      L.boxFare('__proto__', 5, 'x') === false && L.boxFare('skyrim', 5, 'x') === false && L.funds.whiterun === 20);
    yes('and a fare never touches the fee ledger', L.ledger.whiterun === 20);
  }
}

// ---------------------------------------------------------------- wiring
{
  const wm = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const pm = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const W = wm ? new Function('return ' + wm[1])() : [];
  const PW = pm ? new Function('return ' + pm[1])() : [];
  yes('/ride is a word the server answers, and nobody is told about it (#1635)', W.indexOf('/ride') >= 0 && PW.indexOf('/ride') < 0);
  const branch = slice(gm, "    if (word === '/ride') {", '\n    }\n');
  yes('the chat hands /ride to the carriages block', !!branch && /__thornswoodCarriages/.test(branch) && /\.command\(parts, actorId, profileId, toProfile\)/.test(branch));
  const exp = slice(gm, '  g.__thornswoodProperty = {', '\n  };');
  yes('the property block hands out deposit and takeGold', !!exp && /deposit: deposit/.test(exp) && /takeGold: takeGold/.test(exp));
  const save = slice(gm, '  function save() {\n    try {\n      var dir = require(\'path\').dirname(registerPath());', '\n  }\n');
  yes('the ledger is in what the register writes, so a fare survives a restart', !!save && /funds: funds/.test(save));
}

// ---------------------------------------------------------------- fast travel
{
  const code = (block || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  yes('the carriages block never touches fast travel or the map', !/FastTravel|fastTravel|addToMap/.test(code));
  yes('no plugin turns fast travel on', !/enableFastTravel\s*\(\s*true/i.test(front) && !/\.fastTravel\s*\(/i.test(front));
  yes('the party map marker still offers no fast travel', /ref\.addToMap\(false\)/.test(front));
}

// ---------------------------------------------------------------- the front plugin
{
  const press = slice(front, '  function driverPress(e) {', '\n  }\n');
  yes('the front plugin asks the server when E is pressed on a driver', !!press && /tellServer\('\/ride e ' \+ hex\)/.test(press));
  yes('and asks before the merchant press, which would take any person', /if \(driverPress\(e\)\) return;\n\s*if \(merchantPress\(e\)\) return;/.test(front));
  const listSrc = slice(front, '  const RIDE_DRIVER_BASES = [', '\n  ];');
  let list = null;
  try { list = listSrc ? new Function('return ' + listSrc.slice(listSrc.indexOf('['))) () : null; } catch (e) { list = null; }
  const want = (C0 ? C0.STOPS.filter(function (s) { return !!s.driver; }) : []).map(function (s) {
    const bits = s.base.split(':');
    return bits[1] + ':' + parseInt(bits[0], 16);
  }).sort();
  const have = (list || []).map(function (b) { return b[0] + ':' + b[1]; }).sort();
  yes('the plugin knows the same drivers as the server, by base', !!list && have.join() === want.join() && have.length === 27);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
