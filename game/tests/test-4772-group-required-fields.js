'use strict';
// Actual current journal page and front bridge, not a validation mirror.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const makePage = require('../../tests/fixtures/panel-page');
const root = path.join(__dirname, '../..');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
function rig(found) {
  const p = makePage();
  p.run('bridge', fs.readFileSync(path.join(root, 'game/ui/thornswood-bridge.js'), 'utf8'));
  p.run('journal', fs.readFileSync(process.env.JOURNAL_UI || path.join(root, 'game/ui/thornswood-journal.js'), 'utf8'));
  p.state = { journals: [], group: { show: true, canBusiness: true, canFaction: true,
    permNames: ['Read', 'Invite'], books: [{ id: 'g', name: 'Moon Court', kind: 'business',
      owner: true, staff: true, invite: true, read: true, speak: true, canRoles: true, canPrices: true,
      people: [{ name: 'Brenna', role: 'Member' }], roles: [{ name: 'Member', perms: ['Invite'] }],
      priceList: [], chat: [] }] } };
  p.api = p.win.thornswoodJournal; p.api.setData(p.state); p.api.open();
  p.prepare = () => { for (const field of p.doc.querySelectorAll('input')) if (!field.setCustomValidity) {
    field.validationMessage = ''; field.validity = { customError: false }; field.reports = 0;
    field.setCustomValidity = text => { field.validationMessage = String(text); field.validity.customError = !!text; };
    field.reportValidity = () => { field.reports++; return !field.validity.customError; };
  } }; p.prepare();
  p.press = button => { assert(button, 'current button is mounted'); button.focus();
    const event = p.fire(button, 'click', ''); if (!event.defaultPrevented && button.onclick) button.onclick.call(button, event); p.prepare(); };
  if (!found) p.press(p.doc.querySelector('[data-group="g"]'));
  p.field = id => p.doc.getElementById('ts-journal-' + id);
  return p;
}
const cases = [
  ['Found business', 'gname', '[data-found="business"]', 'name'],
  ['Found faction', 'gname', '[data-found="faction"]', 'name'],
  ['Say', 'gline', '[data-g="say"]', 'message'],
  ['Invite', 'ginvite', '[data-g="invite"]', 'invite'],
  ['Rename group', 'grename', '[data-g="rename"]', 'name'],
  ['Set price', 'price-name', '[data-g="price"]', 'item'],
  ['New role', 'grole', '[data-g="rolenew"]', 'role'],
  ['Rename current role', 'grold', '[data-g="rolerename"]', 'role'],
  ['Rename replacement role', 'grnew', '[data-g="rolerename"]', 'name'],
  ['Set role person', 'gwho', '[data-g="setrole"]', 'person'],
  ['Set role name', 'gset', '[data-g="setrole"]', 'role'],
  ['Remove member', 'gwho', '[data-g="remove"]', 'person'],
  ['Hand on', 'ghand', '[data-g="give"]', 'owner']
];
for (const [name, fieldId, selector, reason] of cases) for (const blank of ['', '   ']) {
  const p = rig(selector.includes('data-found'));
  // Complete the other input in two-required-field forms.
  for (const id of ['grold', 'grnew', 'gwho', 'gset']) if (p.field(id)) p.field(id).value = 'Member';
  const field = p.field(fieldId); assert(field, name + ' field is mounted'); field.value = blank;
  const before = JSON.stringify(p.state), sent = p.sent.length;
  p.press(p.doc.querySelector(selector));
  test(name + ' empty=' + JSON.stringify(blank) + ' sends nothing and preserves every input and authoritative view', () => {
    assert.equal(p.sent.length, sent); assert.equal(field.value, blank); assert.equal(JSON.stringify(p.state), before);
  });
  test(name + ' empty=' + JSON.stringify(blank) + ' names the missing field, associates a visible reason and focuses it', () => {
    assert.equal(p.doc.activeElement, field, 'focus goes to the missing field');
    assert.equal(field.getAttribute('aria-invalid'), 'true');
    assert(field.validity.customError && field.reports > 0, 'native validity reports the missing input');
    const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const messages = ids.map(id => p.doc.getElementById(id)).filter(Boolean);
    assert(messages.some(node => !node.hidden && new RegExp(reason, 'i').test(node.textContent)), 'a visible associated reason names the missing input');
  });
}
for (const [verb, first, second, expected] of [
  ['rolerename', 'grold', 'grnew', '/book role g rename | Member | Steward'],
  ['setrole', 'gwho', 'gset', '/book member g role | Member | Steward']
]) test(verb + ' progresses through the two missing fields then sends its original exact wire once', () => {
  const p = rig(), button = p.doc.querySelector('[data-g="' + verb + '"]');
  p.press(button); assert.equal(p.doc.activeElement, p.field(first)); assert.equal(p.sent.length, 0);
  p.field(first).value = 'Member'; p.fire(p.field(first), 'input', '');
  p.press(button); assert.equal(p.doc.activeElement, p.field(second)); assert.equal(p.sent.length, 0);
  p.field(second).value = 'Steward'; p.fire(p.field(second), 'input', '');
  p.press(button); assert.equal(p.sent.at(-1), expected); assert.equal(p.sent.length, 1);
});
test('correction restores prior validity and existing description exactly without erasing the input', () => {
  const p = rig(), field = p.field('gline'), button = p.doc.querySelector('[data-g="say"]');
  field.setAttribute('aria-describedby', 'first-hint  second-hint'); field.setAttribute('aria-invalid', 'false');
  field.setCustomValidity('An earlier custom error'); p.press(button);
  assert(field.getAttribute('aria-describedby').includes('first-hint  second-hint'));
  field.value = 'Our message'; p.fire(field, 'input', '');
  assert.equal(field.getAttribute('aria-describedby'), 'first-hint  second-hint'); assert.equal(field.getAttribute('aria-invalid'), 'false');
  assert.equal(field.validationMessage, 'An earlier custom error'); assert.equal(field.value, 'Our message');
  assert.equal(p.doc.getElementById('ts-journal-field-reason').textContent, '');
});
test('cleanup removes only its own description token and preserves newer external validation', () => {
  const p = rig(), field = p.field('gline'); field.setAttribute('aria-describedby', 'existing-hint');
  p.press(p.doc.querySelector('[data-g="say"]'));
  field.setAttribute('aria-describedby', field.getAttribute('aria-describedby') + ' newer-hint');
  field.setAttribute('aria-invalid', 'grammar'); field.setCustomValidity('A newer external error');
  field.value = 'Our message'; p.fire(field, 'input', '');
  assert.equal(field.getAttribute('aria-describedby'), 'existing-hint newer-hint');
  assert.equal(field.getAttribute('aria-invalid'), 'grammar'); assert.equal(field.validationMessage, 'A newer external error');
});
test('a newer external custom error retains the ordinary true invalid marker', () => {
  const p = rig(), field = p.field('gline'); p.press(p.doc.querySelector('[data-g="say"]'));
  field.setCustomValidity('A newer validation error'); field.setAttribute('aria-invalid', 'true');
  field.value = 'Our message'; p.fire(field, 'input', '');
  assert.equal(field.validationMessage, 'A newer validation error'); assert.equal(field.getAttribute('aria-invalid'), 'true');
});
test('externally cleared native validity is not replaced with an earlier custom error', () => {
  const p = rig(), field = p.field('gline'); field.setCustomValidity('An earlier error');
  p.press(p.doc.querySelector('[data-g="say"]')); field.setCustomValidity(''); field.setAttribute('aria-invalid', 'false');
  field.value = 'Our message'; p.fire(field, 'input', '');
  assert.equal(field.validationMessage, ''); assert.equal(field.getAttribute('aria-invalid'), 'false');
});
test('cleared native validity retires only the helper invalid marker when no replacement error survives', () => {
  const p = rig(), field = p.field('gline'); p.press(p.doc.querySelector('[data-g="say"]'));
  field.setCustomValidity(''); field.value = 'Our message'; p.fire(field, 'input', '');
  assert.equal(field.validationMessage, ''); assert.equal(field.getAttribute('aria-invalid'), null);
});
test('a preexisting description token is not removed by this helper', () => {
  const p = rig(), field = p.field('gline'); field.setAttribute('aria-describedby', 'existing-hint ts-journal-field-reason');
  p.press(p.doc.querySelector('[data-g="say"]')); field.value = 'Our message'; p.fire(field, 'input', '');
  assert.equal(field.getAttribute('aria-describedby'), 'existing-hint ts-journal-field-reason');
});
test('editing a different input does not steal the active field reason', () => {
  const p = rig(), field = p.field('gline'); p.press(p.doc.querySelector('[data-g="say"]'));
  p.field('ginvite').value = 'Brenna'; p.fire(p.field('ginvite'), 'input', '');
  assert.equal(field.getAttribute('aria-invalid'), 'true'); assert(field.validationMessage);
});
// The field and its button are kept through an update (#4475): the update
// retires the old reason, and a press after it checks the field as it is now.
test('an update retires the reason, and a later press checks the field again', () => {
  const p = rig(), field = p.field('gline'), button = p.doc.querySelector('[data-g="say"]');
  p.press(button); button.focus(); p.api.setData(p.state); p.prepare();
  assert.equal(field.validationMessage, ''); assert.equal(field.getAttribute('aria-invalid'), null);
  assert.equal(p.field('gline'), field); assert.equal(p.doc.querySelector('[data-g="say"]'), button);
  button.onclick.call(button); assert.equal(p.sent.length, 0);
  assert.equal(p.doc.getElementById('ts-journal-field-reason').textContent, 'Write a message first.');
  assert.equal(field.getAttribute('aria-invalid'), 'true');
});
test('close and reopen retire validation without inheriting its prior field reference', () => {
  const p = rig(), field = p.field('gline'), button = p.doc.querySelector('[data-g="say"]'); p.press(button);
  p.api.close(); assert.equal(field.validationMessage, ''); button.onclick.call(button); assert.equal(p.sent.length, 0);
  p.api.open(); p.prepare(); assert.equal(p.doc.getElementById('ts-journal-field-reason').textContent, '');
  assert.equal(p.field('gline').getAttribute('aria-invalid'), null);
});
for (const mode of ['sent', 'queued', 'refused', 'queue-then-throw']) test(mode + ' preserves raw fields, authoritative data and exact original command without retry', () => {
  const p = rig(), field = p.field('gline'), button = p.doc.querySelector('[data-g="say"]');
  const lines = [], queuedLines = [], before = JSON.stringify(p.state); field.value = '  Our message  ';
  p.win.thornswoodNet.state = () => ({queued:queuedLines.length});
  p.win.thornswoodNet.say = line => { lines.push(line); if (mode === 'queued' || mode === 'queue-then-throw') queuedLines.push(line);
    if (mode === 'queue-then-throw') throw Error('after queue fixture'); return mode === 'sent'; };
  p.press(button); assert.deepEqual(lines, ['/book say g Our message']); assert.equal(field.value, '  Our message  ');
  assert.equal(queuedLines.length, mode === 'queued' || mode === 'queue-then-throw' ? 1 : 0);
  assert.equal(JSON.stringify(p.state), before); assert.equal(p.doc.getElementById('ts-journal-field-reason').textContent, '');
});
test('optional price columns and a role with no permissions retain their original valid wires', () => {
  const p = rig(); p.field('price-name').value = 'Iron'; p.press(p.doc.querySelector('[data-g="price"]'));
  assert.equal(p.sent.at(-1), '/book price g | Iron | - | -');
  p.press(p.doc.querySelectorAll('[data-g="perm"]').find(button => button.getAttribute('data-perm') === 'Invite'));
  assert.equal(p.sent.at(-1), '/book role g perm | Member | ');
});
test('server permission flags still hide unavailable group actions', () => {
  const p = rig(); for (const flag of ['read', 'speak', 'invite', 'canRoles', 'canPrices', 'owner', 'staff']) p.state.group.books[0][flag] = false;
  p.state.group.canBusiness = false; p.state.group.canFaction = false; p.api.setData(p.state);
  assert.equal(p.doc.querySelectorAll('[data-g]').length, 0); assert.equal(p.doc.querySelectorAll('[data-found]').length, 0);
});
test('a sidebar required-field refusal stays separate from the unsaved private page message', () => {
  const p = rig(true); p.state.journals = [{id:'j',title:'Private',pages:[{id:'p',title:'Saved',text:'Original'}]}]; p.api.setData(p.state);
  p.press(p.doc.querySelector('[data-book="j"]')); p.press(p.doc.querySelector('[data-page="p"]'));
  const field = p.field('text'); field.value = 'Unsaved private writing'; field.oninput();
  const foot = p.doc.getElementById('ts-journal-foot'), before = foot.textContent; assert(before.includes('Unsaved'));
  p.press(p.doc.querySelector('[data-found="business"]')); assert.equal(foot.textContent, before); assert.equal(field.value, 'Unsaved private writing');
  assert(p.doc.getElementById('ts-journal-field-reason').textContent.includes('name'));
});
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
