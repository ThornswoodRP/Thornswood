// test-1386-warrior.js
//
// #1386. A kill's piece count is the band on the warrior page: a chicken and a
// dragon are not the same piece, a person killed by a person stays 0, and body
// loot is not a piece more. Bulwark and Berserker maneuvers use the stamina,
// lengths and waits on the page, the sister half and an outside trade get the
// novice row only, and each named maneuver does what the server can make it
// do. The numbers are read off docs/systems/professions/warrior.md and held
// against the code, so a change to either side shows here.
//
// And Patrick's answers of 4 October: every body neither table names has a
// line, and every race in the load order is on one; the strength table wins
// over the hunter list; Break and Wreck wait 8 seconds; the stamina is a
// share of the person's real most, the skill tree's Endurance included; and
// nobody types a maneuver: the maneuver key opens a panel (the front plugin
// and game/ui/thornswood-maneuvers.js) that sends the line.
//
// Read only. Drives the real blocks out of gamemode.js over a fake mp, and
// the page over a fake document.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(root, 'game', 'gamemode.js'), 'utf8')).replace(/\r/g, '');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(root, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}
const page = fs.readFileSync(path.join(root, 'docs', 'systems', 'professions', 'warrior.md'), 'utf8').replace(/\r/g, '');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) { return slice(gm, head, '\n}\n'); }

// ----------------------------------------------------------- the sources --
const progression = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const maneuvers = slice(gm, '// ==== thornswood warrior maneuvers ====', '// ==== end thornswood warrior maneuvers ====');
const killTable = slice(gm, 'const WARRIOR_KILL = {', '\n};');
const kills = ['function warriorRaceBand(', 'function warriorPieces(', 'function raceEdidOf(', 'function killPieces('].map(cut);
const hunts = slice(gm, 'var HUNTS_BY_BASE = {', ';\n');
const racesLine = require('./gamemode-tables.js').lineOf(gm, 'RACES');
const onDeath = slice(gm, "mp.onDeath = guard('onDeath', function (actorId, killerId) {", '\n});');
const credit = cut('function creditWork(actorId, key, n) {');
const withManeuvers = slice(gm, '  function withManeuvers(actorId, base) {', '\n  }\n');
yes('the progression block, the maneuvers block and the kill band are in the gamemode',
  !!progression && !!maneuvers && !!killTable && kills.every(Boolean) && !!hunts && !!racesLine);
yes('mp.onDeath, creditWork and withManeuvers are in the gamemode', !!onDeath && !!credit && !!withManeuvers);
if (!(progression && maneuvers && killTable && kills.every(Boolean) && hunts && racesLine && onDeath && credit && withManeuvers)) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}
const RACES = JSON.parse(racesLine[1]);
function raceDesc(edid) {
  for (const k in RACES.items) { if (RACES.items[k].e === edid) { return k; } }
  return null;
}

// --------------------------------------------------------- the kill band --
function killBox(mp) {
  const box = { mp: mp, console: { log: function () {} } };
  vm.createContext(box);
  vm.runInContext('const RACES = ' + racesLine[1] + ';\n' + hunts + '\n' + killTable + '\n' + kills.join('\n') +
    '\nthis.warriorPieces = warriorPieces; this.killPieces = killPieces; this.raceEdidOf = raceEdidOf;' +
    ' this.WARRIOR_KILL = WARRIOR_KILL; this.HUNTS_BY_BASE = HUNTS_BY_BASE;', box);
  return box;
}
const K = killBox({});

// The page's strength table, read off the page.
const strength = {};
page.split('\n').forEach(function (line) {
  const m = /^\| (Novice|Advanced|Expert|Master animal) \| [^|]+ \| (\d+) \|$/.exec(line);
  if (m) { strength[m[1].split(' ')[0].toLowerCase()] = Number(m[2]); }
});
yes('the page has the four strength rows', Object.keys(strength).length === 4);
yes('each hunter rank is the pieces the page gives it (' + JSON.stringify(strength) + ')',
  ['novice', 'advanced', 'expert', 'master'].every(function (r) { return K.WARRIOR_KILL.byRank[r] === strength[r]; }));

// The page's person-shaped table, read off the page, held against the race
// each word is in Skyrim.
const shaped = {};
page.split('\n').forEach(function (line) {
  const m = /^\| ([A-Za-z ,]+) \| (\d+) \|$/.exec(line);
  if (m && m[1] !== 'What died') {
    m[1].split(',').forEach(function (w) { shaped[w.trim().toLowerCase()] = Number(m[2]); });
  }
});
const RACE_OF = {
  bandit: 'NordRace', guard: 'ImperialRace', forsworn: 'BretonRace', skeleton: 'SkeletonRace',
  draugr: 'DraugrRace', falmer: 'FalmerRace', hagraven: 'HagravenRace',
  giant: 'GiantRace', 'dragon priest': 'DragonPriestRace', centurion: 'DwarvenCenturionRace',
  lurker: 'DLC2LurkerRace', dragon: 'DragonRace'
};
yes('the page names the twelve person-shaped kinds', Object.keys(shaped).length === 12 &&
  Object.keys(RACE_OF).every(function (w) { return shaped[w] > 0; }));
Object.keys(RACE_OF).forEach(function (w) {
  yes('a ' + w + ' (' + RACE_OF[w] + ') is ' + shaped[w] + ' pieces, as the page says',
    !!raceDesc(RACE_OF[w]) && K.warriorPieces('', RACE_OF[w]) === shaped[w]);
});

const chicken = '10929f:Skyrim.esm';
const karhu = '291791:WindhelmSSE.esp';
function onList(name) {
  for (const k in K.HUNTS_BY_BASE) { if (K.HUNTS_BY_BASE[k].name === name) { return k; } }
  return null;
}
yes('the chicken and Karhu are rows on the hunter list',
  K.HUNTS_BY_BASE[chicken] && K.HUNTS_BY_BASE[chicken].rank === 'novice' &&
  K.HUNTS_BY_BASE[karhu] && K.HUNTS_BY_BASE[karhu].rank === 'master');
yes('a chicken is 1 piece', K.warriorPieces(chicken, 'ChickenRace') === 1);
yes('a chicken and a dragon are not the same piece', K.warriorPieces(chicken, 'ChickenRace') !== K.warriorPieces('', 'DragonRace') &&
  K.warriorPieces('', 'DragonRace') === 16);

// Patrick's answer 2: the strength table wins over the hunter list.
const bull = onList('Bull Netch'), betty = onList('Betty Netch'), vale = onList('Vale Sabre Cat');
const snowy = onList('Snowy Sabre Cat'), ice = onList('Ice Wolf');
yes('the rows the two lists disagree on are on the hunter list (bull and betty netch advanced, vale sabre cat novice, ' +
    'snowy sabre cat expert, ice wolf advanced, Karhu master)',
  bull && K.HUNTS_BY_BASE[bull].rank === 'advanced' && betty && K.HUNTS_BY_BASE[betty].rank === 'advanced' &&
  vale && K.HUNTS_BY_BASE[vale].rank === 'novice' && snowy && K.HUNTS_BY_BASE[snowy].rank === 'expert' &&
  ice && K.HUNTS_BY_BASE[ice].rank === 'advanced');
yes('a bull netch and a betty netch are grown netch, 8, not their advanced row',
  K.warriorPieces(bull, 'DLC2NetchRace') === 8 && K.warriorPieces(betty, 'DLC2NetchRace') === 8);
yes('a sabre cat is 2, and a vale sabre cat is at least that: a sabre cat, 2, not its novice row',
  K.warriorPieces('', 'SabreCatRace') === 2 && K.warriorPieces(vale, 'SabreCatRace') === 2);
yes('a snowy sabre cat is a sabre cat, 2, and an ice wolf a wolf, 1',
  K.warriorPieces(snowy, 'SabreCatSnowyRace') === 2 && K.warriorPieces(ice, 'WolfRace') === 1);
yes('Karhu is a bear, 4: the strength table wins over his master row', K.warriorPieces(karhu, 'BearBrownRace') === 4);
yes('a body on the hunter list whose race no line names counts its hunter rank',
  K.warriorPieces(karhu, 'SomeRaceNoPluginHasYet') === 8 && K.warriorPieces(karhu, '') === 8 &&
  K.warriorPieces(bull, '') === 2);
yes('a race no line names, off the hunter list, is the novice line, 1, and so is a race nobody can read',
  K.warriorPieces('', 'SomeRaceNoPluginHasYet') === 1 && K.warriorPieces('', '') === 1);

// The page's strength table and person-shaped table, word for word against
// the code's kinds.
const kindBand = {};
K.WARRIOR_KILL.kinds.forEach(function (row) {
  row[0].split(',').forEach(function (w) { kindBand[w.trim().toLowerCase()] = row[1]; });
});
const strengthWords = {};
page.split('\n').forEach(function (line) {
  const m = /^\| (Novice|Advanced|Expert|Master animal) \| ([^|]+) \| (\d+) \|$/.exec(line);
  if (m) { m[2].split(',').forEach(function (w) { strengthWords[w.trim().toLowerCase()] = Number(m[3]); }); }
});
const pageKinds = Object.assign({}, strengthWords, shaped);
yes('every word on the two tables is a kind in the code, at the page\'s pieces (' + Object.keys(pageKinds).length + ' words)',
  Object.keys(pageKinds).length >= 30 &&
  Object.keys(pageKinds).every(function (w) { return kindBand[w] === pageKinds[w]; }));
yes('and the code has no kind the page does not name',
  Object.keys(kindBand).every(function (w) { return Object.prototype.hasOwnProperty.call(pageKinds, w); }));

// Patrick's answer 1: the bodies neither table names, on the page and in the code.
const unnamedPage = {};
page.split('\n').forEach(function (line) {
  const m = /^\| (\d+), [^|]+ \| ([^|]+) \|$/.exec(line);
  if (m) { m[2].split(',').forEach(function (w) { unnamedPage[w.trim().toLowerCase()] = Number(m[1]); }); }
});
const unnamedCode = {};
K.WARRIOR_KILL.unnamed.forEach(function (row) { unnamedCode[row[0].toLowerCase()] = row; });
yes('the page lists the bodies neither table names (' + Object.keys(unnamedPage).length + ' words)', Object.keys(unnamedPage).length >= 30);
yes('each one is in the code at the page\'s pieces',
  Object.keys(unnamedPage).every(function (w) { return unnamedCode[w] && unnamedCode[w][1] === unnamedPage[w]; }));
yes('and every one in the code is on the page, but the conjured creatures and the races that are not creatures, which the page says in a sentence',
  Object.keys(unnamedCode).every(function (w) {
    return Object.prototype.hasOwnProperty.call(unnamedPage, w) ||
      (w === 'a creature a spell conjures' && /A creature a spell\s+conjures, from any of the magic mods, is 1/.test(page)) ||
      (w === 'a race that is not a creature' && unnamedCode[w][1] === 1);
  }));
[['rieklings of Solstheim', 'DLC2RieklingRace', 1], ['an ash hopper', 'DLC2AshHopperRace', 1],
 ['a spriggan', 'SprigganRace', 2], ['a dwarven spider', 'DwarvenSpiderRace', 2], ['an ice wraith', 'IceWraithRace', 2],
 ['ash spawn', 'DLC2AshSpawnRace', 2], ['a riekling of the riekling people', '1RieklingBlueRace', 2],
 ['a flame atronach', 'AtronachFlameRace', 4], ['a dwarven sphere', 'DwarvenSphereRace', 4],
 ['a gargoyle', 'DLC1GargoyleRace', 4], ['a dremora', 'DremoraRace', 4], ['a snow elf', 'SnowElfRace', 4],
 ['a werewolf', 'WerewolfBeastRace', 8], ['a vampire lord', 'DLC1VampireBeastRace', 8], ['a werebear', 'DLC2WerebearBeastRace', 8]
].forEach(function (c) {
  yes(c[0] + ' (' + c[1] + ') is ' + c[2], !!raceDesc(c[1]) && K.warriorPieces('', c[1]) === c[2]);
});
yes('the riekling people sit with the people\'s line, beside a bandit', K.warriorPieces('', '1RieklingPurpleRace') === K.warriorPieces('', 'NordRace'));
yes('snow elves sit with the falmer, and werewolves and vampire lords with the giants',
  K.warriorPieces('', 'SnowElfRace') === K.warriorPieces('', 'FalmerRace') &&
  K.warriorPieces('', 'WerewolfBeastRace') === K.warriorPieces('', 'GiantRace') &&
  K.warriorPieces('', 'DLC1VampireBeastRace') === K.warriorPieces('', 'GiantRace'));
yes('a giant frostbite spider is a spider, 2, not a giant', K.warriorPieces('', 'FrostbiteSpiderRaceGiant') === 2);
yes('a vampire of the people is still the people line, 2', K.warriorPieces('', 'ImperialRaceVampire') === 2);
yes('the race is matched whatever its case', K.warriorPieces('', 'dragonrace') === 16 && K.warriorPieces('', 'DLC2ASHSPAWNRACE') === 2);
{
  const placed = {};
  const all = K.WARRIOR_KILL.kinds.concat(K.WARRIOR_KILL.unnamed);
  let twice = [];
  all.forEach(function (row) { row[2].forEach(function (e) { const k = e.toLowerCase(); if (placed[k]) { twice.push(e); } placed[k] = row[1]; }); });
  const races = {};
  Object.keys(RACES.items).forEach(function (k) { races[RACES.items[k].e.toLowerCase()] = RACES.items[k].e; });
  const missing = Object.keys(races).filter(function (e) { return !placed[e]; }).map(function (e) { return races[e]; });
  const stray = Object.keys(placed).filter(function (e) { return !races[e]; });
  yes('every race in the load order (' + Object.keys(races).length + ') is on a line' + (missing.length ? ': not ' + missing.join(', ') : ''), missing.length === 0);
  yes('no line names a race the load order does not have' + (stray.length ? ': ' + stray.join(', ') : ''), stray.length === 0);
  yes('no race is on two lines' + (twice.length ? ': ' + twice.join(', ') : ''), twice.length === 0);
  yes('every line is one of the page\'s pieces, 1, 2, 4, 8 or 16',
    all.every(function (row) { return [1, 2, 4, 8, 16].indexOf(row[1]) !== -1; }));
}

// The engine read: the race comes from Actor.GetRace on the dead actor.
function engine(base, raceAnswer) {
  const asked = [];
  const mp = {
    get: function (id, prop) { if (prop === 'baseDesc') { return base; } throw new Error('no ' + prop); },
    getDescFromId: function (id) { return id.toString(16); },
    callPapyrusFunction: function (type, cls, fn, self, args) {
      asked.push(cls + '.' + fn);
      if (raceAnswer instanceof Error) { throw raceAnswer; }
      return raceAnswer;
    }
  };
  const box = killBox(mp);
  return { pieces: box.killPieces(0xff000201), asked: asked };
}
{
  const dragon = engine('dragonbase:Skyrim.esm', { type: 'espm', desc: raceDesc('DragonRace') });
  yes('a body off the list asks the engine its race and a dragon is 16',
    dragon.pieces === 16 && dragon.asked.join() === 'Actor.GetRace');
  const padded = engine('x:Skyrim.esm', { type: 'espm', desc: '00' + raceDesc('DraugrRace') });
  yes('a race descriptor written with leading zeroes is still found (a draugr, 4)', padded.pieces === 4);
  const bear = engine(karhu, { type: 'espm', desc: raceDesc('BearBrownRace') });
  yes('a body on the hunter list asks the engine too, and its race wins: Karhu is 4',
    bear.pieces === 4 && bear.asked.join() === 'Actor.GetRace');
  const blind = engine(karhu, new Error('no race'));
  yes('a body on the hunter list whose race the engine cannot give counts its row: Karhu 8', blind.pieces === 8);
  const broken = engine('x:Skyrim.esm', new Error('no race'));
  yes('a body off the list whose race the engine cannot give is the novice line, 1', broken.pieces === 1);
}

// ------------------------------------------------------------ mp.onDeath --
const NPC = 0xff002001, HUMAN = 0xff000101, OTHER = 0xff000102, BANDIT = 0xff002002;
function deathBox(opts) {
  const states = new Map([
    [NPC, { profileId: -1, baseDesc: opts.base || 'dragonbase:Skyrim.esm' }],
    [BANDIT, { profileId: -1, baseDesc: 'bandit:Skyrim.esm' }],
    [HUMAN, { profileId: 17, baseDesc: 'person:Skyrim.esm' }],
    [OTHER, { profileId: 18, baseDesc: 'person:Skyrim.esm' }]
  ]);
  const credits = [];
  const box = {
    console: { log: function () {} },
    mp: {
      get: function (id, prop) { const s = states.get(id); if (!s) { throw new Error('no actor'); } return s[prop]; },
      set: function () {},
      getDescFromId: function (id) { return id.toString(16); },
      callPapyrusFunction: function () { return { type: 'espm', desc: raceDesc(opts.race || 'DragonRace') }; }
    },
    guard: function (n, fn) { return fn; },
    HUNT_TUNING: { bodySeconds: 300 },
    isCarcass: function () { return false; },
    creditWork: function (id, half, n) { credits.push({ id: id, half: half, n: n }); return null; },
    notify: function () {}, say: function () {}, log: function () {},
    cameInOf: function () { return null; },
    resolveArrival: function () { return null; },
    setTimeout: function () {},
    __thornswoodCharacter: { stateOf: function (id) { return id === HUMAN ? { prof: 'warrior', half: 'berserker' } : { prof: 'cook', half: 'hearthcook' }; } },
    __thornswoodManeuvers: opts.blow ? { killerOf: function () { return opts.blow; } } : undefined
  };
  vm.createContext(box);
  vm.runInContext('const RACES = ' + racesLine[1] + ';\n' + hunts + '\n' + killTable + '\n' + kills.join('\n') + '\n' + onDeath, box);
  return { box: box, credits: credits };
}
{
  const d = deathBox({});
  d.box.mp.onDeath(NPC, HUMAN);
  yes('a warrior killing a dragon is credited 16 pieces, on the half they hold',
    d.credits.length === 1 && d.credits[0].id === HUMAN && d.credits[0].half === 'berserker' && d.credits[0].n === 16);
  const c = deathBox({ base: chicken, race: 'ChickenRace' });
  c.box.mp.onDeath(NPC, HUMAN);
  yes('a warrior killing a chicken is credited 1 piece', c.credits.length === 1 && c.credits[0].n === 1);
  const p = deathBox({});
  p.box.mp.onDeath(OTHER, HUMAN);
  yes('a person killed by a person is credited nothing', p.credits.length === 0);
  const n = deathBox({});
  n.box.mp.onDeath(NPC, BANDIT);
  yes('a kill by somebody who is not a person is credited nothing', n.credits.length === 0);
  const s = deathBox({});
  s.box.mp.onDeath(NPC, NPC);
  yes('a body that killed itself is credited nothing', s.credits.length === 0);
  const t = deathBox({});
  t.box.mp.onDeath(NPC, OTHER);
  yes('a killer who is not a warrior is credited nothing', t.credits.length === 0);
  const b = deathBox({ blow: HUMAN });
  b.box.mp.onDeath(NPC, 0);
  yes('a body the server\'s own maneuver blow killed is still the warrior\'s kill',
    b.credits.length === 1 && b.credits[0].id === HUMAN && b.credits[0].n === 16);
  const z = deathBox({});
  z.box.mp.onDeath(NPC, 0);
  yes('a death with no killer and no maneuver blow is credited nothing', z.credits.length === 0);
}

// ---------------------------------------------------------- creditWork n --
function creditBox(bonus) {
  const calls = { credit: 0, worked: 0 };
  const box = {
    console: { log: function () {} }, log: function () {}, notify: function () {}, say: function () {},
    __thornswoodNeeds: { worked: function () { calls.worked++; return null; } },
    __thornswoodSocial: { workBonus: function () { return bonus; } },
    __thornswoodCharacter: { credit: function () { calls.credit++; return calls.credit === 3 ? 'You are now an advanced Berserker.' : null; } }
  };
  vm.createContext(box);
  vm.runInContext('const PARTY_BANK = {};\n' + credit + '\nthis.creditWork = creditWork; this.PARTY_BANK = PARTY_BANK;', box);
  return { box: box, calls: calls };
}
{
  const one = creditBox(1);
  one.box.creditWork(5, 'berserker');
  yes('work with no count is one piece, as every trade passes it', one.calls.credit === 1 && one.calls.worked === 1);
  const dragon = creditBox(1);
  const line = dragon.box.creditWork(5, 'berserker', 16);
  yes('a 16 piece kill counts 16 pieces and costs one swing of rest', dragon.calls.credit === 16 && dragon.calls.worked === 1);
  yes('and the line about a rank reached on one of those pieces still comes back', line === 'You are now an advanced Berserker.');
  const party = creditBox(1.15);
  party.box.creditWork(5, 'berserker', 16);
  yes('with the party in the cell, 15% of 16 is two whole pieces paid and 0.4 banked',
    party.calls.credit === 18 && Math.abs(party.box.PARTY_BANK[5] - 0.4) < 1e-9);
}

// ------------------------------------------------- the maneuvers, pure part --
const clock = { t: 1000000 };
const world = { actors: new Map(), calls: [], staggers: [], writes: [], timers: [] };
// An actor may carry its own descriptor, the way another character loaded at
// the same ID has one (#2069).
function desc(id) { const a = world.actors.get(id); return (a && a.desc) || id.toString(16) + ':run'; }
function actor(id, o) {
  world.actors.set(id, Object.assign({ pid: id > 0xff000000 && id < 0xff001000 ? id - 0xff000000 : -1, dead: false,
    p: { health: 1, magicka: 1, stamina: 1 }, max: 100, pos: [0, 0, 0], cell: 'cell:Skyrim.esm', anim: null,
    race: '13746:Skyrim.esm', base: '7:Skyrim.esm', online: true }, o || {}));
  return id;
}
const SPELL = 0x5ee;
/*
  The records the engine works the most stamina out of (GetBaseActorValues):
  a race whose DATA starts it at 50 at byte 44, and a base whose ACBS adds 50
  at byte 6, so 100, the way a person starts. And a race and a base whose two
  numbers come to nothing, which the engine makes 100.
*/
const NORD = 0x13746, PERSON_BASE = 0x7, ZERO_RACE = 0x99001, ZERO_BASE = 0x99002;
function raceData(start) { const b = Buffer.alloc(104); b.writeFloatLE(start, 44); return new Uint8Array(b); }
function acbs(offset) { const b = Buffer.alloc(24); b.writeInt16LE(offset, 6); return new Uint8Array(b); }
const RECORDS = {};
RECORDS[NORD] = { type: 'RACE', fields: [{ type: 'EDID', data: new Uint8Array(4) }, { type: 'DATA', data: raceData(50) }] };
RECORDS[PERSON_BASE] = { type: 'NPC_', fields: [{ type: 'ACBS', data: acbs(50) }] };
RECORDS[ZERO_RACE] = { type: 'RACE', fields: [{ type: 'DATA', data: raceData(0) }] };
RECORDS[ZERO_BASE] = { type: 'NPC_', fields: [{ type: 'ACBS', data: acbs(0) }] };
const effectsMaps = new Map();
const mpFake = {
  getActorRuntimeIdentity: function(id) {
    const a=world.actors.get(id);
    if (!a) throw new Error('no actor');
    return String(1+(a.runtime || 0));
  },
  getNpcAIState: function(id) {
    const a=world.actors.get(id);
    return a ? {isHuman:a.pid>0,profileId:a.pid,lifeGeneration:a.life || 0,runtimeLifeIdentity:String(1+(a.body || 0))} : null;
  },
  get: function (id, prop) {
    if (id === 0 && prop === 'onlinePlayers') {
      return Array.from(world.actors.keys()).filter(function (k) { return world.actors.get(k).pid > 0; });
    }
    const a = world.actors.get(id);
    if (!a) { throw new Error('no actor ' + id); }
    if (prop === 'percentages') { return Object.assign({}, a.p); }
    if (prop === 'pos') { return a.pos.slice(); }
    if (prop === 'worldOrCellDesc') { return a.cell; }
    if (prop === 'isDead') { return a.dead; }
    if (prop === 'profileId') { return a.pid; }
    if (prop === 'lastAnimEvent') { return a.anim; }
    if (prop === 'baseDesc') { return a.base; }
    if (prop === 'isOnline') { return a.online; }
    throw new Error('no ' + prop);
  },
  set: function (id, prop, v) {
    const a = world.actors.get(id);
    if (prop === 'percentages') {
      world.calls.push('set percentages ' + id.toString(16));
      a.p = { health: v.health, magicka: v.magicka, stamina: v.stamina };
      if (v.health === 0) { a.dead = true; }
    }
  },
  getDescFromId: desc,
  getIdFromDesc: function (d) { return parseInt(String(d).split(':')[0], 16); },
  lookupEspmRecordById: function (id) {
    if (Object.prototype.hasOwnProperty.call(RECORDS, id)) { return { record: RECORDS[id] }; }
    if (id === 0x55555) { return {}; }
    return { record: { type: id === SPELL ? 'SPEL' : 'WEAP', fields: [] } };
  },
  callPapyrusFunction: function (type, cls, fn, self, args) {
    world.calls.push(cls + '.' + fn);
    if (fn === 'GetRace') { return { type: 'espm', desc: world.actors.get(parseInt(self.desc, 16)).race }; }
    if (fn === 'DamageActorValue') {
      const a = world.actors.get(parseInt(self.desc, 16));
      a.p.stamina = Math.max(0, a.p.stamina - args[1] / a.max);
    }
    if (fn === 'SendAnimationEvent') { world.staggers.push(parseInt(args[0].desc, 16)); }
    return null;
  }
};
const states = new Map();
const party = { leader: 1, members: [] };
const box = {
  MERCHANT_TRADING: require('../game/merchant-trading'),
  console: { log: function () {} },
  Buffer: Buffer,
  mp: mpFake,
  guard: function (n, fn) { return fn; },
  setTimeout: function (fn, ms) { world.timers.push({ fn: fn, at: clock.t + (ms || 0) }); return world.timers.length; },
  setInterval: function () { return 1; },
  clearInterval: function () {},
  __thornswoodCharacter: {
    stateOf: function (id) { return states.get(id) || null; },
    writeState: function (id, s, redraw) {
      world.writes.push({ id: id, redraw: redraw, effects: box.__thornswoodManeuvers.effects(id),
                          view: box.__thornswoodManeuvers.view(id, s) });
      return s;
    },
    effectsOf: function (id) { return effectsMaps.get(id) || {}; }
  },
  __thornswoodSocial: {
    profileOf: function (id) { const a = world.actors.get(id); return a && a.pid > 0 ? a.pid : 0; },
    partyOf: function (pid) { return party.members.indexOf(pid) !== -1 ? party : null; },
    nameOfPerson: function (id) { return 'Person ' + (id - 0xff000000); }
  }
};
box.globalThis = box;
vm.createContext(box);
box.__clock = clock;
vm.runInContext('Date.now = function () { return __clock.t; };', box);
vm.runInContext(progression, box);
vm.runInContext(maneuvers, box);
const P = box.__thornswoodProgression;
const M = box.__thornswoodManeuvers;
yes('the maneuvers block registered', !!M && !!M.use && !!M.hit && !!M.held);
yes('and it registered the OnHit handler', typeof box.mp['onPapyrusEvent:OnHit'] === 'function');

// The page's maneuver table, held against the block's.
function secondsOf(text) {
  const m = /^(\d+) (second|seconds|minute|minutes)$/.exec(text.trim());
  if (!m) { return null; }
  return Number(m[1]) * (m[2].indexOf('minute') === 0 ? 60 : 1);
}
const rows = [];
page.split('\n').forEach(function (line) {
  const c = line.split('|').slice(1, -1).map(function (x) { return x.trim(); });
  if (c.length === 6 && (c[0] === 'Bulwark' || c[0] === 'Berserker')) { rows.push(c); }
});
yes('the page has eight maneuver rows', rows.length === 8);
rows.forEach(function (c) {
  const key = c[2].toLowerCase();
  const m = M.MANEUVERS[key];
  const lasts = /(?:for|within) (\d+) seconds/.exec(c[3]);
  yes(c[2] + ' is ' + c[0] + ' at ' + c[1] + ', ' + c[4] + ' stamina, a ' + c[5] + ' wait' +
      (lasts ? ', ' + lasts[1] + ' seconds long' : ', waiting for its blow'),
    !!m && m.half === c[0].toLowerCase() && m.rank === c[1].toLowerCase() &&
    m.stamina === Number(c[4]) && m.cooldown === secondsOf(c[5]) &&
    m.seconds === (lasts ? Number(lasts[1]) : 0));
});
yes('there are no maneuvers past the table', Object.keys(M.MANEUVERS).length === 8 && M.ORDER.length === 8);
yes('Cover and Wall take 20% off, within 3 metres', M.MANEUVERS.cover.less === 0.2 && M.MANEUVERS.wall.less === 0.2 &&
  M.MANEUVERS.cover.metres === 3 && M.MANEUVERS.wall.metres === 3);
yes('Rush is +4 speed, Heavy 25% more, Wreck 50% more', M.MANEUVERS.rush.speed === 4 &&
  M.MANEUVERS.heavy.more === 0.25 && M.MANEUVERS.wreck.more === 0.5);

function warrior(half, rank, sisterRank) {
  const s = P.pickProfession(P.fresh(), 'warrior', half).state;
  s.ranks[half] = rank;
  if (sisterRank) { s.ranks[P.sisterOf('warrior', half)] = sisterRank; }
  return s;
}
function keys(o) { return Object.keys(o).sort().join(','); }
yes('a novice Bulwark holds Set', keys(M.held(warrior('bulwark', 'novice'), false)) === 'set');
yes('an expert Bulwark holds Set, Plant and Cover', keys(M.held(warrior('bulwark', 'expert'), false)) === 'cover,plant,set');
yes('a master Berserker holds Rush, Heavy, Break and Wreck',
  keys(M.held(warrior('berserker', 'master'), false)) === 'break,heavy,rush,wreck');
yes('the sister half has no maneuver until a Warlord has taken you on',
  keys(M.held(warrior('bulwark', 'master'), false)) === 'cover,plant,set,wall');
yes('once taken on, the sister half is the novice row only, even past novice',
  keys(M.held(warrior('bulwark', 'master', 'expert'), M.takenOn(warrior('bulwark', 'master', 'expert')))) === 'cover,plant,rush,set,wall');
yes('a sister half at novice reads as not taken on, past novice as taken on',
  M.takenOn(warrior('bulwark', 'novice')) === false && M.takenOn(warrior('bulwark', 'novice', 'advanced')) === true);
box.__thornswoodCharacter.masterFor = function (id, s, half) { return id === 77 && half === 'berserker' ? { ranks: { berserker: 'master' } } : null; };
yes('a sister half at novice whose Master\'s record stands (/apprentice, #1388) is taken on',
  M.takenOn(warrior('bulwark', 'novice'), 77) === true && M.takenOn(warrior('bulwark', 'novice'), 78) === false);
delete box.__thornswoodCharacter.masterFor;
const master = warrior('berserker', 'master');
const cookTaught = P.teach(P.pickProfession(P.fresh(), 'cook', 'hearthcook').state, master, 'berserker');
yes('a Warlord can teach a cook Berserker as an outside trade', cookTaught.ok);
yes('an outside trade is the novice row and no further', keys(M.held(cookTaught.state, false)) === 'rush');
yes('a cook nobody taught holds nothing', keys(M.held(P.pickProfession(P.fresh(), 'cook', 'hearthcook').state, false)) === '');

// ------------------------------------------------- the maneuvers, in use --
const BUL = actor(0xff000001), BER = actor(0xff000002, { pos: [3000, 0, 0] }), FRIEND = actor(0xff000003, { pos: [100, 0, 0] });
const STRANGER = actor(0xff000004, { pos: [0, 120, 0] });
const FAR = actor(0xff000005, { pos: [400, 0, 0] });
const COOK = actor(0xff000006, { pos: [5000, 0, 0] });
const WOLF = actor(0xff002101, { pid: -1, pos: [50, 50, 0] });
states.set(BUL, warrior('bulwark', 'master'));
states.set(BER, warrior('berserker', 'master'));
states.set(COOK, cookTaught.state);
states.set(FRIEND, P.pickProfession(P.fresh(), 'cook', 'hearthcook').state);
party.members = [1, 3, 5];

function later(ms) {
  clock.t += ms;
  world.timers.sort(function (a, b) { return a.at - b.at; });
  while (world.timers.length && world.timers[0].at <= clock.t) { world.timers.shift().fn(); }
  M.tick();
}
function strike(by, target, took, opts) {
  opts = opts || {};
  box.mp['onPapyrusEvent:OnHit'](target, { type: 'form', desc: desc(by) },
    { type: 'espm', desc: (opts.spell ? SPELL : 0x1f4).toString(16) + ':Skyrim.esm' }, null,
    !!opts.power, false, false, !!opts.blocked);
  // The engine's own damage, after the event, the way OnWeaponHit runs.
  const a = world.actors.get(target);
  a.p.health = Math.max(0, a.p.health - took);
  if (a.p.health === 0) { a.dead = true; }
}
function settle() { later(0); }
function health(id) { return Math.round(world.actors.get(id).p.health * 10000) / 10000; }
function heal(id) { const a = world.actors.get(id); a.p.health = 1; a.dead = false; }

yes('/maneuver on its own lists what you hold, and tells nobody to type anything', /^Your maneuvers: Rush \(15 stamina, ready\)/.test(M.use(BER, '')) &&
  !/\//.test(M.use(BER, '')));
yes('a name that is not a maneuver is refused by name', /no maneuver by that name/.test(M.use(BER, 'fireball')));
yes('a cook taught Berserker is refused Heavy, and told the novice row is the whole of it',
  /outside trade, and that is its novice row and no further: Rush/.test(M.use(COOK, 'heavy')));
yes('a cook taught Berserker is refused a Bulwark maneuver', /Set is a Bulwark maneuver/.test(M.use(COOK, 'set')));
yes('a master Bulwark is refused Rush until a Warlord takes them on', /sister half\. Its novice maneuver opens when a Warlord takes you on/.test(M.use(BUL, 'rush')));
states.set(0xff000007, warrior('berserker', 'novice'));
actor(0xff000007, { pos: [9000, 0, 0] });
yes('a novice Berserker is refused Heavy by rank', M.use(0xff000007, 'heavy') === 'Heavy is for an advanced Berserker. You are a novice Berserker.');

// Stamina.
world.actors.get(BER).p.stamina = 0.1;
const callsBefore = world.calls.length;
const tooTired = M.use(BER, 'rush');
yes('without 15 stamina Rush does not start, and says so', /takes 15 stamina, and you do not have it\. Nothing happens\./.test(tooTired));
yes('and nothing is written to the stamina: it is not taken and put back, it is never taken',
  world.actors.get(BER).p.stamina === 0.1 && world.calls.slice(callsBefore).indexOf('set percentages ' + BER.toString(16)) === -1 &&
  world.calls.slice(callsBefore).indexOf('Actor.DamageActorValue') === -1);
yes('and nothing is armed and no wait starts', !M.effects(BER) && /Rush \(15 stamina, ready\)/.test(M.use(BER, '')));
world.actors.get(BER).p.stamina = 1;
const rush = M.use(BER, 'rush');
yes('Rush starts: +4 speed for 5 seconds', rush === 'Rush: +4 speed for 5 seconds.');
yes('Rush spent 15 of the 100 the engine works out from the race and the base, as a share written back',
  Math.abs(world.actors.get(BER).p.stamina - 0.85) < 1e-6 && M.mostStamina(BER) === 100);
yes('Rush puts +4 speed on the map the client sets, and redraws to send it',
  M.effects(BER) && M.effects(BER).speedMult === 4 && world.writes.length === 1 && world.writes[0].redraw === true &&
  world.writes[0].effects.speedMult === 4);
yes('Rush again at once waits its 30 seconds', /Rush is ready again in 30 seconds\./.test(M.use(BER, 'rush')));
later(5100);
yes('after 5 seconds the speed comes off and the client is told', !M.effects(BER) && world.writes.length === 2 && world.writes[1].effects === null);
later(25000);
yes('after the 30 seconds Rush can start again', M.use(BER, 'rush') === 'Rush: +4 speed for 5 seconds.');
later(6000);

// Heavy.
world.actors.get(BER).p.stamina = 1;
yes('Heavy starts', /Heavy\. Your next power attack in the next 8 seconds deals 25% more\./.test(M.use(BER, 'heavy')));
strike(BER, WOLF, 0.2, {});
settle();
yes('a hit that is not a power attack is not Heavy and does not spend it', health(WOLF) === 0.8);
strike(BER, WOLF, 0.2, { power: true, spell: true });
settle();
yes('a spell is not a power attack either', health(WOLF) === 0.6);
heal(WOLF);
strike(BER, WOLF, 0.2, { power: true });
settle();
yes('the power attack takes a quarter again of what it took: 0.2 becomes 0.25', health(WOLF) === 0.75);
strike(BER, WOLF, 0.2, { power: true });
settle();
yes('and Heavy is spent: the next power attack is only itself', health(WOLF) === 0.55);
heal(WOLF);
later(45000);
M.use(BER, 'heavy');
strike(BER, WOLF, 0, { power: true });
settle();
strike(BER, WOLF, 0.2, { power: true });
settle();
yes('a power attack the engine threw away (it took nothing) leaves Heavy armed for the next', health(WOLF) === 0.75);
heal(WOLF);
later(45000);
M.use(BER, 'heavy');
later(8100);
strike(BER, WOLF, 0.2, { power: true });
settle();
yes('after 8 seconds Heavy has run out', health(WOLF) === 0.8);
heal(WOLF);

// Two hits on one body in one turn: each is measured on its own.
later(45000);
M.use(BER, 'heavy');
strike(BER, WOLF, 0.2, { power: true });
strike(FRIEND, WOLF, 0.2, {});
settle();
yes('a Heavy blow and somebody else\'s blow in the same moment: only the Heavy one is a quarter again', health(WOLF) === 0.55);
heal(WOLF);

// Wreck and Break, and the stagger.
world.actors.get(BER).p.stamina = 1;
yes('Wreck starts', /^Wreck\. Your next power attack in the next 8 seconds deals 50% more/.test(M.use(BER, 'wreck')));
strike(BER, STRANGER, 0.2, { power: true });
settle();
yes('the Wreck power attack takes a half again: 0.2 becomes 0.3', health(STRANGER) === 0.7);
yes('and staggers the person it lands on, in their own game', world.staggers.length === 1 && world.staggers[0] === STRANGER);
heal(STRANGER);
world.actors.get(BER).p.stamina = 1;
M.use(BER, 'break');
strike(BER, WOLF, 0.1, {});
settle();
yes('Break: the next hit on a creature does its damage and no stagger is sent', world.staggers.length === 1 && health(WOLF) === 0.9);
heal(WOLF);
later(60000);
world.actors.get(BER).p.stamina = 1;
M.use(BER, 'break');
strike(BER, STRANGER, 0.1, {});
settle();
yes('Break: the next hit on a person staggers them', world.staggers.length === 2 && world.staggers[1] === STRANGER);
heal(STRANGER);

// Plant refuses the stagger the server sends.
world.actors.get(BUL).p.stamina = 1;
world.actors.get(BER).p.stamina = 1;
later(60000);
const plantWrites = world.writes.length;
yes('Plant starts and says nothing staggers you', /^Plant, for 8 seconds\. Nothing staggers you\./.test(M.use(BUL, 'plant')));
{
  // The view the front reads says Plant is on, with its length (#1386).
  const w = world.writes.slice(plantWrites).filter(function (x) { return x.id === BUL; });
  const row = w.length ? (w[w.length - 1].view || []).filter(function (r) { return r.key === 'plant'; })[0] : null;
  yes('starting Plant redraws the view with Plant on, for 8 seconds', !!row && row.on === true && row.seconds === 8);
}
M.use(BER, 'break');
strike(BER, BUL, 0.1, {});
settle();
yes('a Break on a planted Bulwark sends no stagger', world.staggers.length === 2);
heal(BUL);
{
  const before = world.writes.length;
  later(8100);
  const w = world.writes.slice(before).filter(function (x) { return x.id === BUL; });
  const row = w.length ? (w[w.length - 1].view || []).filter(function (r) { return r.key === 'plant'; })[0] : null;
  yes('when Plant ends the view is redrawn with it off', !!row && !row.on && row.seconds === 8);
}

// A Wreck blow that kills is still the berserker's kill.
later(120000);
world.actors.get(BER).p.stamina = 1;
M.use(BER, 'wreck');
world.actors.get(WOLF).p.health = 0.3;
strike(BER, WOLF, 0.2, { power: true });
settle();
yes('a Wreck half again that takes health to nothing kills', world.actors.get(WOLF).dead === true && health(WOLF) === 0);
yes('and mp.onDeath is told whose blow it was', M.killerOf(WOLF) === BER && M.killerOf(WOLF) === 0);

// Unshakeable (#1385): nothing staggers its holder while they block, the
// server's own Break and Wreck included. The block is the IsBlocking their
// own game sends with every movement, asked of the engine.
{
  const fired = [];
  const asked = [];
  box.__thornswoodPerks = {
    holds: function (id, key) { return key === 'unshakeable' && id === STRANGER; },
    fired: function (id, key, more) { fired.push(key + ' ' + id.toString(16) + ' ' + more); }
  };
  const was = mpFake.callPapyrusFunction;
  mpFake.callPapyrusFunction = function (type, cls, fn, self, args) {
    if (fn === 'GetAnimationVariableBool') {
      asked.push(cls + '.' + fn + ' ' + args[0]);
      return !!world.actors.get(parseInt(self.desc, 16)).blocking;
    }
    return was.apply(this, arguments);
  };
  const breakOn = function (target) {
    later(200000);
    world.actors.get(BER).p.stamina = 1;
    M.use(BER, 'break');
    const before = world.staggers.length;
    strike(BER, target, 0.1, {});
    settle();
    heal(target);
    return world.staggers.length - before;
  };
  world.actors.get(STRANGER).blocking = true;
  yes('a Break on somebody who holds Unshakeable and is blocking sends no stagger', breakOn(STRANGER) === 0);
  yes('the engine was asked for IsBlocking, and the perks block logs it fired',
    asked.indexOf('ObjectReference.GetAnimationVariableBool IsBlocking') !== -1 &&
    fired.length === 1 && /^unshakeable ff000004 \(a Break or Wreck, while blocking\)$/.test(fired[0]));
  world.actors.get(STRANGER).blocking = false;
  yes('with the block down the Break staggers them', breakOn(STRANGER) === 1 && fired.length === 1);
  world.actors.get(FRIEND).blocking = true;
  yes('somebody blocking who does not hold Unshakeable is staggered', breakOn(FRIEND) === 1);
  delete box.__thornswoodPerks;
  mpFake.callPapyrusFunction = was;
  world.actors.get(STRANGER).blocking = false;
  world.actors.get(FRIEND).blocking = false;
}

// ------------------------------------------- a replaced target (#2069) --
// A queued Wreck, a Wall's reduction and a stagger belong to the body they
// were queued on. A new life or another descriptor at the same ID before the
// flush is left alone, and the Wreck it spent comes back.
// The native life of whoever is at an ID (#2069). A replacement is a new
// life, or another descriptor at the same ID.
if (!mpFake.getNpcAIState) {
  mpFake.getNpcAIState = function (id) {
    const a = world.actors.get(id);
    return a ? { isHuman: a.pid > 0, profileId: a.pid, lifeGeneration: a.life || 0 } : null;
  };
}
function replaced(id, how) {
  const a = world.actors.get(id);
  if (how === 'life') { a.life = (a.life || 0) + 1; }
  else if (how === 'body') { a.body = (a.body || 0) + 1; }
  else { a.desc = 'other' + id.toString(16) + ':run'; }
  // Its health is what the engine left at the ID, as in the issue: the
  // queued effect is all that could still move it.
}
function restored(id) { const a = world.actors.get(id); delete a.desc; }
{
  const PERSON = actor(0xff000062, { pos: [9000, 100, 0] });
  for (const [name, target] of [['person', PERSON], ['creature', WOLF]]) {
    for (const how of ['life', 'desc', 'body']) {
      later(200000);
      const by = actor(0xff000063, { pos: [9000, 0, 0] });
      states.set(by, warrior('berserker', 'master'));
      world.actors.get(by).p.stamina = 1; M.use(by, 'wreck'); heal(target);
      const staggers = world.staggers.length;
      strike(by, target, 0.2, { power: true });
      replaced(target, how);
      settle();
      yes('T1 a Wreck queued on a ' + name + ' does not land on a replacement (' + how + ')',
          health(target) === 0.8 && world.staggers.length === staggers);
      restored(target);
      heal(target);
      strike(by, target, 0.2, { power: true });
      settle();
      yes('T1 and the Wreck it spent comes back for the next power attack in its window', health(target) === 0.7);
    }
    later(200000);
    const by = actor(0xff000064, { pos: [9000, 0, 0] });
    states.set(by, warrior('berserker', 'master'));
    world.actors.get(by).p.stamina = 1; M.use(by, 'wreck'); heal(target);
    strike(by, target, 0.2, { power: true });
    settle();
    yes('T2 on the same ' + name + ' it still lands: 0.2 becomes 0.3', health(target) === 0.7);
    for (const how of ['life','body']) {
      later(200000);
      world.actors.get(by).p.stamina = 1; M.use(by, 'wreck'); heal(target); world.actors.get(target).p.health = 0.22;
      strike(by, target, 0.2, { power: true });
      settle();
      replaced(target, how);
      yes('T3 the fallback killer of a ' + name + ' is not named for a replacement '+how, M.killerOf(target) === 0);
    }
    later(200000);
    world.actors.get(by).p.stamina = 1; M.use(by, 'wreck'); heal(target); world.actors.get(target).p.health = 0.22;
    strike(by, target, 0.2, { power: true });
    settle();
    yes('T3 and is named for the life it killed', world.actors.get(target).dead === true && M.killerOf(target) === by);
    heal(target);
  }
  // A Wall's reduction is the defender's, and stays with the defender's life.
  for (const how of ['life', 'desc', 'body']) {
    later(200000);
    const wall = actor(0xff000065, { pos: [9000, 0, 0] });
    states.set(wall, warrior('bulwark', 'master'));
    world.actors.get(wall).p.stamina = 1;
    M.use(wall, 'wall');
    strike(WOLF, wall, 0.5, {});
    replaced(wall, how);
    settle();
    yes('T4 a Wall reduction queued for a defender is not given to a replacement (' + how + ')', health(wall) === 0.5);
    restored(wall);
    heal(wall);
  }
  later(200000);
  const wall = actor(0xff000066, { pos: [9000, 0, 0] });
  states.set(wall, warrior('bulwark', 'master'));
  world.actors.get(wall).p.stamina = 1;
  M.use(wall, 'wall');
  strike(WOLF, wall, 0.5, {});
  settle();
  yes('T5 on the same defender the Wall still takes 20% off: 0.5 becomes 0.4', health(wall) === 0.6);
}
heal(WOLF);

// Wall.
later(200000);
world.actors.get(BUL).p.stamina = 1;
yes('Wall starts', /^Wall, for 10 seconds\./.test(M.use(BUL, 'wall')));
yes('Wall spent 40 stamina', Math.abs(world.actors.get(BUL).p.stamina - 0.6) < 1e-9);
strike(WOLF, BUL, 0.5, {});
settle();
yes('the Bulwark takes 20% less: 0.5 becomes 0.4', health(BUL) === 0.6);
strike(WOLF, FRIEND, 0.5, {});
settle();
yes('a party member within 3 metres takes 20% less', health(FRIEND) === 0.6);
strike(WOLF, STRANGER, 0.5, {});
settle();
yes('somebody within 3 metres who is not in the party does not', health(STRANGER) === 0.5);
strike(WOLF, FAR, 0.5, {});
settle();
yes('a party member further than 3 metres does not', health(FAR) === 0.5);
[BUL, FRIEND, STRANGER, FAR].forEach(heal);
later(10100);
strike(WOLF, BUL, 0.5, {});
settle();
yes('after 10 seconds the Wall is down', health(BUL) === 0.5);
heal(BUL);

// Cover.
later(200000);
world.actors.get(BUL).p.stamina = 1;
const cover = M.use(BUL, 'cover');
yes('Cover is on the nearest person within 3 metres', cover === 'Cover on Person 3, for 8 seconds. While you block within 3 metres of them, they take 20% less damage.');
strike(WOLF, FRIEND, 0.5, {});
settle();
yes('while the Bulwark is not blocking, Cover gives nothing', health(FRIEND) === 0.5);
heal(FRIEND);
world.actors.get(BUL).anim = 'blockStart';
later(100);
world.actors.get(BUL).anim = null;
strike(WOLF, FRIEND, 0.5, {});
settle();
yes('while the Bulwark blocks, the covered person takes 20% less, and moving does not forget the block', health(FRIEND) === 0.6);
strike(WOLF, STRANGER, 0.5, {});
settle();
yes('Cover is for one person: somebody else beside them gets nothing', health(STRANGER) === 0.5);
heal(FRIEND); heal(STRANGER);
world.actors.get(BUL).anim = 'blockStop';
later(100);
strike(WOLF, FRIEND, 0.5, {});
settle();
yes('once the block drops, Cover gives nothing again', health(FRIEND) === 0.5);
heal(FRIEND);
world.actors.get(BUL).p.stamina = 1;
later(100000);
const alone = actor(0xff000008, { pos: [20000, 0, 0] });
states.set(alone, warrior('bulwark', 'expert'));
const staminaAlone = world.actors.get(alone).p.stamina;
yes('Cover with nobody within 3 metres is refused before any stamina is spent',
  M.use(alone, 'cover') === 'Cover is for one person within 3 metres of you, and nobody is.' &&
  world.actors.get(alone).p.stamina === staminaAlone);

// A block costs stamina, and Set halves it (Patrick's A of 12 October). The
// game's own rule: 0 plus 0.25 of what the block stopped, and the engine lets
// a blocked hit through at a tenth, so 2 health through is 18 stopped and
// 4.5 stamina. The person's most health and stamina are both 100 here.
function stamina(id) { return Math.round(world.actors.get(id).p.stamina * 100000) / 100000; }
yes('the block rule is the game\'s: nothing to start, a quarter of what was stopped, a tenth through, Set halves',
  M.BLOCK.base === 0 && M.BLOCK.perStopped === 0.25 && M.BLOCK.through === 0.1 && M.BLOCK.set === 0.5);
heal(BUL);
world.actors.get(BUL).p.stamina = 1;
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('a blocked hit that let 2 health through costs 4.5 stamina', stamina(BUL) === 0.955 && health(BUL) === 0.98);
strike(WOLF, BUL, 0.02, {});
settle();
yes('the same hit not blocked costs no stamina', stamina(BUL) === 0.955);
const blockCalls = world.calls.length;
strike(WOLF, BUL, 0, { blocked: true });
settle();
yes('a blocked hit the engine threw away costs nothing and writes nothing',
  stamina(BUL) === 0.955 && world.calls.slice(blockCalls).indexOf('set percentages ' + BUL.toString(16)) === -1);
strike(WOLF, BUL, 0.02, { blocked: true, spell: true });
settle();
yes('a blocked spell costs no stamina: the engine\'s spell damage has no block in it', stamina(BUL) === 0.955);
heal(WOLF);
world.actors.get(WOLF).p.stamina = 1;
strike(BUL, WOLF, 0.02, { blocked: true });
settle();
yes('a creature that blocks pays nothing: the answer was for a person', world.actors.get(WOLF).p.stamina === 1);
heal(WOLF);
heal(BUL);

// A broken arm makes a block cost twice the stamina (docs/systems/injury.md,
// #1383), read off the injury block's record of which limb is broken.
yes('a broken arm doubles a block\'s charge', M.BLOCK.brokenArm === 2);
const hurtSeen = [];
box.__thornswoodHurt = {
  read: function (id) { hurtSeen.push(id); return { id: id }; },
  limbsOf: function (rec) { return { arm: rec.id === BUL ? 1 : 0, leg: 0 }; }
};
world.actors.get(BUL).p.stamina = 1;
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('with a broken arm the same blocked hit costs 9 stamina, twice the 4.5', stamina(BUL) === 0.91 && hurtSeen.indexOf(BUL) !== -1);
box.__thornswoodHurt.limbsOf = function () { return { arm: 0, leg: 1 }; };
heal(BUL);
world.actors.get(BUL).p.stamina = 1;
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('a broken leg leaves the block\'s charge as it was', stamina(BUL) === 0.955);
delete box.__thornswoodHurt;
heal(WOLF);
heal(BUL);

// Set.
world.actors.get(BUL).p.stamina = 1;
yes('Set starts and says a block costs half the stamina',
  M.use(BUL, 'set') === 'Set, for 8 seconds. A block costs you half the stamina.' && stamina(BUL) === 0.85);
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('while Set runs, the same blocked hit costs 2.25 stamina', stamina(BUL) === 0.8275);
strike(WOLF, BUL, 0.04, { blocked: true });
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('two blocked hits before the engine is done are each measured, and each is halved', stamina(BUL) === 0.76);
later(8100);
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('after 8 seconds Set is over and a block costs the whole 4.5 again', stamina(BUL) === 0.715);
heal(BUL);

// The real most: the skill tree's Endurance counts, and it stops at nothing.
effectsMaps.set(BUL, { stamina: 100 });
world.actors.get(BUL).p.stamina = 1;
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('with 100 more stamina from the skill tree, 4.5 is a smaller share of the bar', stamina(BUL) === 0.9775);
effectsMaps.delete(BUL);
heal(BUL);
world.actors.get(BUL).p.stamina = 0.01;
strike(WOLF, BUL, 0.1, { blocked: true });
settle();
yes('a block with too little stamina left takes it to nothing, and the hit still came through at a tenth',
  stamina(BUL) === 0 && health(BUL) === 0.9);
heal(BUL);
world.actors.get(BUL).p.stamina = 1;
// A blocked hit on somebody under a Wall still pays for the block, on what
// the engine took, before the Wall gives its fifth back.
later(200000);
yes('Wall starts again', /^Wall, for 10 seconds\./.test(M.use(BUL, 'wall')) && stamina(BUL) === 0.6);
strike(WOLF, BUL, 0.02, { blocked: true });
settle();
yes('under a Wall the block is paid on what the engine took, and the fifth comes back',
  stamina(BUL) === 0.555 && health(BUL) === 0.984);
later(11000);
heal(BUL);
world.actors.get(BUL).p.stamina = 1;
world.actors.get(BUL).dead = true;
later(50000);
yes('nobody starts a maneuver while down', M.use(BUL, 'set') === 'Not while you are down.');
world.actors.get(BUL).dead = false;

// The sister half through /apprentice.
box.__thornswoodCharacter.masterFor = function (id, s, half) { return id === BUL && half === 'berserker' ? {} : null; };
later(100000);
world.actors.get(BUL).p.stamina = 1;
yes('once a Warlord has taken a Bulwark on (/apprentice), Rush, the sister half\'s novice row, starts',
  M.use(BUL, 'rush') === 'Rush: +4 speed for 5 seconds.');
yes('and Heavy, past the novice row, does not',
  /sister half, and a sister half has its novice row and no more: Rush/.test(M.use(BUL, 'heavy')));
delete box.__thornswoodCharacter.masterFor;
later(6000);

// Patrick's answer 3: Break and Wreck wait 8 seconds for their blow.
later(200000);
world.actors.get(BER).p.stamina = 1;
yes('Break says its 8 seconds', /^Break\. Your next hit in the next 8 seconds staggers a person/.test(M.use(BER, 'break')));
later(8100);
{
  const before = world.staggers.length;
  strike(BER, STRANGER, 0.1, {});
  settle();
  yes('a hit 8 seconds after Break is only a hit: no stagger', world.staggers.length === before);
}
heal(STRANGER);
world.actors.get(BER).p.stamina = 1;
yes('Wreck says its 8 seconds', /^Wreck\. Your next power attack in the next 8 seconds deals 50% more/.test(M.use(BER, 'wreck')));
later(8100);
{
  const before = world.staggers.length;
  strike(BER, STRANGER, 0.2, { power: true });
  settle();
  yes('a power attack 8 seconds after Wreck is only itself: 0.2 stays 0.2, and no stagger',
    health(STRANGER) === 0.8 && world.staggers.length === before);
}
heal(STRANGER);
later(200000);
world.actors.get(BER).p.stamina = 1;
M.use(BER, 'break');
strike(BER, WOLF, 0, {});
settle();
later(3000);
world.actors.get(BER).p.stamina = 1;
M.use(BER, 'wreck');
strike(BER, STRANGER, 0, { power: true });
settle();
strike(BER, STRANGER, 0.2, { power: true });
settle();
yes('a Wreck blow the engine threw away leaves Wreck armed inside its window', health(STRANGER) === 0.7);
heal(STRANGER);
later(200000);
world.actors.get(BER).p.stamina = 1;
M.use(BER, 'wreck');
strike(BER, STRANGER, 0, { power: true });
later(8100);
strike(BER, STRANGER, 0.2, { power: true });
settle();
yes('and not once the window has shut', health(STRANGER) === 0.8);
heal(STRANGER);

// Patrick's answer 5: the stamina scales with the skill tree.
later(200000);
effectsMaps.set(BER, { stamina: 30, speedMult: 2 });
world.actors.get(BER).p.stamina = 1;
yes('with 3 points in Endurance the most is 130: the engine\'s 100 and the tree\'s 30', M.mostStamina(BER) === 130);
M.use(BER, 'rush');
yes('so Rush takes 15 of 130, a smaller share of a bigger bar', Math.abs(world.actors.get(BER).p.stamina - (1 - 15 / 130)) < 1e-6);
later(200000);
world.actors.get(BER).p.stamina = 20 / 130;
yes('20 of 130 left is enough for Rush', M.use(BER, 'rush') === 'Rush: +4 speed for 5 seconds.' &&
  Math.abs(world.actors.get(BER).p.stamina - 5 / 130) < 1e-6);
later(200000);
world.actors.get(BER).p.stamina = 14 / 130;
yes('14 of 130 is not', /takes 15 stamina, and you do not have it/.test(M.use(BER, 'rush')) &&
  Math.abs(world.actors.get(BER).p.stamina - 14 / 130) < 1e-9);
effectsMaps.set(BER, { stamina: 30 - 40 });
world.actors.get(BER).p.stamina = 1;
yes('what hunger, thirst, tiredness and cold take off is off the most too: 100 + 30 - 40 is 90', M.mostStamina(BER) === 90);
M.use(BER, 'rush');
yes('and Rush takes 15 of 90', Math.abs(world.actors.get(BER).p.stamina - (1 - 15 / 90)) < 1e-6);
later(200000);
effectsMaps.set(BER, { stamina: -100 });
world.actors.get(BER).p.stamina = 1;
yes('a most the needs have taken all of has nothing to spend', /takes 15 stamina, and you do not have it/.test(M.use(BER, 'rush')) &&
  world.actors.get(BER).p.stamina === 1);
effectsMaps.delete(BER);
{
  const z = actor(0xff000009, { pos: [30000, 0, 0], race: ZERO_RACE.toString(16) + ':Skyrim.esm', base: ZERO_BASE.toString(16) + ':Skyrim.esm' });
  states.set(z, warrior('berserker', 'novice'));
  yes('a race and base that come to nothing are 100, the way the engine floors them', M.mostStamina(z) === 100);
  const lost = actor(0xff00000a, { pos: [40000, 0, 0], race: '55555:Skyrim.esm' });
  states.set(lost, warrior('berserker', 'novice'));
  const callsBefore2 = world.calls.length;
  yes('a race record that cannot be read starts nothing, says so, and writes nothing',
    /^Your stamina could not be read just now, so Rush did not start\./.test(M.use(lost, 'rush')) &&
    world.calls.slice(callsBefore2).indexOf('set percentages ' + lost.toString(16)) === -1 &&
    !M.effects(lost) && /Rush \(15 stamina, ready\)/.test(M.use(lost, '')));
}
yes('the stamina is never taken through Actor.DamageActorValue any more', world.calls.indexOf('Actor.DamageActorValue') === -1);

// The panel the maneuver key opens: the view.
later(200000);
{
  const v = M.view(BER, states.get(BER));
  yes('a master Berserker\'s panel lists Rush, Heavy, Break and Wreck, in the page\'s order, with their stamina',
    !!v && v.map(function (r) { return r.key + ':' + r.stamina; }).join() === 'rush:15,heavy:20,break:25,wreck:40' &&
    v.every(function (r) { return r.ready === true && typeof r.name === 'string'; }));
  yes('somebody who holds none has no rows', M.view(FRIEND, states.get(FRIEND)) === null && M.view(1, null) === null);
  yes('a cook taught Berserker has the novice row', M.view(COOK, states.get(COOK)).map(function (r) { return r.key; }).join() === 'rush');
  world.actors.get(BER).p.stamina = 1;
  const writes = world.writes.length;
  M.use(BER, 'heavy');
  const after = world.writes.slice(writes);
  yes('starting one redraws the panel, and that row shows waiting',
    after.length === 1 && after[0].redraw === true &&
    after[0].view.filter(function (r) { return r.key === 'heavy'; })[0].ready === false &&
    after[0].view.filter(function (r) { return r.key === 'rush'; })[0].ready === true);
  later(44000);
  yes('nothing redraws while the wait runs', world.writes.length === writes + 1);
  later(1100);
  const end = world.writes.slice(writes + 1);
  yes('the end of the 45 second wait redraws it once, ready again',
    end.length === 1 && end[0].id === BER && end[0].view.filter(function (r) { return r.key === 'heavy'; })[0].ready === true);
  later(1000);
  yes('and then nothing more', world.writes.length === writes + 2);
  world.actors.get(BER).p.stamina = 1;
  M.use(BER, 'heavy');
  world.actors.get(BER).online = false;
  const gone = world.writes.length;
  later(46000);
  yes('a wait that ends after somebody left redraws nothing for them', world.writes.length === gone);
  world.actors.get(BER).online = true;
}

// ------------------------------------------------ the panel's effects map --
{
  const fn = new Function('g', withManeuvers + '\nreturn withManeuvers;')({ __thornswoodManeuvers: { effects: function (id) { return id === 1 ? { speedMult: 4 } : null; } } });
  const out = fn(1, { speedMult: 2, health: 10 });
  yes('Rush adds to the speed the tree already sends rather than replacing it', out.speedMult === 6 && out.health === 10);
  yes('with nothing running the map is left as it was', fn(2, { speedMult: 2 }).speedMult === 2);
  yes('the panel view folds the maneuvers in', /effects: withManeuvers\(actorId, withNeeds\(actorId, P\.treeApplies\(s\)\)\),/.test(gm));
}

// ------------------------------------------- the view and the stamina map --
{
  yes('the panel view carries the maneuver rows', /\n      maneuvers: maneuversView\(actorId, s\),\n/.test(gm));
  yes('the character block hands out the map the client applies, for the real most',
    /acceptApprentice: acceptApprentice, masterFor: masterFor, effectsOf: effectsOf,/.test(gm));
  const effectsOf = slice(gm, '  function effectsOf(actorId) {', '\n  }\n');
  const maneuversView = slice(gm, '  function maneuversView(actorId, s) {', '\n  }\n');
  const logged = [];
  const fn = new Function('g', 'P', 'stateOf', 'withNeeds', 'withManeuvers', 'clog', 'withPerks', 'withCollege',
    effectsOf + '\n' + maneuversView + '\nreturn { effectsOf: effectsOf, maneuversView: maneuversView };');
  const C = fn({ __thornswoodManeuvers: { view: function (id, s) { if (id === 9) { throw new Error('boom'); } return id === 1 ? [{ key: 'rush' }] : null; } } },
    { treeApplies: function (s) { return { stamina: 10 * s.endurance }; } },
    function (id) { return { endurance: id }; },
    function (id, base) { return Object.assign({}, base, { stamina: base.stamina - 20 }); },
    function (id, base) { return base; },
    function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); },
    function (id, base) { return Object.assign({}, base, { DestructionMod: 100 }); },
    function (id, base) { return base; });
  yes('the map is the tree, less the needs, with a running perk on top: the same fold forPanel makes',
    C.effectsOf(3).stamina === 10 && C.effectsOf(3).DestructionMod === 100);
  yes('and forPanel still folds it that way round, so the two agree',
    gm.indexOf('view.effects = withPerks(actorId, view.effects);') > gm.indexOf('effects: withManeuvers(actorId, withNeeds(actorId, P.treeApplies(s))),'));
  yes('the rows come from the maneuvers block, absent for somebody who holds none',
    C.maneuversView(1, {})[0].key === 'rush' && C.maneuversView(2, {}) === null);
  yes('a view that throws is logged, not hidden', C.maneuversView(9, {}) === null && logged.length === 1 && /maneuvers view threw/.test(logged[0]));
}

// ------------------------------------------------- the front plugin's half --
const front = fs.readFileSync(path.join(root, 'game', 'plugins', 'thornswood-front.js'), 'utf8').replace(/\r/g, '');
const overlay = fs.readFileSync(path.join(root, 'game', 'ui', 'thornswood-maneuvers.js'), 'utf8').replace(/\r/g, '');
const ini = fs.readFileSync(path.join(root, 'launcher', 'Thornswood.ini'), 'utf8').replace(/\r/g, '');
const settingsPage = fs.readFileSync(path.join(root, 'game', 'ui', 'thornswood-settings.js'), 'utf8').replace(/\r/g, '');
{
  yes('the maneuver key is 9, scan code 10, in the plugin, the template and Settings in the game',
    /(?:const|let) MANEUVER_KEY = iniNumber\(ini, 'ManeuverKey', 10\);/.test(front) && /^ManeuverKey = 10$/m.test(ini) &&
    /\{ ini: 'ManeuverKey', def: 10,/.test(settingsPage));
  const overlays = /const OVERLAYS = (\[[\s\S]*?\]);/.exec(front);
  yes('the front fetches the maneuver panel with the other overlays',
    !!overlays && new Function('return ' + overlays[1])().indexOf('thornswood-maneuvers.js') !== -1);
  yes('the cap closes it like every other panel', /maneuvers: 'thornswoodManeuvers'/.test(slice(front, 'const CAP_CLOSES = {', '};') || ''));
  yes('the key is heard in the world, and the panel\'s open and close move the claim',
    /if \(e\.code === MANEUVER_KEY\) \{ maneuverKeyPressed\(\); return; \}/.test(front) &&
    /if \(what === 'maneuvers:opened'\) \{ T\.claimFocus\('maneuvers', true\); return; \}/.test(front) &&
    /if \(what === 'maneuvers:closed'\) \{ T\.claimFocus\('maneuvers', false\); return; \}/.test(front));
  yes('the rows are read off the same view the tree hand reads',
    /treeFromView\(what\.slice\(12\)\);\n\s+maneuversFromView\(what\.slice\(12\)\);/.test(front));
  yes('the front sends no /maneuver line of its own: the page does, on a pick',
    front.indexOf("'/maneuver") === -1 && front.indexOf('"/maneuver') === -1);

  const parts = ['  function maneuversToPage() {', '  function maneuversFromView(json) {', '  function maneuverKeyPressed() {']
    .map(function (h) { return slice(front, h, '\n  }\n'); });
  yes('the front\'s three maneuver functions are there', parts.every(Boolean));
  const env = { js: [], notes: [], busy: '', creating: false, claims: {} };
  const F = new Function('T', 'MANEUVER_NAME', 'claims', 'busyMenuOpen', 'note', 'say', 'env',
    'var skillsCreating = false;\nfunction plantSeen() { }\n' + parts.join('\n') +
    '\nreturn { fromView: maneuversFromView, key: function () { skillsCreating = env.creating; return maneuverKeyPressed(); }, rows: function () { return maneuverRows; } };'
    .replace('return {', 'var maneuverRows = [];\nreturn {'))(
    { js: function (src) { env.js.push(src); return true; } }, '9', env.claims,
    function () { return env.busy; }, function (t) { env.notes.push(t); }, function () {}, env);
  F.key();
  yes('with no rows the key says there are none and opens nothing', env.notes.length === 1 && /no maneuvers/.test(env.notes[0]) && env.js.length === 0);
  F.fromView(JSON.stringify({ v: 1, panel: { maneuvers: [{ key: 'rush', name: 'Rush', stamina: 15, cooldown: 30, ready: true },
    { key: 'bad key', name: 'x' }, null] } }));
  yes('a view\'s rows are kept, the malformed ones dropped, and handed to the page with the key\'s name',
    F.rows().length === 1 && F.rows()[0].key === 'rush' && env.js.length === 1 &&
    /thornswoodManeuvers\.setRows\(\[\{"key":"rush"/.test(env.js[0]) && /,"9"\);/.test(env.js[0]));
  F.fromView(JSON.stringify({ v: 1, panel: { maneuvers: [{ key: 'rush', name: 'Rush', stamina: 15, cooldown: 30, ready: true }] } }));
  yes('the same rows again are not sent again', env.js.length === 1);
  F.key();
  yes('with rows the key opens the panel', /thornswoodManeuvers\.open\(\)/.test(env.js[env.js.length - 1]));
  const n = env.js.length;
  env.claims.chat = true; F.key(); env.claims.chat = false;
  env.busy = 'InventoryMenu'; F.key(); env.busy = '';
  env.creating = true; F.key(); env.creating = false;
  yes('not while typing, over a game menu, or while the character is being made', env.js.length === n);
}

// ----------------------------------------------------- the page's half --
{
  function el(tag) {
    return { tag: tag, style: {}, children: [], className: '', innerHTML: '', id: '', attrs: {}, parentNode: null,
      appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
      addEventListener: function (t, f) { this.on = this.on || {}; this.on[t] = f; },
      getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; } };
  }
  const docOn = {};
  const told = [], said = [];
  const win = { skyrimPlatform: { sendMessage: function (a, b) { if (a === 'thornswood-front') { told.push(b); } } },
                thornswoodNet: { say: function (l) { said.push(l); } } };
  const doc = { head: el('head'), body: el('body'), createElement: el, addEventListener: function (t, f) { docOn[t] = f; } };
  const pageBox = { window: win, document: doc };
  vm.createContext(pageBox);
  vm.runInContext(overlay, pageBox);
  const W = win.thornswoodManeuvers;
  yes('the page says it is in', !!W && told[0] === 'maneuvers:ready');
  W.open();
  yes('with no rows it does not open', !W.isOpen() && told.length === 1);
  W.setRows([{ key: 'set', name: 'Set', stamina: 15, cooldown: 45, ready: true },
             { key: 'plant', name: 'Plant', stamina: 20, cooldown: 60, ready: false }], '9');
  W.open();
  const box2 = doc.body.children[0];
  yes('it opens and says so, and draws each row with its number, its stamina and whether it is ready',
    W.isOpen() && told[1] === 'maneuvers:opened' && /<span class="key">1<\/span><span class="name">Set<\/span><span class="cost">15 stamina<\/span><span class="ready">ready/.test(box2.innerHTML) &&
    /<span class="key">2<\/span><span class="name">Plant<\/span><span class="cost">20 stamina<\/span><span class="wait">waiting/.test(box2.innerHTML));
  yes('and names the keys that close it', /9 or Escape closes this/.test(box2.innerHTML));
  let prevented = 0;
  docOn.keydown({ key: '2', preventDefault: function () { prevented++; } });
  yes('a number sends that row as the panel\'s line and closes the panel',
    said.length === 1 && said[0] === '/maneuver plant' && !W.isOpen() && told[2] === 'maneuvers:closed' && prevented === 1);
  docOn.keydown({ key: '1', preventDefault: function () { prevented++; } });
  yes('with the panel shut a number is left alone', said.length === 1 && prevented === 1);
  W.toggle();
  docOn.keydown({ key: '7', preventDefault: function () {} });
  yes('a number with no row sends nothing', said.length === 1 && W.isOpen());
  docOn.keydown({ key: '9', preventDefault: function () {} });
  yes('the maneuver key closes it', !W.isOpen() && said.length === 1);
  W.open();
  docOn.keydown({ key: 'Escape', preventDefault: function () {} });
  yes('Escape closes it', !W.isOpen() && said.length === 1);
  W.open();
  const row = el('div'); row.attrs['data-n'] = '0'; row.parentNode = box2;
  const inner = el('span'); inner.parentNode = row;
  box2.on.click({ target: inner });
  yes('a click on a row sends it', said.length === 2 && said[1] === '/maneuver set' && !W.isOpen());
  W.open();
  W.setRows([], '9');
  yes('rows taken away close an open panel', !W.isOpen());
  W.setRows([{ key: 'set', name: 'Set', stamina: 15, cooldown: 45, ready: true }], '9');
  W.open();
  delete win.thornswoodNet;
  docOn.keydown({ key: '1', preventDefault: function () {} });
  yes('with the chat\'s socket not up it sends nothing and says so', said.length === 2 && told[told.length - 2] === 'social:unavailable');
  yes('the page sends only /maneuver lines', (overlay.match(/thornswoodNet\.say\(/g) || []).length === 1 &&
    /thornswoodNet\.say\('\/maneuver ' \+ r\.key\)/.test(overlay));
}

// ------------------------------------------------------ words and handlers --
{
  const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const W = words ? new Function('return ' + words[1])() : [];
  yes('/maneuver is a word the server answers, for the panel to send', W.indexOf('/maneuver') !== -1);
  const pw = /const PLAYER_WORDS = (\[[\s\S]*?\]);/.exec(gm);
  const PW = pw ? new Function('return ' + pw[1])() : [];
  yes('and not one anybody is told about (Patrick, 4 October: no chat commands for what people do)',
    !!pw && PW.indexOf('/maneuver') === -1);
  // The help is a panel since #1633: its Work topic, as a fresh install reads it.
  const helpWork = helpTopic('work');
  yes('the help names the maneuver key, not the line it sends',
    !!helpWork && helpWork.indexOf('/maneuver') === -1 && /maneuvers open on 9\./.test(helpWork));
  yes('the chat router hands /maneuver to the maneuvers block', /if \(word === '\/maneuver'\) \{[\s\S]{0,400}mvs\.use\(actorId, parts\[1\]\)/.test(gm));
  const reg = gm.split('\n').filter(function (l) { return /^mp\['onPapyrusEvent:OnHit'\]\s*=/.test(l); });
  yes('OnHit is registered once, through guard()', reg.length === 1 && reg[0].indexOf("guard('onPapyrusEvent:OnHit', function") !== -1);
  const body = slice(gm, "mp['onPapyrusEvent:OnHit'] = guard(", '\n});');
  yes('and it never answers false', !!body && !/\breturn\s+false\b/.test(body));
}

// --------------------------------------- a restart while Rush runs (#1642) --
/*
  Rush's speed rides the K panel's view and ends on a timer in memory. A
  restart takes the timer with it, and the server that comes up has nothing
  running, so the view it works out when the person is back (arrival in the
  character block, tests/test-1642-effects-restart.js) has no speed on it.
*/
{
  const RUSHER = actor(0xff00000b, { pos: [7000, 0, 0] });
  states.set(RUSHER, warrior('berserker', 'novice'));
  yes('Rush starts, with the speed on the map', M.use(RUSHER, 'rush') === 'Rush: +4 speed for 5 seconds.' &&
    M.effects(RUSHER).speedMult === 4);
  later(2000);
  world.timers.length = 0;   // the process's timers go with it
  const again = {
    console: { log: function () {} },
    Buffer: Buffer,
    mp: Object.assign({}, mpFake),
    guard: function (n, fn) { return fn; },
    setTimeout: function (fn, ms) { world.timers.push({ fn: fn, at: clock.t + (ms || 0) }); return world.timers.length; },
    setInterval: function () { return 1; },
    clearInterval: function () {},
    __thornswoodCharacter: box.__thornswoodCharacter,
    __thornswoodSocial: box.__thornswoodSocial
  };
  again.globalThis = again;
  vm.createContext(again);
  again.__clock = clock;
  vm.runInContext('Date.now = function () { return __clock.t; };', again);
  vm.runInContext(progression, again);
  vm.runInContext(maneuvers, again);
  const M2 = again.__thornswoodManeuvers;
  yes('a restart two seconds in ends it: the new server puts no speed on any view it works out',
    !!M2 && M2.effects(RUSHER) === null);
  yes('and clears its wait, as the page says', /Rush \(15 stamina, ready\)/.test(M2.use(RUSHER, '')));
}

for (const field of ['pid', 'life', 'runtime', 'unreadable']) {
  later(200000);
  const defender = actor(0xff000050);
  const by = actor(0xff000051);
  states.set(defender, warrior('bulwark', 'master'));
  M.use(defender, 'wall');
  const readIdentity = mpFake.getNpcAIState;
  if (field === 'unreadable') {
    mpFake.getNpcAIState = function (id) { return id === by ? null : readIdentity(id); };
  }
  strike(by, defender, 0.5, {});
  if (field !== 'unreadable') { world.actors.get(by)[field] = (world.actors.get(by)[field] || 0) + 1; }
  settle();
  mpFake.getNpcAIState = readIdentity;
  yes('Wall remains on the defender when attacker identity is ' + field, health(defender) === 0.6);
}

for (const field of ['pid','life','runtime']) {
  const by=actor(0xff000040+['pid','life','runtime'].indexOf(field));
  states.set(by,warrior('berserker','master'));
  yes('Wreck is armed before the '+field+' damage regression',/^Wreck/.test(M.use(by,'wreck')));heal(WOLF);
  strike(by,WOLF,0.2,{power:true});
  world.actors.get(by)[field]=(world.actors.get(by)[field] || 0)+1;
  settle();
  yes('maneuver damage refuses attacker '+field+' replacement before flush',health(WOLF)===0.8);
}
for (const field of ['life','runtime']) {
  const by=actor(0xff000044+['life','runtime'].indexOf(field));
  states.set(by,warrior('berserker','master'));
  yes('Wreck is armed before the '+field+' fallback regression',/^Wreck/.test(M.use(by,'wreck')));
  heal(WOLF);world.actors.get(WOLF).p.health=0.22;
  strike(by,WOLF,0.2,{power:true}); settle();
  world.actors.get(by)[field]=1;
  yes('maneuver fallback does not name a replacement character after '+field,M.killerOf(WOLF)===0);
}
{
  const by=actor(0xff000033);
  states.set(by,warrior('berserker','master'));
  yes('Heavy is armed before the runtime rearm regression',/^Heavy/.test(M.use(by,'heavy')));heal(WOLF);
  strike(by,WOLF,0,{power:true});
  world.actors.get(by).runtime=1;
  settle();
  strike(by,WOLF,0.2,{power:true});settle();
  yes('a discarded old-session hit cannot rearm Heavy for the new session',health(WOLF)===0.8);
}
// ----------------------------------------- Plant on the person's own machine --
/*
  #1386. "You are not staggered for 8 seconds." The server refuses the
  staggers it sends (above). Every other stagger is the game's, played on
  the person's own machine as staggerStart on their own character, so the
  front blanks that event in the sendAnimationEvent hook while the view says
  Plant is on: the real maneuversFromView and the real Plant block, over a
  pretend hook and clock. FRONT=<path> runs it on another copy of the plugin.
*/
{
  const FR = process.env.FRONT ? fs.readFileSync(process.env.FRONT, 'utf8').replace(/\r/g, '') : front;
  const fromView = slice(FR, '  function maneuversFromView(json) {', '\n  }\n');
  const a = FR.indexOf('  let plantUntil = 0;');
  const b = a < 0 ? -1 : FR.indexOf("  sp.on('update', guard('plant', () => {", a);
  const c = b < 0 ? -1 : FR.indexOf('\n  }));\n', b);
  yes('the front has a Plant block beside the maneuver rows', !!fromView && a >= 0 && b > a && c > b);
  if (fromView && a >= 0 && b > a && c > b) {
    const clock = { t: 1000000 };
    const hooks = [], updates = [], said = [];
    const sp = {
      hooks: { sendAnimationEvent: { add: function (h, from, to, pattern) { hooks.push({ h: h, from: from, to: to, pattern: pattern }); } } },
      on: function (ev, fn) { if (ev === 'update') { updates.push(fn); } }
    };
    const api = new Function('sp', 'guard', 'say', 'log', 'Date', 'maneuversToPage',
      'let maneuverRows = [];\n' + fromView + '\n' + FR.slice(a, c + 7) +
      '\nreturn { fromView: maneuversFromView };')(
      sp, function (n, fn) { return fn; }, function (t) { said.push(String(t)); }, function (t) { said.push(String(t)); },
      { now: function () { return clock.t; } }, function () { });
    yes('Plant hooks staggerStart on your own character and nobody else\'s',
      hooks.length === 1 && hooks[0].from === 0x14 && hooks[0].to === 0x14 && hooks[0].pattern === 'staggerStart');
    const stagger = function () {
      const ctx = { animEventName: 'staggerStart', selfId: 0x14 };
      hooks[0].h.enter(ctx);
      updates.forEach(function (f) { f(); });
      return ctx.animEventName;
    };
    const view = function (on) {
      const row = { key: 'plant', name: 'Plant', stamina: 20, cooldown: 60, ready: !on, seconds: 8 };
      if (on) { row.on = true; }
      api.fromView(JSON.stringify({ v: 1, panel: { maneuvers: [{ key: 'set', name: 'Set', stamina: 15, cooldown: 45, ready: true }, row] } }));
    };
    view(false);
    yes('without Plant a stagger plays', stagger() === 'staggerStart');
    view(true);
    yes('with Plant on in the view a stagger is refused', stagger() === '');
    yes('and the log says so', said.some(function (l) { return /plant: refused a stagger \(1 in this Plant\)/.test(l); }));
    clock.t += 3000;
    view(true);
    clock.t += 3000;
    yes('the same Plant seen again does not start it over', stagger() === '');
    view(false);
    yes('the server saying it is over lets staggers play again', stagger() === 'staggerStart' &&
      said.some(function (l) { return /plant: over, 2 stagger\(s\) refused/.test(l); }));
    view(true);
    clock.t += 8001;
    yes('if the end never arrives, Plant still ends at its own length', stagger() === 'staggerStart');
    api.fromView(JSON.stringify({ v: 1, panel: { maneuvers: [] } }));
    view(true);
    api.fromView(JSON.stringify({ v: 1, panel: { maneuvers: [{ key: 'rush', name: 'Rush', stamina: 15, cooldown: 30, ready: true }] } }));
    yes('a view with no Plant row in it ends Plant', stagger() === 'staggerStart');
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
