// test-3137-known-real-bugs.js
//
//     node site/tests/test-3137-known-real-bugs.js
//
// The Known Issues page lists only what is actually broken, and every row of
// it is an issue on the board. What works the way it does on purpose is not
// listed anywhere: Patrick, 26 Oct, 11:42 AM, on Help's Things that are normal
// here: "we can just remove that whole section from help, this ism just
// clutter people arent fucking that stupid". So that section is gone too, and
// nothing points at it.
//
// Issue #3137, Patrick: "we need to add any of the known issues ion the discor
// or the website to the issues boards and get them fixed aswell as remove
// things that arent know issues like things that we removed how things work
// that we did on purpose etc and only put things that are actually
// broken/issues".
//
// WHAT WAS MEASURED ON 26 OCTOBER. The live page (/api/page/known) was the
// repo's known board but for one sentence #2703 had not deployed. It had
// fourteen rows and three prose sections. Read against the board and the code:
//   - real and on the board: mod scripts never fire (#503), killmoves (#2710);
//   - real with no open issue: the menus that still reset (#488 closed with
//     them left, now #3435); the tester note's instruments (#3434) and typing
//     in another window (#3436) were not on the page or the board at all;
//   - fixed: NPC behaviour differing near the same enemy (#504 closed, the
//     server runs the NPCs);
//   - no longer true: fishing "no rod needed" (the server asks for a pole);
//   - on purpose: the mods the collection took out, what the server owns, the
//     bare creation hall, leaving with no class, an old launcher, the load
//     order rule. Those went to help.md's Things that are normal here, which
//     Patrick then removed whole (26 Oct).
// The old harnesses for the sections that came off (test-known-npcs.js for the
// NPC section, test-known-page.js for the table of removed mods) went with
// them, since what they checked is no longer on the page by decision.
//
// A row recorded its issue as "issue" beside its cells. Since #3140 the rows
// are the board's own Findings issues, written out by the bot, so there is no
// typed row left; the checks of the rows went with them.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const { knownPage } = require('../../tests/fixtures/known-page');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }
function read(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return null; } }

const page = knownPage() || '';
const help = read('site/data/help.md') || '';
const content = read('bot/content.py') || '';

// 1. Every row on the page is an issue on the board. Since #3140 that holds
// by construction: the page is written from the board's Findings issues (the
// bot's lists.json), so there is no typed row left to check here. What the
// repository still writes is the page around the rows.
yes('the page around the rows is there', /^# Known Issues\n/.test(page));
yes('the page does not show issue numbers to testers', !/#\d{2,}/.test(page));

// 2. What came off: fixed, untrue, or on purpose.
[
  ['the NPC row #504 fixed', /NPC behaviour differs|Hosting changes every/i],
  ['the fishing row that said no rod is needed', /no rod needed/i],
  ['the table of mods the collection took out', /What the collection took out|SunHelm|TavernGames|Respawn - Death/i],
  ['what the server owns', /What the server owns/i],
  ['the load order rule', /The load order rule|LOAD ORDER ERROR/],
  ['the creation hall rows', /creation hall|leave the hall/i],
  ['the old launcher row', /before 26 September/i]
].forEach(function (c) { yes('the page no longer has ' + c[0], !c[1].test(page)); });
yes('the opening no longer sends anybody to Help for what is on purpose',
    !/on purpose|normal here/i.test(page.split('\n## ')[0]));

// 3. Help has no list of what is normal, and nothing points at one.
yes('Help has no Things that are normal here section', !/normal here/i.test(help));
yes('nor does any public page, the Known Issues intro or the Discord docs point at one',
    [read('site/data/site/join.md'), require('../../tests/site-files').source()].every(function (t) { return !/normal here|on purpose\.?$/im.test(t || ''); }) &&
    !/lists what works this way on purpose/.test(content));
yes('Help still says where to look first, and Known Issues lists what is broken',
    /\[Known Issues\]\(\/known\) first/.test(help));
yes('Help tells somebody with a launcher from before 26 September to take the installer again',
    /launcher last opened before 26 September/.test(help) && /\[Downloads\]\(\/downloads\)/.test(help));

// 5. Discord says the same about the page.
yes('Discord no longer calls the known issues page broken on purpose', !/broken on purpose/i.test(content));
yes('the Discord questions no longer explain NPCs by who is nearest or hosting swaps',
    !/Whoever is nearest is the one running them/.test(content) && !/Hosting swaps/.test(content));
yes('the menus that forget their settings are called a bug, not a lack of a save file',
    /forget their settings every session\. That is a\s+bug/.test(content) && !/no save\s+file for them/.test(content));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
