// test-online-names.js
//
// The gamemode says who is on, by name, and only where the deploy can read it.
//
// WHY. Issue #520. Deploy-DevGamemode and Deploy-Server read online.json before
// they stop a server, and warn the room in game. online.json carries a count, so
// the person running the deploy learnt "2 on" and not whose evening it was about
// to interrupt. The gamemode now keeps the names in online-names.json in the
// private folder. Not beside online.json: that folder is served over HTTP to
// anybody who asks, and who is on right now is nobody else's business.
//
// This cuts the online writer out of gamemode.js and runs it against a
// stand-in mp and a temp folder, turning the interval by hand.
//
// Read only, apart from its own temp folder.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GAMEMODE ||
            path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// From the online banner through the try that closes after its log line.
const START = '  // ------------------------------------------------------------- online ---';
const END = "console.log('[thornswood] online count published at ' + onlineFile);\n  } catch (e) { }\n";
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;
yes('gamemode.js still has its online writer', block !== null);
if (!block) done();

const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-online-names-'));
const dataDir = path.join(box, 'data');
const privDir = path.join(box, 'private');
fs.mkdirSync(dataDir);
fs.mkdirSync(privDir);
fs.writeFileSync(path.join(box, 'server-settings.json'),
  JSON.stringify({ port: 7787, dataDir: dataDir, privDir: privDir }));

// Who is on, as the stand-in mp answers it. Each actor has an appearance with
// a name, or not.
let room = {};
const mp = {
  // The engine's whole-file write (#2740), as far as the gamemode can tell.
  writeFileWhole: function (p, text) { fs.writeFileSync(p, text); },
  get: function (id, what) {
    if (id === 0 && what === 'onlinePlayers') return Object.keys(room).map(Number);
    const who = room[id];
    if (!who) return undefined;
    if (what === 'appearance') return who.name === undefined ? null : { name: who.name };
    if (what === 'profileId') return who.profileId;
    return undefined;
  }
};

let tick = null;
const sandbox = {
  mp: mp,
  require: require,
  console: { log: function () { } },
  setInterval: function (fn) { tick = fn; return 1; },
  clearInterval: function () { },
  Date: Date,
  JSON: JSON,
  String: String
};
sandbox.globalThis = sandbox;

const was = process.cwd();
process.chdir(box);
try {
  vm.runInNewContext(block, sandbox, { filename: 'gamemode.js online block' });
} finally {
  process.chdir(was);
}
yes('the block starts its writer', typeof tick === 'function');
if (typeof tick !== 'function') done();

const namesFile = path.join(privDir, 'online-names.json');
function names() {
  try { return JSON.parse(fs.readFileSync(namesFile, 'utf8')).names; } catch (e) { return null; }
}
function count() {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'online.json'), 'utf8')).now; } catch (e) { return null; }
}

tick();
yes('nobody on writes an empty list, so a fresh server does not keep old names',
    Array.isArray(names()) && names().length === 0);

room = { 1: { name: 'Camilla', profileId: 11 }, 2: { name: 'Ahlam', profileId: 12 } };
tick();
yes('two on: both names, sorted (got ' + JSON.stringify(names()) + ')',
    JSON.stringify(names()) === '["Ahlam","Camilla"]');
yes('and the count still goes to online.json', count() === 2);

const served = fs.readdirSync(dataDir);
yes('nothing but online.json lands in the served folder (got ' + served.join(', ') + ')',
    served.length === 1 && served[0] === 'online.json');
const pub = fs.readFileSync(path.join(dataDir, 'online.json'), 'utf8');
yes('and online.json carries no name', pub.indexOf('Ahlam') < 0 && pub.indexOf('Camilla') < 0);

// One leaves and another arrives between two passes: the count does not move,
// the names do.
room = { 1: { name: 'Camilla', profileId: 11 }, 3: { name: 'Brynjolf', profileId: 13 } };
tick();
yes('a swap with the count unchanged still rewrites the names (got ' + JSON.stringify(names()) + ')',
    JSON.stringify(names()) === '["Brynjolf","Camilla"]');

room = { 1: { name: 'Camilla', profileId: 11 }, 4: { profileId: 14 } };
tick();
yes('somebody still in the creation screen, with no name yet, is named by profile',
    JSON.stringify(names()) === '["Camilla","profile 14"]');

room = {};
tick();
yes('and everybody gone is an empty list again', Array.isArray(names()) && names().length === 0);

try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) { }
done();
