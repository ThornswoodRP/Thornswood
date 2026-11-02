#!/usr/bin/env node
// scripts/dev/Build-TradingCompanyGamemode.js
//
// #512, #2695: the company terms block in game/gamemode.js carries the
// staff's terms (game/data/trading-company.json) and the pure module that
// reads them (game/trading-company.js), because the server loads the one
// file and cannot require anything beside it (docs/GAMEMODE-SOURCE.md, "What
// the server needs"). This writes both between the TRADING_COMPANY markers.
// Edit the terms or the module, then run:
//
//     node scripts/dev/Build-TradingCompanyGamemode.js
//
// With --check it writes nothing and exits 1 when the block is not what the
// two files make; tests/test-512-trading-company.js runs the same check.
'use strict';
const fs = require('fs');
const path = require('path');
const gamemodeSource = require('./gamemode-source.js');

const REPO = path.join(__dirname, '..', '..');
const GAMEMODE = path.join(REPO, 'game', 'gamemode');
const DATA = path.join(REPO, 'game', 'data', 'trading-company.json');
const MODULE = path.join(REPO, 'game', 'trading-company.js');
const START = '  // ==== TRADING_COMPANY ====';
const END = '  // ==== end TRADING_COMPANY ====';

const lf = (t) => String(t).replace(/^\uFEFF/, '').split('\r\n').join('\n');

function region(dataText, moduleText) {
  const data = JSON.parse(lf(dataText));
  return [
    START,
    '  /* Built by scripts\\dev\\Build-TradingCompanyGamemode.js out of game\\data\\trading-company.json',
    '     and game\\trading-company.js. Do not hand edit: change those two and run it again. */',
    '  var COMPANY_TERMS = ' + JSON.stringify(data) + ';',
    '  var LIB = (function () {',
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
  if (a < 0 || b < 0) { throw new Error('Build-TradingCompanyGamemode: the TRADING_COMPANY markers are not in gamemode.js'); }
  const out = gm.slice(0, a) + region(dataText, moduleText) + gm.slice(b + END.length);
  return out;
}

function read(p) { return fs.readFileSync(p, 'utf8'); }

if (require.main === module) {
  const now = gamemodeSource.read(GAMEMODE);
  const next = build(now, read(DATA), read(MODULE));
  if (process.argv.includes('--check')) {
    if (next !== now) {
      console.log('the company terms block is stale: run node scripts/dev/Build-TradingCompanyGamemode.js');
      process.exit(1);
    }
    console.log('the company terms block matches game/data/trading-company.json and game/trading-company.js');
    process.exit(0);
  }
  if (next === now) { console.log('the company terms block is already up to date'); process.exit(0); }
  gamemodeSource.write(GAMEMODE, next);
  console.log('wrote the company terms block into game/gamemode.js');
}

module.exports = { build: build, region: region, START: START, END: END };
