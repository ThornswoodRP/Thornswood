'use strict';

var GOLD_BASE = 15;
var REACH = 400;
var SUPPLY_COUNT = 5;
var SUPPLY_WAIT = 6 * 60 * 60 * 1000;
var MAX_GOLD = 2147483647;
var MAX_COUNT = 100000;

var BOOK_HOLD = {
  Whiterun: 'whiterun',
  Haafingar: 'solitude',
  'the Rift': 'riften',
  'the Reach': 'markarth',
  Eastmarch: 'windhelm',
  Falkreath: 'falkreath',
  Hjaalmarch: 'morthal',
  'the Pale': 'dawnstar',
  Winterhold: 'winterhold',
  Solstheim: 'ravenrock'
};

function bookHoldOf(hold) {
  if (!hold || hold === 'no hold') return null;
  return BOOK_HOLD[hold] || null;
}

function loadGuildSites() {
  if (typeof MERCHANT_GUILD_SITES !== 'undefined') return MERCHANT_GUILD_SITES;
  var fs = require('fs');
  var path = require('path');
  var file = path.join(__dirname, 'data', 'guild-sites.json');
  var doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!doc || !Array.isArray(doc.sites) || doc.sites.length !== 10) {
    throw new Error('Each hold needs one guild site.');
  }
  return doc.sites;
}

var GUILD_SITES = loadGuildSites();

function guildSite(bookHold) {
  for (var i = 0; i < GUILD_SITES.length; i++) {
    if (GUILD_SITES[i].bookHold === bookHold) return GUILD_SITES[i];
  }
  return null;
}

var SETTLEMENT = typeof MERCHANT_SETTLEMENT !== 'undefined' ? MERCHANT_SETTLEMENT : require('./merchant-settlement');
var COMMISSION_STATE=typeof MERCHANT_COMMISSION_STATE!=='undefined'?MERCHANT_COMMISSION_STATE:require('./merchant-commission-state');
var COMMISSIONS=typeof MERCHANT_COMMISSIONS!=='undefined'?MERCHANT_COMMISSIONS:require('./merchant-commissions');
var QUEST_TRANSFER = typeof QUEST_TRANSACTIONS !== 'undefined' ? QUEST_TRANSACTIONS : require('./quest-transactions');

function createRolePermissions(places, tables) {
  var roles = ['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist'];
  var directions = ['buy','sell','supply'], compiled = new Map(), bindings = new Map();
  if (tables !== undefined) {
    if (!tables || typeof tables !== 'object' || Array.isArray(tables) ||
        Object.keys(tables).length !== roles.length || roles.some(function (role) {
          return !Object.prototype.hasOwnProperty.call(tables, role);
        })) throw new Error('The six merchant role tables are required.');
    roles.forEach(function (role) {
      var table = tables[role], copy = Object.create(null);
      if (!table || typeof table !== 'object' || Array.isArray(table) || Object.keys(table).length !== 3)
        throw new Error('Invalid merchant role table.');
      directions.forEach(function (direction) {
        var values = table[direction], ids = new Set();
        if (!Object.prototype.hasOwnProperty.call(table,direction) || !Array.isArray(values))
          throw new Error('Each role needs buy, sell and supply permissions.');
        for (var i=0;i<values.length;i++) {
          var id=values[i];
          if (!Number.isInteger(id) || id<=0 || id>=0xff000000 || id===GOLD_BASE || ids.has(id))
            throw new Error('Invalid or duplicate role item permission.');
          ids.add(id);
        }
        copy[direction]=ids;
      });
      copy.supply.forEach(function (id) {
        if (!copy.buy.has(id)) throw new Error('Role supplies must be permitted purchases.');
      });
      copy.role=role;
      compiled.set(role,copy);
    });
  }
  Object.keys(places).forEach(function (reference) {
    var place=places[reference], table=null;
    if (place && Object.prototype.hasOwnProperty.call(place,'role')) {
      table=compiled.get(place.role);
      if (!table) throw new Error('A merchant role requires its verified item tables.');
    }
    bindings.set(reference,table);
  });
  var permits = function (reference,direction,baseId) {
    if (!bindings.has(reference)) return false;
    var table=bindings.get(reference);
    return table===null || table[direction].has(baseId);
  };
  permits.roleOf=function (reference) {
    if (!bindings.has(reference)) return null;
    var table=bindings.get(reference);
    return table===null ? '' : table.role;
  };
  return permits;
}

function createNativeMerchantTransfer(mp) {
  return {
    available: function () {
      return !!mp && ['validateInventoryTransaction','compareAndSetInventory','getInventoryReceipt','getSavedInventoryReceipt',
        'getNpcAIState','getDescFromId','getIdFromDesc','get'].every(function (key) { return typeof mp[key] === 'function'; });
    },
    identity: function (id) {
      var ai = mp.getNpcAIState(id);
      if (!ai || !ai.isHuman || !Number.isInteger(ai.profileId) || ai.profileId <= 0) return null;
      return {desc:mp.getDescFromId(id),profileId:ai.profileId};
    },
    resolve: function (desc) { return mp.getIdFromDesc(desc); },
    inventory: function (id) { return mp.get(id, 'inventory'); },
    validate: function (snapshot) { return mp.validateInventoryTransaction(snapshot); },
    receipt: function (id) { return mp.getInventoryReceipt(id); },
    saved: function (id) { return mp.getSavedInventoryReceipt(id); },
    cas: function (id, expected, receipt, next, sequence, profile) {
      return mp.compareAndSetInventory(id, expected, receipt, next, sequence, profile);
    }
  };
}

function createMerchantTrading(deps) {
  var purses = deps.purses;
  var prices = deps.prices;
  var transfer = deps.transfer;
  var world = deps.world;
  // An entry the server made into something else on a plain record (a hair
  // dye on the Bowl, #2675) is neither counted nor taken as the plain item.
  var minted = typeof deps.minted === 'function' ? deps.minted : function () { return false; };
  var places = deps.places || {};
  var permits = createRolePermissions(places,deps.roleTables);
  var now = deps.now || function () { return Date.now(); };
  var reach = deps.reach == null ? REACH : deps.reach;
  var sessions = new Map();
  var viewOwners = new WeakMap();
  var sessionSerial = 0;
  /*
    Trades armed and not yet finished, by their settlement's pending id
    (#5419): what to count for the hold and what to tell the person once the
    save storage has acknowledged the transfer, which is always a later tick.
    Bounded like the settlement's own outcomes.
  */
  var awaiting = new Map(), MAX_AWAITING = 4 * SETTLEMENT.MAX_PENDING;
  function tradeSaid(row, gold, purse) {
    return (row.verb === 'buy' ? 'Bought ' : 'Sold ') + row.count + ' ' + row.name + ' for ' + gold + '. Purse ' + purse + '.';
  }
  function countTrade(row) {
    // The pieces that changed hands, for staff's hold economy page (#3164).
    if (typeof deps.traded !== 'function') return;
    try { deps.traded(row); }
    catch (error) { if (typeof deps.log === 'function') deps.log('hold economy count failed: ' + error); }
  }
  function await_(pendingId, entry) {
    awaiting.delete(pendingId);
    awaiting.set(pendingId, entry);
    while (awaiting.size > MAX_AWAITING) awaiting.delete(awaiting.keys().next().value);
  }
  // Each awaited transfer the settlement finished: counted, and its words left on its session's panel.
  function settleAwaited() {
    Array.from(awaiting.entries()).forEach(function (entry) {
      var how = typeof settlement.outcome === 'function' ? settlement.outcome(entry[0]) : null;
      if (!how) return;
      awaiting.delete(entry[0]);
      var done = entry[1], state = purses.read(done.merchantId);
      if (how === 'done' && done.counted) countTrade(done.counted);
      var note = how === 'done' ? done.said(state) : done.released;
      if (sessions.get(done.profileId) === done.session) { done.session.note = note; done.session.view = null; }
    });
  }
  var settlement = SETTLEMENT.createSettlement({purses:purses,transfer:transfer,world:deps.namespace || purses.namespace,log:deps.log,now:now});
  var retirementRequired=deps.retirementRequired===true;
  var active = deps.suspended !== true && !retirementRequired, closed = false;
  var commissions=COMMISSIONS.createCommissions({rows:deps.commissions||[],purses:purses,transfer:transfer,prices:prices,
    resolve:deps.resolve,eligible:deps.commissionEligible,settlement:settlement,addStock:addStock,now:now});

  function placeOf(reference) {
    return places[reference] || null;
  }

  function fail(text, view) {
    return { text: text, view: view || null };
  }

  function stockCopy(stock) { return JSON.parse(JSON.stringify(stock || [])); }
  function addStock(stock, entries, name) {
    entries.forEach(function (entry) {
      var key = SETTLEMENT.metadataKey(entry);
      var row = stock.find(function (held) {
        return held.name === name && SETTLEMENT.metadataKey(held.entry || {baseId:held.baseId,count:held.count}) === key;
      });
      if (row) {
        if (row.count + entry.count > MAX_GOLD) throw new Error('The shelf is full.');
        row.count += entry.count; row.entry = Object.assign({}, entry, {count:row.count});
      } else stock.push({baseId:entry.baseId,count:entry.count,name:name,entry:JSON.parse(JSON.stringify(entry))});
    });
    SETTLEMENT.inventory({entries:stock.map(function (row) { return row.entry || {baseId:row.baseId,count:row.count}; })});
    return stock;
  }
  function takeStock(stock, baseId, name, count) {
    var entries = [], left = count;
    for (var i = 0; i < stock.length && left > 0; i++) {
      var row = stock[i];
      if (row.baseId !== baseId || String(row.name || '').toLowerCase() !== name.toLowerCase()) continue;
      var n = Math.min(row.count, left);
      entries.push(Object.assign({}, row.entry || {baseId:row.baseId}, {count:n}));
      row.count -= n; left -= n;
      if (row.entry) row.entry.count = row.count;
    }
    if (left) throw new Error('The shelf is empty.');
    return {stock:stock.filter(function (row) { return row.count > 0; }),entries:entries};
  }

  function inReach(humanId, merchantId) {
    var human = world.actor(humanId);
    var merchant = world.actor(merchantId);
    if (!human || !merchant || !human.pos || !merchant.pos) {
      return { ok: false, reason: 'You are not close enough to trade.' };
    }
    if (human.isHuman !== true || !(human.profileId > 0)) {
      return { ok: false, reason: 'Only a person can trade.' };
    }
    if (merchant.isHuman || merchant.profileId > 0) {
      return { ok: false, reason: 'That is not a guild trader.' };
    }
    if (String(human.cell) !== String(merchant.cell) || human.cell == null || human.cell === '') {
      return { ok: false, reason: 'You are not close enough to trade.' };
    }
    var d = Math.hypot(
      human.pos[0] - merchant.pos[0],
      human.pos[1] - merchant.pos[1],
      human.pos[2] - merchant.pos[2]
    );
    if (!(d <= reach)) return { ok: false, reason: 'You are not close enough to trade.' };
    return { ok: true, distance: d, human: human };
  }

  function authed(profileId, human) {
    return Number(profileId) > 0 && Number(profileId) === Number(human.profileId);
  }

  function sessionIdentity(human) {
    if (!human || !human.isHuman || !Number.isSafeInteger(human.profileId) || human.profileId<=0 ||
        typeof human.desc!=='string' || !human.desc || !Number.isSafeInteger(human.lifeGeneration) || human.lifeGeneration<0 ||
        typeof human.runtimeIdentity!=='string' || !/^[1-9][0-9]{0,19}$/.test(human.runtimeIdentity) ||
        human.runtimeIdentity.length===20 && human.runtimeIdentity>'18446744073709551615') return null;
    return JSON.stringify([human.desc,human.profileId,human.lifeGeneration,human.runtimeIdentity]);
  }

  function questView(actorId,merchantId) {
    var quests=typeof deps.quests==='function' && deps.quests();
    return (quests ? quests.describe(actorId,merchantId) : []).concat(commissions.view(actorId,merchantId));
  }

  // A supply wait is keyed by the character's runtime form id (#2870), the
  // one shape every register keeps, never by its formDesc. A human whose
  // formDesc is not a runtime form has no key and cannot supply.
  function supplyKey(human, itemName) {
    var id = COMMISSION_STATE.formIdOf(human && human.desc);
    return id ? JSON.stringify([id, human.profileId, itemName.toLowerCase()]) : '';
  }
  function lastSupply(state, key, itemName) {
    var stamps = state.supply || {};
    // Old item-only stamps cannot be assigned to a character. Keep their
    // original window rather than resetting an unidentified completed supply.
    return Math.max(stamps[key] || 0, stamps[itemName.toLowerCase()] || 0);
  }

  function sessionCurrent(actorId, profileId, session) {
    return active && sessions.get(profileId)===session && !!session && session.actorId===actorId;
  }

  function ownsSession(actorId, profileId, session) {
    var identity = sessionIdentity(world.actor(actorId));
    return sessionCurrent(actorId,profileId,session) && identity === session.identity;
  }

  function closedView(actorId, profileId, session) {
    if (!session) return null;
    if (sessions.get(profileId)===session) sessions.delete(profileId);
    var view={open:false};
    viewOwners.set(view,{actorId:actorId,profileId:profileId,session:undefined,identity:session.identity});
    return view;
  }

  function matchesViewOwner(actorId, view) {
    var owner=view && viewOwners.get(view);
    return active && (!owner || owner.actorId===actorId && sessions.get(owner.profileId)===owner.session);
  }

  function isCurrentView(actorId, view) {
    var owner = view && viewOwners.get(view);
    // Legacy callers can publish their own notices. Controller-produced views
    // retain their owner until the actual property write, including closures.
    if (!owner) return active;
    if (owner.actorId !== actorId) return false;
    if (view.open === false) {
      var identity=sessionIdentity(world.actor(actorId));
      return matchesViewOwner(actorId,view) && identity===owner.identity;
    }
    return ownsSession(actorId, owner.profileId, owner.session);
  }

  function viewFor(merchantId, state, place, actorId, profileId, note, owner) {
    var viewSession = owner ? owner.session : sessions.get(profileId);
    var viewIdentity = owner ? owner.identity : (viewSession && viewSession.identity);
    var catalog = prices.catalog ? prices.catalog(place.bookHold) : [];
    var offers = [], supplyIds = [], availablePurse=COMMISSION_STATE.spendable(state);
    var counts = Object.create(null), packReady = true;
    if (settlement.available()) {
      try {
        SETTLEMENT.inventory(transfer.inventory(actorId)).entries.forEach(function (entry) {
          if (minted(entry)) return;
          counts[entry.baseId] = (counts[entry.baseId] || 0) + entry.count;
        });
      } catch (error) { packReady = false; }
    }
    var canTrade = packReady && !state.pending && settlement.canInventoryMutation(actorId);
    var quotedBuy = false, carriedBuy = false, seen = Object.create(null);
    for (var i = 0; i < catalog.length; i++) {
      var row = catalog[i];
      var resolved = deps.resolve ? deps.resolve(row.name) : null;
      if (!resolved || resolved.error || !resolved.baseId || resolved.baseId === GOLD_BASE) continue;
      var accepts = permits(state.reference,'buy',resolved.baseId);
      var sells = permits(state.reference,'sell',resolved.baseId);
      if (!accepts && !sells) continue;
      var name = row.name, key = String(resolved.name || name).toLowerCase();
      var priceKey = String(name).toLowerCase();
      if (seen[priceKey]) continue;
      seen[priceKey] = true;
      // Price books key their submitted labels. The resolved canonical name
      // identifies inventory and shelf goods, not a different price row.
      var price = prices.quote(place.bookHold, name) || {buy:null,sell:null};
      var buy = accepts && Number.isInteger(price.buy) && price.buy >= 0 && price.buy <= MAX_GOLD ? price.buy : null;
      var sell = sells && Number.isInteger(price.sell) && price.sell >= 0 && price.sell <= MAX_GOLD ? price.sell : null;
      var carried = counts[resolved.baseId] || 0;
      if (buy !== null) quotedBuy = true;
      if (buy !== null && carried > 0) carriedBuy = true;
      var held = (state.stock || []).find(function (entry) {
        return entry.baseId === resolved.baseId && String(entry.name || '').toLowerCase() === key;
      });
      var count = 0;
      var stock = state.stock || [];
      for (var s = 0; s < stock.length; s++) {
        if (stock[s].baseId === resolved.baseId && String(stock[s].name || '').toLowerCase() === key) count += stock[s].count;
      }
      offers.push({
        name: name,
        canonicalName: resolved.name || name,
        buy: buy,
        sell: sell,
        carried: carried,
        maxSell: canTrade && buy !== null ? Math.min(carried, MAX_COUNT, buy === 0 ? MAX_COUNT : Math.floor(availablePurse / buy)) : 0,
        stock: count,
        baseId: held ? held.baseId : null
      });
      supplyIds.push(resolved.baseId);
    }
    var supply = [];
    var human = settlement.available() ? transfer.identity(actorId) : null;
    var owns = human && COMMISSION_STATE.formIdOf(human.desc) && human.profileId === profileId;
    var at = now();
    for (var k = 0; k < offers.length; k++) {
      if (offers[k].buy == null || !permits(state.reference,'supply',supplyIds[k])) continue;
      var pay = offers[k].buy * SUPPLY_COUNT;
      var last = owns ? lastSupply(state, supplyKey(human, offers[k].canonicalName), offers[k].canonicalName) : 0;
      var ready = !!owns && canTrade && availablePurse >= pay && (!last || at - last >= SUPPLY_WAIT);
      supply.push({ name: offers[k].name, pay: pay, unit: offers[k].buy, count: SUPPLY_COUNT, ready: ready });
    }
    var view = {
      open: true,
      transfer: settlement.available(),
      canTrade: canTrade,
      trader: place.name || 'Trader',
      place: place.locationName || '',
      hold: place.bookHold,
      purse: state.purse,
      reservedPurse:state.purse-availablePurse,
      offers: offers,
      sellReason: offers.some(function (offer) { return offer.maxSell > 0; }) ? '' :
        !settlement.available() ? 'Trading is unavailable. Nothing has moved.' :
        !packReady ? 'Your pack could not be read. Nothing has moved.' :
        state.pending ? 'This trader is finishing another trade.' :
        !canTrade ? 'Your inventory is waiting for its saved trade.' :
        !quotedBuy ? 'This trader has no submitted buy prices.' :
        !carriedBuy ? 'You are not carrying anything this trader buys.' :
        'This trader cannot afford the goods you are carrying.',
      supply: supply,
      quests: questView(actorId,merchantId),
      note: note || (settlement.available()
        ? ''
        : 'Buying and selling wait on the native transfer. Nothing has moved.')
    };
    var currentIdentity = viewIdentity ? sessionIdentity(world.actor(actorId)) : null;
    if (!active || sessions.get(profileId) !== viewSession || viewIdentity && currentIdentity !== viewIdentity) return null;
    if (viewSession && viewSession.actorId===actorId) view.sessionId=viewSession.id;
    viewOwners.set(view,{actorId:actorId,profileId:profileId,session:viewSession});
    return view;
  }

  function viewKey(view) {
    var copy = Object.assign({}, view);
    delete copy.at;
    delete copy.note;
    return JSON.stringify(copy);
  }

  function recover() {
    if (!active) return [];
    settlement.tick();
    settleAwaited();
    var views = [];
    Array.from(sessions.entries()).forEach(function (entry) {
      var profileId=entry[0],session=entry[1];
      if (!active || sessions.get(profileId)!==session) return;
      var reached=inReach(session.actorId,session.merchantId);
      if (!active || sessions.get(profileId)!==session) return;
      if (!reached.ok || !authed(profileId,reached.human) || sessionIdentity(reached.human)!==session.identity) {
        sessions.delete(profileId);
        var closed=closedView(session.actorId,profileId,session);
        views.push({actorId:session.actorId,view:closed}); return;
      }
      var state = purses.read(session.merchantId), place = state && placeOf(state.reference);
      if (state && place) {
        var view=viewFor(session.merchantId,state,place,session.actorId,profileId,session.note,{session:session,identity:session.identity});
        var current = sessionIdentity(world.actor(session.actorId));
        if (!active || sessions.get(profileId) !== session) return;
        if (current !== session.identity) {
          sessions.delete(profileId);
          var closed=closedView(session.actorId,profileId,session);
          views.push({actorId:session.actorId,view:closed}); return;
        }
        if (!view) return;
        if (session.view === viewKey(view)) return;
        views.push({actorId:session.actorId,view:view});
      }
    });
    return views.filter(function(result){return isCurrentView(result.actorId,result.view);})
      .filter(function(result){return matchesViewOwner(result.actorId,result.view);});
  }

  function sessionMerchant(profileId) {
    var session = sessions.get(Number(profileId));
    return session ? session.merchantId : 0;
  }

  function command(ctx) {
    if (!active) return fail('Trading is unavailable.');
    var parts = (ctx && ctx.parts) || [];
    var profileId = Number(ctx && ctx.profileId) || 0;
    var actorId = ctx && ctx.actorId;
    var verb = String(parts[1] || '').toLowerCase();
    if (!profileId || !actorId) return fail('You are not in the world yet.');
    var requestSession = sessions.get(profileId);
    if (verb === 'join' || verb === 'dues' || verb === 'fee') {
      return fail('People cannot join the Merchant\'s Guild.');
    }
    if (verb === 'scene') {
      return fail('Scene quests are not paid from a trader\'s purse.');
    }
    if (verb === 'e') {
      var pressed = parseInt(String(parts[2] || ''), 16);
      if (!pressed || (typeof deps.isTrader === 'function' && !deps.isTrader(pressed))) {
        return { text: '', view: null };
      }
      if (!active || sessions.get(profileId)!==requestSession) return {text:'',view:null};
      return command({ actorId: actorId, profileId: profileId, parts: ['/merchant', pressed.toString(16)] });
    }
    if (verb === 'close') {
      sessions.delete(profileId);
      return { text: 'You step back from the trader.', view: closedView(actorId,profileId,requestSession) };
    }
    if (verb === 'refresh') {
      var openId = sessionMerchant(profileId);
      if (!openId) return fail('You are not at a trader.');
      return command({ actorId: actorId, profileId: profileId, parts: ['/merchant', openId.toString(16)] });
    }

    var merchantId = 0;
    if (!verb || verb === 'open' || /^[0-9a-f]+$/i.test(verb)) {
      var token = verb === 'open' ? parts[2] : (verb || '');
      if (!token) return fail('Press E on a guild trader.');
      merchantId = parseInt(token, 16);
      if (!merchantId) return fail('That is not a guild trader.');
      var prior = requestSession;
      var reached = inReach(actorId, merchantId);
      if (!active || sessions.get(profileId)!==prior) return fail('This character is unavailable.');
      if (!reached.ok) return fail(reached.reason, closedView(actorId,profileId,prior));
      if (!authed(profileId, reached.human)) return fail('That request is not yours.');
      var identity=sessionIdentity(reached.human);
      if (!identity) return fail('This character is unavailable.', closedView(actorId,profileId,prior));
      var state = purses.prepare(merchantId);
      if (!active || sessions.get(profileId)!==prior) return fail('This character is unavailable.');
      if (!state) return fail('That is not a guild trader.');
      var place = placeOf(state.reference);
      if (!place || !place.bookHold) {
        return fail('This trader has no hold price list.', closedView(actorId,profileId,prior));
      }
      var repeat = prior && prior.merchantId === merchantId && (now() - prior.at) < 3000;
      var opened = viewFor(merchantId, state, place, actorId, profileId,undefined,{session:prior,identity:identity});
      if (!opened) return {text:'',view:null};
      opened.sessionId=identity+':'+now()+':'+(++sessionSerial);
      var nextSession={ id:opened.sessionId, merchantId: merchantId, actorId:actorId, identity:identity, quests:JSON.stringify(opened.quests), view:viewKey(opened), at: now() };
      var current = sessionIdentity(world.actor(actorId));
      if (!active || sessions.get(profileId) !== prior || current !== identity) return {text:'',view:null};
      sessions.set(profileId,nextSession);
      viewOwners.set(opened,{actorId:actorId,profileId:profileId,session:nextSession});
      return {
        text: repeat ? '' : (opened.transfer
          ? ('Trading with ' + opened.trader + ' in ' + opened.place + '. Purse ' + opened.purse + '.')
          : ('The list for ' + opened.trader + ' is open. ' + opened.note)),
        view: opened
      };
    }

    merchantId = sessionMerchant(profileId);
    if (!merchantId) return fail('Press E on a guild trader.');
    if (sessions.get(profileId).actorId !== actorId) {
      sessions.delete(profileId);
      return fail('Press E on a guild trader with this character.', closedView(actorId,profileId,requestSession));
    }
    var originalSession = sessions.get(profileId), quests, heldQuest;
    function refuseSession(text) {
      if (sessions.get(profileId)!==originalSession) return fail(text);
      sessions.delete(profileId);
      return fail(text, closedView(actorId,profileId,originalSession));
    }
    if (verb === 'quest' && !commissions.has(String(parts[3]))) {
      quests = typeof deps.quests==='function' && deps.quests();
      if (!quests || typeof quests.capture!=='function') return fail('Quest work is unavailable.');
      heldQuest = quests.capture(actorId);
      if (!heldQuest) return fail('Quest work is unavailable.');
    }
    var again = inReach(actorId, merchantId);
    if (!again.ok) {
      return refuseSession(again.reason);
    }
    if (!authed(profileId, again.human)) return fail('That request is not yours.');
    var reachedIdentity=sessionIdentity(again.human);
    var currentIdentity=sessionIdentity(world.actor(actorId));
    if (!active || sessions.get(profileId)!==originalSession ||
        reachedIdentity!==originalSession.identity || currentIdentity!==originalSession.identity) {
      return refuseSession('Press E on a guild trader with this character.');
    }
    if (verb === 'quest') {
      if (parts.length<4 || parts.length>5) return fail('Choose the work in the trader panel.');
      var isCommission=commissions.has(String(parts[3]));
      var result=isCommission?commissions.act(actorId,merchantId,String(parts[2]),String(parts[3]),parts[4],{
        current:function(){return ownsSession(actorId,profileId,originalSession);},
        alive:function(){return sessionCurrent(actorId,profileId,originalSession);}}):
        quests.act(actorId,String(parts[2]),String(parts[3]),parts[4],merchantId,heldQuest,
          function(){return sessionCurrent(actorId,profileId,originalSession);});
      var reasons={class:'This work takes a different class.',rank:'This work takes a higher rank.',
        eligibility:'You do not meet this work\'s class or profession requirements.',
        cooldown:'This work is still resting.',open:'You already hold this work.',gem:'Choose a gem first.',
        short:'You have not drawn enough to turn this work in.',none:'You do not hold this work.',
        unbound:'This work has no appointed place yet.',unwritten:'The work could not be committed just now.',
        unavailable:'Quest work is unavailable.',role:'This trader does not handle that work.',
        allowance:'Your new scene work has reached its shared daily gold allowance.',
        price:'The submitted price changed or is missing. Choose the work again.',
        purse:'This trader cannot reserve the quoted payment.',capacity:'This trader cannot accept more work yet.',
        counter:'This trader cannot accept more work yet.',waiting:'The transfer is waiting for its saved inventory.',
        'open-limit':'Finish or leave one of your three open jobs of this kind first.',
        recovery:'This work needs its saved payment checked. You can leave it without payment, or ask staff for recovery.',
        session:'Choose the work again from the trader.'};
      var text=result.ok ? (parts[2]==='take'?'You take the work.':parts[2]==='return'?'The work is turned in.':isCommission?'You leave the work without payment.':'You give back what you drew and leave the work.') :
        reasons[result.why] || 'The work could not be changed.';
      if (isCommission && result.settling) {
        var settling=result.settling;
        await_(settling.id, {merchantId:merchantId,counted:null,profileId:profileId,session:originalSession,
          said:function () { return 'The work is turned in. Paid ' + settling.gold + ' gold.'; },
          released:'Your inventory changed before the turn-in. Nothing moved. Turn the work in again.'});
      }
      if (!ownsSession(actorId,profileId,originalSession)) return {text:'',view:null};
      var questState=purses.prepare(merchantId),questPlace=questState && placeOf(questState.reference);
      var questResponse=questState && questPlace ? viewFor(merchantId,questState,questPlace,actorId,profileId,text,{session:originalSession,identity:originalSession.identity}) : closedView(actorId,profileId,originalSession);
      return questResponse && isCurrentView(actorId,questResponse) ? fail(text,questResponse) : {text:'',view:null};
    }
    if (verb === 'buy' || verb === 'sell' || verb === 'supply') {
      return trade(actorId, profileId, merchantId, verb, parts.slice(2), originalSession);
    }
    return fail('Use the trader panel to buy, sell, or turn in supplies.');
  }

  function parseCountAndName(bits, fixedCount) {
    if (fixedCount) return parseCountAndName([String(fixedCount)].concat(bits),0);
    if (!bits.length) return null;
    var count = Number(bits[0]);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
    var quoted = /^@[0-9]+$/.test(String(bits[1] || ''));
    var unit = quoted ? Number(bits[1].slice(1)) : null;
    if (quoted && (!Number.isInteger(unit) || unit < 0 || unit > MAX_GOLD)) return null;
    return { count: count, name: bits.slice(quoted ? 2 : 1).join(' ').trim(), quoted:quoted, unit:unit };
  }

  function trade(actorId, profileId, merchantId, verb, bits, originalSession) {
    function responseView(state,note) {
      return viewFor(merchantId,state,place,actorId,profileId,note,{session:originalSession,identity:originalSession.identity});
    }
    function response(text,state,note) {
      var view=responseView(state,note);
      return view && isCurrentView(actorId,view) ? fail(text,view) : {text:'',view:null};
    }
    var state = purses.prepare(merchantId);
    if (!state) return fail('That is not a guild trader.');
    if (state.pending) return fail('This trader has a transfer waiting.');
    var place = placeOf(state.reference);
    if (!place || !place.bookHold) return fail('This trader has no hold price list.');
    var asked = parseCountAndName(bits, verb === 'supply' ? SUPPLY_COUNT : 0);
    if (!asked || !asked.name) return fail('Name the count, then the item.');
    var resolved = deps.resolve ? deps.resolve(asked.name) : null;
    if (!resolved || resolved.error || !resolved.baseId || resolved.baseId === GOLD_BASE) {
      return fail((resolved && resolved.error) || 'That item is not known.');
    }
    var itemName = resolved.name || asked.name;
    var direction = verb==='buy' ? 'sell' : verb==='sell' ? 'buy' : 'supply';
    if (!permits(state.reference,direction,resolved.baseId))
      return fail('This trader does not '+(verb==='buy'?'sell':verb==='sell'?'buy':'request')+' that item.');
    var price = prices.quote(place.bookHold, asked.name) || { buy: null, sell: null };
    var unit = verb === 'buy' ? price.sell : price.buy;
    if (unit == null) {
      return fail(verb === 'buy' ? 'No trader sells that.' : 'No trader buys that.');
    }
    if (!Number.isInteger(unit) || unit < 0 || unit > MAX_GOLD) return fail('That price cannot be verified.');
    if (asked.quoted && asked.unit !== unit) {
      var changedPrice = 'The price changed. Check the new quote before trading.';
      return response(changedPrice,state,changedPrice);
    }
    var gold = unit * asked.count;
    if (!Number.isInteger(gold) || gold < 0 || gold > MAX_GOLD) return fail('That price cannot be verified.');
    var npcBuys = verb !== 'buy';
    var completedSupplyKey = null;
    if (verb === 'supply') {
      if (!settlement.available()) return response('Buying and selling wait on the native transfer. Nothing was taken.',state);
      var human = transfer.identity(actorId);
      if (!human || !COMMISSION_STATE.formIdOf(human.desc) || human.profileId !== profileId) return fail('That request is not yours.');
      completedSupplyKey = supplyKey(human, itemName);
      var last = lastSupply(state, completedSupplyKey, itemName);
      if (last && now() - last < SUPPLY_WAIT) return fail('That supply is not due.');
    }
    if (npcBuys && COMMISSION_STATE.spendable(state) < gold) return fail('The trader cannot pay from its unreserved purse.');
    if (!npcBuys && gold > 0 && world.carry(actorId, GOLD_BASE) < gold) return fail('You cannot pay.');
    if (npcBuys && world.carry(actorId, resolved.baseId) < asked.count) return fail('You are not carrying that.');
    if (!settlement.available()) {
      return response('Buying and selling wait on the native transfer. Nothing was taken.',state);
    }
    var nextPurse = npcBuys ? state.purse - gold : state.purse + gold;
    if (nextPurse < 0 || nextPurse > MAX_GOLD) return fail('That price cannot be verified.');
    var moved;
    try {
      if (!ownsSession(actorId,profileId,originalSession)) return fail('The offer changed. Choose the trade again.');
      // Capture every trade's authenticated native character before a save
      // can publish a projection or reenter another request.
      var tradingHuman = transfer.identity(actorId);
      if (!tradingHuman || tradingHuman.profileId !== profileId) return fail('That request is not yours.');
      if (!ownsSession(actorId,profileId,originalSession)) return {text:'',view:null};
      try {
        state = settlement.pruneSupplyHistory(merchantId, state, SUPPLY_WAIT);
      } catch (error) {
        active = false; sessions.clear(); settlement.shutdown();
        throw error;
      }
      if (!state || !active) return fail('The offer changed. Choose the trade again.');
      var currentHuman = transfer.identity(actorId);
      if (!currentHuman || currentHuman.desc !== tradingHuman.desc || currentHuman.profileId !== tradingHuman.profileId)
        return fail('That request is not yours.');
      var expected = SETTLEMENT.inventory(transfer.inventory(actorId));
      var outgoing = SETTLEMENT.takeEntries(expected, npcBuys ? resolved.baseId : GOLD_BASE, npcBuys ? asked.count : gold, minted);
      var stock = stockCopy(state.stock), credit;
      if (npcBuys) {
        stock = addStock(stock, outgoing.entries, itemName);
        credit = gold > 0 ? [{baseId:GOLD_BASE,count:gold}] : [];
      } else {
        var picked = takeStock(stock, resolved.baseId, itemName, asked.count);
        stock = picked.stock; credit = picked.entries;
      }
      var nextSupply = JSON.parse(JSON.stringify(state.supply || {}));
      if (verb === 'supply') nextSupply[completedSupplyKey] = now();
      if (!ownsSession(actorId,profileId,originalSession)) return fail('The offer changed. Choose the trade again.');
      moved = settlement.begin({merchantId:merchantId,humanId:actorId,profileId:profileId,
        caller:function(){return ownsSession(actorId,profileId,originalSession);},
        previous:state,expected:expected,debit:outgoing.inventory,credit:credit,kind:verb,
        next:Object.assign({purse:nextPurse,stock:stock,supply:nextSupply},
          state.commissions===undefined?{}:{commissions:JSON.parse(JSON.stringify(state.commissions))})});
    } catch (error) {
      return fail(settlement.available() ? String(error.message || error) : 'Trading is unavailable. The saved transfer is retained.');
    }
    var current = purses.prepare(merchantId);
    var row = {verb:verb,count:asked.count,name:itemName,
      counted:{hold:place.bookHold,verb:verb,baseId:resolved.baseId,name:itemName,count:asked.count}};
    if (!moved.done) {
      if (moved.accepted && typeof moved.id === 'string') {
        await_(moved.id, {merchantId:merchantId,counted:row.counted,profileId:profileId,session:originalSession,
          said:function (state) { return tradeSaid(row, gold, state ? state.purse : nextPurse); },
          released:'Your inventory changed before the trade. Nothing moved. Choose the trade again.'});
      }
      return response(moved.reason,current,moved.reason);
    }
    countTrade(row.counted);
    return response(tradeSaid(row, gold, current.purse),current);
  }

  function activate(actorId, merchantId) {
    if (!active) return fail('Trading is unavailable.');
    if (typeof deps.isTrader === 'function' && !deps.isTrader(merchantId)) return null;
    var human = world.actor(actorId);
    var profileId = human && Number(human.profileId) || 0;
    return command({
      actorId: actorId,
      profileId: profileId,
      parts: ['/merchant', (Number(merchantId) >>> 0).toString(16)]
    });
  }

  return {
    isCurrentView:isCurrentView,
    acknowledgeView: function(actorId,view) {
      sessions.forEach(function(session){
        if(session.actorId===actorId && session.id===view.sessionId) {
          session.quests=JSON.stringify(view.quests);
          session.view=viewKey(view);
          session.note=view.note;
        }
      });
    },
    command: command,
    activate: activate,
    recover: recover,
    retirementReady: function () {
      var ready=!closed && settlement.canRetire();
      return !closed && ready;
    },
    start: function () {
      if(!settlement.available() || closed) throw new Error('Trading is unavailable.');
      if(retirementRequired && !settlement.canRetire()) throw new Error('Legacy work blocks roster activation.');
      if(!settlement.available() || closed) throw new Error('Trading is unavailable.');
      active=true;
      return true;
    },
    nativeReady: function () { return settlement.available(); },
    withQuestInventoryMutation: function(actorId,change) {return active ? settlement.withInventoryMutation(actorId,change) : {ok:false,why:'unavailable'};},
    questReady: function(actorId) {return active && settlement.canInventoryMutation(actorId);},
    questAdmission: function(actorId,merchantId) {
      if (!active) return null;
      // Capture before actor lookup: native callbacks must not supply a new conversation.
      var session=null,profileId;
      sessions.forEach(function(current,key) {
        if(current.actorId===actorId){session=current;profileId=key;}
      });
      if (!session || session.merchantId!==merchantId || !ownsSession(actorId,profileId,session)) return null;
      // The final transaction admission check must not invoke native callbacks.
      // Actor identity remains fenced by the quest transaction's native CAS.
      return function(){return sessionCurrent(actorId,profileId,session);};
    },
    questRole: function(merchantId) {
      if (!active) return null;
      var state=purses.read(merchantId);
      return active && state ? permits.roleOf(state.reference) : null;
    },
    questHold: function(merchantId) {
      var state=active && purses.read(merchantId),place=state && placeOf(state.reference);
      return place && place.hold || '';
    },
    shutdown: function () { active=false; closed=true; sessions.clear(); settlement.shutdown(); },
    REACH: REACH,
    SUPPLY_COUNT: SUPPLY_COUNT,
    bookHoldOf: bookHoldOf
  };
}

function installMerchantTrading(env) {
  var mp = env.mp;
  var g = env.g || globalThis;
  var log = env.log || function () {};
  var fs = require('fs');
  var path = require('path');
  var root = typeof __dirname === 'string' ? __dirname : path.dirname(__filename);
  var file = path.join(root, 'data', 'merchant-traders.json');
  var doc = env.catalog || JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  var traderIds = new Set();
  if (doc.byRef) {
    Object.keys(doc.byRef).forEach(function (ref) {
      try {
        var found = mp.getIdFromDesc(ref);
        if (found) traderIds.add(Number(found) >>> 0);
      } catch (e) {}
    });
  }
  var minted = typeof env.minted === 'function' ? env.minted : function () { return false; };
  var trading = createMerchantTrading({
    purses: env.purses,
    minted: minted,
    log:log,
    prices: {
      quote: function (hold, item) {
        var books = g.__thornswoodBooks;
        if (!books || typeof books.guildPrice !== 'function') return { buy: null, sell: null };
        return books.guildPrice(hold, item);
      },
      catalog: function (hold) {
        var books = g.__thornswoodBooks;
        if (!books || typeof books.catalog !== 'function') return [];
        return books.catalog(hold);
      }
    },
    transfer: createNativeMerchantTransfer(mp),
    world: {
      actor: function (id) {
        var ai = null;
        try { ai = mp.getNpcAIState(id); } catch (e) { ai = null; }
        var pos = ai && Array.isArray(ai.pos) ? ai.pos.slice(0, 3) : null;
        var cell = ai ? (ai.cellOrWorld || ai.cell || null) : null;
        try {
          var p = mp.get(id, 'pos');
          if (Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(function (n) { return Number.isFinite(n); })) {
            pos = p.slice(0, 3);
          }
        } catch (e2) {}
        try {
          var c = mp.get(id, 'worldOrCellDesc');
          if (c) cell = c;
        } catch (e3) {}
        return {
          pos: pos,
          cell: cell,
          desc: mp.getDescFromId(id),
          lifeGeneration: ai && ai.lifeGeneration,
          runtimeIdentity: mp.getActorRuntimeIdentity(id),
          profileId: ai && ai.profileId || 0,
          isHuman: !!(ai && ai.isHuman)
        };
      },
      carry: function (id, baseId) {
        var inv = null;
        try { inv = mp.get(id, 'inventory'); } catch (e) { return 0; }
        var entries = (inv && inv.entries) || [];
        var n = 0;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i] && Number(entries[i].baseId) === Number(baseId) && !minted(entries[i])) n += Number(entries[i].count) || 0;
        }
        return n;
      }
    },
    places: doc.byRef || {},
    roleTables: env.roleTables,
    commissions: env.commissions,
    commissionEligible:function(actor,gate) {
      var progression=g.__thornswoodProgression,character=g.__thornswoodCharacter;
      if(!progression||!character||!character.PROPERTY)return false;
      try {
        var rule=QUEST_ELIGIBILITY.createQuestEligibility({table:progression.TABLE,spellIds:progression.SPELL_IDS});
        var allowed=rule.allows(rule.validate(gate),mp.get(actor,character.PROPERTY));
        return allowed&&g.__thornswoodProgression===progression&&g.__thornswoodCharacter===character;
      }catch(error){return false;}
    },
    suspended: env.suspended,
    retirementRequired: env.retirementRequired,
    quests: function () { return g.__thornswoodQuests; },
    resolve: function (name) {
      var fn = g.__thornswoodResolveItem;
      if (typeof fn !== 'function') return null;
      return fn(name);
    },
    isTrader: function (id) { return traderIds.has(Number(id) >>> 0); },
    traded: function (row) {
      var economy = g.__thornswoodEconomy;
      if (economy && typeof economy.traded === 'function') economy.traded(row);
    }
  });
  var property = 'thornswoodMerchantView';
  var script = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodMerchantAt === v.at) { return; }',
    '    st.thornswoodMerchantAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodMerchantView=d;" +',
    '      "if(window.thornswoodMerchant&&window.thornswoodMerchant.setData){window.thornswoodMerchant.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  mp.makeProperty(property, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: script, updateNeighbor: ''
  });
  trading.push = function (actorId, view) {
    var payload = JSON.parse(JSON.stringify(view || { open: false }));
    payload.at = Date.now();
    if (!trading.isCurrentView(actorId,view)) return;
    try { mp.set(actorId, property, payload); }
    catch (e) { trading.shutdown(); log('merchant panel publication failed; controller revoked: ' + e); throw e; }
    trading.acknowledgeView(actorId,payload);
  };
  var timers=env.timers || (typeof setTimeout === 'function' && typeof clearTimeout === 'function' ? {setTimeout:setTimeout,clearTimeout:clearTimeout} : null);
  var alive=true, timer=null, started=false;
  var stop=trading.shutdown;
  trading.shutdown=function () {
    alive=false;
    var ownedTimer=timer;
    timer=null;
    // Revoke authority before cancellation can call back or throw.
    try {stop();}
    finally {if(ownedTimer!==null && timers) timers.clearTimeout(ownedTimer);}
  };
  function scheduleAdvance() {
    if(!alive || !timers || timer!==null) return;
    try {
      timer=timers.setTimeout(function () {timer=null;if(alive && started) advance();},1000);
    } catch(error) {trading.shutdown();throw error;}
  }
  function advance() {
    if(!alive) return;
    try { trading.recover().forEach(function (result) {if(alive) trading.push(result.actorId,result.view);}); }
    catch(error) {log('merchant recover: '+error);}
    // This checks exact save acknowledgements, never elapsed-time settlement.
    if(alive && trading.nativeReady()) scheduleAdvance();
  }
  var start=trading.start;
  trading.start=function () {
    if(!alive) throw new Error('Trading is unavailable.');
    start();
    if(!alive) throw new Error('Trading is unavailable.');
    if(!started) {started=true;advance();}
    if(!alive || !trading.nativeReady()) throw new Error('Trading is unavailable.');
    return true;
  };
  if(trading.nativeReady()) {
    if(env.suspended===true || env.retirementRequired===true) scheduleAdvance();
    else trading.start();
  }
  return trading;
}

module.exports = {
  createMerchantTrading: createMerchantTrading,
  createNativeMerchantTransfer: createNativeMerchantTransfer,
  createQuestTransactions: QUEST_TRANSFER.createQuestTransactions,
  actorIdentity: QUEST_TRANSFER.actorIdentity,
  targetIdentity: QUEST_TRANSFER.targetIdentity,
  installMerchantTrading: installMerchantTrading,
  bookHoldOf: bookHoldOf,
  guildSite: guildSite,
  GUILD_SITES: GUILD_SITES,
  BOOK_HOLD: BOOK_HOLD,
  GOLD_BASE: GOLD_BASE,
  REACH: REACH,
  SUPPLY_COUNT: SUPPLY_COUNT
};
