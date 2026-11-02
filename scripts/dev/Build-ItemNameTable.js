// Build-ItemNameTable.js
//
// Writes the gamemode's ITEM_NAMES table (game\gamemode-tables, #5191): every
// item name the recipe
// table knows, as a maker or as an ingredient, with the record it names.
//
// WHY
//
// Patrick, 25 September: "Everytime I do /give Iron Ingot it says Nothing
// called that ... I think the table is missing Alot of items". /give finds
// things by name in tables that were generated for other reasons, and the
// recipes it reads, RECIPES_BY_ID, hold only the recipes a profession owns
// (1888 of them). Iron Ingot, Steel Ingot and Leather Strips come from
// recipes nobody owns and anybody may make, which are left out of that
// table on purpose, and ingredients were never read at all. This table is
// every output and every ingredient in game\data\recipes.json, owned or not.
//
// WHEN TWO RECORDS SHARE A NAME the one from the earliest plugin wins, in the
// order Skyrim.esm, Update.esm, Dawnguard.esm, HearthFires.esm, Dragonborn.esm,
// then any other plugin by name. That is the record people mean when they
// type the vanilla name. The rest are counted in what it prints.
//
// Read only except for the ITEM_NAMES table, which it writes.
//
// Usage:
//   node scripts\dev\Build-ItemNameTable.js
//   node scripts\dev\Build-ItemNameTable.js --recipes <file> --tables <folder>
'use strict';
const fs = require('fs');
const path = require('path');
const TABLES = require('./GamemodeTables.js');

const opts = TABLES.options(process.argv.slice(2), ['--recipes', '--tables']);
const ROOT = path.join(__dirname, '..', '..');
const RECIPES = opts['--recipes'] || path.join(ROOT, 'game', 'data', 'recipes.json');
const DIR = opts['--tables'] || TABLES.DIR;

const FIRST = ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'];
function pluginRank(desc) {
  const p = String(desc).split(':').slice(1).join(':').toLowerCase();
  const i = FIRST.indexOf(p);
  return i >= 0 ? [0, String(i).padStart(2, '0')] : [1, p];
}
function better(a, b) {
  const ra = pluginRank(a), rb = pluginRank(b);
  if (ra[0] !== rb[0]) return ra[0] < rb[0];
  if (ra[1] !== rb[1]) return ra[1] < rb[1];
  return a < b;
}

const data = JSON.parse(fs.readFileSync(RECIPES, 'utf8').replace(/^﻿/, ''));
const rows = data.recipes || {};
const byName = {};
let seen = 0;
const clashed = {};
function add(name, desc) {
  if (!name || !desc || typeof name !== 'string') return;
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const key = clean.toLowerCase();
  seen++;
  const had = byName[key];
  if (!had) { byName[key] = { name: clean, desc: desc }; return; }
  if (had.desc === desc) return;
  clashed[key] = true;
  if (better(desc, had.desc)) byName[key] = { name: clean, desc: desc };
}
for (const id of Object.keys(rows)) {
  const r = rows[id];
  add(r.name, r.out);
  for (const i of (r.inputItems || [])) add(i.name, i.item);
}

const keys = Object.keys(byName).sort();
const clashes = Object.keys(clashed).length;
// Lower-case name -> [name as written, record], in name order. /give reads it
// through buildThings.
const json = '{' + keys.map(function (k) {
  return JSON.stringify(k) + ':[' + JSON.stringify(byName[k].name) + ',' + JSON.stringify(byName[k].desc) + ']';
}).join(',') + '}';
const changed = TABLES.write('ITEM_NAMES', json, DIR);
console.log('ITEM_NAMES: ' + keys.length + ' names from ' + Object.keys(rows).length + ' recipes, ' + clashes +
  ' shared name(s), each to the earliest plugin; ' + (changed ? 'written' : 'already current'));
