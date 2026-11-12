// test-gamemode-id.js
//
// The gamemode says which gamemode.js it is, once, when it loads.
//
// From the To Do List, entry 254: "A version and commit logged at load."
// Nothing the server wrote said which gamemode.js it was running, and 28
// commits changed the file on 23 September alone. Now the file hashes itself
// the way git does and logs that id with its size, so
//     git log --all --oneline --find-object=<id>
// names the commit behind any line in thornswood.log.
//
// This lifts the real block out of gamemode.js and runs it the way
// skymp5-server's requireTemp() runs the file: copied to a temp file through a
// utf8 string, with __filename pointing at the copy. What it logs has to be
// what git itself says. The machine that ships has core.autocrlf on, so the
// copy sent to the VPS has CRLF line ends while git stores LF, and the id has
// to come out the same for both.
//
// Read only. It writes nothing but its own temp folder, and removes that.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = REPO_DIR;
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* git's own answer, or null when there is no git to ask. */
function git(args, input) {
  try {
    const opts = { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] };
    if (input) { opts.input = input; }
    return execFileSync('git', args, opts).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

/*
  The function and the call right after it, both at the top level of the
  file. Top level is what makes it run at load: nothing has to call it.
*/
const a = src.indexOf(LF + 'function gamemodeId(');
const fnEnd = a < 0 ? -1 : src.indexOf(LF + '}' + LF, a);
const t = fnEnd < 0 ? -1 : src.indexOf(LF + 'try {' + LF, fnEnd);
const c = t < 0 ? -1 : src.indexOf(LF + '} catch (e) {' + LF, t);
const z = c < 0 ? -1 : src.indexOf(LF + '}' + LF, c + 1);
const block = (a >= 0 && z >= 0) ? src.slice(a + 1, z + 2) : null;

yes('gamemode.js has a gamemodeId() function', a >= 0 && fnEnd >= 0);
yes('and a top level try right after it, so it runs at load and nothing has to call it',
    t >= 0 && fnEnd >= 0 && src.slice(fnEnd + 3, t + 1).trim() === '');
yes('which hashes the file that is loading, read from __filename',
    block !== null && block.indexOf("gamemodeId(require('fs').readFileSync(__filename))") >= 0);

/*
  Run the block with a given file as __filename and collect what it logs.
  log() in the gamemode joins its arguments with a space and puts
  "[thornswood] " in front; the part after that is what is kept here.
*/
function load(file) {
  const lines = [];
  let threw = null;
  try {
    new Function('require', '__filename', 'log', block)(
      require, file, function () { lines.push(Array.prototype.slice.call(arguments).join(' ')); });
  } catch (e) {
    threw = e;
  }
  return { lines: lines, threw: threw };
}

function parse(line) {
  const m = /^gamemode\.js is git blob ([0-9a-f]{40}), (\d+) bytes$/.exec(line || '');
  return m ? { blob: m[1], size: Number(m[2]) } : null;
}

if (block === null) {
  yes('the block can be run', false);
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-gamemode-id-'));
  try {
    /*
      The copy requireTemp() makes, made the same way: readFileSync with
      'utf8', then writeFileSync of that string.
    */
    const raw = fs.readFileSync(SRC);
    const copy = path.join(tmp, Math.random() + '-' + Date.now() + '.js');
    fs.writeFileSync(copy, fs.readFileSync(SRC, 'utf8'));
    yes('requireTemp\'s way of copying gives back the same ' + raw.length + ' bytes',
        fs.readFileSync(copy).equals(raw));

    const got = load(copy);
    yes('loading it logs exactly one line and throws nothing',
        got.threw === null && got.lines.length === 1);
    const said = parse(got.lines[0]);
    console.log('      ' + (got.lines[0] || '(nothing logged)'));
    yes('the line carries a 40 digit git id and a byte count', said !== null);

    const expect = git(['hash-object', SRC]);
    if (expect === null) {
      console.log('SKIP  git did not answer, so the id was not checked against git');
    } else {
      yes('the id is the one git hash-object gives for ' + path.basename(SRC) + ' in this checkout, ' + expect,
          said !== null && said.blob === expect);
    }
    yes('the size is the size on disk, ' + raw.length + ' bytes, the number Check-LiveGamemode.ps1 prints',
        said !== null && said.size === raw.length);

    /*
      The same file with each kind of line end. git stores it with LF; the
      shipping machine's checkout, and so the copy on the VPS, has CRLF.
      Both have to name the blob git stores.
    */
    const text = raw.toString('latin1').split(CR + LF).join(LF);
    const lfBytes = Buffer.from(text, 'latin1');
    const crlfBytes = Buffer.from(text.split(LF).join(CR + LF), 'latin1');
    const lfFile = path.join(tmp, 'lf.js');
    const crlfFile = path.join(tmp, 'crlf.js');
    fs.writeFileSync(lfFile, lfBytes);
    fs.writeFileSync(crlfFile, crlfBytes);
    const lf = parse(load(lfFile).lines[0]);
    const crlf = parse(load(crlfFile).lines[0]);
    yes('an LF copy and a CRLF copy of it name the same blob',
        lf !== null && crlf !== null && lf.blob === crlf.blob);
    yes('and each logs its own size on disk, which differ by the line count',
        lf !== null && crlf !== null && lf.size === lfBytes.length && crlf.size === crlfBytes.length &&
        crlf.size > lf.size);

    const stored = git(['hash-object', '--no-filters', '--stdin'], lfBytes);
    const rawCrlf = git(['hash-object', '--no-filters', '--stdin'], crlfBytes);
    if (stored === null || rawCrlf === null) {
      console.log('SKIP  git did not answer, so the LF and CRLF ids were not checked against git');
    } else {
      yes('that blob is the one git names for the LF bytes, with no filter in the way',
          lf !== null && lf.blob === stored);
      yes('and the CRLF bytes hashed as they are would have named a blob git does not store',
          rawCrlf !== stored);
    }

    /* Nothing depends on git for these two. */
    const empty = path.join(tmp, 'empty.js');
    fs.writeFileSync(empty, '');
    const e = parse(load(empty).lines[0]);
    yes('an empty file is git\'s well known empty blob, e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
        e !== null && e.blob === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' && e.size === 0);
    const hello = path.join(tmp, 'hello.js');
    fs.writeFileSync(hello, 'hello' + CR + LF);
    const h = parse(load(hello).lines[0]);
    yes('"hello" and a CRLF is the blob git stores for "hello" and an LF, ce013625030ba8dba906f756967f9e9ca394464a',
        h !== null && h.blob === 'ce013625030ba8dba906f756967f9e9ca394464a' && h.size === 7);

    /* A file that cannot be read does not stop the load. */
    const gone = load(path.join(tmp, 'not-there.js'));
    yes('a file that cannot be read logs one line saying so and throws nothing',
        gone.threw === null && gone.lines.length === 1 &&
        gone.lines[0].indexOf('could not name this gamemode.js: ') === 0);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
