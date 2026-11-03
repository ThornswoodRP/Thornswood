'use strict';
/*
  test-scenario-factions.js

  Scenario: systems/factions.md

  #5198. Faction and business books, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js),
  every step a message the engine sends in the order it sends them. Every
  button on the J tab sends its /book line through the voice queue, an
  invite comes up on the P prompt and is answered there, and the tab is
  what the server writes into the social view. Who holds Business Owner, a
  faction's Leader role or a staff seat is what the site hands the door in
  allowed.json. The books on disk are private/books.json.

  Ysolda holds Business Owner. Kodlak holds Companions Leader. Vilkas and
  Aela hold neither. Sam is staff.

    A  The tab is drawn for Ysolda and for Sam, and not at all for Vilkas.
    B  Founding: Vilkas cannot found a business; Ysolda founds The Bee and
       is refused a second. Kodlak founds the Companions' book, once; Ysolda
       holds no Leader role and cannot.
    C  An invite: Ysolda invites Vilkas, it comes up on his P prompt naming
       the book, and he accepts. Now he sees the tab, as a Member. An offer
       left past its 45 seconds has gone.
    D  Roles: as a Member, Vilkas cannot set a price. The owner lets Member
       set prices; he sets one. A new role, a rename, and Vilkas on it.
    E  The chat: a line is drawn for everybody in the book, and a line over
       300 characters is cut. Staff silence Vilkas and the book takes no
       line from him.
    F  The faction's book follows its Leader role: the role goes to Aela,
       the first time she opens J she owns the book, and Kodlak stays a
       member. A business's owner cannot be handed a faction's book by
       staff.
    G  A restart: the books, the prices and the chat are as they were.
    H  Leaving and disbanding: Vilkas leaves, the owner cannot leave, and
       Ysolda disbands The Bee.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Submitting a book's prices at a hold's drop box is the merchants
  scenario's; the 100 lines and the 40 members are in tests/test-books.js.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-factions.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

function allowed(leader) {
  return {
    profiles: [1000, 1001, 1002, 1003, 1009],
    accounts: { 1000: 'acct-ysolda', 1001: 'acct-kodlak', 1002: 'acct-vilkas', 1003: 'acct-aela', 1009: 'acct-sam' },
    businessOwnerProfiles: [1000],
    factionLeaderProfiles: { 'Companions Leader': [leader] },
    staffRoleProfiles: [1009]
  };
}
const w = standIn.world({ name: 'factions', settings: { thornswoodDevs: [1009] }, files: { 'private/allowed.json': allowed(1001) } });
const CITY = '1a26f:Skyrim.esm';
function at(n) { return [20000 + 60 * n, -8000, -3500]; }
const YSOLDA = w.person(0xff001600, { profileId: 1000, name: 'Ysolda', cell: CITY, pos: at(0) });
const KODLAK = w.person(0xff001601, { profileId: 1001, name: 'Kodlak', cell: CITY, pos: at(1) });
const VILKAS = w.person(0xff001602, { profileId: 1002, name: 'Vilkas', cell: CITY, pos: at(2) });
const AELA = w.person(0xff001603, { profileId: 1003, name: 'Aela', cell: CITY, pos: at(3) });
const SAM = w.person(0xff001604, { profileId: 1009, name: 'Sam', cell: CITY, pos: at(4) });
const ALL = [YSOLDA, KODLAK, VILKAS, AELA, SAM];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, line) { w.say(a, line); return last(a); }
/* The J tab, as the server last wrote it into the social view. */
function tab(a) { w.run(1000); return ((w.prop(a, 'thornswoodSocialView') || {}).group) || {}; }
function bookIn(a, name) { return (tab(a).books || []).find(function (b) { return b.name === name; }) || null; }
function stored() { return w.readPrivate('books.json'); }
function storedBook(name) { const s = stored(); const list = Array.isArray(s) ? s : (s && s.books) || []; return list.find(function (b) { return b.name === name; }) || null; }

// ---------------------------------------------------------- A. the tab --
yes('A1 the tab is drawn for Ysolda, who holds Business Owner', tab(YSOLDA).show === true);
yes('A1 and for Sam, who is staff', tab(SAM).show === true);
yes('A2 and not at all for Vilkas (' + JSON.stringify(tab(VILKAS)) + ')', tab(VILKAS).show === false && !tab(VILKAS).books);

// ------------------------------------------------------------ B. founding --
yes('B1 Vilkas cannot found a business (' + say(VILKAS, '/book new business Vilkas Arms') + ')',
    last(VILKAS) === 'Your Discord account does not hold Business Owner.');
yes('B2 Ysolda founds The Bee (' + say(YSOLDA, '/book new business The Bee') + ')', last(YSOLDA) === 'Founded The Bee.' && !!storedBook('The Bee'));
yes('B2 and is refused a second (' + say(YSOLDA, '/book new business The Hive') + ')', last(YSOLDA) === 'This account already has a business.');
yes('B3 Kodlak founds the Companions\' book (' + say(KODLAK, '/book new faction The Companions') + ')',
    last(KODLAK) === 'Founded The Companions.' && (storedBook('The Companions') || {}).leader === 'Companions Leader');
yes('B3 once (' + say(KODLAK, '/book new faction Jorrvaskr') + ')', last(KODLAK) === 'Your faction already has its book.');
yes('B4 Ysolda holds no Leader role and cannot found a faction (' + say(YSOLDA, '/book new faction The Guild') + ')',
    /your Discord account holds none\.$/.test(last(YSOLDA)));

// The tab's buttons send the book's id, not its name (game/ui/thornswood-journal.js).
const BEE = storedBook('The Bee').id, COMP = storedBook('The Companions').id;

// ------------------------------------------------------------ C. an invite --
say(YSOLDA, '/book invite ' + BEE + ' Vilkas');
yes('C1 Ysolda invites Vilkas (' + last(YSOLDA) + ')', last(YSOLDA) === 'You asked Vilkas. They have 45 seconds.');
const offer = JSON.stringify((w.prop(VILKAS, 'thornswoodSocialView') || {}).offer || (w.prop(VILKAS, 'thornswoodSocialView') || {}).prompt || {});
yes('C1 it comes up on his P prompt, naming the book (' + offer.slice(0, 160) + ')', /the business The Bee/.test(offer));
let heardAt = w.heard(YSOLDA).length;
yes('C2 he accepts (' + say(VILKAS, '/yes') + ')', last(VILKAS) === 'You joined The Bee.' && w.heardSince(YSOLDA, heardAt).indexOf('Vilkas joined your book.') >= 0);
const vb = bookIn(VILKAS, 'The Bee');
yes('C2 now he sees the tab, with The Bee, as a Member (' + JSON.stringify(vb && vb.people) + ')',
    tab(VILKAS).show === true && !!vb && (vb.people || []).some(function (p) { return p.name === 'Vilkas' && p.role === 'Member'; }));
say(YSOLDA, '/book invite ' + BEE + ' Aela');
w.run(46000);
const late = say(AELA, '/yes');
yes('C3 an offer left past its 45 seconds has gone (' + late + ')', /has gone|Nobody has asked you anything/.test(late) && tab(AELA).show === false);

// --------------------------------------------------------------- D. roles --
yes('D1 as a Member, Vilkas cannot set a price (' + say(VILKAS, '/book price ' + BEE + ' | Honey | 5 | 8') + ')', last(VILKAS) === 'You cannot set prices in that book.');
yes('D2 the owner lets Member set prices (' + say(YSOLDA, '/book role ' + BEE + ' perm | Member | Read Speak Prices') + ')', last(YSOLDA) === 'Set Member.');
yes('D2 and he sets one (' + say(VILKAS, '/book price ' + BEE + ' | Honey | 5 | 8') + ')',
    /^Set Honey in The Bee\./.test(last(VILKAS)) && JSON.stringify((storedBook('The Bee') || {}).prices) === JSON.stringify([{ name: 'Honey', buy: 5, sell: 8 }]));
say(YSOLDA, '/book role ' + BEE + ' new | Keeper');
say(YSOLDA, '/book role ' + BEE + ' rename | Keeper | Beekeeper');
yes('D3 a new role, a rename, and Vilkas on it (' + say(YSOLDA, '/book member ' + BEE + ' role | Vilkas | Beekeeper') + ')',
    last(YSOLDA) === 'Vilkas is Beekeeper.' && (storedBook('The Bee').members.find(function (m) { return m.name === 'Vilkas'; }) || {}).role === 'Beekeeper');
yes('D4 the Beekeeper role holds nothing yet, so he cannot write in the chat (' + say(VILKAS, '/book say ' + BEE + ' hello') + ')',
    last(VILKAS) === 'You cannot write in that book.');
say(YSOLDA, '/book role ' + BEE + ' perm | Beekeeper | Read Speak Prices');

// ---------------------------------------------------------------- E. chat --
yes('E1 a line in the book\'s chat (' + say(VILKAS, '/book say ' + BEE + ' Hives are full.') + ')', last(VILKAS) === 'Said in The Bee.');
const chatY = (bookIn(YSOLDA, 'The Bee') || {}).chat || [];
yes('E1 is drawn for everybody in the book (' + JSON.stringify(chatY).slice(0, 120) + ')',
    chatY.some(function (c) { return c.name === 'Vilkas' && c.text === 'Hives are full.'; }));
say(VILKAS, '/book say ' + BEE + ' ' + 'b'.repeat(400));
yes('E2 a line over 300 characters is cut to 300',
    storedBook('The Bee').chat.some(function (c) { return c.text === 'b'.repeat(300); }));
say(SAM, '/silence Vilkas 5 spamming the book');
yes('E3 staff silence Vilkas, and the book takes no line from him (' + say(VILKAS, '/book say ' + BEE + ' one more') + ')',
    /silenced/.test(last(VILKAS)) && !storedBook('The Bee').chat.some(function (c) { return c.text === 'one more'; }));
w.run(5 * 60 * 1000 + 1000);

// --------------------------------------------- F. the faction's Leader role --
say(KODLAK, '/book invite ' + COMP + ' Vilkas');
say(VILKAS, '/yes');
w.writePrivate('allowed.json', allowed(1003));
w.run(31000);
const aelaBook = bookIn(AELA, 'The Companions');
yes('F1 the role goes to Aela, and the first time she opens J she owns the book (' + JSON.stringify(aelaBook && aelaBook.people) + ')',
    !!aelaBook && (storedBook('The Companions') || {}).owner === 1003 &&
    aelaBook.people.some(function (p) { return p.name === 'Aela' && p.role === 'Owner'; }));
yes('F1 and Kodlak stays a member', storedBook('The Companions').members.some(function (m) { return m.pid === 1001; }));
yes('F2 staff cannot hand a faction\'s book on by hand (' + say(SAM, '/book give ' + COMP + ' Vilkas') + ')',
    last(SAM) === 'This book moves with the Companions Leader role in Discord, not by hand.');

// ------------------------------------------------------------- G. restart --
const kept = JSON.stringify(stored());
const r = w.restart();
yes('G1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('G1 the books, the prices and the chat are as they were', JSON.stringify(stored()) === kept &&
    ((bookIn(YSOLDA, 'The Bee') || {}).chat || []).some(function (c) { return c.text === 'Hives are full.'; }));

// --------------------------------------------------- H. leaving, disbanding --
yes('H1 Vilkas leaves The Bee (' + say(VILKAS, '/book leave ' + BEE) + ')', last(VILKAS) === 'You left The Bee.' && !bookIn(VILKAS, 'The Bee'));
yes('H2 the owner cannot leave (' + say(YSOLDA, '/book leave ' + BEE) + ')', last(YSOLDA) === 'The owner disbands a book. A member can leave.');
say(YSOLDA, '/book disband ' + BEE);
yes('H3 Ysolda disbands The Bee (' + last(YSOLDA) + ')', !storedBook('The Bee') && !bookIn(YSOLDA, 'The Bee'));

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
