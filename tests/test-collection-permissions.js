// test-collection-permissions.js
//
//     node tests\test-collection-permissions.js
//
// Issue #3649: what each collection mod's own Nexus page says about being put
// in a collection, in records\collection-permissions.json, and the check that
// holds a revision to it (scripts\release\collection-permissions.js, run by
// New-NexusRevision.ps1).
//
// WHY. Mods went into collection 7essxf with nobody reading each page's
// Permissions and credits. Atlas Map Markers SE (24104) was in revision 5,
// and its plugin in records\collection-plugins.json, with "You are not allowed
// to package this mod as part of a mod collection" on its page; an audit found
// it on 26 October, nothing that ran did.
//
// It checks:
//   1. the record reads, every mod in it has every field, and a reading has a
//      date, who read it, a collections value the check knows and the page's
//      own words, with no mail address copied in;
//   2. it is the record of the revision records\collection-plugins.json is,
//      and every plugin there but the game's own six is named by a mod in it,
//      so a plugin cannot reach the servers from a mod nobody read;
//   3. every mod in it has a reading, or is one of Thornswood's own two;
//   4. the check refuses a mod with no reading, a mod the record does not
//      have and a mod whose page does not allow it in a collection, and lets
//      through "allowed", "not stated" and ours, on planted records;
//   5. update keeps each reading, drops a mod the collection no longer
//      carries and brings a new one in unread;
//   6. New-NexusRevision.ps1 runs the check on the revision it makes and on a
//      draft before it publishes it (test-2914-nexus-scripts.ps1 runs both).
//
// It names, on a NOTE line, each mod whose page says no, which the published
// collection still carries until its own issue is done.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cp = require(path.join(ROOT, 'scripts', 'release', 'collection-permissions.js'));
const PLUGINS = path.join(ROOT, 'records', 'collection-plugins.json');
const OURS = [192001, 192762];   // Thornswood Content and the Thornswood Client Runtime
const GAME = ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm', '_resourcepack.esl'];

let pass = 0, fail = 0;
function yes(what, cond, more) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (more ? '\n      ' + more : '')); }
}

// 1. the record and its shape
let record = null;
try { record = cp.readRecord(); } catch (e) { yes('records/collection-permissions.json reads: ' + e.message, false); }
if (!record) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
const shape = cp.shapeProblems(record);
yes('every mod in the record has every field, and every reading a date, a reader, a known collections value and the page\'s words', shape.length === 0, shape.slice(0, 8).join('; '));

// 2. the same revision as the plugin record, and every plugin from a listed mod
const plugins = JSON.parse(fs.readFileSync(PLUGINS, 'utf8'));
yes('it is the record of collection ' + plugins.collection + ' revision ' + plugins.revision + ', as records/collection-plugins.json is',
  record.collection === plugins.collection && record.revision === plugins.revision,
  'collection-permissions.json says ' + record.collection + ' revision ' + record.revision);
const named = new Set();
for (const m of record.mods) for (const p of m.plugins || []) named.add(p.toLowerCase());
const loose = plugins.plugins.map(p => p.name).filter(n => GAME.indexOf(n.toLowerCase()) < 0 && !named.has(n.toLowerCase()));
yes('every plugin in records/collection-plugins.json but the game\'s own six comes from a mod in the record', loose.length === 0, loose.join(', '));

// 3. every page read
const unread = record.mods.filter(m => m.ours !== true && m.reading === null);
yes('every mod\'s page has been read (' + (record.mods.length - unread.length) + ' of ' + record.mods.length + ')', unread.length === 0,
  unread.length + ' not read yet, the first: ' + unread.slice(0, 5).map(m => m.modId + ' ' + m.name).join('; '));
const ours = record.mods.filter(m => m.ours === true).map(m => m.modId);
yes('only Thornswood\'s own mods are marked ours', ours.length === OURS.length && OURS.every(id => ours.indexOf(id) >= 0), 'ours: ' + ours.join(', '));

const no = record.mods.filter(m => m.reading && m.reading.collections === 'not allowed');
for (const m of no) console.log('NOTE  mod ' + m.modId + ' (' + m.name + '): its page, read ' + m.reading.read + ', does not allow it in a collection; revision ' + record.revision + ' carries it');

// 4. the check, on planted records
function mod(id, reading, ours) {
  const m = { modId: id, name: 'Mod ' + id, author: 'Someone', files: [{ fileId: 1, name: 'f', version: '1' }], plugins: [], page: 'https://www.nexusmods.com/skyrimspecialedition/mods/' + id + '?tab=description' };
  if (ours) m.ours = true;
  m.reading = reading;
  return m;
}
function read(collections) { return { read: '2026-10-27', by: 'the test', collections: collections, terms: { "Author's instructions": 'x' } }; }
// An allowed reading carries what allows it (#4190): here an open licence.
const allowedRead = Object.assign(read('allowed'), { licence: { name: 'MIT' } });
const planted = { version: 1, collection: '7essxf', revision: 5, mods: [mod(10, allowedRead), mod(20, read('not stated')), mod(30, read('not allowed')), mod(40, null), mod(50, null, true)] };
yes('a planted record has the shape the check takes', cp.shapeProblems(planted).length === 0, cp.shapeProblems(planted).join('; '));
const r = cp.refusals(planted, [10, 20, 30, 40, 50, 60]);
yes('the check refuses the mod whose page does not allow it in a collection', r.some(x => x.modId === 30 && /does not allow it in a collection/.test(x.why)));
yes('the check refuses the mod nobody has read, naming its page', r.some(x => x.modId === 40 && x.why.indexOf(planted.mods[3].page) >= 0));
yes('the check refuses a mod the record does not have', r.some(x => x.modId === 60 && /not in the record/.test(x.why)));
yes('the check lets through allowed, not stated and ours, and nothing else', r.map(x => x.modId).join() === '30,40,60');
function bad(change) { const c = JSON.parse(JSON.stringify(planted)); change(c); return cp.shapeProblems(c); }
yes('a collections value the check does not know is a shape problem', bad(c => { c.mods[0].reading.collections = 'yes'; }).length > 0);
yes('a reading with a mail address in it is a shape problem', bad(c => { c.mods[0].reading.terms.x = 'write to someone@example.com'; }).length > 0);
yes('a reading with no date is a shape problem', bad(c => { delete c.mods[0].reading.read; }).length > 0);
yes('a page that is not the mod\'s own is a shape problem', bad(c => { c.mods[0].page = 'https://www.nexusmods.com/skyrimspecialedition/mods/99?tab=description'; }).length > 0);
yes('a mod of ours with a reading is a shape problem', bad(c => { c.mods[4].reading = read('allowed'); }).length > 0);

// 4b. What makes a reading (#4190). SKSE Menu Framework's page points to
// its licence file, GPL-3.0, without naming it, and was read "not stated",
// while Crash Logger's page, saying the same of its own, was read
// "allowed": nothing wrote down what makes a reading allowed. The rule is in
// records\README.md and collection-permissions.js ruled(), and the record's
// own shape holds every reading to it.
yes('collection-permissions.js says what each reading comes to by one rule (ruled)', typeof cp.ruled === 'function');
if (typeof cp.ruled === 'function') {
  const off = record.mods.filter(m => m.reading && cp.ruled(m.reading) !== m.reading.collections);
  yes('every reading in the record is what the rule gives', off.length === 0,
    off.slice(0, 6).map(m => m.modId + ' ' + m.name + ' reads "' + m.reading.collections + '", the rule gives "' + cp.ruled(m.reading) + '"').join('; '));
}
const smf = record.mods.find(m => m.modId === 120352);
yes('SKSE Menu Framework reads allowed, through the GPL-3.0 licence file its page points to, with who read that file',
  !!smf && smf.reading && smf.reading.collections === 'allowed' && smf.reading.licence && /GPL-3\.0/.test(smf.reading.licence.name) &&
  !!smf.reading.licence.at && !!smf.reading.licence.read && !!smf.reading.licence.by);
yes('a reading marked allowed with nothing that allows it is a shape problem', bad(c => { delete c.mods[0].reading.licence; }).length > 0);
yes('a reading marked not stated whose page allows uploads elsewhere is a shape problem',
  bad(c => { c.mods[1].reading.terms['Upload permission'] = 'You can upload this file to other sites but you must credit me as the creator of the file'; }).length > 0);
yes('  and marked allowed on that line it is not', bad(c => { c.mods[1].reading.collections = 'allowed'; c.mods[1].reading.terms['Upload permission'] = 'You can upload this file to other sites but you must credit me as the creator of the file'; }).length === 0);
yes('a licence the page only links, with nobody named as reading the file, is a shape problem', bad(c => { c.mods[0].reading.licence.at = 'the LICENSE file the page links'; }).length > 0);
yes('a grant that is not in the page\'s words is a shape problem', bad(c => { delete c.mods[0].reading.licence; c.mods[0].reading.grant = 'do anything'; }).length > 0);
yes('a line against collections stays the reader\'s not allowed, whatever else the page says', bad(c => { c.mods[2].reading.licence = { name: 'MIT' }; }).length === 0);
const readme = fs.readFileSync(path.join(ROOT, 'records', 'README.md'), 'utf8');
yes('records/README.md says what makes a reading allowed', /What makes a reading `allowed`/.test(readme));

// 5. update
const collection = { mods: [
  { name: 'Mod 10 file', version: '2', source: { type: 'nexus', modId: 10, fileId: 11 }, author: 'Someone' },
  { name: 'New Mod', version: '1', source: { type: 'nexus', modId: 70, fileId: 71 }, author: 'Another', hashes: [{ path: 'New.esp', md5: 'x' }, { path: 'meshes\\a.nif', md5: 'y' }] },
] };
const u = cp.updated(planted, collection, 6);
yes('update writes the new revision with only the mods the collection carries', u.revision === 6 && u.mods.map(m => m.modId).join() === '10,70');
yes('update keeps a mod\'s reading and takes its new file', JSON.stringify(u.mods[0].reading) === JSON.stringify(planted.mods[0].reading) && u.mods[0].files[0].fileId === 11);
yes('update brings a new mod in unread, with the plugins its hashes name', u.mods[1].reading === null && u.mods[1].plugins.join() === 'New.esp' && cp.refusals(u, [70]).length === 1);
yes('what update writes has the shape the check takes', cp.shapeProblems(u).length === 0, cp.shapeProblems(u).join('; '));

// 6. New-NexusRevision runs it on both paths
const nnr = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'New-NexusRevision.ps1'), 'utf8');
yes('New-NexusRevision.ps1 checks the revision it builds and the draft it publishes', (nnr.match(/^\s*Test-ModPermissions \$/gm) || []).length === 2 && /collection-permissions\.js'\), 'check'/.test(nnr));
// A checkout with core.autocrlf true (One, the Windows runners) holds it with
// CRLF; git stores the LF that update writes either way.
yes('the record is the text update itself would write', fs.readFileSync(cp.RECORD, 'utf8').replace(/\r\n/g, '\n') === cp.text(record));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
