// ---------------------------------------------------------------------------
// the class and profession gates
//
// classes.md: each class owns a verb that nobody else in the game has, and
// 'those are exclusive, not preferential'. Until 20 September nothing asked:
// canDo existed in the rules block and not one caller called it, so a miner
// picked flowers and a hunter worked a seam. Every place below that hands out
// a yield asks first, and says who can when the answer is no.
//
// The three wrappers go through the character block rather than the rules
// directly, because the character block is the only reader and writer of the
// state. When that block is missing, which means the file loaded broken, the
// gate is OPEN and says so in the log: a rules block that failed to register
// must not be the reason nobody in the world can pick a flower.
// ---------------------------------------------------------------------------

/** null when this person may do that class verb, otherwise what to tell them. */
function classGate(actorId, verb) {
  const c = globalThis.__thornswoodCharacter;
  if (!c || !c.gate) {
    log('the character block is not loaded, so the', verb, 'gate is open');
    return null;
  }
  try {
    return c.gate(actorId, verb);
  } catch (e) {
    log('the', verb, 'gate threw, so it is open:', e);
    return null;
  }
}

/** The same for one half of a profession, at a rank. */
function halfGate(actorId, half, rank, refusal) {
  const c = globalThis.__thornswoodCharacter;
  if (!c || !c.gateHalf) {
    log('the character block is not loaded, so the', half, 'gate is open');
    return null;
  }
  try {
    return c.gateHalf(actorId, half, rank, refusal);
  } catch (e) {
    log('the', half, 'gate threw, so it is open:', e);
    return null;
  }
}

/**
 * A yield has been handed out: count the work, and hand back the line about a
 * new rank when one was reached. Anything going wrong here costs a count, not
 * somebody's salt, so it is swallowed.
 *
 * n is how many pieces this one piece of work is, one when it is not given. A
 * warrior's kill is the one caller that passes it (#1386): a dragon is 16
 * pieces. It is still one swing for tiredness, the page's "the same rest cost
 * as a swing of a pick", and the party bonus is 15% of the whole count.
 */
function creditWork(actorId, key, n) {
  const pieces = (typeof n === 'number' && n >= 1) ? Math.floor(n) : 1;
  /*
    Every piece of work is also a piece of tiredness.

    Blade: "When doing your skilled profession, it drains your Exhaustion
    faster. As you level up your skill it doesn't drain your exhaustion meter
    as fast." This is the one place every trade already passes through, so it
    is the one place that has to know: the seam, the chopping block, the kiln,
    the plot, the river and the hunt all call it, and anything added later
    gets the same treatment for nothing.

    Guarded and silent. A needs block that is not loaded yet, or a hot reload
    mid-tick, must not stop somebody's work being counted.
  */
  try {
    const needs = globalThis.__thornswoodNeeds;
    if (needs && needs.worked) {
      /*
        AND IT SAYS SO WHEN THE WORK ACTUALLY TELLS. worked() costs rest per
        swing now rather than nudging a rate, so it can cross a band, and a
        band crossing is the one thing worth interrupting somebody for. Every
        swing before that says nothing, which is the same rule the seam and
        the chopping block already follow.
      */
      const tiredLine = needs.worked(actorId);
      if (tiredLine) {
        try { notify(actorId, tiredLine); } catch (e) { }
        try { say(actorId, tiredLine); } catch (e) { }
      }
    }
  } catch (e) { }

  /*
    And work done with your party standing next to you counts for more.

    Blade's pitch had an experience bonus for playing together and Patrick
    said yes to it. This is the one place every trade already passes through,
    the same reason the tiredness above is here.

    PAID AS A WHOLE EXTRA PIECE, NOT AS A FRACTION. Work is counted in pieces:
    one seam, one log, one fish. There is no such thing as 1.15 of a log, and
    rolling a die for it would make the same work worth different amounts on
    different swings with nothing on the screen explaining why. So the bonus
    is banked per character and paid out as one extra piece when it reaches a
    whole one, which at fifteen percent is every seventh piece. Deterministic,
    and a sentence somebody can be told.

    IT IS ON BEING TOGETHER rather than on being in a party: partyNear asks
    whether anybody from your party is in the same cell. A bonus for being
    listed together is a checkbox everybody ticks once and never thinks about
    again.
  */
  let extra = 0;
  try {
    const soc = globalThis.__thornswoodSocial;
    if (soc && soc.workBonus) {
      const over = soc.workBonus(actorId) - 1;
      if (over > 0) {
        PARTY_BANK[actorId] = (PARTY_BANK[actorId] || 0) + over * pieces;
        while (PARTY_BANK[actorId] >= 1) { PARTY_BANK[actorId] -= 1; extra++; }
      }
    }
  } catch (e) { }

  const c = globalThis.__thornswoodCharacter;
  if (!c || !c.credit) { return null; }
  try {
    let line = c.credit(actorId, key);
    // Every piece after the first, and then the bonus pieces. A later
    // piece's answer wins when it has one, because a rank raised by the last
    // piece is the thing worth saying.
    for (let i = 1; i < pieces + extra; i++) {
      const more = c.credit(actorId, key);
      if (more) { line = more; }
    }
    return line;
  } catch (e) {
    log('could not count', key, 'work for', actorId.toString(16) + ':', e);
    return null;
  }
}

/* What each character is owed of the party bonus, in fractions of a piece.
   In memory: a party is a session, so its bonus is too. */
const PARTY_BANK = {};

/*
  A yield, counted for the hold it came out of (#3164). Each place that hands
  out a gathered piece calls this beside its creditWork, with what it handed
  over and how many, once the pack has it. The hold economy block further down
  the file does the counting; this only reaches it, so a block that did not
  load costs the count and never anybody's yield.
*/
function economyGathered(actorId, itemDesc, count) {
  const e = globalThis.__thornswoodEconomy;
  if (!e || typeof e.note !== 'function') { return; }
  try { e.note('gathered', actorId, itemDesc, count); }
  catch (err) { log('the hold economy could not count a yield of', itemDesc + ':', err); }
}

/**
 * The rank somebody holds in one class, half or school, as a step: 0 for a
 * novice, 3 for a Master, and 0 when they hold nothing at all. The two
 * stations size their yield by this now rather than by a manual tier.
 */
function rankStep(actorId, key) {
  const c = globalThis.__thornswoodCharacter;
  if (!c || !c.rankOf) return 0;
  try {
    const at = RANK_LADDER.indexOf(c.rankOf(actorId, key));
    return at < 0 ? 0 : at;
  } catch (e) {
    log('could not read the', key, 'rank for', actorId.toString(16) + ':', e);
    return 0;
  }
}

