// ==== thornswood trade ====
/*
  ============================================================================
  TRADING, BECAUSE THE MOD THAT USED TO DO IT IS NOT HERE.

  Patrick, 22 September: "Currently the looking at people doesnt have the
  trade menu and when it did you had to use youyr cursor and a bunch of other
  bs I just want to press a key while looking at them."

  The menu he remembers was an add-on of the old multiplayer mod. The launcher
  carried six key bindings for it in Keys.cs, writing into that add-on's ini
  under Data\SKSE\Plugins, and neither that file nor the DLL is
  anywhere in this build; checked 23 September. So those rows have been
  setting keys in a file nobody reads, which is why looking at somebody does
  nothing, and the cursor he remembers was that mod's mouse menu.

  WHAT A TRADE IS HERE. Two people, each with a pile they are offering, each
  with a gold amount, and two confirmations. Nothing moves until both sides
  have said yes to the pile in front of them, and CHANGING YOUR OFFER TAKES
  BOTH CONFIRMATIONS BACK, which is the one rule that makes a trade safe: the
  thing you agreed to is the thing you get.

  THE SERVER OWNS THE PILES AND NEVER THE CLIENT. An offer is a list of
  pieces (a base id and everything its entry carries beside it, #1718) and
  counts held here, checked against the real inventory at the moment
  of the swap rather than at the moment of the offer, so somebody who drops
  the sword they offered simply fails the check. The client draws what the
  server says the piles are.

  WHY NOT A CONTAINER. Skyrim's own barter and container menus are the
  client's, and this server cannot drive them: the whole reason the chopping
  block needed a plugin is that the engine's menus do not report to the
  gamemode. A panel of our own is the same choice the K menu made.
  ============================================================================
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  function tlog() {
    var a = ['[thornswood trade]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var TRADE_PROPERTY = 'thornswoodTrade';

  var TRADE = {
    // How far apart two people can be and still be trading. A trade that
    // carries on across Skyrim is a post office.
    reach: 700,
    // How long a trade stands with nobody touching it.
    idleFor: 180000,
    // How often the open trades are checked over.
    every: 2000,
    // The most lines one side can offer, so a panel stays a panel.
    mostLines: 24
  };

  /*
    Every open trade, by the two actor ids in it. In memory: a trade is a
    conversation, and one that survived a restart would be two people holding
    piles neither of them remembers offering.
  */
  var open = {};      // actorId -> trade
  var trades = [];    // the same objects, for the tick

  function nameOf(actorId) {
    var soc = g.__thornswoodSocial;
    if (soc && soc.nameOfPerson) { return soc.nameOfPerson(actorId); }
    return 'somebody';
  }

  function tradeOf(actorId) { return open[actorId] || null; }

  function other(t, actorId) { return t.a === actorId ? t.b : t.a; }
  function sideOf(t, actorId) { return t.a === actorId ? t.offerA : t.offerB; }
  function okOf(t, actorId) { return t.a === actorId ? t.okA : t.okB; }

  function setOk(t, actorId, v) {
    if (t.a === actorId) { t.okA = v; } else { t.okB = v; }
  }

  /*
    Any change to either pile takes BOTH confirmations back.

    This is the whole safety of the thing. Without it, one side confirms, the
    other quietly swaps a daedric sword for an iron one and confirms, and the
    swap goes through on an agreement that no longer describes what is in the
    piles.
  */
  function unconfirm(t) { t.okA = false; t.okB = false; t.at = Date.now(); }

  function begin(aActor, bActor) {
    if (open[aActor]) { return 'You are already trading.'; }
    if (open[bActor]) { return 'They are already trading.'; }
    if (!within(aActor, bActor)) { return 'You are too far apart.'; }
    var t = {
      a: aActor, b: bActor,
      offerA: [], offerB: [], goldA: 0, goldB: 0,
      okA: false, okB: false, at: Date.now(),
      // The company worker buying, when it is a sale out of Skyrim (#1393).
      sale: 0,
      // The number the panel names each piece by, for this trade (#1718).
      keys: {}, pieces: []
    };
    open[aActor] = t; open[bActor] = t;
    trades.push(t);
    push(t);
    try {
      say(aActor, 'Trading with ' + nameOf(bActor) + '.');
      say(bActor, 'Trading with ' + nameOf(aActor) + '.');
    } catch (e) { }
    return '';
  }

  function within(aActor, bActor) {
    try {
      var ca = String(mp.get(aActor, 'worldOrCellDesc') || '');
      var cb = String(mp.get(bActor, 'worldOrCellDesc') || '');
      if (!ca || ca !== cb) { return false; }
      var pa = mp.get(aActor, 'pos'), pb = mp.get(bActor, 'pos');
      if (!pa || !pb) { return false; }
      var dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
      return (dx * dx + dy * dy + dz * dz) <= (TRADE.reach * TRADE.reach);
    } catch (e) { return false; }
  }

  function close(t, why) {
    delete open[t.a]; delete open[t.b];
    var at = trades.indexOf(t);
    if (at !== -1) { trades.splice(at, 1); }
    sendView(t.a, { open: false });
    sendView(t.b, { open: false });
    if (why) {
      try { say(t.a, why); say(t.b, why); } catch (e) { }
    }
  }

  /** How many of one base id somebody is actually holding. */
  function holding(actorId, baseId) {
    try {
      var inv = mp.get(actorId, 'inventory');
      var entries = (inv && inv.entries) || [];
      var n = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].baseId === baseId) { n += (entries[i].count || 1); }
      }
      return n;
    } catch (e) { return 0; }
  }

  /** How many of one piece (pieceOf, below) somebody is actually holding (#1718). */
  function holdingPiece(actorId, piece) {
    try {
      var inv = mp.get(actorId, 'inventory');
      var entries = (inv && inv.entries) || [];
      var n = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] && pieceOf(entries[i]) === piece) { n += (entries[i].count || 1); }
      }
      return n;
    } catch (e) { return 0; }
  }

  /*
    What somebody is carrying, as the panel needs it: one line per piece
    (below, #1718), under the piece's own name or the espm record's.

    NOT A CACHE. An inventory changes constantly and a stale list in a trade
    panel is how somebody offers a thing they no longer have.
  */
  /*
    A name somebody can read.

    Skyrim.esm and the DLCs are localized. A FULL field there is not a name:
    it is a four byte index into the strings file. String() of those bytes is
    a row of numbers, which is what the trade list was showing. A FULL is
    used only when it is real text. Otherwise the editor id is spaced out
    (SteelSword becomes Steel Sword). A string index is never shown.
  */
  function fieldText(data) {
    if (typeof data === 'string') {
      var s = data.replace(/\0/g, '').trim();
      if (!s || !/[A-Za-z]/.test(s) || /^[\d,.\s]+$/.test(s)) { return ''; }
      return s;
    }
    if (!data || typeof data.length !== 'number') { return ''; }
    var text = '';
    for (var b = 0; b < data.length; b++) {
      var n = Number(data[b]);
      if (!n) { break; }
      if (n < 32 || n > 126) { return ''; }
      text += String.fromCharCode(n);
    }
    if (!text || !/[A-Za-z]/.test(text) || /^[\d,.\s]+$/.test(text)) { return ''; }
    return text;
  }

  function prettyName(s) {
    s = String(s || '').replace(/[_\-]+/g, ' ').trim();
    if (!s) { return ''; }
    if (s.indexOf(' ') < 0) {
      s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\d+$/g, '').trim();
    }
    return s.replace(/\s+/g, ' ');
  }

  var KIND_NAMES = {
    WEAP: 'Weapons', ARMO: 'Armor and clothes', AMMO: 'Ammunition',
    ALCH: 'Potions and food', INGR: 'Ingredients', BOOK: 'Books and notes',
    KEYM: 'Keys', MISC: 'Miscellaneous', SLGM: 'Soul gems', SCRL: 'Scrolls',
    LIGH: 'Lights'
  };

  var nameCache = {};
  function labelOf(baseId) {
    if (Object.prototype.hasOwnProperty.call(nameCache, baseId)) { return nameCache[baseId]; }
    var label = '';
    var edid = '';
    try {
      var res = mp.lookupEspmRecordById(baseId);
      var rec = res && res.record;
      if (rec) {
        if (rec.editorId) { edid = fieldText(rec.editorId) || String(rec.editorId); }
        var fields = rec.fields || [];
        for (var i = 0; i < fields.length; i++) {
          if (!fields[i]) { continue; }
          var t = String(fields[i].type || '');
          if (t === 'FULL' && !label) { label = fieldText(fields[i].data); }
          else if (t === 'EDID' && !edid) { edid = fieldText(fields[i].data); }
        }
      }
    } catch (e) { }
    if (!label && edid) { label = prettyName(edid); }
    if (!label) { label = 'Unknown item'; }
    nameCache[baseId] = label;
    return label;
  }

  function categoryOf(baseId) {
    var GOLD = (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F;
    if (Number(baseId) === GOLD) { return 'Gold'; }
    var type = '';
    try {
      var res = mp.lookupEspmRecordById(baseId);
      if (res && res.record && res.record.type) { type = String(res.record.type); }
    } catch (e) { type = ''; }
    return KIND_NAMES[type] || 'Other';
  }

  /*
    ONE LINE A PIECE (#1718). Two entries of one record that differ in any
    extra the engine keeps (EXTRA, further down) are two things: a key to
    Breezehome and a key to Honeyside, a sword at 85% and a plain one, an
    enchanted dagger and a plain one. This used to add every entry of a base
    into one line under the record's name, so nobody could choose which of
    them went, the person agreeing saw "Key" or "Iron Sword", and the swap
    took whichever came first in the pack. A line is a piece now: the record
    and every extra, under the entry's own name, and the piece rides on the
    offer to the swap, which moves exactly that piece. Being worn is not part
    of a piece; it belongs to whoever wears it (withCount).
  */
  function pieceOf(entry) {
    var key = [Number(entry.baseId)];
    for (var i = 0; i < EXTRA.length; i++) {
      var v = entry[EXTRA[i]];
      key.push(v === undefined ? null : v);
    }
    return JSON.stringify(key);
  }

  /*
    A piece's name: its own (the house on a key, the condition on a piece, a
    Master-Woven garment's), or the record's. An enchantment, a poison, a
    soul or a temper is not written on a name, so it is said after it in
    brackets, or an enchanted dagger and a plain one would read the same to
    the person agreeing to one of them.
  */
  var SOULS = ['', 'Petty', 'Lesser', 'Common', 'Greater', 'Grand'];
  function pieceName(entry) {
    var n = fieldText(typeof entry.name === 'string' ? entry.name : '') || labelOf(Number(entry.baseId));
    var also = [];
    if (entry.enchantmentId) { also.push('enchanted'); }
    if (entry.poisonId) { also.push('poisoned'); }
    if (SOULS[entry.soul]) { also.push(SOULS[entry.soul] + ' soul'); }
    if (entry.health > 1) { also.push('tempered'); }
    return also.length ? n + ' (' + also.join(', ') + ')' : n;
  }

  function carrying(actorId) {
    var out = [];
    try {
      var inv = mp.get(actorId, 'inventory');
      var entries = (inv && inv.entries) || [];
      var GOLD = (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F;
      var byPiece = {};
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.baseId || Number(e.baseId) === GOLD || questItemBlocked(Number(e.baseId))) { continue; }
        var piece = pieceOf(e);
        if (Object.prototype.hasOwnProperty.call(byPiece, piece)) {
          byPiece[piece].c += (e.count || 1);
          continue;
        }
        byPiece[piece] = { id: Number(e.baseId), x: piece, n: pieceName(e), c: e.count || 1,
                           k: categoryOf(Number(e.baseId)) };
        out.push(byPiece[piece]);
      }
      out.sort(function (l, r) { return l.n.toLowerCase() < r.n.toLowerCase() ? -1 : 1; });
    } catch (e) { }
    return out;
  }

  /*
    The panel names a piece by the number this trade gives it (#1718), never
    by its name: two pieces can read the same, and a name is split on its
    spaces on the way through a line. A piece keeps its number for the whole
    trade and no other piece is ever given it, so a button pressed while a
    pack changes under it still means the piece it was drawn for.
  */
  function keyOf(t, piece) {
    if (!Object.prototype.hasOwnProperty.call(t.keys, piece)) {
      t.pieces.push(piece);
      t.keys[piece] = t.pieces.length;
    }
    return t.keys[piece];
  }

  /* The piece a panel button names, '#' and its number, or '' for none. */
  function pieceAt(t, want) {
    var m = /^#(\d+)$/.exec(String(want));
    var n = m ? Number(m[1]) : 0;
    return n >= 1 && n <= t.pieces.length ? t.pieces[n - 1] : '';
  }

  /*
    Put something on your side: the piece a panel button names (pieceAt), or
    by name or by hex base id.
  */
  function add(actorId, what, count) {
    var t = tradeOf(actorId);
    if (!t) { return 'You are not trading.'; }
    var want = String(what || '').trim().toLowerCase();
    if (!want) { return 'Add what?'; }
    var have = carrying(actorId);
    var byKey = want.charAt(0) === '#';
    var piece = byKey ? pieceAt(t, want) : '';
    var asId = parseInt(want, 16);
    var hit = null;
    for (var i = 0; i < have.length; i++) {
      if (byKey ? have[i].x === piece
                : ((isFinite(asId) && have[i].id === asId) || have[i].n.toLowerCase() === want)) {
        hit = have[i]; break;
      }
    }
    if (!hit && !byKey) {
      for (var j = 0; j < have.length; j++) {
        if (have[j].n.toLowerCase().indexOf(want) !== -1) { hit = have[j]; break; }
      }
    }
    if (!hit) { return 'You are not carrying that.'; }

    var n = Math.floor(Number(count) || 1);
    if (!(n > 0)) { n = 1; }
    if (n > hit.c) { n = hit.c; }

    var side = sideOf(t, actorId);
    for (var k = 0; k < side.length; k++) {
      if (side[k].x === hit.x) {
        var room = hit.c - side[k].c;
        if (room <= 0) { return 'That is all of them already.'; }
        side[k].c += Math.min(n, room);
        unconfirm(t); push(t);
        return '';
      }
    }
    if (side.length >= TRADE.mostLines) { return 'That is as much as one side can offer.'; }
    side.push({ id: hit.id, x: hit.x, n: hit.n, c: n });
    unconfirm(t); push(t);
    return '';
  }

  function remove(actorId, what, count) {
    var t = tradeOf(actorId);
    if (!t) { return 'You are not trading.'; }
    var want = String(what || '').trim().toLowerCase();
    var side = sideOf(t, actorId);
    var n = Math.floor(Number(count) || 0);
    for (var i = 0; i < side.length; i++) {
      if (want.charAt(0) === '#' ? side[i].x === pieceAt(t, want)
          : (side[i].n.toLowerCase().indexOf(want) !== -1 ||
             String(side[i].id) === want || side[i].id.toString(16) === want)) {
        if (n > 0 && side[i].c > n) { side[i].c -= n; }
        else { side.splice(i, 1); }
        unconfirm(t); push(t);
        return '';
      }
    }
    return 'That is not on your side.';
  }

  function gold(actorId, n) {
    var t = tradeOf(actorId);
    if (!t) { return 'You are not trading.'; }
    var want = Math.floor(Number(n) || 0);
    if (!(want >= 0)) { want = 0; }
    var GOLD = (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F;
    var have = holding(actorId, GOLD);
    if (want > have) { return 'You only have ' + have + '.'; }
    if (t.a === actorId) { t.goldA = want; } else { t.goldB = want; }
    unconfirm(t); push(t);
    return '';
  }

  /*
    A SALE OUT OF SKYRIM, #1393, docs/systems/trading-company.md. At a company
    event somebody sells a thing out of Skyrim, and the company buys it
    through a worker. Patrick, 4 Oct: no chat commands for anything people
    do. So it is this panel: the two open an ordinary trade with the key, and
    the worker presses Buy for the company. Then what the other person puts
    up leaves the world instead of crossing, and the gold the worker puts up
    is the price the two of them agree, split by the property block's
    saleCuts (saleSwap). Pressing it again makes it an ordinary trade. Either
    way both agreements are taken back, the same as any change to a pile.

    Only a worker the company has taken on presses it: the property block's
    inCompany, the Discord role an application leads to, or an admin testing
    the chain.
  */
  function companyOf(actorId) {
    var pr = g.__thornswoodProperty;
    var pid = 0;
    try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
    return !!(pid && pr && pr.inCompany && pr.inCompany(pid));
  }

  function sale(actorId) {
    var t = tradeOf(actorId);
    if (!t) { return 'You are not trading.'; }
    if (t.sale === actorId) {
      t.sale = 0;
      unconfirm(t); push(t);
      try { say(other(t, actorId), nameOf(actorId) + ' is not buying for the company now. It is an ordinary trade.'); }
      catch (e) { }
      return '';
    }
    if (t.sale) { return nameOf(t.sale) + ' is already buying for the company.'; }
    if (!companyOf(actorId)) {
      return 'Only somebody the Free Skyrim Trading Company has taken on buys for it. It is an application, in Discord.';
    }
    t.sale = actorId;
    unconfirm(t); push(t);
    try {
      say(other(t, actorId), nameOf(actorId) + ' is buying for the Free Skyrim Trading Company. ' +
          'What you put up leaves Skyrim and does not come back.');
    } catch (e2) { }
    return '';
  }

  /* The split of the price as the panel shows it to either side. */
  function saleView(t, actorId) {
    var pr = g.__thornswoodProperty;
    var price = t.sale === t.a ? t.goldA : t.goldB;
    var cuts = (pr && pr.saleCuts && pr.saleCuts(price)) || { price: price, worker: 0, gone: 0, seller: price };
    return { mine: t.sale === actorId, worker: nameOf(t.sale), price: cuts.price,
             cut: cuts.worker, gone: cuts.gone, seller: cuts.seller };
  }

  function confirm(actorId) {
    var t = tradeOf(actorId);
    if (!t) { return 'You are not trading.'; }
    if (okOf(t, actorId)) { return 'You have already agreed.'; }
    setOk(t, actorId, true);
    push(t);
    var them = other(t, actorId);
    if (!(t.okA && t.okB)) {
      try { say(them, nameOf(actorId) + ' has agreed. Agree on the trade when you are ready.'); } catch (e) { }
      return '';
    }
    return swap(t);
  }

  /*
    The swap, and everything that can refuse it is asked HERE rather than when
    the offer was made.

    Somebody can drop, sell or break a thing between offering it and agreeing
    to it, so the piles are checked against the real inventories at this
    moment and a trade that no longer works is refused whole. Never half: a
    half done trade is somebody's sword gone with nothing back for it.
  */
  function swap(t) {
    if(t.offerA.concat(t.offerB).some(function(row){return questItemBlocked(row.id);})) {
      unconfirm(t);push(t);return 'Quest items stay with their assigned work.';
    }
    if (!within(t.a, t.b)) {
      unconfirm(t); push(t);
      return 'You have moved too far apart.';
    }
    if (t.sale) { return saleSwap(t); }
    var GOLD = (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F;

    var sides = [
      { from: t.a, to: t.b, items: t.offerA, gold: t.goldA },
      { from: t.b, to: t.a, items: t.offerB, gold: t.goldB }
    ];
    var i, j;
    for (i = 0; i < sides.length; i++) {
      var s = sides[i];
      if (s.gold > holding(s.from, GOLD)) {
        unconfirm(t); push(t);
        return nameOf(s.from) + ' does not have that gold any more.';
      }
      for (j = 0; j < s.items.length; j++) {
        if (s.items[j].c > holdingPiece(s.from, s.items[j].x)) {
          unconfirm(t); push(t);
          return nameOf(s.from) + ' does not have the ' + s.items[j].n + ' any more.';
        }
      }
    }

    /*
      Both inventories are rewritten whole, in one write each, rather than
      item by item. A write per item is a chance to be interrupted halfway
      with one pile gone, and giveItems in the outer file already learned that
      lesson for the starting kit.
    */
    var movedOk = true;
    for (i = 0; i < sides.length && movedOk; i++) {
      var side = sides[i];
      var pairs = [];
      for (j = 0; j < side.items.length; j++) {
        pairs.push([side.items[j].id, side.items[j].c, side.items[j].x]);
      }
      if (side.gold > 0) { pairs.push([GOLD, side.gold]); }
      if (!pairs.length) { continue; }
      if (!moveById(side.from, side.to, pairs)) { movedOk = false; }
    }
    if (!movedOk) {
      unconfirm(t); push(t);
      return 'Something went wrong moving it. Nothing was taken.';
    }

    var whatA = describe(t.offerA, t.goldA);
    var whatB = describe(t.offerB, t.goldB);
    try {
      say(t.a, 'Traded. You gave ' + whatA + ' and got ' + whatB + '.');
      say(t.b, 'Traded. You gave ' + whatB + ' and got ' + whatA + '.');
    } catch (e) { }
    tlog(nameOf(t.a), 'and', nameOf(t.b), 'traded:', whatA, 'for', whatB);
    close(t, '');
    return '';
  }

  /*
    The company's swap (#1393). Everything is asked again here, the same as
    swap: the worker still buys for the company, the worker's side is gold
    and nothing else, the seller's side is things and no gold, and each
    still holds what they put up. Then one write each (saleById): the things
    out of the seller's pack and out of the world with the seller's share
    in, and the price less the worker's own cut out of the worker's pack.
    The 10% that leaves is in neither pack. Never half.
  */
  function saleSwap(t) {
    var GOLD = (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F;
    var pr = g.__thornswoodProperty;
    var worker = t.sale;
    var seller = other(t, worker);
    var price = worker === t.a ? t.goldA : t.goldB;
    var asked = seller === t.a ? t.goldA : t.goldB;
    var things = sideOf(t, seller);
    function refuse(why) { unconfirm(t); push(t); return why; }
    if (!pr || !pr.saleCuts) { return refuse('That is not running on this server.'); }
    if (!companyOf(worker)) { return refuse(nameOf(worker) + ' cannot buy for the company now.'); }
    if (sideOf(t, worker).length) {
      return refuse('The company pays in gold. ' + nameOf(worker) + ' takes their things off the table.');
    }
    if (asked > 0) { return refuse('Only the company pays in a sale. ' + nameOf(seller) + ' takes their gold off the table.'); }
    if (!things.length) { return refuse(nameOf(seller) + ' has put up nothing to sell.'); }
    if (!(price > 0)) { return refuse(nameOf(worker) + ' has put up no gold for it.'); }
    if (price > holding(worker, GOLD)) { return refuse(nameOf(worker) + ' does not have that gold any more.'); }
    for (var i = 0; i < things.length; i++) {
      if (things[i].c > holdingPiece(seller, things[i].x)) {
        return refuse(nameOf(seller) + ' does not have the ' + things[i].n + ' any more.');
      }
    }
    var cuts = pr.saleCuts(price);
    if (!cuts) { return refuse('The company\'s terms are not loaded on this server. Say so in the dev channel.'); }
    var cost = cuts.price - cuts.worker;
    if (!saleById(seller, worker, things, cuts.seller, cost)) {
      return refuse('Something went wrong moving it. Nothing was taken.');
    }
    var what = describe(things, 0);
    var me = nameOf(worker), them = nameOf(seller);
    try {
      say(seller, 'Sold to the Free Skyrim Trading Company for ' + cuts.price + ' gold. ' + what +
          ' left Skyrim. ' + (cuts.worker
            ? 'You receive ' + cuts.seller + ': ' + cuts.worker + ' went to ' + me + ' for handling it, and ' +
              cuts.gone + ' left the world.'
            : 'Under 10 gold nothing is cut, and you receive the whole ' + cuts.price + '.'));
      say(worker, 'Bought for the company at ' + cuts.price + ' gold. ' + what + ' left Skyrim. ' + (cuts.worker
            ? 'It cost you ' + cost + ': your ' + cuts.worker + ' for handling it stays with you, ' + cuts.gone +
              ' left the world, and ' + them + ' received ' + cuts.seller + '.'
            : 'Under 10 gold nothing is cut: ' + them + ' received the whole ' + cuts.price + '.'));
    } catch (e) { }
    tlog(me, 'bought', them + '\'s', what, 'for the company at', cuts.price, 'gold:', cuts.seller, 'to the seller,',
         cuts.worker, 'to the worker,', cuts.gone, 'destroyed, and the things left the world');
    close(t, '');
    return '';
  }

  /*
    A pack's entries less [baseId, count] pairs, or null when they are not
    all there. A pair with a piece, [baseId, count, piece], takes only that
    piece (#1718). An entry that is only partly taken keeps everything else
    it had.
  */
  function withoutPairs(entries, pairs) {
    var out = entries.slice();
    for (var i = 0; i < pairs.length; i++) {
      var baseId = pairs[i][0], left = pairs[i][1], piece = pairs[i][2];
      for (var k = 0; k < out.length && left > 0; k++) {
        if (!out[k] || out[k].baseId !== baseId) { continue; }
        if (piece && pieceOf(out[k]) !== piece) { continue; }
        var had = out[k].count || 1;
        var take = Math.min(left, had);
        var rest = {};
        for (var f in out[k]) { if (Object.prototype.hasOwnProperty.call(out[k], f)) { rest[f] = out[k][f]; } }
        rest.count = had - take;
        out[k] = rest;
        left -= take;
      }
      if (left > 0) { return null; }
    }
    var keep = [];
    for (var j = 0; j < out.length; j++) {
      if (out[j] && (out[j].count || 0) > 0) { keep.push(out[j]); }
    }
    return keep;
  }

  /*
    A company sale's two packs, one write each, or nothing at all (#1393).
    The seller's: the things out, and out of the world, and their share in.
    The worker's: the price less their own cut out. Gold in the seller's
    pack goes up by less than the worker's goes down; the difference is the
    10% that leaves the server.
  */
  function saleById(sellerActor, workerActor, things, share, cost) {
    if(things.some(function(row){return questItemBlocked(row.id);}))return false;
    var GOLD = (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F;
    var sellerInv, workerInv;
    try {
      sellerInv = mp.get(sellerActor, 'inventory') || { entries: [] };
      workerInv = mp.get(workerActor, 'inventory') || { entries: [] };
    } catch (e) { return false; }
    var pairs = [];
    for (var i = 0; i < things.length; i++) { pairs.push([things[i].id, things[i].c, things[i].x]); }
    var gone = withoutPairs((sellerInv.entries || []).slice(), pairs);
    var paid = withoutPairs((workerInv.entries || []).slice(), [[GOLD, cost]]);
    if (!gone || !paid || !(share > 0) || !(cost >= share)) { return false; }
    var landed = false;
    for (var k = 0; k < gone.length; k++) {
      if (gone[k] && gone[k].baseId === GOLD && !gone[k].worn) {
        gone[k] = { baseId: GOLD, count: (gone[k].count || 1) + share };
        landed = true;
        break;
      }
    }
    if (!landed) { gone.push({ baseId: GOLD, count: share }); }
    try {
      mp.set(sellerActor, 'inventory', { entries: gone });
      mp.set(workerActor, 'inventory', { entries: paid });
    } catch (e2) { return false; }
    return true;
  }

  function describe(items, goldN) {
    var bits = [];
    for (var i = 0; i < items.length; i++) {
      bits.push(items[i].c > 1 ? (items[i].c + ' ' + items[i].n) : items[i].n);
    }
    if (goldN > 0) { bits.push(goldN + ' gold'); }
    return bits.length ? bits.join(', ') : 'nothing';
  }

  /*
    WHAT A STACK CARRIES BESIDE ITS BASE AND COUNT (#1594). The engine keeps
    an extra on every inventory entry (Inventory::ExtraData in the fork) and
    reads and writes it as fields on the entry, beside baseId and count. A
    key's, a deed's and a mold's house is its name (the property block), a
    piece's condition is written on its name (the durability block), a
    Master-Woven garment is named, and an enchanted piece carries its
    enchantment and charge. The engine keeps all of it through mp.set; what
    used to drop it was moveById writing { baseId, count } back on both
    packs.

    So a piece moves with every field it carries, the rest of a stack it is
    taken from keeps every field it had, and it lands on a stack the
    receiver already holds only when that stack is the same in every field,
    which is how the engine stacks (Inventory::Entry::EqualExceptCount).
    Being worn belongs to whoever wears it, so a piece arrives not worn.
  */
  var EXTRA = ['health', 'enchantmentId', 'maxCharge', 'removeEnchantmentOnUnequip',
               'chargePercent', 'name', 'soul', 'poisonId', 'poisonCount'];

  /* One stack to the engine: the same base and extra, worn the same way. */
  function sameStack(a, b) {
    if (!a || !b || a.baseId !== b.baseId) { return false; }
    for (var i = 0; i < EXTRA.length; i++) {
      if (a[EXTRA[i]] !== b[EXTRA[i]]) { return false; }
    }
    return !!a.worn === !!b.worn && !!a.wornLeft === !!b.wornLeft;
  }

  /* An entry at another count, carrying all it carried. Handed over, it is not worn any more. */
  function withCount(entry, count, handedOver) {
    var out = {};
    for (var f in entry) {
      if (!Object.prototype.hasOwnProperty.call(entry, f)) { continue; }
      if (handedOver && (f === 'worn' || f === 'wornLeft')) { continue; }
      out[f] = entry[f];
    }
    out.count = count;
    return out;
  }

  /* Pieces into a pack: onto the stack they are the same as, or a stack of their own. */
  function land(into, piece) {
    for (var k = 0; k < into.length; k++) {
      if (sameStack(into[k], piece)) {
        into[k] = withCount(into[k], (into[k].count || 1) + piece.count, false);
        return;
      }
    }
    into.push(piece);
  }

  /*
    Move [baseId, count] pairs from one pack to another, or nothing at all,
    each piece with everything it carries (above). A pair with a piece,
    [baseId, count, piece], moves only that piece: the one the trade put up
    (#1718). Gold is a pair without one.
  */
  function moveById(fromActor, toActor, pairs) {
    if(pairs.some(function(pair){return questItemBlocked(pair[0]);}))return false;
    var fromInv, toInv;
    try {
      fromInv = mp.get(fromActor, 'inventory') || { entries: [] };
      toInv = mp.get(toActor, 'inventory') || { entries: [] };
    } catch (e) { return false; }
    var out = (fromInv.entries || []).slice();
    var into = (toInv.entries || []).slice();

    var i, k;
    for (i = 0; i < pairs.length; i++) {
      var baseId = pairs[i][0], left = pairs[i][1], piece = pairs[i][2];
      var moving = [];
      for (k = 0; k < out.length && left > 0; k++) {
        if (!out[k] || out[k].baseId !== baseId) { continue; }
        if (piece && pieceOf(out[k]) !== piece) { continue; }
        var had = out[k].count || 1;
        var take = Math.min(left, had);
        moving.push(withCount(out[k], take, true));
        out[k] = withCount(out[k], had - take, false);
        left -= take;
      }
      if (left > 0) { return false; }
      for (k = 0; k < moving.length; k++) { land(into, moving[k]); }
    }
    var keep = [];
    for (i = 0; i < out.length; i++) {
      if (out[i] && (out[i].count || 0) > 0) { keep.push(out[i]); }
    }
    try {
      mp.set(fromActor, 'inventory', { entries: keep });
      mp.set(toActor, 'inventory', { entries: into });
    } catch (e2) { return false; }
    return true;
  }

  function cancel(actorId) {
    var t = tradeOf(actorId);
    if (!t) { return 'You are not trading.'; }
    close(t, nameOf(actorId) + ' called the trade off.');
    return '';
  }

  // ------------------------------------------------------------ the panel --

  /* Lines as the panel draws them: each piece by its number (keyOf), not the piece itself. */
  function shown(t, lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      out.push({ id: lines[i].id, p: keyOf(t, lines[i].x), n: lines[i].n, c: lines[i].c, k: lines[i].k });
    }
    return out;
  }

  function view(t, actorId) {
    var meA = t.a === actorId;
    return {
      open: true,
      them: nameOf(other(t, actorId)),
      mine: shown(t, meA ? t.offerA : t.offerB),
      theirs: shown(t, meA ? t.offerB : t.offerA),
      myGold: meA ? t.goldA : t.goldB,
      theirGold: meA ? t.goldB : t.goldA,
      iAgreed: meA ? t.okA : t.okB,
      theyAgreed: meA ? t.okB : t.okA,
      pack: shown(t, carrying(actorId)),
      heldGold: holding(actorId, (g.__thornswoodSpoils && g.__thornswoodSpoils.GOLD) || 0x0000000F),
      // A sale out of Skyrim (#1393): the split, and whether this side may
      // press Buy for the company.
      sale: t.sale ? saleView(t, actorId) : null,
      canBuy: (!t.sale || t.sale === actorId) && companyOf(actorId),
      at: Date.now()
    };
  }

  // A fresh browser has no previous view; its ready event asks again (#1275).
  var viewAt = {};
  function sendView(actorId, v) {
    v.at = Math.max(Date.now(), (viewAt[actorId] || 0) + 1);
    try {
      mp.set(actorId, TRADE_PROPERTY, v);
      viewAt[actorId] = v.at;
    } catch (e) { }
  }

  function refresh(actorId) {
    var t = tradeOf(actorId);
    sendView(actorId, t ? view(t, actorId) : { open: false });
  }

  function push(t) {
    refresh(t.a);
    refresh(t.b);
  }

  function panelScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodTradeAt === v.at) { return; }',
      '    st.thornswoodTradeAt = v.at;',
      '    var body = JSON.stringify(v);',
      '    var src = "(function(){try{" +',
      '      "var d=" + body + ";window.thornswoodTradeView=d;" +',
      '      "if(window.thornswoodTrade&&window.thornswoodTrade.setData){window.thornswoodTrade.setData(d);}" +',
      '      "}catch(e){}})();";',
      '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  function tick() {
    var now = Date.now();
    for (var i = trades.length - 1; i >= 0; i--) {
      var t = trades[i];
      if (now - t.at > TRADE.idleFor) { close(t, 'The trade timed out.'); continue; }
      if (!within(t.a, t.b)) { close(t, 'You moved too far apart, so the trade is off.'); continue; }
      var stillA = false, stillB = false;
      try {
        var all = mp.get(0, 'onlinePlayers') || [];
        for (var k = 0; k < all.length; k++) {
          if (all[k] === t.a) { stillA = true; }
          if (all[k] === t.b) { stillB = true; }
        }
      } catch (e) { continue; }
      if (!stillA || !stillB) { close(t, ''); }
    }
  }

  try {
    mp.makeProperty(TRADE_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: panelScript(), updateNeighbor: ''
    });
  } catch (e) { /* already made by a previous load */ }

  if (g.__thornswoodTradeTimer) { try { clearInterval(g.__thornswoodTradeTimer); } catch (e) { } }
  g.__thornswoodTradeTimer = setInterval(guard('tradeTick', tick), TRADE.every);

  g.__thornswoodTrade = {
    TRADE: TRADE,
    begin: begin, add: add, remove: remove, gold: gold, sale: sale, saleById: saleById,
    confirm: confirm, cancel: cancel, tradeOf: tradeOf,
    carrying: carrying, labelOf: labelOf, within: within,
    view: view, push: push, refresh: refresh, tick: tick, swap: swap, moveById: moveById,
    open: open, trades: trades, describe: describe
  };

  tlog('ready: two piles, two confirmations, and any change takes both back');
})();
// ==== end thornswood trade ====

