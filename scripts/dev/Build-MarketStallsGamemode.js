'use strict';
/*
  Build-MarketStallsGamemode.js (#3160)

      node scripts/dev/Build-MarketStallsGamemode.js           write the bundle
      node scripts/dev/Build-MarketStallsGamemode.js --check   fail when it is stale

  The server loads one file, and native hot reload copies only gamemode.js, so
  the stall book is carried inside it, the way Build-TradeCargoGamemode.js
  carries the trade ships' manifest:

    game\market-stalls.js              between the MARKET STALLS BUNDLE markers, as MARKET_STALLS_BOOK

  in the market stalls block. The stalls themselves are tables that
  Build-MarketStallTables.js writes, a step of the content chain; this is
  code, and not in the chain, so a content build never carries it (#6195).

  The markers are never moved by this script: a file without exactly one
  pair of each is an error, not a place to guess.
*/
const fs = require('node:fs');
const path = require('node:path');
const gamemodeSource = require('./gamemode-source.js');
const root = path.join(__dirname, '../..');
const modePath = path.join(root, 'game/gamemode');
const check = process.argv.slice(2).indexOf('--check') >= 0;

function between(text, marker, block, where) {
  const BEGIN = '// ' + marker + ' BEGIN';
  const END = '// ' + marker + ' END';
  const a = text.indexOf(BEGIN);
  const z = text.indexOf(END);
  if (a < 0 || z < a || text.indexOf(BEGIN, a + 1) >= 0 || text.indexOf(END, z + 1) >= 0) {
    throw new Error(where + ' needs exactly one pair of ' + marker + ' markers.');
  }
  return text.slice(0, a) + BEGIN + '\n' + block + END + text.slice(z + END.length);
}

const book = fs.readFileSync(path.join(root, 'game/market-stalls.js'), 'utf8').replace(/\r\n/g, '\n');
const oldMode = gamemodeSource.read(modePath).replace(/\r\n/g, '\n');
const mode = between(oldMode, 'MARKET STALLS BUNDLE',
  '// Built by scripts\\dev\\Build-MarketStallsGamemode.js out of game\\market-stalls.js. Do not hand edit.\n' +
  'const MARKET_STALLS_BOOK = (function () {\nconst module = { exports: {} };\n' +
  book.trimEnd() + '\nreturn module.exports;\n})();\n', 'gamemode.js');

if (check) {
  if (mode !== oldMode) throw new Error('The market stall bundle is stale. Run scripts/dev/Build-MarketStallsGamemode.js.');
  console.log('PASS the market stall bundle matches game/market-stalls.js');
} else {
  gamemodeSource.write(modePath, mode);
}
