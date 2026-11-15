/*
  test-4251-config-kept-as-read.js

      node site\tests\test-4251-config-kept-as-read.js

  Issue #4251. site/lib/config.js reads config.json, then changes what it
  read for this run: "open" made a real true or false, Member put on
  access.play when open is true (playRoles), and default lists filled in.
  When it then made a cookie secret, a join pass key or a member password,
  it wrote the whole of that changed config back to config.json. So turning
  the open switch on saved Member into the play list, and turning it off
  again left Members able to play; and "open": "true" was saved as false.

  Against the real base.js and config.js copied into a temp folder, loaded
  in a child process with a config.json of its own each time:

    A  open on, with no secret yet: the file keeps the play list it had, and
       once open is turned off again Member is not on the play list;
    B  "open": "true" is kept in the file as it was written;
    C  nothing load fills in is written: no access.dev, devBuild, company
       or slots3, and the discord block as the file had it;
    D  the cookie secret, the join pass key and the member password made
       are kept in the file, and a second start keeps them and writes
       nothing;
    E  with no config.json at all, the one written holds the defaults as
       declared (open false, no Member to play) and the three made keys.

  Read only apart from its own temp folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB = path.join(__dirname, '..', 'lib');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 800) : '')); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4251-'));
let n = 0;
/* A site folder of its own with config.js and base.js, and config.json as
   given (null for none). */
function site(config) {
  const root = path.join(tmp, 'site' + (n++));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  for (const f of ['base.js', 'config.js']) fs.copyFileSync(path.join(LIB, f), path.join(root, 'lib', f));
  if (config !== null) fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 2));
  return root;
}
/* Start config.js there as the site does, and say what it holds. */
function load(root) {
  const out = execFileSync(process.execPath, ['-e',
    'const c = require(' + JSON.stringify(path.join(root, 'lib', 'config.js')) + ').cfg;' +
    'process.stdout.write("\\n@@" + JSON.stringify({ open: c.open, play: c.access.play }));'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.lastIndexOf('\n@@') + 3));
}
const file = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const PLAY = ['Owner', 'Playtester'];

try {
  console.log('A. open on, then off again:');
  const a = site({ open: true, access: { play: PLAY } });
  const aRun = load(a);
  yes('while open, this run lets Member play', aRun.play.indexOf('Member') >= 0, JSON.stringify(aRun));
  const aFile = file(a);
  yes('the file keeps the play list it had (' + JSON.stringify(aFile.access && aFile.access.play) + ')',
      JSON.stringify(aFile.access && aFile.access.play) === JSON.stringify(PLAY));
  aFile.open = false;
  fs.writeFileSync(path.join(a, 'config.json'), JSON.stringify(aFile, null, 2));
  const aOff = load(a);
  yes('turned off again, Member is not on the play list (' + JSON.stringify(aOff.play) + ')',
      aOff.play.indexOf('Member') < 0);

  console.log('\nB. open as the text "true":');
  const b = site({ open: 'true', access: { play: PLAY } });
  const bRun = load(b);
  yes('this run reads it as off', bRun.open === false && bRun.play.indexOf('Member') < 0, JSON.stringify(bRun));
  yes('and the file keeps it as it was written (' + JSON.stringify(file(b).open) + ')', file(b).open === 'true');

  console.log('\nC. nothing load fills in is written:');
  const c = site({ access: { play: PLAY }, discord: { clientId: 'abc' } });
  load(c);
  const cFile = file(c);
  yes('the access block is the file\'s own (' + JSON.stringify(Object.keys(cFile.access || {})) + ')',
      JSON.stringify(Object.keys(cFile.access || {})) === '["play"]');
  yes('the discord block is the file\'s own', JSON.stringify(cFile.discord) === '{"clientId":"abc"}', JSON.stringify(cFile.discord));
  yes('open is not added', !('open' in cFile));

  console.log('\nD. what is made is kept:');
  yes('the cookie secret is in the file', typeof cFile.secret === 'string' && cFile.secret.length >= 32);
  yes('the join pass key is in the file', typeof cFile.passKey === 'string' && cFile.passKey.length >= 32);
  yes('the member password is in the file', typeof cFile.password === 'string' && cFile.password.length >= 32);
  const before = fs.readFileSync(path.join(c, 'config.json'), 'utf8');
  load(c);
  yes('a second start writes nothing', fs.readFileSync(path.join(c, 'config.json'), 'utf8') === before);

  console.log('\nE. no config.json at all:');
  const e = site(null);
  load(e);
  const eFile = file(e);
  yes('the file is the declared defaults: open false', eFile.open === false);
  yes('and a play list with no Member', Array.isArray(eFile.access && eFile.access.play) &&
      eFile.access.play.indexOf('Member') < 0 && eFile.access.play.indexOf('Playtester') >= 0);
  yes('with the secret, the pass key and the password made', !!eFile.secret && !!eFile.passKey && !!eFile.password);
} catch (err) {
  yes('the harness ran to the end: ' + (err && err.stack || err), false, err && err.stderr);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
