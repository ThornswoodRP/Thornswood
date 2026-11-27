// Read-PexCalls.js
//
//     node scripts/mods/Read-PexCalls.js --read <reads.jsonl> <file.pex|file.bsa> ...
//     node scripts/mods/Read-PexCalls.js --record <reads.jsonl> --placed <placed.json> --out <scripts.json>
//
// Which native functions the collection's compiled Papyrus scripts call,
// with the function that calls each one and the instruction it is at
// (#7000). Install-NexusRevision.ps1 -Scripts runs it, through Nexus-Run in
// a cloud session.
//
// WHY THIS EXISTS. Most game and mod scripts never run on the server (#5035):
// the server's Papyrus machine has none of the engine functions they call.
// Building those in needs to know which they are, and #5792 asks for that
// list, measured: each script's calls to native functions, with its archive
// and version. The .pex files are their authors', so they cannot come into
// the repository, and until this nothing that runs off One read them: the
// layout record kept each .pex's sha256 and size and nothing it calls.
//
// --read appends one JSON line per compiled script to reads.jsonl: for a .pex
// the file, for a .bsa every .pex under its scripts folder. It runs once per
// mod while Install-NexusRevision -Record still has the mod unpacked, since
// -Record deletes each copy before the next mod is unpacked.
//
// --record reads those lines and placed.json, the files the deployment placed
// (each one's path in the game folder, the unpacked copy it came from, its
// mod and Nexus file id, and the plugin order), and writes scripts.json. For
// every placed .pex, loose or in an archive: its path, sha256 and file id,
// whether it is the copy the game takes, and each call it makes to a native
// function. A call is native when the script the game takes for the type it
// calls on, or for a type that type extends, declares the function native.
// A call that cannot be settled from the collection, because no script of
// that type is in it (the game's own, in Skyrim - Misc.bsa, are not) or the
// type it is made on is not written down, is listed apart with why. A call
// to a function written in Papyrus is not listed: it runs where the script
// runs, and its own calls are listed in its own script.
//
// METADATA ONLY. No byte of a script is written: names of types, functions,
// variables and states, instruction numbers, paths and hashes.
//
// Exits 0 when it wrote what it was asked, 1 when it could not. A script that
// will not read is a line with its error, never a stop, and is counted in
// scripts.json.
//
// tests/test-7000-pex-calls.js runs it against scripts it compiles itself.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const M = require('./Audit-ModMenus.js');

// ------------------------------------------------------------- the format ---
//
// A compiled script, as the game reads it: big endian, a header, the string
// table every name is an index into, debug lines, user flags, then the
// objects with their variables, properties and states, and each state's
// functions with their instructions. Each instruction is an opcode and a
// fixed number of arguments; the three calls carry a count and that many
// more. The argument counts are the opcode table of Skyrim's Papyrus
// (0x00 nop to 0x23 array_rfindelement).

const ARGS = [0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 1, 2, 2, 3, 2, 3, 1, 3, 3, 3, 2, 2, 3, 3, 4, 4];
const CALLMETHOD = 0x17;
const CALLPARENT = 0x18;
const CALLSTATIC = 0x19;
const NATIVE = 0x02;

function reader(b) {
  let p = 0;
  const r = {
    at: function () { return p; },
    u8: function () { const v = b.readUInt8(p); p += 1; return v; },
    u16: function () { const v = b.readUInt16BE(p); p += 2; return v; },
    u32: function () { const v = b.readUInt32BE(p); p += 4; return v; },
    skip: function (n) { p += n; if (p > b.length) { throw new Error('the script ends early'); } },
    wstr: function () { const n = r.u16(); const s = b.toString('latin1', p, p + n); r.skip(n); return s; }
  };
  return r;
}

/*
  One compiled script: its object, the type it extends, the functions it
  declares (and which of them are native), and every call it makes, as
  [caller, instruction, op, type, function]. caller is "<state>.<function>"
  ("" is the empty state) or "<property>.get" / ".set"; type is "" when the
  thing a method is called on has no type written down.
*/
function readCalls(b) {
  if (b.length < 20 || b.readUInt32BE(0) !== 0xfa57c0de) { throw new Error('not a compiled Papyrus script'); }
  const r = reader(b);
  r.skip(16);
  r.wstr(); r.wstr(); r.wstr();
  const strings = [];
  const count = r.u16();
  for (let i = 0; i < count; i++) { strings.push(r.wstr()); }
  const s = function (i) {
    if (i >= strings.length) { throw new Error('a name past the end of the string table'); }
    return strings[i];
  };
  if (r.u8()) {
    r.skip(8);
    const fns = r.u16();
    for (let i = 0; i < fns; i++) { r.skip(7); const lines = r.u16(); r.skip(lines * 2); }
  }
  const flags = r.u16();
  r.skip(flags * 3);
  function value() {
    const t = r.u8();
    if (t === 0) { return { t: 0 }; }
    if (t === 1 || t === 2) { return { t: t, s: s(r.u16()) }; }
    if (t === 3) { const v = r.u32() | 0; return { t: 3, n: v }; }
    if (t === 4) { r.skip(4); return { t: 4 }; }
    if (t === 5) { r.skip(1); return { t: 5 }; }
    throw new Error('an argument of unknown kind ' + t);
  }
  const out = { object: '', parent: '', natives: [], defined: [], calls: [] };
  let vars = {};
  function fn(caller) {
    r.u16(); r.u16(); r.u32();
    const fl = r.u8();
    const types = {};
    const np = r.u16();
    for (let i = 0; i < np; i++) { const n = s(r.u16()); types[n.toLowerCase()] = s(r.u16()); }
    const nl = r.u16();
    for (let i = 0; i < nl; i++) { const n = s(r.u16()); types[n.toLowerCase()] = s(r.u16()); }
    const ni = r.u16();
    for (let i = 0; i < ni; i++) {
      const op = r.u8();
      if (op >= ARGS.length) { throw new Error('an instruction of unknown opcode ' + op + ' in ' + caller); }
      const a = [];
      for (let k = 0; k < ARGS[op]; k++) { a.push(value()); }
      if (op === CALLMETHOD || op === CALLPARENT || op === CALLSTATIC) {
        const more = value();
        for (let k = 0; k < (more.t === 3 ? more.n : 0); k++) { value(); }
        if (op === CALLMETHOD) {
          const on = a[1].s || '';
          const lower = on.toLowerCase();
          const type = lower === 'self' ? out.object : (types[lower] || vars[lower] || '');
          out.calls.push([caller, i, 'method', type, a[0].s || '']);
        } else if (op === CALLPARENT) {
          out.calls.push([caller, i, 'parent', out.parent, a[0].s || '']);
        } else {
          out.calls.push([caller, i, 'static', a[0].s || '', a[1].s || '']);
        }
      }
    }
    return fl;
  }
  const objects = r.u16();
  for (let o = 0; o < objects; o++) {
    const name = s(r.u16());
    r.u32();
    const parent = s(r.u16());
    r.u16(); r.u32(); r.u16();
    if (o === 0) { out.object = name; out.parent = parent; }
    vars = {};
    const nv = r.u16();
    for (let i = 0; i < nv; i++) {
      const vn = s(r.u16());
      vars[vn.toLowerCase()] = s(r.u16());
      r.u32();
      value();
    }
    const np = r.u16();
    for (let i = 0; i < np; i++) {
      const pn = s(r.u16());
      r.u16(); r.u16(); r.u32();
      const pf = r.u8();
      if (pf & 4) { r.u16(); }
      if ((pf & 5) === 1) { fn(pn + '.get'); }
      if ((pf & 6) === 2) { fn(pn + '.set'); }
    }
    const ns = r.u16();
    for (let i = 0; i < ns; i++) {
      const state = s(r.u16());
      const nf = r.u16();
      for (let k = 0; k < nf; k++) {
        const fname = s(r.u16());
        const fl = fn(state + '.' + fname);
        if (o !== 0) { continue; }
        if (out.defined.indexOf(fname) < 0) { out.defined.push(fname); }
        if ((fl & NATIVE) && out.natives.indexOf(fname) < 0) { out.natives.push(fname); }
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------- --read ---

function sha256(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

function oneLine(file, inner, bytes) {
  const line = { file: file, inner: inner, sha256: sha256(bytes) };
  try { Object.assign(line, readCalls(bytes)); } catch (e) { line.error = e.message; }
  return line;
}

function readFiles(out, files) {
  const lines = [];
  for (const file of files) {
    if (/\.bsa$/i.test(file)) {
      let found;
      try { found = M.archiveScripts(file); } catch (e) { lines.push({ file: file, inner: '', error: 'the archive would not read: ' + e.message }); continue; }
      for (const k of Object.keys(found).sort()) {
        const inner = 'scripts\\' + k + '.pex';
        let bytes;
        try { bytes = M.archiveFile(found[k]); } catch (e) { lines.push({ file: file, inner: inner, error: 'would not come out of the archive: ' + e.message }); continue; }
        lines.push(oneLine(file, inner, bytes));
      }
    } else {
      let bytes;
      try { bytes = fs.readFileSync(file); } catch (e) { lines.push({ file: file, inner: '', error: 'would not read: ' + e.message }); continue; }
      lines.push(oneLine(file, '', bytes));
    }
  }
  fs.appendFileSync(out, lines.map(function (l) { return JSON.stringify(l) + '\n'; }).join(''));
  return lines.length;
}

// --------------------------------------------------------------- --record ---

/*
  Which copy of each script the game takes. A loose file in Data\Scripts
  beats every archive. Between archives, the one loaded by the later plugin
  wins; an archive no enabled plugin loads is not loaded, unless the game's
  ini names it, which none of the collection's is. The same rule as
  Audit-ModMenus.js scriptFinder.
*/
function archiveRank(rel, order) {
  const stem = path.win32.basename(rel).replace(/\.bsa$/i, '').toLowerCase();
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i].replace(/\.(esp|esm|esl)$/i, '').toLowerCase();
    if (stem === p || stem.indexOf(p + ' - ') === 0) { return i; }
  }
  return -1;
}

function record(readsFile, placedFile, outFile) {
  const placed = JSON.parse(fs.readFileSync(placedFile, 'utf8').replace(/^﻿/, ''));
  const byFull = {};
  for (const line of fs.readFileSync(readsFile, 'utf8').split('\n')) {
    if (!line.trim()) { continue; }
    const l = JSON.parse(line);
    (byFull[l.file] = byFull[l.file] || []).push(l);
  }
  const order = (placed.plugins || []).map(String);
  const scripts = [];
  const missingReads = [];
  for (const f of placed.files || []) {
    const lines = byFull[f.full];
    if (!lines) { missingReads.push(f.rel); continue; }
    const loose = /^Data\\Scripts\\[^\\]+\.pex$/i.test(f.rel);
    const rank = loose ? Infinity : archiveRank(f.rel, order);
    for (const l of lines) {
      scripts.push({ l: l, path: f.rel, inner: l.inner || '', fileId: f.fileId, mod: f.mod, loose: loose, rank: rank });
    }
  }
  // The copy the game takes of each type, by the object's name.
  const takes = {};
  for (const x of scripts) {
    if (x.l.error || !x.l.object || x.rank < 0) { continue; }
    const k = x.l.object.toLowerCase();
    if (!takes[k] || x.rank > takes[k].rank) { takes[k] = x; }
  }
  // The script a call on type lands in: the type's own, or the first up its
  // chain that declares the function. null when the chain leaves the
  // collection before the function is found.
  function lands(type, fname) {
    const f = fname.toLowerCase();
    const seen = {};
    let t = type;
    while (t) {
      const k = t.toLowerCase();
      if (seen[k]) { return { why: 'the scripts ' + type + ' extends go round in a circle' }; }
      seen[k] = true;
      const x = takes[k];
      if (!x) { return { why: 'no script of ' + t + ' in the collection' }; }
      if (x.l.defined.some(function (d) { return d.toLowerCase() === f; })) {
        return { in: x.l.object, native: x.l.natives.some(function (d) { return d.toLowerCase() === f; }) };
      }
      t = x.l.parent;
    }
    return { why: fname + ' is declared by no script ' + type + ' extends in the collection' };
  }
  const out = [];
  let nativeCalls = 0;
  let unsettled = 0;
  let broken = 0;
  for (const x of scripts) {
    const row = { path: x.path, inner: x.inner, sha256: x.l.sha256, fileId: x.fileId, mod: x.mod };
    if (x.l.error) { row.error = x.l.error; broken++; out.push(row); continue; }
    const k = x.l.object.toLowerCase();
    row.object = x.l.object;
    row.parent = x.l.parent;
    row.taken = x.rank >= 0 && takes[k] === x;
    if (x.rank < 0) { row.why = 'no enabled plugin loads this archive, so the game never reads it'; }
    row.declaresNative = x.l.natives;
    row.natives = [];
    row.unsettled = [];
    for (const c of x.l.calls) {
      if (!c[3]) { row.unsettled.push([c[0], c[1], c[2], '', c[4], 'the type it is called on is not written down']); continue; }
      const got = lands(c[3], c[4]);
      if (got.why) { row.unsettled.push([c[0], c[1], c[2], c[3], c[4], got.why]); continue; }
      if (got.native) { row.natives.push([c[0], c[1], c[2], c[3], c[4], got.in]); }
    }
    nativeCalls += row.natives.length;
    unsettled += row.unsettled.length;
    out.push(row);
  }
  const doc = {
    schema: 1,
    tool: 'scripts/mods/Read-PexCalls.js (#7000)',
    collection: placed.collection || null,
    columns: {
      natives: ['caller', 'instruction', 'call', 'type', 'function', 'declared in'],
      unsettled: ['caller', 'instruction', 'call', 'type', 'function', 'why']
    },
    about: 'Every compiled script the layout places, loose or in an archive, and the calls each makes to native functions: caller is "<state>.<function>" (the empty state is ""), or "<property>.get" or ".set"; instruction is its place in that function; call is method, static or parent. A call the collection cannot settle (no script of the type in it, or a type not written down) is under unsettled with why. taken is whether this is the copy the game reads. Metadata only.',
    counts: { scripts: out.length, taken: out.filter(function (r) { return r.taken; }).length, nativeCalls: nativeCalls, unsettled: unsettled, wouldNotRead: broken, filesNotRead: missingReads.length },
    filesNotRead: missingReads,
    scripts: out
  };
  fs.writeFileSync(outFile, JSON.stringify(doc) + '\n');
  return doc;
}

module.exports = { readCalls: readCalls, record: record, archiveRank: archiveRank };

function main(args) {
  const at = function (name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : ''; };
  if (args[0] === '--read' && args[1]) {
    const n = readFiles(args[1], args.slice(2));
    console.log(n + ' compiled script(s) read');
    return 0;
  }
  if (args[0] === '--record' && args[1] && at('placed') && at('out')) {
    const doc = record(args[1], at('placed'), at('out'));
    const c = doc.counts;
    console.log(c.scripts + ' scripts placed, ' + c.taken + ' of them the copy the game reads; ' + c.nativeCalls + ' calls to native functions, ' +
      c.unsettled + ' the collection cannot settle; ' + c.wouldNotRead + ' would not read' + (c.filesNotRead ? ', ' + c.filesNotRead + ' placed files never read' : ''));
    return c.filesNotRead ? 1 : 0;
  }
  console.log('Use: --read <reads.jsonl> <file.pex|file.bsa> ...   or   --record <reads.jsonl> --placed <placed.json> --out <scripts.json>');
  return 1;
}

if (require.main === module) { process.exitCode = main(process.argv.slice(2)); }
