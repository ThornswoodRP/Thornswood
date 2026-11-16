// Build-WorldspaceTable.js
//
// Builds DATA.worldspaces, the set the server reads as "a worldspace, not a
// room": every WRLD record of the load order, by descriptor. It writes the
// list to game\data\worldspaces.json. Build-WakeTable.js, the next step of
// the chain, writes game\gamemode-tables\DATA.json from it: the
// hand-written game\data\data.json with the list and the wake table after
// it, laid out for the gamemode to read (#5191, DataTable.js). Until 16 Nov
// 2026 it wrote the list into data.json itself, so a file people edit was
// also a table the content build writes.
//
// WHY THERE IS ANYTHING TO BUILD
//
// The list was recovered into data.json when tools\thornswood-src was retired
// (5d1f3f0, 21 September) and kept by hand after that. Read against the Main
// install's load order on 5 October it named 39 of the 65 WRLD records there
// (#1896): none of Dawnguard's (the Soul Cairn, the Forgotten Vale, Fort
// Dawnguard), neither of WindhelmSSE.esp's, none of Solitude Arena.esp's 14,
// nor Update.esm's TestSnow. Before that it also named three Dragonborn.esm
// overrides of Skyrim.esm's worldspaces as if they were worldspaces of their
// own (#1007). A list kept by hand drifts from the plugins both ways, so this
// reads it out of them.
//
// WHAT IS MEASURED
//
// The WRLD top group of every plugin switched on in plugins.txt (a line that
// starts with *), after Skyrim's five masters, which plugins.txt never lists.
// A record's descriptor is its form id with the master byte read against that
// plugin's own MAST list, the same descriptor the server writes as
// worldOrCellDesc: so Dragonborn.esm's copy of Tamriel is 3c:Skyrim.esm, the
// record it overrides, and not a worldspace of its own. A worldspace the last
// plugin to carry it marks deleted is not in the load order and is left out.
//
// WHO READS THE LIST
//
// WORLDSPACES in gamemode.js, which resolveArrival (the temple a death writes,
// and the one a person who comes back dead gets) and climateOf (which hold's
// sky somebody stands under) read as "outdoors". No worldspace is a key of
// DATA.cellToHold, so both pick the same hold for a worldspace in this list or
// out of it; what the list changes is in docs\GAMEMODE.md, Generated tables.
//
// Usage:
//   node scripts\dev\Build-WorldspaceTable.js
//   node scripts\dev\Build-WorldspaceTable.js --check
//   node scripts\dev\Build-WorldspaceTable.js --data "C:\Thornswood\Game\Data" --plugins "C:\Thornswood\Profile\OwnGame\plugins.txt"
//
// --check reads the plugins and says whether worldspaces.json holds
// exactly that list, and writes nothing. --print lists every WRLD record with
// its editor id. Exit code 1 if a plugin that is switched on is not in the
// Data folder or will not parse, if Tamriel is not found (the reader is
// wrong), or, with --check, if the list differs.
'use strict';
const fs = require('fs');
const path = require('path');
const { pluginPath, loadOrder } = require('./OwnPlugins.js');
const DT = require('./DataTable.js');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
// Tamriel. If it is not found, the WRLD group is not being read.
const CANARY = '3c:Skyrim.esm';

function mastersOf(b, headerSize) {
  const out = [];
  for (let k = 24; k + 6 <= 24 + headerSize;) {
    const sz = b.readUInt16LE(k + 4);
    if (b.toString('ascii', k, k + 4) === 'MAST') { out.push(b.toString('latin1', k + 6, k + 6 + sz - 1)); }
    k += 6 + sz;
  }
  return out;
}

function editorId(rec) {
  for (let k = 0; k + 6 <= rec.length;) {
    const sz = rec.readUInt16LE(k + 4);
    if (rec.toString('ascii', k, k + 4) === 'EDID') { return rec.toString('latin1', k + 6, k + 6 + sz - 1); }
    k += 6 + sz;
  }
  return '';
}

// Every WRLD record of one plugin: [{ desc, edid, deleted }], overrides
// included, each under the descriptor of the record it is.
function worldsOf(b, self) {
  if (b.length < 24 || b.toString('ascii', 0, 4) !== 'TES4') { throw new Error('not a plugin'); }
  const headerSize = b.readUInt32LE(4);
  const mast = mastersOf(b, headerSize);
  const out = [];
  for (let i = 24 + headerSize; i + 24 <= b.length;) {
    if (b.toString('ascii', i, i + 4) !== 'GRUP') { throw new Error('a top level record outside a group at ' + i); }
    const groupSize = b.readUInt32LE(i + 4);
    if (groupSize < 24) { throw new Error('a group of ' + groupSize + ' bytes at ' + i); }
    if (b.toString('ascii', i + 8, i + 12) === 'WRLD') {
      // The WRLD group holds the worldspaces, each followed by a group of its
      // cells, which is skipped whole.
      for (let j = i + 24; j + 24 <= i + groupSize;) {
        const size = b.readUInt32LE(j + 4);
        if (b.toString('ascii', j, j + 4) === 'GRUP') { j += size; continue; }
        const flags = b.readUInt32LE(j + 8);
        const formId = b.readUInt32LE(j + 12);
        let rec = b.subarray(j + 24, j + 24 + size);
        if (flags & 0x00040000) { rec = zlib.inflateSync(rec.subarray(4)); }
        const idx = formId >>> 24;
        out.push({
          desc: (formId & 0x00ffffff).toString(16) + ':' + (idx < mast.length ? mast[idx] : self),
          edid: editorId(rec),
          deleted: !!(flags & 0x00000020)
        });
        j += 24 + size;
      }
    }
    i += groupSize;
  }
  return out;
}

// The load order's worldspaces: { order, worlds: { desc: edid }, problems }.
function readWorldspaces(dataDir, pluginsTxt) {
  const order = loadOrder(pluginsTxt);
  const last = {};
  const problems = [];
  for (const pl of order) {
    const p = pluginPath(dataDir, pl);
    if (!fs.existsSync(p)) { problems.push(pl + ' is switched on and is not in ' + dataDir); continue; }
    let rows;
    try { rows = worldsOf(fs.readFileSync(p), pl); }
    catch (e) { problems.push(pl + ' will not parse: ' + e.message); continue; }
    // Load order: the last plugin to carry a record decides whether it is
    // there. The editor id is kept from the first, the record's own.
    for (const r of rows) {
      const was = last[r.desc];
      last[r.desc] = { edid: was ? was.edid : r.edid, deleted: r.deleted };
    }
  }
  const worlds = {};
  Object.keys(last).sort().forEach(function (d) {
    if (!last[d].deleted) { worlds[d] = last[d].edid; }
  });
  if (!problems.length && !Object.prototype.hasOwnProperty.call(worlds, CANARY)) {
    problems.push('no ' + CANARY + ' (Tamriel) among ' + Object.keys(worlds).length + ' worldspaces, so the WRLD group is not being read');
  }
  return { order: order, worlds: worlds, problems: problems };
}

// worldspaces.json's text for list.
function install(list) {
  return { part: DT.partText(['worldspaces'], { worldspaces: list }) };
}

function main(args) {
  function opt(name, def) {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  }
  const dataDir = opt('data', 'C:\\Thornswood\\Game\\Data');
  const pluginsTxt = opt('plugins', 'C:\\Thornswood\\Profile\\OwnGame\\plugins.txt');
  const outPath = opt('out', path.join(DT.DATA_DIR, 'worldspaces.json'));
  const check = args.indexOf('--check') !== -1;

  if (!fs.existsSync(pluginsTxt)) { console.error('FAIL  no plugins.txt at ' + pluginsTxt); return 1; }
  const got = readWorldspaces(dataDir, pluginsTxt);
  got.problems.forEach(function (p) { console.error('FAIL  ' + p); });
  if (got.problems.length) { console.error('nothing written'); return 1; }
  const list = Object.keys(got.worlds).sort();
  console.log(got.order.length + ' plugins read, ' + list.length + ' worldspaces');
  if (args.indexOf('--print') !== -1) {
    list.forEach(function (d) { console.log('  ' + d.padEnd(28) + got.worlds[d]); });
  }

  const partNow = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  const was = partNow ? (JSON.parse(partNow).worldspaces || []) : [];
  const out = install(list);
  const added = list.filter(function (d) { return was.indexOf(d) < 0; });
  const gone = was.filter(function (d) { return list.indexOf(d) < 0; });
  added.forEach(function (d) { console.log('  in   ' + d + '  ' + got.worlds[d]); });
  gone.forEach(function (d) { console.log('  out  ' + d); });
  const same = out.part === partNow;
  if (check) {
    if (!same) { console.error('FAIL  worldspaces.json is not this load order\'s worldspaces; run Build-WorldspaceTable.js'); return 1; }
    console.log('ok    worldspaces.json holds this load order\'s ' + list.length + ' worldspaces');
    return 0;
  }
  if (same) { console.log('worldspaces.json already holds this list'); return 0; }
  fs.writeFileSync(outPath, out.part);
  console.log('wrote ' + list.length + ' worldspaces into ' + outPath);
  return 0;
}

module.exports = { worldsOf: worldsOf, readWorldspaces: readWorldspaces,
                   install: install, main: main };

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
