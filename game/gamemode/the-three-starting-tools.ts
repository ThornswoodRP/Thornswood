// ---------------------------------------------------------------------------
// the three starting tools
//
// Patrick, 20 September: 'if you choose miner you should start with a pickaxe,
// unequipped is fine just in the inventory, the woodworker needs to start with
// an axe', and 'let's make it so to be able to farm you need a hoe so give
// farmers a hoe'.
//
// SKYRIM HAS NO HOE. Measured on 20 September across the whole load order, the
// masters and all 96 plugins after them: there is no record of any type that is
// a hoe. The only records that match the word at all are shoes. So the farmer's
// tool is a shovel, which is a real MISC record in Skyrim.esm and the thing
// actually leaning against the walls of the farms people will be standing in.
// The rulebook says so in its own words as well, on the public page, because a
// person who reads 'you need a hoe' and then cannot find one in any shop in the
// province has been told a lie by us and not by the game.
//
// The tool is IN THE PACK and nothing more. Nothing here equips anything: the
// server can write an inventory and cannot make somebody hold a weapon, and
// Patrick asked for unequipped anyway.
//
// Three verbs ask for a tool and no others. Gathering, hunting and fishing do
// not, because Patrick named three tools and three verbs, and inventing a
// skinning knife and a fishing rod to go with them would be a different design
// rather than a best guess at this one.
// ---------------------------------------------------------------------------

/*
  The tool each class or profession works with, keyed by the pick that earns it.

  ONE TOOL IS HANDED OVER AND SEVERAL COUNT AS HOLDING IT, and the second half
  of that was missing until 21 September. The first draft asked for one form id
  per tool, which is wrong about this game in a way that bites hardest on the
  farmer: Skyrim ships TWO shovels. Shovel01 and Shovel02 are separate MISC
  records in Skyrim.esm with the same model, the same name in the pack and no
  difference a person can see, and both of them sit side by side in
  LootMiningToolRandom05 and LootToolRandom05. Every record below was read out
  of the load order, and every count was made by walking every GRUP in every
  plugin and counting the placed references that point at it, on 21 September:

    weapPickaxe                   0x0E3C16   WEAP   Skyrim.esm      428 placed
    dunVolunruudPickaxe           0x1019D4   WEAP   Skyrim.esm        1  the Notched Pickaxe
    SSDRocksplinterPickaxe        0x06A707   WEAP   Skyrim.esm        0  Rocksplinter, handed out by a quest
    DLC2AncientNordPickaxe        0x0398E6   WEAP   Dragonborn.esm    1  the one that cuts stalhrim
    DLC2RR03NordPickaxe           0x0206F2   WEAP   Dragonborn.esm    1
    DLC2dunKolbjornRalisPickaxe   0x179C9    WEAP   Dragonborn.esm    0
    Axe01                         0x02F2F4   WEAP   Skyrim.esm      287 placed, the woodcutter's axe
    Shovel01                      0x0F5D05   MISC   Skyrim.esm      338 placed
    Shovel02                      0x0F5D06   MISC   Skyrim.esm      112 placed

  So 112 of the 450 shovels lying about the province are the one the first draft
  refused, and a farmer who lost the shovel they were handed, walked to a mill
  and picked up the shovel leaning on the wall had a one in four chance of being
  told they need a shovel while carrying one, which is a hard refusal with no
  way out of it. Measured in the harness rather than worked out: toollens.js
  case G.

  The pickaxes are the same shape of problem with smaller numbers. Three of the
  six are quest items somebody may well be carrying and nothing else, and the
  Notched Pickaxe in particular is a thing people go and fetch on purpose. All
  six mine, so all six count.

  WHAT IS NOT IN THE LISTS. The war picks out of Immersive Weapons, IWSteelWar-
  Pick and the three beside it, are weapons shaped like a pick and are not mining
  tools; nothing in the game lets one work a seam and neither does this. And the
  woodcutter's axe has an accept list of one because there is only one: the whole
  load order, masters and all 96 plugins after them, was searched for another
  woodcutter's axe on 21 September and Axe01 is alone.

  The other farm tool in the masters is Pitchfork001, 0x0F5D07, also a MISC in
  Skyrim.esm. It is named here so that the next person to ask why the farmer
  carries a shovel can see that the other candidate was looked at and put aside:
  a pitchfork moves hay and a shovel turns ground, and turning ground is what
  the hoe was going to be for. Nothing hands a pitchfork out and nothing asks
  for one.

    give    the descriptor a handout adds. One of them, the common one.
    accept  every descriptor that counts as holding the tool, the given one
            first. holdsTool reads this and nothing else.
    name    what a sentence calls it. aWord puts 'a' or 'an' in front of it.
    where   where to get another, said in the refusal, because 'you need a
            pickaxe' with no second sentence sends somebody to the Discord.
    broken  where to get another when the one they had just snapped, which is
            not the same sentence. Patrick, 21 September: a broken tool is
            replaced by "a smith making them", so the smith is named first and
            the world is named second. Both are true and the order is the
            point: the trade is meant to be the way back.
*/
const TOOLS = {
  miner: {
    give: 'e3c16:Skyrim.esm',
    accept: ['e3c16:Skyrim.esm', '1019d4:Skyrim.esm', '6a707:Skyrim.esm',
             '398e6:Dragonborn.esm', '206f2:Dragonborn.esm', '179c9:Dragonborn.esm'],
    name: 'pickaxe',
    where: 'A smith forges them. Nothing in the world hands one out any more: see the spoils block.',
    broken: 'A smith can forge you another. There is nowhere else to get one now.'
  },
  woodworker: {
    give: '2f2f4:Skyrim.esm',
    accept: ['2f2f4:Skyrim.esm'],
    name: 'woodcutter\'s axe',
    where: 'A smith forges them. There are no longer any lying at the mills: see the spoils block.',
    broken: 'A smith can forge you another. There is nowhere else to get one now.'
  },
  farmer: {
    give: 'f5d05:Skyrim.esm',
    accept: ['f5d05:Skyrim.esm', 'f5d06:Skyrim.esm'],
    name: 'shovel',
    where: 'Skyrim has no hoe, so a shovel is the tool, and a smith forges them. ' +
           'The ones that used to lean against every farm wall are gone: see the spoils block.',
    broken: 'A smith can forge you another. There is nowhere else to get one now.'
  },
  // fisher.md: a new fisher is handed a crude pole. Fine and master also count.
  // A fish trap is not in this list. It is not a pole.
  fisher: {
    give: '15498:Thornswood-Content.esp',
    accept: ['15498:Thornswood-Content.esp', '15499:Thornswood-Content.esp',
             '1549a:Thornswood-Content.esp'],
    name: 'crude fishing pole',
    where: 'A woodwright makes them from firewood, leather strips and tundra cotton.',
    broken: 'A woodwright can make you another. The master pole does not take dragon bone.'
  },
  /*
    THE BENCH TRADES' TOOLS (#3162). Patrick's A on his report page, 22 October
    2026: each bench trade needs its own tool, worn out after 50 uses like a
    gathering tool. Keyed by the profession, which is the owner a recipe row
    names, so benchToolKey reads the key straight off the row. The woodworker
    already has one, the woodcutter's axe above, and it is the tool of their
    bench work as well: one tool per trade.

    Which item each is, read out of Skyrim's masters on the box with
    scripts\dev\List-ToolRecords.py on 26 October 2026. The smith's hammer and
    the cook's ladle are Skyrim's own MISC records, BlacksmithHammer01 and
    WoodenLadle01. Skyrim has no tailor's shears, alembic or enchanter's
    blade a person could carry under a name that fits, so those three are
    Thornswood-Content.esp's own, each wearing the model of a Skyrim item that
    has one: the shears RuinsScissor01's, the alembic Tolfdir's Alembic's, the
    rune knife RuinsScalpel01's (scripts\mods\Add-ContentRecords.py). None of
    them is in the world: floor items are switched off (#3077) and containers
    start empty (#3078), so a crafter or the pick is the only way to one.

    The geode work at the Winterhold Enchanter asks toolGate(actor,
    'enchanter') and always has (docs/systems/merchant-geode-work.md: the
    Enchanter's tool rules apply), so it asks for the rune knife from now on.
  */
  smith: {
    give: '5cae1:Skyrim.esm',
    accept: ['5cae1:Skyrim.esm'],
    name: 'hammer',
    where: 'A smith forges them, and a smith with none can forge their own: a hammer is the one thing at the forge that needs no hammer.',
    broken: 'Forge yourself another, or ask another smith.'
  },
  tailor: {
    give: '1b000:Thornswood-Content.esp',
    accept: ['1b000:Thornswood-Content.esp'],
    name: 'pair of shears',
    where: 'A smith forges them.',
    broken: 'A smith can forge you another.'
  },
  cook: {
    give: '319e5:Skyrim.esm',
    accept: ['319e5:Skyrim.esm'],
    name: 'wooden ladle',
    where: 'A woodwright makes them from firewood.',
    broken: 'A woodwright can make you another.'
  },
  alchemist: {
    give: '1b001:Thornswood-Content.esp',
    accept: ['1b001:Thornswood-Content.esp'],
    name: 'alembic',
    where: 'A smith forges them.',
    broken: 'A smith can forge you another.'
  },
  enchanter: {
    give: '1b002:Thornswood-Content.esp',
    accept: ['1b002:Thornswood-Content.esp'],
    name: 'rune knife',
    where: 'A smith forges them.',
    broken: 'A smith can forge you another.'
  }
};

/*
  NO TOOL IS HANDED OUT AGAIN. Until 21 September a seam, a block, a kiln or a
  plot handed a free tool to anybody with none, once every TOOL_AGAIN_HOURS
  (twelve), through offerTool. Patrick, that day: tools come from a smith, and
  nobody works without one (toolGate). Nothing called offerTool after that, and
  it and its clock came out in #1038. The one tool anybody is given is the one
  a starting class hands over at creation (giveTool).
*/

/*
  HOW MUCH WORK A TOOL HAS IN IT BEFORE IT BREAKS. NOT IN THE RULEBOOK.

  Patrick, 21 September: axes, pickaxes and shovels "can eventually break and
  you have to get a new one from a smith making them". So a tool stops being a
  thing somebody owns once and becomes stock, which somebody has to make.

  FIFTY USES, the plan's number: classes.md "It has 50 uses", and the miner,
  farmer, woodworker and fisher pages say the same (#1381). The pull request
  that closed #1381 changed only README.md, so the server kept 100 until
  #1588. The pick, the axe, the shovel and the pole all have 50, and so does
  the tool handed at creation, because handTool starts no count of its own:
  wearTool counts every one of them against this. A tool that was already
  past 49 uses under the old hundred breaks at its next one, because it has
  done its 50.

  It was a hundred first, measured against the ladder when TUNING.workPerRank
  added up to 20 + 50 + 120 = 190 yields from novice to Master: two tools to
  the top. The ladder is 100 + 250 + 600 = 950 now, changed on 21 September
  when a rank stopped meaning twenty seams and started meaning one, so the
  climb costs about nineteen tools. If the tool starts feeling like a toll
  rather than stock, that is a question for the plan pages, not this line.

  The warning comes at fifteen left. Far enough out to finish what you are doing
  and walk to a town, short enough to mean something.

  A use is counted after the work, never before it, so a refused swing costs
  nothing. Nothing here can take a tool somebody is not holding: if the pack
  cannot be read, or the tool is not in it, the swing wears nothing rather than
  breaking something at random.
*/
const TOOL_USES = 50;
const TOOL_WARN_AT = 15;
// Poles are 50 too. fisher.md: "50 uses, the same as the pick, the axe, and the shovel".
const POLE_USES = 50;
const FISH_TRAP_MAX = 3;

/*
  When each tool was last handed to this character, keyed the same way TOOLS is.
  On the actor, not in memory: a restart that forgot would hand every tool out
  again, and this is the only thing standing between the way back and a tap.
*/
const TOOL_PROPERTY = 'thornswoodTools';

/** The tool a class or profession works with, or null when it needs none. */
function toolFor(key) {
  return Object.prototype.hasOwnProperty.call(TOOLS, key) ? TOOLS[key] : null;
}

/*
  Is that tool in the pack.

  EVERY DESCRIPTOR IN tool.accept, not just the one a handout gives. Skyrim has
  two shovels and six pickaxes and a person cannot tell one shovel from the
  other, so asking for one form id would refuse somebody holding the tool. See
  the TOOLS block for the six counts that were walked to settle that.

  TWO READS ANSWER YES RATHER THAN NO, and both are deliberate. A tool none of
  whose descriptors resolve is a plugin missing from the load order, and an
  inventory read that throws is the server failing to answer a question about
  somebody who is plainly standing there. Neither of those is the person's
  fault, and a build fault must not be the reason nobody in the world can work a
  seam. The same choice classGate makes when the character block is missing.

  A descriptor that resolves to 0 on its own is passed over rather than treated
  as the whole tool missing. Dragonborn.esm is in this load order and is not in
  every load order, and a miner holding the plain pickaxe must not be refused
  because the Solstheim one could not be looked up.
*/
function holdsTool(actorId, tool) {
  const wanted = [];
  for (let i = 0; i < tool.accept.length; i++) {
    const baseId = idOf(tool.accept[i]);
    if (baseId) { wanted.push(baseId); }
  }
  if (!wanted.length) {
    log('no', tool.name, 'in this load order, so the tool is not asked for');
    return true;
  }
  let inv = null;
  try {
    inv = mp.get(actorId, 'inventory');
  } catch (e) {
    log('could not read the pack of', actorId.toString(16), 'so the tool is not asked for:', e);
    return true;
  }
  const entries = (inv && inv.entries) || [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !(e.count > 0)) { continue; }
    for (let j = 0; j < wanted.length; j++) {
      if (e.baseId === wanted[j]) { return true; }
    }
  }
  return false;
}

/** The wear count of each tool, under 'wear:<key>'. Always an object, never a throw. */
function toolStamps(actorId) {
  let v = null;
  try {
    v = mp.get(actorId, TOOL_PROPERTY);
  } catch (e) {
    v = null;
  }
  if (!v || typeof v !== 'object') { v = {}; }
  return v;
}

/**
 * The tool into the pack. The tool, or null when nothing reached them. Called
 * by giveTool, at a starting class's pick, and by nothing else.
 */
function handTool(actorId, key) {
  const tool = toolFor(key);
  if (!tool) { return null; }
  if (!addItem(actorId, tool.give, 1)) {
    log('there is no', tool.name, 'in this load order, so', actorId.toString(16),
        'was handed nothing');
    return null;
  }
  log(actorId.toString(16), 'was handed', aWord(tool.name), 'for', key);
  return tool;
}

/** The line to say when a pick hands the tool over, or null. */
function giveTool(actorId, key) {
  const tool = handTool(actorId, key);
  if (!tool) { return null; }
  return 'You are handed ' + aWord(tool.name) + '. Keep it in your pack: the work needs it there.';
}

/**
 * null when this person is holding the tool the work needs, otherwise the
 * sentence to say: the one handing a replacement over, or the refusal.
 *
 * ALWAYS AFTER THE CLASS OR HALF GATE AND BEFORE THE COOLDOWN. Somebody who is
 * not a miner should be told they are not a miner rather than handed a pickaxe,
 * and a refusal that started a cooldown would tell them the wrong thing about
 * why nothing happened. That is the same ordering mineOre, harvest() and the
 * farming block already settled on.
 */
/*
  WHICH tool of the accepted ones is in this pack, as a form id.

  holdsTool already walks this list to answer yes or no; the client needs the
  id itself to put the thing in somebody's hands. Six pickaxes are accepted
  and the one they own is the one that should be drawn, not a stand-in.
  Nothing carried answers 0, which the client reads as no tool and leaves
  their hands alone.
*/
function toolIdIn(actorId, key) {
  const tool = toolFor(key);
  if (!tool) { return 0; }
  const wanted = [];
  for (let i = 0; i < tool.accept.length; i++) {
    const baseId = idOf(tool.accept[i]);
    if (baseId) { wanted.push(baseId); }
  }
  if (!wanted.length) { return 0; }
  let inv = null;
  try { inv = mp.get(actorId, 'inventory'); } catch (e) { return 0; }
  const entries = (inv && inv.entries) || [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !(e.count > 0)) { continue; }
    for (let j = 0; j < wanted.length; j++) {
      if (e.baseId === wanted[j]) { return e.baseId; }
    }
  }
  return 0;
}

function toolGate(actorId, key) {
  const tool = toolFor(key);
  if (!tool) { return null; }
  if (holdsTool(actorId, tool)) { return null; }
  /*
    NO TOOL, NO WORK, AND NOTHING IS HANDED OVER.

    Patrick, 21 September, after playing it: "Don't let p[eople chop wood, mine,
    or farm without a pickaxe, shovel, or woodcutters axe."

    This used to call offerTool here, which gave anybody with an empty pack a
    free tool once every twelve hours and told them to try again. So nobody was
    ever actually refused for want of one: the gate read as a gate and behaved
    as a vending machine, and the tool-breaking system it was written beside had
    nothing to bite on, because a snapped pickaxe was replaced for free by the
    thing that was supposed to make you go and buy another.

    A tool comes from a smith now, which is the whole point of the handle and
    the recipes that need one. handTool is left where it is: through giveTool
    it is how the FIRST tool of a starting class is placed. offerTool, the free
    replacement, had no caller after this and came out in #1038.
  */
  return 'You need ' + aWord(tool.name) + ' in your pack for that. ' + tool.where;
}

/*
  The form id of the tool of this kind actually in the pack, or 0.

  holdsTool answers yes or no and that was enough while nothing ever took one
  away. Breaking one has to know WHICH, because a miner may be carrying any of
  six pickaxes and the Notched Pickaxe off the Throat of the World is not the
  one to snap because it happens to be first in the accept list. So this returns
  the one they are holding, and when they are holding more than one it returns
  the first in accept order, which puts the plain handout ahead of the quest
  items in every one of the three lists.
*/
function heldToolId(actorId, tool) {
  let inv = null;
  try {
    inv = mp.get(actorId, 'inventory');
  } catch (e) {
    return 0;
  }
  const entries = (inv && inv.entries) || [];
  for (let i = 0; i < tool.accept.length; i++) {
    const baseId = idOf(tool.accept[i]);
    if (!baseId) { continue; }
    for (let j = 0; j < entries.length; j++) {
      const e = entries[j];
      if (e && e.count > 0 && e.baseId === baseId) { return baseId; }
    }
  }
  return 0;
}

/*
  One use off the tool. Called AFTER the work is done and the yield is handed
  over, never before, so a refused swing costs nothing.

  Returns the sentence to say, or null when there is nothing worth saying. Three
  answers: silence, the warning near the end, and the break.

  WHAT A BREAK DOES. The tool comes out of the pack and its count starts again.
  The way back is a smith, which is what Patrick asked for: nothing hands a
  replacement over (#1038), and the refusal at the seam, the block, the kiln
  or the plot says who makes one.

  The count is kept in TOOL_PROPERTY under a 'wear:' key. A character made
  before #1038 may also carry the time each tool was handed over, under the
  bare key ('miner'); nothing reads that any more and it is left as it is.
*/
function wearTool(actorId, key) {
  const tool = toolFor(key);
  if (!tool) { return null; }
  const limit = key === 'fisher' ? POLE_USES : TOOL_USES;
  const baseId = heldToolId(actorId, tool);
  if (!baseId) { return null; }

  const stamps = toolStamps(actorId);
  const wearKey = 'wear:' + key;
  const used = (Object.prototype.hasOwnProperty.call(stamps, wearKey)
    ? (Number(stamps[wearKey]) || 0) : 0) + 1;

  if (used < limit) {
    stamps[wearKey] = used;
    try {
      mp.set(actorId, TOOL_PROPERTY, stamps);
    } catch (e) {
      // The wear is not written down, so this swing was free. Harmless: the
      // tool lasts longer than it should rather than breaking in their hand.
      log('could not record', key, 'tool wear for', actorId.toString(16) + ':', e);
      return null;
    }
    const left = limit - used;
    if (left === TOOL_WARN_AT) {
      return 'Your ' + tool.name + ' is worn thin. It has a little work left in it.';
    }
    return null;
  }

  // Worn out. Take it, and forget the count.
  if (!takeItemById(actorId, baseId, 1)) {
    // It could not be taken, so it is not broken. Counting it again next swing
    // is the honest answer; snapping a tool that is still in the pack is not.
    log('could not take the worn', tool.name, 'from', actorId.toString(16));
    return null;
  }
  stamps[wearKey] = 0;
  try {
    mp.set(actorId, TOOL_PROPERTY, stamps);
  } catch (e) {
    log('could not record the broken', key, 'tool for', actorId.toString(16) + ':', e);
  }
  log(actorId.toString(16), 'broke a', tool.name, 'after', limit, 'uses');
  return 'Your ' + tool.name + ' breaks. ' + tool.broken;
}

/**
 * Salt quarry: the miner's verb, and the miner's RANK sizes the yield.
 *
 * The mining manual used to gate this and set the yield. That was a second
 * progression system beside the rulebook's own, and classes.md has only one:
 * the class owns the verb and the rank comes from doing the work. So the
 * manual no longer stands between anybody and a seam, and how much salt comes
 * away follows the Miner rank that the seam itself is raising.
 */
function mineSalt(actorId, refrId) {
  // The class first, and before the cooldown: somebody who is not a miner is
  // never going to work this seam, and a refusal that starts a cooldown is
  // telling them the wrong thing about why.
  const mine = classGate(actorId, 'mine');
  if (mine) return mine;

  // The pickaxe, after the class and before the cooldown. See toolGate.
  const tool = toolGate(actorId, 'miner');
  if (tool) return tool;

  const step = rankStep(actorId, 'miner');

  /*
    A press inside a swing this person is already taking, ignored in silence.
    The twenty second cooldown below would refuse it anyway, but it would
    refuse it with 'the seam needs 19 more seconds', and an early click is not
    a person who came back too soon. See swinging().
  */
  if (swinging(actorId)) { return ''; }

  const wait = cooldownLeft(actorId, refrId);
  if (wait > 0) return 'The seam needs ' + wait + ' more seconds to be worth striking.';

  /*
    The pick goes up on the press and the salt comes away when it lands, the
    same ordering mineOre settled on and for the same reason Patrick gave:
    "you dont get the ore as it hits the vein". The cooldown is stamped on the
    press, with the seam rather than with the salt, so a click during the
    swing cannot buy a second strike at it.
  */
  stampCooldown(actorId, refrId);
  swing(actorId, SWING_MINE, function () {
    const yielded = randInt(1, 2 + step);
    if (!addItem(actorId, ITEMS.saltPile, yielded)) {
      notify(actorId, 'The seam yields nothing you can carry.');
      say(actorId, 'The seam yields nothing you can carry.');
      return;
    }
    economyGathered(actorId, ITEMS.saltPile, yielded);
    let extra = '';
    if (step >= 2 && Math.random() < 0.12 * (step - 1)) {
      const rare = [ITEMS.fireSalts, ITEMS.frostSalts, ITEMS.voidSalts][randInt(0, 2)];
      if (addItem(actorId, rare, 1)) { economyGathered(actorId, rare, 1); }
      extra = ' Something rarer came away with it.';
    }
    const rank = creditWork(actorId, 'mine');
    const worn = wearTool(actorId, 'miner');
    const saying = 'You work ' + yielded + ' salt from the seam.' + extra +
                   (rank ? ' ' + rank : '') + (worn ? ' ' + worn : '');
    notify(actorId, saying);
    say(actorId, saying);
  });
  return '';
}

/**
 * A rank named in a sentence, with the article that belongs in front of it:
 * 'a Novice', 'an Expert'. The farming block has the same three lines inside
 * its closure and cannot be reached from here, so a refusal at a seam and a
 * refusal at a plot read the same way because both were written to, not
 * because one calls the other.
 */
function rankWord(rank) {
  const n = String(rank || '').charAt(0).toUpperCase() + String(rank || '').slice(1);
  return (/^[AEIOU]/.test(n) ? 'an ' : 'a ') + n;
}

/** True when this base is one of the 581 seams in the generated table above.
 *  Never a bare lookup, for the reason own() in the progression block was
 *  written: the descriptor names a record in the world, and '__proto__' finds
 *  something on Object.prototype that a truth test cannot tell from a seam. */
function isVein(baseDesc) {
  return Object.prototype.hasOwnProperty.call(ORES_BY_BASE, baseDesc);
}

/**
 * Every other seam in Skyrim: the miner's verb again, and the table sizes the
 * yield instead of the rank arithmetic the quarry uses.
 *
 * The salt quarry above is one base this server put in the world. These are
 * the 581 the game already had, and until now not one of them answered.
 * Pressing an iron vein did nothing at all: mp.onActivate had no branch for
 * it, and the engine's own mining is MineOreScript, a Papyrus script, which
 * for the two reasons set out at the scripted activators further down never
 * runs on this server or on the client. So a Miner could work the one quarry
 * and walked past every seam in the province.
 *
 * The shape is mineSalt's, line for line, and the differences are the
 * table's doing. The yield is the pair for the miner's rank instead of
 * randInt(1, 2 + step). A pair of zeroes is refused by name rather than handed
 * a smaller pile, so a Novice at an ebony seam is told what it takes rather
 * than left to work out why nothing came off it. There is no rare-drop roll:
 * the quarry has one because salt is the only thing a salt seam can give, and
 * a seam here already gives what it is made of. And a seam has no wait of its
 * own between two strikes, where the quarry's is a flat twenty seconds: it is a
 * deposit, written out below, and that deposit is the only limit on 581 seams
 * the engine never depletes.
 */

/*
  ============================ a seam holds twenty, and gives one at a time ===

  Patrick, 21 September, after playing it: "make each quarry have up to 20 ore
  and not skip the animation and the same with chopping where you get an ore
  each time you hit it you know not all at omce so you can stay for a little
  and get a little or stay andd get all 20", with ten minutes to come back for
  iron, gold, corundum and silver and thirty for moonstone, quicksilver,
  orichalcum, ebony and malachite.

  WHAT THIS REPLACES. A seam handed over its whole yield on one press and then
  refused everybody for between ten minutes and four hours. So a seam was a
  vending machine with a long queue: one strike, a pile of ore, and nothing to
  come back to. A deposit is a pile of twenty that anybody may work down one
  swing at a time, and it is the same seam for whoever is standing there, so
  two miners share a vein rather than each having their own.

  AND THE ANIMATION IS NOT CANCELLED. Every branch of the activate chain ends
  at `return false`, which blocks the engine's own handover, and for a seam
  that is what threw the mining animation away. Mining answers ALLOW now, which
  says "I have handled the yield, let the press go on being a press", and the
  chain returns undefined for it.

  THE POOL LIVES ON THE REFERENCE, not on the person, because a seam is worked
  out for everybody or for nobody. It is written with the reference's own
  property, the same way the spoils block marks a container it has emptied.
*/
/*
  "I HAVE HANDLED THIS, LET THE PRESS GO ON BEING A PRESS."

  Every branch of the activate chain ends at `return false`, which blocks the
  engine's own handover. For a container or a plant that is exactly right: the
  server has already given what there was to give. For a SEAM it threw away the
  mining animation, which is the thing Patrick asked for back.

  A branch that answers this has taken care of the yield and wants the press to
  carry on, so the chain returns undefined for it and Skyrim swings the pick.
*/
const ALLOW = { thornswoodAllow: true };

const DEPOSIT_SIZE = 20;
const SWING_PROPERTY = 'thornswoodSwing';

/*
  ==================== A PLANT THAT GAVE SOMETHING LOOKS PICKED ============

  #3080. Patrick, 21 October: "instead of replinishing things people can't
  pickup to just block the pickup animation to begin with so that it doesnt
  need to pick it back up".

  The engine fork's client blocks activation on Flora and Tree now
  (objectReferenceEx.ts, dealWithRef), the way it already blocked containers,
  items and doors. A press on a plant, a tree, a fish, hanging game, a nest, a
  churn or a hive only sends the activation: the presser's own Skyrim no
  longer picks it first. So a refused press changes nothing on their machine,
  and there is nothing to put back. That is what the put-back property,
  putBack() and its four second timer were for, and they are gone.

  An ALLOWED press is answered here, as before: the branch hands the produce
  over itself and answers false, so the engine never runs its own pick. The
  one thing the presser's game no longer does for itself is empty the plant,
  so the server tells it to, the way the engine's own model sync shows a
  harvested plant (ModelApplyUtils.applyModelIsHarvested in the fork:
  setHarvested, then the reference off and on again so the model follows).
  On the presser's machine only, because that is the machine that used to
  pick it: a nest, a churn and a hive wait per person (cooldownLeft), so
  emptying them for everybody would show a nest empty to somebody who may
  still take from it.

  WHICH PRESS GAVE SOMETHING is read off the presser's pack, not off the
  sentence: the press is on a FLOR or TREE record and some entry in the pack
  went up while it was answered (answerFlora, under mp.onActivate). Every
  branch that hands produce over, the quests' orchard and scarce water
  included, goes through one place that way, and a press that took something
  without giving (sowing a plot) leaves the plot as it is.

  The order is cleared at every login (the per-session hook in the chargen
  tick), so a pick from an earlier session never empties a plant again.
*/
const PICKED_PROPERTY = 'thornswoodPicked';

function pickedScript() {
  return [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || !v.at || !v.ref) { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodPickedAt === v.at) { return; }',
    '    st.thornswoodPickedAt = v.at;',
    '    var sp = ctx.sp;',
    '    var ref = sp.ObjectReference.from(sp.Game.getFormEx(v.ref));',
    '    if (!ref || ref.isHarvested()) { return; }',
    '    ref.setHarvested(true);',
    '    ref.disable(false).then(function () {',
    '      var again = sp.ObjectReference.from(sp.Game.getFormEx(v.ref));',
    '      if (again) { again.enable(false); }',
    '    });',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
}

/** Empty this plant on the presser's machine. See PICKED_PROPERTY. */
function showPicked(actorId, refrId) {
  if (!actorId || !refrId) { return; }
  try { mp.set(actorId, PICKED_PROPERTY, { ref: refrId, at: Date.now() }); } catch (e) {
    log('could not show', refrId.toString(16), 'picked to', actorId.toString(16) + ':', e);
  }
}

/** Every entry's count in a pack, by base id and name. See answerFlora. */
function packCounts(actorId) {
  const counts = {};
  let inv = null;
  try { inv = mp.get(actorId, 'inventory'); } catch (e) { return counts; }
  const entries = (inv && inv.entries) || [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) { continue; }
    const key = e.baseId + ':' + (e.name || '');
    counts[key] = (counts[key] || 0) + (Number(e.count) || 0);
  }
  return counts;
}

/** True when any entry in after holds more than it did in before. */
function packGrew(before, after) {
  for (const key in after) {
    if (Object.prototype.hasOwnProperty.call(after, key) && after[key] > (before[key] || 0)) {
      return true;
    }
  }
  return false;
}

/*
  What the client actually has on, by base id, or null when it cannot be read.
  The equipment record is what the owner's game reports it wears; the
  embassy reads it to see Thalmor gear (#1390). Nothing here acts on it to
  dress anybody: a new character is dressed once, by dressNewCharacter, and
  after that what is worn is the person's own doing (#1560).
*/
function wornNow(actorId) {
  let eq = null;
  try { eq = mp.get(actorId, 'equipment'); } catch (e) { return null; }
  if (!eq) { return null; }
  const entries = (eq.inv && eq.inv.entries) || eq.entries || [];
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e && e.worn && e.baseId) { out.push(e.baseId); }
  }
  return out;
}

/*
  THE ONE WAY TO PUT SOMETHING IN FRONT OF SOMEBODY'S EYES.

  Patrick, 22 September, about the restart countdown: "I need it to do an
  onscreen warninjg and not just in chat at one minute and at 30 seoconds
  before you get kciked from the server incase people miss the message in
  chat", and about the meters: "There is no indicator for the hunger food or
  exhasution on screen".

  Both are the same missing thing. Everything this server says lands in the
  chat overlay, which is a small panel somebody may have scrolled away from or
  simply not be looking at, and the two messages that must not be missed are
  the one that ends in being thrown out and the one that says why you have
  started missing your swings.

  IT DRAWS ITSELF, WITH NO PAGE TO DEPEND ON. The script below builds its own
  element in the overlay document. It does not call into thornswood-chat or
  any other page, so it works on a client whose overlay is from before this
  existed, and it needs no Ship: an updateOwner script travels with the
  gamemode, so a deploy is enough to put a HUD on everybody's screen.

  AND Debug.notification BESIDE IT, which is Skyrim's own corner message and
  needs no browser at all. If the overlay never mounted, that one still lands.
*/
const ALERT_PROPERTY = 'thornswoodAlert';

/*
  How long a banner stays up before it fades, by how much it matters.
  A countdown warning outlives the next one so the screen is never empty
  between 60 and 30.
*/
const ALERT_MS = 9000;

function alertScript() {
  return [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || !v.text || !v.at) { return; }',
    // updateOwner runs EVERY FRAME. See the note over SWING_PROPERTY.
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodAlertAt === v.at) { return; }',
    '    st.thornswoodAlertAt = v.at;',
    '    var sp = ctx.sp;',
    // Skyrim's own corner message first, because it needs no browser.
    '    try { sp.Debug.notification(String(v.text)); } catch (e) { }',
    /*
      And the banner. Built as one string here and handed to the overlay, so
      the page is never asked to have a function for it. JSON.stringify does
      the quoting, which is why nothing in the text has to be escaped by hand.
    */
    '    var body = JSON.stringify(String(v.text));',
    '    var ms = Number(v.ms) || 9000;',
    '    var tone = (v.tone === "bad") ? "#e0645a" : "#d9ab52";',
    '    var src = "(function(){try{" +',
    '      "var d=document.getElementById(\'ts-alert\');" +',
    '      "if(!d){d=document.createElement(\'div\');d.id=\'ts-alert\';" +',
    /*
      A THIRD OF THE WAY DOWN, NOT A NINTH.

      Patrick, 23 September: "The on screen indicator is to high up on the
      screen". It sat at 11%, which on a wide screen is level with the compass
      and above where anybody is actually looking. 30% puts it in the upper
      part of the eye line, clear of the compass at the top and clear of the
      crosshair and the activate prompt in the middle.

      max-width is here for the same message: the wording below is a whole
      sentence now, and without a width a long one stretches to both edges of
      a 32:9 screen and reads as a strip rather than a notice.
    */
    '      "d.style.cssText=\'position:fixed;left:0;right:0;top:30%;z-index:2147483600;" +',
    '        "text-align:center;pointer-events:none;font-family:Georgia,serif\';" +',
    '      "document.body.appendChild(d);}" +',
    '      "d.innerHTML=\'<div style=\\\\\'display:inline-block;padding:16px 30px;" +',
    '        "max-width:62%;background:rgba(20,16,12,.92);border:2px solid " + tone + ";border-radius:10px;" +',
    '        "color:#efe6d6;font-size:28px;line-height:1.35;letter-spacing:.03em;" +',
    '        "box-shadow:0 10px 44px rgba(0,0,0,.65)\\\\\'>\' + " + body + " + \'</div>\';" +',
    '      "d.style.display=\'\';" +',
    '      "clearTimeout(window.__tsAlertT);" +',
    '      "window.__tsAlertT=setTimeout(function(){try{d.style.display=\'none\';}catch(e){}}," + ms + ");" +',
    '      "}catch(e){}})();";',
    '    try { sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
}

/*
  Put a line in front of everybody, or one person.

  The stamp is what makes it an event, the same as the swing: the same words
  twice running are the same value, and a value that has not changed draws
  nothing. tone is 'bad' for anything with a clock on it.
*/
function alertAll(text, tone, ms) {
  let online = [];
  try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
  for (let i = 0; i < online.length; i++) { alertOne(online[i], text, tone, ms); }
}

function alertOne(actorId, text, tone, ms) {
  try {
    mp.set(actorId, ALERT_PROPERTY, {
      text: String(text || ''), tone: tone === 'bad' ? 'bad' : 'good',
      ms: Number(ms) || ALERT_MS, at: Date.now()
    });
  } catch (e) { /* a person without a banner still has the chat line */ }
}

/*
  How long a swing is held before the person is let go of.

  Long enough to read as a swing, short enough that nobody feels held. The exit
  is sent regardless, because an idle with no exit leaves somebody rooted until
  they work out that moving breaks it.
*/
const SWING_MS = 2500;

/*
  HOW FAR INTO A SWING THE PICK LANDS.

  Patrick, 22 September: "you dont get the ore as it hits the vein". He is
  right, and it was not a near miss: the ore was handed over the instant the
  press arrived, before the animation had been asked for, so the pick coming
  down had nothing to do with anything.

  This is when the yield happens now. It is a number and not a measurement,
  and saying so is the point: the strike inside IdlePickaxeEnter is an
  annotation in the animation and the server cannot see annotations. The only
  thing on either machine that can is the sendAnimationEvent hook in
  thornswood-front.js, which is already watching the axe fall at a chopping
  block for exactly this reason and writes down, once each, every event it did
  not recognise. Pointing it at the pickaxe as well turns this constant into
  the real event, and that is its own entry on the list.

  Until then: early in the swing, because a pick comes down at the start of a
  2.5 second idle and not at the end of it, and well inside SWING_MS so the
  yield can never outlive the animation it belongs to.
*/
const SWING_LAND_MS = 900;

/** The animation to play, by what is being worked. See SWING_PROPERTY. */
const SWING_MINE = 'IdlePickaxeEnter';
/*
  Nothing sends this any more, and the name is kept rather than deleted. It
  was read out of IDLE 6c1df under WoodChopRoot in Skyrim.esm and it is worth
  more written down than worked out again; see chopWood for why the server
  stopped sending it.
*/
const SWING_CHOP = 'IdleWoodChopStart';
const SWING_STOP = 'IdleChairExitStart';

/** The graph's unconditional reset. See the note on SWING_PROPERTY. */
const SWING_FREE = 'IdleForceDefaultState';

/* How long a sheathe is given before the swing starts (#2245). Skyrim's own
   sheathe takes about two thirds of a second; one second covers a slow one. */
const SWING_SHEATHE_MS = 1000;

/*
  Run on the person's own machine EVERY FRAME for as long as SWING_PROPERTY
  holds a value. Not on change: see the note on the property, which is where
  the reading of the client that settled that is written down. Everything
  below the state guard runs once per swing because of the guard, and for no
  other reason.

  Written as one string for the same reason lockScript is: the script cannot be
  changed once the property is made, so a change here needs a server restart,
  which a deploy is.
*/
function swingScript() {
  return [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    /*
      THE STAMP ALONE, because an end message carries no animation.

      Patrick, 23 September, working a seam: "It's stopping the animation and
      going back in that doesn't flow smoothly". Every strike was its own
      animation with its own exit, so a spell of mining was enter, swing,
      exit, enter, swing, exit. IdlePickaxeEnter is a state you stay in, so
      now it is entered once, held for the whole spell, and left once at the
      end. The end is a message with a stamp and no anim, which is why this
      no longer asks for one. A cleared property is still at zero and still
      falls out here.
    */
    '    if (!v || !v.at) { return; }',
    /*
      ctx.state is one object, made once when the client starts and handed to
      every updateOwner script, so the key is namespaced. No state at all means
      this cannot tell a swing from the frame after it, and a swing that does
      not play is better than one that never stops: it fails shut.
    */
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodSwingAt === v.at) { return; }',
    '    st.thornswoodSwingAt = v.at;',
    '    var sp = ctx.sp;',
    '    var pc = sp.Game.getPlayer();',
    '    if (!pc) { return; }',
    /*
      THE END OF A SPELL: leave the state, and put the real pickaxe back
      if it was on them when the spell started.

      IdlePickaxeEnter carries its own pick, so the real one comes off at
      the start (see below). Until 27 September the end path never put it
      back: a miner who walked up with the pick on their hip, or drawn,
      finished the seam bare-handed. #611. Remembered on ctx.state under
      thornswoodSwingHadTool, set only when isEquipped was true before
      unequip, so a pick that lived only in the pack stays unequipped.
    */
    '    if (v.end) {',
    '      try { sp.Debug.sendAnimationEvent(pc, v.stop); } catch (e) { }',
    '      try { if (v.free) { sp.Debug.sendAnimationEvent(pc, v.free); } } catch (e) { }',
    '      var restore = (v.tool && st.thornswoodSwingHadTool === v.tool) ? v.tool : 0;',
    '      st.thornswoodSwingHadTool = 0;',
    '      if (restore) {',
    '        try {',
    '          var back = sp.Form.from(sp.Game.getFormEx(restore));',
    '          if (back) { pc.equipItem(back, false, true); }',
    '        } catch (e) { }',
    '      }',
    '      return;',
    '    }',
    '    if (!v.anim) { return; }',
    /*
      AND THE REAL PICKAXE GOES AWAY FIRST, WHICH IS THE OPPOSITE OF WHAT
      THIS DID AN HOUR AGO.

      The first version equipped the tool, because the pick was missing from
      the swing and the obvious reading was that an idle mimes rather than
      drawing anything. It does not: IdlePickaxeEnter carries its own pickaxe
      the moment it is allowed to play through, which it never was while the
      animation restarted every frame. Patrick, with it working: "I have a
      pick on my hip and a pick from the animation and that looks weird also
      if I hold out my pick and do it than I have 2 picks that swing".

      So the tool is UNEQUIPPED for the spell. One pick, the animation's, and
      somebody who walked up with theirs drawn does not end up swinging two.
      Silently, and without preventing removal, so nothing here can trap
      anything on anybody.

      AND REMEMBER WHETHER IT WAS ON THEM. unequipItem of something that
      was never equipped is a no-op, but we still need to know: the end
      path only puts it back when isEquipped was true here (#611).
    */
    /*
      #2245: A DRAWN WEAPON FIRST GOES AWAY, AND THE SWING WAITS FOR IT.

      Skyrim does not play an idle like IdlePickaxeEnter on somebody with a
      weapon out. Unequipping the drawn pick (below) leaves them with fists
      raised, which is still drawn, so the animation was silently refused
      while the server's strikes went on paying ore: "mining with the pickaxe
      already out skips the animation and gives ore on click". So a drawn
      weapon is sheathed, and the rest of the start runs once the sheathe has
      had SWING_SHEATHE_MS, and only if no newer message (an end, or another
      start) has arrived meanwhile.
    */
    '    var go = function () {',
    '      if (st.thornswoodSwingAt !== v.at) { return; }',
    '      try {',
    '    if (v.tool) {',
    '      try {',
    '        var it = sp.Form.from(sp.Game.getFormEx(v.tool));',
    '        if (it) {',
    '          var had = false;',
    '          try {',
    '            var ac = sp.Actor.from(pc);',
    '            if (ac) { had = !!ac.isEquipped(it); }',
    '          } catch (e2) { had = false; }',
    '          st.thornswoodSwingHadTool = had ? v.tool : 0;',
    '          if (had) { pc.unequipItem(it, false, true); }',
    '        }',
    '      } catch (e) { }',
    '    }',
    '    sp.Debug.sendAnimationEvent(pc, v.anim);',
    /*
      A HELD SWING DOES NOT LET GO BY ITSELF. It is one strike of a spell that
      is still going, and the exit comes as its own message when the spell
      ends. Everything that is not a spell keeps the old shape exactly: play,
      wait, exit.
    */
    '    if (v.hold) { return; }',
    // And let them go again. Utility.wait is a promise here, not a block.
    '    sp.Utility.wait((v.ms || 2500) / 1000).then(function () {',
    '      try {',
    '        var me = sp.Game.getPlayer();',
    '        if (!me) { return; }',
    '        sp.Debug.sendAnimationEvent(me, v.stop);',
    // The named exit is a transition out of one state. This one is out of any
    // state, and it is the difference between an exit and a way out.
    '        if (v.free) { sp.Debug.sendAnimationEvent(me, v.free); }',

    '      } catch (e) { }',
    '    });',
    '      } catch (e) { }',
    '    };',
    '    var drawn = false;',
    '    try {',
    '      var ad = sp.Actor.from(pc);',
    '      drawn = !!(ad && ad.isWeaponDrawn());',
    '      if (drawn) { ad.sheatheWeapon(); }',
    '    } catch (e) { drawn = false; }',
    '    if (drawn) { sp.Utility.wait(' + (SWING_SHEATHE_MS / 1000) + ').then(go); } else { go(); }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
}

/*
  Ask for a swing, and take the ask back once it has been swung.

  THE STAMP IS THE WHOLE EVENT. The script above plays a swing when at moves
  and does nothing at all when it has not, so the stamp is what separates two
  strikes at the same seam, and it is the only thing that does.

  AND THE PROPERTY IS CLEARED AFTER. A swing is something that happened, not
  something a character is. Left on the character it is stored, sent to the
  owner again at the next login, and played again by a client that has never
  seen that stamp before, which is the animation nobody could get out of by
  loading a fresh game. Cleared, there is nothing to send. The clear is a
  little past the end of the swing so it cannot race the client's own exit.
*/
function swing(actorId, anim, lands, opts) {
  var o = opts || {};
  try {
    mp.set(actorId, SWING_PROPERTY,
           { anim: anim, stop: SWING_STOP, free: SWING_FREE,
             ms: SWING_MS, at: Date.now(),
             // Held for a spell of work, and the tool to put in their hands.
             hold: !!o.hold, tool: Number(o.tool) || 0 });
  } catch (e) {
    /*
      A person whose property will not take is a person without an animation,
      and NOTHING ELSE ABOUT THEIR WORK CHANGES. That sentence was here before
      the yield moved onto the strike and it has to keep being true now that it
      has: the seam has already been taken from by the time this is called, so
      falling out here would leave somebody a piece of ore short because their
      client could not be sent an idle. Everything below runs either way; only
      the animation is lost. Logged once, so a broken client does not fill the
      log.
    */
    if (!SWING_QUIET[actorId]) {
      SWING_QUIET[actorId] = true;
      log('could not ask', actorId.toString(16), 'for a swing animation:', e);
    }
  }
  SWING_IN_AIR[actorId] = true;
  // A held swing is cleared by whoever is holding it, through swingEnd. A
  // timer that cleared it would put the pick away in the middle of the spell
  // it was asked to hold.
  if (SWING_CLEAR[actorId]) { clearTimeout(SWING_CLEAR[actorId]); delete SWING_CLEAR[actorId]; }
  if (o.hold) {
    if (lands) { setTimeout(guard('swingLands', lands), SWING_LAND_MS); }
    return;
  }
  // One timer per person, not one per strike: a miner working a seam sets this
  // again every swing, and the last one is the one that clears.
  const cleanupTimer = setTimeout(function () {
    if (SWING_CLEAR[actorId] !== cleanupTimer) return;
    var valid = !o.alive || o.alive();
    if (SWING_CLEAR[actorId] !== cleanupTimer) return;
    delete SWING_CLEAR[actorId];
    delete SWING_IN_AIR[actorId];
    if (!valid) return;
    /*
      A spent swing rather than null. The script above throws it away on
      either, but this property has only ever held an object and a property
      that refuses the value it is cleared with is a property that is never
      cleared, which is the whole fault. An empty anim and a zero stamp are
      what it checks for first.
    */
    try { mp.set(actorId, SWING_PROPERTY, { anim: '', at: 0 }); } catch (e) { }
  }, SWING_MS + 1000);
  SWING_CLEAR[actorId] = cleanupTimer;
  if (lands) { setTimeout(guard('swingLands', lands), SWING_LAND_MS); }
}
/*
  End a held swing: leave the state and put the tool away.

  A stamp of its own, because the script edge triggers on the stamp and an
  end that reused the last one would be read as the swing it is ending.
*/
function swingEnd(actorId, tool) {
  var runtime;
  try { runtime = mp.getActorRuntimeIdentity(actorId); } catch (e) { }
  if (SWING_CLEAR[actorId]) { clearTimeout(SWING_CLEAR[actorId]); delete SWING_CLEAR[actorId]; }
  delete SWING_IN_AIR[actorId];
  // And cleared behind it, so nothing replays at the next login.
  const cleanupTimer = setTimeout(function () {
    if (SWING_CLEAR[actorId] !== cleanupTimer) return;
    var current;
    try { current = mp.getActorRuntimeIdentity(actorId); } catch (e) { }
    if (SWING_CLEAR[actorId] !== cleanupTimer) return;
    delete SWING_CLEAR[actorId];
    if (!runtime || current !== runtime) return;
    try { mp.set(actorId, SWING_PROPERTY, { anim: '', at: 0 }); } catch (e) { }
  }, 1500);
  SWING_CLEAR[actorId] = cleanupTimer;
  try {
    mp.set(actorId, SWING_PROPERTY,
           { anim: '', end: true, stop: SWING_STOP, free: SWING_FREE,
             tool: Number(tool) || 0, at: Date.now() });
  } catch (e) { }
}

const SWING_QUIET = {};
const SWING_CLEAR = {};
/* Who has a pick in the air right now. See swinging(). */
const SWING_IN_AIR = {};

/*
  Is this person already mid swing?

  Patrick, 22 September: "if you click duitig the animation you get the ore".
  A press that lands inside a swing somebody is already taking is not a second
  strike, it is the same strike clicked twice, and it used to be worth a second
  piece of ore. This is what a branch asks so it can ignore it.
*/
function swinging(actorId) { return !!SWING_IN_AIR[actorId]; }

/*
  ==================== ONE PRESS IS A SPELL OF MINING ======================

  Patrick, in the world on 23 September: "I just mines it's not doing one
  animation with multiple swings it's doing it one at a time and you have to
  keep clicking".

  He is describing vanilla, and vanilla is right: you activate a seam, your
  character works it, and you walk away when you have had enough. One press
  one swing is a clicking game.

  A SESSION IS A STAMP AND NOTHING ELSE. The person is the key, the stamp is
  what tells one spell of mining from the next, and every swing checks that
  the stamp it started under is still the one on the person. Anything that
  wants it stopped clears the entry; the swing in the air finishes and no
  other follows it. Nothing has to be cancelled, which matters because the
  swing itself is a timer on the client and cannot be taken back.

  WHAT STOPS IT, and each of these is a case somebody hit:
    - pressing again, which is how vanilla stops too
    - the seam running out, which already says so
    - the tool breaking, because the next swing has no pick behind it
    - walking away from the seam, measured rather than assumed
    - logging out, since nobody is there to swing
    - MINE_MOST swings, which is a hard stop under any circumstances

  MINE_MOST is well past the twenty a full seam holds. It is not a balance
  number, it is the thing that stops a bug from being infinite.
*/
const MINE_SESSION = {};   // actorId -> the stamp of the spell they are on
const MINE_TOOL = {};      // actorId -> the pickaxe that went into their hands
const MINE_GAP_MS = 350;   // between the end of one swing and the next
const MINE_MOST = 60;      // a hard stop, never reached by a real seam
const MINE_AWAY = 400;     // how far from the seam is walking away

/** Is this person mining right now? */
function mining(actorId) { return !!MINE_SESSION[actorId]; }

/*
  Somebody who has gone is not mining.

  ASKED RATHER THAN TOLD, because there is nothing to tell it. Every event a
  handler in this file can answer is listed over mp.onTakeItem, and a
  disconnect is not one of them, so a spell of mining cannot be ended by
  somebody leaving. It is ended by the next swing noticing they are not here.
  A list that cannot be read answers yes: the other five stops still apply and
  the hard cap is under all of it.
*/
function miningGone(actorId) {
  try {
    const on = mp.get(0, 'onlinePlayers') || [];
    return on.indexOf(actorId) < 0;
  } catch (e) { return false; }
}

/*
  Stop whatever spell of mining this person is on.

  The held animation is left here and nowhere else, because it is held: there
  is no timer under it that would end it on its own, which is the whole point
  of holding it. Everything that stops a spell comes through this.
*/
function stopMining(actorId) {
  if (!MINE_SESSION[actorId]) { return; }
  delete MINE_SESSION[actorId];
  const tool = MINE_TOOL[actorId] || 0;
  delete MINE_TOOL[actorId];
  swingEnd(actorId, tool);
}

/*
  Still at the seam?

  Both positions come off the server, which has had them for everybody since
  the first day, so this asks nothing of the client. A reference whose
  position cannot be read answers yes rather than no: refusing to keep
  swinging because a lookup failed would stop a spell of mining for a reason
  nobody could see, and the other five stops still apply.
*/
function stillAt(actorId, refrId) {
  try {
    const me = mp.get(actorId, 'pos');
    const it = mp.get(refrId, 'pos');
    if (!me || !it || me.length < 3 || it.length < 3) { return true; }
    const dx = me[0] - it[0], dy = me[1] - it[1], dz = me[2] - it[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= MINE_AWAY;
  } catch (e) { return true; }
}

const DEPOSIT_PROPERTY = 'thornswoodDeposit';
/* Seams whose last write threw. See takeFromDeposit. */
const DEPOSIT_UNWRITABLE = {};

/*
  How long a worked out seam takes to come back, by what it gives.

  The miner page's own table (docs/systems/classes/miner.md, "The seam"),
  issue #1380: iron fifteen minutes, gold twenty, corundum and silver ten, and
  thirty for clay, quarried stone, orichalcum, quicksilver, moonstone,
  malachite and shellbug chitin. Until then it was Patrick's two numbers of
  21 September, ten for iron, gold, corundum and silver and thirty for the
  rest. Ebony, the gems, stalhrim and heart stone are not on it: each is one
  place, opened by a scarce quest, and never reaches the deposit.

  BY THE WHOLE NAME, NEVER A PIECE OF ONE. 'Quicksilver Ore' contains
  'silver', and matching pieces of names once put quicksilver on silver's ten
  minutes. A name this table does not carry takes the LONGEST wait in it,
  because a seam nobody has classified being the cheapest tap in the province
  is the failure that matters.
*/
const DEPOSIT_BACK_MIN = {
  'iron ore': 15,
  'gold ore': 20,
  'corundum ore': 10,
  'silver ore': 10,
  'clay': 30,
  'quarried stone': 30,
  'orichalcum ore': 30,
  'quicksilver ore': 30,
  'moonstone ore': 30,
  'malachite ore': 30,
  'shellbug chitin': 30
};
const DEPOSIT_BACK_LONGEST = Math.max.apply(null, Object.keys(DEPOSIT_BACK_MIN).map(function (k) {
  return DEPOSIT_BACK_MIN[k];
}));

function depositBackMs(name) {
  const n = String(name || '').toLowerCase().trim();
  const min = Object.prototype.hasOwnProperty.call(DEPOSIT_BACK_MIN, n)
    ? DEPOSIT_BACK_MIN[n] : DEPOSIT_BACK_LONGEST;
  return min * 60000;
}

/**
 * How many are left in this deposit right now, refilling it when its time is up.
 *
 * Reading is what refills it, the same choice the property lapse and the farm
 * claims made: there is no tick that would notice sooner and nothing in the
 * world changes until somebody asks.
 */
function depositLeft(refrId, backMs) {
  let d = null;
  try { d = mp.get(refrId, DEPOSIT_PROPERTY); } catch (e) { d = null; }
  if (!d || typeof d !== 'object') { return DEPOSIT_SIZE; }
  const left = Number(d.left);
  const at = Number(d.at) || 0;
  if (!(left >= 0)) { return DEPOSIT_SIZE; }
  if (left > 0) { return left; }
  // Empty, so the only question is whether it has had long enough.
  if (at && (Date.now() - at) >= backMs) { return DEPOSIT_SIZE; }
  return 0;
}

/** Take one out, and stamp the moment it ran dry. */
function takeFromDeposit(refrId, backMs) {
  const left = depositLeft(refrId, backMs);
  if (left <= 0) { return 0; }
  const now = left - 1;
  try {
    mp.set(refrId, DEPOSIT_PROPERTY, { left: now, at: now === 0 ? Date.now() : 0 });
    delete DEPOSIT_UNWRITABLE[refrId];
  } catch (e) {
    /*
      ONCE PER SEAM, NOT ONCE PER SWING, AND NEVER SILENTLY.

      This already logged, and the log is what nobody was reading, because a
      seam that cannot be written is also a seam that reads full: the person
      sees ore coming out and nothing looks wrong from any side. Patrick got a
      hundred out of one vein before anybody noticed.

      A line per swing would be a hundred lines and would bury the first one,
      so it is the first swing on each seam that says it, and the message says
      what it MEANS rather than only what failed. The count is kept so a seam
      that starts working again is not held against it.
    */
    if (!DEPOSIT_UNWRITABLE[refrId]) {
      DEPOSIT_UNWRITABLE[refrId] = true;
      log('THE SEAM AT', refrId.toString(16), 'CANNOT BE WRITTEN, so it will ' +
          'never run out and everybody can take from it forever:', e);
    }
  }
  return now + 1;
}

/** What to say when a seam is empty, in minutes rather than seconds. */
function depositBackIn(refrId, backMs) {
  let d = null;
  try { d = mp.get(refrId, DEPOSIT_PROPERTY); } catch (e) { d = null; }
  const at = (d && Number(d.at)) || 0;
  if (!at) { return 'It will come back.'; }
  const left = Math.max(0, backMs - (Date.now() - at));
  const mins = Math.ceil(left / 60000);
  return 'It comes back in about ' + mins + (mins === 1 ? ' minute.' : ' minutes.');
}

/*
  THE CHANCE OF ONE MORE. docs/systems/classes/miner.md, issue #1380.

  A swing takes 1 ore of its seam and has a chance of one more. The chance
  grows with the rank, and from advanced the extra can be the next tier up,
  from expert two tiers up. One roll decides it, the three chances laid end to
  end, so a swing never drops more than one extra:

    rank      same ore   next tier   two tiers up
    novice    5%
    advanced  10%        2%
    expert    15%        5%          1%
    master    20%        8%          2%

  The tiers are iron, clay and quarried stone; then corundum, silver,
  orichalcum and quicksilver; then gold, moonstone and malachite. Inside a tier
  each name is an equal chance. Ebony, the gems, stalhrim and heart stone are
  never an extra, so a roll that would go past the third tier gives nothing,
  and the same-ore roll still stands. Shellbug chitin is in no tier: its own
  seam can give a second one, and no other seam ever gives it.

  The extra comes out of the same seam of twenty, so a seam still holds twenty
  ore in all, and it is the same swing and the same one piece of work.
*/
const ORE_EXTRA_PCT = [
  [5, 0, 0],
  [10, 2, 0],
  [15, 5, 1],
  [20, 8, 2]
];
const ORE_TIERS = [
  ['Iron Ore', 'Clay', 'Quarried Stone'],
  ['Corundum Ore', 'Silver Ore', 'Orichalcum Ore', 'Quicksilver Ore'],
  ['Gold Ore', 'Moonstone Ore', 'Malachite Ore']
];
/*
  ONE PLACE EACH, AND SHUT WITHOUT THE QUEST.

  These seams are the scarce quest's, in the custom quests block at the foot
  of this file. If that block ever fails to start, these answer shut rather
  than falling through to the ordinary deposit, because a seam of twenty ebony
  at every vein in the province is the one thing the plan rules out.
*/
const ORE_ONE_PLACE = ['Ebony Ore', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Stalhrim', 'Heart Stone'];
let ORE_DESC_BY_NAME = null;

/* The ore a name gives, read off the seam table once, so no form id is typed here. */
function oreDescByName(name) {
  if (!ORE_DESC_BY_NAME) {
    const found = {};
    Object.keys(ORES_BY_BASE).forEach(function (base) {
      const row = ORES_BY_BASE[base];
      if (row && row.name && row.ore && !found[row.name]) { found[row.name] = row.ore; }
    });
    ORE_DESC_BY_NAME = found;
  }
  return ORE_DESC_BY_NAME[name] || '';
}

/**
 * The extra ore of one swing, as { ore, name }, or null for none.
 *
 * roll is one number from 0 up to 1. Where it lands inside a tier's slice
 * picks the name, so one roll is also the equal chance among that tier.
 */
function oreExtra(seam, step, roll) {
  if (!seam || !seam.name || !seam.ore) { return null; }
  if (ORE_ONE_PLACE.indexOf(seam.name) !== -1) { return null; }
  const pct = ORE_EXTRA_PCT[step] || ORE_EXTRA_PCT[0];
  const r = Number(roll) * 100;
  if (!(r >= 0)) { return null; }
  if (r < pct[0]) { return { ore: seam.ore, name: seam.name }; }
  let tier = -1;
  for (let t = 0; t < ORE_TIERS.length; t++) {
    if (ORE_TIERS[t].indexOf(seam.name) !== -1) { tier = t; }
  }
  if (tier < 0) { return null; }
  let lo = pct[0];
  for (let up = 1; up <= 2; up++) {
    const hi = lo + pct[up];
    if (r < hi) {
      const names = ORE_TIERS[tier + up];
      if (!names) { return null; }
      const name = names[Math.min(names.length - 1, Math.floor(((r - lo) / (hi - lo)) * names.length))];
      const ore = oreDescByName(name);
      return ore ? { ore: ore, name: name } : null;
    }
    lo = hi;
  }
  return null;
}

function mineOre(actorId, refrId, baseDesc) {
  if (!isVein(baseDesc)) return null;
  const seam = ORES_BY_BASE[baseDesc];

  // Rare work owns its identity and record before class/tool callbacks run.
  const rareQuests = globalThis.__thornswoodQuests;
  const onePlace = ORE_ONE_PLACE.indexOf(seam.name) !== -1;
  if (onePlace || (rareQuests && rareQuests.isRareSeam && rareQuests.isRareSeam(seam))) {
    if (rareQuests && rareQuests.mineRare) { return rareQuests.mineRare(actorId, refrId, seam); }
    return 'This place is shut.';
  }

  // The class first, and before the cooldown, the same ordering mineSalt and
  // harvest() settled on and for the same reason: somebody who is not a miner
  // is never going to work this seam, and 'it needs 14 more seconds' tells
  // them the wrong thing about why nothing happened.
  const mine = classGate(actorId, 'mine');
  if (mine) return mine;

  // The pickaxe, after the class and before the rank and the cooldown, which is
  // the same order the quarry uses. A miner standing at an ebony seam with no
  // pickaxe is told about the pickaxe first, because that is the one they can
  // do something about today.
  const tool = toolGate(actorId, 'miner');
  if (tool) return tool;

  const step = rankStep(actorId, 'miner');
  const pair = (seam.yield && seam.yield[step]) || [0, 0];
  if (pair[0] <= 0 && pair[1] <= 0) {
    return 'This seam is ' + seam.name + '. Working it takes ' + rankWord(seam.rank) +
           ' Miner. Work the seams you can until you are one.';
  }

  /*
    THE DEPOSIT, IN PLACE OF THE OLD PER-PERSON COOLDOWN.

    MINE_COOLDOWN_MS used to refuse the person for between ten minutes and four
    hours after one strike, and it was the only thing standing between a Master
    Miner and every gem seam in the province, because nothing in the engine
    depletes one. A deposit does that job better and reads as a place rather
    than a punishment: twenty in the seam, one a swing, and it comes back on
    its own clock for everybody at once.

    The clock is Patrick's: ten minutes for iron, gold, corundum and silver,
    thirty for everything else, with anything unnamed taking the longer one.
  */
  /*
    A PRESS THAT LANDS INSIDE A SWING IS NOT A SECOND STRIKE.

    Patrick, 22 September: "if you click duitig the animation you get the ore".
    Clicking four times while the pick was still up was four pieces of ore off
    a seam that had only been struck once. Nothing is said: an early click is
    not a mistake worth a sentence, and the strike they are already taking is
    about to hand them what they came for.
  */
  /*
    AND A PRESS WHILE ALREADY MINING PUTS THE PICK DOWN.

    The same button starts and stops it, which is how the seam behaves in the
    game everybody already knows. Said out loud, because a character who
    stops swinging with nothing on screen reads as the thing having broken
    again.
  */
  if (mining(actorId)) {
    stopMining(actorId);
    return 'You put the pick down.';
  }
  if (swinging(actorId)) { return ''; }

  const backMs = depositBackMs(seam.name);
  const took = takeFromDeposit(refrId, backMs);
  if (!took) {
    return 'This seam is worked out. ' + depositBackIn(refrId, backMs);
  }

  /*
    THE PICK GOES UP HERE AND THE ORE COMES OFF WHEN IT LANDS.

    Everything above this line is a refusal, and a refusal has to be immediate:
    somebody who is not a miner, has no pickaxe, is not ranked for the seam or
    is standing at a worked out one is told so on the press, the way they
    always were. Everything below it is the yield, and the yield is what moves.

    The seam is taken from on the press and not on the strike, deliberately.
    Two miners at one vein must not both be handed the last of it because both
    of them clicked before either pick came down; the pile is the shared thing
    and the strike is the private one. The cost of that ordering is a single
    piece of ore lost out of a seam if the server stops inside the 900ms, and
    a seam refills on its own clock anyway.
  */
  const spell = Date.now();
  MINE_SESSION[actorId] = spell;
  let swungThisSpell = 0;
  /*
    ONE ANIMATION FOR THE WHOLE SPELL, WITH THEIR OWN PICKAXE IN IT.

    Patrick, 23 September: "It's stopping the animation and going back in
    that doesn't flow smoothly", and "Still a pick on my hip when I am
    swinging". Both are the same shape. A swing per strike meant enter,
    swing, exit, enter, swing, exit, which is the stutter; and an idle mimes
    rather than drawing anything, which is the pick staying on the hip.
    Neither is fixed by a better number.

    IdlePickaxeEnter is a state, so the spell enters it ONCE with the tool in
    hand, strikes on a clock while it lasts, and leaves it once at the end.
    The strikes after the first send no animation at all: the character is
    already mining.
  */
  const pick = toolIdIn(actorId, 'miner');
  MINE_TOOL[actorId] = pick;

  /*
    The next swing of the same spell, or the end of it.

    Written as a function so the first swing and every one after it are the
    same code: the first is this one called immediately, which is why the
    press still takes from the seam and still refuses everything it used to
    refuse before a pick ever goes up.
  */
  const again = function () {
    if (MINE_SESSION[actorId] !== spell) { return; }
    if (miningGone(actorId)) { stopMining(actorId); return; }
    if (swungThisSpell >= MINE_MOST) { stopMining(actorId); return; }
    if (!stillAt(actorId, refrId)) {
      stopMining(actorId);
      return;
    }
    // The tool is asked for again every swing rather than once at the top:
    // a pick that broke on the last strike is a spell that ends here.
    if (toolGate(actorId, 'miner')) { stopMining(actorId); return; }
    const more = takeFromDeposit(refrId, backMs);
    if (!more) {
      stopMining(actorId);
      const done = 'This seam is worked out. ' + depositBackIn(refrId, backMs);
      notify(actorId, done);
      say(actorId, done);
      return;
    }
    swungThisSpell++;
    strike(more);
  };

  const strike = function (took) {
  const lands = function () {
    // One a swing, not the whole pile. The rank still decides WHICH seams are
    // workable at all, which is what seam.yield's pair of zeroes says.
    const yielded = 1;
    // addItem answers false in one case only, which is idOf returning 0
    // because the plugin that owns this ore is not in the load order. The
    // quarry says 'nothing you can carry' there, which would send somebody off
    // to empty their pack over a fault in the build, so this says what is
    // actually wrong and where to take it, in the shape the farming block
    // already says it in for the same fault.
    if (!addItem(actorId, seam.ore, yielded)) {
      const broken = 'The seam gives up ' + seam.name + ' and there is nothing in ' +
                     'this load order to put in your hands. Say so in the dev channel.';
      notify(actorId, broken);
      say(actorId, broken);
      return;
    }
    /*
      The chance of one more, out of the same seam. Given before it is taken,
      so an extra the load order cannot hand over leaves the seam as it was.
      If it was the last one there, this swing is the one that ends the seam.
    */
    economyGathered(actorId, seam.ore, yielded);
    const extra = oreExtra(seam, rankStep(actorId, 'miner'), Math.random());
    if (extra && depositLeft(refrId, backMs) > 0 && addItem(actorId, extra.ore, 1)) {
      economyGathered(actorId, extra.ore, 1);
      if (takeFromDeposit(refrId, backMs) === 1) { took = 1; }
    }
    const rank = creditWork(actorId, 'mine');
    const worn = wearTool(actorId, 'miner');
    /*
      NOTHING SAID FOR AN ORDINARY SWING. Patrick on the chopping block, and it
      is the same complaint: "I dont want that spam everytime". A swing a second
      with a line each is a wall of text over the thing you are trying to watch.

      The three worth interrupting somebody for are kept: a rank going up, a tool
      about to break, and the last one out of the seam, because that is the
      moment it is worth walking away from.
    */
    const last = (took === 1)
      ? 'That is the last of this seam. ' + depositBackIn(refrId, backMs) : '';
    const saying = [rank, worn, last].filter(function (x) { return !!x; }).join(' ');
    if (saying) {
      notify(actorId, saying);
      say(actorId, saying);
    }
    if (took === 1) { stopMining(actorId); return; }
    /*
      The next strike, on the animation's own rhythm.

      One swing's worth from this strike to the next, so the ore keeps coming
      off the pick at the rate the pick is moving. Nothing is sent to the
      client for it: the character is already in the animation and stays in
      it, which is what stopped the stutter.
    */
    setTimeout(guard('mineAgain', again), SWING_MS);
  };

  /*
    THE FIRST STRIKE ENTERS THE ANIMATION. EVERY ONE AFTER IT DOES NOT.

    hold keeps the client in IdlePickaxeEnter with the pickaxe in hand until
    stopMining sends the one exit, so a spell of mining is one animation with
    many strikes in it rather than many animations.
  */
  if (swungThisSpell <= 1) {
    swing(actorId, SWING_MINE, function () { lands(); }, { hold: true, tool: pick });
  } else {
    setTimeout(guard('mineLands', function () { lands(); }), SWING_LAND_MS);
  }
  };

  swungThisSpell = 1;
  strike(took);
  /*
    ONE ANIMATION, AND THIS IS WHY IT IS NOT ALLOW ANY MORE.

    Patrick, 22 September: "tehre are two". There were. ALLOW went on this
    branch to stop `return false` throwing the mining animation away, and then
    swing() was added above when that turned out not to have brought one back.
    The note at SWING_PROPERTY says why it could not have: a vein's animation
    is MineOreScript's and no Papyrus object script runs here, so for an ACTI
    vein ALLOW hands the press to an engine that does nothing with it.

    For a vein that is a FURN record it is not nothing. The table is built out
    of the ACTI AND FURN records carrying MineOreScript, and furniture does not
    need Papyrus: the press puts the person into Skyrim's own mining furniture,
    which is the second animation, the one that holds a real pickaxe, and a
    second way to be stuck standing at a seam. Two patches for one symptom,
    both left in.

    The swing above is the one that works at all 581 seams, ACTI and FURN
    alike, so it is the one that is kept, and this goes back to blocking the
    handover the way every other branch does. Empty rather than a sentence:
    there is nothing to tell somebody about an ordinary strike.
  */
  return '';
}

/**
 * Charcoal kiln: firewood in, graded charcoal out. The Charburner RANK sets
 * the grade.
 *
 * NOT a class verb, and this is the one gate that is a profession's rather
 * than a class's. classes.md gives the five classes loot, fish, gather, mine
 * and farm, and nothing else; the kiln takes firewood somebody already has and
 * turns it into charcoal, which is making rather than producing, and the
 * rulebook puts it under Woodworker: 'Charburner, firewood through to coke'.
 * So the question is canWork('charburner'), not canDo. A Woodwright answers
 * yes at novice, because 'you get the novice work of your sister half for
 * nothing', and gets the plain grade for the same reason: the grade is the
 * rank now, where it used to be the woodcutting manual's tier. 'Each rank
 * opens more of what you are able to make.'
 */
/*
  THE CHOPPING BLOCKS. THE WOODWRIGHT'S VERB, AND THE ONLY ONE THEY HAVE.

  Patrick, 21 September, correcting an earlier attempt of mine that overrode all
  three of these records into crafting benches: "The chopping block shouldn't be
  a bench just for getting the firewood and not usable by non woodworkers and
  also have the animation script". So the plugin does not touch them at all, the
  records stay Bethesda's, and the whole of this is server side.

  THE THREE RECORDS, read out of Skyrim.esm on 21 September rather than
  remembered. All three are FURN with WBDT 00ff, which is 'not a bench', which is
  why standing at one has never opened anything:

    0x07022E  WoodChoppingBlock          the common one
    0x0A91BF  WoodChoppingBlockSnow      the same block in the snow regions
    0x10F575  WoodChoppingBlockCOPY0000  a stray duplicate, and the one that is
                                         missing FurnitureWoodChoppingBlock

  AND A FOURTH, IN Dragonborn.esm, added 24 September:

    0x03828B  DLC2WoodChoppingBlockAsh   Solstheim's, three placed, all in
                                         DLC2SolstheimWorld

  The chopping blocks fix of 24 September read every placed block in the load
  order and found this base missing here, so the three on Solstheim were
  outside the Woodwright rules: a press fell through every branch of the
  activate chain to loot(), which answers nothing for a thing that is not an
  actor, and the engine sat whoever pressed it down to swing, whatever their
  trade, while chopWood never ran and no Woodwright was paid. Read out of the
  plugins the same day (C:\Thornswood\Game\Data and the profile's plugins.txt,
  last one wins, nothing overrides it): the same model as WoodChoppingBlock,
  the same three keywords including FurnitureWoodChoppingBlock, the same WBDT
  00ff, the same markers and the same ResourceFurnitureScript. It is the common
  block with ash on it.

  All four are here because a person cannot tell one chopping block from
  another, which is the same reason TOOLS.farmer accepts both shovels.

  WHY IT IS THE WOODWRIGHT'S AND NOT THE WOODWORKER'S. The kiln gates on
  'charburner' and a Woodwright gets its novice grade for nothing, because 'you
  get the novice work of your sister half for nothing'. This is that rule the
  other way round: the block is the Woodwright's and a Charburner may chop at
  novice. Until today the Woodwright had no verb and no bench in the entire load
  order, so half of the Woodworker was a title with nothing behind it.
*/
const CHOPPING_BLOCKS = ['7022e:Skyrim.esm', 'a91bf:Skyrim.esm', '10f575:Skyrim.esm',
                         '3828b:Dragonborn.esm'];

/** True when this base is one of the four chopping blocks. */
function isChoppingBlock(baseDesc) {
  for (let i = 0; i < CHOPPING_BLOCKS.length; i++) {
    if (CHOPPING_BLOCKS[i] === baseDesc) { return true; }
  }
  return false;
}

/**
 * A chopping block: firewood out, and nothing in. The Woodwright's verb.
 *
 * NOT a bench and not a crafting menu. Patrick, 21 September: it is "just for
 * getting the firewood and not usable by non woodworkers". So it is answered
 * here the way the quarry and the kiln are, and the four records in Skyrim.esm
 * and Dragonborn.esm are left exactly as Bethesda wrote them. See CHOPPING_BLOCKS.
 *
 * THE YIELD RISES WITH THE RANK, the same shape mineSalt uses, because the whole
 * of the wood chain hangs off this: firewood is what the kiln burns and what a
 * handle is cut from, so a Master Woodwright supplying a village has to be worth
 * more per swing than a novice. One to two at novice, up to one to five at
 * Master.
 *
 * THE AXE IS ASKED FOR under the profession rather than the half, which is what
 * the kiln does and for the same reason: both halves of the Woodworker are
 * woodworkers and neither of them chops wood without an axe. It also means the
 * axe wears here, which is the point of a tool that breaks: the trade that uses
 * it hardest is the one that buys the most of them.
 */
/*
  WHO IS STANDING AT WHICH BLOCK, AND WHEN THEY LAST PRESSED IT.

  Patrick, 21 September: "the chopping block is still not always doing the
  animation and not always giving the wood apon hit still".

  The server sees a PRESS. The block is a FURN record, so pressing it puts the
  person into Skyrim's own chopping furniture and the axe falls over and over
  while the server hears nothing at all, and vanilla's own block script, which
  would have handed wood over per swing, does not run here any more than
  MineOreScript does. So one press was one handover and everything after it was
  a person swinging an axe at a server that had stopped listening.

  The client can see each swing, because the animation events pass through it.
  It reports them on the one channel that exists, the chat overlay's socket,
  as /chopped. That channel is a chat line, so anybody could type the word, and
  this is what stops that being worth anything: a /chopped is only credited to
  somebody the server has just watched press a chopping block, and no faster
  than an axe can actually fall.
*/
const CHOP_AT = {};
/* A press is good for this long. Longer than anybody chops in one go, short
   enough that it is not a licence to type the word an hour later. */
const CHOP_WINDOW_MS = 120000;
/* The fastest an axe falls. Two a second is not an axe, it is a chat macro. */
const CHOP_MIN_MS = 1200;

/*
  One swing's worth, reported by the client rather than pressed.

  Every gate chopWood applies is applied again here, by calling chopWood
  itself: the half, the tool, the rank and the wear all have to be asked again
  because a session can outlast any of them. A tool that broke on the last
  swing stops the next one, which is the whole point of counting swings.
*/
function choppedSwing(actorId) {
  const at = CHOP_AT[actorId];
  if (!at) { return null; }
  const now = Date.now();
  if (now - at.at > CHOP_WINDOW_MS) { delete CHOP_AT[actorId]; return null; }
  if (now - (at.last || 0) < CHOP_MIN_MS) { return null; }
  at.last = now;
  return chopWood(actorId, at.refrId, true);
}

/*
  ============ THREE BLOCKS THAT ARE NOT OURS TO WORK, BY WHERE THEY STAND ===

  Djinn, 22 September, in "Removal from area - Woodworking chopping Blocks":

    Solitude:          -64263, 106003.5, -8377.8
    Solitude Stables:  -76193.3, 96600.6, -11435
    Dragon Bridge:     -101780.7, 80484.5, -12522.7

  BY POSITION, BECAUSE THE BASE IS SHARED. CHOPPING_BLOCKS is four BASE
  records and every block in Skyrim is one of them, so there is no way to name
  one block without naming all of them. A placed reference cannot be deleted
  from here either: that is a change to a plugin, which is a rebuild and a
  pack and a server that will not start if it goes wrong. A place is something
  this file can hold, the same way a notice board is a place, and it costs one
  distance check on a press that was going to do work anyway.

  THE RADIUS IS GENEROUS ON PURPOSE. 300 units is about two paces wider than a
  block and its stump, and the nearest block Djinn did not name is a hold away
  from any of these, so there is nothing for it to catch by accident.

  WHAT A PRESS DOES NOW: nothing, and it says so once. The activate chain
  blocks the handover, so Skyrim's own furniture does not start either and
  nobody is left swinging at a block that pays nothing.
*/
const BLOCKS_OFF = [
  { where: 'Solitude', pos: [-64263, 106003.5, -8377.8] },
  { where: 'Solitude Stables', pos: [-76193.3, 96600.6, -11435] },
  { where: 'Dragon Bridge', pos: [-101780.7, 80484.5, -12522.7] }
];
const BLOCK_OFF_REACH = 300;

/** The named site a block is standing on, or null. See BLOCKS_OFF. */
function blockIsOff(refrId) {
  let pos = null;
  try { pos = mp.get(refrId, 'pos'); } catch (e) { return null; }
  if (!pos) { return null; }
  for (let i = 0; i < BLOCKS_OFF.length; i++) {
    const b = BLOCKS_OFF[i];
    const dx = pos[0] - b.pos[0], dy = pos[1] - b.pos[1], dz = pos[2] - b.pos[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= BLOCK_OFF_REACH) { return b.where; }
  }
  return null;
}

function chopWood(actorId, refrId, fromSwing) {
  /*
    #842: Skyrim starts the chopping FURN on the client the moment E is
    pressed. mp.onActivate returning false only stops the server's
    ProcessActivateNormal; the axe loop is already running locally. A
    refused press (wrong half, no axe, off-limits block, or no firewood
    form) must kick that loop the same way a mining spell ends:
    IdleChairExitStart then IdleForceDefaultState via swingEnd.
  */
  // Before the class and the axe, because this block is not work for anybody
  // and telling a woodworker they lack a tool at one would be a lie.
  const off = blockIsOff(refrId);
  if (off) {
    swingEnd(actorId);
    return fromSwing ? '' : 'Nobody works this block. There are others in ' + off + '.';
  }

  const half = halfGate(actorId, 'woodwright', 'novice',
    'A chopping block is a woodworker\'s. Only a woodworker who took Woodwright can ' +
    'work one, and a charburner gets the novice yield. Ask one.');
  if (half) { swingEnd(actorId); return half; }

  const tool = toolGate(actorId, 'woodworker');
  if (tool) { swingEnd(actorId); return tool; }

  /*
    NO WAIT BETWEEN SWINGS, because a swing is the unit now.

    There was twenty seconds between presses, which is right for a press that
    hands over a pile and wrong for one that hands over a split. Patrick asked
    for wood each time the axe falls, so the only thing left to limit it is how
    long somebody wants to stand there swinging, which is the point.
  */

  /*
    TWO A SPLIT, EVERY SPLIT, AND NOTHING SAID ABOUT IT.

    Patrick, 21 September, after playing it: "it outs alot spam like you did
    this amnouint of tiem Idont want that spam everytime", and "it should give 2
    each time the wood is split udring the looping animation".

    THE YIELD. It was randInt(1, 2 + step), so a novice got one or two and it
    changed every time. Two, flat, per split. A rank still matters because a
    higher rank splits are not what this measures; the rank shows up in what the
    charcoal kiln gives and in the recipes the half unlocks.

    THE SPAM. Every press said "You split N firewood", plus the rank line and
    the tool-wear line, and the chopping animation loops, so a minute of
    chopping was a wall of text. Nothing is said for an ordinary split now. The
    two lines that actually matter are kept: a rank going up is news, and a tool
    about to break is a warning somebody needs before it happens.

    WHAT IS STILL NOT RIGHT, said here rather than pretended: the server sees
    one press, not one swing. Vanilla's own block script hands over its firewood
    at the end of the animation, which is the "one at the end" Patrick saw. Per
    swing needs the client to tell the server each time the axe falls, and that
    is a plugin change and its own entry.
  */
  const yielded = 2;
  if (!addItem(actorId, ITEMS.firewood, yielded)) {
    swingEnd(actorId);
    return 'The block gives up firewood and there is nothing in this load order to ' +
           'put in your hands. Say so in #bugs.';
  }
  /*
    The press is what starts a session, and the block is a FURN so Skyrim's own
    furniture plays the swing. THE SERVER ASKS FOR NO ANIMATION HERE AT ALL.

    It used to ask for one on every reported swing, and that was the wrong way
    round. The report only ever arrives DURING the furniture loop, because the
    client counts the falls of an axe the engine is already swinging, so
    IdleWoodChopStart landed in the middle of the animation it was meant to
    start and restarted it. Patrick, 21 September: "the chopping block is still
    not always doing the animation". That is what the stutter was, and with the
    frame loop at SWING_PROPERTY on top of it the restart was every frame.

    A seam is the other case and it is why swing() still exists: nothing in the
    engine animates a press on a vein, so the server has to.
  */
  if (!fromSwing) {
    CHOP_AT[actorId] = { refrId: refrId, at: Date.now(), last: Date.now() };
  }
  economyGathered(actorId, ITEMS.firewood, yielded);
  const rank = creditWork(actorId, 'woodwright');
  const worn = wearTool(actorId, 'woodworker');
  // Only when there is something worth interrupting them for, and the press
  // goes on being a press so Skyrim swings the axe.
  const saying = ((rank || '') + (rank && worn ? ' ' : '') + (worn || '')).trim();
  if (saying) {
    notify(actorId, saying);
    say(actorId, saying);
  }
  return ALLOW;
}

/*
  AND THE SERVER HOLDS THE THREE BLOCKS DISABLED (#495).

  thornswood-front.js has taken them out of the world on each person's own
  machine since 24 September, and had to do it again every four seconds:
  the client re-enabled every Skyrim.esm reference the server streamed that
  the server did not say was disabled, because the server said so as
  "isDisabled" and the client read "disabled". Fork a922b480 reads the right
  name. With the server itself holding the three disabled, every client on
  that build is told so when the block streams in, and it stays gone without
  the loop. The disabled flag is on the reference's change form, so it
  survives a restart; setting it again at every start costs one read each.
  The plugin's loop stays for launchers from before that client.
*/
const BLOCKS_OFF_REFS = ['d6ae9:Skyrim.esm', 'a9ee1:Skyrim.esm', 'abf83:Skyrim.esm'];

function disableBlocksOff() {
  let took = 0;
  for (let i = 0; i < BLOCKS_OFF_REFS.length; i++) {
    const id = idOf(BLOCKS_OFF_REFS[i]);
    if (!id) { log('chopping block', BLOCKS_OFF_REFS[i], 'is not in this load order, left alone'); continue; }
    try {
      if (!mp.get(id, 'isDisabled')) { mp.set(id, 'isDisabled', true); took++; }
    } catch (e) {
      log('could not hold chopping block', BLOCKS_OFF_REFS[i], 'disabled:', e);
    }
  }
  if (took) { log('the server holds', took, 'chopping block(s) out of the world'); }
  return took;
}
disableBlocksOff();

/*
  AND WHAT A PLUGIN NOTHING IS COPIED FROM STANDS IN THE WAY OF (#3077, #2454).

  Thornswood-Last.esp switches every floor item and every cut actor off by
  carrying an override of it, initially disabled, with the cell and world it
  stands in. Nothing of Immersive Armors is copied (Patrick, 17 Oct, #2454;
  and 22 Oct, q-613-ia-recipes: the floor items it places and the cell and
  world headers under them were never his to carry). So a floor item it
  places, and a floor item or cut actor standing in a cell or world it wins,
  is not in the plugin, and the server holds it disabled itself, the same
  way and for the same reason as the chopping blocks above: every client is
  told when the reference streams in, and the flag is on the reference's
  change form. HELD_BY_SERVER is written by scripts/mods/Build-LastPlugin.py.
*/
// Written by scripts\mods\Build-LastPlugin.py into its table file (game\data\last-plugin.json says the
// same in floorItems.heldByServer and refs.heldByServer). Placed by, or standing where, a plugin it never copies from.
var HELD_BY_SERVER = table('HELD_BY_SERVER');

function holdNeverCopiedOff() {
  let took = 0;
  for (let i = 0; i < HELD_BY_SERVER.length; i++) {
    const id = idOf(HELD_BY_SERVER[i]);
    if (!id) { log('reference', HELD_BY_SERVER[i], 'is not in this load order, left alone'); continue; }
    try {
      if (!mp.get(id, 'isDisabled')) { mp.set(id, 'isDisabled', true); took++; }
    } catch (e) {
      log('could not hold', HELD_BY_SERVER[i], 'disabled:', e);
    }
  }
  if (took) { log('the server holds', took, 'reference(s) the last plugin cannot switch off out of the world'); }
  return took;
}
holdNeverCopiedOff();

/*
  THE KILN IS A BENCH, AND A PRESS ON IT IS THE ENGINE'S (#2337).

  Until 12 Oct a press on the charcoal kiln was answered here by a function
  that burned three firewood into one grade of charcoal on a second press
  inside fifteen seconds. It was written on 21 September because the kiln's
  crafting menu had nothing in it, and its own comment said so: four charcoal
  recipe records "would turn this into an ordinary bench with an ordinary menu
  and delete" it, which was "the right end state". Patrick's report that day
  was "it's making charcoal automatically instantly upon opening the kiln and
  not when you click to make it".

  The plugin carries those four recipes now, and the Tool Handle and the
  Splint, all six on the kiln's keyword. So the press answer had become the
  fault: onActivate answered every kiln press with a line and false, which
  skips ProcessActivateNormal, the engine step that seats a person at a FURN
  and opens its menu for them; and on the client, where furniture is not
  blocked, opening the menu twice inside the window burned three firewood
  nobody asked to spend. Nothing here answers a kiln press now. benchGate
  still refuses it to anybody who is not a woodworker, and the menu's rows go
  through mp.onCraft like every other bench: the half and rank on each row,
  the fit-to-make gate, and the work counted. tests/test-2337-kiln-menu.js
  holds it.
*/

