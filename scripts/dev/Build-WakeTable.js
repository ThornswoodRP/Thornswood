// Build-WakeTable.js
//
// Builds DATA.ownWorlds, where a death wakes in a worldspace with coordinates
// of its own (#1909). Every worldspace of the load order that is not laid out
// in Tamriel's coordinates is a key, and its value lists the halls of the
// dead, temples and inns whose front door stands in that worldspace. It writes
// the table into game\data\data.json and changes nothing else in it, and
// writes game\gamemode-tables\DATA.json, the same file laid out for the
// gamemode to read (#5191).
//
// WHY
//
// resolveArrival measured every death out of doors against the nine hold
// capitals and the mainland's temple doors, which are in Tamriel's
// coordinates. A worldspace with coordinates of its own (Blackreach, the Soul
// Cairn, Sovngarde, Apocrypha, the Forgotten Vale, the arena's floors) got
// whichever hold its own numbers happened to fall nearest on the mainland's
// map: all 171 Soul Cairn spots npc-population.json stands somebody on woke in
// Whiterun's temple. Patrick, 5 Oct: a death in a worldspace with coordinates
// of its own wakes the person in the nearest hall of the dead, temple or inn
// in that worldspace.
//
// WHAT IS MEASURED
//
// Every plugin switched on in plugins.txt, after Skyrim's five masters, read
// the way Build-WorldspaceTable.js reads them, the last plugin to carry a
// record deciding it.
//
// Which worldspaces share Tamriel's coordinates: Tamriel, and every worldspace
// with a door standing within one cell (4096 units) of the door it leads to in
// a worldspace that already does, directly (a city gate) or through one room
// both doors open into (the two ways into Labyrinthian). Measured on 5 Oct:
// the five walled cities, Dragonsreach's porch, the Katariah and nine small
// worldspaces beside their own entrances. A worldspace whose doors land tens
// of thousands of units from where they lead (Blackreach, 56,029 from its
// nearest), or that has no door to the mainland at all, has coordinates of its
// own. Solstheim is one.
//
// What counts as a place to wake: an interior whose location carries
// LocTypeCemetery (the halls of the dead), LocTypeTemple or LocTypeInn, one
// entry for each door into it that stands in the worldspace, at the point that
// door puts anybody on who walks in (its XTEL, rotation turned to degrees).
// Where game\data\data.json already has a death respawn point for that room
// (destinations.<key>.<slot>, the Raven Rock temple), that point is kept, so a
// death there wakes where it always has. Measured on 5 Oct: Solstheim has two,
// the Raven Rock temple and the Retching Netch, and no other worldspace with
// coordinates of its own has any.
//
// THE DOORS IN. DATA.ownWorldDoors is every door, by its reference, that
// stands outside one of those worldspaces and leads into it, leaving out the
// doors of a room whose only ways out lead back into it (Blackreach's side
// rooms). onActivate writes the one a person presses, and the hold they
// pressed it from, on the character; a worldspace with nowhere to wake wakes
// them where a death in that hold would (Patrick, 5 Oct, #1909). Measured on
// 5 Oct: 92 doors, 12 of them into Blackreach and 2 into the Pit.
//
// Usage:
//   node scripts\dev\Build-WakeTable.js
//   node scripts\dev\Build-WakeTable.js --check
//   node scripts\dev\Build-WakeTable.js --print
//   node scripts\dev\Build-WakeTable.js --data "C:\Thornswood\Game\Data" --plugins "C:\Thornswood\Profile\OwnGame\plugins.txt"
//
// --check reads the plugins and says whether data.json and the DATA table hold
// exactly that table, and writes nothing. --print lists each worldspace's
// frame and places. Exit code 1 if a plugin that is switched on is not in the
// Data folder or will not parse, if Tamriel or its walled cities are not
// found in its coordinates (the reader is wrong), or, with --check, if the
// table differs.
'use strict';
const fs = require('fs');
const path = require('path');
const { pluginPath, loadOrder } = require('./OwnPlugins.js');
const zlib = require('zlib');
const Worlds = require('./Build-WorldspaceTable.js');
const TABLES = require('./GamemodeTables.js');

const ROOT = path.join(__dirname, '..', '..');
const TAMRIEL = '3c:Skyrim.esm';
// Whiterun, Solitude, Windhelm, Markarth and Riften. If one of these is not
// measured as Tamriel's, the door reader is wrong.
const CITIES = ['1a26f:Skyrim.esm', '37edf:Skyrim.esm', '1691d:Skyrim.esm', '16d71:Skyrim.esm', '16bb4:Skyrim.esm'];
const ONE_CELL = 4096;
// What each location keyword makes a room, the first that matches. A hall
// of the dead carries LocTypeCemetery (Riften's mausoleum carries both).
const KINDS = [['LocTypeCemetery', 'hallOfTheDead'], ['LocTypeTemple', 'temple'], ['LocTypeInn', 'inn']];

function round1(n) { return Math.round(n * 10) / 10; }

function fields(rec) {
  const out = {};
  let big = 0;
  for (let k = 0; k + 6 <= rec.length;) {
    const t = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    if (t === 'XXXX') { big = rec.readUInt32LE(k + 6); k += 6 + sz; continue; }
    if (big) { sz = big; big = 0; }
    if (!out[t]) { out[t] = rec.subarray(k + 6, k + 6 + sz); }
    k += 6 + sz;
  }
  return out;
}

// What one plugin carries of what this needs, into the tables passed in. A
// later plugin's record replaces an earlier one's, which is load order.
function readPlugin(b, self, t) {
  if (b.length < 24 || b.toString('ascii', 0, 4) !== 'TES4') { throw new Error('not a plugin'); }
  const headerSize = b.readUInt32LE(4);
  const mast = [];
  for (let k = 24; k + 6 <= 24 + headerSize;) {
    const sz = b.readUInt16LE(k + 4);
    if (b.toString('ascii', k, k + 4) === 'MAST') { mast.push(b.toString('latin1', k + 6, k + 6 + sz - 1)); }
    k += 6 + sz;
  }
  function desc(fid) { const i = fid >>> 24; return (fid & 0xffffff).toString(16) + ':' + (i < mast.length ? mast[i] : self); }
  function walk(from, to, world, cell, depth) {
    for (let i = from; i + 24 <= to;) {
      const type = b.toString('ascii', i, i + 4);
      const size = b.readUInt32LE(i + 4);
      if (type === 'GRUP') {
        if (size < 24) { throw new Error('a group of ' + size + ' bytes at ' + i); }
        const label = b.readUInt32LE(i + 8);
        const gtype = b.readInt32LE(i + 12);
        if (depth === 0 && ['KYWD', 'LCTN', 'CELL', 'WRLD'].indexOf(b.toString('ascii', i + 8, i + 12)) < 0) { i += size; continue; }
        // 1 is a worldspace's cells, 6, 8 and 9 a cell's references.
        walk(i + 24, i + size, gtype === 1 ? desc(label) : world,
             (gtype === 6 || gtype === 8 || gtype === 9) ? desc(label) : cell, depth + 1);
        i += size;
        continue;
      }
      const flags = b.readUInt32LE(i + 8);
      const d = desc(b.readUInt32LE(i + 12));
      if (type === 'KYWD' || type === 'LCTN' || type === 'CELL' || type === 'REFR') {
        let rec = b.subarray(i + 24, i + 24 + size);
        if (flags & 0x00040000) { rec = zlib.inflateSync(rec.subarray(4)); }
        const f = fields(rec);
        const edid = f.EDID ? f.EDID.toString('latin1').replace(/\0+$/, '') : '';
        if (type === 'KYWD') { t.keywords[d] = edid; }
        else if (type === 'LCTN') {
          const kw = [];
          if (f.KWDA) { for (let k = 0; k + 4 <= f.KWDA.length; k += 4) { kw.push(desc(f.KWDA.readUInt32LE(k))); } }
          t.locations[d] = kw;
        } else if (type === 'CELL') {
          const was = t.cells[d] || {};
          t.cells[d] = {
            edid: edid || was.edid || '',
            interior: f.DATA ? !!(f.DATA[0] & 1) : !!was.interior,
            location: f.XLCN ? desc(f.XLCN.readUInt32LE(0)) : (was.location || '')
          };
        } else if (flags & 0x00000020) {
          // A later plugin deleting a door takes it out of the load order.
          if (t.doors[d]) { t.doors[d].deleted = true; }
        } else if (f.XTEL && f.DATA && f.XTEL.length >= 28) {
          t.doors[d] = {
            world: world || '', cell: cell || '',
            pos: [f.DATA.readFloatLE(0), f.DATA.readFloatLE(4), f.DATA.readFloatLE(8)],
            to: desc(f.XTEL.readUInt32LE(0)),
            arrive: [f.XTEL.readFloatLE(4), f.XTEL.readFloatLE(8), f.XTEL.readFloatLE(12)],
            facing: [f.XTEL.readFloatLE(16), f.XTEL.readFloatLE(20), f.XTEL.readFloatLE(24)],
            deleted: !!(flags & 0x00000020)
          };
        }
      }
      i += 24 + size;
    }
  }
  walk(24 + headerSize, b.length, '', '', 0);
}

// Which worldspaces share Tamriel's coordinates, from the door tables.
function tamrielFrame(worlds, doors) {
  const frame = new Set([TAMRIEL]);
  const links = [];
  const intoRoom = {};
  for (const d in doors) {
    const a = doors[d];
    if (a.deleted || !a.world) { continue; }
    const b = doors[a.to];
    if (!b || b.deleted) { continue; }
    if (b.world && b.world !== a.world) { links.push([a.world, b.world, Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])]); }
    if (!b.world && b.cell) { (intoRoom[b.cell] = intoRoom[b.cell] || []).push(a); }
  }
  for (const room in intoRoom) {
    const ds = intoRoom[room];
    for (const a of ds) {
      for (const b of ds) {
        if (a.world !== b.world) { links.push([a.world, b.world, Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])]); }
      }
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of links) {
      if (l[2] <= ONE_CELL && frame.has(l[0]) && !frame.has(l[1]) && Object.prototype.hasOwnProperty.call(worlds, l[1])) {
        frame.add(l[1]); grew = true;
      }
    }
  }
  return frame;
}

// The table: { worldDesc: [ place, ... ] } for every worldspace not in
// Tamriel's coordinates, sorted, each place sorted by its door.
function buildTable(t, worlds, destinations, cellToHold) {
  const frame = tamrielFrame(worlds, t.doors);
  const kindOf = {};
  for (const c in t.cells) {
    const cell = t.cells[c];
    if (!cell.interior || !cell.location) { continue; }
    const kw = (t.locations[cell.location] || []).map(function (k) { return t.keywords[k]; });
    for (const pair of KINDS) { if (kw.indexOf(pair[0]) >= 0) { kindOf[c] = pair[1]; break; } }
  }
  // The death respawn point data.json already has for a room, by its cell.
  const known = {};
  for (const key in destinations || {}) {
    for (const slot in destinations[key]) { known[destinations[key][slot].desc] = { key: key, slot: slot, at: destinations[key][slot] }; }
  }
  const table = {};
  Object.keys(worlds).sort().forEach(function (w) { if (!frame.has(w)) { table[w] = []; } });
  for (const d in t.doors) {
    const a = t.doors[d];
    if (a.deleted || !Object.prototype.hasOwnProperty.call(table, a.world)) { continue; }
    const b = t.doors[a.to];
    if (!b || b.deleted || b.world || !kindOf[b.cell]) { continue; }
    const k = known[b.cell];
    table[a.world].push({
      kind: kindOf[b.cell],
      cell: (t.cells[b.cell] || {}).edid || '',
      desc: b.cell,
      hold: (cellToHold && cellToHold[b.cell]) || null,
      destination: k ? k.key : '',
      door: [round1(a.pos[0]), round1(a.pos[1])],
      pos: k ? k.at.pos : a.arrive.map(round1),
      rot: k ? k.at.rot : a.facing.map(function (r) { return round1(r * 180 / Math.PI); })
    });
  }
  for (const w in table) {
    table[w].sort(function (x, y) { return (x.desc + x.door.join()).localeCompare(y.desc + y.door.join()); });
  }
  // The doors into each of those worldspaces from anywhere else: a room, a
  // worldspace in Tamriel's coordinates or another of its own. A person who
  // presses one has come in by it, and onActivate writes down the hold they
  // pressed it from (#1909): a worldspace of its own with nowhere to wake
  // wakes them where a death in that hold would. A room whose every door
  // leads into the same worldspace (Blackreach's side rooms, Sovngarde's
  // hall) is part of it: nobody comes in from there, so its doors are left out
  // and going in and out of one does not move what was written.
  const leadsTo = {};
  for (const d in t.doors) {
    const a = t.doors[d];
    if (a.deleted || a.world || !a.cell) { continue; }
    const b = t.doors[a.to];
    (leadsTo[a.cell] = leadsTo[a.cell] || new Set()).add(b && !b.deleted ? (b.world || 'room') : 'nowhere');
  }
  const doors = {};
  Object.keys(t.doors).sort().forEach(function (d) {
    const a = t.doors[d];
    if (a.deleted) { return; }
    const b = t.doors[a.to];
    if (!b || b.deleted || !b.world || a.world === b.world || !Object.prototype.hasOwnProperty.call(table, b.world)) { return; }
    if (!a.world && leadsTo[a.cell] && leadsTo[a.cell].size === 1) { return; }
    doors[d] = b.world;
  });
  return { table: table, frame: frame, doors: doors };
}

function readLoadOrder(dataDir, pluginsTxt) {
  const order = loadOrder(pluginsTxt);
  const t = { keywords: {}, locations: {}, cells: {}, doors: {} };
  const problems = [];
  for (const pl of order) {
    const p = pluginPath(dataDir, pl);
    if (!fs.existsSync(p)) { problems.push(pl + ' is switched on and is not in ' + dataDir); continue; }
    try { readPlugin(fs.readFileSync(p), pl, t); }
    catch (e) { problems.push(pl + ' will not parse: ' + e.message); }
  }
  return { order: order, tables: t, problems: problems };
}

// "ownWorlds" and "ownWorldDoors" written into data.json's text as its last
// keys, laid out the way the rest of the file is (one space a level). Nothing
// else moves. The gamemode's DATA table is that file laid out
// (GamemodeTables.js), so it is written from it.
const KEYS = ['ownWorlds', 'ownWorldDoors'];
function install(tables, jsonText) {
  const nl = '\n';
  const end = jsonText.lastIndexOf(nl + '}');
  if (end < 0) { return { error: 'data.json does not end in a closing brace' }; }
  // Ours are the last keys, so everything from the first of them is rewritten.
  let at = -1;
  for (const k of KEYS) { const i = jsonText.indexOf(',' + nl + ' "' + k + '": '); if (i >= 0 && (at < 0 || i < at)) { at = i; } }
  let json = at >= 0 ? jsonText.slice(0, at) : jsonText.slice(0, end);
  for (const k of KEYS) { json += ',' + nl + ' "' + k + '": ' + JSON.stringify(tables[k], null, 1).split('\n').join(nl + ' '); }
  json += jsonText.slice(end);
  let a, b;
  try { a = JSON.parse(jsonText); b = JSON.parse(json); }
  catch (e) { return { error: 'the tables did not land as JSON (' + e.message + ')' }; }
  for (const k of KEYS) {
    if (JSON.stringify(b[k]) !== JSON.stringify(tables[k])) { return { error: k + ' did not land as built' }; }
    delete a[k]; delete b[k];
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) { return { error: 'something besides the tables changed' }; }
  return { json: json };
}

function main(args) {
  function opt(name, def) {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  }
  const dataDir = opt('data', 'C:\\Thornswood\\Game\\Data');
  const pluginsTxt = opt('plugins', 'C:\\Thornswood\\Profile\\OwnGame\\plugins.txt');
  const jsonPath = opt('json', path.join(ROOT, 'game', 'data', 'data.json'));
  const tablesDir = opt('tables', TABLES.DIR);
  const check = args.indexOf('--check') !== -1;

  if (!fs.existsSync(pluginsTxt)) { console.error('FAIL  no plugins.txt at ' + pluginsTxt); return 1; }
  const ws = Worlds.readWorldspaces(dataDir, pluginsTxt);
  const got = readLoadOrder(dataDir, pluginsTxt);
  const problems = ws.problems.concat(got.problems);
  problems.forEach(function (p) { console.error('FAIL  ' + p); });
  if (problems.length) { console.error('nothing written'); return 1; }
  const jsonText = fs.readFileSync(jsonPath, 'utf8');
  const tablePath = TABLES.file('DATA', tablesDir);
  const tableText = fs.existsSync(tablePath) ? fs.readFileSync(tablePath, 'utf8') : null;
  const data = JSON.parse(jsonText);
  const built = buildTable(got.tables, ws.worlds, data.destinations, data.cellToHold);
  const lost = CITIES.filter(function (c) { return !built.frame.has(c); });
  if (lost.length) { console.error('FAIL  ' + lost.join(', ') + ' not measured in Tamriel\'s coordinates, so the doors are not being read; nothing written'); return 1; }
  const own = Object.keys(built.table);
  const places = own.reduce(function (n, w) { return n + built.table[w].length; }, 0);
  console.log(got.order.length + ' plugins read, ' + Object.keys(ws.worlds).length + ' worldspaces, ' +
              built.frame.size + ' in Tamriel\'s coordinates, ' + own.length + ' with their own, ' + places + ' places to wake in those, ' +
              Object.keys(built.doors).length + ' doors into them');
  if (args.indexOf('--print') !== -1) {
    Object.keys(ws.worlds).sort().forEach(function (w) {
      const p = built.table[w];
      const ins = Object.keys(built.doors).filter(function (d) { return built.doors[d] === w; }).length;
      console.log('  ' + w.padEnd(28) + ws.worlds[w].padEnd(34) + (p ? 'own: ' + (p.length ? p.map(function (x) { return x.kind + ' ' + x.cell; }).join(', ') : 'nowhere to wake') + ', ' + ins + ' door(s) in' : 'Tamriel'));
    });
  }
  const out = install({ ownWorlds: built.table, ownWorldDoors: built.doors }, jsonText);
  if (out.error) { console.error('FAIL  ' + out.error + '; nothing written'); return 1; }
  const same = out.json === jsonText && TABLES.layout(out.json) === tableText;
  if (check) {
    if (!same) { console.error('FAIL  data.json or the DATA table is not this load order\'s wake table; run Build-WakeTable.js'); return 1; }
    console.log('ok    data.json and the DATA table hold this load order\'s wake table');
    return 0;
  }
  if (same) { console.log('data.json and the DATA table already hold this table'); return 0; }
  fs.writeFileSync(jsonPath, out.json);
  TABLES.write('DATA', out.json, tablesDir);
  console.log('wrote the wake table into ' + jsonPath + ' and ' + tablePath);
  return 0;
}

module.exports = { readPlugin: readPlugin, tamrielFrame: tamrielFrame, buildTable: buildTable,
                   readLoadOrder: readLoadOrder, install: install, main: main };

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
