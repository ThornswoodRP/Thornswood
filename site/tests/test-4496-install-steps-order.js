'use strict';
// test-4496-install-steps-order.js
//
//     node site/tests/test-4496-install-steps-order.js
//
// #4496. The setup window's closing lines and the launcher give the steps
// after the installer as Downgrade (only where Skyrim is on another build),
// the collection, Connect Discord, Play: the launcher holds the collection's
// card until Downgrade is done (launcher/app/InstallSteps.cs, Checks). The
// join page, which #start-here is read out of word for word (bot/content.py),
// and the Downloads page went from the installer straight to the
// collection, with Downgrade only in "What you need", and the Downloads page
// said Skyrim had to be on 1.6.1170 where the join page says any build.
//
//   A. InstallSteps.cs, the reference: its closing lines are in that order.
//   B. join.md: after Take the installer, its numbered steps are Downgrade,
//      the collection, Connect Discord and Play, numbered one after another,
//      and its words before step 2 name the right steps.
//   C. The Downloads page: the same steps in the same order, headings, alpha
//      and open, whose count is the steps under them, and any build.
//   D. help.md's first install: any build, and the same order.
//
// Read only.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); }
  catch (e) { return ''; }
}
// Which of the four steps a heading or list item is, or '' for none of them.
// Downgrade and Play first: a Play step can mention the collection, and a
// collection step can say what happens when you press Play.
function kind(text) {
  if (/Downgrade/.test(text)) return 'downgrade';
  if (/Press \**Play/.test(text)) return 'play';
  if (/Connect \**(your )?Discord/.test(text)) return 'discord';
  if (/collection/i.test(text)) return 'collection';
  return '';
}
const ORDER = ['downgrade', 'collection', 'discord', 'play'];
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ------------------------------------------------------ A. the reference --
const cs = read('launcher/app/InstallSteps.cs');
const closing = cs.slice(cs.indexOf('Say("Next, in the launcher:");'));
const csSteps = (closing.match(/Say\("  " \+ step(?:\+\+)? \+ "\. ([^"]*)"\);/g) || [])
  .map(function (l) { return kind(l); });
yes('A1 the setup window\'s closing lines are Downgrade, the collection, Connect Discord, Play (got ' +
    csSteps.join(', ') + ')', same(csSteps, ORDER));

// -------------------------------------------------------- B. the join page --
const join = read('site/data/site/join.md');
const heads = [];
join.replace(/^## (\d+)\. (.*)$/gm, function (_m, n, title) { heads.push({ n: Number(n), title: title }); return _m; });
const installer = heads.findIndex(function (h) { return /Take the installer/.test(h.title); });
const after = installer < 0 ? [] : heads.slice(installer + 1);
yes('B1 join.md has Take the installer as a numbered step', installer >= 0);
yes('B2 after it come Downgrade, the collection, Connect Discord, Play (got ' +
    after.map(function (h) { return kind(h.title) || h.title; }).join(', ') + ')',
    same(after.map(function (h) { return kind(h.title); }), ORDER));
yes('B3 numbered one after another from the installer\'s number',
    installer >= 0 && after.every(function (h, i) { return h.n === heads[installer].n + 1 + i; }));
function joinSection(title) {
  const at = join.search(new RegExp('^## \\d+\\. ' + title, 'm'));
  if (at < 0) return '';
  const rest = join.slice(at);
  const end = rest.slice(3).search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end + 3)).replace(/\s+/g, ' ');
}
const down = joinSection('[^\\n]*Downgrade');
yes('B4 the Downgrade step says it is for another build than 1.6.1170, and the Steam copy stays',
    /1\.6\.1170/.test(down) && /Steam copy stays/.test(down));
// The alpha wording says which steps can be done while an application waits:
// every one up to Connect Discord, which works once it is accepted.
const wait = (join.match(/You can do steps (\d+) to (\d+) while you wait\. Step (\d+) works once you are accepted\./) || []).slice(1).map(Number);
const discordAt = heads.find(function (h) { return kind(h.title) === 'discord'; });
yes('B5 the alpha words name the steps up to Connect Discord as the ones to do while you wait (got ' +
    (wait.join(', ') || 'none') + ')',
    wait.length === 3 && discordAt && wait[0] === 2 && wait[1] === discordAt.n - 1 && wait[2] === discordAt.n);
yes('B6 What you need still says any build', /on any build/.test(join.split('\n## ')[1] || ''));

// ------------------------------------------------- C. the Downloads page --
// Read from downloads.js's own words rather than by loading it: loading it
// reads and writes the site's config.json. The alpha and open wordings each
// have their own Discord step, and every step after it is shared.
const dl = read('site/lib/downloads.js');
const code = dl.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
const h3 = (code.match(/<h3>[^<]*<\/h3>/g) || []).map(function (s) { return s.slice(4, -5); });
const at = h3.findIndex(function (t) { return /Take the installer/.test(t); });
const rest = at < 0 ? [] : h3.slice(at + 1);
yes('C1 after Take the installer come Downgrade, the collection, Connect Discord, Play (got ' +
    rest.map(function (t) { return kind(t) || t; }).join(', ') + ')',
    same(rest.map(kind), ORDER));
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const counts = (code.match(/then (\w+) steps<\/h2>/g) || []).map(function (s) { return s.split(' ')[1]; });
yes('C2 both headings, alpha and open, count the steps after the Discord one (say ' +
    (counts.join(' and ') || 'none') + ', there are ' + (rest.length + 1) + ')',
    counts.length === 2 && counts.every(function (c) { return WORDS.indexOf(c) === rest.length + 1; }));
const ledeAt = code.lastIndexOf("'", code.indexOf('<p class="lede">You need'));
const lede = ledeAt < 0 ? '' : code.slice(ledeAt, code.indexOf('</p>', ledeAt) + 5);
const ledeText = (lede.match(/'((?:[^'\\]|\\.)*)'/g) || []).map(function (s) { return s.slice(1, -1); })
  .join('').replace(/<[^>]*>/g, '');
yes('C3 it says any build of Skyrim Special Edition, not that it must be on 1.6.1170 (says "' +
    ledeText.replace(/\s+/g, ' ').slice(0, 90) + '...")',
    /on any build/.test(ledeText) && !/on build 1\.6\.1170/.test(ledeText));

// ---------------------------------------------------------- D. help.md --
const help = read('site/data/help.md');
const first = help.slice(help.indexOf('## Installing it the first time'));
const firstBody = first.slice(0, (first.slice(3).search(/\n## /) + 3) || first.length);
yes('D1 help.md\'s first install says any build', /on any build/.test(firstBody.split('\n\n').slice(0, 2).join(' ')));
const items = (firstBody.match(/^\d+\. [^\n]*(?:\n {3}[^\n]*)*/gm) || []).map(kind).filter(Boolean);
yes('D2 and its steps after the installer are in the same order (got ' + items.join(', ') + ')',
    same(items, ORDER));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
