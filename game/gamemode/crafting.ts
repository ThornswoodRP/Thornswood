// ---------------------------------------------------------------------------
// crafting
//
// classes.md: 'Pick one, then pick one side of it. The side is not a flavour,
// it is what you are able to make at all.' Until now a profession placed two
// points in the skill tree and gated the charcoal kiln, and that was the whole
// of it: an Edgewright could beat out a Daedric cuirass, a warrior could cook,
// and the sentence on the public page was a description of nothing.
//
// THE HOOK. skymp5-server/cpp/server_guest_lib/CraftService.cpp builds a
// CraftEvent named 'onCraft' with (actorFormId, craftedItemBaseId, count,
// recipeId) and fires it. GameModeEvent::Fire returns false when any listener
// answered false, and CraftEvent::OnFireSuccess, which is the thing that takes
// the inputs out of the pack and puts the output in, only runs when Fire
// succeeded. So returning false here refuses the craft outright and the person
// keeps their materials. Read in the fork on 20 September.
//
// TEMPERING NEVER REACHES THIS FILE. CraftService::RecipeItemsMatch throws out
// the armour table (keyword adb78) and the sharpening wheel (88108) before it
// looks at any recipe at all, so a third of every COBJ record in the load order
// never fires the event. Those rows carry "fires": false in tools\recipes.json
// and are not in the table below. Nothing here can gate tempering, and the
// Smith's Mastercraft perk on the public page is about tempering, so that perk
// is not enforced by this gate and cannot be. A temper does reach the server
// now, with no recipe, and recipelessCraft refuses it (#1384): repair is a
// kit, and Mastercraft is the 120% repair (docs/systems/durability.md).
// ---------------------------------------------------------------------------

/*
  EVERY CRAFTING RECIPE THE SERVER IS ACTUALLY ASKED ABOUT, AND IT IS GENERATED.

  Everything between the declaration below and the line that closes the block is
  written by tools\Build-RecipeTable.ps1, out of the COBJ records across 101
  plugins that also built tools\recipes.json. DO NOT HAND EDIT IT. The next run
  of that script replaces every line between them and a correction made here
  goes with it, leaving no trace it was ever made. Same arrangement as
  ORES_BY_BASE, HUNTS_BY_BASE and SPELL_IDS, for the same reason.

  It is seeded with fourteen real rows read out of tools\recipes.json, one per
  half per rank the gate has to tell apart, so the gate works and can be
  measured before the script has ever been run against this build. Everything a
  seeded row says is what the json says.

  WHAT EACH FIELD OF A ROW MEANS IS WRITTEN BY THAT SCRIPT AND NOT HERE. It
  used to be a list in this paragraph, and on 21 September that list was found
  still describing rank as the price of what a recipe makes, a day after the
  rule had changed to what the recipe's inputs cost and had moved 344 of the
  1728 rows. The comment was the only statement in the repository of what the
  field this gate reads means, it shipped to the server in this file, and
  nothing could ever have caught it, because the install only replaced the rows
  underneath. So the field list lives in the script, beside the rules, and the
  run that changes a rule changes the sentence describing it in the same pass.

  THE KEY IS A DESCRIPTOR AND THE EVENT HANDS YOU A NUMBER. All four arguments
  of onCraft are numbers and every key in here is a string like "f61:Skyrim.esm",
  so the lookup goes through mp.getDescFromId and never through recipeId itself.
  A lookup without it is undefined on every row in this block, on every craft,
  which is a gate that refuses nothing and says nothing while it does it. A
  reviewer caught that before anything was built on it and it is the one thing
  about this table worth saying twice.

  FIVE OF THE FOURTEEN HALVES OWN NOTHING HERE AND IT IS NOT AN OVERSIGHT.
  Warrior/Bulwark and Warrior/Berserker: warriors do not craft, and classes.md
  gives them ways of fighting rather than recipes. Alchemist/Blightbrewer and
  Alchemist/Physicker: Skyrim has no alchemy recipes at all, not one COBJ record
  in the load order names an alchemy bench, because a potion is worked out from
  the effects the ingredients share inside the alchemy menu and no record is
  involved at any point. Enchanter/Wardweaver: enchanting is the same shape, a
  menu and not a recipe. Those five gate nothing and this gate cannot make them
  gate anything.

  A RECIPE ID THIS TABLE DOES NOT CARRY IS ONE NOBODY OWNS, AND ANYBODY MAY MAKE
  IT, except the one dwarven smelt craftRow keeps. Smelting an ingot and tanning
  a hide into leather are in this table, one row each, and they do not fall
  through. The duplicate ingot rows are in here too, marked so nobody makes them.
*/
  /* Written by scripts\dev\Build-RecipeTable.ps1 out of the game's own records into
     game\gamemode-tables\RECIPES_BY_ID.json (#5191). Recipe desc -> what it makes and who
     may make it. What each field of a row means is written in that script beside the rule
     that sets it; its -JsOut writes that comment out with the table. */
  var RECIPES_BY_ID = table('RECIPES_BY_ID');

  /* Written by scripts\dev\Build-ItemNameTable.js out of game\data\recipes.json into its
     table file (#5191). Every recipe output and every ingredient, owned or not. A name that
     belongs to more than one record went to the earliest plugin (Skyrim.esm, Update.esm,
     Dawnguard.esm, HearthFires.esm, Dragonborn.esm, then by name).
     Lower-case name -> [name as written, record]. /give reads it through buildThings. */
  var ITEM_NAMES = table('ITEM_NAMES');

  /* Written by scripts\dev\Build-AdminNameTables.py out of the plugins in the load order into
     their table files (#5191). Item names and actor names, for /give and /spawn, which
     read them after their own tables. Lower-case name -> [name as written, record]. */
  var ADMIN_ITEMS = table('ADMIN_ITEMS');
  var ADMIN_ACTORS = table('ADMIN_ACTORS');

/**
 * True when the table above carries this recipe. Never a bare lookup, for the
 * reason isVein was written: the key is a descriptor off the wire, and
 * '__proto__' finds something on Object.prototype that a truth test cannot tell
 * from a recipe row.
 */
/*
  The one dwarven smelt #613 kept out of the owned bucket so the five
  duplicate scrap rows could be cut. It is still a smelt. Novice
  Platewright work, the same rank the other ingot rows ask, so both smith
  halves can do it and nobody else can. It is not a second public recipe.
*/
const KEPT_SMELT = {
  "10dd28:Skyrim.esm": {"out":"db8a2:Skyrim.esm","name":"Dwarven Metal Ingot","type":"MISC","makes":1,"owner":"Smith","half":"Platewright","race":"","rank":"novice","family":"Ingots","open":true}
};

function craftRow(recipeDesc) {
  if (Object.prototype.hasOwnProperty.call(RECIPES_BY_ID, recipeDesc)) {
    return RECIPES_BY_ID[recipeDesc];
  }
  if (Object.prototype.hasOwnProperty.call(KEPT_SMELT, recipeDesc)) {
    return KEPT_SMELT[recipeDesc];
  }
  return null;
}

function isRecipe(recipeDesc) {
  const row = craftRow(recipeDesc);
  return !!row && typeof row === 'object';
}

/*
  NO PROFESSION, NOTHING MADE. Patrick, 29 September, closing issue #1037:
  "There should be no grace at all they shouldn't be allowed to just make
  anything because they didn't choose a profession."

  Until then a character with no profession was let through every craft and
  every held bench, which was called a first-evening allowance and never
  ended: picking a profession only took things away. So the recipe gate
  (craftAnswer), the bench gate (benchGate) and the brew and enchant gate
  (recipelessCraft) all refuse somebody with no profession, with this one
  sentence, because the answer is the same key wherever they are standing.

  WHAT IS STILL NOBODY'S WORK is a recipe no half owns. Smelting an ingot
  and tanning a hide into leather are not in that set: the staying row has
  a half and a rank, and craftAnswer refuses anyone who cannot work it. No
  bench opens for everybody (#3080): benchGate opens one for somebody
  craftAnswer allows at least one of its rows, and what nobody owns there is
  made by whoever that is.
*/
const NO_PROFESSION_AT_A_BENCH = 'You have not chosen a profession yet, so there is nothing you can make here. Press K and choose one.';

/**
 * What the rulebook calls a profession, or the word itself when the rules do
 * not know it. The rules block owns these names; nothing here spells one out.
 */
function professionName(prof) {
  const P = globalThis.__thornswoodProgression;
  if (P && P.has(P.TABLE.professions, prof)) { return P.TABLE.professions[prof].name; }
  return String(prof || '');
}

/**
 * A name with the article that belongs in front of it: 'a Smith', 'an
 * Alchemist'. Two of the eight professions start with a vowel and both of them
 * would have read 'you are a Alchemist' otherwise, which is the kind of sentence
 * that tells a person nobody read the thing before it shipped. rankWord above
 * does the same job for a rank and capitalises as it goes; this one leaves the
 * word exactly as the rulebook spells it.
 */
function aWord(name) {
  const n = String(name || '');
  return (/^[AEIOUaeiou]/.test(n) ? 'an ' : 'a ') + n;
}

/**
 * Whether this person may make what this row makes, and what to say when not.
 *
 * Returns { refusal, note, credit }: refusal is the sentence that stops the
 * craft, note is a sentence said while letting it through, and credit is the
 * key the work counts under once it has gone through.
 *
 * THE ORDER OF THE CHECKS IS THE FEATURE. Every branch that cannot answer
 * ALLOWS, because a gate that cannot tell whose work this is must not be the
 * reason somebody loses their materials at a forge.
 */
