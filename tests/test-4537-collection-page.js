// test-4537-collection-page.js
//
//   node tests/test-4537-collection-page.js
//
// Issue #4537. The collection's Nexus page named Start On Save, which the
// build keeps out because it crashed the game, called the server's own needs
// a mod's, said 1.6.1170 "only" and that plugins are compared by name and
// position, and set its section titles as plain lines. Nothing kept the text
// in the repository: New-NexusRevision built each revision from the one
// before it, so the description and install steps went out again as the last
// revision had them, held to nothing.
//
// What it holds:
//   1. records/collection-page.json keeps the page: summary, description and
//      install steps, each mod it names written [[said|modId]];
//   2. scripts/release/collection-page.js finds no problem with it against
//      records/collection.json, and the page follows the record's revision;
//   3. the check fails while the page names a mod the record does not
//      install, says what notSaid lists, sets a title as a plain line, or
//      lags the record's revision;
//   4. nexus-collection.js sends the page it is given, its marks made plain,
//      in collection.json and the payload, and refuses one that names a mod
//      the new revision does not install, writing nothing;
//   5. New-NexusRevision always hands it the page, and stops without one.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\ufeff/, '')); }
function finish() { console.log(''); console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0; }

// ---- 1. the kept page ---------------------------------------------------------
const pageRel = 'records/collection-page.json';
const libRel = 'scripts/release/collection-page.js';
let page = null, lib = null;
try { page = readJson(pageRel); } catch (e) { /* named below */ }
yes('1. ' + pageRel + ' is there and reads as JSON', page !== null);
try { lib = require(path.join(ROOT, libRel)); } catch (e) { /* named below */ }
yes('1. ' + libRel + ' is there and loads', lib !== null);
const have = lib && ['problems', 'render', 'marks', 'sendable'].every(f => typeof lib[f] === 'function');
yes('1. it gives problems, render, marks and sendable', !!have);
if (!page || !have) { finish(); return; }

const record = readJson('records/collection.json');
yes('1. the page keeps a summary, a description and install steps',
  typeof page.summary === 'string' && page.summary.trim() !== '' && typeof page.description === 'string' && page.description.trim() !== '' &&
  typeof page.installInstructions === 'string');
const named = lib.marks(page.description);
yes('1. the description names its mods by mark (' + named.length + ')', named.length >= 20);

// ---- 2. the real page against the real record ---------------------------------
const real = lib.problems(page, record);
real.forEach(p => console.log('      ' + p));
yes('2. the kept page has no problem against records/collection.json', real.length === 0);
yes('2. it follows the record\'s revision (' + page.revision + ', ' + record.revision + ')', page.revision === record.revision && page.collection === record.collection);
const plain = lib.render(page.description);
yes('2. made plain, no mark is left', !/\[\[|\]\]/.test(plain) && plain.indexOf('SkyUI') >= 0);
yes('2. it says none of what the live page got wrong', !/Start On Save|\bTempt\b|1\.6\.1170 only|by name and position/i.test(plain + page.summary + page.installInstructions));

// ---- 3. what the check catches ------------------------------------------------
function copy() { return JSON.parse(JSON.stringify(page)); }
let c = copy();
c.description += '\n\n- Also [[A Mod That Left|999999]].';
let ps = lib.problems(c, record);
yes('3. a mark naming a mod the record does not install is a problem, naming it', ps.some(p => /A Mod That Left/.test(p) && /999999/.test(p)));
c = copy();
c.description += '\n\nStart On Save comes with it.';
ps = lib.problems(c, record);
yes('3. saying what notSaid lists is a problem, with its reason', ps.some(p => /Start On Save/.test(p)) && (page.notSaid || []).some(n => /Start On Save/i.test(n.said)));
c = copy();
c.description += '\n\nMain features\n\nSomething.';
ps = lib.problems(c, record);
yes('3. a section title written as a plain line is a problem', ps.some(p => /Main features/.test(p)));
// Issue #4234: a screen reader reads a bare address out letter by letter,
// and nothing says where it goes. The description links with words.
c = copy();
c.description += '\n\nGet the launcher from https://example.net and open it.';
ps = lib.problems(c, record);
yes('3. a bare address in the description is a problem, naming its line', ps.some(p => /bare address/.test(p) && /https:\/\/example\.net/.test(p)));
c = copy();
c.description += '\n\nSee <https://example.net> for more.';
ps = lib.problems(c, record);
yes('3. so is one in angle brackets, which shows as the address too', ps.some(p => /bare address/.test(p)));
c = copy();
c.description += '\n\nGet [the Thornswood launcher](https://example.net) and open it.';
ps = lib.problems(c, record);
yes('3. a link with words for its text is not', !ps.some(p => /bare address/.test(p)));
c = copy();
c.description += '\n\nRecommended specs\n\n- A GPU.';
ps = lib.problems(c, record);
yes('3. a section name from the old page set as a plain line is a problem too', ps.some(p => /Recommended specs/.test(p)));
yes('3. the kept description gives no address bare', !/(^|[^(<])https?:\/\//m.test(plain.replace(/\]\(https?:\/\/[^)\s]+\)/g, ']()')));
yes('3. and does not say "pins" or "pin list" with nothing to say what they are', !/\bpins?\b|pin list/i.test(plain + page.installInstructions));
c = copy();
c.revision = record.revision - 1;
ps = lib.problems(c, record);
yes('3. a page behind the record\'s revision is a problem', ps.some(p => /revision/.test(p)));
c = copy();
c.installInstructions = 'Run [[Nobody|424242]] first.';
ps = lib.problems(c, record);
yes('3. the install steps are held the same way', ps.some(p => /424242/.test(p)));

// ---- 4. nexus-collection.js sends the page -------------------------------------
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4537-'));
try {
  const js = path.join(ROOT, 'scripts', 'release', 'nexus-collection.js');
  const col = {
    info: { author: 'EvilPatrick06', authorUrl: '', name: 'Thornswood', description: 'The old words, naming Start On Save.', installInstructions: 'Run LOOT.', domainName: 'skyrimspecialedition', gameVersions: ['1.6.1170.0'] },
    mods: [
      { name: 'SkyUI', version: '5.2', optional: false, domainName: 'skyrimspecialedition', source: { type: 'nexus', modId: 12604, fileId: 1000, md5: '00000000000000000000000000000001', fileSize: 10, logicalFilename: 'SkyUI', updatePolicy: 'exact' }, author: 'a' },
      { name: 'Thornswood Content', version: '1.2', optional: false, domainName: 'skyrimspecialedition', source: { type: 'nexus', modId: 192001, fileId: 2000, md5: '00000000000000000000000000000002', fileSize: 20, logicalFilename: 'Thornswood Content', updatePolicy: 'exact' }, author: 'b' },
    ],
    modRules: [], tools: [], plugins: [], pluginRules: { plugins: [], groups: [] },
  };
  const cj = path.join(T, 'collection.json');
  fs.writeFileSync(cj, JSON.stringify(col, undefined, 2));
  const fixture = {
    version: 1, collection: '7essxf', revision: 2,
    summary: 'The list for [[SkyUI|12604]] users.',
    description: '## What is in it\n\n- [[SkyUI|12604]] and [[Thornswood Content|192001]].',
    installInstructions: 'Add it in Vortex.',
    notSaid: [{ said: 'Start On Save', why: 'kept out' }],
  };
  const swap = { modId: '192001', fileId: '2001', version: '1.3', md5: '00000000000000000000000000000003', fileSize: 21, logicalFilename: 'Thornswood Content' };
  function run(swaps) {
    const sw = path.join(T, 'swaps.json'), o1 = path.join(T, 'out.json'), o2 = path.join(T, 'payload.json');
    for (const f of [o1, o2]) if (fs.existsSync(f)) fs.unlinkSync(f);
    fs.writeFileSync(sw, JSON.stringify(swaps));
    const r = cp.spawnSync(process.execPath, [js, cj, sw, o1, o2], { encoding: 'utf8' });
    return { code: r.status, err: r.stderr || '', out: fs.existsSync(o1) ? JSON.parse(fs.readFileSync(o1, 'utf8')) : null, payload: fs.existsSync(o2) ? JSON.parse(fs.readFileSync(o2, 'utf8')) : null };
  }
  let r = run([swap, { page: fixture }]);
  if (r.err) console.log('      ' + r.err.trim());
  yes('4. with a page, collection.json carries its description, marks made plain',
    r.code === 0 && r.out && r.out.info.description === '## What is in it\n\n- SkyUI and Thornswood Content.');
  yes('4. and its summary and install steps', r.out && r.out.info.summary === 'The list for SkyUI users.' && r.out.info.installInstructions === 'Add it in Vortex.');
  yes('4. and the payload sends the same description and summary',
    r.payload && r.payload.collection_manifest.info.description === '## What is in it\n\n- SkyUI and Thornswood Content.' && r.payload.collection_manifest.info.summary === 'The list for SkyUI users.');
  const off = JSON.parse(JSON.stringify(fixture));
  off.description += '\n- And [[Gone Mod|31337]].';
  r = run([swap, { page: off }]);
  yes('4. a page naming a mod the new revision does not install is refused, naming it, and nothing is written',
    r.code === 1 && /Gone Mod/.test(r.err) && /31337/.test(r.err) && r.out === null && r.payload === null);
  const says = JSON.parse(JSON.stringify(fixture));
  says.description += '\n- Start On Save too.';
  r = run([swap, { page: says }]);
  yes('4. so is one that says what notSaid lists', r.code === 1 && /Start On Save/.test(r.err) && r.out === null);
} finally { fs.rmSync(T, { recursive: true, force: true }); }

// ---- 5. New-NexusRevision always hands it over ------------------------------------
const nnr = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'New-NexusRevision.ps1'), 'utf8');
yes('5. New-NexusRevision takes -PageRecord, records\\collection-page.json unless said',
  /\[string\]\$PageRecord\b/.test(nnr) && /\$PageRecord = Join-Path \$Here '\.\.\\\.\.\\records\\collection-page\.json'/.test(nnr));
yes('5. it puts the page in every revision\'s swaps', /\$swaps\.Add\(\[ordered\]@\{ page = /.test(nnr));
yes('5. and stops when the page is not there, never building from the old text', /if \(-not \(Test-Path -LiteralPath \$PageRecord\)\) \{ Die /.test(nnr));
const verbs = readJson('scripts/release/nexus-verbs.json');
const nv = JSON.stringify(verbs.verbs ? verbs.verbs['New-NexusRevision'] : verbs['New-NexusRevision'] || {});
yes('5. the New-NexusRevision verb\'s reads name collection-page.js, which nexus-collection.js runs', nv.indexOf('scripts/release/collection-page.js') >= 0);

finish();
