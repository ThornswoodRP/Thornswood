'use strict';
/*
  Build-MarketStallsGamemode.js (#3160)

      node scripts/dev/Build-MarketStallsGamemode.js           write the bundle and the tables
      node scripts/dev/Build-MarketStallsGamemode.js --tables <folder>   the gamemode tables somewhere else
      node scripts/dev/Build-MarketStallsGamemode.js --check   fail when one is stale

  The server loads one file, and native hot reload copies only gamemode.js, so
  the stall book is carried inside it, the way Build-TradeCargoGamemode.js
  carries the trade ships' manifest:

    game\market-stalls.js              between the MARKET STALLS BUNDLE markers, as MARKET_STALLS_BOOK

  in the market stalls block. The stalls of game\data\market-stalls.json go
  into the gamemode's MARKET_STALL_TABLE table (game\gamemode-tables, #5191),
  which the gamemode reads where it runs, and the same stalls into the front plugin
  (game\plugins\thornswood-front.js, between its own MARKET STALL SPOTS
  markers) as STALL_SPOTS, which puts the lock key's line up at a stall:
  [id, world or cell id, its file, x, y, z, reach].

  The markers are never moved by this script: a file without exactly one
  pair of each is an error, not a place to guess.
*/
const fs = require('node:fs');
const path = require('node:path');
const TABLES = require('./GamemodeTables.js');
const root = path.join(__dirname, '../..');
const modePath = path.join(root, 'game/gamemode.js');
const frontPath = path.join(root, 'game/plugins/thornswood-front.js');
const tablePath = path.join(root, 'game/data/market-stalls.json');
const opts = TABLES.options(process.argv.slice(2), ['--tables'], ['--check']);
const tablesDir = opts['--tables'] || TABLES.DIR;

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

const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
const rows = table.stalls;
// The table is checked by the book itself before anything is written.
require(path.join(root, 'game/market-stalls.js')).checkTable(rows);

const book = fs.readFileSync(path.join(root, 'game/market-stalls.js'), 'utf8').replace(/\r\n/g, '\n');
const oldMode = fs.readFileSync(modePath, 'utf8').replace(/\r\n/g, '\n');
let mode = between(oldMode, 'MARKET STALLS BUNDLE',
  '// Built by scripts\\dev\\Build-MarketStallsGamemode.js out of game\\market-stalls.js. Do not hand edit.\n' +
  'const MARKET_STALLS_BOOK = (function () {\nconst module = { exports: {} };\n' +
  book.trimEnd() + '\nreturn module.exports;\n})();\n', 'gamemode.js');
const stallTable = JSON.stringify(rows.map(function (r) {
  return { id: r.id, hold: r.hold, place: r.place, world: r.world, pos: r.pos, reach: r.reach };
}));

const oldFront = fs.readFileSync(frontPath, 'utf8').replace(/\r\n/g, '\n');
const spots = rows.map(function (r) {
  const w = r.world.split(':');
  return '    [' + JSON.stringify(r.id) + ', 0x' + w[0].toLowerCase() + ', ' + JSON.stringify(w[1]) + ', ' +
    r.pos.join(', ') + ', ' + r.reach + ']';
});
const front = between(oldFront, 'MARKET STALL SPOTS',
  '  // Built by scripts\\dev\\Build-MarketStallsGamemode.js out of game\\data\\market-stalls.json. Do not hand edit.\n' +
  '  const STALL_SPOTS = [' + (spots.length ? '\n' + spots.join(',\n') + '\n  ' : '') + '];\n  ', 'thornswood-front.js');

if (opts['--check']) {
  if (mode !== oldMode || front !== oldFront || !TABLES.isCurrent('MARKET_STALL_TABLE', stallTable, tablesDir)) {
    throw new Error('The market stall bundle or a stall table is stale. Run scripts/dev/Build-MarketStallsGamemode.js.');
  }
  console.log('PASS the market stall bundle, the MARKET_STALL_TABLE table and the front plugin\'s STALL_SPOTS match game/market-stalls.js and game/data/market-stalls.json');
} else {
  fs.writeFileSync(modePath, mode);
  fs.writeFileSync(frontPath, front);
  TABLES.write('MARKET_STALL_TABLE', stallTable, tablesDir);
}
