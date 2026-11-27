// test-7171-keys-under-keys.js
//
//     node tests/test-7171-keys-under-keys.js
//
// #7171: the keys a property gives sat under Misc in the inventory, not under
// Keys with Skyrim's own. The game sorts a KEYM record under Keys and a MISC
// under Misc, and Thornswood's key and master key were MISC records, because
// the engine did not count a KEYM as an item (fork #220 made it one). Held
// here, from the writer itself (Python, no game, no network):
//
//   1. scripts/mods/Add-ContentRecords.py writes the key (0x5015494) and the
//      master key (0x50154E0) as KEYM records: their names, the key's mesh,
//      Skyrim's VendorItemKey keyword, worth nothing and weightless.
//   2. The key mold (0x5015495) is not a key and stays a MISC.
//   3. The plugin gives KEYM a group, and its description still names every
//      record it writes, inside its 512 bytes.
//   4. No other record the writer makes is a MISC called a key.
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function python(args) {
  for (const [exe, first] of [['python', []], ['py', ['-3']], ['python3', []]]) {
    const p = spawnSync(exe, first.concat(args), { encoding: 'utf8', maxBuffer: 1 << 26, cwd: ROOT });
    if (!p.error) { return p; }
  }
  return null;
}

// The writer's own records, read out by the writer's own reader.
const READ = [
  'import importlib.util, json, sys',
  "spec = importlib.util.spec_from_file_location('content', sys.argv[1])",
  'c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)',
  'records = c.thornswood_records(c.clam01(), []) + c.seasonal_records()',
  'out = {}',
  'for r in records:',
  '    raw = r.bytes()',
  "    out.setdefault('%X' % r.fid, []).append({'tag': raw[:4].decode(), 'edid': r.editor_id(), 'sub': [[t.decode(), b.hex()] for t, b in c.subrecords(raw[24:])]})",
  "description, unnamed = c.description_of([r.tag.decode() + ' ' + r.editor_id() for r in records])",
  "print(json.dumps({'records': out, 'groups': [g.decode() for g in c.GROUP_ORDER], 'key': c.KEY, 'master': c.MASTER_KEY, 'mold': c.MOLD,",
  "                  'description': len(description) + 1, 'most': c.DESCRIPTION_MOST, 'unnamed': unnamed}))"
].join('\n');
const p = python(['-B', '-c', READ, path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py')]);
let got = null;
try { got = JSON.parse(p.stdout); } catch (e) { console.log('      ' + (p ? p.stderr.trim().split(/\r?\n/).slice(-1)[0] : 'no python here')); }
yes('0 python is here and the writer loads as a module', !!got);
if (!got) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = 1; return; }

const hex = (s) => Buffer.from(s, 'hex');
const text = (s) => hex(s).toString('latin1').replace(/\0+$/, '');
function one(fid) {
  const rows = got.records[fid.toString(16).toUpperCase()] || [];
  if (rows.length !== 1) { return null; }
  const r = rows[0], subs = {};
  for (const [t, b] of r.sub) { if (!(t in subs)) { subs[t] = b; } }
  return { tag: r.tag, edid: r.edid, subs };
}
const VENDOR_ITEM_KEY = 0x000914EF;
for (const [fid, edid, name] of [[got.key, 'ThornswoodMiscKey', 'Key'], [got.master, 'ThornswoodMiscMasterKey', 'Master Key']]) {
  const r = one(fid);
  yes('1 ' + edid + ' is one KEYM record called ' + name, !!r && r.tag === 'KEYM' && r.edid === edid && text(r.subs.FULL) === name);
  yes('1 ' + edid + ' wears the key\'s mesh and Skyrim\'s VendorItemKey keyword',
    !!r && text(r.subs.MODL) === 'Clutter\\Key01.nif' && hex(r.subs.KSIZ).readUInt32LE(0) === 1 &&
    hex(r.subs.KWDA).readUInt32LE(0) === VENDOR_ITEM_KEY);
  yes('1 ' + edid + ' is worth nothing and weighs nothing, its DATA laid out as a MISC\'s',
    !!r && hex(r.subs.DATA).length === 8 && hex(r.subs.DATA).readUInt32LE(0) === 0 && hex(r.subs.DATA).readFloatLE(4) === 0);
}
const mold = one(got.mold);
yes('2 the key mold is not a key and stays a MISC', !!mold && mold.tag === 'MISC' && mold.edid === 'ThornswoodMiscKeyMold');
yes('3 the plugin gives KEYM a group', got.groups.indexOf('KEYM') >= 0);
yes('3 the description names every record and stays inside its bytes (' + got.description + ' of ' + got.most + ')',
  got.unnamed.length === 0 && got.description <= got.most);
const miscKeys = [];
for (const rows of Object.values(got.records)) {
  for (const r of rows) {
    const full = (r.sub.find((s) => s[0] === 'FULL') || [null, ''])[1];
    if (r.tag === 'MISC' && /(^|\s)key$/i.test(text(full))) { miscKeys.push(r.edid); }
  }
}
yes('4 no other record the writer makes is a MISC called a key' + (miscKeys.length ? ': ' + miscKeys.join(', ') : ''), miscKeys.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
