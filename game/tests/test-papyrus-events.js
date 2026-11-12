// test-papyrus-events.js
//
// Audit-PapyrusEvents.py sorts the load order by what the event blocker leaves
// alive, and bsa.py reads the archives Skyrim Special Edition actually makes.
//
// WHY THIS EXISTS. Entry 323: on 20 September Patrick reported that "a lot of
// the mods in our list are just straight up not present in the game". They are
// loaded and doing nothing, because the client blanks every Papyrus event but
// OnUpdate (FridaHooks.cpp:43-72 in the fork). The per-event decision the entry
// asks for needs to know which events the collection waits on, and until the
// audit nothing here read a .pex. Two things were wrong on the way: bsa.py
// only knew zlib, and every compressed archive SSE makes is LZ4, so ten of the
// twenty five archives carrying scripts could not be read at all; and a .pex
// built by Caprica carries an object size nothing should trust.
//
// So this builds a Data folder in a temp directory from nothing: native base
// scripts that declare the events, mod scripts that handle them, plugins whose
// VMADs put them on records, aliases and fragments, an LZ4 compressed archive
// and a plain one. It runs the audit on it and checks every judgement. Then it
// feeds bsa.lz4_frame frames built by hand. If this machine has the game folder,
// it runs the real audit too and checks nothing in it was unreadable.
//
// Read only apart from its own temp folder, which it removes.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REPO = REPO_DIR;
const AUDIT = path.join(REPO, 'scripts', 'dev', 'Audit-PapyrusEvents.py');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

function findPython() {
  const tries = [['python', []], ['py', ['-3']], ['python3', []]];
  for (let i = 0; i < tries.length; i++) {
    const r = spawnSync(tries[i][0], tries[i][1].concat(['-c', 'import sys; print(sys.version_info[0])']),
      { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === '3') return tries[i];
  }
  return null;
}
const PY = findPython();
yes('there is a Python 3 to run the audit with', !!PY);
if (!PY) done();
function py(args, opts) {
  return spawnSync(PY[0], PY[1].concat(args), Object.assign({ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }, opts || {}));
}

// ---------------------------------------------------------------------------
// Bytes

function u16be(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function i32be(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; }
function f32be(n) { const b = Buffer.alloc(4); b.writeFloatBE(n); return b; }
function u16le(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function i16le(n) { const b = Buffer.alloc(2); b.writeInt16LE(n); return b; }
function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function i32le(n) { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; }
function f32le(n) { const b = Buffer.alloc(4); b.writeFloatLE(n); return b; }
function wstrbe(s) { const b = Buffer.from(s, 'latin1'); return Buffer.concat([u16be(b.length), b]); }
function wstrle(s) { const b = Buffer.from(s, 'latin1'); return Buffer.concat([u16le(b.length), b]); }
function cat(parts) { return Buffer.concat(parts.map(function (p) { return Buffer.isBuffer(p) ? p : Buffer.from(p); })); }

// ---------------------------------------------------------------------------
// .pex, big endian, the shape the Skyrim compiler writes.

function Strings() { this.list = []; this.at = new Map(); }
Strings.prototype.i = function (s) {
  if (!this.at.has(s)) { this.at.set(s, this.list.length); this.list.push(s); }
  return this.at.get(s);
};

// Operands, each a function of the string table.
const op = {
  none: function () { return function () { return Buffer.from([0]); }; },
  id: function (s) { return function (t) { return cat([[1], u16be(t.i(s))]); }; },
  str: function (s) { return function (t) { return cat([[2], u16be(t.i(s))]); }; },
  int: function (n) { return function () { return cat([[3], i32be(n)]); }; },
  flt: function (n) { return function () { return cat([[4], f32be(n)]); }; },
  bool: function (v) { return function () { return Buffer.from([5, v ? 1 : 0]); }; },
};
function ins(code, operands, varargs) {
  return function (t) {
    const parts = [Buffer.from([code])].concat(operands.map(function (o) { return o(t); }));
    if (varargs) {
      parts.push(op.int(varargs.length)(t));
      varargs.forEach(function (o) { parts.push(o(t)); });
    }
    return cat(parts);
  };
}
// A few ordinary instructions, so the reader has to count operands right.
const filler = [
  ins(0x0D, [op.id('::temp0'), op.int(1)]),
  ins(0x01, [op.id('::temp0'), op.id('::temp0'), op.int(2)]),
  ins(0x1B, [op.id('::temp1'), op.str('a'), op.str('b')]),
  ins(0x16, [op.bool(false), op.int(1)]),
  ins(0x22, [op.id('::temp2'), op.id('::temp3'), op.int(0), op.int(0)]),
];
function callSelf(m, args) { return ins(0x17, [op.id(m), op.id('self'), op.id('::NoneVar')], args || []); }
function callOn(obj, m, args) { return ins(0x17, [op.id(m), op.id(obj), op.id('::NoneVar')], args || []); }
function callParent(m) { return ins(0x18, [op.id(m), op.id('::NoneVar')], []); }
function ret() { return ins(0x1A, [op.none()]); }
function body(calls) { return filler.concat(calls || []).concat([ret()]); }

function fnBytes(t, f) {
  const parts = [u16be(t.i(f.ret || 'None')), u16be(t.i('')), u32be(0), Buffer.from([f.flags || 0])];
  const params = f.params || [];
  parts.push(u16be(params.length));
  params.forEach(function (p) { parts.push(u16be(t.i(p)), u16be(t.i('Int'))); });
  parts.push(u16be(1), u16be(t.i('::temp0')), u16be(t.i('Int')));
  const code = f.code || [];
  parts.push(u16be(code.length));
  code.forEach(function (c) { parts.push(c(t)); });
  return cat(parts);
}

// spec: { name, parent, states: { stateName: { fnName: { flags, code } } }, sizeLie }
function pex(spec) {
  const t = new Strings();
  const obj = [u16be(t.i(spec.parent || '')), u16be(t.i('')), u32be(0), u16be(t.i(''))];
  // One variable and two properties, one auto and one with a read handler,
  // because they sit in front of the states and have to be walked over.
  obj.push(u16be(1), u16be(t.i('::x_var')), u16be(t.i('Int')), u32be(0), op.int(3)(t));
  obj.push(u16be(2));
  obj.push(u16be(t.i('Auto1')), u16be(t.i('Int')), u16be(t.i('')), u32be(0), Buffer.from([7]), u16be(t.i('::x_var')));
  obj.push(u16be(t.i('Read1')), u16be(t.i('Int')), u16be(t.i('')), u32be(0), Buffer.from([1]),
    fnBytes(t, { code: [ret()] }));
  const states = spec.states;
  const names = Object.keys(states);
  obj.push(u16be(names.length));
  names.forEach(function (sn) {
    const fns = Object.keys(states[sn]);
    obj.push(u16be(t.i(sn)), u16be(fns.length));
    fns.forEach(function (fname) { obj.push(u16be(t.i(fname)), fnBytes(t, states[sn][fname])); });
  });
  const objBody = cat(obj);
  const nameIdx = t.i(spec.name);
  const dbg = [t.i(spec.name), t.i(''), t.i('Read1')];
  // Caprica writes a size nothing should trust. Measured on QuickLootIE.
  const size = spec.sizeLie ? 0xA6010000 : objBody.length + 4;
  const head = [u32be(0xFA57C0DE), Buffer.from([3, 2]), u16be(1), Buffer.alloc(8),
    wstrbe(spec.name + '.psc'), wstrbe('tester'), wstrbe('machine')];
  const table = [u16be(t.list.length)].concat(t.list.map(wstrbe));
  const debug = [Buffer.from([1]), Buffer.alloc(8), u16be(1), u16be(dbg[0]), u16be(dbg[1]), u16be(dbg[2]),
    Buffer.from([0]), u16be(2), u16be(10), u16be(11)];
  const flags = [u16be(1), u16be(t.i('hidden')), Buffer.from([0])];
  return cat(head.concat(table, debug, flags, [u16be(1), u16be(nameIdx), u32be(size), objBody]));
}
function script(name, parent, fns, extra) {
  return pex(Object.assign({ name: name, parent: parent, states: { '': fns } }, extra || {}));
}
const NATIVE = 2, GLOBAL = 1;
function natives(list) { const o = {}; list.forEach(function (n) { o[n] = { flags: NATIVE }; }); return o; }
function declared(list) { const o = {}; list.forEach(function (n) { o[n] = { code: [] }; }); return o; }
function handler(calls) { return { code: body(calls) }; }

// ---------------------------------------------------------------------------
// Plugins, little endian.

function sub(sig, data) { return cat([Buffer.from(sig, 'latin1'), u16le(data.length), data]); }
function edid(s) { return sub('EDID', Buffer.from(s + '\0', 'latin1')); }
function rec(sig, fid, subs, opts) {
  opts = opts || {};
  let data = cat(subs);
  let flags = opts.flags || 0;
  if (opts.compressed) { data = cat([u32le(data.length), zlib.deflateSync(data)]); flags |= 0x40000; }
  const h = Buffer.alloc(24);
  h.write(sig, 0, 'latin1'); h.writeUInt32LE(data.length, 4); h.writeUInt32LE(flags, 8);
  h.writeUInt32LE(fid >>> 0, 12); h.writeUInt16LE(44, 20);
  return cat([h, data]);
}
function grup(label, contents, type) {
  const inner = cat(contents);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'latin1'); h.writeUInt32LE(24 + inner.length, 4);
  if (typeof label === 'string') h.write(label, 8, 'latin1'); else h.writeUInt32LE(label >>> 0, 8);
  h.writeUInt32LE(type || 0, 12);
  return cat([h, inner]);
}
function plugin(masters, groups, isMaster) {
  const hedr = cat([f32le(1.7), u32le(1), u32le(0x800)]);
  const subs = [sub('HEDR', hedr)];
  masters.forEach(function (m) { subs.push(sub('MAST', Buffer.from(m + '\0', 'latin1')), sub('DATA', Buffer.alloc(8))); });
  return cat([rec('TES4', 0, subs, { flags: isMaster ? 1 : 0 })].concat(groups));
}
// A script entry in a VMAD, with properties of every kind the reader walks.
function vscript(name, props) {
  props = props || [];
  const parts = [wstrle(name), Buffer.from([0]), u16le(props.length)];
  props.forEach(function (p) { parts.push(wstrle(p[0]), Buffer.from([p[1], 1]), p[2]); });
  return cat(parts);
}
function vscripts(list) {
  return cat([u16le(list.length)].concat(list.map(function (s) { return typeof s === 'string' ? vscript(s) : s; })));
}
function vmad(list, tail) { return sub('VMAD', cat([u16le(5), u16le(2), vscripts(list), tail || Buffer.alloc(0)])); }
const EVERY_PROPERTY = [
  ['pObject', 1, cat([u16le(0), i16le(-1), u32le(0x14)])],
  ['pString', 2, wstrle('hello')],
  ['pInt', 3, i32le(7)],
  ['pFloat', 4, f32le(1.5)],
  ['pBool', 5, Buffer.from([1])],
  ['pObjects', 11, cat([u32le(2), Buffer.alloc(16)])],
  ['pStrings', 12, cat([u32le(2), wstrle('a'), wstrle('bc')])],
  ['pInts', 13, cat([u32le(3), Buffer.alloc(12)])],
  ['pFloats', 14, cat([u32le(1), f32le(2)])],
  ['pBools', 15, cat([u32le(3), Buffer.from([1, 0, 1])])],
];
function questTail(file, aliases) {
  const parts = [Buffer.from([2]), u16le(1), wstrle(file),
    u16le(10), u16le(0), i32le(0), Buffer.from([1]), wstrle(file), wstrle('Fragment_0'),
    u16le(aliases.length)];
  aliases.forEach(function (a) {
    parts.push(u16le(0), i16le(a[0]), u32le(0), u16le(5), u16le(2), vscripts(a[1]));
  });
  return cat(parts);
}
function infoTail(file) { return cat([Buffer.from([2, 1]), wstrle(file), Buffer.from([0]), wstrle(file), wstrle('Fragment_0')]); }
function perkTail(file) { return cat([Buffer.from([2]), wstrle(file), u16le(1), u16le(0), u16le(0), Buffer.from([0]), wstrle(file), wstrle('Fragment_0')]); }
function scenTail(file) { return cat([Buffer.from([2, 0]), wstrle(file), u16le(0)]); }

// ---------------------------------------------------------------------------
// LZ4, a small greedy compressor, and frames around it.

function lz4Block(src) {
  const out = [];
  const n = src.length;
  const seen = new Map();
  let anchor = 0, i = 0;
  function run(len) {
    if (len < 15) return;
    let r = len - 15;
    while (r >= 255) { out.push(255); r -= 255; }
    out.push(r);
  }
  while (i + 12 <= n) {
    const key = src.readUInt32LE(i);
    const cand = seen.get(key);
    seen.set(key, i);
    if (cand !== undefined && i - cand <= 65535) {
      let len = 4;
      while (i + len < n - 5 && src[cand + len] === src[i + len]) len++;
      const lit = i - anchor;
      out.push((Math.min(lit, 15) << 4) | Math.min(len - 4, 15));
      run(lit);
      for (let k = anchor; k < i; k++) out.push(src[k]);
      out.push((i - cand) & 255, (i - cand) >> 8);
      run(len - 4);
      i += len;
      anchor = i;
    } else {
      i++;
    }
  }
  const lit = n - anchor;
  out.push(Math.min(lit, 15) << 4);
  run(lit);
  for (let k = anchor; k < n; k++) out.push(src[k]);
  return Buffer.from(out);
}
// blocks: [{ data: Buffer (already a block), stored: bool }]
function lz4Frame(blocks, opts) {
  opts = opts || {};
  let flg = 0x40 | 0x20;
  if (opts.blockChecksum) flg |= 0x10;
  if (opts.contentSize !== undefined) flg |= 0x08;
  if (opts.contentChecksum) flg |= 0x04;
  const parts = [u32le(0x184D2204), Buffer.from([flg, 0x70])];
  if (opts.contentSize !== undefined) parts.push(u32le(opts.contentSize), u32le(0));
  parts.push(Buffer.from([0xAB]));
  blocks.forEach(function (b) {
    parts.push(u32le(b.data.length | (b.stored ? 0x80000000 : 0)), b.data);
    if (opts.blockChecksum) parts.push(u32le(0xDEADBEEF));
  });
  parts.push(u32le(0));
  if (opts.contentChecksum) parts.push(u32le(0x12345678));
  return cat(parts);
}
function lz4(data) { return lz4Frame([{ data: lz4Block(data) }]); }

// ---------------------------------------------------------------------------
// A version 105 archive. folders: [[name, [[file, data, compressed]]]]

function bsa105(folders, compressedByDefault) {
  const fc = folders.length;
  let filec = 0, folderNames = 0, fileNames = 0;
  folders.forEach(function (f) {
    filec += f[1].length; folderNames += f[0].length + 1;
    f[1].forEach(function (x) { fileNames += x[0].length + 1; });
  });
  let pos = 36 + fc * 24;
  const blockAt = [];
  folders.forEach(function (f) { blockAt.push(pos); pos += 1 + f[0].length + 1 + 16 * f[1].length; });
  pos += fileNames;
  const datas = [], records = [];
  folders.forEach(function (f) {
    const recs = [];
    f[1].forEach(function (x) {
      const packed = x[2] ? cat([u32le(x[1].length), lz4(x[1])]) : x[1];
      let size = packed.length;
      if (!!x[2] !== !!compressedByDefault) size |= 0x40000000;
      recs.push(cat([Buffer.alloc(8), u32le(size), u32le(pos)]));
      datas.push(packed);
      pos += packed.length;
    });
    records.push(recs);
  });
  const head = cat([Buffer.from('BSA\0', 'latin1'), u32le(105), u32le(36), u32le(0x3 | (compressedByDefault ? 4 : 0)),
    u32le(fc), u32le(filec), u32le(folderNames), u32le(fileNames), u32le(0)]);
  const frecs = folders.map(function (f, i) {
    return cat([Buffer.alloc(8), u32le(f[1].length), u32le(0), u32le(blockAt[i] + fileNames), u32le(0)]);
  });
  const blocks = folders.map(function (f, i) {
    return cat([Buffer.from([f[0].length + 1]), Buffer.from(f[0] + '\0', 'latin1')].concat(records[i]));
  });
  const names = [];
  folders.forEach(function (f) { f[1].forEach(function (x) { names.push(Buffer.from(x[0] + '\0', 'latin1')); }); });
  return cat([head].concat(frecs, blocks, names, datas));
}

// ---------------------------------------------------------------------------
// The world.

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-papyrus-'));
const DATA = path.join(ROOT, 'Data');
fs.mkdirSync(path.join(DATA, 'Scripts'), { recursive: true });
function loose(name, bytes) { fs.writeFileSync(path.join(DATA, 'Scripts', name + '.pex'), bytes); }

// The natives, which declare the events as empty functions.
loose('Form', script('Form', '', Object.assign(
  natives(['RegisterForUpdate', 'RegisterForSingleUpdate', 'RegisterForModEvent', 'GetName']),
  { GetFormEx: { flags: NATIVE | GLOBAL } },
  declared(['OnUpdate', 'OnMenuOpen', 'OnUpdateGameTime', 'onBeginState', 'onEndState']))));
loose('ObjectReference', script('ObjectReference', 'Form', Object.assign(natives(['Activate']), declared(['OnActivate', 'OnLoad']))));
loose('Quest', script('Quest', 'Form', Object.assign(natives(['Start']), declared(['OnStoryScript']))));
loose('ReferenceAlias', script('ReferenceAlias', '', Object.assign(natives(['GetReference']), declared(['OnPlayerLoadGame']))));
// Not native, so what it declares is not an event: SKI_ConfigBase's shape.
loose('TS_MenuBase', script('TS_MenuBase', 'Quest', declared(['OnPageReset', 'OnFakeEvent'])));

// Mod scripts.
const TS_DEAD = script('TS_Dead', 'ObjectReference', { OnActivate: handler() });
loose('TS_Timer', script('TS_Timer', 'Quest', {
  OnInit: handler([callSelf('Setup')]),
  Setup: handler([callSelf('RegisterForSingleUpdate', [op.flt(1)])]),
  OnUpdate: handler(),
}));
loose('TS_TimerCalledIn', script('TS_TimerCalledIn', 'Quest', {
  OnInit: handler([callSelf('Begin')]),
  Begin: handler([callSelf('RegisterForUpdate', [op.flt(2)])]),
  OnUpdate: handler(),
}));
loose('TS_Caller', script('TS_Caller', 'ObjectReference', { OnActivate: handler([callOn('::temp0', 'Begin')]) }));
loose('TS_Starter', script('TS_Starter', 'Quest', {
  OnInit: handler([callOn('::temp0', 'RegisterForSingleUpdate', [op.flt(1)])]),
}));
loose('SKI_Fake', script('SKI_Fake', 'Quest', { OnInit: handler() }));
loose('TS_WithSki', script('TS_WithSki', 'Quest', { OnInit: handler(), OnMenuOpen: handler(), Helper: handler() }, { sizeLie: true }));
loose('SKI_Alias', script('SKI_Alias', 'ReferenceAlias', { OnPlayerLoadGame: handler() }));
loose('TS_AliasScript', script('TS_AliasScript', 'ReferenceAlias', { OnPlayerLoadGame: handler() }));
loose('TS_AliasLoad', script('TS_AliasLoad', 'ReferenceAlias', { OnPlayerLoadGame: handler([callParent('OnPlayerLoadGame')]) }));
loose('DefaultDisableHavokOnLoad', script('DefaultDisableHavokOnLoad', 'ObjectReference', { OnLoad: handler() }));
loose('ski_Lower', script('ski_Lower', 'ObjectReference', { OnLoad: handler() }));
loose('TS_ModEvent', script('TS_ModEvent', 'Quest', {
  OnUpdate: handler([callSelf('RegisterForModEvent', [op.str('ts_event'), op.str('HandleX')])]),
  HandleX: handler(),
  OnPageReset: handler(),
}));
loose('TS_StateScript', pex({ name: 'TS_StateScript', parent: 'ObjectReference',
  states: { '': {}, Waiting: { OnActivate: handler() } } }));
loose('TS_Muted', script('TS_Muted', 'TS_Dead', { OnActivate: { code: [] } }));
loose('TS_Shared', script('TS_Shared', 'ObjectReference', { OnLoad: handler() }));
loose('TS_Removed', script('TS_Removed', 'ObjectReference', { OnLoad: handler() }));
loose('TS_Added', script('TS_Added', 'ObjectReference', { OnActivate: handler() }));
['QF_TS_Quest_01', 'TIF_TS_1', 'TIF_TS_2', 'PRKF_TS_1', 'SF_TS_1'].forEach(function (n) {
  loose(n, script(n, '', { Fragment_0: handler() }));
});
// Truncated after the magic and the version. Must be counted, not fatal.
loose('TS_Broken', cat([u32be(0xFA57C0DE), Buffer.from([3, 2]), u16be(1)]));

// TestA.bsa is LZ4 compressed, as SSE makes it, and carries TS_Dead, a stored
// TS_DeadChild by the per file inversion bit, and an old TS_Muted that still
// handles OnActivate, which the loose one must beat.
fs.writeFileSync(path.join(DATA, 'TestA.bsa'), bsa105([
  ['meshes', [['nothing.nif', Buffer.from('not a mesh'), true]]],
  ['scripts', [
    ['ts_dead.pex', TS_DEAD, true],
    ['ts_muted.pex', script('TS_Muted', 'TS_Dead', { OnActivate: handler() }), true],
    ['ts_deadchild.pex', script('TS_DeadChild', 'TS_Dead', { Helper: handler() }), false],
  ]],
], true));
// TestC.bsa is not compressed at all.
fs.writeFileSync(path.join(DATA, 'TestC.bsa'), bsa105([
  ['scripts', [['ts_timer2.pex', script('TS_Timer2', 'Quest', {
    OnInit: handler([callSelf('Setup')]),
    Setup: handler([callSelf('RegisterForSingleUpdate', [op.flt(1)])]),
    OnUpdate: handler(),
  }), false]]],
], false));

function write(name, bytes) { fs.writeFileSync(path.join(DATA, name), bytes); }
write('TestA.esp', plugin([], [
  grup('QUST', [
    rec('QUST', 0x800, [edid('TS_Quest'), vmad(['TS_ModEvent', 'QF_TS_Quest_01'],
      questTail('QF_TS_Quest_01', [[0, ['TS_AliasScript']], [1, ['SKI_Alias', 'TS_AliasLoad']]]))]),
    rec('QUST', 0x80A, [edid('TS_Quest2'), vmad(['TS_TimerCalledIn'])]),
  ]),
  grup('ACTI', [
    rec('ACTI', 0x802, [edid('TS_Acti'), vmad([vscript('TS_Dead', EVERY_PROPERTY)])]),
    rec('ACTI', 0x804, [edid('TS_Acti2'), vmad(['ski_Lower', 'TS_DeadChild'])]),
    rec('ACTI', 0x805, [edid('TS_Acti3'), vmad(['TS_Muted'])]),
    rec('ACTI', 0x806, [edid('TS_Acti4'), vmad(['TS_NotThere', 'TS_Broken'])]),
    rec('ACTI', 0x809, [edid('TS_Squeezed'), vmad(['TS_StateScript'])], { compressed: true }),
    rec('ACTI', 0x80B, [edid('TS_Shared'), vmad(['TS_Shared'])]),
    rec('ACTI', 0x80C, [edid('TS_Removed'), vmad(['TS_Removed'])]),
  ]),
  grup('PERK', [rec('PERK', 0x80D, [edid('TS_Perk'), vmad(['PRKF_TS_1'], perkTail('PRKF_TS_1'))])]),
  grup('SCEN', [rec('SCEN', 0x80E, [edid('TS_Scene'), vmad(['SF_TS_1'], scenTail('SF_TS_1'))])]),
  grup('CELL', [
    rec('CELL', 0x810, [edid('TS_Cell')]),
    grup(0x810, [grup(0x810, [
      rec('REFR', 0x803, [edid('TS_Ref'), vmad(['DefaultDisableHavokOnLoad', 'TS_Dead']), sub('NAME', u32le(0x802))]),
    ], 9)], 6),
  ]),
  grup('DIAL', [rec('INFO', 0x808, [vmad(['TIF_TS_2'], infoTail('TIF_TS_2'))])]),
]));
write('TestB.esp', plugin(['TestA.esp'], [
  grup('ACTI', [
    rec('ACTI', 0x0000080B, [edid('TS_Shared'), vmad(['TS_Shared', 'TS_Added'])]),
    rec('ACTI', 0x0000080C, [edid('TS_Removed')]),
    rec('ACTI', 0x01000800, [edid('TS_CallerActi'), vmad(['TS_Caller'])]),
  ]),
]));
write('TestC.esp', plugin([], [grup('QUST', [rec('QUST', 0x800, [edid('TS_C'), vmad(['TS_Timer2', 'TS_Starter'])])])]));
write('TestWorks.esp', plugin([], [grup('QUST', [rec('QUST', 0x800, [edid('TS_W'), vmad(['SKI_Fake', 'TS_WithSki'])])])]));
write('TestDead.esp', plugin([], [grup('ACTI', [rec('ACTI', 0x800, [edid('TS_D'), vmad(['TS_Dead'])])])]));
write('TestStuck.esp', plugin([], [grup('QUST', [rec('QUST', 0x800, [edid('TS_S'), vmad(['TS_Timer'])])])]));
write('TestFrag.esp', plugin([], [grup('DIAL', [rec('INFO', 0x800, [vmad(['TIF_TS_1'], infoTail('TIF_TS_1'))])])]));
write('TestQuiet.esp', plugin([], [grup('ACTI', [rec('ACTI', 0x800, [edid('TS_Q'), vmad(['TS_Muted'])])])]));
write('TestRecords.esm', plugin([], [grup('ACTI', [rec('ACTI', 0x800, [edid('TS_R')])])], true));

const PLUGINS = path.join(ROOT, 'plugins.txt');
fs.writeFileSync(PLUGINS, ['# made by test-papyrus-events.js', '*TestA.esp', '*TestB.esp', '*TestC.esp',
  '*TestWorks.esp', '*TestDead.esp', '*TestStuck.esp', '*TestFrag.esp', '*TestQuiet.esp',
  'TestInactive.esp', '*TestRecords.esm', ''].join('\r\n'));

// ---------------------------------------------------------------------------
// Run it.

const OUT = path.join(ROOT, 'out.json');
const run = py([AUDIT, '--data', DATA, '--plugins', PLUGINS, '--json', OUT]);
yes('the audit runs on a built Data folder and exits 0', run.status === 0);
if (run.status !== 0) console.log(String(run.stdout) + String(run.stderr));
let R = null;
try { R = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { R = null; }
yes('it writes the JSON --json names', !!R);
if (!R) { fs.rmSync(ROOT, { recursive: true, force: true }); done(); }

const P = {};
R.plugins.forEach(function (p) { P[p.plugin] = p; });
// Every lookup goes through these, so a missing row is a FAIL and not a throw.
function row(pl, s) { return (P[pl] && P[pl].scripts[s]) || null; }
function field(pl, s, f) { const r = row(pl, s); return r ? r[f] : undefined; }
function status(pl) { return P[pl] ? P[pl].status : null; }
function of(pl, f) { return P[pl] ? P[pl][f] : undefined; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

yes('the report prints the groups', /By plugin/.test(run.stdout) && /TIMER NEVER STARTS/.test(run.stdout));
yes('a master flagged plugin sorts before the esps above it in plugins.txt',
  R.loadOrder[0] === 'TestRecords.esm' && R.loadOrder[1] === 'TestA.esp');
yes('a plugin without a star is not in the load order', R.loadOrder.indexOf('TestInactive.esp') < 0);
yes('the five masters, absent here, are named as missing and skipped',
  R.missingPlugins.indexOf('Skyrim.esm') >= 0 && R.loadOrder.indexOf('Skyrim.esm') < 0);

// Events come from the natives, plus OnInit.
const ev = Object.keys(R.eventNames).sort();
yes('the event names are what the native scripts declare, and OnInit: ' + ev.join(', '),
  same(ev, ['OnActivate', 'OnInit', 'OnLoad', 'OnMenuOpen', 'OnPlayerLoadGame', 'OnStoryScript', 'OnUpdate', 'OnUpdateGameTime']));
yes('onBeginState and onEndState are not events', ev.indexOf('onBeginState') < 0 && ev.indexOf('onEndState') < 0);
yes('an empty function in a script with no natives is not an event, SkyUI\'s OnPageReset for one',
  ev.indexOf('OnPageReset') < 0 && ev.indexOf('OnFakeEvent') < 0);
yes('the truncated script is counted as unreadable and nothing else is',
  R.counts.scriptsUnreadable === 1 && Object.keys(R.unreadableScripts)[0] === 'ts_broken');
yes('no archive failed to read', R.unreadableArchives.length === 0);

// bsa.py and the archives.
yes('a script out of the LZ4 compressed archive is read, TS_Dead from TestA.bsa',
  String(field('TestDead.esp', 'TS_Dead', 'source')).toLowerCase() === 'testa.bsa');
yes('a stored file in a compressed archive is read by its inversion bit, TS_DeadChild',
  String(field('TestA.esp', 'TS_DeadChild', 'source')).toLowerCase() === 'testa.bsa');
yes('a script out of an uncompressed archive is read, TS_Timer2 from TestC.bsa',
  String(field('TestC.esp', 'TS_Timer2', 'source')).toLowerCase() === 'testc.bsa');
yes('a loose script beats the archived one of the same name: TS_Muted handles nothing',
  status('TestQuiet.esp') === 'no events' && of('TestQuiet.esp', 'attachedWithoutEvents') === 1);

// The statuses, one plugin each.
yes('SKI_ on the same quest leaves every event alive: works', status('TestWorks.esp') === 'works');
yes('the Caprica size did not stop TS_WithSki being read, and both its events are alive',
  same(field('TestWorks.esp', 'TS_WithSki', 'alive'), ['OnInit', 'OnMenuOpen']));
yes('a script waiting only on OnActivate is dead', status('TestDead.esp') === 'dead'
  && same(field('TestDead.esp', 'TS_Dead', 'blocked'), ['OnActivate']));
yes('a timer only OnInit starts is a timer that never starts', status('TestStuck.esp') === 'timer never starts'
  && field('TestStuck.esp', 'TS_Timer', 'timerNeverStarts') === true
  && same(field('TestStuck.esp', 'TS_Timer', 'timerStartsFrom'), ['OnInit']));
yes('dialogue with only a fragment is fragments only', status('TestFrag.esp') === 'fragments only'
  && of('TestFrag.esp', 'fragments') === 1);
yes('a plugin with no scripts is records only', status('TestRecords.esm') === 'records only');

// TestA, the one with everything on it.
yes('TestA is partial', status('TestA.esp') === 'partial');
yes('TestA has four fragments, quest, dialogue, perk and scene', of('TestA.esp', 'fragments') === 4);
yes('the fragment scripts on their own records are not listed as scripts',
  !row('TestA.esp', 'QF_TS_Quest_01') && !row('TestA.esp', 'TIF_TS_2') && !row('TestA.esp', 'PRKF_TS_1'));
yes('a script no archive or folder has is missing', same(of('TestA.esp', 'missingScripts'), ['TS_NotThere']));
yes('an unreadable script is named as unreadable, not as missing', same(of('TestA.esp', 'unreadableScripts'), ['TS_Broken']));
const dead = row('TestA.esp', 'TS_Dead');
yes('defaultDisableHavokOnLoad, in any case, unblocks TS_Dead on the reference and not on the activator',
  !!dead && dead.attached === 2 && dead.exempt === 1 && same(dead.alive, ['OnActivate']) && same(dead.blocked, ['OnActivate']));
yes('the reference inside a nested cell group was reached', !!dead && same(dead.on, ['ACTI', 'REFR']));
yes('ski_ in lower case is not SkyUI: TS_DeadChild stays blocked',
  field('TestA.esp', 'TS_DeadChild', 'exempt') === 0 && field('TestA.esp', 'ski_Lower', 'exempt') === 0);
yes('TS_DeadChild inherits OnActivate from TS_Dead', same(field('TestA.esp', 'TS_DeadChild', 'events'), ['OnActivate']));
yes('a child declaring the event empty switches the parent\'s off: TS_Muted is not listed',
  !!P['TestA.esp'] && !row('TestA.esp', 'TS_Muted'));
const me = row('TestA.esp', 'TS_ModEvent');
yes('a RegisterForModEvent callback is an event, and blocked; OnPageReset is not',
  !!me && same(me.events, ['HandleX', 'OnUpdate']) && same(me.blocked, ['HandleX']) && same(me.alive, ['OnUpdate']));
yes('an event handled only in a named state still counts, on a compressed record',
  same(field('TestA.esp', 'TS_StateScript', 'events'), ['OnActivate']));
yes('a quest alias script is read and blocked on its own alias',
  same(field('TestA.esp', 'TS_AliasScript', 'blocked'), ['OnPlayerLoadGame'])
  && same(field('TestA.esp', 'TS_AliasScript', 'on'), ['QUST alias']));
yes('a SKI_ script on the same alias frees the one beside it',
  same(field('TestA.esp', 'TS_AliasLoad', 'alive'), ['OnPlayerLoadGame']));
const ci = row('TestA.esp', 'TS_TimerCalledIn');
yes('a timer whose Begin another plugin\'s script calls is not called stuck',
  !!ci && same(ci.timerCalledInBy, ['Begin']) && !ci.timerNeverStarts);
yes('C: a timer is not called stuck when the plugin registers a timer on another object',
  !!row('TestC.esp', 'TS_Timer2') && !field('TestC.esp', 'TS_Timer2', 'timerNeverStarts') && status('TestC.esp') === 'partial');

// Overrides.
yes('a script carried forward by an override stays credited to the plugin that put it there',
  !!row('TestA.esp', 'TS_Shared') && !!P['TestB.esp'] && !row('TestB.esp', 'TS_Shared'));
yes('a script an override adds is credited to the override', !!row('TestB.esp', 'TS_Added'));
yes('an override without a VMAD takes the scripts away',
  !!P['TestA.esp'] && !!P['TestB.esp'] && !row('TestA.esp', 'TS_Removed') && !row('TestB.esp', 'TS_Removed'));
const blockedBy = function (e) { return (R.blockedEvents[e] && R.blockedEvents[e].plugins) || []; };
yes('the blocked event list counts HandleX against TestA', same(blockedBy('HandleX'), ['TestA.esp']));
yes('OnActivate is counted against every plugin that waits on it',
  ['TestA.esp', 'TestB.esp', 'TestDead.esp'].every(function (p) { return blockedBy('OnActivate').indexOf(p) >= 0; }));

// The server half, by the repository's record: nothing a mod or the game
// attaches is in the server's storage, so nothing fires there.
function server(pl) { return P[pl] ? P[pl].server : null; }
yes('by the record, no plugin fires on the server: TestDead is not loaded, a quest only plugin is not on a reference',
    R.plugins.every(function (p) { return p.server.status !== 'fires'; }) &&
    server('TestDead.esp').status === 'not loaded' && same(server('TestDead.esp').notLoaded, ['TS_Dead']) &&
    server('TestStuck.esp').status === 'not on a reference' && server('TestRecords.esm').status === 'records only');
yes('so a plugin dead on the machine fires nowhere, and a partial one is not called that',
    of('TestDead.esp', 'firesNowhere') === true && of('TestStuck.esp', 'firesNowhere') === true &&
    of('TestA.esp', 'firesNowhere') === false && of('TestRecords.esm', 'firesNowhere') === false);
yes('the events reference scripts wait on that the server sends are counted, were they loaded: OnActivate in TestDead',
    !!R.serverSentEventsIfLoaded.OnActivate && R.serverSentEventsIfLoaded.OnActivate.plugins.indexOf('TestDead.esp') >= 0);
yes('the report prints both halves and the plugins nothing fires in',
    /By plugin, on the server/.test(run.stdout) && /nothing fires on either half/.test(run.stdout));

// Another list, written here, proves the audit judges by the record and not
// by anything of its own. The server loads TS_Dead, TS_Muted, TS_AliasScript
// and TS_Timer, drops TS_Shared by name, and the client lets OnActivate through.
const realRecord = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'papyrus-events.json'), 'utf8'));
const other = JSON.parse(JSON.stringify(realRecord));
other.server.loads.dataScripts = ['TS_Dead', 'TS_Muted', 'TS_AliasScript', 'TS_Timer', 'TS_Shared'];
other.server.dropsByName = ['TS_Shared'];
other.client.letsThrough = ['OnUpdate', 'OnActivate'];
const OTHER = path.join(ROOT, 'other-record.json');
fs.writeFileSync(OTHER, JSON.stringify(other));
const OUT2 = path.join(ROOT, 'out2.json');
const run2 = py([AUDIT, '--data', DATA, '--plugins', PLUGINS, '--json', OUT2, '--record', OTHER]);
let R2 = null;
try { R2 = JSON.parse(fs.readFileSync(OUT2, 'utf8')); } catch (e) { R2 = null; }
yes('the audit runs with --record naming another list', run2.status === 0 && !!R2);
const P2 = {};
(R2 ? R2.plugins : []).forEach(function (p) { P2[p.plugin] = p; });
const s2 = function (pl) { return P2[pl] ? P2[pl].server : {}; };
yes('a loaded script on an activator that handles a sent event fires on the server: TS_Dead on OnActivate',
    s2('TestDead.esp').status === 'fires' && same(s2('TestDead.esp').fires, { TS_Dead: ['OnActivate'] }) &&
    P2['TestDead.esp'].firesNowhere === false);
yes('and the client half follows the record too: with OnActivate let through, TestDead works on the machine',
    P2['TestDead.esp'].status === 'works');
yes('a loaded script on a quest never runs there: TS_Timer is not on a reference',
    s2('TestStuck.esp').status === 'not on a reference');
yes('a loaded script that handles nothing the server sends is loaded, never sent: TS_Muted',
    s2('TestQuiet.esp').status === 'loaded, never sent' && same(s2('TestQuiet.esp').loadedNeverSent, ['TS_Muted']));
yes('a script dropped by name is not loaded, though the storage holds it: TS_Shared, credited to TestA',
    (s2('TestA.esp').notLoaded || []).indexOf('TS_Shared') >= 0 && !('TS_Shared' in (s2('TestA.esp').fires || {})));
yes('and one the storage does not hold is not loaded: TS_Added in TestB',
    s2('TestB.esp').status === 'not loaded' && (s2('TestB.esp').notLoaded || []).indexOf('TS_Added') >= 0);
yes('an alias script in the storage still does not fire, and is counted as not on a reference',
    !!s2('TestA.esp').fires && !('TS_AliasScript' in s2('TestA.esp').fires) && s2('TestA.esp').notOnAReference > 0);
const bad = path.join(ROOT, 'bad-record.json');
fs.writeFileSync(bad, '{"client": {}}');
const run3 = py([AUDIT, '--data', DATA, '--plugins', PLUGINS, '--record', bad]);
yes('a record it cannot read stops it with a message', run3.status === 1 && /STOP/.test(run3.stdout));

const stop = py([AUDIT, '--data', path.join(ROOT, 'nowhere'), '--plugins', PLUGINS]);
yes('a Data folder that is not there stops with a message', stop.status === 1 && /STOP/.test(stop.stdout));

// The same plugins with no script beside them, the way the box held only the
// masters before the archives were sent (#3105): every script would read as
// absent and so as harmless, so the audit stops instead of saying so.
const BARE = path.join(ROOT, 'bare');
fs.mkdirSync(BARE);
for (const f of fs.readdirSync(DATA)) {
  if (/\.es[mpl]$/i.test(f)) fs.copyFileSync(path.join(DATA, f), path.join(BARE, f));
}
const bare = py([AUDIT, '--data', BARE, '--plugins', PLUGINS]);
yes('a Data folder with no script at all stops and says so, not that nothing can run',
    bare.status === 1 && /STOP\. no script in /.test(bare.stdout));

// Build-CrimeTable.py reads its scripts the same way, so the crime table is
// not written from a folder without them either (#3105: it read 0 and passed).
// It wants the five masters there, so empty ones go beside the plugins.
for (const m of ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']) {
  fs.writeFileSync(path.join(BARE, m), plugin([], [], true));
}
const crime = py([path.join(REPO, 'scripts', 'dev', 'Build-CrimeTable.py'), '--check', '--data', BARE, '--plugins', PLUGINS]);
yes('the crime table stops on a Data folder with no script, and writes nothing',
    crime.status === 1 && /STOP\. no script in /.test(crime.stdout));
if (crime.status !== 1) console.log(String(crime.stdout) + String(crime.stderr));

// And a folder that carries some scripts and lacks one the load order
// attaches: TestA's TS_NotThere. With nothing recorded as missing on a game
// PC, it stops and names it; recorded, the reading goes on.
const FULL = path.join(ROOT, 'full');
fs.cpSync(DATA, FULL, { recursive: true });
for (const m of ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm']) {
  fs.copyFileSync(path.join(BARE, m), path.join(FULL, m));
}
const none = path.join(ROOT, 'missing-none.json');
fs.writeFileSync(none, JSON.stringify({ missing: {} }));
const lacking = py([path.join(REPO, 'scripts', 'dev', 'Build-CrimeTable.py'), '--check', '--data', FULL,
  '--plugins', PLUGINS, '--known-missing', none]);
yes('the crime table stops on a script the load order attaches and the folder lacks, and names it',
    lacking.status === 1 && /STOP\. 1 script\(s\) the load order attaches/.test(lacking.stdout) && /TestA\.esp TS_NotThere/.test(lacking.stdout));
if (lacking.status !== 1) console.log(String(lacking.stdout) + String(lacking.stderr));
const listed = path.join(ROOT, 'missing-listed.json');
fs.writeFileSync(listed, JSON.stringify({ missing: { 'TestA.esp': ['TS_NotThere'], 'Gone.esp': ['TS_Found'] } }));
const goesOn = py([path.join(REPO, 'scripts', 'dev', 'Build-CrimeTable.py'), '--check', '--data', FULL,
  '--plugins', PLUGINS, '--known-missing', listed]);
yes('one the record lists as missing on a game PC too does not stop it',
    goesOn.status === 0 && !/STOP/.test(goesOn.stdout));
if (goesOn.status !== 0) console.log(String(goesOn.stdout) + String(goesOn.stderr));
yes('and a recorded one that is no longer missing is named for taking out of the record',
    /1 script\(s\) missing-listed\.json lists as missing are here now/.test(goesOn.stdout));

// ---------------------------------------------------------------------------
// bsa.lz4_frame on frames built by hand.

const CODE = [
  'import sys, json',
  'sys.path.insert(0, sys.argv[1])',
  'import bsa',
  'out = []',
  'for f in json.loads(sys.stdin.read()):',
  '    try:',
  '        out.append({"ok": bsa.lz4_frame(bytes.fromhex(f)).hex()})',
  '    except Exception as e:',
  '        out.append({"err": type(e).__name__})',
  'print(json.dumps(out))',
].join('\n');
const text = Buffer.from('Thornswood runs from its own game folder. ');
// 600 bytes with no four byte run repeated, so the whole thing is one literal
// run, long enough to need two 255 bytes in its length.
const noise = Buffer.alloc(600);
let seed = 12345;
for (let i = 0; i < noise.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; noise[i] = seed >>> 24; }
const cases = [
  ['only literals', Buffer.from('short')],
  ['an overlapping copy, ab over and over', Buffer.from('ab'.repeat(200))],
  ['a long literal run, extended past 15 and past 255', noise],
  ['a long copy, extended past 19 and past 255', cat([text, Buffer.alloc(700, 0x41), text])],
  ['text that repeats', Buffer.from(text.toString().repeat(30))],
];
const frames = cases.map(function (c) { return lz4(c[1]).toString('hex'); });
// A stored block, then a compressed block copying 8 bytes back into it, with
// block checksums, a content size and a content checksum for the reader to skip.
const first = Buffer.from('HELLOWORLD12');
const linked = lz4Frame([
  { data: first, stored: true },
  { data: Buffer.from([0x04, 12, 0, 0x10, 0x58]) },
], { blockChecksum: true, contentSize: 21, contentChecksum: true });
frames.push(linked.toString('hex'));
frames.push(Buffer.from('not a frame at all').toString('hex'));
frames.push(lz4Frame([{ data: Buffer.from([0x04, 40, 0, 0x10, 0x58]) }]).toString('hex'));
const lz = py(['-c', CODE, path.dirname(AUDIT)], { input: JSON.stringify(frames) });
let got = [];
try { got = JSON.parse(lz.stdout); } catch (e) { got = []; console.log(String(lz.stderr)); }
cases.forEach(function (c, i) {
  yes('LZ4: ' + c[0] + ' comes back byte for byte', !!got[i] && got[i].ok === c[1].toString('hex'));
});
const n = cases.length;
yes('LZ4: a copy reaching back into a stored block before it, past checksums and a content size',
  !!got[n] && got[n].ok === Buffer.from('HELLOWORLD12HELLOWORX').toString('hex'));
yes('LZ4: something that is not a frame is refused', !!got[n + 1] && got[n + 1].err === 'ValueError');
yes('LZ4: a copy reaching before the start is refused', !!got[n + 2] && got[n + 2].err === 'ValueError');

// ---------------------------------------------------------------------------
// The script pack (#3105). The box holds the plugins and none of the archives
// that carry scripts, so on 26 Oct the crime table stopped there with 14,553
// scripts missing. scripts/mods/New-ScriptPack.py packs a game PC's scripts,
// and the audit reads the pack in place of the archives and Data\Scripts it
// stands for. Here a box's folder of plugins and the pack must audit exactly
// as the folder the pack was made from.

const PACKER = path.join(REPO, 'scripts', 'mods', 'New-ScriptPack.py');
const SRC = path.join(ROOT, 'Src');
const BOX = path.join(ROOT, 'Box');
fs.cpSync(DATA, SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, 'Skyrim - Misc.bsa'), bsa105([
  ['scripts', [['ts_misc.pex', script('TS_Misc', 'ObjectReference', { OnLoad: handler() }), true]]],
], true));
const OUTP = path.join(ROOT, 'pack');
const made = py([PACKER, '--data', SRC, '--out', OUTP]);
let packRec = null;
try { packRec = JSON.parse(fs.readFileSync(path.join(OUTP, 'papyrus-scripts.json'), 'utf8')); } catch (e) { packRec = null; }
const packBytes = fs.existsSync(path.join(OUTP, 'papyrus-scripts.zip')) ? fs.readFileSync(path.join(OUTP, 'papyrus-scripts.zip')) : Buffer.alloc(0);
yes('New-ScriptPack.py packs a Data folder and writes its record (exit ' + made.status + ')', made.status === 0 && !!packRec);
if (made.status !== 0) { console.log(String(made.stdout) + String(made.stderr)); }
const looseCount = fs.readdirSync(path.join(DATA, 'Scripts')).length;
yes('the record holds the pack\'s size and sha256, every archive that carries a script and the loose ones', !!packRec &&
  packRec.bytes === packBytes.length && packRec.sha256 === require('crypto').createHash('sha256').update(packBytes).digest('hex') &&
  same(packRec.archives, { 'Skyrim - Misc.bsa': 1, 'TestA.bsa': 3, 'TestC.bsa': 1 }) && packRec.loose === looseCount && packRec.scripts === 5 + looseCount);
const OUTP2 = path.join(ROOT, 'pack2');
py([PACKER, '--data', SRC, '--out', OUTP2]);
yes('the same folder makes the same bytes', packBytes.length > 0 &&
  fs.existsSync(path.join(OUTP2, 'papyrus-scripts.zip')) && fs.readFileSync(path.join(OUTP2, 'papyrus-scripts.zip')).equals(packBytes));
const notGame = py([PACKER, '--data', DATA, '--out', path.join(ROOT, 'pack3')]);
yes('a folder with no Skyrim - Misc.bsa is refused and nothing is written', notGame.status !== 0 &&
  /STOP/.test(notGame.stdout) && !fs.existsSync(path.join(ROOT, 'pack3', 'papyrus-scripts.zip')));

fs.mkdirSync(BOX);
fs.readdirSync(SRC).filter(function (f) { return /\.(esp|esm|esl)$/i.test(f); })
  .forEach(function (f) { fs.copyFileSync(path.join(SRC, f), path.join(BOX, f)); });
const SRC_OUT = path.join(ROOT, 'src.json');
const BOX_OUT = path.join(ROOT, 'box.json');
py([AUDIT, '--data', SRC, '--plugins', PLUGINS, '--json', SRC_OUT]);
const unpacked = py([AUDIT, '--data', BOX, '--plugins', PLUGINS, '--json', BOX_OUT]);
yes('a box folder with no pack and no archive stops: no script in it', unpacked.status !== 0 && /no script in/.test(String(unpacked.stdout) + String(unpacked.stderr)));
fs.copyFileSync(path.join(OUTP, 'papyrus-scripts.zip'), path.join(BOX, 'papyrus-scripts.zip'));
const boxed = py([AUDIT, '--data', BOX, '--plugins', PLUGINS, '--json', BOX_OUT]);
let S = null, B = null;
try { S = JSON.parse(fs.readFileSync(SRC_OUT, 'utf8')); B = JSON.parse(fs.readFileSync(BOX_OUT, 'utf8')); } catch (e) { S = B = null; }
yes('with the pack, the box folder audits (exit ' + boxed.status + ')', boxed.status === 0 && !!B);
if (boxed.status !== 0) { console.log(String(boxed.stdout) + String(boxed.stderr)); }
yes('and every plugin\'s scripts, their sources and what is missing are the same as in the folder the pack came from',
  !!S && !!B && same(S.plugins, B.plugins) && same(S.eventNames, B.eventNames) && S.counts.scriptsRead === B.counts.scriptsRead);
yes('  the archive a script came from among them: TS_Dead from TestA.bsa, as a loose one from Data\\Scripts', !!B &&
  B.plugins.some(function (p) { return p.plugin === 'TestDead.esp' && String(p.scripts.TS_Dead && p.scripts.TS_Dead.source).toLowerCase() === 'testa.bsa'; }) &&
  B.plugins.some(function (p) { return p.plugin === 'TestStuck.esp' && p.scripts.TS_Timer && p.scripts.TS_Timer.source === 'Data\\Scripts'; }));
fs.writeFileSync(path.join(BOX, 'TestA.bsa'), bsa105([
  ['scripts', [['ts_dead.pex', script('TS_Dead', 'ObjectReference', { OnLoad: handler() }), true]]],
], true));
const both = path.join(ROOT, 'both.json');
py([AUDIT, '--data', BOX, '--plugins', PLUGINS, '--json', both]);
let W = null;
try { W = JSON.parse(fs.readFileSync(both, 'utf8')); } catch (e) { W = null; }
function deadRow(J) {
  const p = J && J.plugins.filter(function (x) { return x.plugin === 'TestDead.esp'; })[0];
  return p ? p.scripts.TS_Dead : null;
}
yes('an archive the folder itself holds is read from there, not from the pack', !!W && !!deadRow(B) && !!deadRow(W) &&
  !same(deadRow(W), deadRow(B)) && !same(deadRow(W).events, deadRow(B).events));

fs.rmSync(ROOT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// This machine's game folder, when there is one.

const GAME = 'C:\\Thornswood\\Game\\Data';
const LIST = 'C:\\Thornswood\\Profile\\Default\\plugins.txt';
if (!fs.existsSync(GAME) || !fs.existsSync(LIST)) {
  console.log('SKIP  no game folder here, so the real load order is not audited');
  done();
}
const REAL = path.join(os.tmpdir(), 'ts-papyrus-real-' + process.pid + '.json');
const real = py([AUDIT, '--json', REAL], { timeout: 600000 });
let G = null;
try { G = JSON.parse(fs.readFileSync(REAL, 'utf8')); } catch (e) { G = null; }
try { fs.unlinkSync(REAL); } catch (e) { /* not there */ }
yes('the audit runs on this machine\'s game folder', real.status === 0 && !!G);
if (real.status !== 0 || !G) {
  console.log('      exit ' + real.status + ', signal ' + real.signal + (real.error ? ', ' + real.error.message : ''));
  console.log('      stdout ends: ' + JSON.stringify(String(real.stdout).slice(-400)));
  console.log('      stderr ends: ' + JSON.stringify(String(real.stderr).slice(-400)));
}
if (G) {
  yes('every archive in the game folder read, the LZ4 compressed ones included: '
    + (G.unreadableArchives.join('; ') || 'none failed'), G.unreadableArchives.length === 0);
  yes('every script in the game folder parsed, ' + G.counts.scriptsRead + ' of them',
    G.counts.scriptsUnreadable === 0 && G.counts.scriptsRead > 10000);
  yes('the game\'s own natives give OnUpdate, OnActivate and OnPlayerLoadGame as events',
    ['OnUpdate', 'OnActivate', 'OnPlayerLoadGame'].every(function (e) { return !!G.eventNames[e]; }));
  const sky = G.plugins.filter(function (p) { return p.plugin === 'SkyUI_SE.esp'; })[0];
  yes('SkyUI works under its own exemption', !sky || sky.status === 'works');
}
done();
