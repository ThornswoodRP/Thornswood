// test-1648-soulgem-rank.js
//
// The soul gem has a rank (#1648, docs/systems/enchantments.md): Petty from
// novice, Lesser at advanced, Common at expert, Greater, Grand and Black at
// master, in the half that owns the piece. A gem above that is refused and
// the gem and the piece stay in the pack (the engine takes nothing when
// mp.onCraft says no; skymp PR #51 holds that side in unit/CraftTest.cpp). A
// petty gem works at every rank.
//
// soulGemRefusal is cut out of the gamemode as it is and run against stubbed
// records and a stubbed progression block. Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + end.length) : null;
}

const table = slice('var SOUL_GEM_RANK = {', '};\n');
const fn = slice('function soulGemRefusal(actorId, inputs) {', '\n}\n');
const ladder = slice("const RANK_LADDER = [", '];\n');
const rankWordSrc = slice('function rankWord(rank) {', '\n}\n');
const onCraft = slice("mp.onCraft = guard('onCraft', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {", '\n});\n');
yes('the soul gem table and gate are in the gamemode', !!table && !!fn && !!ladder && !!rankWordSrc);
yes('mp.onCraft keeps the signature the other tests cut by', !!onCraft);
yes('mp.onCraft asks the gem gate with the seventh argument before recipelessCraft',
  !!onCraft && /var inputs = arguments\[6\];/.test(onCraft) &&
  onCraft.indexOf('soulGemRefusal(actorId, inputs)') !== -1 &&
  onCraft.indexOf('soulGemRefusal(actorId, inputs)') < onCraft.indexOf('return recipelessCraft(') &&
  /if \(gemNo\) \{[\s\S]*?return false;/.test(onCraft));

// Skyrim.esm records, editor ids as the CK has them.
const RECORDS = {
  0x2e4e2: { type: 'SLGM', editorId: 'SoulGemPetty' },
  0x2e4e3: { type: 'SLGM', editorId: 'SoulGemPettyFilled' },
  0x2e4e4: { type: 'SLGM', editorId: 'SoulGemLesser' },
  0x2e4e6: { type: 'SLGM', editorId: 'SoulGemCommon' },
  0x2e4f4: { type: 'SLGM', editorId: 'SoulGemGreater' },
  0x2e4fb: { type: 'SLGM', editorId: 'SoulGemGreaterFilled' },
  0x2e4fc: { type: 'SLGM', editorId: 'SoulGemGrand' },
  0x2e500: { type: 'SLGM', editorId: 'SoulGemBlack' },
  0x63b27: { type: 'SLGM', editorId: 'AzurasStar' },
  0x1397e: { type: 'WEAP', editorId: 'IronDagger' },
  0x12e49: { type: 'ARMO', editorId: 'ArmorIronCuirass' }
};
const DAGGER = 0x1397e, CUIRASS = 0x12e49;
const RANKS = ['novice', 'advanced', 'expert', 'master'];
let state = null;
const logs = [];
const P = {
  halvesOf: (prof) => prof === 'enchanter' ? ['bladebinder', 'wardweaver'] : [],
  rankOf: (s, h) => (s.ranks && s.ranks[h]) || null,
  canWork: (s, h, r) => {
    const have = (s.ranks && s.ranks[h]) || null;
    if (!have) { return false; }
    return RANKS.indexOf(have) >= RANKS.indexOf(r);
  }
};
const C = { stateOf: () => state, nameOf: (k) => k.charAt(0).toUpperCase() + k.slice(1) };
const mp = { lookupEspmRecordById: (id) => RECORDS[id] ? { record: RECORDS[id] } : null };
const make = new Function('mp', 'globalThis', 'log',
  ladder + '\n' + rankWordSrc + '\n' + table + '\n' + fn + '\nreturn soulGemRefusal;');
const soulGemRefusal = make(mp, { __thornswoodCharacter: C, __thornswoodProgression: P }, (...a) => logs.push(a.join(' ')));

function bladebinder(rank) { return { prof: 'enchanter', half: 'bladebinder', ranks: { bladebinder: rank, wardweaver: 'novice' } }; }
function ask(piece, gem) { return soulGemRefusal(0xff000001, [{ baseId: piece, count: 1 }, { baseId: gem, count: 1 }]); }

// A petty gem works at every rank, empty or filled.
for (const r of RANKS) {
  state = bladebinder(r);
  yes('a petty gem works for a ' + r + ' Bladebinder', ask(DAGGER, 0x2e4e2) === '' && ask(DAGGER, 0x2e4e3) === '');
}

// Each gem at the rank it needs, and refused one rank below.
const NEED = [[0x2e4e4, 'advanced', 'lesser'], [0x2e4e6, 'expert', 'common'], [0x2e4f4, 'master', 'greater'],
  [0x2e4fb, 'master', 'greater'], [0x2e4fc, 'master', 'grand'], [0x2e500, 'master', 'black'], [0x63b27, 'master', 'grand']];
for (const [gem, need, size] of NEED) {
  state = bladebinder(need);
  yes('a ' + size + ' gem (' + gem.toString(16) + ') works for a ' + need + ' Bladebinder', ask(DAGGER, gem) === '');
  const below = RANKS[RANKS.indexOf(need) - 1];
  state = bladebinder(below);
  const no = ask(DAGGER, gem);
  yes('a ' + size + ' gem (' + gem.toString(16) + ') is refused to a ' + below + ' Bladebinder, naming the rank', /soul gem is/.test(no) && no.toLowerCase().indexOf(need) !== -1 && /petty gem works at any rank/.test(no));
}

// The issue's own sentence: a greater gem in a novice's pack.
state = bladebinder('novice');
yes('a greater gem in a novice Bladebinder\'s pack is refused', ask(DAGGER, 0x2e4f4) !== '');

// The half that owns the piece is the one asked: a master Bladebinder with a
// novice sister half cannot put a greater gem into a cuirass.
state = bladebinder('master');
yes('armour is Wardweaver\'s, so a master Bladebinder at novice Wardweaver is refused a greater gem on a cuirass', ask(CUIRASS, 0x2e4f4) !== '');
yes('and the same gem on a dagger works for them', ask(DAGGER, 0x2e4f4) === '');

// Not the gate's business.
state = bladebinder('novice');
yes('no gem in the inputs is not asked', soulGemRefusal(1, [{ baseId: DAGGER, count: 1 }]) === '');
yes('no inputs at all is not asked', soulGemRefusal(1, undefined) === '' && soulGemRefusal(1, null) === '');
state = { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master' } };
yes('somebody with no enchanter half is left to recipelessCraft', ask(DAGGER, 0x2e4f4) === '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);