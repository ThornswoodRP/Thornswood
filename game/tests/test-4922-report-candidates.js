'use strict';
/*
  test-4922-report-candidates.js

      node game/tests/test-4922-report-candidates.js

  #4922: an in-game /report left out the person it is about only when the
  name matched exactly one person in the world. A shared first name, or a
  name nobody matched exactly, left nobody out, so a moderator the report
  was about could be told it.

  This runs the real asking staff block out of game/gamemode.js against a
  fake world and writes down every line each profile is told. A report is
  never told to anybody its name could mean: a full name, a shared first
  name, a surname, a short form. A name that could mean nobody in the world
  leaves nobody out, and the reply never says no staff are in the world when
  staff were there and kept out.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const GM = path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = fs.readFileSync(GM, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const kA = src.indexOf('// ==== thornswood asking staff ====');
const kB = kA < 0 ? -1 : src.indexOf('// ==== end thornswood asking staff ====', kA);
const block = (kA >= 0 && kB > kA) ? src.slice(kA, kB) : null;
yes('the asking staff block is in the gamemode', block !== null);

/*
  11 Aela asks. Staff: 12 Lydia Stormblade, 13 Lydia Brown, 14 Brynjolf,
  15 Farkas. 16 Ulfric is nobody in particular.
*/
let WORLD = {};
function world(rows) {
  WORLD = {};
  rows.forEach(function (r) { WORLD[0xff000000 + r[0]] = { profileId: r[0], name: r[1], cell: 'Whiterun', pos: [0, 0, 0] }; });
}
const EVERYONE = [[11, 'Aela'], [12, 'Lydia Stormblade'], [13, 'Lydia Brown'], [14, 'Brynjolf'], [15, 'Farkas'], [16, 'Ulfric']];
const STAFF = { 12: true, 13: true, 14: true, 15: true };
const fakeMp = {
  get(id, prop) {
    if (id === 0 && prop === 'onlinePlayers') return Object.keys(WORLD).map(Number);
    const a = WORLD[id];
    if (!a) throw new Error('no such actor');
    if (prop === 'profileId') return a.profileId;
    if (prop === 'appearance') return { name: a.name };
    if (prop === 'pos') return a.pos;
    if (prop === 'worldOrCellDesc') return a.cell;
    return undefined;
  }
};

const g = {};
const S = block ? new Function('mp', 'require', 'globalThis', 'console', 'URL', 'Buffer',
  block + '\nreturn globalThis.__thornswoodAskStaff;')(fakeMp, require, g, { log() { } }, URL, Buffer) : null;
yes('the block hands out its ask', !!(S && typeof S.ask === 'function'));

// No door.json where it runs, so the site answers at once that it was not reached.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4922-'));
const home = process.cwd();

function report(line) {
  g.__thornswoodAskSeen.by = {}; g.__thornswoodAskSeen.all = [];
  const said = [];
  process.chdir(scratch);
  try {
    S.ask('report', ('/report ' + line).split(/\s+/), 11, 0xff000000 + 11,
      function (pid, text) { said.push({ pid: pid, text: String(text) }); },
      function (pid) { return !!STAFF[pid]; });
  } finally { process.chdir(home); }
  const told = function (pid) { return said.filter(function (s) { return s.pid === pid; }).length; };
  return { said: said, told: told, staff: [12, 13, 14, 15].filter(function (p) { return told(p) > 0; }), reply: said.filter(function (s) { return s.pid === 11; }).map(function (s) { return s.text; }).join(' ') };
}

if (S) {
  world(EVERYONE);
  let r = report('lydia shoved me off the bridge');
  yes('a shared first name: neither Lydia is told, the other staff are (told ' + r.staff.join(',') + ')',
      r.told(12) === 0 && r.told(13) === 0 && r.told(14) === 1 && r.told(15) === 1);

  r = report('Brynj took my sword');
  yes('a short form of a name: Brynjolf is not told (told ' + r.staff.join(',') + ')',
      r.told(14) === 0 && r.told(12) === 1 && r.told(13) === 1 && r.told(15) === 1);

  r = report('Stormblade pushed me');
  yes('a surname alone: Lydia Stormblade is not told (told ' + r.staff.join(',') + ')',
      r.told(12) === 0 && r.told(13) === 1 && r.told(14) === 1 && r.told(15) === 1);

  r = report('lydia, by the gate, shoved me');
  yes('a name with a comma after it: neither Lydia is told (told ' + r.staff.join(',') + ')',
      r.told(12) === 0 && r.told(13) === 0);

  r = report('Lydia Stormblade shoved me');
  yes('a full name: that Lydia is not told, and neither is the other, whom the first name could mean (told ' + r.staff.join(',') + ')',
      r.told(12) === 0 && r.told(13) === 0 && r.told(14) === 1 && r.told(15) === 1);

  r = report('Brynjolf took my sword');
  yes('an exact name: Brynjolf is not told, every other member of staff is (told ' + r.staff.join(',') + ')',
      r.told(14) === 0 && r.told(12) === 1 && r.told(13) === 1 && r.told(15) === 1);

  r = report('Hadvar stole my horse');
  yes('a name that could mean nobody in the world leaves nobody out (told ' + r.staff.join(',') + ')',
      r.staff.join(',') === '12,13,14,15');

  r = report('Ulfric was rude');
  yes('nobody in particular reported: every member of staff is told', r.staff.join(',') === '12,13,14,15');
  yes('  and the line names who and what', r.said.some(function (s) { return s.pid === 15 && /Aela reported Ulfric: was rude \(at Whiterun\)/.test(s.text); }));

  world([[11, 'Aela'], [12, 'Lydia Stormblade'], [13, 'Lydia Brown']]);
  r = report('lydia shoved me');
  yes('with only the two Lydias on staff in the world, neither is told', r.staff.length === 0);
  yes('  and the reply does not say there are no staff in the world (' + r.reply + ')',
      !/[Nn]obody from staff is in the world/.test(r.reply) && /[Nn]o member of staff in the world was told/.test(r.reply));
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
