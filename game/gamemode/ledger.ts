// ==== thornswood ledger ====
/*
  ============================================================================
  THE GOLD AND TRADE LOG (#6270).

  Sura the Mad, an auditor, 15 Nov 2026: their server logged every time
  somebody moved a suspicious amount of gold, and Patrick the same evening:
  "With trade logs you can just delete ill gotten gold instead of having to
  wipe or let your economy get fucked". Before this, a trade and gold taken
  or dropped were lines in thornswood.log by character name only: no
  Discord account, no flag, nothing staff could search.

  WHAT IS LOGGED. Every finished trade and company sale, both sides, gold
  and things (the trading block calls trade()), and every move of gold
  through the engine's own events: taken out of a container or off a body,
  dropped, and put into a container (cuffs.ts's onTakeItem, onDropItem and
  onPutItem call gold()). Each row names who it came from and who it went
  to by profile, character name and Discord account (the door's list,
  __thornswoodAccountOf), and where.

  FLAGGED. A row that hands 1000 gold or more (FLAG_GOLD) to somebody is
  flagged on the site and said in the staff channel through moderation.log,
  the way the staff log reaches the bot. Gold taken out of a container is
  flagged unless the last gold put into that container on this run was the
  same person's: a person's own stash coming back out is not a hand-off.
  Gold dropped on the ground is flagged at the drop, because a pickup off
  the ground reaches the gamemode as an activation with no count (#6272).

  WHAT IT COSTS THE SERVER. A row is a few property reads and an array push.
  Nothing is written on the game server's loop: the rows go to the site in
  one request every 15 seconds (EVERY_MS), and the site appends them to its
  day files. Only a flagged row touches a file here, one line in
  moderation.log. Measured in the load test (#6270).

  WHEN THE SITE IS DOWN. The rows stay in memory and go with the next push
  the site takes, so a restart of the site loses nothing. At most HOLD_MOST
  are held; past that the oldest go, and how many is said once in
  thornswood.log, so a long outage costs memory it can count rather than
  memory it cannot.
  ============================================================================
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var fs = null, path = null, https = null;
  try { fs = require('fs'); path = require('path'); https = require('https'); } catch (e) { /* no fs or https here: push() and sayFlag() check for them and do nothing */ }

  var FLAG_GOLD = 1000;
  var EVERY_MS = 15000;
  var PUSH_MOST = 5000;
  var HOLD_MOST = 50000;
  var GOLD = 0x0000000F;

  function llog() {
    var a = ['[thornswood ledger]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { /* nowhere to say it: the console itself failed */ }
  }

  // On globalThis, so a hot reload keeps the rows not yet sent and who
  // last put gold in each container.
  if (!g.__thornswoodLedgerState) { g.__thornswoodLedgerState = { rows: [], lost: 0, putBy: {}, sending: false }; }
  var state = g.__thornswoodLedgerState;

  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }
  function serverName() {
    return String(settings().thornswoodServer || '').trim().toLowerCase() === 'dev' ? 'dev' : 'main';
  }
  function profileOf(refrId) {
    try { return Number(mp.get(refrId, 'profileId')) || 0; } catch (e) { return 0; }
  }
  function nameOf(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      var n = String((ap && ap.name) || '');
      if (n) { return n; }
    } catch (e) { /* no appearance yet: the name stays empty and the profile still says who */ }
    return '';
  }
  function cellOf(actorId) {
    try { return String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { return ''; }
  }
  function descOf(baseId) {
    try { return String(mp.getDescFromId(Number(baseId) || 0) || ''); } catch (e) { return ''; }
  }

  /* Who, as the site keeps them: profile, character name, Discord account. */
  function person(actorId) {
    var pid = profileOf(actorId);
    if (!pid) { return null; }
    var acct = '';
    var of = g.__thornswoodAccountOf;
    try { acct = typeof of === 'function' ? String(of(pid) || '') : ''; } catch (e) { acct = ''; }
    return { pid: pid, name: nameOf(actorId), account: acct };
  }
  function who(p) {
    if (!p) { return 'nobody'; }
    return (p.name || 'somebody') + ' (profile ' + p.pid + (p.account ? ', account ' + p.account : '') + ')';
  }

  /* The staff channel, through moderation.log, the staff log's own way. */
  function sayFlag(row, sentence) {
    if (!fs || !path) { return; }
    var s = settings();
    var to = row.to || row.from || { pid: 0, name: '' };
    var line = { at: new Date(row.at).toISOString(), server: row.server, did: 'gold',
                 by: to.pid, byName: to.name, who: to.pid, whoName: to.name, why: sentence.slice(0, 600) };
    var dir = String(s.forBotDir || path.join(path.dirname(String(s.privDir || 'private')), 'for-bot'));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'moderation.log'), JSON.stringify(line) + '\n');
    } catch (e) {
      llog('could not write moderation.log, so the staff channel will not hear of this flag:', String(e));
    }
  }

  function add(row) {
    row.at = Date.now();
    row.server = serverName();
    state.rows.push(row);
    if (state.rows.length > HOLD_MOST) {
      var over = state.rows.length - HOLD_MOST;
      state.rows.splice(0, over);
      if (!state.lost) { llog('the site has not taken the log for a while: holding the newest', HOLD_MOST, 'rows, and the oldest go'); }
      state.lost += over;
    }
    return row;
  }

  function thingsOf(list) {
    var out = [];
    for (var i = 0; i < (list || []).length && i < 48; i++) {
      var t = list[i];
      if (!t || !(Number(t.c) > 0)) { continue; }
      out.push({ n: String(t.n || ''), desc: descOf(t.id), c: Number(t.c) });
    }
    return out;
  }
  function goldWords(n) { return n + ' gold'; }

  /*
    A finished trade between two people, or a sale to the company. kind is
    'trade', 'halftrade' (only one pack took its write) or 'sale'. a and b
    are the actor ids; aGave and bGave are { gold, items } with items the
    trading block's pieces ({ id, c, n }).
  */
  function trade(kind, a, b, aGave, bGave) {
    if (['trade', 'halftrade', 'sale'].indexOf(kind) < 0) { return null; }
    var ga = Math.max(0, Number(aGave && aGave.gold) || 0), gb = Math.max(0, Number(bGave && bGave.gold) || 0);
    var row = add({ kind: kind, from: person(a), to: person(b),
                    gold: ga, things: thingsOf(aGave && aGave.items),
                    backGold: gb, backThings: thingsOf(bGave && bGave.items),
                    source: '', where: cellOf(a), flagged: ga >= FLAG_GOLD || gb >= FLAG_GOLD || kind === 'halftrade' });
    if (row.flagged) {
      var big = ga >= gb ? [row.from, row.to, ga] : [row.to, row.from, gb];
      sayFlag(row, kind === 'halftrade'
        ? 'A trade went only half through between ' + who(row.from) + ' and ' + who(row.to) + ': ' +
          goldWords(ga) + ' one way and ' + goldWords(gb) + ' the other. Check both packs; it is on the hub\'s Gold and trades page.'
        : who(big[0]) + ' handed ' + goldWords(big[2]) + ' to ' + who(big[1]) + ' in a ' +
          (kind === 'sale' ? 'sale to the company' : 'trade') + '. It is on the hub\'s Gold and trades page.');
    }
    return row;
  }

  /*
    Gold moved by the engine's own events. how is 'take' (out of sourceRefrId,
    a container or a body, into actorId), 'drop' (actorId to the ground) or
    'put' (actorId into the container sourceRefrId). Only gold is logged
    here; anything else returns null.
  */
  function gold(how, actorId, baseId, count, sourceRefrId) {
    if ((Number(baseId) || 0) !== GOLD) { return null; }
    var n = Math.floor(Number(count) || 0);
    if (!(n > 0)) { return null; }
    var me = person(actorId);
    var src = Number(sourceRefrId) || 0;
    var owner = src ? person(src) : null;          // a body is a person's
    var base = '';
    if (src && !owner) { try { base = String(mp.get(src, 'baseDesc') || ''); } catch (e) { base = ''; } }
    var source = how === 'drop' ? 'the ground'
      : owner ? 'the body of ' + (owner.name || 'somebody')
      : '0x' + src.toString(16) + (base ? ' (' + base + ')' : '');
    var row;
    if (how === 'take') {
      var stashed = !owner && me && state.putBy[src] === me.pid;
      row = add({ kind: 'take', from: owner, to: me, gold: n, things: [], source: source,
                  where: cellOf(actorId), flagged: n >= FLAG_GOLD && !stashed });
      if (row.flagged) {
        sayFlag(row, who(me) + ' took ' + goldWords(n) + ' from ' + (owner ? 'the body of ' + who(owner) : 'container ' + source) +
          ' in ' + row.where + '. It is on the hub\'s Gold and trades page.');
      }
    } else if (how === 'put') {
      if (me) { state.putBy[src] = me.pid; }
      row = add({ kind: 'put', from: me, to: null, gold: n, things: [], source: source,
                  where: cellOf(actorId), flagged: false });
    } else if (how === 'drop') {
      row = add({ kind: 'drop', from: me, to: null, gold: n, things: [], source: source,
                  where: cellOf(actorId), flagged: n >= FLAG_GOLD });
      if (row.flagged) {
        sayFlag(row, who(me) + ' dropped ' + goldWords(n) + ' on the ground in ' + row.where +
          '. Whoever picks it up is not logged yet. It is on the hub\'s Gold and trades page.');
      }
    } else { return null; }
    return row;
  }

  /* To the site: door.json names it and the key, the dev server's with /dev. */
  function push() {
    if (state.sending || !state.rows.length || !fs || !path || !https) { return; }
    var conf = null;
    var privDir = String(settings().privDir || 'private');
    try { conf = JSON.parse(fs.readFileSync(path.join(privDir, 'door.json'), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { return; }
    if (!conf || !conf.site || !conf.key) { return; }
    var u = null;
    try { u = new URL(String(conf.site).replace(/\/+$/, '') + '/api/ledger'); } catch (e) { return; }
    var batch = state.rows.slice(0, PUSH_MOST);
    var body = JSON.stringify({ key: String(conf.key), server: serverName(), rows: batch });
    state.sending = true;
    function done(ok, why) {
      state.sending = false;
      if (ok) {
        // Only what was sent goes; rows added meanwhile stay for the next.
        state.rows.splice(0, batch.length);
        if (state.lost) { llog('the site takes the log again;', state.lost, 'rows were lost while it did not'); state.lost = 0; }
        if (state.said) { state.said = ''; }
      } else if (why !== state.said) {
        llog('the site did not take', batch.length, 'rows; they are kept for the next push:', why);
        state.said = why;
      }
    }
    try {
      var req = https.request({
        host: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST', timeout: 10000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, function (resp) {
        resp.resume();
        if (resp.statusCode === 200) { done(true, ''); } else { done(false, 'it answered ' + resp.statusCode); }
      });
      req.on('error', function (e) { if (state.sending) { done(false, String((e && e.message) || e)); } });
      req.on('timeout', function () { req.destroy(new Error('no answer in 10 s')); });
      req.end(body);
    } catch (e) { done(false, String((e && e.message) || e)); }
  }

  if (g.__thornswoodLedgerPush) { try { clearInterval(g.__thornswoodLedgerPush); } catch (e) { /* nothing to stop: an earlier load's timer is already gone */ } }
  state.sending = false;
  g.__thornswoodLedgerPush = setInterval(push, EVERY_MS);

  g.__thornswoodLedger = { trade: trade, gold: gold, push: push, FLAG_GOLD: FLAG_GOLD, EVERY_MS: EVERY_MS,
                           pending: function () { return state.rows.length; } };
  llog('ready: trades and gold moves go to the site every', EVERY_MS / 1000, 's, and', FLAG_GOLD, 'gold or more is flagged');
})();
// ==== end thornswood ledger ====
