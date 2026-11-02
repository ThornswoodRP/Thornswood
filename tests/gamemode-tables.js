// gamemode-tables.js
//
// The tables the gamemode reads when it loads, for the harnesses (#5191).
//
// Until #5191 each table a builder reads out of the load order was a line or
// a block pasted into game/gamemode.js, and a harness took it from there with
// a regular expression. Now each is game/gamemode-tables/<NAME>.json, read by
// the gamemode's `const NAME = table('NAME')`, so a harness reads the same
// file the same way: table(name) is its value, and source(name) is the line
// the gamemode would have held, for a harness that runs gamemode code in a vm
// box and declares the table in front of it. inGamemode(src, name) reads a
// constant the way the gamemode source in front of it declares it: from its
// file when the source says table('NAME'), and from the line when the
// constant is still written there (one that is not a load order table, like
// FOOD_GROUPS); null when the source declares no such constant. lineOf(src,
// name) is the same as [the declaration, its value's JSON text], the shape a
// harness that matched the old line with a regular expression reads.
// joined(src) is the gamemode source with each table('NAME') given its
// table's value in place, as one line of JSON: what the gamemode holds once
// it has loaded, for a harness that slices or runs its source. A literal in
// place of the call is a new copy each time it runs, as table() gives one. A table
// file is laid out with line breaks only (GamemodeTables.js), and JSON holds
// no raw line break inside a string, so taking them out gives the JSON back.
'use strict';
const T = require('../scripts/dev/GamemodeTables.js');

function table(name) { return T.read(name); }
function source(name, keyword) { return (keyword || 'const') + ' ' + name + ' = ' + JSON.stringify(T.read(name)) + ';'; }

function inGamemode(src, name) {
  const m = new RegExp('^[ \\t]*(?:const|var|let) ' + name + ' = (.*);[ \\t\\r]*$', 'm').exec(src);
  if (!m) { return null; }
  if (m[1] === "table('" + name + "')") { return T.read(name); }
  return JSON.parse(m[1]);
}

function lineOf(src, name) {
  const v = inGamemode(src, name);
  if (v === null) { return null; }
  const text = JSON.stringify(v);
  return ['const ' + name + ' = ' + text + ';', text];
}

function joined(src) {
  const texts = {};
  return src.replace(/\btable\('([A-Z][A-Z0-9_]*)'\)/g, function (all, name) {
    if (!texts[name]) { texts[name] = require('fs').readFileSync(T.file(name), 'utf8').split('\n').join(''); }
    return texts[name];
  });
}

module.exports = { table, source, inGamemode, lineOf, joined, file: T.file, DIR: T.DIR };
