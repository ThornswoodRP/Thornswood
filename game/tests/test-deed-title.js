// test-deed-title.js
//
// The deed is the title. Carrying it to the door takes the property.
//
// /claim has told people this since it was written: "Whoever carries it holds
// the place, so keep it somewhere a thief will not look." Nothing in the file
// did it. holderOf read the register and the register only, so a stolen deed
// was a piece of paper and the message was a promise the code did not keep.
//
// Patrick's design, 21 September: a thief who lifts the deed takes the house,
// and a transfer is an act at a door between two people rather than something
// an item does in a pocket. Carrying the deed and opening the door IS that act.
// It cannot happen in a pocket because it needs the door, and handing somebody
// the deed is the same gesture whether it is a sale, a gift or a theft, which
// is the point: the server does not need to tell those apart.
//
// WHY THE DOOR IS SAFE TO HANG IT ON, and this is measured rather than chosen:
// a LOCKED door is never announced to the server at all, on purpose, so that
// Skyrim's own lockpicking keeps working. So every press that reaches this code
// is a door that was already open to whoever pressed it.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Since #502 the act also asks mayHold: a jail is its hold's Jarl's alone.
const START = '    if (mine && holdsDeed(actorId, building) && (!held || held.by !== mine) &&\n' +
              '        mayHold(actorId, mine, building)) {';
const END = '\n    }\n';
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;

yes('the deed title rule is in the gamemode', block !== null);

const HOUSE = 'breezehome';

/**
 * Drive the real block for one door press.
 *
 * Only the register, the pack and the two ways of speaking are replaced. The
 * decision itself is the shipped text.
 */
function press(opts) {
  const said = [];
  const logs = [];
  const issued = [];
  const words = [];
  const claims = {};
  if (opts.held) { claims[HOUSE] = opts.held; }

  const fn = new Function(
    'mine', 'actorId', 'building', 'held', 'claims', 'holdsDeed', 'holderOf',
    'nameOf', 'groundHere', 'save', 'pushAll', 'plog', 'notify', 'say', 'mp', 'mayHold',
    'issueMaster', 'masterHandedLine', 'recordWord', 'WORD_SAID',
    block + '\nreturn { moved: false, claims: claims };');

  const out = fn(
    opts.mine, 0xff000058, HOUSE, opts.held || null, claims,
    function () { return !!opts.hasDeed; },
    function () { return opts.held || null; },
    function () { return 'Breezehome'; },
    function () { return opts.groundNow || null; },
    function () { }, function () { },
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    function (id, m) { said.push(m); },
    function (id, m) { said.push(m); },
    { get: function () { return { name: opts.who || 'Somebody' }; } },
    function () { return opts.mayHold !== false; },
    // The master key (#2254): the new holder is handed their own. 0 is a
    // server whose plugin has no master key record yet.
    function (to, b, held) {
      issued.push({ to: to, b: b, held: held });
      if (!opts.master) { return 0; }
      held.master = { for: held.by, no: opts.master };
      return opts.master;
    },
    function () { return 'Its master key is in your pack.'; },
    // Word to the holder whose deed was presented (#2680): recorded, not sent here.
    function (kind, b, holder, actor, by) { words.push({ kind: kind, b: b, holder: holder, by: by }); return 'kept'; },
    { kept: 'kept for them' });

  return { claim: claims[HOUSE], said: said, logs: logs, issued: issued, words: words };
}

if (block !== null) {
  const ALICE = 101, BOB = 202;
  const alicesHouse = { by: ALICE, name: 'Alice', at: 1, touched: 1,
                        locked: true, ground: 'the field' };

  // S1: THE WHOLE POINT. Bob has Alice's deed and opens her door. It is his.
  {
    const r = press({ mine: BOB, who: 'Bob', hasDeed: true, held: alicesHouse });
    yes('S1 carrying the deed to the door takes the property',
        r.claim && r.claim.by === BOB);
    yes('S1 and the new holder is named on the claim', r.claim.name === 'Bob');
    yes('S1 and they are told it is theirs',
        r.said.length > 0 && r.said[0].indexOf('It is yours now') !== -1);
    yes('S1 and told whose it was, because that is the story',
        r.said[0].indexOf('Alice') !== -1);
    yes('S1 and word is kept for Alice that her deed was presented at her door (#2680)',
        r.words.length === 1 && r.words[0].kind === 'deed' && r.words[0].b === HOUSE &&
        r.words[0].holder === ALICE && r.words[0].by === BOB);
  }

  // S1j: A JAIL'S DEED IS PAPER (#502). Patrick, 12 Oct: a jail is claimed
  //      by the Jarl of its hold alone, so its deed in anybody else's hand
  //      claims nothing at its door.
  {
    const r = press({ mine: BOB, who: 'Bob', hasDeed: true, held: alicesHouse, mayHold: false });
    yes('S1j a jail\'s deed presented by somebody who may not hold it takes nothing',
        r.claim && r.claim.by === ALICE && r.said.length === 0);
  }

  // S1b (#2254): the new holder is handed a master key of their own, and the
  //     claim is a new record, so Alice's master key names nothing now.
  {
    const old = { by: ALICE, name: 'Alice', at: 1, touched: 1, locked: true,
                  ground: 'the field', master: { for: ALICE, no: 4 } };
    const r = press({ mine: BOB, who: 'Bob', hasDeed: true, held: old, master: 9 });
    yes('S1b the master key is cut for the new holder, on the new claim',
        r.issued.length === 1 && r.issued[0].held === r.claim && r.claim.master &&
        r.claim.master.for === BOB && r.claim.master.no === 9);
    yes('S1b and they are told it is in their pack', /master key is in your pack/.test(r.said[0]));
    const none = press({ mine: BOB, who: 'Bob', hasDeed: true, held: old, master: 0 });
    yes('S1b with no master key record on the server, the deed still takes the house and no master is named',
        none.claim.by === BOB && !none.claim.master && !/master key/.test(none.said[0]));
  }

  // S2: THE LOCK SURVIVES THE TRANSFER. A house that was locked stays locked,
  //     or taking a deed would fling every door in it open.
  {
    const r = press({ mine: BOB, hasDeed: true, held: alicesHouse });
    yes('S2 a locked house is still locked after it changes hands',
        r.claim.locked === true);
  }

  // S3: AND THE GROUND GOES WITH THE HOUSE. A home and its farm are one claim,
  //     so a transfer must not quietly drop the field behind it.
  {
    const r = press({ mine: BOB, hasDeed: true, held: alicesHouse });
    yes('S3 the ground is kept from the old record',
        r.claim.ground === 'the field');
  }

  // S4: an unheld building with a deed in hand is taken the same way. A deed
  //     can outlive a lapsed claim, and it should still open the door to it.
  {
    const r = press({ mine: BOB, who: 'Bob', hasDeed: true, held: null });
    yes('S4 a deed to nobody\'s house still takes it', r.claim && r.claim.by === BOB);
    yes('S4 and nobody is named as the loser',
        r.said.length > 0 && r.said[0].indexOf('no longer') === -1);
  }

  // S5: NOTHING HAPPENS WITHOUT THE DEED. This is the half that keeps a house
  //     yours: opening somebody's door is not taking it, and a person who was
  //     let in, or picked the lock, changes nothing by walking through.
  {
    const r = press({ mine: BOB, hasDeed: false, held: alicesHouse });
    yes('S5 opening a door without the deed takes nothing',
        r.claim && r.claim.by === ALICE);
    yes('S5 and says nothing to anybody', r.said.length === 0);
  }

  // S6: and the holder walking through their own door is not a transfer.
  {
    const r = press({ mine: ALICE, hasDeed: true, held: alicesHouse });
    yes('S6 the holder presenting their own deed changes nothing',
        r.claim.by === ALICE && r.said.length === 0);
  }

  // S7: somebody with no profile id at all does nothing. A read that failed is
  //     not a reason to move a house.
  {
    const r = press({ mine: 0, hasDeed: true, held: alicesHouse });
    yes('S7 a press with no profile id takes nothing', r.claim.by === ALICE);
  }
}

// ---------------------------------------------------------------- structure
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the rule is reached before the once-an-hour touch write',
      code.indexOf('holdsDeed(actorId, building) && (!held || held.by !== mine)') <
      code.indexOf('held.touched = Date.now()'));
  yes('and it speaks through the two the rest of the file uses',
      /notify\(actorId, told\)/.test(code) && /say\(actorId, told\)/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
