// Runs the real site log out of site\server.js against a temp folder.
//
// server.js opens a port and reads a config when it is required, so the block
// between the two markers is taken out and driven on its own. It needs fs and
// path, which it gets from this file's own requires, and nothing else.

const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');
const siteFiles = require('../../tests/site-files');

const SRC = path.join(REPO_DIR, 'site', 'server.js');
const text = siteFiles.source(SRC);
const a = text.indexOf('function makeLog(dir, name, maxBytes, keep, opts) {');
const b = text.indexOf('// Four megabytes is a few days');
if (a < 0 || b < 0) {
  console.error('the site log block is not in server.js the way this expects');
  process.exit(1);
}
eval(text.slice(a, b));

let pass = 0, fail = 0;
function check(what, got, want) {
  if (String(got) === String(want)) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + '\n      wanted [' + want + '] got [' + got + ']'); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-sitelog-'));
process.on('exit', function () {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { }
});

// A tiny cap, so rolling happens after a line or two rather than after four
// megabytes of them.
const log = makeLog(work, 'site.log', 200, 3);

check('it knows where it writes', log.file, path.join(work, 'site.log'));
check('nothing is written until something is said', fs.existsSync(log.file), false);

check('the first line lands', log.write('[thornswood-docs] listening'), true);
check('the file is there now', fs.existsSync(log.file), true);
const first = fs.readFileSync(log.file, 'utf8');
check('it carries the line', first.indexOf('[thornswood-docs] listening') >= 0, true);
check('and a time in front of it', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}  /.test(first), true);

// Past the cap. The roll happens on the write AFTER the file is over it, so
// the line that tips it over is kept with its own generation.
for (let i = 0; i < 12; i++) { log.write('a line of some length to push it over the cap ' + i); }
check('the live file exists', fs.existsSync(log.file), true);
check('and is under the cap again', fs.statSync(log.file).size < 200 * 3, true);
check('a first generation was kept', fs.existsSync(log.file + '.1'), true);
check('and a second', fs.existsSync(log.file + '.2'), true);
check('and a third', fs.existsSync(log.file + '.3'), true);
check('but never a fourth, because three are kept', fs.existsSync(log.file + '.4'), false);

// The oldest goes and the others move up, rather than anything being
// overwritten in place.
fs.writeFileSync(log.file + '.1', 'ONE');
fs.writeFileSync(log.file + '.2', 'TWO');
fs.writeFileSync(log.file + '.3', 'THREE');
fs.writeFileSync(log.file, 'LIVE');
check('rolling says it worked', log.roll(), true);
check('the live file becomes .1', fs.readFileSync(log.file + '.1', 'utf8'), 'LIVE');
check('what was .1 becomes .2', fs.readFileSync(log.file + '.2', 'utf8'), 'ONE');
check('what was .2 becomes .3', fs.readFileSync(log.file + '.3', 'utf8'), 'TWO');
check('and the oldest is gone', fs.existsSync(log.file + '.4'), false);
check('the live file is out of the way', fs.existsSync(log.file), false);

// Rolling with nothing there at all is not an error.
const empty = makeLog(work, 'never-written.log', 200, 3);
check('rolling an empty slot is fine', empty.roll(), true);
check('and writes nothing', fs.existsSync(empty.file), false);

// A log it cannot write is said once and then left alone. This is the part
// that matters: a log that throws on every line is worse than no log.
const bad = makeLog(path.join(work, 'no', 'such', 'folder'), 'site.log', 200, 3);
check('an unwritable log says so by failing', bad.write('anything'), false);
check('and it knows it is broken', bad.broken(), true);
check('a second line is not attempted', bad.write('anything else'), false);

// Whatever it is handed, it writes a line rather than throwing.
check('a very long line is fine', log.write('x'.repeat(5000)), true);
check('an empty line is fine', log.write(''), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
