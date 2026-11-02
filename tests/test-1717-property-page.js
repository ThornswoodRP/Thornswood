// test-1717-property-page.js
//
// #1717. The property page of the K panel never appeared, for anybody. The
// server put the rows on the panel view (view.property in the character
// block's writeState), and the page read them from DATA.property, its own
// section table, which the server never sends. So the list was always empty
// and the Property section was never in K's list: what you hold, the rent on
// it, your farm (#1637) and tonight's guests with their Stop (#1603).
//
// This runs the whole road a row travels, with the real pieces at each end:
//
//   the server  the real progression, character and property blocks in one
//               world: writeState builds the stored value with propertyView
//               over the property block's claims, keys and guests
//   the wire    the real updateOwner script the character block registers,
//               run on that value the way the client runs it each frame;
//               what it hands executeJavaScript is what the browser gets
//   the page    the real game/ui/thornswood-skills.js in a stand-in
//               document, fed exactly that
//
// and then the one thing the page sends, Stop, goes back to the property
// block's own command, which redraws through writeState again.
//
// Read only.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(process.env.GM || path.join(REPO, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const ui = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-skills.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(text, a, b) {
  const i = text.indexOf(a);
  const j = i < 0 ? -1 : text.indexOf(b, i);
  return (i >= 0 && j >= 0) ? text.slice(i, j) : null;
}

const RULES = between(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const PROPERTY = between(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const CHARACTER = between(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
yes('the progression, property and character blocks are in the gamemode', !!(RULES && PROPERTY && CHARACTER));
if (!(RULES && PROPERTY && CHARACTER)) { done(); }

// ------------------------------------------------------------- the world --
const clock = { t: Date.UTC(2026, 9, 4, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const DAY = 86400000;

const TUNDRA = '3c:Skyrim.esm';
const HOME = '16778:Skyrim.esm';   // Honeyside: Carol's, with rent on it
const SHOP = '1a2b3:Skyrim.esm';   // Bob's shop, and Carol carries a key to it
const BUILDING_NAME = {};
BUILDING_NAME[HOME] = 'Honeyside';
BUILDING_NAME[SHOP] = 'The Shop';

const ids = {};
let nextId = 0x05000000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}
const KEY_DESC = (/var KEY = '([^']+:Thornswood-Content\.esp)';/.exec(PROPERTY) || [])[1];
yes('the key record is read out of the property block', !!KEY_DESC);

const ALICE = { a: 0xff000202, pid: 202, name: 'Alice' };   // holds nothing, carries no key
const BOB = { a: 0xff000303, pid: 303, name: 'Bob' };       // holds the shop
const CAROL = { a: 0xff000404, pid: 404, name: 'Carol' };   // holds Honeyside and a farm, a key to the shop
const PEOPLE = [ALICE, BOB, CAROL];

const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                pos: [1000, 1000, 0], inventory: { entries: [] } };
});
const online = PEOPLE.map(function (p) { return p.a; });
const made = {};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1717-property-page-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [HOME]: { by: CAROL.pid, name: 'Carol', at: clock.t - 8 * DAY, touched: clock.t,
            rent: { amount: 50, everyDays: 7, owed: 0, since: clock.t - 8 * DAY } },
  [SHOP]: { by: BOB.pid, name: 'Bob', at: clock.t, touched: clock.t }
} }));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const mp = {
  makeProperty: function (name, opts) { made[name] = opts; },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
    if (!refs[id]) { throw new Error('no reference ' + id); }
    const v = refs[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) {
    if (!refs[id]) { refs[id] = {}; }
    refs[id][key] = JSON.parse(JSON.stringify(v));
  },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function () { return null; },
  getNeighborsByPosition: function () { return []; }
};
const ctx = {
  console: { log: function () { }, error: function () { } }, require: require, mp: mp, Date: FakeDate,
  BUILDING_BY_DOOR: {}, BUILDING_NAME: BUILDING_NAME, WAY_OUT: {}, BENCH_BY_BASE: {}, idOf: idOf,
  guard: function (n, f) { return f; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  notify: function () { }, say: function () { }, log: function () { },
  spellOn: function () { return true; }, giveTool: function () { return null; }, raceOf: function () { return ''; },
  // The farm is the farming block's own claim; its answer is all propertyView asks of it.
  __thornswoodFarming: { farmOf: function (pid) { return pid === CAROL.pid ? { days: 9, reach: 1200 } : null; } }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
let booted = true;
inDir(function () {
  try {
    vm.runInContext(RULES, ctx, { filename: 'gamemode.js progression' });
    vm.runInContext(PROPERTY, ctx, { filename: 'gamemode.js property' });
    vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  } catch (e) { booted = false; console.log(e); }
});
const W = ctx.__thornswoodProperty, C = ctx.__thornswoodCharacter;
yes('the three blocks run together, and the character block registers its property with an updateOwner script',
    booted && !!W && !!C && !!made[C.PROPERTY] && typeof made[C.PROPERTY].updateOwner === 'string');
if (!(booted && W && C && made[C.PROPERTY])) { done(); }
refs[CAROL.a].inventory.entries.push({ baseId: idOf(KEY_DESC), count: 1, name: W.keyLabel(SHOP) });

// --------------------------------------------------------------- the page --
/* One K panel, the real page in a stand-in document: one per person, as in the game. */
function makePage() {
  const lines = [];       // what the page sent the server through the chat line
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
                skyrimPlatform: { sendMessage: function () { } },
                thornswoodNet: { say: function (l) { lines.push(l); } } };
  const box = { window: win, document: docu, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
  vm.createContext(box);
  try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { console.log(e); return null; }
  const api = win.thornswoodSkills;
  if (!api) { return null; }
  api.open();
  const root = docu.body.children[0];
  const nav = root._q['.nav'];
  const pg = { box: box, api: api, lines: lines, nav: nav, body: root._q['.body'], title: root._q['.title'] };
  pg.navRows = function () { return nav.children.filter(function (r) { return /navrow/.test(r.className); }); };
  pg.navNames = function () { return pg.navRows().map(function (r) { return r.children[0].textContent; }); };
  pg.navRow = function (name) { return pg.navRows().filter(function (r) { return r.children[0].textContent === name; })[0]; };
  pg.stops = function () { return all(pg.body).filter(function (n) { return n.className === 'stop'; }); };
  return pg;
}
function all(n, out) {
  out = out || [];
  out.push(n);
  (n.children || []).forEach(function (c) { all(c, out); });
  return out;
}
const pages = {};
pages[CAROL.a] = makePage();
pages[ALICE.a] = makePage();
yes('the K panel runs in a stand-in document', !!pages[CAROL.a] && !!pages[ALICE.a]);
if (!pages[CAROL.a] || !pages[ALICE.a]) { done(); }
const carol = pages[CAROL.a], alice = pages[ALICE.a];

/*
  The wire. One client per person, as in the game: its own ctx.state across
  frames, the registered updateOwner script run on whatever value is on the
  character, and what it hands executeJavaScript run in the page.
*/
const clientState = {};
function frame(p) {
  const handed = [];
  const value = refs[p.a][C.PROPERTY];
  const cctx = { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
                 state: clientState[p.a] || (clientState[p.a] = {}),
                 sp: { browser: { executeJavaScript: function (src) { handed.push(src); } } } };
  new Function('ctx', made[C.PROPERTY].updateOwner)(cctx);
  handed.forEach(function (src) { vm.runInContext(src, pages[p.a].box, { filename: 'executeJavaScript' }); });
  return handed.length;
}
/* The server writes the character the way any answer does, and the client draws. */
function write(p, redraw) {
  inDir(function () { C.writeState(p.a, C.stateOf(p.a), !!redraw); });
  return frame(p);
}
/* A line as the page's button sends it, to the property block's own command. */
function send(p, text) {
  const out = [];
  const parts = text.trim().split(/\s+/);
  inDir(function () { W.command(parts[0], parts, p.a, p.pid, function (pid, m) { out.push(m); }); });
  frame(p);
  return out.join('\n');
}

// --------------------------------------------- A. the server's half of it --
{
  write(CAROL, true);
  const stored = refs[CAROL.a][C.PROPERTY];
  const rows = stored && stored.panel && stored.panel.property;
  yes('A1 the server puts the rows on the panel view, under panel.property (' +
      JSON.stringify((rows || []).map(function (r) { return r.name; })) + ')',
      Array.isArray(rows) && rows.length === 3);
  yes('A1 and not at the top of the stored value, nor anywhere the page calls DATA',
      stored && stored.property === undefined && stored.DATA === undefined);
  const home = (rows || []).filter(function (r) { return r.name === W.placeOf(HOME); })[0];
  yes('A2 Honeyside is Carol\'s, with the building id and the rent owed up to now',
      !!home && home.mine === true && home.b === HOME && !!home.rent && home.rent.owed === 50);
}

// ---------------------------------------------------- B. the page draws it --
{
  yes('B1 what the client handed the browser reaches setData, and Property is in K\'s list (' +
      carol.navNames().join(', ') + ')', carol.navNames().indexOf('Property') !== -1);
  const row = carol.navRow('Property');
  yes('B2 the list says what is held and what is keyed: "' + (row ? row.children[1].textContent : '') + '"',
      !!row && row.children[1].textContent === '2 held, 1 keyed');
  if (row) { row.onclick(); }
  yes('B3 the page has its heading: "' + carol.title.textContent + '"', carol.title.textContent === 'Property');
  const text = carol.body.textContent;
  yes('B4 it lists Honeyside with the rent owed on it',
      /Honeyside/.test(text) && /Rent is 50 gold every 7 days, 50 gold owed now\./.test(text));
  yes('B5 and the farm with its days', /Your farm/.test(text) && /goes back in 9 days/.test(text));
  yes('B6 and the shop Carol carries a key to, as Bob\'s', /The Shop/.test(text) && /Held by Bob\./.test(text));
  yes('B7 with nobody let in tonight it says how, and offers no Stop',
      /Nobody else may sleep here tonight/.test(text) && carol.stops().length === 0);
}

// ------------------------------------------- C. tonight's guests, and Stop --
{
  refs[CAROL.a].worldOrCellDesc = HOME; refs[CAROL.a].pos = [100, 100, 0];
  refs[BOB.a].worldOrCellDesc = HOME; refs[BOB.a].pos = [200, 100, 0];
  const said = send(CAROL, '/sleephere ' + BOB.a.toString(16));
  yes('C1 the look prompt\'s key lets Bob sleep at Honeyside: "' + said + '"', /Bob may sleep at Honeyside/.test(said));
  const stops = carol.stops().filter(function (n) { return n.textContent === 'Stop'; });
  yes('C2 the property block\'s own redraw reaches the open page: Bob is under Honeyside with a Stop',
      /May sleep here tonight/.test(carol.body.textContent) && /Bob/.test(carol.body.textContent) && stops.length === 1);
  carol.lines.length = 0;
  if (stops.length) { stops[0].onclick({ stopPropagation: function () { } }); }
  yes('C3 Stop sends /sleephere stop with Bob\'s profile and the building (' + carol.lines.join(' | ') + ')',
      carol.lines.join('|') === '/sleephere stop ' + BOB.pid + ' ' + HOME);
  const answer = carol.lines.length ? send(CAROL, carol.lines[0]) : '';
  yes('C4 the server ends the night: "' + answer + '"', /Bob/.test(answer) && /Honeyside/.test(answer));
  yes('C5 and the page is drawn again without him',
      /Nobody else may sleep here tonight/.test(carol.body.textContent) && carol.stops().length === 0);
}

// ------------------------------------------------ D. nobody, and nothing --
{
  write(ALICE, true);
  const stored = refs[ALICE.a][C.PROPERTY];
  yes('D1 somebody who holds nothing and carries no key gets no rows from the server',
      !!stored && !!stored.panel && stored.panel.property === undefined);
  yes('D2 and no Property in their K list (' + alice.navNames().join(', ') + ')',
      alice.navNames().length > 0 && alice.navNames().indexOf('Property') === -1);
  const handed = write(CAROL, false);
  yes('D3 a write that changes nothing on the page hands the browser nothing', handed === 0);
}

// ------------------------- F. rent still owed on a place you no longer hold --
{
  // #3893: the deed went to somebody else and the debt stayed Alice's.
  W.arrears()[HOME] = [{ by: ALICE.pid, name: 'Alice', owed: 40, at: clock.t }];
  write(ALICE, true);
  const rows = (refs[ALICE.a][C.PROPERTY].panel || {}).property || [];
  yes('F1 somebody who holds nothing but owes on a place they held gets a row for it (' + JSON.stringify(rows) + ')',
      rows.length === 1 && rows[0].name === W.placeOf(HOME) && rows[0].mine === false && rows[0].owes === 40 &&
      rows[0].by === 'Carol' && !rows[0].keyed);
  const row = alice.navRow('Property');
  yes('F2 Property is in their K list, saying rent is owed (' + (row ? row.children[1].textContent : '') + ')',
      !!row && row.children[1].textContent === 'rent owed');
  if (row) { row.onclick(); }
  yes('F3 and the page says what they owe, from when, and how it is paid (' + alice.body.textContent.slice(0, 400) + ')',
      /Honeyside/.test(alice.body.textContent) && /rent owed/.test(alice.body.textContent) &&
      /Held by Carol now\. You still owe 40 gold of rent on it from when you held it\./.test(alice.body.textContent) &&
      /drop box pays it, or hand it to the steward of its hold\./.test(alice.body.textContent));
  delete W.arrears()[HOME];
}

// --------------------------------------------------------- E. the source --
{
  const strip = function (t) { return String(t || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '); };
  const reader = between(ui, '  function propertyRows() {', '\n  }\n') || '';
  yes('E1 the page reads the rows from mine.property, where the server sends them',
      /mine && mine\.property/.test(reader) && !/DATA/.test(reader));
  yes('E2 and nothing in the page reads them out of its own table',
      !/DATA\s*(?:&&\s*DATA)?\.property\b/.test(strip(ui)));
  const writer = between(gm, '  function writeState(actorId, s, redraw) {', '\n  }\n') || '';
  yes('E3 writeState is where the server puts them, on the view', /view\.property = held;/.test(writer));
}

done();
