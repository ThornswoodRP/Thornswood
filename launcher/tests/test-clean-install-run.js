/*
  test-clean-install-run.js

  docs\CLEAN-INSTALL-RUN.md is the checklist for installing Thornswood on a
  machine that has never seen it. This keeps it honest in the ways a runbook
  goes wrong without anybody noticing.

  WHY THIS EXISTS. Nobody had installed Thornswood on a clean machine and
  written down what happened: the To Do entry is "Nobody has ever installed
  this on a clean machine and written down what happened". A checklist only
  fixes that while it describes the build that ships, and only once every row
  has been filled in.

  ONE, the list describes the build. Every line under "What the build should
  show, by row" names a file and quotes text from it. This reads that file and
  fails when the text is not there, so a launcher label that changes becomes a
  failing line here instead of a tester holding a list that no longer matches
  the screen.

  TWO, the shape. The entry that asked for the list said to test the Steam copy
  with Vortex, because the own folder was not on main. It was on main by then:
  CLAUDE.md was corrected on 18 Sep. The list has to name C:\Thornswood\Game
  and its hard links, and must not claim the other thing.

  THREE, the closing checks point at the run. Check-Build.ps1 and
  Check-Manifest.ps1 default to C:\Thornswood, which on Patrick's machine is
  his own install, so without -Data and -Client they pass for the wrong
  reason. The list must pass both, and both scripts must still take them.

  FOUR, a run is a record. The entry's done-when says that "after the first
  real run every row carries a time and an observation". While the Last run
  line says never, every fill-in cell stays empty, because a list nobody has
  run has nothing to report. Once it carries a date, every row needs a clock
  time, or "not reached", and something under Seen.

  And the house rules for text people read: no em dash, never "player", no To
  Do entry by number (the numbers move), nothing shaped like a secret. A
  SHA-256 is shaped like one and is not: row 15 asks for the installer's, word
  for word, and the Downloads page prints it for anybody. So 64 hex characters
  on a line that says SHA-256 are let through, and nothing else that long is.

  FIVE, the list accepts its own record. The list once asked for the SHA-256
  at row 15 while the key check here refused it, so the pull request carrying a
  faithful run could not have merged, and the proof made on a filled-in copy
  was older than the row. So this fills every row of the list in memory the
  way a run would, hashes included, and every check on the rows and the words
  must pass on that copy too.

  Read only. Pass another path as the first argument to check a copy.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const ROOT = REPO_DIR;
const DOC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO_DIR, 'docs', 'CLEAN-INSTALL-RUN.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

let doc = null;
try { doc = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { doc = null; }
yes('the checklist exists at ' + path.relative(ROOT, DOC), doc !== null);
if (doc === null) done();

// Whitespace is folded on both sides before a quote is looked for, because the
// public pages wrap their lines and a quote from one should not fail on where
// the wrap fell.
function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function repoFile(p) { return path.join(ROOT, p.split('\\').join(path.sep)); }
function readRepo(p) { try { return fs.readFileSync(repoFile(p), 'utf8'); } catch (e) { return null; } }

/* The document, or a copy of it, cut at its ## headings. */
function section(name, text) {
  const parts = (text === undefined ? doc : text).split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i].indexOf('\n');
    const head = (nl < 0 ? parts[i] : parts[i].slice(0, nl)).trim();
    if (head === name) return nl < 0 ? '' : parts[i].slice(nl + 1);
  }
  return null;
}
function cells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map(function (c) { return c.trim(); });
}
function unquote(c) { return /^`[^`]*`$/.test(c) ? c.slice(1, -1) : null; }

// ---- the status line -------------------------------------------------------
const LAST_RUN = /\*\*Last run: ([^*]+?)\.?\*\*/;
const status = LAST_RUN.exec(doc);
yes('there is a Last run line, the way RESTORING.md in the ops repo has one', !!status);
const runAt = doc.indexOf('## The run');
yes('the Last run line comes before the run, where the reader meets it first', !!status && runAt > 0 && status.index < runAt);
const neverRun = !!status && /^never$/i.test(status[1].trim());

// ---- the run table ---------------------------------------------------------
const HEADER = ['#', 'Step', 'Clock', 'Seen, word for word', 'A stranger would instead'];
function runTable(text) {
  const t = { rows: [], headers: 0, headersOk: true, widthOk: true };
  (text || '').split('\n').forEach(function (line) {
    if (!line.trim().startsWith('|')) return;
    const c = cells(line);
    if (c[0] === '#') { t.headers++; if (JSON.stringify(c) !== JSON.stringify(HEADER)) t.headersOk = false; return; }
    if (c.every(function (x) { return /^-+$/.test(x); })) return;
    if (c.length !== HEADER.length) t.widthOk = false;
    t.rows.push({ n: Number(c[0]), step: c[1] || '', clock: c[2] || '', seen: c[3] || '', other: c[4] || '' });
  });
  return t;
}
const run = section('The run');
yes('there is a section called The run', run !== null);
const table = runTable(run);
const rows = table.rows, headers = table.headers, headersOk = table.headersOk, widthOk = table.widthOk;
yes('every table in the run has the three columns the entry asked for: Clock, Seen, A stranger would instead', headers > 0 && headersOk);
yes('every row has exactly one cell per column, so no step has swallowed a pipe', widthOk);
yes('the run is long enough to be the whole path, ' + rows.length + ' rows', rows.length >= 40);
let consecutive = true;
rows.forEach(function (r, i) { if (r.n !== i + 1) consecutive = false; });
yes('the rows are numbered 1 to ' + rows.length + ' with none skipped or repeated', consecutive);
yes('every row says what to do', rows.every(function (r) { return r.step.length > 10; }));

// ---- the order a stranger meets it ------------------------------------------
const heads = [];
(run || '').replace(/^### (.+)$/gm, function (m, h) { heads.push(h.trim()); return m; });
function at(re) { for (let i = 0; i < heads.length; i++) if (re.test(heads[i])) return i; return -1; }
const order = [/Steam/, /Nexus/, /installer/i, /own folder/i, /Play page/i, /read-only checks/i].map(at);
yes('Steam, then Nexus and Vortex, then the installer, then the own folder, then the Play page, then the checks',
    order.every(function (i) { return i >= 0; }) &&
    order.every(function (v, i) { return i === 0 || v > order[i - 1]; }));
yes('the two read-only checks are the last thing in the run', order[5] === heads.length - 1);

// ---- filled in, or not yet --------------------------------------------------
function noClockRows(rs) { return rs.filter(function (r) { return !/^(([01]?\d|2[0-3]):[0-5]\d|not reached)$/i.test(r.clock); }); }
function noSeenRows(rs) { return rs.filter(function (r) { return !r.seen; }); }
if (neverRun) {
  const filled = rows.filter(function (r) { return r.clock || r.seen || r.other; });
  yes('never run, so no row carries a time or an observation yet' +
      (filled.length ? ' (filled: ' + filled.map(function (r) { return r.n; }).join(', ') + ')' : ''),
      filled.length === 0);
} else {
  const noClock = noClockRows(rows);
  const noSeen = noSeenRows(rows);
  yes('run on ' + (status ? status[1] : '?') + ', so every row carries a clock time or "not reached"' +
      (noClock.length ? ' (missing: ' + noClock.map(function (r) { return r.n; }).join(', ') + ')' : ''),
      noClock.length === 0);
  yes('and every row says what was seen' +
      (noSeen.length ? ' (missing: ' + noSeen.map(function (r) { return r.n; }).join(', ') + ')' : ''),
      noSeen.length === 0);
}

// ---- the shape --------------------------------------------------------------
const shape = section('The shape being tested') || '';
yes('the shape under test is the own game folder, C:\\Thornswood\\Game', shape.indexOf('C:\\Thornswood\\Game') >= 0);
yes('and it says the folder is made of hard links', /hard link/i.test(shape));
yes('nothing says the own folder is not on main, which stopped being true on 18 Sep',
    !/\bis not on main\b/i.test(doc) && !/own-game-folder/i.test(doc));

// ---- the two closing checks ------------------------------------------------
yes('Check-Build.ps1 is run against the copy with -Data, not against Patrick\'s own install', /Check-Build\.ps1 -Data \S/.test(doc));
yes('Check-Manifest.ps1 is run against the copy with -Client, not against Patrick\'s own install', /Check-Manifest\.ps1 -Client \S/.test(doc));
const cb = readRepo('scripts\\release\\Check-Build.ps1') || '';
const cm = readRepo('scripts\\mods\\Check-Manifest.ps1') || '';
yes('Check-Build.ps1 still takes -Data and -NoPause', /\[string\]\$Data\b/.test(cb) && /\[switch\]\$NoPause\b/.test(cb));
yes('Check-Manifest.ps1 still takes -Client and -NoPause', /\[string\]\$Client\b/.test(cm) && /\[switch\]\$NoPause\b/.test(cm));
yes('Check-Manifest.ps1 still reads the load order and the plugins from where M7 puts them',
    cm.indexOf("'Profile\\LocalAppData\\plugins.txt'") >= 0 && cm.indexOf("Join-Path $Client 'Game'") >= 0);

// ---- the measuring commands the rows name ----------------------------------
const commands = section('Commands') || '';
const named = {};
rows.forEach(function (r) { (r.step.match(/\b[MC]\d\b/g) || []).forEach(function (k) { named[k] = true; }); });
const dangling = Object.keys(named).filter(function (k) { return commands.indexOf('**' + k + ',') < 0 && commands.indexOf('**' + k + ' and') < 0 && commands.indexOf(' and ' + k + ',') < 0; });
yes('every command a row names (' + Object.keys(named).sort().join(', ') + ') is written out under Commands' +
    (dangling.length ? ' (not there: ' + dangling.join(', ') + ')' : ''),
    Object.keys(named).length >= 5 && dangling.length === 0);

// ---- every "row N" points at a row that exists -----------------------------
const refs = [];
doc.replace(/\b[Rr]ows? (\d+(?:(?:, | and | to )\d+)*)/g, function (m, list) {
  list.split(/, | and | to /).forEach(function (n) { refs.push(Number(n)); });
  return m;
});
const badRefs = refs.filter(function (n) { return !(n >= 1 && n <= rows.length); });
yes('every mention of a row number points at a row in the run (' + refs.length + ' mentions)' +
    (badRefs.length ? ' (out of range: ' + badRefs.join(', ') + ')' : ''),
    refs.length > 0 && badRefs.length === 0);

// ---- what the build should show ---------------------------------------------
const expect = section('What the build should show, by row') || '';
const exp = [];
let expShape = true;
expect.split('\n').forEach(function (line) {
  if (!line.trim().startsWith('|')) return;
  const c = cells(line);
  if (c[0] === 'Row' || c.every(function (x) { return /^-+$/.test(x); })) return;
  const text = unquote(c[1] || ''), file = unquote(c[2] || '');
  if (c.length !== 3 || !/^\d+$/.test(c[0]) || text === null || file === null) { expShape = false; return; }
  exp.push({ row: Number(c[0]), text: text, file: file });
});
yes('every line under What the build should show is a row number, a quote and a file, ' + exp.length + ' of them', expShape && exp.length >= 20);
const rowSet = {};
rows.forEach(function (r) { rowSet[r.n] = true; });
const orphan = exp.filter(function (e) { return !rowSet[e.row]; });
yes('every one of them belongs to a row in the run' + (orphan.length ? ' (no such row: ' + orphan.map(function (e) { return e.row; }).join(', ') + ')' : ''),
    orphan.length === 0);
const cache = {};
exp.forEach(function (e) {
  if (!(e.file in cache)) cache[e.file] = readRepo(e.file);
  const src = cache[e.file];
  yes('row ' + e.row + ': ' + e.file + ' still says "' + e.text + '"',
      src !== null && norm(src).indexOf(norm(e.text)) >= 0);
});

// ---- every file the list names is in the repository ------------------------
const mentioned = {};
doc.replace(/`((?:tools|launcher|installer|game)\\[^`\s]+\.[A-Za-z0-9]+)`/g, function (m, p) { mentioned[p] = true; return m; });
const missingFiles = Object.keys(mentioned).filter(function (p) { return !fs.existsSync(repoFile(p)); });
yes('every repository file the list names is there (' + Object.keys(mentioned).length + ' named)' +
    (missingFiles.length ? ' (not there: ' + missingFiles.join(', ') + ')' : ''),
    Object.keys(mentioned).length > 5 && missingFiles.length === 0);

// ---- the words --------------------------------------------------------------
// Each rule answers with the line numbers it objects to and never the text, so
// a key somebody pasted into a row is not printed a second time by the check
// that caught it.
function lineHits(text, re) {
  const g = new RegExp(re.source, re.flags.indexOf('g') < 0 ? re.flags + 'g' : re.flags);
  const out = [];
  let m;
  while ((m = g.exec(text)) !== null) {
    const n = text.slice(0, m.index).split('\n').length;
    if (out.indexOf(n) < 0) out.push(n);
    if (!m[0].length) g.lastIndex++;
  }
  return out;
}
// The installer's SHA-256 is 64 hex characters, which is key shaped, and it is
// public: the Downloads page prints it and row 15 asks for it word for word,
// from the page and from M8. So on a line that says SHA-256, a run of exactly
// 64 hex characters standing on its own is set aside first. A longer run, a
// shorter one, or a hash on a line that does not say what it is still fails.
const SHA256_RUN = /(^|[^A-Za-z0-9+_\-])[0-9A-Fa-f]{64}(?![A-Za-z0-9+_\-])/g;
function keyLines(text) {
  const out = [];
  text.split('\n').forEach(function (line, i) {
    const l = /SHA-256/i.test(line) ? line.replace(SHA256_RUN, '$1') : line;
    if (/[A-Za-z0-9+_\-]{40,}/.test(l)) out.push(i + 1);
  });
  return out;
}
const WORDS = [
  { what: 'no em dash or en dash anywhere', lines: function (t) { return lineHits(t, /[\u2014\u2013]/); } },
  { what: 'never "player"', lines: function (t) { return lineHits(t, /\bplayers?\b/i); } },
  { what: 'To Do entries are named by title, never by number, because the numbers move', lines: function (t) { return lineHits(t, /\bentr(y|ies)\s+#?\d/i); } },
  { what: 'nothing written down as a password, token, secret or webhook', lines: function (t) { return lineHits(t, /\b(password|passwd|token|secret|webhook)s?\s*[:=]\s*\S/i); } },
  { what: 'no long run of letters and digits that could be a key, bar a SHA-256 on a line that says so', lines: keyLines }
];
function wordChecks(text, prefix) {
  WORDS.forEach(function (w) {
    const bad = w.lines(text);
    yes(prefix + w.what + (bad.length ? ' (line ' + bad.join(', ') + ')' : ''), bad.length === 0);
  });
}
wordChecks(doc, '');

// ---- the list accepts its own record ----------------------------------------
// Every row of the run filled in the way How to fill in a row asks, in memory:
// a clock time, and Seen. Wherever a row asks for a SHA-256 it gets the
// installer's hash whole, once as the page prints it and once as M8 prints it,
// with the path beside it. A check that fails on this copy would fail on the
// pull request carrying the real run, so it fails here first.
const SAMPLE_HASH = '0123456789abcdef'.repeat(4);
function filledIn(text) {
  const start = text.search(/^## The run$/m);
  if (start < 0) return null;
  const next = text.slice(start + 1).search(/^## /m);
  const end = next < 0 ? text.length : start + 1 + next;
  const body = text.slice(start, end).split('\n').map(function (line) {
    if (!line.trim().startsWith('|')) return line;
    const c = cells(line);
    if (c.length !== HEADER.length || !/^\d+$/.test(c[0])) return line;
    const seen = /SHA-256/.test(c[1])
      ? 'Thornswood-Setup.exe, 14.2 MB, no browser warning. Page: SHA-256 ' + SAMPLE_HASH +
        ' M8: ' + SAMPLE_HASH + '  C:\\Users\\tester\\Downloads\\Thornswood-Setup.exe They match.'
      : 'nothing';
    return '| ' + c[0] + ' | ' + c[1] + ' | 14:05 | ' + seen + ' | |';
  }).join('\n');
  return (text.slice(0, start) + body + text.slice(end))
    .replace(LAST_RUN, '**Last run: 25 Sep, the tester, from the clean checkpoint.**');
}
const copy = filledIn(doc);
yes('a copy with every row filled in can be made from the list', copy !== null);
if (copy !== null) {
  const copyStatus = LAST_RUN.exec(copy);
  const copyRows = runTable(section('The run', copy)).rows;
  yes('filled in: the Last run line carries a date', !!copyStatus && !/^never$/i.test(copyStatus[1].trim()));
  yes('filled in: every row carries a clock time and something under Seen, ' + copyRows.length + ' rows',
      copyRows.length === rows.length && noClockRows(copyRows).length === 0 && noSeenRows(copyRows).length === 0);
  yes('filled in: a row asks for the installer\'s SHA-256, and the copy carries it there whole',
      copyRows.some(function (r) { return r.seen.indexOf(SAMPLE_HASH) >= 0; }));
  wordChecks(copy, 'filled in: ');
}

done();
