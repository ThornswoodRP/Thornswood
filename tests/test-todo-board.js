// test-todo-board.js
//
// The hub's own to do board, the `todo` key in site/data/board.json,
// says only true things about what is on fire, and its numbering holds.
//
// WHY THIS EXISTS. Entry 298 on the To Do List: the board opened with
// "1. Broken right now", three rows that had all been fixed. "A list of what
// is on fire is only useful if it is true, and this one still quotes launcher
// 1.0.196." What was measured on 24 September, before the section came out:
//
//   - "The installer will not build". It builds. Thornswood-Setup.zip in
//     C:\Thornswood-Dev\dist\Thornswood\_dist is 385,154,603 bytes, written
//     23 September 07:47, with Thornswood-Setup.exe beside it.
//   - "The news feed publishes nothing ... launcher 1.0.196". The live feed,
//     version.json in the Thornswood-Releases clone, is at launcher 1.1.92
//     and carries 40 news entries. Publish-News.ps1 read that clone rather
//     than the stale copy in this repo, which is where 1.0.196 came from (the
//     site reads the feed itself since #5187).
//   - "The bot is not running". It has run since the certifi fix that row
//     was waiting on. Its own log line from a deploy on 22 September,
//     "trouble: speaking in #news", is quoted in 109c80e, and the bot's code
//     changed and went out again on 23 September. Not checked live, because
//     that means reaching the VPS.
//
// The section numbers are typed into the names, "1." to "11.", not generated,
// and three rows elsewhere on the board point at sections by number. Taking
// section 1 out moves every one of those by one, so this checks that each
// reference still lands on the section it means, not merely on some section.
// "Section 2 below" in the Discord onboarding row was already wrong before
// the section came out: it meant the field by field section, which was 8.
//
// data/todo.md is a different list with the same name. Both are live. This
// reads board.json and only checks todo.md's heading, which the entry names.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

const ROOT = REPO_DIR;
const APP = path.join(ROOT, 'site');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

let board = null;
try { board = JSON.parse(readText(path.join(APP, 'data', 'board.json'))); }
catch (e) { console.log('      ' + e.message); }
yes('board.json parses', !!board);
const todo = board && board.todo;
const sections = (todo && Array.isArray(todo.sections)) ? todo.sections : [];
yes('the todo board has sections, ' + sections.length + ' of them', sections.length > 0);

// ---------------------------------------------------------------- the section

function bare(name) { return String(name || '').replace(/^\s*\d+\.\s*/, ''); }

yes('no section on the todo board is "Broken right now"',
  !sections.some(function (s) { return /^broken right now$/i.test(bare(s.name).trim()); }));

const FIXED = [/installer will not build/i, /news feed publishes nothing/i, /bot is not running/i];
const stillThere = [];
sections.forEach(function (s) {
  (s.rows || []).forEach(function (r) {
    const text = Object.keys(r.cells || {}).map(function (k) { return String(r.cells[k]); }).join('\n');
    FIXED.forEach(function (re) { if (re.test(text)) stillThere.push(r.id + ' ' + re); });
  });
});
stillThere.forEach(function (x) { console.log('      ' + x); });
yes('no row still says the installer, the news feed or the bot is broken', stillThere.length === 0);

// ---------------------------------------------------------------- numbering

const numbers = sections.map(function (s) {
  const m = /^(\d+)\.\s/.exec(String(s.name || ''));
  return m ? parseInt(m[1], 10) : null;
});
yes('every section name starts with its number', numbers.every(function (n) { return n !== null; }));
const gaps = [];
numbers.forEach(function (n, i) { if (n !== i + 1) gaps.push('position ' + (i + 1) + ' is numbered ' + n + ': ' + sections[i].name); });
gaps.forEach(function (g) { console.log('      ' + g); });
yes('the numbers run 1 to ' + sections.length + ' in order, no gap, no repeat', gaps.length === 0);

function byNumber(n) { return (n >= 1 && n <= sections.length) ? sections[n - 1] : null; }

// Every "section N" in a note or a cell names a section that exists.
const refs = [];
sections.forEach(function (s) {
  const texts = [{ where: s.id + ' note', text: String(s.note || '') }];
  (s.rows || []).forEach(function (r) {
    Object.keys(r.cells || {}).forEach(function (k) { texts.push({ where: r.id, text: String(r.cells[k]) }); });
  });
  texts.forEach(function (t) {
    const re = /\bsection (\d+)\b/gi;
    let m;
    while ((m = re.exec(t.text))) refs.push({ where: t.where, n: parseInt(m[1], 10) });
  });
});
const dangling = refs.filter(function (r) { return !byNumber(r.n); });
dangling.forEach(function (r) { console.log('      ' + r.where + ' points at section ' + r.n + ', which is not there'); });
yes('every "section N" on the board names a section that is there, ' + refs.length + ' of them', dangling.length === 0);

// And the ones there are land on the section they mean.
const MEANS = {
  s5r0: /Discord onboarding, field by field/,
  s5r1: /The bot that stays running/,
  s5r2: /The bot that stays running/,
  s7r6: /Taking the mods out of the installer/
};
Object.keys(MEANS).forEach(function (id) {
  const mine = refs.filter(function (r) { return r.where === id; });
  if (!mine.length) { yes(id + ' names the section it depends on by number', false); return; }
  mine.forEach(function (r) {
    const s = byNumber(r.n);
    yes(id + ' "section ' + r.n + '" lands on ' + (s ? '"' + s.name + '"' : 'nothing'),
      !!s && MEANS[id].test(s.name));
  });
});

// The rebuild the mods section said it was blocking was the first row of the
// section that came out. Nothing above it talks about a rebuild now.
const blob = JSON.stringify(sections);
yes('nothing on the board points at "the rebuild above"', !/rebuild above/i.test(blob));

// ---------------------------------------------------------------- the shape

const sectionIds = sections.map(function (s) { return s.id; });
yes('section ids are unique', new Set(sectionIds).size === sectionIds.length);
const rowIds = [];
const strayCells = [];
sections.forEach(function (s) {
  const cols = {};
  (s.columns || []).forEach(function (c) { cols[c.id] = true; });
  (s.rows || []).forEach(function (r) {
    rowIds.push(r.id);
    Object.keys(r.cells || {}).forEach(function (k) { if (!cols[k]) strayCells.push(s.id + ' ' + r.id + ' ' + k); });
  });
});
yes('row ids are unique, ' + rowIds.length + ' rows', new Set(rowIds).size === rowIds.length);
strayCells.forEach(function (x) { console.log('      cell without a column: ' + x); });
yes('every cell belongs to a column of its own section', strayCells.length === 0);

// ---------------------------------------------------------------- the site

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (e.name === 'node_modules' || e.name === '.git') return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  });
  return out;
}
const quoting = walk(APP, []).filter(function (p) {
  try { return fs.readFileSync(p).toString('latin1').indexOf('1.0.196') >= 0; } catch (e) { return false; }
});
quoting.forEach(function (p) { console.log('      ' + path.relative(ROOT, p)); });
yes('no file under site quotes launcher 1.0.196', quoting.length === 0);

let first = '';
try { first = readText(path.join(APP, 'data', 'todo.md')).split(/\r?\n/)[0]; } catch (e) {}
yes('data/todo.md opens with "# Patrick", read "' + first + '"', first === '# Patrick');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
