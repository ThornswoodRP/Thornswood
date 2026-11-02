// test-5191-gamemode-tables.js
//
// #5191: every table a builder reads out of the load order is its own file,
// game/gamemode-tables/<NAME>.json, which the gamemode reads with
// `const NAME = table('NAME')` when it loads, so two content pull requests
// change two files (or two rows of one) and merge side by side.
//
// Checks:
//   1. The three writers lay a table out alike: scripts/dev/GamemodeTables.js,
//      scripts/dev/gamemode_tables.py and scripts/dev/GamemodeTables.ps1 give
//      the same bytes for the same JSON text, spaced or not (SKIP for Python
//      or PowerShell where that is not installed).
//   2. The layout is one entry to a line down to the second level, gives the
//      JSON back with its line breaks taken out, and writes LF only.
//   3. Every file in game/gamemode-tables parses, is already laid out, and is
//      read by a table() call in game/gamemode.js; every table() call has its
//      file; and every file is written by a step of
//      scripts/mods/content-tables.json, so the chain rebuilds all of them.
//   4. No step of the chain writes a table into game/gamemode.js: the only
//      steps that still write it carry code (the merchant and market stall
//      bundles), and their catalogues are table files.
//   5. The gamemode's own table() reads the server's folder, else the
//      repository's game folder, once a load, and stops the load, naming the
//      file, when a table is missing or does not parse; the load logs the
//      folder by the tree id git gives it, beside the gamemode's blob.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO = path.join(__dirname, '..');
const T = require(path.join(REPO, 'scripts', 'dev', 'GamemodeTables.js'));
const GM = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }
function has(cmd, args) {
  try { return cp.spawnSync(cmd, args, { encoding: 'utf8' }).status === 0; } catch (e) { return false; }
}

// ------------------------------------------------- 1. three writers, one layout
const SAMPLES = [
  '{"items":{"a:Skyrim.esm":[1,2,{"x":[3]}],"b":"}{],[\\"\\\\"},"most":0.0,"e":1e5}',
  '{ "items" : { } , "rows" : [ ] , "n" : null }',
  '[{"id":"x","pos":[1.5,-2,3]},{"id":"y,z","pos":[]}]',
  '{"Flames":"12fcd:Skyrim.esm","Ice Spike":"2b96c:Skyrim.esm","Ünïcode":"\\u00e9"}',
  '"1e2a3:Skyrim.esm"',
  '[]',
  '{"a":{"b":{"c":{"d":[1,[2,[3]]]}}}}'
];
const jsOut = SAMPLES.map(T.layout);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-5191-'));
fs.writeFileSync(path.join(tmp, 'samples.json'), JSON.stringify(SAMPLES));

if (has('python3', ['--version'])) {
  const py = 'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport gamemode_tables as G\n' +
    'sys.stdout.write(json.dumps([G.layout(t) for t in json.load(open(sys.argv[2], encoding="utf-8"))]))\n';
  const r = cp.spawnSync('python3', ['-I', '-c', py, path.join(REPO, 'scripts', 'dev'), path.join(tmp, 'samples.json')], { encoding: 'utf8' });
  const got = r.status === 0 ? JSON.parse(r.stdout) : null;
  yes('the Python writer lays every sample out byte for byte as the JavaScript one' + (r.status ? ' (' + r.stderr.trim() + ')' : ''),
      !!got && got.every((g, i) => g === jsOut[i]));
} else { skip('the Python writer: no python3 here'); }

if (has('pwsh', ['-NoProfile', '-Command', 'exit 0'])) {
  const ps = path.join(tmp, 'layout.ps1');
  fs.writeFileSync(ps, '. (Join-Path $args[0] "GamemodeTables.ps1")\n' +
    '$s = Get-Content -Raw -Encoding utf8 $args[1] | ConvertFrom-Json\n' +
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n' +
    '[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($s | ForEach-Object { Format-GamemodeTable $_ })))\n');
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-File', ps, path.join(REPO, 'scripts', 'dev'), path.join(tmp, 'samples.json')], { encoding: 'utf8' });
  let got = null;
  try { got = JSON.parse(r.stdout); } catch (e) { got = null; }
  yes('the PowerShell writer lays every sample out byte for byte as the JavaScript one' + (r.status ? ' (' + r.stderr.trim() + ')' : ''),
      !!got && got.length === jsOut.length && got.every((g, i) => g === jsOut[i]));
} else { skip('the PowerShell writer: no pwsh here'); }

// ------------------------------------------------------------- 2. the layout
yes('each sample gives its JSON back with the line breaks taken out',
    SAMPLES.every((s) => JSON.stringify(JSON.parse(jsOut[SAMPLES.indexOf(s)].split('\n').join(''))) === JSON.stringify(JSON.parse(s))));
yes('a laid out table is laid out already (the same bytes again)', jsOut.every((o) => T.layout(o) === o));
yes('rows are one to a line down to the second level and compact below it',
    T.layout('{"items":{"a":[1,{"b":[2]}],"c":3}}') === '{\n"items":{\n"a":[1,{"b":[2]}],\n"c":3\n}\n}\n');
yes('an empty object or array stays on its line', T.layout('{"a":{},"b":[]}') === '{\n"a":{},\n"b":[]\n}\n');
yes('a brace or comma inside a string is left alone', T.layout('{"a":"x,{y}[z]\\"q"}') === '{\n"a":"x,{y}[z]\\"q"\n}\n');
{
  const dir = path.join(tmp, 'tables');
  const first = T.write('SAMPLE_TABLE', '{\r\n "a" : [1, 2] }', dir);
  const again = T.write('SAMPLE_TABLE', { a: [1, 2] }, dir);
  const body = fs.readFileSync(path.join(dir, 'SAMPLE_TABLE.json'), 'utf8');
  yes('write lays the table out with LF only and says it changed, then that it did not', first === true && again === false && body.indexOf('\r') < 0);
  let threw = false;
  try { T.write('SAMPLE_TABLE', '{"a":', dir); } catch (e) { threw = true; }
  yes('write refuses text that does not parse, and leaves the file as it was',
      threw && fs.readFileSync(path.join(dir, 'SAMPLE_TABLE.json'), 'utf8') === body);
  let named = false;
  try { T.file('lower_case'); } catch (e) { named = true; }
  yes('a table is named like the constant that holds it', named);
}

// --------------------------------------------------- 3. the files and the gamemode
const files = fs.readdirSync(T.DIR).filter((f) => /\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
const called = [...new Set([...GM.matchAll(/\btable\('([A-Z][A-Z0-9_]*)'\)/g)].map((m) => m[1]))].sort();
const notLaid = files.filter((n) => {
  const text = fs.readFileSync(T.file(n), 'utf8');
  try { JSON.parse(text); } catch (e) { return true; }
  return T.layout(text) !== text;
});
yes('there are tables (' + files.length + ')', files.length > 40);
yes('every table file parses and is laid out' + (notLaid.length ? ' (not: ' + notLaid.join(', ') + ')' : ''), notLaid.length === 0);
const unread = files.filter((n) => called.indexOf(n) < 0);
const missing = called.filter((n) => files.indexOf(n) < 0);
yes('every table file is read by a table() call in the gamemode' + (unread.length ? ' (not: ' + unread.join(', ') + ')' : ''), unread.length === 0);
yes('every table() call in the gamemode has its file' + (missing.length ? ' (not: ' + missing.join(', ') + ')' : ''), missing.length === 0);
const chain = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'mods', 'content-tables.json'), 'utf8'));
const written = new Set();
for (const s of chain.steps) { for (const w of s.writes || []) { const m = /^game\/gamemode-tables\/([A-Z0-9_]+)\.json$/.exec(w); if (m) { written.add(m[1]); } } }
const unwritten = files.filter((n) => !written.has(n));
yes('every table file is written by a step of the chain' + (unwritten.length ? ' (not: ' + unwritten.join(', ') + ')' : ''), unwritten.length === 0);

// ------------------------------------------------- 4. the chain and gamemode.js
const intoGamemode = chain.steps.filter((s) => (s.writes || []).indexOf('game/gamemode.js') >= 0).map((s) => s.tool).sort();
yes('the only chain steps that still write gamemode.js are the two code bundles (' + intoGamemode.join(', ') + ')',
    JSON.stringify(intoGamemode) === JSON.stringify(['scripts/dev/Build-MarketStallsGamemode.js', 'scripts/dev/Build-MerchantGamemode.js']));
for (const tool of intoGamemode) {
  const r = cp.spawnSync(process.execPath, [path.join(REPO, tool), '--check'], { cwd: REPO, encoding: 'utf8' });
  yes(tool + ' --check: its bundle and its tables are what it builds' + (r.status ? ' (' + (r.stderr || r.stdout).trim().split('\n').pop() + ')' : ''), r.status === 0);
}

// -------------------------------------------------- 5. the gamemode's table()
{
  const g1 = GM.indexOf('function gamemodeId(bytes) {');
  const g2 = GM.indexOf('\n}\n', g1);
  const t1 = GM.indexOf('var GAMEMODE_TABLES = null;');
  const t2 = GM.indexOf("const DATA = table('DATA');");
  // A fresh load each time: the reader's own state is made anew, as a reload makes it.
  function load(cwd) {
    const fake = (m) => (m === 'process' ? { cwd: () => cwd } : require(m));
    return new Function('require', GM.slice(g1, g2 + 2) + GM.slice(t1, t2) + '\nreturn { table: table, tableFolder: tableFolder };')(fake);
  }
  function ask(l, name) { try { return { value: l.table(name) }; } catch (e) { return { error: e.message }; } }
  const server = path.join(tmp, 'server');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(server, 'gamemode-tables'), { recursive: true });
  fs.mkdirSync(path.join(server, 'game', 'gamemode-tables'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'game', 'gamemode-tables'), { recursive: true });
  fs.writeFileSync(path.join(server, 'gamemode-tables', 'ONE.json'), '{"from":"server"}\n');
  fs.writeFileSync(path.join(server, 'game', 'gamemode-tables', 'ONE.json'), '{"from":"repo"}\n');
  fs.writeFileSync(path.join(repo, 'game', 'gamemode-tables', 'TWO.json'), '[1,\n2]\n');
  fs.writeFileSync(path.join(server, 'gamemode-tables', 'BAD.json'), '{"a":\n');
  const atServer = load(server);
  yes('table() reads gamemode-tables in the server\'s folder when it is there', JSON.stringify(ask(atServer, 'ONE').value) === '{"from":"server"}');
  yes('and game/gamemode-tables from the repository\'s root when it is not', JSON.stringify(ask(load(repo), 'TWO').value) === '[1,2]');
  fs.writeFileSync(path.join(server, 'gamemode-tables', 'ONE.json'), '{"from":"later"}\n');
  yes('a load answers from the one read it made, whatever the folder holds later', JSON.stringify(ask(atServer, 'ONE').value) === '{"from":"server"}');
  yes('and the next load reads the folder again', JSON.stringify(ask(load(server), 'ONE').value) === '{"from":"later"}');
  const gone = ask(atServer, 'NONE');
  yes('a table that is not in the folder stops the load and names its file',
      !!gone.error && gone.error.indexOf(path.join(server, 'gamemode-tables', 'NONE.json')) >= 0);
  const bad = ask(atServer, 'BAD');
  yes('a table that does not parse stops the load and names its file', !!bad.error && bad.error.indexOf(path.join(server, 'gamemode-tables', 'BAD.json') + ' does not parse') >= 0);
  const none = ask(load(path.join(tmp, 'nowhere')), 'ONE');
  yes('no folder at all stops the load and names both places it looked',
      !!none.error && none.error.indexOf(path.join(tmp, 'nowhere', 'gamemode-tables')) >= 0 && none.error.indexOf(path.join(tmp, 'nowhere', 'game', 'gamemode-tables')) >= 0);
  // The id the load logs is git's own tree id for the folder.
  const clean = cp.spawnSync('git', ['status', '--porcelain', '--', 'game/gamemode-tables'], { cwd: REPO, encoding: 'utf8' });
  const want = cp.spawnSync('git', ['rev-parse', 'HEAD:game/gamemode-tables'], { cwd: REPO, encoding: 'utf8' });
  if (clean.status === 0 && clean.stdout.trim() === '' && want.status === 0) {
    const got = load(REPO).tableFolder();
    yes('the load names the folder by the tree id git gives it at this commit (' + got.tree.slice(0, 12) + ', ' + got.count + ' files)',
        got.tree === want.stdout.trim() && got.count === files.length);
  } else { skip('the tree id against git: game/gamemode-tables differs from HEAD or git is not here'); }
  yes('the load logs that id beside the gamemode\'s blob',
      /log\('gamemode tables are git tree ' \+ t\.tree \+ ', ' \+ t\.count \+ ' files, in ' \+ t\.dir\);/.test(GM) &&
      GM.indexOf("log('gamemode tables are git tree ") > GM.indexOf("log('gamemode.js is git blob "));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
