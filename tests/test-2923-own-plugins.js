/*
  test-2923-own-plugins.js

  #2923. Thornswood's own plugins (every file in game/content) are made and
  shipped from this repository. Build-FoodTable.js and Build-RecipeTable.ps1
  read them from the game's Data folder, which holds whichever release last
  reached it (on One, a Content plugin from 12 Oct), so a content change could
  only be built by making a Data folder of links to the repository's copy.
  And nothing said which tables a content change makes stale: #2911 found
  them one red build at a time.

  H  the three helpers (scripts/dev/OwnPlugins.js, OwnPlugins.ps1,
     own_plugins.py) say the same thing: a file in game/content is read from
     there, any other plugin from the Data folder. Thornswood-Last.esp, in no
     repository since #2791 step 3, is read from the Data folder, where its
     recipe makes it, and all three still call it ours.
  F  Build-FoodTable.js, given a Data folder holding a stale content plugin,
     builds from the repository's.
  R  no builder that reads a load order joins the Data folder with a plugin
     name itself.
  C  scripts/mods/content-tables.json, the list
     scripts/mods/Rebuild-ContentTables.ps1 runs: every builder that reads a
     load order is in it or left out with a reason, no step reads a table a
     later step writes, and the script lists every step. #3425: each
     builder's own source is read for every file of the repository it names
     outside scripts, game/content, game/data and records, and each one is
     in a step's reads, readsBack, uses or writes, which is what
     scripts/mods/Run-OnBox.ps1 sends to the box (the K panel's book that
     Build-SpellTable.ps1 reads was named nowhere, and the box run stopped
     there).
  N  the harnesses that hold a table to the plugin's bytes name the script.
  L  #2976. The load order is read in one place: the three helpers say the
     same of a plugins.txt holding switched off lines (the masters, then each
     '*' line, once), and no builder reads plugins.txt's lines itself.
     tests/test-1712-builders-skip-off.js runs the builders on such a list.
  O  #3105. A table says which load order it was read from by its count and
     a hash of its names (the three helpers' load order name, the same in
     each), never the plugin list's path: a box run reads a list in a new
     temp folder each time, so a path in a table made two runs of one commit
     disagree, and on One it named the profile, not the load order.

  Nothing outside a temporary folder is written.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEV = path.join(ROOT, 'scripts', 'dev');
const OWN_DIR = path.join(ROOT, 'game', 'content');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(String.fromCharCode(13)).join(''); }
function run(exes, args, opts) {
  for (const exe of exes) {
    const p = spawnSync(exe, args, Object.assign({ encoding: 'utf8', maxBuffer: 1 << 26 }, opts || {}));
    if (!p.error) { return p; }
  }
  return null;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-2923-'));
const DATA = path.join(TMP, 'Data');
fs.mkdirSync(DATA);
const OWN = fs.readdirSync(OWN_DIR).filter((n) => fs.statSync(path.join(OWN_DIR, n)).isFile());

// ---------------------------------------------------------------- H
yes('H0 game/content holds Thornswood-Content.esp, and not Thornswood-Last.esp (#2791)',
    OWN.indexOf('Thornswood-Content.esp') >= 0 && OWN.indexOf('Thornswood-Last.esp') < 0);
const js = require(path.join(DEV, 'OwnPlugins.js'));
yes('H1 OwnPlugins.js reads every file in game/content from there (' + OWN.length + ')',
    OWN.every((n) => path.resolve(js.pluginPath(DATA, n)) === path.resolve(OWN_DIR, n)));
yes('H2 and any other plugin from the Data folder',
    path.resolve(js.pluginPath(DATA, 'Skyrim.esm')) === path.resolve(DATA, 'Skyrim.esm'));

yes('H2b Thornswood-Last.esp from the Data folder, where its recipe makes it, and still ours',
    path.resolve(js.pluginPath(DATA, 'Thornswood-Last.esp')) === path.resolve(DATA, 'Thornswood-Last.esp') &&
    js.isOwn('Thornswood-Last.esp') && js.isOwn('Thornswood-Content.esp') && !js.isOwn('Skyrim.esm'));

const want = OWN.map((n) => path.resolve(OWN_DIR, n)).concat([path.resolve(DATA, 'Skyrim.esm'), path.resolve(DATA, 'Thornswood-Last.esp')]);
const names = OWN.concat(['Skyrim.esm', 'Thornswood-Last.esp']);
const py = run(['python', 'py', 'python3'], ['-c',
  'import sys; sys.path.insert(0, sys.argv[1]); import own_plugins\n' +
  'for n in sys.argv[3:]: print(own_plugins.plugin_path(sys.argv[2], n))\n' +
  'print(own_plugins.is_own("Thornswood-Last.esp"), own_plugins.is_own("Skyrim.esm"))', DEV, DATA].concat(names));
if (!py) {
  console.log('SKIP  H3: no python here');
} else {
  const lines = py.stdout.trim().split(/\r?\n/);
  const got = lines.slice(0, -1).map((l) => path.resolve(l.trim()));
  yes('H3 own_plugins.py says the same for each', py.status === 0 && JSON.stringify(got) === JSON.stringify(want));
  yes('H3b and calls Thornswood-Last.esp ours, and Skyrim.esm not', lines[lines.length - 1].trim() === 'True False');
  if (py.status !== 0) { console.log(py.stderr); }
}
const asks = path.join(TMP, 'asks.ps1');
fs.writeFileSync(asks, 'param([string]$Dev, [string]$Data, [string]$Names)\n' +
  '. (Join-Path $Dev \'OwnPlugins.ps1\')\n' +
  'foreach ($n in ($Names -split \',\')) { Get-PluginPath $Data $n }\n' +
  '"$(Test-OwnPlugin \'Thornswood-Last.esp\') $(Test-OwnPlugin \'Skyrim.esm\')"\n');
const ps = run(['pwsh', 'powershell'], ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', asks, '-Dev', DEV, '-Data', DATA,
  '-Names', names.join(',')]);
if (!ps) {
  console.log('SKIP  H4: no PowerShell here');
} else {
  const lines = ps.stdout.trim().split(/\r?\n/);
  const got = lines.slice(0, -1).map((l) => path.resolve(l.trim()));
  yes('H4 OwnPlugins.ps1 says the same for each', ps.status === 0 && JSON.stringify(got) === JSON.stringify(want));
  yes('H4b and calls Thornswood-Last.esp ours, and Skyrim.esm not', lines[lines.length - 1].trim() === 'True False');
  if (ps.status !== 0) { console.log(ps.stderr); }
}

// ---------------------------------------------------------------- F
// A plugin in the shape Build-FoodTable.js reads: TES4 with its masters,
// then one ALCH group (the same layout as tests/test-food-table.js).
function zs(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(1)]); }
function sub(tag, data) { const h = Buffer.alloc(6); h.write(tag, 0, 'ascii'); h.writeUInt16LE(data.length, 4); return Buffer.concat([h, data]); }
function record(type, formId, flags, data) {
  const h = Buffer.alloc(24);
  h.write(type, 0, 'ascii'); h.writeUInt32LE(data.length, 4); h.writeUInt32LE(flags >>> 0, 8); h.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([h, data]);
}
function group(label, recs) {
  const body = Buffer.concat(recs);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'ascii'); h.writeUInt32LE(24 + body.length, 4); h.write(label, 8, 'ascii');
  return Buffer.concat([h, body]);
}
function alch(formId, edid, name) {
  const enit = Buffer.alloc(20);
  enit.writeUInt32LE(5, 0); enit.writeUInt32LE(2, 4);
  return record('ALCH', formId, 0, Buffer.concat([sub('EDID', zs(edid)), sub('FULL', zs(name)), sub('ENIT', enit)]));
}
function plugin(masters, recs) {
  const hedr = Buffer.alloc(12);
  hedr.writeFloatLE(1.71, 0); hedr.writeUInt32LE(recs.length, 4); hedr.writeUInt32LE(0x800, 8);
  const parts = [sub('HEDR', hedr)];
  masters.forEach((m) => { parts.push(sub('MAST', zs(m))); parts.push(sub('DATA', Buffer.alloc(8))); });
  return Buffer.concat([record('TES4', 0, 0, Buffer.concat(parts)), group('ALCH', recs)]);
}
const REPO = path.join(TMP, 'repo');
const GAME = path.join(TMP, 'Game', 'Data');
for (const d of ['scripts/dev', 'game/data', 'game/content', 'Profile/Default']) { fs.mkdirSync(path.join(REPO, d), { recursive: true }); }
fs.mkdirSync(GAME, { recursive: true });
for (const f of ['Build-FoodTable.js', 'OwnPlugins.js', 'GamemodeTables.js']) { fs.copyFileSync(path.join(DEV, f), path.join(REPO, 'scripts', 'dev', f)); }
fs.writeFileSync(path.join(GAME, 'Skyrim.esm'), plugin([], [alch(0x00064b3d, 'FoodSweetroll', 'Sweet Roll')]));
for (const m of ['Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']) { fs.writeFileSync(path.join(GAME, m), plugin(['Skyrim.esm'], [])); }
// The game folder's copy is an older release; the repository's has the tea.
fs.writeFileSync(path.join(GAME, 'Thornswood-Content.esp'), plugin(['Skyrim.esm'], [alch(0x01018004, 'ThornswoodOldStew', 'Old Stew')]));
fs.writeFileSync(path.join(REPO, 'game', 'content', 'Thornswood-Content.esp'), plugin(['Skyrim.esm'], [alch(0x01018001, 'ThornswoodTeaLavender', 'Lavender Tea')]));
const list = path.join(TMP, 'plugins.txt');
fs.writeFileSync(list, '*Thornswood-Content.esp\r\n');
const food = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-FoodTable.js'), '--data', GAME, '--plugins', list], { encoding: 'utf8' });
let items = {};
try { items = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'food.json'), 'utf8')).items; } catch (e) { items = {}; }
yes('F1 Build-FoodTable.js runs on a Data folder holding a stale content plugin (exit ' + food.status + ')', food.status === 0);
yes('F2 and the table is the repository\'s plugin: the tea is in it',
    !!items['18001:Thornswood-Content.esp'] && items['18001:Thornswood-Content.esp'].name === 'Lavender Tea');
yes('F3 and the game folder\'s older copy is not', !items['18004:Thornswood-Content.esp']);
if (food.status !== 0) { console.log(food.stdout + food.stderr); }

// ---------------------------------------------------------------- R
const builders = [];
for (const dir of ['scripts/dev', 'scripts/mods']) {
  for (const n of fs.readdirSync(path.join(ROOT, dir))) {
    if (/^(Build|Write|Audit)-.*\.(js|ps1|py)$/.test(n)) { builders.push(dir + '/' + n); }
  }
}
// A builder that reads a load order names a plugin list or the load order a
// table was built against.
const LOAD_ORDER = /plugins\.txt|PluginsTxt|PluginList|last-plugin\.json|npc-population\.json'?\)?\[?['"]loadOrder/;
// Or reads npc-population.json into a name and walks its loadOrder later, as
// Build-MerchantRetrievalSources.py does; the line above missed that one, so
// a content change left its table stale with no step to rebuild it (#2993).
const POPULATION_WALK = (src) => /npc-population\.json/.test(src) && /\[['"]loadOrder['"]\]|\.loadOrder\b/.test(src);
const readers = builders.filter((b) => LOAD_ORDER.test(read(b)) || POPULATION_WALK(read(b)));
const RAW = [
  /path\.join\(\s*(DATA|data|dataDir)\s*,\s*(pl|p|file|name|n|plugin)\s*\)/,
  /Join-Path\s+\$Data\s+\$(pl|p|plugin)\b/,
  /os\.path\.join\(\s*(args\.|a\.)?(data|data_dir)\s*,\s*(n|name|plugin|pl|row\[['"]name['"]\])\s*\)/
];
// Build-MerchantRoleTables.py writes the same rule out against its own ROOT,
// which its harness moves: own = ROOT / 'game/content' / name.
const SAME_RULE = { 'scripts/dev/Build-MerchantRoleTables.py': /own = ROOT \/ 'game\/content' \/ name\n\s+path = own if own\.is_file\(\) else data \/ name/ };
const raw = [];
for (const b of readers) {
  const src = read(b);
  if (SAME_RULE[b]) { if (!SAME_RULE[b].test(src)) { raw.push(b + ' (its own copy of the rule is gone)'); } continue; }
  src.split('\n').forEach((l, i) => { if (RAW.some((r) => r.test(l))) { raw.push(b + ':' + (i + 1) + ' ' + l.trim()); } });
}
yes('R1 ' + readers.length + ' builders read a load order, and none joins the Data folder with a plugin name itself' +
    (raw.length ? ' (' + raw.slice(0, 4).join('; ') + ')' : ''), readers.length >= 25 && raw.length === 0);
yes('R2 Build-FoodTable.js and Build-RecipeTable.ps1 read through the helper',
    /pluginPath\(DATA, file\)/.test(read('scripts/dev/Build-FoodTable.js')) &&
    (read('scripts/dev/Build-RecipeTable.ps1').match(/Get-PluginPath \$Data \$p/g) || []).length === 4);

// ---------------------------------------------------------------- C
const chain = JSON.parse(read('scripts/mods/content-tables.json'));
const steps = chain.steps || [];
const tools = steps.map((s) => s.tool);
const out = Object.keys(chain.notInChain || {});
yes('C1 every step is a builder in this checkout, once (' + steps.length + ')',
    steps.length > 0 && tools.every((t) => fs.existsSync(path.join(ROOT, t))) && new Set(tools).size === tools.length);
const missingFromChain = readers.filter((b) => tools.indexOf(b) < 0 && out.indexOf(b) < 0);
yes('C2 every builder that reads a load order is a step or is left out with its reason' +
    (missingFromChain.length ? ' (not: ' + missingFromChain.join(', ') + ')' : ''),
    missingFromChain.length === 0 && out.every((t) => fs.existsSync(path.join(ROOT, t)) && String(chain.notInChain[t]).length > 40));
const helperUsers = builders.filter((b) => /OwnPlugins\.(js|ps1)|import own_plugins/.test(read(b)));
yes('C3 and so is every builder that uses the helper (' + helperUsers.length + ')',
    helperUsers.every((b) => tools.indexOf(b) >= 0 || out.indexOf(b) >= 0));
const late = [];
steps.forEach((s, i) => {
  for (const r of s.reads || []) {
    steps.slice(i + 1).forEach((t) => { if ((t.writes || []).indexOf(r) >= 0) { late.push(s.tool + ' reads ' + r + ', which ' + t.tool + ' writes after it'); } });
  }
  for (const r of s.readsBack || []) {
    if (!steps.slice(i + 1).some((t) => (t.writes || []).indexOf(r) >= 0)) { late.push(s.tool + ' says a later step writes ' + r + ' back, and none does'); }
  }
});
yes('C4 no step reads a table a later step writes' + (late.length ? ' (' + late.slice(0, 3).join('; ') + ')' : ''), late.length === 0);
const unnamed = [];
for (const s of steps) {
  const src = read(s.tool);
  for (const f of (s.reads || []).concat(s.readsBack || [], s.uses || [], s.writes || [])) {
    // A gamemode table (#5191) is named in its builder by its constant's
    // name, which GamemodeTables turns into the file's.
    const named = /^game\/gamemode-tables\//.test(f) ? path.basename(f, '.json') : path.basename(f);
    if (src.indexOf(named) < 0) { unnamed.push(s.tool + ' ' + f); }
  }
}
yes('C5 each step\'s own source names every table it is said to read and write' + (unnamed.length ? ' (not: ' + unnamed.slice(0, 4).join('; ') + ')' : ''),
    unnamed.length === 0);
const flags = [];
for (const s of steps) {
  const src = read(s.tool);
  for (const k of ['data', 'plugins']) {
    if (s[k] && src.indexOf(s[k].replace(/^-(?!-)/, '$').replace(/^--/, '')) < 0) { flags.push(s.tool + ' ' + s[k]); }
  }
}
yes('C6 and takes the Data folder and plugin list by the names the list gives' + (flags.length ? ' (not: ' + flags.join('; ') + ')' : ''),
    flags.length === 0);
// #3425. The files of the repository a builder's source names: each run of
// string literals that are only joined to each other (path.join's commas,
// Python's '/', a single '..\\..\\game\\ui\\x.js'), read as a path with any
// leading ../ dropped, that starts in a folder of the repository's and is a
// file there. Under scripts the artifact carries scripts/mods, scripts/dev
// and what a builder loads (tests/test-2899-run-on-box.ps1 holds that), so
// scripts is not read here.
const TOPS = fs.readdirSync(ROOT).filter((n) => n !== 'scripts' && n[0] !== '.' && fs.statSync(path.join(ROOT, n)).isDirectory());
function namedFiles(src) {
  const lits = [];
  const re = /'([^'\r\n]*)'|"([^"\r\n]*)"/g;
  let m;
  while ((m = re.exec(src))) { lits.push({ v: m[1] !== undefined ? m[1] : m[2], s: m.index, e: re.lastIndex }); }
  const runs = [];
  lits.forEach((l, i) => {
    if (i && /^[\s,+/]*$/.test(src.slice(lits[i - 1].e, l.s))) { runs[runs.length - 1].push(l.v); } else { runs.push([l.v]); }
  });
  const found = new Set();
  for (const r of runs) {
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j <= r.length; j++) {
        let p = r.slice(i, j).join('/').replace(/\\+/g, '/').replace(/\/+/g, '/');
        while (/^\.\.?\//.test(p)) { p = p.replace(/^\.\.?\//, ''); }
        const parts = p.split('/');
        if (parts.length < 2 || TOPS.indexOf(parts[0]) < 0) { continue; }
        const full = path.join(ROOT, p);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) { found.add(p); }
      }
    }
  }
  return Array.from(found);
}
const SENT = ['game/content', 'game/data', 'records'];
const under = (f, list) => list.some((d) => f === d || f.indexOf(d + '/') === 0);
// Any step's: Write-SystemLists.js reads the spell ids Build-SpellTable.ps1
// writes into game/gamemode.js, which later steps write other tables into.
// And what a builder writes only by hand, with an option the chain does not
// give it (writesOffChain, #3120).
const listed = [].concat.apply([], steps.map((s) => (s.reads || []).concat(s.readsBack || [], s.uses || [], s.writes || [], s.writesOffChain || [])));
const notListed = [];
let named = 0;
for (const s of steps) {
  for (const f of namedFiles(read(s.tool))) {
    named++;
    if (!under(f, SENT) && !under(f, listed)) { notListed.push(s.tool + ' names ' + f); }
  }
}
yes('C9 every file of the repository a builder names outside scripts, game/content, game/data and records goes up in a step\'s list (' + named + ' named)' +
    (notListed.length ? ' (not: ' + notListed.slice(0, 4).join('; ') + ')' : ''), named > 0 && notListed.length === 0);
const spell = steps.filter((s) => s.tool === 'scripts/dev/Build-SpellTable.ps1')[0] || {};
yes('C10 the spell table step uses the K panel\'s book', (spell.uses || []).indexOf('game/ui/thornswood-skills.js') >= 0);
const written = [].concat.apply([], steps.map((s) => s.writes || []));
const badUses = [];
for (const s of steps) {
  for (const f of s.uses || []) {
    if (!fs.existsSync(path.join(ROOT, f)) || !fs.statSync(path.join(ROOT, f)).isFile()) { badUses.push(s.tool + ' uses ' + f + ', which is not a file here'); }
    if (under(f, written)) { badUses.push(s.tool + ' uses ' + f + ', which a step writes: that is a read'); }
    if (under(f, SENT) || /^scripts\//.test(f)) { badUses.push(s.tool + ' uses ' + f + ', which goes up anyway'); }
  }
}
yes('C11 each use is a file here that no step writes and the box would not get otherwise' + (badUses.length ? ' (' + badUses.slice(0, 3).join('; ') + ')' : ''),
    badUses.length === 0);

const script = read('scripts/mods/Rebuild-ContentTables.ps1');
yes('C7 Rebuild-ContentTables.ps1 runs content-tables.json and writes the register\'s hashes',
    /content-tables\.json/.test(script) && /asset-provenance\.json/.test(script));
const shell = run(['pwsh', 'powershell'], ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(ROOT, 'scripts', 'mods', 'Rebuild-ContentTables.ps1'), '-List', '-Data', DATA]);
if (!shell) {
  console.log('SKIP  C8: no PowerShell here');
} else {
  const said = shell.stdout;
  yes('C8 and -List names every step in order, with the Data folder, and runs nothing (exit ' + shell.status + ')',
      shell.status === 0 && tools.every((t, i) => said.indexOf((i + 1) + '. ' + t) >= 0) && /Nothing was run\./.test(said));
  if (shell.status !== 0) { console.log(said + shell.stderr); }
}

const recordedOrder = JSON.parse(read('game/data/npc-population.json')).loadOrder.map((r) => r.name);
const sameList = path.join(TMP, 'same-3105.txt');
fs.writeFileSync(sameList, recordedOrder.slice(5).map((n) => '*' + n).join('\r\n') + '\r\n');
const otherList = path.join(TMP, 'other-3105.txt');
fs.writeFileSync(otherList, recordedOrder.slice(5).filter((n) => n !== 'Thornswood-Last.esp').map((n) => '*' + n).join('\r\n') + '\r\n');
const listed3105 = run(['pwsh', 'powershell'], ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(ROOT, 'scripts', 'mods', 'Rebuild-ContentTables.ps1'), '-List', '-Data', DATA, '-PluginsTxt', sameList]);
const refused3105 = run(['pwsh', 'powershell'], ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(ROOT, 'scripts', 'mods', 'Rebuild-ContentTables.ps1'), '-List', '-Data', DATA, '-PluginsTxt', otherList]);
if (!listed3105 || !refused3105) {
  console.log('SKIP  C12-C13: no PowerShell here');
} else {
  yes('C12 #3105: every builder that takes a plugin list is given the load order npc-population.json records (' + recordedOrder.length + '), not a profile\'s',
      listed3105.status === 0 && listed3105.stdout.indexOf(js.loadOrderName(recordedOrder)) >= 0 &&
      steps.filter((s) => s.plugins).every((s) => new RegExp(s.plugins.replace(/[-]/g, '\\-') + ' \\S*thornswood-loadorder-[0-9a-f]{12}[\\\\/]plugins\\.txt').test(listed3105.stdout)));
  // PowerShell prints a throw in its error view: colour codes, a "|" gutter,
  // and on Windows the message folded at the console's width, between words or
  // inside one. The sentence is read with those and every space taken out.
  const refusal = (refused3105.stdout + refused3105.stderr).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r?\n\s*\|/g, '').replace(/\s+/g, '');
  const c13 = refused3105.status !== 0 && /isnottheloadordergame.data.npc-population\.jsonrecords/.test(refusal) &&
      /Thornswood-Last\.esp/.test(refusal);
  yes('C13 and a -PluginsTxt that is not that load order stops the run before any builder, naming where they part', c13);
  if (!c13) { console.log('      exit ' + refused3105.status + ': ' + JSON.stringify(refused3105.stdout + refused3105.stderr).slice(0, 3000)); }
}

// ---------------------------------------------------------------- N
const naming = ['tests/test-2468-last-plugin.js', 'tests/test-2551-building-holds.js', 'tests/test-516-woodworking-benches.js',
  'tests/test-asset-provenance.js', 'docs/systems/station-placement.md', 'docs/guide/make-a-change.md'];
const silent = naming.filter((f) => read(f).indexOf('Rebuild-ContentTables.ps1') < 0);
yes('N1 the harnesses that hold a table to the plugin\'s bytes, and the docs, name the script' + (silent.length ? ' (not: ' + silent.join(', ') + ')' : ''),
    silent.length === 0);

// ---------------------------------------------------------------- L
// The shape of One's Default\plugins.txt on 20 Oct, cut down: ElysiumEstateSSE.esp
// switched off with its file gone, the live ElysiumEstate.esp switched on, and
// a byte order mark, a comment, a master written into the list, a name twice in
// two cases and a switched off line for a plugin that is also switched on.
const LIST = path.join(TMP, 'plugins-2976.txt');
fs.writeFileSync(LIST, '\ufeff# This file is used by Skyrim to keep track of your downloaded content.\r\n' +
  '*Skyrim.esm\r\n*Unofficial Skyrim Special Edition Patch.esp\r\nCBBE.esp\r\n*ElysiumEstate.esp\r\n' +
  '\r\nElysiumEstateSSE.esp\r\n*elysiumestate.esp\r\n  *Thornswood-Content.esp  \r\nThornswood-Content.esp\r\nCBBE.esp\r\n');
const WANT_ON = js.MASTERS.concat(['Unofficial Skyrim Special Edition Patch.esp', 'ElysiumEstate.esp', 'Thornswood-Content.esp']);
const WANT_OFF = ['CBBE.esp', 'ElysiumEstateSSE.esp'];
yes('L1 OwnPlugins.js reads the five masters and then each switched on line, once',
    JSON.stringify(js.loadOrder(LIST)) === JSON.stringify(WANT_ON));
yes('L2 and names the switched off lines, none of them loaded', JSON.stringify(js.switchedOff(LIST)) === JSON.stringify(WANT_OFF));
const pyL = run(['python', 'py', 'python3'], ['-c',
  'import json, sys; sys.path.insert(0, sys.argv[1]); import own_plugins\n' +
  'on, off = own_plugins.read_plugins_txt(sys.argv[2])\n' +
  'print(json.dumps([own_plugins.MASTERS, own_plugins.load_order(sys.argv[2]), on, off, own_plugins.switched_off(sys.argv[2])]))', DEV, LIST]);
if (!pyL) {
  console.log('SKIP  L3: no python here');
} else {
  let got = null;
  try { got = JSON.parse(pyL.stdout); } catch (e) { got = null; }
  yes('L3 own_plugins.py says the same', !!got && JSON.stringify(got) ===
      JSON.stringify([js.MASTERS, WANT_ON, WANT_ON, WANT_OFF, WANT_OFF]));
  if (!got) { console.log(pyL.stdout + pyL.stderr); }
}
const asksL = path.join(TMP, 'asks-2976.ps1');
fs.writeFileSync(asksL, 'param([string]$Dev, [string]$List)\n' +
  '. (Join-Path $Dev \'OwnPlugins.ps1\')\n' +
  'ConvertTo-Json -Compress -InputObject @(@(Get-LoadOrder $List), @(Get-SwitchedOff $List))\n');
const psL = run(['pwsh', 'powershell'], ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', asksL, '-Dev', DEV, '-List', LIST]);
if (!psL) {
  console.log('SKIP  L4: no PowerShell here');
} else {
  let got = null;
  try { got = JSON.parse(psL.stdout); } catch (e) { got = null; }
  yes('L4 OwnPlugins.ps1 says the same', !!got && JSON.stringify(got) === JSON.stringify([WANT_ON, WANT_OFF]));
  if (!got || JSON.stringify(got[0]) !== JSON.stringify(WANT_ON)) { console.log(psL.stdout + psL.stderr); }
}
// A builder that parses plugins.txt itself tests a line for its leading '*'.
const STAR = [/startswith\(\s*['"]\*['"]\s*\)/i, /\[0\]\s*[!=]==?\s*['"]\*['"]/, /charAt\(0\)\s*[!=]==?\s*['"]\*['"]/];
const parsers = [];
for (const dir of ['scripts/dev', 'scripts/mods']) {
  for (const n of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/^(Build|Write|Audit|Measure)-.*\.(js|ps1|py)$/.test(n)) { continue; }
    read(dir + '/' + n).split('\n').forEach((l, i) => { if (STAR.some((r) => r.test(l))) { parsers.push(dir + '/' + n + ':' + (i + 1)); } });
  }
}
yes('L5 no builder reads plugins.txt\'s lines itself; each takes its load order from the helper' +
    (parsers.length ? ' (' + parsers.slice(0, 6).join(', ') + ')' : ''), parsers.length === 0);

// ---------------------------------------------------------------- O
const NAMED = js.MASTERS.concat(['Unofficial Skyrim Special Edition Patch.esp', 'Thornswood-Content.esp', 'Thornswood-Last.esp']);
const jsName = js.loadOrderName(NAMED);
yes('O1 OwnPlugins.js names a load order by its count and the sha256 of its names: ' + jsName,
    new RegExp('^' + NAMED.length + ' plugins in load order \\(names sha256 [0-9a-f]{12}\\)$').test(jsName) &&
    jsName.indexOf(require('crypto').createHash('sha256').update(NAMED.join('\n')).digest('hex').slice(0, 12)) > 0 &&
    js.loadOrderName(NAMED.slice().reverse()) !== jsName);
const pyO = run(['python', 'py', 'python3'], ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import own_plugins\n' +
  'print(own_plugins.load_order_name(sys.argv[2:]))', DEV].concat(NAMED));
if (!pyO) { console.log('SKIP  O2: no python here'); } else { yes('O2 own_plugins.py names it the same', pyO.status === 0 && pyO.stdout.trim() === jsName); }
const asksO = path.join(TMP, 'asks-3105.ps1');
fs.writeFileSync(asksO, 'param([string]$Dev, [string]$Names)\n. (Join-Path $Dev \'OwnPlugins.ps1\')\nGet-LoadOrderName ($Names -split \'\\|\')\n');
const psO = run(['pwsh', 'powershell'], ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', asksO, '-Dev', DEV, '-Names', NAMED.join('|')]);
if (!psO) { console.log('SKIP  O3: no PowerShell here'); } else { yes('O3 OwnPlugins.ps1 names it the same', psO.status === 0 && psO.stdout.trim() === jsName); }
// A table's own line naming its source: readFrom, or source. The plugin list
// a builder was given is args.plugins, $PluginList, $PluginsTxt or PLUGINS.
const LIST_VAR = /args\.plugins|\$PluginList\b|\$PluginsTxt\b|\bPLUGINS\b|pluginsTxt\b/;
const pathInTable = [];
for (const t of tools.concat(['scripts/dev/Measure-MineBuildings.py'])) {
  read(t).split('\n').forEach((l, i) => { if (/readFrom|['"]source['"]|\bsource:/.test(l) && LIST_VAR.test(l)) { pathInTable.push(t + ':' + (i + 1)); } });
}
yes('O4 no builder writes the plugin list it was given into its table' + (pathInTable.length ? ' (' + pathInTable.join(', ') + ')' : ''), pathInTable.length === 0);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
