// ==== thornswood alchemy ====
/*
  ALCHEMY LIKE OBLIVION (#3134). docs/systems/mixtures.md and
  docs/systems/professions/alchemist.md.

  Patrick, 22 Oct: mixing different ingredients makes different things; once
  you have made something, your character remembers that recipe at any
  alchemy table (docs/DECIDED.md); and to brew with a plant or a like
  ingredient, you must have eaten it first.

  MIXING IS THE ENGINE'S ALREADY. A brew is the effects two or more of its
  ingredients share, worked out by the server from the inputs it takes
  (CraftService::BrewEffects, fork #60), and the mixtures list in
  recipelessCraft holds them to the page. Nothing here changes what a mix
  makes.

  WHAT THE CHARACTER FORGOT. Skyrim keeps which effects of an ingredient are
  known on the save, and every spawn here starts from a throwaway save, so
  the alchemy menu forgot every effect at every login: what you had tasted
  and what you had brewed was gone, at every lab. That is the cause, and this
  block keeps the record on the character, on the server, instead:

    eaten    every ingredient (an INGR record) this character has eaten, by
             desc, heard from mp.onEatItem, which the engine raises only once
             it has checked the pack holds it and is taking it out. Never the
             client's /ate line, which anybody could send.
    known    each ingredient's effects this character knows, as a mask of the
             record's effect slots, the way the game numbers them: eating
             teaches the first, the game's own rule, and a brew teaches every
             slot whose effect was in it.
    recipes  every mix this character has brewed: its ingredients, what it
             made, how many times and when.

  At arrival, and whenever it grows, LEARN_PROPERTY hands the owner's game
  every known slot by form id, and its script teaches them to the game with
  Ingredient.LearnEffect, so the menu shows at any lab what the character
  has learned. The form ids are worked out from the descs each time, so a
  load order that moved a plugin is followed.

  YOU MUST HAVE EATEN IT FIRST. brewRefusal names every ingredient in a brew
  this character has never eaten, and recipelessCraft refuses the brew with
  that line before anything is taken, so the ingredients stay in the pack.
  Only a brew is asked: cooking with an ingredient is a recipe at a cooking
  bench, not this.

  The journal page (#3142) reads journal(actorId).
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  var ALCHEMY_PROPERTY = 'thornswoodAlchemy';
  var LEARN_PROPERTY = 'thornswoodAlchemyLearn';
  var SLOTS = 4;   // an ingredient carries four effects

  function alog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[alchemy]');
    console.log(a.join(' '));
  }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function hex(id) { return (Number(id) >>> 0).toString(16); }
  function now() { return Date.now(); }
  function personOf(id) {
    try { return Number(mp.get(id, 'profileId')) > 0; } catch (e) { return false; }
  }
  function descOf(id) {
    try { return String(mp.getDescFromId(Number(id) || 0) || ''); } catch (e) { return ''; }
  }
  function idOfDesc(desc) {
    try { return Number(mp.getIdFromDesc(String(desc))) || 0; } catch (e) { return 0; }
  }
  function tell(actorId, line) {
    try { if (typeof say === 'function') { say(actorId, line); } } catch (e) { }
  }

  // ------------------------------------------------------- the records --
  /*
    An ingredient's effects, in its slot order: the global form id of each
    EFID, as the engine reads them for a brew. null for anything that is not
    an INGR. Memoed by id, because a record never changes under a running
    server.
  */
  var ingredients = {};
  function effectsOf(baseId) {
    var id = Number(baseId) || 0;
    if (!id) { return null; }
    if (own(ingredients, id)) { return ingredients[id]; }
    var res = null;
    try { res = mp.lookupEspmRecordById(id) || null; } catch (e) { res = null; }
    var out = null;
    if (res && res.record && String(res.record.type || '') === 'INGR') {
      out = [];
      var fields = res.record.fields || [];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f || String(f.type) !== 'EFID') { continue; }
        var b = f.data || [];
        var local = b.length >= 4 ? ((b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 0x1000000) : 0;
        var global = local;
        if (typeof res.toGlobalRecordId === 'function') {
          try { global = Number(res.toGlobalRecordId(local)) || 0; } catch (e) { global = 0; }
        }
        out.push(global);
      }
    }
    ingredients[id] = out;
    return out;
  }

  /*
    A name a person reads: the property block's, which the drop box and the
    trade ships use too (Skyrim.esm's own names are in its strings files,
    which the server does not load).
  */
  function nameOf(desc) {
    var prop = g.__thornswoodProperty;
    if (prop && typeof prop.itemName === 'function') {
      try { return String(prop.itemName({ baseId: idOfDesc(desc) })); } catch (e) { }
    }
    return String(desc || 'something');
  }
  function effectName(desc) {
    if (typeof MIXTURES !== 'undefined' && own(MIXTURES, desc)) { return MIXTURES[desc].name; }
    return String(desc);
  }
  function listed(words, joiner) {
    if (words.length < 2) { return words.join(''); }
    return words.slice(0, -1).join(', ') + ' ' + (joiner || 'and') + ' ' + words[words.length - 1];
  }

  // -------------------------------------------------- the character's own --
  function read(actorId) {
    var rec = null;
    try { rec = mp.get(actorId, ALCHEMY_PROPERTY); } catch (e) { rec = null; }
    if (!rec || typeof rec !== 'object') { rec = {}; }
    return {
      eaten: (rec.eaten && typeof rec.eaten === 'object') ? rec.eaten : {},
      known: (rec.known && typeof rec.known === 'object') ? rec.known : {},
      recipes: Array.isArray(rec.recipes) ? rec.recipes : []
    };
  }
  function write(actorId, rec) {
    try { mp.set(actorId, ALCHEMY_PROPERTY, rec); }
    catch (e) { alog('could not write the record of', hex(actorId) + ':', e); }
  }

  /*
    What the owner's game is taught: [form id, mask] for every ingredient with
    a known slot, under a new stamp, so the script runs once for it.
  */
  function push(actorId, rec) {
    var learn = [];
    for (var desc in rec.known) {
      if (!own(rec.known, desc)) { continue; }
      var id = idOfDesc(desc);
      var mask = Number(rec.known[desc]) & ((1 << SLOTS) - 1);
      if (id && mask) { learn.push([id, mask]); }
    }
    try { mp.set(actorId, LEARN_PROPERTY, { at: now(), learn: learn }); }
    catch (e) { alog('could not teach', hex(actorId), 'what they know:', e); }
  }

  // ------------------------------------------------------------- the verbs --
  /*
    Something eaten, from the one onEatItem handler (the injury block's). Only
    a person's, and only an ingredient. The first taste of one is said once.
  */
  function ate(actorId, baseId) {
    var id = Number(actorId) || 0;
    if (!id || !personOf(id)) { return false; }
    if (!effectsOf(baseId)) { return false; }
    var desc = descOf(baseId);
    if (!desc) { return false; }
    var rec = read(id);
    var first = !own(rec.eaten, desc);
    var mask = Number(rec.known[desc]) || 0;
    if (!first && (mask & 1)) { return false; }
    if (first) { rec.eaten[desc] = now(); }
    rec.known[desc] = mask | 1;
    write(id, rec);
    push(id, rec);
    if (first) {
      alog(hex(id), 'ate', desc, 'for the first time');
      tell(id, 'You know the taste of ' + nameOf(desc) + ' now. It can go in a brew.');
    }
    return first;
  }

  /*
    The ingredients of a brew, by desc, each once, from the craft's inputs
    ([{ baseId, count }], the engine's seventh argument to mp.onCraft).
    Anything that is not an ingredient is left out.
  */
  function ingredientsIn(inputs) {
    var out = [];
    if (!Array.isArray(inputs)) { return out; }
    for (var i = 0; i < inputs.length; i++) {
      var base = Number(inputs[i] && inputs[i].baseId) || 0;
      if (!base || !effectsOf(base)) { continue; }
      var desc = descOf(base);
      if (desc && out.indexOf(desc) === -1) { out.push(desc); }
    }
    return out;
  }

  /*
    The line that refuses a brew with an ingredient this character has never
    eaten, or ''. inputs that are not an array (an engine from before #1648)
    are not asked, and the log says so.
  */
  function brewRefusal(actorId, inputs) {
    if (!Array.isArray(inputs)) {
      alog(hex(actorId), 'brewed and the engine named no inputs, so what they have eaten was not asked');
      return '';
    }
    var rec = read(actorId);
    var untasted = ingredientsIn(inputs).filter(function (d) { return !own(rec.eaten, d); });
    if (!untasted.length) { return ''; }
    var them = untasted.map(nameOf);
    var one = them.length === 1;
    return 'You have never eaten ' + listed(them, 'or') + ', so you do not know what ' +
      (one ? 'it does' : 'they do') + '. Eat ' + (one ? 'one' : 'one of each') + ' first, and then ' +
      (one ? 'it' : 'they') + ' can go in a brew. Your ingredients stay in your pack.';
  }

  /*
    A brew that went through: the mix is remembered, and every slot of each
    ingredient whose effect is in it is known. effects is the engine's sixth
    argument, the MGEF ids the ingredients share.
  */
  function brewed(actorId, inputs, effects) {
    var id = Number(actorId) || 0;
    if (!id || !personOf(id) || !Array.isArray(effects)) { return null; }
    var withDescs = ingredientsIn(inputs).sort();
    if (withDescs.length < 2) { return null; }
    var makes = [];
    var shared = {};
    for (var e = 0; e < effects.length; e++) {
      var m = Number(effects[e]) || 0;
      if (!m) { continue; }
      shared[m] = true;
      var md = descOf(m);
      if (md && makes.indexOf(md) === -1) { makes.push(md); }
    }
    if (!makes.length) { return null; }

    var rec = read(id);
    for (var i = 0; i < withDescs.length; i++) {
      var slots = effectsOf(idOfDesc(withDescs[i])) || [];
      var mask = Number(rec.known[withDescs[i]]) || 0;
      for (var s = 0; s < slots.length && s < SLOTS; s++) {
        if (own(shared, slots[s])) { mask |= (1 << s); }
      }
      rec.known[withDescs[i]] = mask;
    }

    var key = withDescs.join('|');
    var at = now();
    var row = null;
    for (var r = 0; r < rec.recipes.length; r++) {
      if (rec.recipes[r] && Array.isArray(rec.recipes[r].with) && rec.recipes[r].with.join('|') === key) {
        row = rec.recipes[r];
        break;
      }
    }
    var first = !row;
    if (first) {
      row = { with: withDescs, makes: makes, times: 0, first: at, last: at };
      rec.recipes.push(row);
    }
    row.makes = makes;
    row.times = (Number(row.times) || 0) + 1;
    row.last = at;
    write(id, rec);
    push(id, rec);
    if (first) {
      alog(hex(id), 'brewed', key, 'for the first time, making', makes.join(', '));
      tell(id, 'You will remember this mix at any alchemy lab: ' + listed(withDescs.map(nameOf)) +
           ' make ' + listed(makes.map(effectName)) + '.');
    }
    return row;
  }

  /*
    Somebody has come into the world (the character block's arrival): their
    game was started from a throwaway save, so it is taught everything the
    character knows, under a new stamp.
  */
  function arrival(actorId) {
    var id = Number(actorId) || 0;
    if (!id || !personOf(id)) { return; }
    push(id, read(id));
  }

  /* What the journal page (#3142) shows: names a person reads, nothing else. */
  function journal(actorId) {
    var rec = read(actorId);
    var eaten = Object.keys(rec.eaten).map(nameOf).sort();
    var recipes = rec.recipes.filter(function (row) { return row && Array.isArray(row.with); }).map(function (row) {
      return {
        with: row.with.map(nameOf),
        makes: (Array.isArray(row.makes) ? row.makes : []).map(effectName),
        times: Number(row.times) || 0
      };
    });
    return { eaten: eaten, recipes: recipes };
  }

  /*
    THE ALCHEMY JOURNAL, the page of K (#3142): every ingredient this
    character has eaten, with the effects of it they know, and every mix they
    have brewed, in names a person reads. The writeState of the character
    block puts it on the panel; K asks for the panel as it opens, so the page
    reads as of then. null while there is nothing on it, so nobody who has
    never tasted an ingredient gets an empty page.

    A known effect is named when the mixtures list names it, which is every
    effect a brew here can make. The names of the rest are in Skyrim's
    strings files, which the server does not load, and no brew here makes
    them, so they are counted and not named. effects: null is an ingredient
    whose record this server cannot find (a plugin taken out of the load
    order): what was eaten stays, and the page says the rest is not known.
  */
  function page(actorId) {
    var id = Number(actorId) || 0;
    if (!id || !personOf(id)) { return null; }
    var rec = read(id);
    var eaten = [];
    for (var desc in rec.eaten) {
      if (!own(rec.eaten, desc)) { continue; }
      var slots = effectsOf(idOfDesc(desc));
      var mask = Number(rec.known[desc]) || 0;
      var row = { name: nameOf(desc), effects: null, other: 0, known: 0, of: 0 };
      if (slots) {
        row.effects = [];
        row.of = Math.min(slots.length, SLOTS);
        for (var s = 0; s < row.of; s++) {
          if (!(mask & (1 << s))) { continue; }
          row.known++;
          var md = descOf(slots[s]);
          if (md && typeof MIXTURES !== 'undefined' && own(MIXTURES, md)) { row.effects.push(MIXTURES[md].name); }
          else { row.other++; }
        }
      }
      eaten.push(row);
    }
    eaten.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    var recipes = journal(id).recipes;
    if (!eaten.length && !recipes.length) { return null; }
    return { eaten: eaten, recipes: recipes };
  }

  /*
    Edge triggered on v.at through ctx.state, because updateOwner runs every
    frame (see SWING_PROPERTY): the game is taught once for each stamp, and
    the stamp is kept only once the character was there to teach.
  */
  function learnScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || !v.at || !v.learn) { return; }',
      '    var st = ctx.state;',
      '    if (!st || st.thornswoodAlchemyAt === v.at) { return; }',
      '    var sp = ctx.sp;',
      '    if (!sp.Game.getPlayer()) { return; }',
      '    st.thornswoodAlchemyAt = v.at;',
      '    for (var i = 0; i < v.learn.length; i++) {',
      '      var ing = sp.Ingredient.from(sp.Game.getFormEx(v.learn[i][0]));',
      '      if (!ing) { continue; }',
      '      for (var s = 0; s < ' + SLOTS + '; s++) {',
      '        if (v.learn[i][1] & (1 << s)) { ing.learnEffect(s); }',
      '      }',
      '    }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  // ------------------------------------------------------------ register --
  try {
    // The server's own record: nobody's client reads it.
    mp.makeProperty(ALCHEMY_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) {
    // already made by a previous load
  }
  try {
    mp.makeProperty(LEARN_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: learnScript(), updateNeighbor: ''
    });
  } catch (e) {
    // already made by a previous load; a changed script needs a restart,
    // which a deploy is.
  }

  g.__thornswoodAlchemy = {
    ALCHEMY_PROPERTY: ALCHEMY_PROPERTY, LEARN_PROPERTY: LEARN_PROPERTY,
    effectsOf: effectsOf, ate: ate, brewRefusal: brewRefusal, brewed: brewed,
    arrival: arrival, journal: journal, page: page, read: read, learnScript: learnScript
  };
  alog('ready');
})();
// ==== end thornswood alchemy ====

