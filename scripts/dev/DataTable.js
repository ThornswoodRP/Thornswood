// DataTable.js
//
// The gamemode's DATA table, game/gamemode-tables/DATA.json (#5191, stage 4e).
//
// game/data/data.json is written by hand: the holds, which room belongs to
// which hold, the capitals, the places a death wakes and Solstheim's id. Two
// builders add what they read out of the load order: the worldspaces
// (Build-WorldspaceTable.js, game/data/worldspaces.json) and the worldspaces
// of their own with their places to wake and the doors into them
// (Build-WakeTable.js, game/data/own-worlds.json). Until 16 Nov 2026 those two
// wrote their lists into data.json itself, so one file was both a source and
// a table the content build writes, and it could not leave git with the
// tables. Now each writes a file of its own, and the DATA table is data.json
// with theirs after it, laid out (GamemodeTables.js). data.json's own text is
// kept as written, so a number is never re-spelled.
'use strict';
const fs = require('fs');
const path = require('path');
const GT = require('./GamemodeTables.js');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'game', 'data');
const HAND = path.join(DATA_DIR, 'data.json');
// Each builder's file, and the keys it adds, in the order the table holds them.
const PARTS = [
  { file: 'worldspaces.json', keys: ['worldspaces'], by: 'scripts/dev/Build-WorldspaceTable.js' },
  { file: 'own-worlds.json', keys: ['ownWorlds', 'ownWorldDoors'], by: 'scripts/dev/Build-WakeTable.js' }
];
const ADDED = PARTS.reduce(function (a, p) { return a.concat(p.keys); }, []);

// A file's text, or null when there is none. Read once, with no look first,
// so nothing can change between the look and the read.
function readText(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') { return null; } throw e; }
}

// A part's file as its builder writes it: its keys, one space a level, LF.
function partText(keys, value) {
  const o = {};
  keys.forEach(function (k) { o[k] = value[k]; });
  return JSON.stringify(o, null, 1) + '\n';
}

// The table's JSON text from data.json's text and the parts' values ({ key:
// value }), or { error }. A part not given is left out.
function compose(handText, parts) {
  const text = handText.split('\r\n').join('\n');
  let hand;
  try { hand = JSON.parse(text); } catch (e) { return { error: 'data.json will not parse (' + e.message + ')' }; }
  if (!hand || typeof hand !== 'object' || Array.isArray(hand)) { return { error: 'data.json is not an object' }; }
  const theirs = ADDED.filter(function (k) { return Object.prototype.hasOwnProperty.call(hand, k); });
  if (theirs.length) { return { error: 'data.json holds ' + theirs.join(', ') + ', which a builder writes into a file of its own' }; }
  const end = text.lastIndexOf('}');
  let json = text.slice(0, end).replace(/\s+$/, '');
  ADDED.forEach(function (k) {
    if (!parts || parts[k] === undefined) { return; }
    json += ',\n "' + k + '": ' + JSON.stringify(parts[k], null, 1).split('\n').join('\n ');
  });
  json += '\n}\n';
  return { json: json };
}

// The parts' values as their files hold them in -dir, the ones there.
function readParts(dir) {
  const out = {};
  PARTS.forEach(function (p) {
    const f = path.join(dir || DATA_DIR, p.file);
    const t = readText(f);
    if (t === null) { return; }
    const v = JSON.parse(t);
    p.keys.forEach(function (k) { if (v[k] !== undefined) { out[k] = v[k]; } });
  });
  return out;
}

// The DATA table's text from data.json and the parts, or { error }.
function tableText(handText, parts) {
  const c = compose(handText, parts);
  return c.error ? c : { text: GT.layout(c.json) };
}

module.exports = { HAND: HAND, DATA_DIR: DATA_DIR, PARTS: PARTS, ADDED: ADDED,
                   partText: partText, readText: readText, compose: compose, readParts: readParts, tableText: tableText };
