// collection-permissions.js
//
// What each mod's own Nexus page says about being put in a collection, held
// against the collection (#3649):
//
//   node scripts/release/collection-permissions.js check <collection.json>
//   node scripts/release/collection-permissions.js check --mods 24104,1932
//   node scripts/release/collection-permissions.js update <collection.json> --revision 6
//
// WHY. Mods went into collection 7essxf without anybody reading each page's
// Permissions and credits, so nothing compared a mod's terms with the
// collection. Atlas Map Markers SE (24104) was in revision 5 with "You are
// not allowed to package this mod as part of a mod collection" on its page,
// found by an audit on 26 October, not by anything that ran.
// records/collection-permissions.json is the reading of every mod's page, and
// this is the check that holds a revision to it.
//
// CHECK names every mod in a collection.json (or in --mods) that the record
// does not list, that it lists with no reading, or whose reading says the
// page does not allow it in a collection, one line each, and exits 1 when
// there is one. New-NexusRevision.ps1 runs it on the revision it builds and
// on a draft before it publishes it. A mod of Thornswood's own ("ours") needs
// no reading. "not stated" passes: the page says nothing against it, and a
// collection hands out the author's own file from the author's own page.
//
// WHICH LINES SAY NO. Only a line against the mod being in a collection (or
// a mod pack or list that hands it out) is "not allowed". A line against
// uploading the files to other sites, or redistributing them, is "not
// stated": Patrick, 27 October 2026, card q-3649-no-upload-lines, A, because
// the collection hands out no file of the author's. Three readings first
// marked for such a line carry that ruling.
//
// WHAT MAKES A READING (#4190), the same rule records/README.md gives, and
// ruled() below is it. "not allowed" is the reader's, on the line above. Any
// other reading is "allowed" when the page grants the mod's own files more
// than a collection asks, in one of three ways the reading records:
//   licence  an open licence covering the mod's own files, named on the page
//            or in a licence file the page points to as its terms. One the
//            page only points to is recorded with where it is (at) and who
//            opened it (read, by), because the page's words do not say it;
//   upload   the page's Upload permission line lets the files go to other
//            sites, with or without credit, which is more than a collection
//            does with them;
//   grant    the page's own words letting anyone do anything with them,
//            copied in grant as they stand in a term.
// A licence covering only part of the mod's files (a program but not its
// assets) is none of these, and neither is "open source" with no licence
// named. Anything else is "not stated". Until 12 November 2026 this was
// written nowhere, and two pages that point to their licence file without
// naming it were read two ways: SKSE Menu Framework "not stated", Crash
// Logger "allowed". "allowed" and "not stated" both pass the check, so the
// rule says what the record means and lets nothing new through.
//
// UPDATE rewrites the record's list of mods from a collection.json, for a new
// revision: each mod keeps its reading, a mod the collection no longer
// carries goes, and a new one comes in with no reading, so CHECK refuses it
// until somebody reads its page. Plugins come from the collection's own
// hashes where it has them and are otherwise kept.
//
// The pages answer a cloud session with a Cloudflare 403 and neither Nexus
// API has a permissions field (both read 27 October), so a reading is taken
// in a browser, on One.
'use strict';
const fs = require('fs');
const path = require('path');

const RECORD = path.join(__dirname, '..', '..', 'records', 'collection-permissions.json');
const COLLECTIONS = ['allowed', 'not stated', 'not allowed'];
// Nexus's two Upload permission lines that let the files go to other sites.
const UPLOAD_ALLOWED = /^You (can|are allowed to) upload this file to other sites\b/;

// What a reading comes to by the rule in the header (#4190).
function ruled(r) {
  if (r.collections === 'not allowed') return 'not allowed';
  if (r.licence) return 'allowed';
  const up = r.terms && r.terms['Upload permission'];
  if (typeof up === 'string' && UPLOAD_ALLOWED.test(up)) return 'allowed';
  if (r.grant) return 'allowed';
  return 'not stated';
}

function readRecord(file) {
  return JSON.parse(fs.readFileSync(file || RECORD, 'utf8').replace(/^\uFEFF/, ''));
}

// What is wrong with the record's own shape, one line each.
function shapeProblems(record) {
  const out = [];
  if (record.version !== 1) out.push('version is ' + record.version + ', not 1');
  if (typeof record.collection !== 'string' || !/^[a-z0-9]+$/.test(record.collection)) out.push('collection is not a slug');
  if (!Number.isInteger(record.revision) || record.revision < 1) out.push('revision is not a revision number');
  if (!Array.isArray(record.mods) || !record.mods.length) { out.push('there are no mods'); return out; }
  const seen = new Set();
  let last = 0;
  for (const m of record.mods) {
    const who = 'mod ' + (m && m.modId);
    if (!m || !Number.isInteger(m.modId) || m.modId < 1) { out.push(who + ': modId is not a mod number'); continue; }
    if (seen.has(m.modId)) out.push(who + ': listed twice');
    seen.add(m.modId);
    if (m.modId < last) out.push(who + ': not in modId order');
    last = m.modId;
    if (typeof m.name !== 'string' || !m.name) out.push(who + ': no name');
    if (typeof m.author !== 'string') out.push(who + ': no author');
    if (!Array.isArray(m.files) || !m.files.length || m.files.some(f => !f || !Number.isInteger(f.fileId))) out.push(who + ': files is not a list of file ids');
    if (!Array.isArray(m.plugins) || m.plugins.some(p => typeof p !== 'string' || !/\.es[pml]$/i.test(p))) out.push(who + ': plugins is not a list of plugin names');
    if (m.page !== 'https://www.nexusmods.com/skyrimspecialedition/mods/' + m.modId + '?tab=description') out.push(who + ': page is not its own Nexus page');
    if (m.ours === true) {
      if (m.reading !== null) out.push(who + ': a mod of ours carries a reading');
      continue;
    }
    if (m.ours !== undefined) out.push(who + ': ours is only ever true');
    if (m.reading === null) continue;
    const r = m.reading;
    if (!r || typeof r !== 'object') { out.push(who + ': reading is neither null nor a reading'); continue; }
    if (typeof r.read !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.read)) out.push(who + ': reading has no date read');
    if (typeof r.by !== 'string' || !r.by) out.push(who + ': reading says nobody read it');
    if (COLLECTIONS.indexOf(r.collections) < 0) out.push(who + ': collections is "' + r.collections + '", not one of ' + COLLECTIONS.join(', '));
    if (!r.terms || typeof r.terms !== 'object' || !Object.keys(r.terms).length) out.push(who + ': reading copies none of the page\'s terms');
    else for (const k of Object.keys(r.terms)) {
      const v = r.terms[k];
      if (!(typeof v === 'string' && v) && !(Array.isArray(v) && v.length && v.every(s => typeof s === 'string' && s))) out.push(who + ': term "' + k + '" is empty');
    }
    if (/@[A-Za-z0-9-]+\.[A-Za-z]/.test(JSON.stringify(r))) out.push(who + ': reading holds a mail address; name the page instead');
    if (r.licence !== undefined) {
      const l = r.licence;
      if (!l || typeof l !== 'object' || typeof l.name !== 'string' || !l.name) out.push(who + ': licence names no licence');
      else if (l.at !== undefined && (typeof l.at !== 'string' || !l.at || typeof l.by !== 'string' || !l.by || typeof l.read !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.read))) {
        out.push(who + ': a licence the page points to says where it is, when it was read and by whom');
      }
    }
    if (r.grant !== undefined) {
      const words = r.terms && typeof r.terms === 'object' ? Object.keys(r.terms).map(k => [].concat(r.terms[k]).join(' ')).join('\n') : '';
      if (typeof r.grant !== 'string' || !r.grant || words.indexOf(r.grant) < 0) out.push(who + ': grant is not the page\'s own words in a term');
    }
    if (COLLECTIONS.indexOf(r.collections) >= 0 && ruled(r) !== r.collections) {
      out.push(who + ': reads "' + r.collections + '", and the rule (records/README.md, What makes a reading) gives "' + ruled(r) + '"');
    }
  }
  return out;
}

// Every mod in modIds the collection may not carry, with why.
function refusals(record, modIds) {
  const by = new Map(record.mods.map(m => [m.modId, m]));
  const out = [];
  for (const id of [...new Set(modIds)].sort((a, b) => a - b)) {
    const m = by.get(id);
    if (!m) { out.push({ modId: id, why: 'not in the record: read its page and add it' }); continue; }
    if (m.ours === true) continue;
    if (m.reading === null) { out.push({ modId: id, name: m.name, why: 'its page has not been read: ' + m.page }); continue; }
    if (m.reading.collections === 'not allowed') out.push({ modId: id, name: m.name, why: 'its page, read ' + m.reading.read + ', does not allow it in a collection' });
  }
  return out;
}

function collectionModIds(collection) {
  return (collection.mods || []).filter(e => e.source && e.source.type === 'nexus').map(e => Number(e.source.modId));
}

// The record with its list of mods taken from a collection.json.
function updated(record, collection, revision) {
  const old = new Map(record.mods.map(m => [m.modId, m]));
  const groups = new Map();
  for (const e of collection.mods || []) {
    if (!e.source || e.source.type !== 'nexus') continue;
    const id = Number(e.source.modId);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(e);
  }
  const mods = [];
  for (const id of [...groups.keys()].sort((a, b) => a - b)) {
    const es = groups.get(id);
    const was = old.get(id);
    const fromHashes = [];
    for (const e of es) for (const h of e.hashes || []) {
      if (/^[^\\/]+\.es[pml]$/i.test(h.path) && fromHashes.indexOf(h.path) < 0) fromHashes.push(h.path);
    }
    const m = {
      modId: id,
      name: was ? was.name : es[0].name,
      author: was ? was.author : String(es[0].author || ''),
      files: es.map(e => ({ fileId: Number(e.source.fileId), name: e.name, version: e.version })),
      plugins: fromHashes.length ? fromHashes.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1) : (was ? was.plugins : []),
      page: 'https://www.nexusmods.com/skyrimspecialedition/mods/' + id + '?tab=description',
    };
    if (was && was.ours === true) m.ours = true;
    m.reading = was ? was.reading : null;
    mods.push(m);
  }
  return Object.assign({}, record, { revision: revision, mods: mods });
}

// The record's text: two-space JSON, one mod per block, LF, so the same
// record gives the same bytes on any machine.
function text(record) {
  return JSON.stringify(record, null, 2) + '\n';
}

module.exports = { RECORD, COLLECTIONS, readRecord, ruled, shapeProblems, refusals, collectionModIds, updated, text };

if (require.main === module) {
  const a = process.argv.slice(2);
  const die = m => { process.stderr.write(m + '\n'); process.exit(2); };
  const opt = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  // What is left once each --name and its value are taken out.
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--')));
  const recordFile = opt('--record') || RECORD;
  const record = readRecord(recordFile);
  const shape = shapeProblems(record);
  if (shape.length) die(recordFile + ' is not a permission record this reads: ' + shape.join('; '));
  if (pos[0] === 'check') {
    let ids;
    if (opt('--mods') !== undefined) ids = String(opt('--mods')).split(',').filter(Boolean).map(Number);
    else if (pos[1]) ids = collectionModIds(JSON.parse(fs.readFileSync(pos[1], 'utf8').replace(/^\uFEFF/, '')));
    else die('check takes a collection.json or --mods');
    if (!ids.length || ids.some(n => !Number.isInteger(n) || n < 1)) die('no mod numbers to check');
    const r = refusals(record, ids);
    for (const x of r) console.log(x.modId + '\t' + (x.name || '') + '\t' + x.why);
    process.exit(r.length ? 1 : 0);
  }
  if (pos[0] === 'update') {
    const rev = Number(opt('--revision'));
    if (!pos[1] || !Number.isInteger(rev) || rev < 1) die('update takes a collection.json and --revision <n>');
    const next = updated(record, JSON.parse(fs.readFileSync(pos[1], 'utf8').replace(/^\uFEFF/, '')), rev);
    fs.writeFileSync(recordFile, text(next));
    const unread = next.mods.filter(m => m.ours !== true && m.reading === null).length;
    console.log(next.mods.length + ' mods written to ' + recordFile + ', ' + unread + ' with no reading yet');
    process.exit(0);
  }
  die('say check or update');
}
