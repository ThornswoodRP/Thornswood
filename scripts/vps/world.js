// world.js (#6237)
//
// A game server's world, kept in MongoDB, read out to a folder and written
// back from one. Run on the box by World.ps1 with mongosh, never by hand:
//
//     mongosh --nodb --quiet --file world.js
//
// with THORNSWOOD_WORLD_PLAN naming a plan file. The plan names the
// connection file to sign in with (the server's own, access\<user>.uri, or
// the backup's), never a password: the file is read here and nothing prints
// it. The world is the changeForms collection of the plan's database, one
// document per saved form keyed by formDesc, as the engine's MongoDB driver
// keeps it (engine\skymp, MongoDatabase.cpp).
//
// THE FOLDER. The forms are written the way the engine's file driver lays
// out a world, so every tool that reads world\changeForms reads this too:
// one file per form, named by its formDesc with ':' as '_' (14.json,
// 3eb15_Skyrim.esm.json), the document as MongoDB keeps it without its _id.
// The ids inside are by plugin ("801:Sword.esp"), as the driver stores them;
// a tool that needs a number reads it through the server's load order
// (scripts\bot\character.js, descToId).
//
// export   {op, uri, db, to, manifest, live}: every form into the folder
//          `to`, which must not be there yet, and the manifest beside it:
//          the database, the count, and each file's SHA-256 as written.
//          Prints EXPORTED|<count>. A form read by a tool must be the world
//          as it stands, so a count that changed while it read stops it;
//          with live (the nightly backup, while the server runs) the forms
//          read are kept: each is whole, as MongoDB keeps every document
//          whole, though one saved during the read may be the newer or the
//          older save.
// apply    {op, uri, db, from, manifest, mode}: the folder back into the
//          database. Every file is read and checked before anything is
//          written, so a file that does not parse or is not named by its own
//          formDesc stops it with nothing changed.
//            mode "changes": what the folder says changed since the export
//              its manifest describes: a file whose bytes differ replaces
//              its form, a new file adds one, and a file gone from the folder
//              takes its form out. A form the database changed since the
//              export (its document no longer the one exported) stops it
//              first, with nothing written: the server must be stopped while
//              a tool works on its world.
//            mode "replace": the database made to hold exactly the folder,
//              for a restore: every file written, every form the folder
//              lacks taken out. No manifest.
//          Writes go in ordered batches with the engine's own write concern
//          (journaled), and a run cut off part way is finished by the same
//          run again: each write is by formDesc. Prints
//          APPLIED|<written>|<added>|<removed>|<count after>.
// count    {op, uri, db}: COUNT|<forms>|<characters>, a character being a
//          form with profileId above 0 that is not deleted (#5168).
// empty    {op, uri, db}: drops the world's collection, for the restore
//          rehearsal's database (thornswood-rehearsal), which holds a copy
//          of everybody's characters only while a rehearsal runs, and the
//          load test's (thornswood-load), its bots' characters; never a
//          server's.
//          Prints EMPTIED|<forms it held>.
//
// The indexes the engine makes (formDesc_unique and profileId) are made here
// too, with the same names and options, before anything is written: a
// restore into a new database would otherwise look every form up by reading
// the whole collection. Any error ends it with exit code 1 and the line
// WORLD FAILED: <why>, which names no password.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const kCollection = 'changeForms';
const kBatch = 500;

function fail(message) {
  print('WORLD FAILED: ' + message);
  quit(1);
}

function connect(uriFile, dbName) {
  const text = fs.readFileSync(uriFile, 'utf8').trim();
  if (!/^mongodb:\/\//.test(text)) fail('the connection file is not a mongodb: URI: ' + uriFile);
  const conn = new Mongo(text);
  return conn.getDB(dbName);
}

// The file a form is kept in: FormDesc::ToString('_') + ".json".
function fileOf(formDesc) {
  if (typeof formDesc !== 'string' || !/^[0-9a-f]{1,8}(:[^:\\/*?"<>|]+)?$/.test(formDesc)) {
    throw new Error('a form has a formDesc that is not one: ' + JSON.stringify(formDesc));
  }
  return formDesc.replace(':', '_') + '.json';
}

// A form as JSON text, the way the engine's own JSON says it: a double
// keeps its point (100.0), an int32 or int64 is a whole number, so a form
// read out and written back keeps every number's type. Read with
// promoteValues off, so MongoDB says which each one is. Anything JSON has no
// word for (a date, binary, an ObjectId inside a form) is not a thing the
// engine writes, so it stops instead of being guessed at.
function toJson(value, where) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return number(value, where);
  if (Array.isArray(value)) return '[' + value.map((v, i) => toJson(v, where + '[' + i + ']')).join(',') + ']';
  const kind = value && value._bsontype;
  if (kind === 'Double') {
    const v = value.valueOf();
    const text = number(v, where);
    return /[.eE]/.test(text) ? text : text + '.0';
  }
  if (kind === 'Int32') return number(value.valueOf(), where);
  if (kind === 'Long') return value.toString();
  if (kind) throw new Error(where + ' is a BSON ' + kind + ', which a saved form never holds');
  return '{' + Object.keys(value).map((k) => JSON.stringify(k) + ':' + toJson(value[k], where + '.' + k)).join(',') + '}';
}

function number(v, where) {
  if (!Number.isFinite(v)) throw new Error(where + ' is not a finite number');
  return String(v);
}

// A file's JSON as the engine writes it to MongoDB (bsoncxx::from_json): a
// number written with a point or an exponent is a double, any other one an
// int32 when it fits and an int64 when it does not. JSON.parse alone would
// make every whole number an int32 and lose an int64 past 2^53.
function parseForm(text) {
  return JSON.parse(text.replace(/^﻿/, ''), function (key, value, context) {
    if (typeof value !== 'number') return value;
    const src = context && context.source;
    if (typeof src !== 'string') throw new Error('this mongosh cannot read a number as it is written');
    if (/[.eE]/.test(src)) return Double(value);
    if (value >= -2147483648 && value <= 2147483647) return Int32(value);
    return Long.fromString(src);
  });
}

// A form as export writes it, the text both sides of a comparison are.
function canon(doc) {
  return toJson(doc, String(doc.formDesc));
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ensureIndexes(db) {
  db.getCollection(kCollection).createIndex({ formDesc: 1 }, { name: 'formDesc_unique', unique: true });
  db.getCollection(kCollection).createIndex({ profileId: 1 }, { name: 'profileId' });
}

function exportWorld(plan) {
  const db = connect(plan.uri, plan.db);
  if (fs.existsSync(plan.to)) fail(plan.to + ' is there already; nothing was written');
  if (fs.existsSync(plan.manifest)) fail(plan.manifest + ' is there already; nothing was written');
  const part = plan.to + '.part';
  if (fs.existsSync(part)) fail(part + ' is there from an export that did not finish; nothing was written');
  fs.mkdirSync(part, { recursive: true });
  const forms = {};
  let n = 0;
  const cursor = db.getCollection(kCollection).find({}, { _id: 0 }, { promoteValues: false }).sort({ formDesc: 1 }).batchSize(1000);
  while (cursor.hasNext()) {
    const doc = cursor.next();
    const name = fileOf(doc.formDesc);
    if (forms[name]) fail('two forms are kept as ' + name);
    const bytes = Buffer.from(canon(doc), 'utf8');
    fs.writeFileSync(path.join(part, name), bytes);
    forms[name] = sha(bytes);
    n++;
  }
  const counted = db.getCollection(kCollection).countDocuments({});
  if (counted !== n && !plan.live) fail('read ' + n + ' forms where the collection counts ' + counted + '; the server must not be writing while a tool reads its world');
  fs.renameSync(part, plan.to);
  fs.writeFileSync(plan.manifest, JSON.stringify({ db: plan.db, count: n, exported: new Date().toISOString(), forms }, null, 1));
  print('EXPORTED|' + n);
}

// Every file in the folder, read and checked: { name: { doc, sha } }.
function readFolder(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!name.endsWith('.json') || !fs.statSync(full).isFile()) continue;
    const bytes = fs.readFileSync(full);
    let doc;
    try {
      doc = parseForm(bytes.toString('utf8'));
    } catch (e) {
      fail(name + ' does not read as a form (' + e.message + '); nothing was written');
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail(name + ' is not a JSON object; nothing was written');
    let want;
    try {
      want = fileOf(doc.formDesc);
    } catch (e) {
      fail(name + ': ' + e.message + '; nothing was written');
    }
    if (want !== name) fail(name + ' holds the form ' + doc.formDesc + ', whose file is ' + want + '; nothing was written');
    delete doc._id;
    out[name] = { doc, sha: sha(bytes) };
  }
  return out;
}

function applyWorld(plan) {
  const db = connect(plan.uri, plan.db);
  const coll = db.getCollection(kCollection);
  const files = readFolder(plan.from);
  const writes = [];
  const removes = [];
  let added = 0;
  if (plan.mode === 'replace') {
    for (const name of Object.keys(files)) writes.push(files[name].doc);
    const keep = new Set(writes.map((d) => d.formDesc));
    coll.find({}, { formDesc: 1, _id: 0 }).forEach((d) => { if (!keep.has(d.formDesc)) removes.push(d.formDesc); });
  } else if (plan.mode === 'changes') {
    const manifest = JSON.parse(fs.readFileSync(plan.manifest, 'utf8'));
    if (manifest.db !== plan.db) fail('the manifest is of ' + manifest.db + ', not ' + plan.db + '; nothing was written');
    const was = manifest.forms || {};
    for (const name of Object.keys(files)) {
      if (!(name in was)) { writes.push(files[name].doc); added++; }
      else if (was[name] !== files[name].sha) writes.push(files[name].doc);
    }
    for (const name of Object.keys(was)) if (!(name in files)) removes.push(name.replace(/\.json$/, '').replace('_', ':'));
    // The database still holds what was exported, or already what the
    // folder says (a run cut off part way, run again): a form written since
    // means the server ran while the tool worked, and this would undo it.
    const next = {};
    for (const doc of writes) next[doc.formDesc] = canon(doc);
    const touched = writes.map((d) => d.formDesc).concat(removes);
    for (let i = 0; i < touched.length; i += kBatch) {
      const some = touched.slice(i, i + kBatch);
      coll.find({ formDesc: { $in: some } }, { _id: 0 }, { promoteValues: false }).forEach((d) => {
        const now = canon(d);
        const exported = was[fileOf(d.formDesc)];
        if (!(exported && sha(Buffer.from(now, 'utf8')) === exported) && now !== next[d.formDesc]) {
          fail(d.formDesc + ' changed in the database while the tool worked on the folder; nothing was written');
        }
      });
    }
  } else {
    fail('the plan names no mode this knows: ' + plan.mode);
  }

  ensureIndexes(db);
  const concern = { w: 1, j: true };
  let written = 0;
  for (let i = 0; i < writes.length; i += kBatch) {
    const ops = writes.slice(i, i + kBatch).map((doc) => ({
      replaceOne: { filter: { formDesc: doc.formDesc }, replacement: doc, upsert: true },
    }));
    const r = coll.bulkWrite(ops, { ordered: true, writeConcern: concern });
    written += r.matchedCount + r.upsertedCount;
  }
  if (written !== writes.length) fail('MongoDB took ' + written + ' of the ' + writes.length + ' forms written');
  let removed = 0;
  for (let i = 0; i < removes.length; i += kBatch) {
    const r = coll.deleteMany({ formDesc: { $in: removes.slice(i, i + kBatch) } }, { writeConcern: concern });
    removed += r.deletedCount;
  }
  const after = coll.countDocuments({});
  if (plan.mode === 'replace' && after !== writes.length) {
    fail('the database holds ' + after + ' forms after the restore, where the folder has ' + writes.length);
  }
  print('APPLIED|' + written + '|' + added + '|' + removed + '|' + after);
}

function countWorld(plan) {
  const db = connect(plan.uri, plan.db);
  const coll = db.getCollection(kCollection);
  const forms = coll.countDocuments({});
  const people = coll.countDocuments({ profileId: { $gt: 0 }, isDeleted: { $ne: true } });
  print('COUNT|' + forms + '|' + people);
}

function emptyWorld(plan) {
  if (plan.db !== 'thornswood-rehearsal' && plan.db !== 'thornswood-load') fail('only the rehearsal\'s and the load test\'s worlds are ever emptied, not ' + plan.db);
  const db = connect(plan.uri, plan.db);
  const coll = db.getCollection(kCollection);
  const had = coll.countDocuments({});
  coll.drop({ writeConcern: { w: 1, j: true } });
  const left = coll.countDocuments({});
  if (left !== 0) fail(plan.db + ' still holds ' + left + ' forms');
  print('EMPTIED|' + had);
}

const planPath = process.env.THORNSWOOD_WORLD_PLAN;
if (!planPath) fail('THORNSWOOD_WORLD_PLAN names no plan');
let plan;
try {
  plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
} catch (e) {
  fail('the plan does not read: ' + e.message);
}
if (!/^thornswood-[a-z]+$/.test(String(plan.db))) fail('the plan names no world database: ' + plan.db);
try {
  if (plan.op === 'export') exportWorld(plan);
  else if (plan.op === 'apply') applyWorld(plan);
  else if (plan.op === 'count') countWorld(plan);
  else if (plan.op === 'empty') emptyWorld(plan);
  else fail('the plan names no step this knows: ' + plan.op);
} catch (e) {
  fail(String(e && e.message ? e.message : e));
}
