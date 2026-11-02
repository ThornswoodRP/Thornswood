#!/usr/bin/env node
// scripts/dev/Affected-Harnesses.js
//
// Issue #3114. Says which gate harnesses a change can affect, from a read
// map: for each harness, every path inside the checkout it opened, looked
// at, failed to find or listed when it ran on the base commit. On the VPS
// an administrator task traces every main build's gate
// (scripts/dev/Trace-Gate-Task.ps1) and scripts/dev/Run-Gate.ps1 picks a
// pull request's harnesses with "pick" below; scripts/dev/Trace-Gate.ps1
// traces one run by hand (traces.jsonl.gz, one line a harness), and
// scripts/dev/Trace-HarnessReads.js traces on Linux (one file a harness).
//
// WHY THAT IS ENOUGH. A harness's result here can only differ between two
// trees through what its system calls return. When no path it touched is
// changed, added or removed, and no folder it listed gains or loses an
// entry (or, on Windows, where a listing gives sizes and times, has one
// changed in place), every one of those calls returns what it returned on
// the base, so it touches the same paths again and ends the same way. That holds for the
// run that was traced. A Windows trace is of the gate's own run, so it holds
// there; a harness that asks git, or did not pass, or that something outside
// the harnesses opened the checkout beside, always runs. A Linux trace holds
// only for Linux, so a harness whose run on Windows can go another way (it
// asks which system it is on, names a Windows path, or fails or skips on
// Linux) always runs as well. So does a harness the map does not name.
//
//   build:  node scripts/dev/Affected-Harnesses.js build <traces> <map.json> [commit]
//           <traces> a folder of Linux traces with its _commit.txt, or a
//           Windows traces.jsonl.gz and the commit it traced
//   select: node scripts/dev/Affected-Harnesses.js select <map.json> <head> [gate.txt]
//   tree:   node scripts/dev/Affected-Harnesses.js tree <rev> <tree.gz>
//           every path in <rev>'s tree with its mode and object, gzipped
//           (git ls-tree -r -z), so a change can be measured from that tree
//           where the commit itself is not fetched; first, the gate's shape
//           in <rev>'s two build workflows (gateShape below)
//   pick:   node scripts/dev/Affected-Harnesses.js pick <traces.jsonl.gz> <tree.gz> <commit> <gate.txt> <out.txt>
//           build and select in one, measuring the change from the traced
//           tree's listing to HEAD's tree; writes the harnesses to run to
//           <out.txt> and prints why each one runs
//
// The change is every difference between the tree the map was traced on
// (its commit) and <head>; on a pull request <head> is GitHub's merge
// commit. The argument above needs only those two trees, so the map may be
// of any commit, the pull request's base or an older one, and is never
// stale, only wider.
// select prints the harnesses to run, one a line, in gate order; with
// FULL on its first line of standard error when a forcing rule hit, and
// then every gate harness. The gate list is gate.txt, or
// scripts/dev/Gate-Harnesses.ps1 run on the head checkout.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const REPO = path.join(__dirname, '..', '..');

// A change to any of these runs the whole gate. Each is something the
// gate's own result rests on outside any one harness's reads.
const FORCE = [
  // Only the workflow that runs the gate. Any other workflow is a file like
  // any other: a harness that reads it has it in its map. Only its gate
  // part forces (#3874): see gateShape. A change to the rest of it, which
  // cannot reach a harness's run, leaves it a file like any other.
  [/^\.github\/workflows\/(build|build-pr)\.yml$/, 'the workflow that runs the gate, its steps and its environment', 'shape'],
  [/^scripts\/dev\/(Run-Gate\.ps1|Gate-Map\.ps1|Nightly-Harnesses\.ps1|Gate-Harnesses\.ps1|Harness-Files\.ps1|Affected-Harnesses\.js|Trace-HarnessReads\.js)$/, 'the scripts that list, choose and run the harnesses'],
  [/^tests\/gate-excluded\.txt$/, 'the gate list'],
  // Belt and braces: a helper is read by the harnesses that use it, so it is
  // in their maps already. The rule costs little (measured) and covers a
  // helper reached in a way no trace sees, such as one only Windows loads.
  [/^tests\/(?!test-)[^/]+\.(ps1|psm1|js|cjs|mjs|py|c)$/, 'a shared test helper in tests'],
  // And one beside a product's harnesses, in its own tests folder (plan
  // line 42), should a product's harnesses ever share one of their own.
  [/^[^/]+\/tests\/(?!test-)[^/]+\.(ps1|psm1|js|cjs|mjs|py|c)$/, 'a test helper in a product\'s tests folder'],
  [/^records\/build-runners\.json$/, 'the gate step reads it for its share of the cores'],
  [/^\.gitattributes$/, 'line endings of every file a Windows checkout writes'],
  [/^\.gitmodules$/, 'the submodules a checkout has'],
];

// What makes a Linux trace no promise about the Windows run. A code file the
// harness read that asks which system it is on, or reaches for something
// only Windows has, can take another path there.
const PLATFORM = /\$IsWindows|\$IsLinux|\$IsMacOS|\$OnWindows|\$env:OS\b|Windows_NT|PSEdition|PSVersionTable|OSVersion|RuntimeInformation|process\.platform|os\.platform\(|os\.type\(|['"]win32['"]|sys\.platform|os\.name\b|platform\.system|powershell\.exe|cmd\.exe|Get-WindowsPowerShell|Get-WindowsPath|\$env:(SystemRoot|WINDIR|windir|LOCALAPPDATA|APPDATA|USERPROFILE|ProgramFiles|ProgramData|ComSpec)|process\.env\.(SystemRoot|WINDIR|LOCALAPPDATA|APPDATA|USERPROFILE|ProgramFiles|ProgramData|ComSpec)/;
const CODE = /\.(ps1|psm1|psd1|js|cjs|mjs|py|cmd|bat|sh)$/i;
// Which program runs a code file. "python3.12" and "pwsh.exe" count as
// python and pwsh.
const RUNS_IN = [
  [/\.(ps1|psm1|psd1)$/i, ['pwsh', 'powershell']],
  [/\.(js|cjs|mjs)$/i, ['node']],
  [/\.py$/i, ['python']],
  [/\.sh$/i, ['sh', 'bash', 'dash']],
  [/\.(cmd|bat)$/i, ['cmd']],
];

function lower(p) { return p.toLowerCase(); }

// ---- the gate's shape in the build workflows (#3874) ------------------------

// What of the two build workflows a gate harness's run can depend on: the
// top-level permissions, env and defaults, and the build job, less
// their name, needs and if, cut after the gate step (id: gate), all without
// comments, blank lines or trailing spaces. The rest (the triggers, the
// concurrency, the tested jobs, a job's condition, the steps after the gate)
// decides whether and when the gate runs, never what a harness in it sees.
// On 26 and 27 Oct 2026 three of five changes to build.yml (2dd37857,
// 49f4dae9, ebdb9d0c) were all outside it, and each one sent every pull
// request to the whole gate (611 harnesses) until a main build traced again.
// A workflow that cannot be read this way (no gate step found) has no shape,
// and a change to it runs the whole gate as before.
// The box's fallback job, launcher-vps, went with #4983. The gate step left
// the launcher job for a job of its own, "gate", run in shares, on 31 Oct 2026.
const GATE_JOBS = ['gate'];
const WORKFLOWS = ['.github/workflows/build.yml', '.github/workflows/build-pr.yml'];
function gatePart(text) {
  const lines = String(text).split('\r\n').join('\n').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l && !/^\s*#/.test(l));
  const out = [];
  let inJobs = false, sawGate = false;
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (/^\S/.test(l)) {
      inJobs = l === 'jobs:';
      let j = i + 1;
      while (j < lines.length && /^\s/.test(lines[j])) { j++; }
      if (/^(permissions|env|defaults):/.test(l)) { out.push(...lines.slice(i, j)); }
      i = inJobs ? i + 1 : j;
      continue;
    }
    const job = /^  ([A-Za-z0-9_-]+):$/.exec(l);
    if (!inJobs || !job) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && !/^ {0,2}\S/.test(lines[j])) { j++; }
    if (GATE_JOBS.indexOf(job[1]) >= 0) {
      let body = lines.slice(i, j).filter(x => !/^    (name|needs|if):/.test(x));
      const g = body.indexOf('        id: gate');
      if (g >= 0) {
        sawGate = true;
        let k = g + 1;
        while (k < body.length && !/^      - /.test(body[k])) { k++; }
        body = body.slice(0, k);
      }
      out.push(...body);
    }
    i = j;
  }
  return sawGate ? out.join('\n') + '\n' : null;
}
// texts: the two workflows' text, in WORKFLOWS order. null when either has
// no gate part.
function gateShape(texts) {
  const parts = texts.map(t => (t === null || t === undefined ? null : gatePart(t)));
  if (parts.some(x => x === null)) { return null; }
  return require('crypto').createHash('sha256').update(parts.join('\0')).digest('hex');
}

// ---- build: traces to one map ----------------------------------------------

// The traces in a folder (Linux, one file each, with _commit.txt) or in one
// traces.jsonl.gz (Windows, one line each).
function readTraces(from, commit) {
  if (fs.statSync(from).isDirectory()) {
    return {
      commit: fs.readFileSync(path.join(from, '_commit.txt'), 'utf8').trim(),
      traces: fs.readdirSync(from).filter(x => x.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(from, f), 'utf8'))),
    };
  }
  let text = fs.readFileSync(from);
  if (from.endsWith('.gz')) { text = require('zlib').gunzipSync(text); }
  const traces = text.toString('utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  traces.sort((a, b) => (a.harness < b.harness ? -1 : a.harness > b.harness ? 1 : 0));
  return { commit: commit, traces: traces };
}

function build(from, root, commitArg) {
  const got = readTraces(from, commitArg);
  const commit = got.commit;
  if (!/^[0-9a-f]{40}$/.test(commit || '')) { throw new Error('the traces name no full commit (' + commit + ')'); }
  const harnesses = {};
  let windows = false, enumerated = true;
  const codeCache = new Map();
  function platformLine(rel) {
    if (codeCache.has(rel)) { return codeCache.get(rel); }
    let hit = null;
    const file = path.join(root, rel);
    if (CODE.test(rel) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = PLATFORM.exec(lines[i]);
        if (m) { hit = rel + ':' + (i + 1) + ' ' + m[0]; break; }
      }
    }
    codeCache.set(rel, hit);
    return hit;
  }
  for (const t of got.traces) {
    const onWindows = t.platform === 'windows';
    if (onWindows) { windows = true; if (t.listings !== 'enumerated') { enumerated = false; } }
    const reads = [], lists = [];
    let why = onWindows && t.always ? t.always : '';
    for (const [p, kinds] of Object.entries(t.paths)) {
      if (p === '.git' || p.startsWith('.git/')) {
        // Finding the repository is a look at .git and its HEAD and config;
        // anything past that is a question to git about this tree.
        if (!/^\.git(\/(HEAD|config|commondir|gitdir))?$/.test(p) && !why) { why = 'asks git about the tree (' + p + ')'; }
        continue;
      }
      if (!onWindows && /\\|^[A-Za-z]:/.test(p) && !why) { why = 'looks for a Windows path (' + p + ')'; }
      if (kinds.indexOf('list') >= 0) { lists.push(p); }
      reads.push(p);
    }
    if (t.exit !== 0 && !why) { why = 'did not pass when traced (exit ' + t.exit + ')'; }
    if (!onWindows) {
      if ((t.windowsPaths || []).length && !why) { why = 'looks for a Windows path (' + t.windowsPaths[0] + ')'; }
      if (t.blind && !why) { why = 'set up an io_uring, whose file work strace does not see'; }
      if (t.skipped && !why) { why = 'says SKIP or NOT RUN on Linux, so part of it was not traced'; }
    }
    if (!why && !onWindows) {
      // A code file can run only when its language's program ran: a .js
      // harness that greps a .ps1 and starts no pwsh runs none of it. The
      // programs are the harness's own and every one it started.
      const ran = new Set(t.execs.map(e => e.split(' ')[0].replace(/\.exe$/i, '').replace(/[0-9.]+$/, '')));
      ran.add(t.harness.endsWith('.js') ? 'node' : 'pwsh');
      for (const p of reads) {
        const lang = RUNS_IN.find(x => x[0].test(p));
        if (!lang || !lang[1].some(x => ran.has(x))) { continue; }
        const hit = platformLine(p);
        if (hit) { why = 'can run another way on Windows: ' + hit; break; }
      }
    }
    harnesses[t.harness] = why
      ? { always: why, seconds: t.seconds }
      : { seconds: t.seconds, reads: reads.sort(), lists: lists.sort() };
  }
  const map = { format: 1, commit: commit, tracer: windows ? 'ETW on the VPS, scripts/dev/Trace-Gate.ps1' : 'strace on Linux, scripts/dev/Trace-HarnessReads.js', harnesses: harnesses };
  if (windows) { map.platform = 'windows'; }
  // The box read each folder's enumerations, so a folder in lists was
  // listed and one only in reads was opened and never listed.
  if (windows && enumerated) { map.listings = 'enumerated'; }
  return map;
}

// ---- select: a change to the harnesses it can affect -------------------------

// changes: [{status: 'A'|'M'|'D'|'T'|..., path}] with renames as D plus A.
// baseFiles, headFiles: every tracked path in each tree.
function select(opts) {
  const map = opts.map, gate = opts.gate, changes = opts.changes;
  const out = { full: false, reasons: [], run: [], skipped: [], why: {} };
  function full(reason) { out.full = true; out.reasons.push(reason); }
  // The change is measured from the tree the map was traced on, which need
  // not be the pull request's base: any traced tree will do, and an older
  // one only means a longer change and more harnesses run.
  if (!map || map.format !== 1) { full('no read map'); }
  else if (opts.base && map.commit !== opts.base) { full('the change was not measured from the map\'s own commit ' + map.commit.slice(0, 8)); }
  // opts.shape: {base, head}, the gate's shape (gateShape) in the traced
  // tree's workflows and in the head's; either null when unknown.
  const shape = opts.shape || {};
  const sameShape = !!shape.base && shape.base === shape.head;
  out.notes = [];
  for (const c of changes) {
    if (!/^[AMD]$/.test(c.status)) { full(c.path + ' changed as ' + c.status + ' (a type change, copy or unmerged path)'); continue; }
    for (const [re, what, kind] of FORCE) {
      if (!re.test(c.path)) { continue; }
      if (kind === 'shape' && sameShape && c.status === 'M') { out.notes.push(c.path + ' changed outside the gate\'s part (its gate steps, jobs\' runners and environment are as traced), so it is a file like any other'); continue; }
      full(c.path + ': ' + what + (kind === 'shape' ? (shape.base ? ', changed from the traced one' : ', and the traced tree carries no gate shape to compare') : ''));
    }
  }
  if (out.full) { out.run = gate.slice(); for (const n of gate) { out.why[n] = 'full gate'; } return out; }

  // Every path whose existence or contents differ, and every folder whose
  // entries differ. Lower case, as a Windows checkout reads names.
  const dirsOf = (files) => {
    const s = new Set(['']);
    for (const f of files) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) { s.add(parts.slice(0, i).join('/')); } }
    return s;
  };
  const baseSet = new Set(opts.baseFiles.map(lower)), headSet = new Set(opts.headFiles.map(lower));
  const baseDirs = new Set([...dirsOf(opts.baseFiles)].map(lower)), headDirs = new Set([...dirsOf(opts.headFiles)].map(lower));
  const touched = new Set(); // paths whose answer to open or stat differs
  const relisted = new Set(); // folders whose listing differs
  // On Windows a folder's listing carries each entry's size and times, so a
  // file changed in place changes what a harness that listed its folder was
  // told. A map whose trace saw no enumerations has to take every folder
  // opened as listed.
  const restated = new Map(); // folder to a file in it changed in place
  for (const c of changes) {
    const p = lower(c.path);
    touched.add(p);
    if (c.status === 'M') {
      const parent = p.split('/').slice(0, -1).join('/') || '.';
      if (!restated.has(parent)) { restated.set(parent, c.path); }
      continue;
    }
    // An added or removed path: it and every folder above it that came or
    // went, and the folder that holds the topmost of those.
    const had = (q) => baseSet.has(q) || baseDirs.has(q);
    const has = (q) => headSet.has(q) || headDirs.has(q);
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const q = parts.slice(0, i).join('/');
      if (had(q) !== has(q)) {
        const parent = parts.slice(0, i - 1).join('/');
        relisted.add(parent === '' ? '.' : parent);
        for (let j = i; j <= parts.length; j++) { touched.add(parts.slice(0, j).join('/')); }
        break;
      }
    }
  }
  for (const n of gate) {
    const h = map.harnesses[n];
    if (!h) { out.run.push(n); out.why[n] = 'not in the read map (new to the gate)'; continue; }
    if (h.always) { out.run.push(n); out.why[n] = 'always: ' + h.always; continue; }
    let hit = null;
    for (const r of h.reads) {
      const l = lower(r);
      if (touched.has(l)) { hit = 'reads ' + r; break; }
    }
    // A folder it listed gains or loses an entry. With dirStat 'listing' (the
    // default) a folder it only opened or looked at counts the same, since on
    // Linux a folder's size and link count move with its entries. Not on a
    // Windows map that saw the enumerations: there a folder only opened tells
    // nothing of its entries (NTFS gives a folder size 0 and one link,
    // whatever it holds), and its times move on every checkout anyway, since
    // the runner writes every file again (#3029), so no result can lean on
    // them.
    const enumerated = map.platform === 'windows' && map.listings === 'enumerated';
    const folders = enumerated || opts.dirStat === 'existence' ? h.lists : h.reads;
    for (const r of folders) {
      if (hit) { break; }
      if (relisted.has(lower(r))) { hit = 'looks at the folder ' + r + ', which gains or loses an entry'; }
    }
    if (map.platform === 'windows') {
      for (const r of enumerated ? h.lists : h.reads) {
        if (hit) { break; }
        const f = restated.get(lower(r));
        if (f) { hit = (enumerated ? 'listed' : 'opened') + ' the folder ' + r + ', whose listing gives ' + f + '\'s size and times'; }
      }
    }
    if (hit) { out.run.push(n); out.why[n] = hit; } else { out.skipped.push(n); }
  }
  return out;
}

// ---- trees -------------------------------------------------------------------

// git ls-tree -r -z: "<mode> <type> <object>\t<path>" entries, NUL ended, to
// a Map of path to "<mode> <object>".
// A tree file as the tree command writes it: optional '#gate-shape <hex>'
// entries first, then the listing. {tree: parseTree's Map, shape: hex or
// null}. A file written before #3874 has no shape, and a change to a build
// workflow measured from it runs the whole gate.
function readTreeFile(buf) {
  let shape = null, at = 0;
  for (;;) {
    if (buf[at] !== 0x23) { break; }
    const end = buf.indexOf(0, at);
    if (end < 0) { throw new Error('a tree file header has no end'); }
    const m = /^#gate-shape ([0-9a-f]{64})$/.exec(buf.slice(at, end).toString('utf8'));
    if (!m) { throw new Error('a tree file header is not "#gate-shape <sha256>": ' + JSON.stringify(buf.slice(at, Math.min(end, at + 80)).toString('utf8'))); }
    shape = m[1];
    at = end + 1;
  }
  return { tree: parseTree(buf.slice(at)), shape: shape };
}

function parseTree(buf) {
  const out = new Map();
  for (const e of buf.toString('utf8').split('\0')) {
    if (!e) { continue; }
    const tab = e.indexOf('\t');
    const f = e.slice(0, tab).split(' ');
    if (tab < 0 || f.length !== 3) { throw new Error('a tree listing line is not "<mode> <type> <object>\\t<path>": ' + JSON.stringify(e.slice(0, 80))); }
    out.set(e.slice(tab + 1), f[0] + ' ' + f[2]);
  }
  return out;
}

// The change from one tree's listing to another's, the way git diff
// --name-status --no-renames gives it: A added, D removed, M its object or
// its executable bit changed, T a file became a link or a submodule or the
// other way round.
function changesBetween(base, head) {
  const out = [];
  const kind = m => m.slice(0, 3);
  for (const [p, b] of base) {
    const h = head.get(p);
    if (h === undefined) { out.push({ status: 'D', path: p }); continue; }
    if (h === b) { continue; }
    out.push({ status: kind(h) === kind(b) ? 'M' : 'T', path: p });
  }
  for (const p of head.keys()) { if (!base.has(p)) { out.push({ status: 'A', path: p }); } }
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

// ---- command line ------------------------------------------------------------

function git(args) { return cp.execFileSync('git', ['-C', REPO].concat(args), { maxBuffer: 1 << 28 }); }
function treeFiles(sha) { return git(['ls-tree', '-r', '-z', '--name-only', sha]).toString().split('\0').filter(Boolean); }
function diff(base, head) {
  const parts = git(['diff', '--name-status', '--no-renames', '-z', base, head]).toString().split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) { out.push({ status: parts[i][0], path: parts[i + 1] }); }
  return out;
}
function showAt(rev, file) {
  try { return cp.execFileSync('git', ['-C', REPO, 'show', rev + ':' + file], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { return null; }
}
function shapeAt(rev) { return gateShape(WORKFLOWS.map(f => showAt(rev, f))); }
function readGate(file) {
  const text = file ? fs.readFileSync(file, 'utf8') : cp.execFileSync('pwsh', ['-NoProfile', '-File', path.join(REPO, 'scripts', 'dev', 'Gate-Harnesses.ps1')]).toString();
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// pick: what scripts/dev/Run-Gate.ps1 runs on a pull request. The map is
// built from the traces here, by this checkout's own build, and the change
// is measured from the traced tree's listing, so nothing is fetched. The
// traced workflows' gate shape comes with the listing (the tree command).
// tracesFile is the trace task's traces, or a map already built from them
// (a .json, what main's build hands to runners off the box, #4009).
function pick(tracesFile, treeFile, commit, gate) {
  const map = /\.json$/.test(tracesFile) ? JSON.parse(fs.readFileSync(tracesFile, 'utf8')) : build(tracesFile, REPO, commit);
  if (map.commit !== commit) { throw new Error('the map is of ' + map.commit + ', not ' + commit); }
  const read = readTreeFile(require('zlib').gunzipSync(fs.readFileSync(treeFile)));
  const base = read.tree;
  const head = parseTree(git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']));
  const shape = { base: read.shape, head: shapeAt('HEAD') };
  const r = select({ map: map, gate: gate, base: map.commit, changes: changesBetween(base, head), baseFiles: [...base.keys()], headFiles: [...head.keys()], shape: shape });
  r.map = map;
  return r;
}

// ---- platforms: which harnesses Linux runs as fully as Windows (#5293) -----

/*
  The gate map's nightly run (gate-map.yml) runs the whole gate twice, on
  GitHub's Windows runner under the trace and on its Linux runner, each with
  Nightly-Harnesses.ps1 -StartLog. A harness may run on Linux in a pull
  request's checks only when, that night, it passed on both, every SKIP or
  NOT RUN line it said on Linux it said on Windows too, and it printed at
  least as many passing lines (PASS or ok) on Linux as on Windows: then Linux
  ran all of what Windows ran, and a check that quietly does less off
  Windows, printing no SKIP, still shows as fewer passes. Anything else stays on Windows, and says why: it failed on
  either, it was not in both runs, or it skipped on Linux something it ran on
  Windows (a Windows PowerShell 5.1 run, a compiler, a Windows API). A harness
  the map has no line for (a new one) runs on Windows.
*/
function readEnds(file) {
  const out = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) { continue; }
    let o;
    try { o = JSON.parse(line); } catch (e) { throw new Error(file + ' has a line that is not JSON: ' + line.slice(0, 80)); }
    if (o && typeof o.name === 'string' && Object.prototype.hasOwnProperty.call(o, 'code')) { out.set(o.name, o); }
  }
  return out;
}
function platforms(windowsStarts, linuxStarts, commit) {
  const win = readEnds(windowsStarts), lin = readEnds(linuxStarts);
  const harnesses = {};
  for (const name of [...new Set([...win.keys(), ...lin.keys()])].sort()) {
    const w = win.get(name), l = lin.get(name);
    let why = '';
    if (!w) { why = 'did not run on Windows that night'; }
    else if (!l) { why = 'did not run on Linux that night'; }
    else if (w.code !== 0) { why = 'did not pass on Windows that night (exit ' + w.code + ')'; }
    else if (l.code !== 0) { why = 'did not pass on Linux (exit ' + l.code + ')'; }
    else if (!Array.isArray(l.skips) || !Array.isArray(w.skips)) { why = 'its runs did not say which SKIP lines it printed'; }
    else if (typeof l.passes !== 'number' || typeof w.passes !== 'number') { why = 'its runs did not count their passing lines'; }
    else {
      const more = l.skips.filter(x => w.skips.indexOf(x) < 0);
      if (more.length) { why = 'says on Linux what it does not on Windows: ' + more[0]; }
      else if (l.passes < w.passes) { why = 'passed ' + l.passes + ' checks on Linux and ' + w.passes + ' on Windows'; }
    }
    harnesses[name] = why ? { linux: false, why: why } : { linux: true };
  }
  const all = Object.values(harnesses);
  return { format: 1, commit: commit || '', linux: all.filter(h => h.linux).length, windows: all.filter(h => !h.linux).length, harnesses: harnesses };
}

if (require.main === module) {
  const [cmd, a, b, c, d, e] = process.argv.slice(2);
  if (cmd === 'build' && a && b) {
    const map = build(a, REPO, c);
    fs.writeFileSync(b, JSON.stringify(map, null, 1) + '\n');
    const all = Object.values(map.harnesses);
    console.log(`wrote ${b}: ${all.length} harnesses, ${all.filter(h => !h.always).length} mapped, ${all.filter(h => h.always).length} always run`);
  } else if (cmd === 'platforms' && a && b && c) {
    const p = platforms(a, b, d);
    fs.writeFileSync(c, JSON.stringify(p, null, 1) + '\n');
    console.log(`wrote ${c}: ${p.linux} harnesses run on Linux as fully as on Windows, ${p.windows} stay on Windows`);
    for (const [n, h] of Object.entries(p.harnesses)) { if (!h.linux) { console.log('  Windows: ' + n + ': ' + h.why); } }
  } else if (cmd === 'select' && a && b) {
    const map = JSON.parse(fs.readFileSync(a, 'utf8'));
    const base = git(['rev-parse', map.commit]).toString().trim(), head = git(['rev-parse', b]).toString().trim();
    const gate = readGate(c);
    const r = select({ map: map, gate: gate, base: base, changes: diff(base, head), baseFiles: treeFiles(base), headFiles: treeFiles(head), shape: { base: shapeAt(base), head: shapeAt(head) } });
    if (r.full) { console.error('FULL ' + r.reasons.join('; ')); }
    for (const n of r.notes) { console.error(n); }
    console.error(`${r.run.length} of ${gate.length} gate harnesses to run`);
    for (const n of r.run) { console.log(n); }
  } else if (cmd === 'tree' && a && b) {
    const shape = shapeAt(a);
    const head = shape ? Buffer.from('#gate-shape ' + shape + '\0') : Buffer.alloc(0);
    fs.writeFileSync(b, require('zlib').gzipSync(Buffer.concat([head, git(['ls-tree', '-r', '-z', '--full-tree', a])])));
    console.log('the gate\'s shape in ' + a + '\'s build workflows: ' + (shape || 'none, so a pull request that changes them runs the whole gate'));
  } else if (cmd === 'pick' && a && b && c && d && e) {
    const gate = readGate(d);
    const r = pick(a, b, c, gate);
    fs.writeFileSync(e, r.run.map(n => n + '\n').join(''));
    for (const n of r.notes) { console.log(n); }
    if (r.full) { console.log('The whole gate runs: ' + r.reasons.join('; ')); } else {
      console.log(`${r.run.length} of ${gate.length} gate harnesses can be affected by this change, measured from the gate traced on ${c.slice(0, 8)}; ${r.skipped.length} cannot and do not run.`);
      for (const n of r.run) { console.log('  runs ' + n + ': ' + r.why[n]); }
    }
  } else {
    console.error('usage: Affected-Harnesses.js build <traces> <map.json> [commit] | select <map.json> <head> [gate.txt] | tree <rev> <tree.gz> | platforms <windows-starts.jsonl> <linux-starts.jsonl> <out.platforms.json> [commit] | pick <traces.jsonl.gz|map.json> <tree.gz> <commit> <gate.txt> <out.txt>');
    process.exit(2);
  }
}
module.exports = { platforms: platforms, build: build, readTraces: readTraces, select: select, parseTree: parseTree, readTreeFile: readTreeFile, changesBetween: changesBetween, pick: pick, gatePart: gatePart, gateShape: gateShape, WORKFLOWS: WORKFLOWS, FORCE: FORCE, PLATFORM: PLATFORM };
