// #3114, prototype: scripts/dev/Affected-Harnesses.js says which gate
// harnesses a change can affect, from each harness's read map, and
// scripts/dev/Trace-HarnessReads.js turns strace's lines into those maps.
// Offline, against a planted map and planted strace lines; nothing runs.
//
// What is held here:
//   1. a harness runs when the change edits, adds or removes a path it read
//      or failed to find, or adds or removes an entry in a folder it listed,
//      names compared without case as a Windows checkout reads them; it is
//      left out when the change touches nothing it read.
//   2. a harness with no map, or one marked always, runs on any change.
//   3. the forcing rules run every harness: a workflow, the scripts that
//      list and run the gate, a test helper that is not a harness, a type
//      change, a change not measured from the map's own commit, or no map.
//   4. the trace parser follows each process's folder through chdir and
//      fork, even when a child's first calls are printed before its
//      parent's clone returns, joins a call strace split in two, counts a
//      folder listing, does not take readlink's answer for a path, and
//      marks a trace blind when an io_uring was set up.
//   5. a map built from a Windows trace (scripts/dev/Trace-Gate.ps1) holds
//      a harness to what it opened on the box, whatever its code says about
//      Windows, and always runs one that asked git, did not pass, or that
//      the box script marked (something else opened the checkout beside it);
//      and runs a harness when a file changes in place in a folder it
//      opened there, since a Windows listing gives each entry's size; or,
//      when the trace saw the directory enumerations, only in a folder it
//      listed, a folder it only opened rerunning it only when the folder
//      itself comes or goes.
//   6. a change measured from a traced tree's listing, as a pull request
//      measures it (pick), is what git diff --name-status gives.
//   7. a change to a build workflow runs the whole gate only when the gate's
//      part of it differs from the traced tree's (#3874): its gate steps,
//      the build jobs' runners and the environment, never its triggers,
//      concurrency, tested jobs, conditions or the steps after the gate; a
//      traced tree with no shape runs the whole gate as before.
'use strict';
const path = require('path');
const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const A = require(path.join(REPO, 'scripts', 'dev', 'Affected-Harnesses.js'));
const T = require(path.join(REPO, 'scripts', 'dev', 'Trace-HarnessReads.js'));

const BASE = 'a'.repeat(40);
const baseFiles = ['game/gamemode.js', 'game/data/food.json', 'docs/a.md', 'scripts/vps/X.ps1',
  'tests/test-food.js', 'tests/test-list.ps1', 'tests/test-win.ps1', 'tests/Windows.ps1', '.github/workflows/build.yml'];
const map = {
  format: 1, commit: BASE, harnesses: {
    'test-food.js': { reads: ['game/data/food.json', 'game/gamemode.js', 'tests/test-food.js', 'package.json'], lists: [] },
    'test-list.ps1': { reads: ['scripts', 'scripts/vps', 'scripts/vps/X.ps1', 'tests/test-list.ps1'], lists: ['scripts', 'scripts/vps'] },
    'test-win.ps1': { always: 'can run another way on Windows' },
  },
};
const gate = ['test-food.js', 'test-list.ps1', 'test-new.js', 'test-win.ps1'];
function pick(changes, o) {
  const head = baseFiles.filter(f => !changes.some(c => c.status === 'D' && c.path === f))
    .concat(changes.filter(c => c.status === 'A').map(c => c.path));
  return A.select(Object.assign({ map: map, gate: gate, base: BASE, changes: changes, baseFiles: baseFiles, headFiles: head }, o || {}));
}
const runs = (r, n) => r.run.indexOf(n) >= 0;

// 1. what a harness read
let r = pick([{ status: 'M', path: 'docs/a.md' }]);
yes('a change nobody read runs only the harnesses with no map or always', !r.full && r.run.join(' ') === 'test-new.js test-win.ps1');
r = pick([{ status: 'M', path: 'game/data/food.json' }]);
yes('a change to a file a harness read runs it', runs(r, 'test-food.js') && !runs(r, 'test-list.ps1'));
r = pick([{ status: 'M', path: 'GAME/Data/Food.json' }]);
yes('names are compared without case', runs(r, 'test-food.js'));
r = pick([{ status: 'A', path: 'package.json' }]);
yes('adding a file a harness looked for and did not find runs it', runs(r, 'test-food.js'));
r = pick([{ status: 'A', path: 'scripts/vps/Y.ps1' }]);
yes('adding a file in a folder a harness listed runs it', runs(r, 'test-list.ps1') && !runs(r, 'test-food.js'));
r = pick([{ status: 'A', path: 'scripts/new/deep/Z.ps1' }]);
yes('adding a folder inside a listed folder runs it', runs(r, 'test-list.ps1'));
r = pick([{ status: 'D', path: 'scripts/vps/X.ps1' }]);
yes('removing a file a harness read runs it', runs(r, 'test-list.ps1'));
r = pick([{ status: 'A', path: 'game/data/new.json' }]);
yes('adding a file beside one read, in a folder nobody listed, runs nothing more', !runs(r, 'test-food.js') && !runs(r, 'test-list.ps1'));
r = pick([{ status: 'M', path: 'tests/test-food.js' }]);
yes('a change to a harness itself runs it, and is not a helper change', !r.full && runs(r, 'test-food.js'));

// 2 and 3. always, unmapped and the forcing rules
yes('a harness the map does not name runs', runs(pick([]), 'test-new.js'));
yes('an always harness runs', runs(pick([]), 'test-win.ps1'));
for (const [what, c] of [
  ['a workflow', { status: 'M', path: '.github/workflows/build.yml' }],
  ['the harness runner', { status: 'M', path: 'scripts/dev/Nightly-Harnesses.ps1' }],
  ['the gate list', { status: 'M', path: 'tests/gate-excluded.txt' }],
  ['a test helper', { status: 'M', path: 'tests/Windows.ps1' }],
  ['the records the gate step reads', { status: 'M', path: 'records/build-runners.json' }],
  ['a type change', { status: 'T', path: 'docs/a.md' }],
]) {
  r = pick([c]);
  yes(what + ' runs the whole gate', r.full && r.run.length === gate.length);
}
r = pick([{ status: 'M', path: '.github/workflows/board-status.yml' }, { status: 'M', path: 'tests/README.md' }]);
yes('another workflow, or the tests README, is a file like any other', !r.full);
yes('a change not measured from the map\'s commit runs the whole gate', pick([], { base: 'b'.repeat(40) }).full);
yes('no map runs the whole gate', pick([], { map: null }).full);

// 4. the trace parser
const P = T.makeParser('/r', []);
[
  '100 openat(AT_FDCWD, "game/a.js", O_RDONLY|O_CLOEXEC) = 3</r/game/a.js>',
  '100 clone(child_stack=NULL, flags=CLONE_CHILD_SETTID|SIGCHLD) = 101',
  '101 chdir("scripts") = 0',
  '101 newfstatat(AT_FDCWD, "x.ps1", 0x7ffd, 0) = -1 ENOENT (No such file or directory)',
  '100 statx(AT_FDCWD, "docs/b.md", AT_STATX_SYNC_AS_STAT, STATX_ALL, 0x1) = 0',
  '100 openat(AT_FDCWD, "tests", O_RDONLY|O_DIRECTORY) = 4</r/tests>',
  '100 getdents64(4</r/tests>, 0x55 /* 3 entries */, 32768) = 80',
  '100 readlink("/proc/self", "100", 1023) = 3',
  '100 openat(5</r/site>, "index.html", O_RDONLY <unfinished ...>',
  '101 openat(AT_FDCWD, "/etc/hosts", O_RDONLY) = 3</etc/hosts>',
  '100 <... openat resumed>) = 6</r/site/index.html>',
  '100 openat(AT_FDCWD, "out/log.txt", O_WRONLY|O_CREAT|O_TRUNC, 0666) = 7</r/out/log.txt>',
  '101 newfstatat(AT_FDCWD, "C:\\\\Thornswood\\\\Game", 0x7ffd, 0) = -1 ENOENT (No such file or directory)',
  '100 io_uring_setup(256, {flags=IORING_SETUP_NO_SQARRAY}) = -1 ENOSYS (Function not implemented) (INJECTED)',
  // a child whose first calls are printed before its parent's clone returns
  '102 chdir("/r/docs") = 0',
  '102 openat(AT_FDCWD, "c.md", O_RDONLY) = 3</r/docs/c.md>',
  '100 vfork() = 102',
  '102 openat(AT_FDCWD, "d.md", O_RDONLY) = 4</r/docs/d.md>',
].forEach(P.line);
P.end();
const k = (p) => [...(P.touched.get(p) || [])].sort().join(',');
yes('a relative open is under the process folder', k('game/a.js') === 'read');
yes('a forked process keeps its own folder after chdir', k('scripts/x.ps1') === 'missing' && !P.touched.has('x.ps1'));
yes('a stat is a stat', k('docs/b.md') === 'stat');
yes('a listing names its folder', k('tests') === 'list,read');
yes('a call strace split in two is joined and read at its folder', k('site/index.html') === 'read');
yes('readlink\'s answer is not a path', !P.touched.has('100'));
yes('a path outside the checkout is not kept', ![...P.touched.keys()].some(p => p.indexOf('etc') >= 0));
yes('a file opened for writing is a write', k('out/log.txt') === 'write');
yes('a child seen before its parent\'s clone returns keeps the folder it moved to', k('docs/c.md') === 'read' && k('docs/d.md') === 'read' && !P.touched.has('c.md'));
yes('a Windows path is kept wherever it was looked for', P.windowsPaths.has('C:\\Thornswood\\Game'));
yes('a refused io_uring leaves the trace trusted', P.blind.length === 0);
const Q = T.makeParser('/r', []);
Q.line('100 io_uring_setup(256, {flags=0}) = 3');
yes('a ring that was set up marks the trace blind', Q.blind.length === 1);

// 5. a map from a Windows trace
const fs = require('fs'), os = require('os'), zlib = require('zlib');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-win-'));
try {
  const line = (o) => JSON.stringify(Object.assign({ platform: 'windows', exit: 0, seconds: 1, skipped: false, execs: ['pwsh.exe'], paths: {} }, o));
  const gz = path.join(dir, 'traces.jsonl.gz');
  fs.writeFileSync(gz, zlib.gzipSync([
    line({ harness: 'test-b.ps1', paths: { 'tests/test-b.ps1': 'read', 'scripts/vps/Vps.ps1': 'read', 'C:\\x': 'read' } }),
    line({ harness: 'test-a.js', skipped: true, paths: { 'tests/test-a.js': 'read' } }),
    line({ harness: 'test-git.ps1', paths: { '.git/objects/pack': 'read', 'tests/test-git.ps1': 'read' } }),
    line({ harness: 'test-red.js', exit: 1, paths: { 'tests/test-red.js': 'read' } }),
    line({ harness: 'test-stray.js', always: 'another process (svchost.exe) opened docs/x.md in the checkout while it ran', paths: { 'tests/test-stray.js': 'read' } }),
  ].join('\n') + '\n'));
  const m = A.build(gz, REPO, 'c'.repeat(40));
  const h = m.harnesses;
  yes('a Windows map names its commit and its tracer', m.commit === 'c'.repeat(40) && /ETW/.test(m.tracer));
  yes('  holds a harness to what it opened, in name order', h['test-b.ps1'] && !h['test-b.ps1'].always && h['test-b.ps1'].reads.join(' ') === 'C:\\x scripts/vps/Vps.ps1 tests/test-b.ps1' && Object.keys(h)[0] === 'test-a.js');
  yes('  a harness that said SKIP on the box is held to what it opened there', h['test-a.js'] && !h['test-a.js'].always);
  yes('  one that asked git always runs', h['test-git.ps1'] && /asks git/.test(h['test-git.ps1'].always));
  yes('  so does one that did not pass when traced', h['test-red.js'] && /did not pass when traced/.test(h['test-red.js'].always));
  yes('  and one the box marked, with the box\'s reason', h['test-stray.js'] && /svchost/.test(h['test-stray.js'].always));
  let threw = '';
  try { A.build(gz, REPO, ''); } catch (e) { threw = e.message; }
  yes('  traces that name no full commit build no map', /no full commit/.test(threw));
  yes('  says it is of Windows', m.platform === 'windows');
  yes('  and, its traces having no word of enumerations, takes every folder opened as listed', m.listings === undefined);
  const gz2 = path.join(dir, 'enum.jsonl.gz');
  fs.writeFileSync(gz2, zlib.gzipSync(line({ harness: 'test-e.ps1', listings: 'enumerated', paths: { 'tests': 'read', 'scripts': 'list' } }) + '\n'));
  const m2 = A.build(gz2, REPO, 'c'.repeat(40));
  yes('  a map from traces that saw the enumerations says so, and lists only what was listed', m2.listings === 'enumerated' && m2.harnesses['test-e.ps1'].lists.join(' ') === 'scripts');
  const wm = { format: 1, commit: BASE, platform: 'windows', harnesses: { 'test-list.ps1': map.harnesses['test-list.ps1'], 'test-food.js': map.harnesses['test-food.js'] } };
  const win = (changes) => A.select({ map: wm, gate: ['test-food.js', 'test-list.ps1'], base: BASE, changes: changes, baseFiles: baseFiles, headFiles: baseFiles });
  r = win([{ status: 'M', path: 'scripts/dev/Z.ps1' }]);
  yes('  a file changed in place in a folder it did not open leaves it out', r.run.length === 0);
  baseFiles.push('scripts/vps/W.ps1');
  r = win([{ status: 'M', path: 'scripts/vps/W.ps1' }]);
  yes('  one changed in place in a folder it opened runs it, on Windows', r.run.join(' ') === 'test-list.ps1' && /size and times/.test(r.why['test-list.ps1']));
  yes('  and not on a Linux map, where a listing gives no sizes', !runs(pick([{ status: 'M', path: 'scripts/vps/W.ps1' }]), 'test-list.ps1'));
  // A trace that saw the enumerations: test-open.ps1 opened scripts/vps and
  // never listed it, test-list.ps1 listed it.
  const em = { format: 1, commit: BASE, platform: 'windows', listings: 'enumerated', harnesses: {
    'test-list.ps1': { reads: ['scripts/vps', 'tests/test-list.ps1'], lists: ['scripts/vps'] },
    'test-open.ps1': { reads: ['scripts/vps', 'tests/test-open.ps1'], lists: [] },
  } };
  const en = (changes, files) => A.select({ map: em, gate: ['test-list.ps1', 'test-open.ps1'], base: BASE, changes: changes, baseFiles: baseFiles, headFiles: files || baseFiles });
  r = en([{ status: 'M', path: 'scripts/vps/W.ps1' }]);
  yes('  with the enumerations seen, a file changed in place reruns only the harness that listed its folder', r.run.join(' ') === 'test-list.ps1');
  r = en([{ status: 'A', path: 'scripts/vps/New.ps1' }], baseFiles.concat(['scripts/vps/New.ps1']));
  yes('  and so does an entry added there', r.run.join(' ') === 'test-list.ps1');
  r = en([{ status: 'D', path: 'scripts/vps/X.ps1' }, { status: 'D', path: 'scripts/vps/W.ps1' }], baseFiles.filter(f => !f.startsWith('scripts/vps/')));
  yes('  while the folder itself going reruns the one that only opened it too', r.run.join(' ') === 'test-list.ps1 test-open.ps1');
  baseFiles.pop();
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// 6. a change measured from a tree's listing (pick on a pull request, which
// has the traced commit's listing and not the commit), the way git diff
// --name-status --no-renames measures it.
{
  const tree = (entries) => Buffer.from(entries.map(e => e[0] + ' ' + (e[0] === '160000' ? 'commit' : 'blob') + ' ' + e[1] + '\t' + e[2] + '\0').join(''));
  const b = A.parseTree(tree([['100644', 'a'.repeat(40), 'docs/a.md'], ['100644', 'b'.repeat(40), 'game/x.js'], ['100644', 'c'.repeat(40), 'gone.txt'],
    ['100644', 'd'.repeat(40), 'run.sh'], ['100644', 'e'.repeat(40), 'link'], ['160000', 'f'.repeat(40), 'engine/skymp'], ['100644', '1'.repeat(40), 'same.txt']]));
  const h = A.parseTree(tree([['100644', 'a'.repeat(40), 'docs/a.md'], ['100644', '2'.repeat(40), 'game/x.js'], ['100755', 'd'.repeat(40), 'run.sh'],
    ['120000', 'e'.repeat(40), 'link'], ['160000', '3'.repeat(40), 'engine/skymp'], ['100644', '1'.repeat(40), 'same.txt'], ['100644', '4'.repeat(40), 'new/n.txt']]));
  const c = A.changesBetween(b, h).map(x => x.status + ' ' + x.path).join(', ');
  yes('a listing reads into paths with their mode and object', b.size === 7 && b.get('engine/skymp') === '160000 ' + 'f'.repeat(40));
  yes('the change between two listings is git\'s: a new object or executable bit M, a file become a link T, A and D (' + c + ')',
      c === 'M engine/skymp, M game/x.js, D gone.txt, T link, A new/n.txt, M run.sh');
  let threw = false;
  try { A.parseTree(Buffer.from('not a listing\0')); } catch (e) { threw = true; }
  yes('a listing that is not one is refused, so the whole gate runs', threw);
  yes('a change to Run-Gate.ps1, the gate step\'s script, runs the whole gate', A.select({ map: map, gate: gate, base: BASE, changes: [{ status: 'M', path: 'scripts/dev/Run-Gate.ps1' }], baseFiles: baseFiles, headFiles: baseFiles }).full);
  yes('so does a change to Gate-Map.ps1, which fetches the map off the box (#4009)', A.select({ map: map, gate: gate, base: BASE, changes: [{ status: 'M', path: 'scripts/dev/Gate-Map.ps1' }], baseFiles: baseFiles, headFiles: baseFiles }).full);
}

// 7. the gate's shape in the build workflows (#3874)
{
  const WF = [
    'name: Build check', 'on:', '  push:', '    branches: [main]', 'permissions:', '  contents: read',
    'concurrency:', '  group: build-${{ github.ref }}', '  cancel-in-progress: false', 'jobs:',
    '  tested:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo look',
    '  gate:', '    name: Gate harnesses (${{ matrix.shard }} of ${{ strategy.job-total }})', '    needs: tested', "    if: ${{ !cancelled() }}",
    '    runs-on: windows-latest', '    timeout-minutes: 60', '    steps:',
    '      - uses: actions/checkout@x # v7', '      # why the checks run', '      - name: Scan', '        run: |', '          .\\scripts\\dev\\Check-Secrets.ps1',
    '      - name: Run the gate harnesses', '        id: gate', '        run: |', '          .\\scripts\\dev\\Run-Gate.ps1 -Throttle 6',
    '      - name: Lint', '        run: echo lint', '      - name: Write down the tree', '        run: echo note', ''].join('\n');
  const PR = WF.replace('name: Build check', 'name: Build check (pull requests)');
  const sh = (a, b) => A.gateShape([a, b === undefined ? PR : b]);
  const base = sh(WF);
  yes('the two build workflows have a gate shape', /^[0-9a-f]{64}$/.test(base || ''));
  yes('  the same in CRLF', sh(WF.split('\n').join('\r\n')) === base);
  for (const [what, text] of [
    ['a comment', WF.replace('      # why the checks run', '      # why the checks run, and when')],
    ['the triggers', WF.replace('    branches: [main]', '    branches: [main, dev]')],
    ['the concurrency', WF.replace('cancel-in-progress: false', 'cancel-in-progress: true')],
    ['the tested job', WF.replace('      - run: echo look', '      - run: echo look again')],
    ['the gate job\'s condition and needs', WF.replace("    if: ${{ !cancelled() }}", "    if: ${{ !cancelled() && 1 }}").replace('    needs: tested\n', '    needs: [tested, other]\n')],
    ['a step after the gate', WF.replace('        run: echo note', '        if: runner.environment == \'github-hosted\'\n        run: echo note')],
    ['a new job beside the gate job', WF.replace('  gate:\n', '  launcher:\n    runs-on: windows-latest\n  gate:\n')],
  ]) { yes('  a change to ' + what + ' keeps it', sh(text) === base); }
  for (const [what, text] of [
    ['the gate step', WF.replace('-Throttle 6', '-Throttle 4')],
    ['a step before the gate', WF.replace('Check-Secrets.ps1', 'Check-Secrets.ps1 -Binary')],
    ['a new step before the gate', WF.replace('      - name: Run the gate harnesses', '      - name: Plant\n        run: echo x > game/x.js\n      - name: Run the gate harnesses')],
    ['the gate job\'s runner', WF.replace('runs-on: windows-latest', 'runs-on: windows-2025')],
    ['the permissions', WF.replace('  contents: read', '  contents: read\n  actions: read')],
    ['an env for every job', WF.replace('concurrency:', 'env:\n  X: 1\nconcurrency:')],
  ]) { yes('  a change to ' + what + ' changes it', sh(text) !== base); }
  yes('  so does one to the pull request workflow alone', sh(WF, PR.replace('-Throttle 6', '-Throttle 5')) !== base);
  yes('  a workflow with no gate step has none', sh(WF.replace('        id: gate\n', '')) === null && sh(WF, null) === null);

  const files = baseFiles.concat(['tests/test-1306-pr-workflow.js']);
  const m2 = JSON.parse(JSON.stringify(map));
  m2.harnesses['test-1306-pr-workflow.js'] = { reads: ['.github/workflows/build.yml', 'tests/test-1306-pr-workflow.js'], lists: [] };
  const g2 = gate.concat(['test-1306-pr-workflow.js']);
  const sel = (shape) => A.select({ map: m2, gate: g2, base: BASE, changes: [{ status: 'M', path: '.github/workflows/build.yml' }], baseFiles: files, headFiles: files, shape: shape });
  r = sel({ base: base, head: base });
  yes('a build.yml change outside the gate\'s part runs only what reads it', !r.full && r.run.indexOf('test-1306-pr-workflow.js') >= 0 && r.run.indexOf('test-food.js') < 0 && r.notes.length === 1);
  yes('one inside it runs the whole gate', sel({ base: base, head: sh(WF.replace('-Throttle 6', '-Throttle 4')) }).full);
  yes('so does any, measured from a traced tree with no shape', sel({ base: null, head: base }).full && sel(undefined).full);
  yes('and an added or removed build workflow, whatever the shapes', A.select({ map: m2, gate: g2, base: BASE, changes: [{ status: 'D', path: '.github/workflows/build-pr.yml' }], baseFiles: files, headFiles: files, shape: { base: base, head: base } }).full);

  const listing = Buffer.from('100644 blob ' + 'a'.repeat(40) + '\tdocs/a.md\0');
  const withShape = A.readTreeFile(Buffer.concat([Buffer.from('#gate-shape ' + base + '\0'), listing]));
  yes('a tree file carries the shape before its listing', withShape.shape === base && withShape.tree.get('docs/a.md') === '100644 ' + 'a'.repeat(40));
  const old = A.readTreeFile(listing);
  yes('  and one written before it reads with none', old.shape === null && old.tree.size === 1);
  let threw = false;
  try { A.readTreeFile(Buffer.concat([Buffer.from('#gate-shape nope\0'), listing])); } catch (e) { threw = true; }
  yes('  a header that is not a shape is refused, so the whole gate runs', threw);
  const ra = fs.readFileSync(path.join(REPO, 'scripts', 'dev', 'Run-Gate.ps1'), 'utf8');
  yes('Run-Gate.ps1 writes the traced tree with the tree command, which carries the shape', /& node \$Affected tree HEAD /.test(ra));
  yes('the repository\'s own two build workflows have a shape', A.gateShape(A.WORKFLOWS.map(f => fs.readFileSync(path.join(REPO, f), 'utf8'))) !== null);
}

// ---- platforms (#5293): which harnesses Linux runs as fully as Windows ----
{
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'platforms-'));
  try {
    const end = (name, code, skips, passes) => JSON.stringify({ name: name, end: '2026-11-01T00:00:00Z', code: code, secs: 1, skipped: !!(skips && skips.length), skips: skips, passes: passes });
    const start = name => JSON.stringify({ name: name, pid: 42, start: '2026-11-01T00:00:00Z' });
    const win = [start('test-a.js'), end('test-a.js', 0, [], 5), end('test-b.ps1', 0, [], 3), end('test-c.ps1', 0, ['SKIP  no box here'], 4),
      end('test-d.js', 1, [], 2), end('test-e.js', 0, [], 2), end('test-f.js', 0, [], 6), end('test-g.js', 0, undefined, 1), end('test-h.js', 0, [], 1)];
    const lin = [start('test-a.js'), end('test-a.js', 0, [], 5), end('test-b.ps1', 0, ['SKIP  needs Windows PowerShell 5.1'], 2), end('test-c.ps1', 0, ['SKIP  no box here'], 4),
      end('test-d.js', 0, [], 2), end('test-e.js', 2, [], 1), end('test-f.js', 0, [], 4), end('test-g.js', 0, [], 1), end('test-i.js', 0, [], 1)];
    const wf = path.join(dir, 'w.jsonl'), lf = path.join(dir, 'l.jsonl');
    fs.writeFileSync(wf, win.join('\n') + '\n'); fs.writeFileSync(lf, lin.join('\n') + '\n');
    const p = A.platforms(wf, lf, 'c'.repeat(40));
    const h = p.harnesses;
    yes('platforms: one that passed on both with the same lines runs on Linux', h['test-a.js'].linux === true);
    yes('  as does one whose SKIP lines on Linux it said on Windows too', h['test-c.ps1'].linux === true);
    yes('  not one that skips on Linux what it ran on Windows: ' + h['test-b.ps1'].why, h['test-b.ps1'].linux === false && /says on Linux what it does not on Windows: SKIP  needs Windows PowerShell 5\.1/.test(h['test-b.ps1'].why));
    yes('  nor one that failed on Windows that night: ' + h['test-d.js'].why, h['test-d.js'].linux === false && /did not pass on Windows/.test(h['test-d.js'].why));
    yes('  nor one that failed on Linux: ' + h['test-e.js'].why, h['test-e.js'].linux === false && /did not pass on Linux \(exit 2\)/.test(h['test-e.js'].why));
    yes('  nor one that passed fewer checks on Linux, saying no SKIP: ' + h['test-f.js'].why, h['test-f.js'].linux === false && /passed 4 checks on Linux and 6 on Windows/.test(h['test-f.js'].why));
    yes('  nor one whose run did not list its SKIP lines', h['test-g.js'].linux === false && /did not say which SKIP lines/.test(h['test-g.js'].why));
    yes('  nor one in only one of the runs', h['test-h.js'].linux === false && /did not run on Linux/.test(h['test-h.js'].why) && h['test-i.js'].linux === false && /did not run on Windows/.test(h['test-i.js'].why));
    yes('  and it counts them and names the commit', p.format === 1 && p.commit === 'c'.repeat(40) && p.linux === 2 && p.windows === 7);
    const noCount = [end('test-a.js', 0, [], undefined)];
    fs.writeFileSync(lf, noCount.join('\n') + '\n');
    yes('  a run from before the passing lines were counted keeps it on Windows', A.platforms(wf, lf, '').harnesses['test-a.js'].linux === false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
