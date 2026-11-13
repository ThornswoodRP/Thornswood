'use strict';
/*
  test-2551-place-holds.js

      node game/tests/test-2551-place-holds.js

  #2551, Patrick, 17 October 2026, decision 2 = B: the places on Tamriel's
  ground that Skyrim and the collection's mods put in no hold get one.
  Castle Volkihar, Jakob's and Frederik's houses to Haafingar; Nightingale
  Hall and Fort Dawnguard's valley (Dayspring Canyon) to the Rift; Ironbind
  Barrow to Winterhold; Oar's Rest's utility room to Falkreath; the Lost Hut
  and Darkfall Cave to the Reach. Apocrypha, the Soul Cairn, Sovngarde, the
  Forgotten Vale, Misty Grove and the test and Creation Club cells stay in no
  hold. Dayspring Canyon's caves (Dead Drop Falls, Dead Drop Mine, Mossy
  Glen Cave) are put in the valley, so the game reads them in the Rift as
  the building table already did by their doors. Thornswood-Last.esp carries it (scripts/mods/Build-LastPlugin.py,
  the policy's placeHolds), because it loads last and any plugin can be its
  master. And, his words, "our main menu location thing that says where they
  last left off it would be more accurate too": the roster's place name
  (the main menu's Last location, the launcher's "last seen in") names the
  hold the records give.

    P  the policy, the manifest and the committed plugin agree: each
       location is overridden with the policy's parent, each room with its
       location, and nothing else of the policy's is missing
    B  game/data/building-holds.json: the 17 buildings of those places are
       measured in the hold Patrick named, and the 22 left refused are
       exactly the other worlds, the Forgotten Vale, Misty Grove and the test
       cells
    L  the place name, run out of gamemode.js against the committed plugin's
       own records: a room or worldspace of those places is named with its
       hold, and one no hold covers is named without one

  No repository holds the plugin since #2791 step 3, so P2 to P4 and L read
  it made from its recipe out of the game's plugins (tests/last-plugin-made.js),
  and print SKIP without the game; the rest still run.

  On a machine with the game (C:\Thornswood\Game\Data, or THORNSWOOD_DATA)
  the place name is also run over the whole load order, for every one of the
  17 buildings, with Thornswood-Last.esp and without it: before, no hold;
  after, the hold Patrick named.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('').replace(/^\uFEFF/, '');
const made = require('../../tests/last-plugin-made.js').made();
const POLICY = JSON.parse(read(path.join(ROOT, 'game', 'data', 'last-plugin-policy.json')));
const MANIFEST = JSON.parse(read(path.join(ROOT, 'game', 'data', 'last-plugin.json')));
const TABLE = JSON.parse(read(path.join(ROOT, 'game', 'data', 'building-holds.json')));
const gm = read(path.join(ROOT, 'game', 'gamemode.js'));

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

// Patrick's decision, building by building: the hold each is measured in.
const NAMED = {
  '803:Dawnguard.esm': 'solitude', '19dfe:Dawnguard.esm': 'solitude', '285a:Dawnguard.esm': 'solitude',
  '285b:Dawnguard.esm': 'solitude', '154d5:Dawnguard.esm': 'solitude', '7203:Dawnguard.esm': 'solitude',
  '39850:Skyrim.esm': 'riften', '35604:Skyrim.esm': 'winterhold',
  '1b262:The Great City of Solitude.esp': 'solitude', '1b3cc:The Great City of Solitude.esp': 'solitude',
  '1a618:OarsRest.esp': 'falkreath', '660d:Solitude Arena.esp': 'markarth', '4346:Dawnguard.esm': 'markarth',
  '1dba:Dawnguard.esm': 'riften', '181c8:Dawnguard.esm': 'riften', '9bde:Dawnguard.esm': 'riften',
  '8e52:Dawnguard.esm': 'riften'
};
// The ones that stay in no hold.
const STAY = {
  'Apocrypha': ['142f3:Dragonborn.esm', '142f4:Dragonborn.esm', '1ede2:Dragonborn.esm', '3109d:Dragonborn.esm', '3b065:Dragonborn.esm'],
  'the Soul Cairn': ['6429:Dawnguard.esm'],
  'Sovngarde': ['95c44:Skyrim.esm'],
  'the Forgotten Vale': ['10a8b:Dawnguard.esm', '1c09:Dawnguard.esm', '384f:Dawnguard.esm', '8482:Dawnguard.esm', '8995:Dawnguard.esm'],
  'Misty Grove': ['3d62b:Skyrim.esm'],
  'the test and Creation Club cells': ['1321f:Skyrim.esm', '2f99:Update.esm', '2f9b:Update.esm', '2fd1:Update.esm',
    '2fd2:Update.esm', '2fd3:Update.esm', '30e2:Update.esm', '30eb:Update.esm', '30ec:Update.esm']
};
// The hold names the place name gives, by hold location.
const HOLD_NAME = {
  HaafingarHoldLocation: 'Haafingar', RiftHoldLocation: 'The Rift', WinterholdHoldLocation: 'Winterhold',
  FalkreathHoldLocation: 'Falkreath Hold', ReachHoldLocation: 'The Reach'
};
const TOWN_NAME = { solitude: 'Haafingar', riften: 'The Rift', winterhold: 'Winterhold',
                    falkreath: 'Falkreath Hold', markarth: 'The Reach' };

// ------------------------------------------------------------ a plugin reader
function subs(d) {
  const out = [];
  let i = 0, big = null;
  while (i + 6 <= d.length) {
    const t = d.toString('latin1', i, i + 4);
    let n = d.readUInt16LE(i + 4);
    if (t === 'XXXX') { big = d.readUInt32LE(i + 6); i += 6 + n; continue; }
    if (big !== null) { n = big; big = null; }
    out.push({ type: t, data: d.subarray(i + 6, i + 6 + n) });
    i += 6 + n;
  }
  return out;
}
/* The CELL, WRLD and LCTN records of one plugin, by (owner, object id),
   kept as offsets and read when asked. */
function index(file, name) {
  const buf = fs.readFileSync(file);
  const hs = buf.readUInt32LE(4);
  const masters = subs(buf.subarray(24, 24 + hs)).filter((s) => s.type === 'MAST')
    .map((s) => s.data.toString('latin1').replace(/\0+$/, ''));
  const files = masters.map((m) => m.toLowerCase()).concat([name.toLowerCase()]);
  const recs = {};
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') {
        const label = buf.toString('latin1', p + 8, p + 12);
        const gt = buf.readInt32LE(p + 12);
        if (gt !== 0 || label === 'CELL' || label === 'WRLD' || label === 'LCTN') { walk(p + 24, p + size); }
        p += size;
        continue;
      }
      if (tag === 'CELL' || tag === 'WRLD' || tag === 'LCTN') {
        const fid = buf.readUInt32LE(p + 12);
        const owner = files[Math.min(fid >>> 24, files.length - 1)];
        recs[owner + '|' + (fid & 0xFFFFFF)] = { tag: tag, at: p, size: size, flags: buf.readUInt32LE(p + 8) };
      }
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return { name: name, buf: buf, files: files, recs: recs };
}
function fieldsOf(pl, r) {
  let d = pl.buf.subarray(r.at + 24, r.at + 24 + r.size);
  if (r.flags & 0x40000) { d = zlib.inflateSync(d.subarray(4)); }
  return subs(d).map((s) => ({ type: s.type, data: Array.from(s.data) }));
}
/* A stand-in for the server's espm lookup over plugins in load order, the
   last that has a record winning (CombineBrowser::LookupById). A global id
   is the owning plugin's place in the order, then the object id. */
function espm(plugins, extra) {
  const order = [];
  const slot = {};
  function slotOf(owner) {
    if (!(owner in slot)) { slot[owner] = order.length; order.push(owner); }
    return slot[owner];
  }
  plugins.forEach((pl) => pl.files.forEach(slotOf));
  Object.keys(extra || {}).forEach((k) => slotOf(k.split('|')[0]));
  function lookup(gid) {
    const key = order[gid >>> 24] + '|' + (gid & 0xFFFFFF);
    let won = null;
    for (const pl of plugins) { if (pl.recs[key]) { won = { pl: pl, r: pl.recs[key] }; } }
    if (!won) {
      if (extra && extra[key]) {
        return { record: extra[key], toGlobalRecordId: () => 0 };
      }
      return null;
    }
    const pl = won.pl;
    return {
      record: { type: won.r.tag, fields: fieldsOf(pl, won.r) },
      toGlobalRecordId: (local) => (slotOf(pl.files[Math.min(local >>> 24, pl.files.length - 1)]) * 0x1000000) + (local & 0xFFFFFF)
    };
  }
  return {
    getIdFromDesc: (desc) => {
      const at = desc.indexOf(':');
      return slotOf(desc.slice(at + 1).toLowerCase()) * 0x1000000 + parseInt(desc.slice(0, at), 16);
    },
    lookupEspmRecordById: lookup
  };
}

// --------------------------------------------- the place name, out of gamemode
function lift() {
  const a = gm.indexOf('  function spaced(editorId) {');
  const b = gm.indexOf('  var places = {};', a);
  const end = '    places[desc] = out;\n    return out;\n  }\n';
  const c = gm.indexOf(end, b);
  const n0 = gm.indexOf('const BUILDING_NAME = ');
  const n1 = gm.indexOf('\n', n0);
  if (a < 0 || b < 0 || c < 0 || n0 < 0) { return null; }
  return { spaced: gm.slice(a, gm.indexOf('\n  }\n', a) + 5), place: gm.slice(b, c + end.length),
           names: gm.slice(n0, n1).replace(/^const /, 'var ') };
}
const code = lift();
yes('L0 the place name and BUILDING_NAME are in gamemode.js', !!code);
function placeNamer(mp) {
  const box = { mp: mp, String: String, Number: Number, Object: Object };
  vm.createContext(box);
  vm.runInContext(code.names + '\n' + code.spaced + '\n' + code.place + '\nthis.placeName = placeName;', box);
  return box.placeName;
}

// ---------------------------------------------------------------------- P
const last = made.buf ? index(made.path, 'Thornswood-Last.esp') : null;
if (!last) { console.log('SKIP  P2, P3, P4, L: ' + made.why); }
const rules = POLICY.placeHolds || {};
const locs = rules.locations || [], rooms = rules.cells || [];
yes('P1 the policy gives 8 locations and 3 rooms a hold', locs.length === 8 && rooms.length === 3);
function keyOf(desc) { const at = desc.indexOf(':'); return desc.slice(at + 1).toLowerCase() + '|' + parseInt(desc.slice(0, at), 16); }
function formAt(pl, f, type) {
  const s = f.find((x) => x.type === type);
  if (!s || s.data.length !== 4) { return null; }
  const v = Buffer.from(s.data).readUInt32LE(0);
  return pl.files[Math.min(v >>> 24, pl.files.length - 1)] + '|' + (v & 0xFFFFFF);
}
let pBad = [];
if (last) {
  for (const row of locs) {
    const r = last.recs[keyOf(row.location)];
    const f = r && r.tag === 'LCTN' ? fieldsOf(last, r) : null;
    const edid = f ? Buffer.from(f.find((x) => x.type === 'EDID').data).toString('latin1').replace(/\0+$/, '') : '';
    if (!f || edid !== row.edid || formAt(last, f, 'PNAM') !== keyOf(row.parent) || !HOLD_NAME[row.holdEdid]) { pBad.push(row.place); }
}
yes('P2 the plugin overrides each location with the policy\'s parent, a hold\'s location or a place on the list' +
    (pBad.length ? ' (not: ' + pBad.join(', ') + ')' : ''), pBad.length === 0);
pBad = [];
for (const row of rooms) {
  const r = last.recs[keyOf(row.cell)];
  const f = r && r.tag === 'CELL' ? fieldsOf(last, r) : null;
  if (!f || formAt(last, f, 'XLCN') !== keyOf(row.location)) { pBad.push(row.place); }
}
yes('P3 and each room with its location' + (pBad.length ? ' (not: ' + pBad.join(', ') + ')' : ''), pBad.length === 0);
const lctnCount = Object.keys(last.recs).filter((k) => last.recs[k].tag === 'LCTN').length;
yes('P4 the plugin has no other location record (' + lctnCount + ')', lctnCount === locs.length);
}
const mp = MANIFEST.placeHolds || {};
yes('P5 the manifest lists the same places, each location with the parent it had',
    JSON.stringify((mp.locations || []).map((r) => r.location)) === JSON.stringify(locs.map((r) => r.location)) &&
    JSON.stringify((mp.rooms || []).map((r) => r.cell).sort()) === JSON.stringify(rooms.map((r) => r.cell).sort()) &&
    (mp.locations || []).every((r) => r.parentWas === null || /TamrielLocation$/.test(r.parentWas)) &&
    MANIFEST.counts.placeLocations === locs.length && MANIFEST.counts.placeRooms === rooms.length);
yes('P6 the rooms are Oar\'s Rest\'s utility room, given Oar\'s Rest\'s own location, the Lost Hut, given the Reach\'s, ' +
    'and Mossy Glen Cave, given the valley\'s',
    rooms.some((r) => r.edid === 'ORUtility' && r.locationEdid === 'OR_Location_OarsRest' && r.holdEdid === 'FalkreathHoldLocation') &&
    rooms.some((r) => r.edid === 'aamaisonchamp' && r.locationEdid === 'ReachHoldLocation') &&
    rooms.some((r) => r.edid === 'DLC1HunterValleyCave01' && r.locationEdid === 'DLC1HunterHQLocation' &&
                      r.holdEdid === 'RiftHoldLocation'));
yes('P7 Dead Drop Falls\' location is put in the valley, and the valley in the Rift',
    locs.some((r) => r.edid === 'DLC1DeadDropFallsLocation' && r.parentEdid === 'DLC1HunterHQLocation') &&
    locs.some((r) => r.edid === 'DLC1HunterHQLocation' && r.parentEdid === 'RiftHoldLocation'));

// ---------------------------------------------------------------------- B
const got = Object.keys(NAMED).filter((b) => TABLE.buildings[b] && TABLE.buildings[b].hold === NAMED[b]);
yes('B1 the 17 buildings of those places are measured in the hold Patrick named (' + got.length + ')' +
    (got.length !== 17 ? ' (not: ' + Object.keys(NAMED).filter((b) => got.indexOf(b) < 0).join(', ') + ')' : ''),
    got.length === 17);
const stay = [].concat.apply([], Object.keys(STAY).map((k) => STAY[k])).sort();
yes('B2 the 22 refused are exactly ' + Object.keys(STAY).join(', '),
    JSON.stringify(Object.keys(TABLE.refused).sort()) === JSON.stringify(stay) && TABLE.counts.refused === 22);
yes('B3 the table counts 828 measured of 850', TABLE.counts.measured === 828 && TABLE.counts.buildings === 850);

// ---------------------------------------------------------------------- L
if (code && last) {
  // The hold locations as the masters have them, by their editor ids alone,
  // from the table's own record of where each is.
  const holds = {};
  for (const edid of Object.keys(TABLE.holdLocations)) {
    holds[keyOf(TABLE.holdLocations[edid].location)] = { type: 'LCTN', fields: [{ type: 'EDID', data: Array.from(Buffer.from(edid + '\0', 'latin1')) }] };
  }
  const name = placeNamer(espm([last], holds));
  const cases = [
    ['1b262:The Great City of Solitude.esp', 'Jakob\'s House, Haafingar'],
    ['1b3cc:The Great City of Solitude.esp', 'Frederik\'s House, Haafingar'],
    ['35604:Skyrim.esm', 'Ironbind Barrow, Winterhold'],
    ['660d:Solitude Arena.esp', 'Lost Hut, The Reach'],
    ['7202:Dawnguard.esm', 'DLC1 Vampire Castle Courtyard, Haafingar'],
    ['1db8:Dawnguard.esm', 'DLC1 Hunter HQWorld, The Rift'],
    ['3c:Skyrim.esm', 'Tamriel']
  ];
  for (const c of cases) {
    const said = name(c[0]);
    yes('L1 ' + c[0] + ' reads "' + c[1] + '"' + (said !== c[1] ? ' (said "' + said + '")' : ''), said === c[1]);
  }
}

// ------------------------------------------------- the whole load order, if here
const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
if (code && last && fs.existsSync(path.join(data, 'Skyrim.esm'))) {
  const order = MANIFEST.loadOrder;
  const missing = order.filter((n) => !(n.startsWith('Thornswood-') || fs.existsSync(path.join(data, n))));
  if (missing.length) {
    console.log('SKIP  R: the game at ' + data + ' lacks ' + missing.slice(0, 3).join(', '));
  } else {
    const plugins = order.map((n) => index(n.startsWith('Thornswood-') ? path.join(ROOT, 'game', 'content', n) : path.join(data, n), n));
    const before = placeNamer(espm(plugins));
    const after = placeNamer(espm(plugins.concat([last])));
    let bad = [];
    for (const b of Object.keys(NAMED)) {
      const was = before(b), now = after(b);
      console.log('      ' + b + ': before "' + was + '", after "' + now + '"');
      if (/, (Haafingar|The Rift|Winterhold|Falkreath Hold|The Reach)$/.test(was) || !now.endsWith(', ' + TOWN_NAME[NAMED[b]])) { bad.push(b); }
    }
    yes('R1 over the whole load order, each of the 17 is named with no hold before and with its hold after' +
        (bad.length ? ' (not: ' + bad.join(', ') + ')' : ''), bad.length === 0);
    bad = stay.filter((b) => / (Haafingar|The Rift|Winterhold|Falkreath Hold|The Reach|Whiterun Hold|Eastmarch|Hjaalmarch|The Pale|Solstheim)$/.test(after(b)));
    yes('R2 and the 22 that stay in no hold are named without one' + (bad.length ? ' (not: ' + bad.join(', ') + ')' : ''), bad.length === 0);
  }
} else {
  console.log('SKIP  R: no game at ' + data + ' (a machine with the game names the 17 over the whole load order)');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
