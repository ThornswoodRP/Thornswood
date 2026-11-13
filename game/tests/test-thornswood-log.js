// thornswood.log, the gamemode's own log, driven for real in a temp folder.
//
// Entry 220: "Nothing rotates, so last night's crash is at the end of a file
// that grows forever", and "the gamemode's own log also gives up permanently
// on the first failed write, which should raise something rather than
// silently disabling logging". So this checks two things: the file rolls at
// 4 MB keeping five, and a log that cannot be written says so once on the
// console AND in data\thornswood-log.json, which the resources server hands
// out over HTTP so it can be read from outside.
//
// The log block is lifted out of gamemode.js by text, from `let logFile` to
// the comment that opens the "Which gamemode.js this is" block, and evaluated
// fresh for every "load", the way a restart or a hot reload would. It stops
// there because that block (entry 254) writes a line of its own the moment it
// loads, outside anything here that counts what was said, so a log just under
// 4 MB would be pushed over before the test wrote to it, and the carrying-on
// message would be said before the test started listening. It reads
// server-settings.json and writes relative to the working directory, which on
// the VPS is the server's own folder, so the test changes into a temp folder
// first. Nothing outside that folder is touched.

const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(REPO_DIR, 'game', 'gamemode.js');
const text = fs.readFileSync(SRC, 'utf8');
const a = text.indexOf('let logFile = null;');
const idAt = text.indexOf('Which gamemode.js this is.');
const b = idAt < 0 ? -1 : text.lastIndexOf('/*', idAt);
if (a < 0 || b < 0 || b < a) {
  console.error('the log block is not in gamemode.js the way this expects');
  process.exit(1);
}
const block = text.slice(a, b);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-gamelog-'));
const home = process.cwd();
process.chdir(work);
process.on('exit', function () {
  try { process.chdir(home); } catch (e) { }
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { }
});

fs.writeFileSync('server-settings.json', JSON.stringify({ dataDir: 'data' }));
fs.mkdirSync('data');

// The engine's whole-file write (#2740), as far as the log can tell; the
// block below is evaluated in this scope and writes its state through it.
// eslint-disable-next-line no-unused-vars
const mp = { writeFileWhole: function (p, text) { fs.writeFileSync(p, text); } };

// A fresh evaluation of the block, which is what a start or a hot reload is.
// cap, when given, is put in place of the 4 MB so rolling within one load can
// be seen after a few lines instead of four megabytes of them.
function load(cap) {
  let src = block;
  if (cap) {
    const was = src;
    src = src.replace(/const LOG_MAX_BYTES = [^;]+;/, 'const LOG_MAX_BYTES = ' + cap + ';');
    if (src === was) { return null; }
  }
  // eslint-disable-next-line no-eval
  return eval(src + '\n;({ log: log })');
}

// What went to the console, so "said once" can be counted.
function quietly(fn) {
  const said = [];
  const was = console.log;
  console.log = function () { said.push(Array.prototype.slice.call(arguments).join(' ')); };
  try { fn(); } finally { console.log = was; }
  return said;
}

const LOG = path.join(work, 'thornswood.log');
const STATE = path.join(work, 'data', 'thornswood-log.json');
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function state() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return null; } }
function clear() {
  for (const f of fs.readdirSync(work)) {
    if (/^thornswood\.log/.test(f)) { fs.rmSync(path.join(work, f), { recursive: true, force: true }); }
  }
  try { fs.unlinkSync(STATE); } catch (e) { }
}

// ---- an ordinary line ------------------------------------------------------
let g = load();
yes('the block evaluates', !!g);
const said = quietly(function () { g.log('a person came in'); });
yes('the line goes to the console as before', said.length === 1 && said[0].indexOf('[thornswood] a person came in') === 0);
yes('and lands in thornswood.log', (read(LOG) || '').indexOf('[thornswood] a person came in') >= 0);
let st = state();
yes('thornswood-log.json says the log works', !!st && st.ok === true);
yes('with a time on it', !!st && typeof st.at === 'number' && st.at > 0);
yes('and says nothing about anybody', !!st && JSON.stringify(st).indexOf('person') < 0);

// ---- rolled at 4 MB on the next start --------------------------------------
clear();
const FOUR = 4 * 1024 * 1024;
fs.writeFileSync(LOG, Buffer.alloc(FOUR + 10, 0x78));
g = load();
quietly(function () { g.log('after the restart'); });
yes('a log past 4 MB is rolled to .1 on the next line', fs.existsSync(LOG + '.1') && fs.statSync(LOG + '.1').size === FOUR + 10);
yes('and the live file holds only the new line', (read(LOG) || '').indexOf('after the restart') >= 0 && fs.statSync(LOG).size < 200);

clear();
fs.writeFileSync(LOG, Buffer.alloc(FOUR - 10, 0x78));
g = load();
quietly(function () { g.log('still small'); });
yes('a log just under 4 MB is left alone', !fs.existsSync(LOG + '.1') && fs.statSync(LOG).size > FOUR - 10);

// ---- five kept, the oldest goes, nothing overwritten -----------------------
clear();
['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].forEach(function (w, i) { fs.writeFileSync(LOG + '.' + (i + 1), w); });
fs.writeFileSync(LOG, Buffer.alloc(FOUR, 0x78));
g = load();
quietly(function () { g.log('the sixth'); });
yes('the live file becomes .1', fs.existsSync(LOG + '.1') && fs.statSync(LOG + '.1').size === FOUR);
yes('what was .1 becomes .2', read(LOG + '.2') === 'ONE');
yes('what was .4 becomes .5', read(LOG + '.5') === 'FOUR');
yes('what was .5 is the one that goes', !fs.existsSync(LOG + '.6') && [2, 3, 4, 5].every(function (i) { return read(LOG + '.' + i) !== 'FIVE'; }));

// ---- counted within one load, not only at start ----------------------------
clear();
g = load(300);
yes('the cap can be set for the test', !!g);
if (g) {
  quietly(function () {
    for (let i = 0; i < 40; i++) { g.log('a line of some length to push it over the cap ' + i); }
  });
  yes('a running server rolls without a restart', fs.existsSync(LOG + '.1') && fs.existsSync(LOG + '.5'));
  yes('never more than five kept', !fs.existsSync(LOG + '.6'));
  yes('the live file stays near the cap', fs.statSync(LOG).size < 300 + 200);
  yes('and the newest line is in it', (read(LOG) || '').indexOf('over the cap 39') >= 0);
}

// ---- a roll that is refused does not break the log -------------------------
// The oldest is a folder with something in it, so it cannot be removed and
// the roll fails, the way it would if a reader held the file.
clear();
fs.mkdirSync(LOG + '.5');
fs.writeFileSync(path.join(LOG + '.5', 'x'), 'x');
fs.writeFileSync(LOG, Buffer.alloc(FOUR, 0x78));
g = load();
const refused = quietly(function () { g.log('first after a refused roll'); g.log('second after a refused roll'); });
yes('the line still lands when the roll is refused', (read(LOG) || '').indexOf('second after a refused roll') >= 0);
yes('and nothing says the log broke', refused.every(function (l) { return l.indexOf('could not write') < 0; }));
yes('and the state still says it works', !!state() && state().ok === true);

// ---- a log it cannot write -------------------------------------------------
// thornswood.log is a folder, so the append fails.
clear();
fs.mkdirSync(LOG);
g = load();
const broke = quietly(function () {
  g.log('first line into nothing');
  g.log('second line into nothing');
  g.log('third line into nothing');
});
const carrying = broke.filter(function (l) { return l.indexOf('could not write thornswood.log, carrying on') >= 0; });
yes('every line still reaches the console', broke.filter(function (l) { return l.indexOf('line into nothing') >= 0; }).length === 3);
yes('the carrying-on message is said once', carrying.length === 1);
st = state();
yes('thornswood-log.json says the log has stopped', !!st && st.ok === false);
yes('and why', !!st && typeof st.why === 'string' && st.why.length > 0);

// ---- a restart that fixes it says so ---------------------------------------
clear();
g = load();
quietly(function () { g.log('working again'); });
yes('the next start that can write puts ok back', !!state() && state().ok === true);

// ---- the line that names the gamemode.js, through the same log ------------
// Evaluated with the id block this time, which is how the server loads it:
// its line is the first of every load, so it is what rolls a log left over
// 4 MB and what writes thornswood-log.json, before any person does anything.
clear();
fs.writeFileSync(LOG, Buffer.alloc(FOUR + 10, 0x78));
const c = text.indexOf('let voicePortCached');
yes('the id block is between the log block and the voice port', c > b);
const withId = c > b ? text.slice(a, c) : '';
const atLoad = quietly(function () {
  // eslint-disable-next-line no-eval
  eval(withId);
});
yes('the id line is said at load', atLoad.some(function (l) { return l.indexOf('gamemode.js is git blob') >= 0; }));
yes('and it is what rolls a log left over 4 MB', fs.existsSync(LOG + '.1') && fs.statSync(LOG + '.1').size === FOUR + 10);
yes('and it lands in the fresh thornswood.log', (read(LOG) || '').indexOf('gamemode.js is git blob') >= 0);
yes('and thornswood-log.json says ok from the load on', !!state() && state().ok === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
