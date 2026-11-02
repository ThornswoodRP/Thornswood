'use strict';
/*
  test-3111-emudhra-trust.js

      node .\tests\test-3111-emudhra-trust.js

  Issue #3111: eMudhra's emSign roots in the bot's trust. Eight eMudhra
  intermediates were found on 17 Oct 2026 with keys anyone could recover, and
  certifi 2026.10.19, the newest, still carries three emSign roots because
  Mozilla still lists them. The bot needs none of them, so bot\trust.py
  leaves every eMudhra root out of the bundle bot.py writes at every start and
  names in SSL_CERT_FILE. This holds that:

    A  trust.py run on tests\fixtures\3111-roots.pem (four emSign roots from
       certifi 2026.7.22 and four roots the bot does need) trusts the four it
       needs, names the four it leaves out, and writes exactly those four,
       byte for byte, over whatever was at the path before; a context made
       from that file trusts those four and nothing from the machine.
    B  a bundle of nothing but eMudhra roots is refused, not written as an
       empty trust.
    C  bot.py writes the bundle before it imports discord, from its data
       folder, and points SSL_CERT_FILE at it whatever the environment said.
       Every connection it makes, urllib's and discord.py's, goes through a
       context made from that file alone (trust.context), because on Windows
       a default context also loads the machine's stores, and the box's
       LocalMachine\Root holds emSign Root CA - G1 (read 21 Oct). Every
       other script in bot/ that logs in to Discord (Build-Discord.py,
       Wipe-Channels.py, backfill.py, redraw.py) makes its client from the
       same trust.client_class, and none makes a Discord client of its own
       (#3604: backfill.py and redraw.py did, so on the box they trusted that
       emSign root with the bot's token).
    D  Install-Bot.ps1 packs, sends and parse-checks trust.py with the code,
       runs it against the certifi it installed before anything is stopped,
       and no longer writes an SSL_CERT_FILE of its own into bot.env.json.
    E  certifi is pinned at one version in requirements.in and requirements.txt,
       and the written bundle stays out of git.
    F  site\server.js, whose requests carry the bot token to discord.com,
       sets Node's default roots to its own less eMudhra's before anything
       else: the block, run on this Node, leaves out every emSign root and
       nothing else, and comes before the first request in the file.

  bot\tests\test-3111-trust.py, in the nightly, does A and C again with the real
  certifi the bot pins and the real bot.py import.

  Standard library Python only. Nothing leaves the machine; the scratch folder
  is under the temp folder and removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join('');
const TRUST = path.join(ROOT, 'bot', 'trust.py');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', '3111-roots.pem');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

// trust.py needs no library, so any Python 3 that runs it will do. The py
// launcher's 3.12 first, as tests\bot-python.js picks, then the plain names.
function findPython() {
  const tried = [];
  for (const c of [{ cmd: 'py', args: ['-3.12'] }, { cmd: 'python3.12', args: [] },
    { cmd: 'python', args: [] }, { cmd: 'python3', args: [] }]) {
    const r = spawnSync(c.cmd, c.args.concat(['-c', 'import ssl, sys; print(sys.version_info[0])']), { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === '3') return c;
    tried.push(c.cmd + ': ' + (r.error ? r.error.code : 'exit ' + r.status));
  }
  return { cmd: null, why: tried.join('; ') };
}

function blocks(text) {
  return text.match(/-----BEGIN CERTIFICATE-----\s[\s\S]*?-----END CERTIFICATE-----/g) || [];
}

const py = findPython();
yes('a Python 3 is on this machine to run trust.py with', !!py.cmd, py.why);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'test-3111-'));

try {
  if (py.cmd) {
    const run = (args, env) => spawnSync(py.cmd, py.args.concat(['-I']).concat(args),
      { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });

    // ---- A: the fixture
    const fixture = fs.readFileSync(FIXTURE, 'utf8').split(CR).join('');
    const all = blocks(fixture);
    const r = run([TRUST, FIXTURE]);
    const said = String(r.stdout).split(/\r?\n/).filter(Boolean);
    yes('A1 the fixture holds eight roots, four of them eMudhra\'s', all.length === 8 && (fixture.match(/^# Issuer: [^\n]*O=eMudhra/gm) || []).length === 4);
    yes('A2 trust.py trusts the four the bot needs', r.status === 0 && said[0] === 'trusts 4 roots', r.stdout + r.stderr);
    const out = said.slice(1).sort();
    yes('A3 and names each emSign root it leaves out',
      JSON.stringify(out) === JSON.stringify(['leaves out emSign ECC Root CA - C3', 'leaves out emSign ECC Root CA - G3',
        'leaves out emSign Root CA - C1', 'leaves out emSign Root CA - G1']), out.join(' | '));

    const dest = path.join(scratch, 'roots.pem');
    fs.writeFileSync(dest, 'planted by the harness, never to be trusted\n');
    const w = run(['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import trust; print(trust.write_bundle(sys.argv[2], sys.argv[3]))',
      path.join(ROOT, 'bot'), dest, FIXTURE]);
    const written = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    const kept = all.slice(4);
    yes('A4 write_bundle writes the four kept roots byte for byte, in order, over what was at the path',
      w.status === 0 && JSON.stringify(blocks(written)) === JSON.stringify(kept) && written.indexOf('planted') === -1, w.stdout + w.stderr);
    yes('A5 nothing written names eMudhra or emSign', written && !/emudhra|emsign/i.test(written));
    yes('A6 and no half written .tmp is left beside it', !fs.existsSync(dest + '.tmp'));
    // On Windows a context made with no file loads the machine's stores too,
    // and the box's LocalMachine\Root holds emSign Root CA - G1; the gate runs
    // on the box, so this is that measurement.
    const c = run(['-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import trust; ' +
      'print(json.dumps([dict(kv for rdn in x["subject"] for kv in rdn).get("organizationName", "") for x in trust.context(sys.argv[2]).get_ca_certs()]))',
      path.join(ROOT, 'bot'), dest]);
    let orgs = null;
    try { orgs = JSON.parse(String(c.stdout).trim()); } catch (e) { orgs = null; }
    yes('A7 trust.context on that file trusts those four and nothing from the machine\'s own stores',
      Array.isArray(orgs) && orgs.length === 4 && !orgs.some((o) => /emudhra/i.test(o)), c.stdout + c.stderr);

    // ---- B: nothing but eMudhra
    const only = path.join(scratch, 'only-emudhra.pem');
    fs.writeFileSync(only, all.slice(0, 4).join('\n') + '\n');
    const b = run([TRUST, only]);
    yes('B1 a bundle of only eMudhra roots is refused, saying none is left', b.status !== 0 && /no root certificate is left/.test(b.stderr), b.stdout + b.stderr);
  }

  // ---- C: bot.py
  const bot = read('bot/bot.py');
  const iTrust = bot.indexOf('\nimport trust\n');
  const iDiscord = bot.indexOf('\nimport discord\n');
  yes('C1 bot.py imports trust before discord', iTrust > 0 && iDiscord > iTrust);
  const head = bot.slice(iTrust, iDiscord);
  yes('C2 it writes the bundle into its data folder before that import',
    head.indexOf("\nROOTS = os.path.join(DATA_DIR, 'roots.pem')\n") !== -1 &&
    head.indexOf('\n_trusted, _left_out = trust.write_bundle(ROOTS)\n') !== -1 &&
    bot.indexOf('\nDATA_DIR = ') !== -1 && bot.indexOf('\nDATA_DIR = ') < iTrust);
  yes('C4 every urllib request goes through a context made from that file alone',
    head.indexOf('\nCONTEXT = trust.context(ROOTS)\n') !== -1 &&
    head.indexOf('urllib.request.HTTPSHandler(context=CONTEXT)') !== -1 &&
    head.indexOf('urllib.request.install_opener(') !== -1 &&
    !/urlopen\([^)]*context=/.test(bot));
  const after = bot.slice(iDiscord);
  const trustPy = read('bot/trust.py');
  yes('C5 and so does discord.py: TrustedClient, made by trust.client_class, gives its HTTP client a connector on CONTEXT at login',
    after.indexOf('\nTrustedClient = trust.client_class(CONTEXT)\n') !== -1 &&
    /\ndef client_class\(ctx=None\):[\s\S]*?class TrustedClient\(discord\.Client\):\n\s+async def login\(self, token\):\n\s+self\.http\.connector = aiohttp\.TCPConnector\(\n\s+limit=0, ssl=ctx if ctx is not None else own_context\(\)\)\n\s+await super\(\)\.login\(token\)\n\n\s+return TrustedClient\n/.test(trustPy));
  yes('C6 every client the bot makes is a TrustedClient', /\nclass Thornswood\(TrustedClient\):/.test(bot) &&
    !/discord\.Client\(/.test(bot));
  // #3604: backfill.py and redraw.py made a plain discord.Client, so on the
  // box they trusted LocalMachine Root and its emSign root with the bot's
  // token. Every script in bot/ makes its client from trust.client_class,
  // through bot.TrustedClient or directly, and no other Discord client.
  const scripts = fs.readdirSync(path.join(ROOT, 'bot')).filter((f) => /\.py$/.test(f) && !/^test-/.test(f) && f !== 'trust.py');
  const plain = /\b(?:discord\.(?:Client|AutoShardedClient)|commands\.(?:Bot|AutoShardedBot)|(?:^|[^.\w])(?:Client|AutoShardedClient|Bot|AutoShardedBot))\s*\(\s*(?:intents|\)|command_prefix)|\(\s*discord\.(?:Client|AutoShardedClient)\s*\)|from discord(?:\.ext\.commands)? import[^\n]*\b(?:Client|Bot)\b/m;
  const wrong = scripts.filter((f) => plain.test(read('bot/' + f)));
  yes('C7 no script in bot/ makes or subclasses a Discord client of its own (' + scripts.length + ' read)', wrong.length === 0, wrong.join(', '));
  const logsIn = scripts.filter((f) => /\bclient\.(?:run|login|start)\(/.test(read('bot/' + f)));
  const viaTrust = (f) => /\n\s*client = (?:bot\.TrustedClient|trust\.client_class\(\))\(intents=/.test(read('bot/' + f)) ||
    (f === 'bot.py' && /\nclient = Thornswood\(/.test(bot));
  yes('C8 and every one that logs in makes its client from trust.client_class: ' + logsIn.join(', '),
    logsIn.length >= 5 && logsIn.every(viaTrust), logsIn.filter((f) => !viaTrust(f)).join(', '));
  yes('C3 and points SSL_CERT_FILE at it on every start, whatever the environment named',
    head.indexOf("\nos.environ['SSL_CERT_FILE'] = ROOTS\n") !== -1 &&
    bot.indexOf("if not os.environ.get('SSL_CERT_FILE')") === -1 &&
    !/certifi\.where\(\)/.test(bot));

  // ---- D: Install-Bot.ps1
  const ib = read('scripts/deploy/Install-Bot.ps1');
  yes('D1 Install-Bot packs trust.py into the bot artifact', /New-ThornswoodArtifact -Component bot [^\n]*'bot\/trust\.py'/.test(ib));
  yes('D2 sends it with the code and parse-checks it on the box',
    ib.indexOf("foreach ($f in 'bot.py', '_pyguard.py', 'trust.py', 'card.py',") !== -1 &&
    ib.indexOf("$hashes @('bot.py', '_pyguard.py', 'trust.py', 'card.py')") !== -1);
  yes('D3 runs trust.py against the installed certifi and stops before the bot is touched when it cannot',
    ib.indexOf("& python '$rootWin\\$stageName\\trust.py'") !== -1 &&
    /-match 'ROOTS NOT MADE'\) \{ Die /.test(ib));
  yes('D4 writes no SSL_CERT_FILE or REQUESTS_CA_BUNDLE of its own, and takes out one an earlier run wrote',
    !/\$env2\['(SSL_CERT_FILE|REQUESTS_CA_BUNDLE)'\]\s*=/.test(ib) &&
    ib.indexOf("foreach (`$k in 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE') { if (`$env2.Contains(`$k)) { `$env2.Remove(`$k) } }") !== -1);

  // ---- E: the pin and git
  const pin = (text) => (text.match(/^certifi==(\S+)/m) || [])[1];
  const inPin = pin(read('bot/requirements.in'));
  const txtPin = pin(read('bot/requirements.txt'));
  yes('E1 certifi is pinned at one version in requirements.in and requirements.txt', !!inPin && inPin === txtPin, inPin + ' / ' + txtPin);
  const gi = read('.gitignore');
  yes('E2 bot/roots.pem and its .tmp stay out of git', /^bot\/roots\.pem$/m.test(gi) && /^bot\/roots\.pem\.tmp$/m.test(gi));

  // ---- F: the site
  const site = siteFiles.source();
  const from = site.indexOf('\nconst NOT_TRUSTED = ');
  const to = from < 0 ? -1 : site.indexOf('\n}));\n', from);
  const block = (from >= 0 && to > from) ? site.slice(from, to + 5) : '';
  yes('F1 server.js has the block that sets its roots', !!block && site.indexOf("\nconst tls    = require('tls');\n") !== -1);
  const firstCall = Math.min(...['https.request(', 'https.get(', 'fetch('].map((w) => {
    const i = site.indexOf(w); return i < 0 ? Infinity : i;
  }));
  yes('F2 and sets them before the first request anywhere in the file', !!block && from < firstCall);
  const probe = spawnSync(process.execPath, ['-e',
    "const crypto = require('crypto'); const tls = require('tls');\n" +
    "const fp = (p) => new crypto.X509Certificate(p).fingerprint256;\n" +
    "const isE = (p) => { const c = new crypto.X509Certificate(p); return /O=eMudhra/i.test(c.subject) || /O=eMudhra/i.test(c.issuer); };\n" +
    "const before = tls.getCACertificates('default');\n" + block + '\n' +
    "const after = tls.getCACertificates('default');\n" +
    "const want = new Set(before.filter((p) => !isE(p)).map(fp));\n" +
    "const got = new Set(after.map(fp));\n" +
    "console.log(JSON.stringify({ before: before.filter(isE).length, after: after.filter(isE).length, left: LEFT_OUT,\n" +
    "  same: got.size === want.size && [...want].every((f) => got.has(f)) }));"], { encoding: 'utf8' });
  let p = null;
  try { p = JSON.parse(String(probe.stdout).trim()); } catch (e) { p = null; }
  yes('F3 run on this Node (' + process.version + '), it leaves out every eMudhra root Node carries (' + (p ? p.before : '?') + ') and names them',
    !!p && p.after === 0 && p.left.length === p.before && p.left.every((n) => /^emSign /.test(n)), probe.stdout + probe.stderr);
  yes('F4 and keeps every other root Node trusts by default', !!p && p.same === true);
  yes('F5 the site says at start how many it trusts and which it left out',
    /console\.log\('\[thornswood-docs\] trusting ' \+ tls\.getCACertificates\('default'\)\.length/.test(site));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
