// GamemodeTables.js
//
// Where a builder puts a table the gamemode reads (#5191).
//
// Until #5191 every builder in scripts/mods/content-tables.json pasted its
// table into game/gamemode.js, so every content change rewrote the same lines
// of that file and no two content pull requests could merge side by side.
// Now each table is its own file, game/gamemode-tables/<NAME>.json, and the
// gamemode's `const NAME = table('NAME')` reads it when it loads.
//
// The file is laid out one entry to a line down to the second level (the
// rows of {"items": {...}} or of a top-level array), and compact below that,
// so two changes to different rows of a table are two different lines that
// git merges. layout() takes any JSON text, with or without spaces, and gives
// the same bytes for the same value, so a table written from PowerShell,
// Python or JavaScript is laid out alike. The same rule is GamemodeTables.ps1
// for the PowerShell builders and gamemode_tables.py for the Python ones;
// tests/test-5191-gamemode-tables.js holds the three to each other.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'game', 'gamemode-tables');
const NAME = /^[A-Z][A-Z0-9_]*$/;
const DEPTH = 2;

function layout(text) {
  let out = '';
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[++i]; } else if (c === '"') { inString = false; }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { continue; }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '{' || c === '[') {
      depth++;
      out += c;
      let j = i + 1;
      while (j < text.length && ' \t\r\n'.includes(text[j])) { j++; }
      const next = text[j];
      if (depth <= DEPTH && next !== '}' && next !== ']') { out += '\n'; }
      continue;
    }
    if (c === '}' || c === ']') {
      const empty = out[out.length - 1] === '{' || out[out.length - 1] === '[';
      if (depth <= DEPTH && !empty) { out += '\n'; }
      depth--;
      out += c;
      continue;
    }
    if (c === ',' && depth <= DEPTH) { out += ',\n'; continue; }
    out += c;
  }
  return out + '\n';
}

// dir is the folder of tables, game/gamemode-tables unless a harness or a
// builder's --tables option names another.
function file(name, dir) {
  if (!NAME.test(name)) { throw new Error('a gamemode table is named like the constant that holds it, not ' + name); }
  return path.join(dir || DIR, name + '.json');
}

// Writes the table NAME from its JSON text or its value, and says whether the
// file changed. The text has to parse: a table that does not would stop the
// gamemode when it loads.
function body(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  JSON.parse(text);
  return layout(text);
}

// Whether the table file NAME is already what write(name, value) would make:
// a builder's --check.
function isCurrent(name, value, dir) {
  try { return fs.readFileSync(file(name, dir), 'utf8') === body(value); } catch (e) { if (e.code === 'ENOENT') { return false; } throw e; }
}

function write(name, value, dir) {
  const f = file(name, dir);
  if (isCurrent(name, value, dir)) { return false; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body(value));
  return true;
}

function read(name, dir) {
  return JSON.parse(fs.readFileSync(file(name, dir), 'utf8'));
}

// A builder's command line: each name in valued takes the word after it,
// each in flags stands alone. Anything else stops the builder before it
// reads or writes, naming the word: an option a builder does not know was
// once dropped without a word, and the run wrote the repository's own table
// in place of the folder the caller named (#5191).
function options(argv, valued, flags) {
  const out = {};
  const all = valued.concat(flags || []);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.indexOf(a) >= 0 && i + 1 < argv.length) { out[a] = argv[++i]; continue; }
    if ((flags || []).indexOf(a) >= 0) { out[a] = true; continue; }
    console.error(a + (valued.indexOf(a) >= 0 ? ' needs a value after it' : ' is not an option this takes') + '; it takes ' + all.join(', '));
    process.exit(2);
  }
  return out;
}

module.exports = { DIR, layout, file, isCurrent, write, read, options };
