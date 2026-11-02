// ==== thornswood spoilage ====
/*
  SPOILAGE AND PRESERVING (#3163).

  docs/systems/spoilage.md is the design. Patrick's answers of 22 October
  2026 on his report page: food spoils gently, raw in 1 real week, cooked in
  2, preserved never; a pack does not spoil while its owner is offline, and
  chests and shops keep spoiling.

  WHERE THE DAYS LIVE: ON THE FOOD, IN ITS NAME, the way the durability
  block keeps a condition ("Iron Sword (85%)") and for the same reason. An
  entry's extra is the only thing about one copy the engine carries
  everywhere: into a chest, out of it, through a trade, onto the ground
  (#1719) and across a restart. A table here keyed by pack and record could
  never say which of two venison steaks went into the chest. So a piece of
  food that spoils is "Venison (6 days left)", two steaks bought a day apart
  are two lines in the inventory a person can tell apart, and a buyer reads
  how fresh the meat is before they pay for it. Salted and smoked food is
  "Venison (salted)" and never spoils.

  WHAT THE ENGINE HAD TO LEARN. The client names what it eats, and what goes
  into a craft, by its record alone, and the engine took that from the plain
  stack only, so a named steak could be neither eaten nor cooked (the eat
  threw after the meal had landed and the server kept the steak). Fork PR
  #118 (Inventory::ResolveRemoval) takes such a removal from the plain stack
  first and then from a stack that differs only in its name. A stack that
  differs in anything else is never taken. So named food eats and cooks,
  and mp.onCraft's seventh argument names an input that came off a named
  stack; inputRefusal below refuses any named input that is not food
  carrying its days, so a worn sword (85%), a house's mold or a woven
  garment is still never spent by a craft, as it never could be.

  WHICH FOOD SPOILS AND HOW FAST is FOOD_GROUPS.spoil
  (game/data/food-groups.json): days by group (raw meat and fish, and the
  fruit and vegetables, 7; cooked dishes, soups and stews, and bread and
  sweets, 14), keeps for the ones in those groups that keep for good (honey,
  flour, cheese, spiced beef, chocolate, taffy), extra for the ones outside
  them that spoil (milk 7, butter and the burnt meal 14). A fine dish keeps
  as its plain dish does. Drink, ale, tea, potions and drugs never spoil.
  names holds what each one is called, out of food.json, because the
  server cannot read Skyrim's string files (scripts/dev/Build-SpoilNames.js).

  TWO CLOCKS, AND BOTH ARE THE PLACE'S, NOT THE FOOD'S.
    A pack counts only while its owner is online. Every PASS_MS the pass
          below looks at every online pack, adds the time since its last
          look (a gap longer than GAP_MS was time away, or a server that
          was down, and counts nothing), and each time a whole day of that
          has gathered, every piece in the pack has a day fewer left.
    A chest counts real days from the first time it is opened, the dull
          clock's way (durability.md): written on the reference, applied
          when it is next opened and before the engine sends what is in
          it, never reset by opening it. Every container counts, a cave's
          too: rot does not ask who holds the building.
  A day is counted when its place's day turns, whatever came in during it,
  so a steak put in a chest an hour before that chest's day turns loses the
  day. Every day is a whole day of the place, never a share of one.

  COLD STORAGE. A chest in a snowy climate (Winterhold, the Pale, and the
  high mountains, out of the season block) is cold: its days still turn,
  so nothing is owed when the food leaves it, but none of them come off
  the food. And every chest anywhere is cold in the winter week of the
  season block's year: a day that turned in winter comes off nothing in a
  chest. A pack is never cold storage. Patrick, 26 October 2026, B on his
  report page (q-3163-cold-storage).

  WHAT IS NAMED, AND WHEN. Food that spoils and carries no days yet is
  plain: a steak just cut from a deer, an apple just picked, a loaf off a
  merchant's shelf. The pass and a chest's opening name it at its full
  life, so it shows within a pass of reaching a pack. A dish comes off the
  pot already named (outputName, through the engine's craftOutput), so it
  is never plain in a pack at all.

  SPOILED FOOD STAYS (Patrick, 26 October 2026, C on his report page,
  q-3163-spoiled). When a piece reaches 0 it becomes spoiled food, named
  for what it was, "Venison (spoiled)", and its owner is told which food
  went off (the person who opens the chest, for a chest). Eating it fills
  nothing and starts food sickness (the needs block), and no recipe takes
  it. Spoiled food is a record of its own, FOOD_GROUPS.spoil.spoiled in
  Thornswood-Content.esp, and not a name on the food's own record, because
  the client names what it eats by record alone: with "Venison (spoiled)"
  and "Venison (3 days left)" both the Venison record, the server could
  not tell which one went down. A Farmer using it as compost is the rest
  of that answer, and is its own issue on the board. Without the record
  (a plugin older than this block) nothing spoils at all, and the block
  says so once, rather than throw food away that the answer keeps.

  PRESERVING IS A COOK'S WORK, AND A PANEL, NOT A COMMAND (Patrick, 4
  October: no chat commands for what people do). A Hearthcook or a
  Confectioner, own half or taught, salts raw meat and fish with one Salt
  Pile a piece, or smokes it at a lit fire with one Firewood for every
  SMOKE_PER_WOOD pieces. While the owner may preserve and carries raw food
  that is not preserved yet, LINE_PROPERTY is set, and the inventory shows a
  key (game/plugins/thornswood-front.js); the key sends /preserve, and
  panel() publishes the view on PANEL_PROPERTY, which
  game/ui/thornswood-preserve.js draws. Each row's buttons send /preserve
  salt or /preserve smoke with that stack. Nobody is told to type either.
  Who may preserve is Patrick's B of 26 October on his report page
  (q-3163-preserve-who): cooks only, at these costs.
*/
(function () {
  'use strict';
  var g = globalThis;

  var DAY_MS = 24 * 60 * 60 * 1000;
  // How often the online packs are looked at.
  var PASS_MS = 60 * 1000;
  // More than this between two looks at one pack was time away, not play.
  var GAP_MS = 5 * 60 * 1000;
  // One Firewood smokes this many pieces.
  var SMOKE_PER_WOOD = 5;
  // " (6 days left)", " (1 day left)" on the end of a name.
  var LEFT = / \((\d{1,3}) days? left\)$/;
  // " (salted)", " (smoked)": preserved, never spoils.
  var KEPT = / \((salted|smoked)\)$/;
  var PACK_PROPERTY = 'thornswoodSpoilPack';
  var CHEST_PROPERTY = 'thornswoodSpoilChest';
  var PANEL_PROPERTY = 'thornswoodPreserveView';
  var LINE_PROPERTY = 'thornswoodPreserveLine';
  // The halves whose work preserving is.
  var PRESERVERS = ['hearthcook', 'confectioner'];
  var HOW = { salt: 'salted', smoke: 'smoked' };

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function copy(entry) {
    var out = {};
    for (var k in entry) { if (own(entry, k)) { out[k] = entry[k]; } }
    return out;
  }

  /*
    Two entries the engine counts as one stack (Inventory::Entry::
    EqualExceptCount), the durability block's sameStack: the same base and
    the same extra.
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

  function daysWord(n) { return n === 1 ? '1 day' : n + ' days'; }

  function create(api) {
    var table = api.table || {};
    var lives = {};
    var names = {};

    /*
      The days a record keeps, or 0 for never: FOOD_GROUPS.spoil's rule, the
      same one Build-SpoilNames.js reads. A record whose name the table does
      not hold is never named, so it never spoils: a name is the only place
      its days could be kept.
    */
    function lifeOf(baseId) {
      if (!baseId || !spoiledId()) { return 0; }
      if (own(lives, baseId)) { return lives[baseId]; }
      var desc = '';
      try { desc = String(api.descOf(baseId) || ''); } catch (e) { desc = ''; }
      var life = 0;
      if (desc && own(table.names, desc)) { life = lifeOfDesc(desc); }
      lives[baseId] = life;
      names[baseId] = life ? String(table.names[desc]) : '';
      return life;
    }

    function lifeOfDesc(desc) {
      if (own(table.keeps, desc)) { return 0; }
      if (own(table.extra, desc)) { return Number(table.extra[desc]) || 0; }
      var group = '';
      try { group = String(api.groupOfDesc(desc) || ''); } catch (e) { group = ''; }
      if (group && own(table.days, group)) { return Number(table.days[group]) || 0; }
      var plain = '';
      try { plain = String(api.plainOfFine(desc) || ''); } catch (e) { plain = ''; }
      return plain && plain !== desc ? lifeOfDesc(plain) : 0;
    }

    /** The spoiled food record, or 0 when the content plugin has none. */
    var spoiled = -1;
    function spoiledId() {
      if (spoiled < 0) {
        spoiled = idOfDesc(table.spoiled);
        if (!spoiled) {
          try { api.log('spoilage: the content plugin has no spoiled food record (' + String(table.spoiled) +
                        '), so nothing spoils until it does.'); } catch (e) { }
        }
      }
      return spoiled;
    }

    /** Whether raw food of this record may be salted or smoked. */
    function preservable(baseId) {
      if (!lifeOf(baseId)) { return false; }
      var desc = '';
      try { desc = String(api.descOf(baseId) || ''); } catch (e) { desc = ''; }
      var group = '';
      try { group = String(api.groupOfDesc(desc) || ''); } catch (e) { group = ''; }
      return (table.preserve || []).indexOf(group) !== -1;
    }

    /** The days written on an entry, or -1 for none. */
    function leftOf(entry) {
      var m = LEFT.exec(String((entry && entry.name) || ''));
      return m ? Number(m[1]) : -1;
    }

    /** 'salted', 'smoked', or '' for food that is not preserved. */
    function keptOf(entry) {
      var m = KEPT.exec(String((entry && entry.name) || ''));
      return m ? m[1] : '';
    }

    /** The name a person reads, without its days or its preserving. */
    function bareName(entry) {
      var bare = String((entry && entry.name) || '').replace(LEFT, '').replace(KEPT, '');
      if (bare) { return bare; }
      lifeOf(entry && entry.baseId);
      return names[entry && entry.baseId] || 'Food';
    }

    /** Whether a name is one this block wrote: days left, or preserved. */
    function ownName(entry) {
      if (!entry || !entry.name || !lifeOf(entry.baseId)) { return false; }
      return leftOf(entry) >= 0 || !!keptOf(entry);
    }

    function withLeft(entry, n) {
      var out = copy(entry);
      out.name = bareName(entry) + ' (' + daysWord(n) + ' left)';
      return out;
    }

    function withKept(entry, how) {
      var out = copy(entry);
      out.name = bareName(entry) + ' (' + how + ')';
      return out;
    }

    /*
      The entries with `turned` days taken off every piece that spoils, and
      every plain one named at its full life. Answers { entries, gone } where
      gone is [{ name, count }] of what reached 0 and became spoiled food,
      "Venison (spoiled)", in the same place. A piece already past its life
      by its name (a table that shortened) comes down to its life.
    */
    function aged(entries, turned) {
      var out = [];
      var gone = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !(Number(e.count) > 0)) { continue; }
        var life = lifeOf(e.baseId);
        if (!life || keptOf(e)) { out.push(copy(e)); continue; }
        var had = leftOf(e);
        if (had < 0) {
          if (e.name) {
            // A name of somebody else's on a food: left as it is.
            out.push(copy(e));
            continue;
          }
          had = life;
        }
        var left = Math.min(had, life) - turned;
        if (left <= 0) {
          gone.push({ name: bareName(e), count: Number(e.count) || 0 });
          out.push({ baseId: spoiledId(), count: Number(e.count) || 0, name: bareName(e) + ' (spoiled)' });
          continue;
        }
        out.push(withLeft(e, left));
      }
      return { entries: folded(out), gone: gone };
    }

    function same(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function goneLine(gone, where) {
      if (!gone.length) { return ''; }
      var parts = gone.map(function (x) { return (x.count > 1 ? x.count + ' ' : '') + x.name; });
      var list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
      return list + (where ? ' in ' + where : '') + ' went off.';
    }

    function mayPreserve(actorId) {
      var state = null;
      try { state = api.stateOf(actorId); } catch (e) { state = null; }
      if (!state) { return false; }
      for (var i = 0; i < PRESERVERS.length; i++) {
        try { if (api.canWork(state, PRESERVERS[i])) { return true; } } catch (e) { }
      }
      return false;
    }

    /** The stacks a cook could preserve: raw, spoiling, not preserved yet. */
    function preservableIn(entries) {
      var out = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !(Number(e.count) > 0) || keptOf(e) || !preservable(e.baseId)) { continue; }
        if (e.name && leftOf(e) < 0) { continue; }
        out.push(i);
      }
      return out;
    }

    function idOfDesc(desc) {
      if (!desc) { return 0; }
      try { return api.idOf(desc) || 0; } catch (e) { return 0; }
    }

    function heldOf(entries, id) {
      var n = 0;
      if (!id) { return 0; }
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e && e.baseId === id && !e.name && !e.worn && !e.wornLeft) { n += Number(e.count) || 0; }
      }
      return n;
    }

    /** n plain units of record id taken out of a copy, in place. False when short. */
    function takePlain(entries, id, n) {
      if (heldOf(entries, id) < n) { return false; }
      for (var i = 0; i < entries.length && n > 0; i++) {
        var e = entries[i];
        if (!e || e.baseId !== id || e.name || e.worn || e.wornLeft) { continue; }
        var k = Math.min(n, Number(e.count) || 0);
        e.count -= k;
        n -= k;
      }
      return true;
    }

    function setLine(actorId, entries) {
      var on = !!entries && mayPreserve(actorId) && preservableIn(entries).length > 0;
      try { api.setLine(actorId, on); } catch (e) { }
      return on;
    }

    /*
      ONE LOOK AT AN ONLINE PACK. The time since the last look is added to
      the pack's own clock unless it is more than GAP_MS (time away), each
      whole day of it comes off every piece that spoils, and plain food is
      named. The clock moves only once the pack is written, so a write that
      fails is tried again on the next look with nothing lost.
    */
    function pass(actorId, now) {
      var entries = api.inventory(actorId);
      if (!entries) { return null; }
      var clock = null;
      try { clock = api.packClock(actorId); } catch (e) { clock = null; }
      var ms = 0;
      if (clock && Number(clock.at) > 0) {
        var delta = now - Number(clock.at);
        if (!(delta > 0) || delta > GAP_MS) { delta = 0; }
        ms = (Number(clock.ms) || 0) + delta;
      }
      var turned = Math.floor(ms / DAY_MS);
      ms -= turned * DAY_MS;
      var res = aged(entries, turned);
      if (!same(res.entries, entries) && !api.setInventory(actorId, res.entries)) {
        return null;
      }
      try { api.setPackClock(actorId, { at: now, ms: ms }); } catch (e) { }
      var line = goneLine(res.gone, '');
      if (line) {
        api.say(actorId, 'Your ' + line);
        api.log('spoilage:', Number(actorId).toString(16), 'spoiled', JSON.stringify(res.gone), 'after', turned, 'day(s)');
      }
      setLine(actorId, res.entries);
      return { turned: turned, gone: res.gone };
    }

    /*
      A CONTAINER WAS OPENED, by openerId. Its clock starts the first time;
      after that the real days since its last opening come off every piece
      that spoils inside it, unless it is cold storage, and plain food is
      named. Applied before the engine sends what is in it.
    */
    function opened(containerId, openerId, now) {
      var entries = api.inventory(containerId);
      if (!entries) { return null; }
      var clock = null;
      try { clock = api.chestClock(containerId); } catch (e) { clock = null; }
      var at = clock && Number(clock.at) > 0 ? Number(clock.at) : now;
      var days = Math.max(0, Math.floor((now - at) / DAY_MS));
      var from = clock && Number(clock.at) > 0 ? Math.max(0, Number(clock.days) || 0) : days;
      var turned = Math.max(0, days - from);
      var cold = false;
      try { cold = !!api.cold(containerId); } catch (e) { cold = false; }
      var spoiling = cold ? 0 : turned - winterDays(at, from, days);
      var res = aged(entries, spoiling);
      if (!same(res.entries, entries) && !api.setInventory(containerId, res.entries)) {
        return null;
      }
      try { api.setChestClock(containerId, { at: at, days: days }); } catch (e) { }
      var line = goneLine(res.gone, 'this chest');
      if (line && openerId) {
        api.say(openerId, 'The ' + line);
      }
      if (res.gone.length) {
        api.log('spoilage:', Number(containerId).toString(16), 'spoiled', JSON.stringify(res.gone), 'after',
                spoiling, 'day(s)');
      }
      return { turned: spoiling, cold: cold, gone: res.gone };
    }

    /*
      How many of a chest's days from+1 to days turned in the winter week:
      day k is the day that ends at at + k days, and it is winter's when the
      moment before it ends is (Patrick, 26 October, B: every chest is cold
      storage in winter). Each winter is a week, so a chest shut for months
      walks one day at a time; that is 365 asks a year, once, on its opening.
    */
    function winterDays(at, from, days) {
      var n = 0;
      for (var k = from + 1; k <= days; k++) {
        var w = false;
        try { w = !!api.winterAt(at + k * DAY_MS - 1); } catch (e) { w = false; }
        if (w) { n++; }
      }
      return n;
    }

    /** What a dish that comes off the pot is called: its full life, or '' for none. */
    function outputName(baseId) {
      var life = lifeOf(baseId);
      return life ? (names[baseId] || 'Food') + ' (' + daysWord(life) + ' left)' : '';
    }

    /*
      A NAMED INPUT THAT IS NOT FOOD WITH ITS DAYS ON IT is refused, with the
      line to say, or '' when every input may be spent. Since fork PR #118 a
      craft may take from a named stack, and only food is meant to be: a
      piece's condition, a house's mold, a woven garment's mark and a dye
      each sit on a name too, and a craft that took one would give back a
      plain piece (a free repair) or lose what the name said.
    */
    function inputRefusal(inputs) {
      if (!Array.isArray(inputs)) { return ''; }
      for (var i = 0; i < inputs.length; i++) {
        var input = inputs[i];
        if (!input || !input.name) { continue; }
        var entry = { baseId: Number(input.baseId) || 0, name: String(input.name) };
        if (ownName(entry)) { continue; }
        return 'Your ' + entry.name + ' cannot go into that. Keep it, or use a plain one.';
      }
      return '';
    }

    /*
      WHAT THE PANEL SHOWS: every stack of raw food that spoils and is not
      preserved, freshest last, with what salting it or smoking it here would
      take, and why a button is missing when it is.
    */
    function view(actorId) {
      var entries = api.inventory(actorId);
      if (!entries) {
        return { open: true, rows: [], note: 'The server cannot read your pack right now. Try again in a moment.' };
      }
      var may = mayPreserve(actorId);
      var salt = heldOf(entries, idOfDesc(table.salt));
      var wood = heldOf(entries, idOfDesc(table.firewood));
      var fire = false;
      try { fire = !!api.fireNear(actorId); } catch (e) { fire = false; }
      var rows = preservableIn(entries).map(function (i) {
        var e = entries[i];
        var left = leftOf(e);
        return { base: e.baseId.toString(16), left: left < 0 ? lifeOf(e.baseId) : left,
                 name: bareName(e), count: Number(e.count) || 0 };
      });
      rows.sort(function (a, b) { return a.left - b.left; });
      return { open: true, may: may, salt: salt, wood: wood, fire: fire, perWood: SMOKE_PER_WOOD, rows: rows };
    }

    /*
      SALTING OR SMOKING ONE STACK. pick is the row the button names: the
      base, the days left and the name. As many of the stack as the salt or
      the firewood carried covers are preserved; the salt or the wood and
      the renaming are one write, so nothing is used when anything is
      refused. Answers { ok, line }.
    */
    function preserve(actorId, how, pick) {
      function no(line) { return { ok: false, line: line }; }
      if (!own(HOW, how)) { return no('Food is salted or smoked.'); }
      if (!mayPreserve(actorId)) {
        return no('Salting and smoking food is a cook\'s work. A Hearthcook or a Confectioner can preserve it for you.');
      }
      var entries = api.inventory(actorId);
      if (!entries) { return no('The server cannot read your pack right now. Try again in a moment.'); }
      pick = pick || {};
      var at = -1;
      var rows = preservableIn(entries);
      for (var r = 0; r < rows.length; r++) {
        var e = entries[rows[r]];
        var left = leftOf(e) < 0 ? lifeOf(e.baseId) : leftOf(e);
        if (e.baseId === pick.baseId && left === Number(pick.left) && bareName(e) === String(pick.name || '')) {
          at = rows[r];
          break;
        }
      }
      if (at < 0) { return no('That food is not in your pack any more.'); }
      var target = entries[at];
      var name = bareName(target);
      var have = Number(target.count) || 0;
      var next = entries.map(copy);
      var n = 0;
      var spent = '';
      if (how === 'salt') {
        var saltId = idOfDesc(table.salt);
        var salt = heldOf(entries, saltId);
        if (!salt) { return no('Salting takes a Salt Pile a piece, and you have none.'); }
        n = Math.min(have, salt);
        takePlain(next, saltId, n);
        spent = n === 1 ? 'a Salt Pile' : n + ' Salt Piles';
      } else {
        var fire = false;
        try { fire = !!api.fireNear(actorId); } catch (e) { fire = false; }
        if (!fire) { return no('Smoking takes a lit fire. Stand at a campfire, a cooking spit or a hearth.'); }
        var woodId = idOfDesc(table.firewood);
        var wood = heldOf(entries, woodId);
        if (!wood) { return no('Smoking takes one Firewood for every ' + SMOKE_PER_WOOD + ' pieces, and you have none.'); }
        n = Math.min(have, wood * SMOKE_PER_WOOD);
        var logs = Math.ceil(n / SMOKE_PER_WOOD);
        takePlain(next, woodId, logs);
        spent = logs === 1 ? 'a Firewood' : logs + ' Firewood';
      }
      var done = withKept(target, HOW[how]);
      done.count = n;
      next[at].count -= n;
      next.push(done);
      next = folded(next);
      if (!api.setInventory(actorId, next)) {
        return no('The pack could not be written. Nothing was used. Try again in a moment.');
      }
      setLine(actorId, next);
      api.log('spoilage:', Number(actorId).toString(16), HOW[how], n, name, 'with', spent);
      return { ok: true, line: (n === 1 ? 'Your ' + name + ' is ' : n + ' of your ' + name + ' are ') + HOW[how] +
                               ' and will not spoil. You used ' + spent + '.' };
    }

    /*
      WHAT THE PANEL AND THE INVENTORY KEY SEND, as the words after
      /preserve. Nothing, the key: draw the panel. 'salt <base in hex> <days
      left> <name>' or 'smoke ...', a row's button: preserve that stack, then
      draw the panel again. Answers the line to say, or '' for none.
    */
    function panel(actorId, words) {
      words = words || [];
      var line = '';
      var how = String(words[0] || '').toLowerCase();
      if (how === 'salt' || how === 'smoke') {
        line = preserve(actorId, how, {
          baseId: parseInt(String(words[1] || ''), 16) || 0,
          left: Number(words[2]),
          name: words.slice(3).join(' ')
        }).line;
      }
      api.show(actorId, view(actorId));
      return line;
    }

    /* SOMETHING WAS PRESSED. A container is a chest clock. */
    function pressed(actorId, refrId, baseDesc, now) {
      if (!api.isContainer(baseDesc)) { return null; }
      return opened(refrId, actorId, now);
    }

    return {
      DAY_MS: DAY_MS, PASS_MS: PASS_MS, GAP_MS: GAP_MS, SMOKE_PER_WOOD: SMOKE_PER_WOOD,
      lifeOf: lifeOf, leftOf: leftOf, keptOf: keptOf, bareName: bareName, ownName: ownName,
      aged: aged, pass: pass, opened: opened, pressed: pressed, outputName: outputName,
      inputRefusal: inputRefusal, view: view, preserve: preserve, panel: panel, mayPreserve: mayPreserve
    };
  }

  g.__thornswoodSpoilageCreate = create;
  if (typeof mp === 'undefined' || !mp) { return; }

  function log() {
    var a = ['[spoilage]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  [PACK_PROPERTY, CHEST_PROPERTY].forEach(function (name) {
    try {
      mp.makeProperty(name, {
        isVisibleByOwner: false, isVisibleByNeighbors: false,
        updateOwner: '', updateNeighbor: ''
      });
    } catch (e) { /* made by an earlier load. harmless. */ }
  });

  /*
    THE PANEL'S VIEW AND THE INVENTORY LINE, seen by their owner only. The
    view goes to the page the way the repair panel's does, and
    game/ui/thornswood-preserve.js draws it; the line is a flag the front
    plugin reads when the inventory opens. at moves on every send, so the
    key pressed again draws the panel again even when nothing in it changed.
  */
  var panelScript = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodPreserveAt === v.at) { return; }',
    '    st.thornswoodPreserveAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodPreserveView=d;" +',
    '      "if(window.thornswoodPreserve&&window.thornswoodPreserve.setData){window.thornswoodPreserve.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  var lineScript = [
    '(function(){',
    '  try { globalThis.thornswoodPreserveLine = !!(ctx.value && ctx.value.on); } catch (e) { }',
    '})();'
  ].join('\n');
  try {
    mp.makeProperty(PANEL_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: panelScript, updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }
  try {
    mp.makeProperty(LINE_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: lineScript, updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }
  var shownAt = 0;
  var lines = {};

  function entriesOf(id) {
    try {
      var inv = mp.get(id, 'inventory');
      return ((inv && inv.entries) || []).map(copy);
    } catch (e) { return null; }
  }

  /*
    The one write into a pack or a chest. Every caller hands back entries it
    has just read from the same place: food renamed for its days or its
    preserving, food that went off taken away, and the salt or firewood a
    cook used.
  */
  function writeInventory(id, entries) {
    try { mp.set(id, 'inventory', { entries: entries }); return true; } catch (e) {
      log('could not write the inventory of', Number(id).toString(16) + ':', e);
      return false;
    }
  }

  var fineToPlain = null;
  function plainOfFine(desc) {
    if (!fineToPlain) {
      fineToPlain = {};
      var fine = (typeof FOOD_GROUPS !== 'undefined' && FOOD_GROUPS && FOOD_GROUPS.quality &&
                  FOOD_GROUPS.quality.fine) || {};
      for (var plain in fine) { if (own(fine, plain)) { fineToPlain[fine[plain]] = plain; } }
    }
    return own(fineToPlain, desc) ? fineToPlain[desc] : '';
  }

  /*
    COLD STORAGE: a chest in one of the season block's snowy climates, or,
    outdoors, above the height the temperature page calls the high
    mountains.
  */
  function cold(containerId) {
    var S = g.__thornswoodSeason;
    if (!S || !S.climateOf || !S.snowy) { return false; }
    if (S.snowy(S.climateOf(containerId, null))) { return true; }
    var cell = '';
    var pos = null;
    try {
      cell = String(mp.get(containerId, 'worldOrCellDesc') || '');
      pos = mp.get(containerId, 'pos');
    } catch (e) { return false; }
    var outdoors = false;
    try { outdoors = !!(typeof WORLDSPACES !== 'undefined' && WORLDSPACES && WORLDSPACES.has && WORLDSPACES.has(cell)); }
    catch (e) { outdoors = false; }
    var z = pos ? Number(typeof pos.length === 'number' ? pos[2] : pos.z) : 0;
    return outdoors && S.high && z > S.high;
  }

  var table = (typeof FOOD_GROUPS !== 'undefined' && FOOD_GROUPS && FOOD_GROUPS.spoil) || {};

  g.__thornswoodSpoilage = create({
    table: table,
    descOf: function (baseId) { return mp.getDescFromId(baseId); },
    idOf: idOf,
    groupOfDesc: function (desc) {
      return (typeof FOOD_GROUPS !== 'undefined' && FOOD_GROUPS && FOOD_GROUPS.items &&
              own(FOOD_GROUPS.items, desc)) ? FOOD_GROUPS.items[desc] : '';
    },
    plainOfFine: plainOfFine,
    inventory: entriesOf,
    setInventory: writeInventory,
    packClock: function (id) { return mp.get(id, PACK_PROPERTY) || null; },
    setPackClock: function (id, c) { mp.set(id, PACK_PROPERTY, c); },
    chestClock: function (id) { return mp.get(id, CHEST_PROPERTY) || null; },
    setChestClock: function (id, c) { mp.set(id, CHEST_PROPERTY, c); },
    cold: cold,
    winterAt: function (t) {
      var S = g.__thornswoodSeason;
      return !!(S && S.seasonAt && S.seasonAt(t) === 'winter');
    },
    isContainer: kindIsContainer,
    stateOf: function (actorId) {
      var C = g.__thornswoodCharacter;
      return (C && C.stateOf) ? C.stateOf(actorId) : null;
    },
    canWork: function (state, half) {
      var P = g.__thornswoodProgression;
      return !!(P && P.canWork && P.canWork(state, half, 'novice'));
    },
    fireNear: function (actorId) {
      var N = g.__thornswoodNeeds;
      return !!(N && N.fireNear && N.fireNear(actorId));
    },
    setLine: function (id, on) {
      if (lines[id] === on) { return; }
      lines[id] = on;
      mp.set(id, LINE_PROPERTY, { on: !!on, at: Date.now() });
    },
    show: function (id, v) {
      var payload = JSON.parse(JSON.stringify(v || { open: false }));
      shownAt = Math.max(Date.now(), shownAt + 1);
      payload.at = shownAt;
      try { mp.set(id, PANEL_PROPERTY, payload); } catch (e) {
        log('could not send the preserve panel to', Number(id).toString(16) + ':', e);
      }
    },
    // On the screen and in the chat, the way a refused craft is told.
    say: function (id, line) {
      try { notify(id, line); } catch (e) { }
      say(id, line);
    },
    log: log
  });

  /*
    THE PASS over every online pack. A character still at creation has a
    pack too, and nothing in it spoils that the pass would not name anyway.
  */
  function passAll() {
    var all = [];
    try { all = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    var now = Date.now();
    for (var i = 0; i < all.length; i++) {
      try { g.__thornswoodSpoilage.pass(all[i], now); } catch (e) {
        log('the pass over', Number(all[i]).toString(16), 'threw:', e);
      }
    }
  }
  if (g.__thornswoodSpoilTimer) { try { clearInterval(g.__thornswoodSpoilTimer); } catch (e) { } }
  g.__thornswoodSpoilTimer = setInterval(passAll, PASS_MS);
})();
// ==== end thornswood spoilage ====

