'use strict';

const assert = require('node:assert/strict');
const { previewWorld } = require('../scripts/ops/PropertyResetWorldPreview');
const integer = value => ({ $numberInt: String(value) });
const long = value => ({ $numberLong: String(value) });
const item = (baseId, count, extra = {}) => ({ baseId, count: integer(count), ...extra });
function kind(value) {
  if (typeof value === 'string') return 'string';
  if (value && value.$numberInt !== undefined) return 'int';
  if (value && value.$numberLong !== undefined) return 'long';
  if (value && value.$numberDouble !== undefined) return 'double';
  return 'unsupported';
}
function actor(entries, extra = {}) {
  const doc = { formDesc: 'a', recType: integer(1), inv: { entries }, equipmentDump: null, ...extra };
  const types = list => list.map(entry => ({ base: kind(entry.baseId), count: kind(entry.count) }));
  doc.__resetPreviewTypes = { recType: kind(doc.recType), count: kind(doc.count),
    inventory: types(entries), equipment: doc.equipmentDump ? types(doc.equipmentDump.inv.entries) : null };
  return doc;
}
let passed = 0;
let failed = 0;

function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

test('counts descriptor candidates across saved forms without returning names, identifiers or rows', () => {
  const input = [actor([
    item('15494:Thornswood-Content.esp', 2, { name: 'PRIVATE PERSON KEY' }),
    item('15495:Thornswood-Content.esp', 3),
    item('15496:Thornswood-Content.esp', 4),
    item('f:Skyrim.esm', 5)
  ]), actor([item('154e0:Thornswood-Content.esp', 1)], { formDesc: 'b', profileId: integer(-1), isDeleted: true })];
  const original = structuredClone(input);
  const result = previewWorld(input, { maxForms: 100 });
  assert.equal(result.counts.forms, 2);
  assert.equal(result.counts.inventoryStacks, 5);
  assert.equal(result.counts.candidateStacks, 3);
  assert.equal(result.counts.candidateUnits, 6);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.coverage, { world: true, propertyClaims: false, farmClaims: false,
    privateItems: false, protectedInstances: false, pendingTransfers: false });
  assert.deepEqual(input, original);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(Object.values(result.counts).every(Number.isSafeInteger));
});

test('canonical BSON numbers stay exact and legacy static numbers remain unresolved', () => {
  const result = previewWorld([actor([
    { baseId: long(536958100), count: long(2) },
    { baseId: long(4278190090), count: integer(1) },
    { baseId: '15493:Thornswood-Content.esp', count: { $numberDouble: '3.0' } }
  ])], { maxForms: 10 });
  assert.equal(result.counts.legacyNumericStacks, 1);
  assert.equal(result.counts.legacyNumericUnits, 2);
  assert.equal(result.counts.runtimeStacks, 1);
  assert.equal(result.counts.candidateUnits, 3);
});

test('dynamic drops count separately; deleted and static target references never imply removable stock', () => {
  const drop = actor([], { formDesc: 'b', recType: integer(0), baseDesc: '15493:Thornswood-Content.esp', count: integer(4) });
  const deleted = { ...drop, formDesc: 'c', isDeleted: true };
  const authored = { ...drop, formDesc: '123:Thornswood-Content.esp' };
  const result = previewWorld([drop, deleted, authored], { maxForms: 10 });
  assert.equal(result.counts.dropCandidateStacks, 1);
  assert.equal(result.counts.dropCandidateUnits, 4);
  assert.equal(result.counts.staticTargetDrops, 1);
});

test('worn and equipment-mirror candidates are counted as blockers without counting stock twice', () => {
  const entry = item('15494:Thornswood-Content.esp', 2, { worn: true });
  const result = previewWorld([actor([entry], { equipmentDump: { inv: { entries: [entry] } } })], { maxForms: 10 });
  assert.equal(result.counts.candidateUnits, 2);
  assert.equal(result.counts.wornCandidateStacks, 1);
  assert.equal(result.counts.equipmentCandidateStacks, 1);
});

test('malformed counts, noncanonical numeric inputs and duplicate forms never masquerade as complete clean coverage', () => {
  const result = previewWorld([actor([{ baseId: '15494:Thornswood-Content.esp', count: long('9223372036854775807') }]),
    actor([{ baseId: '15494:Thornswood-Content.esp', count: 2 }])], { maxForms: 10 });
  assert.equal(result.counts.malformedRecords, 2);
  assert.equal(result.counts.duplicateForms, 1);
  assert.equal(result.blocked, true);
  assert.throws(() => previewWorld([actor([]), actor([], { formDesc: 'b' })], { maxForms: 1 }),
    /World reset preview cannot be verified/);
});

test('server type proof refuses EJSON-shaped documents and missing inventory schemas', () => {
  const forged = actor([item('15494:Thornswood-Content.esp', 2)]);
  forged.__resetPreviewTypes.inventory[0].count = 'object';
  const missing = actor([], { formDesc: 'b' });
  delete missing.inv;
  const result = previewWorld([forged, missing], { maxForms: 10 });
  assert.equal(result.counts.malformedRecords, 2);
  assert.equal(result.counts.candidateUnits, 0);
  assert.equal(result.coverage.world, false);
});

test('late malformed entries discard all partial counts for the affected form', () => {
  const result = previewWorld([actor([
    item('15494:Thornswood-Content.esp', 2),
    { baseId: '15494:Thornswood-Content.esp', count: long('9223372036854775807') }
  ])], { maxForms: 10 });
  assert.equal(result.counts.forms, 1);
  assert.equal(result.counts.malformedRecords, 1);
  assert.equal(result.counts.inventoryStacks, 0);
  assert.equal(result.counts.candidateUnits, 0);
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
