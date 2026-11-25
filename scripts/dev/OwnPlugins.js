// OwnPlugins.js
//
// Where a builder reads a plugin of the load order from (#2923).
//
// Thornswood's own plugins (Thornswood-Content.esp and any other file in
// game/content) are made and shipped from this repository's game/content.
// Thornswood-Last.esp is ours too, but since #2791 no repository holds it: it
// copies other authors' records, so it is made in the Data folder from its
// recipe, game/data/last-plugin.recipe (Make-LastPlugin.py), and read from
// there (MADE_IN_DATA). isOwn still names it, so MerchantLoadOrderPin.js
// leaves its bytes out of the pin (#613). A game folder holds
// whichever release last reached it: on 20 Oct One's held a Content plugin
// from 12 Oct, 146,941 bytes against the repository's 117,274 the day before
// #2911 changed it. A table read from there describes a plugin nobody ships,
// and a content change could only be built by making a Data folder of links
// to the repository's copy.
//
// So every plugin whose name is a file in game/content is read from there,
// and every other plugin from the game's Data folder. The same rule is
// OwnPlugins.ps1 for the PowerShell builders and own_plugins.py for the
// Python ones; tests/test-2923-own-plugins.js holds the three to it.
//
// Which plugins are in the load order is read here too (#2976). The game
// loads Skyrim's five masters, then every line of plugins.txt that starts
// with '*'. A line without one is a plugin Vortex or the launcher knows about
// and has switched off: the game does not load it, and its file may be gone.
// Eight builders parsed plugins.txt on their own and four of those took the
// switched off lines as loaded, so on 20 Oct Build-DoorTable.py stopped on
// ElysiumEstateSSE.esp, a switched off line whose file the launcher had
// removed on 1 Oct. Every builder takes its load order from loadOrder.
//
//   const { pluginPath, loadOrder } = require('./OwnPlugins.js');
//   const order = loadOrder(PLUGINS_TXT);
//   const file = pluginPath(DATA, 'Thornswood-Content.esp');
'use strict';
const fs = require('fs');
const path = require('path');

const OWN_DIR = path.join(__dirname, '..', '..', 'game', 'content');

// Ours, and made in the Data folder from a recipe rather than held here (#2791).
const MADE_IN_DATA = ['Thornswood-Last.esp'];

function inRepo(name) {
  return fs.existsSync(path.join(OWN_DIR, name));
}

function isOwn(name) {
  return inRepo(name) || MADE_IN_DATA.some((m) => m.toLowerCase() === String(name).toLowerCase());
}

function pluginPath(dataDir, name) {
  return inRepo(name) ? path.join(OWN_DIR, name) : path.join(dataDir, name);
}

// The five masters load before the game reads plugins.txt, and are never
// written to it.
const MASTERS = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];

// plugins.txt as the game reads it: on is the load order (the masters, then
// each '*' line, once, names matched without case the way Windows matches
// files), off is each line the game skips because it has no '*'.
function readPluginsTxt(file) {
  const on = MASTERS.slice();
  const off = [];
  const seen = new Set(on.map((n) => n.toLowerCase()));
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] === '#') { continue; }
    if (t[0] !== '*') { off.push(t); continue; }
    const name = t.slice(1).trim();
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); on.push(name); }
  }
  const skipped = [];
  for (const n of off) {
    if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); skipped.push(n); }
  }
  return { on: on, off: skipped };
}

function loadOrder(file) { return readPluginsTxt(file).on; }
function switchedOff(file) { return readPluginsTxt(file).off; }

// The load order of a builder that reads every plugin in it. A table built
// without one of them describes a load order nobody runs, so a plugin in it
// that is not on disk stops the build, as it stops Build-DoorTable.py: it
// answers null then, with process.exitCode 1, and the builder returns
// rather than calling node's exit function, which can hang on Node 24 (#6036).
function loadedOrder(file, dataDir) {
  if (!fs.existsSync(file)) { console.error('STOP. there is no plugins.txt at ' + file); process.exitCode = 1; return null; }
  const order = loadOrder(file);
  const gone = order.filter((n) => !fs.existsSync(pluginPath(dataDir, n)));
  if (gone.length) {
    console.error('STOP. ' + gone.length + ' plugin(s) are not in ' + dataDir + ': ' + gone.slice(0, 6).join(', '));
    process.exitCode = 1;
    return null;
  }
  return order;
}

// What a table says it was read from: how many plugins and the first twelve
// hex of the sha256 of their names in order, one per line. Never the plugin
// list's path, which names one machine (#3105).
function loadOrderName(order) {
  const hex = require('crypto').createHash('sha256').update(order.join('\n'), 'utf8').digest('hex').slice(0, 12);
  return order.length + ' plugins in load order (names sha256 ' + hex + ')';
}

module.exports = { OWN_DIR, MASTERS, MADE_IN_DATA, inRepo, isOwn, pluginPath, loadOrder, switchedOff, loadedOrder, loadOrderName };
