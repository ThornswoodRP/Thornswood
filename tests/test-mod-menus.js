// test-mod-menus.js
//
// Audit-ModMenus.js, driven against a game folder this builds for itself.
//
// Entry 299 on the To Do List says every mod settings menu resets every
// session. Audit-ModMenus.js reads the plugins and says, per menu, whether a
// value is kept in a file on the machine, in a GLOB record, or in the menu's
// script, because a store on the server can only ever help the second.
//
// Everything it reads is binary and none of it can be checked by eye, so
// every shape it reads is built here byte by byte and the answer compared:
// plugins with a compressed record, an override from a later plugin, both
// VMAD object formats and every property type; compiled scripts with debug
// info; a Special Edition archive with an LZ4 script, a stored one and a
// folder that is not scripts; an archive with embedded names; an MCM Helper
// config.json with every kind of value source; and a plugin that is installed
// but not switched on.
//
// Then it checks the audit wrote nothing, since the one promise it makes
// about the game folder is that it only reads it.
//
// Read only apart from its own temp folder, which it removes.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

const SCRIPT = path.join(REPO_DIR, 'scripts', 'mods', 'Audit-ModMenus.js');
let A = null;
try { A = require(SCRIPT); } catch (e) { console.log('      ' + e.message); }
yes('scripts\\mods\\Audit-ModMenus.js is there and loads', !!A);
if (!A) { done(); return; }

// ------------------------------------------------------------ plugin bytes

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function i16(n) { const b = Buffer.alloc(2); b.writeInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function f32(n) { const b = Buffer.alloc(4); b.writeFloatLE(n); return b; }
function zs(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]); }
function sub(type, data) { return Buffer.concat([Buffer.from(type, 'ascii'), u16(data.length), data]); }

function record(type, id, subs, compress) {
  let data = Buffer.concat(subs);
  let flags = 0;
  if (compress) { data = Buffer.concat([u32(data.length), zlib.deflateSync(data)]); flags |= 0x00040000; }
  return Buffer.concat([Buffer.from(type, 'ascii'), u32(data.length), u32(flags), u32(id), u32(0), u16(44), u16(0), data]);
}
function group(label, records) {
  const body = Buffer.concat(records);
  return Buffer.concat([Buffer.from('GRUP', 'ascii'), u32(24 + body.length), Buffer.from(label, 'ascii'), u32(0), u32(0), u32(0), body]);
}
function plugin(masters, groups) {
  const subs = [sub('HEDR', Buffer.concat([f32(1.7), u32(0), u32(0x800)]))];
  masters.forEach(function (m) { subs.push(sub('MAST', zs(m))); subs.push(sub('DATA', Buffer.alloc(8))); });
  return Buffer.concat([record('TES4', 0, subs)].concat(groups));
}
function glob(id, edid) { return record('GLOB', id, [sub('EDID', zs(edid)), sub('FNAM', Buffer.from('f')), sub('FLTV', f32(0))]); }

function wstr(s) { return Buffer.concat([u16(Buffer.byteLength(s, 'latin1')), Buffer.from(s, 'latin1')]); }
// The eight bytes of an object value. Format 1 puts the form id first.
function obj(fmt, id) { return fmt === 1 ? Buffer.concat([u32(id), i16(-1), u16(0)]) : Buffer.concat([u16(0), i16(-1), u32(id)]); }
function vmad(fmt, scripts) {
  const parts = [i16(5), i16(fmt), u16(scripts.length)];
  scripts.forEach(function (s) {
    parts.push(wstr(s.name), Buffer.from([0]), u16(s.props.length));
    s.props.forEach(function (p) {
      parts.push(wstr(p.name), Buffer.from([p.type, 1]));
      switch (p.type) {
        case 1: parts.push(obj(fmt, p.v)); break;
        case 2: parts.push(wstr(p.v)); break;
        case 3: parts.push(u32(p.v)); break;
        case 4: parts.push(f32(p.v)); break;
        case 5: parts.push(Buffer.from([p.v])); break;
        case 11: parts.push(u32(p.v.length)); p.v.forEach(function (x) { parts.push(obj(fmt, x)); }); break;
        case 12: parts.push(u32(p.v.length)); p.v.forEach(function (x) { parts.push(wstr(x)); }); break;
        case 13: parts.push(u32(p.v.length)); p.v.forEach(function (x) { parts.push(u32(x)); }); break;
        case 14: parts.push(u32(p.v.length)); p.v.forEach(function (x) { parts.push(f32(x)); }); break;
        case 15: parts.push(u32(p.v.length), Buffer.from(p.v)); break;
      }
    });
  });
  // A quest's VMAD carries its fragments and aliases after the scripts. The
  // reader stops before them, so some bytes are left here to prove it does.
  parts.push(Buffer.from([2, 0, 0, 0, 0, 0, 0]));
  return Buffer.concat(parts);
}
function quest(id, edid, fmt, scripts, compress) {
  return record('QUST', id, [sub('EDID', zs(edid)), sub('VMAD', vmad(fmt, scripts)), sub('FULL', zs('A quest'))], compress);
}

// ------------------------------------------------------------ script bytes

function bu16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function bu32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function bstr(s) { return Buffer.concat([bu16(s.length), Buffer.from(s, 'latin1')]); }
/* A compiled script whose one object is `name` extending `parent`, with a
   debug block and a user flag in front of it, as the compiler writes them. */
function pex(name, parent, extra) {
  const table = [name, parent, 'OnInit', ''].concat(extra || []);
  return Buffer.concat([
    bu32(0xfa57c0de), Buffer.from([3, 2]), bu16(1), Buffer.alloc(8),
    bstr(name + '.psc'), bstr('someone'), bstr('SOMEPC'),
    bu16(table.length)].concat(table.map(bstr)).concat([
    Buffer.from([1]), Buffer.alloc(8), bu16(1),
    bu16(0), bu16(3), bu16(2), Buffer.from([0]), bu16(2), bu16(10), bu16(11),
    bu16(1), bu16(2), Buffer.from([0]),
    bu16(1), bu16(0), bu32(40), bu16(1), bu16(3), bu32(0), bu16(3),
    Buffer.alloc(24)
  ]));
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

/* A version 105 archive. files: [{ folder, name, data, flip, stored }] where
   flip sets the bit that inverts the archive's compression for that file. */
function bsa(flags, files) {
  const folders = [];
  files.forEach(function (f) {
    let fo = folders.filter(function (x) { return x.name === f.folder; })[0];
    if (!fo) { fo = { name: f.folder, files: [] }; folders.push(fo); }
    fo.files.push(f);
  });
  const all = [];
  folders.forEach(function (fo) { fo.files.forEach(function (f) { all.push(f); }); });
  const folderNamesLen = folders.reduce(function (s, fo) { return s + fo.name.length + 1; }, 0);
  const fileNamesLen = all.reduce(function (s, f) { return s + f.name.length + 1; }, 0);
  const recAt = 36;
  const blockAt = recAt + folders.length * 24;
  const namesAt = blockAt + folders.length + folderNamesLen + all.length * 16;
  let dataAt = namesAt + fileNamesLen;
  // The bytes each file's record points at.
  const bodies = all.map(function (f) {
    const compressed = !!(flags & 0x4) !== !!f.flip;
    let body = compressed ? Buffer.concat([u32(f.data.length), lz4Literals(f.data)]) : f.data;
    if (flags & 0x100) {
      const full = f.folder + '\\' + f.name;
      body = Buffer.concat([Buffer.from([full.length]), Buffer.from(full, 'latin1'), body]);
    }
    const at = dataAt; dataAt += body.length;
    return { body: body, at: at, size: body.length | (f.flip ? 0x40000000 : 0) };
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

// ------------------------------------------------------------ the folder

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-menus-'));
const DATA = path.join(TMP, 'Game', 'Data');
const PLUGINS = path.join(TMP, 'Profile', 'Default', 'plugins.txt');
function put(rel, bytes) {
  const f = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, bytes);
}
fs.mkdirSync(path.dirname(PLUGINS), { recursive: true });
fs.writeFileSync(PLUGINS, [
  '# written by the test',
  '*Classic.esp', '*Helper.esp', '*Plain.esp', '*Packed.esp',
  'Off.esp', '*Patch.esp', '*Embedded.esp', ''
].join('\r\n'));

// Classic.esp: no masters, so every id's top byte 0 is the plugin itself. Its
// quest is compressed and carries every property type there is.
put('Classic.esp', plugin([], [
  group('GLOB', [glob(0x801, 'ClassicSpeed'), glob(0x804, 'ClassicShown')]),
  group('QUST', [quest(0x802, 'ClassicMenuQuest', 2, [
    { name: 'ClassicMenu', props: [
      { name: 'SpeedGlobal', type: 1, v: 0x801 },
      { name: 'Label', type: 2, v: 'hello' },
      { name: 'Count', type: 3, v: 7 },
      { name: 'Ratio', type: 4, v: 0.5 },
      { name: 'On', type: 5, v: 1 },
      { name: 'Things', type: 11, v: [0x801, 0x803] },
      { name: 'Names', type: 12, v: ['a', 'bb'] },
      { name: 'Ints', type: 13, v: [1, 2, 3] },
      { name: 'Floats', type: 14, v: [1.5] },
      { name: 'Bools', type: 15, v: [1, 0] }
    ] },
    { name: 'OtherScript', props: [] }
  ], true)])
]));
// Patch.esp masters Classic.esp, so top byte 0 is Classic and 1 is itself. It
// replaces Classic's menu quest with one wired to both globals.
put('Patch.esp', plugin(['Classic.esp'], [
  group('GLOB', [glob(0x01000800, 'PatchOwnGlobal')]),
  group('QUST', [quest(0x00000802, 'ClassicMenuQuest', 2, [
    { name: 'ClassicMenu', props: [
      { name: 'SpeedGlobal', type: 1, v: 0x00000801 },
      { name: 'ShownGlobal', type: 1, v: 0x00000804 },
      { name: 'Mine', type: 1, v: 0x01000999 }
    ] }
  ])])
]));
// Helper.esp: VMAD object format 1, and an MCM Helper menu.
put('Helper.esp', plugin([], [
  group('GLOB', [glob(0x800, 'HelperToggle')]),
  group('QUST', [quest(0x801, 'HelperMenuQuest', 1, [
    { name: 'HelperMenu', props: [{ name: 'Toggle', type: 1, v: 0x800 }] }
  ])])
]));
put('Plain.esp', plugin([], [group('QUST', [quest(0x800, 'PlainQuest', 2, [{ name: 'PlainQuest', props: [] }])])]));
put('Packed.esp', plugin([], [group('QUST', [quest(0x800, 'PackedMenuQuest', 2, [
  { name: 'PackedMenu', props: [] }, { name: 'PackedRaw', props: [] }
])])]));
put('Embedded.esp', plugin([], [group('QUST', [quest(0x800, 'EmbeddedMenuQuest', 2, [{ name: 'EmbeddedMenu', props: [] }])])]));
put('Off.esp', plugin([], [group('QUST', [quest(0x800, 'OffMenuQuest', 2, [{ name: 'OffMenu', props: [] }])])]));
put('Broken.esp', Buffer.from('this is not a plugin at all'));

put(path.join('Scripts', 'SKI_ConfigBase.pex'), pex('SKI_ConfigBase', 'SKI_QuestBase'));
put(path.join('Scripts', 'MCM_ConfigBase.pex'), pex('MCM_ConfigBase', 'SKI_ConfigBase'));
put(path.join('Scripts', 'ClassicMenu.pex'), pex('ClassicMenu', 'SKI_ConfigBase', ['JsonUtil', 'SetIntValue']));
put(path.join('Scripts', 'HelperMenu.pex'), pex('HelperMenu', 'MCM_ConfigBase'));
put(path.join('Scripts', 'PlainQuest.pex'), pex('PlainQuest', 'Quest'));
put(path.join('Scripts', 'OtherScript.pex'), pex('OtherScript', 'Quest'));
put(path.join('Scripts', 'OffMenu.pex'), pex('OffMenu', 'SKI_ConfigBase'));
put(path.join('Scripts', 'Shadowed.pex'), pex('Shadowed', 'Quest'));

// Compressed by default, so PackedMenu is LZ4 and PackedRaw, whose bit flips
// that, is stored. A textures folder comes first so the names have to line up.
put('Packed.bsa', bsa(0x7, [
  { folder: 'textures', name: 'a.dds', data: Buffer.from('not a script') },
  { folder: 'scripts', name: 'packedmenu.pex', data: pex('PackedMenu', 'SKI_ConfigBase') },
  { folder: 'scripts', name: 'packedraw.pex', data: pex('PackedRaw', 'Quest'), flip: true },
  { folder: 'scripts', name: 'shadowed.pex', data: pex('Shadowed', 'SKI_ConfigBase') }
]));
put('Embedded.bsa', bsa(0x103, [
  { folder: 'scripts', name: 'embeddedmenu.pex', data: pex('EmbeddedMenu', 'MCM_ConfigBase') }
]));

put(path.join('MCM', 'Config', 'Helper', 'config.json'), JSON.stringify({
  modName: 'Helper',
  content: [
    { type: 'header', text: 'Top' },
    { id: 'bTop:General', type: 'toggle', valueOptions: { sourceType: 'ModSettingBool' } }
  ],
  pages: [{ pageDisplayName: 'One', content: [
    { id: 'fSpeed:General', type: 'slider', valueOptions: { sourceType: 'ModSettingFloat', min: 0, max: 1 } },
    { type: 'hiddenToggle', groupControl: 1, valueOptions: { sourceType: 'GlobalValue', sourceForm: 'Helper.esp|800' } },
    { id: 'iMode', type: 'enum', valueOptions: { sourceType: 'GlobalValue', sourceForm: 'Helper.esp|0x800' } },
    { id: 'bProp', type: 'toggle', valueOptions: { sourceType: 'PropertyValueBool', propertyName: 'bProp' } },
    { type: 'text', text: 'Reset', action: { type: 'CallFunction', function: 'Reset' } },
    { type: 'empty' }
  ] }]
}, null, 2));
put(path.join('MCM', 'Config', 'Gone', 'config.json'), '{"modName":"Gone","content":[]}');
put(path.join('MCM', 'Settings', 'Helper.ini'), '; Another server wrote this\r\n[General]\r\nbTop=1\r\n');
put(path.join('MCM', 'Settings', 'Stray.ini'), '[General]\r\nx=1\r\n');

function snapshot() {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d).sort().forEach(function (n) {
      const f = path.join(d, n);
      const st = fs.statSync(f);
      if (st.isDirectory()) { out.push(f + '/'); walk(f); }
      else { out.push(f + ' ' + st.size + ' ' + st.mtimeMs); }
    });
  })(TMP);
  return out.join('\n');
}
const before = snapshot();

try {
  // ---------------------------------------------------------- the readers
  {
    const out = Buffer.alloc(13);
    // 'abc' as literals, then a copy of nine from three back, which overlaps
    // itself, then 'x' as the closing literals.
    const src = Buffer.from([0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x78]);
    const n = A.lz4Block(src, 0, src.length, out, 0);
    yes('an LZ4 block with an overlapping copy comes out as abcabcabcabcx', n === 13 && out.toString() === 'abcabcabcabcx');
    let threw = false;
    try { A.lz4Block(Buffer.from([0x15, 0x61, 0x05, 0x00]), 0, 4, Buffer.alloc(20), 0); } catch (e) { threw = true; }
    yes('and a copy from before the start of the output is refused, not read as garbage', threw);
    const long = Buffer.alloc(300, 0x41);
    yes('a frame of 300 literals, which needs the length bytes, comes out whole',
        A.lz4Frame(lz4Literals(long), 300).equals(long));
  }

  const classic = A.readPlugin(path.join(DATA, 'Classic.esp'), 'Classic.esp');
  const cq = classic.quests[0];
  yes('a compressed QUST record is read: its editor id is ClassicMenuQuest', cq && cq.edid === 'ClassicMenuQuest');
  yes('both of its scripts come out of the VMAD', cq && cq.scripts.map(function (s) { return s.name; }).join() === 'ClassicMenu,OtherScript');
  const props = cq ? cq.scripts[0].props : [];
  yes('all ten properties are read, one of every type, ending on Bools',
      props.length === 10 && props[9].name === 'Bools');
  yes('an object property carries its form id', props[0] && props[0].forms.join() === String(0x801));
  yes('an object array carries all of them', props[5] && props[5].forms.join() === [0x801, 0x803].join());
  yes('and every form id is keyed to the file that made it', props[0] && props[0].keys[0] === '801:classic.esp');
  yes('its two globals are listed', classic.globs.map(function (g) { return g.edid; }).join() === 'ClassicSpeed,ClassicShown');

  const patch = A.readPlugin(path.join(DATA, 'Patch.esp'), 'Patch.esp');
  yes('an override of a master\'s quest keys to the master', patch.quests[0] && patch.quests[0].key === '802:classic.esp');
  yes('a plugin\'s own record keys to itself, one past its last master', patch.globs[0] && patch.globs[0].key === '800:patch.esp');

  const helper = A.readPlugin(path.join(DATA, 'Helper.esp'), 'Helper.esp');
  yes('VMAD object format 1, form id first, is read too',
      helper.quests[0] && helper.quests[0].scripts[0].props[0].keys[0] === '800:helper.esp');

  const p = A.readPex(pex('ClassicMenu', 'SKI_ConfigBase', ['JsonUtil']));
  yes('a compiled script\'s parent is read past its debug info and user flags', p.name === 'ClassicMenu' && p.parent === 'SKI_ConfigBase');

  const packed = A.archiveScripts(path.join(DATA, 'Packed.bsa'));
  yes('an archive lists its scripts and nothing from other folders',
      Object.keys(packed).sort().join() === 'packedmenu,packedraw,shadowed');
  yes('with the archive\'s compression, flipped for the one file that says so',
      packed.packedmenu && packed.packedmenu.compressed && packed.packedraw && !packed.packedraw.compressed);

  const order = require(path.join(REPO_DIR, 'scripts', 'dev', 'OwnPlugins.js')).loadOrder(PLUGINS);
  const find = A.scriptFinder(DATA, order);
  const pm = find('PackedMenu') || {};
  yes('an LZ4 script out of an archive reads, and extends SKI_ConfigBase', pm.parent === 'SKI_ConfigBase' && pm.from === 'Packed.bsa');
  yes('a stored script out of the same archive reads', (find('PackedRaw') || {}).parent === 'Quest');
  const em = find('EmbeddedMenu') || {};
  yes('an archive that embeds names in front of each file reads', em.parent === 'MCM_ConfigBase' && em.from === 'Embedded.bsa');
  const sh = find('Shadowed') || {};
  yes('a loose script beats the archive copy of the same name', sh.parent === 'Quest' && sh.from === 'Data\\Scripts');
  yes('a script that is nowhere is nothing, not an error', find('NoSuchScript') === null);
  yes('the chain runs to SKI_ConfigBase through MCM_ConfigBase',
      A.chainOf('HelperMenu', find).join(' > ') === 'HelperMenu > MCM_ConfigBase > SKI_ConfigBase');

  yes('"Plugin.esp|800" and "Plugin.esp|0x800" are the same record',
      A.sourceFormKey('Helper.esp|800') === '800:helper.esp' && A.sourceFormKey('Helper.esp|0x800') === '800:helper.esp');

  // ---------------------------------------------------------- the audit
  const r = A.audit({ data: DATA, plugins: PLUGINS });
  const by = {};
  r.menus.forEach(function (m) { by[m.script] = m; });
  yes('four menus: the classic one, the MCM Helper one, the packed one and the embedded one',
      Object.keys(by).sort().join() === 'ClassicMenu,EmbeddedMenu,HelperMenu,PackedMenu');
  yes('a plugin installed but not switched on has no menu', !by.OffMenu);
  yes('a quest script that is not a menu is not one', !by.PlainQuest && !by.OtherScript);
  yes('the five base masters are named as not installed, not as failures',
      r.missing.indexOf('Skyrim.esm') !== -1 && r.problems.length === 0);

  const c = by.ClassicMenu || {};
  yes('the classic menu is classic', c.kind === 'classic');
  yes('it belongs to Classic.esp and is read as Patch.esp leaves it', c.plugin === 'Classic.esp' && c.from === 'Patch.esp');
  yes('the globals are the override\'s two, by editor id, and a form that is no global is not one',
      (c.globals || []).slice().sort().join() === 'ClassicShown,ClassicSpeed');
  yes('a script that calls JsonUtil is said to', (c.ownFile || []).join() === 'JsonUtil');
  yes('the packed menu is classic, and came out of its archive',
      by.PackedMenu && by.PackedMenu.kind === 'classic' && by.PackedMenu.scriptFrom === 'Packed.bsa');

  const h = by.HelperMenu || {};
  yes('the MCM Helper menu is MCM Helper', h.kind === 'helper');
  const cs = (h.config && h.config.controls) || [];
  const tallyOf = function (where, hidden) { return cs.filter(function (x) { return x.where === where && !!x.hidden === hidden; }).length; };
  yes('five controls, and a header, a text button, an empty and a CallFunction are not settings', cs.length === 5);
  yes('two are kept in its ini', tallyOf('file', false) === 2);
  yes('one is a GLOB a person sets, and it is HelperToggle',
      tallyOf('global', false) === 1 && cs.filter(function (x) { return x.id === 'iMode'; })[0].global === 'HelperToggle');
  yes('one is a script property', tallyOf('script', false) === 1);
  yes('the hidden switch is counted apart', tallyOf('global', true) === 1);
  yes('its settings file is found, with its first line',
      h.settingsFile && h.settingsFile.first === '; Another server wrote this');
  yes('an MCM Helper menu with no config.json says so rather than inventing one',
      by.EmbeddedMenu && by.EmbeddedMenu.kind === 'helper' && by.EmbeddedMenu.config === null);

  yes('a config folder no menu claims is named', r.orphanConfigs.join() === 'Gone');
  const sf = {};
  r.settingsFiles.forEach(function (f) { sf[f.name] = f; });
  yes('Helper.ini is read by Helper.esp', sf['Helper.ini'] && sf['Helper.ini'].menu === 'Helper.esp');
  yes('Stray.ini is read by nothing', sf['Stray.ini'] && sf['Stray.ini'].menu === '');

  const text = A.report(r, false).join('\n');
  yes('the report counts two MCM Helper menus and two classic', /MCM Helper menus: 2/.test(text) && /Classic SkyUI menus: 2/.test(text));
  yes('it quotes a settings file\'s first line', text.indexOf('first line: ; Another server wrote this') !== -1);
  yes('it sums up', text.indexOf('4 menus: 2 MCM Helper, 2 classic.') !== -1);
  yes('and says what it cannot answer', /Not answered here/.test(text));
  yes('it never says player', !/player/i.test(text) && !/player/i.test(A.report(r, true).join('\n')));

  // ---------------------------------------------------------- run as a program
  const run = spawnSync(process.execPath, [SCRIPT, '--data', DATA, '--plugins', PLUGINS], { encoding: 'utf8' });
  yes('run as a program it exits 0 and prints the same answer',
      run.status === 0 && (run.stdout || '').indexOf('4 menus: 2 MCM Helper, 2 classic.') !== -1);

  const broken = path.join(TMP, 'Profile', 'broken.txt');
  fs.writeFileSync(broken, '*Classic.esp\r\n*Broken.esp\r\n');
  const rb = A.audit({ data: DATA, plugins: broken });
  yes('a plugin that will not read is named as one', rb.problems.some(function (x) { return /^Broken\.esp would not read/.test(x); }));
  const runb = spawnSync(process.execPath, [SCRIPT, '--data', DATA, '--plugins', broken], { encoding: 'utf8' });
  yes('and then the program exits 1, because its answer has a hole in it', runb.status === 1);
  fs.unlinkSync(broken);

  const nothing = spawnSync(process.execPath, [SCRIPT, '--data', path.join(TMP, 'nowhere')], { encoding: 'utf8' });
  yes('with no Data folder it says so and exits 1', nothing.status === 1 && /no Data folder/.test(nothing.stderr || ''));

  // ---------------------------------------------------------- read only
  yes('nothing in the folder was written, added or removed by any of that', snapshot() === before);
} catch (e) {
  yes('the harness ran to the end without throwing: ' + (e && e.stack || e), false);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
}

done();
