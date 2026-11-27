/*
  test-4937-not-in-discord.js

      node .\site\tests\test-4937-not-in-discord.js [path\to\server.js]

  Issue #4937. personReportRefusal had no answer for an account that is not
  in the Thornswood Discord, so somebody who had left it was answered why
  "role" and told to "Ask staff in the Discord instead", which they cannot.
  The launcher's doors already tell the two apart as 'guild' and 'role'.

  The site is copied into a scratch folder and run on a spare port, once with
  an invite set and once with none, against a small Discord in this process
  (the same preload test-submit-answers.js uses). For each:
    A  /api/gallery/who gives an account not in the server personWhy
       'guild', a sentence that says it is not in the Discord and does not
       send it to staff there, and the invite when one is set;
    B  /api/report refuses its report about a person 403 with the same
       sentence and the invite, and keeps nothing;
    C  an account in the server with no role is still 'role', with no
       invite, and one that may play is let in;
  and the report page shows the invite as a link under the sentence.

  Nothing here touches the repository's data folder or the network.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const SITE = process.argv[2] || path.join(__dirname, '..', '..', 'site', 'server.js');
const HOME = fs.readFileSync(path.join(path.dirname(SITE), 'public', 'home.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');
const INVITE = 'https://discord.gg/harness4937';

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

// Members by id: 'play' holds the role that lets somebody in, 'none' is in
// the server with no role. Anybody not listed is not in the server.
const MEMBERS = { '602': 'none', '603': 'play' };
const discord = http.createServer((req, res) => {
  const u = req.url;
  const out = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (/\/roles$/.test(u)) return out(200, [{ id: 'r1', name: 'Playtester' }]);
  if (/\/members\?limit=/.test(u)) return out(403, { message: 'Missing Access' });
  const id = u.slice(u.lastIndexOf('/') + 1);
  const m = MEMBERS[id];
  if (!m) return out(404, { code: 10007, message: 'Unknown Member' });
  return out(200, { user: { id, username: 'u' + id, global_name: 'Visitor ' + id }, nick: null,
                    roles: m === 'play' ? ['r1'] : [] });
});
const sockets = new Set();
discord.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
let port = 0, secret = '', lane = 0;
const cookieFor = (id) => {
  const at = String(Date.now());
  const name = 'Visitor ' + id;
  const sig = crypto.createHmac('sha256', secret).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
};
function ask(method, where, body, as) {
  return new Promise((ok) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'x-forwarded-for': '10.49.37.' + (++lane), cookie: cookieFor(as), origin: 'http://127.0.0.1:' + port };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers, agent: false }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { } ok({ status: res.statusCode, j: j || {}, text: buf }); });
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', (e) => ok({ status: 0, j: {}, text: String(e) }));
    r.end(data);
  });
}
const sendsToStaff = (s) => /Ask staff in the Discord/.test(s);

async function one(invite, dport) {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4937-'));
  secret = crypto.randomBytes(32).toString('hex');
  let site = null, said = '';
  try {
    siteFiles.copy(dir, SITE);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: 'harness-bot', guildId: 'g1', invite },
      access: { admin: ['Owner'], play: ['Playtester'], banned: ['Banned'], dev: ['Owner'], slots3: [], jarl: [] },
      botKey: crypto.randomBytes(24).toString('hex'), admins: [], secret,
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'fake-discord.js'), [
      "const http = require('http'), https = require('https');",
      "const port = Number(process.env.FAKE_DISCORD_PORT);",
      "const real = https.get;",
      "https.get = function (o, cb) {",
      "  if (o && typeof o === 'object' && o.hostname === 'discord.com') {",
      "    return http.get({ host: '127.0.0.1', port: port, path: o.path, headers: o.headers }, cb);",
      "  }",
      "  return real.apply(this, arguments);",
      "};"
    ].join('\n'));
    site = spawn(process.execPath, ['-r', path.join(dir, 'fake-discord.js'), path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
                                            THORNSWOOD_DOCS_LOCAL: '1', FAKE_DISCORD_PORT: String(dport) })
    });
    site.stdout.on('data', (d) => { said += d; });
    site.stderr.on('data', (d) => { said += d; });
    port = (await siteFiles.listening(site)).port;
    const tag = invite ? ' (invite set)' : ' (no invite)';
    const inbox = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'for-bot', 'inbox.json'), 'utf8')); } catch (e) { return []; } };

    console.log('\nA. /api/gallery/who' + tag + ':');
    let r = await ask('GET', '/api/gallery/who', null, '601');
    const says = String(r.j.personSays || '');
    yes('an account not in the server is personWhy guild (' + r.j.personWhy + ')', r.status === 200 && r.j.personWhy === 'guild', r.text);
    yes('told it is not in the Discord, and not sent to staff there', /not in the Thornswood Discord/.test(says) && !sendsToStaff(says), says);
    yes('with the invite ' + (invite ? 'given' : 'left out'), (r.j.personInvite || '') === invite, r.text);

    console.log('\nB. /api/report' + tag + ':');
    r = await ask('POST', '/api/report', { title: 'about somebody 4937', about: 'Brynjolf', kind: 'report' }, '601');
    yes('its report about a person is refused 403 (' + r.status + ')', r.status === 403, r.text);
    yes('with the same sentence', r.j.error === says, r.text);
    yes('and the invite ' + (invite ? 'given' : 'left out'), (r.j.invite || '') === invite, r.text);
    yes('and nothing is kept', !inbox().some((x) => x.title === 'about somebody 4937'));

    console.log('\nC. the other answers' + tag + ':');
    r = await ask('GET', '/api/gallery/who', null, '602');
    yes('in the server with no role is still role, with no invite (' + r.j.personWhy + ')',
        r.j.personWhy === 'role' && !r.j.personInvite && /not let into Thornswood/.test(r.j.personSays || ''), r.text);
    r = await ask('GET', '/api/gallery/who', null, '603');
    yes('one that may play is let in', r.status === 200 && r.j.personWhy === '', r.text);
    yes('and the site logs no TypeError', !/TypeError/.test(said), said);
  } finally {
    if (site) site.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
}

(async function main() {
  const dport = await new Promise((ok) => discord.listen(0, '127.0.0.1', () => ok(discord.address().port)));
  try {
    await one(INVITE, dport);
    await one('', dport);

    console.log('\nThe report page:');
    yes('reads personInvite from /api/gallery/who', /d\.personInvite/.test(HOME));
    yes('takes only an https invite', /\^https:\\\/\\\/\/\.test\(d\.personInvite/.test(HOME));
    yes('and shows it as a link under the sentence', /join\.href = personInvite/.test(HOME) && /no\.appendChild\(join\)/.test(HOME));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  } finally {
    for (const s of sockets) s.destroy();
    discord.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
