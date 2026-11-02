// ==== thornswood dungeon loot ====
/*
  A CHEST IN A DUNGEON PAYS FROM THE PLACE'S TIER.

  Every other container holds nothing the world put there (the spoils
  block, #3078). This is the one door: the server creates a small pile when somebody opens a
  chest, an urn, a coffin or a safe in a dungeon, a cave or a sewer. The
  same container does not pay again until that tier's rest has passed,
  which is the same rest the population catalogue uses: 30, 45, 60 and 90
  minutes.

  Spell tomes are in the pile on purpose. Anybody who is not a mage learns
  from a tome, and only a novice spell, and only after a master has
  apprenticed them. A tome they cannot read stays in the pack. The three
  gates are not changed here.

  A short list is dungeon exclusive. It is not in the ordinary pile.
  Ordinary weapons and armour are in that pile too. Camps are not on the
  chest table. They have no tier. A camp enemy carries a little on the
  body. Any other dead body can be searched, and anything good on it is
  rare.

  A mine is on the chest table only when the population catalogue gives
  that place enemies. A wilderness mine with no dungeon tier stays off.

  The cell table below is the interiors whose names match a dungeon, a
  cave or a sewer in the population catalogue. Built 2 October 2026.
*/
(function () {
  'use strict';
  var g = globalThis;

  var RETURN_MIN = { 1: 30, 2: 45, 3: 60, 4: 90 };
  var GOLD_SPAN = { 1: [5, 15], 2: [12, 35], 3: [25, 70], 4: [50, 120] };
  var GOODS_CHANCE = { 1: 0.85, 2: 0.80, 3: 0.75, 4: 0.70 };
  var TOME_CHANCE = { 1: 0.22, 2: 0.32, 3: 0.42, 4: 0.55 };
  var EXCL_CHANCE = { 1: 0.05, 2: 0.09, 3: 0.14, 4: 0.22 };
  var RANK_WEIGHT = {
    1: [['novice', 100]],
    2: [['novice', 100]],
    3: [['novice', 92], ['master', 8]],
    4: [['novice', 70], ['master', 30]]
  };
  var GOLD_DESC = 'f:Skyrim.esm';
  if(g.__thornswoodDungeonLoot && g.__thornswoodDungeonLoot.shutdown) g.__thornswoodDungeonLoot.shutdown();
  var active=true,storage=null,ledger=null;
  try {
    var cfgDungeon=mp.getServerSettings();
    if(/^(main|dev)$/i.test(String(cfgDungeon.thornswoodServer || 'main'))) {
      storage=createPrivateEconomyLedger(require('fs'),require('path'),cfgDungeon,'dungeon-rewards',[]);
      ledger=storage.load();
      if(!ledger || ledger.version!==1 || !ledger.entries || typeof ledger.entries!=='object' || Array.isArray(ledger.entries))
        throw new Error('Invalid dungeon reward ledger');
      for(var key of Object.keys(ledger.entries)) {
        var saved=ledger.entries[key];
        if(!/^[0-9a-f]{1,8}:[^:]+\.es[mpl]$/i.test(key)) throw new Error('Invalid dungeon reward identity');
        if(saved && saved.kind==='body') {
          if(!Number.isSafeInteger(saved.at) || saved.at<=0 || typeof saved.taken!=='boolean' ||
            !Number.isInteger(saved.gold) || saved.gold<0 || saved.gold>6 ||
            !Array.isArray(saved.items)) throw new Error('Invalid body reward reservation');
          continue;
        }
        // actor 0 is a reservation whose character was deleted (#2351, release below).
        if(!saved ||
          !Number.isSafeInteger(saved.at) || saved.at<=0 || !Number.isInteger(saved.actor) || saved.actor<0 ||
          !Number.isInteger(saved.tier) || saved.tier<1 || saved.tier>4 ||
          !Number.isInteger(saved.gold) || saved.gold<GOLD_SPAN[saved.tier][0] || saved.gold>GOLD_SPAN[saved.tier][1] ||
          !Array.isArray(saved.items)) throw new Error('Invalid dungeon reward reservation');
      }
    }
  } catch(error) { active=false;console.log('[dungeon] rewards unavailable: '+error); }
  var LOOT_WORD = new RegExp('chest|urn|coffin|sarcophag|strongbox|coffer|safe|knapsack', 'i');
  var SKIP_WORD = new RegExp('barrel|sack|cupboard|dresser|endtable|wardrobe|shelf|crate|basket|drawer|nightstand', 'i');
  /*
    The two lists match inside a name, so a word that holds another word
    has to come out before the test (#510). Measured over the 895 containers
    the load order's winning records name: "sack" refused every knapsack,
    TreasKnapsack among them, though a knapsack is on the list; and "urn"
    paid a chest pile out of TreasBurntCorpse01 to 05, MQ104BurntCorpse03
    and 04 and POIYisraBurnt, which are burnt people, not urns, and out of
    EE_JournalsStorage. A person is never searched (docs\systems\dungeon-loot.md).
  */
  var NOT_SKIP = new RegExp('knapsack', 'ig');
  var NOT_LOOT = new RegExp('burnt|journal', 'ig');
  /*
    THE CHEST AT THE END PAYS ONE TIER ABOVE THE PLACE (#510).
    Decided by Patrick on 12 October 2026: "the 33 boss chests pay one tier
    higher than the other chests there". Skyrim marks the chest at the end
    of a place in its name, and only those: measured over the 895
    containers the dev load order's winning records name, 33 have "boss"
    in the editor id (TreasDraugrChestBoss, TreasBanditChestBossEMPTY,
    DLC2TreasRieklingChestBoss, DLC2RR02BossChest, MorvunskarBossChest
    and the rest), every one of them a chest, and no other container does.
    The pile (gold, goods, tome, exclusive) is the next tier's. A tier 4
    place has no tier above it, so its boss chest stays a tier 4 pile and
    rolls the burial piece a second time instead, and every boss chest
    holds a tome or a burial piece for certain (see roll, below).
    The rest is still the place's, because the rest is how long that
    place takes to fill again, not what the chest holds.
  */
  var BOSS_WORD = new RegExp('boss', 'i');
  function payTierFor(tier, name) {
    tier = clampTier(tier);
    if (!BOSS_WORD.test(String(name || ''))) return tier;
    return tier < 4 ? tier + 1 : 4;
  }

  var CELLS = {
    '10a8b:dawnguard.esm': 2,
    '1382e:skyrim.esm': 1,
    '140a:dawnguard.esm': 2,
    '142e2:dragonborn.esm': 1,
    '142ed:dragonborn.esm': 4,
    '142ee:dragonborn.esm': 4,
    '142ef:dragonborn.esm': 4,
    '142f0:dragonborn.esm': 4,
    '142f3:dragonborn.esm': 3,
    '142f4:dragonborn.esm': 3,
    '142f6:dragonborn.esm': 4,
    '142f7:dragonborn.esm': 1,
    '142f8:dragonborn.esm': 3,
    '142f9:dragonborn.esm': 3,
    '142fa:dragonborn.esm': 3,
    '142fb:dragonborn.esm': 1,
    '142fc:dragonborn.esm': 4,
    '151f2:skyrim.esm': 1,
    '151f3:skyrim.esm': 1,
    '151f4:skyrim.esm': 1,
    '151f5:skyrim.esm': 1,
    '151f6:skyrim.esm': 1,
    '151fa:skyrim.esm': 1,
    '151fb:skyrim.esm': 2,
    '151fc:skyrim.esm': 3,
    '15201:skyrim.esm': 2,
    '15206:skyrim.esm': 2,
    '15208:skyrim.esm': 1,
    '15210:skyrim.esm': 1,
    '15215:skyrim.esm': 1,
    '1521c:skyrim.esm': 2,
    '15223:skyrim.esm': 2,
    '15226:skyrim.esm': 1,
    '15227:skyrim.esm': 1,
    '1522a:skyrim.esm': 3,
    '1522f:skyrim.esm': 1,
    '15230:skyrim.esm': 2,
    '15231:skyrim.esm': 1,
    '15235:skyrim.esm': 2,
    '15239:skyrim.esm': 1,
    '1523d:skyrim.esm': 2,
    '1523f:skyrim.esm': 2,
    '15253:skyrim.esm': 1,
    '15254:skyrim.esm': 1,
    '15257:skyrim.esm': 2,
    '15258:skyrim.esm': 1,
    '1525f:skyrim.esm': 1,
    '15261:skyrim.esm': 1,
    '15262:skyrim.esm': 3,
    '15265:skyrim.esm': 1,
    '1526b:skyrim.esm': 1,
    '1526c:skyrim.esm': 1,
    '1526e:skyrim.esm': 2,
    '1526f:skyrim.esm': 1,
    '15274:skyrim.esm': 2,
    '15275:skyrim.esm': 1,
    '1527e:skyrim.esm': 1,
    '15280:skyrim.esm': 1,
    '15281:skyrim.esm': 1,
    '1528c:skyrim.esm': 1,
    '15290:skyrim.esm': 2,
    '15294:skyrim.esm': 2,
    '15295:skyrim.esm': 1,
    '1529c:skyrim.esm': 1,
    '1529d:skyrim.esm': 1,
    '1529f:skyrim.esm': 1,
    '152a0:skyrim.esm': 1,
    '152a1:skyrim.esm': 2,
    '152a8:skyrim.esm': 1,
    '152ad:skyrim.esm': 1,
    '152ae:skyrim.esm': 1,
    '152af:skyrim.esm': 2,
    '152b1:skyrim.esm': 1,
    '152b7:skyrim.esm': 1,
    '152ba:skyrim.esm': 1,
    '152be:skyrim.esm': 2,
    '152c1:skyrim.esm': 1,
    '161f6:skyrim.esm': 1,
    '16ea1:skyrim.esm': 1,
    '184f0:dragonborn.esm': 3,
    '19cd7:dragonborn.esm': 4,
    '1ab5f:skyrim.esm': 1,
    '1ab60:skyrim.esm': 1,
    '1aec3:skyrim.esm': 1,
    '1bbfb:dragonborn.esm': 1,
    '1be37:dragonborn.esm': 3,
    '1c080:dragonborn.esm': 2,
    '1db4e:skyrim.esm': 1,
    '1db9:dawnguard.esm': 1,
    '1ede2:dragonborn.esm': 3,
    '21594:skyrim.esm': 1,
    '216bb:skyrim.esm': 1,
    '22f53:skyrim.esm': 3,
    '25e24:skyrim.esm': 1,
    '26e93:dragonborn.esm': 1,
    '27f1a:skyrim.esm': 1,
    '285a:dawnguard.esm': 2,
    '285b:dawnguard.esm': 2,
    '285d:dawnguard.esm': 1,
    '2954c:skyrim.esm': 2,
    '2bcd7:skyrim.esm': 1,
    '2d524:skyrim.esm': 1,
    '2d525:skyrim.esm': 1,
    '2f83e:skyrim.esm': 3,
    '3109d:dragonborn.esm': 3,
    '336fb:skyrim.esm': 3,
    '3377b:dragonborn.esm': 1,
    '33d68:skyrim.esm': 3,
    '34864:skyrim.esm': 1,
    '3486e:skyrim.esm': 1,
    '35299:skyrim.esm': 2,
    '3538d:skyrim.esm': 1,
    '35604:skyrim.esm': 1,
    '362d8:skyrim.esm': 1,
    '371dd:skyrim.esm': 1,
    '371de:skyrim.esm': 1,
    '37d7:dawnguard.esm': 1,
    '3b065:dragonborn.esm': 3,
    '3b696:skyrim.esm': 1,
    '3b698:skyrim.esm': 1,
    '3bf0:dawnguard.esm': 2,
    '3c7f5:dragonborn.esm': 4,
    '3e908:skyrim.esm': 2,
    '3ff10:skyrim.esm': 1,
    '41777:skyrim.esm': 1,
    '4346:dawnguard.esm': 2,
    '4401b:skyrim.esm': 2,
    '4624f:skyrim.esm': 3,
    '4b8fb:skyrim.esm': 1,
    '4bbac:skyrimsewers.esp': 1,
    '52feb:skyrim.esm': 2,
    '54226:skyrim.esm': 1,
    '55215:skyrim.esm': 2,
    '58b4d:skyrim.esm': 2,
    '5900:arena - markarth side.esp': 2,
    '59398:skyrim.esm': 2,
    '597d4:skyrim.esm': 2,
    '5a01a:skyrim.esm': 1,
    '5b88b:skyrim.esm': 1,
    '5e1f9:skyrimsewers.esp': 1,
    '5eab:dawnguard.esm': 1,
    '5f496:skyrimsewers.esp': 1,
    '5f536:skyrim.esm': 1,
    '6429:dawnguard.esm': 2,
    '67f2a:skyrim.esm': 2,
    '681dd:skyrim.esm': 1,
    '68b99:skyrim.esm': 1,
    '6ccbb:skyrim.esm': 1,
    '6daa0:skyrim.esm': 1,
    '7284e:skyrim.esm': 2,
    '75669:skyrim.esm': 1,
    '81dec:skyrim.esm': 1,
    '83559:skyrim.esm': 3,
    '8995:dawnguard.esm': 2,
    '8b84d:skyrim.esm': 1,
    '8e52:dawnguard.esm': 2,
    '94bab:skyrim.esm': 1,
    '9aa4a:skyrim.esm': 2,
    'a013b:skyrim.esm': 1,
    'a0877:skyrim.esm': 1,
    'a1a61:skyrim.esm': 1,
    'a1bfd:skyrim.esm': 1,
    'a5a71:skyrim.esm': 1,
    'a73f4:skyrim.esm': 1,
    'a87c5:skyrim.esm': 2,
    'aa20c:skyrim.esm': 2,
    'ab531:skyrim.esm': 1,
    'abd31:skyrim.esm': 1,
    'ae783:skyrim.esm': 1,
    'bbb2f:skyrim.esm': 1,
    'be46a:skyrim.esm': 2,
    'd9dc7:skyrim.esm': 1,
    'dd216:skyrim.esm': 1,
    'eb8:dawnguard.esm': 1,
  };

  /*
    NO POTION IN THE PILE (#3470). Patrick, 26 Oct 2026, A on the report
    page: a bottle the alchemy lab brews is a new form, never one of
    Skyrim's potion records, so a potion here was one nobody could make.
    Each of the ten is an ingredient now, one that carries the same effect
    and that a Gatherer or a Hunter gathers (scripts\dev\Check-Makers.js
    holds every row to a maker), at the same tier and weight.
  */
  var GOODS = [
    { desc: 'a:Skyrim.esm', name: 'lockpick', plural: 'lockpicks', count: 2, weight: 16, tier: 1 },
    { desc: '34cdf:Skyrim.esm', name: 'salt pile', plural: 'salt piles', count: 2, weight: 12, tier: 1 },
    { desc: '34cdd:Skyrim.esm', name: 'bone meal', plural: 'bone meal', count: 2, weight: 12, tier: 1 },
    { desc: '5ace4:Skyrim.esm', name: 'iron ingot', plural: 'iron ingots', count: 1, weight: 10, tier: 1 },
    { desc: '800e4:Skyrim.esm', name: 'leather strip', plural: 'leather strips', count: 3, weight: 8, tier: 1 },
    { desc: '2e4e2:Skyrim.esm', name: 'petty soul gem', plural: 'petty soul gems', count: 1, weight: 8, tier: 1 },
    { desc: '4da23:Skyrim.esm', name: 'imp stool', plural: 'imp stools', count: 2, weight: 10, tier: 1 },
    { desc: '516c8:Skyrim.esm', name: 'deathbell', plural: 'deathbells', count: 2, weight: 6, tier: 1 },
    { desc: '2f44c:Skyrim.esm', name: 'nightshade', plural: 'nightshade', count: 2, weight: 6, tier: 2 },
    { desc: '5ace5:Skyrim.esm', name: 'steel ingot', plural: 'steel ingots', count: 1, weight: 8, tier: 2 },
    { desc: '63b45:Skyrim.esm', name: 'garnet', plural: 'garnets', count: 1, weight: 5, tier: 2 },
    { desc: '2e4e4:Skyrim.esm', name: 'lesser soul gem', plural: 'lesser soul gems', count: 1, weight: 6, tier: 2 },
    { desc: '7e8b7:Skyrim.esm', name: 'swamp fungal pod', plural: 'swamp fungal pods', count: 2, weight: 6, tier: 2 },
    { desc: '5ace3:Skyrim.esm', name: 'silver ingot', plural: 'silver ingots', count: 1, weight: 4, tier: 2 },
    { desc: '5ad93:Skyrim.esm', name: 'corundum ingot', plural: 'corundum ingots', count: 1, weight: 5, tier: 3 },
    { desc: '63b46:Skyrim.esm', name: 'amethyst', plural: 'amethysts', count: 1, weight: 4, tier: 3 },
    { desc: '2e4e6:Skyrim.esm', name: 'common soul gem', plural: 'common soul gems', count: 1, weight: 4, tier: 3 },
    { desc: '5ad9e:Skyrim.esm', name: 'gold ingot', plural: 'gold ingots', count: 1, weight: 3, tier: 3 },
    { desc: '5ad99:Skyrim.esm', name: 'orichalcum ingot', plural: 'orichalcum ingots', count: 1, weight: 4, tier: 4 },
    { desc: '5ad9d:Skyrim.esm', name: 'ebony ingot', plural: 'ebony ingots', count: 1, weight: 3, tier: 4 },
    { desc: '2e4f4:Skyrim.esm', name: 'greater soul gem', plural: 'greater soul gems', count: 1, weight: 3, tier: 4 },
    { desc: '68521:Skyrim.esm', name: 'flawless garnet', plural: 'flawless garnets', count: 1, weight: 2, tier: 4 },
    { desc: '2e4fc:Skyrim.esm', name: 'grand soul gem', plural: 'grand soul gems', count: 1, weight: 2, tier: 4 },
    { desc: '77e1d:Skyrim.esm', name: 'red mountain flower', plural: 'red mountain flowers', count: 3, weight: 6, tier: 2 },
    { desc: '77e1d:Skyrim.esm', name: 'red mountain flower', plural: 'red mountain flowers', count: 2, weight: 8, tier: 1 },
    { desc: '77e1e:Skyrim.esm', name: 'purple mountain flower', plural: 'purple mountain flowers', count: 3, weight: 6, tier: 2 },
    { desc: '77e1e:Skyrim.esm', name: 'purple mountain flower', plural: 'purple mountain flowers', count: 2, weight: 8, tier: 1 },
    { desc: '1b3bd:Skyrim.esm', name: 'snowberries', plural: 'snowberries', count: 2, weight: 4, tier: 2 },
    { desc: '7ee01:Skyrim.esm', name: 'glowing mushroom', plural: 'glowing mushrooms', count: 2, weight: 4, tier: 2 },
    { desc: '6bc07:Skyrim.esm', name: 'eye of sabre cat', plural: 'eyes of sabre cat', count: 1, weight: 4, tier: 3 },
    { desc: '6bc07:Skyrim.esm', name: 'eye of sabre cat', plural: 'eyes of sabre cat', count: 2, weight: 3, tier: 4 },
    { desc: '34c5e:Skyrim.esm', name: 'ale', plural: 'ales', count: 1, weight: 8, tier: 1 },
    { desc: '65c98:Skyrim.esm', name: 'bread', plural: 'loaves of bread', count: 1, weight: 8, tier: 1 },
    { desc: '64b31:Skyrim.esm', name: 'goat cheese wedge', plural: 'goat cheese wedges', count: 1, weight: 6, tier: 1 },
    { desc: '64b3f:Skyrim.esm', name: 'cabbage', plural: 'cabbages', count: 1, weight: 6, tier: 1 },
    { desc: '64b41:Skyrim.esm', name: 'potato', plural: 'potatoes', count: 2, weight: 6, tier: 1 },
    { desc: '669a2:Skyrim.esm', name: 'venison', plural: 'venison', count: 1, weight: 5, tier: 2 },
    { desc: '64b38:Skyrim.esm', name: 'honey nut treat', plural: 'honey nut treats', count: 1, weight: 5, tier: 1 },
    { desc: '64b3d:Skyrim.esm', name: 'sweet roll', plural: 'sweet rolls', count: 1, weight: 5, tier: 1 },
    { desc: '64b32:Skyrim.esm', name: 'eidar cheese wedge', plural: 'eidar cheese wedges', count: 1, weight: 5, tier: 1 },
    { desc: '64b3e:Skyrim.esm', name: 'grilled leeks', plural: 'grilled leeks', count: 1, weight: 4, tier: 2 },
    { desc: '64b3a:Skyrim.esm', name: 'baked potatoes', plural: 'baked potatoes', count: 1, weight: 4, tier: 2 },
    { desc: '64b30:Skyrim.esm', name: 'boiled creme treat', plural: 'boiled creme treats', count: 1, weight: 4, tier: 2 },
    { desc: '71cf3:Skyrim.esm', name: 'iron ore', plural: 'iron ore', count: 2, weight: 8, tier: 1 },
    { desc: '5acdf:Skyrim.esm', name: 'silver ore', plural: 'silver ore', count: 1, weight: 4, tier: 2 },
    { desc: '5acde:Skyrim.esm', name: 'gold ore', plural: 'gold ore', count: 1, weight: 3, tier: 3 },
    { desc: '5acdb:Skyrim.esm', name: 'corundum ore', plural: 'corundum ore', count: 1, weight: 4, tier: 2 },
    { desc: '5acdc:Skyrim.esm', name: 'ebony ore', plural: 'ebony ore', count: 1, weight: 2, tier: 4 },
    { desc: '63b42:Skyrim.esm', name: 'ruby', plural: 'rubies', count: 1, weight: 3, tier: 3 },
    { desc: '63b44:Skyrim.esm', name: 'sapphire', plural: 'sapphires', count: 1, weight: 3, tier: 3 },
    { desc: '63b43:Skyrim.esm', name: 'emerald', plural: 'emeralds', count: 1, weight: 3, tier: 3 },
    { desc: '63b47:Skyrim.esm', name: 'diamond', plural: 'diamonds', count: 1, weight: 2, tier: 4 },
    { desc: '6851f:Skyrim.esm', name: 'flawless diamond', plural: 'flawless diamonds', count: 1, weight: 1, tier: 4 },
    { desc: '3ad5e:Skyrim.esm', name: 'fire salts', plural: 'fire salts', count: 1, weight: 4, tier: 2 },
    { desc: '3ad5f:Skyrim.esm', name: 'frost salts', plural: 'frost salts', count: 1, weight: 4, tier: 2 },
    { desc: '3ad60:Skyrim.esm', name: 'void salts', plural: 'void salts', count: 1, weight: 3, tier: 3 },
    { desc: '34d22:Skyrim.esm', name: 'garlic', plural: 'garlic', count: 2, weight: 6, tier: 1 },
    { desc: '45c28:Skyrim.esm', name: 'lavender', plural: 'lavender', count: 2, weight: 6, tier: 1 },
    { desc: '77e1c:Skyrim.esm', name: 'blue mountain flower', plural: 'blue mountain flowers', count: 2, weight: 5, tier: 1 },
    { desc: '4b0ba:Skyrim.esm', name: 'wheat', plural: 'wheat', count: 2, weight: 6, tier: 1 },
    { desc: '669a5:Skyrim.esm', name: 'leek', plural: 'leeks', count: 2, weight: 6, tier: 1 },
    { desc: '12eb7:Skyrim.esm', name: 'iron sword', plural: 'iron swords', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '13790:Skyrim.esm', name: 'iron war axe', plural: 'iron war axes', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '1397e:Skyrim.esm', name: 'iron dagger', plural: 'iron daggers', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '1359d:Skyrim.esm', name: 'iron greatsword', plural: 'iron greatswords', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '13982:Skyrim.esm', name: 'iron mace', plural: 'iron maces', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '12e4d:Skyrim.esm', name: 'iron helmet', plural: 'iron helmets', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '12e49:Skyrim.esm', name: 'iron armor', plural: 'iron armor', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '12e4b:Skyrim.esm', name: 'iron boots', plural: 'iron boots', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '12e46:Skyrim.esm', name: 'iron gauntlets', plural: 'iron gauntlets', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '12eb6:Skyrim.esm', name: 'iron shield', plural: 'iron shields', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '13985:Skyrim.esm', name: 'hunting bow', plural: 'hunting bows', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '3b562:Skyrim.esm', name: 'long bow', plural: 'long bows', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '1397d:Skyrim.esm', name: 'iron arrow', plural: 'iron arrows', count: 8, weight: 2, tier: 1, kind: 'gear' },
    { desc: '13911:Skyrim.esm', name: 'hide armor', plural: 'hide armor', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '13913:Skyrim.esm', name: 'hide helmet', plural: 'hide helmets', count: 1, weight: 2, tier: 1, kind: 'gear' },
    { desc: '13989:Skyrim.esm', name: 'steel sword', plural: 'steel swords', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13983:Skyrim.esm', name: 'steel war axe', plural: 'steel war axes', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13986:Skyrim.esm', name: 'steel dagger', plural: 'steel daggers', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13954:Skyrim.esm', name: 'steel helmet', plural: 'steel helmets', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13952:Skyrim.esm', name: 'steel armor', plural: 'steel armor', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13955:Skyrim.esm', name: 'steel shield', plural: 'steel shields', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '1397f:Skyrim.esm', name: 'steel arrow', plural: 'steel arrows', count: 8, weight: 2, tier: 2, kind: 'gear' },
    { desc: '3619e:Skyrim.esm', name: 'leather armor', plural: 'leather armor', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13922:Skyrim.esm', name: 'leather helmet', plural: 'leather helmets', count: 1, weight: 2, tier: 2, kind: 'gear' },
    { desc: '13991:Skyrim.esm', name: 'orcish sword', plural: 'orcish swords', count: 1, weight: 1, tier: 3, kind: 'gear' },
    { desc: '13999:Skyrim.esm', name: 'dwarven sword', plural: 'dwarven swords', count: 1, weight: 1, tier: 3, kind: 'gear' },
    { desc: '139a1:Skyrim.esm', name: 'elven sword', plural: 'elven swords', count: 1, weight: 1, tier: 3, kind: 'gear' },
    { desc: '139b1:Skyrim.esm', name: 'ebony sword', plural: 'ebony swords', count: 1, weight: 1, tier: 4, kind: 'gear' },
    { desc: '139a9:Skyrim.esm', name: 'glass sword', plural: 'glass swords', count: 1, weight: 1, tier: 4, kind: 'gear' },
    { desc: '13961:Skyrim.esm', name: 'ebony armor', plural: 'ebony armor', count: 1, weight: 1, tier: 4, kind: 'gear' },
    { desc: '13939:Skyrim.esm', name: 'glass armor', plural: 'glass armor', count: 1, weight: 1, tier: 4, kind: 'gear' }
  ];

  var TOMES = {
    novice: [
      { desc: '9cd51:Skyrim.esm', name: 'Spell Tome: Flames' },
      { desc: '9cd52:Skyrim.esm', name: 'Spell Tome: Frostbite' },
      { desc: '9cd53:Skyrim.esm', name: 'Spell Tome: Sparks' },
      { desc: '9e2af:Skyrim.esm', name: 'Spell Tome: Healing' },
      { desc: '9e2ae:Skyrim.esm', name: 'Spell Tome: Lesser Ward' },
      { desc: '9e2a8:Skyrim.esm', name: 'Spell Tome: Oakflesh' },
      { desc: '9e2ab:Skyrim.esm', name: 'Spell Tome: Conjure Familiar' },
      { desc: '9e2ad:Skyrim.esm', name: 'Spell Tome: Courage' },
      { desc: '9e2ac:Skyrim.esm', name: 'Spell Tome: Fury' },
      { desc: '9e2a7:Skyrim.esm', name: 'Spell Tome: Candlelight' },
      { desc: 'ff7d1:Skyrim.esm', name: 'Spell Tome: Clairvoyance' }
    ],
    apprentice: [
      { desc: 'a26fd:Skyrim.esm', name: 'Spell Tome: Firebolt' },
      { desc: 'a26fe:Skyrim.esm', name: 'Spell Tome: Ice Spike' },
      { desc: 'a26ff:Skyrim.esm', name: 'Spell Tome: Lightning Bolt' },
      { desc: 'a271e:Skyrim.esm', name: 'Spell Tome: Healing Hands' },
      { desc: 'a271d:Skyrim.esm', name: 'Spell Tome: Fast Healing' },
      { desc: 'a270f:Skyrim.esm', name: 'Spell Tome: Muffle' },
      { desc: 'a26e3:Skyrim.esm', name: 'Spell Tome: Stoneflesh' },
      { desc: 'a26e2:Skyrim.esm', name: 'Spell Tome: Magelight' },
      { desc: '9e2a9:Skyrim.esm', name: 'Spell Tome: Bound Sword' },
      { desc: 'a26ec:Skyrim.esm', name: 'Spell Tome: Conjure Flame Atronach' },
      { desc: 'a26eb:Skyrim.esm', name: 'Spell Tome: Reanimate Corpse' },
      { desc: 'a2711:Skyrim.esm', name: 'Spell Tome: Calm' },
      { desc: 'a2712:Skyrim.esm', name: 'Spell Tome: Fear' },
      { desc: '9cd54:Skyrim.esm', name: 'Spell Tome: Soul Trap' },
      { desc: 'a271f:Skyrim.esm', name: 'Spell Tome: Turn Lesser Undead' }
    ],
    adept: [
      { desc: 'a2706:Skyrim.esm', name: 'Spell Tome: Fireball' },
      { desc: 'a2707:Skyrim.esm', name: 'Spell Tome: Ice Storm' },
      { desc: 'a2708:Skyrim.esm', name: 'Spell Tome: Chain Lightning' },
      { desc: 'a2700:Skyrim.esm', name: 'Spell Tome: Fire Rune' },
      { desc: 'a2701:Skyrim.esm', name: 'Spell Tome: Frost Rune' },
      { desc: 'a2702:Skyrim.esm', name: 'Spell Tome: Lightning Rune' },
      { desc: 'a2727:Skyrim.esm', name: 'Spell Tome: Heal Other' },
      { desc: 'a2720:Skyrim.esm', name: 'Spell Tome: Steadfast Ward' },
      { desc: 'a2721:Skyrim.esm', name: 'Spell Tome: Turn Undead' },
      { desc: 'a26e4:Skyrim.esm', name: 'Spell Tome: Ironflesh' },
      { desc: 'a26e6:Skyrim.esm', name: 'Spell Tome: Waterbreathing' },
      { desc: 'a26e5:Skyrim.esm', name: 'Spell Tome: Telekinesis' },
      { desc: 'a26e7:Skyrim.esm', name: 'Spell Tome: Detect Life' },
      { desc: 'a2713:Skyrim.esm', name: 'Spell Tome: Rally' },
      { desc: 'a2714:Skyrim.esm', name: 'Spell Tome: Frenzy' },
      { desc: 'a2717:Skyrim.esm', name: 'Spell Tome: Pacify' },
      { desc: 'a26ef:Skyrim.esm', name: 'Spell Tome: Conjure Frost Atronach' },
      { desc: 'a26ed:Skyrim.esm', name: 'Spell Tome: Bound Battleaxe' },
      { desc: 'a2703:Skyrim.esm', name: 'Spell Tome: Flame Cloak' },
      { desc: 'a2704:Skyrim.esm', name: 'Spell Tome: Frost Cloak' },
      { desc: 'a2705:Skyrim.esm', name: 'Spell Tome: Lightning Cloak' }
    ],
    expert: [
      { desc: 'a2709:Skyrim.esm', name: 'Spell Tome: Wall of Flames' },
      { desc: 'a270a:Skyrim.esm', name: 'Spell Tome: Wall of Frost' },
      { desc: 'a270b:Skyrim.esm', name: 'Spell Tome: Wall of Storms' },
      { desc: 'a26e9:Skyrim.esm', name: 'Spell Tome: Ebonyflesh' },
      { desc: 'a26e8:Skyrim.esm', name: 'Spell Tome: Paralyze' },
      { desc: 'a2715:Skyrim.esm', name: 'Spell Tome: Invisibility' },
      { desc: 'a2718:Skyrim.esm', name: 'Spell Tome: Rout' },
      { desc: 'dd643:Skyrim.esm', name: 'Spell Tome: Grand Healing' },
      { desc: 'a2729:Skyrim.esm', name: 'Spell Tome: Turn Greater Undead' },
      { desc: 'a26f8:Skyrim.esm', name: 'Spell Tome: Expel Daedra' },
      { desc: 'a26f7:Skyrim.esm', name: 'Spell Tome: Dread Zombie' },
      { desc: 'a26f1:Skyrim.esm', name: 'Spell Tome: Bound Bow' },
      { desc: 'a26f0:Skyrim.esm', name: 'Spell Tome: Conjure Storm Atronach' },
      { desc: 'a26ea:Skyrim.esm', name: 'Spell Tome: Detect Undead' }
    ],
    master: [
      { desc: 'a270c:Skyrim.esm', name: 'Spell Tome: Fire Storm' },
      { desc: 'a270d:Skyrim.esm', name: 'Spell Tome: Blizzard' },
      { desc: 'a270e:Skyrim.esm', name: 'Spell Tome: Lightning Storm' },
      { desc: 'd2b4e:Skyrim.esm', name: 'Spell Tome: Dragonhide' },
      { desc: 'dd646:Skyrim.esm', name: 'Spell Tome: Mass Paralysis' },
      { desc: 'a2719:Skyrim.esm', name: 'Spell Tome: Mayhem' },
      { desc: 'a271c:Skyrim.esm', name: 'Spell Tome: Hysteria' },
      { desc: 'a271b:Skyrim.esm', name: 'Spell Tome: Call To Arms' },
      { desc: 'dd647:Skyrim.esm', name: 'Spell Tome: Bane of the Undead' },
      { desc: 'fde7b:Skyrim.esm', name: 'Spell Tome: Guardian Circle' },
      { desc: 'a26f9:Skyrim.esm', name: 'Spell Tome: Dead Thrall' },
      { desc: 'a26fa:Skyrim.esm', name: 'Spell Tome: Flame Thrall' },
      { desc: 'a26fb:Skyrim.esm', name: 'Spell Tome: Frost Thrall' },
      { desc: 'a26fc:Skyrim.esm', name: 'Spell Tome: Storm Thrall' },
      { desc: 'a271a:Skyrim.esm', name: 'Spell Tome: Harmony' }
    ]
  };

  /*
    Found in a dungeon and nowhere else on this table. Not the ordinary
    weapon pile above, and not a company ware. The world puts nothing
    in a container (#3078). What this list creates is the burial set.
  */
  var EXCLUSIVE = [
    { desc: 'cc842:Skyrim.esm', name: 'Ancient Nord Amulet', tier: 1, weight: 8 },
    { desc: '2c66f:Skyrim.esm', name: 'Ancient Nord Sword', tier: 2, weight: 5 },
    { desc: '2c672:Skyrim.esm', name: 'Ancient Nord War Axe', tier: 2, weight: 5 },
    { desc: '34182:Skyrim.esm', name: 'Ancient Nord Arrow', tier: 2, weight: 4, count: 8 },
    { desc: '302ca:Skyrim.esm', name: 'Ancient Nord Bow', tier: 3, weight: 4 },
    { desc: '56a9e:Skyrim.esm', name: 'Ancient Nord Helmet', tier: 3, weight: 4 },
    { desc: '56a9d:Skyrim.esm', name: 'Ancient Nord Boots', tier: 3, weight: 3 },
    { desc: '56b17:Skyrim.esm', name: 'Ancient Nord Gauntlets', tier: 3, weight: 3 },
    { desc: '18388:Skyrim.esm', name: 'Ancient Nord Armor', tier: 3, weight: 3 },
    { desc: '236a5:Skyrim.esm', name: 'Ancient Nord Greatsword', tier: 4, weight: 3 },
    { desc: '1cb64:Skyrim.esm', name: 'Ancient Nord Battleaxe', tier: 4, weight: 3 },
    { desc: '2e500:Skyrim.esm', name: 'Black Soul Gem', tier: 4, weight: 2 }
  ];

  function clampTier(tier) {
    tier = Number(tier) || 1;
    if (tier < 1) return 1;
    if (tier > 4) return 4;
    return tier;
  }

  function tierOf(desc) {
    var key = String(desc || '').toLowerCase();
    return CELLS[key] || 0;
  }

  function ranksFor(tier) {
    var rows = RANK_WEIGHT[clampTier(tier)] || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) out.push(rows[i][0]);
    return out;
  }

  function pickWeighted(list, rng) {
    var total = 0;
    var i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    if (!total) return null;
    var n = rng() * total;
    for (i = 0; i < list.length; i++) {
      n -= list[i].weight;
      if (n < 0) return list[i];
    }
    return list[list.length - 1];
  }

  function goodsFor(tier) {
    var out = [];
    for (var i = 0; i < GOODS.length; i++) {
      if (GOODS[i].tier <= tier) out.push(GOODS[i]);
    }
    return out;
  }

  function exclusiveFor(tier) {
    var out = [];
    for (var i = 0; i < EXCLUSIVE.length; i++) {
      if (EXCLUSIVE[i].tier <= tier) out.push(EXCLUSIVE[i]);
    }
    return out;
  }

  function tomesFor(tier) {
    var ranks = ranksFor(tier);
    var out = [];
    for (var i = 0; i < ranks.length; i++) {
      var list = TOMES[ranks[i]] || [];
      for (var j = 0; j < list.length; j++) {
        out.push({ desc: list[j].desc, name: list[j].name, rank: ranks[i] });
      }
    }
    return out;
  }

  function mergeItems(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var hit = null;
      for (var j = 0; j < out.length; j++) {
        if (out[j].desc === it.desc) { hit = out[j]; break; }
      }
      if (hit) { hit.count += it.count; }
      else {
        out.push({
          desc: it.desc, name: it.name, plural: it.plural || it.name,
          count: it.count, exclusive: !!it.exclusive, rank: it.rank || ''
        });
      }
    }
    return out;
  }

  /*
    THE BOSS CHEST'S EXTRAS (#510). Patrick, 12 October 2026, on top of the
    tier above: every boss chest holds a tome or a burial piece for certain,
    and a boss chest in a tier 4 place, which has no tier above it, rolls the
    burial piece a second time. The ordinary rolls run first, in the order
    every other chest rolls them; when neither a tome nor a burial piece came
    of them, one of the two is put in, the tome or the burial piece in
    proportion to how likely each is at that tier.
  */
  function addTome(items, tier, rng) {
    var rank = pickWeighted(RANK_WEIGHT[tier].map(function (row) {
      return { weight: row[1], rank: row[0] };
    }), rng);
    var books = TOMES[rank.rank] || [];
    if (!books.length) return false;
    var book = books[Math.floor(rng() * books.length)];
    items.push({
      desc: book.desc, name: book.name, plural: book.name,
      count: 1, exclusive: false, rank: rank.rank
    });
    return true;
  }

  function addExclusive(items, tier, rng) {
    var excl = pickWeighted(exclusiveFor(tier), rng);
    if (!excl) return false;
    items.push({
      desc: excl.desc, name: excl.name, plural: excl.name,
      count: excl.count || 1, exclusive: true
    });
    return true;
  }

  function roll(tier, rng, boss) {
    tier = clampTier(tier);
    if (typeof rng !== 'function') rng = Math.random;
    var span = GOLD_SPAN[tier];
    var gold = span[0] + Math.floor(rng() * (span[1] - span[0] + 1));
    var items = [];
    var pool = goodsFor(tier);
    var draw;
    for (draw = 0; draw < 2; draw++) {
      if (rng() < GOODS_CHANCE[tier]) {
        var good = pickWeighted(pool, rng);
        if (good) {
          items.push({
            desc: good.desc, name: good.name, plural: good.plural,
            count: good.count, exclusive: false
          });
        }
      }
    }
    var tome = false, burial = false;
    if (rng() < TOME_CHANCE[tier]) tome = addTome(items, tier, rng);
    if (rng() < EXCL_CHANCE[tier]) burial = addExclusive(items, tier, rng);
    if (boss && boss.secondExclusive && rng() < EXCL_CHANCE[tier]) {
      burial = addExclusive(items, tier, rng) || burial;
    }
    if (boss && !tome && !burial) {
      var tomeShare = TOME_CHANCE[tier] / (TOME_CHANCE[tier] + EXCL_CHANCE[tier]);
      if (rng() < tomeShare) addTome(items, tier, rng);
      else addExclusive(items, tier, rng);
    }
    return { tier: tier, gold: gold, items: mergeItems(items) };
  }

  function article(label) {
    if (/^[0-9]/.test(label)) return label;
    return (/^[aeiou]/i.test(label) ? 'an ' : 'a ') + label;
  }

  function heldLine(rolled) {
    var bits = [];
    if (rolled.gold) bits.push(rolled.gold + ' gold');
    var items = rolled.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.count > 1) bits.push(it.count + ' ' + (it.plural || it.name));
      else bits.push(article(it.name));
    }
    if (!bits.length) return '';
    var body = bits.length === 1
      ? bits[0]
      : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
    return 'The chest held ' + body + '.';
  }

  function edidOf(baseId) {
    var found = null;
    try { found = mp.lookupEspmRecordById(baseId); } catch (e) { return ''; }
    var fields = (found && found.record && found.record.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (String(fields[i].type) !== 'EDID') continue;
      var bytes = fields[i].data || [];
      var text = '';
      for (var b = 0; b < bytes.length; b++) {
        if (!bytes[b]) break;
        text += String.fromCharCode(bytes[b]);
      }
      return text;
    }
    return '';
  }

  function isLootContainer(name) {
    if (!name) return false;
    if (SKIP_WORD.test(name.replace(NOT_SKIP, ''))) return false;
    return LOOT_WORD.test(name.replace(NOT_LOOT, ''));
  }

  function give(actorId, rolled) {
    var goods=[];
    if(rolled.gold>0) goods.push({item:GOLD_DESC,count:rolled.gold});
    for(var item of rolled.items) {
      if(item && item.count>0) goods.push({item:item.desc,count:item.count});
    }
    if(!goods.length) return true;
    try {return addItemsAtomic(actorId,goods);} catch(error) {
      console.log('[dungeon] reserved reward inventory write failed: '+error);return false;
    }
  }

  /*
    Called when a container is opened. The container itself holds nothing
    the world put there (#3078). The pile goes into the pack of the person
    who opened it, not into the container, because it pays once and to
    them (docs\systems\dungeon-loot.md, What opens).
  */
  function onChest(actorId, refrId) {
    if(!active || !ledger) return null;
    if (!actorId || !refrId) return null;
    if (refrId >= 0xff000000) return null;
    try {
      var actorState=mp.getNpcAIState(actorId);
      if(!actorState || (!actorState.isHuman && !(actorState.profileId>0)) || actorState.isDead ||
        actorState.isDisabled || !withinResourceReach(actorId,refrId)) return null;
    } catch(error) {return null;}
    var cell = '';
    try { cell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { return null; }
    var tier = tierOf(cell);
    if (!tier) return null;
    var baseDesc = '';
    try { baseDesc = String(mp.get(refrId, 'baseDesc') || ''); } catch (e2) { return null; }
    var baseId = 0;
    try { baseId = idOf(baseDesc); } catch (e3) { return null; }
    if (!baseId) return null;
    var baseName = edidOf(baseId);
    if (!isLootContainer(baseName)) return null;
    var now = Date.now();
    var reference='';
    try {reference=mp.getDescFromId(refrId);} catch(error) {return null;}
    if(typeof reference!=='string' || !/^[0-9a-f]{1,8}:[^:]+\.es[mpl]$/i.test(reference)) return null;
    var prior=ledger.entries[reference],last=prior ? prior.at : 0;
    var wait = RETURN_MIN[tier] * 60000;
    if (last && (now - last) < wait) return null;
    var boss = BOSS_WORD.test(baseName);
    var rolled = roll(payTierFor(tier, baseName), Math.random,
      boss ? { secondExclusive: tier === 4 } : null);
    var next=JSON.parse(JSON.stringify(ledger));
    next.entries[reference]={at:now,actor:actorId,tier:rolled.tier,gold:rolled.gold,items:rolled.items};
    // Reserve durably before touching inventory. The ledger is the only
    // record of when a chest paid, so an uncertain inventory write cannot be
    // replayed by reopening or reload.
    try {storage.save(next);} catch(error) {console.log('[dungeon] reservation failed: '+error);return null;}
    ledger=next;
    if (!give(actorId, rolled)) return null;
    var line = heldLine(rolled);
    if (line) {
      try { say(actorId, line); } catch (e6) { /* the pile is already in the pack */ }
    }
    try {
      console.log('[dungeon] tier ' + tier + (rolled.tier !== tier ? ' boss chest paid tier ' + rolled.tier + ',' : '') +
        ' paid ' + rolled.gold + ' gold from ' + cell);
    } catch (e7) { /* logging is not the pay */ }
    return rolled;
  }


  /*
    A body is not a chest. The pile is rolled when the actor dies and kept
    on that life until somebody searches it or the actor stands back up.
    A camp enemy carries a little. Anything good on any other body is rare.
    A person is not searched. A hunter carcass stays on the hunter path.
  */
  var BODY_CAMP = { gold: 0.80, goldN: 6, minor: 0.65, decent: 0.08, good: 0.015, rare: 0.002 };
  var BODY_WILD = { gold: 0.20, goldN: 4, minor: 0.12, decent: 0.02, good: 0.005, rare: 0.0005 };
  var places = null;

  function populationKeep() {
    var data = null;
    try {
      if (typeof NPC_POPULATION_DATA !== 'undefined' && NPC_POPULATION_DATA && NPC_POPULATION_DATA.keep) {
        data = NPC_POPULATION_DATA;
      }
    } catch (e) { data = null; }
    if (!data && typeof globalThis !== 'undefined' && globalThis.NPC_POPULATION_DATA) {
      data = globalThis.NPC_POPULATION_DATA;
    }
    return (data && data.keep) || [];
  }

  function placeMap() {
    if (places) return places;
    places = {};
    var keep = populationKeep();
    for (var i = 0; i < keep.length; i++) {
      var row = keep[i];
      if (!row || !row[0]) continue;
      places[String(row[0]).toLowerCase()] = { role: row[6], habitat: row[7] };
    }
    return places;
  }

  function placeOf(actorId) {
    var source = '';
    try {
      var home = mp.get(actorId, 'thornswoodNpcHome');
      if (home && home.source) source = String(home.source);
    } catch (e) { source = ''; }
    if (!source) {
      try { source = String(mp.getDescFromId(actorId) || ''); } catch (e2) { source = ''; }
    }
    return placeMap()[source.toLowerCase()] || null;
  }

  function isCampEnemy(actorId) {
    var row = placeOf(actorId);
    return !!(row && row.role === 'enemy' &&
      (row.habitat === 'bandit-camp' || row.habitat === 'giant-camp'));
  }

  function supplyExact(tier) {
    var out = [];
    for (var i = 0; i < GOODS.length; i++) {
      if (GOODS[i].kind === 'gear') continue;
      if (GOODS[i].tier === tier) out.push(GOODS[i]);
    }
    return out;
  }

  function gearOrNovice() {
    var out = [];
    var i;
    for (i = 0; i < GOODS.length; i++) {
      if (GOODS[i].kind === 'gear' && GOODS[i].tier <= 2) out.push(GOODS[i]);
    }
    var books = TOMES.novice || [];
    for (i = 0; i < books.length; i++) {
      out.push({
        desc: books[i].desc, name: books[i].name, plural: books[i].name,
        count: 1, weight: 1, rank: 'novice'
      });
    }
    return out;
  }

  function rarePile() {
    var out = [];
    var books = TOMES.master || [];
    var i;
    for (i = 0; i < books.length; i++) {
      out.push({
        desc: books[i].desc, name: books[i].name, plural: books[i].name,
        count: 1, weight: 1, rank: 'master'
      });
    }
    for (i = 0; i < EXCLUSIVE.length; i++) {
      out.push({
        desc: EXCLUSIVE[i].desc, name: EXCLUSIVE[i].name, plural: EXCLUSIVE[i].name,
        count: EXCLUSIVE[i].count || 1, weight: EXCLUSIVE[i].weight, exclusive: true
      });
    }
    return out;
  }

  function pushPick(items, row) {
    if (!row) return;
    items.push({
      desc: row.desc, name: row.name, plural: row.plural || row.name,
      count: row.count || 1, exclusive: !!row.exclusive, rank: row.rank || ''
    });
  }

  function rollBody(camp, rng) {
    if (typeof rng !== 'function') rng = Math.random;
    var odds = camp ? BODY_CAMP : BODY_WILD;
    var gold = 0;
    var items = [];
    if (rng() < odds.gold) gold = 1 + Math.floor(rng() * odds.goldN);
    if (gold > 6) gold = 6;
    if (rng() < odds.minor) pushPick(items, pickWeighted(supplyExact(1), rng));
    if (rng() < odds.decent) pushPick(items, pickWeighted(supplyExact(2), rng));
    if (rng() < odds.good) pushPick(items, pickWeighted(gearOrNovice(), rng));
    if (rng() < odds.rare) pushPick(items, pickWeighted(rarePile(), rng));
    return { gold: gold, items: mergeItems(items), camp: !!camp };
  }

  function bodyLine(rolled) {
    var bits = [];
    if (rolled.gold) bits.push(rolled.gold + ' gold');
    var items = rolled.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.count > 1) bits.push(it.count + ' ' + (it.plural || it.name));
      else bits.push(article(it.name));
    }
    if (!bits.length) return '';
    var body = bits.length === 1
      ? bits[0]
      : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
    return 'You take ' + body + ' off the body.';
  }

  function bodyKey(actorId) {
    var reference = '';
    try { reference = mp.getDescFromId(actorId); } catch (e) { return ''; }
    if (typeof reference !== 'string' || !/^[0-9a-f]{1,8}:[^:]+\.es[mpl]$/i.test(reference)) return '';
    return reference;
  }

  function onDeath(actorId) {
    if (!active || !ledger || !actorId) return;
    var baseDesc = '';
    try { baseDesc = String(mp.get(actorId, 'baseDesc') || ''); } catch (e) { return; }
    if (typeof isCarcass === 'function' && isCarcass(baseDesc)) return;
    try {
      if (Number(mp.get(actorId, 'profileId')) > 0) return;
    } catch (e2) { return; }
    var reference = bodyKey(actorId);
    if (!reference || ledger.entries[reference]) return;
    var camp = isCampEnemy(actorId);
    var rolled = rollBody(camp, Math.random);
    var next = JSON.parse(JSON.stringify(ledger));
    next.entries[reference] = {
      kind: 'body', at: Date.now(), taken: false,
      gold: rolled.gold, items: rolled.items, camp: !!camp
    };
    try { storage.save(next); } catch (error) {
      console.log('[dungeon] body reservation failed: ' + error);
      return;
    }
    ledger = next;
  }

  function onStand(actorId) {
    if (!active || !ledger || !actorId) return;
    var reference = bodyKey(actorId);
    if (!reference) return;
    var prior = ledger.entries[reference];
    if (!prior || prior.kind !== 'body') return;
    var next = JSON.parse(JSON.stringify(ledger));
    delete next.entries[reference];
    try { storage.save(next); } catch (error) {
      console.log('[dungeon] body clear failed: ' + error);
      return;
    }
    ledger = next;
  }

  function onBody(actorId, refrId) {
    if (!active || !ledger) return null;
    if (!actorId || !refrId) return null;
    try {
      var actorState = mp.getNpcAIState(actorId);
      if (!actorState || (!actorState.isHuman && !(actorState.profileId > 0)) || actorState.isDead ||
        actorState.isDisabled || !withinResourceReach(actorId, refrId)) return null;
    } catch (error) { return null; }
    var bodyState = null;
    try { bodyState = mp.getNpcAIState(refrId); } catch (e) { return null; }
    if (!bodyState || !bodyState.isDead || bodyState.isDisabled) return null;
    if (bodyState.profileId > 0) return null;
    var baseDesc = '';
    try { baseDesc = String(mp.get(refrId, 'baseDesc') || ''); } catch (e2) { return null; }
    if (typeof isCarcass === 'function' && isCarcass(baseDesc)) return null;
    var reference = bodyKey(refrId);
    if (!reference) return null;
    var prior = ledger.entries[reference];
    if (!prior) {
      onDeath(refrId);
      prior = ledger.entries[reference];
    }
    if (!prior || prior.kind !== 'body' || prior.taken) return null;
    var next = JSON.parse(JSON.stringify(ledger));
    next.entries[reference].taken = true;
    try { storage.save(next); } catch (error) {
      console.log('[dungeon] body reservation failed: ' + error);
      return null;
    }
    ledger = next;
    var rolled = { gold: prior.gold, items: prior.items };
    var empty = !(rolled.gold > 0) && !(rolled.items && rolled.items.length);
    if (!empty && !give(actorId, rolled)) return null;
    var line = empty ? 'There is nothing on this body.' : bodyLine(rolled);
    if (line) {
      try { say(actorId, line); } catch (e4) { /* the pile is already in the pack */ }
    }
    return line || null;
  }

  /*
    A DELETED CHARACTER OFF THE CHEST RECORD (#2351). Asked once, as this
    block loads, through __thornswoodRelease, with the list Delete-Person.ps1
    wrote. A
    chest's reservation keeps the character it paid by form id (actor); that
    becomes 0. The reservation itself stays, with its time, tier, gold and
    goods: it is what holds the chest's wait (RETURN_MIN), so cutting it would
    let the chest pay again early, and every pile it records was paid. So the
    record still adds up and only the name is off it. Saved like a
    reservation, durably before it is used. A server where the rewards are not
    kept (not main or dev) has nothing to release; one whose ledger could not
    be read says so, and the list waits.
  */
  function release(who) {
    var c = { chests: 0 };
    if (!active) { return { counts: c, saved: false }; }
    if (!storage || !ledger) { return { counts: c, saved: true }; }
    var next = JSON.parse(JSON.stringify(ledger));
    Object.keys(next.entries).forEach(function (key) {
      var e = next.entries[key];
      if (e && e.kind !== 'body' && e.actor > 0 && who.actor(e.actor)) { e.actor = 0; c.chests++; }
    });
    if (!c.chests) { return { counts: c, saved: true }; }
    try { storage.save(next); } catch (error) {
      console.log('[dungeon] release failed: ' + error);
      return { counts: c, saved: false };
    }
    ledger = next;
    return { counts: c, saved: true };
  }
  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('dungeon', release); }

  g.__thornswoodDungeonLoot = {
    release: release,
    shutdown:function(){active=false;},
    roll: roll,
    rollBody: rollBody,
    onChest: onChest,
    onDeath: onDeath,
    onBody: onBody,
    onStand: onStand,
    tierOf: tierOf,
    payTierFor: payTierFor,
    ranksFor: ranksFor,
    goodsFor: goodsFor,
    exclusiveFor: exclusiveFor,
    tomesFor: tomesFor,
    heldLine: heldLine,
    RETURN_MIN: RETURN_MIN,
    GOLD_SPAN: GOLD_SPAN,
    GOLD_DESC: GOLD_DESC,
    TOME_CHANCE: TOME_CHANCE,
    EXCL_CHANCE: EXCL_CHANCE,
    GOODS_CHANCE: GOODS_CHANCE
  };
})();
// ==== end thornswood dungeon loot ====

