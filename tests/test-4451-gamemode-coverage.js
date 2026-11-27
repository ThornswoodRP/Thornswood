'use strict';
/*
  test-4451-gamemode-coverage.js

      node tests\test-4451-gamemode-coverage.js

  Issue #4451. docs/GAMEMODE-COVERAGE.md and docs/GAMEMODE.md left out three
  of the handlers the gamemode sets, and the guide said every handler is
  wrapped in guard() when some are not. This reads the gamemode's parts
  (game/gamemode/*.ts, which Build-Gamemode.js joins into gamemode.js) and
  holds:
    1  every mp.on* handler a part sets has a row in the coverage map, and
       each row names every part that sets it and no part that does not;
    2  the map gives no line numbers, which move with every change to the
       built file;
    3  the guide names every handler;
    4  every handler set without guard() (a function of its own, or a name
       that is not a guard()) is named in the guide's guard paragraph, and the
       paragraph names none that every part sets through guard().

  Reads the files only. Under a second.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ---- what the parts set ------------------------------------------------------
const PARTS = path.join(ROOT, 'game', 'gamemode');
const sets = {};   // handler -> [{ part, guarded }]
for (const part of fs.readdirSync(PARTS).filter((f) => f.endsWith('.ts')).sort()) {
  const text = read('game/gamemode/' + part);
  // Comments out, so a line that tells of a handler does not count as one.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const re = /(^|[^.\w])mp\.(on[A-Za-z0-9_]+)\s*=(?!=)\s*([^;\n]*)/g;
  let m;
  while ((m = re.exec(code))) {
    const rhs = m[3].trim();
    let guarded = /^guard\(/.test(rhs);
    const name = /^([A-Za-z_$][\w$]*)$/.exec(rhs);
    if (!guarded && name) guarded = new RegExp('\\b(var|let|const)\\s+' + name[1] + '\\s*=\\s*guard\\(').test(code);
    (sets[m[2]] = sets[m[2]] || []).push({ part: part, guarded: guarded });
  }
}
const handlers = Object.keys(sets).sort();
yes('the parts set handlers on mp (' + handlers.length + ')', handlers.length >= 16);
const built = read('game/gamemode.js');
yes('and the built gamemode.js sets each of them', handlers.every((h) => new RegExp('mp\\.' + h + '\\s*=(?!=)').test(built)));

// ---- 1, 2. the coverage map --------------------------------------------------
const map = read('docs/GAMEMODE-COVERAGE.md');
const rows = {};
for (const line of map.split('\n')) {
  const r = /^\|\s*mp\.(on[A-Za-z0-9_]+)\s*\|([^|]*)\|/.exec(line);
  if (r) rows[r[1]] = r[2];
}
for (const h of handlers) {
  const named = (rows[h] || '').match(/[\w-]+\.ts\b/g) || [];
  const want = Array.from(new Set(sets[h].map((s) => s.part))).sort();
  yes('the map has a row for mp.' + h + ' naming the parts that set it (' + want.join(', ') + ')',
      h in rows && JSON.stringify(Array.from(new Set(named)).sort()) === JSON.stringify(want), rows[h]);
}
const extra = Object.keys(rows).filter((h) => !(h in sets));
yes('and no row for a handler nothing sets (' + extra.join(', ') + ')', extra.length === 0);
yes('the map gives no line numbers', !/\|\s*Line\b/.test(map) && !Object.values(rows).some((c) => /^\s*\d+\s*$/.test(c)));

// ---- 3, 4. the guide -----------------------------------------------------------
const guide = read('docs/GAMEMODE.md');
for (const h of handlers) yes('the guide names mp.' + h, guide.indexOf('mp.' + h) >= 0);
const at = guide.indexOf('Most handlers are wrapped in `guard()`');
const para = at >= 0 ? guide.slice(at, guide.indexOf('\n\n', at)) : '';
yes('the guide has its guard paragraph', para.length > 0);
const bare = handlers.filter((h) => sets[h].some((s) => !s.guarded));
yes('mp.onThornswoodLogin is among those set without guard(), as the issue found', bare.indexOf('onThornswoodLogin') >= 0);
for (const h of bare) {
  yes('the guard paragraph names mp.' + h + ', which ' +
      sets[h].filter((s) => !s.guarded).map((s) => s.part).join(' and ') + ' sets without guard()', para.indexOf('mp.' + h) >= 0, para);
}
const said = (para.match(/mp\.on[A-Za-z0-9_]+/g) || []).filter((h) => bare.indexOf(h.slice(3)) < 0);
yes('and names no handler that is always guarded (' + said.join(', ') + ')', said.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
