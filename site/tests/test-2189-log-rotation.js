'use strict';
/*
  test-2189-log-rotation.js

  #2189: when site.log could not be rolled (a rotated file held open, a
  folder that lost delete rights) the failure was swallowed and every line
  was appended anyway, so the active log grew without limit, silently.

  Runs the real makeLog from site/server.js in a scratch folder, with a
  stand-in fs whose renames can be made to fail with EBUSY, as Windows does
  when another process holds the file without share-delete:
  A. the failure is said once (console and log), naming the file and error
  B. the roll is retried after retryMs, not on every line
  C. the active file stops at the emergency ceiling (2 x maxBytes), says so
     once, and later lines go to the console only
  D. once renames work again the next write rolls, says so once, and
     ordinary logging resumes under the cap
  E. the unchanged path: rolling that works never says anything

  The retry window runs on a pretend clock (#2346). makeLog reads the time
  through Date.now(), and it is handed a Date whose now() is a number this
  file moves by hand, so "inside the window" and "after it" are steps here,
  not sleeps. With real time, A to C had to finish inside the 300 ms window:
  on the hosted runner they did not, a roll was tried during C, and C4, D3
  and D5 saw three failed tries instead of two. Slowing each append by 40 ms
  here gave the same three failures.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const text = siteFiles.source();
const a = text.indexOf('function makeLog(dir, name, maxBytes, keep, opts) {');
const b = text.indexOf('// Four megabytes is a few days');
if (a < 0 || b < 0) { console.error('the site log block is not in server.js the way this expects'); process.exit(1); }

let pass = 0, fail = 0;
function yes(what, c) { if (c) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const gate = { busy: false, renames: 0 };
const stubFs = Object.assign({}, fs, {
  renameSync(from, to) {
    gate.renames++;
    if (gate.busy) { const e = new Error("EBUSY: resource busy or locked, rename '" + from + "'"); e.code = 'EBUSY'; throw e; }
    return fs.renameSync(from, to);
  },
});
const said = [];
const fakeProcess = { stdout: { write(s) { said.push(String(s)); } } };
// The pretend clock. new Date() with no argument still gives the real time,
// which is only used for the stamp at the start of each line.
let clock = Date.UTC(2026, 9, 12, 7, 0, 0);
class PretendDate extends Date {
  static now() { return clock; }
}
const makeLog = new Function('fs', 'path', 'process', 'Date', text.slice(a, b) + '\nreturn makeLog;')(stubFs, path, fakeProcess, PretendDate);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2189-'));
process.on('exit', () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { } });
const later = (ms) => { clock += ms; };
const size = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
const LINE = 'x'.repeat(40);

(async () => {
  const MAX = 1000; // room for the failure line, which names a long scratch path
  const log = makeLog(work, 'site.log', MAX, 3, { retryMs: 300 });
  const file = log.file;
  yes('the ceiling is twice the cap', log.ceiling === 2 * MAX);

  // E: ordinary rolling stays quiet.
  for (let i = 0; i < 60; i++) log.write(LINE);
  yes('E1 ordinary rolling makes .1 and keeps site.log under the cap plus a line', fs.existsSync(file + '.1') && size(file) < MAX + 80);
  yes('E2 and says nothing on the console', said.length === 0);

  // A: rolling starts failing.
  while (size(file) < MAX) log.write(LINE);
  gate.busy = true; gate.renames = 0;
  log.write(LINE);
  const r = log.rolling();
  yes('A1 the failed roll is counted, with its error code', r.failures === 1 && r.error === 'EBUSY');
  yes('A2 it is said on the console once, naming the file and the error',
      said.length === 1 && said[0].indexOf(file) >= 0 && /EBUSY/.test(said[0]) && /held open/.test(said[0]));
  const body = fs.readFileSync(file, 'utf8');
  yes('A3 and in the log itself', /ERROR could not roll .*EBUSY/.test(body));
  yes('A4 the line itself is still kept while under the ceiling', body.trim().endsWith(LINE));

  // B: no retry on every line.
  const before = gate.renames;
  for (let i = 0; i < 5; i++) log.write(LINE);
  yes('B1 five more lines inside the retry window try no renames', gate.renames === before);
  yes('B2 and say nothing more', said.length === 1);

  // C: the ceiling.
  for (let i = 0; i < 60; i++) log.write(LINE);
  const atCeiling = size(file);
  yes('C1 the active file stops near the ceiling (' + atCeiling + ' bytes, ceiling ' + log.ceiling + ')',
      atCeiling >= log.ceiling && atCeiling < log.ceiling + 400);
  yes('C2 the ceiling is said once', said.filter((s) => /emergency ceiling/.test(s)).length === 1 &&
      (fs.readFileSync(file, 'utf8').match(/emergency ceiling/g) || []).length === 1);
  yes('C3 a write past it returns false, and the log is not marked broken', log.write(LINE) === false && log.broken() === false);
  later(299);
  log.write(LINE);
  yes('C3b one millisecond inside the retry window, still no roll is tried', log.rolling().failures === 1);
  later(1);
  log.write(LINE);
  yes('C4 after the retry window one more roll is tried, still failing, still not said again',
      log.rolling().failures === 2 && said.filter((s) => /could not roll/.test(s)).length === 1);
  yes('C5 and the file has not grown', size(file) === atCeiling);

  // D: recovery.
  gate.busy = false;
  later(300);
  yes('D1 the next write after renames work is kept', log.write('after') === true);
  const st = log.rolling();
  yes('D2 the failures are cleared and the hold lifted', st.failures === 0 && st.held === false && st.error === null);
  yes('D3 recovery is said once, with the count', said.filter((s) => /rolled .* again after 2 failed tries/.test(s)).length === 1);
  yes('D4 the full file moved to .1 and site.log starts small', size(file + '.1') >= log.ceiling && size(file) < 200);
  yes('D5 site.log says it rolled again, then carries the line', /rolled again after 2 failed tries[\s\S]*after/.test(fs.readFileSync(file, 'utf8')));
  for (let i = 0; i < 60; i++) log.write(LINE);
  yes('D6 ordinary rolling carries on under the cap', size(file) < MAX + 80 && log.rolling().failures === 0);

  // A failure that never reaches the ceiling and then clears.
  const log2 = makeLog(work, 'two.log', MAX, 3, { retryMs: 0 });
  while (size(log2.file) < MAX) log2.write(LINE);
  gate.busy = true; log2.write(LINE); gate.busy = false; log2.write(LINE);
  yes('F1 a single failed try, then success, rolls and resets', log2.rolling().failures === 0 && fs.existsSync(log2.file + '.1'));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
