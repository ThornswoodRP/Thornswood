// collection-page.js
//
// The text of the collection's Nexus page (#4537): its summary, its
// description and its install steps, kept in records/collection-page.json
// and held to the collection's own record.
//
//   node scripts/release/collection-page.js [<page.json> [<collection record>]]
//
// prints each problem and exits 1, or says the page holds and exits 0. Left
// off, the two are records/collection-page.json and records/collection.json.
//
// WHY IT IS KEPT HERE. Until #4537 the page lived only in each revision's
// collection.json, and New-NexusRevision builds a revision from the one
// before it, so the text went out again as it was, read by nobody. It kept
// naming Start On Save after the build took it out, and called the server's
// own needs a mod's. Now New-NexusRevision sends this text with every
// revision, through nexus-collection.js, and the gate holds it here.
//
// A MOD IS NAMED BY A MARK: [[the words said|its Nexus mod id]], which goes
// out as the words alone. Every mark has to be a mod records/collection.json
// installs, and nexus-collection.js holds it again to the mods of the
// revision it builds. So a mod that leaves the collection cannot stay on the
// page: the check names the line that still says it.
//
// WHAT IT MUST NOT SAY. notSaid lists the words the build has made untrue
// (a mod it keeps out, a step nobody takes any more, a claim about the game
// that stopped holding), each with why. Saying one is a problem.
//
// HEADINGS. Nexus shows the description as Markdown, and a screen reader
// moves between its headings. A short line on its own with no end stop is a
// section title, and has to be a heading (## ...).
'use strict';
const fs = require('fs');
const path = require('path');

const MARK = /\[\[([^\[\]|]+)\|(\d+)\]\]/g;
const FIELDS = ['summary', 'description', 'installInstructions'];

// Every mark in a text: { said, modId }.
function marks(text) {
  const out = [];
  String(text || '').replace(MARK, (all, said, id) => { out.push({ said: said, modId: Number(id) }); return all; });
  return out;
}
// The text as it goes out: each mark is its words.
function render(text) { return String(text || '').replace(MARK, '$1'); }

function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// The phrase as words: "LOOT" is not in "QuickLoot".
function says(text, phrase) { return new RegExp('(^|[^A-Za-z0-9])' + escapeRx(phrase) + '($|[^A-Za-z0-9])', 'i').test(text); }

// What is wrong with the page's own text, held to the mod ids a revision
// installs. Each problem is one sentence.
function textProblems(page, ids, where) {
  const out = [];
  for (const f of FIELDS) {
    for (const m of marks(page[f])) {
      if (!ids.has(m.modId)) out.push(f + ' names ' + m.said + ' (mod ' + m.modId + '), which ' + where + ' does not install. Take it off the page, or put the mod back in the collection.');
    }
    const plain = render(page[f]);
    for (const n of (Array.isArray(page.notSaid) ? page.notSaid : [])) {
      if (n && typeof n.said === 'string' && n.said && says(plain, n.said)) out.push(f + ' says "' + n.said + '", which the page must not: ' + n.why);
    }
  }
  const lines = render(page.description).split(/\r?\n/);
  // An address given as its own text, bare or in <...>, in any of the
  // page's texts: a screen reader spells it out, and nothing says where it
  // goes. A link has words for its text, [the words](address) (#4234).
  for (const f of FIELDS) {
    render(page[f]).split(/\r?\n/).forEach((raw, i) => {
      const left = raw.replace(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/g, '');
      const m = /https?:\/\/[^\s>)]+/.exec(left);
      if (m) out.push(f + ' line ' + (i + 1) + ' gives ' + m[0] + ' as a bare address. Give it words for its text: [the words](' + m[0] + ')');
    });
  }
  let heads = 0;
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l) return;
    if (/^#{1,6} \S/.test(l)) { heads++; return; }
    if (/^([-*+]|\d+\.) /.test(l) || /^https?:\/\//.test(l)) return;
    const alone = (!lines[i - 1] || !lines[i - 1].trim()) && (!lines[i + 1] || !lines[i + 1].trim());
    if (alone && l.split(/\s+/).length <= 6 && !/[.!?:;,)]$/.test(l)) out.push('description line ' + (i + 1) + ', "' + l + '", is a section title written as a plain line. Make it a heading: ## ' + l);
  });
  if (!heads) out.push('the description has no heading, so a screen reader cannot move between its sections.');
  return out;
}

function shapeProblems(page) {
  const out = [];
  if (!page || typeof page !== 'object' || Array.isArray(page)) return ['the page record is not an object.'];
  if (page.version !== 1) out.push('version is ' + JSON.stringify(page.version) + ', and this reads version 1.');
  if (typeof page.collection !== 'string' || !page.collection) out.push('collection names no collection.');
  if (!Number.isInteger(page.revision) || page.revision < 1) out.push('revision is not a revision number.');
  if (typeof page.summary !== 'string' || !page.summary.trim()) out.push('summary is empty.');
  else if (/[\r\n]/.test(page.summary)) out.push('summary is more than one line.');
  if (typeof page.description !== 'string' || !page.description.trim()) out.push('description is empty.');
  if (typeof page.installInstructions !== 'string') out.push('installInstructions is not text.');
  if (!Array.isArray(page.notSaid)) out.push('notSaid is not a list.');
  else page.notSaid.forEach((n, i) => {
    if (!n || typeof n.said !== 'string' || !n.said.trim() || typeof n.why !== 'string' || !n.why.trim()) out.push('notSaid row ' + (i + 1) + ' is not the words and why.');
  });
  return out;
}

// Everything wrong with the page against the collection's record.
function problems(page, record) {
  const out = shapeProblems(page);
  if (out.length) return out;
  if (page.collection !== record.collection) out.push('the page is collection ' + page.collection + ', and the record is ' + record.collection + '.');
  if (page.revision !== record.revision) out.push('the page follows revision ' + page.revision + ', and the record is revision ' + record.revision + '. Read the page against the revision the record holds, then set its revision.');
  const ids = new Set((Array.isArray(record.mods) ? record.mods : []).map(m => Number(m.modId)));
  return out.concat(textProblems(page, ids, 'revision ' + record.revision + ' of the record'));
}

// The three texts as a revision sends them, held to the mod ids it
// installs. Throws with every problem when there is one.
function sendable(page, ids) {
  const out = shapeProblems(page);
  if (!out.length) out.push.apply(out, textProblems(page, ids instanceof Set ? ids : new Set(ids), 'the new revision'));
  if (out.length) throw new Error('The collection page, records/collection-page.json, cannot go out: ' + out.join(' '));
  return { summary: render(page.summary), description: render(page.description), installInstructions: render(page.installInstructions) };
}

// Compare the public GraphQL text to what the publisher sends. Only line
// endings are normalized; case, Markdown and blank lines are part of the copy.
function publicDifference(page, live, slug) {
  if (!page || page.version !== 1) return 'collection-page.json is not a version 1 page record.';
  if (page.collection !== slug) return 'collection-page.json does not name the collection checked (' + slug + ').';
  for (const field of ['summary', 'description']) {
    if (typeof page[field] !== 'string' || !page[field].trim()) return 'collection-page.json has no ' + field + ' text.';
    if (!live || typeof live[field] !== 'string' || !live[field].trim()) return 'Nexus returned no ' + field + ' text.';
    const lines = text => text.split(/\r\n|\r|\n/);
    const expected = lines(render(page[field]));
    const actual = lines(live[field]);
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
      if (expected[i] !== actual[i]) return field + ' line ' + (i + 1) + ' differs from collection-page.json.';
    }
  }
  return '';
}

function comparePublic(pagePath, slug) {
  let page;
  try { page = JSON.parse(fs.readFileSync(pagePath, 'utf8').replace(/^\ufeff/, '')); }
  catch { console.log('collection-page.json could not be read as JSON.'); return 0; }
  // Base64 keeps UTF-8 intact through PowerShell 5.1's ASCII native pipe.
  const live = JSON.parse(Buffer.from(fs.readFileSync(0, 'ascii').trim(), 'base64').toString('utf8'));
  const why = publicDifference(page, live, slug);
  if (why) console.log(why);
  return 0;
}

function main(argv) {
  if (argv[0] === '--compare-public') return comparePublic(argv[1], argv[2]);
  const root = path.join(__dirname, '..', '..');
  const pagePath = argv[0] || path.join(root, 'records', 'collection-page.json');
  const recordPath = argv[1] || path.join(root, 'records', 'collection.json');
  let page, record;
  try { page = JSON.parse(fs.readFileSync(pagePath, 'utf8').replace(/^\ufeff/, '')); }
  catch (e) { console.log('STOP. ' + pagePath + ' will not read: ' + e.message); return 1; }
  try { record = JSON.parse(fs.readFileSync(recordPath, 'utf8').replace(/^\ufeff/, '')); }
  catch (e) { console.log('STOP. ' + recordPath + ' will not read: ' + e.message); return 1; }
  const ps = problems(page, record);
  for (const p of ps) console.log('PROBLEM  ' + p);
  if (ps.length) return 1;
  console.log('the collection page holds to revision ' + record.revision + ': ' + marks(page.description).length + ' mods named, each one the collection installs.');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { marks, render, problems, sendable };
