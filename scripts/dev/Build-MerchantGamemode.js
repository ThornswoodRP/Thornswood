'use strict';
// Native hot reload copies only gamemode.js into a temporary directory.
// Keep the standalone, tested module embedded in that file. Its catalogues are
// gamemode tables (game/gamemode-tables, #5191) that Build-MerchantTables.js
// writes, and the bundle reads them with table() where the gamemode runs, so
// a content change rewrites a table file and never the bundle (#6195).
const fs = require('node:fs');
const path = require('node:path');
const gamemodeSource = require('./gamemode-source.js');
const check = process.argv.slice(2).indexOf('--check') >= 0;
const root = path.join(__dirname, '../..');
const modePath = path.join(root, 'game/gamemode');
const old = gamemodeSource.read(modePath).replace(/\r\n/g, '\n');
const moduleSource = fs.readFileSync(path.join(root, 'game/merchant-trading.js'), 'utf8').replace(/\r\n/g, '\n');
const settlementSource = fs.readFileSync(path.join(root, 'game/merchant-settlement.js'), 'utf8').replace(/\r\n/g, '\n');
const commissionStateSource = fs.readFileSync(path.join(root, 'game/merchant-commission-state.js'), 'utf8').replace(/\r\n/g, '\n');
const commissionSource = fs.readFileSync(path.join(root, 'game/merchant-commissions.js'), 'utf8').replace(/\r\n/g, '\n');
const questSource = fs.readFileSync(path.join(root, 'game/quest-transactions.js'), 'utf8').replace(/\r\n/g, '\n');
const eligibilitySource = fs.readFileSync(path.join(root, 'game/quest-eligibility.js'), 'utf8').replace(/\r\n/g, '\n');
const killSource = fs.readFileSync(path.join(root, 'game/kill-contracts.js'), 'utf8').replace(/\r\n/g, '\n');
const roleSource = fs.readFileSync(path.join(root, 'game/merchant-role-stage.js'), 'utf8').replace(/\r\n/g, '\n');
const fishingSource = fs.readFileSync(path.join(root, 'game/quest-resource-sources.js'), 'utf8').replace(/\r\n/g, '\n');
const questItemSource=fs.readFileSync(path.join(root,'game/quest-items.js'),'utf8').replace(/\r\n/g,'\n');
const mammothSource=fs.readFileSync(path.join(root,'game/quest-mammoth-sources.js'),'utf8').replace(/\r\n/g,'\n');
const huntBundleSource=fs.readFileSync(path.join(root,'game/quest-hunt-bundles.js'),'utf8').replace(/\r\n/g,'\n');
const orchardSource=fs.readFileSync(path.join(root,'game/quest-orchard-plots.js'),'utf8').replace(/\r\n/g,'\n');
const nativeSource = fs.readFileSync(path.join(root, 'game/merchant-ledger-native.js'), 'utf8').replace(/\r\n/g, '\n');
const budgetSource = fs.readFileSync(path.join(root, 'game/scene-reward-budget.js'), 'utf8').replace(/\r\n/g, '\n');
const block = '// MERCHANT TRADING BUNDLE BEGIN\nconst MERCHANT_TRADING = (function () {\n' +
  'const module = { exports: {} };\nconst MERCHANT_GUILD_SITES = table(\'MERCHANT_GUILD_SITES\');\n' +
  'const MERCHANT_COMMISSION_STATE = (function () { const module = {exports:{}};\n' + commissionStateSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const MERCHANT_SETTLEMENT = (function () { const module = {exports:{}};\n' + settlementSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const MERCHANT_COMMISSIONS = (function () { const module = {exports:{}};\n' + commissionSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const QUEST_TRANSACTIONS = (function () { const module = {exports:{}};\n' + questSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const QUEST_ELIGIBILITY = (function () { const module = {exports:{}};\n' + eligibilitySource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const KILL_CONTRACTS = (function () { const module = {exports:{}};\n' + killSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const MERCHANT_ROLES = (function () { const module = {exports:{}};\n' + roleSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const MERCHANT_NATIVE = (function () { const module = {exports:{}};\n' + nativeSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const QUEST_FISHING_SOURCES = (function () { const module = {exports:{}};\n' + fishingSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const QUEST_ITEMS = (function () { const module = {exports:{}};\n' + questItemSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const QUEST_MAMMOTH_SOURCES = (function () { const module = {exports:{}};\n' + mammothSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const QUEST_HUNT_BUNDLES = (function () { const module = {exports:{}};\n' + huntBundleSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const ORCHARD_PLOTS = (function () { const module = {exports:{}};\n' + orchardSource.trimEnd() + '\nreturn module.exports;})();\n' +
  'const SCENE_BUDGET = (function () { const module = {exports:{}};\n' + budgetSource.trimEnd() + '\nreturn module.exports;})();\n' +
  moduleSource.trimEnd() + '\nconst install = module.exports.installMerchantTrading;\n' +
  'module.exports.installMerchantTrading = function (env) {\n' +
  '  return install(Object.assign({ catalog: table(\'MERCHANT_TRADERS\') }, env));\n};\n' +
  'module.exports.prepareRoles = function (population, mp) {\n' +
  '  const native=MERCHANT_NATIVE.createLedgerNativeValidators(mp);\n' +
  '  const prepared=MERCHANT_ROLES.prepareMerchantRoleStage(population, table(\'MERCHANT_TRADERS\'), table(\'MERCHANT_STAGE\'), native);\n' +
  '  prepared.commissions=MERCHANT_COMMISSIONS.prepareCommissions(table(\'MERCHANT_COMMISSION_ROWS\'),prepared.catalog,native);\n' +
  '  return prepared;\n};\n' +
  'module.exports.createQuestFishingSources = QUEST_FISHING_SOURCES.createQuestFishingSources;\n' +
  'module.exports.createQuestHarvestSources = QUEST_FISHING_SOURCES.createQuestHarvestSources;\n' +
  'module.exports.createQuestGeodeSources = QUEST_FISHING_SOURCES.createQuestGeodeSources;\n' +
  'module.exports.createQuestLongfinSources = QUEST_FISHING_SOURCES.createQuestLongfinSources;\n' +
  'module.exports.createQuestRetrievalSources = QUEST_FISHING_SOURCES.createQuestRetrievalSources;\n' +
  'module.exports.createQuestItemPolicy = QUEST_ITEMS.createQuestItemPolicy;\n' +
  'module.exports.createQuestMammothSources = QUEST_MAMMOTH_SOURCES.createQuestMammothSources;\n' +
  'module.exports.orchardPlots = ORCHARD_PLOTS;\n' +
  'module.exports.orchardSources = function () { return table(\'MERCHANT_ORCHARD\'); };\n' +
  'module.exports.createQuestOrchardSources = QUEST_FISHING_SOURCES.createQuestOrchardSources;\n' +
  'module.exports.huntBundles = QUEST_HUNT_BUNDLES;\n' +
  'module.exports.retrievalSources = function () { return table(\'MERCHANT_RETRIEVALS\'); };\n' +
  'module.exports.scarceLongfin = function () { return table(\'MERCHANT_SCARCE_LONGFIN\'); };\n' +
  'module.exports.scarceGeodes = function () { return table(\'MERCHANT_SCARCE_GEODES\'); };\n' +
  'module.exports.scarceHarvest = function () { return table(\'MERCHANT_SCARCE_HARVEST\'); };\n' +
  'module.exports.scarceFishing = function () { return table(\'MERCHANT_SCARCE_FISHING\'); };\n' +
  'module.exports.createKillContracts = KILL_CONTRACTS.createKillContracts;\n' +
  'module.exports.sceneBudget = SCENE_BUDGET;\n' +
  'module.exports.expandedScenes = function () { return table(\'MERCHANT_KILL_SCENES\'); };\n' +
  'module.exports.commissionRows = function () { return table(\'MERCHANT_COMMISSION_ROWS\'); };\n' +
  'module.exports.createQuestEligibility = QUEST_ELIGIBILITY.createQuestEligibility;\n' +
  'return module.exports;\n})();\n// MERCHANT TRADING BUNDLE END';
const existing = /\/\/ MERCHANT TRADING BUNDLE BEGIN[\s\S]*?\/\/ MERCHANT TRADING BUNDLE END/;
const startup = '// NPC SERVER STARTUP BEGIN';
const matched = existing.exec(old);
let next;
if (matched && matched.index < old.lastIndexOf(startup)) next = old.replace(existing, () => block);
else {
  const without = old.replace(existing, '').trimEnd() + '\n';
  const at = without.lastIndexOf(startup);
  if (at < 0) throw new Error('NPC startup marker is missing.');
  next = without.slice(0, at) + block + '\n\n' + without.slice(at);
}
if (check) {
  if (next !== old) throw new Error('Merchant gamemode bundle is stale. Run scripts/dev/Build-MerchantGamemode.js.');
  console.log('PASS merchant gamemode bundle matches its source');
} else {
  gamemodeSource.write(modePath, next);
}
