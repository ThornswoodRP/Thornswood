// scripts/bot/character.js
//
// #5196. What a server folder holds for one character, and whether the
// character the server sent a bot is that one. The restore rehearsal
// (#1046, #5020) asks exactly this of a person in the game today: "load your
// character on a server restored from backup". Here it is a comparison.
//
// expected(root, profileId) reads the character from root's world, the same
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
const path = require('path');

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

// The living characters in root's world: [{ file, profileId, form }].
function characters(root, settings) {
  // The engine's own setting names the folder: databaseName, "world" when
  // unset (DatabaseFactory.cpp in the fork).
  const dir = path.join(root, String(settings.databaseName || 'world'), 'changeForms');
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
    inventory: form.inv && Array.isArray(form.inv.entries) ? form.inv.entries : undefined,
    healthPercentage: form.healthPercentage,
    magickaPercentage: form.magickaPercentage,
    staminaPercentage: form.staminaPercentage,
    isDead: form.isDead,
    isRaceMenuOpen: form.isRaceMenuOpen,
    name: nameOf(form.appearanceDump),
    port: Number(settings.port) || 7777,
    password: settings.password === undefined ? '' : String(settings.password)
  };
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

module.exports = { expected, compare, characters, descToId, slots, pluginPaths, isLight, canon };
