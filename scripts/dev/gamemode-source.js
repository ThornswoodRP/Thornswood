'use strict';
// gamemode-source.js: the gamemode's source and how it becomes the one file
// the server loads (#2181 option D; the plan's rev 64: the gamemode as
// TypeScript source files joined into one gamemode.js).
//
// THE SOURCE. game/gamemode/*.ts, one part per section of the gamemode, and
// game/gamemode/order.json, the one list of parts in load order. A part is a
// TypeScript script, not a module: no import, no export. Every part shares
// the one top-level scope the joined file runs in, as the sections of the
// single file always did, so a part may use a name an earlier part declared.
//
// THE BUILD. Each part's types are stripped with Node's own
// module.stripTypeScriptTypes in strip mode, which puts spaces where the
// types were and changes nothing else, so every line of the built file is
// the same line of its part. The parts are then joined in order.json order,
// with nothing added between them, into game/gamemode.js. That file is what
// the server loads, what the deploys carry and what the tests read; it is
// committed, and test-2181-gamemode-source.js fails when it is not exactly
// what the parts build.
//
// THE JOINED SOURCE. A tool that edits the gamemode by its markers (the
// builders of the code bundles and of the few consts still written into it,
// such as "// MERCHANT TRADING BUNDLE BEGIN" ... "END"; the tables are files
// of their own, #5191) reads all the parts as one text with a "// @part <file>" line before each,
// edits it as it edited the single file, and writes it back. Writing it back
// splits it at those lines into the same parts in the same order (a tool
// cannot add, drop or reorder a part this way; order.json is edited by hand
// for that), writes the parts that changed, and builds game/gamemode.js.
//
// read(target) and write(target, text) take the path a tool was given. A
// source folder (one holding order.json) is the joined source above. Any
// other path is one plain gamemode file, read and written as it is: what a
// harness hands a builder when it runs it over a gamemode of its own.

const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'game', 'gamemode');
const MARK = /^\/\/ @part (\S+)$/;

function builtPath(dir) { return path.resolve(dir) + '.js'; }

function isSource(target) {
  try { return fs.statSync(target).isDirectory() && fs.existsSync(path.join(target, 'order.json')); }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

// The parts in order. Refuses a part that is listed twice, listed and
// missing, present and not listed, or not ending in a line break (the next
// part, and the joined source's @part line, must start on a line of its own).
function order(dir) {
  const file = path.join(dir, 'order.json');
  const o = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!o || !Array.isArray(o.parts) || !o.parts.length) throw new Error(file + ': no "parts" list');
  const errors = [];
  const seen = new Set();
  for (const p of o.parts) {
    if (typeof p !== 'string' || !/^[a-z0-9][a-z0-9-]*\.ts$/.test(p)) { errors.push('not a part name: ' + JSON.stringify(p)); continue; }
    if (seen.has(p)) errors.push('listed twice: ' + p);
    seen.add(p);
    if (!fs.existsSync(path.join(dir, p))) errors.push('listed but not there: ' + p);
  }
  for (const f of fs.readdirSync(dir)) {
    if (f !== 'order.json' && !seen.has(f)) errors.push('there but not listed: ' + f);
  }
  if (errors.length) throw new Error(file + ': ' + errors.join('; '));
  return o.parts;
}

function readParts(dir) {
  return order(dir).map((name) => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    if (!text.endsWith('\n')) throw new Error(path.join(dir, name) + ': does not end with a line break');
    if (text.split('\n').some((l) => MARK.test(l))) throw new Error(path.join(dir, name) + ': holds a "// @part" line, which only the joined source may');
    return { name, text };
  });
}

function strip(name, text) {
  try { return stripTypeScriptTypes(text, { mode: 'strip' }); }
  catch (e) { throw new Error(name + ': ' + String(e.message).split('\n')[0]); }
}

// The text of game/gamemode.js, built from the parts in memory.
function build(dir) {
  return readParts(dir || SOURCE).map((p) => strip(p.name, p.text)).join('');
}

// Writes game/gamemode.js from the parts. Returns true when it changed.
function writeBuilt(dir) {
  dir = dir || SOURCE;
  const text = build(dir);
  const out = builtPath(dir);
  const old = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  if (old === text) return false;
  fs.writeFileSync(out, text);
  return true;
}

function joined(dir) {
  return readParts(dir).map((p) => '// @part ' + p.name + '\n' + p.text).join('');
}

// Splits a joined source back into its parts, by the order.json of dir.
function split(dir, text) {
  const names = order(dir);
  if (!text.endsWith('\n')) throw new Error('the joined gamemode source does not end with a line break');
  const lines = text.slice(0, -1).split('\n');
  const parts = [];
  let cur = null;
  for (const line of lines) {
    const m = MARK.exec(line);
    if (m) { cur = { name: m[1], lines: [] }; parts.push(cur); continue; }
    if (!cur) throw new Error('the joined gamemode source has text before its first "// @part" line');
    cur.lines.push(line);
  }
  const got = parts.map((p) => p.name);
  if (got.join('\n') !== names.join('\n')) {
    throw new Error('the joined gamemode source names its parts differently from ' + path.join(dir, 'order.json')
      + ' (a tool may change what is in a part, not which parts there are)');
  }
  return parts.map((p) => ({ name: p.name, text: p.lines.join('\n') + '\n' }));
}

function read(target) {
  if (isSource(target)) return joined(target);
  return fs.readFileSync(target, 'utf8');
}

function write(target, text) {
  if (!isSource(target)) { fs.writeFileSync(target, text); return; }
  const parts = split(target, text);
  // Every part is stripped before any file is written, so text a tool got
  // wrong stops here with the source as it was.
  for (const p of parts) strip(p.name, p.text);
  for (const p of parts) {
    const file = path.join(target, p.name);
    if (fs.readFileSync(file, 'utf8') !== p.text) fs.writeFileSync(file, p.text);
  }
  writeBuilt(target);
}

// Line n (from 1) of the built file: which part, and which line of it.
function where(dir, n) {
  let at = 1;
  for (const p of readParts(dir || SOURCE)) {
    const count = p.text.split('\n').length - 1;
    if (n < at + count) return { part: p.name, line: n - at + 1 };
    at += count;
  }
  return null;
}

module.exports = { ROOT, SOURCE, MARK, builtPath, isSource, order, build, writeBuilt, joined, split, read, write, where };
