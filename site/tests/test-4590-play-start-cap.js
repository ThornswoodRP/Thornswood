'use strict';
/*
  test-4590-play-start-cap.js

      node .\site\tests\test-4590-play-start-cap.js

  Issue #4590. POST /api/play/start refuses a new row with 429 "too many"
  once one account has 30 starts in the last hour, and an end is never
  refused (lib/serve.js). With the check made `if (false)` every site test
  still passed: test-play-join reaches the route but never starts thirty.

  The real /api/play/start and /api/play/end handler, lifted out of the
  site's source as test-4643-session-characters does, and run against an
  in-memory sessions file:
    A  one account's 30 new starts in an hour are each taken, a row each;
    B  its 31st new start is 429 "too many", and writes no row;
    C  a start again on an id it already has, and an end on it, go through,
       and so does an end on an id it never started;
    D  another account's new start is taken;
    E  once the account's starts are over an hour old, a new one is taken.

  Writes nothing.
*/
const siteFiles = require('../../tests/site-files');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function braces(text, at) {
  const b = text.indexOf('{', at);
  let d = 0;
  for (let i = b; i < text.length; i++) {
    if (text[i] === '{') d++;
    else if (text[i] === '}') { d--; if (d === 0) return text.slice(at, i + 1); }
  }
  return '';
}
function grab(text, name) {
  const at = text.indexOf('function ' + name + '(');
  return at < 0 ? '' : braces(text, at);
}

async function main() {
  const src = siteFiles.source();
  const at = src.indexOf("if ((p === '/api/play/start' || p === '/api/play/end') && req.method === 'POST') {");
  const block = at < 0 ? '' : braces(src, at);
  yes('the site has the start and end handler', block.length > 0);
  const helpers = ['sessionKey', 'findSession', 'sessionRow'].map((n) => grab(src, n));
  yes('and the session functions it uses', helpers.every((h) => h.length > 0));
  if (!block || !helpers.every((h) => h.length > 0)) return;

  let ROWS = [];
  let sent = null;
  // eslint-disable-next-line no-new-func
  const make = new Function('ctx',
    'with (ctx) {\n' + helpers.join('\n') + '\n' +
    'return async function (p, req, res) {\n' + block + '\nreturn null;\n};\n}');
  const route = make({
    bodyObject: async (req) => JSON.parse(req.text),
    passBodyFailure: (e) => { throw e; },
    readTicket: (t) => ({ a: { d: '777', n: 'Aela' }, b: { d: '888', n: 'Brynjolf' } })[t] || null,
    standingCached: async () => ({}),
    sessionRows: () => ROWS,
    putSessions: (rows) => { ROWS = rows; return true; },
    sendJson: (res, code, obj) => { sent = { code, obj }; return sent; },
    jsonFile: () => ({}),
    LINKED: ''
  });
  const post = async (p, o) => { sent = null; await route(p, { method: 'POST', text: JSON.stringify(o) }, {}); return sent || {}; };
  const id = (n) => 'a4590-' + String(n).padStart(4, '0');
  const mine = () => ROWS.filter((r) => String(r.who) === '777');

  console.log('A. one account\'s first thirty starts in an hour:');
  const codes = [];
  for (let i = 1; i <= 30; i++) codes.push((await post('/api/play/start', { ticket: 'a', session: id(i), channel: 'main' })).code);
  yes('each is taken (' + codes.filter((c) => c === 200).length + ' of 30 answered 200)', codes.every((c) => c === 200));
  yes('a row each (' + mine().length + ')', mine().length === 30);

  console.log('\nB. its 31st new start:');
  let r = await post('/api/play/start', { ticket: 'a', session: id(31), channel: 'main' });
  yes('is 429 "too many" (' + r.code + ', ' + JSON.stringify(r.obj) + ')', r.code === 429 && r.obj && r.obj.why === 'too many' && r.obj.ok === false);
  yes('and writes no row (' + mine().length + ', ' + ROWS.some((x) => x.session === id(31)) + ')',
      mine().length === 30 && !ROWS.some((x) => x.session === id(31)));

  console.log('\nC. what is never refused:');
  r = await post('/api/play/start', { ticket: 'a', session: id(1), channel: 'main', version: '9.9.9' });
  yes('a start again on an id it has goes through, on the same row (' + r.code + ', ' + mine().length + ')',
      r.code === 200 && mine().length === 30 && (mine().find((x) => x.session === id(1)) || {}).version === '9.9.9');
  r = await post('/api/play/end', { ticket: 'a', session: id(1), minutes: 5, why: 'quit' });
  yes('an end on it goes through (' + r.code + ')', r.code === 200 && !!(mine().find((x) => x.session === id(1)) || {}).end);
  r = await post('/api/play/end', { ticket: 'a', session: id(32), minutes: 5, why: 'quit' });
  yes('and so does an end on an id it never started (' + r.code + ')', r.code === 200 && ROWS.some((x) => x.session === id(32)));

  console.log('\nD. another account:');
  r = await post('/api/play/start', { ticket: 'b', session: 'b4590-0001', channel: 'main' });
  yes('its new start is taken (' + r.code + ')', r.code === 200 && ROWS.some((x) => x.session === 'b4590-0001'));

  console.log('\nE. an hour on:');
  const hourAgo = Date.now() - 3600000 - 1000;
  for (const x of mine()) if (Number(x.start) > 0) x.start = hourAgo;
  r = await post('/api/play/start', { ticket: 'a', session: id(33), channel: 'main' });
  yes('once its starts are over an hour old, a new one is taken (' + r.code + ')', r.code === 200 && ROWS.some((x) => x.session === id(33)));
}

main().catch((e) => yes('the harness ran to the end: ' + (e && e.stack || e), false)).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
});
