#!/usr/bin/env node
// scripts/dev/Trace-HarnessReads.js
//
// Issue #3114, prototype. Runs gate harnesses on Linux under strace and
// writes, for each one, every path inside the checkout it opened, looked
// at, failed to find, listed, wrote or ran. That is its read map: a pull
// request that changes none of those paths leaves every system call the
// harness makes returning what it returned here, so the harness takes the
// same path and ends the same way (scripts/dev/Affected-Harnesses.js).
//
//     node scripts/dev/Trace-HarnessReads.js --out <dir> [--jobs 4] [names...]
//
// With no names it traces the whole gate (scripts/dev/Gate-Harnesses.ps1).
// Each harness runs in a fresh copy of a clean checkout of HEAD, so what one
// writes is never what another reads, with GITHUB_ACTIONS and CI set the way
// the build sets them and TEMP of its own. Linux only: it needs strace.
//
// Writes <out>/<harness>.json, one per harness. Read only on the repository.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const REPO = path.join(__dirname, '..', '..');

// ---- strace output to paths ------------------------------------------------

// Splits a syscall's argument text at its top level commas.
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += s[++i] || ''; continue; }
      if (c === '"') { inStr = false; }
      continue;
    }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '[' || c === '{' || c === '(') { depth++; }
    if (c === ']' || c === '}' || c === ')') { depth--; }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) { out.push(cur.trim()); }
  return out;
}

// strace's C string escapes back to the bytes, as a JS string.
function unquote(q) {
  let s = q.slice(1, q.endsWith('"...') ? -4 : -1);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = s[++i];
    if (n === 'x') { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; continue; }
    if (/[0-7]/.test(n)) {
      let j = i, o = '';
      while (j < s.length && o.length < 3 && /[0-7]/.test(s[j])) { o += s[j++]; }
      bytes.push(parseInt(o, 8)); i = j - 1; continue;
    }
    const map = { n: 10, t: 9, r: 13, v: 11, f: 12, '"': 34, '\\': 92 };
    bytes.push(map[n] !== undefined ? map[n] : n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

const FD = /^(-?\d+|AT_FDCWD)(?:<(.*)>)?$/;

// One traced run's lines to what it touched under root.
function makeParser(root, extraRoots) {
  const cwdOf = new Map(); // pid -> {path}
  const pending = new Map(); // pid -> text before <unfinished ...>
  const touched = new Map(); // rel -> Set of kinds
  const execs = [];
  const blind = [];
  let first = null;
  function rel(abs) {
    const n = path.posix.normalize(abs);
    if (n === root) { return '.'; }
    if (n.startsWith(root + '/')) { return n.slice(root.length + 1); }
    for (const [from, to] of extraRoots) {
      if (n === from || n.startsWith(from + '/')) { return to + n.slice(from.length); }
    }
    return null;
  }
  function note(abs, kind) {
    const r = rel(abs);
    if (r === null) { return; }
    if (!touched.has(r)) { touched.set(r, new Set()); }
    touched.get(r).add(kind);
  }
  function cwd(pid) {
    if (!cwdOf.has(pid)) { cwdOf.set(pid, { path: root }); }
    return cwdOf.get(pid);
  }
  // A path written the Windows way, wherever it was looked for: on the box
  // it can name something real, and the run can go another way there.
  const windowsPaths = new Set();
  function resolve(pid, base, p) {
    if (/^[A-Za-z]:[\\/]|\\/.test(p)) { windowsPaths.add(p); }
    if (p.startsWith('/')) { return p; }
    let b = cwd(pid).path;
    if (base) {
      const m = FD.exec(base);
      if (m && m[1] !== 'AT_FDCWD' && m[2]) { b = m[2]; }
    }
    return path.posix.join(b, p);
  }
  const WRITE_CALLS = /^(unlink|unlinkat|rmdir|mkdir|mkdirat|rename|renameat|renameat2|link|linkat|truncate|chmod|fchmodat|chown|lchown|fchownat|utime|utimes|utimensat|futimesat|mknod|mknodat)$/;
  const NO_PATH = /^(exit|exit_group|wait4|waitid|kill|tgkill)$/;
  // A new process's first calls can come in the trace before its parent's
  // clone returns, and so before anything says which folder it started in.
  // Its lines wait until its parent's clone names it, or the trace ends.
  const known = new Set();
  const waiting = new Map(); // pid -> raw lines
  function line(raw) {
    const m = /^(\d+)\s+(.*)$/.exec(raw);
    if (!m) { return; }
    const pid = m[1];
    if (first === null) { first = pid; known.add(pid); }
    if (!known.has(pid)) {
      if (!waiting.has(pid)) { waiting.set(pid, []); }
      waiting.get(pid).push(raw);
      return;
    }
    handle(pid, m[2]);
  }
  function release(pid) {
    known.add(pid);
    const lines = waiting.get(pid) || [];
    waiting.delete(pid);
    for (const raw of lines) { line(raw); }
  }
  // At the end, a process no clone named (strace lost the line) starts in
  // the checkout, as the first one did.
  function end() { for (const pid of [...waiting.keys()]) { release(pid); } }
  function handle(pid, body) {
    let m;
    if (body.endsWith('<unfinished ...>')) { pending.set(pid, body.slice(0, -'<unfinished ...>'.length)); return; }
    const res = /^<\.\.\. (\w+) resumed>(.*)$/.exec(body);
    if (res) { body = (pending.get(pid) || (res[1] + '(')) + res[2]; pending.delete(pid); }
    m = /^(\w+)\((.*)\)\s+=\s+(.*)$/.exec(body);
    if (!m) { return; }
    const call = m[1], args = splitArgs(m[2]), ret = m[3];
    if (NO_PATH.test(call)) { return; }
    // An io_uring does file work with no system call strace can see. Every
    // io_uring_setup is refused (-e inject below), so node's libuv and
    // anything else fall back to plain calls; one that got a ring anyway
    // leaves a map that cannot be trusted.
    const ok = !/^-1 /.test(ret) && !/^\? /.test(ret);
    if (call === 'io_uring_setup') { if (ok) { blind.push(pid); } return; }
    if (call === 'clone' || call === 'clone3' || call === 'fork' || call === 'vfork') {
      const child = parseInt(ret, 10);
      if (child > 0) {
        const sharesFs = /CLONE_FS/.test(m[2]);
        cwdOf.set(String(child), sharesFs ? cwd(pid) : { path: cwd(pid).path });
        release(String(child));
      }
      return;
    }
    if (call === 'getdents64' || call === 'getdents') {
      const f = FD.exec(args[0] || '');
      if (f && f[2]) { note(f[2], 'list'); }
      return;
    }
    if (call === 'fchdir') {
      const f = FD.exec(args[0] || '');
      if (ok && f && f[2]) { cwd(pid).path = f[2]; note(f[2], 'stat'); }
      return;
    }
    if (call === 'execve' || call === 'execveat') {
      const i = args.findIndex(a => a.startsWith('"'));
      if (i < 0) { return; }
      const p = resolve(pid, i > 0 ? args[i - 1] : '', unquote(args[i]));
      let argv = [];
      const a = args[i + 1] || '';
      if (a.startsWith('[')) { argv = splitArgs(a.slice(1, -1)).filter(x => x.startsWith('"')).map(unquote); }
      if (ok) { execs.push({ exe: p, argv: argv }); }
      note(p, ok ? 'exec' : 'missing');
      return;
    }
    let kind = ok ? 'stat' : 'missing';
    if (ok && WRITE_CALLS.test(call)) { kind = 'write'; }
    if (ok && /^(open|openat|openat2|inotify_add_watch|readlink|readlinkat)$/.test(call)) { kind = 'read'; }
    if (ok && (call === 'open' || call === 'openat' || call === 'creat' || call === 'openat2')) {
      const flags = args.find(a => /O_(RDONLY|WRONLY|RDWR)/.test(a)) || '';
      if (call === 'creat' || /O_WRONLY/.test(flags)) { kind = 'write'; }
    }
    if (call === 'symlink' || call === 'symlinkat') {
      // the first string is the target, which is not looked at
      const strs = args.map((a, i) => [a, i]).filter(x => x[0].startsWith('"'));
      if (strs.length > 1) { const [a, i] = strs[1]; note(resolve(pid, args[i - 1], unquote(a)), 'write'); }
      return;
    }
    // Only the path arguments: the first string, and the second for the
    // calls that name two paths. readlink's second string is what it read.
    let strings = 0;
    const want = /^(rename|renameat|renameat2|link|linkat)$/.test(call) ? 2 : 1;
    if (call === 'getcwd') { return; }
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith('"')) { continue; }
      if (++strings > want) { break; }
      const p = resolve(pid, i > 0 ? args[i - 1] : '', unquote(args[i]));
      if (call === 'chdir') {
        if (ok) { cwd(pid).path = path.posix.normalize(p); }
        note(p, ok ? 'stat' : 'missing');
        continue;
      }
      note(p, kind);
    }
  }
  return { line: line, end: end, touched: touched, execs: execs, blind: blind, windowsPaths: windowsPaths };
}

// ---- running one harness ---------------------------------------------------

// The file a gate name stands for, from the checkout's top: a name with a
// slash is a product's harness beside its code, by its path
// (launcher/tests/test-498-msbuild.ps1); one without is in tests\. The same
// rule as scripts/dev/Harness-Files.ps1 (plan line 42).
function harnessFile(name) {
  return name.indexOf('/') >= 0 ? path.join.apply(path, name.split('/')) : path.join('tests', name);
}

function runOne(name, pristine, work, outDir, clockSeconds) {
  return new Promise((done) => {
    const dir = path.join(work, 'run-' + name.replace(/[^\w.-]/g, '_'));
    const tmp = dir + '.tmp';
    cp.execFileSync('rm', ['-rf', dir, tmp]);
    cp.execFileSync('cp', ['-a', pristine, dir]);
    fs.mkdirSync(tmp, { recursive: true });
    const traceFile = dir + '.strace';
    const file = harnessFile(name);
    const cmd = name.endsWith('.js') ? ['node', file] : ['pwsh', '-NoProfile', '-File', file];
    const env = Object.assign({}, process.env, {
      GITHUB_ACTIONS: 'true', CI: 'true', UV_USE_IO_URING: '0', RUNNER_TEMP: tmp, TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    });
    const t0 = Date.now();
    const args = ['-f', '--seccomp-bpf', '-qq', '-y', '-s', '65535', '-e', 'abbrev=!execve',
      '-e', 'trace=%file,%process,getdents64,getdents,fchdir,io_uring_setup',
      '-e', 'inject=io_uring_setup:error=ENOSYS', '-o', traceFile, '--'].concat(cmd);
    const child = cp.spawn('timeout', ['-k', '10', String(clockSeconds), 'strace'].concat(args),
      { cwd: dir, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('close', (code) => {
      const seconds = (Date.now() - t0) / 1000;
      const parser = makeParser(dir, [[tmp, '<temp>']]);
      const rl = readline.createInterface({ input: fs.createReadStream(traceFile), crlfDelay: Infinity });
      rl.on('line', parser.line);
      rl.on('close', () => {
        parser.end();
        const paths = {};
        for (const [r, kinds] of [...parser.touched.entries()].sort()) {
          if (r.startsWith('<temp>')) { continue; }
          paths[r] = [...kinds].sort().join(',');
        }
        const execs = parser.execs.filter(e => !/\/(strace|timeout)$/.test(e.exe))
          .map(e => [path.basename(e.exe)].concat(e.argv.slice(1)).join(' '));
        const out = {
          harness: name,
          exit: code,
          seconds: Math.round(seconds * 10) / 10,
          skipped: /^\s*(SKIP|NOT RUN)\b/m.test(output),
          blind: parser.blind.length > 0,
          windowsPaths: [...parser.windowsPaths].sort().slice(0, 20),
          execs: [...new Set(execs)].sort(),
          paths: paths,
          tail: output.split('\n').slice(-6).join('\n'),
        };
        // A product harness's name has slashes in it; its file here does not.
        fs.writeFileSync(path.join(outDir, name.split('/').join('%2F') + '.json'), JSON.stringify(out, null, 1));
        cp.execFileSync('rm', ['-rf', dir, tmp, traceFile]);
        done(out);
      });
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let outDir = '', jobs = Math.max(1, os.cpus().length), clock = 600;
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { outDir = argv[++i]; } else if (argv[i] === '--jobs') { jobs = parseInt(argv[++i], 10); } else if (argv[i] === '--clock') { clock = parseInt(argv[++i], 10); } else { names.push(argv[i]); }
  }
  if (!outDir) { console.error('usage: Trace-HarnessReads.js --out <dir> [--jobs N] [names...]'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const pristine = path.join(work, 'pristine');
  cp.execFileSync('git', ['clone', '-q', '--no-local', '--no-checkout', REPO, pristine]);
  const head = cp.execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD']).toString().trim();
  cp.execFileSync('git', ['-C', pristine, 'checkout', '-q', '--detach', head]);
  let list = names;
  if (!list.length) {
    // The gate of the commit being traced, not of the working tree.
    list = cp.execFileSync('pwsh', ['-NoProfile', '-File', path.join(pristine, 'scripts', 'dev', 'Gate-Harnesses.ps1'), '-Root', pristine])
      .toString().split('\n').map(s => s.trim()).filter(Boolean);
  }
  // A harness that says RUNS ALONE runs after the rest, alone, as in the gate.
  const alone = list.filter(n => /RUNS ALONE/.test(fs.readFileSync(path.join(pristine, harnessFile(n)), 'utf8')));
  const rest = list.filter(n => alone.indexOf(n) < 0);
  fs.writeFileSync(path.join(outDir, '_commit.txt'), head + '\n');
  let doneCount = 0;
  async function pool(items, n) {
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const name = items[next++];
        const r = await runOne(name, pristine, work, outDir, clock);
        doneCount++;
        console.log(`${doneCount}/${list.length} ${r.exit === 0 ? 'ok  ' : 'FAIL'} ${r.seconds}s ${name} (${Object.keys(r.paths).length} paths)`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  }
  await pool(rest, jobs);
  await pool(alone, 1);
  cp.execFileSync('rm', ['-rf', work]);
}

if (require.main === module) { main().catch(e => { console.error(e); process.exit(1); }); }
module.exports = { makeParser: makeParser, splitArgs: splitArgs, unquote: unquote };
