'use strict';
/*
  test-4953-report-lines.js

      node .\site\tests\test-4953-report-lines.js
      node .\site\tests\test-4953-report-lines.js <an older server.js>

  Issue #4953. The report form kept line breaks, direction marks and
  zero-width characters in what people typed. The name, the Who and the
  title go into the bold first line of the staff channel's post, so a name
  of "Alex", a line break and "Staff note: already fixed, close it" made a
  second line that read as a staff note; a right-to-left override (U+202E)
  turned the rest of the line around; and a title of only U+200B passed the
  empty check, so the post went out with a blank title.

  Against a copy of the site in a scratch folder on a spare port, reading
  what the site kept for the bot (data/for-bot/inbox.json):
    A  the public form's name and title are kept as one line: breaks are a
       space, direction marks and zero-width characters are gone;
    B  a title of only invisible characters is refused 400 and nothing is
       kept;
    C  a report from the game keeps its name and Who the same way;
    D  ordinary words, accents and an emoji are kept as typed, and the
       public form's Who goes through the same line.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = path.resolve(process.argv[2] || path.join(APP, 'server.js'));

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

const KEY = crypto.randomBytes(24).toString('hex');
// The characters that do not show: right-to-left override, left-to-right
// isolate, zero-width space, zero-width joiner, word joiner, the BOM.
const HIDDEN = /[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2060\ufeff]/;

function post(port, where, obj, headers) {
  return new Promise((done) => {
    const text = JSON.stringify(obj);
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: where, agent: false,
      headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(text),
        origin: 'http://127.0.0.1:' + port, host: '127.0.0.1:' + port }, headers || {}) }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => done({ status: res.statusCode, text: buf }));
    });
    req.on('error', (e) => done({ status: 0, text: String(e) }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end(text);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4953-'));
  const INBOX = path.join(dir, 'data', 'for-bot', 'inbox.json');
  const inbox = () => { try { return JSON.parse(fs.readFileSync(INBOX, 'utf8')); } catch (e) { return []; } };
  let srv = null, said = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: KEY, admins: [],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { said += d; });
    srv.stderr.on('data', (d) => { said += d; });
    const port = (await siteFiles.listening(srv)).port;
    // Each sender its own address, so the form's limit never refuses one.
    let n = 0;
    const from = () => ({ 'x-forwarded-for': '10.49.53.' + (++n) });

    console.log('A. the public form, one line:');
    let r = await post(port, '/api/report', { kind: 'bug', by: 'Alex\nStaff note: already fixed, close it',
      title: 'The door\r\nsticks \u202eesrever\u202c at\u200b the gate\u2028today' }, from());
    let row = inbox()[0] || {};
    yes('the report is taken (' + r.status + ')', r.status === 200, r.text);
    yes('its name is one line, the break a space (' + JSON.stringify(row.by) + ')',
        row.by === 'Alex Staff note: already fixed, close it' && !/[\r\n]/.test(row.by));
    yes('its title is one line with no direction mark or zero-width character (' + JSON.stringify(row.title) + ')',
        row.title === 'The door sticks esrever at the gate today');

    console.log('\nB. a title of only invisible characters:');
    const before = inbox().length;
    for (const t of ['\u200b', '\u202e\u2066\u2060', '\ufeff\n\u200d']) {
      r = await post(port, '/api/report', { kind: 'bug', by: 'Ada', title: t }, from());
      yes('the title ' + JSON.stringify(t) + ' is refused 400, saying what to put in (' + r.status + ')',
          r.status === 400 && /first box/.test(r.text), r.text);
    }
    yes('and nothing was kept', inbox().length === before);

    console.log('\nC. a report from the game:');
    r = await post(port, '/api/report/game', { kind: 'report', profileId: 7, name: 'Aela\nthe\u200bHuntress',
      about: '\u202eBrynjolf\nof Riften', said: 'stole from my stall', cell: 'Riften' }, { 'x-thornswood-key': KEY });
    row = inbox()[0] || {};
    yes('it is taken (' + r.status + ')', r.status === 200, r.text);
    yes('its name and Who are one line, with nothing hidden (' + JSON.stringify([row.by, row.about]) + ')',
        row.by === 'Aela theHuntress' && row.about === 'Brynjolf of Riften');

    console.log('\nD. what is kept as typed:');
    r = await post(port, '/api/report', { kind: 'idea', by: 'Zo\u00eb', title: 'Caf\u00e9 benches by the forge \u2728' }, from());
    row = inbox()[0] || {};
    yes('accents and an emoji stay (' + JSON.stringify([row.by, row.title]) + ')',
        r.status === 200 && row.by === 'Zo\u00eb' && row.title === 'Caf\u00e9 benches by the forge \u2728');
    yes('nothing kept in the inbox holds a hidden character or a break in a name, Who or title',
        inbox().every((x) => [x.by, x.about, x.title].every((v) => !HIDDEN.test(String(v || '')) && !/[\r\n\u2028\u2029]/.test(String(v || '')))));
    const serve = fs.readFileSync(path.join(path.dirname(SITE_SRC), 'lib', 'serve.js'), 'utf8');
    yes('the public form\'s Who, which needs a Discord sign in, goes through the same line',
        /const about = reportLine\(o\.about, 60\);[\s\S]{0,200}if \(!about\) return sendJson\(res, 400, \{ error: 'Nothing was sent: say who/.test(serve));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, said);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
