'use strict';
/*
  The help in the game, as a panel (#1633).

  Patrick, 4 October: "no more commands for things [people] do, only for dev
  and staff commands; everything else takes buttons and GUI". The help was
  /help typed into the chat: a menu and six topics, each written as commands
  to type. It is this panel now, opened without the chat: the help key
  (HelpKey in Thornswood.ini, F7 unless it was moved on the Settings panel),
  or Help on the K, P and J panels, which call open() here and close
  themselves (Patrick's answer on #1633). Settings at its foot opens the
  Settings panel, where every key is changed (#3126), and puts this down. Nothing tells anybody to
  type /help. The server still answers it, typed out of habit, with where
  this panel is.

  THE SAME SIX TOPICS, written as keys, prompts and panels: talking, people,
  living, work, land, and getting help. Every key is named as this machine
  has it bound: thornswood-front.js hands the names over (setKeys), and until
  it has, the keys below are what a fresh install has.

  What is still typed is named here, and nothing else: /stuck, /helpme and
  /report (Patrick, 4 October, #1682), and how a line is said, /me, /do, /w,
  /s, /y and /ooc, with /roll (#1639), and /needs, the four bars as a line
  of text for somebody who hid them (Patrick, 11 October, #2267). The same
  list is PLAYER_WORDS in the gamemode, and tests/test-1633-help-panel.js
  holds the two together.

  The words are the page's own rather than the server's, so the panel opens
  at once, with or without the chat's connection, which is when somebody
  wedged in a wall needs it.

  REPORT A PROBLEM (#3155). Patrick, 21 Oct: testers get a button that files
  a board issue with their log and where they are, an exception to the rule
  that what reaches staff stays typed. Getting help ends with a box and
  Send. The words go to the plugin, the plugin sends them to the game
  server as /problem (nobody types it), and the server says in the chat
  whether the site took it. Where they stand and this game's logs go with
  it without being asked for.

  THE CONTRACT with thornswood-front.js:
    window.thornswoodHelp = { open(topic), close(), toggle(), isOpen(), setKeys(names) }
    page -> plugin  'help:ready' | 'help:opened' | 'help:closed' |
                    'help:problem <what went wrong>'
*/
(function () {
  if (window.thornswoodHelp) { return; }

  var ID = 'ts-help';
  var shown = false;
  // What is typed in the problem box, kept across redraws (#3155).
  var problemDraft = '';
  var PROBLEM_MAX = 1000;
  var root = null;
  var topic = 'talking';

  /* A fresh install's keys: Thornswood.ini's, and the game's own E. */
  var keys = {
    help: 'F7', chat: 'Enter', command: '/', skills: 'K', party: 'P', journal: 'J',
    friend: 'Y', trade: 'H', mute: 'L', mold: 'U', lock: 'X', maneuver: '9',
    talk: 'V', voiceMode: 'B', wheel: 'G', activate: 'E', stop: 'N', voiceLock: 'O'
  };

  /*
    THE TOPICS. Each is a list of short paragraphs, made from the key names
    so a rebind is what the help says. What /help living, /help work and the
    rest said, with the keys named instead of "the key the prompt names".
  */
  var TOPICS = [
    { id: 'talking', title: 'Talking', text: function (k) {
      return [
        k.chat + ' opens the chat box, and Escape gives the keyboard back to the game. ' +
          'A line typed there reaches the people near you.',
        'Hold ' + k.talk + ' to talk out loud. ' + k.voiceMode + ' steps your voice between a ' +
          'whisper, your normal voice and a yell, and each carries a different distance. ' +
          k.voiceLock + ' locks the microphone open until you press it again, for a song or ' +
          'a long speech without holding ' + k.talk + '.',
        'Start a line with /me for what your character does, or /do for what there is to see. ' +
          '/w whispers it, and /s or /y shouts it.',
        '/ooc and what you meant is out of character, to whoever is near you.',
        '/roll 20 rolls a twenty sided die, and /roll 6x3 three six sided ones. The server ' +
          'rolls it, so nobody can make a number up.',
        k.command + ' opens the chat with the slash already typed.'
      ];
    } },
    { id: 'people', title: 'People', text: function (k) {
      return [
        'Look at somebody and the prompt under your crosshair names what you can do: ' +
          k.friend + ' asks them to be friends, ' + k.trade + ' offers a trade, ' + k.mute +
          ' stops you hearing them, and ' + k.party + ' asks them to party. Carrying a letter ' +
          'for them, ' + k.activate + ' hands it over. Answer a request with Accept or Refuse ' +
          'on its prompt.',
        k.party + ' opens your friends and party. Work done with your party in the same ' +
          'place counts for more.',
        k.journal + ' opens your journals, and a group book beside them when this character ' +
          'is in one or the Discord account may found one. A Dev may found one of each. ' +
          'New business and New faction on that tab start one, and Leave there drops this ' +
          'character.'
      ];
    } },
    { id: 'living', title: 'Living', text: function (k) {
      return [
        'The four bars are food, water, rest and how warm you are, and the Body page on ' +
          k.skills + ' says why. Eat or drink from your pack. With the bars hidden on ' +
          'Settings, /needs in the chat says all four as a line of text.',
        'Sit or lie down to rest: on a seat, on the ground with Sit on the emote wheel (' +
          k.wheel + '), or in a bed. By a fire is better, an inn or temple bed is better ' +
          'than the road, and your own bed is best. ' +
          'Somebody else\'s bed counts when they let you sleep there or you carry its key. ' +
          'A lute, flute or drum played on the wheel, or Sing, helps everybody resting there.',
        k.stop + ' stands you up out of an idle or an emote, one you are stuck in too, and ' +
          'works with the wheel shut.',
        'Log out lying in a bed indoors, your own, one you may use, or an inn or temple bed, ' +
          'and nothing runs down while you are away, and you come back rested. Anywhere else ' +
          'the bars fall at half the pace while you are gone, and never below 25. The Body ' +
          'page says what logging out where you are now would do.',
        'Change character, at the foot of ' + k.skills + ', goes back to the character menu ' +
          'without closing the game. Stay still and out of a fight for the ten seconds it ' +
          'counts; moving, a fight or getting hurt stops it, and pressing it again stops it too.',
        'Fires warm you and standing in one burns you. Fur is the warmest to wear, metal the worst.',
        'In your inventory, while you have a wound to tend, ' + k.trade + ' opens the panel ' +
          'that tends it. Looking at somebody hurt, ' + k.lock + ' tends theirs when the ' +
          'prompt says so.'
      ];
    } },
    { id: 'work', title: 'Work', text: function (k) {
      return [
        k.skills + ' opens your profession, your class and your skill tree. Work at what you ' +
          'chose and the rank climbs on its own. Its Profession guides have a page for every ' +
          'profession: what it makes, where the materials come from and how it ranks up.',
        'Your sister half stops at novice until a Master of it takes you on: a Master looks ' +
          'at you and presses ' + k.skills + ' when the prompt names it. ' + k.skills +
          ' lists who took you on and who you took on, and either of you can end it there.',
        'At a crop, a line says what is sown and whose farm it is. ' + k.activate +
          ' on an empty plot sows the crop in your pack, and on a ripe one brings it in.',
        'A warrior\'s maneuvers open on ' + k.maneuver + '.',
        'In your inventory, with a repair kit in your pack, ' + k.mold + ' opens the repair panel.',
        k.activate + ' on a notice board opens it, with its notices and jobs; ' +
        k.activate + ' on the drop box on its post opens the box, and ' +
          k.journal + ' shows every town\'s board. ' + k.activate + ' on a carriage driver ' +
          'shows his stops and fares, and on a guild trader the wares.'
      ];
    } },
    { id: 'land', title: 'Land', text: function (k) {
      return [
        'At a door you just opened, a line names ' + k.lock + ': it claims a building nobody ' +
          'holds, and locks or unlocks one you hold. At a crop the same key claims the farm ' +
          'around it.',
        k.skills + ' lists what you hold and the rent owed. A Jarl, a steward, a guard or ' +
          'somebody on a Court has an Office page on ' + k.skills + '. The offices are Discord ' +
          'roles, and the Jarl of a hold names its Court, its Steward and its Guards there.',
        'To let somebody sleep in a building you hold, look at them inside it and press ' +
          k.mold + '.',
        'A blank key mold goes into a door\'s lock on ' + k.mold + ', and a smith carrying ' +
          'that mold cuts a key at a forge with ' + k.lock + '.',
        'Claiming a building hands you its master key with the deed. Whoever carries it gets ' +
          'in and locks or unlocks the door, for as long as you hold the place, so the deed ' +
          'can stay in a chest. A lost one is cut again at a forge from the mold, with ' +
          k.mold + ', for 2 iron ingots, with you standing there.'
      ];
    } },
    { id: 'help', title: 'Getting help', text: function (k) {
      return [
        '/helpme and what is wrong reaches staff from here, stuck or otherwise. /report, ' +
          'the person\'s name and what they did, reports somebody to staff and nobody else.',
        '/stuck, when you are wedged in the world, takes you back a few steps or to the ' +
          'nearest temple: once every 5 minutes, a 15 second wait in a fight, and every use ' +
          'is logged for staff. It does not move anybody out of a jail while a guard has a cell ' +
          'there locked.',
        'These are typed in the chat: ' + k.chat + ' opens it, or ' + k.command +
          ' with the slash already typed.',
        'The rules are on thornswood.net and in the Discord, and a ticket there reaches ' +
          'staff too.',
        // The AGPL's offer, where the server is used (#421).
        'Thornswood runs on SkyMP, which is free software. Its source, with every change ' +
          'Thornswood made to it, is at thornswood.net/credits#source, and Source code on ' +
          'the launcher opens it.'
      ];
    } }
  ];

  /* The line above every topic: the keys somebody looks for first. */
  function lead(k) {
    return k.skills + ' is your profession and skills, ' + k.party + ' your friends and party, ' +
      k.journal + ' your journals and every town\'s notice board. ' + k.chat + ' opens the ' +
      'chat, and ' + k.talk + ' held talks out loud. Settings, below, changes every key.';
  }

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'help:' + what); }
    catch (e) { }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /*
    THE LOOK IS THE P PANEL'S, which is the K panel's. Every colour below is
    one thornswood-party.js already uses. No :hover and no transitions. It
    sits just above the K, P and J panels, so a panel the server puts back
    up does not cover it, and under the Accept and Refuse card.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483100;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:880px;max-width:calc(100vw - 48px);height:620px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .nav{padding:12px 24px;display:flex;gap:8px;flex-wrap:wrap;',
    '  border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .body{overflow:auto;padding:16px 24px;font-size:17px;line-height:1.5}',
    '#' + ID + ' .body p{margin:0 0 12px}',
    '#' + ID + ' .body p.lead{font-size:15px;font-style:italic;color:rgba(217,207,180,.7)}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:10px;align-items:center;font-size:13.5px;font-style:italic;color:rgba(217,207,180,.7)}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .problem{margin-top:18px;padding-top:14px;border-top:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .problem h3{margin:0 0 8px;font-size:19px;font-weight:normal;color:#f6e9c8}',
    '#' + ID + ' .problem textarea{width:100%;box-sizing:border-box;height:96px;resize:none;',
    '  font-family:inherit;font-size:16px;line-height:1.4;padding:8px 10px;color:#f6e9c8;',
    '  background:rgba(0,0,0,.35);border:1px solid rgba(198,170,109,.42)}',
    '#' + ID + ' .problem .row{margin-top:8px;display:flex;gap:12px;align-items:center;',
    '  font-size:14px;font-style:italic;color:rgba(217,207,180,.7)}'
  ].join('\n');

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel">' +
      '<h2>Help</h2>' +
      '<div class="nav" id="' + ID + '-nav"></div>' +
      '<div class="body" id="' + ID + '-body"></div>' +
      '<div class="foot"><span id="' + ID + '-foot"></span><span style="flex:1"></span>' +
      '<button id="' + ID + '-settings">Settings</button>' +
      '<button id="' + ID + '-close">Close</button></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector('#' + ID + '-close').onclick = close;
    // Settings (#3126): the Settings panel, and this one put down; it opens
    // first, so the keyboard is never let go between the two.
    root.querySelector('#' + ID + '-settings').onclick = function () {
      try { if (window.thornswoodSettings) { window.thornswoodSettings.open(); } } catch (e) { }
      close();
    };

    /*
      Escape and the help key close it, and the page has to hear them itself:
      while the browser holds the keyboard no plugin sees a key (see
      thornswood-bridge.js), which is why every panel here answers its own.
    */
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      var k = String(ev.key || '');
      // A letter typed in the problem box is a letter, even the help key's.
      var typing = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
      if (k === 'Escape' || (!typing && keys.help && k.toUpperCase() === String(keys.help).toUpperCase())) {
        if (ev.preventDefault) { ev.preventDefault(); }
        close();
      }
    });
    return root;
  }

  function find(id) {
    for (var i = 0; i < TOPICS.length; i++) {
      if (TOPICS[i].id === id) { return TOPICS[i]; }
    }
    return null;
  }

  function draw() {
    if (!root) { return; }
    var nav = root.querySelector('#' + ID + '-nav');
    var body = root.querySelector('#' + ID + '-body');
    var foot = root.querySelector('#' + ID + '-foot');
    var html = '';
    for (var i = 0; i < TOPICS.length; i++) {
      html += '<button data-topic="' + TOPICS[i].id + '"' +
              (TOPICS[i].id === topic ? ' class="go"' : '') + '>' + esc(TOPICS[i].title) + '</button>';
    }
    nav.innerHTML = html;
    var buttons = nav.querySelectorAll('button[data-topic]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].onclick = function () {
        topic = this.getAttribute('data-topic');
        draw();
      };
    }
    var t = find(topic) || TOPICS[0];
    var out = '<p class="lead">' + esc(lead(keys)) + '</p>';
    var paras = t.text(keys);
    for (var p = 0; p < paras.length; p++) { out += '<p>' + esc(paras[p]) + '</p>'; }
    if (t.id === 'help') { out += problemForm(); }
    body.innerHTML = out;
    if (t.id === 'help') { wireProblem(); }
    foot.textContent = 'Escape or ' + keys.help + ' closes this.';
  }

  /* Report a problem (#3155), at the end of Getting help. */
  function problemForm() {
    return '<div class="problem">' +
      '<h3>Report a problem</h3>' +
      '<p>Say what went wrong and what you were doing. It goes on the board for the ' +
      'developers, with where you are standing and the logs of this game, which are ' +
      'sent when you close it.</p>' +
      '<textarea id="' + ID + '-ptext" maxlength="' + PROBLEM_MAX + '">' + esc(problemDraft) + '</textarea>' +
      '<div class="row"><button class="go" id="' + ID + '-psend">Send</button>' +
      '<span id="' + ID + '-psaid"></span></div>' +
      '</div>';
  }

  function wireProblem() {
    var box = root.querySelector('#' + ID + '-ptext');
    var send = root.querySelector('#' + ID + '-psend');
    var said = root.querySelector('#' + ID + '-psaid');
    if (!box || !send || !said) { return; }
    box.oninput = function () { problemDraft = String(box.value || '').slice(0, PROBLEM_MAX); };
    send.onclick = function () {
      // One line to the server, which splits on spaces anyway.
      var text = String(box.value || '').replace(/\s+/g, ' ').trim().slice(0, PROBLEM_MAX);
      if (!text) { said.textContent = 'Say what went wrong first.'; return; }
      tell('problem ' + text);
      problemDraft = '';
      box.value = '';
      said.textContent = 'Sent. The chat says when it reaches the site.';
    };
  }

  function open(which) {
    build();
    if (typeof which === 'string' && find(which)) { topic = which; }
    draw();
    if (shown) { return; }
    shown = true;
    root.className = 'on';
    tell('opened');
  }

  function close() {
    if (!shown) { return; }
    shown = false;
    if (root) { root.className = ''; }
    tell('closed');
  }

  function toggle() { if (shown) { close(); } else { open(); } }

  /* The key names from thornswood-front.js. A name it does not send keeps
     the fresh install's. */
  function setKeys(names) {
    if (!names || typeof names !== 'object') { return; }
    for (var k in keys) {
      if (Object.prototype.hasOwnProperty.call(keys, k) &&
          typeof names[k] === 'string' && names[k]) {
        keys[k] = names[k];
      }
    }
    if (shown) { draw(); }
  }

  window.thornswoodHelp = {
    open: open, close: close, toggle: toggle, setKeys: setKeys,
    isOpen: function () { return shown; }
  };
  build();
  tell('ready');
})();
