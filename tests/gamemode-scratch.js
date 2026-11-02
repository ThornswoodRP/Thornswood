'use strict';
// gamemode-scratch.js: a gamemode source of its own for a harness that runs a
// table builder in a scratch repository (#2181 option D).
//
// A builder writes the gamemode's parts in <repo>/game/gamemode and builds
// <repo>/game/gamemode.js from them (scripts/dev/gamemode-source.js). So a
// scratch repository gets the same: the gamemode text a harness wants, as the
// one part of a source folder, the build tools the builders call, and the
// built file, which is what the harness then reads back.
//
//   const scratch = require('./gamemode-scratch.js');
//   scratch.source(repo, text)   writes the source and builds game/gamemode.js;
//                                returns the built file's path
//   scratch.tools(repo)          only copies the build tools into scripts/dev
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const TOOLS = ['gamemode-source.js', 'Build-Gamemode.js', 'gamemode_source.py'];

function tools(repo) {
  const dev = path.join(repo, 'scripts', 'dev');
  fs.mkdirSync(dev, { recursive: true });
  for (const f of TOOLS) fs.copyFileSync(path.join(REPO, 'scripts', 'dev', f), path.join(dev, f));
}

function source(repo, text) {
  tools(repo);
  const dir = path.join(repo, 'game', 'gamemode');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gamemode.ts'), text.endsWith('\n') ? text : text + '\n');
  fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ parts: ['gamemode.ts'] }) + '\n');
  require(path.join(repo, 'scripts', 'dev', 'gamemode-source.js')).writeBuilt(dir);
  return path.join(repo, 'game', 'gamemode.js');
}

module.exports = { tools, source };
