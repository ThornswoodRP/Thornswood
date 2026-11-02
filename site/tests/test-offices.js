// test-offices.js
//
// The offices: who is a Jarl, a steward, on a Court or a guard, and a steward
// ending a claim.
//
// Patrick's design, 21 September: a Jarl places stewards, and a steward's one
// power nobody else has is ending a claim. Patrick, 15 October (#2551): every
// office is a Discord role on the account ("Jarl of <Hold>", "<Hold> Court",
// "Steward of <Hold>", "Guard of <Hold>"), read through the door from the
// site. Nothing in the game keeps a list of who holds what, and nobody is an
// officer by being staff. A steward is the Steward of one hold, and a Jarl
// keeps their own hold too. Patrick, 16 October: an office is one
// character's, not the whole account's, so the law register names which
// character of the account holds it, and only that one acts.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const SITE = process.env.SITE || path.join(REPO_DIR, 'site', 'server.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const site = siteFiles.source(SITE).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function lift(startsWith, endsWith) {
  const a = src.indexOf(startsWith);
  if (a < 0) { return null; }
  const b = src.indexOf(endsWith, a);
  return b < 0 ? null : src.slice(a, b + endsWith.length);
}
/* One function out of the gamemode by name, to the brace that closes it. */
function fnSrc(name) {
  const head = '\n  function ' + name + '(';
  const a = src.indexOf(head);
  if (a < 0 || src.indexOf(head, a + 1) >= 0) { return null; }
  const b = src.indexOf('{', a);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') { d++; }
    else if (src[i] === '}') { d--; if (d === 0) { return src.slice(a + 1, i + 1); } }
  }
  return null;
}

const READERS = ['rolesOfProfile', 'officeAccountOf', 'officeHeldBy', 'officesOfProfile', 'officesToHold',
                 'holdsOffice', 'isJarlOf', 'jarlHoldsOf', 'isJarl', 'isCourtOf',
                 'isStewardOf', 'stewardHoldsOf', 'isSteward'];
const readerSrc = READERS.map(fnSrc);
const tables = (lift('  var OFFICE_KINDS = [', ';') || '') + '\n' + (lift('  var HOLD_TOWN = {', '};') || '');
const evictBlock = lift('  function evict(actorId, profileId, toProfile, cmd) {', '\n  }\n');
// A steward ends a claim only in their own hold (#2551): the building's hold, and the rule;
// staff at any door (settleAs), which test-2551-building-holds.js drives.
const ownHoldSrc = [fnSrc('holdOfBuilding'), fnSrc('notStewardHere'), fnSrc('isStaffHere'), fnSrc('settleAs'),
                    fnSrc('settleWhere'), fnSrc('staffRecord')];

yes('the office readers are in the gamemode, each once', readerSrc.every(function (s) { return !!s; }));
yes('and so is the eviction, with the building\'s hold and its rule', evictBlock !== null &&
    ownHoldSrc.every(function (s) { return !!s; }));

const JARL = 1, ALICE = 101, BOB = 202, COURT = 303, ADMIN = 404;
const HOUSE = 'breezehome';

/*
  The readers over a table of Discord roles, as the door hands them over,
  accounts (profile -> account, the door's), and which character of each
  account holds each office (the law register). With no held table given,
  every profile holds what its roles give, as if each had chosen.
*/
function readers(roles, accounts, held) {
  if (!held) {
    held = {};
    Object.keys(roles).forEach(function (pid) {
      ['jarl', 'court', 'steward', 'guard'].forEach(function (k) {
        (roles[pid][k] || []).forEach(function (h) {
          const key = k + ':' + h;
          held[key] = held[key] || {};
          held[key][(accounts && accounts[pid]) || 'p:' + pid] = { pid: Number(pid), name: 'x', at: 0 };
        });
      });
    });
  }
  const g = {
    __thornswoodAccountOf: function (pid) { return (accounts && accounts[pid]) || ''; },
    __thornswoodOffices: function (pid) {
      const o = roles[pid] || {};
      return { jarl: o.jarl || [], court: o.court || [], steward: o.steward || [], guard: o.guard || [] };
    },
    // An admin is staff; staff hold no office by being staff (#2551). The
    // readers must never ask this.
    __thornswoodIsAdmin: function () { throw new Error('the office readers asked whether somebody is an admin'); }
  };
  return new Function('g', 'law', tables + '\n' + readerSrc.join('\n') + '\nreturn { ' +
                      READERS.map(function (n) { return n + ': ' + n; }).join(', ') + ' };')(g, { cells: {}, held: held });
}

/** Drive /evict with a given claim and caller. */
function evict(opts) {
  const told = [];
  const logs = [];
  const claims = {};
  if (opts.held) { claims[HOUSE] = opts.held; }
  const pushed = { n: 0 };
  // opts.stewards keep Whiterun, opts.riften keep Riften; the house is in
  // Whiterun unless opts.hold says another hold, or null for none.
  const ofWhiterun = opts.stewards || [], ofRiften = opts.riften || [];
  const buildingHold = {};
  if (opts.hold !== null) { buildingHold[HOUSE] = opts.hold || 'whiterun'; }
  const fn = new Function(
    'actorId', 'profileId', 'toProfile', 'isSteward', 'here', 'holderOf',
    'nameOf', 'claims', 'save', 'pushAll', 'plog', 'redrawPanel', 'OFFICE_AT_DOOR',
    'isStewardOf', 'BUILDING_HOLD', 'HOLD_TOWN', 'g', 'personName',
    // What an evicted holder owed stays theirs (#3950): tests/test-3893-rent-arrears.js; no rent here.
    'keepOwed',
    ownHoldSrc.join('\n') + '\n' + evictBlock + '\nreturn evict;');
  const call = fn(
    null, null, null,
    function (pid) { return ofWhiterun.indexOf(pid) !== -1 || ofRiften.indexOf(pid) !== -1; },
    function () { return opts.atDoor === false ? null : HOUSE; },
    function () { return claims[HOUSE] || null; },
    function () { return 'Breezehome'; },
    claims,
    function () { }, function () { pushed.n++; },
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    function () { pushed.redraws = (pushed.redraws || 0) + 1; },
    'Open the door of the building, then press the button on the Office page of K within a minute.',
    function (pid, hold) {
      return (hold === 'whiterun' && ofWhiterun.indexOf(pid) !== -1) || (hold === 'riften' && ofRiften.indexOf(pid) !== -1);
    },
    buildingHold, { whiterun: 'Whiterun', riften: 'Riften' },
    // Nobody here is staff: staff at any door is test-2551-building-holds.js's.
    { __thornswoodIsStaff: function () { return false; } }, function () { return 'somebody'; },
    function () { });
  call(0xff000058, opts.by, function (pid, m) { told.push(m); });
  return { told: told, claims: claims, pushes: pushed.n, redraws: pushed.redraws || 0 };
}

if (readerSrc.every(function (s) { return !!s; })) {
  const R = readers({
    1: { jarl: ['whiterun'] },
    101: { steward: ['whiterun'] },
    202: { guard: ['riften'] },
    303: { court: ['whiterun'], steward: ['narnia'], jarl: ['__proto__'] }
  });
  yes('S1 the Steward of Whiterun is a steward of Whiterun, and of no other hold',
      R.isSteward(ALICE) && R.isStewardOf(ALICE, 'whiterun') && !R.isStewardOf(ALICE, 'riften') &&
      R.stewardHoldsOf(ALICE).join() === 'whiterun');
  yes('S2 the Jarl of Whiterun keeps Whiterun as its steward too, and is Jarl of it alone',
      R.isJarl(JARL) && R.isJarlOf(JARL, 'whiterun') && !R.isJarlOf(JARL, 'riften') &&
      R.isStewardOf(JARL, 'whiterun') && R.jarlHoldsOf(JARL).join() === 'whiterun');
  yes('S3 a guard is no steward and no Jarl', !R.isSteward(BOB) && !R.isJarl(BOB));
  yes('S4 the Court of Whiterun is that, and a hold that is not one of the ten is nobody\'s office',
      R.isCourtOf(COURT, 'whiterun') && !R.isSteward(COURT) && !R.isJarl(COURT));
  yes('S5 an admin with no role holds no office, and the readers never ask who is an admin',
      !R.isJarl(ADMIN) && !R.isSteward(ADMIN) && !R.isCourtOf(ADMIN, 'whiterun'));
  yes('S5 nor does somebody with no role, or no profile', !R.isSteward(999) && !R.isJarlOf(0, 'whiterun'));

  // One character holds the office (Patrick, 16 Oct). Profiles 11 and 12 are
  // the same account, which holds the Jarl of Whiterun role; 11 holds it.
  const C = readers({ 11: { jarl: ['whiterun'], guard: ['riften'] }, 12: { jarl: ['whiterun'], guard: ['riften'] } },
                    { 11: 'acct-a', 12: 'acct-a' },
                    { 'jarl:whiterun': { 'acct-a': { pid: 11, name: 'Balgruuf', at: 1 } } });
  yes('C1 of two characters on an account with the Jarl role, only the one that holds the office is Jarl',
      C.isJarlOf(11, 'whiterun') && !C.isJarlOf(12, 'whiterun') && C.isStewardOf(11, 'whiterun') && !C.isSteward(12));
  yes('C2 a role no character holds yet is nobody\'s office, and both characters are offered it',
      C.officesOfProfile(11).guard.length === 0 &&
      C.officesToHold(11).map(function (t) { return t.office + ':' + t.hold; }).join() === 'guard:riften' &&
      C.officesToHold(12).map(function (t) { return t.office + ':' + t.hold + ':' + (t.by ? t.by.pid : ''); }).join() ===
        'jarl:whiterun:11,guard:riften:');
  const G = readers({ 11: {}, 12: {} }, { 11: 'acct-a', 12: 'acct-a' },
                    { 'jarl:whiterun': { 'acct-a': { pid: 11, name: 'Balgruuf', at: 1 } } });
  yes('C3 a role taken in Discord ends the office, whatever the register says', !G.isJarlOf(11, 'whiterun') &&
      G.officesToHold(11).length === 0);
  const W = readers({ 11: { jarl: ['whiterun'] } }, { 11: 'acct-b' },
                    { 'jarl:whiterun': { 'acct-a': { pid: 11, name: 'Balgruuf', at: 1 } } });
  yes('C4 a record under another account is not this account\'s', !W.isJarlOf(11, 'whiterun'));
}

if (evictBlock !== null) {
  const alicesHouse = { by: ALICE, name: 'Alice', at: 1, touched: 1,
                        locked: true, ground: 'the field' };

  {
    const r = evict({ by: BOB, stewards: [], held: alicesHouse });
    yes('S6 somebody who is not a steward cannot end a claim',
        r.claims[HOUSE] && r.claims[HOUSE].by === ALICE);
    yes('S6 and is told the rule', r.told[0] === 'Only a steward ends a claim.');
  }

  {
    const r = evict({ by: BOB, stewards: [BOB], held: alicesHouse });
    yes('S7 a steward ends the claim', !r.claims[HOUSE]);
    yes('S7 and the view is pushed, so shut doors are right at once',
        r.pushes === 1);
    yes('S7 and the person who lost it is named to the steward',
        r.told[0].indexOf('Alice') !== -1);
    yes('S7 and the steward\'s Office page is written again', r.redraws === 1);
  }

  {
    const r = evict({ by: BOB, stewards: [BOB], held: alicesHouse });
    yes('S8 it says belongings are untouched',
        r.told[0].indexOf('untouched') !== -1);
    yes('S8 and that a key they hold still works',
        r.told[0].indexOf('key') !== -1 && r.told[0].indexOf('still works') !== -1);
  }

  {
    yes('S9 a steward at a door nobody holds is told so',
        evict({ by: BOB, stewards: [BOB], held: null })
          .told[0].indexOf('Nobody holds') !== -1);
    yes('S9 and away from a door is told to go to one',
        evict({ by: BOB, stewards: [BOB], held: alicesHouse, atDoor: false })
          .told[0].indexOf('Open the door of the building') !== -1);
  }

  // Patrick, 16 October, answer C (#2551): own hold only, by the building's hold.
  {
    const r = evict({ by: BOB, riften: [BOB], held: alicesHouse });
    yes('S10 the Steward of Riften does not end a claim on a Whiterun house, and is told whose it is (' + r.told[0] + ')',
        r.claims[HOUSE] && r.claims[HOUSE].by === ALICE && r.pushes === 0 &&
        r.told[0] === 'Breezehome answers to Whiterun. Only the Steward of Whiterun or its Jarl ends a claim or sets rent there.');
    const r2 = evict({ by: BOB, riften: [BOB], held: alicesHouse, hold: 'riften' });
    yes('S10 and does end one on a house in Riften', !r2.claims[HOUSE] && r2.pushes === 1);
    const r3 = evict({ by: BOB, stewards: [BOB], held: alicesHouse, hold: null });
    yes('S11 a building the table gives no hold is nobody\'s to end, and the steward is told why',
        r3.claims[HOUSE] && r3.claims[HOUSE].by === ALICE &&
        r3.told[0] === 'Breezehome answers to no hold the server knows, so no steward ends a claim or sets rent there.');
  }
}

{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the office line and evict are in the one list every command is registered in, and /box is not (#2298)',
      /'\/evict', '\/rent',/.test(code) && /'\/office',/.test(code) && !/'\/box'/.test(code));
  yes('and the dispatcher hands /office and /evict to the property block',
      /word === '\/office'/.test(code) && /word === '\/evict'/.test(code));
  yes('the roles are read from outside, and the register keeps only which character holds an office: no stewards register, no guards or seats',
      /g\[onRecord \? '__thornswoodOfficesOnRecord' : '__thornswoodOffices'\]/.test(code) && !/claims: claims, stewards: stewards/.test(code) &&
      /JSON\.stringify\(\{ cells: law\.cells, held: law\.held \}/.test(code) && !/law\.jarls|law\.guards/.test(code));
  yes('__thornswoodOffices is defined on the door loader (not only read), and the Jarl answer that came before it is gone',
      /__thornswoodOffices = function\s*\(/.test(code) && !/__thornswoodIsJarl/.test(code));
  yes('no office is on the character any more: nothing writes or reads s.office',
      !/s\.office\b|office:\s*null|officeHold\b/.test(code));
  yes('the site\'s door answer names the offices by profile and the Jarl roles held twice, and no jarlProfiles',
      /offices: \{\}, jarlClash: \[\]/.test(site) && !/jarlProfiles/.test(site));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
