// Audit-ModMenus.js
//
//     node scripts\mods\Audit-ModMenus.js
//     node scripts\mods\Audit-ModMenus.js -v        every setting of every menu, one line each
//     node scripts\mods\Audit-ModMenus.js --data <a Data folder> --plugins <its plugins.txt>
//
// With no --plugins it reads Profile\Default\plugins.txt of the install --data
// is in (two folders up from Data).
//
// Entry 299 on the To Do List: "Mod settings menus reset every session,
// because a character lives on the server and there is no save for a mod to
// write into". Known Issues, help.md, tests.md and the board all say it, and the
// fix the entry proposes is a small store on the server, keyed by character,
// that the front plugin reads back at login.
//
// WHY THIS COMES BEFORE ANY STORE. The sentence is only half true, and a store
// is only worth building for the half it is true of. There are two kinds of
// menu, and a value inside either can live in one of three places:
//
//   A FILE. An MCM Helper menu keeps a changed value in
//   Data\MCM\Settings\<mod>.ini, a file on the machine. No save is involved,
//   so those values come back every session without anybody's help.
//
//   A GLOB RECORD. A global variable lives in the save, so under SkyMP it
//   starts from the plugin's own value every session. But Skyrim Platform can
//   set one from outside the menu, so a store on the server could put it back.
//
//   THE SCRIPT. A classic SkyUI menu keeps its values in its own script, and
//   so does an MCM Helper value marked PropertyValue. A script's state lives
//   in the save as well, and Skyrim Platform has no call that writes another
//   script's variables, so a store could send the value and nothing in the
//   game would change.
//
// Nobody can say which settings are which without reading the plugins. This
// reads them, and says per menu where each value is kept.
//
// HOW IT KNOWS A QUEST IS A MENU. A menu is a quest whose script extends
// SKI_ConfigBase; MCM Helper's MCM_ConfigBase extends SKI_ConfigBase in turn,
// so the chain of parents says which kind it is. The quest's scripts and their
// filled properties are in its VMAD subrecord. Each script's parent is in its
// compiled .pex, loose in Data\Scripts or inside an archive.
//
// WHAT IT SAID ON 24 SEPTEMBER, on Patrick's machine, 99 plugins in the order:
// 13 menus. Five are MCM Helper (TrueHUD, SkyUI_SE, BetterThirdPersonSelection,
// Precision, TrueDirectionalMovement), with 421 settings kept in their ini
// files and 3 in a script, SkyUI_SE's. Eight are classic (Apocalypse,
// chfshVariousActions, AHZmoreHUD, McmRecorder, PlayFluteLuteDrum,
// QuickLootIE, Skyrim Unbound, atlas map markers): five have GLOB records
// wired to them, 176 between them, and three call JsonUtil. So by what the
// files say, the sentence on the site is wrong for the MCM Helper menus and
// right for the classic ones. A person in the game has to confirm the first
// half: change a TrueHUD option, quit, come back.
//
// It also found two of the three files in Data\MCM\Settings, Precision.ini and
// TrueDirectionalMovement.ini, opening with a "Daedric Online" comment: another
// server's values, which MCM Helper reads over the mod's own defaults. That is
// why the settings files section prints each file's first line.
//
// Read only. It opens files in the game folder and writes nothing, there or
// anywhere else.
//
// WHAT IT CANNOT ANSWER. Whether a menu opens at all under SkyMP, where every
// Papyrus event except OnUpdate is blocked; whether a mod acts on a GLOB that
// was set from outside its menu; and what a classic menu does with a file of
// its own, which only its source says. Those need the game or the source.
const fs = require('fs');
const path = require('path');
const { pluginPath, loadOrder } = require('../dev/OwnPlugins.js');
const zlib = require('zlib');

const COMPRESSED_RECORD = 0x00040000;

/*
  A form id inside a plugin names its file by position: the top byte is an
  index into that plugin's own masters, and one past the last master is the
  plugin itself. So the same number means a different record in each file,
  and every id is turned into (local id, file that made it) before anything
  compares two of them.
*/
function formKey(id, masters, self) {
  const at = id >>> 24;
  const owner = at < masters.length ? masters[at] : self;
  return (id & 0x00ffffff).toString(16) + ':' + owner.toLowerCase();
}

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (n <= 0) { break; }
    got += n;
  }
  return got === len ? b : b.slice(0, got);
}

function eachSubrecord(rec, fn) {
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if (k + sz > rec.length) { return; }
    fn(sub, rec.slice(k, k + sz));
    k += sz;
  }
}

function zstring(b) {
  const end = b.indexOf(0);
  return b.toString('latin1', 0, end < 0 ? b.length : end);
}

/*
  One plugin: its masters, its quests that carry scripts, and its globals.

  Only the QUST and GLOB top groups are read. The rest of a plugin is skipped
  by its size without being loaded, because Skyrim.esm is a quarter of a
  gigabyte and none of it but those two groups says anything about a menu.
*/
function readPlugin(file, name) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 24);
    if (head.length < 24 || head.toString('ascii', 0, 4) !== 'TES4') {
      throw new Error(name + ' is not a plugin');
    }
    const headSize = head.readUInt32LE(4);
    const masters = [];
    eachSubrecord(readAt(fd, 24, headSize), function (sub, data) {
      if (sub === 'MAST') { masters.push(zstring(data)); }
    });
    const out = { name: name, masters: masters, quests: [], globs: [] };
    let pos = 24 + headSize;
    while (pos + 24 <= size) {
      const g = readAt(fd, pos, 24);
      if (g.toString('ascii', 0, 4) !== 'GRUP') { throw new Error(name + ' has something other than a group at the top level, at byte ' + pos); }
      const groupSize = g.readUInt32LE(4);
      if (groupSize < 24) { throw new Error(name + ' has a group too short to be one, at byte ' + pos); }
      const label = g.toString('ascii', 8, 12);
      if (label === 'QUST' || label === 'GLOB') {
        walkGroup(readAt(fd, pos, groupSize), 24, groupSize, out);
      }
      pos += groupSize;
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

function walkGroup(b, start, end, out) {
  let j = start;
  while (j + 24 <= end) {
    const type = b.toString('ascii', j, j + 4);
    const dataSize = b.readUInt32LE(j + 4);
    if (type === 'GRUP') {
      if (dataSize < 24) { return; }
      walkGroup(b, j + 24, j + dataSize, out);
      j += dataSize;
      continue;
    }
    const flags = b.readUInt32LE(j + 8);
    const id = b.readUInt32LE(j + 12);
    if (type === 'QUST' || type === 'GLOB') {
      let rec = b.slice(j + 24, j + 24 + dataSize);
      if (flags & COMPRESSED_RECORD) { rec = zlib.inflateSync(rec.slice(4)); }
      let edid = '', vmad = null;
      eachSubrecord(rec, function (sub, data) {
        if (sub === 'EDID') { edid = zstring(data); }
        if (sub === 'VMAD') { vmad = data; }
      });
      const key = formKey(id, out.masters, out.name);
      if (type === 'GLOB') {
        out.globs.push({ key: key, edid: edid });
      } else if (vmad) {
        const scripts = readVmad(vmad);
        scripts.forEach(function (s) {
          s.props.forEach(function (p) {
            p.keys = p.forms.map(function (f) { return formKey(f, out.masters, out.name); });
          });
        });
        out.quests.push({ key: key, edid: edid, scripts: scripts });
      }
    }
    j += 24 + dataSize;
  }
}

/*
  The scripts section of a VMAD subrecord: each script's name and each filled
  property, with the form ids an object property points at. A quest's VMAD
  goes on after this with its fragments and its aliases, none of which name
  the quest's own scripts, so reading stops here.
*/
function readVmad(v) {
  let p = 0;
  const version = v.readInt16LE(p); p += 2;
  const objFormat = v.readInt16LE(p); p += 2;
  const count = v.readUInt16LE(p); p += 2;
  function wstr() {
    const n = v.readUInt16LE(p); p += 2;
    const s = v.toString('latin1', p, p + n); p += n;
    return s;
  }
  // An object value is eight bytes, a form id and an alias. Format 1 puts the
  // form id first and format 2 puts it last.
  function obj() {
    const id = objFormat === 1 ? v.readUInt32LE(p) : v.readUInt32LE(p + 4);
    p += 8;
    return id;
  }
  const scripts = [];
  for (let i = 0; i < count; i++) {
    const name = wstr();
    if (version >= 4) { p += 1; }
    const propCount = v.readUInt16LE(p); p += 2;
    const props = [];
    for (let k = 0; k < propCount; k++) {
      const propName = wstr();
      const type = v.readUInt8(p); p += 1;
      if (version >= 4) { p += 1; }
      const forms = [];
      let n = 0;
      switch (type) {
        case 1: forms.push(obj()); break;
        case 2: wstr(); break;
        case 3: case 4: p += 4; break;
        case 5: p += 1; break;
        case 11: n = v.readUInt32LE(p); p += 4; for (let q = 0; q < n; q++) { forms.push(obj()); } break;
        case 12: n = v.readUInt32LE(p); p += 4; for (let q = 0; q < n; q++) { wstr(); } break;
        case 13: case 14: n = v.readUInt32LE(p); p += 4 + n * 4; break;
        case 15: n = v.readUInt32LE(p); p += 4 + n; break;
        default: throw new Error('script ' + name + ' has a property of type ' + type + ', which this reader does not know');
      }
      props.push({ name: propName, type: type, forms: forms });
    }
    scripts.push({ name: name, props: props });
  }
  return scripts;
}

// ------------------------------------------------------------------ scripts

/*
  A compiled Papyrus script: big endian, a header of three strings, a string
  table, optional debug info, user flags, then the objects. The first object's
  parent is what this wants, and the string table comes back with it because
  the names a script calls are in there too.
*/
function readPex(b) {
  if (b.length < 20 || b.readUInt32BE(0) !== 0xfa57c0de) { throw new Error('not a compiled Papyrus script'); }
  let p = 16;
  function wstr() {
    const n = b.readUInt16BE(p); p += 2;
    const s = b.toString('latin1', p, p + n); p += n;
    return s;
  }
  wstr(); wstr(); wstr();
  const count = b.readUInt16BE(p); p += 2;
  const table = [];
  for (let i = 0; i < count; i++) { table.push(wstr()); }
  if (b.readUInt8(p++)) {
    p += 8;
    const fns = b.readUInt16BE(p); p += 2;
    for (let i = 0; i < fns; i++) {
      p += 7;
      const lines = b.readUInt16BE(p); p += 2 + lines * 2;
    }
  }
  const flags = b.readUInt16BE(p); p += 2 + flags * 3;
  if (b.readUInt16BE(p) < 1) { throw new Error('a compiled script with no object in it'); }
  p += 2;
  const nameAt = b.readUInt16BE(p); p += 2;
  p += 4;
  const parentAt = b.readUInt16BE(p);
  return { name: table[nameAt] || '', parent: table[parentAt] || '', strings: table };
}

/*
  LZ4, which is what a Special Edition archive compresses with. Node has no
  LZ4 of its own and a compiled script is a few kilobytes, so this is the
  plain decoder from the format's description: a frame of blocks, each block
  a run of literals then a copy from earlier output.
*/
function lz4Block(src, i, end, out, o) {
  while (i < end) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) { let x; do { x = src[i++]; lit += x; } while (x === 255); }
    src.copy(out, o, i, i + lit); o += lit; i += lit;
    if (i >= end) { break; }
    const off = src[i] | (src[i + 1] << 8); i += 2;
    if (off === 0 || off > o) { throw new Error('an LZ4 copy reaches before the start of its output'); }
    let len = token & 15;
    if (len === 15) { let x; do { x = src[i++]; len += x; } while (x === 255); }
    len += 4;
    for (let k = 0; k < len; k++) { out[o] = out[o - off]; o++; }
  }
  return o;
}

function lz4Frame(src, size) {
  if (src.length < 7 || src.readUInt32LE(0) !== 0x184d2204) { throw new Error('not an LZ4 frame'); }
  const flg = src[4];
  let p = 6;
  if (flg & 0x08) { p += 8; }
  if (flg & 0x01) { p += 4; }
  p += 1;
  const out = Buffer.alloc(size);
  let o = 0;
  while (p + 4 <= src.length) {
    const word = src.readUInt32LE(p); p += 4;
    if (word === 0) { break; }
    const n = word & 0x7fffffff;
    if (word & 0x80000000) { src.copy(out, o, p, p + n); o += n; }
    else { o = lz4Block(src, p, p + n, out, o); }
    p += n;
    if (flg & 0x10) { p += 4; }
  }
  if (o !== size) { throw new Error('an LZ4 frame came out ' + o + ' bytes long, not ' + size); }
  return out;
}

/*
  The compiled scripts inside one archive, by lower case name, with where
  each one's bytes are. Only the header, the folder records and the name
  block are read; a file's own bytes are read when somebody asks for it.
*/
function archiveScripts(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = readAt(fd, 0, 36);
    if (h.length < 36 || h.toString('ascii', 0, 4) !== 'BSA\u0000') { throw new Error('not an archive'); }
    const version = h.readUInt32LE(4);
    const offset = h.readUInt32LE(8);
    const flags = h.readUInt32LE(12);
    const folderCount = h.readUInt32LE(16);
    const fileCount = h.readUInt32LE(20);
    const folderNamesLen = h.readUInt32LE(24);
    const fileNamesLen = h.readUInt32LE(28);
    const rec = version >= 105 ? 24 : 16;
    const recs = readAt(fd, offset, folderCount * rec);
    const blockAt = offset + folderCount * rec;
    const block = readAt(fd, blockAt, folderCount + folderNamesLen + fileCount * 16);
    const names = readAt(fd, blockAt + block.length, fileNamesLen);
    const found = {};
    let nameAt = 0;
    for (let f = 0; f < folderCount; f++) {
      const count = recs.readUInt32LE(f * rec + 8);
      const off = recs.readUInt32LE(f * rec + (version >= 105 ? 16 : 12));
      let q = off - fileNamesLen - blockAt;
      const nameLen = block[q];
      const folder = block.toString('latin1', q + 1, q + nameLen).replace(/\u0000+$/, '').toLowerCase();
      q += 1 + nameLen;
      for (let i = 0; i < count; i++) {
        const sz = block.readUInt32LE(q + 8);
        const at = block.readUInt32LE(q + 12);
        q += 16;
        const end = names.indexOf(0, nameAt);
        const leaf = names.toString('latin1', nameAt, end < 0 ? names.length : end).toLowerCase();
        nameAt = end < 0 ? names.length : end + 1;
        if (folder !== 'scripts' || !/\.pex$/.test(leaf)) { continue; }
        let compressed = !!(flags & 0x4);
        if (sz & 0x40000000) { compressed = !compressed; }
        found[leaf.slice(0, -4)] = {
          archive: file, version: version, embedded: !!(flags & 0x100),
          compressed: compressed, at: at, size: sz & 0x3fffffff
        };
      }
    }
    return found;
  } finally {
    fs.closeSync(fd);
  }
}

function archiveFile(entry) {
  const fd = fs.openSync(entry.archive, 'r');
  try {
    let b = readAt(fd, entry.at, entry.size);
    if (entry.embedded) { b = b.slice(1 + b[0]); }
    if (!entry.compressed) { return b; }
    const size = b.readUInt32LE(0);
    return entry.version >= 105 ? lz4Frame(b.slice(4), size) : zlib.inflateSync(b.slice(4));
  } finally {
    fs.closeSync(fd);
  }
}

/*
  Where the game would get a script from. A loose file in Data\Scripts beats
  any archive. Between archives, the one loaded by the later plugin wins, and
  an archive no plugin loads (the game's own, named in its ini) comes first.
  The archives are only opened the first time a script is not loose.
*/
function scriptFinder(data, order) {
  const loose = path.join(data, 'Scripts');
  let archived = null;
  const cache = {};
  function indexArchives() {
    archived = {};
    let files = [];
    try { files = fs.readdirSync(data).filter(function (f) { return /\.bsa$/i.test(f); }); } catch (e) { files = []; }
    const stems = order.map(function (n) { return n.replace(/\.(esp|esm|esl)$/i, '').toLowerCase(); });
    function rank(f) {
      const stem = f.replace(/\.bsa$/i, '').toLowerCase();
      for (let i = stems.length - 1; i >= 0; i--) {
        if (stem === stems[i] || stem.indexOf(stems[i] + ' - ') === 0) { return i; }
      }
      return -1;
    }
    files.sort(function (a, b) { return rank(a) - rank(b) || (a.toLowerCase() < b.toLowerCase() ? -1 : 1); });
    files.forEach(function (f) {
      let got = {};
      try { got = archiveScripts(path.join(data, f)); } catch (e) { return; }
      Object.keys(got).forEach(function (k) { archived[k] = got[k]; });
    });
  }
  return function find(name) {
    const k = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(cache, k)) { return cache[k]; }
    let got = null;
    const file = path.join(loose, name + '.pex');
    try {
      if (fs.existsSync(file)) { got = readPex(fs.readFileSync(file)); got.from = 'Data\\Scripts'; }
    } catch (e) { got = { error: name + '.pex in Data\\Scripts would not read: ' + e.message }; }
    if (!got) {
      if (!archived) { indexArchives(); }
      const entry = archived[k];
      if (entry) {
        try { got = readPex(archiveFile(entry)); got.from = path.basename(entry.archive); }
        catch (e) { got = { error: name + '.pex in ' + path.basename(entry.archive) + ' would not read: ' + e.message }; }
      }
    }
    cache[k] = got;
    return got;
  };
}

const MENU_BASE = 'ski_configbase';
const HELPER_BASE = 'mcm_configbase';
// Where the chain can stop without reading on: the game's own quest script,
// and the two bases themselves.
const STOP_AT = ['quest', 'form', MENU_BASE];

/* The script, its parent, its parent's parent, as far as they can be read. */
function chainOf(name, find) {
  const chain = [name];
  let at = name;
  for (let i = 0; i < 12; i++) {
    if (STOP_AT.indexOf(at.toLowerCase()) !== -1) { break; }
    const pex = find(at);
    if (!pex || pex.error || !pex.parent) { break; }
    at = pex.parent;
    if (chain.map(function (c) { return c.toLowerCase(); }).indexOf(at.toLowerCase()) !== -1) { break; }
    chain.push(at);
  }
  return chain;
}

// Names in a script's string table that say it may write a file of its own:
// PapyrusUtil's JsonUtil, and JContainers' writeToFile. Everything else those
// two offer is held in the save, so it resets like the script does.
const OWN_FILE = /^(jsonutil|writetofile)$/i;

// --------------------------------------------------------------- MCM Helper

/*
  An MCM Helper menu is described by Data\MCM\Config\<plugin>\config.json.
  Each control there names where its value is kept, in valueOptions.sourceType:

    ModSetting...    the mod's ini, Data\MCM\Settings\<mod>.ini once changed
    GlobalValue      a GLOB record, named in sourceForm as "Plugin.esp|id"
    PropertyValue... a property of the menu's own script

  Controls are the entries of a "content" array, on the menu or on a page.
  Anything else with a "type" (an action's CallFunction, say) is not one.
  A hiddenToggle is a switch the menu flips for itself to show or hide a
  group; nobody sets one, so it is counted apart from the settings.
*/
const NOT_A_SETTING = ['header', 'empty', 'text'];

function readMcmConfig(text) {
  const cfg = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const controls = [];
  function take(list) {
    if (!Array.isArray(list)) { return; }
    list.forEach(function (c) {
      if (!c || typeof c !== 'object') { return; }
      const vo = c.valueOptions || {};
      const source = typeof vo.sourceType === 'string' ? vo.sourceType : '';
      if (!source && NOT_A_SETTING.indexOf(String(c.type)) !== -1) { return; }
      let where = 'none';
      if (/^ModSetting/i.test(source)) { where = 'file'; }
      else if (/^GlobalValue$/i.test(source)) { where = 'global'; }
      else if (/^PropertyValue/i.test(source)) { where = 'script'; }
      controls.push({
        id: String(c.id || vo.propertyName || vo.sourceForm || c.text || c.type || ''),
        type: String(c.type || ''),
        hidden: c.type === 'hiddenToggle',
        source: source,
        where: where,
        form: typeof vo.sourceForm === 'string' ? vo.sourceForm : ''
      });
    });
  }
  take(cfg.content);
  (Array.isArray(cfg.pages) ? cfg.pages : []).forEach(function (pg) { if (pg) { take(pg.content); } });
  return { modName: String(cfg.modName || ''), controls: controls };
}

/* "Plugin.esp|813" as the same key formKey makes, or '' if it is not one. */
function sourceFormKey(s) {
  const bar = s.lastIndexOf('|');
  if (bar < 1) { return ''; }
  const id = parseInt(s.slice(bar + 1).trim(), 16);
  if (!isFinite(id)) { return ''; }
  return (id & 0x00ffffff).toString(16) + ':' + s.slice(0, bar).trim().toLowerCase();
}

// ------------------------------------------------------------------ the audit

function firstLine(file) {
  try {
    const t = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
    const line = t.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
    return line.trim().slice(0, 100);
  } catch (e) { return ''; }
}

function stamp(file) {
  try { return fs.statSync(file).mtime.toISOString().slice(0, 10); } catch (e) { return ''; }
}

function audit(opts) {
  const data = opts.data;
  const pluginsTxt = opts.plugins;
  const order = loadOrder(pluginsTxt);
  const problems = [];
  function problem(s) { if (problems.indexOf(s) === -1) { problems.push(s); } }
  const missing = [];
  const quests = {};
  const globs = {};

  order.forEach(function (name) {
    const file = pluginPath(data, name);
    if (!fs.existsSync(file)) { missing.push(name); return; }
    let p;
    try { p = readPlugin(file, name); } catch (e) { problem(name + ' would not read: ' + e.message); return; }
    p.globs.forEach(function (g) { if (!globs[g.key]) { globs[g.key] = g.edid; } });
    // A later plugin's copy of a quest replaces the earlier one whole, VMAD
    // and all, which is what the game does with an override.
    p.quests.forEach(function (q) {
      const owner = q.key.slice(q.key.indexOf(':') + 1);
      quests[q.key] = { edid: q.edid, scripts: q.scripts, from: name, owner: owner };
    });
  });

  const plugName = {};
  order.forEach(function (n) { plugName[n.toLowerCase()] = n; });
  const find = scriptFinder(data, order);
  const menus = [];
  Object.keys(quests).forEach(function (key) {
    const q = quests[key];
    q.scripts.forEach(function (s) {
      const chain = chainOf(s.name, find);
      const lower = chain.map(function (c) { return c.toLowerCase(); });
      if (lower.indexOf(MENU_BASE) === -1) {
        const last = find(chain[chain.length - 1]);
        if (last && last.error) { problem(last.error); }
        return;
      }
      const owner = plugName[q.owner] || q.owner;
      const menu = {
        plugin: owner,
        from: q.from,
        quest: q.edid,
        script: s.name,
        chain: chain,
        kind: lower.indexOf(HELPER_BASE) !== -1 ? 'helper' : 'classic',
        scriptFrom: (find(s.name) || {}).from || '',
        globals: [],
        ownFile: []
      };
      s.props.forEach(function (p) {
        (p.keys || []).forEach(function (k) {
          if (globs[k] !== undefined && menu.globals.indexOf(globs[k] || k) === -1) { menu.globals.push(globs[k] || k); }
        });
      });
      chain.forEach(function (c) {
        const lc = c.toLowerCase();
        if (lc === MENU_BASE || lc === HELPER_BASE) { return; }
        const pex = find(c);
        (pex && pex.strings || []).forEach(function (w) {
          if (OWN_FILE.test(w) && menu.ownFile.indexOf(w) === -1) { menu.ownFile.push(w); }
        });
      });
      menus.push(menu);
    });
  });
  menus.sort(function (a, b) {
    return order.indexOf(a.plugin) - order.indexOf(b.plugin) || (a.script.toLowerCase() < b.script.toLowerCase() ? -1 : 1);
  });

  // MCM Helper: each menu's config.json, and whether its settings file is there.
  const configDir = path.join(data, 'MCM', 'Config');
  const settingsDir = path.join(data, 'MCM', 'Settings');
  const claimed = {};
  menus.forEach(function (m) {
    if (m.kind !== 'helper') { return; }
    const stem = m.plugin.replace(/\.(esp|esm|esl)$/i, '');
    claimed[stem.toLowerCase()] = true;
    m.configDir = stem;
    const cfgFile = path.join(configDir, stem, 'config.json');
    if (!fs.existsSync(cfgFile)) { m.config = null; return; }
    try { m.config = readMcmConfig(fs.readFileSync(cfgFile, 'utf8')); }
    catch (e) { m.config = null; problem('Data\\MCM\\Config\\' + stem + '\\config.json would not read: ' + e.message); return; }
    m.config.controls.forEach(function (c) {
      if (c.where !== 'global') { return; }
      const k = sourceFormKey(c.form);
      c.global = globs[k] !== undefined ? (globs[k] || k) : '';
    });
    const ini = path.join(settingsDir, (m.config.modName || stem) + '.ini');
    m.settingsFile = fs.existsSync(ini)
      ? { name: path.basename(ini), date: stamp(ini), first: firstLine(ini) }
      : null;
  });

  let configs = [];
  try { configs = fs.readdirSync(configDir).filter(function (d) { return fs.statSync(path.join(configDir, d)).isDirectory(); }); } catch (e) { configs = []; }
  const orphanConfigs = configs.filter(function (d) { return !claimed[d.toLowerCase()]; }).sort();

  let settingsFiles = [];
  try { settingsFiles = fs.readdirSync(settingsDir).filter(function (f) { return /\.ini$/i.test(f); }); } catch (e) { settingsFiles = []; }
  settingsFiles = settingsFiles.sort().map(function (f) {
    const full = path.join(settingsDir, f);
    const stem = f.replace(/\.ini$/i, '').toLowerCase();
    const reader = menus.filter(function (m) {
      return m.kind === 'helper' && ((m.config && m.config.modName) || m.configDir || '').toLowerCase() === stem;
    })[0];
    return { name: f, date: stamp(full), first: firstLine(full), menu: reader ? reader.plugin : '' };
  });

  return {
    data: data, plugins: pluginsTxt, order: order, missing: missing, problems: problems,
    menus: menus, orphanConfigs: orphanConfigs, settingsFiles: settingsFiles
  };
}

// ------------------------------------------------------------------ the report

function tally(controls) {
  const t = { file: 0, global: 0, script: 0, none: 0, hidden: 0 };
  controls.forEach(function (c) { if (c.hidden) { t.hidden++; } else { t[c.where]++; } });
  return t;
}

function report(r, verbose) {
  const out = [];
  function say(s) { out.push(s); }
  function head(s) { say(''); say(s); say('-'.repeat(s.length)); }
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // Atlas alone wires 98 globals to its menu. The first few say what kind of
  // thing they are; -v prints the rest.
  function some(list) {
    if (verbose || list.length <= 8) { return list.join(', '); }
    return list.slice(0, 8).join(', ') + ' and ' + (list.length - 8) + ' more (-v lists them)';
  }

  say('MOD SETTINGS MENUS, and where each one keeps what a person changes');
  say('Read ' + r.data + ', ' + r.order.length + ' plugins from ' + r.plugins +
      (r.missing.length ? ' (' + r.missing.length + ' of them not installed: ' + r.missing.join(', ') + ')' : ''));

  const helper = r.menus.filter(function (m) { return m.kind === 'helper'; });
  const classic = r.menus.filter(function (m) { return m.kind === 'classic'; });

  head('MCM Helper menus: ' + helper.length);
  let fileTotal = 0, globalTotal = 0, scriptTotal = 0;
  helper.forEach(function (m) {
    say('  ' + m.plugin + '   quest ' + m.quest + ', script ' + m.script);
    if (!m.config) {
      say('      no Data\\MCM\\Config\\' + m.configDir + '\\config.json, so nothing says where its values go');
      return;
    }
    const t = tally(m.config.controls);
    fileTotal += t.file; globalTotal += t.global; scriptTotal += t.script;
    const parts = [t.file + ' kept in its ini on this machine'];
    if (t.global) { parts.push(t.global + ' in GLOB records'); }
    if (t.script) { parts.push(t.script + ' in its script'); }
    if (t.none) { parts.push(t.none + ' naming no place at all'); }
    say('      ' + count(t.file + t.global + t.script + t.none, 'setting', 'settings') + ': ' + parts.join(', ') +
        (t.hidden ? '; and ' + count(t.hidden, 'hidden switch', 'hidden switches') + ' the menu sets for itself' : ''));
    const globals = [];
    m.config.controls.forEach(function (c) {
      if (c.where === 'global' && !c.hidden && globals.indexOf(c.global || c.form) === -1) { globals.push(c.global || c.form); }
    });
    if (globals.length) { say('      the GLOB records a person sets: ' + some(globals)); }
    say('      Data\\MCM\\Settings\\' + (m.config.modName || m.configDir) + '.ini: ' +
        (m.settingsFile ? 'there, dated ' + m.settingsFile.date : 'not there yet, which is every value at its default'));
    if (verbose) {
      m.config.controls.forEach(function (c) {
        const where = c.hidden ? 'hidden' : c.where === 'global' ? 'GLOB ' + (c.global || c.form) : c.where;
        say('        ' + c.type.padEnd(13) + ' ' + where.padEnd(16) + ' ' + c.id);
      });
    }
  });

  head('Classic SkyUI menus: ' + classic.length);
  classic.forEach(function (m) {
    say('  ' + m.plugin + '   quest ' + m.quest + ', script ' + m.script +
        (m.from !== m.plugin ? ' (the quest as ' + m.from + ' leaves it)' : ''));
    say('      its values live in its script, which starts from the plugin every session');
    say('      ' + (m.globals.length
      ? count(m.globals.length, 'GLOB record is', 'GLOB records are') + ' wired to it, which Skyrim Platform can set: ' + some(m.globals)
      : 'no GLOB record is wired to it, so nothing in it can be set from outside the menu'));
    if (m.ownFile.length) {
      say('      it calls ' + m.ownFile.join(' and ') + ', so it may keep some values in a file of its own; its source says which');
    }
    if (verbose) { say('      extends ' + m.chain.slice(1).join(' > ') + '; script from ' + m.scriptFrom); }
  });

  head('Settings files in Data\\MCM\\Settings');
  if (!r.settingsFiles.length) { say('  none'); }
  r.settingsFiles.forEach(function (f) {
    say('  ' + f.name + '   ' + f.date + '   ' + (f.menu ? 'read by ' + f.menu : 'no menu in the load order reads it'));
    if (f.first) { say('      first line: ' + f.first); }
  });
  if (r.orphanConfigs.length) {
    say('');
    say('  Folders in Data\\MCM\\Config with no menu in the load order: ' + r.orphanConfigs.join(', '));
  }

  if (r.problems.length) {
    head('Could not read');
    r.problems.forEach(function (p) { say('  ' + p); });
  }

  head('What this says');
  say('  ' + r.menus.length + ' menus: ' + helper.length + ' MCM Helper, ' + classic.length + ' classic.');
  say('  MCM Helper: ' + fileTotal + ' settings kept in files on this machine, which a session does not reset;');
  say('  ' + globalTotal + ' in GLOB records and ' + scriptTotal + ' in scripts, which it does.');
  const withGlobals = classic.filter(function (m) { return m.globals.length; }).length;
  const withFile = classic.filter(function (m) { return m.ownFile.length; }).length;
  say('  Classic: what is in the script resets every session. ' + withGlobals + ' of the ' + classic.length +
      ' have GLOB records wired to them that a store could put back,');
  say('  and ' + withFile + ' call a file writer and may keep some values without anybody\'s help.');
  say('  Not answered here: whether each menu opens under SkyMP at all, and whether a mod');
  say('  acts on a GLOB set from outside its menu. Both need the game.');
  return out;
}

module.exports = {
  formKey: formKey, readPlugin: readPlugin, readVmad: readVmad,
  readPex: readPex, lz4Block: lz4Block, lz4Frame: lz4Frame, archiveScripts: archiveScripts,
  archiveFile: archiveFile, scriptFinder: scriptFinder, chainOf: chainOf,
  readMcmConfig: readMcmConfig, sourceFormKey: sourceFormKey, audit: audit, report: report
};

// Exits 1 when something could not be read, because then the answer above has
// a hole in it. The code is set rather than exited on, so the report is all
// out before the process ends.
function main(args) {
  const opt = function (name, def) {
    const at = args.indexOf('--' + name);
    return at >= 0 && args[at + 1] ? args[at + 1] : def;
  };
  const data = opt('data', 'C:\\Thornswood\\Game\\Data');
  const plugins = opt('plugins', path.join(data, '..', '..', 'Profile', 'Default', 'plugins.txt'));
  if (!fs.existsSync(data)) { console.error('FAIL  no Data folder at ' + data); return 1; }
  if (!fs.existsSync(plugins)) { console.error('FAIL  no plugins.txt at ' + plugins); return 1; }
  const r = audit({ data: data, plugins: plugins });
  report(r, args.indexOf('-v') !== -1).forEach(function (l) { console.log(l); });
  return r.problems.length ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
