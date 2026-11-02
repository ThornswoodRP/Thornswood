// ==== thornswood hold economy ====
/*
  WHAT EACH HOLD GATHERS, MAKES AND TRADES, FOR STAFF (#3164).

  Patrick, 22 Oct 2026, on his report page: staff's hold economy view is a
  staff page on the hub. Staff need to see what is gathered, crafted and
  traded in each hold, so they can spot a hold that is out of balance. Items
  here have no gold price (an RP server, #3139), so it counts pieces, never
  value. Until this nothing counted any of it: a yield, a craft and a trade
  each went into a pack and the server kept no tally of where.

  WHAT IS COUNTED, AND WHO CALLS:
    gathered  every yield the world hands to a gathering verb, by
              economyGathered beside its creditWork: a seam, the salt, the
              chopping block, a plant, the water, a hung or hunted body, the
              farm's butter, eggs, honey and milk, and a crop brought in.
              Quest work (the crimson plants, the geodes, the pearl beds, the
              longfin waters, the mammoth ground and the orchard's quest rows)
              is the quest's own count and is not counted here: those pieces
              go back to whoever gave the work.
    crafted   every craft a bench allows, what the engine hands over, by the
              wrapper after mp.onCraft.
    bought    pieces bought from a hold's guild traders, and
    sold      pieces sold or supplied to them, both told by
              merchant-trading.js once the transfer is done.
    hauled    a haul confirmed at the board it went to, counted for the hold
              it left, under the hold it went to (confirmHaul).

  THE HOLD is the one the work was done in: the room's hold, or in the open
  world the nearest capital (holdAt, the same answer the respawn gives), with
  Solstheim's own worldspace as Raven Rock. Anywhere holdAt has no answer for
  (Blackreach, a room no hold names) is the hold of the door the person came
  in by, and with no door either it is counted under 'elsewhere', never
  dropped. A trade is the trader's hold and a haul the board's.

  NOTHING ABOUT ANYBODY. A row is a day, a hold, a kind, an item and a count:
  no name, no profile, no account. So it is nobody's personal data, and the
  privacy page has nothing to add for it.

  KEPT KEEP_DAYS days by the server's own date, in private\hold-economy.json,
  written whole a minute after the first change, and sent whole to the site
  every five minutes with the door's key, the way the roster is: the site is
  door.json's, so the dev server's lands on /dev/api/economy. The counts live
  on globalThis between gamemode reloads, so a reload loses none of them.
*/
(function holdEconomy() {
  var g = globalThis;
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }

  var KEEP_DAYS = 30;
  var SAVE_AFTER_MS = 60000;
  var PUSH_EVERY_MS = 300000;
  var MOST = 1000000000;
  var KINDS = ['gathered', 'crafted', 'bought', 'sold', 'hauled'];
  var HOLDS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
               'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
  var ELSEWHERE = 'elsewhere';
  // The hold records holdAt and the came-in record answer, to the ten holds
  // as the ledgers, the boards and the traders name them.
  var OF_LOCATION = {
    WhiterunHoldLocation: 'whiterun', HaafingarHoldLocation: 'solitude',
    RiftHoldLocation: 'riften', ReachHoldLocation: 'markarth',
    EastmarchHoldLocation: 'windhelm', FalkreathHoldLocation: 'falkreath',
    HjaalmarchHoldLocation: 'morthal', PaleHoldLocation: 'dawnstar',
    WinterholdHoldLocation: 'winterhold', DLC2SolstheimLocation: 'ravenrock'
  };
  var SOLSTHEIM = '800:dragonborn.esm';
  // A brewed potion or a made enchantment is a form only that run of the
  // server has (#1649), with no record to read a name from.
  var RUNTIME_FORM = 0xff000000;
  var MADE_IN_GAME = 'A brew or an enchanted piece';

  var privDir = 'private';
  var serverName = 'main';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
    serverName = String((cfg && cfg.thornswoodServer) || '').trim().toLowerCase() || 'main';
  } catch (e) { }
  var FILE = path.join(privDir, 'hold-economy.json');

  function elog() {
    var a = ['[thornswood economy]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** The server's own date, 2026-10-26, which is the day a row is counted on. */
  function dayOf(t) {
    var d = new Date(t);
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /** The first day still kept on the day `t`. */
  function firstKept(t) {
    return dayOf(t - (KEEP_DAYS - 1) * 24 * 60 * 60 * 1000);
  }

  /*
    What was read or carried over, held to the shape: a day, a hold, a kind,
    an item key and a whole count above 0. Anything else in the file is left
    out rather than trusted, and days past KEEP_DAYS go.
  */
  function clean(raw, t) {
    var out = { days: {}, names: {} };
    var days = raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object' ? raw.days : {};
    var names = raw && typeof raw === 'object' && raw.names && typeof raw.names === 'object' ? raw.names : {};
    var cut = firstKept(t);
    for (var day in days) {
      if (!own(days, day) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cut) { continue; }
      var holds = days[day];
      if (!holds || typeof holds !== 'object') { continue; }
      for (var hold in holds) {
        if (!own(holds, hold) || (HOLDS.indexOf(hold) < 0 && hold !== ELSEWHERE)) { continue; }
        var kinds = holds[hold];
        if (!kinds || typeof kinds !== 'object') { continue; }
        for (var i = 0; i < KINDS.length; i++) {
          var items = kinds[KINDS[i]];
          if (!items || typeof items !== 'object') { continue; }
          for (var key in items) {
            var n = items[key];
            if (!own(items, key) || key === '__proto__' || !key || key.length > 120) { continue; }
            if (!Number.isSafeInteger(n) || n <= 0) { continue; }
            var row = ((out.days[day] = out.days[day] || {})[hold] = out.days[day][hold] || {});
            (row[KINDS[i]] = row[KINDS[i]] || {})[key] = Math.min(n, MOST);
            var nm = own(names, key) && typeof names[key] === 'string' ? names[key].slice(0, 120) : '';
            out.names[key] = nm || key;
          }
        }
      }
    }
    return out;
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) {
      if (e && e.code !== 'ENOENT') { elog('could not read', FILE + ', so the counts start empty:', e.message || e); }
      return { days: {}, names: {} };
    }
    return clean(raw, Date.now());
  }

  var state = g.__thornswoodEconomyState;
  if (!state || typeof state !== 'object' || !state.days || !state.names) { state = load(); }
  g.__thornswoodEconomyState = state;

  /*
    AN ITEM'S NAME, read off the two generated name tables /give reads
    (ITEM_NAMES, then ADMIN_ITEMS, the first record a name was written for).
    The count is keyed by the name in lower case, so a piece gathered, made and
    sold is one row on the page whatever handed it over. A record neither
    table names is counted under its record, which the page shows as it is.
  */
  var byRecord = null;
  function recordNames() {
    if (byRecord) { return byRecord; }
    byRecord = {};
    var tables = [];
    if (typeof ITEM_NAMES !== 'undefined') { tables.push(ITEM_NAMES); }
    if (typeof ADMIN_ITEMS !== 'undefined') { tables.push(ADMIN_ITEMS); }
    for (var t = 0; t < tables.length; t++) {
      for (var k in tables[t]) {
        if (!own(tables[t], k)) { continue; }
        var row = tables[t][k];
        var at = String((row && row[1]) || '').toLowerCase();
        if (at && !own(byRecord, at)) { byRecord[at] = String(row[0] || ''); }
      }
    }
    return byRecord;
  }

  /** { key, name } for a record's descriptor or a form id, or null. */
  function itemOf(item, named) {
    var desc = '';
    if (typeof item === 'number') {
      if (!(item > 0)) { return null; }
      if (item >= RUNTIME_FORM) { return { key: MADE_IN_GAME.toLowerCase(), name: MADE_IN_GAME }; }
      try { desc = String(mp.getDescFromId(item) || ''); } catch (e) { desc = ''; }
    } else {
      desc = String(item || '');
    }
    var name = desc ? (recordNames()[desc.toLowerCase()] || '') : '';
    if (!name) { name = String(named || '').trim(); }
    if (!name) { name = desc; }
    if (!name) { return null; }
    name = name.slice(0, 120);
    return { key: name.toLowerCase(), name: name };
  }

  /** The hold a person is working in, as one of HOLDS, or 'elsewhere'. */
  function holdOf(actorId) {
    var desc = '', pos = null;
    try { desc = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { desc = ''; }
    try { pos = mp.get(actorId, 'pos'); } catch (e) { pos = null; }
    if (desc.toLowerCase() === SOLSTHEIM) { return 'ravenrock'; }
    var at = null;
    try { at = holdAt({ desc: desc, pos: pos }); } catch (e) { at = null; }
    if (!at) {
      var rec = null;
      try { rec = cameInOf(actorId); } catch (e) { rec = null; }
      if (rec) {
        var inWorld = rec.world && String(rec.world).toLowerCase() === desc.toLowerCase();
        at = (inWorld && rec.hold) || rec.lastHold || null;
      }
    }
    return (at && own(OF_LOCATION, at)) ? OF_LOCATION[at] : ELSEWHERE;
  }

  // A save still waiting from before a reload is made again by this copy, so
  // what the last copy counted is written in a minute whatever happens next.
  var saveWaiting = !!g.__thornswoodEconomySave;
  if (g.__thornswoodEconomySave) {
    try { clearTimeout(g.__thornswoodEconomySave); } catch (e) { }
    g.__thornswoodEconomySave = null;
  }
  var saveSaid = '';
  function save() {
    g.__thornswoodEconomySave = null;
    var kept = clean(state, Date.now());
    state.days = kept.days;
    state.names = kept.names;
    try {
      fs.mkdirSync(privDir, { recursive: true });
      mp.writeFileWhole(FILE, JSON.stringify({ at: Date.now(), keepDays: KEEP_DAYS, days: state.days, names: state.names }));
      saveSaid = '';
    } catch (e) {
      var why = String((e && e.message) || e);
      if (why !== saveSaid) { elog('could not write', FILE + ':', why); }
      saveSaid = why;
    }
  }
  function changed() {
    if (!g.__thornswoodEconomySave) { g.__thornswoodEconomySave = setTimeout(save, SAVE_AFTER_MS); }
  }
  if (saveWaiting) { changed(); }

  function add(hold, kind, it, count) {
    if (!it || KINDS.indexOf(kind) < 0) { return false; }
    var n = Math.floor(Number(count) || 0);
    if (!(n > 0)) { return false; }
    var h = (HOLDS.indexOf(hold) >= 0) ? hold : ELSEWHERE;
    var day = dayOf(Date.now());
    var holds = (state.days[day] = state.days[day] || {});
    var kinds = (holds[h] = holds[h] || {});
    var items = (kinds[kind] = kinds[kind] || {});
    items[it.key] = Math.min((own(items, it.key) ? items[it.key] : 0) + n, MOST);
    state.names[it.key] = it.name;
    changed();
    return true;
  }

  /*
    THE PART THE REST OF THE FILE CALLS.
      note(kind, actorId, item, count)  a yield ('gathered') or a craft
                                        ('crafted') by this person, item a
                                        record's descriptor or a form id;
      traded({hold, verb, baseId, name, count})  a guild trader's buy, sell
                                        or supply, as merchant-trading.js has it;
      hauled(from, to)                  one haul confirmed;
      holdOf(actorId)                   the hold a person is counted in;
      snapshot()                        a copy of what is held, for the push
                                        and the harness.
  */
  g.__thornswoodEconomy = {
    note: function (kind, actorId, item, count) {
      if (kind !== 'gathered' && kind !== 'crafted') { return false; }
      return add(holdOf(actorId), kind, itemOf(item), count);
    },
    traded: function (row) {
      if (!row || typeof row !== 'object') { return false; }
      var kind = row.verb === 'buy' ? 'bought' : (row.verb === 'sell' || row.verb === 'supply') ? 'sold' : '';
      if (!kind) { return false; }
      return add(String(row.hold || ''), kind, itemOf(Number(row.baseId) || 0, row.name), row.count);
    },
    hauled: function (from, to) {
      var dest = String(to || '').toLowerCase();
      if (HOLDS.indexOf(dest) < 0) { return false; }
      return add(String(from || '').toLowerCase(), 'hauled', { key: dest, name: dest }, 1);
    },
    holdOf: holdOf,
    snapshot: function () {
      return JSON.parse(JSON.stringify({ keepDays: KEEP_DAYS, days: state.days, names: state.names }));
    }
  };

  /*
    TO THE SITE, the roster's way: door.json in the private folder names the
    site and the key, and the dev server's names it with /dev on the end. The
    whole of what is kept goes each time, so a site that missed a push is
    whole again at the next, and a refusal is said once until one works.
  */
  var pushSaid = '';
  function push() {
    var conf = null;
    try { conf = JSON.parse(fs.readFileSync(path.join(privDir, 'door.json'), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { return; }
    if (!conf || !conf.site || !conf.key) { return; }
    var https = null;
    try { https = require('https'); } catch (e) { return; }
    var u = null;
    try { u = new URL(String(conf.site).replace(/\/+$/, '') + '/api/economy'); } catch (e) { return; }
    var kept = clean(state, Date.now());
    var body = JSON.stringify({ key: String(conf.key), server: serverName, keepDays: KEEP_DAYS,
                                today: dayOf(Date.now()), days: kept.days, names: kept.names });
    var said = function (why) {
      if (why !== pushSaid) { elog('the site did not take the hold economy:', why); }
      pushSaid = why;
    };
    try {
      var req = https.request({
        host: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST', timeout: 10000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, function (resp) {
        resp.resume();
        if (resp.statusCode === 200) { pushSaid = ''; } else { said('it answered ' + resp.statusCode); }
      });
      req.on('error', function (e) { said(String((e && e.message) || e)); });
      req.on('timeout', function () { req.destroy(new Error('no answer in 10 s')); });
      req.end(body);
    } catch (e) { said(String((e && e.message) || e)); }
  }
  if (g.__thornswoodEconomyPush) {
    try { clearInterval(g.__thornswoodEconomyPush); } catch (e) { }
  }
  if (g.__thornswoodEconomyFirst) {
    try { clearTimeout(g.__thornswoodEconomyFirst); } catch (e) { }
  }
  g.__thornswoodEconomyFirst = setTimeout(push, 20000);
  g.__thornswoodEconomyPush = setInterval(push, PUSH_EVERY_MS);
})();
// ==== end thornswood hold economy ====

