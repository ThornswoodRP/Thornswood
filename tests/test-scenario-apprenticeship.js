'use strict';
/*
  test-scenario-apprenticeship.js

  Scenario: systems/apprenticeship.md

  #5198. Masters and apprentices, end to end: the WHOLE of game/gamemode.js
  over the stand-in server (tests/stand-in-server.js), every step a message
  the engine sends in the order it sends them. The K page's Take on and End
  buttons and the look prompt's accept are lines through the voice queue
  (/apprentice, /yes), as the panel sends them; the work is enchanting at an
  arcane enchanter, CraftService's onCraftWork and onCraft with the effects
  and the inputs. A login is the launcher's pass and onThornswoodLogin.

  Wynn is a novice Bladebinder whose sister half, Wardweaver, has 99 pieces
  of work toward advanced. Sigrid is a Wardweaver at Master. Brenna is a
  smith who has never been taught anything; Corvin a tailor who has had both
  his outside trades; Ulfr a novice Wardweaver. Each carries a rune knife,
  armour and petty soul gems, at an arcane enchanter in Windhelm.

    A  The sister half waits: Wynn's next Wardweaver piece takes the count to
       the threshold, and there it waits, at novice.
    B  Only a Master takes anybody on: Ulfr is told so.
    C  Sigrid offers to take Wynn on in Wardweaver, Wynn is told what it is
       and accepts, and both characters carry it.
    D  The next piece is the one that raises her: advanced Wardweaver, said,
       and Resist Fire, advanced Wardweaver work, now goes through.
    E  A restart: both sides still carry it.
    F  An outside trade: Sigrid teaches Brenna novice Wardweaver. Brenna can
       put Fortify Health on armour, and Resist Fire is refused with the
       ceiling being the teaching. Corvin, with his two used, is refused.
    G  Ending: Wynn leaves; her advanced rank stays and Sigrid's list loses
       her. Sigrid ends Brenna's teaching; its novice list is gone, it still
       counts, and the bench refuses her again.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  A mage teaching a school and a taught staff are Magic and the College's
  scenario; the 120% repair is Durability's.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-apprenticeship.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'apprenticeship' });
const CITY = '1691d:Skyrim.esm';
const TABLE_BASE = 'bad0d:Skyrim.esm';               // an arcane enchanter: BENCH_BY_BASE names it enchanting
const KNIFE = '1b002:Thornswood-Content.esp';         // the rune knife
const FORTIFY_HEALTH = '493aa:Skyrim.esm', RESIST_FIRE = '48c8b:Skyrim.esm';
const ARMOR = '12e49:Skyrim.esm', PETTY = '2e4e3:Skyrim.esm';
[FORTIFY_HEALTH, RESIST_FIRE].forEach(function (d) { w.record(d, 'MGEF'); });
function bod2(slots, kind) { return { type: 'BOD2', data: [slots & 255, (slots >> 8) & 255, (slots >> 16) & 255, (slots >>> 24) & 255, kind, 0, 0, 0] }; }
w.record(ARMOR, 'ARMO', { editorId: 'ArmorIronCuirass', fields: [bod2(1 << 2, 1)] });
w.record(PETTY, 'SLGM', { editorId: 'SoulGemPettyFilled' });
w.record(TABLE_BASE, 'FURN', { editorId: 'CraftingEnchantingWorkbench' });
w.record(KNIFE, 'MISC');
const id = w.idOf;
const TABLE = w.ref(0xff2000a0, { base: TABLE_BASE, cell: CITY, pos: [2000, 0, 0] });

function pack() {
  return { entries: [{ baseId: id(ARMOR), count: 6 }, { baseId: id(PETTY), count: 6 }, { baseId: id(KNIFE), count: 1 }] };
}
function at(n) { return [2040 + 30 * n, 0, 0]; }
const WYNN = w.person(0xff001500, { profileId: 1000, name: 'Wynn', prof: 'enchanter', half: 'bladebinder', cell: CITY, pos: at(0), inventory: pack(),
  character: { work: { wardweaver: 99 } } });
const SIGRID = w.person(0xff001501, { profileId: 1002, name: 'Sigrid', prof: 'enchanter', half: 'wardweaver', rank: 'master', cell: CITY, pos: at(1), inventory: pack() });
const BRENNA = w.person(0xff001502, { profileId: 1004, name: 'Brenna', prof: 'smith', cell: CITY, pos: at(2), inventory: pack() });
const CORVIN = w.person(0xff001503, { profileId: 1006, name: 'Corvin', prof: 'tailor', cell: CITY, pos: at(3), inventory: pack(),
  character: { taught: ['hearthcook', 'woodwright'] } });
w.row(CORVIN).thornswoodCharacter.ranks.hearthcook = 'novice';
w.row(CORVIN).thornswoodCharacter.ranks.woodwright = 'novice';
const ULFR = w.person(0xff001504, { profileId: 1008, name: 'Ulfr', prof: 'enchanter', half: 'wardweaver', cell: CITY, pos: at(4), inventory: pack() });
const EVERYONE = [WYNN, SIGRID, BRENNA, CORVIN, ULFR];
EVERYONE.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 80, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function hex(a) { return a.toString(16); }
function ch(a) { return w.prop(a, 'thornswoodCharacter') || {}; }
function rank(a, half) { return (ch(a).ranks || {})[half] || null; }
function work(a, half) { return (ch(a).work || {})[half] || 0; }
function show(a) {
  return JSON.stringify(w.row(a).inventory.entries.filter(function (e) { return e.count > 0; }).map(function (e) { return e.baseId.toString(16) + 'x' + e.count; }).sort());
}
let piece = 0xff000c00;
/* One enchantment on a piece of armour with a petty gem, at the table. */
function enchant(a, effect) {
  piece++;
  w.activate(TABLE, a);
  const r = w.craft(a, TABLE, { output: piece, count: 1, recipe: 0, effects: [id(effect)],
    inputs: [{ baseId: id(ARMOR), count: 1 }, { baseId: id(PETTY), count: 1 }] });
  w.activate(TABLE, a);
  return r;
}
function tookOn(master, learner, half) {
  return (ch(master).apprentices || []).some(function (r) { return r.id === learner && r.half === half; });
}
function masterOf(learner, half) { const m = (ch(learner).masters || {})[half]; return m ? m.id : 0; }
let heardAt = 0;

// --------------------------------------------------- A. the count waits --
const a1 = enchant(WYNN, FORTIFY_HEALTH);
yes('A1 Wynn\'s next Wardweaver piece takes the count to the threshold, and there it waits at novice (' +
  work(WYNN, 'wardweaver') + ', ' + rank(WYNN, 'wardweaver') + ')',
  a1.made && work(WYNN, 'wardweaver') === 100 && rank(WYNN, 'wardweaver') === 'novice');
const a2 = enchant(WYNN, FORTIFY_HEALTH);
yes('A2 another piece does not climb past it (' + work(WYNN, 'wardweaver') + ', ' + rank(WYNN, 'wardweaver') + ')',
  a2.made && work(WYNN, 'wardweaver') === 100 && rank(WYNN, 'wardweaver') === 'novice');

// ----------------------------------------------------- B. only a Master --
yes('B1 Ulfr, a novice, is told only a Master takes anybody on (' + say(ULFR, '/apprentice ' + hex(WYNN)) + ')',
  last(ULFR) === 'Only a Master takes anybody on, and you are not a Master of any half or school yet.' && !masterOf(WYNN, 'wardweaver'));

// ------------------------------------------------------- C. taken on --
heardAt = w.heard(WYNN).length;
const offered = say(SIGRID, '/apprentice ' + hex(WYNN) + ' wardweaver');
yes('C1 Sigrid offers to take Wynn on in Wardweaver (' + offered + ')', /^Asked Wynn to be your apprentice in Wardweaver\./.test(offered));
yes('C1 and Wynn is told it is her sister half, free, and not an outside trade (' + w.heardSince(WYNN, heardAt).join(' | ') + ')',
  w.heardSince(WYNN, heardAt).some(function (l) { return /^Sigrid offers to take you on in Wardweaver, your sister half, so it can climb past novice\. It costs nothing and it is not one of your two outside trades\./.test(l); }));
heardAt = w.heard(SIGRID).length;
const accepted = say(WYNN, '/yes');
yes('C2 Wynn accepts (' + accepted + ' | ' + w.heardSince(SIGRID, heardAt).join(' | ') + ')',
  /^Sigrid has taken you on in Wardweaver\./.test(accepted) &&
  w.heardSince(SIGRID, heardAt).some(function (l) { return l === 'Wynn is your apprentice in Wardweaver. K lists them, with End.'; }));
yes('C2 both characters carry it', masterOf(WYNN, 'wardweaver') === SIGRID && tookOn(SIGRID, WYNN, 'wardweaver'));

// ------------------------------------------------------- D. she climbs --
heardAt = w.heard(WYNN).length;
const d1 = enchant(WYNN, FORTIFY_HEALTH);
yes('D1 the next piece raises her to advanced Wardweaver, and she is told (' + rank(WYNN, 'wardweaver') + ', ' +
  work(WYNN, 'wardweaver') + ', ' + w.heardSince(WYNN, heardAt).join(' | ') + ')',
  d1.made && rank(WYNN, 'wardweaver') === 'advanced' && work(WYNN, 'wardweaver') === 1 &&
  w.heardSince(WYNN, heardAt).some(function (l) { return /^You are now an Advanced Wardweaver\./.test(l); }));
const d2 = enchant(WYNN, RESIST_FIRE);
yes('D2 Resist Fire, advanced Wardweaver work, now goes through (' + last(WYNN) + ')', d2.made && w.count(WYNN, piece) === 1);
yes('D2 and she is still a Bladebinder (' + ch(WYNN).half + ')', ch(WYNN).half === 'bladebinder');

// ------------------------------------------------------------ E. restart --
const r = w.restart();
yes('E1 the server restarts', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
yes('E1 and both sides still carry it', masterOf(WYNN, 'wardweaver') === SIGRID && tookOn(SIGRID, WYNN, 'wardweaver') &&
  rank(WYNN, 'wardweaver') === 'advanced');

// ---------------------------------------------------- F. an outside trade --
let before = show(BRENNA);
const f0 = enchant(BRENNA, FORTIFY_HEALTH);
yes('F1 untaught, Brenna is refused the table (' + last(BRENNA) + ')', !f0.made && show(BRENNA) === before);
heardAt = w.heard(BRENNA).length;
say(SIGRID, '/apprentice ' + hex(BRENNA) + ' wardweaver');
yes('F2 Sigrid offers to teach her novice Wardweaver, one of her two for life (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  w.heardSince(BRENNA, heardAt).some(function (l) { return /^Sigrid offers to teach you novice Wardweaver\. It is one of your two outside trades for life/.test(l); }));
const taught = say(BRENNA, '/yes');
yes('F2 she accepts: it is in her book, at novice (' + taught + ')',
  /^Sigrid taught you novice Wardweaver\./.test(taught) && (ch(BRENNA).taught || []).indexOf('wardweaver') !== -1 &&
  rank(BRENNA, 'wardweaver') === 'novice' && ch(BRENNA).prof === 'smith' && tookOn(SIGRID, BRENNA, 'wardweaver'));
const f3 = enchant(BRENNA, FORTIFY_HEALTH);
yes('F3 Brenna can put Fortify Health on armour (' + JSON.stringify(f3) + ')', f3.made && w.count(BRENNA, piece) === 1);
before = show(BRENNA);
const f4 = enchant(BRENNA, RESIST_FIRE);
yes('F4 Resist Fire is refused, and the ceiling is the teaching (' + last(BRENNA) + ')', !f4.made && show(BRENNA) === before &&
  /What a Master teaches you outside your own profession never goes further than novice/.test(last(BRENNA)));
const no = say(SIGRID, '/apprentice ' + hex(CORVIN) + ' wardweaver');
yes('F5 Corvin, with his two outside trades used, is refused (' + no + ')',
  no === 'No: they have had their 2 outside trades, and that is all there is in a life.' && !(ch(CORVIN).taught || []).includes('wardweaver'));

// ------------------------------------------------------------ G. ending --
const left = say(WYNN, '/apprentice leave wardweaver');
yes('G1 Wynn leaves: her advanced rank stays and Sigrid\'s list loses her (' + left + ')',
  !masterOf(WYNN, 'wardweaver') && !tookOn(SIGRID, WYNN, 'wardweaver') && rank(WYNN, 'wardweaver') === 'advanced');
heardAt = w.heard(BRENNA).length;
const ended = say(SIGRID, '/apprentice end ' + hex(BRENNA) + ' wardweaver');
yes('G2 Sigrid ends Brenna\'s teaching (' + ended + ' | ' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  /^You ended Brenna's novice Wardweaver\./.test(ended) && !tookOn(SIGRID, BRENNA, 'wardweaver') &&
  w.heardSince(BRENNA, heardAt).some(function (l) { return /its novice list is gone\. It still counts as one of your two outside trades\./.test(l); }));
yes('G2 the novice list is gone and it still counts (' + JSON.stringify(ch(BRENNA).taught) + ', ' + JSON.stringify(ch(BRENNA).untaught) + ')',
  !(ch(BRENNA).taught || []).includes('wardweaver') && !rank(BRENNA, 'wardweaver') && (ch(BRENNA).untaught || []).includes('wardweaver'));
before = show(BRENNA);
const g3 = enchant(BRENNA, FORTIFY_HEALTH);
yes('G3 and the table refuses her again (' + last(BRENNA) + ')', !g3.made && show(BRENNA) === before);

t.done(w);
