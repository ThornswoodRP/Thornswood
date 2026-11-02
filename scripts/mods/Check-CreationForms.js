// Check-CreationForms.js
//
//     node scripts\mods\Check-CreationForms.js
//     node scripts\mods\Check-CreationForms.js --data <a Data folder> --plugins <its plugins.txt>
//     node scripts\mods\Check-CreationForms.js --write records\update-creation-club.json
//
// Does anything in the load order, or anything the gamemode hands out, need
// Creation Club content that plain Special Edition does not load? Exit 0 when
// nothing does, 1 when something does, and 0 with a SKIP on a machine with no
// game folder, so a build runner can run it.
//
// Issue #479, Patrick, 28 September: "Yes base only". Thornswood needs only
// Skyrim Special Edition. Nobody has to own the Anniversary upgrade, and
// somebody who owns it still plays.
//
// WHAT Check-Editions.ps1 COULD NOT SEE, AND THIS DOES. Check-Editions reads
// the masters a plugin declares, and said itself that it could not see "a
// plugin using a Creation Club form id without declaring the master". In the
// file format that has one real shape: a form id's top byte is an index into
// the plugin's own master list, so a plugin cannot point into a Creation Club
// file it does not declare. What it CAN point into is Update.esm, because
// Bethesda keeps several hundred Creation Club records there (editor ids
// starting cc: the Rare Curios roots, the unicorn horse armor, the bone wolf,
// the empty "Creation Club Cell" rooms). Every Special Edition has those
// records, but their meshes, textures and scripts come with the Creation Club
// files, which Thornswood's own game folder leaves out (OwnGame
// UnwantedCreation) and the server never loads. So a plugin that places,
// stocks or level lists one of them shows a missing mesh on a base install,
// and a gamemode table that hands one out gives somebody an item with nothing
// to draw.
//
// So it reads, the way the game does:
//
//   1. Update.esm: every record of its own whose editor id starts with cc.
//      --write puts that list in records\update-creation-club.json, which
//      tests\test-special-edition-only.js reads, so the gamemode's tables are
//      held to it on a machine with no game at all.
//   2. Every enabled plugin in the list: its declared masters (none may be a
//      Creation Club file), and every record in it, compressed ones opened,
//      for a form id that resolves to one of those Update.esm records. A
//      record that is itself one of them (an override) is left alone: it
//      changes something nobody places. So is a reference Update.esm's own
//      copy of the same record already makes: that is the base game's.
//   3. The gamemode (game\gamemode.js, its tables in game\gamemode-tables,
//      game\data\*.json, game\plugins\*.js):
//      no form key names a Creation Club file, and none names one of those
//      records outside the tables that only describe a record (DESCRIBE_ONLY
//      below says which and why).
//
// WHAT IT STILL CANNOT SEE: a mesh or texture path inside a plugin that only a
// Creation Club archive holds. Nothing here opens an archive. A playtest on a
// machine with no Creation Club files (the shipping machine's Game\Data has
// none) shows it as a red exclamation mark or an invisible object.
//
// Read only, but for --write.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.join(__dirname, '..', '..');
const LIGHT_FLAG = 0x200;
const COMPRESSED = 0x40000;

/** An official Creation Club plugin, by name: LoadOrder.IsCreation in the launcher. */
function isCreation(name) {
  return /^cc[a-z]{3}sse\d{3}.*\.es[mlp]$/i.test(String(name == null ? '' : name).trim());
}

/** The TES4 header: flags, masters in order, and where the records start. */
function readHeader(buf) {
  if (!buf || buf.length < 24 || buf.toString('latin1', 0, 4) !== 'TES4') { return null; }
  const size = buf.readUInt32LE(4);
  const flags = buf.readUInt32LE(8);
  const masters = [];
  for (const s of subrecords(buf.subarray(24, 24 + size))) {
    if (s.type === 'MAST') { masters.push(s.data.toString('latin1').replace(/\0+$/, '')); }
  }
  return { flags: flags, light: (flags & LIGHT_FLAG) !== 0, masters: masters, start: 24 + size };
}

/** Subrecords of one record's data, XXXX lengths honoured. */
function* subrecords(data) {
  let p = 0;
  let big = -1;
  while (p + 6 <= data.length) {
    const type = data.toString('latin1', p, p + 4);
    let size = data.readUInt16LE(p + 4);
    if (type === 'XXXX') { big = data.readUInt32LE(p + 6); p += 6 + size; continue; }
    if (big >= 0) { size = big; big = -1; }
    yield { type: type, data: data.subarray(p + 6, p + 6 + size) };
    p += 6 + size;
  }
}

/**
 * Every record after the header, groups walked straight through (a group's
 * header is 24 bytes and its records follow it), compressed ones inflated.
 * data is null for a record that would not inflate.
 */
function* records(buf, start) {
  let p = start;
  while (p + 24 <= buf.length) {
    const type = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (type === 'GRUP') { p += 24; continue; }
    const flags = buf.readUInt32LE(p + 8);
    const formId = buf.readUInt32LE(p + 12);
    let data = buf.subarray(p + 24, p + 24 + size);
    if (flags & COMPRESSED) {
      try { data = zlib.inflateSync(data.subarray(4)); } catch (e) { data = null; }
    }
    yield { type: type, flags: flags, formId: formId >>> 0, data: data };
    p += 24 + size;
  }
}

function editorId(data) {
  if (!data) { return ''; }
  for (const s of subrecords(data)) {
    if (s.type === 'EDID') { return s.data.toString('latin1').replace(/\0+$/, ''); }
  }
  return '';
}

function hex(n) { return (n >>> 0).toString(16); }

/**
 * Update.esm's own Creation Club records: local id (hex, no leading zeros, the
 * way the gamemode writes keys) -> "EDID TYPE".
 */
function creationRecords(updateBuf) {
  const h = readHeader(updateBuf);
  const out = {};
  if (!h) { return out; }
  const own = h.masters.length;
  for (const r of records(updateBuf, h.start)) {
    if ((r.formId >>> 24) !== own) { continue; }
    const e = editorId(r.data);
    if (/^cc/i.test(e)) { out[hex(r.formId & 0xffffff)] = e + ' ' + r.type; }
  }
  return out;
}

/*
  Every place a record points at one of those Creation Club records, as
  "<record>|<target>", both written the gamemode's way ("306a:update.esm",
  lower case). masters is the plugin's own master list, which is how a form
  id's top byte is read; self is the plugin's own name, for its new records.
  A form id is looked for at every four byte step of every field. That finds
  the ones no record layout here names, and a Creation Club id with Update.esm's
  index in its top byte is a control character there, so text and ordinary
  numbers do not look like one.
*/
function* pointsAt(buf, start, masters, self, cc) {
  let k = -1;
  for (let i = 0; i < masters.length; i++) {
    if (masters[i].toLowerCase() === 'update.esm') { k = i; }
  }
  if (k < 0) { return; }
  for (const r of records(buf, start)) {
    if (!r.data) { continue; }
    const top = r.formId >>> 24;
    const low = hex(r.formId & 0xffffff);
    // An override of one of them changes a record nobody places.
    if (top === k && cc[low]) { continue; }
    const owner = top < masters.length ? masters[top] : self;
    const key = low + ':' + String(owner).toLowerCase();
    for (const s of subrecords(r.data)) {
      for (let o = 0; o + 4 <= s.data.length; o += 4) {
        if (s.data[o + 3] !== k) { continue; }
        const target = hex(s.data.readUInt32LE(o) & 0xffffff);
        if (!cc[target]) { continue; }
        yield { key: key + '|' + target + ':update.esm', record: r, field: s.type, target: target };
      }
    }
  }
}

/**
 * What Update.esm's own records already point at: the base game's part of
 * every such reference. A plugin that copies one of those records whole (JK's
 * Skyrim carries the navmesh map, which names a Creation Club door Update.esm
 * itself places) adds nothing Special Edition does not already have.
 */
function baseReferences(updateBuf, cc) {
  const h = readHeader(updateBuf);
  const out = new Set();
  if (!h) { return out; }
  const masters = h.masters.concat(['Update.esm']);
  for (const p of pointsAt(updateBuf, h.start, masters, 'Update.esm', cc)) { out.add(p.key); }
  return out;
}

/**
 * What one plugin needs of the Creation Club: the Creation Club masters it
 * declares, and every record that points at one of Update.esm's Creation Club
 * records where Update.esm's own copy of that record does not already. cc is
 * what creationRecords returns, base what baseReferences returns.
 */
function pluginUses(buf, cc, base, self) {
  const h = readHeader(buf);
  const found = { masters: [], refs: [] };
  if (!h) { return found; }
  for (const m of h.masters) { if (isCreation(m)) { found.masters.push(m); } }
  for (const p of pointsAt(buf, h.start, h.masters, self || '(this plugin)', cc)) {
    if (base && base.has(p.key)) { continue; }
    found.refs.push({ record: p.record.type, formId: hex(p.record.formId), edid: editorId(p.record.data),
                      field: p.field, target: p.target + ':Update.esm', what: cc[p.target] });
  }
  return found;
}

/*
  The tables that only DESCRIBE a record, and so may name one of Update.esm's
  Creation Club records. Each is a lookup the gamemode makes about something
  already in front of it: how warm a worn thing is (WARMTH), what a race is
  (RACES), which building a door belongs to, what that building is called
  and which hold it answers to (BUILDING_BY_DOOR, BUILDING_NAME,
  BUILDING_HOLD, #2551), and the number its key and deed carry when name
  and hold are another building's too (LABEL_NO, #3899). None of them
  hands anything out, spawns anything or sends anybody anywhere, so a row
  for a record nobody meets is a row nobody reads. And the doors and rooms
  are Update.esm's own: it places them in every copy of Special Edition's
  world. Every other table (harvests,
  hunts, /give and /spawn, recipes, kits, spawn and respawn points) hands out
  or sends, and may not name one. A game\data file is judged as the table it
  is the record of, and the list in it of what its script left out and why
  (harvests.json "unranked", hunts.json "skipped") may name one too: that is
  where a Creation Club record is written down as left out.

  npc-population.json writes its left out rows beside the kept ones, row by
  row, all on one line: a row with keep false is a placement the script left
  out, with its reason, and the gamemode hands that ref to the engine as a
  placement exclusion (NPC_POPULATION_DATA.cut, setNpcPlacementExclusions),
  which is what keeps it out of the world. Update.esm places twenty refs of
  the bone wolf, 3025:Update.esm, each deleted or switched off from the
  start, and all twenty are cut rows (#479, #1413). So in that file a row with keep false may name one,
  and a kept row, or anything else in it, may not. LEFT_OUT_ROWS says which
  list and which rows.

  last-plugin.json (#2468) is the manifest of Thornswood-Last.esp, which stops
  every vanilla quest from starting. Update.esm's CCHorseArmorDialogueQuest
  (30b5:Update.esm) is one of them, so its list of stopped quests names it:
  that is a record written down as kept out, the same as a cut row. The rest
  of the manifest (the kept quests, the arrival talk) may not name one. A rule's
  list may sit inside an object, written as a dotted path.
*/
const DESCRIBE_ONLY = ['WARMTH', 'RACES', 'BUILDING_BY_DOOR', 'BUILDING_NAME', 'BUILDING_HOLD', 'LABEL_NO'];
const DESCRIBE_ONLY_FILES = ['warmth.json', 'races.json', 'doors.json', 'building-holds.json', 'harvests.json#unranked',
                             'hunts.json#skipped'];
const LEFT_OUT_ROWS = {
  'npc-population.json': { list: 'npcs', leftOut: function (row) { return row && row.keep === false; } },
  'last-plugin.json': { list: 'quests.stopped', leftOut: function (row) { return !!row; } }
};

/** The table a line of gamemode.js sits in: the nearest declaration at or above it. */
function tableAt(lines, i) {
  for (let j = i; j >= 0; j--) {
    const m = /^\s*(?:const|var|let)\s+([A-Z][A-Z0-9_]*)\s*=/.exec(lines[j]);
    if (m) { return m[1]; }
  }
  return '';
}

/**
 * The top level key a line of harvests.json or hunts.json sits under. Both
 * are written with two spaces a level, so a top level key opens a line with
 * exactly two and a row with four.
 */
function sectionAt(lines, i) {
  for (let j = i; j >= 0; j--) {
    const m = /^ {2}"([^"]+)": *[[{]/.exec(lines[j]);
    if (m) { return m[1]; }
  }
  return '';
}

/**
 * Every form key in the gamemode that points at Creation Club content: a
 * "<hex>:<cc plugin>" key, anywhere, or "<hex>:Update.esm" for one of its
 * Creation Club records outside the describe-only tables. files defaults to
 * the gamemode, its data tables and the game plugins. With all, the hits the
 * describe-only tables are allowed come back too, marked allowed.
 */
function gamemodeUses(cc, files, all) {
  if (!files) {
    files = [path.join(REPO, 'game', 'gamemode.js')];
    for (const dir of [path.join(REPO, 'game', 'gamemode-tables'), path.join(REPO, 'game', 'data'), path.join(REPO, 'game', 'plugins')]) {
      for (const f of fs.readdirSync(dir)) {
        if (/\.(json|js)$/i.test(f)) { files.push(path.join(dir, f)); }
      }
    }
  }
  const hits = [];
  const re = /\b([0-9a-f]{1,8}):([^"'|,:<>\r\n]{1,80}?\.es[mlp])\b/gi;
  for (const entry of files) {
    // A path, or { name, text } for text that is not on disk.
    const f = typeof entry === 'string' ? entry : entry.name;
    const text = typeof entry === 'string' ? fs.readFileSync(f, 'latin1') : String(entry.text);
    const lines = text.split('\n');
    const base = path.basename(f).toLowerCase();
    if (LEFT_OUT_ROWS[base]) {
      rowHits(cc, f, base, text, all, hits);
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(lines[i]))) {
        const plugin = m[2].trim();
        const low = m[1].toLowerCase().replace(/^0+(?=.)/, '');
        let why = '';
        let allowed = false;
        let table = '';
        if (isCreation(plugin)) {
          why = 'a Creation Club file';
        } else if (plugin.toLowerCase() === 'update.esm' && cc[low]) {
          why = cc[low];
          if (path.basename(path.dirname(f)) === 'gamemode-tables') {
            // One of the gamemode's tables (#5191), named like its constant.
            table = path.basename(f, '.json');
            allowed = DESCRIBE_ONLY.indexOf(table) >= 0;
          } else if (/\.json$/.test(base)) {
            table = base;
            allowed = DESCRIBE_ONLY_FILES.indexOf(base) >= 0 ||
                      DESCRIBE_ONLY_FILES.indexOf(base + '#' + sectionAt(lines, i)) >= 0;
          } else {
            table = tableAt(lines, i);
            allowed = DESCRIBE_ONLY.indexOf(table) >= 0;
          }
        } else {
          continue;
        }
        if (allowed && !all) { continue; }
        hits.push({ file: path.relative(REPO, f), line: i + 1, key: m[0], why: why, table: table, allowed: allowed });
      }
    }
  }
  return hits;
}

/**
 * The hits in a file LEFT_OUT_ROWS names, read as JSON rather than by line:
 * a key in a row its rule calls left out is allowed, a key anywhere else is
 * not. A file that does not read as JSON is judged whole, every hit refused.
 */
function rowHits(cc, f, base, text, all, hits) {
  const rule = LEFT_OUT_ROWS[base];
  const re = /\b([0-9a-f]{1,8}):([^"'|,:<>\r\n]{1,80}?\.es[mlp])\b/gi;
  let data = null;
  try { data = JSON.parse(text.replace(/^\uFEFF|^\u00EF\u00BB\u00BF/, '')); } catch (e) { data = null; }
  function scan(value, leftOut, where) {
    if (typeof value === 'string') {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(value))) {
        const plugin = m[2].trim();
        const low = m[1].toLowerCase().replace(/^0+(?=.)/, '');
        let why = '';
        if (isCreation(plugin)) { why = 'a Creation Club file'; }
        else if (plugin.toLowerCase() === 'update.esm' && cc[low]) { why = cc[low]; }
        else { continue; }
        const allowed = leftOut && why !== 'a Creation Club file';
        if (allowed && !all) { continue; }
        hits.push({ file: path.relative(REPO, f), line: where, key: m[0], why: why, table: base, allowed: allowed });
      }
    } else if (Array.isArray(value)) {
      for (const v of value) { scan(v, leftOut, where); }
    } else if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) { scan(value[k], leftOut, where); }
    }
  }
  if (!data) { scan(text, false, 1); return; }
  (function walk(obj, rest) {
    for (const k of Object.keys(obj)) {
      if (k === rest[0] && rest.length === 1 && Array.isArray(obj[k])) {
        obj[k].forEach(function (row) { scan(row, rule.leftOut(row), 1); });
      } else if (k === rest[0] && rest.length > 1 && obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        walk(obj[k], rest.slice(1));
      } else {
        scan(obj[k], false, 1);
      }
    }
  })(data, rule.list.split('.'));
}

/** The enabled names of a plugins.txt, in order. */
function enabledOf(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const s = raw.trim();
    if (!s.startsWith('*')) { continue; }
    const n = s.slice(1).trim();
    if (n) { out.push(n); }
  }
  return out;
}

module.exports = {
  isCreation, readHeader, subrecords, records, creationRecords, baseReferences, pluginUses,
  gamemodeUses, enabledOf, DESCRIBE_ONLY, DESCRIBE_ONLY_FILES, LEFT_OUT_ROWS
};

// ------------------------------------------------------------------ the run

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function main() {
  let data = arg('--data');
  let list = arg('--plugins');
  const write = arg('--write');
  if (!data) { data = 'C:\\Thornswood\\Game\\Data'; }
  if (!list) { list = 'C:\\Thornswood\\Profile\\LocalAppData\\plugins.txt'; }

  console.log('');
  console.log('  THORNSWOOD  -  does anything need Creation Club content?');
  const update = path.join(data, 'Update.esm');
  if (!fs.existsSync(update) || !fs.existsSync(list)) {
    console.log('');
    console.log('  SKIP. No game folder and plugin list on this machine, so there is');
    console.log('  nothing to read. This is the answer on a build runner.');
    console.log('    looked for ' + update);
    console.log('    and        ' + list);
    return 0;
  }

  const updateBuf = fs.readFileSync(update);
  const cc = creationRecords(updateBuf);
  const base = baseReferences(updateBuf, cc);
  console.log('');
  console.log('  Update.esm keeps ' + Object.keys(cc).length + ' Creation Club records of its own');
  if (write) {
    const doc = {
      builtBy: 'scripts\\mods\\Check-CreationForms.js --write',
      what: 'Update.esm\'s own records whose editor id starts with cc. Every Special Edition has them, but their meshes, textures and scripts come with the Creation Club files, which Thornswood leaves out, so no plugin may place one and no gamemode table may hand one out or send anybody to one; the tables that only describe a record may name one (DESCRIBE_ONLY in scripts\\mods\\Check-CreationForms.js). tests\\test-special-edition-only.js holds the gamemode to this list, and the table scripts skip what it names.',
      updateEsmSize: fs.statSync(update).size,
      count: Object.keys(cc).length,
      records: cc
    };
    fs.writeFileSync(write, JSON.stringify(doc, null, 1) + '\n');
    console.log('  wrote ' + write);
  }

  const enabled = enabledOf(fs.readFileSync(list, 'latin1'));
  let bad = 0;
  let read = 0;
  const absent = [];
  for (const n of enabled) {
    if (isCreation(n)) { bad++; console.log('  NEEDS  ' + n + ' is a Creation Club plugin the list switches on'); continue; }
    const p = path.join(data, n);
    if (!fs.existsSync(p)) { absent.push(n); continue; }
    read++;
    const u = pluginUses(fs.readFileSync(p), cc, base, n);
    for (const m of u.masters) { bad++; console.log('  NEEDS  ' + n + ' declares ' + m + ' as a master'); }
    for (const r of u.refs) {
      bad++;
      console.log('  NEEDS  ' + n + ': ' + r.record + ' ' + r.formId + (r.edid ? ' ' + r.edid : '') +
                  ' points at ' + r.target + ' (' + r.what + ') in ' + r.field);
    }
  }
  console.log('  ' + read + ' enabled plugins read, ' + absent.length + ' named but not in Data');

  const every = gamemodeUses(cc, null, true);
  const gm = every.filter(function (h) { return !h.allowed; });
  for (const h of gm) { bad++; console.log('  NEEDS  ' + h.file + ':' + h.line + ' ' + h.key + ' (' + h.why + ')' + (h.table ? ' in ' + h.table : '')); }
  console.log('  the gamemode: ' + (gm.length ? gm.length + ' form keys hand out Creation Club content' : 'nothing hands out or sends anybody to Creation Club content') +
              '; ' + (every.length - gm.length) + ' mentions in tables that only describe a record or list it as left out');

  console.log('');
  if (bad) {
    console.log('  Something above needs Creation Club content that Special Edition does not load.');
    console.log('  A plugin comes out through the collection and one complete release; a gamemode row');
    console.log('  comes out of the table script that wrote it.');
    return 1;
  }
  console.log('  Special Edition is enough: no plugin points at Creation Club content, and no gamemode table hands it out.');
  console.log('  What this cannot see: a mesh or texture only a Creation Club archive holds. A playtest');
  console.log('  on a machine with no Creation Club files shows that as a red exclamation mark.');
  return 0;
}

if (require.main === module) { process.exitCode = main(); }
