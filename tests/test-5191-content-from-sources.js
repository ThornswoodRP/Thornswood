// test-5191-content-from-sources.js
//
// #5191, stage 2: Thornswood-Content.esp is written whole from its sources by
// scripts/mods/Add-ContentRecords.py, not edited in place. The records it
// makes from its own numbers (the welcome letter, the passages and the deed
// among them, which were only ever in the committed file), its header, the
// order of its groups, its group stamps and the five Dwarven scrap overrides
// it copies from Skyrim.esm now come from the tool. The rest it copies from
// the game's masters, and the dish looks need Gourmet.esp and the masters'
// string tables, which GitHub's runner does not have; so the plugin is built
// where the game is (the box, or a PC with the game).
//
// Without the game this proves, with the tool loaded as a module:
//   1. every record it writes from its own numbers is the committed record
//      byte for byte, in the committed order within its group, and every
//      committed record of those types is one it writes or one it copies;
//   2. the header it writes, given the committed records, is the committed
//      header byte for byte;
//   3. the committed top groups stand in GROUP_ORDER, and differences()
//      finds nothing between a plugin and itself and names a changed record;
//   4. with no game it stops, names the masters it lacks and writes nothing;
//      Collapse-DwarvenIngots.py, which edited the plugin in place, is gone.
// With the game (THORNSWOOD_DATA, or C:\Thornswood\Game\Data):
//   5. the tool builds the plugin, and every record in it is the committed
//      record byte for byte.
//
// Its output goes to a temporary folder (TEST_TMP if set) and is removed.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function python(args, input) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', input: input, maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}

const ASK = String.raw`
import importlib.util, json, struct, sys
spec = importlib.util.spec_from_file_location('acr', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
raw = open(sys.argv[2], 'rb').read()
hs = struct.unpack_from('<I', raw, 4)[0]
tree = m.parse(raw, 24 + hs, len(raw))
have = list(m.every_record(tree))
by = dict((r.fid, r) for r in have)
scrap = [by[f] for f, _ in m.DWARVEN_SCRAP_HIDDEN if f in by]
made = m.thornswood_records(m.clam01(), scrap) + m.seasonal_records()
off = ['%s 0x%07X %s' % (r.tag.decode(), r.fid, r.editor_id()) for r in made
       if r.fid not in by or by[r.fid].bytes() != r.bytes()]
order = []
for g in tree:
    tag = g.label[:4]
    mine = set(r.fid for r in made if r.tag == tag)
    built = [r.fid for r in made if r.tag == tag]
    there = [k.fid for k in g.kids if isinstance(k, m.Rec) and k.fid in mine]
    if there != built:
        order.append(tag.decode())
# Every committed record of the types the tool writes is one it writes or one
# it copies from a master (house parts, woodworking moves, cooking quality).
copied = set(f for f, _ in m.HOUSE_PARTS) | set(f for f, _, _ in m.WOODWORKER_MASTER_RECIPES)
copied |= set(f for f, _, _, _, _ in m.quality_wanted(list(m.PLUGIN_MASTERS), m.PLUGIN))
kinds = set(r.tag for r in made)
made_ids = set(r.fid for r in made)
stray = ['%s 0x%07X %s' % (r.tag.decode(), r.fid, r.editor_id()) for r in have
         if r.tag in kinds and r.fid not in made_ids and r.fid not in copied]
count = struct.unpack_from('<i', raw, 24 + 6 + 4)[0]
text, unnamed = m.description_of(['%s %s' % (r.tag.decode(), r.editor_id()) for r in have])
changed = bytearray(raw)
first = made[0].bytes()
at = raw.index(first)
changed[at + len(first) - 1] ^= 1
print(json.dumps({
  'made': len(made), 'scrap': len(scrap), 'off': off, 'order': order, 'stray': stray,
  'header': m.header(text, count) == raw[:24 + hs] and not unnamed,
  'groups': [g.label[:4].decode() for g in tree],
  'groupOrder': [t.decode() for t in m.GROUP_ORDER],
  'same': m.differences(raw, raw),
  'changed': m.differences(bytes(changed), raw),
  'first': '%s 0x%07X' % (made[0].tag.decode(), made[0].fid),
}))
`;

const run = python(['-c', ASK, TOOL, ESP]);
yes('python is on this machine and the tool loads as a module', !!run && run.status === 0);
if (run && run.status !== 0) { console.log(run.stdout + run.stderr); }
const a = run && run.status === 0 ? JSON.parse(run.stdout) : null;
if (a) {
  // ------------------------------------------- 1. its own numbers --------
  yes('1 the five Dwarven scrap overrides are in the committed plugin (' + a.scrap + ')', a.scrap === 5);
  yes('1 every record the tool writes from its own numbers is the committed record byte for byte (' + a.made + ')' +
      (a.off.length ? ': not ' + a.off.slice(0, 5).join(', ') : ''), a.made > 100 && a.off.length === 0);
  yes('1 and they stand in the committed order within each group' + (a.order.length ? ': not in ' + a.order.join(', ') : ''),
      a.order.length === 0);
  yes('1 every committed record of those types is one the tool writes or copies from a master' +
      (a.stray.length ? ': not ' + a.stray.slice(0, 5).join(', ') : ''), a.stray.length === 0);
  // ------------------------------------------------- 2. the header ------
  yes('2 the header the tool writes around the committed records is the committed header, byte for byte', a.header === true);
  // ------------------------------------------- 3. groups, differences ---
  yes('3 the committed top groups stand in GROUP_ORDER: ' + a.groups.join(' '),
      JSON.stringify(a.groups) === JSON.stringify(a.groupOrder.filter(t => a.groups.indexOf(t) >= 0)) &&
      a.groups.length === new Set(a.groups).size);
  yes('3 differences() finds nothing between the plugin and itself', a.same.length === 0);
  yes('3 and names the one record changed: ' + JSON.stringify(a.changed),
      a.changed.length === 1 && a.changed[0].indexOf(a.first) >= 0);
}

// ----------------------------------------------------- 4. no game -------
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-5191-'));
try {
  const out = path.join(dir, 'Thornswood-Content.esp');
  const stop = python([TOOL, '--masters', path.join(dir, 'no-game'), '--out', out]);
  yes('4 with no game, the tool stops', !!stop && stop.status === 1);
  yes('4 and names the five masters it lacks', !!stop &&
      /STOP\. Skyrim\.esm, Update\.esm, Dawnguard\.esm, HearthFires\.esm, Dragonborn\.esm are not in /.test(stop.stdout));
  yes('4 and writes nothing', !fs.existsSync(out) && !fs.existsSync(out + '.part'));
  yes('4 Collapse-DwarvenIngots.py, which edited the plugin in place, is gone',
      !fs.existsSync(path.join(ROOT, 'scripts', 'mods', 'Collapse-DwarvenIngots.py')));

  // ------------------------------------------------- 5. with the game ---
  const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
  if (['Skyrim.esm', 'Gourmet.esp'].every(f => fs.existsSync(path.join(data, f)))) {
    const built = python([TOOL, '--masters', data, '--out', out]);
    yes('5 with the game, the tool builds the plugin', !!built && built.status === 0 && fs.existsSync(out));
    if (built && built.status !== 0) { console.log(built.stdout + built.stderr); }
    if (fs.existsSync(out)) {
      const COMPARE = String.raw`
import importlib.util, struct, sys
spec = importlib.util.spec_from_file_location('acr', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def recs(p):
    raw = open(p, 'rb').read()
    hs = struct.unpack_from('<I', raw, 4)[0]
    return dict((r.fid, r.bytes()) for r in m.every_record(m.parse(raw, 24 + hs, len(raw))))
a, b = recs(sys.argv[2]), recs(sys.argv[3])
off = sorted(set(a) ^ set(b)) + sorted(f for f in set(a) & set(b) if a[f] != b[f])
print(' '.join('0x%07X' % f for f in off) or 'none')
`;
      const cmp = python(['-c', COMPARE, TOOL, out, ESP]);
      yes('5 and every record in it is the committed record byte for byte (differing: ' + (cmp ? cmp.stdout.trim() : '?') + ')',
          !!cmp && cmp.status === 0 && cmp.stdout.trim() === 'none');
    }
  } else {
    console.log('SKIP  5: no game at ' + data + ' (the box, or a PC with the game and Gourmet.esp, runs it)');
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
