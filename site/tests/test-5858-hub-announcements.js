'use strict';
// Whole current hub page on the shared browser-order DOM. Real Linked accounts
// handlers produce repeated results; controlled frames check publication order.
// DOM/AX changes are evidence of exposure, not proof a screen reader spoke.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const makePage = require('../../tests/fixtures/panel-page.js');
const ROOT = process.env.TS_REPO || path.resolve(__dirname, '../..');
const HUB = fs.readFileSync(path.join(ROOT, 'site/public/hub.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'site/public/index.html'), 'utf8');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
async function settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
function page() {
  const p = makePage(), box = p.win;
  p.doc.body.innerHTML = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('</body>'));
  const frames = new Map(), canceled = [], sent = [];
  let next = 0;
  box.requestAnimationFrame = fn => { frames.set(++next, fn); return next; };
  box.cancelAnimationFrame = id => { canceled.push(id); frames.delete(id); };
  box.location = { pathname: '/linked', search: '', href: 'http://localhost/linked' };
  box.history = { pushState() {}, replaceState() {} };
  box.URLSearchParams = URLSearchParams;
  box.marked = { setOptions() {}, use() {}, parse: String };
  box.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  box.confirm = () => true;
  box.alert = text => { throw new Error('unexpected alert: ' + text); };
  const linked = [{ id: '333333333333333333', name: 'Bjorn', profiles: [2002] }];
  box.fetch = (url, opts) => {
    if (url === '/api/hello') return new Promise(() => {});
    sent.push({ url, opts });
    const body = url === '/api/all' ? { linked, records: { bans: {}, notes: {}, pk: {}, names: {} } } : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  p.run('hub.js', HUB);
  box.S.me = { member: true, dev: true, admin: true, name: 'Aela' };
  box.S.level = { linked: 'staff', inbox: 'admin' };
  box.S.at = 'linked'; box.S.linked = linked;
  box.draw();
  return Object.assign(p, { sent, canceled, frames, region: () => p.doc.getElementById('hubsaid'),
    frame() { const ready = Array.from(frames.values()); frames.clear(); ready.forEach(fn => fn()); },
    async note() {
      const field = p.doc.querySelector('.notetext'), button = p.doc.querySelector('button[data-act="note"]');
      assert.ok(field && button, 'actual retained Linked accounts controls are mounted');
      field.value = 'a test note'; button.focus(); button.click(); await settle();
    }
  });
}
(async () => {
  const p = page(), region = p.region();
  test('the real shell mounts one polite status region outside the redraw area', () => {
    assert.equal(region.getAttribute('role'), 'status');
    assert.equal(region.getAttribute('aria-live'), 'polite');
    assert.equal(p.doc.getElementById('page').contains(region), false);
  });
  await p.note();
  test('the actual note handler sends one note request and leaves focus on its replacement button', () => {
    assert.equal(p.sent.filter(x => x.url === '/api/staff/note').length, 1);
    assert.equal(p.doc.activeElement.getAttribute('data-act'), 'note');
  });
  test('a committed note leaves the status empty before the first render turn', () => assert.equal(region.textContent, ''));
  p.frame();
  test('the cleared status survives a whole render turn before text returns', () => assert.equal(region.textContent, ''));
  p.frame();
  test('the next render publishes the actual note result in the same mounted region', () => {
    assert.equal(p.region(), region); assert.equal(region.textContent, 'Note added for Bjorn.');
  });
  await p.note();
  test('an identical second real result clears the previously published message', () => assert.equal(region.textContent, ''));
  p.frame();
  test('the identical result has an observable empty render between publications', () => assert.equal(region.textContent, ''));
  p.frame();
  test('the identical result is published again without repeating the server action', () => {
    assert.equal(region.textContent, 'Note added for Bjorn.');
    assert.equal(p.sent.filter(x => x.url === '/api/staff/note').length, 2);
  });
  const q = page();
  q.win.announce('Older result'); q.frame();
  const stale = Array.from(q.frames.values());
  q.win.announce('Newest result');
  test('a superseded frame cannot publish an older result even if cancellation raced', () => {
    stale.forEach(fn => fn()); assert.equal(q.region().textContent, '');
  });
  q.frame(); q.frame();
  test('only the latest result reaches the live region', () => assert.equal(q.region().textContent, 'Newest result'));
  q.win.announce('Must be canceled'); q.frame(); const cleared = Array.from(q.frames.values()); q.win.announce('');
  q.frame(); q.frame(); cleared.forEach(fn => fn());
  test('explicit clear cancels pending text and rejects a raced callback', () => assert.equal(q.region().textContent, ''));
  q.win.announce('Replaced result'); q.frame(); const replaced = q.region();
  replaced.parentNode.innerHTML = '<p id="hubsaid" role="status" aria-live="polite"></p>';
  q.frame();
  test('a replacement region cannot receive the prior region owner\'s pending text', () => {
    assert.equal(replaced.textContent, ''); assert.equal(q.region().textContent, '');
  });
  q.win.announce('Detached result'); q.frame(); const old = q.region();
  old.parentNode.innerHTML = ''; q.frame();
  test('a disconnected status node cannot receive a delayed result', () => assert.equal(old.textContent, ''));
  q.win.announce('No region');
  test('a missing region schedules no publication', () => assert.equal(q.frames.size, 0));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
