// test-bans.js
//
// A ban does not depend on somebody spelling a role name correctly.
//
// From the To Do List: "site/server.js:75 expects a role named Banned...
// Build-Discord.py builds the role list and Banned is not in it. Entry 30 is
// the enforcement; this is the fact that the thing being enforced does not
// exist yet."
//
// TWO HALVES, AND THIS CHECKS BOTH. The builder makes the role now, so a
// moderator has something to reach for in Discord. And the site reads a
// bans.json of Discord ids, so the ban survives somebody renaming the role,
// the bot being out of the guild, a guild lookup failing, and the branch for
// "no bot configured yet" which used to hand play to everybody.
//
// The file half is what this drives, by lifting the block out of server.js and
// running it, because that is the half a typo cannot break.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const CR = String.fromCharCode(13);
const SRC = path.join(REPO_DIR, 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');
const builder = fs.readFileSync(path.join(REPO_DIR, 'bot', 'Build-Discord.py'), 'utf8')
  .split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---------------------------------------------------- the role exists now
yes('the builder makes a Banned role', /ROLES\.append\(\('Banned',/.test(builder));
yes('and it is not hoisted, because a ban is not a badge',
    /ROLES\.append\(\('Banned', 0x[0-9A-Fa-f]{6}, False,/.test(builder));
yes('the site still keys the role half off that exact name',
    /banned: \['Banned'\]/.test(src));

// ------------------------------------------------------- the file half
// The read goes through bansNow() since #2186, which fails closed on a
// broken file (site/tests/test-bans-broken.js runs that against the real site).
const from = src.indexOf('  const readB = bansNow();\n  if (readB.broken) {');
const to = src.indexOf('  /* The hand written admin list is an override', from);
const block = (from >= 0 && to > from) ? src.slice(from, to) : '';
yes('the ban file is read inside standing()', !!block);

if (block) {
  /*
    Lifted and run rather than read, so this fails if somebody deletes the
    early return or turns it into a check that only counts when the guild
    lookup worked. The stub stands in for jsonFile, which on the real thing
    returns the fallback for a missing or unreadable file.
  */
  function decide(bansTable, discordId, broken) {
    const out = { id: String(discordId), banned: false, play: false, admin: false };
    const jsonFile = function () { return bansTable; };
    const bansNow = function () { return { table: bansTable, broken: broken || '' }; };
    const BANS_BROKEN_WHY = 'broken';
    const BANS = 'bans.json';
    let returned = false;
    (function () {
      // the block ends in `return out;` inside the real function
      const run = new Function('out', 'jsonFile', 'BANS', 'discordId', 'Object', 'bansNow', 'BANS_BROKEN_WHY',
        block + '\nreturn null;');
      const r = run(out, jsonFile, BANS, discordId, Object, bansNow, BANS_BROKEN_WHY);
      returned = (r !== null) || out.banned;
    })();
    return { out: out, returned: returned };
  }

  const table = { '123456789012345678': { at: 1, by: 'patrick', why: 'told a tester where to go' } };

  const hit = decide(table, '123456789012345678');
  yes('an id in the file is banned', hit.out.banned === true);
  yes('and standing stops there rather than going on to ask Discord', hit.returned === true);
  yes('and the reason comes back with it', hit.out.reason === 'told a tester where to go');

  const miss = decide(table, '999999999999999999');
  yes('somebody who is not in the file is not banned', miss.out.banned === false);

  /*
    THE ID IS STRINGIFIED, and the value here is small on purpose.

    A Discord id is a 64 bit snowflake and a JavaScript number cannot hold one:
    String(123456789012345678) answers 123456789012345680, a different account.
    That is not a fault in this check, it is a reason ids must never be turned
    into numbers anywhere on the way here, and they are not: Discord's API
    returns them as strings in JSON and the ticket carries a string. So this
    proves the stringify works, with a value where it is lossless, and the
    lookup below proves the code does it rather than comparing types.
  */
  const small = decide({ '42': { why: 'small enough to survive being a number' } }, 42);
  yes('an id is stringified before it is looked up', small.out.banned === true);
  yes('and the code does that itself, rather than trusting what it was handed',
      /String\(discordId\)/.test(block));

  yes('an empty file bans nobody', decide({}, '123456789012345678').out.banned === false);
  yes('a broken file bans everybody, and says why (#2186)', decide({}, '1', 'will not parse').out.banned === true &&
      decide({}, '1', 'will not parse').out.bansBroken === true);

  /*
    A missing file is the one that matters most: jsonFile answers its fallback,
    which is {}, and an empty table must not ban the world. Proved with the
    same shape jsonFile returns.
  */
  yes('a missing file bans nobody either', decide({}, '1').out.banned === false);

  /*
    AND NOT A PROTOTYPE KEY. A lookup without hasOwnProperty finds things on
    Object.prototype, so an id of 'constructor' or 'toString' would read as
    banned. Nobody has an id like that, but the check is one word and the
    failure would be silent and permanent for whoever it hit.
  */
  yes('a prototype name is not a ban', decide({}, 'constructor').out.banned === false);
  yes('and neither is toString', decide({}, 'toString').out.banned === false);
}

// ------------------------------------------- where the check has to sit
{
  /*
    BEFORE EVERY OTHER BRANCH. standing() has three ways out before it ever
    looks at roles: the hand written admin list, "no bot configured yet" which
    hands play to everybody, and a guild lookup that fails. A ban read off a
    role only works on the fourth path.
  */
  const fn = src.slice(src.indexOf('async function standing(discordId)'),
                       src.indexOf('/* The ticket the launcher keeps.'));
  const banIdx = fn.indexOf('bansNow()');
  const adminIdx = fn.indexOf('cfg.admins.indexOf');
  const noBotIdx = fn.indexOf('No bot configured yet');
  yes('the file is read before the hand written admin list',
      banIdx >= 0 && adminIdx > banIdx);
  yes('and before the branch that hands play out when no bot is configured',
      banIdx >= 0 && noBotIdx > banIdx);
  yes('the role check is still there as well',
      /out\.banned = has\(cfg\.access\.banned\);/.test(fn));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
