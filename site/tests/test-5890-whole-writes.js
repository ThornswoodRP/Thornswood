'use strict';
/*
  test-5890-whole-writes.js

      node .\site\tests\test-5890-whole-writes.js
      node .\site\tests\test-5890-whole-writes.js <an older server.js>

  Issue #5890. Three site writes went straight into the file rather than
  beside it and renamed in, so a crash or a restart part way through left the
  file cut short: config.json (the Discord secret, the bot token, botKey and
  the cookie secret), the pages (and their .bak), and putFile when its rename
  failed on Windows and it copied the temp file over the target instead. A
  session log set was written in place the same way.

    A  In site/server.js and site/lib, nothing copies a file over another,
       and every writeFileSync writes a temp file.
    B  config.json: a crash part way through the site's write of it leaves
       it as it was; a rename that fails is said, and leaves it as it was.
    C  A page: a crash part way through writing the page, or its .bak,
       leaves each as it was; a rename that fails is said and refused, the
       page as it was; a save that works writes the page and keeps the old
       one as the .bak.
    D  putFile: a rename that fails is said and refused, the file as it was
       and no temp file left.
    E  A session log set: a crash part way through leaves it as it was.

  A crash is a preload that writes the first half of the body to the file
  the site writes, then kills the process. A refused rename is a preload
  that refuses renameSync onto that file with EPERM, as Windows refuses a
  rename onto a file another program holds open.

  Nothing leaves the machine. The scratch folders are removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..');
const SITE_SRC = path.resolve(process.argv[2] || path.join(APP, 'server.js'));
const SRC_DIR = path.dirname(SITE_SRC);

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ').slice(0, 600) : '')); }
}

/* The faults, read from the file TS_FAULT names: crash, a list of file
   names whose write is cut in half and the process killed; rename, a list
   of file names a rename onto is refused. A temp file beside a name counts
   as the name only for the crash, since a crash while writing the temp file
   is the crash a whole write lives through. Just before the kill it leaves
   the name in killed.txt beside TS_FAULT, since a kill on Windows ends the
   process with exit code 1 and no signal, as a failure would. */
function fault() {
  const fs = require('fs');
  const path = require('path');
  const asked = () => { try { return JSON.parse(fs.readFileSync(process.env.TS_FAULT, 'utf8')); } catch (e) { return {}; } };
  const named = (p) => path.basename(p).replace(/^\.(.+)\.\d+\.tmp$/, '$1');
  const write = fs.writeFileSync;
  fs.writeFileSync = function (p, body) {
    if (typeof p === 'string' && (asked().crash || []).indexOf(named(p)) >= 0) {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      write.call(fs, p, b.subarray(0, Math.floor(b.length / 2)));
      write.call(fs, path.join(path.dirname(process.env.TS_FAULT), 'killed.txt'), named(p));
      process.kill(process.pid, 'SIGKILL');
    }
    return write.apply(this, arguments);
  };
  const copy = fs.copyFileSync;
  fs.copyFileSync = function (from, to) {
    if (typeof to === 'string' && (asked().crash || []).indexOf(path.basename(to)) >= 0) {
      const b = fs.readFileSync(from);
      write.call(fs, to, b.subarray(0, Math.floor(b.length / 2)));
      write.call(fs, path.join(path.dirname(process.env.TS_FAULT), 'killed.txt'), path.basename(to));
      process.kill(process.pid, 'SIGKILL');
    }
    return copy.apply(this, arguments);
  };
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (typeof to === 'string' && (asked().rename || []).indexOf(path.basename(to)) >= 0) {
      const e = new Error('EPERM: operation not permitted, rename \'' + from + '\' -> \'' + to + '\'');
      e.code = 'EPERM';
      throw e;
    }
    return rename.apply(this, arguments);
  };
}

const tmpsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => /\.tmp$/.test(n));

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5890-'));
  siteFiles.copy(dir, SITE_SRC);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fault.js'), '(' + fault.toString() + ')();\n');
  fs.writeFileSync(path.join(dir, 'fault.json'), '{}');
  return dir;
}
function config(dir, withSecret) {
  const c = {
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: '1', clientSecret: crypto.randomBytes(16).toString('hex'), botToken: crypto.randomBytes(24).toString('hex'), guildId: '2', invite: '' },
    botKey: crypto.randomBytes(16).toString('hex'), admins: [], passKey: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  };
  if (withSecret) c.secret = crypto.randomBytes(32).toString('hex');
  const text = JSON.stringify(c, null, 2);
  fs.writeFileSync(path.join(dir, 'config.json'), text);
  return text;
}
const ENV = (dir) => Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
  THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), TS_FAULT: path.join(dir, 'fault.json') });
const faults = (dir, f) => {
  fs.rmSync(path.join(dir, 'killed.txt'), { force: true });
  fs.writeFileSync(path.join(dir, 'fault.json'), JSON.stringify(f));
};
// The file the preload was writing when it killed the process, or ''.
const killed = (dir) => { try { return fs.readFileSync(path.join(dir, 'killed.txt'), 'utf8'); } catch (e) { return ''; } };

// Runs a few lines in a copy of the site, with the faults loaded.
function run(dir, code) {
  const r = spawnSync(process.execPath, ['-r', path.join(dir, 'fault.js'), '-e', code], { cwd: dir, env: ENV(dir), encoding: 'utf8', timeout: 60000 });
  return { out: (r.stdout || '') + (r.stderr || ''), signal: r.signal, status: r.status };
}
// Starts a copy of the site, with the faults loaded, until it listens or stops.
async function start(dir) {
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'fault.js'), 'server.js'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: ENV(dir) });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const ended = new Promise((ok) => srv.on('exit', (code, signal) => ok(signal || code)));
  let listened = true;
  try { await siteFiles.listening(srv, 20000); } catch (e) { listened = false; }
  try { srv.kill(); } catch (e) { /* already gone */ }
  const how = await ended;
  return { out, listened, how };
}
const wipe = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); } };

(async () => {
  // ---- A ---------------------------------------------------------------
  console.log('A. no write in place:');
  const files = [SITE_SRC].concat(fs.readdirSync(path.join(SRC_DIR, 'lib')).filter((n) => /\.js$/.test(n)).map((n) => path.join(SRC_DIR, 'lib', n)));
  const copies = [], inPlace = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      const at = path.relative(SRC_DIR, f) + ':' + (i + 1);
      if (/\bcopyFileSync\s*\(/.test(l)) copies.push(at);
      const m = /\bwriteFileSync\s*\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(l);
      if (/\bwriteFileSync\s*\(/.test(l) && !(m && /^(tmp|temp)$/.test(m[1]))) inPlace.push(at + ' ' + l.trim().slice(0, 80));
    });
  }
  yes('A1 nothing in the site copies a file over another (' + copies.join(', ') + ')', copies.length === 0);
  yes('A2 and every writeFileSync writes a temp file', inPlace.length === 0, inPlace.join('\n'));

  // ---- B ---------------------------------------------------------------
  console.log('\nB. config.json:');
  let dir = scratch();
  try {
    const was = config(dir, false);
    faults(dir, { crash: ['config.json'] });
    const r = await start(dir);
    const now = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    yes('B1 the site was killed part way through writing config.json (' + killed(dir) + ', ' + r.how + ')', killed(dir) === 'config.json' && r.how !== 0 && !r.listened, r.out);
    yes('B2 and config.json is as it was, whole', now === was, now.slice(0, 200));
  } finally { wipe(dir); }
  dir = scratch();
  try {
    const was = config(dir, false);
    faults(dir, { rename: ['config.json'] });
    const r = await start(dir);
    const now = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    yes('B3 with the rename refused, the site starts and says it (' + (r.out.match(/could not keep the new cookie secret[^\n]*/) || [''])[0] + ')',
      r.listened && /could not keep the new cookie secret in config\.json \(EPERM\)/.test(r.out), r.out);
    yes('B4 and config.json is as it was, with no temp file left', now === was && tmpsIn(dir).length === 0, tmpsIn(dir).join(', '));
  } finally { wipe(dir); }

  // ---- C, D, E -----------------------------------------------------------
  dir = scratch();
  try {
    config(dir, true);
    const DATA = path.join(dir, 'data');
    const PAGE = path.join(DATA, 'help.md'), BAK = PAGE + '.bak';
    const OLD = '# Help\n\nThe page as it was, ' + 'long enough to cut. '.repeat(40) + '\n';
    const OLDER = '# Help\n\nThe one before. ' + 'x'.repeat(400) + '\n';
    const NEW = '# Help\n\nThe page as saved. ' + 'y'.repeat(800) + '\n';
    const save = 'const s = require("./lib/store"); console.log("saved=" + s.writeDoc("help", ' + JSON.stringify(NEW) + '));';
    // A crash leaves its half-written temp file beside the page until the
    // site next starts (#7437), and these cases never start it, so each
    // case starts without the last one's.
    const reset = () => {
      fs.writeFileSync(PAGE, OLD); fs.writeFileSync(BAK, OLDER);
      for (const n of tmpsIn(DATA)) fs.unlinkSync(path.join(DATA, n));
    };

    console.log('\nC. a page:');
    reset(); faults(dir, { crash: ['help.md'] });
    let r = run(dir, save);
    yes('C1 the save was killed part way through writing the page (' + killed(dir) + ')', killed(dir) === 'help.md' && r.status !== 0 && !/saved=/.test(r.out), r.out);
    yes('C2 and the page is as it was, whole', fs.readFileSync(PAGE, 'utf8') === OLD);
    reset(); faults(dir, { crash: ['help.md.bak'] });
    r = run(dir, save);
    yes('C3 a save killed part way through writing the .bak (' + killed(dir) + ')', killed(dir) === 'help.md.bak' && r.status !== 0 && !/saved=/.test(r.out), r.out);
    yes('C4 leaves the .bak as it was, whole, and the page too', fs.readFileSync(BAK, 'utf8') === OLDER && fs.readFileSync(PAGE, 'utf8') === OLD);
    reset(); faults(dir, { rename: ['help.md'] });
    r = run(dir, save);
    yes('C5 with the rename refused, the save is refused and said (' + (r.out.match(/saved=\w+/) || [''])[0] + ')',
      /saved=false/.test(r.out) && /could not save help\.md \(EPERM\)/.test(r.out), r.out);
    yes('C6 and the page is as it was, with no temp file left', fs.readFileSync(PAGE, 'utf8') === OLD && tmpsIn(DATA).length === 0, tmpsIn(DATA).join(', '));
    reset(); faults(dir, {});
    r = run(dir, save);
    yes('C7 with nothing refused, the page is saved and the old one kept as the .bak',
      /saved=true/.test(r.out) && fs.readFileSync(PAGE, 'utf8') === NEW && fs.readFileSync(BAK, 'utf8') === OLD && tmpsIn(DATA).length === 0, r.out);

    console.log('\nD. putFile:');
    const STORE = path.join(DATA, 'kept.json');
    fs.writeFileSync(STORE, '{"kept":true}');
    reset();
    faults(dir, { rename: ['kept.json'] });
    r = run(dir, 'const s = require("./lib/store"); console.log("put=" + s.putFile(' + JSON.stringify(STORE) + ', "{\\"kept\\":false}"));');
    yes('D1 with the rename refused, putFile refuses and says it (' + (r.out.match(/put=\w+/) || [''])[0] + ')',
      /put=false/.test(r.out) && /could not put kept\.json in place \(EPERM\)/.test(r.out), r.out);
    yes('D2 and the file is as it was, with no temp file left', fs.readFileSync(STORE, 'utf8') === '{"kept":true}' && tmpsIn(DATA).length === 0, tmpsIn(DATA).join(', '));

    console.log('\nE. a session log set:');
    const SET = path.join(DATA, 'set.json');
    const SET_WAS = JSON.stringify({ at: Date.now(), lines: ['a'.repeat(500)] });
    fs.writeFileSync(SET, SET_WAS);
    faults(dir, { crash: ['set.json'] });
    r = run(dir, 'const s = require("./lib/sessions"); s.writeSlogSet(' + JSON.stringify(SET) + ', { at: Date.now(), lines: ["' + 'b'.repeat(900) + '"] });');
    yes('E1 the write was killed part way through (' + killed(dir) + ')', killed(dir) === 'set.json' && r.status !== 0, r.out);
    yes('E2 and the set is as it was, whole', fs.readFileSync(SET, 'utf8') === SET_WAS);
  } finally { wipe(dir); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exitCode = 1; });
