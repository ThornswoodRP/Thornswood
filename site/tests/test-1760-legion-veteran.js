// test-1760-legion-veteran.js
//
//     node .\site\tests\test-1760-legion-veteran.js
//
// The public site says a person can play a Legion veteran, and that the
// embassy's six armed are its own guard, not Legion (#1760). The site's world
// page said "You can play a Legion soldier, at the embassy", and its Article
// the Third made the six armed inside the walls the one exception to the
// Legion ban, while lore/accord.md says no Legion soldier may set foot in
// Skyrim under arms, the embassy guard are not Legion, and you cannot play a
// Legion soldier. Patrick, 5 Oct: the site says a person can play a Legion
// veteran and must not say "certain events may allow it"; the lore is right
// about the embassy. Since #3138 the world page is the Accord's only copy, and
// lore/accord.md points at it, so the page is read against the ban itself.
//
// What it checks:
//   1. site/data/site/world.md says you can play a Legion veteran, and never
//      that you can play a Legion soldier;
//   2. its Article the Third says no Legion soldier sets foot in Skyrim
//      under arms, and the embassy guard are not Legion;
//   3. no public page (every site/data/site/*.md, the site's own HTML, the
//      launcher's help and the bot's channel posts) says "certain events may
//      allow", or that a person can play a Legion soldier;
//   4. docs/systems/embassy.md still says the six are not Legion and a
//      veteran can be played.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
function flat(s) { return s.replace(/[*_`]/g, '').replace(/\s+/g, ' '); }
function slice(text, start, end) {
  const a = text.indexOf(start);
  const b = a < 0 ? -1 : text.indexOf(end, a + start.length);
  return a < 0 || b < 0 ? '' : text.slice(a, b);
}

const world = flat(read('site/data/site/world.md'));

// 1. what you can play
yes('the world page says you can play a Legion veteran', /You can play a Legion veteran\./.test(world));
yes('and never that you can play a Legion soldier', !/can play a (serving )?Legion soldier/i.test(world));
yes('and says you cannot play a serving one', /You cannot play a serving Legion soldier/.test(world));

// 2. Article the Third bans every Legion soldier
const siteThird = slice(world, 'Article the Third', 'Article the Fourth');
const ban = 'No Legion soldier may set foot in Skyrim under arms. The embassy guard are not Legion and are not to be called so.';
yes('the site\'s Article the Third bans every Legion soldier and says the embassy guard are not Legion', siteThird.indexOf(ban) >= 0);
yes('and no longer makes the six armed an exception to the Legion ban',
  !/whole of the exception/.test(siteThird) && !/armed anywhere in Skyrim outside the embassy walls/.test(siteThird));
yes('the page says the six armed at the embassy are its own guard, not Legion', /its own guard, not Legion/.test(world));

// 3. every public page
const pages = fs.readdirSync(path.join(REPO_DIR, 'site', 'data', 'site')).filter(function (f) { return /\.md$/.test(f); })
  .map(function (f) { return 'site/data/site/' + f; })
  .concat(fs.readdirSync(path.join(REPO_DIR, 'site', 'public')).filter(function (f) { return /\.html$/.test(f); })
    .map(function (f) { return 'site/public/' + f; }))
  .concat(['bot/content.py']);
const said = [];
for (const rel of pages) {
  const t = flat(read(rel));
  if (/certain events may allow/i.test(t)) { said.push(rel + ' says certain events may allow it'); }
  if (/can play a Legion soldier/i.test(t)) { said.push(rel + ' says you can play a Legion soldier'); }
}
yes('no public page (' + pages.length + ' read) says certain events may allow it, or that you can play a Legion soldier' +
  (said.length ? ' (' + said.join('; ') + ')' : ''), said.length === 0);

// 4. the embassy page agrees
const embassy = flat(read('docs/systems/embassy.md'));
yes('docs/systems/embassy.md says the 6 armed are the embassy\'s own guard, not Legion', /The 6 are the embassy's own guard, not Legion/.test(embassy));
yes('and that a Legion veteran can be played', /A Legion veteran who served in the war about fifty years ago and settled in a hold when the Legion left can be played/.test(embassy));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
