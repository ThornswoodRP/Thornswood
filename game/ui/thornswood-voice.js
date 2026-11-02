'use strict';
/*
  Thornswood proximity voice, in the game's own browser.

  The earlier build opened Chrome in a window beside the game. That could never
  have worked, for a reason that has nothing to do with the bugs in it: it was
  served from http://<address>:7778, and Chromium exposes the microphone only
  on https or on localhost. On a plain http remote address
  navigator.mediaDevices is not merely blocked, it is undefined. No flag passed
  on the command line changes that, because it is an origin rule, not a
  permission.

  A page loaded from file:// inside the game is a trustworthy origin by
  Chromium's own rule, so the microphone API exists here. Whether CEF hands
  over an actual device is a separate question, answered by the probe.

  Everything this file needs comes from the plugin, never from the page's own
  address, because file:// has no host to read a server out of, and never from
  the keyboard, because the game's browser does not hold focus while you play.
  Push to talk is a game key that the plugin forwards.

  The socket belongs to thornswood-chat.js. This file used to open a second one
  to the same service, which is worse than wasteful: the service hands out a
  peer id per connection, so one person showed up in the room twice, negotiated
  with themselves, and saw every line of chat written out twice. So chat owns
  the connection and this subscribes to it.
*/

(function () {
  if (window.thornswoodVoice) return;   // injected twice, which is harmless

  var UNITS_PER_METRE = 70;

  /*
   * Three ranges, named rather than numbered.
   *
   * ref is the distance a voice stays at full strength; past it the volume
   * falls away, and at max it is gone. Whisper is close enough that somebody
   * has to be at the same table. Local is a room. Yell carries across a
   * market and up onto a wall.
   *
   * The mode belongs to whoever is speaking, so these are applied to the
   * panner carrying THEIR audio, not to your own listener. Everyone hears you
   * at the range you chose, which is the only arrangement that behaves the way
   * a room does.
   */
  var MODES = {
    whisper: { ref: 1.5, max: 7,  gain: 0.8, label: 'Whisper', colour: '#9ec7f2' },
    local:   { ref: 4,   max: 30, gain: 1.0, label: 'Local',   colour: '#ffffff' },
    yell:    { ref: 9,   max: 85, gain: 1.3, label: 'Yell',    colour: '#edad38' }
  };
  /*
    colour is what the microphone at the bottom of the screen turns while you
    speak at that distance (#2474, Patrick, 12 Oct: "the one on your screen
    should change colors based on the mode you are speaking in"). They are
    the speaking mark's colours above other people's heads, MARK_COLOUR in
    thornswood-front.js written as hex (0.62,0.78,0.95 is 9e c7 f2; 0.93,
    0.68,0.22 is ed ad 38), and the ones docs/systems/voice.md gives:
    whisper pale blue, ordinary white, yell amber. So the colour you see on
    yourself is the colour everybody in range sees over you.
  */
  var MODE_ORDER = ['whisper', 'local', 'yell'];
  var myMode = 'local';

  function modeOf(name) { return MODES[name] || MODES.local; }

  /*
    HOW LOUD SOMEBODY IS AT A GIVEN DISTANCE, worked out here rather than left
    to the panner.

    THE PANNER CANNOT DO IT, and that is the whole of this defect. The three
    modes were applied by setting refDistance and maxDistance on a panner whose
    distanceModel is 'inverse', and WEBAUDIO'S INVERSE MODEL DOES NOT READ
    maxDistance AT ALL. Only the linear model does. So the number changed with
    every mode and the only thing that actually differed was refDistance: there
    was no cut off anywhere, a whisper never stopped being audible, and a yell
    was not meaningfully louder than a whisper at the same distance. It is on
    the To Do List as "Whisper, local and yell all carry the same distance,
    because the page changes a number WebAudio does not read", found 19
    September against the launcher's old page; the overlay that replaced that
    page inherited it.

    So the panner is told to apply no distance attenuation of its own,
    rolloffFactor 0, which makes the inverse model return exactly 1 at every
    distance. It keeps HRTF, so direction still works, and the level comes
    from here.

    THE SHAPE. Full strength out to ref, then a natural 1/d falloff scaled so
    it reaches exactly nothing at max rather than trailing off for ever. And a
    per mode weight on top, so a yell IS louder than a whisper standing in the
    same place, which is what anybody would expect and what the old
    arrangement could not express at all.
  */
  function levelFor(name, metres) {
    var m = modeOf(name);
    var d = Number(metres);
    if (!isFinite(d) || d < 0) { d = 0; }
    if (d >= m.max) { return 0; }
    if (d <= m.ref) { return m.gain; }
    var fade = 1 - ((d - m.ref) / (m.max - m.ref));
    return m.gain * (m.ref / d) * fade;
  }

  /*
    Ramped rather than assigned, because a gain that jumps clicks.

    Four hundredths of a second, which is well under the position feed's own
    200ms beat, so a ramp has always finished before the next one starts and
    never lags behind somebody walking.
  */
  function setGain(node, want) {
    try {
      var now = ctx ? ctx.currentTime : 0;
      node.gain.setTargetAtTime(want, now, 0.04);
    } catch (e) {
      try { node.gain.value = want; } catch (e2) { }
    }
  }


  var cfg = { host: '', port: 7778, profileId: 0, name: '', pushToTalk: true,
              microphone: true, micName: '' };

  var ctx = null, mic = null, myPeer = 0;
  var talking = false, joined = false, wired = false;

  /*
    Relay mode: the audio has moved to the launcher and this page is a HUD.

    Everything below still works and is kept, because it is the only voice
    there is until a launcher new enough to carry it answers. The moment one
    does, it tells us its loopback port, and from then on this page stops
    joining, stops holding a microphone and stops building peer connections.
    Two clients on one profile id would fight over the same slot on the server
    and each hear a ghost of the other.

    What it keeps doing is drawing the indicator and forwarding push to talk,
    because the game is the only thing that can see a keyboard and the launcher
    is the only thing that can open a microphone that actually works.
  */
  var RELAY_PORT = 0;

  /*
    Relay mode is on from the first word the launcher gets to this page, by
    either route: its loopback port, or its state pushed in by the plugin.
    The second route is the one that works everywhere (see setLauncherStatus),
    and it carries no port, so the port alone cannot be the switch.
  */
  var RELAY_ON = false;
  function inRelay() { return RELAY_ON || RELAY_PORT > 0; }

  /*
    What the launcher knows and this page does not.

    Once the audio moved, the indicator was reading state that no longer
    exists here: no microphone object, no peer connections, so it showed
    LISTENING ONLY greyed out while voice was in fact working perfectly. The
    launcher answers every request with its own state, and a slow poll keeps
    the capsule honest when nobody is pressing anything.
  */
  var relay = { mic: false, peers: 0, talking: false };
  var relayTimer = null;

  function relayAsk(path) {
    if (!RELAY_PORT) return;
    try {
      fetch('http://127.0.0.1:' + RELAY_PORT + path, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (!s) return;
          relay.mic = !!s.mic;
          relay.peers = Number(s.peers) || 0;
          relay.talking = !!s.talking;
          draw();
        })
        .catch(function () { });
    } catch (e) { }
  }
  var micError = '';
  /* True from the moment getUserMedia is called until it settles, so that a
   * second configure arriving mid-request cannot start a second one. */
  var micAsking = false;
  var lastWho = {};
  /*
    Who this person has muted, by profile id, handed over by the server.

    Patrick, 22 September, wanted a mute key that works while you are looking
    at somebody. Muting is THE SERVER'S TO REMEMBER and THIS PAGE'S TO DO: the
    list lives on the character so it survives logging out, and the silencing
    is a gain node that already exists here, one per peer, already being
    written five times a second by the distance mixing below.

    Deliberately not a mute on the microphone and not a mute the server
    enforces. A server side mute would be a mute everybody got, which is a
    moderation tool and a different thing entirely.
  */
  var muted = {};
  /* Staff silence, told to every connection and also carried on the
     position row. It is not a personal mute: it closes this microphone
     and sets their level to nothing for everybody. */
  var hushed = {};
  function noteHush(pid, on) {
    pid = Number(pid) || 0;
    if (!pid) return;
    if (on) { hushed[pid] = true; } else { delete hushed[pid]; }
  }
  function noteRows(who) {
    for (var k in who) {
      if (!Object.prototype.hasOwnProperty.call(who, k)) continue;
      noteHush(k, !!(who[k] && who[k].hush));
    }
  }
  function selfHushed() {
    var me = lastWho[cfg.profileId];
    return !!(hushed[cfg.profileId] || (me && me.hush));
  }
  var conns = new Map();
  var waiting = null;

  /** The chat's socket, or null until that file has run. */
  function net() {
    var n = window.thornswoodNet;
    return (n && typeof n.post === 'function') ? n : null;
  }

  function post(obj) {
    var n = net();
    return n ? n.post(obj) : false;
  }

  // ------------------------------------------------------------- reporting --
  var lastReport = '';
  function report(stage, detail) {
    var line = stage + ' | ' + detail;
    if (line === lastReport) return;
    lastReport = line;
    try { window.skyrimPlatform.sendMessage('thornswood-voice', line); } catch (e) { }
    try { console.log('[voice] ' + line); } catch (e) { }
  }

  // --------------------------------------------------------------- overlay --
  // Two pieces, and they answer different questions.
  //
  // The one at the bottom is the one you actually play with: am I being heard
  // right now, and how far does it carry. It is a microphone with the cradle
  // arc around it and one word under it, because that reads at a glance in
  // peripheral vision while you are looking at somebody's face.
  //
  // The one at the top right is the peer list, and it only appears when there
  // is somebody to list. It used to carry the voice status as a line of text
  // as well, which meant the answer to "can they hear me" was a sentence in
  // the corner you had to stop and read.
  //
  // Neither takes pointer events. Nothing in the game's browser can be clicked
  // without taking the mouse away from the game.
  var box = null;
  function overlay() {
    if (box) return box;
    try {
      box = document.createElement('div');
      box.id = 'thornswood-voice';
      box.setAttribute('style', [
        'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
        'pointer-events:none', 'font:12px/1.5 "Segoe UI",system-ui,sans-serif',
        'color:#e8e3d8', 'background:rgba(20,18,15,.72)', 'border:1px solid #2b2721',
        'border-radius:8px', 'padding:8px 11px', 'min-width:150px',
        'text-shadow:0 1px 2px rgba(0,0,0,.8)'
      ].join(';'));
      document.body.appendChild(box);
    } catch (e) { box = null; }
    return box;
  }

  var micBox = null;
  function micOverlay() {
    if (micBox) return micBox;
    try {
      var css = document.createElement('style');
      css.textContent = [
        '#thornswood-mic{position:fixed;left:50%;bottom:74px;transform:translateX(-50%);',
        'z-index:2147483646;pointer-events:none;display:flex;flex-direction:column;',
        'align-items:center;gap:3px;font:600 11px/1 "Segoe UI",system-ui,sans-serif;',
        'letter-spacing:.14em;text-transform:uppercase;transition:opacity .18s ease}',
        '#thornswood-mic .tw-word{text-shadow:0 1px 3px rgba(0,0,0,.95)}',
        '#thornswood-mic svg{display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.95))}',
        // Only while a voice is actually going out. A resting indicator that
        // pulses is an indicator you stop seeing.
        '#thornswood-mic.tw-live svg{animation:twPulse 1.15s ease-in-out infinite}',
        '@keyframes twPulse{0%,100%{opacity:1}50%{opacity:.58}}'
      ].join('');
      document.head.appendChild(css);

      micBox = document.createElement('div');
      micBox.id = 'thornswood-mic';
      document.body.appendChild(micBox);
    } catch (e) { micBox = null; }
    return micBox;
  }

  /*
   * The microphone, drawn rather than loaded.
   *
   * There is no network here and no file the page may reach for, so an icon
   * font or an image would be a blank square. It is four shapes: the capsule,
   * the cradle arc that wraps its left, top and right, the stem, and the foot.
   */
  function micSvg(colour) {
    return '<svg width="19" height="25" viewBox="0 0 19 25" fill="none" ' +
           'stroke="' + colour + '" stroke-width="1.9" ' +
           'stroke-linecap="round" stroke-linejoin="round">' +
           '<rect x="6.4" y="1.6" width="6.2" height="11.4" rx="3.1" ' +
             'fill="' + colour + '" stroke="none"/>' +
           '<path d="M2.4 10.6 a7.1 7.1 0 0 0 14.2 0"/>' +
           '<path d="M9.5 17.7 V21.4"/>' +
           '<path d="M5.9 21.4 H13.1"/>' +
           '</svg>';
  }

  function drawMic() {
    var b = micOverlay();
    if (!b) return;

    var live, usable;
    if (inRelay()) {
      // The microphone is the launcher's. Asking this page whether it has one
      // is asking the wrong process, and the answer was always no.
      usable = !!relay.mic;
      live = !!(relay.mic && (relay.talking || talking));
    } else {
      live = !!(mic && talking);
      usable = !!mic && !micError;
    }

    var colour = live ? modeOf(myMode).colour   // going out, at this distance
               : usable ? '#cdc6b8'        // ready, nothing being sent
               : '#8d857a';                // cannot speak at all
    var word = usable ? modeOf(myMode).label.toUpperCase() : 'LISTENING ONLY';

    /*
      ONLY WHAT CHANGED IS WRITTEN (#963). draw() comes here every 300 ms while
      anybody is connected and on every relay answer, and the microphone reads
      the same for minutes at a time. Rewriting the svg each pass rebuilt it
      and repainted the game's browser layer for nothing.
    */
    var cls = live ? 'tw-live' : '';
    // Written as the browser reads them back, so the comparison holds.
    var op = live ? '1' : (usable ? '0.72' : '0.5');
    var html = micSvg(colour) +
               '<span class="tw-word" style="color:' + colour + '">' +
               word + '</span>';
    if (b.className !== cls) { b.className = cls; }
    if (b.style.opacity !== op) { b.style.opacity = op; }
    if (b.__twHtml !== html) { b.__twHtml = html; b.innerHTML = html; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function draw() {
    drawMic();

    /*
      The list of who else is nearby is not drawn.

      It used to sit in the top right corner naming everybody in earshot and how
      far away they were, and it hid itself when nobody was connected, which is
      why it was invisible for as long as pairing was broken. The moment pairing
      started working it appeared, and it reads as a message box nobody asked
      for over the top of the game.

      The information is already on screen in better form: their name floats
      over their head where they are actually standing, and the microphone at
      the bottom says whether voice is working at all. A corner box repeating it
      in metres is clutter.

      The records behind it are untouched. Everything still tracks who is
      connected, where they are and how loudly they are speaking, because that
      is what decides how loud they sound. Only the drawing is gone.
    */
    var b = overlay();
    if (b && (b.style.display !== 'none' || b.innerHTML !== '')) { b.style.display = 'none'; b.innerHTML = ''; }
  }

  // ------------------------------------------------------------- the mic ----
  function applyMic() {
    if (!mic || inRelay()) return;
    var live = (cfg.pushToTalk ? talking : true) && !selfHushed();
    mic.getAudioTracks().forEach(function (t) { t.enabled = live; });
    draw();
  }

  function hear(rec, on) {
    try {
      rec.pc.getReceivers().forEach(function (r) {
        if (r.track && r.track.kind === 'audio') r.track.enabled = !!on;
      });
    } catch (e) { }
  }

  /**
   * Listening and talking are two different things, and only one of them needs
   * a microphone.
   *
   * The earlier version gave up entirely the moment CEF refused the mic, which
   * meant one refusal took the whole room's audio with it. So the audio
   * context and the mesh are set up first and the microphone is asked for
   * afterwards: if it is refused you still hear everybody, the overlay says
   * why, and the only thing missing is your own voice.
   */
  function start() {
    if (inRelay()) { draw(); return; }
    if (joined) return;
    joined = true;

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      micError = 'this browser has no Web Audio';
      report('audio', 'no AudioContext in this build, voice cannot run');
      draw();
      return;
    }

    try { ctx = new AC(); }
    catch (e) {
      micError = 'audio would not start';
      report('audio', 'AudioContext threw: ' + e);
      draw();
      return;
    }

    // Heads sit at the origin facing -Z and everybody else is placed
    // relative to that, so the listener never has to move.
    try {
      if (ctx.listener.forwardZ) {
        ctx.listener.forwardX.value = 0; ctx.listener.forwardY.value = 0; ctx.listener.forwardZ.value = -1;
        ctx.listener.upX.value = 0; ctx.listener.upY.value = 1; ctx.listener.upZ.value = 0;
      } else if (ctx.listener.setOrientation) {
        ctx.listener.setOrientation(0, 0, -1, 0, 1, 0);
      }
    } catch (e) { }

    resume();
    draw();

    // Held back on purpose. Either the microphone is switched off in
    // Thornswood.ini, or the game side has not said yet that it is safe to
    // open one. Nothing is touched in either case, and openMic below is what
    // changes that later without restarting any of this.
    if (!cfg.microphone) {
      micError = 'waiting';
      report('mic', 'not asking yet');
      connect();
      draw();
      return;
    }

    openMic();
  }

  /**
   * Open the capture device, join the room, and hand the track to anybody who
   * got in first.
   *
   * Split out of start so that it can happen long after start did. The game
   * side holds the microphone shut while somebody is in the creation hall and
   * turns it on when they are out, and by then start has already run: the
   * audio context is up, the socket is shared, the peer list is drawn. Only
   * this part is still to do.
   */
  function openMic() {
    if (mic || micAsking) return;
    // The launcher holds the microphone in relay mode; this page asking for
    // one would only collect a refusal from a browser that cannot grant it.
    if (inRelay()) { draw(); return; }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micError = 'this page has no getUserMedia';
      report('mic', 'this page has no getUserMedia at all, so you can hear but not talk');
      connect();
      draw();
      return;
    }

    report('mic', 'asking');
    micAsking = true;

    var tuning = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

    /*
     * Pick the microphone by name, in two passes, because it cannot be done in
     * one.
     *
     * Device labels are hidden until a capture has been granted at least once,
     * so the first getUserMedia has to take whatever the browser calls the
     * default. That default is not Windows' default: it took a pair of
     * speakers with an input on them over the microphone Windows records from.
     *
     * So: open the default, and now that labels are readable, look for the one
     * that was actually asked for. If it is a different device, swap to it and
     * let the first one go. One extra open, once, at startup.
     */
    /*
     * Match a device by name, loosely, because the two names are written by
     * different people.
     *
     * The launcher reads the name out of Windows, which says things like
     * "Microphone (FIFINE K669B)". Chromium writes its own labels and does not
     * always agree: it abbreviates, reorders, and sometimes drops the bracket.
     * An exact compare would fail on a device that is obviously the right one.
     *
     * So: try the whole string both ways round first, and if neither lands,
     * score on shared words. Words of three characters or fewer are thrown
     * away because "the", "mic" and "usb" match everything and settle nothing.
     * A tie is no answer, and no answer means stay on the default rather than
     * pick a microphone nobody asked for.
     */
    function words(s) {
      return String(s || '').toLowerCase().split(/[^a-z0-9]+/)
             .filter(function (w) { return w.length > 3; });
    }

    function wanted(devices) {
      var want = String(cfg.micName || '').trim().toLowerCase();
      if (!want) return null;

      var inputs = devices.filter(function (d) { return d.kind === 'audioinput'; });

      for (var i = 0; i < inputs.length; i++) {
        var lab = String(inputs[i].label || '').toLowerCase();
        if (!lab) continue;
        if (lab.indexOf(want) !== -1 || want.indexOf(lab) !== -1) return inputs[i];
      }

      var mine = words(want);
      if (!mine.length) return null;

      var best = null, bestScore = 0, tied = false;
      for (var j = 0; j < inputs.length; j++) {
        var theirs = words(inputs[j].label);
        var score = 0;
        for (var k = 0; k < mine.length; k++) {
          if (theirs.indexOf(mine[k]) !== -1) score++;
        }
        if (score > bestScore) { bestScore = score; best = inputs[j]; tied = false; }
        else if (score === bestScore && score > 0) { tied = true; }
      }
      return (bestScore > 0 && !tied) ? best : null;
    }

    function settle(str) {
      micAsking = false;
      mic = str;
      micError = '';
      var t = str.getAudioTracks()[0];
      report('mic', 'using ' + (t ? (t.label || '(no label)') : 'no track'));
      applyMic();
      connect();
      conns.forEach(function (rec) {
        try { mic.getAudioTracks().forEach(function (tr) { rec.pc.addTrack(tr, mic); }); }
        catch (e) { }
      });
      draw();
    }

    function choose(first) {
      var t0 = first.getAudioTracks()[0];
      var have = t0 ? String(t0.label || '') : '';

      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        // Listed in full, once. Naming a microphone is only possible if you
        // can see what the names actually are, and they are not the names
        // Windows shows in its own sound settings.
        var names = [];
        devices.forEach(function (d) {
          if (d.kind === 'audioinput') names.push(d.label || '(unnamed)');
        });
        report('inputs', names.length ? names.join(' | ') : 'none listed');

        var pick = wanted(devices);
        if (!pick) {
          if (cfg.micName) {
            report('mic', 'nothing clearly matched "' + cfg.micName +
                          '", staying on ' + (have || 'the default'));
          }
          settle(first);
          return;
        }
        // Already on it. Compared by label rather than by name, because the
        // name is the thing the two sides spell differently.
        if (have && pick.label && have.toLowerCase() === String(pick.label).toLowerCase()) {
          settle(first);
          return;
        }

        /*
         * The first one is closed BEFORE the second is opened, not after.
         *
         * It used to overlap: ask for the named device, and only once that had
         * resolved let the default go. For a moment the game was holding two
         * live capture devices, and opening a capture while another is running
         * is the thing that stalls Windows' audio stack. That stall lands on
         * the game as input that stops arriving, which from the chair is the
         * keyboard locking up for no reason.
         *
         * Closing first means that if the named device then fails to open we
         * have nothing, so the default is reopened rather than kept. One extra
         * call on a path that almost never runs is worth more than an overlap
         * on the path that always does.
         */
        var wantId = pick.deviceId;
        var label = pick.label || cfg.micName;
        try { first.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) { }

        navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: wantId },
            echoCancellation: true, noiseSuppression: true, autoGainControl: true
          }
        }).then(function (better) {
          settle(better);
        }).catch(function (err) {
          report('mic', 'could not open "' + label +
                        '" (' + (err && err.name ? err.name : err) + '), going back to the default');
          navigator.mediaDevices.getUserMedia({ audio: tuning })
            .then(settle)
            .catch(function (e2) {
              micAsking = false;
              micError = (e2 && e2.name) ? e2.name : 'refused';
              report('mic', 'and the default would not reopen either: ' + micError);
              connect();
              draw();
            });
        });
      }).catch(function () {
        settle(first);
      });
    }

    navigator.mediaDevices.getUserMedia({
      audio: tuning
    }).then(function (str) {
      // The room is joined inside settle, and deliberately not before.
      //
      // A peer connection carries the tracks it had when it was created.
      // Joining first and asking for the microphone afterwards meant the first
      // person already in the room got a receive-only connection, and adding a
      // track to it later only renegotiates from the side that offered. Half
      // the pairs would have been one way, silently, and which half depended
      // on who loaded faster. Choosing a named device makes that worse, not
      // better: the stream that ends up being used is the second one.
      choose(str);
    }).catch(function (err) {
      micAsking = false;
      micError = (err && err.name ? err.name : 'refused');
      // NotAllowedError here is not a setting anybody can change. The game's
      // CEF is built without a permission handler, so every media request is
      // refused before it reaches Windows, and there is no prompt to accept.
      // The command line switch that bypasses it, --use-fake-ui-for-media-
      // stream, was tried on the launcher's play button and hung the game on
      // the loading screen every time. So this is the end of that road until
      // SkyrimPlatform is rebuilt: you can hear, you cannot talk.
      report('mic', 'refused ' + micError + ': ' +
                    (err && err.message ? err.message : err));
      // Still joined. Being unable to talk is not a reason to be unable to
      // hear, and the peer list is what the overlay draws.
      connect();
      draw();
    });
  }

  // An AudioContext may start suspended when nobody has clicked anything, and
  // in the game's browser nobody ever will. Ask on every opportunity rather
  // than once, and say so when it stays shut, because silent voice with a
  // healthy peer list looks identical to a broken mesh from the outside.
  function resume() {
    if (!ctx) return;
    if (ctx.state === 'running') { report('audio', 'running'); return; }
    try {
      ctx.resume().then(function () {
        report('audio', ctx.state);
      }).catch(function (e) {
        report('audio', 'suspended, resume refused: ' + e);
      });
    } catch (e) {
      report('audio', 'suspended, resume threw: ' + e);
    }
  }

  // ---------------------------------------------------------- the server ----
  // Nothing is opened here. thornswood-chat.js holds the one socket; this
  // listens on it and posts through it. Both files are fetched by the front in
  // the same pass and neither can rely on running first, so this waits rather
  // than assuming.
  /*
    Where to look for each other, handed over rather than typed in.

    This was a Google STUN server written into three separate pages. STUN
    alone only works when both ends can be reached once they know where to
    look; behind a symmetric NAT, some mobile networks and a lot of corporate
    ones, they cannot, and that pair of people never hear each other while
    everybody else sounds fine. TURN fixes it and needs a relay, which cannot
    be typed into a page, so the service hands the list out.

    It comes on every roster (#1821), the moment this page builds its
    connections, over the socket its join token proved, so the relay comes
    with it when one is set. It used to be a POST to /ice with the token the
    connection was opened with, and that token is good for two minutes: for
    the rest of a session this page was handed STUN only. Nothing here holds
    a token now.

    The old value stays here until the first roster, so a service that has
    not been told about a relay behaves exactly as this did before.
  */
  var ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  function takeIce(list) {
    if (!list || !list.length) { return; }
    ICE = list;
    report('ice', ICE.length + ' server(s), relay ' +
           (ICE.some(function (s) { return /^turns?:/.test([].concat(s.urls)[0]); }) ? 'yes' : 'no'));
  }

  function connect() {
    if (wired) { return; }
    var n = net();
    if (!n) {
      /*
        AND IT GIVES UP EVENTUALLY.

        This waits for thornswood-chat.js to load, because voice is a
        passenger on that page's socket and there is nothing to join until it
        exists. It normally takes a second. If that file never loads at all it
        used to poll twice a second for the rest of the session with nothing
        on screen saying so, which is the same silence the site outage taught
        us to stop writing.

        Two minutes is far longer than the page has ever taken and short
        enough that somebody looking at a dead voice indicator gets an answer.
      */
      if (!waiting) {
        var waitedFrom = Date.now();
        waiting = setInterval(function () {
          if (net()) { clearInterval(waiting); waiting = null; connect(); return; }
          if (Date.now() - waitedFrom > 120000) {
            clearInterval(waiting); waiting = null;
            report('server', 'the chat page never loaded, so there is no socket to carry voice. ' +
                             'Voice is off for this session.');
          }
        }, 500);
        report('server', 'waiting for the chat socket');
      }
      return;
    }
    wired = true;
    report('server', 'sharing the chat socket to ' + cfg.host + ':' + cfg.port);
    // The launcher took the audio before the chat's socket was here to say
    // so on (#1925; see enterRelay).
    if (inRelay()) { n.noVoice(); }

    // Restated on every connect. The join that put us in the room was sent by
    // the chat file, which knows nothing about modes, so without this a
    // reconnect would leave everyone hearing us at local while the indicator
    // on our own screen says whisper.
    post({ t: 'vmode', mode: myMode });

    myPeer = n.peer();

    /*
      On for the life of the page, relay mode included (#1959). The
      positions, the modes on them and the staff silences that come down
      this socket are what the speaking marks and the party strip are drawn
      from, and a launcher holding the audio changes none of that. Only the
      signalling is the launcher's, and the guard below drops it.
    */
    var onNet = function (m) {
      if (!m || !m.t) { return; }
      if (m.t === 'welcome') { myPeer = Number(m.peer) || 0; return; }
      /*
        The relay guard comes before the peer list, not after it.

        It used to sit below this line, so in relay mode a peer list still
        reached reconcile, and reconcile built a WebRTC connection to every
        other person in the room before open threw on the audio context relay
        mode never makes. Measured in cef_debug.log on 26 September: the
        launcher had the microphone from 14:28:01, and at 14:29:03, when a
        second person joined, the game's browser made a peer connection, the
        network service in SkyrimPlatformCEF.exe.hidden started its mDNS
        responder, and the chat logged "listener threw: TypeError: Cannot read
        properties of null (reading 'createGain')". A WebRTC connection opens
        UDP sockets on every network the machine has, which is what makes
        Windows Firewall ask about the game's browser. The launcher's own
        voice code does all of this, so this page has no reason to.

        This guard is all relay mode takes from this listener (#1959). It
        used to take the listener off the socket as well, and then a page
        configured before the launcher took the audio heard no position
        again: no speaking marks and a party strip frozen where it was.
      */
      if (inRelay() && (m.t === 'sdp' || m.t === 'ice' || m.t === 'peers')) { return; }
      if (m.t === 'peers') { takeIce(m.iceServers); reconcile(m.peers); return; }
      // The whole view on the first tick after a join, then only what moved
      // and who left it (issue #482; the note over the tick in
      // voice/voice-server.js). The party strip reads the same table. When
      // this page got on after that first tick, board hands over the view
      // the chat kept for it, with every move since (#1924).
      if (m.t === 'hush') {
        noteHush(m.profileId, m.on);
        place();
        publishMarks();
        applyMic();
        return;
      }
      if (m.t === 'pos') { lastWho = m.who || {}; noteRows(lastWho); place(); publishMarks(); applyMic(); return; }
      if (m.t === 'moved') { applyMoved(lastWho, m); noteRows(m.who || {}); place(); publishMarks(); applyMic(); return; }
      if (m.t === 'vmode') {
        var rec = conns.get(Number(m.from));
        if (rec) {
          rec.mode = m.mode;
          setRange(rec, m.mode);
          draw();
        }
        return;
      }
      /*
        Once the launcher holds the audio, this page is a HUD and must not
        answer for the connection (the guard above). It used to, which is the
        other half of the handoff defect below: relay mode dropped the
        connections and then rebuilt them from the very next offer that
        arrived.
      */
      if (m.t === 'sdp') { onSdp(m); return; }
      if (m.t === 'ice') { onIce(m); return; }
      if (m.t === '__closed') {
        report('server', 'the chat socket went down, dropping the mesh');
        conns.forEach(function (_, id) { drop(id); });
        return;
      }
    };
    /*
      On with board, not on (#1869). The chat's socket may have joined the
      room before this page was configured (at the character choice, or
      when the launcher's token came back first), and the roster and every
      offer the room sent this connection came then. board hands those over
      first, roster before signalling, so every peer is opened here before
      anything it sent is read.
    */
    n.board(onNet);
  }

  function reconcile(list) {
    var want = new Map();
    // Not a connection that carries no voice: another game whose launcher
    // has the audio, which would never answer (#1925). One this page had to
    // it is dropped below like anybody who left.
    list.forEach(function (p) { if (p.peer !== myPeer && p.voice !== false) want.set(p.peer, p); });
    conns.forEach(function (_, id) { if (!want.has(id)) drop(id); });
    want.forEach(function (p, id) {
      if (conns.has(id)) {
        var had = conns.get(id);
        had.profileId = p.profileId;
        had.name = p.name;
        if (p.mode && p.mode !== had.mode) {
          had.mode = p.mode;
          setRange(had, p.mode);
        }
        return;
      }
      // Only the lower peer id offers, or both would and the negotiations
      // collide. Every pair agrees on that without being told.
      open(id, p, myPeer < id);
    });
    report('peers', conns.size + ' connected');
    draw();
  }

  function open(id, info, initiator) {
    // No connection is built unless this page is the one playing the audio.
    // In relay mode the launcher is, and with no audio context there is
    // nowhere to play it. Checked before the RTCPeerConnection rather than
    // after: making one is what opens the sockets Windows Firewall asks about,
    // and the old order made it and then threw on ctx, leaving it open.
    if (inRelay() || !ctx) { return; }
    var pc = new RTCPeerConnection({ iceServers: ICE });
    var gain = ctx.createGain();
    var panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    /*
      Direction only. rolloffFactor 0 makes the inverse model return 1 at
      every distance, so the panner places the voice and levelFor decides how
      loud it is. See levelFor for why the panner cannot be trusted with the
      distance.
    */
    panner.distanceModel = 'inverse';
    panner.rolloffFactor = 0;
    panner.refDistance = 1;
    panner.connect(gain).connect(ctx.destination);

    var rec = { pc: pc, panner: panner, gain: gain, mode: info.mode || 'local',
                profileId: info.profileId,
                name: info.name, el: null, dist: null,
                /* Perfect negotiation state. The initiator is impolite and
                   wins collisions; the answerer yields. */
                polite: !initiator,
                makingOffer: false,
                haveRemote: false,
                pendingIce: [],
                restarts: 0 };
    conns.set(id, rec);

    if (mic) {
      mic.getAudioTracks().forEach(function (track) { pc.addTrack(track, mic); });
    } else {
      // No microphone yet, or none at all. Ask for a one way connection rather
      // than none, so the rest of the room is still audible.
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch (e) { }
    }

    pc.onicecandidate = function (e) {
      if (e.candidate) { post({ t: 'ice', to: id, candidate: e.candidate }); }
    };

    /*
      What the connection is actually doing, said out loud.

      Nothing here watched this before, which is why the log could report
      "peers 1 connected" while not one byte of audio moved. That count comes
      from signalling. This is the real thing: checking means ICE is still
      hunting, connected means media is flowing, failed means it never will
      without help.
    */
    pc.oniceconnectionstatechange = function () {
      var st = pc.iceConnectionState;
      report('peer', (rec.name || id) + ' ice ' + st);

      if (st !== 'failed') { return; }
      // One restart, then stop. A pair that cannot reach each other over STUN
      // needs a relay, and hammering it does not conjure one.
      if (rec.restarts >= 1) {
        report('peer', (rec.name || id) +
               ' ice failed twice. STUN is not enough for this pair, ' +
               'which needs a TURN relay.');
        return;
      }
      rec.restarts++;
      report('peer', (rec.name || id) + ' ice failed, restarting');
      try { pc.restartIce(); } catch (e) { }
    };

    pc.ontrack = function (e) {
      var src = ctx.createMediaStreamSource(e.streams[0]);
      src.connect(panner);
      // Chromium will not pump a WebRTC stream through WebAudio unless the
      // stream is also attached to a media element. It is muted: the audible
      // path is the panner.
      var a = new Audio();
      a.srcObject = e.streams[0];
      a.muted = true;
      a.play().catch(function () { });
      rec.el = a;
      resume();
      draw();
    };

    /*
      Both sides renegotiate, not just the one that opened the connection.

      This handler used to be attached only for the initiator. Adding a track
      to a live connection requires renegotiation, and the microphone is ALWAYS
      added late here: the log shows "peers 1 connected" before "opening the
      microphone" every single session. So for every pair, the answerer
      attached its microphone to a connection that never renegotiated, and its
      audio never left the machine. One direction of every conversation was
      dead by construction, which is exactly the report: indicator lit, nobody
      hears you.

      Attaching it to both sides means two offers can cross. That is glare, and
      the standard answer is perfect negotiation: the impolite peer ignores a
      colliding offer, the polite one yields and takes theirs. The initiator is
      impolite, and both sides already agree who that is.
    */
    pc.onnegotiationneeded = function () {
      rec.makingOffer = true;
      Promise.resolve()
        .then(function () { return pc.setLocalDescription(); })
        .then(function () {
          post({ t: 'sdp', to: id, sdp: pc.localDescription });
        })
        .catch(function (e) {
          report('peer', (rec.name || id) + ' could not offer: ' + e);
        })
        .then(function () { rec.makingOffer = false; });
    };
  }

  function onSdp(m) {
    var rec = conns.get(m.from);
    /*
      Nobody here is still to be opened (#1869). The service writes the
      roster that names somebody to this socket before anything they send
      it, and board hands over what came before this page was on in that
      same order. A sender with no connection here is one this page chose
      not to open, in relay mode or with no audio, and has nothing to answer
      with, or one that has said since it carries no voice (#1925).
    */
    if (!rec) return;

    // Glare. Two offers crossed in flight, so somebody has to give way.
    var collision = m.sdp.type === 'offer' &&
                    (rec.makingOffer || rec.pc.signalingState !== 'stable');
    if (collision && !rec.polite) {
      return;
    }

    rec.pc.setRemoteDescription(m.sdp).then(function () {
      rec.haveRemote = true;
      flushIce(rec);
      if (m.sdp.type !== 'offer') return null;
      return rec.pc.setLocalDescription().then(function () {
        post({ t: 'sdp', to: m.from, sdp: rec.pc.localDescription });
      });
    }).catch(function (e) {
      report('peer', (rec.name || m.from) + ' sdp failed: ' + e);
    });
  }

  /*
    Candidates that turn up before the description they belong to.

    addIceCandidate throws if there is no remote description yet, and this used
    to be a bare try/catch, so those candidates were silently dropped. With
    trickle ICE the answering side routinely receives candidates before it has
    finished with the offer, and the ones it loses are often the only routes
    that would have worked.
  */
  function flushIce(rec) {
    var queued = rec.pendingIce;
    rec.pendingIce = [];
    queued.forEach(function (c) {
      rec.pc.addIceCandidate(c).catch(function () { });
    });
  }

  function onIce(m) {
    var rec = conns.get(m.from);
    // As in onSdp: a sender with no connection here is one this page chose
    // not to open.
    if (!rec) return;
    if (!rec.haveRemote) {
      rec.pendingIce.push(m.candidate);
      return;
    }
    rec.pc.addIceCandidate(m.candidate).catch(function () { });
  }

  function drop(id) {
    var rec = conns.get(id);
    if (!rec) return;
    try { rec.pc.close(); } catch (e) { }
    try { if (rec.el) { rec.el.pause(); rec.el.srcObject = null; } } catch (e) { }
    conns.delete(id);
    draw();
  }

  // The chat used to live here too, which meant two files rendering the same
  // line. thornswood-chat.js owns it now: it reads the socket, it writes into
  // the front's widget, and it handles /roll. Nothing about chat is left here.

  // ---------------------------------------------------------- placement -----
  /* A 'moved' tick on top of the table the last 'pos' gave: the rows that
     changed replace theirs, and the ids in gone are nobody this person can
     hear any more. */
  function applyMoved(table, m) {
    var who = m.who || {};
    for (var k in who) {
      if (Object.prototype.hasOwnProperty.call(who, k)) { table[k] = who[k]; }
    }
    var gone = m.gone || [];
    for (var i = 0; i < gone.length; i++) { delete table[gone[i]]; }
  }

  /*
    The speaking mark. Not words: a mark above the head while the
    microphone is open, only inside that person's own distance, and
    never on your own head. A voice mute hides it. Hiding a name does
    not, and neither does turning their text off, so neither is read
    here. Staff silence arrives as the microphone being closed.
  */
  var markSig = '';
  function publishMarks() {
    var me = lastWho[cfg.profileId];
    var list = [];
    if (me && me.pos) {
      for (var k in lastWho) {
        if (!Object.prototype.hasOwnProperty.call(lastWho, k)) continue;
        var row = lastWho[k];
        if (!row || !row.talk || row.hush || !row.actor || !row.pos) continue;
        if (Number(k) === Number(cfg.profileId)) continue;
        if (muted[k] || hushed[k]) continue;
        if (String(row.cell) !== String(me.cell)) continue;
        var dx = (Number(row.pos[0]) - Number(me.pos[0])) / UNITS_PER_METRE;
        var dy = (Number(row.pos[1]) - Number(me.pos[1])) / UNITS_PER_METRE;
        var dz = (Number(row.pos[2]) - Number(me.pos[2])) / UNITS_PER_METRE;
        var metres = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var mode = MODES[row.mode] ? row.mode : 'local';
        if (metres > MODES[mode].max) continue;
        list.push({ a: Number(row.actor), m: mode });
      }
    }
    list.sort(function (p, q) { return p.a - q.a; });
    var sig = JSON.stringify(list);
    if (sig === markSig) return;
    markSig = sig;
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'marks:' + sig); } catch (e) { }
  }

  function place() {
    var me = lastWho[cfg.profileId];
    if (!me || !ctx) { draw(); return; }

    // Skyrim's Z is up and the facing angle is degrees clockwise from north.
    // WebAudio has Y up and Z toward the listener, so the axes swap and the
    // sign of Z flips. Getting this wrong puts everyone behind you, and only
    // shows up once somebody turns away from north.
    var yaw = (Number(me.angleZ) || 0) * Math.PI / 180;
    var cos = Math.cos(yaw), sin = Math.sin(yaw);

    conns.forEach(function (rec) {
      var them = lastWho[rec.profileId];
      if (muted[rec.profileId] || hushed[rec.profileId] || (them && them.hush)) {
        setGain(rec.gain, 0); hear(rec, false); rec.dist = null; return;
      }
      if (!them || !them.pos || !me.pos) { setGain(rec.gain, 0); rec.dist = null; return; }

      // A wall is not a distance. Different cell, no sound.
      if (String(them.cell) !== String(me.cell)) { setGain(rec.gain, 0); rec.dist = null; return; }

      var dx = (them.pos[0] - me.pos[0]) / UNITS_PER_METRE;
      var dy = (them.pos[1] - me.pos[1]) / UNITS_PER_METRE;
      var dz = (them.pos[2] - me.pos[2]) / UNITS_PER_METRE;

      var right = dx * cos - dy * sin;
      var forward = dx * sin + dy * cos;

      rec.dist = Math.sqrt(right * right + forward * forward + dz * dz);
      // The speaker's own mode decides, at the distance they are standing.
      // A personal mute and a staff silence already returned above.
      hear(rec, true);
      setGain(rec.gain, levelFor(rec.mode, rec.dist));
      setPos(rec.panner, right, dz, -forward);
    });
    draw();
  }

  /*
    The mode a connection is carrying, which is the speaker's and not yours.

    It used to write refDistance and maxDistance onto the panner, which is the
    defect levelFor describes: the panner ignored one of them outright. It
    records the mode on the connection instead, and place() reads it on the
    next beat, which is at most a fifth of a second away.
  */
  function setRange(rec, name) {
    if (!rec) { return; }
    rec.mode = MODES[name] ? name : 'local';
  }

  function setPos(panner, x, y, z) {
    if (panner.positionX) {
      panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
  }

  // ------------------------------------------------------------- the api ----
  // Drawn once as soon as this file runs, rather than waiting for the first
  // thing that happens to call draw(). Until the plugin has said who we are
  // there is nothing to report, but "nothing to report" is still worth showing:
  // an indicator that appears only once voice is working cannot tell you that
  // voice is not working.
  try { drawMic(); } catch (e) { }

  /*
    The launcher has the audio. Anything this page already built has to come
    down, or the server sees two of everybody and each hears a ghost of the
    other. Safe to call twice.
  */
  function enterRelay() {
    RELAY_ON = true;
    try { conns.forEach(function (rec, id) { drop(id); }); } catch (e) { }
    try {
      if (mic) { mic.getTracks().forEach(function (t) { t.stop(); }); }
      mic = null;
    } catch (e) { }
    micError = '';
    /*
      STILL ON THE SOCKET (#1959).

      This used to take the page's listener off the chat's socket here, so
      that no offer could rebuild what was just dropped. That also cut off
      the positions, the modes and the staff silences, which relay mode
      still draws the speaking marks and the party strip from: a page
      configured before the launcher took the audio froze them, while one
      configured after it, whose listener went on with relay mode already
      set, kept them. The relay guard at the top of the listener in connect
      is what keeps the signalling out, the same in both orders, so the
      listener stays.
    */
    var n = net();
    /*
      AND THE ROOM IS TOLD (#1925). Every launcher in the room built a
      WebRTC connection to this socket off the roster, and from here this
      page answers none of them, so each sat on its offer for the rest of the
      session and counted in that launcher's peers. The chat tells the
      service this connection carries no voice, and says so in every join
      after; the roster marks it and the pages close those connections.
      With no chat socket yet, connect says it once it has one.
    */
    if (n) { n.noVoice(); }
    joined = false;
    draw();
  }

  window.thornswoodVoice = {
    configure: function (o) {
      o = o || {};
      if (o.host != null) cfg.host = String(o.host);
      if (o.port != null) cfg.port = Number(o.port) || 7778;
      if (o.profileId != null) cfg.profileId = Number(o.profileId) || 0;
      if (o.name != null) cfg.name = String(o.name);
      if (o.pushToTalk != null) cfg.pushToTalk = !!o.pushToTalk;
      if (o.microphone != null) cfg.microphone = !!o.microphone;
      if (o.micName != null) cfg.micName = String(o.micName);
      report('config', cfg.host + ':' + cfg.port + ' as profile ' + cfg.profileId +
                       (cfg.pushToTalk ? ', push to talk' : ', always open'));
      start();
      // start returns immediately once it has run once, so a configure that
      // flips the microphone on after the fact would otherwise change the flag
      // and nothing else. This is the second half of that switch.
      if (joined && cfg.microphone) { openMic(); }
      connect();
    },
    setTalking: function (v) {
      v = !!v;
      if (v === talking) return;
      talking = v;

      if (inRelay()) {
        // The launcher owns the microphone now. All this has to do is say
        // when the key is down, and read back what the launcher makes of it.
        // The plugin also writes the key into a file the launcher watches, so
        // this call is the second of two routes and may fail without loss.
        // The launcher is the one that tells the room the microphone is open.
        relayAsk('/ptt?on=' + (v ? '1' : '0'));
        draw();
        return;
      }

      post({ t: 'talk', on: v });
      resume();
      applyMic();
    },

    /**
     * The launcher saying where to send push to talk, and by saying it at all,
     * that it has taken over the audio.
     *
     * Called every few seconds by the plugin until it lands, because the page
     * may still be parsing when the launcher is already up.
     */
    setLauncherPort: function (p) {
      p = Number(p) || 0;
      if (!p || p === RELAY_PORT) return;
      RELAY_PORT = p;
      report('server', 'the launcher has the microphone now, on 127.0.0.1:' + p);

      // Tell it the mode it missed while this page still owned the socket,
      // then keep the indicator in step with it.
      relayAsk('/mode?mode=' + myMode);
      if (!relayTimer) {
        relayTimer = setInterval(function () { relayAsk('/status'); }, 1500);
      }
      enterRelay();
    },

    /**
     * The launcher's own state, pushed in by the plugin, which reads it off a
     * file the launcher writes several times a second:
     * mic ready, how many peers, whether it is sending, and the range mode.
     *
     * This is the route that works. Asking the launcher over loopback from a
     * page loaded from file:// is a fetch Chromium may refuse, and it refuses
     * without a word, so the indicator sat on LISTENING ONLY all session while
     * voice was carrying audio. A file has no origin to argue about.
     *
     * Arriving at all also says the launcher has the microphone, so this
     * switches the page into relay mode even when setLauncherPort never landed.
     */
    setLauncherStatus: function (micOk, peers, sending, mode) {
      relay.mic = !!micOk;
      relay.peers = Number(peers) || 0;
      relay.talking = !!sending;
      var m = String(mode || '').toLowerCase();
      if (MODES[m] && m !== myMode) { myMode = m; }
      if (!inRelay()) {
        report('server', 'the launcher has the microphone now, reporting through the plugin');
        enterRelay();
      }
      draw();
    },

    /**
     * Whisper, local or yell.
     *
     * Told to the room rather than kept here, because the falloff is applied
     * by whoever is listening. Announcing it on every change is the whole
     * mechanism: nobody can hear a mode they were not told about, so a missed
     * message means somebody carries on hearing you at your old range.
     */
    setMode: function (name) {
      var next = MODES[String(name || '').toLowerCase()] ? String(name).toLowerCase() : null;
      if (!next || next === myMode) { return myMode; }
      myMode = next;
      if (inRelay()) {
        // The socket this used to go down was closed when the launcher took
        // over, so every mode change since has gone nowhere and everybody
        // stayed on local.
        relayAsk('/mode?mode=' + myMode);
      } else {
        post({ t: 'vmode', mode: myMode });
      }
      report('mode', myMode);
      draw();
      return myMode;
    },

    /** Step to the next mode along, for a single key that cycles. */
    nextMode: function () {
      var at = MODE_ORDER.indexOf(myMode);
      return window.thornswoodVoice.setMode(MODE_ORDER[(at + 1) % MODE_ORDER.length]);
    },

    mode: function () { return myMode; },

    /*
      The mute list, from the server. Applied on the next placement pass,
      which runs five times a second, so a key press is silent within a frame
      or two and nothing here has to walk the connections itself.

      And handed on to the launcher, because once it has the audio this page
      holds no connections and the silence has to happen in the launcher's
      page. Without that a muted person was still heard (entry 151). The
      plugin writes the ids into voice-muted.txt and the launcher passes them
      to its page.

      setMuted(123, true) mutes one person and setMuted(123, false) unmutes
      them, which is the call the To Do List entry was written against. The
      server sends the whole list.
    */
    setMuted: function (list, on) {
      if (typeof list === 'number' || typeof list === 'string') {
        if (on) { muted[list] = true; } else { delete muted[list]; }
      } else {
        muted = (list && typeof list === 'object') ? list : {};
      }
      var ids = [];
      for (var k in muted) {
        if (Object.prototype.hasOwnProperty.call(muted, k) && muted[k] && Number(k) > 0) { ids.push(k); }
      }
      try { window.skyrimPlatform.sendMessage('thornswood-voice-muted', ids.join(' ')); } catch (e) { }
      try { place(); } catch (e) { }
      try { publishMarks(); } catch (e) { }
      return true;
    },
    isMuted: function (profileId) { return !!muted[profileId]; },

    /*
      Where everybody is, for whoever else on this page needs it.

      The position feed arrives here five times a second because voice needs
      it, and it is the freshest picture of the world any page has. The party
      strip in thornswood-party.js draws off it rather than off the server's
      own party push, which is on a tick and a half: the same facts, fifteen
      times more often, for nothing.

      Handed back as it stands rather than copied. It is replaced whole on
      every feed message, so a caller holding the old one is holding a
      snapshot, which is what a drawing pass wants anyway.
    */
    who: function () { return lastWho; },
    // There is no mute. Push to talk already means the microphone is shut
    // unless a key is held, so a second control for "shut" was answering a
    // question nobody asked.
    nudge: function () { resume(); if (!joined) start(); else connect(); },
    state: function () {
      return {
        mic: !!mic, audio: ctx ? ctx.state : 'none',
        socket: net() && net().isUp() ? 'up' : 'down', peers: conns.size,
        talking: talking, mode: myMode
      };
    }
  };

  setInterval(function () { if (conns.size) draw(); }, 300);

  // Said once, at load, because when voice does not work these five lines are
  // the difference between knowing why and guessing. A page loaded from file://
  // should report secure=true and mediaDevices=true; if it does not, no amount
  // of fixing the mesh will help.
  try {
    report('where', location.href);
    report('secure', String(window.isSecureContext));
    report('mediaDevices', String(!!navigator.mediaDevices) +
           ', getUserMedia ' + String(!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)));
    report('webrtc', typeof window.RTCPeerConnection);
    report('webaudio', typeof (window.AudioContext || window.webkitAudioContext));
  } catch (e) { }

  report('loaded', 'waiting for the plugin to say who we are');
})();
