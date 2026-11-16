'use strict';
/*
  test-4543-company-words.js

      node tests/test-4543-company-words.js

  #4543: the Free Skyrim Trading Company is wired into the gamemode
  (globalThis.__thornswoodCompany, game/gamemode/company-terms.ts): the
  property block posts and pays hauls by it, the trade block splits sales by
  it, and the trade ship dock asks it before every load and sail (#2700).
  Two comments still said otherwise: game/trading-company.js's header ("it
  is not wired in yet"), which Build-TradingCompanyGamemode.js copies into
  the TRADING_COMPANY block, and company-terms.ts ("Nothing loads a ship
  yet"). This holds the words to the code:
    1 neither stale line is in the module, the block or gamemode.js
    2 the dock does ask the company, so saying it is wired in is true
    3 nothing calls freightFor, and the comments say so; the day something
      does, this fails and the comments are put right with it

  Read only.
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8').split(String.fromCharCode(13)).join(''); }

const lib = read('game/trading-company.js');
const terms = read('game/gamemode/company-terms.ts');
const gm = read('game/gamemode.js');
const dock = read('game/gamemode/trade-dock-bundle.ts');

const STALE = [/not wired in yet/, /Nothing loads a ship yet/];
[['game/trading-company.js', lib], ['game/gamemode/company-terms.ts', terms], ['game/gamemode.js', gm]].forEach(function (f) {
  STALE.forEach(function (re) {
    yes('1 ' + f[0] + ' does not say "' + re.source + '"', !re.test(f[1]));
  });
});

yes('2 the trade ship dock asks the company before a load or a sail', /charterOf\(g\.__thornswoodCompany/.test(dock));
yes('2 and the module\'s header says the gamemode reads it through __thornswoodCompany', /__thornswoodCompany/.test(lib.slice(0, lib.indexOf('*/'))));

/* Lines that call freightFor: not its definition, the handle's pass-through to the module, or the comment that lists it. */
const callers = gm.split('\n').filter(function (l) {
  return /freightFor\(/.test(l) && !/function freightFor\(|LIB\.freightFor\(|freightFor\(\)\s+\{ gold/.test(l);
});
yes('3 nothing in the gamemode calls freightFor (' + callers.length + ' line(s)' + (callers.length ? ': ' + callers.join(' | ').trim() : '') + ')', callers.length === 0);
yes('3 and both comments say no freight is charged on a load', /Nothing calls freightFor yet/.test(lib) && /Nothing calls freightFor yet/.test(terms));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
