const assert = require('node:assert/strict');
const { applySwaps } = require('../scripts/release/nexus-collection.js');
const names = ['Base.esm', 'First.esp', 'Tail.esp'];
function fixture() {
  return { mods: [], plugins: names.map(name => ({ name, enabled: true })), pluginRules: { plugins: [
    { name: 'first.esp', after: ['base.esm'] }, { name: 'tail.esp', after: ['first.esp'] },
  ], groups: [] } };
}
function add(name, after, facts = {}) {
  return { add: true, modId: 100, fileId: 101, version: '1', md5: '0'.repeat(32), fileSize: 1,
    logicalFilename: 'test.zip', name: 'Test', author: 'Test', category: 'Test', plugins: [{ name, after, ...facts }] };
}
let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function refuse(c, row, reason, context = []) {
  const before = JSON.stringify(c);
  assert.throws(() => applySwaps(c, [...context, row]), reason);
  assert.equal(JSON.stringify(c), before);
}
check('a middle rule does not pin an appended plugin', () => refuse(fixture(), add('New.esp', ['first.esp']), /tail.*Tail\.esp/i));
check('an ESL is a master even without the header bit', () => refuse(fixture(), add('New.esl', ['tail.esp'], { master: false }), /New\.esl.*master.*tail\.esp.*not/i));
check('the rule list cannot already name the added plugin', () => {
  const c = fixture();
  c.pluginRules.plugins.push({ name: 'NEW.ESP', after: ['tail.esp'] });
  refuse(c, add('New.esp', ['tail.esp']), /rule list already names New\.esp/i);
});
check('a valid tail addition keeps the old rules and appends one edge', () => {
  const c = fixture();
  const old = structuredClone(c.pluginRules.plugins);
  applySwaps(c, [add('New.esp', ['TAIL.ESP'])]);
  assert.deepEqual(c.plugins.map(p => p.name), [...names, 'New.esp']);
  assert.deepEqual(c.pluginRules.plugins, [...old, { name: 'new.esp', after: ['tail.esp'] }]);
});
check('a light-flagged ESP is not a master without the master bit', () => {
  const c = fixture();
  applySwaps(c, [add('New.esp', ['tail.esp'], { light: true, master: false })]);
  assert.equal(c.plugins.at(-1).name, 'New.esp');
});
check('a header-master ESP can anchor the master tail, before the regular suffix', () => {
  const c = fixture();
  applySwaps(c, [{ masterFlags: { 'First.esp': true, 'Tail.esp': false } }, add('New.esl', ['first.esp'])]);
  assert.deepEqual(c.plugins.map(p => p.name), ['Base.esm', 'First.esp', 'New.esl', 'Tail.esp']);
});
check('an add row cannot override a master flag recorded for the plugin', () => {
  refuse(fixture(), add('New.esp', ['tail.esp'], { master: false }), /New\.esp.*master flag.*record/i,
    [{ masterFlags: { 'NEW.ESP': true } }]);
  refuse(fixture(), add('New.esp', ['base.esm'], { master: true }), /New\.esp.*master flag.*record/i,
    [{ masterFlags: { 'NEW.ESP': false } }]);
});
process.exitCode = failed ? 1 : 0;
