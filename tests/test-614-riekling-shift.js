// test-614-riekling-shift.js
//
// A new riekling starts in its own clothes, and a riekling tailor can make them.
//
// WHY. #614: a riekling in the Belted Tunic and Boots was drawn with the human
// sized Khajiit model, the neck in the wrong place and the body showing through,
// because those two items have no armour addon for either playable Riekling
// race and both races name KhajiitRace as their armour race. Patrick, 12 October
// 2026: "Rieklings get Riekling clothing", and later that evening the riekling
// cut of the same clothes rather than its light armour. So a riekling's shift
// is Playable Rieklings.esp's Riekling Belted Tunic and Riekling Footwraps,
// both clothing, and those two come out of the cut file to the Haberdasher.
//
// This lifts the real giveShift and rieklingShift out of gamemode.js by text and
// runs them against a stand-in mp. GM points it at another copy of the file,
// which is how it was shown to fail on the code before the change.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function fnOf(head) {
  const a = src.indexOf(head);
  const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + 2) : null;
}

const giveShiftSrc = fnOf('function giveShift(actorId) {');
const rieklingSrc = fnOf('function rieklingShift(actorId, race) {');
const chooseSrc = fnOf('function beginChoosing(actorId, state, why) {');
const CHARGEN_SRC = (/\nconst CHARGEN = (\{[^\n]*\});/.exec(src) || [])[1] || null;
const CHARGEN = CHARGEN_SRC ? JSON.parse(CHARGEN_SRC) : null;

yes('giveShift is in the gamemode', !!giveShiftSrc);
yes('rieklingShift is in the gamemode', !!rieklingSrc);
yes('CHARGEN has a riekling shift', !!(CHARGEN && Array.isArray(CHARGEN.rieklingShift)));

// ------------------------------------------------------ the pieces themselves
const TUNIC = 'bfd98:Playable Rieklings.esp';
const FEET = 'bfdb1:Playable Rieklings.esp';
const RS = (CHARGEN && CHARGEN.rieklingShift) || [];
yes('the riekling shift is the Riekling Belted Tunic and the Riekling Footwraps, one each',
  RS.length === 2 && RS.every(function (p) { return p[1] === 1; }) &&
  [TUNIC, FEET].every(function (d) { return RS.some(function (p) { return p[0] === d; }); }));
yes('the human shift is still the Belted Tunic and the Boots',
  !!CHARGEN && JSON.stringify(CHARGEN.shift) === JSON.stringify([['1be1a:Skyrim.esm', 1], ['1be1b:Skyrim.esm', 1]]));
yes('beginChoosing, the step after the race menu, gives the shift for the race',
  !!chooseSrc && /giveShift\(actorId\)/.test(chooseSrc));
if (fail) { done(); }

// ------------------------------------------------------------- the stand-in
const IDS = {
  '1be1a:Skyrim.esm': 0x1be1a, '1be1b:Skyrim.esm': 0x1be1b,
  [TUNIC]: 0x0b0bfd98, [FEET]: 0x0b0bfdb1
};
const GOLD = 0xf;
function world(race, pack) {
  const props = { 7: { inventory: { entries: pack } } };
  const calls = [];
  const lines = [];
  const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const mp = {
    get(id, key) { return copy((props[id] || {})[key]); },
    set(id, key, value) { (props[id] = props[id] || {})[key] = copy(value); calls.push('set ' + key); },
    getDescFromId(id) { return id.toString(16) + ':Thornswood'; },
    callPapyrusFunction(kind, cls, name, self, args) {
      calls.push([kind, cls, name, self.desc, args[0] && args[0].desc, args[1], args[2]].join(' '));
      return null;
    }
  };
  const make = new Function('mp', 'log', 'idOf', 'SHIFT', 'RIEKLING_SHIFT', 'raceOf',
    rieklingSrc + '\n' + giveShiftSrc + '\nreturn giveShift;');
  const give = make(mp, (...a) => lines.push(a.join(' ')), d => IDS[d] || 0,
    CHARGEN.shift, CHARGEN.rieklingShift, () => race);
  return { give, mp, calls, lines, pack: () => mp.get(7, 'inventory').entries };
}
const made = () => [
  { baseId: 0x1be1a, count: 1, worn: true },
  { baseId: 0x1be1b, count: 1, worn: true },
  { baseId: GOLD, count: 40 }
];
const has = (pack, id) => pack.some(e => e.baseId === id && e.count > 0);

// -------------------------------------------------- somebody who is not one
{
  const w = world('nordrace', made());
  w.give(7);
  yes('a nord keeps the tunic and the boots', has(w.pack(), 0x1be1a) && has(w.pack(), 0x1be1b));
  yes('and is given no riekling piece and asked to put nothing on',
    !has(w.pack(), IDS[TUNIC]) && !w.calls.some(c => /EquipItem/.test(c)));
}

// ------------------------------------------------------------- a riekling
for (const race of ['1rieklingbluerace', '1rieklingpurplerace']) {
  const w = world(race, made());
  w.give(7);
  const pack = w.pack();
  yes(race + ': the tunic and the boots go back out of the pack',
    !has(pack, 0x1be1a) && !has(pack, 0x1be1b));
  yes(race + ': the riekling tunic and footwraps are in it',
    has(pack, IDS[TUNIC]) && has(pack, IDS[FEET]));
  yes(race + ': the purse is untouched', pack.some(e => e.baseId === GOLD && e.count === 40));
  const equips = w.calls.filter(c => /EquipItem/.test(c));
  yes(race + ': its game is asked once for each piece, silently, never to keep it on',
    equips.length === 2 &&
    [TUNIC, FEET].every(d => equips.some(c => c === 'method Actor EquipItem 7:Thornswood ' + d + ' false true')));
  yes(race + ': the pack is written before anything is asked',
    w.calls.indexOf('set inventory') === 0 && w.calls.filter(c => c === 'set inventory').length === 1);
  yes(race + ': the log says what was done', w.lines.some(l => /is a riekling/.test(l)));

  // A second pass, a reconnect while choosing.
  const before = w.calls.length;
  w.give(7);
  yes(race + ': a second pass changes nothing and asks nothing', w.calls.length === before);
}

// A riekling whose pack never had the shift (taken off and dropped in the hall).
{
  const w = world('1rieklingbluerace', [{ baseId: GOLD, count: 40 }]);
  w.give(7);
  yes('a riekling with no shift in the pack still gets its own two pieces',
    has(w.pack(), IDS[TUNIC]) && has(w.pack(), IDS[FEET]) &&
    w.calls.filter(c => /EquipItem/.test(c)).length === 2);
}

// A riekling whose race could not be read is given the shift, as anybody.
{
  const w = world('', made());
  w.give(7);
  yes('no race read: the shift stays and nothing is asked',
    has(w.pack(), 0x1be1a) && !w.calls.some(c => /EquipItem/.test(c)));
}

// ------------------------------------------------- the tailor makes them
// The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
const BOOK = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID') || {};
function row(desc) { return BOOK[desc] || null; }
const RECIPE = {
  'bfee5:Playable Rieklings.esp': TUNIC,
  'bfefb:Playable Rieklings.esp': FEET
};
// The light armour pieces the first pass put back (#2503) are cut again.
const ARMOUR = ['19f92:Playable Rieklings.esp', '19f94:Playable Rieklings.esp',
  '19f90:Playable Rieklings.esp', '19f91:Playable Rieklings.esp'];
for (const r of Object.keys(RECIPE)) {
  const x = row(r);
  yes('recipe ' + r + ' makes ' + RECIPE[r] + ', Haberdasher work at novice, race locked to a riekling',
    !!x && x.out === RECIPE[r] && x.owner === 'Tailor' && x.half === 'Haberdasher' &&
    x.rank === 'novice' && x.race === 'riekling' && !x.nobody);
}
const cut = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'cut-items.json'), 'utf8'));
yes('and neither is in the cut file',
  Object.keys(RECIPE).every(id => !cut.items.some(i => i.id === id)));
yes('the loincloths and cloth wraps are cut again, and nobody makes them',
  ARMOUR.every(id => cut.items.some(i => i.id === id && i.disposition === 'cut')) &&
  ARMOUR.every(id => { const x = row(id); return !x || !!x.nobody; }));
yes('the cut file names them with the riekling pieces that stay',
  ['Riekling Belted Tunic', 'Riekling Footwraps'].every(n => cut.rieklingKept.indexOf(n) >= 0) &&
  ['Riekling LoinCloth 1', 'Riekling Cloth Hand Wraps'].every(n => cut.rieklingKept.indexOf(n) < 0));

done();
