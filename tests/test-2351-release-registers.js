'use strict';
/*
  test-2351-release-registers.js

      node tests/test-2351-release-registers.js

  #2351, Patrick's A of 16 October: "Delete-Person.ps1 writes a list, and the
  gamemode releases those entries at its next start." This starts the real
  blocks of game\gamemode.js that keep a register naming a character, in the
  order the server loads them, in a scratch server folder with a stand-in of
  every register and a stand-in list (private\deleted-characters.json), the
  way a game server starts after a deletion:

    R  the release of deleted characters: the list read once, each part let
       go as its block loads, marked done, the list gone at the end
    F  farming: their farm claim and seed are gone, the others' stay
    P  property: their claim is free, a master key record cut for them comes
       off another's claim, their office is let go, before rolesRead could
       name them; their posts come down with their words off; a job they took
       goes back on the board; gold owed to them stops being held; the drop
       box keeps every coin with their name off; their bed nights and takings
       go
    B  the books stay balanced: every hold's ledger (funds) is the same coin
       for coin, never less than what is still held, and the drop box holds
       the same gold
    E  the embassy and remnant rolls, by profile and by form id
    D  the dungeon chests' record: the character off, the reservation kept,
       the file still verifies and loads again
    K  the books: a book they own is disbanded with its ledger entries, their
       membership and their chat lines go, and when they last left
    M  the guild traders' ledger, as the NPC startup reads the purses
       (#2652): their supply waits go and a trade waiting on them is cleared,
       somebody else's stay, and every purse and shelf is the same
    L  the log says counts and nothing else
    W  a part that cannot write waits, alone, for the next start; a list that
       is not one releases nothing and is left; settings that will not read
       release nothing and leave the list and the ships' manifest (#2871)
    C  a list naming characters only, no profile, as Reset-Character.ps1 and
       Wipe-Saves.ps1 write it (#2668): what a character held goes (an
       embassy row with no profile, a dungeon chest's reservation, a trader's
       supply waits and a trade waiting on it) and nothing a profile holds is
       touched: every claim, office, bed, farm, book and roll place held by a
       profile stays; a market stall, kept by the character who claimed it,
       ends, and its goods go into the drop box for the profile (#3160)
    S  the trade ships' manifest (#511): the character off every line and
       hand out, by form id or by profile, every piece where it was; on a
       list of characters only, a profile's other character stays
    V  the market stalls (#3160): the stall they kept is free, its goods in
       the hold's drop box with no name on them, somebody else's stays
    T  the trade carts' manifest (#3158): the character off every line and
       off the cart they drive, which stays on the road with every piece
    X  a wipe's list, every part but the merchants' marked done: only the
       merchant ledger lets go, and the list is gone

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8')).split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(start, end, withEnd) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  if (b < 0) { return null; }
  return gm.slice(a, withEnd ? b + end.length : b);
}

const parts = {
  release: slice('// ==== thornswood release of deleted characters ====', '// ==== end thornswood release of deleted characters ====', true),
  crops: slice('var CROPS_BY_BASE = ', 'var CROPS = mergeCrops();', true),
  farming: slice('// ==== thornswood farming ====', '// ==== end thornswood farming ===='),
  property: slice('// ==== thornswood property ====', '// ==== end thornswood property ===='),
  embassy: slice('// ==== thornswood embassy and remnant ====', '// ==== end thornswood embassy and remnant ===='),
  ledger: slice('function createPrivateMerchantLedger(', 'function npcMerchantManifest('),
  dungeon: slice('// ==== thornswood dungeon loot ====', '// ==== end thornswood dungeon loot ===='),
  ships: slice('// ==== thornswood trade ships ====', '// ==== end thornswood trade ships ===='),
  stalls: slice('// ==== thornswood market stalls ====', '// ==== end thornswood market stalls ===='),
  carts: slice('// ==== thornswood trade carts ====', '// ==== end thornswood trade carts ===='),
  books: slice('/* BOOKS-START */', '// ==== thornswood chat commands ===='),
  purses: slice('function npcMerchantManifest(', '// NPC MERCHANT PURSES END'),
  startup: slice('// NPC SERVER STARTUP BEGIN', '// NPC SERVER STARTUP END', true),
  waiting: slice('// NPC SERVER STARTUP END', '// ==== thornswood custom quests ====')
};
for (const k of Object.keys(parts)) { yes('R0 ' + k + ' is in gamemode.js where this harness looks', !!parts[k]); }
if (Object.keys(parts).some(function (k) { return !parts[k]; })) { done(); }

// The release block comes before the first register block, and every block asks it.
yes('R1 the release block loads before farming, the first register block',
    gm.indexOf('// ==== thornswood release of deleted characters ====') < gm.indexOf('// ==== thornswood farming ===='));
for (const [part, where] of [['farms', parts.farming], ['property', parts.property], ['embassy', parts.embassy], ['dungeon', parts.dungeon]]) {
  yes('R2 the ' + part + ' block asks for its part once, as it loads',
      where.indexOf("g.__thornswoodRelease('" + part + "', release)") >= 0);
}
yes('R2 the trade ships block asks for its part once, as it loads (#511)', parts.ships.indexOf("g.__thornswoodRelease('cargo', release)") >= 0 &&
    gm.indexOf('// ==== thornswood trade ships ====') > gm.indexOf('// ==== end thornswood dungeon loot ====') &&
    gm.indexOf('// ==== end thornswood trade ships ====') < gm.indexOf('/* BOOKS-START */'));
yes('R2 the market stalls block asks for its part once, as it loads, after the ships (#3160)',
    parts.stalls.split("g.__thornswoodRelease('stalls', release)").length === 2 &&
    gm.indexOf('// ==== thornswood market stalls ====') > gm.indexOf('// ==== end thornswood trade ships ====') &&
    gm.indexOf('// ==== end thornswood market stalls ====') < gm.indexOf('/* BOOKS-START */'));
yes('R2 the trade carts block asks for its part once, as it loads, after the ships (#3158)', parts.carts.indexOf("g.__thornswoodRelease('carts', release)") >= 0 &&
    gm.indexOf('// ==== thornswood trade carts ====') > gm.indexOf('// ==== end thornswood trade ships ====') &&
    gm.indexOf('// ==== end thornswood trade carts ====') < gm.indexOf('/* BOOKS-START */'));
yes('R2 the books ask for theirs as they start', parts.books.indexOf("g.__thornswoodRelease('books', api.release)") >= 0);
yes('R3 property lets go before rolesRead, which would name the character in the log',
    parts.property.indexOf("g.__thornswoodRelease('property', release)") < parts.property.lastIndexOf('rolesRead();'));
yes('R2 the NPC startup asks for the merchants\' part once the purses are read (#2652)',
    parts.startup.indexOf("globalThis.__thornswoodRelease('merchants',merchants.release)") > parts.startup.indexOf('merchants=createNpcMerchantPurses('));
yes('R4 and every part waiting is said once, after the NPC startup, the last block that asks',
    parts.waiting.indexOf('__thornswoodReleaseWaiting();') > 0 && parts.books.indexOf('__thornswoodReleaseWaiting();') < 0);

// ------------------------------------------------------------- stand-ins --
const ME = '111111111111111111', YOU = '222222222222222222';
const P1 = 5001, P2 = 5002, PY = 6001, PZ = 6002;     // P1 and P2 are theirs; PY and PZ are not
const A1 = 0xff000a01, A2 = 0xff000a02, AY = 0xff000a09;  // form ids: theirs, theirs, yours
const NOW = Date.now();
const GOLD = 15;
// One shape (#2870): a supply key and a list actor are the same full runtime form id.
const MKEY_1 = JSON.stringify([A1, P1, 'iron ore']), MKEY_2 = JSON.stringify([A2, 77, 'wheat']);
const MKEY_Y = JSON.stringify([AY, PY, 'iron ore']);
const runtimeDesc = function (id) { return (id - 0xff000000).toString(16); };   // formDesc of a runtime form

function checksum(doc) {
  return crypto.createHash('sha256').update(JSON.stringify([doc.version, doc.entries])).digest('hex');
}

/*
  The trade ships' register (#511): one hold at Windhelm, three lines and a
  hand out. A1 (P1) loaded line 1 for AY and received 2 of it; AY loaded
  line 2 for A2 (P2); A3, another character on P1, loaded line 3 for AY.
  The real module writes it, so it verifies as the server's would.
*/
const A3 = 0xff000a03;
function cargoRegister() {
  const T = require(path.join(REPO, 'game', 'trade-cargo.js'));
  const ports = [{ key: 'solitude', name: 'Solitude', hold: 'solitude', world: '3c:Skyrim.esm', pos: [0, 0, 0] },
                 { key: 'windhelm', name: 'Windhelm', hold: 'windhelm', world: '3c:Skyrim.esm', pos: [1, 1, 1] }];
  const reg = T.adoptRoutes(T.openRegister(null), { v: 1, ports: ports, routes: [{ from: 'solitude', to: 'windhelm', minutes: 60 }] });
  const s = reg.state, sh = reg.ships;
  const me = { actor: A1, profile: P1 }, you = { actor: AY, profile: PY }, mine2 = { actor: A2, profile: P2 }, other = { actor: A3, profile: P1 };
  sh.open(s, 'ship-1', 'solitude');
  sh.load(s, 'ship-1', { by: me, for: you, receipt: 'debit:1', entry: { baseId: 0x5ace4, count: 5 } });
  sh.load(s, 'ship-1', { by: you, for: mine2, receipt: 'debit:2', entry: { baseId: 0x34cdf, count: 4 } });
  sh.load(s, 'ship-1', { by: other, for: you, receipt: 'debit:3', entry: { baseId: 0x5ace4, count: 6 } });
  sh.depart(s, 'ship-1', 'windhelm', 1, 2);
  sh.arrive(s, 2);
  const b = sh.begin(s, 'ship-1', 1, 2, 'taken', me, 3);
  sh.finish(s, 'ship-1', b.out, 'credit:1');
  return T.saveRegister(reg);
}

/*
  The trade carts' register (#3158): one cart on the road from Whiterun to
  Riften, driven by A1 (P1). A1 loaded line 1 for AY; AY loaded line 2 for
  A2 (P2). The real module writes it, driven.
*/
function cartsRegister() {
  const T = require(path.join(REPO, 'game', 'trade-cargo.js'));
  const stops = [{ key: 'whiterun', name: 'Whiterun', hold: 'whiterun', world: '3c:Skyrim.esm', pos: [0, 0, 0] },
                 { key: 'riften', name: 'Riften', hold: 'riften', world: '3c:Skyrim.esm', pos: [1, 1, 1] }];
  const reg = T.adoptRoutes(T.openRegister(null, { driven: true }), { v: 1, ports: stops, routes: [{ from: 'whiterun', to: 'riften', minutes: 30 }] });
  const s = reg.state, sh = reg.ships;
  const me = { actor: A1, profile: P1 }, you = { actor: AY, profile: PY }, mine2 = { actor: A2, profile: P2 };
  sh.open(s, 'cart-1', 'whiterun');
  sh.load(s, 'cart-1', { by: me, for: you, receipt: 'cart-debit:1', entry: { baseId: 0x5ace4, count: 5 } });
  sh.load(s, 'cart-1', { by: you, for: mine2, receipt: 'cart-debit:2', entry: { baseId: 0x34cdf, count: 4 } });
  sh.depart(s, 'cart-1', 'riften', 1, 2, me);
  return T.saveRegister(reg);
}

function registers(dir) {
  const P = path.join(dir, 'private');
  fs.mkdirSync(P, { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private', thornswoodServer: 'dev' }));
  const w = function (f, v) { fs.writeFileSync(path.join(P, f), JSON.stringify(v, null, 1)); };
  w('property.json', {
    claims: {
      'b1:Skyrim.esm': { by: P1, name: 'Mine', at: NOW, touched: NOW, rent: { amount: 10, everyDays: 7, owed: 10, since: NOW } },
      'b2:Skyrim.esm': { by: PY, name: 'Yours', at: NOW, touched: NOW, master: { for: P1, no: 3 } },
      'b3:Skyrim.esm': { by: PZ, name: 'Theirs', at: NOW, touched: NOW, master: { for: PZ, no: 4 } }
    },
    // Rent still owed on a place by somebody who no longer holds it (#3893).
    arrears: { 'b2:Skyrim.esm': [{ by: P1, name: 'Mine', owed: 25, at: NOW }, { by: PY, name: 'Yours', owed: 5, at: NOW }] },
    funds: { whiterun: 200, riften: 50 },
    notices: {
      whiterun: [
        { by: P1, name: 'Mine', title: 'Lost cat', text: 'Grey and old.', at: NOW, job: false, taken: 0 },
        { by: P1, name: 'Mine', title: 'Fetch water', text: 'From the well.', at: NOW, job: true, pay: 20, taken: PY, takenName: 'Yours' },
        { by: PY, name: 'Yours', text: 'Meet me at dusk.', at: NOW, job: true, letter: true, to: 'Lydia', pay: 15, taken: P1, takenName: 'Mine' },
        { by: PY, name: 'Yours', text: 'a crate of iron', at: NOW, job: true, haul: true, dest: 'riften', pay: 0, taken: P1,
          takenName: 'Mine', down: NOW, downBy: PY, done: NOW, doneBy: PY, owed: 40, owedTo: P1, owedFor: 'hauled', paid: 40, kept: 4 },
        { by: PY, name: 'Yours', text: 'For you.', at: NOW, job: true, letter: true, to: 'Mine', pay: 0, taken: PZ,
          takenName: 'Theirs', down: NOW, downBy: P1, delivered: NOW, deliveredTo: P1 },
        { by: PZ, name: 'Theirs', title: 'Selling a horse', text: 'A good one.', at: NOW, job: false, taken: 0 }
      ]
    },
    dropbox: {
      whiterun: {
        items: [
          { n: 1, by: P1, name: 'Mine', kind: 'gold', baseId: GOLD, count: 30, what: 'Gold', at: NOW, rent: [{ building: 'b1:Skyrim.esm', amount: 10 }] },
          { n: 2, by: PY, name: 'Yours', kind: 'gold', baseId: GOLD, count: 7, what: 'Gold', at: NOW }
        ],
        log: [
          { act: 'in', n: 1, who: P1, whoName: 'Mine', by: P1, byName: 'Mine', what: 'Gold', count: 30, at: NOW },
          { act: 'out', n: 3, who: PY, whoName: 'Yours', by: P1, byName: 'Mine', what: 'Gold', count: 5, at: NOW },
          { act: 'in', n: 2, who: PY, whoName: 'Yours', by: PY, byName: 'Yours', what: 'Gold', count: 7, at: NOW }
        ],
        next: 4
      }
    },
    // The jail rule ran long ago, as on every server, so a start writes nothing of its own.
    steps: { jailRule: NOW },
    boards: {
      whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true },
      riften: { cell: '3c:Skyrim.esm', pos: [100000, 0, 0], where: 'Riften', placed: true }
    }
  });
  w('law.json', { cells: {}, held: {
    'jarl:whiterun': { [ME]: { pid: P1, name: 'Mine', at: NOW } },
    'guard:riften': { [YOU]: { pid: PY, name: 'Yours', at: NOW } },
    'court:solitude': { [ME]: { pid: P2, name: 'Also mine', at: NOW }, [YOU]: { pid: PY, name: 'Yours', at: NOW } }
  } });
  w('beds.json', {
    guests: {
      'b2:Skyrim.esm': { [P1]: { by: PY, at: NOW, name: 'Mine' }, [PZ]: { by: PY, at: NOW, name: 'Theirs' } },
      'b1:Skyrim.esm': { [PY]: { by: P1, at: NOW, name: 'Yours' } }
    },
    takings: { [P1]: 10, [PY]: 4 }
  });
  w('farm-claims.json', { at: NOW, claims: {
    [P1]: { by: P1, name: 'Mine', at: NOW, cell: '3c:Skyrim.esm', x: 0, y: 0 },
    [PY]: { by: PY, name: 'Yours', at: NOW, cell: '3c:Skyrim.esm', x: 9000, y: 0 }
  }, seeded: { [P1]: NOW, [PY]: NOW } });
  w('embassy.json', {
    embassy: [
      { actor: A1, profile: 0, name: 'Mine', at: NOW, armed: true },
      { actor: AY, profile: PY, name: 'Yours', at: NOW, armed: false }
    ],
    remnant: [
      { actor: A2, profile: P2, name: 'Also mine', at: NOW },
      { actor: A1 + 100, profile: PY, name: 'Yours too', at: NOW }
    ]
  });
  const dungeon = { version: 1, entries: {
    '1a2b3:Skyrim.esm': { at: NOW, actor: A1, tier: 1, gold: 9, items: [] },
    '1a2b4:Skyrim.esm': { at: NOW, actor: AY, tier: 2, gold: 20, items: [] },
    '1a2b5:Skyrim.esm': { kind: 'body', at: NOW, taken: false, gold: 3, items: [], camp: false }
  } };
  fs.writeFileSync(path.join(P, 'dungeon-rewards-ledger.json'), JSON.stringify({ version: dungeon.version, entries: dungeon.entries, sha256: checksum(dungeon) }));
  fs.writeFileSync(path.join(P, 'dungeon-rewards-ledger.initialized'), '1');
  w('books.json', {
    books: [
      { id: 'b1', kind: 'faction', name: 'The Grey Cloaks', account: ME, owner: P1,
        members: [{ pid: P1, name: 'Mine', role: 'Member' }, { pid: PY, name: 'Yours', role: 'Member' }],
        roles: [{ name: 'Member', perms: ['Read'] }], chat: [{ pid: PY, name: 'Yours', text: 'hi', at: NOW }], prices: [] },
      { id: 'b2', kind: 'business', name: 'Iron and Oak', account: YOU, owner: PY,
        members: [{ pid: PY, name: 'Yours', role: 'Member' }, { pid: P1, name: 'Mine', role: 'Member' }, { pid: PZ, name: 'Theirs', role: 'Member' }],
        roles: [{ name: 'Member', perms: ['Read'] }],
        chat: [{ pid: P1, name: 'Mine', text: 'my words', at: NOW }, { pid: PZ, name: 'Theirs', text: 'theirs', at: NOW }],
        prices: [{ name: 'Iron Ingot', buy: 5, sell: 8 }] }
    ],
    ledgers: {
      whiterun: {
        b1: { book: 'b1', kind: 'faction', name: 'The Grey Cloaks', at: NOW, prices: [] },
        b2: { book: 'b2', kind: 'business', name: 'Iron and Oak', at: NOW, prices: [{ name: 'Iron Ingot', buy: 5, sell: 8 }] }
      }
    }
  });
  w('last-left.json', { [P1]: NOW, [PY]: NOW });
  w('benches.json', { whiterun: 4278190081 });
  const merchants = { version: 2, entries: {
    '9:Skyrim.esm': { version: 1, reference: '9:Skyrim.esm', base: 'a:Skyrim.esm', purse: 280, stock: [{ baseId: 4096, count: 3 }], revision: 4,
      supply: { [MKEY_1]: NOW, [MKEY_2]: NOW, [MKEY_Y]: NOW },
      pending: { version: 3, id: 'dev:9:4', human: { desc: runtimeDesc(A1), profileId: P1 }, kind: 'supply', phase: 'credit',
                 previous: { supply: { [MKEY_2]: NOW, [MKEY_Y]: NOW } }, next: { purse: 280, stock: [{ baseId: 4096, count: 3 }], supply: {} } } },
    '8:Skyrim.esm': { version: 1, reference: '8:Skyrim.esm', base: 'a:Skyrim.esm', purse: 300, stock: [], revision: 2, supply: {},
      pending: { version: 3, id: 'dev:8:2', human: { desc: runtimeDesc(AY), profileId: PY }, kind: 'sell', phase: 'debit',
                 previous: { purse: 300, stock: [], supply: {} }, next: { purse: 290, stock: [{ baseId: 4096, count: 1 }], supply: {} } } }
  } };
  fs.writeFileSync(path.join(P, 'merchant-ledger.json'), JSON.stringify({ version: merchants.version, entries: merchants.entries, sha256: checksum(merchants) }));
  fs.writeFileSync(path.join(P, 'merchant-ledger.initialized'), '1');
  w('trade-cargo.json', JSON.parse(cargoRegister()));
  // The market stalls (#3160): A1 (P1) keeps a Riften stall with a sword laid
  // out, AY (PY) keeps one in Windhelm.
  w('market-stalls.json', { version: 1, state: { next: 3, out: [], stalls: {
    'riften-1dd1': { keeper: { actor: A1, profile: P1 }, hold: 'riften', since: NOW, last: NOW,
                     lines: [{ n: 1, entry: { baseId: 0x12eb7 }, count: 1, price: { gold: 30 } }] },
    'windhelm-383a6': { keeper: { actor: AY, profile: PY }, hold: 'windhelm', since: NOW, last: NOW,
                        lines: [{ n: 2, entry: { baseId: 0x5ace4 }, count: 4, price: { gold: 2 } }] } } } });
  w('trade-carts.json', JSON.parse(cartsRegister()));
  // Its saves already taken by server-log.js before the engine started (#2758).
  w('deleted-characters.json', { profiles: [P1, P2], actors: [A1, A2], done: { saves: NOW } });
  return P;
}

/*
  One start of the server's blocks, in their order in gamemode.js, in one
  context, from the scratch folder, as the game server would. Answers the
  context and the log.
*/
function start(dir, opt) {
  opt = opt || {};
  const logged = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return []; }
      throw new Error('no reference ' + id);
    },
    set: function () { },
    getDescFromId: function (id) { return Number(id).toString(16) + ':Skyrim.esm'; },
    getIdFromDesc: function () { return 0; },
    lookupEspmRecordById: function () { return null; },
    getNeighborsByPosition: function () { return []; },
    callPapyrusFunction: function () { return null; },
    getServerSettings: function () { return { thornswoodServer: 'dev', privDir: 'private', dataDir: 'data' }; }
  };
  const tstart = gm.indexOf('    farming: {');
  const tend = gm.indexOf('\n    }', tstart);
  const farmingTuning = eval('({' + gm.slice(tstart, tend + 6) + '})').farming;
  const box = {
    console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, mp: mp, Buffer: Buffer,
    setInterval: function () { return 1; }, clearInterval: function () { },
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {}, RECIPES_BY_ID: {}, ADMIN_ITEMS: {},
    idOf: function () { return 0; }, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    toolGate: function () { return null; }, wearTool: function () { return null; }, rankStep: function () { return 0; },
    creditWork: function () { return null; }, addItem: function () { return true; }, takeItem: function () { return true; },
    classGate: function () { return null; }, wornNow: function () { return []; },
    isCarcass: function () { return false; }, withinResourceReach: function () { return true; },
    addItemsAtomic: function () { return true; },
    __thornswoodProgression: { has: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); },
                               TABLE: { tuning: { farming: farmingTuning } } },
    __thornswoodCharacter: { stateOf: function () { return null; }, writeState: function () { } },
    // The door has read its list, and no account holds any role: rolesRead at
    // this start ends every office held, and says each one in the log.
    __thornswoodRolesKnown: function () { return true; },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; },
    __thornswoodOfficesOnRecord: function (pid) {
      return pid === PY ? { jarl: [], court: ['solitude'], steward: [], guard: ['riften'] } : { jarl: [], court: [], steward: [], guard: [] };
    },
    __thornswoodAccountOf: function (pid) { return pid === PY ? YOU : (pid === P1 || pid === P2 ? ME : ''); }
  };
  if (opt.before) { opt.before(box); }
  box.globalThis = box;
  vm.createContext(box);
  const was = process.cwd();
  process.chdir(dir);
  try {
    for (const k of ['release', 'crops', 'farming', 'property', 'embassy', 'ledger', 'dungeon', 'ships', 'stalls', 'carts', 'books', 'purses']) {
      vm.runInContext(parts[k], box, { filename: 'gamemode.js (' + k + ')' });
    }
    // The NPC startup as far as its part (#2652): the real purse service on
    // the real ledger file, asking as the startup does (R2 checks the line).
    vm.runInContext(MERCHANT_START, box, { filename: 'NPC startup (merchant purses)' });
    vm.runInContext(parts.waiting, box, { filename: 'gamemode.js (after the NPC startup)' });
  } finally { process.chdir(was); }
  return { box: box, logged: logged };
}

const MERCHANT_START = '(function () {' +
  "  var cfg = { privDir: 'private', dataDir: 'data', thornswoodServer: 'dev' };" +
  "  var refs = ['9:Skyrim.esm', '8:Skyrim.esm'];" +
  "  var api = { makeProperty: function () { }, getIdFromDesc: function (d) { return d === '9:Skyrim.esm' ? 9 : d === '8:Skyrim.esm' ? 8 : 0; }," +
  "    getNpcAIState: function () { return { isHuman: false }; }, get: function (id, k) { return k === 'baseDesc' ? 'a:Skyrim.esm' : undefined; }, set: function () { } };" +
  "  var merchants = createNpcMerchantPurses(api, { keep: refs.map(function (r) { return [r, 'a:Skyrim.esm', null, null, null, null, 'trader']; }) }," +
  "    createPrivateMerchantLedger(require('fs'), require('path'), cfg, refs, null));" +
  "  globalThis.__thornswoodTestMerchants = merchants;" +
  "  if (typeof globalThis.__thornswoodRelease === 'function') globalThis.__thornswoodRelease('merchants', merchants.release);" +
  '})();';

function j(dir, f) { return JSON.parse(fs.readFileSync(path.join(dir, 'private', f), 'utf8')); }
function held(n) {
  if (!n || !n.job) { return 0; }
  const owed = Math.floor(Number(n.owed)) || 0;
  if (owed > 0) { return owed; }
  if (n.down) { return 0; }
  return Math.max(0, Math.floor(Number(n.pay)) || 0);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2351-release-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

try {
  // ============================================================ one start
  const dir = path.join(scratch, 'server');
  registers(dir);
  const before = {};
  for (const f of fs.readdirSync(path.join(dir, 'private'))) { before[f] = fs.readFileSync(path.join(dir, 'private', f), 'utf8'); }
  const run = start(dir);
  const L = run.logged.filter(function (l) { return /^release: /.test(l); });

  yes('R5 the list is read once and every part is let go at this start (' + L.length + ' lines)',
      L.length === 11 && /a list of 2 profile\(s\) and 2 character\(s\) to let go, at server start/.test(L[0]));
  yes('R6 in the order the blocks load', ['farms', 'property', 'embassy', 'dungeon', 'cargo', 'stalls', 'carts', 'books', 'merchants'].every(function (p, i) {
    return new RegExp('^release: ' + p + ': ').test(L[i + 1]);
  }));
  yes('R7 and then the list is gone', /every part is done, and the list is gone/.test(L[10]) &&
      !fs.existsSync(path.join(dir, 'private', 'deleted-characters.json')));

  // ---- F
  const farm = j(dir, 'farm-claims.json');
  yes('F1 their farm claim is free and the other stays', !farm.claims[P1] && !!farm.claims[PY]);
  yes('F2 when they were handed seed is forgotten, the other is kept', !farm.seeded[P1] && !!farm.seeded[PY]);

  // ---- P
  const prop = j(dir, 'property.json');
  yes('P1 the building they held is free', !prop.claims['b1:Skyrim.esm']);
  yes('P2 the master key record cut for them comes off another\'s claim, which stays',
      !!prop.claims['b2:Skyrim.esm'] && prop.claims['b2:Skyrim.esm'].by === PY && !prop.claims['b2:Skyrim.esm'].master);
  yes('P3 a claim and master key of somebody else\'s are as they were',
      JSON.stringify(prop.claims['b3:Skyrim.esm'].master) === JSON.stringify({ for: PZ, no: 4 }));
  const law = j(dir, 'law.json');
  yes('P4 the offices their characters held are let go, the others\' stay',
      !law.held['jarl:whiterun'] && !!law.held['guard:riften'] && !!law.held['guard:riften'][YOU] &&
      !law.held['court:solitude'][ME] && !!law.held['court:solitude'][YOU]);
  yes('P5 rolesRead found nothing of theirs to end and name', !run.logged.some(function (l) { return /no longer on the account of/.test(l) && /Mine/.test(l); }));
  const wr = prop.notices.whiterun;
  yes('P6 every post keeps its number (the board\'s numbers do not move)', wr.length === 6);
  yes('P7 their notice comes down with their name and words off it',
      !!wr[0].down && wr[0].by === 0 && wr[0].name === 'somebody' && wr[0].title === undefined && wr[0].text === undefined);
  yes('P8 their job comes down too, with its words off, though somebody had taken it',
      !!wr[1].down && wr[1].by === 0 && wr[1].title === undefined && wr[1].text === undefined && wr[1].takenName === 'Yours');
  yes('P9 a letter of somebody else\'s they had taken goes back on the board, untaken, its pay still held',
      !wr[2].down && wr[2].taken === 0 && wr[2].takenName === null && wr[2].pay === 15 && wr[2].to === 'Lydia');
  yes('P10 gold owed to them stops being held for them, and the haul\'s record keeps its numbers',
      wr[3].owed === 0 && wr[3].owedTo === 0 && wr[3].taken === 0 && wr[3].takenName === 'somebody' && wr[3].paid === 40 && wr[3].kept === 4);
  yes('P11 a letter delivered to them, and taken down by them, names them no more',
      wr[4].deliveredTo === 0 && wr[4].downBy === 0 && wr[4].to === 'Mine' && wr[4].by === PY);
  yes('P12 somebody else\'s notice is as it was', JSON.stringify(wr[5]) === JSON.stringify(JSON.parse(before['property.json']).notices.whiterun[5]));
  const box = prop.dropbox.whiterun;
  yes('P13 their gold stays in the drop box with their name and the rent it paid off it',
      box.items[0].count === 30 && box.items[0].by === 0 && box.items[0].name === 'somebody' && box.items[0].rent === undefined);
  yes('P14 somebody else\'s gold in the box is as it was', box.items[1].by === PY && box.items[1].count === 7);
  yes('P15 the box\'s record keeps every line, with their name off each',
      box.log.length === 3 && box.log[0].who === 0 && box.log[0].whoName === 'somebody' && box.log[0].byName === 'somebody' &&
      box.log[1].who === PY && box.log[1].whoName === 'Yours' && box.log[1].by === 0 && box.log[1].byName === 'somebody' &&
      box.log[2].byName === 'Yours' && box.log.every(function (l, i) { return l.count === JSON.parse(before['property.json']).dropbox.whiterun.log[i].count; }));
  const beds = j(dir, 'beds.json');
  yes('P16 their night, and the guests of the building they held, end; somebody else\'s guest stays',
      !beds.guests['b2:Skyrim.esm'][P1] && !!beds.guests['b2:Skyrim.esm'][PZ] && !beds.guests['b1:Skyrim.esm']);
  yes('P17 the takings kept for them go, the others\' stay', beds.takings[P1] === undefined && beds.takings[PY] === 4);
  yes('P18 rent they still owed on a place they no longer held goes; somebody else\'s stays (#3893)',
      JSON.stringify(prop.arrears) === JSON.stringify({ 'b2:Skyrim.esm': [{ by: PY, name: 'Yours', owed: 5, at: NOW }] }));

  // ---- B
  const was = JSON.parse(before['property.json']);
  const heldBefore = was.notices.whiterun.reduce(function (s, n) { return s + held(n); }, 0);
  const heldAfter = wr.reduce(function (s, n) { return s + held(n); }, 0);
  yes('B1 every hold\'s ledger is the same, coin for coin', JSON.stringify(prop.funds) === JSON.stringify(was.funds));
  yes('B2 what is held for somebody drops by what was held for them, the job\'s 20 and the 40 owed (' + heldBefore + ' to ' + heldAfter + ')',
      heldBefore === 75 && heldAfter === 15);
  yes('B3 the ledger is never less than what it still holds', prop.funds.whiterun >= heldAfter);
  const gold = function (b) { return b.items.reduce(function (s, it) { return s + (it.baseId === GOLD ? it.count : 0); }, 0); };
  yes('B4 the drop box holds the same gold', gold(box) === gold(was.dropbox.whiterun));
  yes('B5 the in-memory register is what was written', JSON.stringify(run.box.__thornswoodProperty.funds()) === JSON.stringify(prop.funds) &&
      !run.box.__thornswoodProperty.claims()['b1:Skyrim.esm']);

  // ---- E
  const rolls = j(dir, 'embassy.json');
  yes('E1 a row of theirs from before rows kept a profile goes by its form id', rolls.embassy.length === 1 && rolls.embassy[0].actor === AY);
  yes('E2 a row of theirs goes by its profile', !rolls.remnant.some(function (r) { return r.profile === P2; }));
  yes('E3 a row whose form id is not theirs, on another profile, stays', rolls.remnant.length === 1 && rolls.remnant[0].profile === PY);

  // ---- D
  const raw = j(dir, 'dungeon-rewards-ledger.json');
  yes('D1 the chest their character opened keeps its reservation with the character off it',
      raw.entries['1a2b3:Skyrim.esm'].actor === 0 && raw.entries['1a2b3:Skyrim.esm'].gold === 9 && raw.entries['1a2b3:Skyrim.esm'].at === NOW);
  yes('D2 somebody else\'s and a body\'s are as they were',
      raw.entries['1a2b4:Skyrim.esm'].actor === AY && raw.entries['1a2b5:Skyrim.esm'].kind === 'body');
  yes('D3 the record still verifies', raw.sha256 === checksum(raw));

  // ---- K
  const books = j(dir, 'books.json');
  yes('K1 the book they own is disbanded, with its ledger entry', books.books.length === 1 && books.books[0].id === 'b2' &&
      !books.ledgers.whiterun.b1 && !!books.ledgers.whiterun.b2);
  yes('K2 they are off the other book, its owner and the rest stay',
      JSON.stringify(books.books[0].members.map(function (m) { return m.pid; })) === JSON.stringify([PY, PZ]));
  yes('K3 the lines they wrote in its chat go, the others\' stay',
      books.books[0].chat.length === 1 && books.books[0].chat[0].pid === PZ);
  const left = j(dir, 'last-left.json');
  yes('K4 when they last left goes', left[P1] === undefined && left[PY] === NOW);

  // ---- untouched
  yes('R8 a register that names nobody is not written', fs.readFileSync(path.join(dir, 'private', 'benches.json'), 'utf8') === before['benches.json']);

  // ---- M (#2652)
  const ml = j(dir, 'merchant-ledger.json');
  const m9 = ml.entries['9:Skyrim.esm'];
  const mWas = JSON.parse(before['merchant-ledger.json']);
  yes('M1 their supply waits go, by profile and by form id, and somebody else\'s stays',
      JSON.stringify(Object.keys(m9.supply)) === JSON.stringify([MKEY_Y]) && m9.supply[MKEY_Y] === NOW);
  yes('M2 the trade waiting on them is cleared, the trader keeping what it already held',
      m9.pending === null && m9.purse === 280 && JSON.stringify(m9.stock) === JSON.stringify([{ baseId: 4096, count: 3 }]) && m9.revision === 5);
  yes('M3 a trade waiting on somebody else is as it was',
      JSON.stringify(ml.entries['8:Skyrim.esm']) === JSON.stringify(mWas.entries['8:Skyrim.esm']));
  yes('M4 the ledger still verifies', ml.sha256 === checksum(ml));
  yes('M5 the log says counts: ' + (L[9] || '').replace('release: merchants: ', ''), L[9] === 'release: merchants: merchants 1, supply 2, trades 1');

  // ---- V (#3160)
  const st = j(dir, 'market-stalls.json').state;
  yes('V1 the stall they kept is free, and somebody else\'s stays with its goods',
      !st.stalls['riften-1dd1'] && !!st.stalls['windhelm-383a6'] && st.stalls['windhelm-383a6'].keeper.profile === PY &&
      st.stalls['windhelm-383a6'].lines.length === 1 && st.out.length === 0);
  const rb = prop.dropbox.riften;
  yes('V2 the sword on it is in Riften\'s drop box with no name on it, for the hold\'s officers',
      !!rb && rb.items.length === 1 && rb.items[0].baseId === 0x12eb7 && rb.items[0].count === 1 && rb.items[0].by === 0 && rb.items[0].kind === 'stall');
  yes('V3 the log says counts: ' + (L[6] || '').replace('release: stalls: ', ''), L[6] === 'release: stalls: stalls 1');

  // ---- S
  const sc = j(dir, 'trade-cargo.json'), sh = sc.cargo.holds['ship-1'];
  yes('S1 their character comes off the lines they loaded and the line for them, by form id and by profile',
      sh.lines['1'].by === null && sh.lines['1'].for.actor === AY && sh.lines['2'].for === null && sh.lines['3'].by === null);
  yes('S2 and off the hand out they received, which keeps its count and receipt',
      sh.outs[0].who === null && sh.outs[0].count === 2 && sh.outs[0].receipt === 'credit:1');
  yes('S3 every piece is where it was: aboard, out and the receipts the same',
      sh.lines['1'].aboard === 3 && sh.lines['2'].aboard === 4 && sh.lines['3'].aboard === 6 &&
      JSON.stringify(sc.cargo.receipts) === JSON.stringify(JSON.parse(cargoRegister()).cargo.receipts));
  yes('S4 the log says counts: ' + (L[5] || '').replace('release: cargo: ', ''), L[5] === 'release: cargo: loaders 2, recipients 1, receivers 1');

  // ---- T (#3158)
  const tc = j(dir, 'trade-carts.json'), tk = tc.cargo.holds['cart-1'];
  yes('T1 their character comes off the line they loaded, the line for them and the cart they drive',
      tk.lines['1'].by === null && tk.lines['1'].for.actor === AY && tk.lines['2'].for === null && tk.lines['2'].by.actor === AY &&
      tk.sailing.driver === null);
  yes('T2 and the cart stays on the road with every piece aboard',
      tk.sailing.from === 'whiterun' && tk.sailing.to === 'riften' && tk.lines['1'].aboard === 5 && tk.lines['2'].aboard === 4);
  yes('T3 the log says counts: ' + (L[7] || '').replace('release: carts: ', ''), L[7] === 'release: carts: loaders 1, recipients 1, drivers 1');

  // ---- L
  const all = run.logged.join('\n');
  yes('L1 the log says counts: property ' + (L[2] || '').replace('release: property: ', ''),
      /^release: property: claims 1, masterKeys 1, offices 2, posts 2, handedBack 1, owed 1, lines 5, box 1, boxRecord 2, guests 2, takings 1, arrears 1$/.test(L[2] || ''));
  yes('L2 and never a name, a profile id or a form id of theirs, in any line of this start',
      !/Mine|Also mine|my words/.test(all) &&
      [P1, P2, A1, A2].every(function (n) { return !new RegExp('\\b(' + n + '|' + n.toString(16) + ')\\b', 'i').test(all); }));

  // ---- the next start, with no list
  const again = start(dir);
  yes('R9 the next start has no list and lets go of nothing', !again.logged.some(function (l) { return /^release: /.test(l); }));
  const D2 = again.logged.filter(function (l) { return /^\[dungeon\]/.test(l); });
  yes('R10 the dungeon record with a released character loads again', !D2.some(function (l) { return /unavailable/.test(l); }) &&
      typeof again.box.__thornswoodDungeonLoot.onChest === 'function');
  yes('R11 so do the books, the rolls and the register', !!again.box.__thornswoodBooks && again.box.__thornswoodEmbassy.rolls().embassy.length === 1 &&
      !again.box.__thornswoodProperty.claims()['b1:Skyrim.esm']);

  // ============================================================ W: a part waits
  const dir2 = path.join(scratch, 'waits');
  registers(dir2);
  fs.writeFileSync(path.join(dir2, 'private', 'embassy.json'), 'not a roll file');
  const w1 = start(dir2);
  const list1 = j(dir2, 'deleted-characters.json');
  yes('W1 a roll file that cannot be read keeps the embassy\'s part waiting, said in the log',
      w1.logged.some(function (l) { return l === 'release: embassy could not write what it let go, so its part waits for the next start'; }) &&
      w1.logged.some(function (l) { return l === 'release: embassy did not let go at this start, so the list waits for the next one'; }));
  yes('W2 the list stays with every other part marked done',
      JSON.stringify(Object.keys(list1.done).sort()) === JSON.stringify(['books', 'cargo', 'carts', 'dungeon', 'farms', 'merchants', 'property', 'saves', 'stalls']) &&
      JSON.stringify(list1.profiles) === JSON.stringify([P1, P2]));
  // A claim made by a listed profile after the first start is not a released one.
  const p2 = j(dir2, 'property.json');
  p2.claims['b9:Skyrim.esm'] = { by: P1, name: 'New', at: NOW, touched: NOW };
  fs.writeFileSync(path.join(dir2, 'private', 'property.json'), JSON.stringify(p2));
  fs.writeFileSync(path.join(dir2, 'private', 'embassy.json'), before['embassy.json']);
  const w2 = start(dir2);
  const W = w2.logged.filter(function (l) { return /^release: /.test(l); });
  yes('W3 at the next start only the embassy runs, and then the list is gone',
      W.length === 3 && /^release: embassy: embassy 1, remnant 1$/.test(W[1]) && /the list is gone/.test(W[2]) &&
      !fs.existsSync(path.join(dir2, 'private', 'deleted-characters.json')));
  yes('W4 a part done once never runs again: the claim made since stays', !!j(dir2, 'property.json').claims['b9:Skyrim.esm']);

  // ============================================================ W: not a list
  const dir3 = path.join(scratch, 'not-a-list');
  registers(dir3);
  fs.writeFileSync(path.join(dir3, 'private', 'deleted-characters.json'), '{"profiles":[5001,"x"]}');
  const keep = {};
  for (const f of fs.readdirSync(path.join(dir3, 'private'))) { keep[f] = fs.readFileSync(path.join(dir3, 'private', f), 'utf8'); }
  // The door knows no roles here, so rolesRead ends nothing and only the list is measured.
  const n1 = start(dir3, { before: function (b) { b.__thornswoodRolesKnown = function () { return false; }; } });
  let same = true;
  for (const f of Object.keys(keep)) {
    if (f === 'dungeon-rewards-ledger.json' || f === 'dungeon-rewards-ledger.initialized') { continue; }
    if (fs.readFileSync(path.join(dir3, 'private', f), 'utf8') !== keep[f]) { same = false; console.log('      changed: ' + f); }
  }
  yes('W5 a list that is not one lets go of nothing and is left as it is, said in the log',
      same && n1.logged.some(function (l) { return /is not a list of deleted characters, so nothing was let go and it is left as it is/.test(l); }));

  // ============================================================ W: settings that will not read (#2871)
  // Until 22 Oct 2026 the release and the trade ships read privDir inside an
  // empty catch, so a settings file that would not parse sent both to the
  // default folder without a word. Now each says so and touches nothing.
  const dir5 = path.join(scratch, 'settings-unread');
  registers(dir5);
  fs.writeFileSync(path.join(dir5, 'server-settings.json'), '{ "privDir": "private", ');
  const keep5 = {};
  for (const f of fs.readdirSync(path.join(dir5, 'private'))) { keep5[f] = fs.readFileSync(path.join(dir5, 'private', f), 'utf8'); }
  const u1 = start(dir5, { before: function (b) { b.__thornswoodRolesKnown = function () { return false; }; } });
  const U = u1.logged.filter(function (l) { return /^release: /.test(l); });
  yes('W6 settings that will not parse: the release says so and lets go of nothing (' + U.join(' / ') + ')',
      U.length === 1 && /^release: server-settings\.json could not be read \(.+\), so where the list is is not known and nothing was let go$/.test(U[0]));
  yes('W7 and the list is left as it was',
      fs.readFileSync(path.join(dir5, 'private', 'deleted-characters.json'), 'utf8') === keep5['deleted-characters.json']);
  yes('W8 the trade ships say so too, and their manifest is left as it was',
      u1.logged.some(function (l) { return /^\[ships\] server-settings\.json could not be read \(.+\), so where the manifest is is not known/.test(l); }) &&
      fs.readFileSync(path.join(dir5, 'private', 'trade-cargo.json'), 'utf8') === keep5['trade-cargo.json']);
  yes('W9 and the trade carts say so, with their manifest left as it was (#3158)',
      u1.logged.some(function (l) { return /^\[carts\] server-settings\.json could not be read \(.+\), so where the carts' register is is not known/.test(l); }) &&
      fs.readFileSync(path.join(dir5, 'private', 'trade-carts.json'), 'utf8') === keep5['trade-carts.json']);

  // ============================================================ S: saves not taken yet
  // A list whose saves server-log.js has not taken (#2758): the registers go,
  // and the list stays for the start that takes the saves, said in the log.
  const dir4 = path.join(scratch, 'saves-wait');
  registers(dir4);
  fs.writeFileSync(path.join(dir4, 'private', 'deleted-characters.json'), JSON.stringify({ profiles: [P1, P2], actors: [A1, A2] }));
  const s1 = start(dir4);
  const list4 = j(dir4, 'deleted-characters.json');
  yes('S1 with the saves not taken, every register part is done and the list stays',
      JSON.stringify(Object.keys(list4.done).sort()) === JSON.stringify(['books', 'cargo', 'carts', 'dungeon', 'embassy', 'farms', 'merchants', 'property', 'stalls']));
  yes('S2 and the log says the saves wait for the next start',
      s1.logged.some(function (l) { return l === 'release: saves did not let go at this start, so the list waits for the next one'; }));
  // ============================================================ C: characters only (#2668)
  // Reset-Character.ps1 and Wipe-Saves.ps1 name the characters they throw
  // away by form id and never a profile, which keeps its id and what it holds.
  // The door knows no roles here, so rolesRead ends nothing and only the list
  // is measured (as W5).
  const quiet = { before: function (b) { b.__thornswoodRolesKnown = function () { return false; }; } };
  function charactersOnly(name, list) {
    const d = path.join(scratch, name);
    registers(d);
    fs.writeFileSync(path.join(d, 'private', 'deleted-characters.json'), JSON.stringify(list));
    const k = {};
    for (const f of fs.readdirSync(path.join(d, 'private'))) { k[f] = fs.readFileSync(path.join(d, 'private', f), 'utf8'); }
    const r = start(d, quiet);
    const changed = Object.keys(k).filter(function (f) {
      if (f === 'deleted-characters.json' || /^dungeon-rewards-ledger\./.test(f)) { return false; }
      return !fs.existsSync(path.join(d, 'private', f)) || fs.readFileSync(path.join(d, 'private', f), 'utf8') !== k[f];
    }).sort();
    return { dir: d, run: r, keep: k, changed: changed, lines: r.logged.filter(function (l) { return /^release: /.test(l); }) };
  }
  // As Release-List.ps1 writes it: naming no profile, it has 'saves' done.
  const c = charactersOnly('characters-only', { profiles: [], actors: [A1, A2], done: { saves: NOW } });
  yes('C1 the list of characters only is read and every part runs (' + c.lines.length + ' lines)',
      /a list of 0 profile\(s\) and 2 character\(s\) to let go, at server start/.test(c.lines[0] || '') &&
      /every part is done, and the list is gone/.test(c.lines[c.lines.length - 1] || '') &&
      !fs.existsSync(path.join(c.dir, 'private', 'deleted-characters.json')));
  yes('C2 only the rolls, the merchant ledger, the trade ships\' and carts\' manifests, the stall book and the drop box are written (' + c.changed.join(', ') + ')',
      JSON.stringify(c.changed) === JSON.stringify(['embassy.json', 'market-stalls.json', 'merchant-ledger.json', 'property.json', 'trade-cargo.json', 'trade-carts.json']));
  // A stall is kept by the character who claimed it (#3160): it ends, and its
  // sword goes into Riften's drop box for the person, whose profile stays.
  const cp = j(c.dir, 'property.json'), cpWas = JSON.parse(c.keep['property.json']);
  const crb = cp.dropbox.riften;
  yes('C9 the character\'s stall ends, and its sword is in Riften\'s drop box for the person, under their profile',
      !j(c.dir, 'market-stalls.json').state.stalls['riften-1dd1'] && !!crb && crb.items.length === 1 && crb.items[0].by === P1 &&
      crb.items[0].baseId === 0x12eb7);
  delete cp.dropbox.riften;
  // Writing the register fills in its defaults (a claim's locked, Raven Rock's
  // board), so what a person holds is compared, not the bytes.
  const holdings = function (q) {
    return JSON.stringify([Object.keys(q.claims).sort().map(function (k) { return [k, q.claims[k].by, q.claims[k].master || null, q.claims[k].rent || null]; }),
                           q.notices, q.funds, q.dropbox]);
  };
  yes('C10 and nothing else a person holds in property.json moves: claims, keys, rent, posts, the other drop boxes and the funds',
      holdings(cp) === holdings(cpWas));
  const profileHeld = ['law.json', 'beds.json', 'farm-claims.json', 'books.json', 'last-left.json'];
  yes('C3 nothing else a profile holds is touched: offices, beds, the farm, books and when they last left, byte for byte',
      profileHeld.every(function (f) { return fs.readFileSync(path.join(c.dir, 'private', f), 'utf8') === c.keep[f]; }));
  yes('C4 the parts that keep those say they found nothing of the characters\'',
      ['farms', 'property', 'books'].every(function (p) { return c.lines.indexOf('release: ' + p + ': nothing of theirs') >= 0; }));
  const cr = j(c.dir, 'embassy.json');
  yes('C5 an embassy row with no profile goes by its form id; a row a profile holds stays, though its character is named',
      cr.embassy.length === 1 && cr.embassy[0].actor === AY &&
      cr.remnant.length === 2 && cr.remnant.some(function (r) { return r.actor === A2 && r.profile === P2; }));
  const cd = j(c.dir, 'dungeon-rewards-ledger.json');
  yes('C6 the chest the character opened keeps its reservation with the character off it, and the record verifies',
      cd.entries['1a2b3:Skyrim.esm'].actor === 0 && cd.entries['1a2b4:Skyrim.esm'].actor === AY && cd.sha256 === checksum(cd));
  const cm = j(c.dir, 'merchant-ledger.json'), cm9 = cm.entries['9:Skyrim.esm'];
  yes('C7 the characters\' supply waits go by form id, the trade waiting on one is cleared, somebody else\'s stay',
      JSON.stringify(Object.keys(cm9.supply)) === JSON.stringify([MKEY_Y]) && cm9.pending === null &&
      JSON.stringify(cm.entries['8:Skyrim.esm']) === JSON.stringify(JSON.parse(c.keep['merchant-ledger.json']).entries['8:Skyrim.esm']) &&
      cm.sha256 === checksum(cm));
  const cc = j(c.dir, 'trade-cargo.json').cargo.holds['ship-1'];
  yes('C8 the listed characters come off the manifest, and another character on a listed character\'s profile stays',
      cc.lines['1'].by === null && cc.lines['2'].for === null && cc.outs[0].who === null &&
      !!cc.lines['3'].by && cc.lines['3'].by.actor === A3 && cc.lines['3'].by.profile === P1);

  // ============================================================ X: a wipe's list (#2668)
  const x = charactersOnly('wipe-list', { profiles: [], actors: [A1],
    done: { saves: NOW, farms: NOW, property: NOW, embassy: NOW, dungeon: NOW, cargo: NOW, stalls: NOW, carts: NOW, books: NOW } });
  yes('X1 only the merchants\' part runs, and then the list is gone (' + x.lines.join(' / ') + ')',
      x.lines.length === 3 && /^release: merchants: /.test(x.lines[1]) && /the list is gone/.test(x.lines[2]) &&
      !fs.existsSync(path.join(x.dir, 'private', 'deleted-characters.json')));
  yes('X2 only the merchant ledger is written (' + x.changed.join(', ') + ')', JSON.stringify(x.changed) === JSON.stringify(['merchant-ledger.json']));
  const xm9 = j(x.dir, 'merchant-ledger.json').entries['9:Skyrim.esm'];
  yes('X3 the wiped character\'s supply wait and waiting trade go; another character\'s stays',
      xm9.pending === null && !(MKEY_1 in xm9.supply) && (MKEY_2 in xm9.supply) && (MKEY_Y in xm9.supply));
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
}
done();
