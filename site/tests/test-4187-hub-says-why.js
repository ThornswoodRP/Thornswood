'use strict';
/*
  test-4187-hub-says-why.js

      node site\tests\test-4187-hub-says-why.js

  Issue #4187. Where the site refused something and said why, the hub showed
  its own blanket line instead, because each caller wrote its own fallback
  and none read the site's answer:
    - sign in said "Not that one." to every refusal, the 429 that says how
      long to wait included, so a person guessed again exactly when guessing
      makes the wait longer;
    - staff actions read only the answer's message, never its error, so
      "that is your own account" and "staff only" never reached staff;
    - the session hold, crash mark, page edit, test mark and inbox saves said
      "did not save" whether the person was signed out, not an admin, or the
      site was down;
    - the report form said "did not send, try again" to the 429 that says
      when to try again, and to the Turnstile refusals;
    - a page load the site answered with a 5xx, or with something not JSON,
      showed the sign in gate as if the person were signed out.

  Runs the real code out of site\public\hub.js against stand-in answers:
    S  the shared readers: the site's message, then its error, then what the
       status means (signed out, admins only, could not reach the site);
    A  sign in: the 429's own sentence, "Not that one." only for a wrong
       password, and no answer said as no answer;
    B  staff actions show the site's error when it gives no message;
    C  every save names why it did not save, and no bare "did not save" is
       left;
    D  the report form shows the site's sentence;
    E  a load the site could not answer says so and offers no sign in, and
       a 401 still shows the gate to sign in.

  Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hub.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, c, why) {
  if (c) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why) : '')); }
}
// The text from one marker to the next, or '' when either is missing.
function slice(from, to) {
  const a = SRC.indexOf(from);
  if (a < 0) return '';
  const b = to === null ? SRC.length : SRC.indexOf(to, a + from.length);
  return b < 0 ? '' : SRC.slice(a, b);
}

const HELP = slice('function siteSaid(', 'function saidNow(');
yes('hub.js has the shared readers siteSaid, whyWords and notSaved, before saidNow',
  /function siteSaid\(/.test(HELP) && /function whyWords\(/.test(HELP) && /function notSaved\(/.test(HELP));

function answer(status, body) {
  return {
    ok: status >= 200 && status < 300, status: status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body))
  };
}
const settle = () => new Promise((r) => setTimeout(r, 10));
function node(id) {
  return { id, textContent: '', value: '', hidden: false, href: '', style: { display: '' }, disabled: false };
}
function box(extra) {
  const els = {};
  const ctx = Object.assign({
    els,
    el: (id) => (els[id] = els[id] || node(id)),
    Promise, JSON, Error, TypeError, SyntaxError, Object, String, Number, Date, Array,
    location: { pathname: '/hub' }, encodeURIComponent,
  }, extra || {});
  return ctx;
}

(async () => {
  // ---- S ---------------------------------------------------------------
  if (HELP) {
    const h = box();
    vm.runInNewContext(HELP, h);
    yes('S1 the site\'s message comes first', h.siteSaid({ message: 'Only an admin can undo a PK.', error: 'admins only' }) === 'Only an admin can undo a PK.');
    yes('S2 then its error', h.siteSaid({ error: 'that is your own account' }) === 'that is your own account');
    yes('S3 and nothing when it gave neither, or no body', h.siteSaid({}) === '' && h.siteSaid(undefined) === '' && h.siteSaid({ error: 7 }) === '');
    const w = (s, j) => h.whyWords(s, j);
    yes('S4 a 401 with no words says signed out (' + w(401, {}) + ')', /signed out/.test(w(401, {})));
    yes('S5 a 403 with no words says admins only (' + w(403, {}) + ')', /only admins/i.test(w(403, {})));
    yes('S6 no answer says the site could not be reached (' + w(0) + ')', /could not reach the site/.test(w(0)));
    yes('S7 a 502 with a body that is not JSON says the same (' + w(502) + ')', /could not reach the site/.test(w(502)));
    yes('S8 any other status is named (' + w(418, {}) + ')', /418/.test(w(418, {})));
    yes('S9 the site\'s words win over the status', w(401, { error: 'sign in first' }) === 'sign in first');
    yes('S10 notSaved puts it after "did not save" (' + h.notSaved(403, { error: 'admins only' }) + ')',
      h.notSaved(403, { error: 'admins only' }) === 'did not save: admins only');
  }

  // ---- A: sign in ------------------------------------------------------
  const SIGNIN = slice('function signIn() {', '/* --------------------------------------------------------------- route -- */');
  async function signInWith(reply) {
    let started = 0;
    const b = box({ api: () => reply(), start: () => { started++; } });
    vm.runInNewContext(HELP + '\n' + SIGNIN, b);
    b.el('pw').value = 'guess';
    b.signIn();
    await settle();
    return { err: b.el('err').textContent, started };
  }
  if (SIGNIN && HELP) {
    const wait = 'Too many sign-in attempts from this connection. Try again in 30 seconds.';
    let r = await signInWith(() => Promise.resolve(answer(429, { error: wait })));
    yes('A1 a 429 shows the site\'s own wait (' + r.err + ')', r.err === wait && r.started === 0);
    r = await signInWith(() => Promise.resolve(answer(401, { error: 'wrong password' })));
    yes('A2 a wrong password is still "Not that one." (' + r.err + ')', r.err === 'Not that one.');
    r = await signInWith(() => Promise.reject(new TypeError('Failed to fetch')));
    yes('A3 no answer says the server could not be reached (' + r.err + ')', /[Cc]ould not reach/.test(r.err));
    r = await signInWith(() => Promise.resolve(answer(200, { ok: true })));
    yes('A4 a good password starts the hub', r.started === 1 && r.err === '');
  } else {
    yes('A sign in can be run with the shared readers', false, 'signIn ' + !!SIGNIN + ', readers ' + !!HELP);
  }

  // ---- B: staff actions ------------------------------------------------
  const ACT = slice("var said = '', taken = false;", '/* ------------------------------------------------------- play sessions -- */');
  yes('B1 a staff action takes the site\'s message, else its error', /said = siteSaid\(j\);/.test(ACT));
  yes('B2 and still falls back to its own line only when the site said nothing',
    /alert\(said \|\| 'The site did not take that\.'\);/.test(ACT));

  // ---- C: saves --------------------------------------------------------
  const SAVE = slice('function saveResult(', 'function tally()');
  async function saveWith(reply) {
    const said = [];
    const b = box({ api: () => reply(), saidNow: (t) => said.push(t), each: () => {}, tally: () => {}, S: { results: {} } });
    vm.runInNewContext(HELP + '\n' + SAVE, b);
    b.saveResult('test-one', { status: 'pass' }, null);
    await settle();
    return said[said.length - 1] || '';
  }
  if (SAVE && HELP) {
    let s = await saveWith(() => Promise.resolve(answer(403, { error: 'admins only' })));
    yes('C1 a test mark refused 403 says admins only (' + s + ')', s === 'did not save: admins only');
    s = await saveWith(() => Promise.resolve(answer(401)));
    yes('C2 refused 401 with no JSON says signed out (' + s + ')', /^did not save: .*signed out/.test(s));
    s = await saveWith(() => Promise.reject(new TypeError('Failed to fetch')));
    yes('C3 no answer says the site could not be reached (' + s + ')', /^did not save: could not reach the site/.test(s));
  } else {
    yes('C saveResult can be run with the shared readers', false);
  }
  yes('C4 no bare "did not save" is left anywhere in hub.js', !/'did not save'/.test(SRC));
  const DOC = slice("api('/api/doc/' + at", 'function dressCode()');
  yes('C5 the page edit names why', /notSaved\(r\.status, j\)/.test(DOC) && /notSaved\(0\)/.test(DOC));
  const KEEP = slice("api('/api/session-keep'", '/* The sessions of one person');
  yes('C6 the session hold and the crash mark name why',
    (KEEP.match(/notSaved\(a\.status, a\.j\)/g) || []).length === 2 && (KEEP.match(/notSaved\(0\)/g) || []).length === 2);
  const INBOX = slice('function inboxAct(', 'function inboxName(');
  yes('C7 the inbox names why', /if \(!r\.ok\) return unsaved\(r\.status, j\);/.test(INBOX) &&
    /whyWords\(status, j\)/.test(INBOX) && /notSaved\(status, j\)/.test(INBOX) && /unsaved\(0\)/.test(INBOX));

  // ---- D: the report form ---------------------------------------------
  const REPORT = slice("api('/api/report'", '/* --------------------------------------------------------------- inbox -- */');
  yes('D1 the report form shows the site\'s sentence', /'did not send: ' \+ whyWords\(r\.status, j\)/.test(REPORT));
  yes('D2 and no blanket "did not send, try again" is left', !/did not send, try again/.test(SRC));

  // ---- E: a load the site could not answer -----------------------------
  const START = slice('function start() {', '/* Fetches /api/all again');
  const GATE = slice('function showGate() {', null);
  yes('E0 hub.js has unreachable() beside showGate()', /function unreachable\(/.test(GATE));
  async function startWith(reply) {
    const b = box({ api: () => reply(), S: { me: {} } });
    vm.runInNewContext(HELP + '\n' + START + '\n' + GATE, b);
    b.start();
    await settle();
    return b;
  }
  if (START && GATE && HELP) {
    let b = await startWith(() => Promise.resolve(answer(502)));
    yes('E1 /api/all answering 502, not JSON, says the site could not be reached (' + b.el('err').textContent + ')',
      /[Cc]ould not reach the site/.test(b.el('err').textContent));
    yes('E2 and offers no sign in, since being signed out is not what happened',
      b.el('gatediscord').hidden === true && b.el('pwbox').hidden === true);
    b = await startWith(() => Promise.resolve(answer(401, { error: 'sign in first' })));
    yes('E3 a 401 still shows the gate to sign in, with nothing said',
      b.el('gate').style.display === 'grid' && b.el('gatediscord').hidden === false && b.el('err').textContent === '');
  } else {
    yes('E start() can be run beside showGate()', false);
  }
  const HELLO = slice("api('/api/hello').then(", '// The sign in button on the gate');
  async function helloWith(reply) {
    const did = [];
    const b = box({ api: () => reply(), S: {},
      start: () => did.push('start'), showGate: () => did.push('gate'), unreachable: () => did.push('unreachable') });
    vm.runInNewContext(HELP + '\n' + HELLO, b);
    await settle();
    return did.join(',');
  }
  if (HELLO && HELP) {
    yes('E4 /api/hello answering 401 shows the gate (' + await helloWith(() => Promise.resolve(answer(401, { discord: true }))) + ')',
      (await helloWith(() => Promise.resolve(answer(401, { discord: true })))) === 'gate');
    yes('E5 /api/hello answering 502, not JSON, is unreachable (' + await helloWith(() => Promise.resolve(answer(502))) + ')',
      (await helloWith(() => Promise.resolve(answer(502)))) === 'unreachable');
    yes('E6 /api/hello not answering at all is unreachable',
      (await helloWith(() => Promise.reject(new TypeError('Failed to fetch')))) === 'unreachable');
    yes('E7 /api/hello answering 200 starts the hub',
      (await helloWith(() => Promise.resolve(answer(200, { discord: true })))) === 'start');
  } else {
    yes('E the /api/hello block can be run', false);
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
