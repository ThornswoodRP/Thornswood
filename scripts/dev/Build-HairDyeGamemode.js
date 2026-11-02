#!/usr/bin/env node
// scripts/dev/Build-HairDyeGamemode.js
//
// #2675: the hair dye block in game/gamemode.js carries the staff's list
// (game/data/hair-dyes.json) and the pure module that reads it
// (game/hair-dye.js), because the server loads the one file from a temporary
// copy and cannot require anything beside it (docs/GAMEMODE-SOURCE.md, "What
// the server needs"). This writes both between the HAIR_DYES markers. Edit
// the list or the module, then run:
//
//     node scripts/dev/Build-HairDyeGamemode.js
//
// With --check it writes nothing and exits 1 when the block is not what the
// two files make; tests/test-2675-hair-dye-wiring.js runs that check.
'use strict';
const fs = require('fs');
const path = require('path');
const gamemodeSource = require('./gamemode-source.js');

const REPO = path.join(__dirname, '..', '..');
const GAMEMODE = path.join(REPO, 'game', 'gamemode');
const DATA = path.join(REPO, 'game', 'data', 'hair-dyes.json');
const MODULE = path.join(REPO, 'game', 'hair-dye.js');
const START = '  // ==== HAIR_DYES ====';
const END = '  // ==== end HAIR_DYES ====';

const lf = (t) => t.split('\r\n').join('\n');

function region(dataText, moduleText) {
  const data = JSON.parse(lf(dataText));
  return [
    START,
    '  /* Built by scripts\\dev\\Build-HairDyeGamemode.js out of game\\data\\hair-dyes.json and',
    '     game\\hair-dye.js. Do not hand edit: change those two and run it again. */',
    '  var HAIR_DYES = ' + JSON.stringify(data) + ';',
    '  var HAIR_DYE = (function () {',
    '  var module = { exports: {} };',
    lf(moduleText).trimEnd(),
    '  return module.exports;',
    '  })();',
    END
  ].join('\n');
}

function build(gamemodeText, dataText, moduleText) {
  const gm = lf(gamemodeText);
  const a = gm.indexOf(START + '\n');
  const b = a < 0 ? -1 : gm.indexOf(END, a);
  if (a < 0 || b < 0) { throw new Error('Build-HairDyeGamemode: the HAIR_DYES markers are not in gamemode.js'); }
  return gm.slice(0, a) + region(dataText, moduleText) + gm.slice(b + END.length);
}

function read(p) { return fs.readFileSync(p, 'utf8'); }

if (require.main === module) {
  const now = gamemodeSource.read(GAMEMODE);
  const next = build(now, read(DATA), read(MODULE));
  if (process.argv.includes('--check')) {
    if (next !== lf(now)) {
      console.log('the hair dye block is stale: run node scripts/dev/Build-HairDyeGamemode.js');
      process.exit(1);
    }
    console.log('the hair dye block matches game/data/hair-dyes.json and game/hair-dye.js');
  } else {
    gamemodeSource.write(GAMEMODE, next);
    console.log('wrote the hair dye block into game/gamemode.js');
  }
}

module.exports = { build, region, START, END };
