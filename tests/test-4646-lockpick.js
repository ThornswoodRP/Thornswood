// test-4646-lockpick.js
//
//     node tests/test-4646-lockpick.js
//
// #4646: lockpicks came only from dungeon and body loot, and no recipe made
// one. Thornswood-Content.esp now carries a forge recipe that makes several of
// Skyrim's own Lockpick from one iron ingot, and the recipe table gives it to
// the Edgewright. Held here, from the writer itself (Python, no game, no
// network):
//
//   1. scripts/mods/Add-ContentRecords.py writes one ThornswoodRecipeLockpick:
//      one iron ingot in, Skyrim's Lockpick (a:Skyrim.esm) out, at the forge,
//      more than one made, no condition hiding it.
//   2. Its form id is new to the plugin, and the plugin's description still
//      names every record it writes, inside its 512 bytes.
//   3. records/recipe-owners.json gives it to the Smith's Edgewright half.
//   4. Check-Makers.waiting.json no longer lists the lockpick as waiting for a
//      maker, since the forge makes it once the box builds this.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const NAME = 'ThornswoodRecipeLockpick';

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
  'import importlib.util, json, struct, sys',
  "spec = importlib.util.spec_from_file_location('content', sys.argv[1])",
  'c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)',
  'records = c.thornswood_records(c.clam01(), []) + c.seasonal_records()',
  "mine = [r for r in records if r.editor_id() == sys.argv[2]]",
  'fields = []',
  'for r in mine:',
  '    raw = r.bytes()',
  "    fields.append({'tag': raw[:4].decode(), 'fid': r.fid, 'sub': [[t.decode(), b.hex()] for t, b in c.subrecords(raw[24:])]})",
  "description, unnamed = c.description_of([r.tag.decode() + ' ' + r.editor_id() for r in records])",
  "print(json.dumps({'mine': fields, 'made': c.LOCKPICKS_MADE, 'ids': len({r.fid for r in records}), 'count': len(records),",
  "                  'description': len(description) + 1, 'most': c.DESCRIPTION_MOST, 'unnamed': unnamed}))"
].join('\n');
const p = python(['-B', '-c', READ, path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py'), NAME]);
let got = null;
try { got = JSON.parse(p.stdout); } catch (e) { console.log('      ' + (p ? p.stderr.trim() : 'no python here')); }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b.toString('hex'); };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b.toString('hex'); };
const sub = (tag) => (got && got.mine.length === 1 ? got.mine[0].sub.filter((s) => s[0] === tag).map((s) => s[1]) : null);

yes('1 the writer writes one ThornswoodRecipeLockpick, a COBJ', !!got && got.mine.length === 1 && got.mine[0].tag === 'COBJ');
yes('1 it makes Skyrim\'s own Lockpick (a:Skyrim.esm) at the forge (88105)',
  JSON.stringify(sub('CNAM')) === JSON.stringify([u32(0x0000000A)]) && JSON.stringify(sub('BNAM')) === JSON.stringify([u32(0x00088105)]));
yes('1 from one iron ingot and nothing else',
  JSON.stringify(sub('COCT')) === JSON.stringify([u32(1)]) && JSON.stringify(sub('CNTO')) === JSON.stringify([u32(0x0005ACE4) + u32(1)]));
yes('1 several picks at a time (' + (got ? got.made : '?') + '), and no condition hides it',
  !!got && got.made > 1 && JSON.stringify(sub('NAM1')) === JSON.stringify([u16(got.made)]) && (sub('CTDA') || [1]).length === 0);
yes('2 every record keeps its own form id, the lockpick\'s new', !!got && got.ids === got.count);
yes('2 the plugin\'s description names every record and stays inside its bytes (' + (got ? got.description + ' of ' + got.most : '?') + ')',
  !!got && got.unnamed.length === 0 && got.description <= got.most);

const owners = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'recipe-owners.json'), 'utf8')).owner;
yes('3 records/recipe-owners.json gives it to the Smith\'s Edgewright half',
  !!owners[NAME] && owners[NAME].Owner === 'Smith' && owners[NAME].Half === 'Edgewright');
const waiting = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'Check-Makers.waiting.json'), 'utf8')).items;
yes('4 the lockpick no longer waits for a maker in Check-Makers.waiting.json', !waiting.some((r) => r.desc === 'a:Skyrim.esm'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
