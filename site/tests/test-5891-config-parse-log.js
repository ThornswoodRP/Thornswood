'use strict';
/*
  test-5891-config-parse-log.js

      node .\site\tests\test-5891-config-parse-log.js
      node .\site\tests\test-5891-config-parse-log.js <an older server.js>

  Issue #5891. A config.json that will not parse was said in the site's log
  with the parse error's message, and a newer Node puts a piece of the text
  near the fault in that message. config.json holds the Discord client
  secret, the bot token, botKey and the cookie secret.

    A  whereJsonBreaks, lifted out of site/lib/config.js, finds what
       JSON.parse finds: -1 for every text it takes, and for every text it
       refuses, the place its message gives where it gives one. Over a few
       thousand texts cut and changed at random as well as the named ones.
    B  A copy of the site, started on a config.json broken in four ways
       (cut short inside a secret, a secret left unquoted, a stray word after
       a secret, nothing after the opening brace), says the error's name and
       the line and column where it broke, and no five characters of any
       secret in the file appear in anything it prints.

  Nothing leaves the machine. The scratch folders are removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..');
const SITE_SRC = path.resolve(process.argv[2] || path.join(APP, 'server.js'));
const CONFIG_SRC = fs.readFileSync(path.join(path.dirname(SITE_SRC), 'lib', 'config.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ').slice(0, 600) : '')); }
}

// ---- A. where it breaks ------------------------------------------------------
console.log('A. whereJsonBreaks finds what JSON.parse finds:');
let where = null;
{
  const start = CONFIG_SRC.indexOf('function whereJsonBreaks(');
  const end = CONFIG_SRC.indexOf('/* The broken-config line', start);
  if (start >= 0 && end > start) {
    try { where = new Function(CONFIG_SRC.slice(start, end) + '\nreturn whereJsonBreaks;')(); } catch (e) { where = null; }
  }
}
yes('config.js has whereJsonBreaks', typeof where === 'function');
if (where) {
  const named = ['{}', '[]', '{"a":1}', ' {"a" : [1, -2.5e+3, true, false, null, "x\\u00e9\\n"]} ',
    '{"a":"sec', '{"a":"secret" x}', '{"a":1,}', '{"a": secretvalue}', '', ' ', '{"a":"ab\u0001c"}', '{"a":01}',
    '{"a":1.}', '{"a":-}', '{"a":"\\x"}', '{"a":"\\u12g4"}', '[1,]', '{"a":1}{}', 'tru', 'nul', '"\\', '{,}',
    '{"a":1e}', '{"a":.5}', '\t[\r\n]\n', '{"a" 1}', '{1:2}'];
  let seed = 5891;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const base = JSON.stringify({ password: 'pw', discord: { clientId: '123', clientSecret: 'abc"def', botToken: 'tok\\en' },
    n: [1, -2.5, 3e10, 0], ok: true, no: false, none: null, u: 'é\u0001' }, null, 2);
  const texts = named.slice();
  const pieces = ['"', ',', '}', ']', '{', '[', ':', ' ', '\\', 'x', '0', '-', '.', 'e', '\u0002'];
  for (let k = 0; k < 4000; k++) {
    let t = base;
    const how = next(3);
    const at = next(t.length + 1);
    if (how === 0) t = t.slice(0, at);
    else if (how === 1) t = t.slice(0, at) + pieces[next(pieces.length)] + t.slice(at);
    else t = t.slice(0, at) + t.slice(at + 1 + next(4));
    texts.push(t);
  }
  let wrongWhole = [], wrongPlace = [], placed = 0;
  for (const t of texts) {
    let ok = true, msg = '';
    try { JSON.parse(t); } catch (e) { ok = false; msg = e.message; }
    const w = where(t);
    if (ok !== (w === -1)) { wrongWhole.push(JSON.stringify(t).slice(0, 80) + ' -> ' + w + ' / ' + msg); continue; }
    const m = /at position (\d+)/.exec(msg);
    if (m) { placed++; if (Number(m[1]) !== w) wrongPlace.push(JSON.stringify(t).slice(0, 80) + ' -> ' + w + ' / ' + msg); }
    if (!ok && /end of JSON input/.test(msg) && w !== t.length) wrongPlace.push(JSON.stringify(t).slice(0, 80) + ' -> ' + w + ' / end');
  }
  yes('A1 it takes every text JSON.parse takes and refuses every one it refuses (' + texts.length + ' texts)',
    wrongWhole.length === 0, wrongWhole.slice(0, 5).join('\n'));
  yes('A2 and its place is the one JSON.parse gives, where it gives one (' + placed + ' placed)',
    placed > 500 && wrongPlace.length === 0, wrongPlace.slice(0, 5).join('\n'));
}

// ---- B. what the site prints ------------------------------------------------
function letters(n) {
  // Letters that are not hex digits, so no number the site prints can match.
  const abc = 'ghijkmnpqrstuvwxyzGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (const b of crypto.randomBytes(n)) s += abc[b % abc.length];
  return s;
}
function leaks(out, secrets) {
  const found = [];
  for (const s of secrets) for (let k = 0; k + 5 <= s.length; k++) if (out.indexOf(s.slice(k, k + 5)) >= 0) { found.push(s.slice(k, k + 5)); break; }
  return found;
}
async function startOn(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5891-'));
  let srv = null, out = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), text);
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    let started = true;
    try { await siteFiles.listening(srv); } catch (e) { started = false; }
    const kept = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    return { out, started, kept };
  } finally {
    if (srv) await new Promise((ok) => { srv.on('exit', ok); try { srv.kill(); } catch (e) { ok(); } setTimeout(ok, 3000).unref(); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/* How many of an unquoted word's first letters a JSON reader takes before it
   breaks: those that match the start of true, false or null (#7441). A word
   that starts with n or t breaks there, a letter or more in, not at its first. */
function wordStart(w) {
  for (const lit of ['true', 'false', 'null']) {
    if (w[0] !== lit[0]) continue;
    let k = 0;
    while (k < w.length && k < lit.length && w[k] === lit[k]) k++;
    return k;
  }
  return 0;
}
function lineCol(text, at) {
  const before = text.slice(0, at).split('\n');
  return 'line ' + before.length + ' column ' + (before[before.length - 1].length + 1);
}

(async () => {
  console.log('\nB. a copy of the site on a broken config.json:');
  const clientSecret = letters(32), botToken = letters(48), botKey = letters(32), secret = letters(64);
  const secrets = [clientSecret, botToken, botKey, secret];
  const whole = JSON.stringify({ password: letters(16),
    discord: { clientId: '1', clientSecret: clientSecret, botToken: botToken, guildId: '2', invite: '' },
    botKey: botKey, secret: secret, admins: [] }, null, 2);
  const cut = whole.indexOf(botToken) + 20;
  const cases = [
    { name: 'cut short inside the bot token', text: whole.slice(0, cut), at: cut },
    { name: 'the client secret left unquoted', text: whole.replace('"' + clientSecret + '"', clientSecret), at: whole.indexOf('"' + clientSecret + '"') + wordStart(clientSecret) },
    // Secrets that start like null and true, so the break is letters in, every run (#7441).
    { name: 'a botKey that starts like null left unquoted', text: whole.replace('"' + botKey + '"', 'nu' + botKey), at: whole.indexOf('"' + botKey + '"') + wordStart('nu' + botKey) },
    { name: 'a botKey that starts like true left unquoted', text: whole.replace('"' + botKey + '"', 'tr' + botKey), at: whole.indexOf('"' + botKey + '"') + wordStart('tr' + botKey) },
    { name: 'a stray word after botKey', text: whole.replace('"' + botKey + '"', '"' + botKey + '" ' + secret.slice(0, 12)), at: whole.indexOf('"' + botKey + '"') + botKey.length + 3 },
    { name: 'nothing after the opening brace', text: '{', at: 1 }
  ];
  for (const c of cases) {
    const r = await startOn(c.text);
    const said = r.out.split('\n').filter((l) => /will not parse|^\[thornswood\]   /.test(l)).join('\n');
    yes('B ' + c.name + ': the site starts and says the file will not parse', r.started && /config\.json is on disk but will not parse/.test(r.out), r.out);
    yes('B ' + c.name + ': it names the error and where it broke (' + lineCol(c.text, c.at) + ')',
      /SyntaxError/.test(said) && said.indexOf(lineCol(c.text, c.at)) >= 0, said);
    const found = leaks(r.out, secrets);
    yes('B ' + c.name + ': no five characters of a secret are in what it prints', found.length === 0, 'found ' + found.join(', ') + '\n' + said);
    yes('B ' + c.name + ': and the file is left as it was', r.kept === c.text);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exitCode = 1; });
