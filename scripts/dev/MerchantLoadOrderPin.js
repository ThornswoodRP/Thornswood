'use strict';
// What the merchant source evidence is pinned to (#613).
//
// The retrieval, geode and harvest evidence was measured in the catalogue's
// load order (game/data/npc-population.json), and each document carries the
// sha256 of that order. It used to be the sha256 of the whole order, own
// plugins' bytes included, so every rebuild of Thornswood-Content.esp or
// Thornswood-Last.esp that reached the catalogue made all three documents
// invalid and the merchant build (Build-MerchantTables.js now) stopped, though none of the
// evidence was read from them: on 21 Oct the catalogue still named a Content
// plugin from before #2993, and re-costing smith recipes in Last.esp (#613)
// stopped the merchant build. Own plugins are held to their files where the
// evidence uses one (contentSha256 in MerchantRetrievalSources.js) and by
// their own harnesses, so the pin names them and leaves their bytes out.
// Build-MerchantRetrievalSources.py makes the same digest with own_plugins.py.
const crypto = require('node:crypto');
const { isOwn } = require('./OwnPlugins.js');

function pinnedLoadOrder(population) {
  return population.loadOrder.map((row) => ({ name: row.name, sha256: isOwn(row.name) ? '' : row.sha256 }));
}

function loadOrderSha256(population) {
  return crypto.createHash('sha256').update(JSON.stringify(pinnedLoadOrder(population))).digest('hex');
}

module.exports = { pinnedLoadOrder, loadOrderSha256 };
