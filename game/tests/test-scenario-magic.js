'use strict';
/*
  test-scenario-magic.js

  Scenario: systems/magic.md

  #5198. Magic and the College, end to end: the WHOLE of game/gamemode.js
  over the stand-in server (tests/stand-in-server.js), every step a message
  the engine sends in the order it sends them. The spell book on K sends its
  /pick line; a tome is read as the engine reads a book (onReadBook, then the
  engine teaches the spell and spends the tome unless the server said no);
  a semester is E at a study desk (onActivate); a reanimate spell on a body
  is the OnHit the engine raises. The spells on a character are the
  engine's own list (Actor.AddSpell and the rest).

  Mira is a Mage of Destruction and Conjuration, novice in both, with the
  2 spell points a mage starts with. Brenna is a Smith a Master mage taught
  Destruction. Aldis has no magic at all. They stand in the Arcanaeum, by
  its study desk.

    A  The three gates on K: Mira picks Flames, and the point is spent and
       the spell is on her character. Firebolt, Advanced, is above her
       rank; Fire Storm, Master, too. Nothing is spent by a refusal.
    B  A tome: Firebolt's is refused, the line names the gate, and the tome
       stays in her pack. Sparks's teaches it, the point is spent and the
       engine spends the tome. With no point left, Frostbite's is refused
       and kept, and the line says why.
    C  Only the book is granted: a tome of a mod's spell, of a school and a
       rank, is refused and kept. A spell the book does not list that is on
       the character comes off at the next login.
    D  A semester: E at the desk hands Mira 2 points, in the Arcanaeum. A
       second press waits out the 24 hours. A desk outside the four halls
       is no semester. Aldis, with no magic, is told so.
    E  Somebody a Master mage taught: the spell book's pick is refused with
       the tome to read; the tome is refused with no point; a semester hands
       1, and then the tome teaches Flames.
    F  No thrall of a person: Raise Zombie on Aldis's body is refused, the
       body is put back down, and Mira is told. On a body the world placed
       it is the spell working as written.
    G  A restart: the books, the points and the semester's clock are as they
       were; the desk still waits, and opens once the 24 hours are past.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Restoration strain, which is a cast and its magicka, is driven in
  game/tests/test-1387-college.js; teaching itself is the apprenticeship
  scenario's.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-magic.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'magic' });

// --------------------------------------------------------------- records --
const SP = {
  flames: '12fcd:Skyrim.esm', sparks: '2dd2a:Skyrim.esm', frostbite: '2b96b:Skyrim.esm',
  firebolt: '12fd0:Skyrim.esm', firestorm: '7a82b:Skyrim.esm', zombie: '7e8e1:Skyrim.esm'
};
const MOD_SPELL = '1f00:Apocalypse - Magic of Skyrim.esp';   // a stand-in record for a mod's spell
const PERK = 'f2ca7:Skyrim.esm';                           // DestructionNovice00, the half cost perk
const REANIMATE_FX = '7e8e0:Skyrim.esm';                    // an effect of the Reanimate archetype
Object.keys(SP).forEach(function (k) { if (k !== 'zombie') { w.record(SP[k], 'SPEL'); } });
w.record(REANIMATE_FX, 'MGEF', { fields: [{ type: 'DATA', data: (function () { const b = new Array(0x44).fill(0); b[0x40] = 22; return b; })() }] });
w.record(SP.zombie, 'SPEL', { fields: [{ type: 'EFID', data: { ref: REANIMATE_FX } }] });
w.record(PERK, 'PERK', { editorId: 'DestructionNovice00' });
w.record(MOD_SPELL, 'SPEL', { editorId: 'ModSear', fields: [
  { type: 'FULL', data: Array.from(Buffer.from('Sear\0', 'latin1')) },
  { type: 'SPIT', data: { bytes: new Array(36).fill(0), refs: { 32: PERK } } }
] });
/* A spell tome: DATA flag 0x04 (TeachesSpell) and the spell at offset 4. */
function tome(desc, spell) {
  w.record(desc, 'BOOK', { fields: [{ type: 'DATA', data: { bytes: [4, 0, 0, 0, 0, 0, 0, 0, 0xee, 2, 0, 0, 0, 0, 128, 63], refs: { 4: spell } } }] });
  return w.idOf(desc);
}
const T = {
  firebolt: tome('a26fd:Skyrim.esm', SP.firebolt), sparks: tome('9cd53:Skyrim.esm', SP.sparks),
  frostbite: tome('9cd52:Skyrim.esm', SP.frostbite), flames: tome('9cd51:Skyrim.esm', SP.flames),
  mod: tome('1f01:Apocalypse - Magic of Skyrim.esp', MOD_SPELL)
};

const ARCANAEUM = '13810:Skyrim.esm', HALL = [0, 0, 0];
const DESK_BASE = '18032:Thornswood-Content.esp';
w.record(DESK_BASE, 'ACTI');
const DESK = w.ref(0xff200050, { base: DESK_BASE, cell: ARCANAEUM, pos: HALL });
const STREET = '1a26f:Skyrim.esm';
const STRAY_DESK = w.ref(0xff200051, { base: DESK_BASE, cell: STREET, pos: [20000, -8000, -3500] });
function at(n) { return [40 + 30 * n, 0, 0]; }
const pack = function (books) { return { entries: [{ baseId: 0xf, count: 40 }].concat(books.map(function (b) { return { baseId: b, count: 1 }; })) }; };

const MIRA = w.person(0xff001400, { profileId: 1000, name: 'Mira', prof: 'mage', cell: ARCANAEUM, pos: at(0),
  inventory: pack([T.firebolt, T.sparks, T.frostbite, T.mod]),
  character: { schools: ['destruction', 'conjuration'], ranks: { destruction: 'novice', conjuration: 'novice' }, spells: { points: 2, known: [] } } });
const BRENNA = w.person(0xff001401, { profileId: 1001, name: 'Brenna', prof: 'smith', cell: ARCANAEUM, pos: at(1), inventory: pack([T.flames]) });
const ALDIS = w.person(0xff001402, { profileId: 1002, name: 'Aldis', prof: 'smith', cell: ARCANAEUM, pos: at(2) });
const ALL = [MIRA, BRENNA, ALDIS];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
// Brenna was taught Destruction by a Master mage: the apprenticeship scenario drives the teaching itself.
const P = w.box().__thornswoodProgression;
w.row(BRENNA).thornswoodCharacter = JSON.parse(JSON.stringify(P.teach(w.row(BRENNA).thornswoodCharacter, { prof: 'mage', ranks: { destruction: 'master' } }, 'destruction').state));
ALL.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, line) { w.say(a, line); return last(a); }
function ch(a) { return w.prop(a, 'thornswoodCharacter') || {}; }
function points(a) { return P.spellPoints(ch(a)); }
function known(a) { return (ch(a).spells && ch(a).spells.known) || []; }
function holds(a, spell) { return w.spellsOf(a).indexOf(w.idOf(spell)) !== -1; }
function read(a, book) { const m = w.heard(a).length; const r = w.readBook(a, book); r.line = w.heardSince(a, m).join(' | '); return r; }

// ------------------------------------------------------- A. the gates on K --
yes('A1 Mira picks Flames on K (' + say(MIRA, '/pick spell Flames') + ')',
    known(MIRA).indexOf('Flames') !== -1 && points(MIRA) === 1 && holds(MIRA, SP.flames));
yes('A2 Firebolt, Advanced, is above her rank, and nothing is spent (' + say(MIRA, '/pick spell Firebolt') + ')',
    known(MIRA).indexOf('Firebolt') === -1 && points(MIRA) === 1 && !holds(MIRA, SP.firebolt) && /above your rank/.test(last(MIRA)));
yes('A3 Fire Storm, Master, too (' + say(MIRA, '/pick spell Fire Storm') + ')',
    known(MIRA).indexOf('Fire Storm') === -1 && points(MIRA) === 1);

// ----------------------------------------------------------- B. the tomes --
const b1 = read(MIRA, T.firebolt);
yes('B1 the Firebolt tome is refused, the line names the gate, and the tome stays in her pack (' + b1.line + ')',
    b1.allowed === false && w.count(MIRA, T.firebolt) === 1 && !holds(MIRA, SP.firebolt) && points(MIRA) === 1 &&
    /You cannot learn Firebolt \(Advanced Destruction\) from this tome yet, so you keep it\. You need Advanced rank in Destruction/.test(b1.line));
const b2 = read(MIRA, T.sparks);
yes('B2 the Sparks tome teaches it, the point is spent, and the engine spends the tome (' + b2.line + ')',
    b2.allowed !== false && known(MIRA).indexOf('Sparks') !== -1 && points(MIRA) === 0 && holds(MIRA, SP.sparks) &&
    w.count(MIRA, T.sparks) === 0 && /The tome teaches you Sparks, Novice Destruction\. It cost a spell point\./.test(b2.line));
const b3 = read(MIRA, T.frostbite);
yes('B3 with no point left, the Frostbite tome is refused and kept, and the line says why (' + b3.line + ')',
    b3.allowed === false && w.count(MIRA, T.frostbite) === 1 && !holds(MIRA, SP.frostbite) && /a spell point to spend, and you have none/.test(b3.line));

// ------------------------------------------------------- C. only the book --
const c1 = read(MIRA, T.mod);
yes('C1 a tome of a mod\'s spell is refused and kept (' + c1.line + ')',
    c1.allowed === false && w.count(MIRA, T.mod) === 1 && !holds(MIRA, MOD_SPELL) && /^You cannot learn Sear from this tome: it is not in the College's book/.test(c1.line));
w.leave(MIRA);
w.run(10000);
w.row(MIRA).learnedSpells.push(w.idOf(MOD_SPELL));   // a spell a tome taught before the rule, on the character
let heardAt = w.heard(MIRA).length;
w.arrive(MIRA);
w.run(10000);
yes('C2 a spell the book does not list comes off the character at the next login, and she is told (' + w.heardSince(MIRA, heardAt).filter(function (l) { return /Sear/.test(l); }).join(' | ') + ')',
    !holds(MIRA, MOD_SPELL) && holds(MIRA, SP.flames) && holds(MIRA, SP.sparks) &&
    w.heardSince(MIRA, heardAt).some(function (l) { return /^Sear is not in the College's book, so it was taken back\./.test(l); }));

// -------------------------------------------------------- D. a semester --
heardAt = w.heard(MIRA).length;
w.activate(DESK, MIRA);
const d1 = w.heardSince(MIRA, heardAt).join(' | ');
yes('D1 E at the desk hands Mira 2 points, in the Arcanaeum (' + d1 + ')',
    points(MIRA) === 2 && /A semester at the College, in the Arcanaeum: 2 spell points\. You have 2 to spend\. The next semester opens in 24 hours\./.test(d1));
const studied = ch(MIRA).studied;
w.run(60 * 60 * 1000);
heardAt = w.heard(MIRA).length;
w.activate(DESK, MIRA);
yes('D2 a second press waits out the 24 hours, and hands nothing (' + w.heardSince(MIRA, heardAt).join(' | ') + ')',
    points(MIRA) === 2 && ch(MIRA).studied === studied && /your next one opens in 23 hours/.test(w.heardSince(MIRA, heardAt).join(' ')));
w.moveTo(ALDIS, STREET, [20040, -8000, -3500]);
heardAt = w.heard(ALDIS).length;
w.activate(STRAY_DESK, ALDIS);
yes('D3 Aldis, with no magic, is told so (' + w.heardSince(ALDIS, heardAt).join(' | ') + ')',
    /magic is not yours yet/.test(w.heardSince(ALDIS, heardAt).join(' ')) && !ch(ALDIS).studied);
w.moveTo(MIRA, STREET, [20040, -8000, -3500]);
w.run(24 * 60 * 60 * 1000);
heardAt = w.heard(MIRA).length;
w.activate(STRAY_DESK, MIRA);
yes('D4 a desk outside the four halls is no semester, though hers is open (' + w.heardSince(MIRA, heardAt).join(' | ') + ')',
    points(MIRA) === 2 && ch(MIRA).studied === studied && /not in one of the College's halls/.test(w.heardSince(MIRA, heardAt).join(' ')));
w.moveTo(MIRA, ARCANAEUM, at(0));
w.moveTo(ALDIS, ARCANAEUM, at(2));

// ------------------------------------------------- E. somebody a master taught --
yes('E1 the spell book\'s pick is refused for Brenna, with the tome to read (' + say(BRENNA, '/pick spell Flames') + ')',
    /read the tome of Flames to learn it/.test(last(BRENNA)) && known(BRENNA).length === 0);
const e2 = read(BRENNA, T.flames);
yes('E2 the tome is refused with no point, and kept (' + e2.line + ')',
    e2.allowed === false && w.count(BRENNA, T.flames) === 1 && /anybody who is not a Mage earns one with a semester at the College/.test(e2.line));
heardAt = w.heard(BRENNA).length;
w.activate(DESK, BRENNA);
yes('E3 a semester hands her 1, for a Novice spell of Destruction (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    points(BRENNA) === 1 && /1 spell point, for a Novice spell of Destruction from its tome/.test(w.heardSince(BRENNA, heardAt).join(' ')));
const e4 = read(BRENNA, T.flames);
yes('E4 and then the tome teaches Flames, and is spent (' + e4.line + ')',
    known(BRENNA).indexOf('Flames') !== -1 && holds(BRENNA, SP.flames) && w.count(BRENNA, T.flames) === 0 && points(BRENNA) === 0);

// ----------------------------------------------------- F. no thrall of a person --
w.die(ALDIS, MIRA, null);
heardAt = w.heard(MIRA).length;
w.hit(ALDIS, MIRA, SP.zombie);
yes('F1 Raise Zombie on Aldis\'s body is refused, the body is put back down, and Mira is told (' + w.heardSince(MIRA, heardAt).join(' | ') + ')',
    !!(w.prop(ALDIS, 'thornswoodLaidDown') || {}).at &&
    w.heardSince(MIRA, heardAt).some(function (l) { return /^Raise Zombie does not take a person\./.test(l); }));
const BANDIT_BASE = '1e7e7:Skyrim.esm';
w.record(BANDIT_BASE, 'NPC_');
const BANDIT = w.ref(0xff200060, { base: BANDIT_BASE, type: 'NPC_', cell: ARCANAEUM, pos: at(5) });
w.row(BANDIT).isDead = true;
heardAt = w.heard(MIRA).length;
w.hit(BANDIT, MIRA, SP.zombie);
yes('F2 on a body the world placed it is the spell working as written',
    !w.prop(BANDIT, 'thornswoodLaidDown') && w.heardSince(MIRA, heardAt).length === 0);
w.respawn(ALDIS);

// -------------------------------------------------------------- G. restart --
const kept = JSON.stringify([ch(MIRA).spells, ch(MIRA).studied, ch(BRENNA).spells, ch(BRENNA).studied]);
w.run(60 * 60 * 1000);
const r = w.restart();
yes('G1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('G1 the books, the points and the semester\'s clock are as they were',
    JSON.stringify([ch(MIRA).spells, ch(MIRA).studied, ch(BRENNA).spells, ch(BRENNA).studied]) === kept &&
    holds(MIRA, SP.flames) && holds(MIRA, SP.sparks) && holds(BRENNA, SP.flames));
heardAt = w.heard(BRENNA).length;
w.activate(DESK, BRENNA);
yes('G2 Brenna\'s desk still waits (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    points(BRENNA) === 0 && /your next one opens in 2[23] hours/.test(w.heardSince(BRENNA, heardAt).join(' ')));
heardAt = w.heard(MIRA).length;
w.activate(DESK, MIRA);
yes('G3 and Mira\'s, whose 24 hours are past, opens (' + w.heardSince(MIRA, heardAt).join(' | ') + ')', points(MIRA) === 4);
const g4 = read(MIRA, T.frostbite);
yes('G4 so the Frostbite tome now teaches her (' + g4.line + ')', holds(MIRA, SP.frostbite) && points(MIRA) === 3 && w.count(MIRA, T.frostbite) === 0);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
