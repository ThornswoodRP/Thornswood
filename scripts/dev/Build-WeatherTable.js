// Build-WeatherTable.js
//
// Builds game\data\weather.json: how hard the wind blows in every weather in the
// load order, and what kind of weather it is.
//
// WHY THERE IS ANYTHING TO BUILD
//
// Patrick, 23 September: "the temp should also account for wind and all other
// weather reelated and environment factors".
//
// The client can ask the game which weather is running and it can ask that
// weather which way the wind is blowing. It cannot ask how HARD, because
// Weather.pex exposes getWindDirection and getWindDirectionRange and no wind
// speed at all. The number exists: it is the first byte of the WTHR record's
// DATA subrecord, and it runs from 0 to 178 across the base game. So the
// client reports which weather it is in and the server looks the wind up here.
//
// WHAT IS MEASURED
//
//   wind   DATA byte 0, 0 to 255. SkyrimClear is 25, SkyrimCloudy 38,
//          SkyrimStormRain 50, SkyrimOvercastSnow 76 and SkyrimStormSnow 178,
//          which is the blizzard and is four times a clear day.
//   kind   DATA byte 11, the classification flags: 1 pleasant, 2 cloudy,
//          4 rainy, 8 snow, and 16 on top of any of them for a permanent
//          aurora. The same bits Weather.getClassification answers from.
//   storm  a rainy or snowy weather whose editor id names it a storm (#3176):
//          the blizzards and the heavy storms that slow travel. The record
//          has no storm flag, and neither of the two numbers above can tell
//          one: Cathedral Weathers gives SkyrimStormRain and
//          SkyrimOvercastRain the same wind of 85, and both are rainy. The
//          only place the record says which is a storm is its name, which is
//          how Bethesda (SkyrimStormRain, SkyrimStormSnow) and Cathedral
//          Weathers (xStormRain, xStormSnow) both tell them apart.
//
// WHAT IT IS WORTH is balance and lives in NEEDS.weather in gamemode.js, the
// same split as the warmth table.
//
// Read only. It opens the plugins of the build and writes game\data\weather.json,
// and installs the compact table into game\gamemode.js.
//
// Usage:
//   node scripts\dev\Build-WeatherTable.js
//   node scripts\dev\Build-WeatherTable.js --print
//
// Exit code 1 if a plugin will not parse, if no weather is found, if the
// known blizzard does not come out as the windiest thing in the base game,
// which is the one check that says the byte offset is still right, or if
// Bethesda's own storms stop reading as storms and its overcast rain starts
// to.
const fs = require('fs');
const path = require('path');
const { pluginPath, loadedOrder } = require('./OwnPlugins.js');
const TABLES = require('./GamemodeTables.js');
const zlib = require('zlib');

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const DATA = opt('data', 'C:\\Thornswood\\Game\\Data');
const PLUGINS_TXT = opt('plugins', 'C:\\Thornswood\\Profile\\Default\\plugins.txt');
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'weather.json'));
const PRINT = args.indexOf('--print') !== -1;

// The record that proves the offsets are still right. If Bethesda's own
// blizzard stops being the windiest weather in Skyrim.esm, byte 0 is not the
// wind any more and every number in this table is noise.
const CANARY = 'SkyrimStormSnow';

// The storm rule, and the four records that prove it still sorts the load
// order the way the name says: Bethesda's storm rain and blizzard are storms,
// its overcast rain and overcast snow are not.
const STORM_NAME = /Storm/;
const STORMS = ['SkyrimStormRain', 'SkyrimStormSnow'];
const CALM = ['SkyrimOvercastRain', 'SkyrimOvercastSnow'];
function isStorm(k, e) { return (k & 12) !== 0 && STORM_NAME.test(e || ''); }

function fail(msg) { console.error('FAIL  ' + msg); process.exitCode = 1; }

function masters(b, headerSize) {
  const out = [];
  let k = 24;
  const end = 24 + headerSize;
  while (k + 6 <= end) {
    const sub = b.toString('ascii', k, k + 4);
    const sz = b.readUInt16LE(k + 4);
    k += 6;
    if (sub === 'MAST' && sz > 1) { out.push(b.toString('latin1', k, k + sz - 1)); }
    k += sz;
  }
  return out;
}

function descOf(formId, mast, self) {
  const idx = (formId >>> 24) & 0xff;
  const from = idx < mast.length ? mast[idx] : self;
  return (formId & 0x00ffffff).toString(16) + ':' + from;
}

function subrecords(rec) {
  const got = {};
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if (k + sz > rec.length) { break; }
    if (!got[sub]) { got[sub] = rec.slice(k, k + sz); }
    k += sz;
  }
  return got;
}

const items = {};
let seen = 0;

function walk(b, start, end, mast, self) {
  let i = start;
  while (i + 24 <= end) {
    if (b.toString('ascii', i, i + 4) !== 'GRUP') { break; }
    const groupSize = b.readUInt32LE(i + 4);
    if (groupSize < 24) { break; }
    if (b.toString('ascii', i + 8, i + 12) === 'WTHR') {
      let j = i + 24;
      const stop = Math.min(i + groupSize, end);
      while (j + 24 <= stop) {
        const type = b.toString('ascii', j, j + 4);
        const dataSize = b.readUInt32LE(j + 4);
        if (type === 'GRUP') { if (dataSize < 24) { break; } j += dataSize; continue; }
        const flags = b.readUInt32LE(j + 8);
        const formId = b.readUInt32LE(j + 12);
        if (type === 'WTHR') {
          seen++;
          try {
            const rec = (flags & 0x00040000)
              ? zlib.inflateSync(b.slice(j + 28, j + 24 + dataSize))
              : b.slice(j + 24, j + 24 + dataSize);
            const s = subrecords(rec);
            if (s.DATA && s.DATA.length >= 12) {
              const e = s.EDID ? s.EDID.toString('latin1', 0, s.EDID.length - 1) : '';
              const row = { w: s.DATA[0], k: s.DATA[11], e: e };
              if (isStorm(row.k, e)) { row.s = 1; }
              items[descOf(formId, mast, self)] = row;
            }
          } catch (e) { /* one unreadable weather is not the end of it */ }
        }
        j += 24 + dataSize;
      }
    }
    i += groupSize;
  }
}

const order = loadedOrder(PLUGINS_TXT, DATA);
let parsed = 0;
for (const pl of order) {
  const p = pluginPath(DATA, pl);
  let b;
  try { b = fs.readFileSync(p); } catch (e) { fail('could not read ' + pl); continue; }
  if (b.length < 24 || b.toString('ascii', 0, 4) !== 'TES4') { fail('not a plugin: ' + pl); continue; }
  const headerSize = b.readUInt32LE(4);
  try { walk(b, 24 + headerSize, b.length, masters(b, headerSize), pl); }
  catch (e) { fail(pl + ' would not walk: ' + e.message); }
  parsed++;
}

const rows = Object.keys(items).map(function (d) { return items[d]; });
if (!rows.length) { fail('no weather found'); }

// The canary: Bethesda's blizzard has to be the windiest thing in the base
// game, or byte 0 is not the wind.
let windiest = null;
let canary = null;
for (const r of rows) {
  if (!windiest || r.w > windiest.w) { windiest = r; }
  if (r.e === CANARY) { canary = r; }
}
if (!canary) { fail('the canary weather ' + CANARY + ' is not in this load order'); }
else if (canary.w < 100) { fail(CANARY + ' reads a wind of ' + canary.w + ', which is not a blizzard'); }
for (const r of rows) {
  if (STORMS.indexOf(r.e) !== -1 && !r.s) { fail(r.e + ' does not read as a storm'); }
  if (CALM.indexOf(r.e) !== -1 && r.s) { fail(r.e + ' reads as a storm'); }
}

const maxWind = windiest ? windiest.w : 0;

/*
  THE MIDDLE, AND IT IS HERE BECAUSE A WEATHER MOD FLATTENED THE WIND.

  In Skyrim.esm SkyrimClear blows at 25 and SkyrimStormSnow at 178, so the raw
  byte is a good measure of how exposed somebody is. Cathedral Weathers is in
  this load order and it overrides both of them with 150. Scaling the raw byte
  against the maximum would have said a clear afternoon in Whiterun was three
  quarters of a gale.

  So the wind is read RELATIVE TO THIS LOAD ORDER'S OWN MIDDLE: at or below the
  median it counts for nothing, and it climbs from there to the windiest thing
  in the table. That is correct on vanilla numbers and correct on Cathedral's,
  which is the point of measuring it here rather than assuming either.
*/
const sorted = rows.map(function (r) { return r.w; }).sort(function (a, b) { return a - b; });
const midWind = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

console.log(parsed + ' plugins read, ' + seen + ' weathers seen, ' +
            Object.keys(items).length + ' with a wind reading');
console.log('  windiest is ' + (windiest ? windiest.e + ' at ' + windiest.w : 'nothing') +
            ', the middle is ' + midWind +
            ', ' + CANARY + ' reads ' + (canary ? canary.w : '-'));
if (PRINT) {
  rows.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 20)
    .forEach(function (r) { console.log('  ' + String(r.w).padStart(4) + '  ' + r.e); });
}

function install() {
  const thin = {};
  Object.keys(items).sort().forEach(function (d) {
    thin[d] = { w: items[d].w, k: items[d].k };
    if (items[d].s) { thin[d].s = 1; }
  });
  const changed = TABLES.write('WEATHER', { most: maxWind, mid: midWind, items: thin });
  console.log((changed ? 'wrote ' : 'already current: ') + Object.keys(thin).length + ' rows' + ' in game\\gamemode-tables\\WEATHER.json');
}

if (process.exitCode === 1) {
  console.error('nothing written');
} else {
  install();
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts\\dev\\Build-WeatherTable.js',
    builtAt: new Date().toISOString(),
    source: 'the WTHR records of ' + parsed + ' plugins in load order',
    readFrom: 'DATA byte 0 for the wind speed, DATA byte 11 for the classification flags, ' +
              'and s for a rainy or snowy weather whose editor id names it a storm',
    note: 'what a wind is WORTH is balance and lives in NEEDS.weather in gamemode.js',
    canary: CANARY + ' at ' + (canary ? canary.w : '-'),
    most: maxWind,
    mid: midWind,
    count: Object.keys(items).length,
    items: items
  }, null, 2) + '\n');
  console.log('wrote ' + OUT);
}
