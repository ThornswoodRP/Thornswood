// test-2962-creation-menus-gone.js
//
// Issue #2962. Thornswood-Content.esp held four message boxes, the trade menu
// (MESG 0x05E80050, 0x05E80051) and the town menu (MESG 0x05E80052,
// 0x05E80053) of the first creation flow. The choices are made in the K panel
// since 20 September and there is no trade to choose since 21 September, and
// nothing showed or named the boxes but Check-Chargen.ps1, which asked for
// them and their button counts as if creation needed them. Add-ContentRecords.py
// then kept every record it did not write, so they stayed.
//
// This proves:
//
//   1. the committed plugin holds none of the four;
//   2. Add-ContentRecords.py names them in RETIRED, by id, type and editor id;
//   3. Check-Chargen.ps1 no longer asks for them or reads message boxes, and
//      gamemode.js names none of them;
//   4. the tool (which writes the plugin from its sources since #5191) writes
//      none of them, and stops if one is among what it would write;
//   5. and stops if another record stands under one of their form ids.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');
const CHECK = path.join(ROOT, 'scripts', 'ops', 'Check-Chargen.ps1');
const GAMEMODE = path.join(ROOT, 'game', 'gamemode.js');
const COMPRESSED = 0x00040000;

const MENUS = [
  [0x05E80050, 'ThornswoodTradeMenu1'],
  [0x05E80051, 'ThornswoodTradeMenu2'],
  [0x05E80052, 'ThornswoodTownMenu1'],
  [0x05E80053, 'ThornswoodTownMenu2'],
];

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

function subsOf(d) {
  const out = [];
  let i = 0, big = null;
  while (i + 6 <= d.length) {
    const tag = d.toString('latin1', i, i + 4);
    let size = d.readUInt16LE(i + 4);
    if (tag === 'XXXX') { big = d.readUInt32LE(i + 6); i += 6 + size; continue; }
    if (big !== null) { size = big; big = null; }
    out.push({ tag, body: d.subarray(i + 6, i + 6 + size) });
    i += 6 + size;
  }
  return out;
}
function records(buf) {
  const out = [];
  function walk(start, end) {
    let p = start;
    while (p + 24 <= end) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8);
      let data = buf.subarray(p + 24, p + 24 + size);
      if (flags & COMPRESSED) { data = zlib.inflateSync(data.subarray(4)); }
      out.push({ tag, fid: buf.readUInt32LE(p + 12), data });
      p += 24 + size;
    }
  }
  walk(24 + buf.readUInt32LE(4), buf.length);
  return out;
}

// ------------------------------------------------------- 1. the plugin ---
const shipped = fs.readFileSync(ESP);
const recs = records(shipped);
const held = MENUS.filter(([fid]) => recs.some(r => r.fid === fid));
yes('1 the committed plugin holds none of the four creation menus' +
    (held.length ? ' (holds ' + held.map(([f, e]) => e + ' ' + hex(f)).join(', ') + ')' : ''),
    held.length === 0);
const named = MENUS.filter(([fid]) => {
  const b = Buffer.alloc(4); b.writeUInt32LE(fid >>> 0);
  return recs.some(r => r.data.indexOf(b) >= 0);
});
yes('1 and no record in it names one', named.length === 0);

// ---------------------------------------------------------- 2. the tool --
const tool = fs.readFileSync(TOOL, 'utf8');
const retired = /RETIRED = \(([\s\S]*?)\n\)/.exec(tool);
yes('2 Add-ContentRecords.py has a RETIRED list', !!retired);
yes('2 it names all four, each a MESG by its object id and editor id',
    !!retired && MENUS.every(([fid, e]) => new RegExp('\\(0x' + (fid & 0xFFFFFF).toString(16).toUpperCase() +
      ", b'MESG', '" + e + "'\\)").test(retired[1])));

// ------------------------------------------- 3. the check and the gamemode
const check = fs.readFileSync(CHECK, 'utf8');
yes('3 Check-Chargen.ps1 asks for none of them', MENUS.every(([fid]) => check.toUpperCase().indexOf(hex(fid).slice(2)) < 0));
yes('3 and reads no message boxes', !/\$label -eq 'MESG'|'MESG \{0:X8\}|\^MESG |\(BOOK\|MESG\)/.test(check));
const gm = fs.readFileSync(GAMEMODE, 'utf8');
yes('3 gamemode.js names none of them', MENUS.every(([fid]) =>
  gm.indexOf((fid & 0xFFFFFF).toString(16) + ':Thornswood-Content.esp') < 0));

// ------------------------------------------- 4 and 5. the tool ---------
// The tool writes the plugin from nothing (#5191), and stops when anything it
// would write is retired. Asked of its own retired_among(), loaded as a
// module: over the records it writes from its own numbers, none; with the
// trade menu among them, or another record under a retired form id, that one.
const ASK = [
  'import importlib.util, sys',
  'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'own = len(m.PLUGIN_MASTERS)',
  'made = m.thornswood_records(m.clam01(), []) + m.seasonal_records()',
  'menu = m.own_record(b"MESG", 0x5E80050, [(b"EDID", m.zstr("ThornswoodTradeMenu1")), (b"DESC", m.zstr("What do you do for a living?"))])',
  'other = m.own_record(b"MESG", 0x5E80052, [(b"EDID", m.zstr("SomethingElse")), (b"DESC", m.zstr("Not a creation menu"))])',
  'for name, recs in (("made", made), ("menu", made + [menu]), ("other", made + [other])):',
  '    print(name + " " + ",".join("%s:0x%07X:%s" % (r.tag.decode(), r.fid, r.editor_id()) for r in m.retired_among(recs, own)))',
].join('\n');
let said = null;
for (const exe of ['python', 'py', 'python3']) {
  const p = spawnSync(exe, ['-c', ASK, TOOL], { encoding: 'utf8' });
  if (!p.error) { said = p; break; }
}
yes('4 python is on this machine and the tool loads as a module', !!said && said.status === 0);
if (said && said.status !== 0) { console.log(said.stdout + said.stderr); }
const line = (n) => ((said && said.stdout) || '').split(/\r?\n/).find(l => l.indexOf(n + ' ') === 0) || '';
yes('4 none of the records the tool writes is retired', line('made') === 'made ');
yes('4 with the trade menu among them, the tool names it as retired and stops', line('menu') === 'menu MESG:0x5E80050:ThornswoodTradeMenu1');
yes('5 with another record under a retired form id, the tool names it and stops', line('other') === 'other MESG:0x5E80052:SomethingElse');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
