'use strict';
/*
  test-4436-game-readme.js

      node tests/test-4436-game-readme.js

  Issue #4436. game/README.md had fallen behind the folder it describes: it
  named a main menu with no Bethesda logo that game/ours no longer holds and
  left out files that it does, named a minority of the tables in game/data,
  said the gamemode is one file when the sources beside it are carried into
  it by builders, and named game/content as a folder of ours though the
  content plugin is built on the box and never committed (#5191).

  Nothing compared the README with the folder. This does, both ways, from
  the README's tables:

    1. the "ours" table names every committed file under game/ours, by its
       path under Data, and nothing else;
    2. the "menu" table names every file in game/menu, and nothing else;
    3. the "sources" table names every .js beside game/gamemode.js, and each
       row names the builder that carries it into the gamemode (a
       scripts/dev/Build-*Gamemode.js that reads it), or says it is not part
       of the gamemode when none does;
    4. the "data" table names every committed table in game/data, says "by
       hand" only for one no chain step of scripts/mods/content-tables.json
       writes, and the README points at that list and at .gitignore for the
       tables the box builds;
    5. it says the content plugin is built, not kept in the folder.

  What .gitignore names (the box's content build, which CI lays into the
  checkout) is not a committed file and is never asked for. Reads files only.
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function read(p) { try { return fs.readFileSync(path.join(REPO, p), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } }
function same(a, b) { return JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort()); }
function diff(a, b) { return a.filter((x) => b.indexOf(x) < 0); }

const readme = read('game/README.md');
yes('game/README.md is there', !!readme);

// What the box builds and git never holds (#5191).
const ignored = read('.gitignore').split('\n').map((l) => l.trim())
  .filter((l) => l.indexOf('/game/') === 0).map((l) => l.slice(1).replace(/\/$/, ''));
function isIgnored(rel) { return ignored.some((g) => rel === g || rel.indexOf(g + '/') === 0); }

function filesUnder(dir) {
  const out = [];
  (function walk(rel) {
    let list = [];
    try { list = fs.readdirSync(path.join(REPO, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      const r = rel + '/' + e.name;
      if (isIgnored(r)) { continue; }
      if (e.isDirectory()) { walk(r); } else { out.push(r); }
    }
  })(dir);
  return out;
}

// A section is a "## " heading whose text holds the key, to the next "## ".
function section(key) {
  const parts = readme.split(/\n(?=## )/);
  return parts.filter((p) => p.split('\n')[0].indexOf(key) >= 0)[0] || '';
}
// A table row is a line starting "| `"; its first cell's code is the name.
function rows(text) {
  return text.split('\n').filter((l) => /^\| `/.test(l)).map((l) => {
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    return { name: (/^`([^`]+)`/.exec(cells[0]) || [])[1].replace(/\\/g, '/'), rest: cells.slice(1).join(' | ') };
  });
}

// ---- 1. ours -------------------------------------------------------------
const ours = filesUnder('game/ours').map((f) => f.slice('game/ours/'.length));
const oursRows = rows(section('`ours')).map((r) => r.name);
yes('the README has an "ours" table', oursRows.length > 0);
yes('it names every committed file under game/ours' + (diff(ours, oursRows).length ? ' (missing: ' + diff(ours, oursRows).join(', ') + ')' : ''),
  diff(ours, oursRows).length === 0);
yes('and nothing game/ours does not hold' + (diff(oursRows, ours).length ? ' (not there: ' + diff(oursRows, ours).join(', ') + ')' : ''),
  oursRows.length > 0 && diff(oursRows, ours).length === 0);

// ---- 2. menu -------------------------------------------------------------
const menu = filesUnder('game/menu').map((f) => f.slice('game/menu/'.length));
const menuRows = rows(section('`menu')).map((r) => r.name);
yes('the README\'s "menu" table names every file in game/menu, and nothing else', menuRows.length > 0 && same(menu, menuRows));

// ---- 3. the sources beside the gamemode ----------------------------------
const sources = fs.readdirSync(path.join(REPO, 'game')).filter((n) => /\.js$/.test(n) && n !== 'gamemode.js' && !isIgnored('game/' + n));
const builders = fs.readdirSync(path.join(REPO, 'scripts', 'dev')).filter((n) => /^Build-.*Gamemode\.js$/.test(n) && n !== 'Build-Gamemode.js');
const readsIt = {};
for (const b of builders) {
  const text = read('scripts/dev/' + b);
  for (const s of sources) {
    if (text.indexOf('game/' + s) >= 0 || text.indexOf("'" + s + "'") >= 0 || text.indexOf('game\\\\' + s) >= 0 || text.indexOf("'game', '" + s + "'") >= 0) {
      (readsIt[s] = readsIt[s] || []).push(b);
    }
  }
}
const srcRows = rows(section('sources'));
yes('the README has a "sources" table', srcRows.length > 0);
yes('it names every .js beside game/gamemode.js, and nothing else' +
  (diff(sources, srcRows.map((r) => r.name)).length ? ' (missing: ' + diff(sources, srcRows.map((r) => r.name)).join(', ') + ')' : ''),
  srcRows.length > 0 && same(sources, srcRows.map((r) => r.name)));
for (const s of sources) {
  const row = srcRows.filter((r) => r.name === s)[0];
  if (!row) { continue; }
  if (readsIt[s]) {
    yes('  ' + s + ' is carried in by ' + readsIt[s].join(', ') + ', and its row says so',
      readsIt[s].every((b) => row.rest.indexOf(b) >= 0));
  } else {
    yes('  ' + s + ' is read by no gamemode builder, and its row says it is not part of the gamemode',
      /not part of the gamemode/.test(row.rest));
  }
}

// ---- 4. the data tables ----------------------------------------------------
const chain = JSON.parse(read('scripts/mods/content-tables.json') || '{"steps":[]}');
const chainWrites = [].concat.apply([], chain.steps.map((s) => (s.writes || []).concat(s.writesOffChain || [])));
const data = filesUnder('game/data').map((f) => f.slice('game/data/'.length));
const dataRows = rows(section('`data'));
yes('the README has a "data" table', dataRows.length > 0);
yes('it names every committed table in game/data, and nothing else' +
  (diff(data, dataRows.map((r) => r.name)).length ? ' (missing: ' + diff(data, dataRows.map((r) => r.name)).join(', ') + ')' : ''),
  dataRows.length > 0 && same(data, dataRows.map((r) => r.name)));
const wrongHand = dataRows.filter((r) => /by hand/.test(r.rest) && chainWrites.indexOf('game/data/' + r.name) >= 0).map((r) => r.name);
yes('no table a content chain step writes is called hand-edited' + (wrongHand.length ? ' (' + wrongHand.join(', ') + ')' : ''), wrongHand.length === 0);
yes('every row says who writes it: by hand, or the script', dataRows.length > 0 && dataRows.every((r) => /by hand|\.py|\.js|\.ps1/.test(r.rest)));
const dataText = section('`data');
yes('the data section points at the one list of built tables, scripts/mods/content-tables.json, and at .gitignore',
  dataText.indexOf('content-tables.json') >= 0 && dataText.indexOf('.gitignore') >= 0);

// ---- 5. the content plugin ---------------------------------------------------
// By the scripts that build and lay it, not by its file name: a harness that
// names a file the content build writes is a content check to the gate's
// pick, and a content check does not run on a pull request whose inputs the
// newest content build is not of. This one reads no built file.
yes('the README says the content plugin is built on the box and laid by Get-ContentBuild.ps1, not kept here',
  /content plugin|plugin file/.test(readme) && readme.indexOf('Get-ContentBuild.ps1') >= 0 && readme.indexOf('Build-ContentOnBox.ps1') >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
