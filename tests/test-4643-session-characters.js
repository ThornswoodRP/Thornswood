'use strict';
/*
  test-4643-session-characters.js

      node tests\test-4643-session-characters.js

  #4643. Change character (#3128) brings the game's menu back without
  closing the game, so one game run can play several characters. The
  launcher sent the end of the session with the character played last, and
  the site kept one profile on the row, so the staff session sheet filed the
  whole run under that one and staff could not see the others were on.

  It reads two products, so it lives in tests\:

    A  the site: the real /api/play/start and /api/play/end handler, lifted
       out of the site's source and run against an in-memory sessions file.
       A run that picks character 1001, then 1002, and ends: the row keeps
       both, in the order picked, and still says 1002 is the last;
    B  the staff sheet (site\public\hub.js): the row's cell names both;
    C  the launcher: each pick at the menu goes on the session's list, a new
       session starts it empty, and the end sends it.

  Writes nothing.
*/
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
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
  // ------------------------------------------------------------------ A --
  console.log('A. the site keeps every character a session played:');
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
  const ctx = {
    body: async (req) => req.text,
    // The routes read their body with lib/http.js bodyObject (#4382): JSON, and an object.
    bodyObject: async (req) => {
      const v = JSON.parse(req.text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SyntaxError('the body is JSON, but not an object');
      return v;
    },
    passBodyFailure: (e) => { throw e; },
    readTicket: (t) => (t === 'good' ? { d: '777', n: 'Aela' } : null),
    standingCached: async () => ({}),
    sessionRows: () => ROWS,
    putSessions: (rows) => { ROWS = rows; return true; },
    sendJson: (res, code, obj) => { sent = { code, obj }; return sent; },
    jsonFile: () => ({}),
    LINKED: ''
  };
  const route = make(ctx);
  const post = async (p, o) => { sent = null; await route(p, { method: 'POST', text: JSON.stringify(o) }, {}); return sent; };

  const SESSION = 'a4643a4643a4643a4643a4643a4643a4';
  let r = await post('/api/play/start', { ticket: 'good', session: SESSION, channel: 'main', version: '1.2.3' });
  yes('the start is kept (' + (r && r.code) + ')', !!r && r.code === 200 && ROWS.length === 1);
  // What the launcher sends at the end of a run that picked 1001, then
  // changed character to 1002: the last one, and every one.
  r = await post('/api/play/end', { ticket: 'good', session: SESSION, profileId: 1002, profiles: [1001, 1002], minutes: 42, why: 'quit' });
  const row = ROWS[0] || {};
  yes('the end is kept (' + (r && r.code) + ')', !!r && r.code === 200 && ROWS.length === 1);
  yes('the row still names the character played last (' + row.profile + ')', row.profile === 1002);
  yes('and keeps both characters the run played, in the order picked (' + JSON.stringify(row.profiles) + ')',
      Array.isArray(row.profiles) && row.profiles.join(',') === '1001,1002');

  const LATE = 'b4643b4643b4643b4643b4643b4643b4';
  r = await post('/api/play/end', { ticket: 'good', session: LATE, profileId: 2002, profiles: [2001, 2002, 'x', -4, 2001], minutes: 3, why: 'quit' });
  const late = ROWS.filter((x) => x.session === LATE)[0] || {};
  yes('an end whose start was never seen keeps them too, and only real ids, once (' + JSON.stringify(late.profiles) + ')',
      Array.isArray(late.profiles) && late.profiles.join(',') === '2001,2002');

  const OLD = 'c4643c4643c4643c4643c4643c4643c4';
  await post('/api/play/start', { ticket: 'good', session: OLD, channel: 'main' });
  await post('/api/play/end', { ticket: 'good', session: OLD, profileId: 3001, minutes: 1, why: 'quit' });
  const old = ROWS.filter((x) => x.session === OLD)[0] || {};
  yes('a launcher from before sends no list, and its row is as it always was', old.profile === 3001 && !('profiles' in old));

  // ------------------------------------------------------------------ B --
  console.log('\nB. the staff session sheet names them:');
  const hub = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.js'), 'utf8');
  const chars = grab(hub, 'sessionChars');
  yes('hub.js says a session\'s characters in one place', chars.length > 0);
  yes('and the sheet\'s character cell uses it', /\(s\.profile \? sessionChars\(s\) : 'none picked'\)/.test(hub));
  if (chars) {
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    // eslint-disable-next-line no-new-func
    const say = new Function('esc', chars + '\nreturn sessionChars;')(esc);
    const both = say(row);
    yes('the cell for the run names 1001 and 1002 (' + both + ')', both.indexOf('1001') >= 0 && both.indexOf('1002') >= 0);
    yes('and a row from before names its one character (' + say(old) + ')', say(old) === '<code>3001</code>');
  }

  // ------------------------------------------------------------------ C --
  console.log('\nC. the launcher sends every character it saw picked:');
  const discord = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'Discord.cs'), 'utf8');
  const chose = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'ShellChars.cs'), 'utf8');
  const cs = (text, sig) => { const i = text.indexOf(sig); return i < 0 ? '' : braces(text, i); };
  const poll = cs(chose, 'static void PollChoice()');
  yes('each pick at the menu goes on the session\'s list', /chosenId = id;[\s\S]*?Discord\.Played\(id\);/.test(poll));
  const newSession = cs(discord, 'public static string NewSession()');
  yes('a new session starts the list empty', /played\.Clear\(\)/.test(newSession));
  const end = cs(discord, 'public static void SessionEnd(');
  yes('the end sends the list beside the last one', /Head\(profileId\) \+ PlayedJson\(\)/.test(end));
  yes('and an end with no session of its own keeps the list it has', end.length > 0 && !/NewSession\(\)/.test(end));
  const json = cs(discord, 'static string PlayedJson()');
  yes('the list goes as "profiles", a JSON array of the ids', /\\"profiles\\":\[/.test(json) && /played\[i\]\.ToString\(CultureInfo\.InvariantCulture\)/.test(json));
}

main().catch((e) => yes('the harness ran to the end: ' + (e && e.stack || e), false)).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
});
