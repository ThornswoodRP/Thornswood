// test-4561-contracts.js
//
//     node tests/test-4561-contracts.js
//
// #4561. Contracts between people, signed and kept in a ledger. Decided
// 22 Oct: a signed contract is read by the people who signed it, and staff.
//
// C: THE BLOCK. The real contracts block out of game/gamemode.js, run over a
//    temporary private folder with a stand-in for the social block, the
//    character block and the engine:
//      two people write and sign a contract, and it is in the ledger;
//      a third person can neither sign it nor read it;
//      staff read every signed contract, and nobody else gets that list;
//      a refused or withdrawn offer, and one still waiting, is never signed;
//      the writer must stand with the other person; terms have a length;
//      one writer has at most OFFERS_EACH waiting;
//      K is drawn again for both people when an offer is written;
//      a restart reads the ledger back, and a file that does not read is
//        set aside, never written over (#4529).
// W: THE WIRING. /contract reaches the block, is in WORDS and not in
//    PLAYER_WORDS, K's view carries pageFor, the near list carries ct, and
//    order.json lists the part.
// K: THE K PANEL AND THE LOOK PROMPT. A Contracts section whose buttons send
//    the /contract lines, a terms box K does not read as its own key, the
//    look prompt's K opening it on a person, and nothing a person reads
//    telling them to type a command.
//
// Nothing outside the temporary folder is written.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join('');
const gm = read('game/gamemode.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const A0 = gm.indexOf('// ==== thornswood contracts ====');
const A1 = A0 < 0 ? -1 : gm.indexOf('// ==== end thornswood contracts ====', A0);
const BLOCK = (A0 < 0 || A1 < 0) ? '' : gm.slice(A0, A1);
yes('C0 the contracts block is in the gamemode, between its markers', BLOCK.length > 0);
if (!BLOCK) { done(); }

// ------------------------------------------------------------ the world --
// Ana (A) and Bjorn (B) stand together in Whiterun; Cyra (C) is across the
// room; Sten (S) is staff and somewhere else.
const PEOPLE = {
  0xff000a01: { pid: 101, name: 'Ana', cell: 'whiterun', pos: [0, 0, 0] },
  0xff000a02: { pid: 102, name: 'Bjorn', cell: 'whiterun', pos: [300, 0, 0] },
  0xff000a03: { pid: 103, name: 'Cyra', cell: 'whiterun', pos: [5000, 0, 0] },
  0xff000a04: { pid: 104, name: 'Sten', cell: 'riften', pos: [0, 0, 0] }
};
const A = 0xff000a01, B = 0xff000a02, C = 0xff000a03, S = 0xff000a04;
const STAFF = { 104: true };
const NONE = { waiting: [], sent: [], signed: [] };

function boot(dir) {
  const told = [];
  const drawn = [];
  const logged = [];
  const realFs = fs;
  const shimFs = Object.assign({}, realFs, {
    readFileSync: function (f, enc) {
      if (f === 'server-settings.json') { return JSON.stringify({ privDir: dir }); }
      return realFs.readFileSync(f, enc);
    }
  });
  const ctx = {
    console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: function (m) { return m === 'fs' ? shimFs : require(m); },
    Date: Date, JSON: JSON, Math: Math, Number: Number, String: String, Array: Array, Object: Object,
    mp: {
      get: function (id, key) {
        const p = PEOPLE[id];
        if (!p) { throw new Error('no such actor'); }
        if (key === 'worldOrCellDesc') { return p.cell; }
        if (key === 'pos') { return p.pos; }
        if (key === 'profileId') { return p.pid; }
        return null;
      }
    },
    __thornswoodSocial: {
      // As the real one: the look prompt hands over the form id in hex.
      findPerson: function (want) {
        const id = /^[0-9a-f]{1,8}$/i.test(String(want)) ? parseInt(want, 16) >>> 0 : 0;
        return PEOPLE[id] ? { actorId: id } : { why: 'Nobody here by that name.' };
      },
      profileOf: function (id) { return PEOPLE[id] ? PEOPLE[id].pid : 0; },
      nameOfPerson: function (id) { return PEOPLE[id] ? PEOPLE[id].name : 'somebody'; }
    },
    __thornswoodCharacter: {
      stateOf: function (id) { return { who: id }; },
      writeState: function (id) { drawn.push(id); }
    },
    __thornswoodIsStaff: function (pid) { return !!STAFF[pid]; },
    __thornswoodTrade: { TRADE: { reach: 700 } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(BLOCK, ctx);
  const api = ctx.__thornswoodContracts;
  function say(actor, line) {
    // The lines below name people by their actor number; K sends the form
    // id in hex, as the look prompt hands it over, so that is what goes.
    line = line.replace(/^\/contract offer (\d+) /, function (m, n) { return '/contract offer ' + Number(n).toString(16) + ' '; });
    const parts = line.split(' ');
    return api.command({ actorId: actor, profileId: PEOPLE[actor].pid, parts: parts, text: line,
                         toProfile: function (pid, m) { told.push({ pid: pid, m: m }); } });
  }
  // K's page for an actor, as character.ts asks for it; NONE when there is none.
  function view(actor) { return api.pageFor(actor) || NONE; }
  function file() {
    const f = path.join(dir, 'contracts.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }
  return { api: api, say: say, view: view, file: file, told: told, drawn: drawn, logged: logged };
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-4561-'));
try {
  const dir = path.join(TMP, 'private');
  let w = boot(dir);
  yes('C1 the block hands out command, pageFor, viewFor and waitingFrom', !!w.api && typeof w.api.command === 'function' &&
      typeof w.api.pageFor === 'function' && typeof w.api.viewFor === 'function' && typeof w.api.waitingFrom === 'function');
  yes('C1 nobody has a Contracts page before there is a contract', w.api.pageFor(A) === null && w.api.pageFor(S) === null);

  // C2: Ana writes Bjorn a contract, standing with him.
  let r = w.say(A, '/contract offer ' + B + ' :: Ana guards Bjorn\'s cart to Riften.\\nBjorn pays 50 gold at the gate.');
  yes('C2 a contract written beside the other person is given to them', /You signed the contract and gave it to Bjorn/.test(r));
  let bv = w.view(B);
  yes('C2 it waits for Bjorn to sign, with both names and the words, line break kept',
      bv.waiting.length === 1 && bv.waiting[0].from === 'Ana' && bv.waiting[0].to === 'Bjorn' &&
      bv.waiting[0].terms === 'Ana guards Bjorn\'s cart to Riften.\nBjorn pays 50 gold at the gate.');
  yes('C2 and Ana sees it waiting for him', w.view(A).sent.length === 1 && w.view(A).waiting.length === 0);
  yes('C2 Bjorn is told, on K', w.told.some(function (t) { return t.pid === 102 && /Ana has written you a contract/.test(t.m) && /on K/.test(t.m); }));
  yes('C2 K is drawn again for both of them', w.drawn.indexOf(A) >= 0 && w.drawn.indexOf(B) >= 0);
  yes('C2 the near list can tell Bjorn that Ana wrote him one, and not the other way',
      w.api.waitingFrom(102, 101) === true && w.api.waitingFrom(101, 102) === false && w.api.waitingFrom(103, 101) === false);
  yes('C2 an offer is not signed', w.file().offers.length === 1 && w.file().signed.length === 0 && bv.signed.length === 0);
  const n1 = bv.waiting[0].n;

  // C3: Cyra is not in it.
  r = w.say(C, '/contract sign ' + n1);
  yes('C3 a third person cannot sign it', /not written to you/.test(r) && w.file().offers.length === 1 &&
      w.file().signed.length === 0);
  r = w.say(C, '/contract withdraw ' + n1);
  yes('C3 nor take it back', /Only the person who wrote/.test(r) && w.file().offers.length === 1);
  yes('C3 and she has no page with any of it', w.api.pageFor(C) === null);

  // C4: Bjorn signs.
  r = w.say(B, '/contract sign ' + n1);
  yes('C4 Bjorn signs it, and it is in the ledger', /You signed the contract with Ana/.test(r) &&
      w.file().signed.length === 1 && w.file().offers.length === 0 && w.file().signed[0].signedAt > 0);
  yes('C4 both of them read it, signed', w.view(A).signed.length === 1 && w.view(B).signed.length === 1 &&
      w.view(A).signed[0].terms === w.view(B).signed[0].terms);
  yes('C4 Ana is told', w.told.some(function (t) { return t.pid === 101 && /Bjorn signed your contract/.test(t.m); }));
  yes('C4 Cyra still reads nothing', w.api.pageFor(C) === null);
  yes('C5 staff read every signed contract they are not in', Array.isArray(w.view(S).all) &&
      w.view(S).all.length === 1 && w.view(S).all[0].from === 'Ana' && w.view(S).all[0].terms.length > 0);
  yes('C5 and the signers get no staff list', w.view(A).all === undefined && w.view(B).all === undefined);

  // C6: a refusal never lands.
  w.say(A, '/contract offer ' + B + ' :: A second deal.');
  const n2 = w.view(B).waiting[0].n;
  r = w.say(B, '/contract refuse ' + n2);
  yes('C6 a refused contract is gone, and never signed', /You refused the contract from Ana/.test(r) &&
      w.file().offers.length === 0 && w.file().signed.length === 1 && w.view(S).all.length === 1);
  yes('C6 and Ana is told', w.told.some(function (t) { return t.pid === 101 && /Bjorn refused/.test(t.m); }));

  // C7: the writer takes one back.
  w.say(A, '/contract offer ' + B + ' :: A third deal.');
  const n3 = w.view(A).sent[0].n;
  r = w.say(A, '/contract withdraw ' + n3);
  yes('C7 the writer takes an unsigned one back, and it is never signed',
      /You took the contract back/.test(r) && w.file().offers.length === 0 && w.file().signed.length === 1);
  r = w.say(B, '/contract sign ' + n3);
  yes('C7 and it cannot be signed after', /not waiting for anybody/.test(r) && w.file().signed.length === 1);

  // C8: standing apart, empty, too long, oneself.
  r = w.say(A, '/contract offer ' + C + ' :: Across the room.');
  yes('C8 a contract is written standing with the other person', /Stand with them/.test(r) && w.file().offers.length === 0);
  r = w.say(A, '/contract offer ' + B + ' :: ');
  yes('C8 a contract with no terms is not sent', /Write the terms/.test(r) && w.file().offers.length === 0);
  r = w.say(A, '/contract offer ' + B + ' :: ' + 'x'.repeat(w.api.TERMS_CHARS + 1));
  yes('C8 a contract past ' + w.api.TERMS_CHARS + ' characters is not sent', /is up to/.test(r) && w.file().offers.length === 0);
  r = w.say(A, '/contract offer ' + A + ' :: With myself.');
  yes('C8 a contract is with somebody else', /with somebody else/.test(r) && w.file().offers.length === 0);

  // C9: at most OFFERS_EACH waiting from one writer.
  for (let i = 0; i < w.api.OFFERS_EACH; i++) { w.say(A, '/contract offer ' + B + ' :: Deal ' + i + '.'); }
  r = w.say(A, '/contract offer ' + B + ' :: One too many.');
  yes('C9 one writer has at most ' + w.api.OFFERS_EACH + ' waiting', /Take one back on K/.test(r) &&
      w.file().offers.length === w.api.OFFERS_EACH);

  // C10: a restart reads it all back.
  w = boot(dir);
  yes('C10 a restart reads the ledger and the waiting offers back',
      w.view(A).signed.length === 1 && w.view(B).waiting.length === w.api.OFFERS_EACH &&
      w.view(S).all.length === 1);

  // C11: a file that does not read is set aside, never written over.
  const bad = path.join(TMP, 'bad');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'contracts.json'), '{ not json');
  w = boot(bad);
  yes('C11 a ledger that does not read holds nothing at this start', w.api.pageFor(A) === null);
  w.say(A, '/contract offer ' + B + ' :: After the bad file.');
  const aside = fs.readdirSync(bad).filter(function (f) { return /^contracts\.json\.unreadable-/.test(f); });
  yes('C11 and the first save sets it aside rather than writing over it', aside.length === 1 &&
      fs.readFileSync(path.join(bad, aside[0]), 'utf8') === '{ not json' && w.file().offers.length === 1);
  yes('C12 the log names who and which, never the words',
      w.logged.some(function (l) { return /\[contracts\] Ana \(profile 101\) wrote contract 1 with Bjorn/.test(l); }) &&
      !w.logged.some(function (l) { return /After the bad file/.test(l); }));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ------------------------------------------------------------ the wiring --
{
  const code = gm.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('W1 /contract reaches the contracts block, with the line and toProfile',
      /if \(word === '\/contract'\) \{[\s\S]{0,400}__thornswoodContracts[\s\S]{0,400}contractsApi\.command\(\{ actorId: actorId, profileId: profileId, parts: parts,\s*text: String\(cmd\.text \|\| ''\), toProfile: toProfile \}\)/.test(code));
  const words = (code.match(/(?:var|const) WORDS = \[[\s\S]*?\];/) || [''])[0];
  const player = (code.match(/(?:var|const) PLAYER_WORDS = \[[\s\S]*?\];/) || [''])[0];
  yes('W2 /contract is in WORDS and not in PLAYER_WORDS', words.indexOf("'/contract'") >= 0 &&
      player !== '' && player.indexOf('/contract') === -1);
  yes('W3 K\'s view carries the contracts block\'s page', /CT\.pageFor\(actorId\)[\s\S]{0,120}view\.contracts = contractsPage/.test(code));
  yes('W4 the near list marks a person who wrote you a contract as ct',
      /contracts\.waitingFrom\(me\.pid, them\.pid\)\) \{ w\[them\.id\.toString\(16\)\]\.ct = 1; \}/.test(code));
  const order = JSON.parse(read('game/gamemode/order.json')).parts;
  yes('W5 order.json lists contracts.ts', order.indexOf('contracts.ts') >= 0);
}

// ---------------------------------------------- the K panel and the prompt --
{
  const K = read('game/ui/thornswood-skills.js');
  const F = read('game/plugins/thornswood-front.js');
  yes('K1 K has a Contracts section, drawn from mine.contracts or a person from the prompt',
      /sections\.push\('contracts'\)/.test(K) && /else if \(section === 'contracts'\) drawContracts\(\);/.test(K) &&
      /var got = mine && mine\.contracts;/.test(K));
  yes('K2 Sign and give sends /contract offer to that person, the terms on one line',
      /dyePress\('\/contract offer ' \+ who\.id \+ ' :: ' \+ raw\.split\('\\n'\)\.join\('\\\\n'\)/.test(K));
  yes('K3 Sign, Refuse and Take it back send their lines',
      /'\/contract sign ' \+ Number\(c\.n\)/.test(K) && /'\/contract refuse ' \+ Number\(c\.n\)/.test(K) &&
      /'\/contract withdraw ' \+ Number\(c\.n\)/.test(K));
  yes('K4 the staff list is drawn only when the server sent it', /Array\.isArray\(contractsView\(\)\.all\)/.test(K));
  yes('K5 a K typed into the terms is the box\'s, not the panel\'s',
      /e\.target\.tagName === 'INPUT' \|\| e\.target\.tagName === 'TEXTAREA'\) && e\.key !== 'Escape'\) return;/.test(K));
  yes('K6 the look prompt offers Write a contract on K, or Read their contract with ct',
      /keyRow\(CONTRACT_NAME, row\.ct \? 'Read their contract' : 'Write a contract', !!row\.ct\)/.test(F) &&
      /let CONTRACT_KEY = SKILLS_KEY;/.test(F) && /CONTRACT_KEY = SKILLS_KEY;/.test(F));
  yes('K7 K on a person opens K\'s Contracts on them, after Take on and Dye their hair',
      /if \(e\.code === HAIR_DYE_KEY && hairDyePress\(\)\) \{ return; \}\s*\/\/[^\n]*\n\s*if \(e\.code === CONTRACT_KEY && contractPress\(\)\) \{ return; \}/.test(F) &&
      /window\.thornswoodSkills\.contractWith\(/.test(F) && /contractWith: function \(who\)/.test(K));
  const page = read('docs/systems/contracts.md');
  const said = (BLOCK.match(/'[^'\n]*'/g) || []).filter(function (s) { return s !== "'/contract'"; }).join(' ');
  // The command word itself, not a path such as game/gamemode/contracts.ts.
  const typed = /\/contract(?![s\w])/;
  yes('K8 nothing a person reads tells them to type /contract', !typed.test(page) && !typed.test(said));
}

done();
