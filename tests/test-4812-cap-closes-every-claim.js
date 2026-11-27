// test-4812-cap-closes-every-claim.js
//
//     node tests/test-4812-cap-closes-every-claim.js
//
// WHY THIS EXISTS. Issue #4812. Any panel that holds the keyboard for two
// minutes has its claim taken back by the cap in thornswood-front.js, and the
// cap first closes that panel's window by its name in CAP_CLOSES. The
// furniture panel claimed the keyboard and had no name there, so the cap took
// the claim back and left the panel drawn with focus down: its Escape and its
// Close button could not be reached, the trap the cap was written to end.
//
// What it checks, on the real files:
//   1. every name any plugin claims the keyboard for, read from its
//      claimFocus('<name>', ...) calls that can raise it (true, or a test
//      such as the choice's choiceUp()), has a window in CAP_CLOSES, the chat
//      box apart (it has three watchdogs of its own and is never closed by
//      name); and CAP_CLOSES names nothing nobody claims;
//   2. the furniture panel is one of them: CAP_CLOSES.furniture is
//      thornswoodFurniture, the page assigns it with a close, and that close
//      says furniture:closed, which the plugin answers by releasing the claim;
//   3. the cap itself, run in a sandbox with a furniture claim held for over
//      two minutes, closes thornswoodFurniture before it releases the claim.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const pluginDir = path.join(repo, 'game', 'plugins');
const front = fs.readFileSync(path.join(pluginDir, 'thornswood-front.js'), 'utf8');

function capCloses(src) {
  const start = src.indexOf('const CAP_CLOSES = {');
  if (start < 0) { return null; }
  const end = src.indexOf('\n  };', start);
  if (end < 0) { return null; }
  try { return new Function('return ' + src.slice(src.indexOf('{', start), end) + '\n};')(); } catch (e) { return null; }
}
const closes = capCloses(front);
yes('CAP_CLOSES reads from the front', !!closes && Object.keys(closes).length >= 10);

// ---- 1. every claim has a closer ------------------------------------------------------
const claimed = new Set();
fs.readdirSync(pluginDir).filter(function (f) { return f.endsWith('.js'); }).forEach(function (f) {
  const src = fs.readFileSync(path.join(pluginDir, f), 'utf8');
  const re = /claimFocus\(\s*'([a-z]+)'\s*,\s*(?!false\s*\))/g;
  let m;
  while ((m = re.exec(src))) { claimed.add(m[1]); }
});
yes('the plugins claim the keyboard by name, the chat box and the furniture panel among them',
    claimed.size >= 10 && claimed.has('chat') && claimed.has('furniture'));
const missing = Array.from(claimed).filter(function (n) { return n !== 'chat' && !(closes && closes[n]); });
yes('every name that claims the keyboard has a window for the cap to close, the chat box apart' +
    (missing.length ? ' (not: ' + missing.join(', ') + ')' : ''), missing.length === 0);
const stray = closes ? Object.keys(closes).filter(function (n) { return !claimed.has(n); }) : [];
yes('and CAP_CLOSES names nothing nobody claims' + (stray.length ? ' (not: ' + stray.join(', ') + ')' : ''), stray.length === 0);
yes('the chat box is not closed by name: it has its own watchdogs', !!closes && !closes.chat &&
    front.includes("if (who === 'chat') { continue; }"));

// ---- 2. the furniture panel -----------------------------------------------------------
const page = fs.readFileSync(path.join(repo, 'game', 'ui', 'thornswood-furniture.js'), 'utf8');
yes('CAP_CLOSES.furniture is thornswoodFurniture', !!closes && closes.furniture === 'thornswoodFurniture');
yes('the furniture page assigns window.thornswoodFurniture with a close', /window\.thornswoodFurniture = \{[\s\S]*?close: close,/.test(page) &&
    /function close\(\) \{/.test(page));
yes('  and its close says furniture:closed', /function close\(\) \{[\s\S]*?tell\('closed'\);/.test(page));
yes('  which the plugin answers by releasing the claim', front.includes("if (what === 'furniture:closed') { T.claimFocus('furniture', false); return; }"));

// ---- 3. the cap, run --------------------------------------------------------------------
const capStart = front.indexOf('    for (const who in claimedAt) {');
const capEnd = capStart < 0 ? -1 : front.indexOf('\n    checkServer(now);', capStart);
yes('the cap loop reads from the front', capStart > 0 && capEnd > capStart);
if (capStart > 0 && capEnd > capStart) {
  const calls = [];
  const now = 1000000;
  const sandbox = {
    now: now, claimedAt: { furniture: now - 121000 }, claims: { furniture: true }, CAP_CLOSES: closes,
    skillsCreating: false, choiceUp: function () { return false; }, log: function () {},
    T: { js: function (code) { calls.push('js ' + code); }, claimFocus: function (who, on) { calls.push('claim ' + who + ' ' + on); } }
  };
  vm.runInNewContext(front.slice(capStart, capEnd), sandbox);
  yes('a furniture claim held past two minutes closes thornswoodFurniture',
      calls[0] === "js try{window.thornswoodFurniture&&window.thornswoodFurniture.close();}catch(e){}");
  yes('  and then releases the claim', calls[1] === 'claim furniture false' && calls.length === 2);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
