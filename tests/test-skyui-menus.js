// test-skyui-menus.js
//
// scripts\mods\Check-SkyUIMenus.js, driven against game folders this builds
// for itself, then Ship.ps1's step that runs it, then this machine's dev game.
//
// Issue #960, 28 September: dev showed "SKYUI ERROR CODE 6", menu file version
// mismatch for magicmenu.swf, skyui/itemcard.swf, skyui/bottombar.swf and
// map.swf, "required 5.2 SE, detected 6.11 SE". SkyUI 5.2's scripts were loose
// in Data\Scripts over the collection's SkyUI, whose menus are 6.11 SE inside
// SkyUI_SE.bsa. Done when the check fails a Ship while SkyUI's menus carry a
// different version from the one its script expects.
//
// Every shape it reads is built here byte by byte: a compiled script, Flash
// movies stored and zlib compressed, Special Edition archives with LZ4 and
// stored files. Then it checks the check wrote nothing.
//
// Read only apart from its own temp folder, which it removes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0, skip = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skipped(what) { skip++; console.log('SKIP  ' + what); }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
  process.exit(fail ? 1 : 0);
}

const SCRIPT = path.join(REPO, 'scripts', 'mods', 'Check-SkyUIMenus.js');
let C = null;
try { C = require(SCRIPT); } catch (e) { console.log('      ' + e.message); }
yes('scripts\\mods\\Check-SkyUIMenus.js is there and loads', !!C);
if (!C) { done(); }

// ------------------------------------------------------------------ bytes

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function bu16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function bu32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function bstr(s) { return Buffer.concat([bu16(s.length), Buffer.from(s, 'latin1')]); }
function zs(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]); }

/* A ski_main.pex whose string table holds `extra`, built at `secs`. */
function pex(extra, secs) {
  const table = ['SKI_Main', 'SKI_QuestBase', 'OnInit', ''].concat(extra);
  return Buffer.concat([
    bu32(0xfa57c0de), Buffer.from([3, 2]), bu16(1), bu32(0), bu32(secs || 0),
    bstr('SKI_Main.psc'), bstr('someone'), bstr('SOMEPC'),
    bu16(table.length)].concat(table.map(bstr)).concat([
    Buffer.from([0]),
    bu16(0),
    bu16(1), bu16(0), bu32(40), bu16(1), bu16(3), bu32(0), bu16(3),
    Buffer.alloc(24)
  ]));
}
const MENUS = ['magicmenu.swf', 'skyui/itemcard.swf', 'map.swf'];
function oldScript() {
  return pex(['5.2 SE', 'Menu file version mismatch for ', 'Required version: ', 'Detected version: '].concat(MENUS), 1507000000);
}
function newScript() { return pex(['6.11 SE', 'CheckVersion'], 1775450000); }
function checkingNew() {
  return pex(['6.11 SE', 'Menu file version mismatch for '].concat(MENUS), 1775450000);
}

/* A Flash movie holding the SkyUI constants and version `v`, stored or zlib. */
function swf(v, compressed, notSkyUI) {
  const body = Buffer.concat([
    Buffer.from([0x78, 0x00, 0x05, 0x5f, 0x00, 0x00, 0x0f, 0xa0, 0x00, 0x00, 0x18, 0x01, 0x00]),
    notSkyUI ? zs('someoneElsesMenu') : Buffer.concat([zs('SKYUI_RELEASE_IDX'), zs('SKYUI_VERSION_STRING'), zs(v)]),
    zs('ASSetPropFlags'), Buffer.alloc(8)
  ]);
  const len = u32(8 + body.length);
  if (compressed) { return Buffer.concat([Buffer.from('CWS'), Buffer.from([8]), len, zlib.deflateSync(body)]); }
  return Buffer.concat([Buffer.from('FWS'), Buffer.from([8]), len, body]);
}

/* LZ4 with no copies at all is still LZ4: one block of literals. */
function lz4Literals(data) {
  const n = data.length;
  const head = [];
  if (n < 15) { head.push(n << 4); }
  else { head.push(0xf0); let r = n - 15; while (r >= 255) { head.push(255); r -= 255; } head.push(r); }
  const block = Buffer.concat([Buffer.from(head), data]);
  return Buffer.concat([u32(0x184d2204), Buffer.from([0x60, 0x40, 0x82]), u32(block.length), block, u32(0)]);
}

/* A version 105 archive, compressed by default. files: { 'folder\\leaf': bytes }. */
function bsa(files) {
  const flags = 0x1 | 0x2 | 0x4;
  const folders = [];
  Object.keys(files).forEach(function (k) {
    const at = k.lastIndexOf('\\');
    const name = k.slice(0, at), leaf = k.slice(at + 1);
    let fo = folders.filter(function (x) { return x.name === name; })[0];
    if (!fo) { fo = { name: name, files: [] }; folders.push(fo); }
    fo.files.push({ name: leaf, data: files[k] });
  });
  const all = [];
  folders.forEach(function (fo) { fo.files.forEach(function (f) { all.push(f); }); });
  const folderNamesLen = folders.reduce(function (s, fo) { return s + fo.name.length + 1; }, 0);
  const fileNamesLen = all.reduce(function (s, f) { return s + f.name.length + 1; }, 0);
  const blockAt = 36 + folders.length * 24;
  let dataAt = blockAt + folders.length + folderNamesLen + all.length * 16 + fileNamesLen;
  const bodies = all.map(function (f, i) {
    // Every other file stored, by flipping the archive's default for it.
    const flip = i % 2 === 1;
    const body = flip ? f.data : Buffer.concat([u32(f.data.length), lz4Literals(f.data)]);
    const at = dataAt; dataAt += body.length;
    return { body: body, at: at, size: body.length | (flip ? 0x40000000 : 0) };
  });
  const recs = [], blocks = [];
  let q = blockAt, k = 0;
  folders.forEach(function (fo) {
    recs.push(Buffer.alloc(8), u32(fo.files.length), u32(0), u32(q + fileNamesLen), u32(0));
    blocks.push(Buffer.from([fo.name.length + 1]), zs(fo.name));
    q += 1 + fo.name.length + 1;
    fo.files.forEach(function () {
      blocks.push(Buffer.alloc(8), u32(bodies[k].size), u32(bodies[k].at));
      q += 16; k++;
    });
  });
  const header = Buffer.concat([Buffer.from('BSA\u0000', 'latin1'), u32(105), u32(36), u32(flags),
    u32(folders.length), u32(all.length), u32(folderNamesLen), u32(fileNamesLen), u32(0)]);
  return Buffer.concat([header].concat(recs, blocks, all.map(function (f) { return zs(f.name); }),
    bodies.map(function (b) { return b.body; })));
}

/* The collection's SkyUI: a script that checks nothing, 6.11 menus. */
function skyuiArchive(script, v) {
  return bsa({
    'scripts\\ski_main.pex': script || newScript(),
    'interface\\magicmenu.swf': swf(v || '6.11 SE', true),
    'interface\\map.swf': swf(v || '6.11 SE', false),
    'interface\\skyui\\itemcard.swf': swf(v || '6.11 SE', true)
  });
}

// ------------------------------------------------------------------ folders

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-skyui-'));
let n = 0;
function game(files, order) {
  const root = path.join(TMP, 'g' + (n++));
  const data = path.join(root, 'Data');
  // rel names folders with \ the way the game does; split, so Linux makes
  // the folders too rather than one file with \ in its name (#3005).
  Object.keys(files).forEach(function (rel) {
    const f = path.join.apply(path, [data].concat(rel.split('\\')));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, files[rel]);
  });
  fs.mkdirSync(data, { recursive: true });
  const plugins = path.join(root, 'plugins.txt');
  fs.writeFileSync(plugins, (order || ['SkyUI_SE.esp']).map(function (p) { return '*' + p; }).join('\r\n') + '\r\n');
  return { data: data, plugins: plugins };
}
function run(g, gone) {
  const args = [SCRIPT, '--data', g.data, '--plugins', g.plugins];
  if (gone) { args.push('--gone', gone.join(';')); }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function stamp(dir) {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d).forEach(function (f) {
      const p = path.join(d, f), s = fs.statSync(p);
      if (s.isDirectory()) { walk(p); } else { out.push(p + '|' + s.size + '|' + s.mtimeMs); }
    });
  })(dir);
  return out.sort().join('\n');
}

try {
  // 1. What dev had: SkyUI 5.2's ski_main loose over the collection's SkyUI.
  const g1 = game({ 'SkyUI_SE.bsa': skyuiArchive(), 'SkyUI_SE.esp': Buffer.alloc(8), 'Scripts\\ski_main.pex': oldScript() });
  const before = stamp(g1.data);
  let r = run(g1);
  yes('the loose 5.2 script over 6.11 menus is exit 2 (got ' + r.code + ')', r.code === 2);
  yes('  it names each menu with its version, where it came from and what the script wants',
    /WRONG\s+magicmenu\.swf\s+6\.11 SE, SkyUI_SE\.bsa; SkyUI's script wants 5\.2 SE/.test(r.out) &&
    /WRONG\s+skyui\/itemcard\.swf\s+6\.11 SE/.test(r.out) && /WRONG\s+map\.swf\s+6\.11 SE/.test(r.out));
  yes('  it reads a stored menu and a zlib one, from an LZ4 file and a stored one in the archive', (r.out.match(/^\s+WRONG\s/gm) || []).length === 3);
  yes('  it says the script is loose, built 2017, and hides the archive\'s', /loose in Data\\Scripts, built 2017-10-0\d/.test(r.out) && /hides the one in SkyUI_SE\.bsa/.test(r.out));
  yes('  and that the archive\'s one checks no menu versions', /which checks no menu versions/.test(r.out));
  yes('  and what to do: take the loose scripts out', /Take the loose SkyUI scripts out of Data\\Scripts/.test(r.out));
  yes('  it never says player', !/player/i.test(r.out));
  yes('  and wrote nothing in the game folder', stamp(g1.data) === before);
  const g1b = game({ 'SkyUI_SE.bsa': skyuiArchive(), 'SkyUI_SE.esp': Buffer.alloc(8), 'scripts\\SKI_Main.PEX': oldScript() });
  r = run(g1b);
  yes('  a loose script is found whatever the case of its folder and name, as Windows finds it (got ' + r.code + ')',
    r.code === 2 && /loose in Data\\Scripts/.test(r.out));

  // 2. The same folder once a release has deleted the loose script.
  r = run(g1, ['Data\\Scripts\\ski_main.pex']);
  yes('with the loose script on the release\'s delete list it is exit 0 (got ' + r.code + ')', r.code === 0);
  yes('  because the archive\'s script checks no menu versions', /does not compare menu versions/.test(r.out));
  r = run(g1, ['data/scripts/SKI_MAIN.PEX']);
  yes('  the delete list is read in any case and either slash', r.code === 0);

  // 3. A SkyUI whose script checks, and whose menus match it.
  const g3 = game({ 'SkyUI_SE.bsa': skyuiArchive(checkingNew()) });
  r = run(g3);
  yes('a script and menus of one release are exit 0 (got ' + r.code + ')', r.code === 0 && /Every menu SkyUI checks is 6\.11 SE/.test(r.out));

  // 4. Another mod ships one menu loose over SkyUI's.
  const g4 = game({ 'SkyUI_SE.bsa': skyuiArchive(checkingNew()), 'Interface\\magicmenu.swf': swf('5.2 SE') });
  r = run(g4);
  yes('a loose menu of another release over SkyUI\'s is exit 2 (got ' + r.code + ')', r.code === 2 &&
    /WRONG\s+magicmenu\.swf\s+5\.2 SE, loose in Data\\Interface/.test(r.out));
  yes('  and only that menu is named', (r.out.match(/^\s+WRONG\s/gm) || []).length === 1);
  yes('  and it says which conflict to settle in Vortex', /set SkyUI to win that conflict in Vortex/.test(r.out));

  // 5. Archive against archive: the later plugin's wins.
  const other = bsa({ 'interface\\skyui\\itemcard.swf': swf('5.4 SE') });
  const g5 = game({ 'SkyUI_SE.bsa': skyuiArchive(checkingNew()), 'Other.bsa': other }, ['SkyUI_SE.esp', 'Other.esp']);
  r = run(g5);
  yes('another archive loaded after SkyUI\'s wins, and is exit 2 (got ' + r.code + ')', r.code === 2 && /WRONG\s+skyui\/itemcard\.swf\s+5\.4 SE, Other\.bsa/.test(r.out));
  fs.writeFileSync(g5.plugins, '*Other.esp\r\n*SkyUI_SE.esp\r\n');
  r = run(g5);
  yes('  loaded before SkyUI\'s it loses, and is exit 0 (got ' + r.code + ')', r.code === 0);
  fs.writeFileSync(g5.plugins, '*SkyUI_SE.esp\r\n*Other.esp\r\n');
  fs.renameSync(path.join(g5.data, 'Other.bsa'), path.join(g5.data, 'Other - Interface.bsa'));
  r = run(g5);
  yes('  an archive named "<plugin> - something" loads with its plugin', r.code === 2 && /Other - Interface\.bsa/.test(r.out));

  // 6. A menu that is not SkyUI's at all, the loose map.swf of 22 September.
  const g6 = game({ 'SkyUI_SE.bsa': skyuiArchive(checkingNew()), 'Interface\\map.swf': swf('', false, true) });
  r = run(g6);
  yes('a menu with no SkyUI marker over SkyUI\'s is exit 2 (got ' + r.code + ')', r.code === 2 && /WRONG\s+map\.swf\s+not SkyUI's menu at all/.test(r.out));

  // 7. A menu the script checks that nothing provides.
  const g7 = game({ 'SkyUI_SE.bsa': bsa({ 'scripts\\ski_main.pex': checkingNew(), 'interface\\magicmenu.swf': swf('6.11 SE') }) });
  r = run(g7);
  yes('a menu the script checks that is nowhere is exit 2 (got ' + r.code + ')', r.code === 2 && /WRONG\s+map\.swf\s+not in the game folder or any archive/.test(r.out));

  // 8. No SkyUI.
  const g8 = game({ 'Other.bsa': other }, ['Other.esp']);
  r = run(g8);
  yes('no SkyUI at all is exit 0 (got ' + r.code + ')', r.code === 0 && /SkyUI is not in this game folder/.test(r.out));

  // 9. Unreadable.
  const g9 = game({ 'SkyUI_SE.bsa': skyuiArchive(checkingNew()), 'Interface\\map.swf': Buffer.from('GIF89a not a movie') });
  r = run(g9);
  yes('a menu that is not a movie is exit 1, not a pass (got ' + r.code + ')', r.code === 1 && /UNREAD\s+map\.swf/.test(r.out));
  const g9b = game({ 'SkyUI_SE.bsa': skyuiArchive(), 'Scripts\\ski_main.pex': Buffer.from('not a script') });
  r = run(g9b);
  yes('a ski_main that is not a script is exit 1 (got ' + r.code + ')', r.code === 1);
  r = run({ data: path.join(TMP, 'nowhere'), plugins: g1.plugins });
  yes('no Data folder is exit 1 (got ' + r.code + ')', r.code === 1);

  // 10. --quiet prints only what is wrong.
  const q = spawnSync(process.execPath, [SCRIPT, '--data', g3.data, '--plugins', g3.plugins, '--quiet'], { encoding: 'utf8' });
  yes('--quiet leaves the ok lines out', q.status === 0 && !/\bok\s+magicmenu/.test(q.stdout));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ------------------------------------------------------------------ the rules

function read(p) { try { return fs.readFileSync(path.join(REPO, p), 'utf8'); } catch (e) { return ''; } }
const rules = read('scripts/release/Ship-Rules.ps1');
const block = /\$ShipOldSkyUIScripts = @\(([\s\S]*?)\n\)/.exec(rules);
const oldScripts = block ? (block[1].match(/'Data\\Scripts\\[^']+'/g) || []).map(function (s) { return s.slice(1, -1); }) : [];
yes('Ship-Rules.ps1 lists SkyUI 5.2\'s ten loose scripts', oldScripts.length === 10 && oldScripts.indexOf('Data\\Scripts\\ski_main.pex') !== -1);
yes('  and not MCM Recorder\'s SKI_ConfigBase or SKI_ConfigManager', !oldScripts.some(function (s) { return /ski_config(base|manager)\.pex$/i.test(s); }));
yes('  Test-ShipOtherServer leaves them out of packs', /if \(\$ShipOldSkyUIScripts -contains \$rel\) \{ return \$true \}/.test(rules));
yes('  and every pack deletes them', /\$ShipDeleteAlways \+= \$ShipOldSkyUIScripts/.test(rules));
const og = read('launcher/app/OwnGame.cs');
const leaves = oldScripts.map(function (s) { return s.replace(/^Data\\Scripts\\ski_/, '').replace(/\.pex$/, ''); });
const ogRule = /ski_\(([a-z_|]+)\)\\\.pex\$/.exec(og);
yes('OwnGame.Foreign leaves the same ten out of a refresh', !!ogRule &&
  ogRule[1].split('|').sort().join(',') === leaves.slice().sort().join(','));
const rulesNum = /const int Rules = (\d+);/.exec(og);
yes('  and OwnGame.Rules moved to 8 for it, so every folder refreshes once', !!rulesNum && +rulesNum[1] >= 8 && /\/\/\/ 8: SkyUI 5\.2's ten loose scripts/.test(og));

const ship = read('scripts/release/Ship.ps1');
const at = ship.indexOf("Head 'SkyUI menus'");
// The step is the statement after its Head line, read by PowerShell's own
// parser so it ends where the step ends however long it grows. A window of
// so many characters after the Head line lost the node line once a comment
// pushed it past the window (#3020).
function shipStep(head) {
  const find = "$e = $null; $t = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:TS_SHIP, [ref]$t, [ref]$e); " +
    "if ($e -and $e.Count) { 'PARSE ' + $e[0].Message; exit 1 }; " +
    "$h = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.PipelineAst] -and $n.Extent.Text -ceq $env:TS_HEAD }, $true)); " +
    "if ($h.Count -ne 1) { 'HEADS ' + $h.Count; exit 1 }; " +
    "$list = @($h[0].Parent.Statements); $i = [array]::IndexOf($list, $h[0]); " +
    "if ($i -lt 0 -or $i + 1 -ge $list.Count) { 'NO STATEMENT AFTER IT'; exit 1 }; " +
    "[Console]::Out.Write($list[$i + 1].Extent.Text); exit 0";
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', find], {
    encoding: 'utf8', env: Object.assign({}, process.env, { TS_SHIP: path.join(REPO, 'scripts', 'release', 'Ship.ps1'), TS_HEAD: head })
  });
  if (r.status !== 0) { console.log('      reading ' + head + ' in Ship.ps1: ' + (r.error ? r.error.message : (r.stdout + r.stderr).trim())); return ''; }
  return r.stdout;
}
const step = at >= 0 ? shipStep("Head 'SkyUI menus'") : '';
yes('Ship.ps1 has a SkyUI menus step', at > 0);
yes('  read whole as the statement after its Head line, by PowerShell\'s parser', /^if \(\$FromFeed( -and \$revMoveFrom)?\) \{/.test(step) && /\}\s*$/.test(step));
// A release from the feed that moves the revision runs the same check on the
// box's store of the revision, with our files over it (#4069).
yes('  a move from the feed runs it too, on the revision\'s own files from the box\'s store',
  /^if \(\$FromFeed -and \$revMoveFrom\) \{/.test(step) && /Check-SkyUIMenus\.js'\) --data \$skyuiData --plugins \$skyuiPlugins --gone \(@\(Get-ShipDeleteAlways\) -join ';'\)/.test(step) &&
  /\$skyuiStore\.Menus/.test(step));
yes('  it runs Check-SkyUIMenus.js on the game folder with the order Ship ships',
  /Check-SkyUIMenus\.js'\) --data \(Join-Path \$GameDir 'Data'\) --plugins \$skyuiPlugins/.test(step) && /Get-ShipLoadOrderDir/.test(step));
yes('  it reads the paths every pack deletes as gone', /--gone \(@\(Get-ShipDeleteAlways\) -join ';'\)/.test(step));
// No source file holds the launcher's number since #4825, so there is nothing
// to put back before it stops.
yes('  it refuses on exit 2, dev and main alike',
  /if \(\$skyuiExit -eq 2\) \{\s*Die /.test(step) && !/\$Dev/.test(step) && !/\bUnbump\b/.test(step));
yes('  and it reads the exit code off the global one', /\$global:LASTEXITCODE = 0/.test(step));
const bodies = ship.indexOf("Head 'Animation and body files'");
const pub = ship.indexOf('Publish-Update.ps1', at + 1);
yes('  it comes after the load order copies and before anything is published',
  at > ship.indexOf("Head 'The load order copies'") && at > bodies && (pub < 0 || pub > at));

// ------------------------------------------------------------------ this machine

const dev = 'C:\\Thornswood-DevBuild';
const devPlugins = path.join(dev, 'Profile', 'OwnGame', 'plugins.txt');
if (fs.existsSync(path.join(dev, 'Game', 'Data', 'SkyUI_SE.bsa')) && fs.existsSync(devPlugins)) {
  const g = { data: path.join(dev, 'Game', 'Data'), plugins: devPlugins };
  const always = ['Data\\Interface\\map.swf'].concat(oldScripts);
  const r = run(g, always);
  yes('the dev game folder, once this release deletes the old scripts, has no SkyUI mismatch (exit ' + r.code + ')', r.code === 0);
  const now = run(g);
  if (now.code === 2) { skipped('the dev game folder still has SkyUI 5.2\'s scripts loose until a pack with this change is applied'); }
  else { yes('the dev game folder has no SkyUI mismatch today (exit ' + now.code + ')', now.code === 0); }
} else {
  skipped('no dev game folder with SkyUI at ' + dev);
}

done();
