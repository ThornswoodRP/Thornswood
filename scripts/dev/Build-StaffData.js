#!/usr/bin/env node
'use strict';
/*
  Build-StaffData.js (#2873)

      node scripts/dev/Build-StaffData.js           write the STAFF_DATA line
      node scripts/dev/Build-StaffData.js --check   fail when it is stale

  The server runs gamemode.js from a copy in its own temp folder
  (requireTemp, the header of game/gamemode.js), and the gamemode artifact is
  that one file. So game/data/<file>.json beside the repository's gamemode is
  never beside the server's copy, and a reader that opens
  path.join(__dirname, 'data', ...) on the server finds nothing. Measured on
  dev, 19 Oct: "game/data/thalmor-patrols.json would not read ... ENOENT
  ... Temp\skymp5-serveramfj1k\data\thalmor-patrols.json", and the same for
  property-word.json and furniture.json.

  This carries those staff files inside gamemode.js as one line,

      const STAFF_DATA = {"furniture.json": {...}, ...};

  the way Build-RaceTable.js carries RACES. Each reader takes its file out of
  STAFF_DATA when the line is there, and opens game/data only when it is not
  (a harness that runs one block of the gamemode on its own). The files in
  game/data stay the place staff change them: edit the file, run this, commit
  both, and deploy the gamemode.

  The line must already be in gamemode.js exactly once. It is replaced in
  place, never added or moved: a gamemode without it is an error, not a place
  to guess.
*/
const fs = require('node:fs');
const path = require('node:path');
const gamemodeSource = require('./gamemode-source.js');

const ROOT = path.join(__dirname, '..', '..');
const GAMEMODE = path.join(ROOT, 'game', 'gamemode');
// Every game/data file a gamemode reader opens at run time with no copy of
// its own inside gamemode.js. guild-sites.json is not here: Build-MerchantGamemode.js
// carries it. merchant-traders.json is (#5137): that bundle carries the traders
// only inside MERCHANT_TRADING, for its own install, and first steps reads them
// at load to find the start town's Cook, so on a server it found nothing.
const FILES = ['furniture.json', 'merchant-traders.json', 'property-word.json', 'thalmor-patrols.json'];
const LINE = /^const STAFF_DATA = .*;$/m;

function read(name) {
  const text = fs.readFileSync(path.join(ROOT, 'game', 'data', name), 'utf8').replace(/^﻿/, '');
  return JSON.parse(text);
}

function line() {
  const all = {};
  for (const name of FILES) all[name] = read(name);
  return 'const STAFF_DATA = ' + JSON.stringify(all) + ';';
}

function build(gamemodeText) {
  const found = gamemodeText.match(new RegExp(LINE.source, 'gm')) || [];
  if (found.length !== 1) {
    throw new Error('gamemode.js needs exactly one "const STAFF_DATA = ...;" line, found ' + found.length);
  }
  return gamemodeText.replace(LINE, line());
}

if (require.main === module) {
  const now = gamemodeSource.read(GAMEMODE);
  const next = build(now);
  if (process.argv.includes('--check')) {
    if (next !== now) {
      console.log('STAFF_DATA in game/gamemode.js is stale: run node scripts/dev/Build-StaffData.js');
      process.exit(1);
    }
    console.log('PASS STAFF_DATA matches game/data/' + FILES.join(', game/data/'));
    process.exit(0);
  }
  if (next === now) { console.log('STAFF_DATA is already up to date'); process.exit(0); }
  gamemodeSource.write(GAMEMODE, next);
  console.log('wrote STAFF_DATA into game/gamemode.js');
}

module.exports = { build, line, FILES };
