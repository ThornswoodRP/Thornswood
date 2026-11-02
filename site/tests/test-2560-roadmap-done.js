// test-2560-roadmap-done.js
//
// #2560: the public roadmap drifted from the board twice after #2561.
//   1. The #502 row still promised bounties, though #502 was rewritten on
//      12 Oct (no bounty at all) and #2472 removed the bounty system.
//   2. The Done rows #2561 added never reached /roadmap, because both
//      renderers (home.js and server.js's server-drawn page) skipped any
//      section named Done.
// Since #3140 the roadmap is built from the issue board, so the first cannot
// come back the same way: a row's words are its issue's "Roadmap:" comment.
// Since 26 Oct the bot writes no Done lane at all (Patrick: "Done section
// needs removed from the roadmap"), at its source, bot.py roadmap_once. The
// renderers still draw every lane they are given, in order, with no filter
// by name, so the bot alone decides the lanes and a lane can never again be
// written and not drawn: this plants a Done lane to prove that.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const siteFiles = require('../../tests/site-files');
const { listWriters } = require('../../tests/fixtures/known-page');
const root = path.join(__dirname, '..', '..');
let fails = 0;
function yes(name, ok) { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) fails++; }
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// 1. The bot's lists, planted, as server.js turns them into the roadmap.
const writers = listWriters(siteFiles.source());
yes('server.js has its list writers between their markers', !!writers);
const rm = writers ? writers.roadmapBoard({
  at: '2026-10-26T08:05:00Z',
  roadmap: { lanes: [
    { name: 'Being built now', rows: [{ title: 'Guards and cells run by people', text: 'A guard holds the cells of their own hold.' }] },
    { name: 'Next', rows: [] },
    { name: 'Later', rows: [{ title: 'The Thalmor war', text: 'A remnant holds the embassy.' }] },
    { name: 'Done', rows: [{ title: 'Thinning the crowd', text: 'The cast was cut.' }] }] }
}) : { sections: [] };
const secs = rm.sections || [];
yes('every lane is a section, in order, Done last',
    secs.map(s => s.name).join('|') === 'Being built now|Next|Later|Done');
yes('a row reads like the board it replaced: What, then Where it stands',
    secs[0] && secs[0].columns.map(c => c.name).join('|') === 'What|Where it stands' &&
    secs[0].rows[0].cells.what === 'Guards and cells run by people');

// 2. home.js draws Done: run its /roadmap branch on that roadmap
const home = read('site/public/home.js');
const start = home.indexOf("} else if (here === '/roadmap') {");
const end = home.indexOf("} else if (here === '/news') {");
yes('home.js has its /roadmap branch', start > 0 && end > start);
function draw(answer) {
  let drawn = '';
  if (start > 0 && end > start) {
    const branch = home.slice(start + "} else ".length, end);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const thenable = v => ({ then(f) { try { return thenable(f(v)); } catch (e) { return thenable(undefined); } }, catch() { return this; } });
    const ctx = {
      here: '/roadmap', esc,
      request: () => thenable({ json: () => answer }),
      show: html => { drawn = html; }
    };
    vm.runInNewContext(branch + '}', ctx);
  }
  return drawn;
}
const drawn = draw(rm);
yes('home.js draws a Done lane', /<h2>Done<\/h2>/.test(drawn));
yes('home.js draws "Thinning the crowd"', drawn.includes('Thinning the crowd'));
yes('home.js draws Done after Later', drawn.indexOf('<h2>Later</h2>') >= 0 && drawn.indexOf('<h2>Done</h2>') > drawn.indexOf('<h2>Later</h2>'));
yes('home.js leaves out a lane with nothing in it', drawn.indexOf('<h2>Next</h2>') < 0);
yes('home.js says when the board was read', drawn.includes('26 Oct 2026, 8:05 AM UTC'));
const unread = draw(writers ? writers.roadmapBoard(null) : {});
yes('a roadmap the bot has not written is said, not drawn empty',
    /could not be read from the issue board/.test(unread) && !/Nothing on it yet/.test(unread));

// 3. server.js's server-drawn /roadmap skips no Done section
const srv = siteFiles.source();
const s0 = srv.indexOf("} else if (route === '/roadmap') {");
const s1 = srv.indexOf("} else if (route === '/gallery') {", s0);
const block = s0 > 0 && s1 > s0 ? srv.slice(s0, s1) : '';
yes('server.js has its /roadmap block', !!block);
yes('server.js /roadmap does not skip a Done section', !!block && !/done/i.test(block.replace(/\/\/.*$/gm, '')));

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
