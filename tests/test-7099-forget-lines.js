// test-7099-forget-lines.js
//
//     node tests/test-7099-forget-lines.js
//
// #7099. A main session's front log on 24 Nov had "menu: forgetting
// character" and, two seconds later, a pick of a new character, and nothing
// said what put the choice page's confirm strip up or what answered it. The
// page (game/ui/thornswood-select.js) now tells the front how a forget was
// asked (the Delete key, the bin) and how it was answered (Enter, the Forget
// button, Escape, the Keep button), with the time between, so the next one
// says whether it was a stray key or click or a deliberate forget.
//
// What it checks:
//   1. every way to ask and every way to answer says which it was;
//   2. the two lines reach the front log as "choice page: ..." and are never
//      taken for the forget itself ("select:forget <id>");
//   3. the two functions, run on their own: the ask's line, the answer's line
//      with the milliseconds between them, and an answer with no ask seen.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }
const page = read('game/ui/thornswood-select.js');
const front = read('game/plugins/thornswood-front.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- 1. every way in and out says which ------------------------------------
console.log('the ways');
yes('Delete on a lit character asks, and says the Delete key',
  page.includes("if (e && e.c) { asking = e.id; askedHow('the Delete key'); draw(); }"));
yes('the bin asks, and says the bin, also when the click lands on the card',
  page.includes("ask(i, e.id, 'the bin');") &&
  page.includes("ask(wasSlot < 0 ? i : wasSlot, null, 'the bin, the click landing on the card');") &&
  /function ask\(i, id, how\) \{[\s\S]*?askedHow\(how\);[\s\S]*?\}/.test(page));
yes('Enter on the strip says Enter before it forgets',
  page.includes("if (key === 'Enter') { answered('confirmed by Enter'); forget(asking); return true; }"));
yes('the Forget button says so before it forgets',
  page.includes("answered('confirmed by the Forget button'); forget(e.id);"));
yes('Escape and the Keep button say the character was kept',
  page.includes("answered('kept, by Escape'); asking = 0;") && page.includes("answered('kept, by the Keep button'); asking = 0;"));
const forgets = (page.match(/forget\((asking|e\.id)\)/g) || []).length;
const confirms = (page.match(/answered\('confirmed by [^']+'\); forget\((asking|e\.id)\)/g) || []).length;
yes('no forget goes without its answer line (' + confirms + ' of ' + forgets + ')', forgets === 2 && confirms === 2);

// ---- 2. into the front log, never taken for the forget ----------------------
console.log('');
console.log('the front log');
yes('the page sends each line as select:<line>',
  page.includes("window.skyrimPlatform.sendMessage('thornswood-front', 'select:' + what);"));
yes('the front writes a select line it has no handler for as "choice page: <line>"',
  front.includes("if (what.indexOf('select:alive') !== 0) { log('choice page:', what.slice(7)); }"));
const prefixes = (front.match(/what\.indexOf\('select:[^']*'\) === 0/g) || [])
  .map(function (m) { return m.slice("what.indexOf('select:".length, -"') === 0".length); })
  .filter(function (p) { return p && p !== 'alive'; });
const equals = (front.match(/what === 'select:[^']*'/g) || []).map(function (m) { return m.slice("what === 'select:".length, -1); });
const lines = ['asked to forget, by the Delete key', 'the ask to forget was confirmed by Enter, 120 ms after it was asked'];
yes('neither line starts with a word the front handles on its own (forget, want, keycheck and the rest: ' +
    prefixes.join(', ') + ')',
  prefixes.indexOf('forget ') !== -1 &&
  lines.every(function (l) { return prefixes.every(function (p) { return l.indexOf(p) !== 0; }) && equals.indexOf(l) === -1; }));

// ---- 3. the two functions, run ----------------------------------------------
console.log('');
console.log('the lines');
const a = page.indexOf('  function askedHow(how) {');
const b = page.indexOf('\n  }\n', page.indexOf('  function answered(how) {'));
yes('askedHow and answered are in the page', a > 0 && b > a);
if (a > 0 && b > a) {
  const told = [];
  let now = 1000;
  const ctx = { tell: function (w) { told.push(w); }, Date: { now: function () { return now; } }, askedAt: 0 };
  vm.runInNewContext('var askedAt = 0;\n' + page.slice(a, b + 4) +
    '\nthis.askedHow = askedHow; this.answered = answered;', ctx);
  ctx.askedHow('the Delete key');
  now += 180;
  ctx.answered('confirmed by Enter');
  ctx.answered('kept, by Escape');
  yes('the ask says how it came', told[0] === 'asked to forget, by the Delete key');
  yes('the answer says how, and how long after the ask', told[1] === 'the ask to forget was confirmed by Enter, 180 ms after it was asked');
  yes('an answer with no ask before it says so', told[2] === 'the ask to forget was kept, by Escape, with no ask seen');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
