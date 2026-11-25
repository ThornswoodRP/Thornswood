// test-arrivals.js
//
// Each of the nine inn spots, and whether that point is in the room.
//
// Since #2622 a new character arrives at the town's start spot
// (test-2622-start-spots.js checks those), and the inn spot is where staff's
// /tp <town> inn lands; Djinn re-marked three of them on 17 Oct because the
// old ones were too close to the door. Everything below still holds for them.
//
// WHY THIS EXISTS. Entry 161: "Four of the nine starting towns use
// hand-written arrival points, and the shipped config says one of them puts
// you in a wall". Reading the load order showed what the hand-written ones
// were. Every one of the eight is the inn's front door moved 110 units along
// the door's own heading, at the door's height and with its facing. Nobody
// stood on any of them, and whether that lands in the room depends on which
// way the door's model faces. For seven of the eight it did not.
//
// The entry proposed checking that no two towns' points are within a hundred
// units and that no facing is a whole quarter turn. Neither says anything
// about a wall. Interior coordinates belong to their own cell, so two towns
// being close is meaningless (Moorside Inn and Windpeak Inn are one layout,
// front doors two units apart), and the game's own door teleport points face
// exactly 0 degrees. So this checks the thing itself instead.
//
// WHAT IT CHECKS, for every town in CHARGEN.towns in game/gamemode.js:
//   the arrival is in the cell the inn's front door stands in;
//   it is on the room side of that door by at least half a pace, where the
//   room side is the side the game's own landing point for that door is on;
//   it is on the floor that door opens onto, within 48 units of the landing
//   point's height.
// Then it checks the check against the only ground truth there is, people
// walking: the five points 1.1.41 replaced by walking fail it, except
// Riften's, which was in the room and which the walk kept.
//
// THE DOORS BELOW WERE READ OUT OF THE LOAD ORDER on 24 September, 99
// plugins, last one wins. On a machine with C:\Thornswood\Game\Data and a
// plugins.txt, they are read again from the plugins and a door that has
// moved fails. Anywhere else that part says SKIP and the rest still runs.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/*
  Each inn's front door, and the point the game stands anybody on who walks
  in through it: the teleport (XTEL) carried by the OUTSIDE half of the door,
  which names the inside half and gives a position and facing in the inn.
  pos and rot are the inside door's own placement. Rotations in degrees.
*/
const DOORS = {
  whiterun:   { cell: '1605e:Skyrim.esm', door: '16072:Skyrim.esm', pos: [-128, -1152, 120.2], rot: 90,
                outside: '1a6f4:Skyrim.esm', land: [-125.1, -1101.7, 68], landRot: 0 },
  riften:     { cell: '16bdf:Skyrim.esm', door: '44bd7:Skyrim.esm', pos: [-228, -676, 68], rot: 45,
                outside: '430a6:Skyrim.esm', land: [-184, -636, 68], landRot: 45 },
  solitude:   { cell: '16a0e:Skyrim.esm', door: '16a8a:Skyrim.esm', pos: [-288, -1504, 128], rot: 90,
                outside: '37f25:Skyrim.esm', land: [-293.9, -1450.6, 0], landRot: 0 },
  windhelm:   { cell: '16789:Skyrim.esm', door: 'd18b5:Skyrim.esm', pos: [881, -3550.5, 158.3], rot: 180,
                outside: 'd18b2:Skyrim.esm', land: [835.6, -3555.7, 66.6], landRot: 270 },
  markarth:   { cell: '16dfe:Skyrim.esm', door: '793a4:Skyrim.esm', pos: [-5600, -2311.9, -24], rot: 180,
                outside: '16e3b:Skyrim.esm', land: [-5600, -2199.9, -24], landRot: 0 },
  falkreath:  { cell: '3a184:Skyrim.esm', door: '3a196:Skyrim.esm', pos: [673.1, -510.3, 0], rot: 180,
                outside: '17762:Skyrim.esm', land: [670.4, -443.1, 0.5], landRot: 0 },
  morthal:    { cell: '138ce:Skyrim.esm', door: '1738c:Skyrim.esm', pos: [1824.1, -575.8, 0.5], rot: 180,
                outside: '177af:Skyrim.esm', land: [1824.6, -533.2, 0.5], landRot: 0 },
  dawnstar:   { cell: '13a7f:Skyrim.esm', door: '13d41:Skyrim.esm', pos: [1824.3, -573.7, 0], rot: 180,
                outside: '17636:Skyrim.esm', land: [1823.2, -534.7, 0.5], landRot: 0 },
  winterhold: { cell: '13814:Skyrim.esm', door: '1759e:Skyrim.esm', pos: [2528.6, -414.4, 0.5], rot: 180,
                outside: '177fb:Skyrim.esm', land: [2523.4, -366.8, 0.5], landRot: 0 }
};

/*
  What the table said before anybody stood anywhere, out of git history:
  0571ad9 for all nine, b01e530 (1.1.41) for the five it replaced by walking.
  walked is what that walk did with it.
*/
const HAND = {
  whiterun:   { pos: [-18, -1152, 120.2], rot: 90, walked: 'moved' },
  riften:     { pos: [-150.2, -598.2, 68], rot: 45, walked: 'kept' },
  solitude:   { pos: [-178, -1504, 128], rot: 90 },
  windhelm:   { pos: [881, -3660.5, 158.3], rot: 180, walked: 'moved' },
  falkreath:  { pos: [673.1, -620.3, 0], rot: 180 },
  morthal:    { pos: [1824.1, -685.8, 0.5], rot: 180, walked: 'moved' },
  dawnstar:   { pos: [1824.3, -683.7, 0], rot: 180 },
  winterhold: { pos: [2528.6, -524.4, 0.5], rot: 180, walked: 'moved' }
};

// Half a pace, the same 32 units the gamemode calls MOVED_UNITS. The game's
// own landing points are 39 to 112 units in front of their doors.
const IN_FRONT = 32;
// Well under the height of one storey, well over the few units a floor
// varies by. A point at the door's own height is 128 above Solitude's floor.
const SAME_FLOOR = 48;

/*
  How far into the room a point is: its distance from the door, level,
  measured along the way the game steps a person in, which is from the door
  to the door's landing point. Negative is behind the door; near zero is on
  the line of the wall the door is set in.
*/
function intoRoom(d, p) {
  const nx = d.land[0] - d.pos[0], ny = d.land[1] - d.pos[1];
  const len = Math.sqrt(nx * nx + ny * ny);
  return ((p[0] - d.pos[0]) * nx + (p[1] - d.pos[1]) * ny) / len;
}
function inRoom(d, p) {
  return intoRoom(d, p) >= IN_FRONT && Math.abs(p[2] - d.land[2]) <= SAME_FLOOR;
}
function near(a, b, tol) {
  for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - b[i]) > tol) { return false; } }
  return true;
}
function angle(a, b) {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}
function f1(n) { return (Math.round(n * 10) / 10).toString(); }

// ------------------------------------------------------------ the table ----
// It is one line of JSON, and the server reads it as one.
let towns = null;
const m = src.match(/^const CHARGEN = (\{.*\});$/m);
if (m) { try { towns = JSON.parse(m[1]).towns; } catch (e) { towns = null; } }
yes('T0 the CHARGEN table is in the gamemode and parses', !!towns);

const byKey = {};
if (towns) {
  for (const desc in towns) {
    const t = towns[desc];
    if (t && t.key) { byKey[t.key] = t; }
  }
}
yes('T0 it has nine towns and every one has a front door here',
    Object.keys(byKey).length === 9 &&
    Object.keys(byKey).every(function (k) { return !!DOORS[k]; }));

Object.keys(DOORS).forEach(function (k) {
  const d = DOORS[k];
  const t = byKey[k];
  const a = t && t.arrival;
  if (!a || !a.pos || a.pos.length !== 3) {
    yes('T1 ' + k + ' has an arrival point', false);
    return;
  }
  yes('T1 ' + k + ' arrives in the cell its front door stands in (' + d.cell + ')', a.desc === d.cell);
  yes('T2 ' + k + ' arrives on the room side of the front door, ' + f1(intoRoom(d, a.pos)) +
      ' units in, at least ' + IN_FRONT, intoRoom(d, a.pos) >= IN_FRONT);
  yes('T3 ' + k + ' arrives on the floor the door opens onto, ' +
      f1(Math.abs(a.pos[2] - d.land[2])) + ' units from it',
      Math.abs(a.pos[2] - d.land[2]) <= SAME_FLOOR);
});

// ------------------------------------------------- the hand-written sum ----
// Every hand point is its door, 110 units along the door's heading, at the
// door's height and facing. Skyrim's heading for an angle r is (sin r, cos r).
// This is what the diagnosis rests on, and it also cross-checks the door
// positions above: eight numbers typed in September land exactly on them.
Object.keys(HAND).forEach(function (k) {
  const d = DOORS[k], h = HAND[k];
  const r = d.rot * Math.PI / 180;
  const sum = [d.pos[0] + 110 * Math.sin(r), d.pos[1] + 110 * Math.cos(r), d.pos[2]];
  yes('H1 ' + k + '\'s hand point was the front door moved 110 units along its heading',
      near(h.pos, sum, 0.2) && angle(h.rot, d.rot) < 0.1);
});
(function () {
  const d = DOORS.markarth;
  const r = d.rot * Math.PI / 180;
  const sum = [d.pos[0] + 110 * Math.sin(r), d.pos[1] + 110 * Math.cos(r)];
  const a = byKey.markarth && byKey.markarth.arrival;
  yes('H1 markarth\'s point is not that sum, which is why it is left as it was',
      !!a && !near([a.pos[0], a.pos[1]], sum, 50));
})();

// And the check agrees with the walk. The four the walk moved were not in
// the room by this check; the one it kept was.
Object.keys(HAND).forEach(function (k) {
  const h = HAND[k];
  if (!h.walked) { return; }
  if (h.walked === 'kept') {
    yes('H2 ' + k + '\'s hand point, which the 1.1.41 walk kept, is in the room by this check',
        inRoom(DOORS[k], h.pos));
  } else {
    yes('H2 ' + k + '\'s hand point, which the 1.1.41 walk moved, is not in the room by this check (' +
        f1(intoRoom(DOORS[k], h.pos)) + ' units in)', !inRoom(DOORS[k], h.pos));
  }
});
['solitude', 'falkreath', 'dawnstar'].forEach(function (k) {
  yes('H3 ' + k + '\'s hand point is not in the room by this check (' +
      f1(intoRoom(DOORS[k], HAND[k].pos)) + ' units in)', !inRoom(DOORS[k], HAND[k].pos));
});

// ---------------------------------------------------- the stale comments ----
// Four files told the next person Morthal and Dawnstar share a point, which
// 1.1.41 had already made untrue and which was never a collision anyway.
[
  path.join(REPO_DIR, 'launcher', 'Thornswood.ini'),
  path.join(REPO_DIR, 'game', 'plugins', 'thornswood-mark.js'),
  path.join(REPO_DIR, 'scripts', 'ops', 'Mark-Spot.ps1')
].forEach(function (f) {
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { text = null; }
  // Comment markers go too, so a sentence broken across two // lines reads whole.
  const flat = text === null ? '' : text.replace(/[\s\/;#]+/g, ' ');
  yes('C1 ' + path.relative(REPO_DIR, f) +
      ' no longer says Morthal and Dawnstar are two units apart',
      text !== null && !/two units apart/i.test(flat) && flat.indexOf('1824.1, -685.8') < 0);
});

// ------------------------------------------------------ the game records ----
/*
  Read the doors again out of the plugins, last one wins. Only the records
  wanted are inflated, so this is mostly reading record headers.
*/
const DATA = process.env.TS_DATA || 'C:\\Thornswood\\Game\\Data';
const LISTS = [process.env.TS_PLUGINS || '',
               'C:\\Thornswood\\Profile\\Default\\plugins.txt',
               'C:\\Thornswood\\Profile\\LocalAppData\\plugins.txt'];
const MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
const GRUP = 0x50555247, REFR = 0x52464552;

function subs(buf) {
  const out = [];
  let i = 0, big = -1;
  while (i + 6 <= buf.length) {
    const tag = buf.toString('latin1', i, i + 4);
    let size = buf.readUInt16LE(i + 4);
    if (tag === 'XXXX') { big = buf.readUInt32LE(i + 6); i += 10; continue; }
    if (big >= 0) { size = big; big = -1; }
    out.push([tag, buf.subarray(i + 6, i + 6 + size)]);
    i += 6 + size;
  }
  return out;
}

function readPlugin(name, want, found) {
  const buf = fs.readFileSync(path.join(DATA, name));
  if (buf.length < 24 || buf.toString('latin1', 0, 4) !== 'TES4') { return; }
  const hsize = buf.readUInt32LE(4);
  const masters = subs(buf.subarray(24, 24 + hsize))
    .filter(function (s) { return s[0] === 'MAST'; })
    .map(function (s) { return s[1].toString('latin1').replace(/\0+$/, ''); });
  function desc(fid) {
    const idx = fid >>> 24;
    const own = idx < masters.length ? masters[idx] : (idx === masters.length ? name : null);
    return own ? (fid & 0xFFFFFF).toString(16) + ':' + own : null;
  }
  function eat(start, end, cell) {
    let p = start;
    while (p + 24 <= end) {
      const tag = buf.readUInt32LE(p);
      const size = buf.readUInt32LE(p + 4);
      if (tag === GRUP) {
        // Group type 6 is a cell's children, and its label is the cell.
        const kid = buf.readUInt32LE(p + 12) === 6 ? desc(buf.readUInt32LE(p + 8)) : cell;
        eat(p + 24, p + size, kid);
        p += size;
        continue;
      }
      if (tag === REFR) {
        const d = desc(buf.readUInt32LE(p + 12));
        if (d && want[d]) {
          const flags = buf.readUInt32LE(p + 8);
          let body = buf.subarray(p + 24, p + 24 + size);
          if (flags & 0x00040000) { body = zlib.inflateSync(body.subarray(4)); }
          const row = { plugin: name, cell: cell, deleted: !!(flags & 0x20) };
          subs(body).forEach(function (s) {
            const b = s[1];
            if (s[0] === 'DATA' && b.length >= 24) {
              row.pos = [b.readFloatLE(0), b.readFloatLE(4), b.readFloatLE(8)];
              row.rot = b.readFloatLE(20) * 180 / Math.PI;
            } else if (s[0] === 'XTEL' && b.length >= 28) {
              row.xtel = { door: desc(b.readUInt32LE(0)),
                           pos: [b.readFloatLE(4), b.readFloatLE(8), b.readFloatLE(12)],
                           rot: b.readFloatLE(24) * 180 / Math.PI };
            }
          });
          found[d] = row;
        }
      }
      p += 24 + size;
    }
  }
  let p = 24 + hsize;
  while (p + 24 <= buf.length && buf.readUInt32LE(p) === GRUP) {
    const size = buf.readUInt32LE(p + 4);
    const label = buf.toString('latin1', p + 8, p + 12);
    if (label === 'CELL' || label === 'WRLD') { eat(p + 24, p + size, null); }
    p += size;
  }
}

const list = LISTS.filter(function (f) { return f && fs.existsSync(f); })[0];
if (!list || !fs.existsSync(path.join(DATA, 'Skyrim.esm'))) {
  console.log('SKIP  the game folder and its load order are not on this machine, so the doors were not read again');
} else {
  const order = MASTERS.slice();
  fs.readFileSync(list, 'utf8').split(/\r?\n/).forEach(function (l) {
    l = l.trim();
    if (l.charAt(0) !== '*') { return; }
    l = l.slice(1).trim();
    if (l && order.indexOf(l) < 0) { order.push(l); }
  });
  const want = {};
  Object.keys(DOORS).forEach(function (k) { want[DOORS[k].door] = true; want[DOORS[k].outside] = true; });
  const found = {};
  let missing = 0;
  order.forEach(function (name) {
    if (!fs.existsSync(path.join(DATA, name))) { missing++; return; }
    readPlugin(name, want, found);
  });
  yes('G0 every plugin in the load order is in the game folder (' + order.length + ' of them)', missing === 0);
  Object.keys(DOORS).forEach(function (k) {
    const d = DOORS[k];
    const inside = found[d.door], outside = found[d.outside];
    yes('G1 ' + k + '\'s front door ' + d.door + ' stands in ' + d.cell + ' where this file says, facing ' + d.rot,
        !!inside && !inside.deleted && inside.cell === d.cell && !!inside.pos &&
        near(inside.pos, d.pos, 0.2) && angle(inside.rot, d.rot) < 0.1);
    yes('G2 ' + k + '\'s outside door ' + d.outside + ' lands you at ' + d.land.join(', ') +
        ' facing ' + d.landRot + ' (last written by ' + (outside ? outside.plugin : 'nothing') + ')',
        !!outside && !outside.deleted && !!outside.xtel && outside.xtel.door === d.door &&
        near(outside.xtel.pos, d.land, 0.2) && angle(outside.xtel.rot, d.landRot) < 0.1);
  });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
