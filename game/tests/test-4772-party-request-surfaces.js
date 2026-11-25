'use strict';
// Whole current P page and front bridge. This tests local control ownership,
// never changes the server's existing unbound /yes and /no protocol.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const makePage = require('../../tests/fixtures/panel-page');
const root = path.join(__dirname, '../..');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
function rig(kind = 'party') {
  const p = makePage();
  p.run('bridge', fs.readFileSync(path.join(root, 'game/ui/thornswood-bridge.js'), 'utf8'));
  p.run('party', fs.readFileSync(process.env.PARTY_UI || path.join(root, 'game/ui/thornswood-party.js'), 'utf8'));
  p.api = p.win.thornswoodParty;
  p.state = { me: 1000, party: [], friends: [], near: [], muted: [], offer: {kind,from:1001,name:'Brenna <Ox> & Co',about:'The <Bee> & Court'} };
  p.feed = () => p.api.setData(JSON.parse(JSON.stringify(p.state)));
  p.feed();
  p.panel = p.doc.getElementById('ts-party'); p.content = p.doc.getElementById('ts-party-body'); p.ask = p.doc.getElementById('ts-ask');
  p.answers = container => container.querySelectorAll('[data-do="yes"],[data-do="no"]');
  p.press = button => { assert(button, 'current answer button exists'); button.focus(); const event = p.fire(button, 'click', '');
    if (!event.defaultPrevented && button.onclick) button.onclick.call(button, event); };
  p.retain = button => { const handler = button.onclick; return () => handler.call(button, {target:button,currentTarget:button}); };
  return p;
}
for (const kind of ['friend', 'party', 'trade', 'apprentice', 'dye', 'book']) {
  const p = rig(kind), floating = p.retain(p.answers(p.ask)[0]);
  test(kind + ' closed page has one floating answer pair', () => {
    assert.equal(p.answers(p.doc).length, 2); assert.equal(p.answers(p.ask).length, 2);
  });
  p.api.open();
  test(kind + ' open page has exactly one inline pair and no floating controls', () => {
    assert.equal(p.answers(p.doc).length, 2); assert.equal(p.answers(p.panel).length, 2); assert.equal(p.answers(p.ask).length, 0);
  });
  test(kind + ' opening retires a retained floating handler', () => {
    const before = p.sent.length; floating(); assert.equal(p.sent.length, before);
  });
  const inline = p.retain(p.answers(p.panel)[0]); p.api.close();
  test(kind + ' closing removes the inline answers and restores one floating pair', () => {
    assert.equal(p.answers(p.doc).length, 2); assert.equal(p.answers(p.panel).length, 0); assert.equal(p.answers(p.ask).length, 2);
  });
  test(kind + ' closing retires a retained inline handler', () => {
    const before = p.sent.length; inline(); assert.equal(p.sent.length, before);
  });
  test(kind + ' current controls preserve exact Accept and Refuse wires in both modes', () => {
    const q = rig(kind); q.press(q.answers(q.ask)[0]); q.press(q.answers(q.ask)[1]);
    q.api.open(); q.press(q.answers(q.panel)[0]); q.press(q.answers(q.panel)[1]);
    assert.deepEqual(q.sent, ['/yes', '/no', '/yes', '/no']);
  });
  test(kind + ' request name and details remain escaped in both existing presentations', () => {
    const q = rig(kind); assert(q.ask.innerHTML.includes('Brenna &lt;Ox&gt; &amp; Co'));
    q.api.open(); assert(q.content.innerHTML.includes('Brenna &lt;Ox&gt; &amp; Co'));
    assert.equal(q.doc.querySelector('ox'), null);
    if (kind === 'book' || kind === 'dye') assert(q.content.innerHTML.includes('The &lt;Bee&gt; &amp; Court'));
  });
}
for (const shown of [false, true]) {
  const p = rig(); if (shown) p.api.open();
  const container = shown ? p.content : p.ask, old = p.retain(p.answers(container)[0]);
  p.state.offer = {kind:'friend',from:1002,name:'Corvin',about:''}; p.feed();
  test('replacement offer retires the prior handler while open=' + shown, () => {
    const before = p.sent.length; old(); assert.equal(p.sent.length, before);
  });
  test('replacement renders only the new request surface while open=' + shown, () => {
    assert.equal(p.answers(p.doc).length, 2);
    assert(container.innerHTML.includes('Corvin')); assert(!container.innerHTML.includes('Brenna'));
  });
  const expires = p.retain(p.answers(container)[1]); p.state.offer = null; p.feed();
  test('expiry removes both surfaces and retires the old answer while open=' + shown, () => {
    assert.equal(p.answers(p.doc).length, 0); const before = p.sent.length; expires(); assert.equal(p.sent.length, before);
  });
}
test('repeated open/close and owner pushes keep one pair and retire each prior mode handler', () => {
  const p = rig();
  for (let i = 0; i < 6; i++) {
    const floating = p.retain(p.answers(p.ask)[0]); p.api.open();
    assert.equal(p.answers(p.doc).length, 2); floating(); assert.equal(p.sent.length, 0);
    const inline = p.retain(p.answers(p.panel)[0]); p.api.close();
    assert.equal(p.answers(p.doc).length, 2); inline(); assert.equal(p.sent.length, 0);
    p.feed(); assert.equal(p.answers(p.doc).length, 2);
  }
});
for (const shown of [false, true]) test('null owner data removes every answer and retires its handler while open=' + shown, () => {
  const p = rig(); if (shown) p.api.open(); const old = p.retain(p.answers(shown ? p.panel : p.ask)[0]);
  p.api.setData(null); assert.equal(p.answers(p.doc).length, 0); old(); assert.equal(p.sent.length, 0);
});
test('an unknown offer kind retains the existing trade wording and answer wires', () => {
  const p = rig('future-kind'); assert(p.ask.innerHTML.includes('is offering to trade'));
  p.press(p.answers(p.ask)[0]); p.api.open(); assert(p.content.innerHTML.includes('is offering to trade'));
  assert.equal(p.answers(p.doc).length, 2); p.press(p.answers(p.panel)[1]); assert.deepEqual(p.sent, ['/yes', '/no']);
});
test('absent offer data never creates an answer pair across modes', () => {
  const p = rig(); p.state.offer = null; p.feed(); assert.equal(p.answers(p.doc).length, 0);
  p.api.open(); assert.equal(p.answers(p.doc).length, 0); p.api.close(); assert.equal(p.answers(p.doc).length, 0);
});
for (const shown of [false, true]) for (const throws of [false, true]) test('unconfirmed delivery neither clears an offer nor retries while open=' + shown + ' throws=' + throws, () => {
  const p = rig(); if (shown) p.api.open(); const calls = [], before = JSON.stringify(p.state);
  p.win.thornswoodNet.say = line => { calls.push(line); if (throws) throw Error('after queue fixture'); return false; };
  p.press(p.answers(shown ? p.panel : p.ask)[0]);
  assert.deepEqual(calls, ['/yes']); assert.equal(JSON.stringify(p.state), before); assert.equal(p.answers(p.doc).length, 2);
});
test('closing retires only inline request markup and preserves unrelated party row identity', () => {
  const p = rig(); p.state.friends = [{p:1002,name:'Corvin',on:true}]; p.feed(); p.api.open();
  const friend = p.content.querySelectorAll('[data-do="ask"]')[0]; assert(friend);
  const contents = p.content; p.api.close();
  assert.equal(p.content, contents); assert.equal(p.content.querySelectorAll('[data-do="ask"]')[0], friend);
  assert.equal(p.answers(p.panel).length, 0); assert.equal(p.answers(p.ask).length, 2);
});
test('mode changes preserve the existing need for two fresh destructive presses', () => {
  const p = rig(); p.state.partyIntent = {id:'a'.repeat(48),version:'b'.repeat(48)};
  p.state.party = [{p:1000,name:'Aldis',me:true,leader:true},{p:1001,name:'Brenna'}]; p.feed(); p.api.open();
  p.press(p.content.querySelector('[data-do="disband"]')); assert.equal(p.sent.length, 0);
  p.api.close(); p.api.open(); p.press(p.content.querySelector('[data-do="disband"]')); assert.equal(p.sent.length, 0);
  p.press(p.content.querySelector('[data-do="disband"]'));
  assert.deepEqual(p.sent, ['/party-action-v1 disband '+'a'.repeat(48)+' '+'b'.repeat(48)]);
  assert.equal(p.answers(p.doc).length, 2);
});
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
