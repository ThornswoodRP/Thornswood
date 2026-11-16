'use strict';
/*
  test-scenario-contracts.js

  Scenario: systems/contracts.md

  #5198 and #4561. Contracts, end to end: the WHOLE of game/gamemode.js over
  the stand-in server (tests/stand-in-server.js), every step a message the
  engine sends in the order it sends them. K's Contracts section sends the
  /contract lines, the look prompt handing it the person's form id in hex.
  What K shows is read the way character.ts reads it, from the contracts
  block's pageFor, and the ledger from the private folder it is kept in.

  Ana and Bjorn stand together in Whiterun; Cyra is across the street.

    A  Ana writes Bjorn a contract beside him: it waits on his K, and the
       ledger holds it as an offer, never as signed.
    B  He refuses it: it is gone, and nothing is signed.
    C  She writes another. Cyra, who is not in it, cannot sign it and her K
       shows none of it.
    D  Bjorn signs it: both read it on K, and the ledger keeps it with both
       names and the words.
    E  Ana writes to Cyra from across the street: stand with them.
    F  The server restarts: the signed contract is still on both K pages.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-contracts.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'contracts' });
const CITY = '1691d:Skyrim.esm';
const ANA = w.person(0xff001200, { profileId: 1201, name: 'Ana', cell: CITY, pos: [1000, 0, 0] });
const BJORN = w.person(0xff001201, { profileId: 1202, name: 'Bjorn', cell: CITY, pos: [1300, 0, 0] });
const CYRA = w.person(0xff001202, { profileId: 1203, name: 'Cyra', cell: CITY, pos: [6000, 0, 0] });
const EVERYONE = [ANA, BJORN, CYRA];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(1000); return last(a); }
function hex(a) { return (a >>> 0).toString(16); }
function page(a) { const b = w.box().__thornswoodContracts; return b ? b.pageFor(a) : null; }
function list(a, field) { const p = page(a); return (p && p[field]) || []; }
function ledger() { return w.readPrivate('contracts.json') || { offers: [], signed: [] }; }

yes('P1 the contracts block is running', !!w.box().__thornswoodContracts);

// ------------------------------------------------------- A. an offer --
let answer = say(ANA, '/contract offer ' + hex(BJORN) + ' :: Ana guards Bjorn\'s cart to Riften.\\nBjorn pays her at the gate.');
yes('A1 Ana signs it and gives it to Bjorn (' + answer + ')', /^You signed the contract and gave it to Bjorn\./.test(answer));
const waitingA = list(BJORN, 'waiting');
yes('A2 it waits on Bjorn\'s K, from Ana, the line break kept',
    waitingA.length === 1 && waitingA[0].from === 'Ana' &&
    waitingA[0].terms === 'Ana guards Bjorn\'s cart to Riften.\nBjorn pays her at the gate.');
yes('A3 Bjorn is told', w.heard(BJORN).some(function (l) { return /^Ana has written you a contract and signed it\./.test(l); }));
yes('A4 the ledger holds it as an offer, not signed', ledger().offers.length === 1 && ledger().signed.length === 0);

// ------------------------------------------------------- B. refused --
answer = waitingA.length ? say(BJORN, '/contract refuse ' + waitingA[0].n) : '';
yes('B1 Bjorn refuses it (' + answer + ')', /^You refused the contract from Ana\./.test(answer));
yes('B2 it is gone and nothing was signed',
    ledger().offers.length === 0 && ledger().signed.length === 0 && list(BJORN, 'waiting').length === 0);

// --------------------------------------------- C. somebody not in it --
say(ANA, '/contract offer ' + hex(BJORN) + ' :: A load of iron ore each week.');
const waitingC = list(BJORN, 'waiting');
const n = waitingC.length ? waitingC[0].n : -1;
answer = say(CYRA, '/contract sign ' + n);
yes('C1 Cyra cannot sign a contract written to Bjorn (' + answer + ')',
    answer === 'That contract is not written to you.' && ledger().signed.length === 0 && ledger().offers.length === 1);
yes('C2 and her K shows none of it', page(CYRA) === null);

// ---------------------------------------------------------- D. signed --
answer = say(BJORN, '/contract sign ' + n);
yes('D1 Bjorn signs it (' + answer + ')', /^You signed the contract with Ana\./.test(answer));
yes('D2 both read it on K', list(ANA, 'signed').length === 1 && list(BJORN, 'signed').length === 1 &&
    list(ANA, 'signed')[0].terms === 'A load of iron ore each week.');
const kept = ledger().signed;
yes('D3 the ledger keeps it with both names and the words', kept.length === 1 && ledger().offers.length === 0 &&
    kept[0].fromName === 'Ana' && kept[0].toName === 'Bjorn' && kept[0].terms === 'A load of iron ore each week.');
yes('D4 Cyra\'s K still shows nothing', page(CYRA) === null);

// ------------------------------------------------------ E. too far --
answer = say(ANA, '/contract offer ' + hex(CYRA) + ' :: Across the street.');
yes('E1 a contract is written standing with the other person (' + answer + ')',
    /^Stand with them\./.test(answer) && ledger().offers.length === 0);

// ------------------------------------------------------- F. restart --
w.restart();
EVERYONE.forEach(w.arrive);
w.run(30000);
yes('F1 after a restart the signed contract is still on both K pages',
    list(ANA, 'signed').length === 1 && list(BJORN, 'signed').length === 1 && page(CYRA) === null);

t.done(w);
