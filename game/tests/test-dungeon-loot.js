// test-dungeon-loot.js
//
// A chest in a dungeon pays from the tier of the place.
// Gold, ordinary goods, a spell tome, and a short exclusive list.
// The world's own coin is still stripped. This pile is created on the open.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
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

const A = '// ==== thornswood dungeon loot ====';
const B = '// ==== end thornswood dungeon loot ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('the dungeon loot block is in the gamemode', block !== null);

function edidRecord(text) {
  const data = [];
  for (let i = 0; i < text.length; i++) data.push(text.charCodeAt(i));
  data.push(0);
  return { record: { fields: [{ type: 'EDID', data: data }] } };
}

function rig(random, seed) {
  const store = {};
  const records = {};
  const given = [];
  const said = [];
  let clock = 1000000000000;
  const ids = {};
  let nextId = 0x200;
  let saved=seed ? JSON.parse(JSON.stringify(seed)) : {version:1,entries:{}};
  const storage={load:()=>JSON.parse(JSON.stringify(saved)),save:next=>{saved=JSON.parse(JSON.stringify(next));}};

  function idOf(desc) {
    if (!ids[desc]) { ids[desc] = nextId++; }
    return ids[desc];
  }
  const mp = {
    getServerSettings:()=>({thornswoodServer:'dev'}),
    getNpcAIState: function (id) {
      return (store[id] && store[id].ai) ? store[id].ai : {isHuman:true,profileId:1,isDead:false,isDisabled:false};
    },
    getDescFromId:id=>id.toString(16)+':Skyrim.esm',
    get: function (id, key) {
      const row = store[id] || {};
      return row[key];
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id][key] = v;
    },
    lookupEspmRecordById: function (baseId) {
      return records[baseId] || null;
    }
  };
  function addItem(actorId, desc, count) {
    given.push({ actorId: actorId, desc: desc, count: count });
    return true;
  }
  function addItemsAtomic(actorId,goods) {
    for(const good of goods) given.push({actorId,desc:good.item,count:good.count});
    return true;
  }
  function say(actorId, text) { said.push(String(text)); }
  const FakeDate = { now: function () { return clock; } };
  const fn = new Function(
    'globalThis', 'mp', 'console', 'idOf', 'addItem', 'say',
    'Math', 'Date', 'Number', 'String', 'Object', 'Array', 'RegExp',
    'require','createPrivateEconomyLedger','withinResourceReach','addItemsAtomic',
    'function isCarcass(desc){ return String(desc).indexOf("wolf")>=0; }\n' +
    block + '\nreturn globalThis.__thornswoodDungeonLoot;');
  const g = {
    NPC_POPULATION_DATA: {
      keep: [
        ['20:Skyrim.esm', 'b:Skyrim.esm', 'c:Skyrim.esm', [0, 0, 0], 400, 30, 'enemy', 'bandit-camp', null, 4, '20:Skyrim.esm'],
        ['21:Skyrim.esm', 'b:Skyrim.esm', 'c:Skyrim.esm', [0, 0, 0], 400, 30, 'enemy', 'dungeon', 2, 4, '21:Skyrim.esm'],
        ['22:Skyrim.esm', 'wolf:Skyrim.esm', 'c:Skyrim.esm', [0, 0, 0], 400, 30, 'animal', 'wilderness', null, 4, '22:Skyrim.esm']
      ]
    }
  };
  const math = {
    floor: Math.floor,
    random: typeof random === 'function' ? random : Math.random
  };
  const api = fn(
    g, mp, { log: function () { } }, idOf, addItem, say,
    math, FakeDate, Number, String, Object, Array, RegExp,
    require,()=>storage,()=>true,addItemsAtomic);
  api.given = given;
  api.said = said;
  api.idOf = idOf;
  api.clock = function (n) { if (n !== undefined) clock = n; return clock; }
  api.advance = function (ms) { clock += ms; };
  api.putActor = function (id, cell) {
    store[id] = { worldOrCellDesc: cell };
  };
  api.putBody = function (id, baseDesc, ai) {
    store[id] = { baseDesc: baseDesc, ai: ai };
  };
  api.putChest = function (id, edid) {
    const desc = edid + ':Skyrim.esm';
    store[id] = { baseDesc: desc };
    records[idOf(desc)] = edidRecord(edid);
  };
  api.ledger = function () { return JSON.parse(JSON.stringify(saved)); };
  return api;
}

if (block) {
  const api = rig();
  yes('Bleak Falls Temple is tier 1', api.tierOf('371de:Skyrim.esm') === 1);
  yes('the lookup ignores case', api.tierOf('371DE:Skyrim.esm') === 1);
  yes('Temple of Miraak is tier 4', api.tierOf('142f0:Dragonborn.esm') === 4);
  yes('a town temple is not a dungeon', api.tierOf('165a7:Skyrim.esm') === 0);
  yes('more than a hundred interiors are on the table', (function () {
    const n = (block.match(/': [1-4],/g) || []).length;
    return n > 100;
  })());

  yes('tier 1 tomes are novice only', api.ranksFor(1).join(',') === 'novice');
  yes('tier 2 tomes are novice only', api.ranksFor(2).join(',') === 'novice');
  yes('tier 3 is novice and master', api.ranksFor(3).join(',') === 'novice,master');
  yes('tier 4 reaches master', api.ranksFor(4).indexOf('master') >= 0);
  yes('Raven Rock Mine is tier 4', api.tierOf('142fc:Dragonborn.esm') === 4);

  const low = api.goodsFor(1).map(function (g) { return g.name; });
  yes('a tier 1 chest can hold a lockpick', low.indexOf('lockpick') >= 0);
  yes('a tier 1 chest can hold an iron sword', low.indexOf('iron sword') >= 0);
  yes('a tier 1 chest cannot hold ebony', low.indexOf('ebony ingot') < 0);
  const high = api.goodsFor(4).map(function (g) { return g.name; });
  yes('a tier 4 chest can hold ebony', high.indexOf('ebony ingot') >= 0);

  const excl = api.exclusiveFor(4).map(function (g) { return g.name; });
  const goods = api.goodsFor(4).map(function (g) { return g.name; });
  yes('the exclusive list is not the ordinary pile', excl.every(function (n) {
    return goods.indexOf(n) < 0;
  }));
  yes('tier 1 exclusive is only the amulet', api.exclusiveFor(1).length === 1
    && api.exclusiveFor(1)[0].name === 'Ancient Nord Amulet');
  yes('the embalming tool is not a dungeon find', excl.indexOf('Embalming Tool') < 0);
  yes('a black soul gem waits for tier 4', api.exclusiveFor(3).every(function (g) {
    return g.name !== 'Black Soul Gem';
  }) && api.exclusiveFor(4).some(function (g) { return g.name === 'Black Soul Gem'; }));

  // rng order: gold, goods, goods, tome, rank, which, exclusive, which
  const amulet = api.roll(1, (function () {
    const seq = [0, 0.99, 0.99, 0.99, 0, 0];
    let i = 0;
    return function () { return seq[Math.min(i++, seq.length - 1)]; };
  })());
  yes('a quiet tier 1 roll is the minimum gold and the amulet',
    amulet.gold === 5 && amulet.items.length === 1
    && amulet.items[0].name === 'Ancient Nord Amulet');
  yes('the line names the gold and the amulet',
    api.heldLine(amulet) === 'The chest held 5 gold and an Ancient Nord Amulet.');

  const storm = api.roll(4, (function () {
    const seq = [0, 0.99, 0.99, 0, 0.95, 0, 0.99];
    let i = 0;
    return function () { return seq[Math.min(i++, seq.length - 1)]; };
  })());
  yes('a tier 4 roll can be a master tome',
    storm.gold === 50 && storm.items.length === 1
    && storm.items[0].name === 'Spell Tome: Fire Storm'
    && storm.items[0].rank === 'master');

  let noviceOnly = true;
  for (let n = 0; n < 80; n++) {
    const rolled = api.roll(1, Math.random);
    if (rolled.gold < 5 || rolled.gold > 15) noviceOnly = false;
    for (let k = 0; k < rolled.items.length; k++) {
      const it = rolled.items[k];
      if (it.rank && it.rank !== 'novice') noviceOnly = false;
      if (it.exclusive && it.name !== 'Ancient Nord Amulet') noviceOnly = false;
    }
  }
  yes('eighty tier 1 rolls stay in the novice band', noviceOnly);

  const actor = 1;
  const chest = 0x1000;
  const barrel = 0x1001;
  const made = 0xff000010;
  api.putActor(actor, '371de:Skyrim.esm');
  api.putChest(chest, 'TreasureChestLarge');
  api.putChest(barrel, 'BarrelEmpty');
  api.putChest(made, 'TreasureChestLarge');

  const paid = api.onChest(actor, chest);
  yes('opening a dungeon chest pays', paid && paid.gold >= 5);
  yes('the gold goes into the pack as coin', api.given.some(function (g) {
    return g.desc === 'f:Skyrim.esm' && g.count === paid.gold;
  }));
  yes('the chest says what it held', api.said.length === 1 && api.said[0].indexOf('The chest held ') === 0);
  yes('the ledger remembers the pay', (api.ledger().entries[chest.toString(16) + ':Skyrim.esm'] || {}).at === api.clock());

  const before = api.given.length;
  yes('the same chest does not pay twice inside the rest', api.onChest(actor, chest) === null);
  yes('nothing else was handed over', api.given.length === before);

  api.advance(29 * 60 * 1000);
  yes('twenty nine minutes is still the same rest', api.onChest(actor, chest) === null);
  api.advance(2 * 60 * 1000);
  const again = api.onChest(actor, chest);
  yes('thirty minutes later the chest pays again', again && again.gold >= 5);

  const mid = api.given.length;
  yes('a barrel in the same place does not pay', api.onChest(actor, barrel) === null);
  yes('a container somebody placed does not pay', api.onChest(actor, made) === null);
  api.putActor(2, '165a7:Skyrim.esm');
  api.putChest(0x1002, 'TreasureChestLarge');
  yes('a chest in a temple that is not a dungeon does not pay', api.onChest(2, 0x1002) === null);
  yes('those three opens handed nothing', api.given.length === mid);

  // #510: the lists match inside a name. "sack" refused every knapsack and
  // "urn" paid out of burnt corpses (TreasBurntCorpse01) and a journal box.
  api.putChest(0x1003, 'TreasKnapsack');
  const knap = api.onChest(actor, 0x1003);
  yes('a dungeon knapsack pays, though "sack" is on the refused list', knap && knap.gold >= 5);

  api.putChest(0x1004, 'TreasBurntCorpse01');
  yes('a burnt corpse is not an urn and does not pay', api.onChest(actor, 0x1004) === null);
  api.putChest(0x1005, 'MQ104BurntCorpse03');
  yes('nor the burnt corpses of the dragon attack', api.onChest(actor, 0x1005) === null);
  api.putChest(0x1006, 'EE_JournalsStorage');
  yes('a journal box is not an urn', api.onChest(actor, 0x1006) === null);
  api.putChest(0x1007, 'TreasRuinsUrnSmall01');
  const urn = api.onChest(actor, 0x1007);
  yes('a real urn still pays', urn && urn.gold >= 5);
  api.putChest(0x1008, 'DLC2WB01JournalChest');
  yes('a chest named for a journal is still a chest', !!api.onChest(actor, 0x1008));
  api.putChest(0x1009, 'NobleChestDrawers01');
  yes('a chest of drawers is still a dresser', api.onChest(actor, 0x1009) === null);
  api.putChest(0x100a, 'SackSmall01');
  yes('a sack still does not pay', api.onChest(actor, 0x100a) === null);
  yes('the knapsack keeps its rest like any chest', api.onChest(actor, 0x1003) === null);

  // #510, Patrick 12 Oct: the boss chest at the end of a place pays one
  // tier above the place. A tier 4 place has nothing above it and stays 4.
  // The rest is still the place's. Every one of these fails on the gamemode
  // before the change, where a boss chest paid the place's own tier.
  const bossRig = rig(function () { return 0; });
  bossRig.putActor(1, '371de:Skyrim.esm');
  bossRig.putChest(0x2000, 'TreasDraugrChestBoss');
  bossRig.putChest(0x2001, 'TreasureChestLarge');
  const boss1 = bossRig.onChest(1, 0x2000);
  const plain1 = bossRig.onChest(1, 0x2001);
  yes('a boss chest in a tier 1 place pays a tier 2 pile',
    !!boss1 && boss1.tier === 2 && boss1.gold === bossRig.GOLD_SPAN[2][0]);
  yes('an ordinary chest in the same place still pays tier 1',
    !!plain1 && plain1.tier === 1 && plain1.gold === bossRig.GOLD_SPAN[1][0]);
  yes('the boss chest gold goes into the pack', bossRig.given.some(function (g) {
    return g.desc === 'f:Skyrim.esm' && g.count === bossRig.GOLD_SPAN[2][0];
  }));
  bossRig.advance(31 * 60 * 1000);
  const boss1Again = bossRig.onChest(1, 0x2000);
  yes('the boss chest keeps the rest of the place, thirty minutes at tier 1, not forty five',
    !!boss1Again && boss1Again.tier === 2);
  yes('the paid tier is what the ledger keeps',
    bossRig.ledger().entries['2000:Skyrim.esm'].tier === 2);
  const reloaded = rig(function () { return 0; }, bossRig.ledger());
  reloaded.putActor(1, '371de:Skyrim.esm');
  reloaded.putChest(0x2002, 'TreasureChestLarge');
  yes('a ledger holding a boss chest pile still loads after a restart',
    !!reloaded.onChest(1, 0x2002));
  yes('the reloaded ledger keeps the boss chest resting',
    reloaded.onChest(1, 0x2000) === null);

  bossRig.putActor(3, '142f0:Dragonborn.esm');
  bossRig.putChest(0x2003, 'DLC2TreasRieklingChestBoss');
  const boss4 = bossRig.onChest(3, 0x2003);
  yes('a boss chest in a tier 4 place stays a tier 4 pile',
    !!boss4 && boss4.tier === 4 && boss4.gold === bossRig.GOLD_SPAN[4][0]);
  bossRig.putChest(0x2004, 'DLC2RR02BossChest');
  const bossName = bossRig.onChest(1, 0x2004);
  yes('a chest named BossChest is a boss chest too', !!bossName && bossName.tier === 2);
  bossRig.putChest(0x2005, 'TreasBanditChestBossEMPTY');
  const bossEmpty = bossRig.onChest(1, 0x2005);
  yes('the boss chests Skyrim leaves empty pay the boss pile', !!bossEmpty && bossEmpty.tier === 2);
  yes('the tier above stops at 4', typeof bossRig.payTierFor === 'function'
    && bossRig.payTierFor(3, 'TreasFalmerChestBoss') === 4
    && bossRig.payTierFor(4, 'TreasFalmerChestBoss') === 4
    && bossRig.payTierFor(2, 'TreasFalmerChest') === 2);

  // #510, Patrick 12 Oct, the extras: every boss chest holds a tome or a
  // burial piece for certain, and a boss chest in a tier 4 place rolls the
  // burial piece a second time. These fail on the gamemode before the extras.
  const special = function (rolled) {
    return !!rolled && rolled.items.some(function (it) { return it.exclusive || !!it.rank; });
  };
  const burials = function (rolled) {
    let n = 0;
    (rolled ? rolled.items : []).forEach(function (it) { if (it.exclusive) n += it.count; });
    return n;
  };
  // rng order: gold, goods, goods, tome, exclusive, then the sure pick.
  const quiet = bossRig.roll(1, seqRng([0, 0.99, 0.99, 0.99, 0.99, 0.99, 0]), {});
  yes('a boss roll that missed both still holds a burial piece or a tome',
    special(quiet) && quiet.items.length === 1);
  const quietTome = bossRig.roll(1, seqRng([0, 0.99, 0.99, 0.99, 0.99, 0, 0, 0]), {});
  yes('and the sure pick can be a novice tome',
    !!quietTome && quietTome.items.length === 1 && quietTome.items[0].rank === 'novice');
  const plainQuiet = bossRig.roll(1, seqRng([0, 0.99, 0.99, 0.99, 0.99, 0.99, 0]));
  yes('an ordinary roll that missed both holds neither', !!plainQuiet && plainQuiet.items.length === 0);

  const unluckyRig = rig(function () { return 0.99; });
  unluckyRig.putActor(1, '371de:Skyrim.esm');
  unluckyRig.putChest(0x2100, 'TreasDraugrChestBoss');
  unluckyRig.putChest(0x2101, 'TreasureChestLarge');
  yes('opening a boss chest on the unluckiest rolls still pays a tome or a burial piece',
    special(unluckyRig.onChest(1, 0x2100)));
  yes('an ordinary chest on the same rolls pays neither', !special(unluckyRig.onChest(1, 0x2101)));

  const luckyRig = rig(function () { return 0; });
  luckyRig.putActor(3, '142f0:Dragonborn.esm');
  luckyRig.putChest(0x2200, 'TreasDraugrChestBoss');
  luckyRig.putChest(0x2201, 'TreasureChestLarge');
  yes('a boss chest in a tier 4 place rolls the burial piece twice', burials(luckyRig.onChest(3, 0x2200)) === 2);
  yes('an ordinary chest there rolls it once', burials(luckyRig.onChest(3, 0x2201)) === 1);
  luckyRig.putActor(4, '142f3:Dragonborn.esm');
  luckyRig.putChest(0x2202, 'TreasDraugrChestBoss');
  const fromThree = luckyRig.onChest(4, 0x2202);
  yes('a boss chest in a tier 3 place pays tier 4 but rolls the burial piece once',
    !!fromThree && fromThree.tier === 4 && burials(fromThree) === 1);

  const act = src.slice(src.indexOf('function activate(actorId, refrId, baseDesc)'),
                        src.indexOf('// ------------------------------------------------- where gold comes from --'));
  yes('opening a container asks the dungeon table',
    /dungeonLoot\.onChest\(actorId, refrId\)/.test(act));
  yes('a press the hunter does not answer can search a body',
    src.indexOf('bodyLoot.onBody') >= 0);

  function seqRng(seq) {
    let i = 0;
    return function () { return seq[Math.min(i++, seq.length - 1)]; };
  }
  const campPile = api.rollBody(true, seqRng([0, 0, 0, 0, 0.99, 0.99, 0.99]));
  yes('a camp body can carry a little coin and a common supply',
    campPile.gold === 1 && campPile.items.length === 1 && campPile.items[0].name === 'lockpick');
  const wildEmpty = api.rollBody(false, seqRng([0.99, 0.99, 0.99, 0.99, 0.99]));
  yes('a wild body can be empty', wildEmpty.gold === 0 && wildEmpty.items.length === 0);
  const wildGood = api.rollBody(false, seqRng([0.99, 0.99, 0.99, 0, 0, 0.99]));
  yes('a good find on a body is ordinary gear',
    wildGood.items.length === 1 && wildGood.items[0].name === 'iron sword');
  const rare = api.rollBody(false, seqRng([0.99, 0.99, 0.99, 0.99, 0, 0]));
  yes('a rare body find can be a master tome',
    rare.items.length === 1 && rare.items[0].name === 'Spell Tome: Fire Storm');
  yes('body coin stays under the chest minimum',
    api.rollBody(true, seqRng([0, 0.99])).gold <= 6);

  const dead = { isHuman: false, profileId: 0, isDead: true, isDisabled: false };
  const campRig = rig(function () { return 0; });
  campRig.putActor(1, '371de:Skyrim.esm');
  campRig.putBody(0x20, 'bandit:Skyrim.esm', dead);
  const taken = campRig.onBody(1, 0x20);
  const handed = campRig.given.length;
  yes('searching a camp enemy hands over what was on the body',
    taken && taken.indexOf('You take ') === 0 && handed > 0);
  yes('the same body does not pay a second time', campRig.onBody(1, 0x20) === null);
  yes('the second search hands nothing more', campRig.given.length === handed);
  campRig.onStand(0x20);
  const stood = campRig.onBody(1, 0x20);
  yes('standing up clears the body so the next life can be searched',
    stood && stood.indexOf('You take ') === 0);

  const wildRig = rig(function () { return 0.99; });
  wildRig.putActor(1, '371de:Skyrim.esm');
  wildRig.putBody(0x21, 'draugr:Skyrim.esm', dead);
  yes('an empty body says there is nothing',
    wildRig.onBody(1, 0x21) === 'There is nothing on this body.');
  yes('an empty body hands nothing', wildRig.given.length === 0);
  yes('a second search of an empty body is silence', wildRig.onBody(1, 0x21) === null);

  const personRig = rig(function () { return 0; });
  personRig.putActor(1, '371de:Skyrim.esm');
  personRig.putBody(0x30, 'person:Skyrim.esm',
    { isHuman: true, profileId: 7, isDead: true, isDisabled: false });
  yes('a dead person is not looted', personRig.onBody(1, 0x30) === null);
  yes('a dead person hands nothing', personRig.given.length === 0);

  const wolfRig = rig(function () { return 0; });
  wolfRig.putActor(1, '371de:Skyrim.esm');
  wolfRig.putBody(0x22, 'wolf:Skyrim.esm', dead);
  yes('a hunter carcass is not paid by the body table', wolfRig.onBody(1, 0x22) === null);
  yes('a hunter carcass hands nothing', wolfRig.given.length === 0);
}

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
