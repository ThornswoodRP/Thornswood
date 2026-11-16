// test-4619-header-count.js
//
// #4619: the header count of every plugin we write equals its records plus
// its groups, the way the game and the editors count a plugin, so an editor
// reports no header error.
//
// Cause: scripts/mods/Add-ContentRecords.py wrote len(holds) + len(copies),
// the records alone, as the header's count, leaving out every group it
// writes. scripts/mods/Build-LastPlugin.py already counts both
// (tests/test-2468-last-plugin.js P9 holds it).
//
// Without the game, with the tool loaded as a module:
//   A. its count of a tree of records and nested groups is records plus groups;
//   B. the header it writes carries that count;
//   C. the build writes its header from that count, and holds the records it
//      reads back to the records it built, not to the header's count;
//   D. every plugin writer in scripts/mods is one this harness or
//      test-2468 holds, so a new writer is held too.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (!p.error) { return p; }
  }
  return null;
}

// Two COBJ under their top group, and a world with a cell and a placement in
// it, each child group nested the way a plugin holds them: 5 records, 4 groups.
const ASK = String.raw`
import importlib.util, json, struct, sys
spec = importlib.util.spec_from_file_location('acr', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def rec(tag, fid):
    return m.Rec(tag, 0, fid, m.FORM_TAIL, b'')
tree = [
    m.Grup(b'COBJ' + b'\x00' * 8 + m.GROUP_STAMP, [rec(b'COBJ', 0x5000801), rec(b'COBJ', 0x5000802)]),
    m.Grup(b'WRLD' + b'\x00' * 8 + m.GROUP_STAMP, [
        rec(b'WRLD', 0x3C),
        m.Grup(struct.pack('<I', 0x3C) + struct.pack('<I', 1) + b'\x00' * 4 + m.GROUP_STAMP, [
            rec(b'CELL', 0x9732),
            m.Grup(struct.pack('<I', 0x9732) + struct.pack('<I', 6) + b'\x00' * 4 + m.GROUP_STAMP, [
                rec(b'REFR', 0x5000900)])])])]
out = {'has': hasattr(m, 'header_count')}
if out['has']:
    n = m.header_count(tree)
    out['count'] = n
    out['written'] = struct.unpack_from('<i', m.header(b'Test.', n), 24 + 6 + 4)[0]
print(json.dumps(out))
`;

const run = python(['-c', ASK, TOOL]);
yes('python is on this machine and the tool loads as a module', !!run && run.status === 0);
if (run && run.status !== 0) { console.log(run.stdout + run.stderr); }
const a = run && run.status === 0 ? JSON.parse(run.stdout) : {};

// ------------------------------------------------------------- A. count --
yes('A the tool counts what a header counts (header_count)', a.has === true);
yes('A a tree of 5 records in 4 groups, two of them nested, counts 9 (' + a.count + ')', a.count === 9);

// ------------------------------------------------------------ B. header --
yes('B the header it writes carries that count (' + a.written + ')', a.written === 9);

// ------------------------------------------------------------- C. build --
const src = fs.readFileSync(TOOL, 'utf8').split(String.fromCharCode(13)).join('');
yes('C the build writes its header from header_count of the tree it writes',
  /head = header\(description, header_count\(tree\)\)/.test(src) && !/count = len\(holds\) \+ len\(copies\)\s*\n\s*head = header/.test(src));
yes('C and holds the records it reads back to the records it built, not to the header\'s count',
  /if len\(after\) != built:/.test(src) && !/if len\(after\) != count:/.test(src));

// ----------------------------------------------------------- D. writers --
// A plugin writer packs a HEDR. Each one is held here or by test-2468.
const HELD = { 'Add-ContentRecords.py': 'this harness', 'Build-LastPlugin.py': 'tests/test-2468-last-plugin.js P9' };
const mods = path.join(ROOT, 'scripts', 'mods');
const writers = fs.readdirSync(mods).filter(function (f) {
  return /\.(py|ps1|js)$/.test(f) && /\(b'HEDR', struct\.pack/.test(fs.readFileSync(path.join(mods, f), 'utf8'));
}).sort();
yes('D the plugin writers in scripts/mods are the two held (' + writers.join(', ') + ')',
  JSON.stringify(writers) === JSON.stringify(Object.keys(HELD).sort()));
const last = fs.readFileSync(path.join(ROOT, 'tests', 'test-2468-last-plugin.js'), 'utf8');
yes('D and test-2468 still holds Thornswood-Last\'s count to its records plus its groups',
  /readInt32LE\(4\) === count \+ groups/.test(last));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
