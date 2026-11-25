'use strict';
/*
  Build-MarketStallTables.js (#3160, #6195)

      node scripts/dev/Build-MarketStallTables.js           write the tables
      node scripts/dev/Build-MarketStallTables.js --tables <folder>   the gamemode table somewhere else
      node scripts/dev/Build-MarketStallTables.js --check   fail when one is stale

  The stalls of game\data\market-stalls.json go into the gamemode's
  MARKET_STALL_TABLE table (game\gamemode-tables, #5191), which the gamemode
  reads where it runs, and the same stalls into the front plugin's client
  table STALL_SPOTS (game\plugins\thornswood-table-stall-spots.js,
  ClientTables.js), which puts the lock key's line up at a stall:
  [id, world or cell id, its file, x, y, z, reach].

  It is a step of the content chain (scripts/mods/content-tables.json). The
  stall book's code goes into the gamemode by Build-MarketStallsGamemode.js,
  which is not in the chain, so a content build never carries gamemode code.
*/
const fs = require('node:fs');
const path = require('node:path');
const TABLES = require('./GamemodeTables.js');
const CLIENT = require('./ClientTables.js');
const root = path.join(__dirname, '../..');
const tablePath = path.join(root, 'game/data/market-stalls.json');
const opts = TABLES.options(process.argv.slice(2), ['--tables'], ['--check']);
if (!opts) return;
const tablesDir = opts['--tables'] || TABLES.DIR;

const rows = JSON.parse(fs.readFileSync(tablePath, 'utf8')).stalls;
// The table is checked by the book itself before anything is written.
require(path.join(root, 'game/market-stalls.js')).checkTable(rows);

const stallTable = JSON.stringify(rows.map(function (r) {
  return { id: r.id, hold: r.hold, place: r.place, world: r.world, pos: r.pos, reach: r.reach };
}));
// [id, world or cell id, its file, x, y, z, reach]
const spots = rows.map(function (r) {
  const w = r.world.split(':');
  return [r.id, parseInt(w[0], 16), w[1]].concat(r.pos, [r.reach]);
});
const BY = 'scripts/dev/Build-MarketStallTables.js';

if (opts['--check']) {
  if (!CLIENT.isCurrent('STALL_SPOTS', spots, BY) || !TABLES.isCurrent('MARKET_STALL_TABLE', stallTable, tablesDir)) {
    throw new Error('A market stall table is stale. Run scripts/dev/Build-MarketStallTables.js.');
  }
  console.log('PASS the MARKET_STALL_TABLE table and the front plugin\'s STALL_SPOTS match game/data/market-stalls.json');
} else {
  CLIENT.write('STALL_SPOTS', spots, BY);
  TABLES.write('MARKET_STALL_TABLE', stallTable, tablesDir);
}
