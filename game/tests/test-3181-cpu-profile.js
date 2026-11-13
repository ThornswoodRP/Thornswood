'use strict';
/*
  test-3181-cpu-profile.js

      node game/tests/test-3181-cpu-profile.js

  Issue #3181. Each game server used about a ninth of a core all day with
  nobody on and nothing said where it went. The gamemode's CPU PROFILE ON
  REQUEST block samples its own process when profile.json appears in the
  data folder (scripts\vps\Profile-GameServer.ps1 drops it). This runs that
  block for real, in this process, against a scratch folder, and fails on:
    1. the request not being picked up, or not deleted before it is acted on;
    2. no profile and no summary written in profiles\, or a summary that does
       not say how busy the thread was, by file and by function;
    3. busy work during the sampling not showing in the summary under its
       own name;
    4. a second run growing the folder instead of replacing the files;
    5. a request it cannot read firing anything, or not being said;
    6. a hot reload adding a second timer instead of replacing the first;
    7. an inspector port left open: the block must never call
       inspector.open.
  About 15 seconds, most of it the five second check and two one second
  samples.
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const begin = source.indexOf('// CPU PROFILE ON REQUEST BEGIN');
const end = source.indexOf('// CPU PROFILE ON REQUEST END');
let passed = 0, failed = 0;
function yes(what, ok) { if (ok) { passed++; console.log('PASS  ' + what); } else { failed++; console.log('FAIL  ' + what); } }
yes('gamemode.js has the CPU PROFILE ON REQUEST block', begin >= 0 && end > begin);
if (failed) { console.log(JSON.stringify({ passed, failed })); process.exit(1); }
const block = source.slice(begin, end);
yes('it never opens an inspector port', !/inspector\.open|_debugProcess|--inspect/.test(block));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3181-'));
const data = path.join(scratch, 'world');
fs.mkdirSync(data);
fs.writeFileSync(path.join(scratch, 'server-settings.json'), JSON.stringify({ dataDir: data }));
const said = [];
const log = (...a) => said.push(a.map(String).join(' '));
const timers = [];
const sandbox = {
  require, log, console, JSON, Math, Date, Object, Number, String,
  setTimeout, clearTimeout,
  setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t; },
  clearInterval: t => { clearInterval(t); timers.splice(timers.indexOf(t), 1); }
};
sandbox.globalThis = sandbox;
const cwd = process.cwd();
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(what, ok, ms) {
  const at = Date.now();
  while (Date.now() - at < ms) { if (ok()) return true; await wait(100); }
  return false;
}
// Work the profiler should see by name.
function thornswoodBusyWork(ms) { const until = Date.now() + ms; let x = 0; while (Date.now() < until) x += Math.sqrt(x + 1); return x; }

(async () => {
  try {
    process.chdir(scratch);
    vm.createContext(sandbox);
    vm.runInContext(block, sandbox, { filename: 'gamemode.js' });
    yes('one timer is set', timers.length === 1);
    vm.runInContext(block, sandbox, { filename: 'gamemode.js' });
    process.chdir(cwd);
    yes('a hot reload replaces it, not adds another', timers.length === 1);

    const req = path.join(data, 'profile.json'), out = path.join(data, 'profiles');
    fs.writeFileSync(req, JSON.stringify({ seconds: 1 }));
    const took = await until('picked up', () => !fs.existsSync(req), 7000);
    yes('the request is picked up and deleted', took);
    const busy = setInterval(() => thornswoodBusyWork(40), 50);
    const wrote = await until('written', () => fs.existsSync(path.join(out, 'newest.txt')), 5000);
    clearInterval(busy);
    yes('it writes newest.txt and newest.cpuprofile in profiles', wrote && fs.existsSync(path.join(out, 'newest.cpuprofile')));
    if (wrote) {
      const text = fs.readFileSync(path.join(out, 'newest.txt'), 'utf8');
      const profile = JSON.parse(fs.readFileSync(path.join(out, 'newest.cpuprofile'), 'utf8'));
      yes('  the profile is a profile: nodes, samples, time deltas', Array.isArray(profile.nodes) && profile.samples.length > 100 && profile.timeDeltas.length === profile.samples.length);
      yes('  the summary says how much of a core the thread was busy', /busy \d+\.\d+ s, \d\.\d{3} of a core on the JavaScript thread/.test(text));
      yes('  and lists by file and by function', /\r\nby file:\r\n/.test(text) && /\r\nby function:\r\n/.test(text));
      yes('  the busy work shows under its own name', /thornswoodBusyWork  test-3181-cpu-profile\.js:\d+/.test(text));
      yes('  idle is named, not counted as busy', /%\s+\d+ ms\s+\(idle\)|\(program\)/.test(text));
      yes('  its start and end are said in the log', said.some(l => /cpu profile: sampling for 1 s/.test(l)) && said.some(l => /cpu profile: written to/.test(l)));
    }

    fs.writeFileSync(req, JSON.stringify({ seconds: 1 }));
    await until('picked up', () => !fs.existsSync(req), 7000);
    const before = said.filter(l => /written to/.test(l)).length;
    await until('written again', () => said.filter(l => /written to/.test(l)).length > before, 5000);
    yes('a second run replaces the files, it does not add more', fs.readdirSync(out).sort().join(',') === 'newest.cpuprofile,newest.txt');

    fs.writeFileSync(req, '{not json');
    const n = said.filter(l => /sampling for/.test(l)).length;
    await until('picked up', () => !fs.existsSync(req), 7000);
    await wait(300);
    yes('a request it cannot read is deleted and said, and fires nothing',
      !fs.existsSync(req) && said.some(l => /cpu profile request was not readable/.test(l)) && said.filter(l => /sampling for/.test(l)).length === n);
  } catch (e) {
    failed++; console.log('FAIL  it threw: ' + (e && e.stack || e));
  } finally {
    process.chdir(cwd);
    for (const t of timers.slice()) clearInterval(t);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (failed) console.log('the block said: ' + said.join(' | '));
  console.log(JSON.stringify({ passed, failed }));
  process.exitCode = failed ? 1 : 0;
})();
