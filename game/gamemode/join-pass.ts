// ==== thornswood join pass ====
/*
  NOBODY IS IN THE WORLD WHO DID NOT COME THROUGH AN UP TO DATE LAUNCHER (#937).

  Patrick, 28 Sep: "People should not be allowed in at all if they don't join
  from our launcher." Until this only the launcher checked: it holds Play while
  an update waits, but the server never asked which launcher, if any, started
  the game. Skyrim or skse started by hand, another launcher, or an old one of
  ours walked straight in, under a profile id the client picks (#410).

  THE PASS. When a character is picked at the menu, the launcher asks the site
  (/api/play/pass) with the Discord ticket it holds. The site answers only for
  an account that may play, for its own character, from a launcher between the
  channel's minLauncher and its current one, and signs the profile, the server,
  the launcher version, the Discord id and a ten minute expiry with the key it
  shares with this server: passKey in door.json, which Set-Door.ps1 -Connect
  copies there from the site. The launcher leaves it in
  Data/Platform/thornswood-pass.txt and renews it every minute, and the front
  plugin sends it here as "/joinpass <pass>" over the command relay, at once
  and every minute. The format is makePass in site/server.js.

  WHAT IS CHECKED, here and with nothing asked of anybody: the signature, the
  expiry, that it names this server (thornswoodServer in server-settings.json,
  "dev" on the dev box, "main" when absent), that its profile is the one the
  relay says sent it, which the voice join token proves, and that no other
  session has used it (below).

  THE PROFILE ID IS THE PASS'S. Every session online needs a valid pass of its
  own. One with none is told one line and ended GRACE_MS after it was first
  seen. A session under somebody else's number cannot have a pass for it: the
  site will not issue one and nothing else can sign one.

  ONE PASS, ONE SESSION (#1320). A pass is a note anybody holding it could
  show, so it is bound to the first session it proves and never proves
  another: not the next session after a reconnect, not a second connection
  under the same number. A session is one engine connection behind a profile
  (its GUID, connOf), from when it is first seen until it leaves or the
  connection behind the character changes; a new connection starts a new
  session, held (#410) and judged afresh. A pass also starts a session only
  when the site issued it at most ISSUED_MS before that session began, so a
  pass picked up at the menu, off a disk, or over the wire is good for a
  minute and a half, not for the ten minutes it lives; after that it only
  keeps the session it already proved trusted (proven, for roles). The
  launcher renews every minute, so a reconnect has a new pass within one.
  Kept on globalThis, so a hot reload keeps every binding; a restart loses
  them, and then a pass can be shown again only within ISSUED_MS of its
  issue. Measured on 5 Oct: the pass never travels on the game's own port.
  It goes launcher to site over https, through a file, and over the relay's
  socket, which is wss through Caddy whenever the voice address is https; a
  launcher with no https voice address gets no join token, and with the hold
  on the relay refuses it. What the gamemode cannot do is tie that socket to
  the game connection: both only name the profile. Binding the pass into the
  game login itself, checked before the engine hands over the character, is a
  fork change, written out on #1320.

  ONE DISCORD ACCOUNT, ONE SEAT (#2887). Patrick, 20 Oct, on both servers,
  dev included: a second game from an account already in the world is told
  why and ended. The seats counted characters, so one account running a
  second game under another of its characters took a second seat. Every pass
  names the Discord account the site signed it for (d), so the moment a pass
  proves a session, here in take() or at the sweep for a pass picked up at
  the menu, it is compared with every other session in the world: one whose
  own pass proves it, on the connection that pass proved. When one names the
  same account, the later session is told ACCOUNT_SENTENCE and ended, its
  pass is not kept, and the log names both profiles. The first keeps its
  seat. A reconnect is the same profile, so it is never its own twin; a
  connection the engine has already let go does not count, so closing one
  game and starting another goes through once the engine sees the first one
  gone. Staff seats are no different. The check waits for the pass, so a
  second game sits in the world held (#410) until its pass arrives.

  THE SERVER'S OWN FAILURES REFUSE TOO, decided on purpose (the standing rule
  is that refusing is the secure side, #937): no passKey in door.json, a relay
  that is down, a site that would not issue a pass. Each leaves a session with
  no valid pass, and the log says which.

  THE SESSION IS ENDED EITHER WAY (#937). A profile with no valid pass
  at the end of the grace is told one line and ended. thornswoodRequirePass
  does not decide that. Absent, or any other value, used to write WOULD
  REFUSE and let them stay. An older launcher never gets a pass, because the
  site signs one only from the channel minLauncher up to that feed's current
  launcher, so that session is the same refusal. The setting still decides
  the hold (#410): with it on, nothing the session does counts until the pass
  arrives. Deploy-DevGamemode.ps1 -RequirePass on|off sets the hold on the
  dev box, and Deploy-Server.ps1 -RequirePass on|off on live (#1223). No
  older launcher or plugin is kept working (Patrick, 28 Sep).

  THE HOLD FAILS CLOSED (#1319). false is the one way to turn it off. true
  holds, and so does anything else: absent, null, empty, "true" as text, 1.
  Until 5 Oct only exactly true held, so one empty value, which the dev
  server had on 29 Sep (#1222), dropped the hold for the whole server and
  said nothing. requiring() logs any value that is neither, with the value.
  Every reader asks requiring(): the seats block, the dispatcher, the voice
  feed. A deploy never changes what a box does unasked: Deploy-DevGamemode.ps1
  and Deploy-Server.ps1 refuse a server whose settings hold neither true nor
  false until -RequirePass says which.
*/
(function () {
  var g = globalThis;
  var crypto = null, fs = null, path = null;
  try { crypto = require('crypto'); fs = require('fs'); path = require('path'); } catch (e) { }

  var GRACE_MS = 180000;      // online this long with no valid pass: ended
  var BEFORE_MS = 60000;      // a pass at the menu not sent again this long, with no session, is let go
  var ISSUED_MS = 90000;      // a pass issued this long before a session began can still start it (#1320)
  var SWEEP_MS = 5000;
  var KEY_READ_MS = 60000;
  var SAY_AGAIN_MS = 600000;  // the same bad pass is logged at most this often
  var SENTENCE = 'This game was not started from an up to date Thornswood launcher, so ' +
                 'the session is being ended. Open the Thornswood launcher, let it update, ' +
                 'then press Play.';
  var ACCOUNT_SENTENCE = 'Your Discord account already has a character in the world, so this ' +
                         'second game is being ended: one account holds one seat. If you just ' +
                         'closed the other game, wait a minute, then press Play again.';
  var WAIT_SAY_MS = 15000;    // held this long with no pass: told why nothing works (#410)
  var WAITING = 'Your launcher\'s pass has not reached the server yet, so nothing you do ' +
                'counts until it does. Keep the Thornswood launcher open; if this does not ' +
                'clear in a minute, restart the game from the launcher.';

  // On globalThis, so a hot reload keeps who has shown a pass.
  // passes: profile -> { at, x, v, d, i, id, s }, the pass on hand, s the session it proved (0: none yet);
  // online: profile -> { joined, judged, actorId, sid, conn }; used: pass id -> { s, x } (#1320).
  if (!g.__thornswoodPassSeen) { g.__thornswoodPassSeen = { passes: {}, online: {}, said: {} }; }
  var seen = g.__thornswoodPassSeen;
  if (!seen.used) { seen.used = {}; }
  if (!seen.serial) { seen.serial = 0; }
  // Sessions from a block before #1320, on a hot reload: each gets its number,
  // and one that had already proved itself keeps the pass it showed.
  for (var was in seen.online) {
    if (Object.prototype.hasOwnProperty.call(seen.online, was) && !seen.online[was].sid) {
      seen.online[was].sid = ++seen.serial;
      if (seen.online[was].judged && seen.passes[was]) { seen.passes[was].s = seen.online[was].sid; }
    }
  }

  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }
  /* The hold (#410), failing closed (#1319): off only for false. */
  function requiring() {
    var v = settings().thornswoodRequirePass;
    if (v === true) { return true; }
    if (v === false) { return false; }
    var said = 'missing';
    if (v !== undefined) {
      try { said = String(JSON.stringify(v)).slice(0, 80) + (typeof v === 'string' ? ' (text)' : ''); }
      catch (e) { said = 'unreadable'; }
    }
    if (fresh('switch ' + said, Date.now())) {
      console.log('[thornswood] thornswoodRequirePass in server-settings.json is ' + said +
                  ', which is neither true nor false, so the join pass hold is on. ' +
                  'false is the one way to turn it off (#1319).');
    }
    return true;
  }
  function serverName() {
    return String(settings().thornswoodServer || '').trim().toLowerCase() || 'main';
  }

  var keyAt = 0;
  var keyHad = '';
  function passKey(now) {
    if (keyAt && now - keyAt < KEY_READ_MS) { return keyHad; }
    keyAt = now;
    var k = '';
    try {
      var dir = String(settings().privDir || 'private');
      var doc = JSON.parse(String(fs.readFileSync(path.join(dir, 'door.json'), 'utf8')).replace(/^\uFEFF/, ''));
      k = String((doc && doc.passKey) || '');
    } catch (e) { k = ''; }
    if (!k && fresh('no key', now)) {
      console.log('[thornswood] door.json has no passKey, so no join pass can be checked and every ' +
                  'session counts as having none. Set-Door.ps1 -Connect copies it from the site.');
    }
    keyHad = k;
    return k;
  }

  /* True when this line has not been said lately. */
  function fresh(key, now) {
    if (seen.said[key] && now - seen.said[key] < SAY_AGAIN_MS) { return false; }
    seen.said[key] = now;
    return true;
  }

  function b64u(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /*
    What a pass says, or why it says nothing. { ok, p, v, x } or { why, p }.
    The signature is checked before anything in the body is believed, with
    timingSafeEqual, so how long this takes says nothing about a guess.
  */
  function readPass(raw, key, now, server) {
    if (!key) { return { why: 'this server has no join pass key' }; }
    var parts = String(raw == null ? '' : raw).trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'jp1' || !parts[1] || !parts[2]) { return { why: 'not a join pass' }; }
    var want = Buffer.from(b64u(crypto.createHmac('sha256', key).update('jp1.' + parts[1]).digest()));
    var got = Buffer.from(parts[2]);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      return { why: 'a signature that does not check out' };
    }
    var o = null;
    try { o = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')); } catch (e) { o = null; }
    var p = o ? Number(o.p) : 0;
    if (!o || !(p > 0) || !(Number(o.x) > 0)) { return { why: 'a pass with nothing in it' }; }
    if (now > Number(o.x)) { return { why: 'an expired pass', p: p }; }
    if (String(o.s) !== server) { return { why: 'a pass for the ' + String(o.s) + ' server', p: p }; }
    // d is the Discord account the site signed it for; /stuck's staff record
    // names it (#414). i is when the site issued it, and id, its signature,
    // is what a session binds (#1320).
    return { ok: true, p: p, v: String(o.v || ''), x: Number(o.x), d: String(o.d || ''),
             i: Number(o.i) || 0, id: parts[2] };
  }

  /*
    Whether this pass may prove the session profileId is in now (#1320): r
    back with s, the session it is bound to (0 at the menu), or a refusal.
  */
  function bind(profileId, r) {
    var e = seen.online[profileId];
    var sid = e ? e.sid : 0;
    var u = seen.used[r.id];
    if (u && u.s && u.s !== sid) { return { why: 'a pass an earlier session already used', p: r.p }; }
    if (sid && !(u && u.s === sid) && r.i < e.joined - ISSUED_MS) {
      return { why: 'a pass issued before this session began', p: r.p };
    }
    seen.used[r.id] = { s: sid, x: r.x };
    r.s = sid;
    return r;
  }

  /*
    Which engine connection is behind a character now (#1320): its GUID, which
    is new for every connection, or its slot on an engine that cannot say. ''
    when there is none to name, which changes nothing.
  */
  function connOf(actorId) {
    var u = -1;
    try { u = mp.getUserByActor(actorId); } catch (e) { u = -1; }
    if (u === undefined || u === null || u < 0) { return ''; }
    if (typeof mp.getUserGuid !== 'function') { return 'user ' + u; }
    var guid = '';
    try { guid = String(mp.getUserGuid(u) || ''); } catch (e) { guid = ''; }
    return guid ? 'guid ' + guid : '';
  }

  /*
    Another connection behind this character (#1320): a session of its own,
    which the pass the last one showed does not prove. True when the session
    on record for pid was on another connection than conn, which is then let
    go with its pass.
  */
  function moved(pid, conn) {
    var e = seen.online[pid];
    if (!(e && conn && e.conn && conn !== e.conn)) { return false; }
    console.log('[thornswood] profile ' + pid + ' is on another connection now, so that session needs a join pass of its own');
    delete seen.passes[pid];
    delete seen.online[pid];
    return true;
  }

  /* A new session for pid on conn, from now. */
  function begin(pid, conn, now) {
    var e = seen.online[pid] = { joined: now, judged: false, actorId: 0, sid: ++seen.serial, conn: conn };
    // A pass that came at the menu is this session's, when it was issued
    // close enough before it and nothing else has used it.
    var menu = seen.passes[pid];
    if (menu && !menu.s && menu.i >= now - ISSUED_MS && !(seen.used[menu.id] && seen.used[menu.id].s)) {
      menu.s = e.sid;
      seen.used[menu.id] = { s: e.sid, x: menu.x };
    }
    return e;
  }

  /*
    Another profile in the world on Discord account d (#2887), or 0: a
    session whose own pass proves it and names d, still on the connection
    that pass proved, and not being ended for this itself.
  */
  function inWorld(pid, d) {
    if (!d) { return 0; }
    for (var k in seen.online) {
      if (!Object.prototype.hasOwnProperty.call(seen.online, k) || Number(k) === pid) { continue; }
      var o = seen.online[k];
      var h = seen.passes[k];
      if (o.twin || !h || h.s !== o.sid || h.d !== d) { continue; }
      var c = o.actorId ? connOf(o.actorId) : '';
      if (!c || (o.conn && c !== o.conn)) { continue; }
      return Number(k);
    }
    return 0;
  }

  /*
    A session this pass let in just now, that was held before it: the blocks
    that wait for that moment are told here, once, and the launcher's later
    passes for the same session tell nobody. Only the cuffs wait on it, so a
    guard who arrived still waiting on their pass is issued their pair now
    (#2573, passShown()).
  */
  function letIn(profileId) {
    var cuffs = g.__thornswoodCuffs;
    if (!cuffs || !cuffs.passShown) { return; }
    try { cuffs.passShown(profileId); }
    catch (e) { console.log('[thornswood] join pass: the cuffs issue for profile ' + profileId + ' failed: ' + e); }
  }

  /* One "/joinpass <pass>" from the relay, sent under profileId. */
  function take(profileId, raw, now) {
    var heldBefore = held(profileId, now);
    var r = readPass(raw, passKey(now), now, serverName());
    if (r.ok && r.p !== profileId) { r = { why: 'a pass for profile ' + r.p, p: r.p }; }
    // The character may be on a new connection the sweep has not seen yet
    // (#2013). A game started again within the engine's timeout logs in while
    // the last connection still looks alive, and its pass comes before the
    // next sweep: bound to the session on record it was spent on the dead
    // one, the sweep then let it go, and the new session was held until the
    // launcher's next pass. So that is settled first, the way the sweep does.
    var rec = r.ok ? seen.online[profileId] : null;
    if (rec && rec.actorId) {
      var connNow = connOf(rec.actorId);
      if (moved(profileId, connNow)) { begin(profileId, connNow, now).actorId = rec.actorId; }
    }
    if (r.ok) { r = bind(profileId, r); }
    // It proves a session now, so that session is judged now (#2887); one
    // at the menu is judged at the sweep that starts its session.
    var twin = r.ok && r.s ? inWorld(profileId, r.d) : 0;
    if (twin) {
      seen.online[profileId].twin = twin;
      if (seen.passes[profileId] && seen.passes[profileId].s === r.s) { delete seen.passes[profileId]; }
      r = { why: 'its Discord account is already in the world as profile ' + twin, p: r.p };
    }
    if (!r.ok) {
      if (fresh('bad ' + profileId + ' ' + r.why, now)) {
        console.log('[thornswood] join pass from profile ' + profileId + ' not taken: ' + r.why);
      }
      return r;
    }
    if (!seen.passes[profileId]) {
      console.log('[thornswood] join pass for profile ' + profileId + ', launcher ' + r.v);
    }
    seen.passes[profileId] = { at: now, x: r.x, v: r.v, d: r.d, i: r.i, id: r.id, s: r.s };
    if (heldBefore && !held(profileId, now)) { letIn(profileId); }
    return r;
  }

  // After the sentence, so it is on screen before the connection goes. Their
  // game is told the session ends (#1157), so it closes its side and does not
  // connect again by itself; the kick is for a game that does not.
  function refuseLater(profileId, actorId, sentence) {
    var line = g.__thornswoodSayLine;
    if (typeof line === 'function') { line(profileId, { end: sentence }); }
    setTimeout(function () {
      var userId = -1;
      try { userId = mp.getUserByActor(actorId); } catch (e) { userId = -1; }
      if (userId === undefined || userId === null || userId < 0) {
        console.log('[thornswood] could not find the connection of profile ' + profileId + ', so they stayed');
        return;
      }
      try { mp.kick(userId); } catch (e) { console.log('[thornswood] could not end profile ' + profileId + ': ' + e); }
    }, 5000);
  }

  /*
    Once every SWEEP_MS. online is [{ actorId, profileId }]; tell(profileId,
    text) says a line. Returns the profiles judged to have no pass this sweep.
  */
  function sweep(now, online, tell) {
    var here = {};
    var judged = [];
    for (var i = 0; i < online.length; i++) {
      var pid = Number(online[i] && online[i].profileId) || 0;
      if (!pid) { continue; }
      here[pid] = true;
      var conn = connOf(online[i].actorId);
      var e = moved(pid, conn) ? null : seen.online[pid];
      if (!e) { e = begin(pid, conn, now); }
      if (!e.conn && conn) { e.conn = conn; }
      e.actorId = online[i].actorId;
      if (e.judged) { continue; }
      var had = seen.passes[pid];
      if (had && had.s === e.sid) {
        e.twin = inWorld(pid, had.d);
        if (!e.twin) { e.judged = true; continue; }
        delete seen.passes[pid];
      }
      // A second game from an account already in the world (#2887).
      if (e.twin) {
        e.judged = true;
        tell(pid, ACCOUNT_SENTENCE);
        console.log('[thornswood] refusing profile ' + pid + ': its Discord account is already in the world as profile ' + e.twin);
        refuseLater(pid, e.actorId, ACCOUNT_SENTENCE);
        continue;
      }
      // Held until then (#410): said once, after long enough that a pass on
      // its way has had time to arrive.
      if (requiring() && !e.told && now - e.joined >= WAIT_SAY_MS) {
        e.told = true;
        tell(pid, WAITING);
      }
      if (now - e.joined < GRACE_MS) { continue; }
      e.judged = true;
      judged.push(pid);
      var why = passKey(now) ? 'no valid join pass in ' + Math.round((now - e.joined) / 1000) + 's online'
                             : 'this server has no join pass key in door.json';
      tell(pid, SENTENCE);
      console.log('[thornswood] refusing profile ' + pid + ': ' + why);
      refuseLater(pid, e.actorId, SENTENCE);
    }
    // Gone: the next session under that number needs a pass of its own.
    for (var k in seen.online) {
      if (Object.prototype.hasOwnProperty.call(seen.online, k) && !here[k]) {
        delete seen.online[k];
        delete seen.passes[k];
      }
    }
    for (var q in seen.passes) {
      if (Object.prototype.hasOwnProperty.call(seen.passes, q) && !here[q] &&
          now - seen.passes[q].at > BEFORE_MS) { delete seen.passes[q]; }
    }
    // A pass past its expiry is refused by readPass anyway.
    for (var u in seen.used) {
      if (Object.prototype.hasOwnProperty.call(seen.used, u) && !(Number(seen.used[u].x) > now)) { delete seen.used[u]; }
    }
    return judged;
  }

  /*
    NOTHING TRUSTS A PROFILE NUMBER THE PASS HAS NOT PROVED (#410).

    The pass ends a session that never shows one, but only after GRACE_MS, and
    until then the rest of this file took the number the client logged in
    under at its word: that character's inventory, trades and crafting, its
    roles (admin, staff, playtester, Jarl), its place in the line, its
    commands. So with thornswoodRequirePass on, a profile is taken at its word
    only once this block has a pass for it:

      shown(pid)    a valid pass bound to the session it is in now (#1320).
                    A profile not yet seen online (at the menu, or joined
                    since the last sweep) counts a pass that has not expired.
      proven(pid)   shown, and the pass has not expired: what a role needs.
                    The launcher renews it every minute while it is open.
      held(pid)     enforcement is on and pid has not shown one: the session
                    is in the world, but nothing it does counts yet.
      trusts(pid)   what a role check asks: proven when enforcement is on,
                    and anything while it is only watched.

    Watch-only changes nothing here, so the server can run like this before
    it is switched on. What must work before a pass arrives, and how it stays
    safe: the pass itself ("/joinpass", checked against its own signature),
    the line ("/line", which already asks for a pass before it seats anybody),
    and the game session existing at all, which cannot act (every engine event
    it raises is refused by guard(), and its commands wait in the dispatcher's
    queue) until the pass comes, and is ended at GRACE_MS if it never does.
  */
  function shown(pid, now) {
    pid = Number(pid) || 0;
    if (!pid) { return false; }
    var had = seen.passes[pid];
    if (!had) { return false; }
    var e = seen.online[pid];
    if (e) { return had.s === e.sid; }
    return Number(had.x) > now;
  }
  function proven(pid, now) {
    if (!shown(pid, now)) { return false; }
    return Number(seen.passes[Number(pid)].x) > now;
  }
  function held(pid, now) { return requiring() && !shown(pid, now); }
  function trusts(pid, now) { return !requiring() || proven(pid, now); }

  /*
    THE LOGIN PROVES THE PASS ON ITS OWN CONNECTION (#1320), watched only.

    The pass reaches this block over the relay's socket, which names a profile
    and nothing else, so this block cannot tie a pass to the game connection
    that holds the character. The fork's login (skymp5-server,
    thornswoodLogin.ts) can: with mp.onThornswoodLogin set, it sends every
    offline login a fresh nonce, and a client of that engine answers with the
    pass and HMAC-SHA256 of "jlp1." + nonce under the pass's own key. The site
    gives the launcher that key over https beside the pass (passLoginKey in
    site/server.js: HMAC-SHA256 of "jpk1." and the pass's mac, keyed on
    passKey), so it never travels on the game's port, and a pass and mac seen
    on the wire prove nothing on another connection, whose nonce is another.

    WATCHED ONLY, ON PURPOSE. A launcher and an engine that answer are not on
    everybody's machine yet, and a client that does not know the challenge
    never answers. So the login hands over the profile asked for, exactly as
    before, and the proof, when one comes, is checked and logged: good, or
    why not. Nothing is refused here. Waiting for a good proof, and handing
    over the pass's profile rather than the one asked for, is the next step,
    once main's launcher and engine carry all of it and these lines show a
    good proof for every login; it is written out on #1320.

    loginProof(e, now) is what that step will ask: { ok, p } or { why }.
  */
  function loginProof(e, now) {
    var key = passKey(now);
    if (!e || !e.proof) { return { why: 'no proof' }; }
    var r = readPass(e.proof.pass, key, now, serverName());
    if (!r.ok) { return { why: r.why, p: r.p }; }
    var own = b64u(crypto.createHmac('sha256', key).update('jpk1.' + r.id).digest());
    var want = Buffer.from(b64u(crypto.createHmac('sha256', own).update('jlp1.' + String(e.nonce)).digest()));
    var got = Buffer.from(String(e.proof.mac || ''));
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      return { why: 'a mac that does not check out for this connection', p: r.p };
    }
    if (r.p !== Number(e.profileId)) {
      return { ok: true, p: r.p, why: 'a pass for profile ' + r.p + ', logged in as ' + e.profileId };
    }
    return { ok: true, p: r.p };
  }

  function onLogin(e) {
    var now = Date.now();
    var asked = Number(e && e.profileId) || 0;
    if (!e || !e.proof) {
      console.log('[thornswood] login of profile ' + asked + ' on user ' + (e && e.userId) +
                  ' challenged; handed over as asked (watching, #1320)');
      return asked;
    }
    var v = loginProof(e, now);
    console.log('[thornswood] login proof from profile ' + asked + ' on user ' + e.userId + ': ' +
                (v.ok ? (v.why ? 'good, but ' + v.why : 'good') : v.why) + ' (watching, nothing refused)');
    return -1;
  }
  // Set again on every load, so a hot reload's hook is this one. An engine
  // older than the fork's login challenge never calls it.
  mp.onThornswoodLogin = onLogin;

  g.__thornswoodJoinPass = { take: take, sweep: sweep, readPass: readPass,
                             grace: GRACE_MS, sentence: SENTENCE, waiting: WAITING,
                             accountSentence: ACCOUNT_SENTENCE,
                             shown: shown, proven: proven, held: held, trusts: trusts,
                             requiring: requiring, loginProof: loginProof, onLogin: onLogin };

  /*
    The one question every other block asks, safe to call before this block
    has loaded (a block above it in this file, or a hot reload half way):
    with no join pass block there is nothing to require, so it trusts.
  */
  // A throw here is a bug, and it answers the secure way (not trusted, held)
  // and says so, rather than letting the number through.
  g.__thornswoodPassTrusts = function (pid) {
    var jp = g.__thornswoodJoinPass;
    try { return !jp || !jp.trusts || jp.trusts(pid, Date.now()); }
    catch (e) { console.log('[thornswood] join pass trusts() threw, so profile ' + pid + ' is not trusted: ' + e); return false; }
  };
  g.__thornswoodPassHeld = function (pid) {
    var jp = g.__thornswoodJoinPass;
    try { return !!(jp && jp.held && jp.held(pid, Date.now())); }
    catch (e) { console.log('[thornswood] join pass held() threw, so profile ' + pid + ' is held: ' + e); return true; }
  };

  if (g.__thornswoodPassTimer) { clearInterval(g.__thornswoodPassTimer); }
  g.__thornswoodPassTimer = setInterval(function () {
    try {
      var list = [];
      var online = mp.get(0, 'onlinePlayers') || [];
      for (var i = 0; i < online.length; i++) {
        var pid = 0;
        try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e) { pid = 0; }
        if (pid) { list.push({ actorId: online[i], profileId: pid }); }
      }
      var say = g.__thornswoodToProfile;
      sweep(Date.now(), list, function (p, text) { if (say) { say(p, text); } });
    } catch (e) {
      console.log('[thornswood] join pass sweep failed: ' + e);
    }
  }, SWEEP_MS);

  console.log('[thornswood] join pass ' + (requiring() ? 'REQUIRED' : 'watched only') +
              ' on the ' + serverName() + ' server, key ' + (passKey(Date.now()) ? 'present' : 'MISSING'));
})();
// ==== end thornswood join pass ====


