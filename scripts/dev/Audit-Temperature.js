// Audit-Temperature.js
//
// What every input to the temperature is actually worth, run through the real
// needs block out of gamemode.js with the real tables installed in it.
//
// Patrick, 23 September, after an evening of it: "This temperature shit is not
// working like at all with clothes, fire, water, wind, snow, indoors, nothing
// man ... do an audit on it and fix it please".
//
// This is that audit, and it is a tool rather than a one-off: every number
// below is computed by the shipped code, so it cannot drift from what the
// server does, and anybody can run it after changing a tuning number to see
// what they just did to the game.
//
//   node scripts\dev\Audit-Temperature.js
//
// Read only. It touches nothing and talks to nothing.
const fs = require('fs');
const path = require('path');

const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

const A = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const B = '// ==== end thornswood needs ====';
const a = src.indexOf(A);
const b = src.indexOf(B);
if (a < 0 || b < 0) {
  console.error('the needs block is not in gamemode.js');
  process.exit(1);
}

// The three tables the block reads, out of game\gamemode-tables where the
// gamemode reads them when it loads (#5191), so this audits what is installed
// rather than what is in game\data beside it. GM_TABLES names another folder.
const TABLES = require('./GamemodeTables.js');
function table(name, fallback) {
  try { return TABLES.read(name, process.env.GM_TABLES || TABLES.DIR); } catch (e) { return fallback; }
}
const WARMTH = table('WARMTH', { items: {} });
const WEATHER = table('WEATHER', { most: 0, mid: 0, items: {} });
const WATERS = table('WATERS', { items: {} });

// ------------------------------------------------------------------ the rig
const clock = { now: 1700000000000 };
const store = {};
const worn = {};
const cells = {};
const ids = {};
let nextId = 0x10;
function idOf(desc) {
  if (!ids[desc]) { ids[desc] = nextId++; }
  return ids[desc];
}
const mp = {
  getOnlinePlayers: () => Object.keys(store).map(Number),
  makeProperty: () => {},
  getDescFromId: (id) => {
    for (const d in ids) { if (ids[d] === id) { return d; } }
    return '';
  },
  get: (id, key) => {
    if (key === 'worldOrCellDesc') { return cells[id] || 'cell:X.esm'; }
    if (key === 'inventory') { return { entries: worn[id] || [] }; }
    if (key === 'pos') { return [0, 0, 0]; }
    if (key === 'equipment') { return { inv: { entries: worn[id] || [] } }; }
    return store[id] ? store[id].v : undefined;
  },
  set: (id, key, v) => { if (!store[id]) { store[id] = {}; } store[id].v = v; }
};
const fakeDate = function () { return new Date(clock.now); };
fakeDate.now = () => clock.now;

const block = src.slice(a, b);
const fn = new Function(
  'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
  'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
  'idOf', 'WARMTH', 'WEATHER', 'WATERS',
  block + '\nreturn globalThis.__thornswoodNeeds;');
const g = {};
const api = fn(g, mp, fakeDate, { log: () => {} }, () => 0, () => {},
               (n, f) => f, () => {}, () => {}, Math, Number, String, Object,
               isFinite, idOf, WARMTH, WEATHER, WATERS);

// ------------------------------------------------------------- the scenarios
/*
  Each one is a place the client can actually report, with the fields it
  sends: the word, the weather id, night, roof, height and the fire distance.
  A person is made fresh for each, so nothing carries over.
*/
let who = 100;
function run(what, place, opts) {
  const id = who++;
  api.view(id);                       // make a state at comfort
  const o = opts || {};
  if (o.wear) { worn[id] = o.wear.map((d) => ({ baseId: idOf(d), worn: true })); }
  if (o.cell) { cells[id] = o.cell; }
  api.place(id, place, o.sky || '-', o.night ? '1' : '0', o.roof ? '1' : '0',
            String(o.high || 0), o.fire === undefined ? '-' : String(o.fire));
  const v0 = api.view(id);
  // The clock is this file's own, the way the harness drives it: move it and
  // ask again, so every number below is the shipped settle curve.
  const marks = [10, 30, 60, 180];
  const at = [];
  let stood = 0;
  for (const secs of marks) {
    clock.now += (secs - stood) * 1000;
    stood = secs;
    at.push(Math.round(api.view(id).temp));
  }
  const v = api.view(id);
  return { what: what, target: v0.tempTarget, at: at, band: v.tempBand, cover: v.cover };
}

function warm(desc) {
  // A descriptor out of the installed table, by what it covers.
  for (const d in WARMTH.items) {
    if (!Object.prototype.hasOwnProperty.call(WARMTH.items, d)) { continue; }
    if (WARMTH.items[d].c === desc.c && WARMTH.items[d].m === desc.m) { return d; }
  }
  return null;
}

const furBody = warm({ m: 'fur', c: 'body' });
const furFeet = warm({ m: 'fur', c: 'feet' });
const clothBody = warm({ m: 'cloth', c: 'body' });

/*
  A weather id out of the installed table, by what kind it is, AS THE CLIENT
  SENDS IT.

  The table is keyed by descriptor and the client sends the runtime form id in
  hex, which the block resolves through idOf once and then indexes. The first
  version of this audit handed over the descriptor key and reported that wind
  and sun were worth nothing at all, which was this tool being wrong rather
  than the game. A tool that cannot be trusted about its own inputs is worse
  than no tool.
*/
function sky(kind) {
  for (const key in WEATHER.items) {
    if (!Object.prototype.hasOwnProperty.call(WEATHER.items, key)) { continue; }
    const r = WEATHER.items[key];
    let want = false;
    if (kind === 'clear') { want = (r.k & 1) && r.w <= WEATHER.mid; }
    if (kind === 'snow') { want = !!(r.k & 8); }
    if (kind === 'rain') { want = !!(r.k & 4); }
    if (kind === 'cloud') { want = !!(r.k & 2); }
    if (kind === 'windy') { want = r.w >= WEATHER.most - 1; }
    if (want) { return idOf(key).toString(16); }
  }
  return '';
}

const rows = [];
rows.push(run('indoors, dry, nothing on', 'indoors', { roof: true }));
rows.push(run('indoors, at a hearth (90 away)', 'indoors', { roof: true, fire: 90 }));
rows.push(run('indoors, standing IN the fire', 'indoors', { roof: true, fire: 0 }));
rows.push(run('outdoors, clear day', 'outdoors', { sky: sky('clear') }));
rows.push(run('outdoors, clear night', 'outdoors', { sky: sky('clear'), night: true }));
rows.push(run('outdoors, rain', 'rain', { sky: sky('rain') }));
rows.push(run('outdoors, snow', 'snow', { sky: sky('snow') }));
rows.push(run('outdoors, the windiest weather there is', 'outdoors', { sky: sky('windy') }));
rows.push(run('outdoors, overcast', 'outdoors', { sky: sky('cloud') }));
rows.push(run('outdoors, snow falling on you', 'outdoors', { sky: sky('snow') }));
rows.push(run('outdoors, rain falling on you', 'outdoors', { sky: sky('rain') }));
rows.push(run('high up, 12,000 units', 'outdoors', { sky: sky('clear'), high: 12000 }));
rows.push(run('wading, shallow water', 'shallow', { sky: sky('clear') }));
rows.push(run('swimming', 'water', { sky: sky('clear') }));
rows.push(run('swimming at night in snow', 'water', { sky: sky('snow'), night: true }));
rows.push(run('at a forge', 'fire', { roof: true }));
if (furBody && furFeet) {
  rows.push(run('snow, nothing on', 'snow', { sky: sky('snow') }));
  rows.push(run('snow, fur body and boots', 'snow', { sky: sky('snow'), wear: [furBody, furFeet] }));
}
if (clothBody) {
  rows.push(run('snow, a cloth shirt', 'snow', { sky: sky('snow'), wear: [clothBody] }));
}

// ------------------------------------------------------------------- report
console.log('');
console.log('TEMPERATURE, AS THE SHIPPED CODE COMPUTES IT');
console.log('comfort is 50. target is where it is heading; the four numbers are');
console.log('what the meter reads after 10s, 30s, 1m and 3m from a fresh 50.');
console.log('');
console.log('  ' + 'situation'.padEnd(38) + 'target   10s  30s   1m   3m   cover  band');
console.log('  ' + '-'.repeat(84));
for (const r of rows) {
  console.log('  ' + r.what.padEnd(38) +
              String(r.target).padStart(5) + '   ' +
              r.at.map((n) => String(n).padStart(4)).join(' ') + '   ' +
              (r.cover + '%').padStart(5) + '  ' + r.band);
}
console.log('');

// What the tables actually hold, since a table that resolved nothing looks
// exactly like every input being worth zero.
console.log('the tables inside gamemode.js:');
console.log('  warmth  ' + Object.keys(WARMTH.items || {}).length + ' wearables');
console.log('  weather ' + Object.keys(WEATHER.items || {}).length + ' records, ' +
            'middle wind ' + WEATHER.mid + ', windiest ' + WEATHER.most);
console.log('  waters  ' + Object.keys(WATERS.items || {}).length + ' cells and worldspaces');
console.log('');
