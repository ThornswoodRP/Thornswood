// ---------------------------------------------------------------------------
// scripted activators
//
// A shrine, a lever, a chain, a notice board and a nirnroot are the same kind
// of record: ACTI, an activator whose whole behaviour lives in an attached
// Papyrus script. On this server not one of those scripts runs, for two
// reasons that stack.
//
//   1. The server has no scripts. Its script storage is data/scripts plus any
//      archive named in the "archives" setting, and data/scripts holds exactly
//      one file: ActiveMagicEffect.pex. "archives" is not set at all, so
//      Skyrim's own script archive is never opened. Nothing vanilla is
//      attached to anything, anywhere.
//
//   2. Even with scripts present, the client is told not to run them. SkyMP
//      answers an activator with a bare OpenContainer message and the client
//      replies to that with refr.activate(player, true). The second argument
//      is abDefaultProcessingOnly: default behaviour only, no OnActivate. So
//      the script does not fire locally either.
//
// Which is why pressing E on a shrine does nothing at all, and why nirnroot
// cannot be picked: nirnroot is ACTI 0xE1FB2, not a FLOR, so it never reaches
// the branch of the server that hands out a harvested plant.
//
// The two below are done by hand because both effects are server side and
// therefore reliable: an ingredient into the pack, which is an ordinary
// inventory write, and an ability onto the character, which Actor.AddSpell
// records server side and re-sends on every spawn. Levers, chains and notice
// boards are not done here. They need the real script and there is no way to
// fake what they do; the way back for those is putting Skyrim's .pex files in
// the server's data/scripts.
// ---------------------------------------------------------------------------

/*
  EVERY PLANT IN THE LOAD ORDER, AND IT IS GENERATED.

  Everything between the declaration below and the line that closes the block
  is written by the harvests pass in scripts\dev\Build-HarvestTable.ps1, out of the
  FLOR and TREE records of the 101 plugins and 5 masters this build enables:
  105 plants, the same table as the harvests key of
  game\data\harvests.json. DO NOT HAND EDIT IT. The next run of that script
  replaces every line between them and takes any correction with it. Same
  arrangement as CROPS_BY_BASE below and SPELL_IDS further down.

  It is seeded empty and the script fills it. A row says:

    produce  the item the record hands over when the plant is picked.
    name     what a person is told they picked.
    rank     THE GATHERER'S LADDER, and unlike the crops this is the one that
             gates. harvests.json ranks by the gold value of the produce
             against the thresholds at the top of it, which is a fair reading
             of what a plant is worth to pick: the 105
             rows come out 42 novice, 41 advanced, 20 expert and 2 master. That
             is the opposite of what the same arithmetic did to the crops, where
             ten of eleven landed on one rung, which is why the crops carry a
             hand written rule beside them and the plants do not need one.

  THE TABLE WAS 181 ROWS AND THE FIRST RUNG OF IT WAS EMPTY IN THE OPEN WORLD.
  Measured on 20 September, the same day the table went in: 50 rows ranked
  novice, and 33 of them were the HearthFires planter sacks, which are a MISC
  the records price at nothing and a Papyrus script opens into three of the real
  ingredient, so they gated nothing and handed over a sack that this server
  cannot open. One was the clam at Oar's Rest and one the tree in the Ancestor
  Glade. The 15 that were left were every one of them a white cap, an imp stool
  or a namira's rot in a cave. So a new Gatherer was refused every flower in
  Skyrim, and with workPerRank.advanced at 20 as it was then, the only road onto
  the second rung was twenty cave mushrooms. The pass now leaves the sacks out and reads the
  novice band as produce worth up to 1 gold, which is lavender, thistle, creep
  cluster, juniper berries, jazbay grapes, hanging moss and the rest of them:
  47 wild bases on the first rung instead of 15. The three numbers that did
  that are RANK_MAX_VALUE, PRODUCE_A_SCRIPT_MUST_OPEN and OUR_STATIONS, all in
  the knobs at the top of the script, each with what was measured beside it.

  AND A PLANT WHOSE PRODUCE IS FOOD IS NEVER A ROW HERE EITHER, which is the
  change of 21 September and the largest one this table has had. Patrick: 'The
  farmer grows the crops? Those crops should be used to make food, why is a
  gatherer giving them all the food ingredients when they gather herbs and
  things.' Measured that day over the 131 rows this table then had, 106 gave an
  alchemy reagent, which is the gatherer's work as classes.md describes it, and
  24 gave food. Counted the same day over tools\recipes.json, the gatherer
  supplied the Cook 225 of that profession's inputs and the farmer supplied the
  Cook nothing at all.

  So the pass now sorts on the produce: a plant whose produce is an alchemy
  reagent is the gatherer's and a plant whose produce is food is not, food being
  bit 0x2 of an ALCH record's ENIT flag word, which tools\Build-RecipeTable.ps1
  proves against the five masters and already gates the whole Cook and Alchemist
  split on. Of the 24, thirteen were grown crops and went to the crops map,
  seven were hanging game and went to the game map above, two were props that
  are neither a plant nor an animal and went nowhere, and two were the Soul Husk
  and stayed here on purpose, because it grows wild in the Soul Cairn and is an
  input to no recipe in this build. All of that is argued out over the food
  knobs in the script, and the run prints the four counts every time.

  A BASE THIS SERVER PLACES ITSELF IS NEVER A ROW HERE. The pass reads the whole
  load order and Thornswood-Content.esp is in it, so the beehive this server put
  in the world was swept up as a wild plant worth 5 gold and gated behind an
  Advanced Gatherer, which nobody decided and which blocked the engine's own
  handover for everybody else as well. The pass reads the same stations file the
  STATIONS line at the top of this file is generated from and leaves those bases
  out, and plantAt below refuses one a second time in case a future station
  reaches this table another way.
*/
var HARVESTS_BY_BASE = table('HARVESTS_BY_BASE');

/*
  THE WATER PRODUCE, WHICH IS THE FISHER'S AND NOT THE GATHERER'S, AND IT IS
  GENERATED.

  Everything between the declaration below and the line that closes the block is
  written by the fish pass in tools\Build-HarvestTable.ps1, out of the same FLOR
  records the harvests pass reads, named one at a time in FISH_BY_EDITOR_ID at
  the top of that script. DO NOT HAND EDIT IT. The next run replaces every line
  between them and takes any correction with it. Same arrangement as
  HARVESTS_BY_BASE above and CROPS_BY_BASE below.

  WHY THERE IS A FISHER'S TABLE AT ALL, AND WHY IT NEEDED NO CREATION KIT WORK.
  Skyrim's own fishing is a Creation Club system this build does not have, so
  the fisher's verb looked like a thing that had to be made from nothing.
  Measured in tools\harvests.json on 20 September: sixteen records already
  standing in every river and on every shore are water produce, and every one of
  them was in the plant table and gated on the Gatherer. They are the salmon,
  the clams, the pearl oysters, the horker meat and the slaughterfish egg nest,
  and the last one is the only record of the sixteen this table leaves out: the
  clam at Oar's Rest, whose produce is a fake Dwemer coin the records price at
  nothing, which is a joke item and not a catch. So the fisher's verb is the
  water produce that was already in the world, and this server places no record
  for it.

  A row says:

    produce  the item the record hands over, the same key the harvests rows use.
    name     that item's name, so a yield can say what came away.
    from     what the thing standing in the water is called, because a salmon
             gives Salmon Meat and a pearl oyster gives a Pearl, and a sentence
             that names only the produce reads as though a person picked up a
             cut of meat off the riverbed.
    rank     the Fisher rank the record asks for, and unlike the plants it is
             NOT the gold value of the produce. All fifteen of these are priced
             at 2 or 3 gold in this build, measured the same day, so the rule
             that ranks a plant puts every one of them on one rung and the
             ladder does nothing at all. They are named one at a time in
             FISH_RANK_BY_EDITOR_ID at the top of the script, the way the crops
             are and for the same reason.

  THE SALMON AND THE CLAMS ARE NOVICE AND NOTHING MOVES THEM. They are eleven of
  the fifteen rows and they are the whole of a new fisher's work: a first rung
  with nothing on it is the circle that has already cost this repo two rewrites,
  once at the plants, where 33 of the 50 novice rows were planter sacks nobody
  could open, and once at the crops, where the gold rule put ten of eleven on
  one rung. A fisher who cannot fish cannot climb.
*/
var FISH_BY_BASE = table('FISH_BY_BASE');

/*
  HOW OFTEN A PIECE OF WATER GIVES, AND HOW MUCH. THE RULEBOOK DOES NOT SET ANY
  OF IT.

  classes.md gives the fisher the verb and says rank decides which source
  somebody may work and how much it gives. It puts no number on either. These
  are invented, they are first numbers for the dev server, and they are here in
  one block so that changing the pace of every river in the province is one edit
  in one place.

  cooldownMs, by the rank the record asks for. The plants give themselves ten
  minutes, near enough the hour the engine reloots a FLOR in, and a salmon is a
  FLOR like a flower is. But a river is not a flower bed: a novice fisher works
  eleven records that all give the same 2 gold meat, and there are dozens of
  them in one stretch of the White River, so the wait is what stands between a
  fisher and a pack of salmon. It sits where mining put it, by what the rank is
  worth, and every rung is longer than the twenty seconds the salt quarry runs
  on:

    novice    ten minutes, the same wait a picked plant gets. Salmon Meat and
              Clam Meat are 2 gold, so one record is about 12 gold an hour,
              which is the pace the plants already run at.
    advanced  half an hour. The small pearls and the horker meat on Solstheim.
    expert    an hour. The pearls.
    master    four hours. The one slaughterfish egg nest record, which sits
              underwater in water slaughterfish are in.

  Since #1413 the wait is kept on the record itself, in the shared resource
  stock (createSharedResourceStock), for everybody at once, and not in the
  lastUse map the quarry and the plants use.

  yieldByStep, the least and the most one press gives, novice first. The records
  hand over exactly one of their produce when the engine picks them, so the
  whole of the ladder here is invented: a novice takes the one the game would
  have given and every rank above takes more of it. Four hundred presses of the
  harness walk both ends of every pair.
*/
const FISH_TUNING = {
  cooldownMs: {
    novice: 600000,
    advanced: 1800000,
    expert: 3600000,
    master: 14400000
  },
  yieldByStep: [[1, 1], [1, 2], [1, 3], [2, 4]]
};

/** True when this base is one of the water records in the generated table
 *  above. Never a bare lookup, for the reason own() in the progression block
 *  was written: the descriptor names a record in the world, and '__proto__'
 *  finds something on Object.prototype that a truth test cannot tell from a
 *  salmon. */
function isFish(baseDesc) {
  return Object.prototype.hasOwnProperty.call(FISH_BY_BASE, baseDesc);
}

/*
  THE HANGING GAME, WHICH IS THE HUNTER'S AND NOT THE GATHERER'S, AND IT IS
  GENERATED.

  Everything between the declaration below and the line that closes the block is
  written by the food rule in tools\Build-HarvestTable.ps1, out of the same FLOR
  records the harvests pass reads. DO NOT HAND EDIT IT. The next run replaces
  every line between them and takes any correction with it. Same arrangement as
  HARVESTS_BY_BASE, FISH_BY_BASE and CROPS_BY_BASE.

  PATRICK, 21 SEPTEMBER: 'The farmer grows the crops? Those crops should be used
  to make food, why is a gatherer giving them all the food ingredients when they
  gather herbs and things.' A gatherer gathers reagents. Measured that day over
  the 131 rows of the plant table, 106 gave an alchemy reagent and 24 gave food,
  and among the 24 were two hanging pheasants, two hanging rabbits and three
  charred skeevers. A gatherer picked a pheasant off a rack and a hunter walked
  past it, which is the same fault the water had until the day before.

  WHY THIS IS NOT A ROW IN THE HUNT TABLE, which is the question to answer here
  because the hunt table is thirty lines further down and is also the hunter's.
  HUNTS_BY_BASE is built out of NPC_ records and the death item lists they point
  at, and loot() only reaches it after reading the reference itself: mp.get
  'type' has to answer 'MpActor' and mp.get 'isDead' has to answer true. A
  hanging pheasant is a FLOR record standing in a camp. It was never an actor,
  nothing killed it on this server, and neither of those reads would ever answer
  for it, so a row in the hunt table would be a row nothing could reach. What it
  is instead is a press on a FLOR whose produce the engine hands over, which is
  the shape the fish block above already solved: its own map, its own verb, its
  own class gate. This follows it rather than inventing a second arrangement.

  A row says:

    produce  the item the record hands over, the same key the harvests rows use.
    name     that item's name, so a yield can say what came away.
    from     what hangs in the world, because HangingPheasant01 gives Pheasant
             Breast and a sentence that names only the produce reads as though
             somebody found a cut of meat lying on the ground.
    rank     the Hunter rank the record asks for, and like the fish it is NOT
             the gold value of the produce. The three produce records here are
             priced at 2, 3 and 4 gold, so every threshold in the plant ranker
             puts all seven on one rung and the ladder does nothing. They are
             named one at a time in GAME_RANK_BY_EDITOR_ID at the top of the
             script, the way the fish and the crops are.

  THE RABBITS AND THE PHEASANTS ARE NOVICE AND NOTHING MOVES THEM. They are four
  of the seven rows and they hang at farms and hunters' camps everywhere, which
  is where a new hunter already is. An empty first rung is the circle this repo
  has been rewritten over three times now, at the plants, at the crops and at
  the fish, and the build script fails its run outright if this one empties.
*/
var GAME_BY_BASE = table('GAME_BY_BASE');

/*
  HOW OFTEN A PIECE OF HANGING GAME GIVES, AND HOW MUCH. THE RULEBOOK DOES NOT
  SET ANY OF IT.

  classes.md gives the hunter the verb and says rank decides which source
  somebody may work and how much it gives. It puts no number on either. These
  are invented, they are first numbers for the dev server, and they are in one
  block so that changing the pace of every meat rack in the province is one edit
  in one place, which is the arrangement FISH_TUNING above is written under.

  cooldownMs, by the rank the record asks for. It is FISH_TUNING's ladder to the
  minute, and deliberately so rather than by coincidence: a hanging pheasant and
  a salmon are the same thing to the engine, a FLOR the server refuses and then
  pays out itself, and two tables of different waits for the same shape of press
  would be two numbers to argue about instead of one. A rack of game is rarer in
  the world than a stretch of river is, which argues for a shorter wait, and it
  is also a whole animal rather than a fish, which argues for a longer one, so
  there is no measured reason here to move off the fisher's numbers and a number
  moved for no reason is a number nobody can defend.

    novice    ten minutes, the same wait a picked plant gets.
    advanced  half an hour. The charred skeever in a bandit camp.
    expert    an hour. The two on a giant's own spit.
    master    four hours. Nothing sits on this rung yet and the number is here
              so that a record added to it later is not also a record with no
              wait at all.

  Since #1413 the wait is kept on the record itself, in the shared resource
  stock, the same as the rivers', and not in the lastUse map.

  yieldByStep, the least and the most one press gives, novice first. The records
  hand over exactly one of their produce when the engine picks them, so the
  whole ladder is invented: a novice takes the one the game would have given and
  every rank above takes more of it. The same pairs the fish use, for the same
  reason the waits are the same.
*/
const GAME_TUNING = {
  cooldownMs: {
    novice: 600000,
    advanced: 1800000,
    expert: 3600000,
    master: 14400000
  },
  yieldByStep: [[1, 1], [1, 2], [1, 3], [2, 4]]
};

/** True when this base is one of the hanging game records in the generated
 *  table above. Never a bare lookup, for the reason own() in the progression
 *  block was written: the descriptor names a record in the world, and
 *  '__proto__' finds something on Object.prototype that a truth test cannot
 *  tell from a pheasant. */
function isGame(baseDesc) {
  return Object.prototype.hasOwnProperty.call(GAME_BY_BASE, baseDesc) ||
         Object.prototype.hasOwnProperty.call(RACKS_BY_HAND, baseDesc);
}

/*
  A CARCASS OR A CATCH LYING IN THE WORLD THAT THE PASS LEFT UNRANKED (#3141).

  Patrick, 22 October, on #3141: each gathering action goes to the class whose
  work it is, resource by resource, "Neither just properly split it". The pass
  files these four in its unranked list because their produce is a leveled list
  (a LVLI) rather than one item, so it could not price or rank them, and until
  now nothing answered them: the press fell out of onActivate and the engine
  handed the list's roll to whoever pressed it.

    38a83 Dragonborn  DLC2HorkerDead01, a dead horker the Skaal have hauled up
                      in their village. A body, so the hunter's, at the rank the
                      hunter's own horker body asks (lists/hunter.md: advanced).
    17b9e1, 17ba31,   WHOarFish, WHOarFishHanging, WHOarFishHangingBig: fish
    19648b Windhelm   laid out and hung up in Windhelm. A catch, so the fisher's,
                      at novice, the rank of the fisher's commonest water. It
                      is taken by hand like hanging game, so no pole is asked.

  A row says who (owner), the rank, what the thing in the world is (from, for
  the sentence) and the list the record hands over (list). The list is read out
  of the load order when it is first pressed (listItems): one of its items is
  handed over a press, as many as the owner's yield for their rank. Nothing
  about what is in the list is written down here, so a plugin update that
  changes the fish changes what is caught.
*/
var RACKS_BY_HAND = {
  '38a83:Dragonborn.esm':   { owner: 'hunter', rank: 'advanced', from: 'Horker', list: '3c6a8:Dragonborn.esm' },
  '17b9e1:WindhelmSSE.esp': { owner: 'fisher', rank: 'novice', from: 'catch', list: '19647b:WindhelmSSE.esp' },
  '17ba31:WindhelmSSE.esp': { owner: 'fisher', rank: 'novice', from: 'hanging catch', list: '19647b:WindhelmSSE.esp' },
  '19648b:WindhelmSSE.esp': { owner: 'fisher', rank: 'novice', from: 'hanging catch', list: '19647b:WindhelmSSE.esp' }
};

/*
  The two owners a rack can have, and what each one's gate, ladder, waits and
  yields are. The hunter's are the hanging game's (GAME_TUNING) and the fisher's
  are the water's (FISH_TUNING), so a catch on a rack waits and pays what the
  same rank of water does.
*/
var RACK_OWNERS = {
  hunter: { verb: 'loot', ladder: 'hunter', word: 'Hunter', tuning: function () { return GAME_TUNING; } },
  fisher: { verb: 'fish', ladder: 'fisher', word: 'Fisher', tuning: function () { return FISH_TUNING; } }
};

/** The row and its owner for a rack base, or null. The generated hanging game
 *  is all the hunter's. */
function rackOf(baseDesc) {
  if (Object.prototype.hasOwnProperty.call(GAME_BY_BASE, baseDesc)) {
    return { row: GAME_BY_BASE[baseDesc], owner: RACK_OWNERS.hunter };
  }
  if (Object.prototype.hasOwnProperty.call(RACKS_BY_HAND, baseDesc)) {
    var row = RACKS_BY_HAND[baseDesc];
    if (Object.prototype.hasOwnProperty.call(RACK_OWNERS, row.owner)) {
      return { row: row, owner: RACK_OWNERS[row.owner] };
    }
  }
  return null;
}

/*
  THE ITEMS A LEVELED LIST CAN HAND OVER, read out of the load order the first
  time it is asked and kept. Each LVLO entry names a form at bytes 4 to 7 (the
  level is 0 to 1, the count 8 to 9); a list inside a list is walked to its
  items, four deep at most. The engine's own pick does the same walk
  (LeveledListUtils::EvaluateListRecurse in the fork). An entry twice in a list
  is twice as likely, as it is in Skyrim. Empty when the plugin that owns the
  list is not loaded, and the press then says nothing came away.
*/
var LIST_ITEMS = {};

function listItems(desc) {
  if (Object.prototype.hasOwnProperty.call(LIST_ITEMS, desc)) { return LIST_ITEMS[desc]; }
  var out = [];
  (function walk(id, depth) {
    if (!id || depth > 4) { return; }
    var found = null;
    try { found = mp.lookupEspmRecordById(id); } catch (e) { found = null; }
    var rec = found && found.record;
    if (!rec) { return; }
    if (String(rec.type) !== 'LVLI') {
      var item = '';
      try { item = String(mp.getDescFromId(id) || ''); } catch (e) { item = ''; }
      if (item) { out.push(item); }
      return;
    }
    var fields = rec.fields || [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || String(f.type) !== 'LVLO' || !f.data || f.data.length < 8) { continue; }
      var b = f.data;
      var local = (b[4] | (b[5] << 8) | (b[6] << 16)) + b[7] * 0x1000000;
      var global = 0;
      try { global = Number(found.toGlobalRecordId(local)) || 0; } catch (e) { global = 0; }
      walk(global, depth + 1);
    }
  })(idOf(desc), 0);
  if (!out.length) { log('the list', desc, 'hands over no item in this load order'); }
  LIST_ITEMS[desc] = out;
  return out;
}

/*
  THE PLANTS THE PASS CANNOT SEE, WHICH IS WHY THIS MAP IS STILL HERE.

  The pass reads FLOR and TREE. Nirnroot is neither: it is ACTI 0xE1FB2, an
  activator whose whole behaviour is a Papyrus script, and the red one is ACTI
  0xB6FB9. Checked on 20 September against the built table: neither base is one
  of the 147 rows. So switching harvest() onto the generated table alone would
  have quietly taken nirnroot back out of the game, and the block of comment
  above the scripted activators is there to say why it had to be put in by hand
  in the first place. The produce ids are read out of Skyrim.esm rather than
  off a wiki: 0xE1FB2 yields INGR 0x59B86 and 0xB6FB9 yields 0xB701A.

  They carry no rank, and that is deliberate rather than unfinished. The pass
  ranks a plant by the gold value of its produce, and it cannot read a record
  it does not look at, so a rank written here would be a number somebody made
  up sitting in a column where every other row's is measured. The gatherer's
  class verb is the only gate on these two, which is exactly the gate they had
  before the big table arrived. harvest() reads a null rank as no rank and
  skips the ladder for it.
*/
const HARVESTS = {
  'e1fb2:Skyrim.esm': { produce: '59b86:Skyrim.esm', name: 'Nirnroot', rank: null },
  'b6fb9:Skyrim.esm': { produce: 'b701a:Skyrim.esm', name: 'Red Nirnroot', rank: null },
};

/**
 * True when this base is one of the ones this server puts in the world itself.
 *
 * STATIONS is generated from tools\stations.json and carries
 * three today: the salt quarry, the charcoal kiln and the beehive. The quarry
 * and the kiln have their own branches. hive() answers the beehive, which
 * is what made this worth a function. The harvests pass reads every FLOR and
 * TREE in the load order, Thornswood-Content.esp is in that load order, and the
 * beehive is a FLOR with an INGR produce like any flower, so on 20 September it
 * came out of the pass as a wild plant worth 5 gold, ranked advanced. The
 * moment harvest() started answering the generated table, pressing this
 * server's own hive ran the gatherer class gate and then 'Picking Honeycomb
 * takes an Advanced Gatherer', and because onActivate returns false for
 * anything it answers, the engine's own handover was blocked too: a Woodworker
 * got nothing at all out of a hive Thornswood placed for them.
 *
 * The pass leaves the station bases out now, so this finds nothing in the table
 * today. It is here because the pass is a sweep of the whole load order and
 * this server's plugin keeps growing: the next FLOR or TREE Thornswood places
 * would be swept up the same way if the two files ever fall out of step.
 */
function isStation(baseDesc) {
  for (var k in STATIONS) {
    if (!Object.prototype.hasOwnProperty.call(STATIONS, k)) continue;
    if (STATIONS[k] === baseDesc) return true;
  }
  return false;
}


/*
  WORLD RECORDS FILED WITH NO RANK.

  docs/systems/lists/unranked.md is what the harvest pass left over.
  The ranks under "What you cannot do" on the gatherer page are the
  ones applied here. A produce already on the generated ladder keeps
  that rank, and the row hands that ladder ingredient, one of it,
  rather than the sack a Papyrus script would have opened.

  Rot scale, screaming maw and thorn hook are not here. They are
  Update.esm's Creation Club records (306a to 306f), harvests.json files
  them as left out for that reason, and Thornswood is Special Edition
  only (#479, Patrick, 4 Oct: it still stands), so nobody is handed one.
  records/update-creation-club.json names them and
  tests/test-special-edition-only.js holds this table to it.

  Cabbage, carrot, gourds, leek, potato and wheat stay the farmer's.
  A clam and a fish stay the fisher's. A coin purse and an estate key
  are not a harvest. Mammoth cheese and a mead barrel stay off every
  ladder. The beehive, the chickens' nest and the churn are farmer
  verbs and are not here. A horker is not on the gatherer page. No
  row carries a gold price.
*/
const GATHER_UNRANKED = {
  "10466:HearthFires.esm": { "produce": "6ac4a:Skyrim.esm", "name": "Jazbay Grapes", "rank": "novice" },
  "10467:HearthFires.esm": { "produce": "5076e:Skyrim.esm", "name": "Juniper Berries", "rank": "novice" },
  "10468:HearthFires.esm": { "produce": "45c28:Skyrim.esm", "name": "Lavender", "rank": "novice" },
  "110bb:HearthFires.esm": { "produce": "3f7f8:Skyrim.esm", "name": "Tundra Cotton", "rank": "novice" },
  "110bc:HearthFires.esm": { "produce": "b2183:Skyrim.esm", "name": "Creep Cluster", "rank": "novice" },
  "110c4:HearthFires.esm": { "produce": "4da22:Skyrim.esm", "name": "White Cap", "rank": "novice" },
  "110c5:HearthFires.esm": { "produce": "4da23:Skyrim.esm", "name": "Imp Stool", "rank": "novice" },
  "110c6:HearthFires.esm": { "produce": "4da24:Skyrim.esm", "name": "Namira's Rot", "rank": "novice" },
  "110cb:HearthFires.esm": { "produce": "83e64:Skyrim.esm", "name": "Grass Pod", "rank": "novice" },
  "110cc:HearthFires.esm": { "produce": "134aa:Skyrim.esm", "name": "Thistle Branch", "rank": "novice" },
  "10461:HearthFires.esm": { "produce": "6abcb:Skyrim.esm", "name": "Canis Root", "rank": "advanced" },
  "10462:HearthFires.esm": { "produce": "516c8:Skyrim.esm", "name": "Deathbell", "rank": "advanced" },
  "10463:HearthFires.esm": { "produce": "889a2:Skyrim.esm", "name": "Dragon's Tongue", "rank": "advanced" },
  "10464:HearthFires.esm": { "produce": "7e8c1:Skyrim.esm", "name": "Giant Lichen", "rank": "advanced" },
  "10465:HearthFires.esm": { "produce": "7ee01:Skyrim.esm", "name": "Glowing Mushroom", "rank": "advanced" },
  "110bd:HearthFires.esm": { "produce": "7e8b7:Skyrim.esm", "name": "Swamp Fungal Pod", "rank": "advanced" },
  "110be:HearthFires.esm": { "produce": "ec870:Skyrim.esm", "name": "Mora Tapinella", "rank": "advanced" },
  "110bf:HearthFires.esm": { "produce": "77e1c:Skyrim.esm", "name": "Blue Mountain Flower", "rank": "advanced" },
  "110c0:HearthFires.esm": { "produce": "77e1e:Skyrim.esm", "name": "Purple Mountain Flower", "rank": "advanced" },
  "110c1:HearthFires.esm": { "produce": "77e1d:Skyrim.esm", "name": "Red Mountain Flower", "rank": "advanced" },
  "110c2:HearthFires.esm": { "produce": "4da00:Skyrim.esm", "name": "Fly Amanita", "rank": "advanced" },
  "110c9:HearthFires.esm": { "produce": "6f950:Skyrim.esm", "name": "Scaly Pholiota", "rank": "advanced" },
  "110ca:HearthFires.esm": { "produce": "1b3bd:Skyrim.esm", "name": "Snowberries", "rank": "advanced" },
  "10469:HearthFires.esm": { "produce": "2f44c:Skyrim.esm", "name": "Nightshade", "rank": "expert" },
  "110c3:HearthFires.esm": { "produce": "4da20:Skyrim.esm", "name": "Bleeding Crown", "rank": "expert" },
  "110c7:HearthFires.esm": { "produce": "4da25:Skyrim.esm", "name": "Blisterwort", "rank": "expert" },
  // The resource pack's aloe vera planter, the same kind of sack (#3141);
  // its field plants are novice rows of the generated table.
  "16b:_ResourcePack.esl": { "produce": "d0:_ResourcePack.esl", "name": "Aloe Vera Leaves", "rank": "novice" }
};

/** The row for a base, out of the generated table or the hand list beside it,
 *  or null when this base is not a plant at all. Own-property checks on both,
 *  for the reason own() in the progression block was written: '__proto__'
 *  finds something on Object.prototype and a truth test cannot tell that from
 *  a plant. */
function plantAt(baseDesc) {
  // A station is answered by the branch written for it in onActivate, or, while
  // it has no branch, by the engine doing what it already does with a FLOR. It
  // is never answered here. See isStation above for what happened when it was.
  if (isStation(baseDesc)) return null;
  /*
    AND WATER PRODUCE IS THE FISHER'S, NOT THE GATHERER'S.

    The fish pass leaves these fifteen out of the plant table now, so on a
    rebuilt table this finds nothing. It is here for the table that is
    installed today: every one of them was a plant row until 20 September, both
    passes read the same FLOR records, and a server running a gamemode built
    before the fish pass ran would otherwise hand a gatherer the salmon and
    refuse the fisher. Refusing here rather than trusting the branch order is
    the same arrangement harvest() makes with the crops, and for the same
    reason: the order in onActivate is a thing somebody can change.
  */
  if (isFish(baseDesc)) return null;
  /*
    AND FOOD IS NOT A REAGENT, SO HANGING GAME IS THE HUNTER'S.

    Patrick, 21 September: a gatherer gathers herbs, and a plant whose produce
    is food is not theirs. The food rule leaves these seven out of the plant
    table now, so on a rebuilt table this finds nothing. It is here for the
    table a server is running today: all seven were plant rows until this
    change, both passes read the same FLOR records, and a gamemode built before
    the food rule ran would otherwise hand a gatherer the meat rack and refuse
    the hunter. Refusing here rather than trusting the branch order is the same
    arrangement the fish two lines up and the crops in harvest() make, and for
    the same reason: the order in onActivate is a thing somebody can change.
  */
  if (isGame(baseDesc)) return null;
  if (Object.prototype.hasOwnProperty.call(HARVESTS_BY_BASE, baseDesc)) {
    return HARVESTS_BY_BASE[baseDesc];
  }
  if (Object.prototype.hasOwnProperty.call(HARVESTS, baseDesc)) {
    return HARVESTS[baseDesc];
  }
  if (Object.prototype.hasOwnProperty.call(GATHER_UNRANKED, baseDesc)) {
    return GATHER_UNRANKED[baseDesc];
  }
  return null;
}

/** True when somebody pressing this base should be answered by harvest(). */
function isPlant(baseDesc) {
  return plantAt(baseDesc) !== null;
}

/*
  EVERY PLANT AND TREE IN THE WORLD HAS AN OWNER, AND ONE NO LIST NAMES IS
  NOBODY'S, NEVER EVERYBODY'S (#3141).

  Patrick, 22 October, on #3141: each gathering action is split to the class
  whose work it is, resource by resource, and not left open to everyone. The
  chain in onActivate answers a FLOR or a TREE by table: a crop for the farmer,
  water for the fisher, a rack for the hunter or the fisher, a nest, a churn or
  a hive for the farmer, a reagent for the gatherer. Until this change a base no
  table named fell out of the chain, and the engine's own pick
  (MpObjectReference::ProcessActivate in the fork) handed its produce to
  whoever pressed it. So the open door was the default: every record the pass
  could not rank, and every plant a new plugin brings, was free to everybody.

  Now the chain asks this last for a FLOR or a TREE, and it answers by name:

    anybody  Patrick, 21 September: "make mammoth cheese bowls able to be picked
             up by literally anybody." A giant's bowl of mammoth cheese. The
             engine hands it over, as it always has.
    nobody   records with nothing in them for anybody, each with its reason.
             The HearthFires mead barrel's produce is a sack only a Papyrus
             script opens, and no trade here draws or brews mead. Bashir's clam
             (Oar's Rest) holds a quest prop, a fake Dwemer coin, not a catch.
             A coin purse is not a harvest (gold.md), and every placed one is
             switched off in Thornswood-Last.esp (#3077). The three Creation
             Club roots are named on no list at all, because no table here may
             name Creation Club content (#479, test-special-edition-only.js):
             nothing places one, and the rule below would refuse it.

  Any other FLOR or TREE is refused with the nobody sentence and named once in
  the log, so a plant a plugin adds turns up there to be given its owner in
  the right table, instead of being handed out.
*/
var WORLD_PRODUCE_ANYBODY = {
  '7edf0:Skyrim.esm': 'Mammoth Cheese'
};

var NOBODYS_PRODUCE = 'This is nobody\'s work here, so nothing comes away.';
var NOT_A_HARVEST = 'A coin purse is not a harvest. Nothing comes away.';

var WORLD_PRODUCE_NOBODY = {
  'f39b:HearthFires.esm': 'The mead barrel is sealed. Nobody draws from it here.',
  '4d078:OarsRest.esp': 'There is nothing in this clam to take.',
  'd790c:Skyrim.esm': NOT_A_HARVEST,
  'd8e7f:Skyrim.esm': NOT_A_HARVEST,
  'd8e80:Skyrim.esm': NOT_A_HARVEST,
  'd8e8a:Skyrim.esm': NOT_A_HARVEST,
  'd8e8b:Skyrim.esm': NOT_A_HARVEST,
  'd8e8c:Skyrim.esm': NOT_A_HARVEST
};

var unownedProduceSeen = {};

/** True when this base is a plant or a tree, or on one of the two lists. Asked
 *  after every table in onActivate, so it only ever sees what none of them
 *  named. A body's base is an NPC_ and is never one. */
function isWorldProduce(baseDesc) {
  if (Object.prototype.hasOwnProperty.call(WORLD_PRODUCE_ANYBODY, baseDesc)) { return true; }
  if (Object.prototype.hasOwnProperty.call(WORLD_PRODUCE_NOBODY, baseDesc)) { return true; }
  var spoils = globalThis.__thornswoodSpoils;
  if (!spoils || !spoils.kindOf) { return false; }
  var kind = '';
  try { kind = spoils.kindOf(idOf(baseDesc)); } catch (e) { kind = ''; }
  return kind === 'FLOR' || kind === 'TREE';
}

/** ALLOW for a record anybody may take, so the engine hands it over; the
 *  record's reason for one nobody may; the nobody sentence for the rest. */
function worldProduce(actorId, refrId, baseDesc) {
  if (Object.prototype.hasOwnProperty.call(WORLD_PRODUCE_ANYBODY, baseDesc)) { return ALLOW; }
  if (Object.prototype.hasOwnProperty.call(WORLD_PRODUCE_NOBODY, baseDesc)) {
    return WORLD_PRODUCE_NOBODY[baseDesc];
  }
  if (!Object.prototype.hasOwnProperty.call(unownedProduceSeen, baseDesc)) {
    unownedProduceSeen[baseDesc] = true;
    log('#3141: a plant or tree no list names was pressed, so it is nobody\'s:', baseDesc,
        'Give it its owner in a class table, WORLD_PRODUCE_ANYBODY or WORLD_PRODUCE_NOBODY.');
  }
  return NOBODYS_PRODUCE;
}

/* Shrine -> the ability it grants. These are the Altar*Spell records, which
 * are what the vanilla shrine script adds; the blessing is one ability at a
 * time, so the other eight come off when a new one goes on. */
const SHRINES = {
  'd9883:Skyrim.esm': { spell: 'fb988:Skyrim.esm', who: 'Akatosh' },
  '71854:Skyrim.esm': { spell: 'fb994:Skyrim.esm', who: 'Arkay' },
  'd9881:Skyrim.esm': { spell: 'fb995:Skyrim.esm', who: 'Dibella' },
  'd9885:Skyrim.esm': { spell: 'fb996:Skyrim.esm', who: 'Julianos' },
  'd987f:Skyrim.esm': { spell: 'fb997:Skyrim.esm', who: 'Kynareth' },
  'd9887:Skyrim.esm': { spell: 'fb998:Skyrim.esm', who: 'Mara' },
  'd987d:Skyrim.esm': { spell: 'fb999:Skyrim.esm', who: 'Stendarr' },
  '100780:Skyrim.esm': { spell: 'fb99a:Skyrim.esm', who: 'Talos' },
  'd987b:Skyrim.esm': { spell: 'fb99b:Skyrim.esm', who: 'Zenithar' },
  '10e8b0:Skyrim.esm': { spell: '10e8ae:Skyrim.esm', who: 'Nocturnal' },
};

const HARVEST_COOLDOWN_MS = 600000;   // ten minutes, roughly a vanilla reloot

/*
  THE CROPS A FARM IS MADE OF, IN TWO HALVES: what the game files say, and what
  this server decides. They were one table until 20 September and that is what
  went wrong with it, which is written out below rather than left to be found.

  THE FIRST HALF IS MEASURED, AND IT IS GENERATED. CROPS_BY_BASE is written by
  the crops pass in scripts\dev\Build-HarvestTable.ps1 into
  game\gamemode-tables\CROPS_BY_BASE.json (#5191), out of the same FLOR and
  TREE records that build game\data\harvests.json. DO NOT HAND EDIT IT. The
  next run of that script writes the whole table again, and a correction made
  there goes with it and leaves no trace that it was ever made. Same
  arrangement as SPELL_IDS further down, for the same reason.

  Each generated row says what the record says, and nothing else:

    produce      the item that comes off the plant, and also the item that is
                 sown, because a reference's base cannot be changed by the
                 server: a cabbage plot grows cabbages and nothing else. That is
                 why the /plant command takes no argument. See the farming
                 block.
    name         what a person is told they sowed or brought in.
    rank         THE GATHERER'S LADDER, not the farmer's. harvests.json ranks by
                 the gold value of the produce, and ten of the eleven produce
                 something worth one gold, so ten of the eleven come out
                 Advanced and the apples land beside the cabbages. It is kept
                 because the pass writes it and it says something true about the
                 produce. It is not what gates a Farmer. CROP_RULES below is.
    growMinutes  HARVESTS.JSON'S OWN ARITHMETIC, which is 'base + the produce
                 value in gold x perGold, capped at max, and never under base,
                 which is the hour the engine reloots a FLOR or TREE in on its
                 own', with base 60. So it is never under an hour by
                 construction: 75 minutes for ten of these and 135 for Wheat.
                 That is the opposite invariant to the one farming needs, for
                 the reason set out in the farming block: the server owns the
                 rule and not the look, so a wait longer than the engine's hour
                 means the model regrows while the rule still says growing.
                 CROP_RULES below sets the wait that is used and caps it under
                 the hour.

  THE SECOND HALF IS THE RULE, AND IT IS OURS. A rule written into the generated
  block would be gone the next time the pass ran, silently, which is exactly the
  trap the marker mismatch was hiding. So the rank a crop asks of a Farmer and
  the time it takes to come up live in CROP_RULES, by hand, and mergeCrops puts
  the two halves together into CROPS. The pass stays what it is, which is a
  reader of the game files.
*/
var CROPS_BY_BASE = table('CROPS_BY_BASE');

/*
  THE HOUR THE ENGINE OWNS.

  MpObjectReference::GetRelootTime in the fork at C:\Thornswood-Dev\skymp
  returns a hardcoded std::chrono::hours(1) for FLOR and for TREE, and there is
  no property binding that lets the server change it per reference: the whole
  list is in
  skymp5-server\cpp\addon\property_bindings\PropertyBindingFactory.cpp and
  neither isHarvested nor a reloot time is among them. So the model comes back
  after an hour whatever the rule says, and a wait longer than that is a plot
  standing there looking ripe and answering 'still growing' to every press.

  Every wait in CROP_RULES is therefore capped five minutes under that hour by
  mergeCrops rather than by anybody remembering to. The cap is arithmetic on the
  measured hour and not another invented number.
*/
var ENGINE_RELOOT_MINUTES = 60;
var CROP_GROW_MINUTES_MAX = ENGINE_RELOOT_MINUTES - 5;

/*
  WHAT A FARMER MAY GROW, AND HOW LONG IT TAKES. INVENTED, ALL OF IT.

  site\data\site\classes.md, 'What you are allowed to grow', publishes
  the ladder and not the crops in it: Novice the common field crops, Advanced
  the crops worth more than those, Expert the orchard, Master everything. Which
  crop sits on which rung is the part nobody has written down, so it is decided
  here and it is decided once.

  It cannot be decided by the gold value, which is what the generated rank does.
  Measured in tools\harvests.json on 20 September: Cabbage, Leek, Potato, Gourd,
  Tomato, Ash Yam and both apples all produce something worth
  exactly 1 gold, and Wheat is worth 5. A ladder built on that has four rungs
  and puts ten things on one of them. So the split is by what the produce is
  for, which is the thing the site's words are already about:

    novice     the common field crops, the vegetables anybody eats and the ones
               a new Farmer is handed. Cabbage, Leek, Potato, Gourd and Carrot.
    advanced   what a trade buys rather than what a person eats. Wheat for the
               cook, and the Ash Yam and Tomato, which grow in one corner of the
               map each and are worth the walk. Tundra Cotton is gatherer flora
               (#626), not a farm crop.
    expert     the orchard, which is the site's own word for it. Both apple
               trees, in both plugins that have a pair.
    master     everything, which is the site's word again, and it means a Master
               is refused nothing rather than that some crop is held back for
               them. Nothing sits on this rung and the table says so here rather
               than by being silently short of one.

  growMinutes is sown to ripe for a Novice, before the multiplier in
  TUNING.farming.growByRank, and every one of them is under the engine's hour
  above. A vegetable is quicker than a tree, wheat is the slowest thing in a
  field, and that is the whole of the reasoning. These are first numbers for the
  dev server, not a decision.

  FOUR BASES HERE CARRY THEIR OWN PRODUCE AND NAME, AND AS OF 21 SEPTEMBER THEY
  NO LONGER HAVE TO. XJKWOTreeAppleRed, XJKWOTreeAppleGreen, XJKWOCarrotPlant
  and XJKcarrotplantflora were written in by hand on 20 September, read out of
  tools\harvests.json .detail, because the crops pass took TREE records and
  these four are FLOR: a crop the generated table leaves out is a crop
  mp.onActivate falls straight through, and the engine then hands the produce to
  whoever pressed it every hour for nothing, which is the one thing the farming
  block exists to stop. That also answered the question the old comment left
  open, which was whether to take the JK's Skyrim apples or the JK's Whiterun's
  Outskirts pair: both.

  The pass now finds all four. Patrick's food rule dropped the record type test
  altogether, because a cabbage is a cabbage whichever record type it is, and
  the crops map above carries fifteen rows where it carried eleven. The produce
  and name on those four lines are therefore the same strings the pass writes,
  and mergeCrops takes the pass's row when there is one, so they are dead
  weight rather than a disagreement. They are left in rather than deleted for
  the reason the whole list is here: this is the list the server gates a plot
  on, a base whose plugin is not in the load order never matches a reference in
  the world and costs nothing but the line, and a line that would have to be
  typed back in if a plugin ever stopped shipping its FLOR copy is a line worth
  keeping. THE RANKS ON THEM AND THE ONES IN CROP_RANK_BY_EDITOR_ID IN THE
  SCRIPT ARE NOW THE SAME NAMES ON THE SAME RUNGS, which is what the comment
  over that knob means by the two lists having to agree.
*/
var CROP_RULES = {
  'bcf48:Skyrim.esm': { rank: 'novice', growMinutes: 20 },
  'bb952:Skyrim.esm': { rank: 'novice', growMinutes: 20 },
  'bcf47:Skyrim.esm': { rank: 'novice', growMinutes: 20 },
  'be3e6:Skyrim.esm': { rank: 'novice', growMinutes: 25 },
  '2493e:JKs Skyrim.esp': { rank: 'novice', growMinutes: 20 },
  '2493d:JKs Skyrim.esp': { rank: 'novice', growMinutes: 20,
                            produce: '64b40:Skyrim.esm', name: 'Carrot' },
  '1503ff:JK\'s Whiterun\'s Outskirts.esp': { rank: 'novice', growMinutes: 20,
                            produce: '64b40:Skyrim.esm', name: 'Carrot' },
  'bb953:Skyrim.esm': { rank: 'advanced', growMinutes: 45 },
  '206e8:Dragonborn.esm': { rank: 'advanced', growMinutes: 25 },
  '18d5d7:JK\'s Whiterun\'s Outskirts.esp': { rank: 'advanced', growMinutes: 25 },
  '2c91:JKs Skyrim.esp': { rank: 'expert', growMinutes: 40 },
  '3274:JKs Skyrim.esp': { rank: 'expert', growMinutes: 40 },
  '141081:JK\'s Whiterun\'s Outskirts.esp': { rank: 'expert', growMinutes: 40,
                            produce: '64b2e:Skyrim.esm', name: 'Red Apple' },
  '141088:JK\'s Whiterun\'s Outskirts.esp': { rank: 'expert', growMinutes: 40,
                            produce: '64b2f:Skyrim.esm', name: 'Green Apple' },
  /*
    THE HEARTHFIRES GARDEN PLANTERS (#3141). The pass files them unranked,
    because each one's produce is a sack (Cabbage (2) and the like) that only a
    Papyrus script opens, and nothing answered them: the engine handed the sack
    to whoever pressed. The ingredient planters beside them went to the gatherer
    in GATHER_UNRANKED. These six are field crops and the farmer's, so they are
    plots like the field ones: the same produce, rank and time as that crop.
  */
  '1045e:HearthFires.esm': { rank: 'novice', growMinutes: 20,
                            produce: '64b3f:Skyrim.esm', name: 'Cabbage' },
  '1045f:HearthFires.esm': { rank: 'novice', growMinutes: 25,
                            produce: '10d666:Skyrim.esm', name: 'Gourd' },
  '10460:HearthFires.esm': { rank: 'novice', growMinutes: 20,
                            produce: '669a5:Skyrim.esm', name: 'Leek' },
  '110b9:HearthFires.esm': { rank: 'novice', growMinutes: 20,
                            produce: '64b40:Skyrim.esm', name: 'Carrot' },
  '110ba:HearthFires.esm': { rank: 'novice', growMinutes: 20,
                            produce: '64b41:Skyrim.esm', name: 'Potato' },
  '110cd:HearthFires.esm': { rank: 'advanced', growMinutes: 45,
                            produce: '4b0ba:Skyrim.esm', name: 'Wheat' }
};

/*
  The two halves put together, once, when the file loads.

  A base the crops pass found and nobody has ranked asks for a Master. That is
  the safe direction and it is deliberate: the alternative defaults are a free
  crop for everybody or a crash on the first press, and a refusal that names a
  rank nobody has yet is at least a refusal. It is said in the log with the
  descriptor in it, so the next run of the pass adding a crop to the game leaves
  a line telling somebody to put it on a rung.

  hasOwnProperty throughout, and '__proto__' skipped by name, for the reason
  own() in the progression block was written: these keys are descriptors, they
  come out of a generated file, and a key of '__proto__' assigned to a plain
  object sets the prototype rather than a member.
*/
function mergeCrops() {
  var out = {};
  var d;
  for (d in CROPS_BY_BASE) {
    if (!Object.prototype.hasOwnProperty.call(CROPS_BY_BASE, d)) { continue; }
    if (d === '__proto__') { continue; }
    var m = CROPS_BY_BASE[d];
    if (!m || typeof m.produce !== 'string' || typeof m.name !== 'string') { continue; }
    out[d] = { produce: m.produce, name: m.name,
               rank: 'master', growMinutes: CROP_GROW_MINUTES_MAX };
  }
  for (d in CROP_RULES) {
    if (!Object.prototype.hasOwnProperty.call(CROP_RULES, d)) { continue; }
    if (d === '__proto__') { continue; }
    var r = CROP_RULES[d];
    if (!Object.prototype.hasOwnProperty.call(out, d)) {
      if (typeof r.produce !== 'string' || typeof r.name !== 'string') {
        log('crops: the rule for', d, 'names no produce and the crops pass does',
            'not list it, so it is not a crop on this server');
        continue;
      }
      out[d] = { produce: r.produce, name: r.name,
                 rank: 'master', growMinutes: CROP_GROW_MINUTES_MAX };
    }
    out[d].rank = r.rank;
    out[d].growMinutes = Math.max(1, Math.min(r.growMinutes, CROP_GROW_MINUTES_MAX));
  }
  for (d in out) {
    if (!Object.prototype.hasOwnProperty.call(out, d)) { continue; }
    if (!Object.prototype.hasOwnProperty.call(CROP_RULES, d)) {
      log('crops:', d, 'came out of the crops pass with no rule beside it, so it',
          'asks for a Master until somebody puts it on a rung in CROP_RULES');
    }
  }
  return out;
}

var CROPS = mergeCrops();

/** True when this base is one of the crops above. Never a bare lookup: the
 *  descriptor arrives from a reference in the world, and '__proto__' finding
 *  something on Object.prototype is the hole the progression block's own()
 *  was written for. A base this server places itself is refused first, for the
 *  reason written over isStation: the crops pass sweeps the same load order the
 *  harvests pass does, and a station that reached this table would be a plot
 *  somebody could claim. */
function isCrop(baseDesc) {
  if (isStation(baseDesc)) return false;
  return Object.prototype.hasOwnProperty.call(CROPS, baseDesc);
}

/**
 * Add or remove an ability on somebody's character.
 *
 * This is the one Papyrus call from here that is known to reach a client.
 * Debug.Notification and Message.Show find their actor through the Papyrus
 * stack, which is empty when the call starts in this file, so they do nothing.
 * Actor.AddSpell takes its target from `self` instead: the native records the
 * spell on the server and sends the client a snippet to match, and the list
 * comes back on every spawn as learnedSpells. So a blessing survives logging
 * out, which the vanilla one does not.
 */
function spellOn(actorId, spellDesc, on) {
  try {
    mp.callPapyrusFunction(
      'method', 'Actor', on ? 'AddSpell' : 'RemoveSpell',
      { type: 'form', desc: mp.getDescFromId(actorId) },
      [{ type: 'espm', desc: spellDesc }, false]
    );
    return true;
  } catch (e) {
    log('shrine: could not', on ? 'add' : 'remove', spellDesc, '-', e);
    return false;
  }
}

/*
 * Instruments (PlayFluteLuteDrum.esp) used to be handed out as a Class
 * privilege for the old bard trade. That trade is RP-only now: chargen no
 * longer calls armBard for it. The WEAP records and PlayInstrumentSpell stay
 * in the load order for anyone who has an instrument (Woodwright craft, the
 * Lute, Flute and Drum emotes). The helper remains so a stray call cannot throw.
 */
const INSTRUMENT_SPELL = '9456:PlayFluteLuteDrum.esp';

function armBard(actorId) {
  if (spellOn(actorId, INSTRUMENT_SPELL, true)) {
    log('bard', actorId.toString(16), 'can play their instruments');
  }
}

/** One blessing at a time, the way the shrines themselves work. */
function bless(actorId, baseDesc) {
  const shrine = SHRINES[baseDesc];
  if (!shrine) return null;
  for (const d in SHRINES) {
    if (d === baseDesc) continue;
    spellOn(actorId, SHRINES[d].spell, false);
  }
  /*
    A SHRINE IN A TEMPLE IS ALSO THE TEMPLE RITE (#1383): it clears ordinary
    disease, sets a break and puts a crooked heal right, and the injury and
    disease block answers whether this shrine stands in a temple.
  */
  let rite = '';
  try {
    const hurt = globalThis.__thornswoodHurt;
    rite = (hurt && hurt.rite) ? hurt.rite(actorId) : '';
  } catch (e) { log('injury: the temple rite threw:', e); }
  if (!spellOn(actorId, shrine.spell, true)) {
    return 'The shrine of ' + shrine.who + ' does not answer.' + (rite ? ' ' + rite : '');
  }
  return 'You take the blessing of ' + shrine.who + '.' + (rite ? ' ' + rite : '');
}

/**
 * A press on a plant, answered off the generated table since 20 September.
 *
 * It read a hand written map with two nirnroots in it until then, so a
 * gatherer could pick two things in the whole province and every other flower,
 * mushroom and egg sack in the load order was a press that did nothing. The
 * map is still there, holding those same two, because they are ACTI records
 * the pass does not read. Everything else now comes out of HARVESTS_BY_BASE.
 */
// These are Skyrim.esm reference IDs, so interception does not depend on
// a working quest controller, source lookup or the object's current base.
function drawGeode(actorId,refrId,baseDesc) {
  const unavailable='This geode is unavailable for now.';
  if(baseDesc!=='10e93b:Skyrim.esm')return unavailable;
  try {
    const quests=globalThis.__thornswoodQuests;
    if(!quests || typeof quests.geodeScarce!=='function')return unavailable;
    const result=quests.geodeScarce(actorId,refrId);
    if(!result || !result.ok)return result && result.text || unavailable;
    return 'You draw 1 Empty Petty Soul Gem.';
  }catch(error){return unavailable;}
}

function harvestCrimson(actorId,refrId,baseDesc) {
  const unavailable='This crimson plant is unavailable for now.';
  if(baseDesc!=='b6fb9:Skyrim.esm')return unavailable;
  let result;
  try {
    const quests=globalThis.__thornswoodQuests;
    if(!quests || typeof quests.harvestScarce!=='function')return unavailable;
    result=quests.harvestScarce(actorId,refrId);
    if(!result || !result.ok)return result && result.text || unavailable;
  }catch(error){return unavailable;}
  const rank=creditWork(actorId,'harvest');
  return 'You pick 1 Crimson Nirnroot.'+(rank?' '+rank:'');
}

function harvest(actorId, refrId, baseDesc) {
  if([0xf3b51,0xf3b54,0xf3b5d,0x10ffac,0x10ffaf,0x10ffb0,0xf3b56,0x10ffa9].includes(refrId))return harvestCrimson(actorId,refrId,baseDesc);
  /*
    A CROP IS NOT A PLANT TO BE PICKED HERE, whatever the pass says about it.

    Measured on 20 September: every one of the crop bases in CROPS was also a
    row in the generated harvests table, because both passes read the same FLOR
    and TREE records and a cabbage plot is a FLOR like any other. Patrick's food
    rule of 21 September took the food crops out of the plant table, since a
    plant whose produce is food is not the gatherer's at all. Tundra cotton left
    the crop table for #626 (gatherer reagent flora with put-back), so today the
    overlap is one: wheat, which gives an ingredient rather than a food and which
    the food rule therefore never touches.

    That makes this line matter MORE and not less. It is now the only thing
    standing between a gatherer and a field of wheat. onActivate asks isCrop
    first as well, and this asks again rather than
    trusting the branch order to stay the way it is: a press that reached here
    would hand over the produce with no plot, no wait, no claim and no farmer,
    which is the free farming the farming block exists to stop.
  */
  if (isCrop(baseDesc)) return null;

  const plant = plantAt(baseDesc);
  if (!plant) return null;

  // The gatherer's verb. Asked before the cooldown so that somebody who is
  // not a gatherer gets the same answer at every plant, every time, rather
  // than 'this one has already been picked' at one they never picked.
  const mine = classGate(actorId, 'harvest');
  if (mine) return mine;

  /*
    The plant's rank, gated the way mineOre gates a seam and for the same
    reason: the ladder is worth climbing only if something is above you on it.
    indexOf answers -1 for the two hand rows, which carry no rank, and 0 for a
    novice plant, so the test skips both without a second branch saying so.
  */
  const want = RANK_LADDER.indexOf(plant.rank);
  if (want > 0 && rankStep(actorId, 'gatherer') < want) {
    return 'Picking ' + plant.name + ' takes ' + rankWord(plant.rank) +
           ' Gatherer. Pick what you can until you are one.';
  }

  // A seasonal ingredient is picked only in its seasons (#3152).
  const resting = outOfSeason(plant);
  if (resting) return resting;

  // One wait for this plant, shared. The key is the plant, not the person,
  // so the next person cannot take it early. stampCooldown stores
  // actor:ref, and the actor half of a shared plant is the word plant.
  const prev = lastUse.get('plant:' + refrId) || 0;
  if (Date.now() - prev < HARVEST_COOLDOWN_MS) {
    return 'This one has already been picked.';
  }
  /*
    The season's share of the one a pick gives (#3144): a second a quarter of
    the time in summer, nothing a quarter of the time in winter. A bare plant
    still waits its ten minutes, or pressing it again would take the quarter
    back, and nothing picked is no piece of work.
  */
  const season = globalThis.__thornswoodSeason;
  const got = (season && season.seasonYield) ? season.seasonYield(1) : 1;
  const word = (season && season.yieldWord) ? season.yieldWord() : '';
  if (got <= 0) {
    stampCooldown('plant', refrId);
    return 'The ' + plant.name + ' has nothing to pick this time.' + (word ? ' ' + word : '');
  }
  if (!addItem(actorId, plant.produce, got)) return null;
  stampCooldown('plant', refrId);
  economyGathered(actorId, plant.produce, got);
  const rank = creditWork(actorId, 'harvest');
  const took = got === 1 ? 'You pick the ' + plant.name + '.' : 'You pick ' + got + ' ' + plant.name + '.';
  return took + (got !== 1 && word ? ' ' + word : '') + (rank ? ' ' + rank : '');
}

/*
  A SEASONAL INGREDIENT (#3152). Patrick, 22 Oct 2026, A: a seasonal dish can
  be made any time with its ingredients, and the ingredients are what is
  seasonal. FOOD_GROUPS.inSeason (game/data/food-groups.json) names, by the
  produce, the seasons each is picked in: Lavender, Jazbay Grapes, Snowberries
  and Juniper Berries, two seasons each, so every season has its own pair and
  its festival dish and brew want that pair. Out of season the plant has
  nothing to give: nothing is picked, it is no piece of work, and it keeps no
  wait. The season is the season block's, the one the crops read. Answers the
  line to say, or '' for a plant that is in season or has no season.
*/
function outOfSeason(plant, now) {
  const table = FOOD_GROUPS.inSeason || {};
  if (!Object.prototype.hasOwnProperty.call(table, plant.produce)) return '';
  const seasons = table[plant.produce];
  if (seasons.indexOf(globalThis.__thornswoodSeason.seasonAt(now || Date.now())) !== -1) return '';
  return 'This plant is bare out of season. The season for ' + plant.name + ' is ' + seasons.join(' and ') + '.';
}

/**
 * A press on water produce: a salmon in a river, a clam on a shore, a pearl
 * oyster or an egg nest under one. The fisher's verb, and the fisher's rank
 * decides which of them answer and how much comes away.
 *
 * Every one of these fifteen records was a row in the plant table until now, so
 * a gatherer picked them and a fisher walked past them, which is the whole of
 * the fisher's work handed to the wrong class. plantAt() refuses them now and
 * this answers them instead. The two halves of that are deliberate and both are
 * needed: the pass stops writing them into the plant table, and plantAt refuses
 * one a second time in case a table built before this change is still installed
 * on a server that has not been rebuilt.
 *
 * The shape is harvest()'s with mineOre()'s ladder. A rank the table asks for
 * is refused by name rather than handed a smaller catch, the wait is the
 * record's own off FISH_TUNING.cooldownMs rather than the ten minutes every
 * plant gets, and the count is the pair for the fisher's rank. There is no
 * second table of thresholds: the rank on the row is the whole gate.
 */

const FISH_TRAP_DESC = ITEMS.fishTrap;
const TRAP_PROPERTY = 'thornswoodFishTraps';
const POLE_COVERS = {
  '15498:Thornswood-Content.esp': 0,
  '15499:Thornswood-Content.esp': 2,
  '1549a:Thornswood-Content.esp': 3
};

function bestPoleCovers(actorId) {
  let best = -1;
  let inv = null;
  try { inv = mp.get(actorId, 'inventory'); } catch (e) { return 3; }
  const entries = (inv && inv.entries) || [];
  const keys = Object.keys(POLE_COVERS);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !(e.count > 0)) { continue; }
    for (let j = 0; j < keys.length; j++) {
      const baseId = idOf(keys[j]);
      if (baseId && e.baseId === baseId && POLE_COVERS[keys[j]] > best) {
        best = POLE_COVERS[keys[j]];
      }
    }
  }
  return best;
}

function poleTooWeak(actorId, waterRank) {
  const named = RANK_LADDER.indexOf(waterRank);
  const want = named < 0 ? RANK_LADDER.length - 1 : named;
  if (bestPoleCovers(actorId) < want) {
    return 'That water takes a finer pole. A crude pole fishes novice water, ' +
           'a fine pole fishes through expert, and a master pole fishes every water.';
  }
  return null;
}

function fishTrapsOf(actorId) {
  let v = null;
  try { v = mp.get(actorId, TRAP_PROPERTY); } catch (e) { v = null; }
  return Array.isArray(v) ? v.filter(function (t) { return t && typeof t === 'object'; }) : [];
}

function holdsDesc(actorId, desc) {
  const baseId = idOf(desc);
  if (!baseId) { return false; }
  let inv = null;
  try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
  const entries = (inv && inv.entries) || [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e && e.count > 0 && e.baseId === baseId) { return true; }
  }
  return false;
}

function placeFishTrap(actorId, waterRank) {
  const refusal = classGate(actorId, 'fish');
  if (refusal) { return { ok: false, line: refusal }; }
  if (!holdsDesc(actorId, FISH_TRAP_DESC)) {
    return { ok: false, line: 'You need a fish trap in your pack. A woodwright makes them. A trap is not a pole.' };
  }
  const set = fishTrapsOf(actorId);
  if (set.length >= FISH_TRAP_MAX) {
    return { ok: false, line: 'You already have ' + FISH_TRAP_MAX + ' fish traps set. Collect one before you set another.' };
  }
  if (!takeItem(actorId, FISH_TRAP_DESC, 1)) {
    return { ok: false, line: 'The trap did not leave your pack, so it was not set.' };
  }
  set.push({ at: Date.now(), rank: String(waterRank || '') });
  try { mp.set(actorId, TRAP_PROPERTY, set); }
  catch (e) {
    addItem(actorId, ITEMS.fishTrap, 1);
    return { ok: false, line: 'The trap could not be written down, so it is back in your pack.' };
  }
  let raised = null;
  try { raised = creditWork(actorId, 'fish'); } catch (e2) { raised = null; }
  return {
    ok: true,
    count: set.length,
    line: 'You set a fish trap. ' + set.length + ' of ' + FISH_TRAP_MAX + ' are out.' +
          (raised ? ' ' + raised : '')
  };
}

function setFishTrap(actorId, waterRank) {
  return placeFishTrap(actorId, waterRank);
}

function collectFishTrap(actorId) {
  const set = fishTrapsOf(actorId);
  if (!set.length) { return { ok: false, line: 'You have no fish trap set.' }; }
  const trap = set.shift();
  try { mp.set(actorId, TRAP_PROPERTY, set); }
  catch (e) { return { ok: false, line: 'The trap is still set. It could not be collected.' }; }
  let raised = null;
  try { raised = creditWork(actorId, 'fish'); } catch (e2) { raised = null; }
  return {
    ok: true,
    count: set.length,
    rank: trap && trap.rank,
    line: 'You collect a fish trap.' + (raised ? ' ' + raised : '')
  };
}

function fish(actorId, refrId, baseDesc) {
  if (!isFish(baseDesc)) return null;
  if(baseDesc==='154a5:Thornswood-Content.esp') {
    const quests=globalThis.__thornswoodQuests;
    if(!quests || typeof quests.longfinScarce!=='function')return 'This longfin water is unavailable for now.';
  }
  const caught = FISH_BY_BASE[baseDesc];
  if(!withinResourceReach(actorId,refrId)) return 'Come closer to this water.';
  const stock=globalThis.__thornswoodResourceStock;
  if(!stock) return 'This water is unavailable for now.';

  // The class first, and before the cooldown, the same ordering mineSalt,
  // mineOre and harvest() settled on and for the same reason: somebody who is
  // not a fisher is never going to work this water, and 'it is fished out'
  // tells them the wrong thing about why nothing happened.
  const refusal = classGate(actorId, 'fish');
  if (refusal) return refusal;

  // A pole, after the class and before the wait. A trap is not a pole.
  const pole = toolGate(actorId, 'fisher');
  if (pole) return pole;
  if (typeof poleTooWeak === 'function') {
    const weak = poleTooWeak(actorId, caught.rank);
    if (weak) return weak;
  }

  /*
    The record's rank. indexOf answers 0 for a novice record, so the eleven
    salmon and clams skip this test without a branch saying so, which is what
    keeps the first rung of this ladder worth standing on.

    A RANK THIS FILE DOES NOT KNOW IS THE STRICTEST ONE, NOT THE LOOSEST, which
    is the line that was missing here until 20 September. indexOf answers -1 for
    any string that is not one of the four, and -1 is not greater than 0, so the
    whole ladder test was skipped and the record was handed to anybody: measured
    against the real fish() with one row in the table, setting the pearl oyster's
    knob to 'Expert' with a capital E gave a novice fisher 'You take 1 Pearl out
    of the Pearl Oyster.' with no refusal and nothing in the log. The rank
    reaches this file out of FISH_RANK_BY_EDITOR_ID in tools\Build-HarvestTable.ps1,
    which is typed by hand one record at a time, so a one character difference in
    a knob is the failure to expect, and the built table is what arrives here.
    The wait four lines below already treats an unknown rank as the strictest
    thing it knows; the gate now does the same, so the two cannot disagree about
    the same row. Build-HuntTable.ps1 fails its run outright on a rank that is
    not one of the four and Build-HarvestTable.ps1 does the same as of the same
    day, so this is the second lock on a door rather than the only one.

    The sentence names the rank being enforced rather than the string on the row,
    because 'This Pearl Oyster takes an Expert Fisher' off a row nobody can climb
    to is a sentence that sends somebody to earn a rank that will not open it.
  */
  const step = rankStep(actorId, 'fisher');
  const named = RANK_LADDER.indexOf(caught.rank);
  const want = named < 0 ? RANK_LADDER.length - 1 : named;
  if (want > 0 && step < want) {
    return 'This ' + caught.from + ' takes ' + rankWord(RANK_LADDER[want]) +
           ' Fisher. Fish what you can until you are one.';
  }

  // The wait is the record's own. A rank the table does not name falls back to
  // the longest wait rather than the shortest, the same way the seams do, so a
  // row that arrives carrying a rank nobody knows cannot be the cheapest tap in
  // the game.
  const span = Object.prototype.hasOwnProperty.call(FISH_TUNING.cooldownMs, caught.rank)
    ? FISH_TUNING.cooldownMs[caught.rank] : FISH_TUNING.cooldownMs.master;
  // stock.left answers in milliseconds and waitWord takes seconds. Until
  // #1826 the milliseconds went in as seconds, and ten minutes left read
  // '166 hours and 40 minutes to go'.
  const waitMs = stock.left(refrId,span);
  if (waitMs > 0) {
    return 'This water is fished out for now. ' + waitWord(waitMs / 1000) + ' to go.';
  }

  const pair = FISH_TUNING.yieldByStep[step] || FISH_TUNING.yieldByStep[0];
  let got = randInt(pair[0], pair[1]);
  // addItem answers false in one case only, which is idOf returning 0 because
  // the plugin that owns the produce is not in the load order. The same
  // sentence the seams say for the same fault, because sending somebody off to
  // empty their pack over a broken build is the wrong answer twice.
  const source=globalThis.__thornswoodQuestFishingRefs && globalThis.__thornswoodQuestFishingRefs[refrId];
  if(source && source!==baseDesc)return 'This pearl bed is unavailable for now.';
  const longfin=baseDesc==='154a5:Thornswood-Content.esp';
  const method=longfin?'longfinScarce':'fishScarce';
  const unavailable=longfin?'This longfin water is unavailable for now.':'This pearl bed is unavailable for now.';
  let result,selected=!!source || longfin;
  if(selected) {
    try {
      const quests=globalThis.__thornswoodQuests;
      if(!quests || typeof quests[method]!=='function')return unavailable;
      result=quests[method](actorId,refrId);
      if(!result || !result.ok)return result && result.text || unavailable;
      got=result.count;
    }catch(error){return unavailable;}
  }else{
    /*
      The season's share of the catch (#3144), on ordinary water only: the
      pearl bed and the longfin count what their quest hands over. A catch
      that comes to nothing in winter still fishes the water out for its wait,
      and is no piece of work.
    */
    const season=globalThis.__thornswoodSeason;
    if(season && season.seasonYield)got=season.seasonYield(got);
    if(got<=0) {
      const word=season && season.yieldWord ? season.yieldWord() : '';
      const empty=stock.take(refrId,span,()=>true);
      if(!empty.ok)return 'This water is unavailable for now.';
      return 'Nothing comes out of the water this time.' + (word ? ' ' + word : '');
    }
    result=stock.take(refrId,span,()=>addItemsAtomic(actorId,[{item:caught.produce,count:got}]));
  }
  if (!result.ok) {
    return 'There is ' + caught.name + ' here and nothing in this load order to ' +
           'put in your hands. Say so in the dev channel.';
  }
  // A pearl bed's or a longfin water's catch is quest work, the quest's count.
  if (!selected) { economyGathered(actorId, caught.produce, got); }
  const rank = creditWork(actorId, 'fish');
  const worn = wearTool(actorId, 'fisher');
  /*
    One row in fifteen is called the same thing as what it gives: the butchered
    horker on Solstheim, DLC2HorkerMeat01, is named 'Horker meat' in the records
    and hands over Horker Meat. Naming both would say 'You take 1 Horker Meat
    out of the Horker meat.', so when the two read the same the sentence names
    the produce once and says where it came from instead.
  */
  const doubled = String(caught.from).toLowerCase() === String(caught.name).toLowerCase();
  const where = doubled ? 'the water' : 'the ' + caught.from;
  const season=selected ? null : globalThis.__thornswoodSeason;
  const word=season && season.yieldWord ? season.yieldWord() : '';
  return 'You take ' + got + ' ' + caught.name + ' out of ' + where + '.' +
         (word ? ' ' + word : '') + (rank ? ' ' + rank : '') + (worn ? ' ' + worn : '');
}

/**
 * A press on hanging game: a pheasant or a rabbit strung up at a camp, a
 * charred skeever over a fire. The hunter's second verb, and the hunter's rank
 * decides which of them answer and how much comes away.
 *
 * Every one of these seven records was a row in the plant table until
 * 21 September, so a gatherer picked a pheasant off a rack and a hunter walked
 * past it. Patrick's correction is that a gatherer gathers reagents and food is
 * somebody else's, and this is where the food that is an animal went. plantAt()
 * refuses them now and this answers them instead. Both halves are deliberate
 * and both are needed: the pass stops writing them into the plant table, and
 * plantAt refuses one a second time in case a table built before this change is
 * still installed on a server that has not been rebuilt.
 *
 * IT IS NOT loot() AND IT MUST NOT BE. loot() reads the reference over the wire
 * bindings and refuses anything the engine does not call a dead MpActor. These
 * seven are FLOR records that were never actors, so loot() would fall through
 * every one of them and answer nothing at all. The class gate is the same one,
 * because classes.md gives the hunter one verb and the refusal for it already
 * reads 'Only a hunter can take anything off a carcass', which is what a
 * pheasant hanging by its feet is.
 *
 * The shape is fish()'s, line for line, because the press is the same press:
 * the class first and before the wait, then the rank refused by name with an
 * unknown rank treated as the strictest rather than the loosest, then the
 * record's own wait, then the count for the hunter's rank.
 *
 * Since #3141 it answers the racks in RACKS_BY_HAND as well: a horker for the
 * hunter and the fish laid out in Windhelm for the fisher, each through its owner's gate,
 * ladder, waits and yields (RACK_OWNERS).
 */
function game(actorId, refrId, baseDesc) {
  const rack = rackOf(baseDesc);
  if (!rack) return null;
  const hung = rack.row;
  const who = rack.owner;
  const tuning = who.tuning();
  if(!withinResourceReach(actorId,refrId)) return 'Come closer to this rack.';
  const stock=globalThis.__thornswoodResourceStock;
  if(!stock) return 'This rack is unavailable for now.';

  // The class first, and before the cooldown, the same ordering mineSalt,
  // mineOre, harvest() and fish() settled on and for the same reason: somebody
  // who is not a hunter is never going to work this rack, and 'it is picked
  // clean' tells them the wrong thing about why nothing happened.
  const refusal = classGate(actorId, who.verb);
  if (refusal) return refusal;

  /*
    The record's rank. indexOf answers 0 for a novice record, so the two rabbits
    and the two pheasants skip this test without a branch saying so, which is
    what keeps the first rung of this ladder worth standing on.

    A RANK THIS FILE DOES NOT KNOW IS THE STRICTEST ONE, NOT THE LOOSEST. The
    whole of the case is written out in fish() above, where it was a real bug
    measured on 20 September: indexOf answers -1 for any string that is not one
    of the four, -1 is not greater than 0, so the ladder test was skipped and
    the record was handed to anybody. The rank reaches this file out of
    GAME_RANK_BY_EDITOR_ID in tools\Build-HarvestTable.ps1, which is typed by
    hand one record at a time, so a one character difference in a knob is the
    failure to expect. That script fails its run on a rank that is not one of
    the four, so this is the second lock on that door rather than the only one.
  */
  const step = rankStep(actorId, who.ladder);
  const named = RANK_LADDER.indexOf(hung.rank);
  const want = named < 0 ? RANK_LADDER.length - 1 : named;
  if (want > 0 && step < want) {
    return 'This ' + hung.from + ' takes ' + rankWord(RANK_LADDER[want]) +
           ' ' + who.word + '. Work what you can until you are one.';
  }

  // The wait is the record's own. A rank the table does not name falls back to
  // the longest wait rather than the shortest, the same way the rivers, the
  // seams and the bodies do.
  const span = Object.prototype.hasOwnProperty.call(tuning.cooldownMs, hung.rank)
    ? tuning.cooldownMs[hung.rank] : tuning.cooldownMs.master;
  // milliseconds from the stock, seconds to waitWord, as in fish() (#1826)
  const waitMs = stock.left(refrId,span);
  if (waitMs > 0) {
    return 'This one is picked clean for now. ' + waitWord(waitMs / 1000) + ' to go.';
  }

  const pair = tuning.yieldByStep[step] || tuning.yieldByStep[0];
  const got = randInt(pair[0], pair[1]);
  // A hand row hands one item of its list (RACKS_BY_HAND); none in this load
  // order is the same answer as a produce that is not loaded.
  let produce = hung.produce;
  if (hung.list) {
    const items = listItems(hung.list);
    produce = items.length ? items[randInt(0, items.length - 1)] : '';
  }
  // addItem answers false in one case only, which is idOf returning 0 because
  // the plugin that owns the produce is not in the load order. The same
  // sentence the seams and the rivers say, because sending somebody off to
  // empty their pack over a broken build is the wrong answer twice.
  const taken=stock.take(refrId,span,()=>!!produce && addItemsAtomic(actorId,[{item:produce,count:got}]));
  if (!taken.ok) {
    return 'There is ' + (hung.name || 'something') + ' here and nothing in this load order to ' +
           'put in your hands. Say so in the dev channel.';
  }
  economyGathered(actorId, produce, got);
  const rank = creditWork(actorId, who.verb);
  /*
    The same doubling fish() has to handle: a row whose name in the world reads
    the same as what it gives would say 'You take 1 Cooked Skeever off the
    Cooked Skeever.' None of the seven does today, measured against the built
    table, because a pheasant gives Pheasant Breast and a skeever on a skewer is
    CharredSkeever03 giving Cooked Skeever, but a mod renaming one is a sentence
    nobody would see until somebody read it in the world.
  */
  if (!hung.name) {
    return 'You take ' + got + ' from the ' + hung.from + '.' + (rank ? ' ' + rank : '');
  }
  const doubled = String(hung.from).toLowerCase() === String(hung.name).toLowerCase();
  const where = doubled ? 'the rack' : 'the ' + hung.from;
  return 'You take ' + got + ' ' + hung.name + ' off ' + where + '.' +
         (rank ? ' ' + rank : '');
}

/*
  THE BUTTER CHURN IS THE FARMER'S.

  Patrick, 21 September: "give milk and butter to farmers and make mammoth
  cheese bowls able to be picked up by literally anybody."

  BYOHButterChurn is the churn in a HearthFires homestead. It is a FLOR somebody
  presses E on, so there is a press here to gate. Until now nothing answered it:
  the food rule took it out of the gatherer's plant table on 21 September and
  put it in none of the others, loot() falls through for anything that is not
  an actor, and so the press fell out of onActivate untouched and the engine
  handed the Butter to whoever pressed it. Counted over tools\recipes.json on
  21 September, Butter is 46 of the Cook's inputs, the biggest single one, and
  the farmer supplied the Cook nothing at all.

  NOVICE WORK, ONE BUTTER A PRESS. One is what the engine's own pick gave:
  GivePickupItemsToActivationSource in the fork hands over a FLOR's produce
  once unless the reference itself carries a count, read on 24 September. The
  wait is HARVEST_COOLDOWN_MS, the ten minutes a picked plant waits, and it is
  the presser's own, because lastUse is keyed by who pressed as well as what.
  It is the plants' constant and not a new one on purpose: longestWaitMs reads
  every wait a cooldown is checked against, test-cooldown-sweep.js fails on a
  wait it does not read, and ten minutes is the plants' number already. These
  are first numbers for the dev server.

  THE MAMMOTH CHEESE BOWL IS NOT HERE AND MUST NOT BE. "Literally anybody" is
  its row in WORLD_PRODUCE_ANYBODY (#3141), which lets the engine hand it to
  whoever pressed it. A line here would make it the farmer's.

  MILK IS BESIDE loot(), FOR LIVING COWS ONLY.
  A farmer pressing E on a living cow is given one Jug of Milk
  (3534:HearthFires.esm) on HARVEST_COOLDOWN_MS, the plants' ten minutes, and
  the work is counted under the farm verb. A dead cow is still the hunter's:
  milk() reads isDead and returns null so loot() takes the body. A living cow
  is nothing to everybody else: milk() returns null for a non-farmer, so the
  press falls through the way it did before this branch existed. That fall
  through is what keeps every other living press in the game working, and it
  is the trap on #396.

  Goats and a milking rank are still Patrick's to say (#396 step 4). Until then
  only the Cow rows out of hunts.json are milked, and there is no rank gate.

  The log line below is the measurement the entry asked for: every press that
  reaches milk() on a living cow prints "milk: living cow press" so a console
  on the server (and the client's "Sent activation for caster=") can prove the
  activation arrived. If neither line shows, milk needs another way in.
*/
const CHURNS = { 'bc0:HearthFires.esm': 'Churn' };

/** True when this base is a butter churn. Never a bare lookup, for the reason
 *  isGame gives: '__proto__' finds something on Object.prototype. */
function isChurn(baseDesc) {
  return Object.prototype.hasOwnProperty.call(CHURNS, baseDesc);
}

/**
 * A press on a butter churn: a farmer gets one Butter, everybody else is told
 * whose work it is. Null for any base that is not a churn, so it can never
 * answer a press meant for something else. The churn is put back by the
 * branch in onActivate that calls this, the way the plants are.
 */
function churn(actorId, refrId, baseDesc) {
  if (!isChurn(baseDesc)) return null;

  // The class first, and before the wait, the same order harvest(), fish() and
  // game() settled on: somebody who is not a farmer is never going to work this
  // churn, and 'you have worked it' tells them the wrong thing. The sentence is
  // the farm verb's own, because the farmer is the one to ask.
  const refusal = classGate(actorId, 'farm');
  if (refusal) return refusal;

  const wait = cooldownLeft(actorId, refrId, HARVEST_COOLDOWN_MS);
  if (wait > 0) {
    return 'You have worked this churn for now. ' + waitWord(wait) + ' to go.';
  }

  // addItem answers false in one case only, the plugin that owns the Butter not
  // being in the load order, and it says so the way the seams and racks do.
  if (!addItem(actorId, ITEMS.butter, 1)) {
    return 'There is Butter here and nothing in this load order to put in ' +
           'your hands. Say so in the dev channel.';
  }
  stampCooldown(actorId, refrId);
  economyGathered(actorId, ITEMS.butter, 1);
  const rank = creditWork(actorId, 'farm');
  return 'You churn 1 Butter.' + (rank ? ' ' + rank : '');
}

/*
  A CHICKEN NEST IS THE FARMER'S (#628).

  "Gather can get eggs": ChickenNest gives Chicken's Egg, an INGR, so the food
  rule (which reads the ALCH food bit) never took it off the gatherer, and
  the harvest table ranked it like a flower. A nest is kept in a farmyard,
  not found in the wild, so it is the farmer's, the same way the churn and
  the living cow are. Build-HarvestTable.ps1 now names it in
  FARMYARD_BY_EDITOR_ID and leaves it out of every table, and this answers
  the press. Wild bird nests (pine thrush, rock warbler, hawk) are found in
  the wild and stay the gatherer's.

  Shape is churn's: classGate farm first, HARVEST_COOLDOWN_MS, addItem the
  egg, counted under the farm verb, no rank gate. Build-RecipeTable.ps1 reads
  ITEMS.chickenEgg out of this body (STATION_VERBS), which is how the Cook's
  recipes learn the farmer supplies the egg. The refusal is a string, never
  null: a FLOR that falls through is handed to the presser by the engine,
  which is the free egg this exists to stop. The success toast starts with
  "You take " so the put back in onActivate leaves the nest empty the way a
  real plant pick does.
*/
const CHICKEN_NESTS = {
  '1062d1:Skyrim.esm': "Chicken's Egg"  // ChickenNest -> 23d77 Chicken's Egg
};

/** True when this base is a chicken nest a farmer collects from. */
function isChickenNest(baseDesc) {
  return Object.prototype.hasOwnProperty.call(CHICKEN_NESTS, baseDesc);
}

/**
 * A press on a chicken nest: a farmer gets one Chicken's Egg, everybody else
 * is told whose work it is. Null only for a base that is not a nest.
 */
function collectEgg(actorId, refrId, baseDesc) {
  if (!isChickenNest(baseDesc)) return null;

  log('egg: chicken nest press', baseDesc, 'by', actorId);

  const refusal = classGate(actorId, 'farm');
  if (refusal) return refusal;

  const wait = cooldownLeft(actorId, refrId, HARVEST_COOLDOWN_MS);
  if (wait > 0) {
    return 'You have taken from this nest for now. ' + waitWord(wait) + ' to go.';
  }

  if (!addItem(actorId, ITEMS.chickenEgg, 1)) {
    return "There is a Chicken's Egg here and nothing in this load order to " +
           'put in your hands. Say so in the dev channel.';
  }
  stampCooldown(actorId, refrId);
  economyGathered(actorId, ITEMS.chickenEgg, 1);
  const rank = creditWork(actorId, 'farm');
  return "You take 1 Chicken's Egg." + (rank ? ' ' + rank : '');
}


/*
  A PLACED HIVE IS THE FARMER'S.

  docs/systems/classes/farmer.md: 1 Honeycomb, 10 minutes, one piece of
  work, novice, no rank gate. The placed hive is
  dbf8b3:Thornswood-Content.esp. That is also the beehive row on the
  harvest list. It is not a gatherer verb.
*/
const HIVES = {
  'dbf8b3:Thornswood-Content.esp': 'Beehive'
};

function isHive(baseDesc) {
  return Object.prototype.hasOwnProperty.call(HIVES, baseDesc);
}

function hive(actorId, refrId, baseDesc) {
  if (!isHive(baseDesc)) return null;

  const refusal = classGate(actorId, 'farm');
  if (refusal) return refusal;

  const wait = cooldownLeft(actorId, refrId, HARVEST_COOLDOWN_MS);
  if (wait > 0) {
    return 'You have worked this hive for now. ' + waitWord(wait) + ' to go.';
  }

  if (!addItem(actorId, ITEMS.honeycomb, 1)) {
    return 'There is Honeycomb here and nothing in this load order to put in ' +
           'your hands. Say so in the dev channel.';
  }
  stampCooldown(actorId, refrId);
  economyGathered(actorId, ITEMS.honeycomb, 1);
  const rank = creditWork(actorId, 'farm');
  return 'You take 1 Honeycomb.' + (rank ? ' ' + rank : '');
}

/*
  A FARMER MILKS A LIVING COW.

  Beside loot(), not inside it: loot() falls through for a living actor, and
  that fall through is what every other living press in the game stands on.
  milk() answers only a living cow for a farmer; everybody else and every other
  base get null, so the press leaves this file untouched.

  Cow bases are the name=Cow rows out of hunts.json (six of them on the day
  this was written). Goats wait on Patrick (#396 step 4). No rank gate: novice
  work, the same as the churn.
*/
const MILK_COWS = {
  '6681e:Skyrim.esm': 'Cow',
  'c39f1:Skyrim.esm': 'Cow',
  '9da4b:Skyrim.esm': 'Cow',
  '23a90:Skyrim.esm': 'Cow',
  'f9a9:Dawnguard.esm': 'Cow',
  'ea867:ZIA_Complete Pack.esp': 'Cow'
};

/** True when this base is a cow a farmer can milk. Never a bare lookup. */
function isMilkCow(baseDesc) {
  return Object.prototype.hasOwnProperty.call(MILK_COWS, baseDesc);
}

/**
 * A press on a living cow: a farmer gets one Jug of Milk, everybody else is
 * left alone (null), and a dead cow is left for loot(). Null for any base that
 * is not a milk cow.
 */
function milk(actorId, refrId, baseDesc) {
  if (!isMilkCow(baseDesc)) return null;

  let type = '';
  try {
    type = mp.get(refrId, 'type');
  } catch (e) {
    return null;
  }
  if (type !== 'MpActor') return null;

  let dead = false;
  try {
    dead = mp.get(refrId, 'isDead');
  } catch (e) {
    return null;
  }
  // Dead cows are carcasses. loot() takes them; this does not.
  if (dead) return null;

  // The measurement #396 asked for: did the activation reach the server?
  log('milk: living cow press', baseDesc, 'by', actorId);

  // Non-farmers fall through. A refusal string here would return false from
  // onActivate and block every living cow press for everybody who is not a
  // farmer, which is the trap on the issue.
  const refusal = classGate(actorId, 'farm');
  if (refusal) return null;

  const wait = cooldownLeft(actorId, refrId, HARVEST_COOLDOWN_MS);
  if (wait > 0) {
    return 'You have milked this cow for now. ' + waitWord(wait) + ' to go.';
  }

  if (!addItem(actorId, ITEMS.milk, 1)) {
    return 'There is Milk here and nothing in this load order to put in ' +
           'your hands. Say so in the dev channel.';
  }
  stampCooldown(actorId, refrId);
  economyGathered(actorId, ITEMS.milk, 1);
  const rank = creditWork(actorId, 'farm');
  return 'You milk 1 Jug of Milk.' + (rank ? ' ' + rank : '');
}


/*
  EVERY ANIMAL BODY THIS SERVER ANSWERS FOR, AND IT IS GENERATED.

  Everything between the declaration below and the line that closes the block is
  written by tools\Build-HuntTable.ps1, out of the NPC_ records of the load order
  and the death item levelled lists they point at. DO NOT HAND EDIT IT. The next
  run of that script replaces every line between them and takes any correction
  with it. Same arrangement as ORES_BY_BASE, HARVESTS_BY_BASE, FISH_BY_BASE and
  CROPS_BY_BASE, for the same reason.

  IT IS SEEDED WITH NINE ANIMALS AND THE SCRIPT FILLS IT, which is how
  CROPS_BY_BASE started as well. The nine were read out of the five masters on
  20 September with a walk of their NPC_, LVLI, MISC, INGR and ALCH records, not
  off a wiki: EncWolf is 23abe:Skyrim.esm, its INAM points at DeathItemWolf,
  3ad9e:Skyrim.esm, and the one thing in that list that is not a coin purse is
  MISC 3ad74:Skyrim.esm, Wolf Pelt, priced at 10 gold. Every row below was read
  the same way.

  WHY THE SERVER HAS TO HAND THE PELT OVER ITSELF, CORRECTED 20 SEPTEMBER. This
  block used to say the death item was not on the body at all, because the client
  resolved it. That is not true of this fork and was read out of the source
  rather than assumed this time: MpActor::Kill ends with AddDeathItem
  (skymp5-server/cpp/server_guest_lib/MpActor.cpp:1348), AddDeathItem calls
  EvaluateDeathItem, and EvaluateDeathItem follows TPLT through
  espm::NPC_::UseTraits, runs LeveledListUtils::EvaluateListRecurse on the INAM
  record and AddItem()s every result into the dead actor's OWN inventory. So
  mp.get(refrId, 'inventory') on a fresh carcass does carry a Wolf Pelt, and the
  server, not the client, put it there.

  The table is still the only way a hunter ever sees it, and that is the real
  reason it exists. NOBODY CAN OPEN A BODY. ProcessActivateNormal
  (MpObjectReference.cpp:1419) has no NPC_ branch: a body is not pickable, not a
  DOOR, not a CONT, not an ACTI and not a FURN, so a press falls through every
  branch and no container is ever sent. The client blocks it as well, in
  objectReferenceEx.ts, which calls blockActivation(true) for FormType.NPC, and
  again in movementApply.ts for every actor it applies movement to. And the pile
  does not survive: RespawnWithDelay (MpActor.cpp:1351) replaces the corpse's
  inventory with the few SweetCantDrop entries and the base container before it
  stands the animal back up. So the engine's roll is created and thrown away
  without anybody being able to reach it, and the row below is what actually
  reaches a hunter's pack.

  THAT MEANS THE YIELD IS ROLLED TWICE AND ONE OF THE TWO IS UNREACHABLE. Worth
  knowing before anybody opens bodies up: the day a press on a carcass sends a
  container, this table starts paying out on top of the engine's own roll, and
  the engine's roll includes the coin purse and treasure sublists this table
  deliberately leaves out. Whoever does that has to take one of the two away,
  and a line in #dev comes first.

  A row says:

    name   what the animal is called, so a refusal and a yield can both say it.
    rank   the Hunter rank the body asks for, which in the built table is the
           gold value of the best thing the body gives against RANK_BANDS at
           the top of that script: up to 10 novice, up to 25 advanced, up to 75
           expert, anything above that master. The seed uses the same bands and
           the same reading, off the five masters, so the fox, the wolf, the
           goat, the deer and the elk are on the first rung, which is five of
           the nine, because a hunter who cannot work the animals standing
           outside every town cannot climb.
    yield  FOUR PAIRS, novice first, the least and the most of EACH thing in
           gives that a hunter of that rank takes. A pair of zeroes is a rank
           that may not work that body at all, which is how the table refuses
           without a second set of thresholds standing beside it to disagree,
           and is the same convention ORES_BY_BASE uses. rank above is what the
           refusal says out loud and the pair is what decides it.
    gives  what the death item list holds for certain, each with the item
           record, its name, and the count the list carries. The seed follows
           no sublist at all: DeathItemDeerNew points at LItemAntlersLarge50
           and DeathItemGoat at BYOHLItemHornGoat50, and a list with a chance
           of giving nothing in it is a chance and not a yield. The built table
           follows a sublist only while that sublist's LVLD is zero, which is
           the same rule read properly, and it is what keeps the coin purse
           list every one of these bodies also carries out of the table.
*/
var HUNTS_BY_BASE = table('HUNTS_BY_BASE');

/*
  HOW LONG A BODY LIES THERE. THE RULEBOOK DOES NOT SET IT, AND IT IS THE
  ENGINE'S NUMBER UNTIL THIS FILE SETS IT.

  THE PREMISE THIS BLOCK USED TO REST ON WAS FALSE, MEASURED IN THE FORK ON
  20 SEPTEMBER. It said a body never comes back, lies there until the cell resets
  and so a four hour wait per hunter per reference meant 'once'. Every dead actor
  on this server stands back up: DeathEvent::OnFireSuccess
  (skymp5-server/cpp/server_guest_lib/gamemode_events/DeathEvent.cpp:66) calls
  MpActor::RespawnWithDelay for every death of every actor, RespawnWithDelay
  (MpActor.cpp:1351) sets a timer of GetRespawnTime(), GetRespawnTime is
  ChangeForm().spawnDelay, and spawnDelay is declared `float spawnDelay = 25.0f`
  at MpChangeForms.h:109. Nothing in this file used to set it, so the number in
  force was twenty five seconds and two things followed from it that nobody had
  written down:

    - The same wolf at the same reference could be killed again every twenty
      five seconds, and the four hour wait keyed on actorId + ':' + refrId
      refused the second body and every body after it for four hours. A hunter
      working a patrol route was told 'There is nothing more to take off this
      Wolf. 4 hours to go.' standing over an animal that had been alive ten
      seconds earlier.
    - Twenty five seconds was also the whole window in which the verb answered
      at all, because loot() reads isDead and a respawned animal is not dead.
      Walk over half a minute after the kill and the press did nothing, said
      nothing and looked exactly like a server that had never heard of hunting.

  SO THE BODY IS GIVEN A LENGTH, an invented first number for the dev server.

  bodySeconds, how long a carcass lies there before the animal stands back up.
  Five minutes. It is written onto the dying actor in mp.onDeath, which runs
  before the engine starts the respawn timer (GameModeEvent::Fire runs every
  listener first and only then calls OnFireSuccess), so the number this file sets
  is the one that death uses. Five minutes is long enough to finish the fight,
  sheathe and walk back to what fell in it, and short enough that the woods are
  not a field of carcasses for an hour. It is set on animals in the hunt table
  and on nothing else, so bandits, guards and dragons keep the engine's twenty
  five seconds and no other part of the server changes pace.

  A body has no wait by rank. Until #1413 this table also had cooldownMs, how
  long one hunter was done with one reference, ten minutes to four hours by the
  rank of the body. Since #1413 a carcass is dressed once a life, by whoever
  dresses it first, on the shared resource stock (stock.dress), and the next life
  is the next body, so nothing read those waits and they came out in #1831.
  bodySeconds is written into the actor's change form by the engine, so it
  outlives a reload and is re-set on every death anyway.
*/
const HUNT_TUNING = {
  bodySeconds: 300
};

/** True when this base is one of the animals in the generated table above.
 *  Never a bare lookup, for the reason own() in the progression block was
 *  written: '__proto__' finds something on Object.prototype that a truth test
 *  cannot tell from a wolf. */
function isCarcass(baseDesc) {
  return Object.prototype.hasOwnProperty.call(HUNTS_BY_BASE, baseDesc);
}

/** '1 Wolf Pelt', '1 Venison and 1 Deer Hide', '1 Venison, 1 Deer Hide and 1
 *  Large Antlers'. Written here rather than reached for because a carcass is
 *  the only thing in this file that hands over more than one kind of thing at
 *  once, and 'You take 1 Venison, 1 Deer Hide, off the Deer.' is not a
 *  sentence. */
function saidInOrder(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, parts.length - 1).join(', ') + ' and ' + parts[parts.length - 1];
}

/**
 * A press on an animal body: the hunter's verb, and the hunter's rank decides
 * which bodies answer and how much comes off them.
 *
 * WHAT THE SERVER CAN TELL ABOUT A BODY, read out of the fork on 20 September
 * rather than assumed, because this is the question that held the hunter up for
 * days:
 *
 *   mp.get(refrId, 'type') is the string 'MpActor' for anything that is an
 *   actor and 'MpObjectReference' for a chest, a door, a plant or an ore vein.
 *   TypeBinding.cpp does GetFormAt<MpObjectReference> and asks AsActor(). That
 *   is how a body is told from a chest, and it is the only way to.
 *
 *   mp.get(refrId, 'isDead') is true for a corpse. IsDeadBinding.cpp does
 *   GetFormAt<MpActor>, which THROWS for anything that is not an actor, so the
 *   type has to be read first and every read has to be wrapped.
 *
 *   ProcessActivateNormal in the fork does nothing at all for an NPC_ base: it
 *   is not pickable, not a DOOR, not a CONT, not an ACTI and not a FURN, so it
 *   falls through every branch. Nothing of the engine's is being taken away
 *   here.
 *
 *   isDead is true for a while and then it is not. Every dead actor is stood
 *   back up: DeathEvent::OnFireSuccess calls MpActor::RespawnWithDelay for every
 *   death and the delay is the actor's own spawnDelay, twenty five seconds
 *   unless something sets it. mp.onDeath sets it to HUNT_TUNING.bodySeconds for
 *   the animals in the table, so the window this function answers in is five
 *   minutes on an animal and the engine's twenty five seconds on everything
 *   else. Press an animal after that and it is alive again, the isDead test
 *   below falls through, and the press is the client's business: pressing a live
 *   animal is riding it, talking to it or nothing at all, which is why that is
 *   silence rather than a refusal.
 *
 * THE ORDER OF THE CHECKS, AND THE ONE THAT IS NOT WHERE IT LOOKS LIKE IT
 * BELONGS. Type, then dead, then the table, then the class, then the rank, then
 * the body taken once a life on the shared stock. The class gate sits BELOW the
 * table lookup, which is the opposite
 * of where a gate usually goes and is the same order mineOre and harvest()
 * already use. It matters here more than it does there. This function is
 * reached by a press on anything no other branch claimed, which is every dead
 * bandit, every dead guard, every dead draugr and every dead dragon in the
 * game, and none of those is in the table. A gate above the table would answer
 * all of them with 'Only a hunter can take anything off a carcass' and, because
 * onActivate returns false for anything this file answers, would block whatever
 * the client does with a body for everybody who is not a hunter. Below the
 * table, a body this server does not know about is not this server's business
 * and falls through untouched, which is what the fifth bullet of the task that
 * asked for this says it must do.
 */
function loot(actorId, refrId, baseDesc) {
  if([0x33fa6,0x846ea,0x846eb].includes(refrId)) {
    const quests=globalThis.__thornswoodQuests;
    if(!quests || typeof quests.dressMammoth!=='function')return 'This mammoth ground is unavailable for now.';
    const result=quests.dressMammoth(actorId,refrId,baseDesc);
    if(!result || !result.ok)return result && result.text || 'This mammoth ground is unavailable for now.';
    const rank=creditWork(actorId,'loot');
    return result.text+(rank?' '+rank:'');
  }
  // Every read wrapped, and the type first. A throw here is a reference the
  // world does not have any more, or one this binding cannot answer for, and
  // the answer to both is the same: this is not ours, leave it alone. Never
  // refuse on a read that failed and never pay out on one.
  let type = '';
  try {
    type = mp.get(refrId, 'type');
  } catch (e) {
    return null;
  }
  if (type !== 'MpActor') return null;

  let dead = false;
  try {
    dead = mp.get(refrId, 'isDead');
  } catch (e) {
    return null;
  }
  // A living animal is not a carcass. Pressing one is talking to it, riding it
  // or nothing at all, and all three of those are somebody else's to answer.
  if (!dead) return null;

  if (!isCarcass(baseDesc)) return null;
  const body = HUNTS_BY_BASE[baseDesc];
  if(!withinResourceReach(actorId,refrId)) return 'Come closer to this carcass.';
  const stock=globalThis.__thornswoodResourceStock;
  if(!stock) return 'This carcass is unavailable for now.';

  const refusal = classGate(actorId, 'loot');
  if (refusal) return refusal;

  /*
    The rank, refused by name. The pair of zeroes is what decides it, not a
    comparison against the rank on the row: the table carries one pair per rank
    and a pair of zeroes IS 'this rank may not work this body', which is the
    convention ORES_BY_BASE already uses and means there is no second set of
    thresholds standing beside the table to disagree with it. The rank on the
    row is what the sentence says out loud.
  */
  const step = rankStep(actorId, 'hunter');
  const pair = (body.yield && body.yield[step]) || [0, 0];
  if (pair[0] <= 0 && pair[1] <= 0) {
    return 'This ' + body.name + ' takes ' + rankWord(body.rank) +
           ' Hunter. Work the bodies you can until you are one.';
  }

  // The pair is how many of EACH thing the body gives, rolled once for each,
  // so a deer hands over its meat and its hide in the same press and a master
  // takes more of both than a novice does.
  const took = [];
  const gives = body.gives || [];
  const goods=[];
  let unloadable = false;
  for (let i = 0; i < gives.length; i++) {
    const g = gives[i];
    const n = randInt(pair[0], pair[1]);
    if (n <= 0) continue;
    // addItem answers false in one case only, which is idOf returning 0 because
    // the plugin that owns that item is not in the load order. The rest of the
    // body still comes off; what could not be given is said at the end.
    if (!idOf(g.item)) { unloadable = true; continue; }
    goods.push({item:g.item,count:n});
    took.push(n + ' ' + g.name);
  }

  if (took.length === 0) {
    if (unloadable) {
      return 'This ' + body.name + ' should give something and there is nothing in ' +
             'this load order to put in your hands. Say so in the dev channel.';
    }
    // A row whose gives list is empty. The pass leaves a body out of the table
    // altogether when its death item holds nothing certain, so this is a row
    // that arrived built wrong rather than a body that has nothing on it. It is
    // not a refusal and it is not the person's fault: say so and start no wait.
    return 'There is nothing on this ' + body.name + ' you know how to take yet.';
  }

  if(unloadable) return 'This carcass has supplies missing from the load order. Say so in the dev channel.';
  const result=stock.dress(refrId,()=>addItemsAtomic(actorId,goods));
  if(!result.ok) return 'There is nothing more to take off this ' + body.name + '.';
  for (let i = 0; i < goods.length; i++) { economyGathered(actorId, goods[i].item, goods[i].count); }
  const rank = creditWork(actorId, 'loot');
  const short = unloadable
    ? ' The rest of it is not in this load order. Say so in the dev channel.' : '';
  return 'You take ' + saidInOrder(took) + ' off the ' + body.name + '.' + short +
         (rank ? ' ' + rank : '');
}

/**
 * A press on a crop, answered by the farming block further down the file.
 *
 * The same shape as classGate above, and for the same reason: the farming block
 * registers itself on globalThis after the rules it depends on, so it is looked
 * up when somebody presses E rather than when this line is read. Unlike
 * classGate, a farming block that is missing does NOT open the gate. An open
 * gate here would be the engine handing out a free pick every hour, which is
 * the single thing the whole system exists to stop, so a missing block refuses
 * and says so in the log.
 */
function farmActivate(actorId, refrId, baseDesc) {
  const refs=globalThis.__thornswoodQuestOrchardRefs;
  if(baseDesc==="141081:JK's Whiterun's Outskirts.esp" && !refs)return 'The orchard is unavailable for now.';
  if(refs && refs[refrId]) {
    const quests=globalThis.__thornswoodQuests;
    if(!quests || typeof quests.harvestOrchard!=='function')return 'The orchard is unavailable for now.';
    const result=quests.harvestOrchard(actorId,refrId,baseDesc);
    if(result!==null)return result.text;
  }
  const f = globalThis.__thornswoodFarming;
  if (!f || !f.activate) {
    log('the farming block is not loaded, so the crop at', refrId.toString(16),
        'gives nothing');
    return 'Nothing comes of it.';
  }
  try {
    return f.activate(actorId, refrId, baseDesc);
  } catch (e) {
    log('the crop at', refrId.toString(16), 'threw:', e);
    return 'Nothing comes of it.';
  }
}

/**
 * Everything anybody presses E on.
 *
 * Returning false blocks the default activation, which is what keeps the
 * furniture from playing its own idle while the server hands out the yield.
 * Returning undefined lets it through: the native reads the result and only an
 * explicit false counts as a block, so falling off the end of this function is
 * the safe answer and is what every ordinary door, chest and item gets.
 */
/*
  A container, by the record rather than by a list of base ids.

  The spoils block already memoises every base it looks up, so asking it is one
  hash lookup after the first press on a given base. Asking the engine again
  here would be a second lookup for the same answer.
*/
function kindIsContainer(baseDesc) {
  var sp = globalThis.__thornswoodSpoils;
  if (!sp || !sp.kindOf) { return false; }
  try { return sp.kindOf(idOf(baseDesc)) === 'CONT'; } catch (e) { return false; }
}

mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {
  if([0x33fa6,0x846ea,0x846eb].includes(refrId)) {
    if(!casterRefrId)return false;
    try {notify(casterRefrId,loot(casterRefrId,refrId,mp.get(refrId,'baseDesc')));}
    catch(error){try {log('Mammoth dressing refused:',String(error));}catch(logError){}}
    return false;
  }
  if(globalThis.__thornswoodQuestRetrievalRefs && globalThis.__thornswoodQuestRetrievalRefs[refrId]) {
    if(!casterRefrId)return false;
    try {
      const quests=globalThis.__thornswoodQuests;
      const text=quests && typeof quests.onActivate==='function' ? quests.onActivate(casterRefrId,refrId) : null;
      notify(casterRefrId,text || 'This retrieval source is unavailable for now.');
    }catch(error){try {log('Retrieval refused:',String(error));}catch(logError){}}
    return false;
  }
  const questFishBase=globalThis.__thornswoodQuestFishingRefs && globalThis.__thornswoodQuestFishingRefs[refrId];
  if(questFishBase) {
    if(!casterRefrId)return false;
    try {
      const base=mp.get(refrId,'baseDesc');
      notify(casterRefrId,base===questFishBase?fish(casterRefrId,refrId,base):'This quest water is unavailable for now.');
    }catch(error){try {log('Scarce fishing refused:',String(error));}catch(logError){}}
    return false;
  }
  if([0x10fc57,0x10eb24,0x10e994,0x10e955,0x10e8bb,0x10fc4c].includes(refrId)) {
    if(!casterRefrId)return false;
    try {notify(casterRefrId,drawGeode(casterRefrId,refrId,mp.get(refrId,'baseDesc')));}
    catch(error){try {log('Geode work refused:',String(error));}catch(logError){}}
    return false;
  }
  if([0xf3b51,0xf3b54,0xf3b5d,0x10ffac,0x10ffaf,0x10ffb0,0xf3b56,0x10ffa9].includes(refrId)) {
    if(!casterRefrId)return false;
    try {
      notify(casterRefrId,harvest(casterRefrId,refrId,mp.get(refrId,'baseDesc')));
    }catch(error){
      try {log('Crimson harvesting refused:',String(error));}catch(logError){}
    }
    return false;
  }
  if (!casterRefrId) return;
  let baseDesc;
  try {
    baseDesc = mp.get(refrId, 'baseDesc');
  } catch (e) {
    return;
  }


  /*
    A STUDY DESK IN THE COLLEGE HALLS (#1387): a semester at the College,
    which is the desk's whole use. The college block answers null for any
    other press, which goes on down the chain.
  */
  try {
    const collegeDesk = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodCollege;
    const deskLine = (collegeDesk && collegeDesk.deskActivated)
      ? collegeDesk.deskActivated(refrId, casterRefrId, baseDesc) : null;
    if (deskLine !== null) {
      notify(casterRefrId, deskLine);
      say(casterRefrId, deskLine);
      return false;
    }
  } catch (eDesk) {
    log('the study desk at', Number(refrId).toString(16), 'threw:', eDesk);
  }

  /*
    A NOTICE BOARD OR ITS DROP BOX (#2516, #2298): the server's own
    references. The board opens only the board's panel and the box only the
    box's, and nothing else in this chain sees the press.
  */
  try {
    const propBoard = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodProperty;
    const boardWhich = (propBoard && propBoard.boardActivated) ? propBoard.boardActivated(refrId, casterRefrId) : '';
    if (boardWhich) {
      // Finding the board is a first step (#3166); the box beside it is not the board.
      const steps = globalThis.__thornswoodFirstSteps;
      if (boardWhich === 'board' && steps && steps.sawBoard) {
        try { steps.sawBoard(casterRefrId); } catch (eSteps) { log('first steps threw at the board:', eSteps); }
      }
      return false;
    }
  } catch (eBoard) {
    log('the board or box at', Number(refrId).toString(16), 'threw:', eBoard);
  }

  /*
    A TRADE SHIP'S DOCK CRATE (#2700): the dock panel, never the container.
    Any other container a staff member opens is remembered for a minute,
    for the staff panel, and the press goes on.
  */
  try {
    const shipsDock = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodTradeShips;
    if (shipsDock && shipsDock.activated && shipsDock.activated(refrId, casterRefrId, baseDesc)) {
      return false;
    }
  } catch (eShip) {
    log('the dock crate at', Number(refrId).toString(16), 'threw:', eShip);
  }

  /*
    A TRADE CART STOP'S CRATE (#3158): the stop panel, never the container,
    the same way as a dock's, asked after it.
  */
  try {
    const cartStop = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodTradeCarts;
    if (cartStop && cartStop.activated && cartStop.activated(refrId, casterRefrId, baseDesc)) {
      return false;
    }
  } catch (eCart) {
    log('the cart stop crate at', Number(refrId).toString(16), 'threw:', eCart);
  }

  /*
    WATER (#1382). A well activator with an empty bottle fills it; a cooking
    spot starts boiling any unboiled water carried. It answers nothing to the
    engine, so the press goes on down the chain and the cooking menu opens as
    it always has. Boiling is not cooking, so it is asked before the bench gate.
  */
  try {
    var needsW = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodNeeds;
    if (needsW && needsW.activatedWater) {
      var refDescW = '';
      try { refDescW = mp.getDescFromId(refrId); } catch (eW) { refDescW = ''; }
      var kwW = (typeof BENCH_BY_BASE !== 'undefined' && BENCH_BY_BASE &&
                 Object.prototype.hasOwnProperty.call(BENCH_BY_BASE, baseDesc)) ? BENCH_BY_BASE[baseDesc] : '';
      /*
        HAIR DYE (#2675) at the same cooking spot, asked first: a steep and a
        boil can start on one press, and the hair dye block says which is
        settled first. Neither answers the engine.
      */
      var dyeW = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodHairDye;
      var dLine = '';
      try { dLine = (dyeW && dyeW.pressed) ? dyeW.pressed(casterRefrId, kwW) : ''; } catch (eDye) {
        log('the hair dye at', refrId.toString(16), 'threw:', eDye);
      }
      if (dLine) { notify(casterRefrId, dLine); say(casterRefrId, dLine); }
      var wLine = needsW.activatedWater(casterRefrId, refDescW, baseDesc, kwW);
      if (wLine) { notify(casterRefrId, wLine); say(casterRefrId, wLine); }
    }
  } catch (eWater) {
    // Logged and passed on, the way farmActivate does: a fault in the water
    // must not skip the bench gate below and let a refused bench open.
    log('the water at', refrId.toString(16), 'threw:', eWater);
  }

  // The placed hive is the farmer's. hive() answers it: one Honeycomb,
  // ten minutes, one piece of work, no rank gate. A gatherer is told it
  // is farm work, and the engine does not hand the comb over.
  /*
    A CRAFTING BENCH THAT IS NOT THEIRS, REFUSED BEFORE ANYTHING ELSE LOOKS AT
    IT. See benchGate. It answers null for anybody who may open it, and for
    every base that is not a bench at all, so this costs one hash lookup on
    every other press in the world.

    It is in front of the chain rather than inside it because a refusal is the
    whole of what it does: there is no yield and no cooldown, the person is told
    why, and the press ends. A bench somebody MAY use is not answered here at
    all, so it goes on to the engine and the crafting menu opens the way it
    always has.

    Our own kiln is a bench like the rest (#2337): a woodwright is allowed the
    kiln's novice rows by the sister half rule, so the gate lets them through,
    the menu opens, and mp.onCraft grades each row they make.
  */
  const shut = benchGate(casterRefrId, baseDesc);
  if (shut) {
    notify(casterRefrId, shut);
    say(casterRefrId, shut);
    return false;
  }

  /*
    THE DOOR THEY JUST OPENED, WRITTEN DOWN, AND THE PRESS CARRIES ON.

    This answers nothing and refuses nothing. It is how /claim knows which
    building somebody means without a proximity search, and it is how a claim
    stays alive, because opening your own front door is what 'entering the
    house' means and a claim lapses when nobody does.

    It is keyed by the REFERENCE rather than the base, because two doors with
    the same base lead to two different places, so it needs the descriptor of
    this door and not of doors like it. A door the table does not know is passed
    over inside touched().
  */
  const prop = globalThis.__thornswoodProperty;
  if (prop && prop.touched) {
    try {
      const doorDesc = mp.getDescFromId(refrId);
      if (doorDesc) {
        prop.touched(casterRefrId, doorDesc);
        /*
          THE SECOND HALF OF A LOCK, and the half that is not trusting anybody.

          The first half is on the client: the server writes which doors are shut
          to this person and a script on their machine locks them, which is what
          makes Skyrim's own lockpicking game appear. That is the half that is
          meant to run.

          Measured in the fork on 21 September, in activationService.ts: a press
          on a LOCKED reference is never announced to the server. So if this line
          is reached at all for a door somebody may not pass, the door was NOT
          locked on their client, which means the script did not run. A plugin
          that failed to load is one reason and a client somebody has changed is
          the other, and this cannot tell them apart and does not need to.

          So the honest client gets a lock it can pick and the dishonest one gets
          a door that does not open.

          A WAY OUT IS NEVER REFUSED, because a lock keeps people out and never
          shuts them in. Somebody pressing the inside half of a front door, or
          the door up out of a cellar, is already in. See WAY_OUT.
        */
        /*
          A CELL A GUARD LOCKED (#502), refused the same way: the cell is
          locked in this person's game unless the client half did not run.
          A cell door is a way out of the jail building, so the building's
          check below never looks at it.
        */
        if (prop.jailHoldOf && prop.jailHoldOf(doorDesc)) {
          let cpid = 0;
          try { cpid = Number(mp.get(casterRefrId, 'profileId')) || 0; } catch (e) { cpid = 0; }
          if (!prop.mayPassCell(casterRefrId, cpid, doorDesc)) {
            const no = 'The cell is locked, and only a guard of this hold opens it.';
            notify(casterRefrId, no);
            say(casterRefrId, no);
            log(casterRefrId.toString(16), 'was refused a locked cell door', doorDesc,
                '(the client lock did not run)');
            return false;
          }
        }
        const shutTo = prop.buildingOf(doorDesc);
        if (shutTo && prop.mayPass && !(prop.wayOut && prop.wayOut(doorDesc))) {
          let pid = 0;
          try { pid = Number(mp.get(casterRefrId, 'profileId')) || 0; } catch (e) { pid = 0; }
          if (!prop.mayPass(casterRefrId, pid, shutTo)) {
            const no = prop.nameOf(shutTo) + ' is locked and you have no key.';
            notify(casterRefrId, no);
            say(casterRefrId, no);
            log(casterRefrId.toString(16), 'was refused a locked door into',
                prop.nameOf(shutTo), '(the client lock did not run)');
            return false;
          }
        }
      }
    } catch (e) {
      // No descriptor for this reference. Nothing about property can be said,
      // and nothing about the press changes.
    }
  }
  /*
    THE DOOR THEY CAME IN BY (#1909), written on the character after the lock
    above, so a door that refused them is not one they came in by. Only for a
    person: a profileId is what tells one from the rest of Skyrim. It answers
    nothing and refuses nothing, and a press it cannot read leaves the record
    as it was, which the death code then says it had.
  */
  try {
    if (Number(mp.get(casterRefrId, 'profileId')) > 0) {
      noteCameIn(casterRefrId, mp.getDescFromId(refrId));
    }
  } catch (e) {
    log('came in: the press by', casterRefrId.toString(16), 'was not written:', e);
  }
  /*
    NOTHING IS SPAWNED IN THE WORLD. See the spoils block.

    Before every branch below it, because a container is emptied on the press
    that opens it, before anything else gets a chance to answer for it. It
    refuses nothing: nothing a plugin placed lies on the floor any more
    (#3077). It does nothing at all for the other million presses in the
    world, which is why it is one lookup and a memo.
  */
  const spoils = globalThis.__thornswoodSpoils;
  if (spoils && spoils.activate) {
    try {
      spoils.activate(casterRefrId, refrId, baseDesc);
    } catch (e) {
      log('the spoils rule threw, so the press goes on:', e);
    }
  }

  const quests = globalThis.__thornswoodQuests;
  if (quests && quests.onActivate) {
    try {
      const questLine = quests.onActivate(casterRefrId, refrId, baseDesc);
      if (questLine) {
        notify(casterRefrId, questLine);
        say(casterRefrId, questLine);
        return false;
      }
    } catch (e) {
      log('the quest press threw, so the press goes on:', e);
    }
  }

  /*
    THE DULL CLOCK (#1384). See the durability block. A container in a held
    building loses what its days have taken before the engine sends what is
    in it. It refuses nothing. A dropped piece keeps its condition in the
    engine now (MpActor::DropItem, #1719), so a pickup needs nothing here.
  */
  const wear = globalThis.__thornswoodDurability;
  if (wear && wear.pressed) {
    try { wear.pressed(casterRefrId, refrId, baseDesc); } catch (e) {
      log('the durability press threw, so the press goes on:', e);
    }
  }

  /*
    THE CHEST'S FOOD CLOCK (#3163). See the spoilage block. Every container,
    held or not, takes the days its food has spent in it before the engine
    sends what is in it, and the opener is told what went off. It refuses
    nothing.
  */
  const rot = globalThis.__thornswoodSpoilage;
  if (rot && rot.pressed) {
    try { rot.pressed(casterRefrId, refrId, baseDesc, Date.now()); } catch (e) {
      log('the spoilage press threw, so the press goes on:', e);
    }
  }

  if (prop && prop.touchedBench) {
    // Which bench they just pressed, for /key. Costs one hash lookup and is
    // passed over inside touchedBench for anything that is not a bench.
    try { prop.touchedBench(casterRefrId, baseDesc, refrId); } catch (e) { }
  }

  /*
    WHICH BED THEY JUST PRESSED, for /rest bed (#1392). The bed is the one the
    engine handed over here, never the word somebody types. One remembered
    lookup per base, and nothing is written for a press on anything that is
    not a bed. The press goes on, so the engine still lays them down.
  */
  const beds = globalThis.__thornswoodBeds;
  if (beds && beds.touched) {
    try { beds.touched(casterRefrId, refrId, baseDesc); } catch (e) { }
  }

  let message = null;
  if (baseDesc === STATIONS.saltQuarry) message = mineSalt(casterRefrId, refrId);
  // The four chopping blocks. Before the STATIONS branches would not matter,
  // because these are not ours, but before the FURN fallthrough further down
  // very much does: a chopping block is a FURN, and a FURN that reaches
  // ProcessActivateNormal sits the person down on it.
  else if (isChoppingBlock(baseDesc)) message = chopWood(casterRefrId, refrId);
  else if (SHRINES[baseDesc]) message = bless(casterRefrId, baseDesc);
  // A crop always falls through to the return false at the bottom, whatever
  // farmActivate answered. ProcessActivateNormal in the engine reads the produce
  // straight out of the FLOR or TREE record and hands it over, and it is only
  // an explicit false from here that stops it. Anything that reached this line
  // and left without a false would be the free pick back.
  //
  // IT IS ASKED BEFORE THE PLANTS, AND THE ORDER IS LOAD BEARING. Measured on
  // 20 September: all fifteen crop bases are rows in the generated harvests
  // table as well, because both passes read the same FLOR and TREE records. A
  // plants-first order would answer every cabbage plot in Skyrim as a plant to
  // be picked, and the farming block would never be reached at all. harvest()
  // refuses a crop on its own account too, so neither half of that depends on
  // this line staying where it is.
  else if (isCrop(baseDesc)) message = farmActivate(casterRefrId, refrId, baseDesc);
  // Water produce before the plants, and it would work either way. Every one of
  // the fifteen fish bases is still a row in the plant table that is installed
  // today, because both passes read the same FLOR records and the fish pass has
  // not been run against this build yet, so a plants-first order would answer a
  // salmon as a flower for a gatherer. plantAt() refuses a fish base on its own
  // account as well, so neither half of that depends on this line staying where
  // it is. Same arrangement as the crops two lines up, same reason.
  else if (isFish(baseDesc)) message = fish(casterRefrId, refrId, baseDesc);
  // Hanging game before the plants, for the same reason. All seven bases were
  // rows in the plant table until the food rule of 21 September took them out,
  // so on a gamemode built before that ran a plants-first order would answer a
  // meat rack as a flower for a gatherer. plantAt() refuses a game base on its
  // own account as well, so neither half of that depends on this line staying
  // where it is.
  //
  // IT IS ABOVE loot() RATHER THAN INSIDE IT, and that is not a matter of
  // taste. loot() reads the reference itself and refuses anything the engine
  // does not call a dead MpActor; these seven are FLOR records that were never
  // actors, so loot() answers null for every one of them and the press would
  // fall out of this function untouched, with the engine handing the pheasant
  // to whoever pressed it.
  else if (isGame(baseDesc)) message = game(casterRefrId, refrId, baseDesc);
  // The chicken nest, which is the farmer's (#628). The harvest table leaves it
  // out (FARMYARD_BY_EDITOR_ID in Build-HarvestTable.ps1), so it is in no plant
  // table and the order against the plants does not matter; it sits with the
  // churn, the other farmyard work.
  else if (isChickenNest(baseDesc)) message = collectEgg(casterRefrId, refrId, baseDesc);
  // The butter churn, which is the farmer's. It is in no plant table, so the
  // order against the plants does not matter today; it sits with the other
  // food the food rule moved off the gatherer.
  else if (isChurn(baseDesc)) message = churn(casterRefrId, refrId, baseDesc);
  else if (isHive(baseDesc)) message = hive(casterRefrId, refrId, baseDesc);
  else if (isPlant(baseDesc)) message = harvest(casterRefrId, refrId, baseDesc);
  else if (isVein(baseDesc)) message = mineOre(casterRefrId, refrId, baseDesc);
  // A plant or a tree none of the tables above named: its owner by name, or
  // nobody's (#3141). Never the engine's free pick for whoever pressed it.
  else if (isWorldProduce(baseDesc)) message = worldProduce(casterRefrId, refrId, baseDesc);
  else {
    /*
      A BODY IS LAST, AND IT IS THE ONLY BRANCH THAT IS NOT A TABLE LOOKUP.

      Every branch above is a lookup on a string this function already has, and
      costs nothing. This one reads the reference itself twice, over the wire
      bindings, and one of those reads throws for anything that is not an actor,
      so it is the only branch that can be expensive or dangerous. Last means a
      press on anything that already has a home never pays for it.

      The order is free of correctness either way, and that is worth writing
      down rather than leaving somebody to work out. A body's base is an NPC_
      record; every table above is built out of FLOR, TREE and ACTI records and
      the three station bases. No base can be in both, so loot() cannot take a
      press off a branch above it and no branch above it can take one off loot().

      AND THIS BRANCH MUST NOT RETURN FALSE WHEN IT ANSWERS NOTHING. Every other
      branch ends at the return false below, which is right for them: they were
      reached because a table claimed the base, and blocking the engine's own
      handover is the point. loot() is reached by every press this file has no
      answer for at all, a door, a chest, a living animal, a dead bandit, so a
      null out of it has to leave exactly the way a press did before any of this
      existed. It returns undefined and the default goes ahead.
    */
    // Living cows for a farmer, before loot(). milk() returns null for
    // everybody else and for a dead cow, so loot() and the fall through stay
    // exactly as they were for those presses.
    /*
      E ON A GUILD TRADER OPENS THE PANEL. /merchant with the id still works.
      A press on anything else falls through, the same as before.
    */
    const merchants = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodMerchantTrade;
    if (merchants && merchants.activate) {
      let opened = null;
      try { opened = merchants.activate(casterRefrId, refrId); } catch (eOpen) { opened = null; }
      if (opened) {
        if (opened.view && merchants.push) merchants.push(casterRefrId, opened.view);
        if (opened.text) {
          notify(casterRefrId, opened.text);
          say(casterRefrId, opened.text);
        }
        return false;
      }
    }

    const milked = milk(casterRefrId, refrId, baseDesc);
    if (milked !== null) {
      message = milked;
    } else {
      const off = loot(casterRefrId, refrId, baseDesc);
      if (off === null) {
        let searched = null;
        try {
          const bodyLoot = globalThis.__thornswoodDungeonLoot;
          if (bodyLoot && bodyLoot.onBody) searched = bodyLoot.onBody(casterRefrId, refrId);
        } catch (eBody) { searched = null; }
        if (!searched) return;
        message = searched;
      } else {
        message = off;
      }
    }
  }

  /*
    A branch that answered ALLOW has already done its work and wants the press
    to go on. Nothing is said and nothing is blocked, so Skyrim runs the
    animation it would have run if this file did not exist.
  */
  if (message === ALLOW) { return; }

  if (message) {
    notify(casterRefrId, message);
    say(casterRefrId, message);
  }
  return false;
});

/*
  AN ALLOWED PRESS ON A PLANT IS SHOWN PICKED ON THE PRESSER'S MACHINE (#3080).
  See PICKED_PROPERTY for why the server does it now and not their Skyrim.

  Around the handler rather than inside every branch, because the branches
  that hand produce over are many (plants, fish, hanging game, nests, hives,
  crops, the quests' orchard and scarce water) and each has its own sentence.
  The pack says whether this press gave something, so no sentence is read.

  A churn is left as it is. It is worked, not emptied: the server holds it
  full, and its wait is the farmer's own (churn, cooldownLeft).
*/
function showsPick(refrId) {
  let baseDesc = '';
  try { baseDesc = mp.get(refrId, 'baseDesc'); } catch (e) { return false; }
  if (!baseDesc || isChurn(baseDesc)) { return false; }
  const spoils = globalThis.__thornswoodSpoils;
  if (!spoils || !spoils.kindOf) { return false; }
  let kind = '';
  try { kind = spoils.kindOf(idOf(baseDesc)); } catch (e) { return false; }
  return kind === 'FLOR' || kind === 'TREE';
}

(function answerFlora() {
  const answer = mp.onActivate;
  mp.onActivate = function (refrId, casterRefrId) {
    const before = (refrId && casterRefrId && showsPick(refrId)) ? packCounts(casterRefrId) : null;
    const result = answer(refrId, casterRefrId);
    if (before && packGrew(before, packCounts(casterRefrId))) { showPicked(casterRefrId, refrId); }
    return result;
  };
})();

/*
  The bases this server answers for, published where the client can read them.

  thornswood-front.js re-activates every ACTI it sees, because a handful of
  vanilla handle and lever scripts never start under SkyMP. The client forwards
  that second activation as well, so onActivate below ran twice for every press
  on anything the server already handles: a quarry strike and then "the seam
  needs 20 more seconds", a blessing removed and re-added.

  The client cannot know which bases those are without being told, so it is
  told. This goes into the same folder the client already fetches online.json
  and the manifest from, as runtime form ids, which is exactly what the
  client's getBaseObject().getFormID() hands back.
*/
(function publishServerBases() {
  var ids = [];
  var seen = {};
  function add(desc) {
    var id = idOf(desc);
    // 0 means the plugin that owns it is not loaded, which is a different
    // problem and not one this list should carry. Deduped because two keys
    // resolving to one record would otherwise be sent twice.
    if (id && !seen[id]) { seen[id] = true; ids.push(id); }
  }
  try {
    add(STATIONS.saltQuarry);
    for (var shrine in SHRINES) { add(shrine); }
    for (var handPlant in HARVESTS) { add(handPlant); }
    // Every farm crop as well. A crop base missing from this list is pressed
    // twice for every press: once by the person and once by the client
    // re-activating it, so the first press brings the crop in and the second
    // is told the plot is empty a tick later.
    for (var cropBase in CROPS) { add(cropBase); }
    // And every base the two generated tables answer for, which is the 181
    // plants and the 581 seams. This is the same defect as the crops one
    // above and it is worth saying again in the shape it takes here: the
    // second press lands inside the cooldown, so a gatherer who picks a
    // deathbell is told a tick later that it has already been picked, and a
    // miner who works an iron vein is told the seam needs 20 more seconds.
    // The yield is right and the sentence on the screen is the wrong one,
    // which is the hardest kind of fault to be shown a bug report for.
    for (var plantBase in HARVESTS_BY_BASE) { add(plantBase); }
    for (var unrankedPlant in GATHER_UNRANKED) { add(unrankedPlant); }
    for (var veinBase in ORES_BY_BASE) { add(veinBase); }
    // And the water produce, which is on this list today only because every one
    // of those fifteen bases is still a row in the plant table above. The next
    // run of the harvests script takes them out of that table, and this line is
    // what keeps them on the list once it has: the server answers for them
    // either way, so the client must not activate them a second time.
    for (var fishBase in FISH_BY_BASE) { add(fishBase); }
    /*
      A BODY IS NOT ON THIS LIST, AND THAT IS THE ANSWER RATHER THAN AN
      OVERSIGHT.

      This list exists for one defect: thornswood-front.js re-activates things
      whose vanilla script never starts under SkyMP, the client forwards that
      second activation, and the server answers the same press twice. Read the
      client on 20 September: that handler gives up at 'if (type !== 24)
      return', and 24 is kActivator. An animal's base record is an NPC_, which
      is form type 43, so the client never re-activates a body and there is no
      second press to suppress.

      Putting the hunt bases on here anyway would cost something real. The seed
      is nine animals and the built table will be every animal in the load
      order, and every id on this list is sent to every client, to stop a
      re-activation that cannot happen. So the bodies stay off it. If the client
      ever starts re-activating actors, this is the line that has to change, and
      the symptom will be the one the plants and the seams already showed: the
      yield is right and the sentence on the screen says the body has already
      been worked.
    */

    var fsb = require('fs');
    var pathb = require('path');
    var dataDirB = 'data';
    try {
      var cfgB = JSON.parse(fsb.readFileSync('server-settings.json', 'utf8'));
      if (cfgB && cfgB.dataDir) { dataDirB = String(cfgB.dataDir); }
    } catch (e) { }
    // Whole, never in place (#2740): the port may be handing it to a client
    // that is loading at that moment, a hot reload included.
    mp.writeFileWhole(pathb.join(dataDirB, 'server-bases.json'),
                      JSON.stringify({ at: Date.now(), bases: ids }));
    log('published', ids.length, 'server handled bases for the client');
  } catch (e) {
    log('could not publish the server handled bases, the client will keep ' +
        're-activating them:', e);
  }
})();

