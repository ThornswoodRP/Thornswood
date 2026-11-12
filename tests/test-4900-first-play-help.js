/*
  test-4900-first-play-help.js

      node tests/test-4900-first-play-help.js

  #4900: since #3715 the first Play, and the first after the collection
  changes, builds Thornswood's animation and body files on the person's own
  computer before the game starts, and that takes a few minutes. When the
  build stops, Play stops with a box saying why. The site's Help page
  (site/data/help.md) and its join guide (site/data/site/join.md) said
  nothing about either, so the wait looked like a launcher that had stuck.

  The cause was that nothing tied the site's words to what the launcher
  says. This reads the launcher's own lines out of its source:

    - the status line Play shows while it builds (GeneratedHere.cs, said
      through Log under the wait cursor), its opening words and how long it
      says it takes;
    - the line under the box when the build stops (ShellPlay.cs), which says
      where each step is written down;
    - Scan's card for the files (Upkeep.cs), which says Fix builds them too.

  and fails unless both pages quote the status line's opening words, give
  the same wait, say it happens on the first Play, and send people to the
  same place the box does when it stops. Help must also say what to do then.
  A change to the launcher's words fails here until the pages follow.

  Read only.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/^\uFEFF/, '').split('\r\n').join('\n'); }
  catch (e) { return null; }
}
// What a reader sees: no bold marks, no comments, one space between words.
function flat(t) {
  let out = '';
  for (let at = 0; at < t.length;) {
    const open = t.indexOf('<!--', at);
    if (open < 0) { out += t.slice(at); break; }
    out += t.slice(at, open);
    const shut = t.indexOf('-->', open + 4);
    at = shut < 0 ? t.length : shut + 3;
  }
  return out.split('**').join('').replace(/\s+/g, ' ');
}
function section(t, head) {
  const at = t.indexOf('\n## ' + head + '\n');
  if (at < 0) return null;
  const next = t.indexOf('\n## ', at + 4 + head.length);
  return t.slice(at, next < 0 ? t.length : next);
}
const has = (text, words) => text.toLowerCase().indexOf(words.toLowerCase()) >= 0;

// ------------------------------------------------- the launcher's own words --
console.log('The launcher\'s words:');
const here = read('launcher/app/GeneratedHere.cs') || '';
const play = read('launcher/app/ShellPlay.cs') || '';
const upkeep = read('launcher/app/Upkeep.cs') || '';

// say("Building ... (" + why + "). This takes a few minutes.");
const status = /say\("(Building [^"]*) \(" \+ why \+ "\)\. This takes ([^".]+)\."\);/.exec(here);
yes('GeneratedHere.cs says the build on the status line, and how long it takes', !!status);
// The opening words, up to where the line starts naming the tools.
const opening = status ? status[1].split(' on this computer')[0] : '';
const wait = status ? status[2] : '';
yes('  its opening words (' + opening + ')', /^Building .+ files$/.test(opening));
yes('  and its wait (' + wait + ')', wait.length > 0);
yes('Play runs that build under the wait cursor, its lines to the status line',
    /Waiting\([\s\S]{0,200}GeneratedHere\.Ensure\(SafeLog\)/.test(play));

// Ask.Tell(notBuilt + "\n\nThe launcher log on the Diagnostics page has each step it took.", ...)
const stop = /Ask\.Tell\(notBuilt \+ "(?:\\n)*([^"]+)"/.exec(play);
const stopLine = stop ? stop[1] : '';
yes('ShellPlay.cs shows the stop in a box with a line saying where the steps are (' + stopLine + ')', !!stop);
// Where it sends people: the words before " has each step".
const where = stopLine.split(' has each step')[0].replace(/^The /, '');
yes('  that line names a place (' + where + ')', /log/i.test(where) && /Diagnostics/.test(where));
const fixBuilds = upkeep.indexOf('Fix builds them now') >= 0;
yes('Scan\'s card says Fix builds them too', fixBuilds);

// ------------------------------------------------------------------- pages --
function holds(name, text) {
  const f = flat(text || '');
  yes(name + ' quotes the status line\'s opening words, "' + opening + '"', !!opening && f.indexOf(opening) >= 0);
  yes(name + ' says it takes ' + wait, !!wait && has(f, 'takes ' + wait));
  yes(name + ' says it happens on the first Play', /first (time you press )?Play|first Play/i.test(f));
  yes(name + ' says the game does not start when it stops', /game does not start/i.test(f));
  yes(name + ' sends people where the box does, ' + where, !!where && has(f, where));
  return f;
}

console.log('\nHelp (site/data/help.md):');
const help = read('site/data/help.md') || '';
const install = section(help, 'Installing it the first time');
const wrong = section(help, 'When something goes wrong');
yes('Help has Installing it the first time and When something goes wrong', !!install && !!wrong);
const fi = flat(install || '');
yes('Installing it the first time quotes the status line\'s opening words', !!opening && fi.indexOf(opening) >= 0);
yes('  and says it takes ' + wait, !!wait && has(fi, 'takes ' + wait));
const fw = holds('When something goes wrong', wrong);
yes('  and says to put right what the box names', /what the box (names|says)/i.test(fw));
if (fixBuilds) yes('  and that Fix on Diagnostics builds them again', /Scan[^.]*Fix[^.]*build/i.test(fw));
yes('  and how to send it to staff if it stops again', /Build the report/.test(fw) && /\(\/report\)|ticket/.test(fw));

console.log('\nThe join guide (site/data/site/join.md):');
const join = read('site/data/site/join.md') || '';
const step = section(join, '5. Press Play');
yes('the join guide has 5. Press Play', !!step);
const fs5 = holds('5. Press Play', step);
yes('  and points at Help for what to do', /\]\(\/help\)/.test(fs5));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
