'use strict';
/*
  test-7437-left-writes.js

      node .\site\tests\test-7437-left-writes.js
      node .\site\tests\test-7437-left-writes.js <an older server.js>

  Issue #7437. Every whole write on the site (site/lib/whole.js, writeWhole)
  writes a temp file named .<name>.<process id>.tmp beside the file and
  renames it in. A site killed part way through left that temp file for
  good: the next run has another process id, so it never wrote over it, and
  nothing looked for it. config.json's holds the Discord secret, the bot
  token, botKey and the cookie secret.

    A  A start killed part way through writing config.json leaves its temp
       file; the next start removes it and says so, and starts.
    B  A page save killed part way through leaves its temp file; the next
       start removes it, and one in a folder under data, and says each.
    C  The next start leaves alone a temp file whose writer is still
       running (it says so), a .tmp that is not writeWhole's name, and
       anything under node_modules or a folder whose name starts with a dot.

  A crash is a preload that writes the first half of the body to the temp
  file, then kills the process, as test-5890-whole-writes.js does.

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

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ').slice(0, 800) : '')); }
}

/* The crash, read from the file TS_FAULT names: a list of file names whose
   temp file's write is cut in half and the process killed. */
function fault() {
  const fs = require('fs');
  const path = require('path');
  const asked = () => { try { return JSON.parse(fs.readFileSync(process.env.TS_FAULT, 'utf8')); } catch (e) { return {}; } };
  const temp = /^\.(.+)\.\d+\.tmp$/;
  const write = fs.writeFileSync;
  fs.writeFileSync = function (p, body) {
    const m = typeof p === 'string' ? temp.exec(path.basename(p)) : null;
    if (m && (asked().crash || []).indexOf(m[1]) >= 0) {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      write.call(fs, p, b.subarray(0, Math.floor(b.length / 2)));
      write.call(fs, path.join(path.dirname(process.env.TS_FAULT), 'killed.txt'), path.basename(p));
      process.kill(process.pid, 'SIGKILL');
    }
    return write.apply(this, arguments);
  };
}

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-7437-'));
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
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c, null, 2));
}
const ENV = (dir) => Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
  THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), TS_FAULT: path.join(dir, 'fault.json') });
const faults = (dir, f) => {
  fs.rmSync(path.join(dir, 'killed.txt'), { force: true });
  fs.writeFileSync(path.join(dir, 'fault.json'), JSON.stringify(f));
};
const killed = (dir) => { try { return fs.readFileSync(path.join(dir, 'killed.txt'), 'utf8'); } catch (e) { return ''; } };
const tmpsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => /^\..+\.\d+\.tmp$/.test(n));

function run(dir, code) {
  const r = spawnSync(process.execPath, ['-r', path.join(dir, 'fault.js'), '-e', code], { cwd: dir, env: ENV(dir), encoding: 'utf8', timeout: 60000 });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}
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
const said = (out, re) => (out.match(re) || [''])[0];

(async () => {
  // ---- A ---------------------------------------------------------------
  console.log('A. config.json:');
  let dir = scratch();
  try {
    config(dir, false);
    faults(dir, { crash: ['config.json'] });
    let r = await start(dir);
    const left = killed(dir);
    yes('A1 a start was killed part way through writing config.json (' + left + ')',
      /^\.config\.json\.\d+\.tmp$/.test(left) && !r.listened && fs.existsSync(path.join(dir, left)), r.out);
    faults(dir, {});
    r = await start(dir);
    yes('A2 the next start removes its temp file', !fs.existsSync(path.join(dir, left)) && tmpsIn(dir).length === 0, tmpsIn(dir).join(', '));
    yes('A3 says so (' + said(r.out, /removed \.config[^\n]*/) + ')',
      r.out.indexOf('removed ' + left + ', left by a write cut off when the site last stopped') >= 0, r.out);
    yes('A4 and starts', r.listened, r.out);
  } finally { wipe(dir); }

  // ---- B, C --------------------------------------------------------------
  dir = scratch();
  try {
    config(dir, true);
    const DATA = path.join(dir, 'data');
    const LOGS = path.join(DATA, 'session-logs');
    fs.mkdirSync(LOGS, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'help.md'), '# Help\n\n' + 'The page as it was. '.repeat(40) + '\n');

    console.log('\nB. a page and a folder under data:');
    faults(dir, { crash: ['help.md'] });
    let r = run(dir, 'require("./lib/store").writeDoc("help", ' + JSON.stringify('# Help\n\n' + 'y'.repeat(800)) + ');');
    const page = killed(dir);
    yes('B1 a page save was killed part way through (' + page + ')',
      /^\.help\.md\.\d+\.tmp$/.test(page) && r.status !== 0 && fs.existsSync(path.join(DATA, page)), r.out);
    // One a write into session-logs left, from a process that has ended.
    const done = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    const gone = Number(String(done.stdout).trim());
    const deep = '.set.json.' + gone + '.tmp';
    fs.writeFileSync(path.join(LOGS, deep), '{"half":');

    // C: what the start must leave.
    const mine = '.pk.json.' + process.pid + '.tmp';           // this test is running
    fs.writeFileSync(path.join(DATA, mine), 'a write under way');
    fs.writeFileSync(path.join(DATA, 'notes.tmp'), 'not writeWhole\'s name');
    fs.writeFileSync(path.join(DATA, '.notes.tmp'), 'not writeWhole\'s name');
    fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'x', '.a.js.' + gone + '.tmp'), 'a package\'s own');
    fs.mkdirSync(path.join(dir, 'uploads', '.part'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploads', '.part', '.b.' + gone + '.tmp'), 'clearPartUploads owns this folder');

    faults(dir, {});
    r = await start(dir);
    yes('B2 the next start removes the page\'s temp file', !fs.existsSync(path.join(DATA, page)));
    yes('B3 and the one in data/session-logs', !fs.existsSync(path.join(LOGS, deep)));
    yes('B4 says each one it removed',
      r.out.indexOf('removed ' + path.join('data', page) + ', left by') >= 0 &&
      r.out.indexOf('removed ' + path.join('data', 'session-logs', deep) + ', left by') >= 0, r.out);
    yes('B5 and starts', r.listened, r.out);

    console.log('\nC. what it leaves:');
    yes('C1 a temp file whose writer is still running is left (' + said(r.out, /left data[^\n]*/) + ')',
      fs.existsSync(path.join(DATA, mine)) && r.out.indexOf('left ' + path.join('data', mine) + ': process ' + process.pid + ' is running') >= 0, r.out);
    yes('C2 a .tmp of any other name is left', fs.existsSync(path.join(DATA, 'notes.tmp')) && fs.existsSync(path.join(DATA, '.notes.tmp')));
    yes('C3 node_modules is not looked in', fs.existsSync(path.join(dir, 'node_modules', 'x', '.a.js.' + gone + '.tmp')));
    yes('C4 nor a folder whose name starts with a dot',
      fs.existsSync(path.join(dir, 'uploads', '.part', '.b.' + gone + '.tmp')) || !/removed[^\n]*\.part/.test(r.out), r.out);
  } finally { wipe(dir); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  the harness itself threw: ' + String(e && e.stack || e).replace(/\n/g, '\n      ')); process.exitCode = 1; });
