// Build-WaterTable.js
//
// Builds game\data\waters.json: what kind of water is in every cell and every
// worldspace of the load order.
//
// WHY THERE IS ANYTHING TO BUILD
//
// Patrick, 23 September: "there should be different temperatures for different
// water types like ice, galciers, fresh water, shallow, etc".
//
// The client can tell whether somebody is swimming and it can tell how deep
// they are standing. It cannot tell what they are standing IN, because the
// water type is a WATR record on the cell and nothing in Skyrim Platform
// exposes it. The server holds a cell descriptor for everybody online, so the
// lookup belongs here: cell to water, and when the cell does not say, the
// worldspace it sits in.
//
// WHAT IS MEASURED
//
//   WATR   the 34 water records of the base game, by editor id.
//   XCWT   the water type a CELL declares. 460 cells in Skyrim.esm do.
//   NAM2   the water a WORLDSPACE falls back to, which is what answers for
//          every exterior cell that does not declare one. Tamriel is
//          DefaultWater, Blackreach is BlackreachWater, the Rift has its own.
//
// AND WHAT IS NOT. There is no ice water record in Skyrim, and no glacier
// water: the whole overworld is DefaultWater whether you are off Dawnstar or
// off Riften. So ICE IS NOT READ FROM HERE. A frozen swim is cold weather, a
// dark hour and a high place, all of which the exposure half already measures
// and all of which already apply to somebody in the water. What this table
// adds is the part that IS in the records: a marsh is not a mountain creek, a
// puddle is not the sea, and lava is not water at all.
//
// THE CLASSES, by editor id, and the rule is on the row:
//
//   lava     /lava/            the one that is hotter than a forge
//   marsh    /marsh/           standing, shallow, sun warmed
//   puddle   /puddle|trough|ankle/   barely water
//   river    /river|creek|flow/ moving, and moving water is colder
//   still    /int.*still|clear.*still/  an indoor pool, which is warmer
//   deep     everything else, which is the sea and most lakes
//
// WHAT EACH CLASS IS WORTH is balance and lives in NEEDS.water in
// gamemode.js, the same split as the warmth and weather tables.
//
// Read only. It opens the plugins of the build, writes game\data\waters.json and
// installs the compact table into game\gamemode.js.
//
// Usage:
//   node scripts\dev\Build-WaterTable.js
//   node scripts\dev\Build-WaterTable.js --print
//
// Exit code 1 if a plugin will not parse, if no water is found, or if the
// worldspace everybody plays in has no water at all, which would mean NAM2 is
// not where this thinks it is.
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
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'waters.json'));
const PRINT = args.indexOf('--print') !== -1;

// Tamriel. If this worldspace comes out with no water, NAM2 is not being read
// and every exterior in the game would silently fall back to nothing.
const CANARY = 'Tamriel';

/*
  Order matters: the first one that matches wins, so ice is above river or
  DLC1FrostreachWaterFlowNE would be read as a mountain creek rather than as
  meltwater off a glacier.

  AND ICE IS A SMALL CLASS ON PURPOSE. Bethesda named four records for it and
  no more: there is no icy version of the sea off Dawnstar. The rest of "am I
  swimming in something freezing" is cold weather, a dark hour and a high
  place, which the exposure half already measures and which already applies to
  somebody in the water.
*/
const CLASSES = [
  ['lava', /lava/i],
  ['ice', /cold|frost|frozen|\bice|glacier/i],
  ['marsh', /marsh/i],
  ['puddle', /puddle|trough|ankle/i],
  ['river', /river|creek|flow/i],
  ['still', /(int|interior|clear).*still/i]
];
function classOf(edid) {
  for (const c of CLASSES) { if (c[1].test(edid)) { return c[0]; } }
  return 'deep';
}

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

const waters = {};     // water descriptor -> { e, c }
// #2302: placed water. An ACTI with a WNAM is a water plane somebody put in a
// cell (the Temple of Kynareth's pool is one); getWaterLevel cannot see it.
const placed = {};     // activator descriptor -> { e, w, b: [x1, y1, x2, y2] }
const where = {};      // cell or worldspace descriptor -> water descriptor
let cells = 0, worlds = 0;

/*
  CELLs and WRLDs are NOT top level groups the way KYWD and ARMO are: the CELL
  group holds blocks, which hold sub blocks, which hold the cells, and every
  cell is followed by a group of the references in it. So this one descends,
  and it is the slow walk on purpose.
*/
function walk(b, start, end, mast, self) {
  let j = start;
  while (j + 24 <= end) {
    const type = b.toString('ascii', j, j + 4);
    const dataSize = b.readUInt32LE(j + 4);
    if (type === 'GRUP') {
      if (dataSize < 24) { return; }
      const label = b.toString('ascii', j + 8, j + 12);
      const groupType = b.readUInt32LE(j + 12);
      // Skip the reference groups under a cell: hundreds of thousands of
      // records with nothing in them this wants.
      const isRefs = groupType === 8 || groupType === 9 || groupType === 10;
      if (!isRefs && (groupType !== 0 || label === 'CELL' || label === 'WRLD' ||
                      label === 'WATR' || label === 'ACTI')) {
        walk(b, j + 24, Math.min(j + dataSize, end), mast, self);
      }
      j += dataSize;
      continue;
    }
    const flags = b.readUInt32LE(j + 8);
    const formId = b.readUInt32LE(j + 12);
    if (type === 'WATR' || type === 'CELL' || type === 'WRLD' || type === 'ACTI') {
      try {
        const rec = (flags & 0x00040000)
          ? zlib.inflateSync(b.slice(j + 28, j + 24 + dataSize))
          : b.slice(j + 24, j + 24 + dataSize);
        const s = subrecords(rec);
        const desc = descOf(formId, mast, self);
        const edid = s.EDID ? s.EDID.toString('latin1', 0, s.EDID.length - 1) : '';
        if (type === 'WATR') {
          waters[desc] = { e: edid, c: classOf(edid) };
        } else if (type === 'ACTI') {
          if (s.WNAM && s.WNAM.length >= 4 && s.OBND && s.OBND.length >= 12) {
            placed[desc] = {
              e: edid,
              w: descOf(s.WNAM.readUInt32LE(0), mast, self),
              b: [s.OBND.readInt16LE(0), s.OBND.readInt16LE(2),
                  s.OBND.readInt16LE(6), s.OBND.readInt16LE(8)]
            };
          } else {
            delete placed[desc];
          }
        } else if (type === 'CELL') {
          cells++;
          if (s.XCWT && s.XCWT.length >= 4) {
            where[desc] = descOf(s.XCWT.readUInt32LE(0), mast, self);
          }
        } else {
          worlds++;
          if (s.NAM2 && s.NAM2.length >= 4) {
            where[desc] = descOf(s.NAM2.readUInt32LE(0), mast, self);
          }
        }
      } catch (e) { /* one unreadable record is not the end of it */ }
    }
    j += 24 + dataSize;
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

if (!Object.keys(waters).length) { fail('no water records found'); }

// The canary. Tamriel has to end up with a water, or NAM2 is not being read
// and every exterior in the game falls back to nothing.
let canaryClass = '';
for (const d in where) {
  if (!Object.prototype.hasOwnProperty.call(where, d)) { continue; }
  const w = waters[where[d]];
  if (w && w.e === 'DefaultWater' && d.indexOf(':Skyrim.esm') !== -1) { canaryClass = w.c; }
}
if (!canaryClass) { fail('nothing in the load order points at DefaultWater, so NAM2 or XCWT is not being read'); }

const byClass = {};
for (const d in waters) {
  if (!Object.prototype.hasOwnProperty.call(waters, d)) { continue; }
  byClass[waters[d].c] = (byClass[waters[d].c] || 0) + 1;
}

console.log(parsed + ' plugins read, ' + cells + ' cells and ' + worlds + ' worldspaces, ' +
            Object.keys(waters).length + ' water types, ' +
            Object.keys(where).length + ' places that name one');
console.log('  by class: ' + Object.keys(byClass).sort().map(function (k) {
  return k + ' ' + byClass[k];
}).join(', '));
if (PRINT) {
  Object.keys(waters).sort(function (a, b) {
    return waters[a].e < waters[b].e ? -1 : 1;
  }).forEach(function (d) {
    console.log('  ' + waters[d].c.padEnd(8) + d.padEnd(22) + waters[d].e);
  });
}

function install() {
  // Flattened on the way in: the server only ever asks "what class of water is
  // in this cell", so the two hops are collapsed to one here rather than at
  // run time, and the water records themselves never reach the gamemode.
  const thin = {};
  Object.keys(where).sort().forEach(function (d) {
    const w = waters[where[d]];
    if (w && w.c !== 'deep') { thin[d] = w.c; }
  });
  const changed = TABLES.write('WATERS', { items: thin });
  console.log((changed ? 'wrote ' : 'already current: ') + Object.keys(thin).length + ' places (deep is the default and is left out)' + ' in game\\gamemode-tables\\WATERS.json');
}

/*
  #2302: the placed waters go into the client, which is where wading is
  decided. One row per activator, [plugin, local id, x1, y1, x2, y2], sorted
  so the line only changes when the load order does.
*/
function placedRows() {
  // An activator with no footprint (OBND all 0) has nowhere to stand in.
  return Object.keys(placed).sort().filter(function (d) {
    const b = placed[d].b;
    return b[0] < b[2] && b[1] < b[3];
  }).map(function (d) {
    const c = d.indexOf(':');
    const b = placed[d].b;
    return [d.slice(c + 1), parseInt(d.slice(0, c), 16), b[0], b[1], b[2], b[3]];
  });
}

function installPlaced() {
  const fp = path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
  let src;
  try { src = fs.readFileSync(fp, 'utf8'); } catch (e) { fail('no thornswood-front.js to install into'); return; }
  const rows = placedRows();
  const line = '  const PLACED_WATERS = ' + JSON.stringify(rows) + ';';
  const re = /^  const PLACED_WATERS = .*;$/m;
  if (!re.test(src)) { fail('could not find PLACED_WATERS in thornswood-front.js'); return; }
  const next = src.replace(re, function () { return line; });
  if (next === src) { console.log('installed placed waters already match this load order'); return; }
  fs.writeFileSync(fp, next);
  console.log('installed ' + rows.length + ' placed waters into game\\plugins\\thornswood-front.js');
}

if (!Object.keys(placed).length) { fail('no placed water activators found, so ACTI WNAM is not being read'); }

if (process.exitCode === 1) {
  console.error('nothing written');
} else {
  install();
  installPlaced();
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts\\dev\\Build-WaterTable.js',
    builtAt: new Date().toISOString(),
    source: 'the WATR, CELL and WRLD records of ' + parsed + ' plugins in load order',
    readFrom: 'XCWT on a cell, NAM2 on a worldspace, and the editor id of the WATR they point at',
    note: 'what a class is WORTH is balance and lives in NEEDS.water in gamemode.js. ' +
          'There is no ice water record in Skyrim: a frozen swim is cold weather, ' +
          'a dark hour and a high place, which the exposure half already measures.',
    classes: CLASSES.map(function (c) { return c[0] + ': ' + String(c[1]); }),
    byClass: byClass,
    waters: waters,
    placed: placed,
    where: where
  }, null, 2) + '\n');
  console.log('wrote ' + OUT);
}
