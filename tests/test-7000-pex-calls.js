// test-7000-pex-calls.js
//
//     node tests/test-7000-pex-calls.js
//
// WHY THIS EXISTS. #7000: nothing that runs off One could say which native
// functions the collection's compiled scripts call, which #5792 and #5035
// need. scripts/mods/Read-PexCalls.js reads them for Install-NexusRevision
// -Scripts. The collection's scripts are their authors', so this compiles
// scripts of its own, byte by byte in the game's format, and an archive to
// hold some of them.
//
// What it checks:
//   1. one script: its object and parent, the functions it declares and which
//      are native, and each call (method on self, on a variable, on a local,
//      static, parent, inside a property's handler) with its caller and its
//      instruction, through every kind of argument and every fixed-length
//      opcode before it;
//   2. --read, on a loose script, an archive holding scripts, and a file that
//      is not a script: a line each, the bad one with its error;
//   3. --record: a call that lands on a native up the chain is listed with
//      the script that declares it; one that lands on Papyrus is not; one
//      the collection cannot settle is listed apart with why; the loose copy
//      is the one taken over an archive's; an archive no plugin loads is never
//      taken; a placed file never read is counted and exits 1; nothing of a
//      script's bytes is written.
//
// Exits 1 when any check fails. Writes only in its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const TOOL = path.join(repo, 'scripts', 'mods', 'Read-PexCalls.js');
const P = require(TOOL);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------- a compiled script, made ---
function pex(spec) {
  const strings = [];
  const idx = function (s) { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const body = [];
  const u8 = function (v) { const b = Buffer.alloc(1); b.writeUInt8(v); body.push(b); };
  const u16 = function (v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); body.push(b); };
  const u32 = function (v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); body.push(b); };
  const str = function (s) { u16(idx(s)); };
  // arguments: 'id:name', 'str:text', an integer, 1.5 (a float), true/false, null
  function arg(a) {
    if (a === null) { u8(0); } else if (typeof a === 'boolean') { u8(5); u8(a ? 1 : 0); } else if (typeof a === 'number' && Number.isInteger(a)) { u8(3); u32(a); } else if (typeof a === 'number') { u8(4); u32(0x3fc00000); } else if (a.indexOf('str:') === 0) { u8(2); str(a.slice(4)); } else { u8(1); str(a.replace(/^id:/, '')); }
  }
  function fn(f) {
    str(f.ret || 'None'); str(''); u32(0); u8(f.native ? 3 : 0);
    u16((f.params || []).length); (f.params || []).forEach(function (p) { str(p[0]); str(p[1]); });
    u16((f.locals || []).length); (f.locals || []).forEach(function (p) { str(p[0]); str(p[1]); });
    u16((f.code || []).length);
    (f.code || []).forEach(function (ins) {
      u8(ins[0]);
      const fixed = ins[1];
      fixed.forEach(arg);
      if (ins[0] >= 0x17 && ins[0] <= 0x19) { arg((ins[2] || []).length); (ins[2] || []).forEach(arg); }
    });
  }
  str(spec.name); u32(0); str(spec.parent || ''); str(''); u32(0); str('');
  u16((spec.vars || []).length); (spec.vars || []).forEach(function (v) { str(v[0]); str(v[1]); u32(0); arg(null); });
  u16((spec.props || []).length);
  (spec.props || []).forEach(function (p) {
    str(p.name); str(p.type); str(''); u32(0); u8(p.flags);
    if (p.flags & 4) { str(p.auto); }
    if ((p.flags & 5) === 1) { fn(p.get); }
    if ((p.flags & 6) === 2) { fn(p.set); }
  });
  u16((spec.states || []).length);
  (spec.states || []).forEach(function (st) {
    str(st.name); u16(st.fns.length);
    st.fns.forEach(function (f) { str(f.name); fn(f); });
  });
  const objects = Buffer.concat(body);
  const head = [];
  const h = Buffer.alloc(16); h.writeUInt32BE(0xfa57c0de, 0); h.writeUInt8(3, 4); h.writeUInt8(2, 5); h.writeUInt16BE(1, 6);
  head.push(h);
  const w = function (s) { const b = Buffer.alloc(2 + s.length); b.writeUInt16BE(s.length); b.write(s, 2, 'latin1'); head.push(b); };
  w(spec.name + '.psc'); w('someone'); w('somewhere');
  const n = Buffer.alloc(2); n.writeUInt16BE(strings.length); head.push(n);
  strings.forEach(w);
  // debug info: one function's lines; user flags: one
  const dbg = Buffer.alloc(1 + 8 + 2 + 7 + 2 + 4); let q = 0;
  dbg.writeUInt8(1, q); q += 1 + 8; dbg.writeUInt16BE(1, q); q += 2 + 7; dbg.writeUInt16BE(2, q); head.push(dbg);
  const uf = Buffer.alloc(2 + 3); uf.writeUInt16BE(1, 0); head.push(uf);
  const oc = Buffer.alloc(2); oc.writeUInt16BE(1); head.push(oc);
  return Buffer.concat(head.concat([objects]));
}

// An archive of the Special Edition's kind (105), uncompressed, with names.
function bsa(files) {
  const folders = {};
  Object.keys(files).forEach(function (rel) { const i = rel.lastIndexOf('\\'); const f = rel.slice(0, i); (folders[f] = folders[f] || []).push(rel.slice(i + 1)); });
  const names = Object.keys(folders);
  const fileCount = Object.keys(files).length;
  const folderNamesLen = names.reduce(function (a, f) { return a + f.length + 1; }, 0);
  const leafs = []; names.forEach(function (f) { folders[f].forEach(function (l) { leafs.push(l); }); });
  const fileNamesLen = leafs.reduce(function (a, l) { return a + l.length + 1; }, 0);
  const blockAt = 36 + names.length * 24;
  const blockLen = names.length + folderNamesLen + fileCount * 16;
  let dataAt = blockAt + blockLen + fileNamesLen;
  const h = Buffer.alloc(36);
  h.write('BSA\u0000', 0, 'latin1'); h.writeUInt32LE(105, 4); h.writeUInt32LE(36, 8); h.writeUInt32LE(3, 12);
  h.writeUInt32LE(names.length, 16); h.writeUInt32LE(fileCount, 20); h.writeUInt32LE(folderNamesLen, 24); h.writeUInt32LE(fileNamesLen, 28);
  const recs = Buffer.alloc(names.length * 24);
  const blocks = []; const datas = [];
  let inBlock = 0;
  names.forEach(function (f, i) {
    recs.writeUInt32LE(folders[f].length, i * 24 + 8);
    recs.writeUInt32LE(blockAt + fileNamesLen + inBlock, i * 24 + 16);
    const b = Buffer.alloc(1 + f.length + 1 + folders[f].length * 16);
    b.writeUInt8(f.length + 1, 0); b.write(f, 1, 'latin1');
    folders[f].forEach(function (l, k) {
      const bytes = files[f + '\\' + l];
      b.writeUInt32LE(bytes.length, 1 + f.length + 1 + k * 16 + 8);
      b.writeUInt32LE(dataAt, 1 + f.length + 1 + k * 16 + 12);
      dataAt += bytes.length; datas.push(bytes);
    });
    inBlock += b.length; blocks.push(b);
  });
  const nm = Buffer.from(leafs.map(function (l) { return l + '\u0000'; }).join(''), 'latin1');
  return Buffer.concat([h, recs].concat(blocks, [nm], datas));
}

// --------------------------------------------------------------- the scripts
const OP = { nop: 0, iadd: 1, fadd: 2, not: 0x0a, assign: 0x0d, cmpeq: 0x0f, jmp: 0x14, jmpf: 0x16, callmethod: 0x17, callparent: 0x18, callstatic: 0x19, ret: 0x1a, strcat: 0x1b, propget: 0x1c, arraycreate: 0x1e, find: 0x22 };
const quest = pex({
  name: 'TS_Quest', parent: 'TS_Base',
  vars: [['::Who_var', 'Actor']],
  props: [
    { name: 'Who', type: 'Actor', flags: 7, auto: '::Who_var' },
    { name: 'Count', type: 'Int', flags: 1, get: { ret: 'Int', code: [[OP.callmethod, ['DoThing', 'self', '::temp9']], [OP.ret, ['::temp9']]] , locals: [['::temp9', 'Int']] } }
  ],
  states: [
    { name: '', fns: [
      { name: 'OnInit', locals: [['::temp0', 'Actor'], ['::temp1', 'Int'], ['::temp2', 'String'], ['::nonevar', 'None'], ['::temp3', 'Int[]']], code: [
        [OP.nop, []],
        [OP.iadd, ['::temp1', 1, 2]],
        [OP.fadd, ['::temp1', 1.5, 2.5]],
        [OP.strcat, ['::temp2', 'str:a', 'str:b']],
        [OP.cmpeq, ['::temp1', true, false]],
        [OP.jmpf, ['::temp1', 2]],
        [OP.jmp, [1]],
        [OP.arraycreate, ['::temp3', 4]],
        [OP.find, ['::temp3', '::temp1', 0, 0]],
        [OP.callmethod, ['DoThing', 'self', '::temp1'], [5, 'str:x']],
        [OP.callmethod, ['Helper', 'self', '::nonevar']],
        [OP.callstatic, ['Game', 'GetPlayer', '::temp0']],
        [OP.callmethod, ['GetName', '::temp0', '::temp2']],
        [OP.callmethod, ['MoveTo', '::Who_var', '::nonevar'], ['::temp0']],
        [OP.callmethod, ['Wat', 'NoSuchThing', '::nonevar']],
        [OP.callparent, ['OnInit', '::nonevar']],
        [OP.callstatic, ['TS_Base', 'Shared', '::nonevar']],
        [OP.ret, [null]]
      ] }
    ] },
    { name: 'Busy', fns: [{ name: 'OnInit', code: [[OP.callmethod, ['DoThing', 'self', '::nonevar']]] }] }
  ]
});
const base = pex({
  name: 'TS_Base', parent: 'ObjectReference',
  states: [{ name: '', fns: [
    { name: 'DoThing', native: true, ret: 'Int', params: [['n', 'Int'], ['s', 'String']] },
    { name: 'Shared', native: true },
    { name: 'Helper', code: [[OP.callmethod, ['DoThing', 'self', '::nonevar']]] },
    { name: 'OnInit', code: [] }
  ] }]
});
const baseOld = pex({ name: 'TS_Base', parent: 'ObjectReference', states: [{ name: '', fns: [{ name: 'DoThing' }, { name: 'Shared' }, { name: 'Helper' }] }] });

// ------------------------------------------------------------ 1. one script
console.log('one script');
const q = P.readCalls(quest);
yes('it names the object and what it extends', q.object === 'TS_Quest' && q.parent === 'TS_Base');
yes('  the functions it declares, and which are native', q.defined.join(',') === 'OnInit' && q.natives.length === 0 && P.readCalls(base).natives.join(',') === 'DoThing,Shared');
const calls = q.calls.map(function (c) { return c.join('|'); });
yes('  a method on self, at its instruction, past every kind of argument before it', calls.indexOf('.OnInit|9|method|TS_Quest|DoThing') >= 0);
yes('  a static call by its type', calls.indexOf('.OnInit|11|static|Game|GetPlayer') >= 0);
yes('  a method on a local takes the local\'s type', calls.indexOf('.OnInit|12|method|Actor|GetName') >= 0);
yes('  and on a variable of the script the variable\'s', calls.indexOf('.OnInit|13|method|Actor|MoveTo') >= 0);
yes('  one on a name with no type written down is left without one', calls.indexOf('.OnInit|14|method||Wat') >= 0);
yes('  a parent call goes to what it extends', calls.indexOf('.OnInit|15|parent|TS_Base|OnInit') >= 0);
yes('  a call in a property\'s handler names the property', calls.indexOf('Count.get|0|method|TS_Quest|DoThing') >= 0);
yes('  and one in another state names the state', calls.indexOf('Busy.OnInit|0|method|TS_Quest|DoThing') >= 0);
let threw = '';
try { P.readCalls(Buffer.from('not a script at all, not at all')); } catch (e) { threw = e.message; }
yes('a file that is not a script is said to be one it is not', /not a compiled Papyrus script/.test(threw));
threw = '';
try { P.readCalls(quest.slice(0, quest.length - 20)); } catch (e) { threw = e.message; }
yes('a script cut short is said to be', threw !== '');

// ---------------------------------------------------------------- 2. --read
console.log('');
console.log('--read');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-7000-'));
try {
  const loose = path.join(tmp, 'mods', '1', 'Scripts', 'TS_Quest.pex');
  fs.mkdirSync(path.dirname(loose), { recursive: true });
  fs.writeFileSync(loose, quest);
  const arch = path.join(tmp, 'mods', '1', 'TS Mod.bsa');
  fs.writeFileSync(arch, bsa({ 'scripts\\ts_quest.pex': quest, 'scripts\\ts_base.pex': base, 'meshes\\x.nif': Buffer.from('nif') }));
  const stray = path.join(tmp, 'mods', '2', 'Stray.bsa');
  fs.mkdirSync(path.dirname(stray), { recursive: true });
  fs.writeFileSync(stray, bsa({ 'scripts\\ts_base.pex': baseOld }));
  const bad = path.join(tmp, 'mods', '2', 'Scripts', 'Broken.pex');
  fs.mkdirSync(path.dirname(bad), { recursive: true });
  fs.writeFileSync(bad, Buffer.from('garbage garbage garbage'));
  const reads = path.join(tmp, 'reads.jsonl');
  const said = execFileSync('node', [TOOL, '--read', reads, loose, arch], { encoding: 'utf8' });
  execFileSync('node', [TOOL, '--read', reads, stray, bad], { encoding: 'utf8' });
  const lines = fs.readFileSync(reads, 'utf8').trim().split('\n').map(JSON.parse);
  yes('a line for the loose script and each script in the archive, none for its mesh', lines.length === 5 && /3 compiled script\(s\) read/.test(said));
  yes('  each with its sha256', lines.every(function (l) { return /^[0-9a-f]{64}$/.test(l.sha256 || ''); }));
  yes('  an archive\'s with its path inside it', lines.filter(function (l) { return l.file === arch; }).map(function (l) { return l.inner; }).sort().join(',') === 'scripts\\ts_base.pex,scripts\\ts_quest.pex');
  yes('  the file that is not a script with its error, and the run goes on', lines.some(function (l) { return l.file === bad && /not a compiled Papyrus script/.test(l.error || ''); }));

  // ------------------------------------------------------------- 3. --record
  console.log('');
  console.log('--record');
  const placed = path.join(tmp, 'placed.json');
  const doc = {
    collection: { slug: '7essxf', revision: 12 },
    plugins: ['Skyrim.esm', 'TS Mod.esp'],
    files: [
      { rel: 'Data\\Scripts\\TS_Quest.pex', full: loose, fileId: 111, mod: 'TS Mod' },
      { rel: 'Data\\TS Mod.bsa', full: arch, fileId: 111, mod: 'TS Mod' },
      { rel: 'Data\\Stray.bsa', full: stray, fileId: 222, mod: 'Stray' },
      { rel: 'Data\\Scripts\\Broken.pex', full: bad, fileId: 222, mod: 'Stray' }
    ]
  };
  fs.writeFileSync(placed, JSON.stringify(doc));
  const out = path.join(tmp, 'scripts.json');
  const run = spawnSync('node', [TOOL, '--record', reads, '--placed', placed, '--out', out], { encoding: 'utf8' });
  yes('it exits 0 and says what it found', run.status === 0 && /5 scripts placed, 2 of them the copy the game reads/.test(run.stdout));
  const rec = JSON.parse(fs.readFileSync(out, 'utf8'));
  const row = function (p, inner) { return rec.scripts.filter(function (r) { return r.path === p && r.inner === inner; })[0]; };
  const lq = row('Data\\Scripts\\TS_Quest.pex', '');
  const aq = row('Data\\TS Mod.bsa', 'scripts\\ts_quest.pex');
  const ab = row('Data\\TS Mod.bsa', 'scripts\\ts_base.pex');
  const sb = row('Data\\Stray.bsa', 'scripts\\ts_base.pex');
  yes('every placed script is a row, with its path, sha256, file id and mod', rec.scripts.length === 5 && lq.fileId === 111 && lq.mod === 'TS Mod' && /^[0-9a-f]{64}$/.test(lq.sha256));
  yes('  the loose copy is the one the game reads, not the archive\'s', lq.taken === true && aq.taken === false && ab.taken === true);
  yes('  an archive no enabled plugin loads is never read, and says so', sb.taken === false && /no enabled plugin loads this archive/.test(sb.why));
  const nat = lq.natives.map(function (c) { return c.join('|'); });
  yes('a call that lands on a native up the chain is listed, with where it is declared', nat.indexOf('.OnInit|9|method|TS_Quest|DoThing|TS_Base') >= 0 && nat.indexOf('Count.get|0|method|TS_Quest|DoThing|TS_Base') >= 0);
  yes('  so is a static one', nat.indexOf('.OnInit|16|static|TS_Base|Shared|TS_Base') >= 0);
  yes('  a call to a function written in Papyrus is not', !lq.natives.some(function (c) { return c[4] === 'Helper' || c[4] === 'OnInit'; }) && !lq.unsettled.some(function (c) { return c[4] === 'Helper' || (c[4] === 'OnInit' && c[2] === 'parent'); }));
  const un = lq.unsettled.map(function (c) { return c.join('|'); });
  yes('one on a type with no script in the collection is unsettled, and says so', un.indexOf('.OnInit|11|static|Game|GetPlayer|no script of Game in the collection') >= 0 && un.indexOf('.OnInit|12|method|Actor|GetName|no script of Actor in the collection') >= 0);
  yes('  one on a native the chain leaves the collection before reaching says where it left', un.indexOf('.OnInit|13|method|Actor|MoveTo|no script of Actor in the collection') >= 0);
  yes('  one on a name with no type written down says that', un.indexOf('.OnInit|14|method||Wat|the type it is called on is not written down') >= 0);
  yes('the script that would not read is a row with its error, and counted', row('Data\\Scripts\\Broken.pex', '').error && rec.counts.wouldNotRead === 1);
  yes('the counts add up', rec.counts.scripts === 5 && rec.counts.taken === 2 && rec.counts.nativeCalls === lq.natives.length + aq.natives.length + ab.natives.length + sb.natives.length);
  const text = fs.readFileSync(out, 'latin1');
  yes('nothing of a script\'s bytes is in the record', text.indexOf('someone') < 0 && text.indexOf('somewhere') < 0 && text.indexOf(quest.slice(0, 4).toString('latin1')) < 0);
  yes('the record names its columns', rec.columns.natives.length === 6 && rec.columns.unsettled.length === 6);

  doc.files.push({ rel: 'Data\\Scripts\\Never.pex', full: path.join(tmp, 'never.pex'), fileId: 333, mod: 'Never' });
  fs.writeFileSync(placed, JSON.stringify(doc));
  const short = spawnSync('node', [TOOL, '--record', reads, '--placed', placed, '--out', out], { encoding: 'utf8' });
  yes('a placed file that was never read is counted, named, and exits 1', short.status === 1 && /1 placed files never read/.test(short.stdout) && JSON.parse(fs.readFileSync(out, 'utf8')).filesNotRead[0] === 'Data\\Scripts\\Never.pex');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
