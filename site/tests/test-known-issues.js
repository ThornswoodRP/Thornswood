// test-known-issues.js
//
// The Known Issues page stops calling roadmap work permanent, and every other
// place that describes the same rows says the same thing about them.
//
// From the To Do List, entry 296: "Pick one and say it once. If NPC behaviour
// is being worked on, it belongs under a heading that says so rather than one
// that tells people never to report it. The tester note repeats the permanent
// version, so three places currently disagree about whether this is a limit
// or a task".
//
// WHAT WAS MEASURED ON 24 SEPTEMBER. known.md opened its first table with
// "They are not going to change" over NPCs standing still and NPC behaviour
// differing, while board.json's roadmap carries Thinning the crowd and NPCs
// with their own work under Next. Patrick decided the NPC cut on 17 September
// (To Do entry 320), so the roadmap is the one that is right. It was not three
// places but six: the /known link preview in server.js and the same string in
// public/home.html both opened "Permanent limits", the hub's own copy of the
// board in board.json said "none are changing", the tester note listed NPCs
// under Do not report these, and the Help page listed them under "All of that
// is deliberate". The other three rows in that table are open To Do entries
// too (299 mod settings, 323 Papyrus events, 300 killmoves and stagger), so
// the fix is to the promise over the table rather than to two of its rows.
//
// SINCE #3140 the rows and the roadmap are both on the issue board, so what
// this checks is the part of the page the repository still writes, and that
// the other places keep saying the same.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const APP = process.env.DOCS_APP || path.join(REPO_DIR, 'site');
const CR = String.fromCharCode(13);
function read(rel) {
  try { return fs.readFileSync(path.join(APP, rel), 'utf8').split(CR).join(''); }
  catch (e) { return null; }
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Anything that tells a reader a row will stay the way it is. "Not all of it
   is permanent" is the opposite, so "permanent" on its own is not here; the
   phrases are the ones this site has actually used. */
const PROMISE = /not going to change|none are changing|are not changing|never going to change|will not change|won't change|permanent limits/i;

/* A markdown page as the text before the first heading and one entry per
   "## " heading: the words between the heading and its table, and the first
   cell of every row of that table. */
function sections(md) {
  const lines = md.split('\n');
  const out = { intro: '', list: [] };
  let cur = null, header = false;
  lines.forEach(function (line) {
    if (/^## /.test(line)) {
      cur = { heading: line.slice(3).trim(), lead: '', rows: [], items: [], text: '' };
      out.list.push(cur); header = false; return;
    }
    if (!cur) { if (!/^# /.test(line)) { out.intro += line + '\n'; } return; }
    cur.text += line + '\n';
    if (/^\|/.test(line)) {
      if (!header) { header = true; return; }
      if (/^\|\s*-/.test(line)) { return; }
      cur.rows.push(line.split('|')[1].trim());
      return;
    }
    if (/^- /.test(line)) { cur.items.push(line.slice(2).trim()); }
    if (!cur.rows.length) { cur.lead += line + '\n'; }
  });
  return out;
}

// ---------------------------------------------------------- the known page
/* Since #3140 both the Known Issues page and the roadmap are written from the
   issue board (the bot's lists.json), so a row and a roadmap item are two
   labels on the board, and whether one is the other is decided there. What
   the repository still holds is the page around the rows, written by
   knownMarkdown in server.js: that is what is checked here, written from one
   made-up row. */
const known = require('../../tests/fixtures/known-page').knownPage(null, {
  at: '2026-10-26T08:00:00Z',
  known: [{ title: 'Doors stick', text: 'A door sticks shut. Push it twice.', where: ['Main'] }]
});
yes('the Known Issues page is there, written from the issue board', known !== null);
const page = sections(known || '');
/* Since #3137 the page holds only what is broken right now; what works the
   way it does on purpose moved to the Help page. */
const skymp = page.list[0] || { heading: '', lead: '', rows: [] };
yes('its first section is what is broken right now, with the row in it',
    /broken right now/i.test(skymp.heading) && /### Doors stick/.test(skymp.text));

/*
  THE DEFECT ITSELF. The page's own opening said the first group "is not
  going to change", over rows the roadmap listed as work under Next.
*/
yes('the page opening does not promise anything on it will not change',
    !PROMISE.test(page.intro) && !page.list.some(function (s) { return PROMISE.test(s.lead); }));

/* "Rather than one that tells people never to report it." The section still
   tells people when a report is worth making. */
yes('that section says what is still worth reporting',
    /report[^.]*only if|only report|worth reporting|worth a report/i.test(skymp.lead));

// ------------------------------------------------------------ the preview
/* What a link to /known says when it is pasted into Discord, and what the
   browser tab reads. server.js writes both into the page from its one list
   (BLURB). home.js kept a second copy until #3138, and the two were edited
   apart, so the test now checks there is only the one. */
function blurb(rel) {
  const src = read(rel) || '';
  const m = src.match(/'\/known':\s*\[\s*'([^']*)',\s*'([^']*)'\s*\]/);
  return m ? m[2] : null;
}
// The blurbs are in site\lib\pages.js since server.js was split (#5357).
const serverBlurb = blurb(path.join('lib', 'pages.js'));
yes('the site has a /known preview', serverBlurb !== null);
yes('the preview no longer calls the page permanent',
    serverBlurb !== null && !/permanent/i.test(serverBlurb) && !PROMISE.test(serverBlurb));
yes('home.js keeps no second copy of it', blurb(path.join('public', 'home.js')) === null);

// ------------------------------------------- the tester note and Help page
/* Both used to be checked here against the roadmap's rows in board.json:
   anything on the roadmap that the tester note called never worth reporting,
   or Help called deliberate, failed. The roadmap is on the issue board since
   #3140 ("roadmap:" labels), which no file here holds, so the check went
   with it. That the tester note's list is still there is checked. Help's
   list of what is deliberate (Things that are normal here) was removed whole
   by Patrick on 26 Oct, so the check is that it stays gone. */
const tests = read(path.join('data', 'tests.md'));
yes('tests.md is there', tests !== null);
yes('it still has its Do not report these list',
    sections(tests || '').list.some(function (x) { return /do not report/i.test(x.heading); }));
const help = read(path.join('data', 'help.md'));
yes('help.md is there', help !== null);
yes('it has no list of what is deliberate any more', !/normal here|All of that is deliberate/i.test(help || ''));

// ----------------------------------------------- one copy only (#2414, #3140)
/* The text was kept twice, known.md for the page and a known board nothing
   showed, and the board went stale. Then the board was the one copy (#2414),
   and it went stale too. Since #3140 the one copy is the issue board, and
   neither known.md nor a known board in board.json comes back. */
yes('there is no known.md', read(path.join('data', 'known.md')) === null);
{
  let board = null;
  try { board = JSON.parse(read(path.join('data', 'board.json'))); } catch (e) { board = null; }
  yes('board.json has no known board and no roadmap board',
      !!board && !('known' in board) && !('roadmap' in board));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
