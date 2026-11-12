'use strict';
/*
  The chat's connection, page side.

  Where the messages actually travel, and why here rather than through the game
  server: the voice service already relays them. It has since it was written.
  Look at the socket handler in voice-server.js:

      if (msg.t === 'chat') {
        ...
        for (const [, p] of peers) p.ws.send(out);
      }

  Everyone with the game open already holds that socket, the service already
  knows who they are, and it is plain JavaScript on the VPS that can be changed
  without recompiling anything. Going through the game server instead would
  mean a new packet type in skymp5-client, and skymp5-client is compiled.

  It runs in the page rather than in a plugin because the browser is where a
  WebSocket exists. SkyrimPlatform's own HttpClient can only poll.

  The page is served from file:///, which Chromium treats as a trustworthy
  origin, so it may open sockets anywhere. It opens only wss:// to the
  address the launcher gives it, since the join token goes with the handshake
  and the service refuses one over plain ws (#1304).
*/

(function () {
  if (window.thornswoodNet) return;

  var CFG = window.THORNSWOOD || {};
  var HOST = String(CFG.host || '');
  var PORT = Number(CFG.port || 7778);
  var ME   = Number(CFG.profileId || 0);
  var NAME = String(CFG.name || 'Traveller');
  // Who the voice service believes we are. Everything else on this socket,
  // chat included, hangs off the identity this establishes.
  var TOKEN = String(CFG.token || '');
  // Taken, so the page's settings do not keep a copy of it (#1821).
  CFG.token = '';
  /*
    ONE TOKEN, ONE TRY (#1322, #1337). TOKEN is one not yet used, or ''. It
    goes with the handshake, as the protocol after 'thornswood', and is spent
    on that try whatever comes of it: the service opens one connection with a
    token and refuses a handshake without one. A try with none asks the front
    for one ('token? <profile>' to thornswood-front, which asks the launcher
    through the folder push to talk uses) and waits for the backoff, and a
    token handed over by setToken or rejoinAs goes at once. SPENT is the last
    one used, because the front can hand the same string over again until the
    launcher has written a new one. It is only compared, never sent again or
    handed to anything else: the relay list comes on the roster (#1821), so no
    other page needs a token once the handshake has spent it.
  */
  var SPENT = '';

  // Colours from the launcher's own palette so the chat looks like the rest of
  // the build rather than like a web page.
  var C_NAME = '#c6aa6d';
  var C_TEXT = '#e8e3d8';
  var C_SYS  = '#8f8a7d';
  var C_WARN = '#c98b6b';
  // An action, /me and /do, and a whisper. Only used while the voice service
  // has THORNSWOOD_CHAT_RANGE on; see partsFor.
  var C_ACT   = '#b8a6cf';
  var C_QUIET = '#b3ada0';

  var ws = null;
  var tries = 0;
  var joined = false;
  var timer = null;
  var queue = [];
  // setName closes a joined socket on purpose. That close is not the server
  // being lost, so neither it nor the welcome after it is said. See setName.
  var renaming = false;

  // One socket, not two.
  //
  // Voice needs the same connection: the service hands out a peer id per
  // socket, and a second one from the same game would show up as a second
  // person in the room, get its own half of every WebRTC negotiation, and
  // double every line in the chat. So this file owns the connection and
  // anything else that wants it subscribes here.
  var listeners = [];
  var peerId = 0;

  function fanout(msg) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](msg); } catch (e) {
        try { console.log('[chat] listener threw: ' + e); } catch (e2) { }
      }
    }
  }

  /*
    WHAT VOICE MISSED BEFORE IT GOT ON (#1869).

    Nothing orders this socket joining the room against the game's voice
    overlay getting on it. The socket joins as soon as it has a token: at
    the character choice, for somebody waiting in line (#481, #1142), and
    otherwise whenever the launcher hands one over. The overlay gets on when
    the voice plugin first configures it, about two seconds after the
    overlays go in. The service sends the roster when somebody joins or
    leaves and at no other time, and everybody already in the room builds a
    connection to this one off that roster and sends its offer at once.
    Whatever came before voice was listening went to fanout and so nowhere:
    the overlay had nobody to open until the next join or leave, and then
    its own offer met a peer still waiting on the answer to the one it had
    sent, which the impolite side of a pair ignores. Neither ever answered
    the other. tests/test-1869-voice-negotiation.js runs both pages through
    the real service in that order.

    So until voice gets on (board, below), the newest roster and the offers
    and candidates sent to this connection are kept, and board hands them
    over in that order before anything new. The service always writes the
    roster that names somebody before anything they send here, so the
    overlay opens a peer before it hears from them, as it does live. A newer
    roster replaces the old one, and what is kept from somebody it no longer
    names goes, because they left and their peer id is never handed out
    again. A new connection starts with nothing kept: the room offers to its
    new peer id. Once voice is on, nothing is kept: it hears everything from
    then on, across reconnects, relay mode included, where it reads the
    positions and drops the signalling (#1959).

    A connection gathers a handful of candidates and sends one offer before
    it hears an answer, so a hundred from one peer is not a connection
    being made. Nothing more from that peer is kept, and the log says so
    once.

    THE POSITION VIEW, THE MODES AND THE SILENCES TOO (#1924). The service
    sends a connection its whole view once, { t: 'pos' } on the first tick
    after it joins, and from then on only the rows that changed
    ({ t: 'moved' }, the note over the tick in voice/voice-server.js). So
    an overlay that got on after that first tick never held anybody
    standing still, itself included: no speaking marks until it moved, the
    party strip reading the same empty table, and nobody placed in its own
    mesh. So the view is kept as
    the overlay would have kept it, the last whole one with every change
    since applied, and board hands it over as one whole view. A mode said
    since the newest roster is written onto that roster, for everybody on
    the speaker's profile, as the service does for the next roster it
    sends. A staff silence is kept until it is lifted, since it is told to
    every connection once and the rows carry it only when they change. Each
    of these replaces what it says rather than adding to it, so none of
    them grows.
  */
  var HELD_FROM_ONE = 100;
  /* False once the voice overlay has handed the audio to a launcher, for
     the rest of this page (noVoice, below). */
  var carriesVoice = true;
  var heldRoom = null;
  var heldSignals = [];
  var heldView = null;
  var heldViewAt = 0;
  var heldHush = {};
  var boarded = false;
  var saidTooMany = false;

  function keep(msg) {
    if (boarded) return;
    if (msg.t === 'peers') {
      heldRoom = msg;
      var named = {};
      var list = msg.peers || [];
      for (var i = 0; i < list.length; i++) { named[list[i].peer] = true; }
      heldSignals = heldSignals.filter(function (s) { return named[s.from]; });
      return;
    }
    if (msg.t === 'pos') {
      heldView = {};
      var whole = msg.who || {};
      for (var w in whole) {
        if (Object.prototype.hasOwnProperty.call(whole, w)) { heldView[w] = whole[w]; }
      }
      heldViewAt = msg.at;
      return;
    }
    if (msg.t === 'moved') {
      // The service sends a connection its whole view before any change to
      // it, so there is always one here to apply this to.
      if (!heldView) return;
      var rows = msg.who || {};
      for (var r in rows) {
        if (Object.prototype.hasOwnProperty.call(rows, r)) { heldView[r] = rows[r]; }
      }
      var gone = msg.gone || [];
      for (var g = 0; g < gone.length; g++) { delete heldView[gone[g]]; }
      heldViewAt = msg.at;
      return;
    }
    if (msg.t === 'vmode') {
      // Said by somebody the newest roster names, since the service writes
      // that roster here before anything they send.
      var on = heldRoom ? (heldRoom.peers || []) : [];
      for (var v = 0; v < on.length; v++) {
        if (Number(on[v].profileId) === Number(msg.profileId)) { on[v].mode = msg.mode; }
      }
      return;
    }
    if (msg.t === 'hush') {
      var pid = Number(msg.profileId) || 0;
      if (!pid) return;
      if (msg.on) { heldHush[pid] = true; } else { delete heldHush[pid]; }
      return;
    }
    if (msg.t !== 'sdp' && msg.t !== 'ice') return;
    var fromThem = 0;
    for (var j = 0; j < heldSignals.length; j++) {
      if (heldSignals[j].from === msg.from) fromThem++;
    }
    if (fromThem >= HELD_FROM_ONE) {
      if (!saidTooMany) {
        saidTooMany = true;
        try { console.log('[chat] peer ' + msg.from + ' sent ' + HELD_FROM_ONE + ' offers and candidates before voice was on; no more are kept'); } catch (e) { }
      }
      return;
    }
    heldSignals.push(msg);
  }

  function forget() {
    heldRoom = null;
    heldSignals = [];
    heldView = null;
    heldViewAt = 0;
    heldHush = {};
  }

  function chat() { return window.thornswoodChat; }

  /*
    How one chat line is drawn, by what kind of line it is.

    A plain line arrives as say. /me and /do are actions and read as one.
    A whisper is dimmer. A shout says so. An /ooc is in brackets. A line
    with no kind, from an older service, is the name and then the words.
    A kind this page has never heard of is drawn as a plain line.
  */
  function partsFor(msg) {
    var who = String(msg.name || '').trim() || 'Someone';
    var mine = ME && Number(msg.profileId) === ME;
    var nc = mine ? '#d8c79a' : C_NAME;
    var said = String(msg.text || '');
    var kind = String(msg.kind || '');
    if (kind === 'me') {
      return [{ text: '* ' + who + ' ', color: nc }, { text: said, color: C_ACT }];
    }
    if (kind === 'do') {
      return [{ text: '* ' + said + ' ', color: C_ACT }, { text: '(' + who + ')', color: nc }];
    }
    if (kind === 'whisper') {
      return [{ text: who + ' whispers: ', color: nc }, { text: said, color: C_QUIET }];
    }
    if (kind === 'shout') {
      return [{ text: who + ' shouts: ', color: nc }, { text: said, color: C_TEXT }];
    }
    if (kind === 'ooc') {
      return [{ text: '(( ' + who + ': ', color: nc }, { text: said + ' ))', color: C_TEXT }];
    }
    return [{ text: who + ': ', color: nc }, { text: said, color: C_TEXT }];
  }

  /* The one line above a head. Your own uses the local character, because
     the form id the server has may not be the one this machine is playing. */
  function showHead(msg) {
    if (!msg || !msg.head) return;
    var mine = ME && Number(msg.profileId) === ME;
    var who = mine ? 'self' : String(Number(msg.actor) || 0);
    if (who === '0') return;
    try {
      window.skyrimPlatform.sendMessage('thornswood-front', 'head:' + JSON.stringify({
        who: who, text: String(msg.head), profile: Number(msg.profileId) || 0
      }));
    } catch (e) { }
  }

  function note(text, color) {
    var c = chat();
    if (c) c.add([{ text: text, color: color || C_SYS }], 'plain');
  }

  /*
    Through Caddy, the only way in (#1304): a base of https://... gives
    wss://. The raw port this fell back to without a base is shut, and the
    service refuses a join token over plain ws, so anything that is not
    https is no address at all.
  */
  function url() {
    var b = String(CFG.base || '').replace(/\/+$/, '');
    if (b.indexOf('https://') === 0) { return 'wss://' + b.slice(8) + '/'; }
    return '';
  }

  function connect() {
    if (!HOST) { note('No server address, so the chat is off.', C_WARN); return; }
    if (!url()) { note('No secure address for the chat from the launcher, so the chat is off.', C_WARN); return; }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

    if (!TOKEN) {
      try { window.skyrimPlatform.sendMessage('thornswood-front', 'token? ' + ME); } catch (e) { }
      retry();
      return;
    }
    var token = TOKEN;
    SPENT = token;
    TOKEN = '';
    try {
      ws = new WebSocket(url(), ['thornswood', token]);
    } catch (e) {
      retry();
      return;
    }

    ws.onopen = function () {
      // Not tries = 0 here: a join the service refuses opens first and is
      // closed straight after, and resetting on the open made that a retry
      // every second for as long as the token was refused (issue #409). The
      // welcome is what says we are in.
      joined = false;
      heard = Date.now();
      // Said in the join once voice has gone to a launcher (noVoice), so a
      // new connection is on the room's roster as carrying none from the
      // first roster on, and no launcher builds a connection to it (#1925).
      var join = { t: 'join', profileId: ME, name: NAME };
      if (!carriesVoice) { join.voice = false; }
      try {
        ws.send(JSON.stringify(join));
      } catch (e) { }
    };

    ws.onmessage = function (ev) {
      heard = Date.now();
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.t) return;
      if (msg.t === 'pong') return;

      if (msg.t === 'welcome') {
        tries = 0;
        joined = true;
        peerId = Number(msg.peer) || 0;
        forget();
        fanout(msg);
        if (!renaming) note('Chat is on. Press enter to talk.', C_SYS);
        renaming = false;
        // Anything typed while the socket was down goes now rather than being
        // lost, which is what an unacknowledged send would have been.
        while (queue.length) {
          try { ws.send(JSON.stringify(chatFrame(queue.shift()))); }
          catch (e) { break; }
        }
        return;
      }

      // A line above a head, with nothing in the box. An emote uses this.
      // Staff silence uses headclear so a line already up does not sit
      // out its six seconds.
      if (msg.t === 'head') {
        showHead({ head: msg.text, profileId: msg.profileId, actor: msg.actor });
        return;
      }
      if (msg.t === 'headclear') {
        try {
          window.skyrimPlatform.sendMessage('thornswood-front',
            'headclear:' + (Number(msg.profileId) || 0));
        } catch (e) { }
        return;
      }

      // Anything that is not chat belongs to whoever else is on this socket,
      // and what voice needs is kept until it is on (keep).
      if (msg.t !== 'chat') { keep(msg); fanout(msg); return; }

      /*
        The line at the menu (#481): the game server's word on this person's
        place, or that it is their turn, as data. Only the service itself
        sends from 0, and only the gamemode names a line 'Thornswood line',
        so no person can send one. Handed to the character choice page as
        { t: 'line', ... } and never drawn in the chat.
      */
      if (!Number(msg.from) && !Number(msg.profileId) && msg.name === 'Thornswood line') {
        var said = null;
        try { said = JSON.parse(String(msg.text || '')); } catch (e) { said = null; }
        if (said && typeof said === 'object') {
          // Moved out of the world for being idle (#1142): the front takes the
          // game back to the character choice, if it has not already.
          if (said.afk === 'out') {
            try { window.skyrimPlatform.sendMessage('thornswood-front', 'afk:out server'); } catch (e) { }
          }
          // The server is ending this session on purpose (#1157): the front
          // closes the game's connection before the kick, so the client does
          // not connect again by itself, and shows the sentence at the choice.
          if (typeof said.end === 'string' && said.end) {
            try { window.skyrimPlatform.sendMessage('thornswood-front', 'session:end', said.end); } catch (e) { }
          }
          said.t = 'line';
          fanout(said);
        }
        return;
      }

      // And from here down it is chat, which the line above already settled.
      // There was a second `if (msg.t === 'chat')` wrapped round all of this,
      // which could never be false.
      {
        showHead(msg);
        var c = chat();
        if (!c) return;
        c.add(partsFor(msg), 'plain');
        return;
      }

      // 'peers' and 'pos' belong to voice. Ignored here on purpose rather than
      // logged: they arrive several times a second.
    };

    ws.onclose = function () { lost(); };

    ws.onerror = function () {
      try { ws.close(); } catch (e) { }
    };
  }

  /*
    A token handed over: kept unless it is the one just spent, and used at
    once when no connection is up or opening, rather than after the backoff.
  */
  function take(t) {
    t = String(t || '');
    if (!t || t === SPENT || t === TOKEN) return;
    TOKEN = t;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (timer) { clearTimeout(timer); timer = null; }
    connect();
  }

  /* The socket is gone, however it went. */
  function lost() {
    if (joined && !renaming) note('Chat lost the server. Trying again.', C_WARN);
    joined = false;
    peerId = 0;
    forget();
    fanout({ t: '__closed' });
    retry();
  }

  function retry() {
    if (timer) return;
    // Backs off to half a minute and stays there. Somebody who alt tabs out
    // for an hour should not come back to a thousand failed connections.
    // Somewhere in the second half of that, so a service restart does not
    // bring every page in the world back in the same instant. Where in it
    // comes from the profile id rather than from chance: no Math.random in
    // this file, which game/tests/test-dice.js holds it to because the dice are
    // the server's.
    var cap = Math.min(30000, 1000 * Math.pow(2, Math.min(tries, 5)));
    var spread = ((Math.abs(ME) % 1009) + tries * 389) % 1009 / 1009;
    var wait = Math.round(cap / 2 + spread * cap / 2);
    tries++;
    timer = setTimeout(function () { timer = null; connect(); }, wait);
  }

  /*
    LISTENING FOR THE SERVER, issue #519.

    The service pings every socket, and this browser answers without the page
    ever hearing of it, so a socket that went half open, after a sleep or a
    change of network, looked here exactly like a quiet room: the chat said
    nothing was wrong and nothing typed went anywhere. Every twenty five
    seconds this sends { t: 'ping' }, the service answers { t: 'pong' }, and
    seventy seconds with nothing at all from it is a lost server, said and
    retried like any other.
  */
  var PING_EVERY = 25000, SILENT_AFTER = 70000;
  var heard = 0;
  setInterval(function () {
    if (!ws || ws.readyState !== 1 || !joined) return;
    if (Date.now() - heard > SILENT_AFTER) {
      var dead = ws;
      ws = null;
      dead.onopen = dead.onclose = dead.onerror = dead.onmessage = null;
      try { dead.close(); } catch (e) { }
      lost();
      return;
    }
    try { ws.send(JSON.stringify({ t: 'ping' })); } catch (e) { }
  }, PING_EVERY);

  // --------------------------------------------------------------- dice ---
  // /roll, because a shop full of haggling needs one and the front's own dice
  // pouch has been taken off the screen.
  //
  // The number is the number of sides. Not "d20", just 20, because nobody
  // wants to type a letter to roll a die and the d only ever meant something
  // to people who already play tabletop.
  //
  //   /roll          one 20
  //   /roll 20       one 20
  //   /roll 1000     one 1000
  //   /roll 6x3      three 6s, added up
  //
  // Sides: any whole number from 1 to 1000. Dice: up to 100 of them. Decimals
  // are refused rather than rounded, because a roll nobody can predict the
  // shape of is worse than no roll.
  //
  // ROLLED ON THE SERVER, NOT HERE, AND THAT IS THE WHOLE POINT OF A DIE.
  //
  // This used to roll in the page and send the RESULT as an ordinary chat
  // line: "/roll 20" went out as the words "rolls 20: 17". The comment that
  // stood here said so and called it the right trade among five friends.
  //
  // It stopped being the right trade the moment a steward settled a dispute
  // by asking somebody to roll for it. Anybody who can open a console can
  // type "rolls 20: 20" themselves, and nobody reading the room can tell the
  // two apart. A roll anybody can fake is worth less than no roll at all.
  //
  // So the spec goes to the server and the words come back from it. What is
  // left here is the same parsing, used only to refuse nonsense before it
  // travels: the answer is the server's and this cannot produce one.
  var ROLL = /^\/(roll|r)\b\s*(.*)$/i;
  var SPEC = /^(\d+)(?:\s*[x*]\s*(\d+))?$/;

  var MAX_SIDES = 1000;
  var MAX_DICE = 100;
  var DEFAULT_SIDES = 20;

  function rollOf(spec) {
    spec = String(spec || '').trim().toLowerCase().replace(/\s+/g, '');
    // A leading d is not the syntax, but somebody who has rolled dice before
    // will type it on reflex, so it is dropped rather than refused.
    spec = spec.replace(/(^|[x*])d/g, '$1');
    if (!spec) spec = String(DEFAULT_SIDES);

    var m = SPEC.exec(spec);
    if (!m) return null;

    var sides = parseInt(m[1], 10);
    var count = m[2] ? parseInt(m[2], 10) : 1;

    if (!isFinite(sides) || sides < 1 || sides > MAX_SIDES) return null;
    if (!isFinite(count) || count < 1 || count > MAX_DICE) return null;

    /*
      The spec back in its plain form, never a result.

      Rebuilt rather than passed through, so what goes to the server is always
      "20" or "6x3" whatever somebody typed, including the d they typed on
      reflex. The server parses it again and does not trust this: this is here
      so a typo is answered in the same breath instead of a round trip later.
    */
    return count === 1 ? String(sides) : (count + 'x' + sides);
  }

  /* A queued line is its text, or { text, press } for one a key sent (#2251). */
  function chatFrame(item) {
    if (item && typeof item === 'object') return { t: 'chat', text: item.text, press: true };
    return { t: 'chat', text: item };
  }

  /*
    TWO ANSWERS, NOT ONE FLAG (#2732). Every line asks two things of send:
    whether somebody typed it, and whether a line held for the socket says
    "Not connected yet". Until #2732 one flag, auto, answered both: it marked
    a line as pressed (#2251) and it kept the notice quiet. A panel button
    wants the mark and the notice, because somebody pressed it and should be
    told it is waiting, so no panel could pass auto and none did, and the
    party, trade, merchant and ride buttons and the look keys went into the
    chat log as if somebody had typed them.

    So which door a line comes in by says whether it was typed, and quiet is
    asked on its own:

      typed(text)              the chat box (thornswood-bridge.js) and nothing
                               else: no press, and told when it is queued.
      say(text)                a key or a panel button: press, and told when
                               it is queued.
      say(text, { quiet: true })
                               a line the front plugin sends by itself or for
                               a key it handles (tellServer, the wait in line,
                               the join pass): press, and queued without a
                               word. Patrick, 24 September, over a tester in
                               the creation hall who had typed nothing: "it
                               says mulitple trimes he wasnt connected yet".

    A line that is not typed is pressed whatever the notice does, and only the
    chat box can send a line as typed. game/tests/test-2732-press-mark.js holds
    every caller to one of the three.
  */
  function send(text, press, notice) {
    text = String(text == null ? '' : text).trim();
    if (!text) return false;

    var dice = ROLL.exec(text);
    if (dice) {
      var spec = rollOf(dice[2]);
      if (!spec) {
        note('The number is the sides: /roll 20, /roll 1000, or /roll 6x3 for three of them. ' +
             'Whole numbers, 1 to ' + MAX_SIDES + ', up to ' + MAX_DICE + ' dice.', C_WARN);
        return false;
      }
      // The command, not the answer. See the note over ROLL.
      text = '/roll ' + spec;
    }
    // A line a key or a button sent says so (#2251), so the chat log does
    // not record the lock key as somebody typing /lock. Queued with the
    // flag, so a line held through an outage keeps it.
    var item = press ? { text: text, press: true } : text;
    if (ws && ws.readyState === 1 && joined) {
      try { ws.send(JSON.stringify(chatFrame(item))); return true; }
      catch (e) { }
    }
    // Held rather than dropped, and capped so a long outage does not grow
    // without limit.
    queue.push(item);
    while (queue.length > 20) queue.shift();
    if (notice) note('Not connected yet, that is queued.', C_WARN);
    return false;
  }

  window.thornswoodNet = {
    /* A key or a panel button. See TWO ANSWERS above send. */
    say: function (text, how) {
      return send(text, true, !(how && how.quiet === true));
    },

    /* What somebody typed in the chat box, from thornswood-bridge.js alone. */
    typed: function (text) {
      return send(text, false, true);
    },

    state: function () {
      return { host: HOST, port: PORT, joined: joined,
               ready: ws ? ws.readyState : -1, queued: queue.length };
    },

    /** Whoever else wants the socket, as the line at the character choice
        does. Voice gets on with board, below. */
    on: function (fn) {
      if (typeof fn === 'function') { listeners.push(fn); }
    },

    /*
      How voice gets on (#1869): on, and first everything kept for it since
      this connection joined, the newest roster, then the whole position
      view and the silences still on (#1924), and then the offers and
      candidates in the order they came. See keep.
    */
    board: function (fn) {
      if (typeof fn !== 'function') return;
      listeners.push(fn);
      if (boarded) return;
      boarded = true;
      var missed = heldRoom ? [heldRoom] : [];
      if (heldView) { missed.push({ t: 'pos', at: heldViewAt, who: heldView }); }
      for (var h in heldHush) {
        if (Object.prototype.hasOwnProperty.call(heldHush, h)) {
          missed.push({ t: 'hush', profileId: Number(h), on: true });
        }
      }
      missed = missed.concat(heldSignals);
      forget();
      for (var i = 0; i < missed.length; i++) {
        try { fn(missed[i]); } catch (e) {
          try { console.log('[chat] listener threw: ' + e); } catch (e2) { }
        }
      }
    },

    /*
      Voice has gone to the launcher, for good (#1925). The overlay calls
      this when it goes into relay mode, which it never leaves. Every page in
      the room builds a WebRTC connection to everybody on the roster, and in
      relay mode the overlay takes no signalling, so each of those to this
      socket sent its offer and waited for ever. So the service is told this
      connection carries no voice, its row on the roster says so, and the
      pages close the connection they had to it and build none. An open
      socket has sent its join already (onopen sends it in the same task the
      socket opens in), so this goes after it on the same socket; one still
      opening says it in the join, as every later connection does.
    */
    noVoice: function () {
      if (!carriesVoice) return;
      carriesVoice = false;
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ t: 'voice', on: false })); } catch (e) { }
      }
    },

    /** Raw send, for message kinds this file has no opinion about. */
    post: function (obj) {
      if (!ws || ws.readyState !== 1 || !joined) { return false; }
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    },

    /** The service's id for this connection, 0 until the welcome arrives. */
    peer: function () { return peerId; },

    isUp: function () { return !!(ws && ws.readyState === 1 && joined); },

    /**
     * The name is only known once the character exists, so it can arrive late.
     *
     * Reconnects rather than sending a second join. The service hands out a new
     * peer id for every join and never removes the old one, so a second join on
     * a live socket leaves two entries pointing at the same connection and you
     * see every message twice. Closing first makes the service drop the old
     * entry properly, and costs one round trip nobody will notice.
     */
    setName: function (n) {
      n = String(n || '').trim();
      if (!n || n === NAME) return;
      NAME = n;
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
        tries = 0;
        // Ours, not an outage. In creation the name lands right after the
        // race menu, and this close used to say "Chat lost the server" there.
        if (joined) renaming = true;
        try { ws.close(); } catch (e) { }
      } else {
        connect();
      }
    },

    /**
     * A join token the launcher minted because this page asked for one,
     * pushed in from thornswood-front.js (#1322).
     *
     * A try waiting on it goes at once. One that arrives while the connection
     * is up is kept for the next try. The one this page last spent is not
     * taken again: the front reads the file the launcher writes and can hand
     * the same string over twice.
     */
    setToken: function (t) {
      take(t);
    },

    /**
     * Another of this person's characters, at the character choice (#1142).
     *
     * Somebody moved out of the world for being idle keeps this page and its
     * connection, which is the character they were, and waits in line as it.
     * When they pick another character the front hands the place over and
     * then calls this with that character's own join token: the connection
     * closes and opens again as that character, the way setName does, since
     * the service takes who somebody is from the token at the handshake and
     * never after. The same character again only takes the token, which goes
     * at once if a try is waiting on it (see take).
     */
    rejoinAs: function (id, t) {
      id = Number(id) || 0;
      if (!id || id === ME) { take(t); return false; }
      ME = id;
      // A token for the character this was is no use to the next one.
      TOKEN = '';
      t = String(t || '');
      if (t && t !== SPENT) { TOKEN = t; }
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
        tries = 0;
        if (joined) renaming = true;
        try { ws.close(); } catch (e) { }
      } else {
        connect();
      }
      return true;
    }
  };

  connect();

  try { window.skyrimPlatform.sendMessage('thornswood-front', 'chat socket to ' + url()); }
  catch (e) { }
})();
