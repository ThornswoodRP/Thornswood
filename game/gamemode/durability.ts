// ==== thornswood durability ====
/*
  CONDITION, REPAIR KITS AND THE DULL CLOCK (#1384).

  docs/systems/durability.md is the design and the Dull section of
  docs/systems/gold.md is the clock. In short: a worn piece runs from 0% to
  120%. A kit mends it, to 120% when the half that makes that kit does the
  work and to 100% for anybody else. At 0% a piece that is being worn has a
  10% chance to break on a hit. A piece sitting in a shop chest or a house
  container loses 5% of its condition per real day; a pack does not, and
  worn gear does not: worn gear loses 1% a hit instead (Patrick, 4 October).

  WHAT HAS A CONDITION. A weapon, a piece of armour and a piece of clothing:
  a WEAP record, and an ARMO record that is not jewellery. Those are the
  three things the three kits mend. A ring, an amulet or a circlet is on no
  kit's list, so it carries none. The pickaxe, the woodcutter's axe and the
  shovel wear out by use in the tool block (wearTool) and carry none either,
  because two clocks on one pickaxe is one too many. Ammunition is not a
  piece. Armour or clothing is the record's own armour type in BOD2 (light
  and heavy are armour, clothing is clothing), read once per base and kept.

  WHERE THE NUMBER LIVES: ON THE ITEM, IN ITS NAME. An entry in a pack or a
  chest is a base and a count and whatever extra the engine keeps beside
  them (Inventory.h in the fork: health, enchantment, name, worn and the
  rest). Two entries that differ in any of those are two stacks, and the
  engine carries that extra wherever the entry goes: into a chest, out of
  it, onto a body, and across a restart. So a piece at 100% is plain, and
  any other condition is written on the end of its name, "Iron Sword (85%)".
  The person sees it in their own inventory, two swords at different
  conditions are two lines they can tell apart, and nothing here has to
  follow an item from place to place. A deed, a mold and a key already carry
  which house they belong to the same way (the property block).

  Not the health extra, which looks like the obvious home. The client rounds
  it to a tenth and throws 1.0 away (inventory.ts in the fork), so 95% could
  not be kept, and Skyrim reads health as the temper level, so 120% would
  show as "Superior" and hit as one. And not a table in this file keyed by
  pack and base: two identical swords are one stack to the engine, so a
  table could never say which of the two left when one was put in a chest.

  TWO THINGS IN THE ENGINE MAKE A FRESH, PLAIN ENTRY, and a plain entry
  reads as 100%, so each of them would be a free repair:
    a drop, until #1719. MpActor::DropItem now puts the dropped entry's
          extra on the reference and the pickup adds it back, so a drop
          keeps the condition and nothing here watches drops any more.
    a craft. CraftEvent::OnFireSuccess takes away plain entries and adds a
          plain one. A temper is refused (recipelessCraft), so it is not a
          way round this. Enchanting a piece that is not at 100% fails in
          the engine, because the plain piece it asks to take is not there.
  A trade was a third, and it was this file's: moveById in the trade block
  wrote a base and a count and nothing else. It moves a piece with its name
  now, and leaves every other stack's alone (#1594).

  THE DULL CLOCK IS THE CHEST'S, NOT THE ITEM'S. A container in a building
  somebody holds (a shop is a claimed building, and so is a house) starts a
  clock the first time it is opened, written on the reference so it
  survives a restart. Every real day after that, everything with a
  condition inside it loses 5%. The loss is applied when the chest is
  opened, before the engine sends what is in it, so a person sees the right
  number; a chest nobody opens does not need to be right until somebody
  does. Opening it never moves the clock, so it does not reset the day, and
  taking a piece out and putting it back does not either: whatever is in
  the chest when its day turns loses the 5%.

  WHAT A HIT REACHES, Patrick's answers of 4 October on #1384. Each hit
  reaches every worn piece of armour and clothing on the person hit, the
  weapon the hit was landed with, and, when the hit was blocked, the weapon
  that blocked it (the shield, when one is worn, is armour and already
  counted). A weapon is not reached when its holder is hit. A piece the hit
  reaches loses WEAR_PER_HIT; one already at 0% rolls the break chance
  instead, and a broken piece is gone. Only people's gear wears: nothing
  here gives a bandit's sword a condition. The hit arrives through
  onPapyrusEvent:OnHit, whose one handler is at the end of the warrior
  maneuvers block and hands it to onHit here.

  WHAT IS WORN IS MATCHED TO THE PACK BY THE NAME WITHOUT THE CONDITION.
  What is worn is read off the equipment record, which the client sends
  when something goes on or comes off. Since #1651 the client takes a new
  condition on a piece it holds: its namesEqual (sync/inventory.ts in the
  fork) compares names exactly, and a piece the pack renames is renamed in
  the game where it lies, so a worn piece stays worn. This block renames
  the record's entry in the same step (THE EQUIPMENT RECORD FOLLOWS THE
  PACK), but the record can still name an older condition for a moment: the
  client's own report of an equip can cross a rename on the way. So sameName
  leaves the condition out, and a hit still finds the piece.

  THE KITS. A kit is a MISC record and a recipe in Thornswood-Content.esp
  (scripts/mods/Add-ContentRecords.py). KITS says what each one mends,
  whose it is, and its record; a server whose plugin does not carry the
  record yet resolves it to 0, and the panel says no kit has been made.
  repairTo and repairWithKit are what the rest of the file uses, so the fuel
  and master work (#1398) can rely on them: repairTo is the number a kit
  mends to for this person, and repairWithKit is the whole repair.

  THE REPAIR IS A PANEL, NOT A COMMAND (Patrick, 4 October: no chat
  commands for what people do). With a kit in the pack, the inventory shows
  a key; the key sends /repair, and panel() answers by publishing the view
  on PANEL_PROPERTY, which draws game/ui/thornswood-repair.js. Each row's
  button sends /repair mend with that piece. Nobody is told to type either.

  NOTHING HERE TOUCHES A NUMBER ON THE PAGE. 120% does not yet add 5% to a
  weapon's damage or an armour piece's rating: the server works damage out
  in the fork's TES5DamageFormula, which this file cannot reach.
*/
(function () {
  'use strict';
  var g = globalThis;

  var CONDITION = {
    // The bottom. A worn piece here can break on a hit.
    lowest: 0,
    // A sound piece: every piece as it is made, and a repair by anybody.
    sound: 100,
    // The repair of the half that makes the kit.
    highest: 120
  };
  // gold.md, Dull: 5% of its condition per real day.
  var DULL_PER_DAY = 5;
  var DAY_MS = 24 * 60 * 60 * 1000;
  // durability.md: at 0%, a worn piece has a 10% chance to break on a hit.
  var BREAK_CHANCE = 0.10;
  // Patrick, 4 October (#1384): a worn piece loses condition per hit. 1% a
  // hit, written on durability.md.
  var WEAR_PER_HIT = 1;
  // BOD2 slot 39, the shield. A shield blocks for its holder, so a blocked
  // hit reaches it, and it is armour, so every hit already does.
  var SHIELD_SLOT = 1 << 9;
  // Where a container's dull clock is written, on the reference itself.
  var CLOCK_PROPERTY = 'thornswoodDull';
  // The repair panel's view, the owner's only (game/ui/thornswood-repair.js).
  var PANEL_PROPERTY = 'thornswoodRepairView';

  /*
    THE THREE KITS, by what they mend. half is the half that makes it and
    repairs to 120%; maker is that half as a person reads it. item is the
    kit's MISC record in Thornswood-Content.esp (Add-ContentRecords.py).
    Only the half the person picked repairs to 120%, never the sister half at
    any rank (Patrick, 4 October). atMaster is a kit whose 120% waits for
    Master in that half: the Smith's two, because the 120% repair is the
    Smith's Master perk, Mastercraft (Patrick, 26 October, #3442). Below
    Master a smith mends to 100% like anybody else. The Sewing Kit is not
    the Tailor's Master perk (that is Master Weaver), so it keeps 120% at
    every rank.
  */
  var KITS = {
    weapon:   { name: 'Weapon Kit', half: 'edgewright',  maker: 'Edgewright',  item: '154b0:Thornswood-Content.esp', atMaster: true },
    armour:   { name: 'Armor Kit',  half: 'platewright', maker: 'Platewright', item: '154b1:Thornswood-Content.esp', atMaster: true },
    clothing: { name: 'Sewing Kit', half: 'haberdasher', maker: 'Haberdasher', item: '154b2:Thornswood-Content.esp' }
  };

  // " (85%)" on the end of a name.
  var SUFFIX = / \((\d{1,3})%\)$/;

  /*
    Jewellery, by the keywords Skyrim.esm gives it: ArmorJewelry,
    VendorItemJewelry, ClothingRing, ClothingNecklace and ClothingCirclet. A
    keyword in KWDA is the id as the plugin wrote it, and Skyrim.esm is
    master 0 in every plugin that names it, so these are the same number in
    any plugin. A piece whose only slots are the amulet, the ring and the
    circlet is jewellery too, for a mod that forgot the keyword.
  */
  var JEWELLERY_KEYWORDS = [0x6bbe9, 0x8f95a, 0x10cd09, 0x10cd0a, 0x10cd08];
  var JEWELLERY_SLOTS = (1 << 5) | (1 << 6) | (1 << 12);

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function u32(bytes, at) {
    if (!bytes || bytes.length < at + 4) { return -1; }
    return ((bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) >>> 0) +
           (bytes[at + 3] * 0x1000000);
  }

  function clamp(n) {
    n = Math.round(Number(n) || 0);
    if (n < CONDITION.lowest) { return CONDITION.lowest; }
    if (n > CONDITION.highest) { return CONDITION.highest; }
    return n;
  }

  /** The condition written on an entry, or 100 for a plain one. */
  function conditionOf(entry) {
    var m = SUFFIX.exec(String((entry && entry.name) || ''));
    return m ? clamp(m[1]) : CONDITION.sound;
  }

  /*
    Two entries the engine counts as one stack: the same base and the same
    extra (Inventory::Entry::EqualExceptCount). worn and wornLeft read false
    when they are missing, as the engine reads them.
  */
  var EXTRA = ['health', 'enchantmentId', 'maxCharge', 'removeEnchantmentOnUnequip',
               'chargePercent', 'name', 'soul', 'poisonId', 'poisonCount'];
  function sameStack(a, b) {
    if (!a || !b || a.baseId !== b.baseId) { return false; }
    for (var i = 0; i < EXTRA.length; i++) {
      if (a[EXTRA[i]] !== b[EXTRA[i]]) { return false; }
    }
    return !!a.worn === !!b.worn && !!a.wornLeft === !!b.wornLeft;
  }

  function copy(entry) {
    var out = {};
    for (var k in entry) { if (own(entry, k)) { out[k] = entry[k]; } }
    return out;
  }

  /** Stacks that have become the same stack folded into one, empties dropped. */
  function folded(entries) {
    var out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !(Number(e.count) > 0)) { continue; }
      var into = -1;
      for (var j = 0; j < out.length; j++) {
        if (sameStack(out[j], e)) { into = j; break; }
      }
      if (into >= 0) { out[into].count += e.count; } else { out.push(e); }
    }
    return out;
  }

  function aWord(name) {
    return (/^[aeiou]/i.test(String(name)) ? 'an ' : 'a ') + name;
  }

  function create(api) {
    var kits = api.kits || KITS;
    var kinds = {};
    var shields = {};
    var names = {};

    /*
      What kind of piece a base is: 'weapon', 'armour', 'clothing', or ''
      for a thing that has no condition. Asked once per base. A record that
      cannot be read has none, because not knowing what a thing is has to
      mean not touching it.
    */
    function pieceKind(baseId) {
      if (!baseId) { return ''; }
      if (own(kinds, baseId)) { return kinds[baseId]; }
      var kind = '';
      try { kind = readKind(baseId); } catch (e) { kind = ''; }
      kinds[baseId] = kind;
      return kind;
    }

    function readKind(baseId) {
      if (api.isTool && api.isTool(baseId)) { return ''; }
      var rec = api.recordOf(baseId);
      if (!rec || !rec.type) { return ''; }
      var type = String(rec.type);
      if (type === 'WEAP') { return 'weapon'; }
      if (type !== 'ARMO') { return ''; }
      var fields = rec.fields || [];
      var slots = -1, armourType = -1, keywords = [];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f) { continue; }
        var t = String(f.type);
        if (t === 'BOD2') {
          slots = u32(f.data, 0);
          armourType = u32(f.data, 4);
        } else if (t === 'BODT' && slots < 0) {
          slots = u32(f.data, 0);
          armourType = u32(f.data, 8);
        } else if (t === 'KWDA') {
          for (var k = 0; k + 4 <= (f.data || []).length; k += 4) { keywords.push(u32(f.data, k)); }
        }
      }
      for (var j = 0; j < keywords.length; j++) {
        if (JEWELLERY_KEYWORDS.indexOf(keywords[j]) !== -1) { return ''; }
      }
      if (slots > 0 && (slots & ~JEWELLERY_SLOTS) === 0) { return ''; }
      if (slots > 0 && (slots & SHIELD_SLOT)) { shields[baseId] = true; }
      if (armourType === 0 || armourType === 1) { return 'armour'; }
      if (armourType === 2) { return 'clothing'; }
      return '';
    }

    /*
      What a piece is called with nothing written on it. The recipe table
      first, which holds the names Skyrim's own string files give; then the
      record's FULL when it is real text; then its editor id, spaced out.
    */
    function baseName(baseId) {
      if (own(names, baseId)) { return names[baseId]; }
      var name = '';
      try { name = String(api.nameOf(baseId) || ''); } catch (e) { name = ''; }
      if (!name) {
        var rec = null;
        try { rec = api.recordOf(baseId); } catch (e) { rec = null; }
        var fields = (rec && rec.fields) || [];
        var edid = '';
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (!f) { continue; }
          var text = '';
          var data = f.data || [];
          for (var b = 0; b < data.length; b++) {
            var c = Number(data[b]);
            if (!c) { break; }
            if (c < 32 || c > 126) { text = ''; break; }
            text += String.fromCharCode(c);
          }
          if (!/[A-Za-z]/.test(text)) { continue; }
          if (f.type === 'FULL' && !name) { name = text; }
          if (f.type === 'EDID' && !edid) { edid = text; }
        }
        if (!name && edid) { name = edid.replace(/([a-z0-9])([A-Z])/g, '$1 $2'); }
      }
      names[baseId] = name || 'Piece';
      return names[baseId];
    }

    /** The name a person reads for this entry, without the condition. */
    function bareName(entry) {
      var bare = String((entry && entry.name) || '').replace(SUFFIX, '');
      return bare || baseName(entry.baseId);
    }

    /** A copy of the entry at that condition, its name written to match. */
    function withCondition(entry, cond) {
      var out = copy(entry);
      var bare = String(entry.name || '').replace(SUFFIX, '');
      cond = clamp(cond);
      if (cond === CONDITION.sound) {
        if (!bare || bare === baseName(entry.baseId)) { delete out.name; } else { out.name = bare; }
      } else {
        out.name = (bare || baseName(entry.baseId)) + ' (' + cond + '%)';
      }
      return out;
    }

    /** The entries with n units of entries[i] set to that condition. */
    function setUnits(entries, i, n, cond) {
      var out = entries.map(copy);
      var e = out[i];
      n = Math.min(n, Number(e.count) || 0);
      if (n <= 0) { return out; }
      var changed = withCondition(e, cond);
      changed.count = n;
      e.count -= n;
      out.push(changed);
      return folded(out);
    }

    /** The entries with one unit of entries[i] taken away. */
    function takeUnit(entries, i) {
      var out = entries.map(copy);
      out[i].count -= 1;
      return folded(out);
    }

    function piecesIn(entries) {
      var out = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !(Number(e.count) > 0)) { continue; }
        var kind = pieceKind(e.baseId);
        if (!kind) { continue; }
        out.push({ i: i, entry: e, kind: kind, cond: conditionOf(e), name: bareName(e) });
      }
      return out;
    }

    function kitId(key) {
      var kit = kits[key];
      if (!kit || !kit.item) { return 0; }
      try { return api.idOf(kit.item) || 0; } catch (e) { return 0; }
    }

    /*
      THE NUMBER A KIT MENDS TO, for this person. The half that makes that
      kit mends to 120; anybody else, the other half of the same profession
      included, mends to 100. The half is the one they picked, so a sister
      half held at novice is not it. A kit marked atMaster mends to 120 only
      for that half at Master, read from the person's own ranks.
    */
    function repairTo(state, key) {
      var kit = kits[key];
      if (!kit || !state || state.half !== kit.half) { return CONDITION.sound; }
      if (kit.atMaster) {
        var rank = (state.ranks && own(state.ranks, kit.half)) ? state.ranks[kit.half] : null;
        if (rank !== 'master') { return CONDITION.sound; }
      }
      return CONDITION.highest;
    }

    function heldOf(entries, id) {
      var n = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].baseId === id) { n += Number(entries[i].count) || 0; }
      }
      return n;
    }

    /*
      A REPAIR. pick is the row the panel's button names: the base, the
      condition and the name without it. One kit of the kind that mends it is
      used up, and one unit of the piece comes out at repairTo. Answers
      { ok, line } and, when it worked, from, to, kit and baseId. Nothing is
      taken when anything is refused.
    */
    function repairWithKit(actorId, pick) {
      function no(line) { return { ok: false, line: line }; }
      var entries = api.inventory(actorId);
      if (!entries) { return no('The server cannot read your pack right now. Try again in a moment.'); }
      pick = pick || {};
      var p = null;
      var all = piecesIn(entries);
      for (var f = 0; f < all.length; f++) {
        if (all[f].entry.baseId === pick.baseId && all[f].cond === Number(pick.cond) &&
            all[f].name === String(pick.name || '')) { p = all[f]; break; }
      }
      if (!p) { return no('That piece is not in your pack any more.'); }
      var kit = kits[p.kind];
      var id = kitId(p.kind);
      if (!id) {
        return no('Your ' + p.name + ' is mended with ' + aWord(kit.name) +
                  ', and no ' + kit.name + ' has been made in the world yet.');
      }
      var k = -1;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].baseId === id && Number(entries[i].count) > 0) { k = i; break; }
      }
      if (k < 0) {
        var maker = aWord(kit.maker);
        return no('Your ' + p.name + ' is mended with ' + aWord(kit.name) + ', and you have none. ' +
                  maker.charAt(0).toUpperCase() + maker.slice(1) + ' makes them.');
      }
      var state = null;
      try { state = api.stateOf(actorId); } catch (e) { state = null; }
      var to = repairTo(state, p.kind);
      if (p.cond >= to) {
        return no('Your ' + p.name + ' is at ' + p.cond + '%. A repair by you would not raise it.');
      }
      // One kit out, then one unit of the piece mended. The kit is never the
      // piece (a kit is a MISC), so p.i still points at the piece.
      var next = entries.map(copy);
      next[k].count -= 1;
      next = setUnits(next, p.i, 1, to);
      if (!api.setInventory(actorId, next)) {
        return no('The repair could not be written. Nothing was used. Try again in a moment.');
      }
      // When one unit of a stack is mended and one of them is worn, the
      // owner's game renames the worn one (renameInventoryItems takes worn
      // pieces first), so the record renames the worn one too.
      var mendedWorn = [];
      try { mendedWorn = api.worn(actorId) || []; } catch (e) { mendedWorn = []; }
      for (var mw = 0; mw < mendedWorn.length; mw++) {
        if (packEntryFor(entries, mendedWorn[mw]) === p.i) {
          renameInRecord(actorId, [{ worn: mendedWorn[mw], to: withCondition(p.entry, to).name }]);
          break;
        }
      }
      api.log('durability:', actorId.toString(16), 'mended', p.name, 'from', p.cond + '%', 'to',
              to + '%', 'with', aWord(kit.name));
      return { ok: true, from: p.cond, to: to, kit: p.kind, baseId: p.entry.baseId,
               line: 'Your ' + p.name + ' is at ' + to + '% now. The ' + kit.name + ' is used up.' };
    }

    /*
      WHAT THE PANEL SHOWS. A row for every piece carried that is not at
      100%, and for every sound piece this person's kit would raise (the
      half that makes a kit mends to 120%), worst first; pieces of one base
      at one condition under one name are one row. Each row says which kit
      mends it, the number a repair by this person comes out at, and whether
      that kit is in the pack. The kits are listed with how many are carried
      and whether the world has the record at all.
    */
    function view(actorId) {
      var entries = api.inventory(actorId);
      if (!entries) {
        return { open: true, rows: [], kits: [],
                 note: 'The server cannot read your pack right now. Try again in a moment.' };
      }
      var state = null;
      try { state = api.stateOf(actorId); } catch (e) { state = null; }
      var held = {};
      var kitRows = [];
      for (var key in kits) {
        if (!own(kits, key)) { continue; }
        var id = kitId(key);
        held[key] = id ? heldOf(entries, id) : 0;
        kitRows.push({ kind: key, name: kits[key].name, maker: kits[key].maker,
                       count: held[key], made: !!id });
      }
      var rows = [];
      var byKey = {};
      var pieces = piecesIn(entries);
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        var to = repairTo(state, p.kind);
        if (p.cond === CONDITION.sound && to <= CONDITION.sound) { continue; }
        var n = Number(p.entry.count) || 0;
        var worn = !!(p.entry.worn || p.entry.wornLeft);
        var rowKey = p.entry.baseId + '|' + p.cond + '|' + p.name;
        if (own(byKey, rowKey)) {
          byKey[rowKey].count += n;
          byKey[rowKey].worn = byKey[rowKey].worn || worn;
          continue;
        }
        var row = { base: p.entry.baseId.toString(16), cond: p.cond, name: p.name, count: n, worn: worn,
                    kind: p.kind, kit: kits[p.kind].name, maker: kits[p.kind].maker, to: to,
                    can: p.cond < to && held[p.kind] > 0 };
        byKey[rowKey] = row;
        rows.push(row);
      }
      rows.sort(function (a, b) { return a.cond - b.cond; });
      return { open: true, rows: rows, kits: kitRows };
    }

    /*
      WHAT THE PANEL AND THE INVENTORY KEY SEND, as the words after /repair.
      Nothing, the key: draw the panel. 'mend <base in hex> <condition>
      <name>', a row's button: mend that piece, then draw the panel again.
      Answers the line to say in the chat, or '' for none.
    */
    function panel(actorId, words) {
      words = words || [];
      var line = '';
      if (String(words[0] || '').toLowerCase() === 'mend') {
        line = repairWithKit(actorId, {
          baseId: parseInt(String(words[1] || ''), 16) || 0,
          cond: Number(words[2]),
          name: words.slice(3).join(' ')
        }).line;
      }
      api.show(actorId, view(actorId));
      return line;
    }

    /*
      A CONTAINER WAS OPENED. If it stands in a building somebody holds, its
      clock is read and whatever days have turned since it was last applied
      come off everything in it with a condition. A container in no held
      building has no clock: a chest in a cave is not a shop.
    */
    function opened(containerId) {
      var held = false;
      try { held = !!api.held(containerId); } catch (e) { held = false; }
      var clock = null;
      try { clock = api.clockOf(containerId); } catch (e) { clock = null; }
      if (!held) {
        if (clock && Number(clock.at) > 0) { api.setClock(containerId, null); }
        return 0;
      }
      var t = api.now();
      if (!clock || !(Number(clock.at) > 0)) {
        api.setClock(containerId, { at: t, days: 0 });
        return 0;
      }
      var days = Math.floor((t - Number(clock.at)) / DAY_MS);
      var turned = days - (Number(clock.days) || 0);
      if (turned <= 0) { return 0; }
      var lose = turned * DULL_PER_DAY;
      var entries = api.inventory(containerId) || [];
      var next = [];
      var dulled = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !(Number(e.count) > 0)) { continue; }
        var cond = pieceKind(e.baseId) ? conditionOf(e) : -1;
        if (cond <= CONDITION.lowest) { next.push(copy(e)); continue; }
        next.push(withCondition(e, Math.max(CONDITION.lowest, cond - lose)));
        dulled += Number(e.count) || 0;
      }
      if (dulled && !api.setInventory(containerId, folded(next))) {
        // Not written, so the clock stays where it was and the next opening tries again.
        return 0;
      }
      api.setClock(containerId, { at: Number(clock.at), days: days });
      if (dulled) {
        api.log('durability:', dulled, 'piece(s) in container', containerId.toString(16),
                'lost', lose + '%', 'over', turned, 'day(s)');
      }
      return dulled;
    }

    /*
      A HIT LANDED. targetId was hit, by aggressorId, with the weapon sourceId
      (a base id, or 0 for a fist or a spell), and blocked is the flag the
      client sent with it. Nothing here can stop the hit; it only wears what
      the hit reaches (the block comment says what that is) and breaks a
      piece at 0% on the roll. Answers the names of what broke.
    */
    function hit(targetId, aggressorId, sourceId, blocked) {
      var said = [];
      if (aggressorId && sourceId && api.isPerson(aggressorId) && pieceKind(sourceId) === 'weapon') {
        said = said.concat(wear(aggressorId, function (worn) {
          return inHand(worn.filter(function (w) { return w.baseId === sourceId; }));
        }));
      }
      if (targetId && api.isPerson(targetId)) {
        said = said.concat(wear(targetId, function (worn) {
          var body = worn.filter(function (w) {
            var kind = pieceKind(w.baseId);
            return kind === 'armour' || kind === 'clothing';
          });
          if (!blocked || body.some(function (w) { return !!shields[w.baseId]; })) { return body; }
          return body.concat(inHand(worn.filter(function (w) { return pieceKind(w.baseId) === 'weapon'; })));
        }));
      }
      return said;
    }

    /*
      One weapon out of those worn that could be it: the right hand's, else
      the left's. A hit is landed or blocked with one weapon, and two of the
      same sword, one in each hand, are still one hit.
    */
    function inHand(list) {
      for (var i = 0; i < list.length; i++) { if (list[i].worn) { return [list[i]]; } }
      return list.length ? [list[0]] : [];
    }

    /*
      The same piece by name, the way the client compares: the condition is
      not part of it, and no name at all is the base's own name (see WHAT IS
      WORN IS MATCHED TO THE PACK in the block comment).
    */
    function sameName(entry, wornName) {
      var a = String(entry.name || '').replace(SUFFIX, '');
      var b = String(wornName || '').replace(SUFFIX, '');
      if (a === b) { return true; }
      var plain = baseName(entry.baseId);
      return (!a && b === plain) || (!b && a === plain);
    }

    /*
      The pack's entry for a worn thing. What is worn is read off the
      equipment, which is what the client dresses from, and the condition off
      the pack. When the worn thing names itself, a stack of that name; of
      those, the one the pack has flagged worn in the same hand, else any
      flagged worn, else the first.
    */
    function packEntryFor(entries, w, left) {
      var at = -1, best = -1;
      var named = typeof w.name === 'string';
      for (var k = 0; k < entries.length; k++) {
        var e = entries[k];
        if (!e || e.baseId !== w.baseId || !(Number(e.count) > 0)) { continue; }
        if (left && !(left[k] > 0)) { continue; }
        if (named && !sameName(e, w.name)) { continue; }
        var score = (!!e.worn === !!w.worn && !!e.wornLeft === !!w.wornLeft) ? 2 : ((e.worn || e.wornLeft) ? 1 : 0);
        // The record's own name first, condition and all: the record follows
        // the pack (#1651), so of two stacks of one base it names the right
        // one, where the name without the condition names both.
        if (named && (e.name || '') === w.name) { score += 4; }
        if (score > best) { at = k; best = score; }
      }
      return at;
    }

    /*
      THE EQUIPMENT RECORD FOLLOWS THE PACK (#1651). The engine keeps two
      lists for a person: the pack, which this block writes, and the
      equipment record, which says what is worn and which their game writes
      every time something goes on or comes off. The record names each piece
      as their game named it then. Their game dresses them at login by
      finding, for each worn entry in the record, the stack in the pack with
      the same name and extras (applyPcInv in the fork's remoteServer.ts),
      and since #1651 it compares names exactly. So when this block renames
      a worn piece in the pack, it renames that piece's entry in the record
      in the same step. The engine takes a write that changes nothing but
      names for any actor and tells nobody (EquipmentBinding::Set in the
      fork), because nothing worn changes. Only worn entries are renamed: the
      rest of the record is their game's copy of the pack at the last equip,
      and nothing reads it.

      renames is a list of { worn: the record's entry as read, to: the new
      name, or undefined for a plain one }. Answers how many were renamed.
    */
    function sameRecordEntry(a, b) {
      if (!a || !b || a.baseId !== b.baseId || (Number(a.count) || 0) !== (Number(b.count) || 0)) {
        return false;
      }
      for (var i = 0; i < EXTRA.length; i++) {
        if (a[EXTRA[i]] !== b[EXTRA[i]]) { return false; }
      }
      return !!a.worn === !!b.worn && !!a.wornLeft === !!b.wornLeft;
    }

    function renameInRecord(actorId, renames) {
      if (!renames.length || !api.record || !api.setRecord) { return 0; }
      var rec = null;
      try { rec = api.record(actorId); } catch (e) { rec = null; }
      var list = rec && rec.inv && rec.inv.entries;
      if (!list) { return 0; }
      var used = {};
      var changed = 0;
      for (var r = 0; r < renames.length; r++) {
        var at = -1;
        for (var i = 0; i < list.length && at < 0; i++) {
          var e = list[i];
          if (!used[i] && e && (e.worn || e.wornLeft) && sameRecordEntry(e, renames[r].worn)) { at = i; }
        }
        if (at < 0) { continue; }
        used[at] = true;
        if ((list[at].name || '') === (renames[r].to || '')) { continue; }
        if (renames[r].to) { list[at].name = renames[r].to; } else { delete list[at].name; }
        changed++;
      }
      if (changed && !api.setRecord(actorId, rec)) { return 0; }
      return changed;
    }

    /*
      A RECORD WRITTEN BEFORE #1651, put right as its owner logs in. Until
      #1651 nothing renamed the record, and the owner's game never took a new
      condition, so a record can name a worn piece by a condition the pack
      has since moved on from ("Iron Sword (90%)" worn, the pack holding
      "Iron Sword (85%)"). The engine asks here just before it hands the
      character to its owner's game (spawn.ts in the fork). Each worn piece
      whose name matches no stack in the pack is renamed to the stack a hit
      on it reaches, by packEntryFor. When two stacks of that base differ
      only in condition and the pack does not say which is worn, the one
      nearest the condition the record names is taken: a worn piece moves a
      percent a hit from the number its record was written at. A stack
      answers for as many worn entries as it has units, and entries that
      already match claim theirs first.
    */
    function sameNameOrPlain(a, b, baseId) {
      a = String(a || '');
      b = String(b || '');
      if (a === b) { return true; }
      var plain = baseName(baseId);
      return (!a && b === plain) || (!b && a === plain);
    }

    function loading(actorId) {
      if (!api.record || !api.setRecord) { return 0; }
      var rec = null;
      try { rec = api.record(actorId); } catch (e) { rec = null; }
      var list = rec && rec.inv && rec.inv.entries;
      var entries = api.inventory(actorId);
      if (!list || !entries) { return 0; }
      var left = entries.map(function (e) { return Number(e && e.count) || 0; });
      var stale = [];
      for (var i = 0; i < list.length; i++) {
        var w = list[i];
        if (!w || !(w.worn || w.wornLeft) || !pieceKind(w.baseId)) { continue; }
        var exact = -1;
        for (var k = 0; k < entries.length && exact < 0; k++) {
          var e = entries[k];
          if (e && e.baseId === w.baseId && left[k] > 0 && sameNameOrPlain(e.name, w.name, w.baseId)) { exact = k; }
        }
        if (exact >= 0) { left[exact]--; } else { stale.push(w); }
      }
      var changed = 0;
      for (var s = 0; s < stale.length; s++) {
        var at = packEntryFor(entries, stale[s], left);
        if (at < 0) { continue; }
        var was = conditionOf(stale[s]);
        for (var n = 0; n < entries.length; n++) {
          var other = entries[n];
          if (n === at || !other || other.baseId !== stale[s].baseId || !(left[n] > 0) ||
              !sameName(other, stale[s].name || '') ||
              !!other.worn !== !!entries[at].worn || !!other.wornLeft !== !!entries[at].wornLeft) { continue; }
          if (Math.abs(conditionOf(other) - was) < Math.abs(conditionOf(entries[at]) - was)) { at = n; }
        }
        left[at]--;
        var to = entries[at].name;
        if (to) { stale[s].name = to; } else { delete stale[s].name; }
        changed++;
      }
      if (changed && !api.setRecord(actorId, rec)) { return 0; }
      if (changed) {
        api.log('durability:', actorId.toString(16), 'named', changed,
                'worn piece(s) in the equipment record as the pack has them');
      }
      return changed;
    }

    /*
      ONE HIT ON ONE PERSON'S GEAR. pick chooses, out of what they wear that
      has a condition, the pieces this hit reaches. Each one above 0% loses
      WEAR_PER_HIT; each one at 0% rolls the break chance. One write for the
      lot, and nothing said or logged unless it was written.
    */
    function wear(actorId, pick) {
      var worn = [];
      try { worn = api.worn(actorId) || []; } catch (e) { worn = []; }
      var due = pick(worn.filter(function (w) { return w && w.baseId && pieceKind(w.baseId); }));
      if (!due.length) { return []; }
      var entries = api.inventory(actorId);
      if (!entries) { return []; }
      var gone = [];
      var worse = 0;
      var renames = [];
      for (var j = 0; j < due.length; j++) {
        var at = packEntryFor(entries, due[j]);
        if (at < 0) { continue; }
        var cond = conditionOf(entries[at]);
        if (cond > CONDITION.lowest) {
          renames.push({ worn: due[j], to: withCondition(entries[at], cond - WEAR_PER_HIT).name });
          entries = setUnits(entries, at, 1, cond - WEAR_PER_HIT);
          worse++;
          continue;
        }
        if (!(api.random() < BREAK_CHANCE)) { continue; }
        gone.push(bareName(entries[at]));
        entries = takeUnit(entries, at);
      }
      if (!gone.length && !worse) { return []; }
      if (!api.setInventory(actorId, entries)) { return []; }
      renameInRecord(actorId, renames);
      for (var n = 0; n < gone.length; n++) {
        api.say(actorId, 'Your ' + gone[n] + ' broke. It was at 0%, and a kit would have mended it.');
      }
      if (gone.length) {
        api.log('durability:', actorId.toString(16), 'broke', gone.join(', '), 'on a hit at 0%');
      }
      return gone;
    }

    /*
      A hit as the engine sends it: the target's id, then the aggressor and
      the weapon or spell as { type, desc } (THE PAPYRUS FAMILY, over
      mp.onTakeItem), and the client's blocked flag. The one OnHit handler,
      in the warrior maneuvers block, hands it here.
    */
    function onHit(targetId, aggressor, source, blocked) {
      function idFrom(v) {
        if (typeof v === 'number') { return v; }
        if (v && v.desc) { return api.idOf(v.desc) || 0; }
        return 0;
      }
      return hit(Number(targetId) || 0, idFrom(aggressor), idFrom(source), !!blocked);
    }

    /*
      SOMETHING WAS PRESSED. A container is the dull clock. A piece picked
      up off the ground keeps its condition in the engine (#1719).
    */
    function pressed(actorId, refrId, baseDesc) {
      if (api.isContainer(baseDesc)) { return opened(refrId); }
      return 0;
    }

    return {
      CONDITION: CONDITION, DULL_PER_DAY: DULL_PER_DAY, DAY_MS: DAY_MS,
      BREAK_CHANCE: BREAK_CHANCE, WEAR_PER_HIT: WEAR_PER_HIT, KITS: kits,
      pieceKind: pieceKind, conditionOf: conditionOf, withCondition: withCondition,
      repairTo: repairTo, repairWithKit: repairWithKit, view: view, panel: panel,
      opened: opened, hit: hit, onHit: onHit, pressed: pressed, loading: loading
    };
  }

  g.__thornswoodDurabilityCreate = create;
  g.__thornswoodDurabilityKits = KITS;
  if (typeof mp === 'undefined' || !mp) { return; }

  try {
    mp.makeProperty(CLOCK_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }

  /*
    THE REPAIR PANEL'S VIEW, seen by its owner only. The owner's script hands
    it to the page, the way the merchant panel's does, and
    game/ui/thornswood-repair.js draws it; a view with open set opens it. at
    moves on every send, so the key pressed again draws the panel again
    even when nothing in it changed.
  */
  var panelScript = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodRepairAt === v.at) { return; }',
    '    st.thornswoodRepairAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodRepairView=d;" +',
    '      "if(window.thornswoodRepair&&window.thornswoodRepair.setData){window.thornswoodRepair.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  try {
    mp.makeProperty(PANEL_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: panelScript, updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }
  var shownAt = 0;

  /*
    Display names by record, out of the recipe table, built once: every
    weapon, armour and garment anybody can make is the output of a row
    there, under the name Skyrim's own string files give it. Not the two
    names tables /give reads: they name gold too, and test-one-mint.js keeps
    them to /give alone.
  */
  var displayNames = null;
  function displayName(baseId) {
    if (!displayNames) {
      displayNames = {};
      var rows = (typeof RECIPES_BY_ID !== 'undefined' && RECIPES_BY_ID) ? RECIPES_BY_ID : {};
      for (var k in rows) {
        if (!own(rows, k)) { continue; }
        var row = rows[k];
        if (row && row.out && row.name && !own(displayNames, row.out)) { displayNames[row.out] = row.name; }
      }
    }
    var desc = '';
    try { desc = String(mp.getDescFromId(baseId) || ''); } catch (e) { desc = ''; }
    return desc && own(displayNames, desc) ? displayNames[desc] : '';
  }

  /*
    The one write into a pack or a chest. Every caller hands back entries it
    has just read from the same pack or chest: a stack renamed for its
    condition, or a kit or a broken piece taken away. No base is added and
    no count grows.
  */
  function writePack(id, entries) {
    try { mp.set(id, 'inventory', { entries: entries }); return true; } catch (e) {
      log('durability: could not write the inventory of', Number(id).toString(16) + ':', e);
      return false;
    }
  }

  function entriesOf(id) {
    try {
      var inv = mp.get(id, 'inventory');
      return ((inv && inv.entries) || []).map(copy);
    } catch (e) { return null; }
  }

  g.__thornswoodDurability = create({
    now: function () { return Date.now(); },
    random: Math.random,
    later: function (fn, ms) { setTimeout(fn, ms); },
    inventory: entriesOf,
    setInventory: writePack,
    worn: function (id) {
      try {
        var eq = mp.get(id, 'equipment');
        var ee = eq && ((eq.inv && eq.inv.entries) || eq.entries);
        if (ee) { return ee.filter(function (e) { return e && (e.worn || e.wornLeft); }); }
      } catch (e) { }
      return (entriesOf(id) || []).filter(function (e) { return e && (e.worn || e.wornLeft); });
    },
    // The equipment record as the engine holds it, and a write of it that
    // changes only names (#1651; EquipmentBinding::Set in the fork).
    record: function (id) {
      try {
        var eq = mp.get(id, 'equipment');
        return eq ? JSON.parse(JSON.stringify(eq)) : null;
      } catch (e) { return null; }
    },
    setRecord: function (id, rec) {
      try { mp.set(id, 'equipment', rec); return true; } catch (e) {
        log('durability: could not rename in the equipment record of', Number(id).toString(16) + ':', e);
        return false;
      }
    },
    recordOf: function (baseId) {
      var res = mp.lookupEspmRecordById(baseId);
      return (res && res.record) || null;
    },
    nameOf: displayName,
    idOf: idOf,
    stateOf: function (actorId) {
      var C = g.__thornswoodCharacter;
      return (C && C.stateOf) ? C.stateOf(actorId) : null;
    },
    isPerson: function (id) {
      try { return (Number(mp.get(id, 'profileId')) || 0) > 0; } catch (e) { return false; }
    },
    isTool: function (baseId) {
      var sp = g.__thornswoodSpoils;
      return !!(sp && sp.isTool && sp.isTool(baseId));
    },
    held: function (containerId) {
      var prop = g.__thornswoodProperty;
      if (!prop || !prop.holderOf) { return false; }
      var cell = String(mp.get(containerId, 'worldOrCellDesc') || '');
      var by = cell ? prop.holderOf(cell) : null;
      return !!(by && Number(by.by) > 0);
    },
    isContainer: kindIsContainer,
    cellOf: function (id) {
      try { return String(mp.get(id, 'worldOrCellDesc') || ''); } catch (e) { return ''; }
    },
    clockOf: function (id) { return mp.get(id, CLOCK_PROPERTY) || null; },
    // No clock is written as a clock that never started, rather than as null.
    setClock: function (id, clock) {
      try { mp.set(id, CLOCK_PROPERTY, clock || { at: 0, days: 0 }); } catch (e) {
        log('durability: could not write the clock of container', Number(id).toString(16) + ':', e);
      }
    },
    show: function (id, v) {
      var payload = JSON.parse(JSON.stringify(v || { open: false }));
      shownAt = Math.max(Date.now(), shownAt + 1);
      payload.at = shownAt;
      try { mp.set(id, PANEL_PROPERTY, payload); } catch (e) {
        log('durability: could not send the repair panel to', Number(id).toString(16) + ':', e);
      }
    },
    say: say,
    log: log
  });

  /*
    The engine's last word before it hands a character that already exists
    to its owner's game (spawn.ts in the fork, #1651): see A RECORD WRITTEN
    BEFORE #1651. A failure here is logged with the actor and the login goes
    on, since the record is then only as it was before.
  */
  g.__thornswoodSpawn = g.__thornswoodSpawn || {};
  g.__thornswoodSpawn.loading = function (actorId) {
    try { g.__thornswoodDurability.loading(actorId); } catch (e) {
      log('durability: could not name the equipment record of', Number(actorId).toString(16), 'at login:', e);
    }
  };
})();
// ==== end thornswood durability ====

