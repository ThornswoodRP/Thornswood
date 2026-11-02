'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const source = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname, '../game/gamemode.js'), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf('// MERCHANT TRADING BUNDLE BEGIN');
const end = source.indexOf('// MERCHANT TRADING BUNDLE END');
assert.ok(start >= 0 && end > start, 'Native hot reload must receive the merchant module and catalogues inside gamemode.js');
assert.ok(end < source.lastIndexOf('// NPC SERVER STARTUP BEGIN'), 'Bundle must initialize before native startup uses it');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-merchant-'));
try {
  const deployed = path.join(temp, 'gamemode.js');
  fs.writeFileSync(deployed, source.slice(start, end) + '\nmodule.exports = MERCHANT_TRADING;');
  const service = require(deployed);
  assert.equal(service.GUILD_SITES.length, 10);
  const props = [];
  const trade = service.installMerchantTrading({
    mp: { getIdFromDesc() { return 20; }, makeProperty() {}, set(id, key, value) { props.push({ id, key, value }); } },
    catalog:{byRef:{}},g: {}, purses: { prepare() { return null; } }, log() {}
  });
  trade.push(10, { open: true });
  assert.equal(props[0].value.open, true);
  const broken = service.installMerchantTrading({
    mp: {getIdFromDesc(){return 20;},makeProperty(){},set(){throw Error('publication unavailable');}},
    catalog:{byRef:{}},g:{},purses:{prepare(){return null;}},log(){}
  });
  assert.throws(()=>broken.push(10,{open:true}),/publication unavailable/);
  assert.match(broken.command({actorId:10,profileId:7,parts:['/merchant','1']}).text,/unavailable/,
    'a failed publisher revokes the controller before it can accept more work');
  // Run the actual activation dispatch with a stubbed trade service.
  const activation = source.slice(source.indexOf('    const merchants =', source.indexOf('E ON A GUILD TRADER')), source.indexOf('    const milked =', source.indexOf('E ON A GUILD TRADER')));
  const pushed = [];
  const ctx = { globalThis: { __thornswoodMerchantTrade: { activate() { return { view: { open: true } }; }, push(id, view) { pushed.push({ id, view }); } } }, casterRefrId: 10, refrId: 20, notify() {}, say() {} };
  assert.equal(vm.runInNewContext('(function(){' + activation + '})()', ctx), false);
  assert.equal(pushed.length, 1, 'Activation must send its view to the owner');
  assert.equal(pushed[0].id, 10);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('PASS isolated native hot reload and merchant activation delivery');
