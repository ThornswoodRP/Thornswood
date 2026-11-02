'use strict';
// The calling thread's CPU time to the cycle, for the NPC native acceptance
// run (issue #2032). Windows only, like the engine addon that run loads.
//
// Why not process.threadCpuUsage: it reads GetThreadTimes, which Windows
// charges by the clock interrupt, 15.6 ms at a time. Measured on One on
// 12 Oct: a 60 ms busy loop read 47 ms and a 70 ms one 78 ms, so the run
// could only say a callback that read 47 ms had used 31 to 63.
// thread-clock.c reads QueryThreadCycleTime instead, which counts the cycles
// the thread ran; the same loops read 58.5 and 69.7 ms.
//
// load() compiles thread-clock.c the first time, into out\tests under a name
// that carries the source's hash, with the Visual Studio C compiler the
// engine build already needs, then measures the rate the cycles are counted
// at and refuses a clock that does not keep to it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const REPO_DIR = path.join(__dirname, '..');

function compiler() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;
  const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {encoding: 'utf8'});
  const install = (found.stdout || '').trim().split(/\r?\n/)[0];
  const vcvars = install && path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return vcvars && fs.existsSync(vcvars) ? vcvars : null;
}

function build() {
  const source = path.join(__dirname, 'thread-clock.c');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 12);
  const dir = path.join(REPO_DIR, 'out', 'tests');
  const name = 'thread-clock-' + hash + '.node', target = path.join(dir, name);
  if (fs.existsSync(target)) return target;
  const vcvars = compiler();
  if (!vcvars) throw new Error('thread-clock.js needs the Visual Studio C compiler (the "Desktop development with C++" ' +
    'workload or the Build Tools with the C++ tools), the same one the engine build uses; docs/guide/set-up-a-machine.md ' +
    '"Setting up a machine" has the install.');
  fs.mkdirSync(dir, {recursive: true});
  // cmd /s keeps every quote inside the outer pair, so a path with & in it
  // (the worktree folder on One) is one argument.
  const line = '"call "' + vcvars + '" >nul 2>nul && cl /nologo /O2 /LD "' + source + '" /Fe:' + name +
    ' /link kernel32.lib"';
  const out = spawnSync('cmd.exe', ['/d', '/s', '/c', line], {cwd: dir, encoding: 'utf8', windowsVerbatimArguments: true});
  for (const extra of ['thread-clock.obj', name.replace(/\.node$/, '.lib'), name.replace(/\.node$/, '.exp')])
    fs.rmSync(path.join(dir, extra), {force: true});
  if (out.status !== 0 || !fs.existsSync(target))
    throw new Error('thread-clock.c did not compile (exit ' + out.status + '):\n' + (out.stdout || '') + (out.stderr || ''));
  return target;
}

function load() {
  if (process.platform !== 'win32') throw new Error('thread-clock.js reads QueryThreadCycleTime, which is Windows only');
  const clock = require(build());
  // The rate of the time stamp counter, against the performance counter.
  const qpf = clock.qpf();
  const spin = ms => { const until = performance.now() + ms; while (performance.now() < until); };
  const t0 = clock.tsc(), q0 = clock.qpc();
  spin(200);
  const hz = (clock.tsc() - t0) / ((clock.qpc() - q0) / qpf);
  // The thread's cycles must come at that rate: in a busy loop never faster,
  // and, in the best of five tries, nearly all of it (time taken by other
  // programs is the only thing that makes a try slower).
  let most = 0;
  for (let i = 0; i < 5; i++) {
    const c = clock.cycles(), t = clock.tsc();
    spin(30);
    most = Math.max(most, (clock.cycles() - c) / (clock.tsc() - t));
  }
  if (!(hz > 1e8) || most > 1.02 || most < 0.9)
    throw new Error('QueryThreadCycleTime does not count at the time stamp counter\'s rate here (counter ' +
      (hz / 1e9).toFixed(3) + ' GHz, best busy-loop ratio ' + most.toFixed(3) + '), so it cannot be read as time');
  return {ms: () => clock.cycles() / hz * 1000, counterGHz: hz / 1e9};
}

module.exports = {load};
