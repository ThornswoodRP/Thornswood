// test-architecture.js
//
// launcher\app\ARCHITECTURE.md is the launcher's one architecture page, the two
// long-form documents point at it, and every step it names is still where it
// says and in the order it says.
//
// WHY THIS EXISTS. To Do List entry 256: "There is no launcher architecture
// document, because the one that is pointed at is a finished to-do note".
// CLAUDE.md and Developer-Guide.md both sent a newcomer to
// launcher\app\HOOKUP.md for "how the launcher classes hang together", and that
// file was 108 lines titled "Wiring Discord.cs into the launcher": finished
// work. Play, the flow every person hits, could not be followed from the
// written record at all. The entry's own trap is the reason for the checks
// below: "leaving a stale one behind is exactly how this problem started".
//
// What it checks:
//   1. the page is there and the old note is gone;
//   2. the guide's list of where things are written down
//      (docs/guide/the-system.md) points at the page (the long CLAUDE.md that did
//      too is in the private ops repo since #3693, and its
//      tests/test-ops-docs.js checks it there), and no tracked
//      document still points at the old note (docs/archive is exempt:
//      it is the dated 17 September audit, a record of what was true then);
//   3. Shell.cs carries a class summary that names the page;
//   4. every `File.cs:123 Name` reference on the page resolves: the file is in
//      launcher\app and the name is still in it, as a declaration when it ends
//      in () and as code (not a comment, not a string) otherwise;
//   5. under each heading, references into the same method are in the order
//      the code runs them, so a step moved in Play is a step moved on the page;
//   6. the page has the four sections the entry asked for, says which
//      install it describes, and lists every file the guide's #dev rule names
//      (docs/guide/how-work-moves.md).
//
// A line that has only moved is reported, not failed: every edit above it
// moves it, and the name is the anchor the page tells people to search for.
// Each NOTE says where the line is now, so updating the page is a copy. Where
// a name is on several lines (a method's declaration and its call), the one
// meant is the one that moved with the references around it, not the nearest,
// and the chosen lines stay in the order the page lists them so a rename whose
// old name still appears elsewhere fails instead of reading as a move;
// settle() below says why, and a check after the order check proves it
// against the code on every run.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = REPO_DIR;
const APP = path.join(REPO_DIR, 'launcher', 'app');
const PAGE = path.join(APP, 'ARCHITECTURE.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function note(m) { console.log('NOTE  ' + m); }
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ------------------------------------------------------------ 1. the files
const page = read(PAGE);
yes('launcher/app/ARCHITECTURE.md exists', page !== null);
yes('launcher/app/HOOKUP.md, the finished Discord wiring note, is gone',
    !fs.existsSync(path.join(APP, 'HOOKUP.md')));

// ------------------------------------------------------------ 2. the pointers
// The guide is an index, Developer-Guide.md, and its pages in docs/guide.
// Its list of where things are written down is on the-system.md.
{
  const t = read(path.join(ROOT, 'docs', 'guide', 'the-system.md')) || '';
  yes('docs/guide/the-system.md points at launcher\\app\\ARCHITECTURE.md', t.indexOf('launcher\\app\\ARCHITECTURE.md') >= 0);
}
['Developer-Guide.md'].concat(fs.readdirSync(path.join(ROOT, 'docs', 'guide')).map(function (f) { return 'docs/guide/' + f; }))
  .forEach(function (doc) {
    yes(doc + ' does not name HOOKUP.md', !/HOOKUP/i.test(read(path.join(ROOT, doc)) || ''));
  });

let tracked = null;
try {
  tracked = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
} catch (e) {
  note('git ls-files did not answer, so only the two documents above were searched: ' + e.message);
}
if (tracked) {
  const pointing = tracked.filter(function (f) {
    if (!/\.md$/i.test(f)) return false;
    if (/^docs\/archive\//i.test(f)) return false;
    if (/^tools\/app\/ARCHITECTURE\.md$/i.test(f)) return false;
    const t = read(path.join(ROOT, f));
    return t !== null && /HOOKUP\.md/i.test(t);
  });
  pointing.forEach(function (f) { console.log('      still names HOOKUP.md: ' + f); });
  yes('no tracked document outside the dated audit still points at HOOKUP.md', pointing.length === 0);
}

// ------------------------------------------------------------ 3. Shell.cs
{
  const shellSrc = (read(path.join(APP, 'Shell.cs')) || '').replace(/\r\n/g, '\n');
  const at = shellSrc.search(/^[ \t]*static partial class Shell\b/m);
  const before = at > 0 ? shellSrc.slice(0, at) : '';
  const m = before.match(/((?:[ \t]*\/\/\/[^\n]*\n)+)$/);
  const summary = m ? m[1] : '';
  yes('Shell.cs has a /// summary directly above the class', /<summary>/.test(summary) && /<\/summary>/.test(summary));
  yes('that summary names launcher\\app\\ARCHITECTURE.md', summary.indexOf('launcher\\app\\ARCHITECTURE.md') >= 0);
}

if (page === null) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ------------------------------------------------------------ reading C#
// Comments and the insides of string and char literals blanked out, line
// count kept, so a name mentioned in a comment or a log sentence does not
// count as the code still doing it.
function strip(src) {
  let out = '';
  let st = 0; // 0 code, 1 // comment, 2 /* comment, 3 "string", 4 @"verbatim", 5 'char'
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (st === 0) {
      if (c === '/' && d === '/') { st = 1; out += '  '; i++; continue; }
      if (c === '/' && d === '*') { st = 2; out += '  '; i++; continue; }
      if (c === '@' && d === '"') { st = 4; out += '@"'; i++; continue; }
      if (c === '"') { st = 3; out += c; continue; }
      if (c === '\'') { st = 5; out += c; continue; }
      out += c; continue;
    }
    if (c === '\n') {
      out += '\n';
      if (st === 1 || st === 3 || st === 5) st = 0;
      continue;
    }
    if (st === 1) { out += ' '; continue; }
    if (st === 2) {
      if (c === '*' && d === '/') { st = 0; out += '  '; i++; continue; }
      out += ' '; continue;
    }
    if (st === 3 || st === 5) {
      if (c === '\\' && d !== '\n') { out += '  '; i++; continue; }
      if ((st === 3 && c === '"') || (st === 5 && c === '\'')) { st = 0; out += c; continue; }
      out += ' '; continue;
    }
    if (st === 4) {
      if (c === '"' && d === '"') { out += '  '; i++; continue; }
      if (c === '"') { st = 0; out += c; continue; }
      out += ' '; continue;
    }
  }
  return out.split('\n');
}

const MODS = '(?:(?:public|private|internal|protected|static|override|virtual|sealed|extern|abstract|unsafe|new)\\s+)+';
function declRx(name) { return new RegExp('^\\s*' + MODS + '[\\w<>\\[\\],.?]+\\s+' + esc(name) + '\\s*\\('); }
// A method declared at class depth: eight spaces in, the way every file here
// is laid out (namespace, class, member).
const MEMBER = new RegExp('^ {8}' + MODS + '[\\w<>\\[\\],.?]+\\s+(\\w+)\\s*\\(');
function refRx(name) { return new RegExp('(^|[^\\w])' + esc(name) + '(?!\\w)'); }

const sources = {};
function source(file) {
  if (!(file in sources)) {
    const t = read(path.join(APP, file));
    sources[file] = t === null ? null : strip(t.replace(/\r\n/g, '\n'));
  }
  return sources[file];
}

// The member a line sits inside: the nearest method declared at class depth
// at or above it. A delegate wired inside Wire belongs to Wire.
function enclosing(lines, at) {
  for (let i = at - 1; i >= 0; i--) {
    const m = lines[i].match(MEMBER);
    if (m) return (i + 1) + ':' + m[1];
  }
  return '0:';
}

// ------------------------------------------------------------ 4. references
// Read across line breaks: a reference wrapped onto two lines is still a
// reference, and one the check must not skip.
const pageText = page.replace(/\r\n/g, '\n');
const pageLines = pageText.split('\n');
const headings = [];
{
  let off = 0;
  pageLines.forEach(function (l) { if (/^#/.test(l)) headings.push({ at: off, text: l }); off += l.length + 1; });
}
function headingAt(at) {
  let h = '';
  headings.forEach(function (x) { if (x.at <= at) h = x.text; });
  return h;
}
const refs = [];
const malformed = [];
{
  const spanRx = /`([^`]+)`/g;
  let sm;
  while ((sm = spanRx.exec(pageText)) !== null) {
    const body = sm[1].replace(/[ \t]*\n[ \t]*/g, ' ');
    if (!/^[A-Za-z]+\.cs:\d/.test(body)) continue;
    const at = pageText.slice(0, sm.index).split('\n').length;
    const m = body.match(/^([A-Za-z]+\.cs):(\d+) ([A-Za-z_][A-Za-z0-9_.]*)(\(\))?$/);
    if (!m) { malformed.push('page line ' + at + ': `' + body + '`'); continue; }
    refs.push({ file: m[1], line: +m[2], name: m[3], decl: !!m[4], heading: headingAt(sm.index), pageLine: at, text: body });
  }
}
malformed.forEach(function (b) { console.log('      not in the File.cs:line Name form: ' + b); });
yes('every file:line reference on the page is in the File.cs:line Name form', malformed.length === 0);
yes('the page makes at least 100 file:line references, ' + refs.length + ' of them', refs.length >= 100);

// Every line a reference's name is on: as a declaration when the page gives it
// with (), as code otherwise.
function hitsOf(lines, r) {
  const rx = r.decl ? declRx(r.name.split('.').pop()) : refRx(r.name);
  const hits = [];
  lines.forEach(function (l, i) { if (rx.test(l)) hits.push(i + 1); });
  return hits;
}

// Which of those lines is the one the page means, once lines have moved.
//
// The nearest line with the name is the wrong answer for any name that is on
// more than one line. A method's declaration and its call carry the same name,
// and once an edit above both moves them further than half the gap between
// them, the declaration is nearer to where the page says the call is. Measured
// on 24 Sep: 16 comment lines added near the top of Shell.cs, nothing renamed
// and nothing reordered, and the order check failed with "Door.Check then
// StartPlay", because it had taken StartPlay's declaration for its call. At 80
// lines five pairs failed. That is a docs page turning a required check red on
// an ordinary pull request.
//
// An edit moves every line below it by the same amount, so references that sit
// near each other in a file move together. So the references into one file are
// taken in the order of the lines the page gives them, and between them they
// get the lines with their names over which the move changes least: counted in
// lines, plus one for each time it changes, starting from no move at the top.
// A step picked on another line with its name costs twice, once to jump there
// and once to jump back, so it only wins where the references around it moved
// that way too. A name on one line settles itself, and it settles the names on
// several lines around it.
//
// The chosen lines must also stay in page order: each spot's .now is strictly
// after the previous spot's .now. Without that, a step renamed or taken out of
// Play whose name is still called earlier in the same file settles on that
// earlier call and reads as a moved line (a NOTE) rather than a failure (#496).
// Additive line-only edits keep relative order, so they still settle and only
// NOTE the new numbers. A spot that has hits but no order-preserving choice is
// left without .now and counts as gone.
// `spots` are one file's references, one per line the page gives and name,
// sorted by that line, each with at least one hit; each gets .now, the line it
// settled on, or no .now when order cannot place it.
function settle(spots) {
  let prev = [{ shift: 0, at: 0, cost: 0 }];
  const rows = [];
  const aliveAt = [];
  spots.forEach(function (s) { s.now = undefined; });
  spots.forEach(function (s, si) {
    const row = s.hits.map(function (h) { return { at: h, shift: h - s.line, cost: Infinity, from: 0 }; });
    // Nearest first, so that of two choices that cost the same, the line
    // nearer to where the page says wins, as it did before.
    row.sort(function (a, b) { return Math.abs(a.shift) - Math.abs(b.shift) || a.at - b.at; });
    row.forEach(function (c) {
      prev.forEach(function (p, j) {
        if (!(p.at < c.at) || !(p.cost < Infinity)) return;
        const d = Math.abs(c.shift - p.shift);
        const v = p.cost + d + (d ? 1 : 0);
        if (v < c.cost) { c.cost = v; c.from = j; }
      });
    });
    if (!row.some(function (c) { return c.cost < Infinity; })) {
      rows.push(null);
      return;
    }
    rows.push(row);
    aliveAt.push(si);
    prev = row;
  });
  const live = [];
  for (let i = 0; i < rows.length; i++) if (rows[i]) live.push(i);
  if (!live.length) return;
  const last = rows[live[live.length - 1]];
  let k = 0;
  last.forEach(function (c, j) { if (c.cost < last[k].cost) k = j; });
  for (let li = live.length - 1; li >= 0; li--) {
    spots[aliveAt[li]].now = rows[live[li]][k].at;
    k = rows[live[li]][k].from;
  }
}
function bySpot(a, b) { return a.line - b.line || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); }

const gone = [];
const spotsIn = {};
refs.forEach(function (r) {
  const lines = source(r.file);
  if (lines === null) { gone.push(r.text + ' (page line ' + r.pageLine + '): launcher/app/' + r.file + ' does not exist'); return; }
  const all = spotsIn[r.file] || (spotsIn[r.file] = {});
  const key = r.line + ' ' + r.name + (r.decl ? '()' : '');
  const s = all[key] || (all[key] = { key: key, line: r.line, hits: hitsOf(lines, r) });
  if (s.hits.length === 0) {
    gone.push(r.text + ' (page line ' + r.pageLine + '): ' +
      (r.decl ? 'no method of that name is declared in ' : 'that name is no longer in the code of ') + r.file);
    return;
  }
  r.spot = s;
});
function spotsOf(file) {
  const all = spotsIn[file];
  return Object.keys(all).map(function (k) { return all[k]; })
    .filter(function (s) { return s.hits.length > 0; }).sort(bySpot);
}
Object.keys(spotsIn).forEach(function (file) { settle(spotsOf(file)); });

let exact = 0, moved = 0;
refs.forEach(function (r) {
  if (!r.spot) return;
  if (r.spot.now === undefined) {
    gone.push(r.text + ' (page line ' + r.pageLine + '): ' +
      (r.decl ? 'no method of that name is declared in ' : 'that name is no longer in the code of ') + r.file +
      ' at a line that keeps page order with the other references');
    return;
  }
  r.now = r.spot.now;
  if (r.now === r.line) exact++;
  else {
    moved++;
    note(r.text + ' has moved to ' + r.file + ':' + r.now + ' (page line ' + r.pageLine + ')');
  }
  r.member = r.file + '|' + enclosing(source(r.file), r.now);
});
gone.forEach(function (m) { console.log('      ' + m); });
yes('every name the page gives is still in the file it names', gone.length === 0);
if (moved > 0) note(moved + ' of ' + (exact + moved) + ' references have moved; the page wants those line numbers updated');
else console.log('      all ' + exact + ' references land on their line');

// ------------------------------------------------------------ 5. order
// Under one heading, a reference into a method comes after the previous
// reference into the same method, because that is the order the page tells
// people the steps happen in.
function outOfOrder(list) {
  const found = [];
  let lastHeading = null, lastIn = {};
  list.forEach(function (r) {
    if (r.heading !== lastHeading) { lastHeading = r.heading; lastIn = {}; }
    if (r.now === undefined) return;
    const prev = lastIn[r.member];
    if (prev && r.now <= prev.now && !(r.now === prev.now && r.text === prev.text)) {
      found.push(prev.text + ' then ' + r.text + ' under "' + r.heading.replace(/^#+\s*/, '') +
        '": the code has them at ' + prev.now + ' and ' + r.now);
    }
    lastIn[r.member] = r;
  });
  return found;
}
const disorder = outOfOrder(refs);
disorder.forEach(function (m) { console.log('      ' + m); });
yes('the steps the page lists inside each method are in the order the code runs them', disorder.length === 0);

// Proof the order check has teeth: the steps the page walks inside Play(),
// read backwards, have to be caught.
{
  const inPlay = refs.filter(function (r) {
    return r.now !== undefined && r.heading === '### Pressing it' && /\|\d+:Play$/.test(r.member || '');
  });
  yes('the page walks at least ten steps inside Play(), ' + inPlay.length + ' of them', inPlay.length >= 10);
  yes('and the same steps listed backwards would be caught as out of order',
      outOfOrder(inPlay.slice().reverse()).length > 0);
}

// Proof that a line which has only moved is a NOTE and never a failure. For
// each file, the page taken as exactly right, then every line from its first
// reference down pushed further down by 16, 80 and 400, the way lines added
// above all of them would: each reference has to follow its own line and not
// another line with its name. 16 is where the nearest-line choice this
// replaced first went wrong in Shell.cs. The answer is certain, whatever the
// code says, in any file where one referenced name is on one line only, since
// that name pins the move for the rest; a file without one is left out rather
// than guessed at.
{
  const wrong = [];
  let files = 0;
  Object.keys(spotsIn).forEach(function (file) {
    const real = spotsOf(file).filter(function (s) { return s.now !== undefined; });
    if (!real.some(function (s) { return s.hits.length === 1; })) return;
    files++;
    let top = Infinity;
    real.forEach(function (s) { if (s.now < top) top = s.now; });
    [16, 80, 400].forEach(function (k) {
      const pushed = real.map(function (s) {
        return { key: s.key, line: s.now, hits: s.hits.map(function (h) { return h >= top ? h + k : h; }) };
      }).sort(bySpot);
      settle(pushed);
      pushed.forEach(function (s) {
        if (s.now !== s.line + k) wrong.push(file + ':' + s.line + ' ' + s.key.replace(/^\d+ /, '') + ' pushed ' + k + ' lines came out at ' + s.now + ', not ' + (s.line + k));
      });
    });
  });
  wrong.slice(0, 10).forEach(function (m) { console.log('      ' + m); });
  yes('pushed down 16, 80 or 400 lines, every reference in ' + files + ' files follows its own line', files > 0 && wrong.length === 0);
}

// And inside one method, the StartPlay case as it is laid out in Shell.cs:
// StartPlay declared at 100, Door.Check at 115, StartPlay called again at 130,
// CheckIn at 140, then 40 lines added between Door.Check and the call. The
// declaration is now 30 lines from where the page says the call is and the
// call is 40, so the nearest line is the wrong one; the steps either side say
// which is right.
{
  const fixture = [
    { key: '100 StartPlay()', line: 100, hits: [100] },
    { key: '115 Door.Check', line: 115, hits: [115] },
    { key: '130 StartPlay', line: 130, hits: [100, 170] },
    { key: '140 CheckIn', line: 140, hits: [180] }
  ];
  settle(fixture);
  yes('a call moved 40 lines past its own declaration is found at the call, 170, not the declaration: ' + fixture[2].now,
      fixture[0].now === 100 && fixture[1].now === 115 && fixture[2].now === 170 && fixture[3].now === 180);
}

// Proof that a renamed step whose name still appears earlier fails to settle,
// rather than reading as a moved line on that earlier call (#496). Hold.Take
// in Play at 200, with the same name still at 50 in Run: after the Play call
// is removed, the Play reference has no order-preserving hit.
{
  const fixture = [
    { key: '40 Door.Check', line: 40, hits: [40] },
    { key: '50 Hold.Take', line: 50, hits: [50] },
    { key: '60 Keep.Seed', line: 60, hits: [60] },
    { key: '180 Keep.Restore', line: 180, hits: [180] },
    { key: '200 Hold.Take', line: 200, hits: [50] },
    { key: '220 Swap.Apply', line: 220, hits: [220] }
  ];
  settle(fixture);
  yes('a Play Hold.Take renamed away, with Run still calling Hold.Take, does not settle: ' + fixture[4].now,
      fixture[0].now === 40 && fixture[1].now === 50 && fixture[2].now === 60 &&
      fixture[3].now === 180 && fixture[4].now === undefined && fixture[5].now === 220);
}

// ------------------------------------------------------------ 6. shape
['## Which install this describes', '## 1. Starting up', '## 2. What each part owns',
 '## 3. The Play sequence', '## 4. The six shared files'].forEach(function (h) {
  yes('the page has the heading "' + h.replace(/^#+\s*/, '') + '"', pageLines.indexOf(h) >= 0);
});
{
  const top = page.slice(0, Math.max(0, page.indexOf('## 1. Starting up')));
  yes('before section 1 it says the game runs from <Root>\\Game, Thornswood\'s own folder',
      top.indexOf('<Root>\\Game') >= 0 && /Paths\.Collection/.test(top));
}

// The subsystems the entry named, each with its paragraph. "Creation" has no
// class; the page says so, and Chars.cs is where it lives.
{
  const s2 = page.slice(page.indexOf('## 2. What each part owns'), page.indexOf('## 3. The Play sequence'));
  ['Paths', 'Config', 'Keep', 'Hold', 'Swap', 'Verify', 'Updater', 'Door', 'Voice', 'Chars', 'OwnGame', 'Uninstall', 'Register']
    .forEach(function (c) {
      yes('section 2 has a paragraph for ' + c + ' (' + c + '.cs)',
          new RegExp('^\\*\\*' + c + '\\b[^\\n]*\\n?[^\\n]*\\(' + c + '\\.cs').test(s2) ||
          new RegExp('^\\*\\*[^*\\n]*\\b' + c + '\\b[^*\\n]*\\*\\* \\([^)]*\\b' + c + '\\.cs', 'm').test(s2));
    });
  yes('section 2 says there is no class called Creation', /no class called Creation/.test(s2));
}

// Every class in launcher\app named somewhere on the page. Reported rather than
// failed: a new file is a new line on the page, and the NOTE says which.
{
  const unnamed = [];
  try {
    fs.readdirSync(APP).filter(function (f) { return /\.cs$/.test(f); }).forEach(function (f) {
      if (page.indexOf(f) < 0) unnamed.push(f);
    });
  } catch (e) { }
  if (unnamed.length) note('not named on the page yet: ' + unnamed.join(', '));
  else console.log('      every .cs file in launcher/app is named on the page');
}

// The six shared files, as the guide's #dev rule names them today
// (docs/guide/how-work-moves.md, "Signing, the build check, and the six shared files").
{
  const claude = (read(path.join(ROOT, 'docs', 'guide', 'how-work-moves.md')) || '').replace(/\s+/g, ' ');
  const m = claude.match(/An edit to (.+?) that blocks others' work gets a line in #dev-coordination/);
  const s4 = page.slice(Math.max(0, page.indexOf('## 4. The six shared files')));
  if (!m) note('docs/guide/how-work-moves.md no longer words its #dev rule as "An edit to ... that blocks others\' work gets a line in #dev-coordination", so section 4 was not compared with it');
  else {
    const named = m[1].match(/[\w-]+\.(?:cs|ps1)/g) || [];
    yes('docs/guide/how-work-moves.md\'s #dev rule names files, ' + named.length + ' of them', named.length > 0);
    named.forEach(function (f) { yes('section 4 lists ' + f, s4.indexOf(f) >= 0); });
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
