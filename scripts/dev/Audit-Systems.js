// Audit-Systems.js
//
//     node scripts\dev\Audit-Systems.js
//     node scripts\dev\Audit-Systems.js -v      every half and every class in full
//
// Asked for by Patrick, 21 September: "a full scale audit of the Proffesions,
// Sub Proffesions, Classes, Skill Tree, and Property system ... so when I go to
// actually test the system things arent missing and we have to wait for it to
// be added".
//
// So this answers one question: IS IT ALL THERE. It reads the shipped
// gamemode.js and the generated tables beside it and says, per class, per
// profession, per half, per sub-skill and for the property system, whether the
// thing exists, whether it is gated, and whether anybody can actually do it.
//
// It is READ ONLY and talks to nothing. It never starts a game and never
// touches the VPS, so it can be run at any time, including while people are
// playing.
//
// WHAT IT CANNOT ANSWER, said here rather than left to be discovered: whether a
// recipe's conditions pass in a real game, whether a mini game feels right, and
// whether a number is balanced. It answers presence, ownership and reachability.
// Check-Balance.ps1 is the one that answers whether the ladders line up.
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const VERBOSE = process.argv.indexOf('-v') !== -1;
const SRC = process.env.GM || path.join(HERE, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
// The gamemode's tables (#5191): game/gamemode-tables, or GM_TABLES.
const TABLES = require('./GamemodeTables.js');
const TABLE_DIR = process.env.GM_TABLES || TABLES.DIR;

let ok = 0, warn = 0, bad = 0;
const notes = [];

function OK(m) { ok++; console.log('  ok    ' + m); }
function WARN(m) { warn++; notes.push('WARN  ' + m); console.log('  WARN  ' + m); }
function BAD(m) { bad++; notes.push('FAIL  ' + m); console.log('  FAIL  ' + m); }
function head(m) {
  console.log('');
  console.log(m);
  console.log('-'.repeat(m.length));
}

function readJson(name) {
  // The tables are in game\data since phase 6 of issue #440.
  try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'game', 'data', name), 'utf8')); }
  catch (e) { return null; }
}

/** Lift a top level object literal out of the gamemode and evaluate it. */
function lift(decl) {
  const a = src.indexOf(decl);
  if (a < 0) { return null; }
  /*
    A LIST IS LIFTED THE SAME WAY AN OBJECT IS.

    This only ever looked for an opening brace, so a declaration whose value is
    an array walked past its own value and matched the first brace belonging to
    something else entirely, hundreds of lines down. It then fed that to the
    Function constructor, which threw, and lift answered null. The only caller
    that hits it is WORDS, and the audit reported "the word list could not be
    read" on a file where the word list is perfectly readable, which meant
    nothing checked that a registered command is answered by anything.
  */
  const brace = src.indexOf('{', a);
  const bracket = src.indexOf('[', a);
  let open = -1;
  if (brace < 0) { open = bracket; }
  else if (bracket < 0) { open = brace; }
  else { open = Math.min(brace, bracket); }
  if (open < 0) { return null; }
  const shut = src[open] === '[' ? ']' : '}';
  const start = src[open];
  let depth = 0, end = -1, inStr = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) { inStr = null; }
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === start) { depth++; }
    else if (c === shut) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) { return null; }
  try { return new Function('return (' + src.slice(open, end + 1) + ');')(); }
  catch (e) { return null; }
}

console.log('THORNSWOOD SYSTEM AUDIT');
console.log('read from ' + SRC);

// =========================================================== the classes ===
head('Classes, and whether the verb each one owns is actually gated');

const VERBS = lift('var VERBS = ');
const CLASS_TABLES = {
  mine: 'ORES_BY_BASE', harvest: 'HARVESTS_BY_BASE',
  loot: 'HUNTS_BY_BASE', fish: 'FISH_BY_BASE', farm: 'CROPS_BY_BASE'
};

if (!VERBS) {
  BAD('the verb table could not be read, so nothing below it means anything');
} else {
  const names = Object.keys(VERBS);
  if (names.length === 5) { OK('five class verbs: ' + names.join(', ')); }
  else { BAD('expected five class verbs, found ' + names.length); }

  names.forEach(function (verb) {
    const cls = VERBS[verb];
    // Is the gate actually called for this verb, anywhere?
    const calls = (src.match(new RegExp("classGate\\(actorId, '" + verb + "'", 'g')) || []).length;
    if (calls > 0) { OK(cls + ' (' + verb + ') is gated at ' + calls + ' site(s)'); }
    else { BAD(cls + ' (' + verb + ') has a class but NO GATE CALL, so anybody can do it'); }

    // Is there a table of things to do it to?
    const table = CLASS_TABLES[verb];
    if (!table) { WARN(verb + ' has no table named in this audit'); return; }
    const present = src.indexOf("table('" + table + "')") !== -1 && fs.existsSync(TABLES.file(table, TABLE_DIR));
    if (!present) { BAD(cls + ': ' + table + ' is NOT read by the gamemode or not in its tables, so the verb has nothing to work on'); }
    else { OK(cls + ': ' + table + ' is installed'); }
  });
}

// ====================================================== the tables by rank ===
head('What each class can work, by rank');

[['ores.json', 'veins', 'Miner'],
 ['harvests.json', 'plants', 'Gatherer'],
 ['hunts.json', 'animals', 'Hunter']].forEach(function (row) {
  const doc = readJson(row[0]);
  if (!doc) { WARN(row[0] + ' is missing, so ' + row[2] + ' cannot be checked'); return; }
  const byRank = {};
  const bag = doc.ores || doc.harvests || doc.hunts || doc.rows || null;
  if (!bag) { WARN(row[0] + ' has no rows this audit understands'); return; }
  Object.keys(bag).forEach(function (k) {
    const r = (bag[k] && bag[k].rank) || 'unranked';
    byRank[r] = (byRank[r] || 0) + 1;
  });
  const total = Object.keys(bag).length;
  const ranks = ['novice', 'advanced', 'expert', 'master'];
  const missing = ranks.filter(function (r) { return !byRank[r]; });
  const shown = ranks.map(function (r) { return r + ' ' + (byRank[r] || 0); }).join(', ');
  if (missing.length) {
    WARN(row[2] + ': ' + total + ' ' + row[1] + ', but nothing at ' + missing.join(' or ') +
         ' (' + shown + ')');
  } else {
    OK(row[2] + ': ' + total + ' ' + row[1] + ' across all four ranks (' + shown + ')');
  }
});

// ======================================================= the professions ===
head('Professions and their halves, and what each half can make');

const PROFESSIONS = lift('var PROFESSIONS = ');
const rec = readJson('recipes.json');

if (!PROFESSIONS) {
  BAD('the profession table could not be read');
} else {
  const profs = Object.keys(PROFESSIONS);
  if (profs.length === 8) { OK('eight professions: ' + profs.join(', ')); }
  else { BAD('expected eight professions, found ' + profs.length); }

  const halvesSeen = [];
  profs.forEach(function (p) {
    const h = PROFESSIONS[p].halves;
    if (!h) {
      if (p === 'mage') { OK('mage has schools rather than halves, which is the rulebook'); }
      else { BAD(p + ' has no halves and is not the mage'); }
      return;
    }
    const keys = Object.keys(h);
    if (keys.length !== 2) { BAD(p + ' has ' + keys.length + ' halves, expected two'); }
    keys.forEach(function (k) { halvesSeen.push(k); });
  });
  OK(halvesSeen.length + ' craft halves across the professions');

  if (!rec) {
    BAD('recipes.json is missing, so no half can be checked for what it makes');
  } else {
    const byHalf = {};
    const rows = rec.recipes || {};
    Object.keys(rows).forEach(function (id) {
      const r = rows[id];
      const half = String(r.half || '').toLowerCase();
      if (!half) { return; }
      if (!byHalf[half]) { byHalf[half] = { total: 0, fires: 0, ranks: {} }; }
      byHalf[half].total++;
      if (r.fires !== false) { byHalf[half].fires++; }
      const rk = r.rank || 'unranked';
      byHalf[half].ranks[rk] = (byHalf[half].ranks[rk] || 0) + 1;
    });

    /*
      A RECIPE IS NOT THE ONLY WAY TO CLIMB, and asking only about recipes made
      this report wrong about five halves out of sixteen.

      It said bulwark, berserker, blightbrewer, physicker and wardweaver "OWN
      NO RECIPE AT ALL, so somebody can pick it and make nothing". The first
      half of that is true and the second is now false, and the difference
      matters because the question anybody actually has is whether a half can
      be picked and then never climb.

      THERE ARE THREE WAYS TO CLIMB and the file knows about all of them:

        A RECIPE. Most halves. The recipe gate credits the half that owns it.

        A BENCH WITH NO RECIPES BEHIND IT. Skyrim has no COBJ records for
        alchemy or enchanting: a potion is worked out from the effects the
        ingredients share, inside a menu, with no record involved. So the
        gamemode reads the BENCH instead, in recipelessCraft, and credits the
        half that owns it. blightbrewer, physicker, wardweaver and bladebinder
        climb that way and have since the recipeless path learned to credit.

        A VERB. The server sees a death with its killer, so a Warrior's work
        is the fight: mp.onDeath credits bulwark or berserker for an NPC they
        killed. Added 23 September for exactly this report.

      So the check reads the gamemode for the other two rather than assuming
      the recipe table is the whole world. A half with none of the three is
      still a real failure and still says so.
    */
    // src is the gamemode, already read at the top of this file.
    const gm = src;
    const benched = {};
    {
      const access = fs.existsSync(TABLES.file('BENCH_ACCESS', TABLE_DIR));
      if (access) {
        try {
          const table = TABLES.read('BENCH_ACCESS', TABLE_DIR);
          Object.keys(table).forEach(function (k) {
            const halves = (table[k] && table[k].halves) || {};
            Object.keys(halves).forEach(function (hh) {
              (benched[hh.toLowerCase()] = benched[hh.toLowerCase()] || []).push(table[k].name || k);
            });
          });
        } catch (e) { /* a table that will not parse is reported by its own check */ }
      }
    }
    // The halves a verb credits, read out of the file rather than listed here,
    // so this cannot say yes to something that was taken out again.
    const verbed = {};
    if (gm && /st\.prof === 'warrior' && st\.half/.test(gm)) {
      verbed.bulwark = 'a kill'; verbed.berserker = 'a kill';
    }

    halvesSeen.forEach(function (h) {
      const b = byHalf[h];
      if (!b || !b.total) {
        if (benched[h]) {
          OK(h + ' owns no recipe, and does not need one: it climbs at ' +
             benched[h].join(' and ') + ', through the recipeless craft path');
          return;
        }
        if (verbed[h]) {
          OK(h + ' owns no recipe, and does not need one: it climbs on ' + verbed[h]);
          return;
        }
        BAD(h + ' owns no recipe, no bench and no verb, so somebody can pick it ' +
            'and never climb at all');
        return;
      }
      if (!b.fires) {
        BAD(h + ' owns ' + b.total + ' recipes and the server is asked about NONE of them');
        return;
      }
      const ranks = ['novice', 'advanced', 'expert', 'master']
        .map(function (r) { return r + ' ' + (b.ranks[r] || 0); }).join(', ');
      const empty = ['novice', 'advanced', 'expert', 'master']
        .filter(function (r) { return !b.ranks[r]; });
      if (empty.length) {
        WARN(h + ': ' + b.fires + ' of ' + b.total + ' reach the server, nothing at ' +
             empty.join(' or ') + ' (' + ranks + ')');
      } else if (VERBOSE) {
        OK(h + ': ' + b.fires + ' of ' + b.total + ' reach the server (' + ranks + ')');
      } else {
        OK(h + ': ' + b.fires + ' craftable, all four ranks');
      }
    });

    // The two that have no COBJ anywhere, and the gate written for them.
    const hasRecipeless = src.indexOf('function recipelessCraft') !== -1;
    if (hasRecipeless) {
      OK('alchemy and enchanting have no COBJ in the game and are handled by the ' +
         'recipeless craft gate instead');
    } else {
      BAD('nothing handles a craft with no recipe, so brewing and enchanting do nothing');
    }
  }
}

// ========================================================= the skill tree ===
head('The skill tree');

const TREE = lift('var TREE = ');
if (!TREE) {
  BAD('the tree could not be read');
} else {
  /*
    THE TREE HAS BRANCHES AND THE SUB-SKILLS ARE INSIDE THEM.

    This counted Object.keys(TREE) and called the answer the sub-skills, so it
    reported three and warned that twelve were missing. Nothing was missing.
    TREE is health, magicka and stamina, and each of those carries a skills
    object with five in it. A harness that is confidently wrong is worse than
    no harness, because its numbers get quoted, and this one said the skill
    tree was four fifths absent on the night of the professions audit.
  */
  const branches = Object.keys(TREE);
  const keys = [];
  branches.forEach(function (b) {
    const inside = (TREE[b] && TREE[b].skills) || {};
    Object.keys(inside).forEach(function (k) { keys.push(b + '.' + k); });
  });
  console.log('  ' + branches.length + ' branches: ' + branches.join(', '));
  console.log('  ' + keys.length + ' sub-skills: ' + keys.join(', '));
  if (branches.length === 3) { OK('three branches, which is the rulebook'); }
  else { WARN('expected three branches, found ' + branches.length); }
  if (keys.length === 15) { OK('fifteen sub-skills, which is the rulebook'); }
  else { WARN('expected fifteen sub-skills, found ' + keys.length); }

  // Every one has to end up as something the client can set, or a point in it
  // buys nothing. treeApplies is what turns the tree into actor values.
  if (src.indexOf('function treeApplies') !== -1) { OK('treeApplies turns the tree into values for the client'); }
  else { BAD('nothing turns the tree into anything the character can feel'); }
  if (src.indexOf('treeApplyNow') !== -1 || src.indexOf('panel.effects') !== -1) {
    OK('the client applies them, which is the only way: the server cannot set a base value');
  } else {
    WARN('the client side of the tree was not found from here, check thornswood-front.js');
  }

  /*
    A sub-skill that names nothing to set buys nothing when a point goes into
    it. Read from inside its branch, for the same reason as the count above:
    TREE[k] for a sub-skill was undefined, so every one of them read as naming
    no value and the warning was meaningless.
  */
  let noValue = [];
  keys.forEach(function (k) {
    const part = k.split('.');
    const e = TREE[part[0]].skills[part[1]];
    const av = e && (e.av || e.actorValue || e.values || e.value || e.perk);
    if (!av) { noValue.push(k); }
  });
  if (noValue.length) {
    WARN(noValue.length + ' sub-skill(s) name nothing to set and no perk: ' + noValue.join(', '));
  } else {
    OK('every sub-skill names something to set or a perk to give');
  }
}

// ============================================================ the property ===
head('The property system');

[['BUILDING_BY_DOOR', 'the door table'],
 ['BUILDING_NAME', 'the building names'],
 ['function claim(', 'claiming'],
 ['function giveDeed', 'the deed'],
 ['function setLock', 'locking'],
 ['function mold', 'molding a door'],
 ['function cutKey', 'cutting a key'],
 ['function mayPass', 'who may pass a locked door'],
 ['function evict', 'eviction'],
 ['function isJarlOf', 'the jarl, by the Discord role'],
 ['function isStewardOf', 'the steward, by the Discord role'],
 ['function officeCmd', 'a Jarl giving an office'],
 ['function dropboxCmd', 'the drop box'],
 ['function rentCmd', 'rent'],
 ['function post(', 'posting to a board'],
 ['function take(', "the taker's list"],
 ['function boardHere', 'standing at a board'],
 ['coversGround', 'a house and its farm as one claim']].forEach(function (row) {
  if (src.indexOf(row[0]) !== -1) { OK(row[1] + ' is in'); }
  else { BAD(row[1] + ' is MISSING'); }
});

const doors = readJson('doors.json');
if (doors) {
  const n = doors.buildings ? Object.keys(doors.buildings).length : (doors.count || 0);
  console.log('  doors.json: ' + (doors.doors ? Object.keys(doors.doors).length : '?') +
              ' door(s), ' + n + ' building(s)');
}

// ============================================================== the words ===
head('Every command the server answers');

const words = lift('const WORDS = ') || [];
const listed = Array.isArray(words) ? words : [];
if (listed.length) { OK(listed.length + ' words registered'); }
else { BAD('the word list could not be read'); }

listed.forEach(function (w) {
  // Every registered word has to be answered by something, or it is a word
  // that says "unknown command" while sitting in /help.
  // Either comparison counts. /pick and /spend are answered by a guard written
  // as `word !== '/pick' && word !== '/spend'`, and looking only for === called
  // a command that works perfectly well an unanswered one.
  const lit = "'" + w + "'";
  const answered = src.indexOf('word === ' + lit) !== -1 ||
                   src.indexOf('word !== ' + lit) !== -1;
  if (!answered && VERBOSE) { WARN(w + ' is registered and nothing answers it'); }
  else if (!answered) { WARN(w + ' is registered and nothing answers it'); }
});

// ========================================================== the mini games ===
head('The mini games, and what keeps them working');

if (src.indexOf('function benchGate') !== -1) {
  OK('vanilla benches are gated, so nobody works around the craft rules');
} else {
  BAD('benchGate is missing, so any bench opens for anybody');
}
const front = (function () {
  try { return fs.readFileSync(path.join(HERE, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8'); }
  catch (e) { return ''; }
})();
if (front.indexOf('lockChanged') !== -1) {
  OK('lockpicking: the client hands a picked lock back to the server, so a picked chest can be looted');
} else {
  BAD('nothing hands a picked lock back, so a picked chest cannot be looted');
}
if (src.indexOf('setRaceMenuOpen') !== -1) {
  OK('the race menu is reachable from the server');
} else {
  WARN('nothing opens the race menu from here');
}

// ================================================================= the end ===
console.log('');
console.log('SUMMARY');
console.log('-------');
console.log('  ' + ok + ' ok, ' + warn + ' warning(s), ' + bad + ' failure(s)');
if (notes.length) {
  console.log('');
  console.log('Everything that was not ok:');
  notes.forEach(function (n) { console.log('  ' + n); });
}
console.log('');
console.log('This answers presence, ownership and reachability. Check-Balance.ps1');
console.log('answers whether the ladders line up across classes and professions.');
process.exit(bad ? 1 : 0);
