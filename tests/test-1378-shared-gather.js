'use strict';
// Issue #1378. One shared wait per plant, a non-gatherer refused before
// the plant is consumed, and the unranked world records take the ranks
// under "What you cannot do" on the gatherer page.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8')).replace(/\r/g, '');
const page = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'classes', 'gatherer.md'), 'utf8').replace(/\r/g, '');
const unrankedPage = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'lists', 'unranked.md'), 'utf8').replace(/\r/g, '');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function codeOf(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const code = codeOf(src);

function braceSlice(s, head) {
  const a = s.indexOf(head);
  if (a < 0) return null;
  const open = s.indexOf('{', a);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(a, i + 1);
    }
  }
  return null;
}

function loadObject(head) {
  const slice = braceSlice(code, head);
  if (!slice) return null;
  const open = slice.indexOf('{');
  try { return new Function('return ' + slice.slice(open) + ';')(); }
  catch (e) { return null; }
}

const HARVESTS_BY_BASE = loadObject('var HARVESTS_BY_BASE = {');
const HARVESTS = loadObject('const HARVESTS = {');
const GATHER_UNRANKED = loadObject('const GATHER_UNRANKED = {') || null;
const harvestFn = braceSlice(code, 'function harvest(');
const plantAtFn = braceSlice(code, 'function plantAt(');

yes('HARVESTS_BY_BASE lifts', !!HARVESTS_BY_BASE && Object.keys(HARVESTS_BY_BASE).length > 50);
yes('the hand nirnroot map lifts', !!HARVESTS);
yes('harvest() is present', !!harvestFn);
yes('plantAt() is present', !!plantAtFn);
yes('the formerly unranked gather map is present', !!GATHER_UNRANKED);

const ladderByName = {};
if (HARVESTS_BY_BASE) {
  Object.keys(HARVESTS_BY_BASE).forEach(function (base) {
    const row = HARVESTS_BY_BASE[base];
    ladderByName[row.name] = { rank: row.rank, produce: row.produce, base: base };
  });
}

const ALIAS = {
  'Juniper': 'Juniper Berries',
  'Jazbay': 'Jazbay Grapes',
  'Thistle': 'Thistle Branch',
  'Spiky Grass': 'Grass Pod',
  'Snowberry': 'Snowberries'
};
const RANK_OF = {
  'Lavender': 'novice', 'Juniper Berries': 'novice', 'Jazbay Grapes': 'novice',
  'Thistle Branch': 'novice', 'Tundra Cotton': 'novice', 'Grass Pod': 'novice',
  'Imp Stool': 'novice', 'Creep Cluster': 'novice', "Namira's Rot": 'novice',
  'White Cap': 'novice',
  'Blue Mountain Flower': 'advanced', 'Purple Mountain Flower': 'advanced',
  'Red Mountain Flower': 'advanced', 'Canis Root': 'advanced', 'Deathbell': 'advanced',
  "Dragon's Tongue": 'advanced', 'Fly Amanita': 'advanced', 'Giant Lichen': 'advanced',
  'Glowing Mushroom': 'advanced', 'Mora Tapinella': 'advanced', 'Scaly Pholiota': 'advanced',
  'Snowberries': 'advanced', 'Swamp Fungal Pod': 'advanced',
  'Bleeding Crown': 'expert', 'Blisterwort': 'expert', 'Nightshade': 'expert'
};
const NOT_A_GATHER = {
  'Cabbage': 'farmer', 'Carrot': 'farmer', 'Gourds': 'farmer', 'Leek': 'farmer',
  'Potato': 'farmer', 'Wheat': 'farmer',
  "Bashir's Clam": 'nobody, a quest prop', 'Fish': 'fisher',
  'Coin Purse': 'not a harvest',
  // #3141: the cheese is anybody's (Patrick, 21 Sep), the barrel nobody's.
  'Mammoth Cheese': 'anybody', 'Mead Barrel': 'nobody',
  'Beehive': 'farmer verb', "Chickens' Nest": 'farmer verb', 'Churn': 'farmer verb',
  'Horker': 'the hunter',
  // Update.esm's Creation Club records: Special Edition only (#479).
  'Rot Scale': 'a Creation Club record', 'Screaming Maw': 'a Creation Club record',
  'Thorn Hook': 'a Creation Club record',
  // _ResourcePack.esl's planter Aloe Vera, whose produce is a sack only a
  // Papyrus script opens; the wild Aloe Vera is on the ladder. The tables
  // read _ResourcePack.esl since #3105, as both servers load it.
  'Aloe Vera': 'a sack only Papyrus opens'
};
// The three that kept a produce of their own were the Creation Club roots,
// and they are off the gatherer now, so no unranked row keeps its own.
const OWN_PRODUCE = {};

const unrankedNames = [];
unrankedPage.split('\n').forEach(function (line) {
  if (line.indexOf('|') !== 0 || line.indexOf('| ---') === 0 || line.indexOf('| Name |') === 0) return;
  const cells = line.split('|').slice(1, -1).map(function (c) { return c.trim(); });
  if (cells[0]) unrankedNames.push(cells[0]);
});
yes('unranked.md was read and still lists the filed records', unrankedNames.length === 45);

const byGatherName = {};
if (GATHER_UNRANKED) {
  Object.keys(GATHER_UNRANKED).forEach(function (base) {
    const row = GATHER_UNRANKED[base];
    byGatherName[row.name] = { base: base, row: row };
  });
}

unrankedNames.forEach(function (name) {
  const gatherName = ALIAS[name] || name;
  if (Object.prototype.hasOwnProperty.call(NOT_A_GATHER, name)) {
    const hit = GATHER_UNRANKED && Object.keys(GATHER_UNRANKED).some(function (base) {
      const row = GATHER_UNRANKED[base];
      return row.name === name || row.name === gatherName;
    });
    yes(name + ' stays off the gatherer (' + NOT_A_GATHER[name] + ')', !hit);
    return;
  }
  const row = byGatherName[gatherName];
  const want = RANK_OF[gatherName];
  yes(name + ' is ranked ' + want, !!row && row.row.rank === want);
  if (ladderByName[gatherName]) {
    yes(name + ' keeps the ladder rank and the ladder produce',
      !!row && row.row.rank === ladderByName[gatherName].rank &&
      row.row.produce === ladderByName[gatherName].produce);
  } else if (row) {
    yes(name + ' keeps its own produce and gains no gold price',
      row.row.produce === OWN_PRODUCE[gatherName]);
  }
});

if (GATHER_UNRANKED) {
  const blob = JSON.stringify(GATHER_UNRANKED);
  yes('no gold price was added', !/"(gold|price|value)"/.test(blob));
  yes('a coin purse is not a harvest', blob.toLowerCase().indexOf('purse') < 0 && blob.toLowerCase().indexOf('coin') < 0);
  yes('an estate key is not a harvest', blob.toLowerCase().indexOf('estate') < 0 && blob.toLowerCase().indexOf('key') < 0);
  yes('the beehive, the nest and the churn are not in the map',
    blob.indexOf('dbf8b3:Thornswood-Content.esp') < 0 &&
    blob.indexOf('1062d1:Skyrim.esm') < 0 &&
    blob.indexOf('bc0:HearthFires.esm') < 0);
}

yes('wheat already on the ladder keeps advanced',
  !!ladderByName.Wheat && ladderByName.Wheat.rank === 'advanced' &&
  ladderByName.Wheat.base === 'bb953:Skyrim.esm');
yes('the nirnroot activators stay unranked hand rows',
  !!HARVESTS && HARVESTS['e1fb2:Skyrim.esm'] && HARVESTS['e1fb2:Skyrim.esm'].rank == null &&
  HARVESTS['b6fb9:Skyrim.esm'] && HARVESTS['b6fb9:Skyrim.esm'].rank == null);

yes('the gatherer page no longer says the wait is per person',
  page.indexOf('The wait is still per person') < 0 &&
  page.indexOf('The wait is the plant, for everybody') >= 0);

const plantBody = plantAtFn || '';
yes('plantAt answers the unranked map after the generated table',
  plantBody.indexOf('HARVESTS_BY_BASE') >= 0 &&
  plantBody.indexOf('HARVESTS_BY_BASE') < plantBody.indexOf('GATHER_UNRANKED') &&
  plantBody.indexOf('GATHER_UNRANKED') >= 0);
yes('those bases are published so the client does not press them twice',
  code.indexOf('for (var unrankedPlant in GATHER_UNRANKED)') >= 0);

const REFUSAL = 'Only a gatherer can pull that out of the ground. Ask one.';
const PLANTER = '110bf:HearthFires.esm';
const EXPERT = '110c3:HearthFires.esm';

if (harvestFn && plantAtFn && HARVESTS_BY_BASE && HARVESTS) {
  const map = GATHER_UNRANKED || {};
  let built;
  try {
    built = new Function(
      'isStation', 'isFish', 'isGame', 'HARVESTS_BY_BASE', 'HARVESTS', 'GATHER_UNRANKED',
      plantAtFn + '\n' + harvestFn + '\nreturn { plantAt: plantAt, harvest: harvest };'
    )(
      function (d) { return d === 'dbf8b3:Thornswood-Content.esp'; },
      function (d) {
        return d === '4d078:OarsRest.esp' || d === '17b9e1:WindhelmSSE.esp' ||
          d === '17ba31:WindhelmSSE.esp' || d === '19648b:WindhelmSSE.esp';
      },
      function () { return false; },
      HARVESTS_BY_BASE,
      HARVESTS,
      map
    );
  } catch (e) {
    yes('plantAt and harvest load (' + e.message + ')', false);
    built = null;
  }

  if (built) {
    const adds = [];
    const lastUse = new Map();
    function stampCooldown(actorId, refrId) {
      lastUse.set(String(actorId) + ':' + refrId, Date.now());
    }
    function classGate(actorId) {
      if (actorId === 2) return REFUSAL;
      return null;
    }
    function rankStep(actorId) { return actorId === 3 ? 0 : 3; }
    const harvest = new Function(
      'classGate', 'rankStep', 'rankWord', 'RANK_LADDER', 'addItem', 'creditWork',
      'isCrop', 'plantAt', 'lastUse', 'stampCooldown', 'HARVEST_COOLDOWN_MS', 'Date', 'outOfSeason',
      'function economyGathered() { }\n' + harvestFn + '\nreturn harvest;'
    )(
      classGate,
      rankStep,
      function (r) { return String(r).charAt(0).toUpperCase() + String(r).slice(1); },
      ['novice', 'advanced', 'expert', 'master'],
      function (actor, desc, n) { adds.push([actor, desc, n]); return true; },
      function () { return null; },
      function () { return false; },
      built.plantAt,
      lastUse,
      stampCooldown,
      600000,
      Date,
      // Every plant here is in season; the seasons are test-3152's (#3152).
      function () { return ''; }
    );

    adds.length = 0;
    const refused = harvest(2, 0x91, PLANTER);
    yes('a non-gatherer is refused before the planter is consumed',
      refused === REFUSAL && adds.length === 0 && lastUse.size === 0);

    const low = harvest(3, 0x92, EXPERT);
    yes('a gatherer below the rank takes nothing',
      typeof low === 'string' && low.indexOf('takes Expert') >= 0 && adds.length === 0 && lastUse.size === 0);

    let wild = null;
    Object.keys(HARVESTS_BY_BASE).forEach(function (base) {
      if (!wild && HARVESTS_BY_BASE[base].name === 'Lavender') wild = base;
    });
    yes('a lavender already on the ladder was found', !!wild);
    const picked = harvest(1, 0x93, wild);
    const keys = Array.from(lastUse.keys());
    yes('the first gatherer is handed one',
      /^You pick /.test(picked || '') && adds.length === 1 && adds[0][2] === 1);
    yes('the wait is stored on the plant, not the person',
      keys.length === 1 && keys[0] === 'plant:147');

    const secondAdds = adds.length;
    const second = harvest(4, 0x93, wild);
    yes('the next person cannot take that plant early',
      second === 'This one has already been picked.' && adds.length === secondAdds);

    const other = harvest(4, 0x94, wild);
    yes('the flower beside it is a different plant',
      /^You pick /.test(other || '') && adds.length === secondAdds + 1);

    const planterPick = harvest(1, 0x95, PLANTER);
    yes('the unranked planter is now a gather and hands one',
      /^You pick /.test(planterPick || '') && adds[adds.length - 1][1] === '77e1c:Skyrim.esm');

    yes('the hive, the clam and the churn are not gatherer plants',
      built.plantAt('dbf8b3:Thornswood-Content.esp') === null &&
      built.plantAt('4d078:OarsRest.esp') === null &&
      built.plantAt('bc0:HearthFires.esm') === null &&
      built.plantAt('1062d1:Skyrim.esm') === null &&
      built.plantAt('7edf0:Skyrim.esm') === null &&
      built.plantAt('f39b:HearthFires.esm') === null &&
      built.plantAt('110cd:HearthFires.esm') === null &&
      built.plantAt('d790c:Skyrim.esm') === null);
  }
} else {
  yes('harvest could be run', false);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
