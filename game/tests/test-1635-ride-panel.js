// test-1635-ride-panel.js
//
// #1635. E on a carriage or ferry driver opens a panel of that driver's stops
// and fares, and a Ride button beside each pays and goes. Nobody is told to
// type /ride: it is out of the words named to everybody, the carriages page
// and the server's own lines, and the server still answers the lines the
// panel sends. A short pack is refused with the server's line and the panel
// stays; a ride that goes closes it; walking away closes it. The mod's own
// conversation opens on the same press, and the panel waits for it rather
// than taking the keyboard from it.
//
// And Patrick's fare answers on #1394 (4 Oct): 40 is only the crossing
// between the mainland and Solstheim, a ferry between stops on Solstheim is
// 10, a carriage to a stop in the same hold is 10 and between holds 20.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
function read(p) { return fs.readFileSync(path.join(REPO_DIR, p), 'utf8').split(CR).join(''); }
const gm = read('game/gamemode.js');
const front = read('game/plugins/thornswood-front.js');
const page = read('game/ui/thornswood-ride.js');

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
const EM = String.fromCharCode(0x2014);
const BANNED = new RegExp('pla' + 'yer', 'i');
function clean(s) { return String(s).indexOf(EM) < 0 && !BANNED.test(String(s)); }

const GOLD = 0x0000000F;
const VIEW = 'thornswoodRideView';
const block = slice(gm, '// ==== thornswood carriages ====', '// ==== end thornswood carriages ====');
const takeSrc = slice(gm, '  function takeGold(actorId, amount) {', '\n  }\n');
const depositSrc = slice(gm, '  var LEDGER_HOLDS = [', '\n  }\n');
yes('the carriages block, takeGold and deposit are where this expects them', !!block && !!takeSrc && !!depositSrc);

// ===================================================================== the server
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
function ledger(mp) {
  const funds = {};
  const dropbox = {};
  const fn = new Function('mp', 'funds', 'save', 'plog', 'GOLD_ID', 'dropbox', 'BOX_LOG_KEEP',
    takeSrc + '\n' + depositSrc + '\n' + boxSrc.join('\n') +
    '\nreturn { takeGold: takeGold, deposit: deposit, boxFare: boxFare, LEDGER_HOLDS: LEDGER_HOLDS };');
  const api = fn(mp, funds, function () { }, function () { }, GOLD, dropbox, 500);
  api.ledger = funds;
  api.funds = fareBox(dropbox);
  return api;
}

let clock = 5000000;
function rig() {
  const forms = {};
  const views = [];
  const made = {};
  const mp = {
    getIdFromDesc: function () { return 0; },
    makeProperty: function (name, opts) { made[name] = opts; },
    get: function (id, key) {
      const f = forms[id];
      if (!f) { throw new Error('no form ' + id); }
      if (key === 'worldOrCellDesc') { return f.cell; }
      if (key === 'pos') { return f.pos.slice(); }
      if (key === 'baseDesc') { return f.base || ''; }
      if (key === 'inventory') { return { entries: f.inv.map(function (e) { return Object.assign({}, e); }) }; }
      throw new Error('no property ' + key);
    },
    set: function (id, key, value) {
      const f = forms[id];
      if (!f) { throw new Error('no form ' + id); }
      if (key === 'inventory') { f.inv = value.entries.map(function (e) { return Object.assign({}, e); }); return; }
      if (key === 'locationalData') { f.cell = value.cellOrWorldDesc; f.pos = value.pos.slice(); f.moved = (f.moved || 0) + 1; return; }
      if (key === VIEW) { views.push({ id: id, v: JSON.parse(JSON.stringify(value)) }); return; }
      throw new Error('set ' + key);
    }
  };
  const L = ledger(mp);
  const box = { mp: mp, console: { log: function () { } }, Date: { now: function () { return clock; } } };
  box.globalThis = box;
  box.__thornswoodProperty = { takeGold: L.takeGold, deposit: L.deposit, boxFare: L.boxFare };
  vm.runInNewContext(block, box);
  return { forms: forms, views: views, made: made, L: L, C: box.__thornswoodCarriages };
}

const ME = 0x14, PID = 9, DRIVER = 0xff000a10;
function person(r, at, coins, dx) {
  r.forms[ME] = { cell: at.world, pos: [at.pos[0] + (dx || 0), at.pos[1], at.pos[2]],
    inv: coins ? [{ baseId: GOLD, count: coins }] : [] };
  return r.forms[ME];
}
function say(r, words) {
  const out = [];
  r.C.command(words.split(' '), ME, PID, function (pid, text) { out.push(text); });
  return out.join(' | ');
}
function lastView(r) { return r.views.length ? r.views[r.views.length - 1] : null; }
function gold(f) { let n = 0; f.inv.forEach(function (e) { if (e.baseId === GOLD) { n += e.count; } }); return n; }

let R0 = null;
try { R0 = rig(); } catch (e) { console.log('the block would not run: ' + e); }
yes('the block runs', !!R0 && !!R0.C);

if (R0) {
  const by = function (k) { return R0.C.stopByKey(k); };

  // ------------------------------------------------------------- the property
  const prop = R0.made[VIEW];
  yes('the panel\'s view is a property its owner alone sees',
    R0.C.PANEL_PROPERTY === VIEW && !!prop && prop.isVisibleByOwner === true && prop.isVisibleByNeighbors === false &&
    prop.updateNeighbor === '');
  yes('and its owner script hands it to the page\'s window.thornswoodRide.setData, once per send',
    !!prop && /window\.thornswoodRide\.setData\(d\)/.test(prop.updateOwner) &&
    /st\.thornswoodRideAt === v\.at/.test(prop.updateOwner) && /executeJavaScript\(src\)/.test(prop.updateOwner));
  let scriptRuns = false;
  try { new Function('ctx', prop.updateOwner); scriptRuns = true; } catch (e) { scriptRuns = false; }
  yes('and the owner script is JavaScript that parses', scriptRuns);

  // ------------------------------------------------------------- E on a driver
  {
    const r = rig();
    const t = by('carriage:whiterun');
    r.forms[DRIVER] = { cell: t.world, pos: t.pos.slice(), base: t.base, inv: [] };
    const me = person(r, t, 50, 120);
    const line = say(r, '/ride e ' + DRIVER.toString(16));
    const v = lastView(r);
    yes('E on a driver says nothing in the chat and sends his panel to the one who pressed',
      line === '' && r.views.length === 1 && v.id === ME);
    const names = v.v.stops.map(function (s) { return s.name + ' ' + s.fare; });
    yes('the panel names the driver, his line and his stop, and the ledger the fare goes to',
      v.v.open === true && v.v.driver === 'Bjorlam' && v.v.what === 'the carriage' && v.v.from === 'Whiterun' &&
      v.v.ledger === 'Whiterun' && v.v.note === '' && v.v.at > 0);
    yes('and every stop he goes to with its fare, and not his own stop',
      names.length === 27 && names.indexOf('Solitude 20') >= 0 && names.indexOf('Markarth 20') >= 0 &&
      names.indexOf('Riverwood 10') >= 0 && names.indexOf('Lakeview Manor 20') >= 0 &&
      names.indexOf('Winterhold 20') >= 0 && !names.some(function (n) { return /^Whiterun/.test(n); }));
    yes('pressing him did not move anybody or take a coin', !me.moved && gold(me) === 50 && !r.L.funds.whiterun);

    // A short pack, from the panel.
    me.inv = [{ baseId: GOLD, count: 19 }];
    const refused = say(r, '/ride Solitude');
    const rv = lastView(r).v;
    yes('a short pack is refused with the server\'s line in the chat',
      refused === 'The ride to Solitude is 20 gold and you do not have it. Nothing was taken.');
    yes('and the panel stays, with the same stops and that line on it',
      rv.open === true && rv.note === refused && rv.stops.length === 27 && rv.at > v.v.at);
    yes('and nothing moved and nothing was taken', !me.moved && gold(me) === 19 && !r.L.funds.whiterun);

    // A stop the driver does not go to.
    const off = say(r, '/ride Raven Rock');
    yes('a stop this driver does not go to is refused and the panel stays',
      off === 'No ride to Raven Rock from here.' && lastView(r).v.open === true && lastView(r).v.note === off);

    // The ride.
    me.inv = [{ baseId: GOLD, count: 25 }];
    const went = say(r, '/ride Solitude');
    yes('Ride pays and goes: the line, the fare on Whiterun\'s ledger, one move',
      went === 'You pay the 20 gold fare and ride to Solitude.' && gold(me) === 5 && r.L.funds.whiterun === 20 &&
      me.moved === 1 && me.cell === by('carriage:solitude').world);
    yes('and a ride that goes closes the panel', lastView(r).v.open === false);
  }

  // Walk up first.
  {
    const r = rig();
    const t = by('carriage:whiterun');
    r.forms[DRIVER] = { cell: t.world, pos: t.pos.slice(), base: t.base, inv: [] };
    person(r, t, 50, 900);
    const line = say(r, '/ride e ' + DRIVER.toString(16));
    yes('a press from out of reach is told to walk up, and no panel is sent', line === 'Walk up to Bjorlam first.' && r.views.length === 0);
    const asked = say(r, '/ride Solitude');
    yes('a Ride away from every driver is refused, and closes any panel',
      asked === 'Walk up to a carriage or ferry driver first.' && lastView(r).v.open === false && !r.forms[ME].moved);
    yes('a press on somebody who is not a driver says nothing and sends nothing', (function () {
      r.forms[0xff000777] = { cell: t.world, pos: t.pos.slice(), base: '13bbf:Skyrim.esm', inv: [] };
      const n = r.views.length;
      return say(r, '/ride e ff000777') === '' && r.views.length === n;
    })());
  }

  // Every send moves at on, so a second press draws the panel again.
  {
    const r = rig();
    const t = by('coast:dawnstar');
    r.forms[DRIVER] = { cell: t.world, pos: t.pos.slice(), base: t.base, inv: [] };
    person(r, t, 50, 10);
    say(r, '/ride e ' + DRIVER.toString(16));
    say(r, '/ride e ' + DRIVER.toString(16));
    yes('two presses in the same moment are two views with different at',
      r.views.length === 2 && r.views[1].v.at > r.views[0].v.at &&
      r.views[0].v.what === 'the North Coast ferry' && r.views[0].v.stops.every(function (s) { return s.fare === 10; }));
  }

  // ------------------------------------------------------------- the fares
  const C = R0.C;
  yes('the crossing between the mainland and Solstheim is 40, each way',
    C.fare(by('maiden:windhelm'), by('maiden:ravenrock')) === 40 && C.fare(by('maiden:ravenrock'), by('maiden:windhelm')) === 40 &&
    C.FARE_CROSSING === 40);
  yes('a ferry between stops on Solstheim is 10, Raven Rock at either end or not',
    C.fare(by('solstheim:ravenrock'), by('solstheim:skaalvillage')) === 10 &&
    C.fare(by('solstheim:skaalvillage'), by('solstheim:ravenrock')) === 10 &&
    C.fare(by('solstheim:ravenrock'), by('solstheim:telmithryn')) === 10 &&
    C.fare(by('solstheim:telmithryn'), by('solstheim:skaalvillage')) === 10);
  yes('every other ferry is 10', ['coast', 'honrich', 'ilinalta'].every(function (line) {
    const s = C.STOPS.filter(function (x) { return x.line === line; });
    // From a driver: a landing nobody drives from takes nobody anywhere.
    return s.every(function (a) { return s.every(function (b) { return a === b || !a.driver || C.fare(a, b) === 10; }); });
  }));
  yes('a carriage between two holds is 20', C.fare(by('carriage:whiterun'), by('carriage:riften')) === 20 &&
    C.fare(by('carriage:winterhold'), by('carriage:markarth')) === 20);
  yes('the only 40 on the whole list is the Northern Maiden', C.STOPS.every(function (a) {
    return C.STOPS.every(function (b) { return C.fare(a, b) !== 40 || a.line === 'maiden'; });
  }));
  {
    // A village stop in Whiterun hold, on the mod's own marker (#1394, 11 Oct).
    const r = rig();
    const t = r.C.stopByKey('carriage:whiterun');
    const v = r.C.stopByKey('carriage:riverwood');
    yes('a carriage to a stop in the same hold is 10', r.C.fare(t, v) === 10 && r.C.FARE_CARRIAGE_IN_HOLD === 10);
    yes('and to another hold still 20', r.C.fare(t, r.C.stopByKey('carriage:solitude')) === 20);
    yes('and the panel at Whiterun offers it at 10', r.C.panelView(t, '').stops.some(function (s) {
      return s.name === 'Riverwood' && s.fare === 10;
    }));
    yes('a stop nobody drives from takes nobody anywhere', r.C.destinations(v).length === 0);
    const me = person(r, t, 30, 50);
    say(r, '/ride Riverwood');
    yes('the 10 is taken onto Whiterun\'s ledger and the ride goes', r.L.funds.whiterun === 10 && gold(me) === 20 &&
      me.cell === v.world && me.pos.join() === v.pos.join());
  }
}

// ===================================================================== no word for people
{
  const wm = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const pm = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const W = wm ? new Function('return ' + wm[1])() : [];
  const PW = pm ? new Function('return ' + pm[1])() : [];
  yes('the server still answers /ride, the line the panel sends', W.indexOf('/ride') >= 0 &&
    /if \(word === '\/ride'\) \{[\s\S]{0,400}?__thornswoodCarriages[\s\S]{0,200}?\.command\(parts, actorId, profileId, toProfile\)/.test(gm));
  yes('and /ride is not among the words named to everybody, which /help reads', PW.indexOf('/helpme') !== -1 && PW.indexOf('/ride') < 0);
  // '/ride threw:' is the router's line for the server log, which nobody in the world reads.
  const lits = (gm.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter(function (l) {
    return /\/ride/.test(l) && l !== "'/ride threw:'";
  });
  yes('no line the server says names /ride: only the word list and the router hold it',
    lits.length === 2 && lits.every(function (l) { return l === "'/ride'"; }));
  yes('nothing anywhere in the gamemode says "say /ride"', !/say \/ride/i.test(gm));
  const lines = (block || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const said = lines.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
  yes('the carriages block\'s own lines are clean words', said.every(clean));
}

// ===================================================================== the docs
{
  const page1 = read('docs/systems/carriages.md');
  const gold = read('docs/systems/gold.md');
  const cmds = read('docs/systems/commands.md');
  yes('carriages.md no longer names /ride, and says E on the driver opens the panel',
    page1.indexOf('/ride') < 0 && /press E on them\. A panel names every stop that driver goes to and\s+its fare, with a Ride button beside each/.test(page1));
  yes('carriages.md has Patrick\'s fares: ferry 10, carriage 10 in a hold and 20 between, 40 only the crossing',
    /\| A ferry, one stop to another on its water, Solstheim's own ferry included \| 10 \|/.test(page1) &&
    /\| A carriage to a stop in the same hold \| 10 \|/.test(page1) &&
    /\| A carriage, one hold to another \| 20 \|/.test(page1) &&
    /\| The crossing between the mainland and Solstheim, the Northern Maiden between Windhelm and Raven Rock \| 40 \|/.test(page1) &&
    !/Either end is Raven Rock/.test(page1));
  yes('gold.md agrees', /\| A carriage \| 10 to a stop in the same hold, 20 to another hold \|/.test(gold) &&
    /\| A ferry \| 10, Solstheim's own ferry included \|/.test(gold) &&
    /\| The crossing to Solstheim, the Northern Maiden between Windhelm and Raven Rock \| 40 \|/.test(gold) &&
    !/40 if Raven Rock is either end/.test(gold));
  const row = (cmds.split('\n').filter(function (l) { return l.indexOf('| `/ride`, `/ride <stop>` |') === 0; })[0]) || '';
  yes('commands.md says the panel sends /ride and nothing tells anybody to type it',
    /Never in the list or the help/.test(row) && /^\| [^|]*\| [^|]*\| [^|]*\| [^|]*\| Nowhere\./.test(row) && cmds.indexOf('Say /ride') < 0);
  yes('the pages are clean words', clean(page1) && clean(gold));
}

// ===================================================================== the page
function pageRig() {
  const told = [], sent = [], keys = [];
  let root = null;
  function node(tag) {
    return { tag: tag, children: [], innerHTML: '', className: '', id: '', listeners: {}, textContent: '',
      appendChild: function (c) { this.children.push(c); return c; },
      addEventListener: function (ev, fn) { this.listeners[ev] = fn; } };
  }
  const h2 = node('h2'), body = node('div'), foot = node('button');
  let buttons = [];
  function ridesDrawn() {
    buttons = [];
    const re = /<button class="go" data-n="(\d+)">Ride<\/button>/g;
    let m;
    while ((m = re.exec(body.innerHTML))) {
      const n = m[1];
      buttons.push({ disabled: false, onclick: null, getAttribute: function () { return n; } });
    }
    return buttons;
  }
  body.querySelectorAll = function () { return ridesDrawn(); };
  const win = {
    skyrimPlatform: { sendMessage: function (a, b) { told.push(a + ' ' + b); } },
    thornswoodNet: { say: function (l) { sent.push(l); } }
  };
  const doc = {
    head: node('head'), body: node('body'),
    createElement: function (t) {
      const n = node(t);
      if (t === 'div' && !root) {
        root = n;
        n.querySelector = function (sel) {
          if (sel === 'h2') { return h2; }
          if (sel === '.body') { return body; }
          if (sel === '.foot button') { return foot; }
          return null;
        };
        n.querySelectorAll = function () { return buttons; };
      }
      return n;
    },
    addEventListener: function (ev, fn) { if (ev === 'keydown') { keys.push(fn); } }
  };
  const box = { window: win, document: doc, String: String, Number: Number };
  vm.createContext(box);
  vm.runInContext(page, box);
  return { win: win, told: told, sent: sent, keys: keys, h2: h2, body: body, foot: foot,
           rides: function () { return buttons; }, root: function () { return root; } };
}

{
  const P = pageRig();
  const api = P.win.thornswoodRide;
  yes('the page puts window.thornswoodRide up, says it is in, and shows nothing by itself',
    !!api && typeof api.setData === 'function' && P.told.indexOf('thornswood-front ride:ready') >= 0 && !api.isOpen());
  const view = { open: true, driver: 'Bjorlam', what: 'the carriage', from: 'Whiterun', ledger: 'Whiterun', note: '', at: 1,
    stops: [{ name: 'Solitude', fare: 20 }, { name: 'Riverwood', fare: 10 }] };
  api.setData(view);
  yes('the server\'s view asks the front for the panel and does not open it', !api.isOpen() &&
    P.told.indexOf('thornswood-front ride:wants') >= 0 && P.told.indexOf('thornswood-front ride:opened') < 0);
  api.open();
  yes('the front\'s open opens it and says so', api.isOpen() && P.told.indexOf('thornswood-front ride:opened') >= 0 &&
    P.root().className === 'on');
  yes('the title is the driver, his line and his stop', /^Bjorlam <span class="sub">the carriage from Whiterun<\/span>$/.test(P.h2.innerHTML));
  yes('each stop is a row with its fare and a Ride button', P.rides().length === 2 &&
    /Solitude<\/span><span class="fare">20 gold<\/span><button class="go" data-n="0">Ride<\/button>/.test(P.body.innerHTML) &&
    /Riverwood<\/span><span class="fare">10 gold<\/span>/.test(P.body.innerHTML));
  yes('and it says where the fare goes and what a short pack means',
    /The fare goes into Whiterun's drop box\. If the gold is not in your pack, you do not move and nothing is taken\./.test(P.body.innerHTML));
  yes('the words on it are clean', clean(P.body.innerHTML) && clean(P.h2.innerHTML) && clean(page));
  const b = P.rides()[0];
  b.onclick.call(b);
  yes('Ride sends the stop to the server as the one line, and nothing is typed', P.sent.length === 1 && P.sent[0] === '/ride Solitude');
  yes('and every Ride button waits for the answer', P.rides().every(function (x) { return x.disabled; }));
  const wantsBefore = P.told.filter(function (t) { return t === 'thornswood-front ride:wants'; }).length;
  api.setData(Object.assign({}, view, { note: 'The ride to Solitude is 20 gold and you do not have it. Nothing was taken.', at: 2 }));
  yes('a refusal is drawn on the open panel, which stays open', api.isOpen() &&
    /<div class="said">The ride to Solitude is 20 gold and you do not have it\. Nothing was taken\.<\/div>/.test(P.body.innerHTML) &&
    P.told.filter(function (t) { return t === 'thornswood-front ride:wants'; }).length === wantsBefore);
  yes('and its Ride buttons are live again', P.rides().length === 2 && P.rides().every(function (x) { return !x.disabled; }));
  api.setData({ open: false, at: 3 });
  yes('the server\'s open false closes it and says so', !api.isOpen() && P.told.indexOf('thornswood-front ride:closed') >= 0);
  api.open();
  yes('and the front cannot open a panel the server closed', !api.isOpen());
  api.setData(Object.assign({}, view, { at: 4 }));
  api.open();
  P.keys[0]({ key: 'Escape' });
  yes('Escape closes it', !api.isOpen());
  api.open();
  P.foot.onclick();
  yes('and so does Step back', !api.isOpen() && /<button data-do="close">Step back<\/button>/.test(P.root().innerHTML));
}

// ===================================================================== the front plugin
{
  const overlays = /const OVERLAYS = (\[[\s\S]*?\]);/.exec(front);
  yes('the front plugin loads the page', !!overlays && new Function('return ' + overlays[1])().indexOf('thornswood-ride.js') >= 0);
  yes('the cap on a claim can close it like every other panel',
    /ride: 'thornswoodRide'/.test(slice(front, 'const CAP_CLOSES = {', '};') || ''));
  const press = slice(front, '  function driverPress(e) {', '\n  }\n') || '';
  yes('E on a driver keeps which driver it was, then asks the server',
    /rideDriver = localId;\n\s*tellServer\('\/ride e ' \+ hex\);/.test(press));
  yes('and the plugin tells nobody to type a line', !/[Ss]ay \/ride|[Tt]ype \/ride/.test(front));

  // The panel's state, run.
  const stateA = front.indexOf('  const RIDE_REACH = 400;');
  const stateB = front.indexOf('\n  function rideDriverIdSet() {', stateA);
  const state = stateA >= 0 && stateB > stateA ? front.slice(stateA, stateB) : null;
  const hooksA = front.indexOf("  sp.on('menuOpen', guard('ride panel waits'");
  const hooksB = front.indexOf('\n  }));\n', front.indexOf("guard('ride distance'"));
  const hooks = hooksA >= 0 && hooksB > hooksA ? front.slice(hooksA, hooksB + 6) : null;
  const msgA = front.indexOf("    if (what === 'ride:wants')");
  const msgB = front.indexOf('\n', front.indexOf("    if (what === 'ride:ready')"));
  const msgs = msgA >= 0 && msgB > msgA ? front.slice(msgA, msgB) : null;
  yes('the panel\'s state, its three hooks and its four messages are where this expects them', !!state && !!hooks && !!msgs);
  const sm = /const SELF_OPENING_MENUS = (\[[\s\S]*?\]);/.exec(front);
  if (state && hooks && msgs && sm) {
    const g = { now: 1000, menus: [], js: [], claims: {}, handlers: {}, me: [0, 0, 0], him: [100, 0, 0], loaded: true };
    const box = {
      Date: { now: function () { return g.now; } }, Math: Math,
      guard: function (n, fn) { return fn; },
      SELF_OPENING_MENUS: new Function('return ' + sm[1])(),
      busyMenuOpenNow: function (except) {
        for (let i = 0; i < g.menus.length; i++) { if (g.menus[i] !== except) { return g.menus[i]; } }
        return '';
      },
      T: { js: function (s) { g.js.push(s); return true; }, claimFocus: function (w, on) { g.claims[w] = !!on; } },
      sp: {
        on: function (ev, fn) { (g.handlers[ev] = g.handlers[ev] || []).push(fn); },
        Game: {
          getPlayer: function () {
            return { getPositionX: function () { return g.me[0]; }, getPositionY: function () { return g.me[1]; },
                     getPositionZ: function () { return g.me[2]; } };
          },
          getFormEx: function (id) { return id === 0x1234 && g.loaded ? { id: id } : null; }
        },
        ObjectReference: {
          from: function (f) {
            return f ? { getPositionX: function () { return g.him[0]; }, getPositionY: function () { return g.him[1]; },
                         getPositionZ: function () { return g.him[2]; } } : null;
          }
        }
      }
    };
    vm.createContext(box);
    vm.runInContext(state + '\n' + hooks + '\nfunction onMessage(what) {\n' + msgs + '\n}\n' +
      'globalThis.__ride = { msg: onMessage, set driver(v) { rideDriver = v; }, get state() { return rideState; } };', box);
    const R = box.__ride;
    function fire(ev, arg) { (g.handlers[ev] || []).forEach(function (fn) { fn(arg); }); }
    const OPEN = 'try{window.thornswoodRide&&window.thornswoodRide.open();}catch(e){}';
    const CLOSE = 'try{window.thornswoodRide&&window.thornswoodRide.close();}catch(e){}';
    function opens() { return g.js.filter(function (s) { return s === OPEN; }).length; }
    function closes() { return g.js.filter(function (s) { return s === CLOSE; }).length; }

    R.driver = 0x1234;
    // The mod's conversation came up on the press, before the server answered.
    g.menus = ['Dialogue Menu'];
    R.msg('ride:wants');
    yes('while the mod\'s conversation is open, the panel waits and takes nothing', opens() === 0 && R.state === 'waiting' &&
      !g.claims.ride);
    fire('menuClose', { name: 'Dialogue Menu' });
    yes('and opens when the conversation closes', opens() === 1);
    g.menus = [];
    R.msg('ride:opened');
    yes('the open panel takes the keyboard', g.claims.ride === true && R.state === 'up');
    // The conversation opening after the server answered.
    g.menus = ['Dialogue Menu'];
    fire('menuOpen', { name: 'Dialogue Menu' });
    yes('a conversation that opens over the panel closes it', closes() === 1 && R.state === 'waiting');
    R.msg('ride:closed');
    yes('and the keyboard goes back to the game while the panel waits', g.claims.ride === false && R.state === 'waiting');
    fire('menuClose', { name: 'Cursor Menu' });
    yes('another menu closing while the conversation is up does not open it', opens() === 1);
    fire('menuClose', { name: 'Dialogue Menu' });
    g.menus = [];
    yes('the conversation closing opens it again', opens() === 2);
    R.msg('ride:opened');
    // Walking away.
    g.now += 300;
    g.me = [450, 0, 0];
    fire('update');
    yes('walking within reach of the driver keeps it', closes() === 1 && R.state === 'up');
    g.now += 300;
    g.me = [520, 0, 0];
    fire('update');
    yes('walking out of his reach closes it', closes() === 2 && R.state === '');
    R.msg('ride:closed');
    fire('menuClose', { name: 'Dialogue Menu' });
    yes('and nothing opens it again until the next press', opens() === 2 && !g.claims.ride);
    // The view arriving with no menu up.
    g.me = [0, 0, 0];
    R.msg('ride:wants');
    yes('with no menu up it opens at once', opens() === 3);
    R.msg('ride:opened');
    R.msg('ride:closed');
    yes('Step back or Escape ends it for good', R.state === '' && g.claims.ride === false);
    fire('menuClose', { name: 'Dialogue Menu' });
    yes('so a menu closing afterwards does not bring it back', opens() === 3);
    // The view arriving out of reach, or with the driver gone.
    g.me = [900, 0, 0];
    R.msg('ride:wants');
    yes('a view that arrives once you have walked off opens nothing', opens() === 3 && R.state === '');
    g.me = [0, 0, 0];
    g.loaded = false;
    R.msg('ride:wants');
    yes('nor one for a driver this game no longer has', opens() === 3 && R.state === '');
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
