// test-2740-whole-writes.js
//
// The gamemode writes every file another program reads while the server runs
// whole, through the engine's mp.writeFileWhole, and never in place.
//
// WHY. Issue #2740. The gamemode wrote online.json (and the names file, the
// served bases and manifest, its log state, and the private roster, door list,
// take limit and mod settings) with writeFileSync, straight over the file, so
// a reader landing on the write got an empty or cut short file: measured on
// One with a write every 20 ms, 43 of 810 site-style reads empty and 70 of 782
// HTTP answers bad. Three of them wrote a temp file and renamed it with node's
// renameSync, and when Windows refused that rename (MoveFileEx is refused
// while any other program has the file open) wrote the file in place after
// all. Patrick's A: the engine fork has a whole-file write the gamemode can
// call (a new file beside it, flushed, renamed over it with POSIX semantics),
// and the port serves each file from the handle it opened. Measured with the
// fork's write every 20 ms: 0 of 1500 writes refused, 0 bad of 1060 site-style
// reads and 0 bad of 1029 answers from the port.
//
// WHAT IT HOLDS IT TO.
//   1. Each of the nine writers writes through mp.writeFileWhole and no
//      writeFileSync or renameSync touches its file.
//   2. No in-place fallback is left anywhere in gamemode.js: no catch of a
//      refused rename that writes the same file in place.
//   3. The online writer, run against a stand-in mp: both files go through
//      mp.writeFileWhole; a refused write leaves the files as they were, is
//      said on the console once for each reason, and is not counted as
//      written, so the next pass writes the count; nothing in it calls
//      writeFileSync or renameSync.
//
// GAMEMODE names another gamemode.js to hold to these (main's before #2740
// fails 1, 2 and 3). Read only, apart from its own temp folder.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GAMEMODE || path.join(REPO_DIR, 'game', 'gamemode.js');
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

// The text between two markers, or '' when either is not there.
function between(from, to) {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? '' : src.slice(a, b + to.length);
}

// ---- 1: the nine writers --------------------------------------------------------
// Each: the block it is in (from a line that names the file to the end of the
// function or block that writes it) and the whole write in it.
const writers = [
  ['data/thornswood-log.json, the log state',
    between('function sayLogState(state) {', '\nfunction logPath() {'),
    /mp\.writeFileWhole\(where, JSON\.stringify\(state\)\)/],
  ['data/server-bases.json, the bases the client leaves to the server',
    between("var dataDirB = 'data';", "log('published', ids.length"),
    /mp\.writeFileWhole\(pathb\.join\(dataDirB, 'server-bases\.json'\)/],
  ['private/online-names.json, who is on',
    between("var namesFile = path.join(privDir, 'online-names.json');", "console.log('[thornswood] online count published at '"),
    /mp\.writeFileWhole\(namesFile, /],
  ['data/online.json, the count',
    between("var onlineFile = path.join(dataDir, 'online.json');", "console.log('[thornswood] online count published at '"),
    /mp\.writeFileWhole\(onlineFile, /],
  ['private/characters.json, the roster',
    between('Into a file beside it and then renamed over it, never written in place.', '\n    push();\n'),
    /mp\.writeFileWhole\(FILE, JSON\.stringify\(\{ at: Date\.now\(\), who: book \}\)\)/],
  ['private/allowed.json, the door list',
    between('var enforce = false;', "note('list refreshed from the site, '"),
    /mp\.writeFileWhole\(FILE, JSON\.stringify\(\{\s*enforce: enforce,/],
  ['data/api/servers/thornswood/manifest.json, the load order',
    between("var DST = path.join(DIR, 'manifest.json');", "return 'could not write ' + DST"),
    /mp\.writeFileWhole\(DST, JSON\.stringify\(out\)\)/],
  ['private/take-limit.json, the take limit',
    between("var FILE = path.join(privDir, 'take-limit.json');", "could not write the take limit: "),
    /mp\.writeFileWhole\(FILE, JSON\.stringify\(\{ at: t, counts: counts \}\)\)/],
  ['private/mod-settings.json, the mod settings',
    between('see the roster\'s write(). */', "mlog('could not write', FILE + ':', e);"),
    /mp\.writeFileWhole\(FILE, JSON\.stringify\(\{ at: Date\.now\(\), who: book \}\)\)/]
];
for (const [what, block, whole] of writers) {
  yes(what + ': its block is in gamemode.js', block.length > 0);
  if (!block) continue;
  yes(what + ': written whole with mp.writeFileWhole', whole.test(block));
  yes(what + ': and nothing in its block writes or renames in place',
      !/\b(?:fs|fsb)\.(?:writeFileSync|renameSync|appendFileSync|copyFileSync)\(/.test(block) &&
      !/require\('fs'\)\.(?:writeFileSync|renameSync)\(/.test(block));
}

// ---- 2: no fallback to an in-place write ----------------------------------------
// A rename in a try whose catch writes the file in place: the shape all three
// fallbacks had (renameSync(tmp, FILE); } catch (e) { fs.writeFileSync(FILE, ...).
const fallback = /renameSync\(\s*[^,()]+,\s*([\w.]+)\s*\)\s*;?\s*\}\s*catch\s*\(\s*\w+\s*\)\s*\{\s*(?:[\w.]+\.)?writeFileSync\(\s*\1\b/g;
const fallbacks = src.match(fallback) || [];
yes('no catch of a refused rename writes the file in place anywhere in gamemode.js (found ' + fallbacks.length + ')',
    fallbacks.length === 0);
yes('the three that did (the roster, the take limit, the mod settings) have no .tmp of their own left',
    !/var tmp = FILE \+ '\.tmp';/.test(src));

// ---- 3: the online writer, run ----------------------------------------------------
const START = '  // ------------------------------------------------------------- online ---';
const END = "console.log('[thornswood] online count published at ' + onlineFile);\n  } catch (e) { }\n";
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;
yes('gamemode.js still has its online writer', block !== null);
if (!block) done();

const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2740-'));
const dataDir = path.join(box, 'data');
const privDir = path.join(box, 'private');
fs.mkdirSync(dataDir);
fs.mkdirSync(privDir);
fs.writeFileSync(path.join(box, 'server-settings.json'),
  JSON.stringify({ port: 7787, dataDir: dataDir, privDir: privDir }));
const onlineFile = path.join(dataDir, 'online.json');
const namesFile = path.join(privDir, 'online-names.json');

// fs for the block: reads as they are, and any write or rename noted, so a
// write that is not through mp.writeFileWhole shows.
const inPlace = [];
const blockFs = Object.assign({}, fs, {
  writeFileSync: function (f) { inPlace.push('writeFileSync ' + f); return fs.writeFileSync.apply(fs, arguments); },
  renameSync: function (f) { inPlace.push('renameSync ' + f); return fs.renameSync.apply(fs, arguments); },
  appendFileSync: function (f) { inPlace.push('appendFileSync ' + f); return fs.appendFileSync.apply(fs, arguments); }
});

let room = {};
let refuse = null;     // a reason to refuse every whole write with, or null
const whole = [];
const said = [];
const mp = {
  get: function (id, what) {
    if (id === 0 && what === 'onlinePlayers') return Object.keys(room).map(Number);
    const who = room[id];
    if (!who) return undefined;
    if (what === 'appearance') return { name: who.name };
    return undefined;
  },
  getServerSettings: function () { return {}; },
  // The engine's write as far as the gamemode can tell: the file is the new
  // text afterwards, or the call throws and the file is as it was.
  writeFileWhole: function (file, text) {
    if (typeof file !== 'string' || typeof text !== 'string') throw new Error('writeFileWhole wants a path and a string');
    if (refuse) throw new Error('Could not write ' + file + ' whole: ' + refuse + '. ' + path.basename(file) + ' is as it was.');
    whole.push(path.resolve(file));
    fs.writeFileSync(file, text);
  }
};
let tick = null;
const sandbox = {
  mp: mp,
  require: function (name) { return name === 'fs' ? blockFs : require(name); },
  console: { log: function (l) { said.push(String(l)); } },
  setInterval: function (fn) { tick = fn; return 1; },
  clearInterval: function () { },
  Date: Date, JSON: JSON, String: String, Number: Number
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
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

room = { 1: { name: 'Camilla' } };
tick();
yes('one on: online.json says 1, written with mp.writeFileWhole',
    (read(onlineFile) || {}).now === 1 && whole.indexOf(path.resolve(onlineFile)) >= 0);
yes('and the names went the same way',
    JSON.stringify((read(namesFile) || {}).names) === '["Camilla"]' && whole.indexOf(path.resolve(namesFile)) >= 0);

room = { 1: { name: 'Camilla' }, 2: { name: 'Ahlam' } };
refuse = 'renaming the new file over it, refused because another program has it open without sharing delete';
said.length = 0;
tick();
tick();
yes('a refused write leaves online.json as it was', (read(onlineFile) || {}).now === 1);
yes('and the names file too', JSON.stringify((read(namesFile) || {}).names) === '["Camilla"]');
const told = said.filter((l) => /could not write .*online\.json/.test(l));
const toldNames = said.filter((l) => /could not write .*online-names\.json/.test(l));
yes('the console says so for each file, once over two refused passes (online.json ' + told.length + ', names ' + toldNames.length + ')',
    told.length === 1 && toldNames.length === 1 && /without sharing delete/.test(told[0] || ''));

refuse = null;
tick();
yes('the next pass that can write writes the count it did not get to (got ' + JSON.stringify(read(onlineFile)) + ')',
    (read(onlineFile) || {}).now === 2);
yes('and the names', JSON.stringify((read(namesFile) || {}).names) === '["Ahlam","Camilla"]');

yes('nothing in the online writer wrote or renamed in place (' + (inPlace.join(', ') || 'none') + ')', inPlace.length === 0);
yes('no file but the two is left in either folder',
    fs.readdirSync(dataDir).join(',') === 'online.json' && fs.readdirSync(privDir).join(',') === 'online-names.json');

try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) { }
done();
