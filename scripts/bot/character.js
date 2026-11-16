// scripts/bot/character.js
//
// #5196. What a server folder holds for one character, and whether the
// character the server sent a bot is that one. The restore rehearsal
// (#1046, #5020) asks exactly this of a person in the game today: "load your
// character on a server restored from backup". Here it is a comparison.
//
// expected(root, profileId) reads the character from root's world (its
// world folder, or MongoDB read out the same way, #6237), the same
// rule Restore-Server.ps1 uses: a runtime change form in world\changeForms,
// named with its form id in lowercase hex and no plugin (FormDesc::ToString,
// %x, #5168), whose profileId is the one asked for and which is not
// deleted. It must be read before the bot logs in, since the server writes
// the form again once the character is loaded.
//
// compare(want, got) holds the createActor the bot was sent against it:
// where the character stands (position, angle, world or cell), what it
// carries (every inventory entry), its health, magicka and stamina, whether
// it is dead, its name and whether the race menu is open. Each is a line,
// PASS or FAIL with both values; a field the backup does not hold is a SKIP
// line saying so, never a silent pass.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function readJson(file) {
  return JSON.parse(String(fs.readFileSync(file, 'utf8')).replace(/^﻿/, ''));
}

// The plugins the server loads, in its order, as ScampServer.cpp builds the
// list: loadOrder's entries (absolute, or under dataDir), or the five masters.
function pluginPaths(root, settings) {
  const dataDir = path.resolve(root, String(settings.dataDir || 'data'));
  const list = Array.isArray(settings.loadOrder) ? settings.loadOrder
    : ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
  return list.map((p) => (path.isAbsolute(String(p)) || /^[A-Za-z]:[\\/]/.test(String(p)))
    ? String(p) : path.join(dataDir, String(p)));
}

// libespm's IsLightPlugin: the TES4 header's flag 0x200, or an .esl name.
function isLight(file) {
  if (/\.esl$/i.test(file)) { return true; }
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('latin1', 0, 4) !== 'TES4') {
      throw new Error(file + ' does not start with a TES4 header');
    }
    return (head.readUInt32LE(8) & 0x200) !== 0;
  } finally { fs.closeSync(fd); }
}

// file name (lower case) -> { full, index } in the game's numbering: full and
// light plugins are counted apart, each in load order (libespm Combiner).
function slots(paths) {
  const out = {};
  let full = 0, light = 0;
  for (const p of paths) {
    const name = path.basename(p.replace(/\\/g, '/')).toLowerCase();
    const l = isLight(p);
    out[name] = l ? { full: false, index: light++ } : { full: true, index: full++ };
  }
  return out;
}

// The masters a plugin names in its TES4 header (MAST subrecords), as file
// names. Skyrim's TES4 record header is 24 bytes; an XXXX subrecord carries
// the size of the one after it.
function masters(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(24);
    if (fs.readSync(fd, head, 0, 24, 0) < 24 || head.toString('latin1', 0, 4) !== 'TES4') {
      throw new Error(file + ' does not start with a TES4 header');
    }
    const size = head.readUInt32LE(4);
    const data = Buffer.alloc(size);
    if (fs.readSync(fd, data, 0, size, 24) < size) { throw new Error(file + '\'s TES4 header is cut short'); }
    const out = [];
    let at = 0, big = -1;
    while (at + 6 <= data.length) {
      const type = data.toString('latin1', at, at + 4);
      const n = big >= 0 ? big : data.readUInt16LE(at + 4);
      big = -1;
      if (type === 'XXXX') { big = data.readUInt32LE(at + 6); at += 6 + 4; continue; }
      if (type === 'MAST') { out.push(data.toString('latin1', at + 6, at + 6 + n).replace(/\0+$/, '')); }
      at += 6 + n;
    }
    return out;
  } finally { fs.closeSync(fd); }
}

// The plugin a rehearsal's load order change moves (#6237): the earliest
// full plugin no other loaded plugin names as a master and that the game
// does not load as a master itself. A plugin that is somebody's master
// stays, since the game loads a master before what needs it; one that is a
// master (0x1, .esm or .esl) is loaded before every plugin that is not, so
// it can never be last (#6313). It only names the plugin: the order is made
// by the one rule, ServerOrder.ps1's Get-ThornswoodServerOrder, which takes
// it out of the running order and puts it back on the end of the full
// plugins (Rehearse-OnBox.ps1, Set-RehearsalOrder). paths are where
// loadOrder's entries are. Returns { moved, from, to }, the full slot it
// leaves and the one it takes, or throws when no plugin may move.
function pick(paths) {
  const names = paths.map((p) => path.basename(p.replace(/\\/g, '/')).toLowerCase());
  const needed = new Set();
  for (const p of paths) { for (const m of masters(p)) { needed.add(m.toLowerCase()); } }
  const fulls = paths.filter((p) => !isLight(p)).length;
  let full = -1;
  for (let i = 0; i < paths.length; i++) {
    if (isLight(paths[i])) { continue; }
    full++;
    if (full === fulls - 1 || needed.has(names[i]) || loadsAsMaster(paths[i])) { continue; }
    return { moved: path.basename(paths[i].replace(/\\/g, '/')), from: full, to: fulls - 1 };
  }
  throw new Error('every full plugin but the last is a master, or a master of another, so none can move');
}

// Whether the game loads a plugin as a master: an .esm or .esl name, or the
// 0x1 flag in its TES4 header (Test-ThornswoodLoadsAsMaster's rule).
function loadsAsMaster(file) {
  if (/\.es[ml]$/i.test(file)) { return true; }
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('latin1', 0, 4) !== 'TES4') {
      throw new Error(file + ' does not start with a TES4 header');
    }
    return (head.readUInt32LE(8) & 0x1) !== 0;
  } finally { fs.closeSync(fd); }
}

// Each plugin the character's ids name, with its slot in table, as
// { "Skyrim Unbound.esp": "0x2f" }: what a load order change moves.
function pluginsOf(form, table) {
  const out = {};
  const note = (v) => {
    const m = typeof v === 'string' ? /^[0-9a-fA-F]+:(.+)$/.exec(v) : null;
    if (!m) { return; }
    const s = table[m[1].toLowerCase()];
    out[m[1]] = s ? (s.full ? '0x' + s.index.toString(16).padStart(2, '0') : '0xfe' + s.index.toString(16).padStart(3, '0')) : 'not loaded';
  };
  note(form.worldOrCellDesc);
  const entries = form.inv && Array.isArray(form.inv.entries) ? form.inv.entries : [];
  for (const e of entries) {
    note(e.baseId); note(e.enchantmentId); note(e.poisonId);
    for (const o of [e.made, e.madeEnchantment]) { if (o && Array.isArray(o.effects)) { for (const f of o.effects) { note(f.effectId); } } }
  }
  return out;
}

// FormDesc::ToFormId: "1a26f:Skyrim.esm" to the number the server sends.
function descToId(desc, table) {
  const m = /^([0-9a-fA-F]+)(?::(.+))?$/.exec(String(desc || ''));
  if (!m) { throw new Error('"' + desc + '" is not a form desc'); }
  const id = parseInt(m[1], 16);
  if (!m[2]) { return (0xff000000 + id) >>> 0; }
  if (id === 0x3c && m[2] === 'Skyrim.esm') { return 0x3c; }
  const s = table[m[2].toLowerCase()];
  if (!s) { throw new Error(m[2] + ' (in ' + desc + ') is not in the server\'s load order'); }
  if (s.full) { return ((s.index << 24) | (id & 0xffffff)) >>> 0; }
  return (0xfe000000 | (s.index << 12) | (id & 0xfff)) >>> 0;
}

// A world in MongoDB (#6237), read out by scripts/vps/world.js into a
// folder laid out as the file driver lays out a world, with the connection
// file the server's settings name (read inside mongosh, never here).
// Returns the folder; the caller removes its parent when done.
function readOutMongo(settings) {
  const shell = process.env.THORNSWOOD_MONGOSH || 'C:\\Thornswood-Mongo\\bin\\mongosh.exe';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-world-'));
  const plan = path.join(tmp, 'plan.json');
  const to = path.join(tmp, 'changeForms');
  fs.writeFileSync(plan, JSON.stringify({
    op: 'export', uri: String(settings.databaseUriFile || ''), db: String(settings.databaseName || ''),
    to, manifest: path.join(tmp, 'export.json'), live: true
  }));
  const r = childProcess.spawnSync(shell, ['--nodb', '--quiet', '--file', path.join(__dirname, '..', 'vps', 'world.js')],
    { env: Object.assign({}, process.env, { THORNSWOOD_WORLD_PLAN: plan }), encoding: 'utf8' });
  const said = String(r.stdout || '') + String(r.stderr || '');
  if (r.status !== 0 || !/^EXPORTED\|/m.test(said)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('the world in ' + settings.databaseName + ' could not be read out: ' + (said.trim() || (r.error && r.error.message) || 'mongosh said nothing'));
  }
  return to;
}

// The living characters in root's world: [{ file, profileId, form }].
function characters(root, settings) {
  if (settings.databaseDriver === 'mongodb') {
    const dir = readOutMongo(settings);
    try { return charactersIn(dir); } finally { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); }
  }
  // The engine's own setting names the folder: databaseName, "world" when
  // unset (DatabaseFactory.cpp in the fork).
  return charactersIn(path.join(root, String(settings.databaseName || 'world'), 'changeForms'));
}

function charactersIn(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^[0-9a-f]{1,16}\.json$/.test(f)) { continue; }
    let o;
    try { o = readJson(path.join(dir, f)); } catch (e) { continue; }
    const pid = Number(o && o.profileId);
    if (!(pid > 0) || o.isDeleted) { continue; }
    out.push({ file: f, profileId: pid, form: o });
  }
  return out;
}

function expected(root, profileId) {
  const settings = readJson(path.join(root, 'server-settings.json'));
  const hits = characters(root, settings).filter((c) => c.profileId === Number(profileId));
  if (hits.length !== 1) {
    throw new Error(hits.length ? hits.length + ' living characters have profile id ' + profileId + ' (' +
                    hits.map((h) => h.file).join(', ') + '), so which one should load is not known'
                    : 'no living character in ' + root + ' has profile id ' + profileId);
  }
  const form = hits[0].form;
  const table = slots(pluginPaths(root, settings));
  return {
    file: hits[0].file,
    profileId: Number(profileId),
    position: form.position,
    angle: form.angle,
    worldOrCellDesc: form.worldOrCellDesc,
    worldOrCell: form.worldOrCellDesc ? descToId(form.worldOrCellDesc, table) : undefined,
    inventory: form.inv && Array.isArray(form.inv.entries) ? form.inv.entries.map((e) => numbered(e, table)) : undefined,
    healthPercentage: form.healthPercentage,
    magickaPercentage: form.magickaPercentage,
    staminaPercentage: form.staminaPercentage,
    isDead: form.isDead,
    isRaceMenuOpen: form.isRaceMenuOpen,
    name: nameOf(form.appearanceDump),
    plugins: pluginsOf(form, table),
    port: Number(settings.port) || 7777,
    password: settings.password === undefined ? '' : String(settings.password)
  };
}

// Ids by plugin (#6237, the engine's StableIds): a saved id is "801:Sword.esp"
// rather than the number the server sends, and a made bottle's or
// enchantment's id is "made", its hash worked out again from its effects.
// An inventory entry with each id as the number the server sends.
function numbered(entry, table) {
  const n = JSON.parse(JSON.stringify(entry));
  const id = (v) => (typeof v === 'string' && v !== 'made' ? descToId(v, table) : v);
  const effects = (o) => { if (o && Array.isArray(o.effects)) { for (const e of o.effects) { e.effectId = id(e.effectId); } } };
  effects(n.made);
  effects(n.madeEnchantment);
  n.baseId = n.baseId === 'made' ? madeId(canonicalMade(n.made)) : id(n.baseId);
  if (n.enchantmentId !== undefined) {
    n.enchantmentId = n.enchantmentId === 'made' ? madeId(canonicalEnchantment(n.madeEnchantment)) : id(n.enchantmentId);
  }
  if (n.poisonId !== undefined) { n.poisonId = id(n.poisonId); }
  return n;
}

// Inventory.cpp: Canonical(Made), Canonical(MadeEnchantment) and MadeId,
// FNV-1a over the canonical text, in the made range from 0xff800000.
function canonicalEffects(effects) {
  return (effects || []).map((e) => '|' + (Number(e.effectId) >>> 0).toString(16) + ':' + Math.fround(Number(e.magnitude)).toFixed(2) +
    ':' + Number(e.area) + ':' + Number(e.duration)).join('');
}
function canonicalMade(made) {
  if (!made) { throw new Error('an entry says its id is made but carries no made bottle'); }
  return (made.poison ? 'poison|' : 'potion|') + String(made.name || '') + canonicalEffects(made.effects);
}
function canonicalEnchantment(e) {
  if (!e) { throw new Error('an entry says its enchantment is made but carries none'); }
  return (e.weapon ? 'weapon-enchantment' : 'armour-enchantment') + canonicalEffects(e.effects);
}
function madeId(text) {
  let h = 2166136261;
  for (const b of Buffer.from(text, 'utf8')) { h = Math.imul(h ^ b, 16777619) >>> 0; }
  return (0xff800000 | (h & 0x007fffff)) >>> 0;
}

function nameOf(appearanceDump) {
  if (!appearanceDump) { return undefined; }
  try {
    const a = typeof appearanceDump === 'string' ? JSON.parse(appearanceDump) : appearanceDump;
    return a && typeof a.name === 'string' ? a.name : undefined;
  } catch (e) { return undefined; }
}

// Keys in order, so two entries that say the same thing read the same.
function canon(v) {
  if (Array.isArray(v)) { return '[' + v.map(canon).join(',') + ']'; }
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function near(a, b, tol) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { return false; }
  return a.every((x, i) => Math.abs(Number(x) - Number(b[i])) <= tol);
}

function fmt(v) { return v === undefined ? 'nothing' : JSON.stringify(v); }

// [{ ok: true|false|null, what, want, got }], null for a skip.
function compare(want, got) {
  const lines = [];
  const props = got.props || {};
  const pick = (k) => (props[k] !== undefined ? props[k] : got[k]);
  const line = (ok, what, w, g) => lines.push({ ok, what, want: fmt(w), got: fmt(g) });
  const t = got.transform || {};

  line(got.isMe === true, 'the server sent the character as its owner\'s (isMe)', true, got.isMe);
  if (want.position === undefined) { line(null, 'position: the backup holds none'); }
  else { line(near(want.position, t.pos, 0.01), 'position', want.position, t.pos); }
  if (want.angle === undefined) { line(null, 'angle: the backup holds none'); }
  else { line(near(want.angle, t.rot, 0.01), 'angle', want.angle, t.rot); }
  if (want.worldOrCell === undefined) { line(null, 'world or cell: the backup holds none'); }
  else {
    line(t.worldOrCell === want.worldOrCell, 'world or cell (' + want.worldOrCellDesc + ')',
         '0x' + want.worldOrCell.toString(16), t.worldOrCell === undefined ? undefined : '0x' + Number(t.worldOrCell).toString(16));
  }

  if (want.inventory === undefined) { line(null, 'inventory: the backup holds none'); }
  else {
    const inv = pick('inventory');
    const gotEntries = inv && Array.isArray(inv.entries) ? inv.entries : [];
    const w = want.inventory.map(canon).sort();
    const g = gotEntries.map(canon).sort();
    const missing = w.filter((x) => { const i = g.indexOf(x); if (i < 0) { return true; } g.splice(i, 1); return false; });
    line(missing.length === 0 && g.length === 0, 'inventory, ' + want.inventory.length + ' entries',
         missing.length ? 'also ' + missing.join(' ') : want.inventory.length + ' entries',
         g.length ? 'also ' + g.join(' ') : gotEntries.length + ' entries');
  }

  for (const k of ['healthPercentage', 'magickaPercentage', 'staminaPercentage']) {
    if (want[k] === undefined) { line(null, k + ': the backup holds none'); continue; }
    const g = pick(k);
    line(typeof g === 'number' && Math.abs(g - want[k]) <= 0.001, k, want[k], g);
  }
  line(!!pick('isDead') === !!want.isDead, 'dead', !!want.isDead, !!pick('isDead'));
  line(!!pick('isRaceMenuOpen') === !!want.isRaceMenuOpen, 'race menu open', !!want.isRaceMenuOpen, !!pick('isRaceMenuOpen'));
  if (want.name === undefined) { line(null, 'name: the backup holds no appearance'); }
  else {
    const a = got.appearance || props.appearance;
    line(!!a && a.name === want.name, 'name', want.name, a ? a.name : undefined);
  }
  return lines;
}

module.exports = { expected, compare, characters, descToId, slots, pluginPaths, isLight, masters, pick, loadsAsMaster, pluginsOf, canon, numbered, madeId, canonicalMade, canonicalEnchantment };
