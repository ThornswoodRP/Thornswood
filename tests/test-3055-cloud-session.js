/*
  test-3055-cloud-session.js

  #3055. A cloud thread had no Python that loads the bot, so the bot
  harnesses failed or skipped there over nothing the thread changed.
  scripts/dev/Setup-CloudSession.sh puts bot/requirements.txt into python3.12:
  the cloud environment's setup script runs it with --register, which adds it
  to the user's Claude settings as a SessionStart hook, and the hook runs it at
  every cloud session start.

  A  nothing in the repository registers it, so a Claude on One or on a
     developer's PC never runs it, and it installs exactly the bot's pins:
     bot/requirements.txt, by hash, wheels only, into python3.12.
  B  as the hook, outside a cloud session (CLAUDE_CODE_REMOTE not true) it
     does nothing at all: no output, and no Python asked.
  C  in a cloud session it runs that one pip line, says one line when it
     worked, and when pip fails it says so with pip's own words and exit 1.
     #5231: it also writes the session's git identity, EvilPatrick06 by his
     noreply address, into the CLAUDE_ENV_FILE Claude Code gives the hook,
     and says so in one line; with no CLAUDE_ENV_FILE it says the identity
     was not set and goes on. --register writes no identity. #5291: it
     sets the clone's core.hooksPath to .githooks, so the pre-push checks
     run before every push, and says so; --register sets nothing.
  D  --register adds the hook once to the settings it is pointed at and keeps
     every other key; off Linux it refuses and writes nothing.
  E  scripts/dev/cloud-environment-setup.sh, the text of the environment's
     setup script, which every session of the environment runs, the project
     chat too (#3085): it is stored LF, names the clone in one place, and
     runs Setup-CloudSession.sh --register only when the clone is there. A
     session with no clone gets through it with exit 0, one with the clone
     runs the register line, and one whose clone lacks the script stops.

  B to E run the script with bash and a stand-in python3.12 that only writes
  down how it was called, so nothing is installed. They need a Linux bash: on
  Windows `bash` can be WSL's or Git's, and the script never runs there, so
  they say SKIP. E runs a copy of the setup script with its clone line
  pointed at a temp folder and every installer on PATH a stand-in, so it
  installs nothing. Writes only its own temp folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'dev', 'Setup-CloudSession.sh');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- A ----------------------------------------------------------------------
yes('A1 scripts/dev/Setup-CloudSession.sh is in the repository', fs.existsSync(SCRIPT));
// A Windows checkout can hold it CRLF (A5 checks what is stored), so the
// text is read without CRs.
const src = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8').split('\r').join('') : '';
let claudeFiles = [];
try {
  claudeFiles = cp.execFileSync('git', ['ls-files', '-z', '--', '.claude'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean)
    .filter(function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf('Setup-CloudSession') >= 0; });
}
catch (e) { console.log('NOTE  git did not answer, so .claude was not read: ' + e.message); }
yes('A2 no file the repository carries under .claude runs it (it is the cloud environment\'s, never One\'s)' +
  (claudeFiles.length ? ' (' + claudeFiles.join('; ') + ')' : ''), claudeFiles.length === 0);
const pipLine = (/python3\.12 -m pip install[^\n]*\\\n[^\n]*/.exec(src) || [''])[0];
yes('A3 it installs into python3.12 with --require-hashes and --only-binary :all:',
  pipLine.indexOf('--require-hashes') >= 0 && pipLine.indexOf('--only-binary :all:') >= 0);
yes('A4 from bot/requirements.txt, the bot\'s own pins, and from no other list',
  pipLine.indexOf('-r "$repo/bot/requirements.txt"') >= 0 && (src.match(/ -r /g) || []).length === 1);
// Stored LF is what a Linux checkout gets; a Windows one may hold it CRLF,
// and never runs it.
let eol = '';
try { eol = cp.execFileSync('git', ['ls-files', '--eol', '--', 'scripts/dev/Setup-CloudSession.sh'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
catch (e) { eol = 'git did not answer: ' + e.message; }
yes('A5 it is stored LF, so bash reads it on the Linux machine it runs on (' + eol + ')', /^i\/lf\s/.test(eol));

// ---- E, what can be read on any machine -------------------------------------
const SETUP = path.join(ROOT, 'scripts', 'dev', 'cloud-environment-setup.sh');
yes('E1 scripts/dev/cloud-environment-setup.sh, the setup script\'s text, is in the repository', fs.existsSync(SETUP));
const setupSrc = fs.existsSync(SETUP) ? fs.readFileSync(SETUP, 'utf8').split('\r').join('') : '';
let setupEol = '';
try { setupEol = cp.execFileSync('git', ['ls-files', '--eol', '--', 'scripts/dev/cloud-environment-setup.sh'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
catch (e) { setupEol = 'git did not answer: ' + e.message; }
yes('E2 it is stored LF (' + setupEol + ')', /^i\/lf\s/.test(setupEol));
const CLONE_LINE = 'clone=/home/user/Thornswood';
yes('E3 it names the clone in one line, ' + CLONE_LINE + ', and nowhere else',
  setupSrc.split('\n').filter(function (l) { return l === CLONE_LINE; }).length === 1 &&
  setupSrc.split('/home/user/Thornswood').length === 2);
yes('E4 it stops at the first failure (set -euo pipefail)', /^set -euo pipefail$/m.test(setupSrc));

// ---- B to D -------------------------------------------------------------------
if (process.platform === 'win32') {
  console.log('SKIP  B to D: Windows, where the script never runs and bash may be WSL\'s (A checked it here)');
}
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't3055-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(tmp, 'calls.txt');
  const stub = path.join(bin, 'python3.12');
  function stand(code) {
    fs.writeFileSync(stub, '#!/bin/sh\necho "$*" >> \'' + calls + '\'\n' +
      (code ? 'echo "ERROR: stand-in pip said no" >&2\n' : '') + 'exit ' + code + '\n');
    fs.chmodSync(stub, 0o755);
  }
  // #5291: the hook sets this clone's core.hooksPath. GIT_DIR points every
  // git it runs at a bare stand-in, so the real clone's config is never
  // written, and C7 reads the stand-in's.
  const fakeGit = path.join(tmp, 'clone.git');
  cp.execFileSync('git', ['init', '-q', '--bare', fakeGit]);
  function run(args, env) {
    const e = Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, GIT_DIR: fakeGit }, env || {});
    for (const k of Object.keys(e)) { if (e[k] === null) { delete e[k]; } }
    return cp.spawnSync('bash', [SCRIPT].concat(args || []), { env: e, encoding: 'utf8' });
  }
  function called() { return fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''; }

  try {
    stand(0);
    // B
    let r = run([], { CLAUDE_CODE_REMOTE: null });
    yes('B1 with CLAUDE_CODE_REMOTE unset it exits 0 and says nothing',
      r.status === 0 && r.stdout === '' && r.stderr === '');
    r = run([], { CLAUDE_CODE_REMOTE: 'false' });
    yes('B2 with CLAUDE_CODE_REMOTE false it exits 0 and says nothing', r.status === 0 && r.stdout === '' && r.stderr === '');
    yes('B3 and no Python was asked either time', called() === '');

    // C
    const envFile = path.join(tmp, 'session.env');
    r = run([], { CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile });
    const line = called().trim();
    yes('C1 in a cloud session it exits 0 (' + r.status + ') with one line each for the identity, the pre-push checks and the libraries',
      r.status === 0 && r.stdout.trim().split('\n').length === 3 && r.stderr === '');
    let hooks = '';
    try { hooks = cp.execFileSync('git', ['--git-dir', fakeGit, 'config', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch (e) { hooks = 'not set'; }
    yes('C7 #5291: it points the clone\'s hooks at .githooks, so a push runs the pre-push checks (' + hooks + '), and says so',
      hooks === '.githooks' && r.stdout.indexOf('pre-push checks (#5291)') >= 0);
    const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    const envLines = envText.trim().split('\n');
    const NOREPLY = '187923600+EvilPatrick06@users.noreply.github.com';
    yes('C4 #5231: the session\'s environment file makes its commits EvilPatrick06\'s, author and committer (' + envLines.length + ' lines)',
      envLines.length === 4 &&
      envLines.indexOf("export GIT_AUTHOR_NAME='EvilPatrick06'") >= 0 &&
      envLines.indexOf("export GIT_AUTHOR_EMAIL='" + NOREPLY + "'") >= 0 &&
      envLines.indexOf("export GIT_COMMITTER_NAME='EvilPatrick06'") >= 0 &&
      envLines.indexOf("export GIT_COMMITTER_EMAIL='" + NOREPLY + "'") >= 0);
    let who = '';
    try {
      who = cp.execFileSync('bash', ['-c', '. "$1"; git var GIT_AUTHOR_IDENT; git var GIT_COMMITTER_IDENT', 'x', envFile],
        { encoding: 'utf8' });
    }
    catch (e) { who = 'git var failed: ' + e.message; }
    yes('C5 and git, with that file read, names EvilPatrick06 as author and committer',
      who.split('\n').filter(function (l) { return l.indexOf('EvilPatrick06 <' + NOREPLY + '>') === 0; }).length === 2);
    fs.unlinkSync(calls);
    r = run([], { CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: null });
    yes('C6 with no CLAUDE_ENV_FILE it says the identity was not set, and still installs and exits 0',
      r.status === 0 && r.stderr.indexOf('no CLAUDE_ENV_FILE') >= 0 && /--require-hashes/.test(called()));
    yes('C2 having asked python3.12 for exactly bot/requirements.txt, by hash, wheels only (' + line + ')',
      line.indexOf('-m pip install --user --break-system-packages --require-hashes --only-binary :all:') === 0 &&
      line.indexOf('-r ' + path.join(ROOT, 'bot', 'requirements.txt')) >= 0);
    fs.unlinkSync(calls);
    stand(1);
    r = run([], { CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile });
    yes('C3 when pip fails it exits 1 and passes on pip\'s words',
      r.status === 1 && r.stderr.indexOf('stand-in pip said no') >= 0 && r.stderr.indexOf('bot/requirements.txt') >= 0);
    stand(0);

    // D
    const cfg = path.join(tmp, 'cfg');
    fs.mkdirSync(cfg);
    const settings = path.join(cfg, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ model: 'kept', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } }));
    const uname = cp.spawnSync('uname', ['-s'], { encoding: 'utf8' }).stdout.trim();
    const regEnv = path.join(tmp, 'register.env');
    cp.spawnSync('git', ['--git-dir', fakeGit, 'config', '--unset', 'core.hooksPath']);
    r = run(['--register'], { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_REMOTE: null, CLAUDE_ENV_FILE: regEnv });
    if (uname === 'Linux') {
      r = run(['--register'], { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_REMOTE: null, CLAUDE_ENV_FILE: regEnv });
      yes('D6 #5231: --register, at image build, writes no git identity', !fs.existsSync(regEnv));
      const regHooks = cp.spawnSync('git', ['--git-dir', fakeGit, 'config', 'core.hooksPath'], { encoding: 'utf8' });
      yes('D7 #5291: and sets no hooks folder, which is the session\'s clone\'s to set', regHooks.status === 1 && regHooks.stdout === '');
      const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
      const start = ((s.hooks || {}).SessionStart || []);
      const cmds = [].concat.apply([], start.map(function (g) { return (g.hooks || []).map(function (h) { return h.command; }); }));
      yes('D1 two runs of --register exit 0 and leave one SessionStart hook', r.status === 0 && cmds.length === 1);
      yes('D2 which runs this script when it is there (' + cmds[0] + ')',
        cmds.length === 1 && cmds[0] === "test ! -f '" + SCRIPT + "' || bash '" + SCRIPT + "'");
      yes('D3 and every other key in the settings is as it was',
        s.model === 'kept' && JSON.stringify(s.hooks.Stop) === JSON.stringify([{ hooks: [{ type: 'command', command: 'true' }] }]));
      yes('D4 --register installs too, so the image holds the libraries before any session', /--require-hashes/.test(called()));
    }
    else {
      yes('D1 off Linux (' + uname + ') --register refuses with exit 2 and writes nothing',
        r.status === 2 && fs.readFileSync(settings, 'utf8').indexOf('SessionStart') < 0 && called() === '');
    }
    r = run(['--bogus'], { CLAUDE_CODE_REMOTE: 'true' });
    yes('D5 an option it does not know stops it with exit 2', r.status === 2);

    // E, run
    const ebin = path.join(tmp, 'ebin');
    fs.mkdirSync(ebin);
    const ecalls = path.join(tmp, 'ecalls.txt');
    // Every command the setup script runs that would install, download or
    // touch the image: a stand-in that writes down its name and arguments.
    // sha256sum reads the line piped to it, as the real one does: one that
    // exits without reading can end before echo writes, and under
    // set -o pipefail echo's SIGPIPE then ends the script 141 (seen on a busy
    // machine on 22 Oct 2026, #3114).
    ['pwsh', 'curl', 'dpkg', 'apt-get', 'npm', 'sha256sum', 'install', 'ln', 'ls',
      'chromium', 'lighthouse', 'linkinator', 'osv-scanner'].forEach(function (n) {
      fs.writeFileSync(path.join(ebin, n), '#!/bin/sh\n' + (n === 'sha256sum' ? 'cat > /dev/null\n' : '') + 'echo "' + n + ' $*" >> \'' + ecalls + '\'\nexit 0\n');
      fs.chmodSync(path.join(ebin, n), 0o755);
    });
    function setup(clone) {
      const copy = path.join(tmp, 'setup.sh');
      fs.writeFileSync(copy, setupSrc.split(CLONE_LINE).join("clone='" + clone + "'"));
      if (fs.existsSync(ecalls)) { fs.unlinkSync(ecalls); }
      const e = Object.assign({}, process.env, { PATH: ebin + path.delimiter + process.env.PATH });
      return cp.spawnSync('bash', [copy], { env: e, encoding: 'utf8' });
    }
    function ecalled() { return fs.existsSync(ecalls) ? fs.readFileSync(ecalls, 'utf8') : ''; }

    r = setup(path.join(tmp, 'no-clone'));
    yes('E5 with no clone (the project chat) the setup script exits 0 (' + r.status + ': ' + r.stderr.trim().split('\n').pop() + ')',
      r.status === 0 && r.stdout.indexOf('No Thornswood clone in this session') >= 0);
    yes('E6 having run every step before the clone\'s', /^npm install -g /m.test(ecalled()) && /^osv-scanner --version$/m.test(ecalled()));

    const fake = path.join(tmp, 'clone');
    fs.mkdirSync(path.join(fake, '.git'), { recursive: true });
    fs.mkdirSync(path.join(fake, 'scripts', 'dev'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'scripts', 'dev', 'Setup-CloudSession.sh'), 'echo "register $*" >> \'' + ecalls + '\'\n');
    r = setup(fake);
    yes('E7 with the clone it exits 0 having run Setup-CloudSession.sh --register from it (' + r.status + ')',
      r.status === 0 && /^register --register$/m.test(ecalled()) && r.stdout.indexOf('No Thornswood clone') < 0);

    fs.unlinkSync(path.join(fake, 'scripts', 'dev', 'Setup-CloudSession.sh'));
    r = setup(fake);
    yes('E8 a clone without Setup-CloudSession.sh stops the setup script (' + r.status + ')', r.status !== 0);
  }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
