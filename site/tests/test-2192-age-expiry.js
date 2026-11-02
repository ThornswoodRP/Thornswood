'use strict';
/*
  test-2192-age-expiry.js

  #2192: the age gate's localStorage copy was a bare "1" that never expired,
  so clearing cookies left the gate open for ever. Both copies now carry a
  policy number and the localStorage copy a day one year out.

  Runs the real ageOk / ageRemember from site/public/home.js against a
  stand-in localStorage, document.cookie and clock:
  A. a fresh answer, cookie clearing, storage clearing, both cleared
  B. expiry and clock changes (forward past the day, set back, far future)
  C. malformed values and another policy
  D. migration of the old bare "1" and the old cookie
  E. a browser whose localStorage throws
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'home.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, c) {
  if (c) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
const start = SRC.indexOf("var AGE_KEY = 'tw-age-18'");
const end = SRC.indexOf('function showAgeGate()');
yes('the gate helpers are in home.js', start > 0 && end > start);
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 11, 12);

function browser(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});
  const jar = Object.assign({}, opts.cookies || {});
  const b = { now: T0, store, jar, broken: !!opts.broken };
  const localStorage = {
    getItem(k) { if (b.broken) throw new Error('denied'); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { if (b.broken) throw new Error('denied'); store[k] = String(v); },
    removeItem(k) { if (b.broken) throw new Error('denied'); delete store[k]; },
  };
  const document = {};
  Object.defineProperty(document, 'cookie', {
    get() { return Object.keys(jar).filter((k) => jar[k].exp > b.now).map((k) => k + '=' + jar[k].v).join('; '); },
    set(line) {
      const parts = line.split(';').map((s) => s.trim());
      const kv = parts[0].split('=');
      const exp = parts.find((p) => /^expires=/i.test(p));
      jar[kv[0]] = { v: kv.slice(1).join('='), exp: exp ? Date.parse(exp.slice(8)) : Infinity, line };
    },
  });
  const FakeDate = function (ms) { return ms === undefined ? new Date(b.now) : new Date(ms); };
  FakeDate.now = () => b.now;
  FakeDate.UTC = Date.UTC; FakeDate.parse = Date.parse;
  const box = { localStorage, document, location: { protocol: 'https:' }, Date: FakeDate, JSON, RegExp, String };
  vm.runInNewContext(SRC.slice(start, end) + '\nthis.ageOk = ageOk; this.ageRemember = ageRemember; this.AGE_POLICY = AGE_POLICY;', box);
  b.ok = box.ageOk; b.remember = box.ageRemember; b.policy = box.AGE_POLICY;
  b.clearCookies = () => { for (const k of Object.keys(jar)) delete jar[k]; };
  b.clearStorage = () => { for (const k of Object.keys(store)) delete store[k]; };
  return b;
}
const rec = (b) => { try { return JSON.parse(b.store['tw-age-18']); } catch (e) { return b.store['tw-age-18']; } };

// A
let b = browser();
yes('A1 a new browser is asked', b.ok() === false);
b.remember();
const r = rec(b);
yes('A2 confirming stores the policy and a day one year out', r && r.v === b.policy && r.until === T0 + 365 * DAY);
yes('A3 and a cookie with the policy as its value, one year, Lax, Secure on https',
    b.jar['tw-age-18'] && b.jar['tw-age-18'].v === String(b.policy) && b.jar['tw-age-18'].exp === T0 + 365 * DAY &&
    /SameSite=Lax/.test(b.jar['tw-age-18'].line) && /Secure/.test(b.jar['tw-age-18'].line));
yes('A4 then it is not asked', b.ok() === true);
b.clearCookies();
yes('A5 cookies cleared: the stored copy still answers inside its year', b.ok() === true);
b.now = T0 + 366 * DAY;
yes('A6 cookies cleared and the year gone: asked again (the bug in #2192)', b.ok() === false);
yes('A7 and the stale copy is removed', b.store['tw-age-18'] === undefined);
b = browser(); b.remember(); b.clearStorage();
yes('A8 storage cleared: the cookie still answers', b.ok() === true);
b.clearCookies();
yes('A9 both cleared: asked again', b.ok() === false);

// B
b = browser(); b.remember();
b.now = T0 + 364 * DAY; yes('B1 a day before the year is up: not asked', b.ok() === true);
b.now = T0 + 365 * DAY; yes('B2 on the day: asked', b.ok() === false);
b = browser(); b.remember(); b.clearCookies();
b.now = T0 - 1 * DAY; yes('B3 clock set back a day: still believed, not asked', b.ok() === true);
b.now = T0 - 30 * DAY; yes('B3b clock set back a month: the day now looks more than a year off, so asked (the safe side)', b.ok() === false);
b.now = T0 - 10 * DAY;
b.store['tw-age-18'] = JSON.stringify({ v: 1, until: T0 + 400 * DAY });
yes('B4 a day further away than a year and two days is not believed', b.ok() === false);
b.store['tw-age-18'] = JSON.stringify({ v: 1, until: 8.64e15 });
yes('B5 nor is the end of time', b.ok() === false);

// C
for (const [what, v] of [['C1 garbage', 'yes please'], ['C2 JSON null', 'null'], ['C3 a number', '1e99'],
  ['C4 until as a string', JSON.stringify({ v: 1, until: String(T0 + DAY) })],
  ['C5 no until', JSON.stringify({ v: 1 })], ['C6 an array', '[1]'], ['C7 empty', '']]) {
  b = browser({ store: { 'tw-age-18': v } });
  yes(what + ' is asked and dropped', b.ok() === false && b.store['tw-age-18'] === undefined);
}
b = browser({ store: { 'tw-age-18': JSON.stringify({ v: 0, until: T0 + DAY }) } });
yes('C8 an answer to another policy is asked again', b.ok() === false);
b = browser({ cookies: { 'tw-age-18': { v: '0', exp: T0 + DAY } } });
yes('C9 a cookie for another policy is asked again', b.ok() === false);
b = browser({ cookies: { 'xtw-age-18': { v: '1', exp: T0 + DAY } } });
yes('C10 a cookie that only ends in the name does not count', b.ok() === false);

// D
b = browser({ store: { 'tw-age-18': '1' }, cookies: { 'tw-age-18': { v: '1', exp: T0 + 100 * DAY } } });
yes('D1 old "1" with the old cookie still alive: not asked', b.ok() === true);
yes('D2 and restamped in the new shape', rec(b) && rec(b).v === 1 && rec(b).until === T0 + 365 * DAY);
b = browser({ store: { 'tw-age-18': '1' } });
yes('D3 old "1" with the cookie cleared or expired: asked', b.ok() === false);
yes('D4 and the old "1" is removed', b.store['tw-age-18'] === undefined);
b = browser({ cookies: { 'tw-age-18': { v: '1', exp: T0 + DAY } } });
yes('D5 an old cookie alone (value 1, policy 1) still counts for its year', b.ok() === true);

// E
b = browser({ broken: true });
yes('E1 localStorage that throws: asked, nothing thrown', b.ok() === false);
b.remember();
yes('E2 confirming still sets the cookie, and that answers', b.ok() === true);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
