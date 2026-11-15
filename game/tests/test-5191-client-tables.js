// test-5191-client-tables.js
//
// #5191, stage 4: the front plugin held three tables a builder pasted into
// its source out of the load order (PLACED_WATERS, STALL_SPOTS and
// NO_BOUNTY_FACTIONS), so every load order change rewrote
// game/plugins/thornswood-front.js and the tables could not leave git. Each
// is now a plugin of its own, game/plugins/thornswood-table-<name>.js, that
// puts its rows on globalThis.Thornswood.clientTables as Skyrim Platform
// loads it, and the front plugin reads them there with clientTable(NAME)
// when it uses them.
//
// Checks:
//   1. The two writers lay a table out alike: scripts/dev/ClientTables.js and
//      scripts/dev/client_tables.py give the same bytes for the same rows,
//      whole floats included (SKIP for Python where that is not installed).
//   2. Each table plugin opens with the whose-game reader and, run as Skyrim
//      Platform runs it, sets nothing at load; on the first tick it puts on
//      globalThis.Thornswood.clientTables exactly the rows read() gives,
//      beside what is there already, only when the game is ours, and says so
//      in the console. It is LF only.
//   3. Every table plugin is written by a step of
//      scripts/mods/content-tables.json and read by a clientTable() call in
//      the front plugin, every call has its plugin, and the front plugin
//      holds no copy of any of them.
//   4. clientTable() gives the rows when the plugin loaded, and when it did
//      not, an empty list and one line in the log naming the plugin.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const C = require(path.join(REPO, 'scripts', 'dev', 'ClientTables.js'));
const FRONT = fs.readFileSync(path.join(REPO, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split('\r').join('');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }

// ------------------------------------------------ 1. two writers, one layout
const SAMPLES = [
  [['Skyrim.esm', 0x74ee9, -1024.5, 2, 3.0, 4]],
  [[0x2816c, 'Skyrim.esm', 'CrimeFactionReach'], [0x18279, 'Dragonborn.esm', 'DLC2CrimeRavenRockFaction']],
  [['stall-1', 60, 'Skyrim.esm', 1.25, -2, 1e5, 150]],
  [['Ünïcode, "quoted" ]['], { a: [1, { b: 2 }] }],
  []
];
const BY = 'test-5191-client-tables.js';
const jsOut = SAMPLES.map((s) => C.body('SAMPLE_TABLE', s, BY));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-5191-client-'));
// Handed over as JSON text, with the whole float written 3.0, so it reaches
// Python as a float, the way a builder's own rows do.
const texts = SAMPLES.map((s) => JSON.stringify(s).replace(',2,3,4]', ',2,3.0,4]'));
yes('a sample carries a whole float for Python', texts[0].indexOf(',3.0,') > 0);
fs.writeFileSync(path.join(tmp, 'samples.json'), JSON.stringify(texts));
let python = false;
try { python = cp.spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0; } catch (e) { python = false; }
if (python) {
  const py = 'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport client_tables as C\n' +
    'sys.stdout.write(json.dumps([C._body("SAMPLE_TABLE", t, "' + BY + '") for t in json.load(open(sys.argv[2], encoding="utf-8"))]))\n';
  const r = cp.spawnSync('python3', ['-I', '-c', py, path.join(REPO, 'scripts', 'dev'), path.join(tmp, 'samples.json')], { encoding: 'utf8' });
  let got = null;
  try { got = r.status === 0 ? JSON.parse(r.stdout) : null; } catch (e) { got = null; }
  yes('the Python writer gives every sample byte for byte as the JavaScript one' + (r.status ? ' (' + r.stderr.trim() + ')' : ''),
      !!got && got.length === jsOut.length && got.every((g, i) => g === jsOut[i]));
} else { skip('the Python writer: no python3 here'); }

yes('a table is one compact row to a line', jsOut[1].split('\n').filter((l) => /^\[/.test(l)).length === 2);
yes('an empty table is one line', /= \[\];\n/.test(jsOut[4]));
{
  const dir = path.join(tmp, 'plugins');
  const first = C.write('SAMPLE_TABLE', SAMPLES[0], BY, dir);
  const again = C.write('SAMPLE_TABLE', JSON.stringify(SAMPLES[0]), BY, dir);
  yes('write says it changed the file, then that it did not', first === true && again === false);
  yes('read gives the rows back without running the file', JSON.stringify(C.read('SAMPLE_TABLE', dir)) === JSON.stringify(SAMPLES[0]));
  let named = false;
  try { C.file('lower_case'); } catch (e) { named = true; }
  yes('a table is named like the constant the front plugin used', named);
  yes('its plugin is thornswood-table-<name>.js',
      path.basename(C.file('NO_BOUNTY_FACTIONS')) === 'thornswood-table-no-bounty-factions.js');
}

// ------------------------------------------- 2. each plugin, as the game runs it
const plugins = fs.readdirSync(C.DIR).filter((f) => /^thornswood-table-.*\.js$/.test(f)).sort();
const names = plugins.map((f) => f.slice('thornswood-table-'.length, -3).toUpperCase().replace(/-/g, '_'));
yes('there are the three client tables (' + names.join(', ') + ')',
    JSON.stringify(names) === JSON.stringify(['NO_BOUNTY_FACTIONS', 'PLACED_WATERS', 'STALL_SPOTS']));
// The whose-game reader each opens with (tests/test-whose-game-gate.js holds
// it): nothing at load, the rows on the first tick, and only when ours.
const ticks = [];
const said = [];
let ours = false;
const box = {
  Thornswood: { already: 1, whoseGame: () => ours },
  skyrimPlatform: { once: (name, fn) => { if (name === 'tick') { ticks.push(fn); } }, printConsole: (t) => said.push(t) }
};
box.globalThis = box;
vm.createContext(box);
const rowsOf = {};
for (let i = 0; i < plugins.length; i++) {
  const text = fs.readFileSync(path.join(C.DIR, plugins[i]), 'utf8');
  let rows = null, threw = null;
  try { rows = C.read(names[i]); vm.runInContext(text, box, { filename: plugins[i] }); } catch (e) { threw = e.message; }
  rowsOf[names[i]] = rows;
  yes(plugins[i] + ' loads, sets nothing at load and waits for the first tick' + (threw ? ' (' + threw + ')' : ''),
      !threw && !box.Thornswood.clientTables && ticks.length === i + 1);
  yes(plugins[i] + ' is LF only, opens with the reader and is already what its writer makes', text.indexOf('\r') < 0 &&
      text.indexOf(C.READER) > 0 && text === C.body(names[i], rows || [], /Built by (\S+);/.exec(text)[1]));
}
ticks.splice(0).forEach((fn) => fn());
yes('told not ours on the first tick, they set nothing', !box.Thornswood.clientTables && said.length === 0);
// A second session, told ours.
for (let i = 0; i < plugins.length; i++) { vm.runInContext(fs.readFileSync(path.join(C.DIR, plugins[i]), 'utf8'), box); }
ours = true;
ticks.splice(0).forEach((fn) => fn());
for (const n of names) {
  const rows = rowsOf[n];
  const set = box.Thornswood.clientTables && box.Thornswood.clientTables[n];
  yes('told ours, ' + n + ' is the ' + (rows ? rows.length : 0) + ' rows its plugin holds, and the console says so',
      Array.isArray(rows) && rows.length > 0 && JSON.stringify(set) === JSON.stringify(rows) &&
      said.indexOf('[thornswood-table] ' + n + ': ' + rows.length + ' rows') >= 0);
}
yes('the plugins leave what globalThis.Thornswood held already', box.Thornswood.already === 1);

// --------------------------------- 3. the chain writes them, the front reads them
const chain = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'mods', 'content-tables.json'), 'utf8'));
const written = new Set();
for (const s of chain.steps) { for (const w of s.writes || []) { if (/^game\/plugins\/thornswood-table-.*\.js$/.test(w)) { written.add(path.basename(w)); } } }
const unwritten = plugins.filter((f) => !written.has(f));
yes('every table plugin is written by a step of the chain' + (unwritten.length ? ' (not: ' + unwritten.join(', ') + ')' : ''), unwritten.length === 0);
const intoFront = chain.steps.filter((s) => (s.writes || []).indexOf('game/plugins/thornswood-front.js') >= 0).map((s) => s.tool);
yes('no step of the chain writes the front plugin' + (intoFront.length ? ' (' + intoFront.join(', ') + ')' : ''), intoFront.length === 0);
const called = [...new Set([...FRONT.matchAll(/\bclientTable\('([A-Z][A-Z0-9_]*)'\)/g)].map((m) => m[1]))].sort();
yes('the front plugin reads every table plugin, and only those (' + called.join(', ') + ')',
    JSON.stringify(called) === JSON.stringify(names));
const copies = names.filter((n) => new RegExp('\\b' + n + ' = \\[').test(FRONT) || FRONT.indexOf('==== ' + n) >= 0);
yes('the front plugin holds no copy of any of them' + (copies.length ? ' (' + copies.join(', ') + ')' : ''), copies.length === 0);

// ------------------------------------------------------ 4. clientTable() itself
{
  const a = FRONT.indexOf('  const clientTableSaid = {};');
  const b = FRONT.indexOf('\n  }\n', FRONT.indexOf('  function clientTable(name) {', a));
  yes('the front plugin has clientTable', a >= 0 && b > a);
  function load(T) {
    const said = [];
    const fn = new Function('T', 'say', FRONT.slice(a, b + 4) + '\nreturn clientTable;')(T, (t) => said.push(t));
    return { clientTable: fn, said: said };
  }
  const there = load({ clientTables: { STALL_SPOTS: [['s', 1]] } });
  yes('it gives the rows its plugin put there', JSON.stringify(there.clientTable('STALL_SPOTS')) === '[["s",1]]' && there.said.length === 0);
  const gone = load({});
  const first = gone.clientTable('PLACED_WATERS');
  gone.clientTable('PLACED_WATERS');
  yes('a table whose plugin did not load is an empty list, and the log names the plugin once',
      Array.isArray(first) && first.length === 0 && gone.said.length === 1 &&
      gone.said[0].indexOf('thornswood-table-placed-waters.js did not load') >= 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
