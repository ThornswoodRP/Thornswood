'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const begin = source.lastIndexOf('// NPC SERVER STARTUP BEGIN');
const end = source.indexOf('// NPC SERVER STARTUP END', begin);
assert.ok(begin >= 0 && end > begin);
const manifest = source.slice(source.indexOf('function npcMerchantManifest('), source.indexOf('function createNpcMerchantPurses('));
for (const channel of ['main', 'dev', undefined]) {
  let prepared = 0, population = 0, runtime = 0, quotes = 0, shutdowns = 0, commits = 0, starts = 0;
  const ledgerChannels = [], logs = [];
  const settings = { thornswoodServer: channel, loadOrder: ['Skyrim.esm'], privDir: `${channel || 'main'}-private` };
  const ctx = {
    require, setTimeout, clearTimeout, Date, serverRunId: () => "test-run", removeSpawned() {},
    // #3296: the startup names its NPC code from the file that is loading.
    __filename: path.join(__dirname, '../../game/gamemode.js'),
    // #2675: what the merchants are told is not the plain item (a hair dye).
    mintedEntry: () => false,
    log: text => logs.push(text),
    mp: { getServerSettings: () => settings, prepareNpcLoad: () => prepared++ },
    NPC_POPULATION_DATA: { plugins: ['Skyrim.esm'], keep: [['1:Skyrim.esm','a:Skyrim.esm',0,0,0,0,'trader']] },
    createPrivateMerchantLedger: (fs, path, cfg) => { ledgerChannels.push(cfg.privDir); return {}; },
    createNpcMerchantPurses: () => ({ shutdown() {} }),
    createNpcPopulation: (api,data,plugins,purses,options) => {
      population++;assert.equal(options.suspended,true);
      // #2623: the run a temporary spawn belongs to, and how a leftover one is removed.
      assert.equal(options.run,'test-run');assert.equal(typeof options.discard,'function');
      return {commit(){commits++;},stop(){}};
    },
    startSharedNpcServerRuntime: (api,timers,now,report,population,options) => {
      runtime++;assert.equal(options.suspended,true);return { stop() {},start:()=>true };
    },
    MERCHANT_TRADING: { prepareRoles: population => ({population,catalog:{byRef:{}},roleTables:{}}), installMerchantTrading: env => {
      quotes++;assert.equal(env.suspended,true);
      return {nativeReady:()=>true,start(){starts++;},shutdown() { shutdowns++; }};
    } }
  };
  vm.createContext(ctx);
  vm.runInContext(manifest, ctx);
  vm.runInContext(source.slice(begin, end), ctx);
  assert.equal(prepared, 1, `${channel || 'legacy Main'} prepares the winning records`);
  assert.equal(population, 1, `${channel || 'legacy Main'} starts the curated population`);
  assert.equal(runtime, 1, `${channel || 'legacy Main'} starts shared NPC authority`);
  assert.equal(quotes, 1, `${channel || 'legacy Main'} installs the quote panel`);
  assert.equal(commits,1,`${channel || 'legacy Main'} commits its staged population once`);
  assert.equal(starts,1,`${channel || 'legacy Main'} activates trading after construction`);
  assert.deepEqual(ledgerChannels, [settings.privDir], 'Each channel uses its own private ledger');
  assert.deepEqual(logs, []);
  ctx.NPC_POPULATION_DATA.plugins = ['Wrong.esm'];
  vm.runInContext(source.slice(begin, end), ctx);
  assert.equal(shutdowns, 1, 'A failed reload revokes the previous merchant service');
  assert.equal(ctx.__thornswoodMerchantTrade, null, 'A failed reload cannot retain the merchant writer');
  assert.equal(runtime, 1, 'A mismatched catalogue cannot start another runtime');
  assert.equal(commits,1,'A mismatched catalogue cannot commit more exclusions');
  assert.equal(starts,1,'A mismatched catalogue cannot reactivate trading');
  assert.equal(ctx.__thornswoodNpcRuntime, null, 'Failed startup revokes the active runtime');
  assert.ok(logs.some(line => line.includes('does not match')));
}
console.log('PASS Main and Dev startup, separate private storage and catalogue refusal');
