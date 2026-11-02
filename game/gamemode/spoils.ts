// ==== thornswood spoils ====
/*
  NOTHING IS SPAWNED IN THE WORLD: NO WEAPONS, NO ARMOUR, NO TOOLS, NO GOLD.

  Patrick, 21 September: "all weapons, armour, tools, and gold are not spawned in
  the world at all. Not on the ground, not in containers, or display cases, not
  anywhere in the world unless made by someone or from the starter ones for
  Farmer, Miner, and Woodworker".

  This is the economy having a bottom. It is the reason anybody would buy a thing
  a person made, and it is the other end of what entry 26 asks for.

  WHAT MAKES IT AFFORDABLE, measured on 21 September: the server can ask the
  engine what any form is. mp.lookupEspmRecordById is bound in ScampServer.cpp
  and returns the record's id, editor id, type and fields, so a container's
  contents are classified at runtime and NOTHING has to be generated. That was
  the thing that would have made this too expensive: a table of every weapon and
  every piece of armour in 101 plugins, in a gamemode that is already 1.4MB. The
  answers are memoed, so a form is looked up once for the life of the process.

  A CONTAINER HOLDS NOTHING THE WORLD PUT THERE, and nothing in here takes it
  out (#3078). Patrick, 21 October 2026: "not fill them with anything vanilla
  only our special ones for the caves with our items and refill times, and dont
  fill any storages that shouldnt be filled". The engine copied a container's
  plugin contents in on the first press (MpObjectReference::
  EnsureBaseContainerAdded), after this block's hook had run, so this block
  used to take part of it back out with a timer. Now the server settings name
  CONT in forbiddenBaseContainer (scripts\deploy\Deploy-Gamemode.ps1, and
  Deploy-DevGamemode.ps1 for dev) and the engine never puts a record's contents
  in. Every chest, barrel, sack and cupboard starts empty and holds only what a
  person put in it, or the pile the dungeon loot block pays a dungeon chest.

  THE FLOOR IS NOT IN HERE AT ALL (#3077). Patrick, 21 October 2026: "don't
  spawn floor items anymore at all no matter what they are". Every item and
  coin purse a plugin placed is switched off in Thornswood-Last.esp
  (scripts/mods/Build-LastPlugin.py, step 5), so no machine draws it and the
  server never makes it, and there is nothing on the floor to refuse. What a
  person drops is made at runtime, in no plugin, and picks up as it always did.

  WHAT IS DELIBERATELY NOT HERE. A body cannot be opened by anybody at all,
  which gamemode.js has written out at length above, so nothing has to be done
  about death loot. And the starter tools are handed over by the server rather
  than found, so the exception Patrick named needs no code: there is nothing in
  the world for it to be an exception to.
*/
(function () {
  'use strict';
  var g = globalThis;
  function slog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[spoils]');
    console.log(a.join(' '));
  }

  /* Gold001. The one form id in this file that is not a descriptor, because it
     is the same number in every load order there has ever been. */
  var GOLD = 0x0000000F;

  function ready() {
    try {
      mp.makeProperty(PURSE_PROPERTY, {
        isVisibleByOwner: false, isVisibleByNeighbors: false,
        updateOwner: '', updateNeighbor: ''
      });
    } catch (e) { }
  }

  /*
    What kind of record a base is, asked once per form and then remembered.

    An answer of '' is 'the engine could not say', and every caller treats that
    as 'leave it alone'. Not knowing what a thing is has to mean not touching it:
    the other way round, one unreadable record would quietly refuse every one
    of it in the world.
  */
  var kinds = {};
  function kindOf(baseId) {
    if (!baseId) { return ''; }
    if (Object.prototype.hasOwnProperty.call(kinds, baseId)) { return kinds[baseId]; }
    var kind = '';
    try {
      var res = mp.lookupEspmRecordById(baseId);
      if (res && res.record && res.record.type) { kind = String(res.record.type); }
    } catch (e) {
      kind = '';
    }
    kinds[baseId] = kind;
    return kind;
  }

  /*
    The three tools, by every form the world hands them out as.

    TOOLS in the outer file already lists them, accept lists and all, because the
    tool gate had to know that Skyrim has two shovels and six pickaxes. This is
    the same six and the same two, read off that table rather than written down
    again, so a tool added there is known here without anybody remembering to
    do both.
  */
  var toolIds = null;
  function isTool(baseId) {
    if (!toolIds) {
      toolIds = {};
      for (var key in TOOLS) {
        if (!Object.prototype.hasOwnProperty.call(TOOLS, key)) { continue; }
        var accept = TOOLS[key].accept || [];
        for (var i = 0; i < accept.length; i++) {
          var id = idOf(accept[i]);
          if (id) { toolIds[id] = true; }
        }
      }
    }
    return Object.prototype.hasOwnProperty.call(toolIds, baseId);
  }

  /*
    A press. It refuses nothing and always answers null. A container opens
    as it always did, empty of anything the world put there (the block
    comment), and a dungeon chest pays its pile. Anything else is left to the
    engine: nothing a plugin placed lies on the floor any more (#3077, the
    block comment), and a thing a person dropped is theirs to pick up.
  */
  function activate(actorId, refrId, baseDesc) {
    var baseId = idOf(baseDesc);
    if (!baseId) { return null; }
    if (kindOf(baseId) === 'CONT') {
      try {
        var dungeonLoot = g.__thornswoodDungeonLoot;
        if (dungeonLoot && dungeonLoot.onChest) { dungeonLoot.onChest(actorId, refrId); }
      } catch (eLoot) {
        slog('dungeon loot threw:', eLoot);
      }
    }
    return null;
  }

  // ------------------------------------------------- where gold comes from --
  /*
    FORTY GOLD, ONCE, TO EVERY CHARACTER.

    Patrick, 21 September: "everyone starts with 40 gold, and we can add a job
    for gold later but that's just to start."

    This is the other half of the rule above and it belongs beside it. Taking
    every coin out of the world closes the economy at the bottom, and a closed
    economy with no way in is not an economy: nobody could buy the first thing
    anybody made. So the world stops handing coin out and the server starts, and
    both of those facts live in one block so that neither can be changed without
    the other being read.

    IT IS A FLOOR AND NOT AN INCOME. Forty gold buys a meal and a bed and not
    much else, which is the point: it is enough to trade with on the first
    evening and not enough to live on, so the job Patrick means to add later is
    still the thing that pays.

    ONCE PER CHARACTER, EVER, and the mark is on the character rather than in a
    file. Somebody who logs in twice is not somebody who starts twice, and the
    purse would otherwise be an income of forty gold a session, which is exactly
    the tap this whole block exists to close.

    IT REACHES CHARACTERS THAT ALREADY EXIST, deliberately. Every character on
    this server picked their class before any of this was written, and the
    world they are standing in no longer has a coin in it. A starting purse that
    only new characters got would leave everybody already here with no money and
    no way to get any. The tool handout had the same reasoning until tools
    became a smith's (#1038).
  */
  var PURSE = 40;
  var PURSE_PROPERTY = 'thornswoodPurse';

  function purse(actorId) {
    try {
      if (mp.get(actorId, PURSE_PROPERTY)) { return false; }
    } catch (e) {
      // Cannot tell whether they have had it, so do not hand it over. Saying no
      // costs somebody forty gold once; saying yes hands it out every tick.
      return false;
    }
    var goldId = GOLD;
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    var found = false;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].baseId === goldId) {
        entries[i].count += PURSE;
        found = true;
        break;
      }
    }
    if (!found) { entries.push({ baseId: goldId, count: PURSE }); }
    try {
      mp.set(actorId, 'inventory', { entries: entries });
    } catch (e) {
      return false;
    }
    try {
      mp.set(actorId, PURSE_PROPERTY, Date.now());
    } catch (e) {
      // The coin is in the pack and the mark is not written, so this runs again
      // next tick and hands over another forty. That is the one direction that
      // is not harmless, so it is said out loud rather than swallowed.
      slog('handed', actorId.toString(16), 'their purse and could not mark it:', e);
    }
    slog(actorId.toString(16), 'was handed a starting purse of', PURSE);
    return true;
  }

  ready();
  g.__thornswoodSpoils = {
    purse: purse, PURSE: PURSE, PURSE_PROPERTY: PURSE_PROPERTY,
    activate: activate, kindOf: kindOf, isTool: isTool, GOLD: GOLD
  };
  slog('ready');
})();
// ==== end thornswood spoils ====
