// test-classes-page.js
//
// The Professions page (site/data/site/classes.md) says what the game does.
//
// WHY. Issue #419. It was filed when the launcher asked for a class, a
// profession and a half and the game did nothing with two of them. That is
// long gone: all three are picked on the K panel, the server holds a class to
// its one verb and a profession's half to what it can make. But the page had
// drifted the other way. It said the three picks could be taken in any order
// and "the third one" ends creation (the town ends it, and the other two can
// wait); it never said a character with no profession is held to nothing at a
// bench, or that one with no class can do none of the five verbs; it said an
// Edgewright cannot make a cuirass, when an iron one is the novice work of
// their sister half; and it promised a free tool when yours runs out, which
// the server stopped doing on 21 September.
//
// Issue #1037, Patrick 29 September: "There should be no grace at all they
// shouldn't be allowed to just make anything because they didn't choose a
// profession." So with no profession the craft gate, the lab and the arcane
// enchanter all refuse and say to press K, and the page and join.md say so.
// Issue #1026: the page says a spell tome teaches only under the Mage rules,
// and the rules it names are the ones learnFromTome runs.
//
// So this reads the gamemode's own tables and runs its own rules, then reads
// the page, and fails when they disagree. Every claim about the game is
// checked against the code that makes it true, not against a sentence copied
// into this harness, so a table that changes under the page fails here.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
function read(rel) {
  return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const gm = process.env.GAMEMODE
  ? require('../../tests/gamemode-tables.js').joined(fs.readFileSync(process.env.GAMEMODE, 'utf8')).split(CR).join('')
  : require('../../tests/gamemode-tables.js').joined(read(path.join('game', 'gamemode.js')));
const page = process.env.CLASSES_MD
  ? fs.readFileSync(process.env.CLASSES_MD, 'utf8').split(CR).join('')
  : read(path.join('site', 'data', 'site', 'classes.md'));
const join = read(path.join('site', 'data', 'site', 'join.md'));
const home = read(path.join('site', 'public', 'home.html'));

/** From a start marker to the first end marker after it, or null. */
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
/** A top level function, from its first line to the brace that closes it. */
function cut(head) { return slice(gm, head, '\n}\n'); }

// Paragraphs joined into one line each, so a sentence that wraps is found.
function flat(md) { return md.replace(/\r/g, '').replace(/([^\n])\n(?=[^\n|#])/g, '$1 '); }
const text = flat(page);

/** One page section, from its heading to the next heading of the same depth. */
function section(md, heading) {
  const a = md.indexOf('\n' + heading + '\n');
  if (a < 0) { return null; }
  const depth = heading.match(/^#+/)[0];
  const re = new RegExp('\\n' + depth + ' ', 'g');
  re.lastIndex = a + heading.length + 1;
  const m = re.exec(md);
  return md.slice(a, m ? m.index : md.length);
}

/** The rows of the first table in a piece of markdown, as arrays of cells. */
function tableRows(md) {
  if (!md) { return []; }
  const lines = md.split('\n');
  const out = [];
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\|/.test(l)) {
      started = true;
      if (/^\|[-| ]+\|$/.test(l)) { continue; }
      out.push(l.split('|').slice(1, -1).map(function (c) { return c.trim(); }));
    } else if (started) {
      break;
    }
  }
  return out.slice(1); // the header row
}
/** Every **bold** phrase in a string, without the stars or a closing full stop. */
function bolds(s) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let m;
  while ((m = re.exec(s)) !== null) { out.push(m[1].replace(/\.$/, '').trim()); }
  return out;
}
function sameSet(a, b) {
  const x = a.slice().sort(), y = b.slice().sort();
  return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
}
const letters = function (s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); };

// ------------------------------------------------------ the rules, running

const block = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
yes('the gamemode has its progression block', block !== null);
if (!block) { done(); }
const box = { console: { log: function () {} } };
box.globalThis = box;
vm.runInNewContext(block, box, { filename: 'gamemode.js progression' });
const P = box.__thornswoodProgression;
yes('and it registers the rules', !!P && !!P.TABLE);
if (!P || !P.TABLE) { done(); }
const T = P.TABLE;

// Recipes and benches, the two generated tables the craft gate reads.
const recSrc = slice(gm, 'var RECIPES_BY_ID = {', ';\n');
let RECIPES = null;
try { RECIPES = recSrc ? new Function('return ' + recSrc.slice('var RECIPES_BY_ID = '.length).replace(/;$/, ''))() : null; }
catch (e) { RECIPES = null; }
yes('the recipe table reads', !!RECIPES && Object.keys(RECIPES).length > 100);
if (!RECIPES) { done(); }
const rows = Object.keys(RECIPES).map(function (k) { return RECIPES[k]; });
function row(name, half) {
  return rows.filter(function (r) { return r.name === name && (!half || r.half === half); })[0] || null;
}

const benchLine = /^const BENCH_ACCESS = (\{.*\});$/m.exec(gm);
let BENCH_ACCESS = null;
try { BENCH_ACCESS = benchLine ? JSON.parse(benchLine[1]) : null; } catch (e) { BENCH_ACCESS = null; }
yes('the bench table reads', !!BENCH_ACCESS && !!BENCH_ACCESS.alchemy && !!BENCH_ACCESS.enchanting);
if (!BENCH_ACCESS) { done(); }

/** The name the rules give a key: a class, a half or a profession. */
function nameOf(key) {
  if (P.has(T.classes, key)) { return T.classes[key].name; }
  for (const p in T.professions) {
    if (P.has(T.professions[p].halves, key)) { return T.professions[p].halves[key]; }
  }
  if (P.has(T.professions, key)) { return T.professions[key].name; }
  return key;
}

// The craft gate and the bench gate, cut out and run against the real rules.
const noProfM = /^const NO_PROFESSION_AT_A_BENCH = '([^']*)';$/m.exec(gm);
const NO_PROFESSION = noProfM ? noProfM[1] : null;
yes('the gamemode has the one no-profession sentence, and it says to press K',
    !!NO_PROFESSION && /Press K/.test(NO_PROFESSION));
const helpers = ['function rankWord(', 'function aWord(', 'function professionName(']
  .map(cut);
const craftSrc = cut('function craftAnswer(');
const benchSrc = cut('function benchGate(');
yes('craftAnswer, benchGate and their helpers are in the gamemode',
    craftSrc !== null && benchSrc !== null && helpers.every(function (h) { return h !== null; }));
if (!craftSrc || !benchSrc) { done(); }
function gates(state) {
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; }, nameOf: nameOf }
  };
  const fn = new Function('globalThis', 'log', 'raceGate', 'NO_PROFESSION_AT_A_BENCH',
                          'BENCH_BY_BASE', 'BENCH_ACCESS', 'benchToolKey', 'toolGate', 'professionOfHalf',
                          helpers.join('\n') + '\n' + craftSrc + '\n' + benchSrc +
                          '\nreturn { craftAnswer: craftAnswer, benchGate: benchGate };');
  const byBase = { lab: 'alchemy', enchanter: 'enchanting' };
  // Everybody here holds their trade's tool (#3162); tests/test-3162-bench-tools.js asks the refusal.
  return fn(g, function () {}, function () { return null; }, NO_PROFESSION, byBase, BENCH_ACCESS,
            function () { return ''; }, function () { return null; }, function () { return ''; });
}
function made(state, r) { return gates(state).craftAnswer(1, r).refusal === null; }
function smith(half, rank) {
  const r = P.pickProfession(P.fresh(), 'smith', half);
  if (r.ok && rank) { r.state.ranks[half] = rank; }
  return r.ok ? r.state : null;
}

// ---------------------------------------------------------- the tables

// Classes.
const classRows = tableRows(section(page, '## Classes'));
const classNames = Object.keys(T.classes).map(function (k) { return T.classes[k].name; });
yes('the Classes table names the five classes the rules have (' + classNames.join(', ') + ')',
    sameSet(classRows.map(function (r) { return bolds(r[0])[0]; }), classNames));
// Each class's row says its one verb, and the rules give it that verb and no other.
const VERB_WORD = { loot: 'loot', fish: 'fish', harvest: 'gather', mine: 'mine', farm: 'farm' };
const verbs = Object.keys(VERB_WORD);
yes('every class verb the rules know has a word on the page',
    verbs.every(function (v) { return !!P.classFor(v); }) && verbs.length === classNames.length);
Object.keys(T.classes).forEach(function (cls) {
  const verb = verbs.filter(function (v) { return P.classFor(v) === cls; });
  const r = classRows.filter(function (x) { return bolds(x[0])[0] === T.classes[cls].name; })[0];
  const s = P.pickClass(P.fresh(), cls).state;
  const only = verbs.filter(function (v) { return P.canDo(s, v); });
  yes('a ' + T.classes[cls].name + ' may ' + (verb[0] || '?') + ' and nothing else of the five, and the page says so',
      verb.length === 1 && sameSet(only, verb) && !!r &&
      new RegExp('\\b' + VERB_WORD[verb[0]], 'i').test(r[1]));
});
// No class: none of the five.
const noClass = verbs.filter(function (v) { return P.canDo(P.fresh(), v); });
const gateSrc = slice(gm, 'function gate(actorId, verb) {', '\n  }\n');
yes('with no class the rules allow none of the five verbs, and the gate says to press K',
    noClass.length === 0 && gateSrc !== null && /if \(!s\.cls\) \{ return NO_CLASS; \}/.test(gateSrc) &&
    /var NO_CLASS = '[^']*Press K/.test(gm));
yes('and the page says a character with no class can do none of them',
    /until you pick one, none of the five is yours/i.test(text) && /press K and choose/i.test(text));

// Professions and their halves.
const profRows = tableRows(section(page, '## Professions'));
const profNames = Object.keys(T.professions).map(function (k) { return T.professions[k].name; });
yes('the Professions table names the eight professions the rules have (' + profNames.join(', ') + ')',
    sameSet(profRows.map(function (r) { return bolds(r[0])[0]; }), profNames));
Object.keys(T.professions).forEach(function (key) {
  const p = T.professions[key];
  const r = profRows.filter(function (x) { return bolds(x[0])[0] === p.name; })[0];
  const want = p.halves ? Object.keys(p.halves).map(function (h) { return p.halves[h]; }) : [];
  yes(p.name + ': the page names the halves the rules have (' + (want.join(' and ') || 'none') + ')',
      !!r && sameSet(bolds(r[1]), want));
});

// Master perks.
const perkRows = tableRows(section(page, '### What Master actually gets you'));
Object.keys(T.professions).forEach(function (key) {
  const p = T.professions[key];
  const r = perkRows.filter(function (x) { return bolds(x[0])[0] === p.name; })[0];
  yes(p.name + '\'s Master perk is ' + p.perk.name + ' on the page too',
      !!r && bolds(r[1])[0] === p.perk.name);
});

// The skill tree.
Object.keys(T.tree).forEach(function (attr) {
  const r = tableRows(section(page, '### ' + T.tree[attr].name));
  const skills = T.tree[attr].skills;
  const onPage = r.map(function (x) { return bolds(x[0])[0]; });
  const inRules = Object.keys(skills).map(function (k) { return skills[k].name; });
  yes(T.tree[attr].name + ': the page lists the five sub-skills the rules have', sameSet(onPage, inRules));
  Object.keys(skills).forEach(function (k) {
    const line = r.filter(function (x) { return bolds(x[0])[0] === skills[k].name; })[0];
    yes('  ' + skills[k].name + ' fills to the perk the rules name (' + skills[k].perk + ')',
        !!line && letters(bolds(line[2])[0]) === skills[k].perk);
  });
});

// Roleplay only.
const rpRows = tableRows(section(page, '## Roleplay only (not Class or Profession)'));
const rpNames = Object.keys(T.rpOnly).map(function (k) { return T.rpOnly[k].name; });
yes('the roleplay only names are the rules\' (' + rpNames.join(', ') + ')',
    sameSet(rpRows.map(function (r) { return bolds(r[0])[0]; }), rpNames));
yes('and none of them can be picked as a class or a profession',
    Object.keys(T.rpOnly).every(function (k) {
      return !P.pickClass(P.fresh(), k).ok && !P.pickProfession(P.fresh(), k, 'x').ok;
    }));

// Ranks.
const rankRows = tableRows(section(page, '## Getting better at it'));
yes('the four ranks, in order, are the rules\' (' + T.ranks.join(', ') + ')',
    rankRows.length === T.ranks.length && rankRows.every(function (r, i) {
      return letters(bolds(r[0])[0]) === T.ranks[i];
    }));

// The Mage and the apprenticeship limits.
const NUM = { 1: 'one', 2: 'two', 3: 'three' };
yes('a mage picks ' + NUM[T.professions.mage.schools] + ' schools',
    new RegExp('picks \\*\\*' + NUM[T.professions.mage.schools] + ' schools\\*\\*').test(text) &&
    !P.pickProfession(P.fresh(), 'mage', ['destruction']).ok &&
    P.pickProfession(P.fresh(), 'mage', ['destruction', 'illusion']).ok);
yes('then ' + NUM[T.limits.mageStartSpells] + ' starting spells',
    new RegExp('\\*\\*' + NUM[T.limits.mageStartSpells] + ' starting spells\\*\\*').test(text));
yes('and a ' + (T.professions.mage.mastered === 3 ? 'third' : '?') + ' school at Master',
    T.professions.mage.mastered === 3 && /At \*\*Master\*\* a mage picks a \*\*third school\*\*/.test(text));
yes('a trade outside your own can be taught ' + (T.limits.secondaries === 2 ? 'twice' : '?'),
    T.limits.secondaries === 2 && /you may only ever do this twice/i.test(text));

// Taking an apprentice (#1592). docs/systems/apprenticeship.md has two
// arrangements, the sister half and an outside trade. The page used to promise
// a third, a faster climb under a Master of your own half, which neither the
// design nor the rules have.
{
  const appr = section(page, '### Taking an apprentice');
  const atext = appr ? flat(appr) : '';
  const mPlate = { prof: 'smith', half: 'platewright', ranks: { platewright: 'master', edgewright: 'novice' } };
  const who = { id: 7, name: 'Eorlund', at: 1 };
  const plateOwn = P.pickProfession(P.fresh(), 'smith', 'platewright').state;
  const ownTake = P.takeOn(plateOwn, mPlate, 'platewright', who);
  yes('a Master of your own half cannot take you on in it (' + (ownTake.why || '?') + ')', !ownTake.ok);
  let alone = plateOwn, under = plateOwn;
  for (let i = 0; i < 40; i++) {
    alone = P.creditWork(alone, 'platewright', null).state;
    under = P.creditWork(under, 'platewright', mPlate).state;
  }
  yes('work in your own half counts the same with a Master handed in or without (' +
      P.workDone(alone, 'platewright') + ' and ' + P.workDone(under, 'platewright') + ')',
      P.workDone(alone, 'platewright') === 40 && P.workDone(under, 'platewright') === 40);
  yes('the page promises no faster climb under a Master',
      !!appr && !/climbs? faster|worth more than|counts? for more/i.test(text));
  yes('it says your own half climbs at the same pace with a Master or without, and a Master of it cannot take you on',
      /Your own half needs nobody/.test(atext) &&
      /same pace with a Master beside you or without one/.test(atext) &&
      /a Master of your own half cannot take you on in it/.test(atext));

  const edge = P.pickProfession(P.fresh(), 'smith', 'edgewright').state;
  const need = P.workNeeded(edge, 'platewright');
  let waiting = edge;
  for (let i = 0; i < need + 40; i++) { waiting = P.creditWork(waiting, 'platewright', null).state; }
  const taken = P.takeOn(waiting, mPlate, 'platewright', who);
  const up = taken.ok ? P.creditWork(taken.state, 'platewright', mPlate) : { ok: false };
  yes('without a Master the sister half stays novice and its count waits at the threshold (' +
      P.workDone(waiting, 'platewright') + ' of ' + need + ')',
      need > 0 && P.rankOf(waiting, 'platewright') === 'novice' && P.workDone(waiting, 'platewright') === need);
  yes('a Master of it takes you on and the next piece raises it',
      taken.ok && up.ok && !!up.raised && up.raised.to === 'advanced');
  yes('the page names the sister half as the first arrangement, waiting at novice until a Master of it takes you on',
      /\*\*The other half of your own profession\.\*\*/.test(atext) &&
      /Without a Master of that half it never leaves novice/.test(atext) &&
      /the next piece raises you, and from there it climbs the whole ladder/.test(atext));
  yes('and an outside trade as the second, and nothing else',
      /\*\*Outside your profession entirely\.\*\*/.test(atext) && !/Inside the same half/i.test(atext));
}

// ---------------------------------------------------- what a half makes

const ironCuirass = row('Iron Armor', 'Platewright');
const steelCuirass = row('Steel Armor', 'Platewright');
yes('the recipe table has the iron and the steel cuirass, both Platewright work',
    !!ironCuirass && !!steelCuirass);
if (!ironCuirass || !steelCuirass) { done(); }
const edge = smith('edgewright');
const edgeMaster = smith('edgewright', 'master');
const plate = smith('platewright', 'advanced');
yes('an Edgewright makes the iron cuirass, novice work of their sister half',
    ironCuirass.rank === 'novice' && made(edge, ironCuirass));
yes('and the page says so',
    /an Edgewright knows how to beat out a plain iron cuirass/i.test(text));
yes('an Edgewright, even at Master, does not make the steel one',
    steelCuirass.rank !== 'novice' && !made(edge, steelCuirass) && !made(edgeMaster, steelCuirass));
yes('and an advanced Platewright does',
    made(plate, steelCuirass));
yes('and the page says a steel cuirass is not novice work, and a Master Edgewright cannot make one',
    /a steel cuirass is not novice work/i.test(text) &&
    /An Edgewright at Master still cannot make a steel cuirass/i.test(text));
// No page says an Edgewright cannot make armour at all, because they can.
const anyArmour = rows.some(function (r) {
  return r.type === 'ARMO' && r.half === 'Platewright' && made(edge, r);
});
[['classes.md', page], ['join.md', join], ['home.html', home]].forEach(function (p) {
  yes(p[0] + ' does not say an Edgewright cannot make armour',
      !(anyArmour && /Edgewright\s+cannot\s+make\s+armou?r/i.test(p[1].replace(/\s+/g, ' '))));
});

// Nobody's work: smelting and tanning are in no half.
const nobodys = ['Iron Ingot', 'Steel Ingot', 'Leather', 'Leather Strips'];
yes('smelting and tanning are Platewright novice work (' + nobodys.join(', ') + ')',
    nobodys.every(function (n) {
      const r = row(n, 'Platewright');
      return !!r && r.half === 'Platewright' && String(r.rank).toLowerCase() === 'novice' && !r.nobody;
    }));
yes('and the page says they are Platewright work, not anybody\'s',
    /Smelting ore into ingots and tanning a hide into leather are Platewright work/i.test(text));

// The two halves that gate nothing.
['bulwark', 'berserker'].forEach(function (h) {
  const n = nameOf(h);
  const owns = rows.some(function (r) { return String(r.half).toLowerCase() === h; });
  const bench = Object.keys(BENCH_ACCESS).some(function (k) { return P.has(BENCH_ACCESS[k].halves, h); });
  yes(n + ' owns no recipe and no bench, as the page says', !owns && !bench &&
      /\*\*Bulwark\*\* and \*\*Berserker\*\*\. Warriors do not make things/.test(text));
});

// The alchemy lab and the arcane enchanter.
[['alchemy', 'alchemy lab', 'alchemist'], ['enchanting', 'arcane enchanter', 'enchanter']].forEach(function (b) {
  const halves = Object.keys(BENCH_ACCESS[b[0]].halves).map(nameOf);
  const want = Object.keys(T.professions[b[2]].halves).map(nameOf);
  const para = (text.split('\n').filter(function (l) { return l.indexOf('**' + b[1] + '**') >= 0; })[0]) || '';
  yes('the ' + b[1] + ' opens for exactly the halves of ' + T.professions[b[2]].name + ' (' + halves.join(', ') + ')',
      sameSet(halves, want) && halves.every(function (h) { return para.indexOf('**' + h + '**') >= 0; }));
});

// No profession: nothing that is somebody's work gets made (#1037).
const newcomer = P.fresh();
const sample = rows.filter(function (r) { return !r.race && !r.nobody; });
const refusedAll = sample.every(function (r) {
  return gates(newcomer).craftAnswer(1, r).refusal === NO_PROFESSION;
});
yes('ISSUE #1037: with no profession the craft gate refuses every owned row (' + sample.length +
    ') with the press K sentence, the steel cuirass included',
    !!NO_PROFESSION && refusedAll && !made(newcomer, steelCuirass));
yes('  and no row lets them through with a note instead',
    sample.every(function (r) { return gates(newcomer).craftAnswer(1, r).note === null; }));
const shutLab = gates(newcomer).benchGate(1, 'lab');
const shutEnch = gates(newcomer).benchGate(1, 'enchanter');
yes('ISSUE #1037: the lab and the arcane enchanter refuse somebody with no profession, with the press K sentence',
    shutLab === NO_PROFESSION && shutEnch === NO_PROFESSION);
yes('  and still refuse an Edgewright, with the bench\'s own sentence',
    gates(edge).benchGate(1, 'lab') !== null && gates(edge).benchGate(1, 'lab') !== NO_PROFESSION);
yes('  and still open for an Alchemist',
    gates(P.pickProfession(P.fresh(), 'alchemist', 'physicker').state).benchGate(1, 'lab') === null);
const craftSrcNoComments = craftSrc.replace(/\/\*[\s\S]*?\*\//g, '');
yes('the grace is gone from the gamemode: no toldCraftingIsComing, no "nothing is stopping you"',
    gm.indexOf('toldCraftingIsComing') === -1 && !/nothing is stopping you/i.test(gm) &&
    /if \(!s\.prof\) \{\s*out\.refusal = NO_PROFESSION_AT_A_BENCH;/.test(craftSrcNoComments));
const recipelessSrc = cut('function recipelessCraft(');
yes('and the brew and enchant gate refuses with the same sentence',
    recipelessSrc !== null && /if \(!s\.prof\) \{[\s\S]{0,120}NO_PROFESSION_AT_A_BENCH[\s\S]{0,400}return false;/.test(recipelessSrc));
yes('the page says nothing that is somebody\'s work is made until you pick a profession, and to press K',
    /Until you pick a profession, you cannot make anything that is somebody's work/i.test(text) &&
    /press K and choose one/i.test(text));
yes('the page no longer promises the old grace',
    !/Until then nothing at a bench is held against you/i.test(text) &&
    !/can make whatever anybody can/i.test(text) &&
    !/can use both, so nobody is shut out/i.test(text) &&
    !/first evening/i.test(text));
yes('and says the lab and the enchanter are shut to somebody with no profession',
    /Somebody who has not chosen a profession yet can use neither/i.test(text));
yes('join.md says you cannot make anything at a bench before a profession, smelting and tanning included',
    /Until you pick a profession you cannot make anything at a bench, smelting and tanning included/i.test(flat(join)));

// Spell tomes (#1026): the page names the three rules learnFromTome runs.
const tomes = section(page, '### Spell tomes');
yes('the page has a Spell tomes section', tomes !== null);
if (tomes) {
  const t = flat(tomes);
  yes('  naming the three rules: a spell point, the rank, a spell from the rank below',
      /\*\*A spell point\*\*/.test(t) && /\*\*The rank\*\*/.test(t) && /\*\*A spell from the rank below\*\*/.test(t));
  yes('  saying the tome is kept and chat says which is missing',
      /you keep the tome/i.test(t) && /says which/i.test(t));
  yes('  and that what a staff binds is not learned this way (#1128)',
      /What a staff binds is not learned this way/i.test(t));
}

// Staff spells (#1128): the page names the three rules pickStaffSpell runs and
// the numbers the rules hold, and the non-Enchanter path.
const staffSec = section(page, '### Staff spells');
yes('the page has a Staff spells section', staffSec !== null);
if (staffSec && P.pickStaffSpell) {
  const t = flat(staffSec);
  const L = T.limits;
  yes('  naming the three rules: a staff spell point, the rank, a staff spell from the rank below',
      /\*\*A staff spell point\*\*/.test(t) && /\*\*The rank\.\*\*/.test(t) && /\*\*A staff spell from the rank below\*\*/.test(t));
  yes('  with the numbers the rules hold: ' + L.enchanterStartStaff + ' to start, one a Bladebinder rank, ' + L.enchanterMasterStaff + ' more at Master',
      new RegExp('starts with ' + NUM[L.enchanterStartStaff]).test(t) && /earns one\s+with every Bladebinder rank/.test(t) &&
      new RegExp(NUM[L.enchanterMasterStaff] + ' more at Master').test(t));
  yes('  no tome for an Enchanter, and Unlock on K', /no tome/i.test(t) && /Press K and open \*\*Staff spells\*\*/.test(t) && /press Unlock/.test(t));
  yes('  and a non-Enchanter: a Master Bladebinder, the tome, ' + NUM[L.outsiderSpells] + ' at most, Novice only',
      /A Master Bladebinder has to teach them first/.test(t) && /from its tome/.test(t) &&
      new RegExp('they hold ' + NUM[L.outsiderSpells] + ' at most, and only Novice ones').test(t));
  const ench = P.pickProfession(P.fresh(), 'enchanter', 'bladebinder').state;
  const rankOfStaff = function (d) { return d === 'n' ? 'novice' : (d === 'a' ? 'advanced' : 'expert'); };
  const e1 = P.pickStaffSpell(ench, { desc: 'e', name: 'Thunderbolt', rank: 'expert' }, rankOfStaff);
  yes('the rules the page names are the rules that run: a new Enchanter asking for an Expert staff spell misses the rank and the one below',
      !e1.ok && sameSet(e1.missing.map(function (m) { return m.what; }), ['level', 'below']));
  const e2 = P.pickStaffSpell(ench, { desc: 'n', name: 'Flames', rank: 'novice' }, rankOfStaff);
  yes('  and unlocks a Novice one, spending a point', e2.ok && P.staffPoints(e2.state) === L.enchanterStartStaff - 1);
}
if (P.learnFromTome) {
  const smithState = smith('edgewright');
  const fireball = P.spellAt('Fireball');
  const tomeNo = P.learnFromTome(smithState, fireball);
  yes('the rules the page names are the rules that run: a Smith reading Fireball misses all three',
      !tomeNo.ok && !!tomeNo.missing && sameSet(tomeNo.missing.map(function (m) { return m.what; }), ['points', 'level', 'below']));
  yes('  and Apprentice and Adept both map to Advanced, as the page says',
      P.rankForLevel(25) === 'advanced' && P.rankForLevel(50) === 'advanced' &&
      P.rankForLevel(75) === 'expert' && P.rankForLevel(100) === 'master' && P.rankForLevel(0) === 'novice');
}

// -------------------------------------------------------- creation

// The home is the pick that ends creation; class and profession can wait.
const ends = slice(gm, 'if (creating && st.home) {', '\n      }\n');
yes('the town is the pick that ends creation',
    ends !== null && /chargen\.arrive\(actorId, st\.home\)/.test(ends) && !/st\.cls|st\.prof/.test(ends.split('clog(')[0]));
[['classes.md', text], ['join.md', flat(join)]].forEach(function (p) {
  yes(p[0] + ' says only the town has to be chosen, and class and profession can wait',
      /Only the town has to be chosen before you leave the hall/i.test(p[1]) &&
      /class and (your )?profession can wait/i.test(p[1]));
  yes(p[0] + ' no longer says the picks go in any order with the last one ending it',
      !/any order/i.test(p[1]) && !/the (third|last) one sends you/i.test(p[1]));
});

// -------------------------------------------------------- the tools

const toolsSrc = slice(gm, 'const TOOLS = {', '\n};\n');
let TOOLS = null;
try { TOOLS = toolsSrc ? new Function('return ' + toolsSrc.slice('const TOOLS = '.length).replace(/;\n$/, ''))() : null; }
catch (e) { TOOLS = null; }
const toolRows = tableRows(section(page, '## The tools'));
yes('the tools table is the gamemode\'s: ' + (TOOLS ? Object.keys(TOOLS).map(function (k) { return k + ' ' + TOOLS[k].name; }).join(', ') : '?'),
    !!TOOLS && sameSet(toolRows.map(function (r) { return letters(bolds(r[0])[0]); }), Object.keys(TOOLS)) &&
    Object.keys(TOOLS).every(function (k) {
      const r = toolRows.filter(function (x) { return letters(bolds(x[0])[0]) === k; })[0];
      return !!r && r[1].toLowerCase().indexOf(TOOLS[k].name.toLowerCase()) >= 0;
    }));
const toolGateSrc = cut('function toolGate(');
const handsOut = toolGateSrc !== null && /offerTool\(/.test(toolGateSrc.replace(/\/\*[\s\S]*?\*\//g, ''));
const usesMatch = /^const TOOL_USES = (\d+);$/m.exec(gm);
yes('the tool gate refuses and hands nothing out (as of this build: ' + !handsOut + ')', toolGateSrc !== null);
yes('the page says what happens with no tool, whichever way the gate answers',
    handsOut ? !/nothing hands you a free one/i.test(text)
             : /nothing hands you a free one/i.test(text) && !/hands you another/i.test(text));
yes('the page gives a tool the uses the gamemode does (' + (usesMatch ? usesMatch[1] : '?') + ')',
    !!usesMatch && (usesMatch[1] === '100' ? /a hundred uses/i.test(text) : text.indexOf(usesMatch[1] + ' uses') >= 0));

done();
