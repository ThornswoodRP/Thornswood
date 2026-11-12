// test-2962-creation-menus-gone.js
//
// Issue #2962. Thornswood-Content.esp held four message boxes, the trade menu
// (MESG 0x05E80050, 0x05E80051) and the town menu (MESG 0x05E80052,
// 0x05E80053) of the first creation flow. The choices are made in the K panel
// since 20 September and there is no trade to choose since 21 September, and
// nothing showed or named the boxes but Check-Chargen.ps1, which asked for
// them and their button counts as if creation needed them. Add-ContentRecords.py
// keeps every record it does not write, so they stayed.
//
// This proves:
//
//   1. the committed plugin holds none of the four;
//   2. Add-ContentRecords.py names them in RETIRED, by id, type and editor id;
//   3. Check-Chargen.ps1 no longer asks for them or reads message boxes, and
//      gamemode.js names none of them;
//   4. the tool, given a copy of the plugin with one of them back, takes it out
//      and writes the committed plugin byte for byte;
//   5. and given a copy where that form id is some other record, it stops and
//      writes nothing.
//
// Copies go to a temporary folder (TEST_TMP if set) and are removed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
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

// ------------------------------------------- 4 and 5. the tool, run ------
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8' });
    if (!p.error) { return p; }
  }
  return null;
}
// One record and the top group it goes in, at the end of a copy of the file.
function withRecord(tag, fid, subs) {
  const body = Buffer.concat(subs.map(([t, s]) => {
    const v = Buffer.from(s + '\0', 'latin1');
    const h = Buffer.alloc(6); h.write(t, 0, 'latin1'); h.writeUInt16LE(v.length, 4);
    return Buffer.concat([h, v]);
  }));
  const rh = Buffer.alloc(24);
  rh.write(tag, 0, 'latin1'); rh.writeUInt32LE(body.length, 4); rh.writeUInt32LE(fid >>> 0, 12); rh.writeUInt16LE(44, 20);
  const gh = Buffer.alloc(24);
  gh.write('GRUP', 0, 'latin1'); gh.writeUInt32LE(24 + 24 + body.length, 4); gh.write(tag, 8, 'latin1');
  return Buffer.concat([shipped, gh, rh, body]);
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-2962-'));
try {
  const noGame = path.join(dir, 'no-game');
  fs.mkdirSync(noGame);
  const copy = path.join(dir, 'Thornswood-Content.esp');

  fs.writeFileSync(copy, withRecord('MESG', 0x05E80050,
    [['EDID', 'ThornswoodTradeMenu1'], ['DESC', 'What do you do for a living?'], ['ITXT', 'Warrior']]));
  const run = python([TOOL, '--data', dir, '--masters', noGame]);
  yes('4 python is on this machine', run !== null);
  if (run) {
    yes('4 a copy with the trade menu back: the tool takes it out, as retired',
        run.status === 0 && /retired, nothing shows or names it \(#2962\): MESG 0x5E80050 ThornswoodTradeMenu1/.test(run.stdout));
    yes('4 and writes the committed plugin, byte for byte', fs.readFileSync(copy).equals(shipped));
    if (run.status !== 0) { console.log(run.stdout + run.stderr); }

    const other = withRecord('MESG', 0x05E80052, [['EDID', 'SomethingElse'], ['DESC', 'Not a creation menu']]);
    fs.writeFileSync(copy, other);
    const stop = python([TOOL, '--data', dir, '--masters', noGame]);
    yes('5 a copy where a retired form id is another record: the tool stops',
        stop.status === 1 && /STOP\. 0x5E80052 is MESG SomethingElse, not the retired MESG ThornswoodTownMenu1/.test(stop.stdout));
    yes('5 and writes nothing', fs.readFileSync(copy).equals(other));
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
