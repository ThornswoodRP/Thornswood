'use strict';
/*
  The party menu, behind P.

  Patrick, 22 September: "Friend/Party System & Journals - P for the Party
  menu. This menu would allow people to see who their friends are, if they are
  online, invite them to a party, see their name tag colour, see them on the
  map and compass, and get an experience boost for playing together."

  WHAT IS HERE AND WHAT IS NOT, said plainly rather than left to be discovered.
  Friends, who is online, inviting, the party, and the experience bonus are all
  here and all real. THE MAP AND THE COMPASS ARE NOT, and they are the one part
  of that list this server cannot do from a browser overlay: a compass marker
  is a Papyrus quest alias or a MapMarker reference, both of which live in the
  game rather than in a page, and putting a live marker on another person needs
  a plugin change that is worth doing on its own rather than half doing here.
  The panel says so where somebody would look for it, instead of quietly
  leaving it out.

  THE CONTRACT with thornswood-front.js, the same shape thornswood-skills.js
  uses and for the same reasons:

    window.thornswoodParty = { open, close, toggle, isOpen, setData, setKey }
    page -> plugin  'party:ready' | 'party:opened' | 'party:closed'
    setKey(name)    PartyKey's name, P unless it is bound elsewhere (#1919)

  Everything this panel DOES it does by sending the server the lines its
  commands were, through window.thornswoodNet.say: /friend, /trade, /party,
  /mute, /hidename, /yes, /no. There is no second protocol, and the panel
  cannot do anything those lines could not. Nobody is told to type them
  (#1628): this panel, the look prompt and the trade window are the way in.
*/
(function () {
  if (window.thornswoodParty) { return; }

  var ID = 'ts-party';
  var data = null;
  var shown = false;
  var root = null;
  var askEl = null;
  var destructiveArm = null, destructiveTimer = 0, destructiveHeld = '';
  // PartyKey as bound. P until the front says otherwise.
  var keyName = 'P';

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'party:' + what); }
    catch (e) { }
  }

  function net(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) {
        return window.thornswoodNet.say(line) !== false;
      }
    } catch (e) { }
    return false;
  }

  /*
    THE LOOK IS THE K PANEL'S, as the journal's is. Patrick, 23 September,
    about the journal: "the journal menu works but is ugly asf and doesn't
    match the theme we use with our other menus". This panel was drawn from
    the same old template the journal had been: system-ui sans serif, a
    rounded 12px panel and 7px buttons, flat grey #1b1f26 and #212630 and a
    brass #d9ab52, which is the To Do List web page's palette and not the
    game's. Every colour below is one thornswood-skills.js already uses, and
    the rest follows it as thornswood-journal.js does: the Palatino stack
    (fonts on the machine, never one off the network, because this is the
    game's own browser), parchment text, gold hairlines, square corners, the
    dark vignette behind the panel, uppercase gold buttons with one gold
    primary, and gold scrollbars. tools/test-party-trade-theme.js fails on a
    colour here that the K panel does not use.

    Kept inline rather than shared: a file that every panel depends on is
    one more thing that can fail to load, and these are small. So the
    journal, this panel and the trade window each carry a copy of the K
    panel's values, and that harness is what keeps the copies the same.

    Only the look changed. The grid, the sizes, the ids and classes the
    script reads and every line it sends are as they were. The buttons keep
    the font size and padding they had and carry the line height the old
    type gave them, so each is the height it was, 29px, whichever font of
    the stack the machine has; uppercase and spaced, each is wider than it
    was (measured in Edge at 1920 by 1080 under the front's reset,
    24 September).

    No :hover, for the reason the K panel has none (see the head of
    thornswood-skills.js). The front's own stylesheet, in this same document,
    sets margin, padding, border and background to nothing on every element,
    so each rule sets what it needs.

    The strip under the compass, further down, is not this panel and keeps
    its own look: it is drawn over the world rather than on a panel, and its
    green and gold are what the note on this panel says they mean.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:880px;max-width:calc(100vw - 48px);height:620px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22);display:flex;align-items:baseline;gap:14px}',
    '#' + ID + ' h2 .sub{font-size:14px;color:rgba(217,207,180,.6);font-style:italic}',
    '#' + ID + ' .body{overflow:auto;padding:16px 24px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px;',
    '  align-content:start;font-size:16px}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:10px;align-items:center;font-size:13.5px;font-style:italic;color:rgba(217,207,180,.7)}',
    '#' + ID + ' h3{margin:0 0 8px;padding-bottom:6px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);font-weight:normal;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px}',
    '#' + ID + ' .tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex:1 1 220px;min-width:0}',
    '#' + ID + ' .kicker{display:block;font-size:11px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);margin-bottom:4px}',
    // online or not, drawn as the K panel draws a pip: a square with a gold
    // hairline, lit green (the K panel's colour for what is yours) when on
    '#' + ID + ' .dot{width:9px;height:9px;border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.2);flex:none}',
    '#' + ID + ' .dot.on{background:#7fb877;border-color:#9fcf92}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button[data-confirm]{max-width:100%;white-space:normal;overflow-wrap:anywhere}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .none{color:rgba(217,207,180,.6);font-style:italic;padding:6px 2px}',
    '#' + ID + ' .ask{border:1px solid #e9d19b;background:rgba(201,162,75,.16);',
    '  padding:14px 16px;display:flex;gap:12px;align-items:center}',
    '#ts-ask{position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:2147483200;',
    '  pointer-events:none;font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#ts-ask .card{pointer-events:auto;min-width:420px;max-width:calc(100vw - 48px);',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);padding:22px 26px;display:flex;gap:16px;align-items:center}',
    '#ts-ask .who{flex:1;font-size:20px;line-height:1.35;color:#f6e9c8}',
    '#ts-ask .kicker{display:block;font-size:11px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);margin-bottom:6px}',
    '#ts-ask button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:8px 18px;font-size:16px;line-height:22px;letter-spacing:.14em;text-transform:uppercase}',
    '#ts-ask button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .ask .who{flex:1}',
    '#' + ID + ' .ask b{font-weight:normal;font-size:16.5px;color:#f6e9c8}',
    '#' + ID + ' .note{color:rgba(217,207,180,.7);font-size:12.5px;line-height:1.5}',
    '#' + ID + ' .tag{font-size:11px;letter-spacing:.2em;text-transform:uppercase;white-space:nowrap;',
    '  border:1px solid rgba(198,170,109,.30);padding:1px 6px;color:rgba(217,207,180,.5)}',
    '#' + ID + ' .tag.p{border-color:rgba(160,205,150,.85);color:#9fcf92}',
    '#' + ID + ' .tag.m{border-color:#d9a27a;color:#d9a27a}',
    // The K panel's scrollbars, the same rules scoped to this panel, so it
    // has them whether or not the K panel's page loaded first.
    '#' + ID + ' ::-webkit-scrollbar{width:10px;height:10px}',
    '#' + ID + ' ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#' + ID + ' ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    '  background-clip:padding-box;border-radius:6px}',
    '#' + ID + ' ::-webkit-scrollbar-thumb:active{background:rgba(233,209,155,.55);background-clip:padding-box}',
    '#' + ID + ' ::-webkit-scrollbar-corner{background:transparent}'
  ].join('\n');

  /*
    ------------------------------------------------------ THE PARTY STRIP

    Patrick asked to "see them on the map and compass". The map is the
    plugin's: one MapMarker per member, moved to wherever the server says they
    are. The COMPASS is this, and it is deliberately not Skyrim's.

    WHY NOT SKYRIM'S. That compass draws quest targets and map markers and
    nothing a plugin can add an arrow to. Putting a party on it properly needs
    a quest with one alias per member inside an esp, which is a Creation Kit
    change, a plugin rebuild and a new master for everybody. This is a strip of
    our own, under the game's compass, saying the same thing.

    AND IT IS FRESHER THAN THE SERVER'S OWN PARTY PUSH. Voice already receives
    everybody's position five times a second, because proximity voice needs it,
    and thornswood-voice.js hands that table out through who(). The server's
    party list is on a tick and a half. So membership comes from the server,
    where it belongs, and the POSITIONS come from the voice feed, which is
    fifteen times more often and costs nothing new.

    THE MATHS IS THE SAME AS THE VOICE PANNER'S and is written out there at
    length: Skyrim's facing is degrees clockwise from north, north is +Y, so
    forward is (sin, cos) and right is (cos, -sin). Getting it wrong only
    shows up once somebody turns away from north, which is why both places say
    so.
  */
  var where = [];            // the server's party list: who, and their form id
  var stripEl = null;
  var stripTimer = null;

  // The window's look (#531): its Palatino, its parchment text, and for the
  // second line its faded parchment. It was Georgia and the To Do List web
  // page's greys, left behind when the windows were restyled on 24 Sep.
  var STRIP_MUTED = 'rgba(217,207,180,.6)';
  var STRIP_CSS =
    'position:fixed;left:50%;top:76px;transform:translateX(-50%);' +
    'z-index:2147483400;pointer-events:none;' +
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;' +
    'font-size:15px;letter-spacing:.03em;color:#d9cfb4;' +
    'text-shadow:0 2px 4px rgba(0,0,0,.95);white-space:nowrap;display:none';

  function esc2(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /*
    One member, as an arrow and a distance.

    The arrow is a character rather than a drawing: eight of them cover the
    compass rose closely enough to point at somebody, they need no file and no
    svg, and they are legible at this size on every machine.
  */
  var ARROWS = ['↑', '↗', '→', '↘',
                '↓', '↙', '←', '↖'];

  function arrowFor(bearing) {
    var at = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
    return ARROWS[at];
  }

  function drawStrip() {
    if (!stripEl) { return; }
    if (!where.length) { stripEl.style.display = 'none'; return; }

    var who = null;
    try {
      if (window.thornswoodVoice && window.thornswoodVoice.who) {
        who = window.thornswoodVoice.who();
      }
    } catch (e) { who = null; }

    var mine = null;
    var byProfile = who || {};
    try {
      if (data && data.me && byProfile[data.me]) { mine = byProfile[data.me]; }
    } catch (e) { mine = null; }

    var bits = [];
    for (var i = 0; i < where.length; i++) {
      var row = where[i];
      var name = esc2(row.n || 'somebody');

      /*
        Match the server's row to the voice feed's by NAME, because the two
        are keyed differently: the server's party list carries the form id the
        plugin needs for the map marker, and the voice feed is keyed by
        profile id. Names on this server are unique per character and the
        alternative is a third table nobody needs.

        Somebody the voice feed has not seen yet gets a name and no arrow,
        which is honest: it says they are in your party and does not pretend
        to know where.
      */
      var them = null;
      for (var pid in byProfile) {
        if (!Object.prototype.hasOwnProperty.call(byProfile, pid)) { continue; }
        if (String(byProfile[pid].name || '') === String(row.n || '')) {
          them = byProfile[pid];
          break;
        }
      }

      if (!them || !them.pos || !mine || !mine.pos) {
        bits.push('<span style="margin:0 14px;color:' + STRIP_MUTED + '">' + name + '</span>');
        continue;
      }

      var dx = them.pos[0] - mine.pos[0];
      var dy = them.pos[1] - mine.pos[1];
      var dz = them.pos[2] - mine.pos[2];
      var metres = Math.sqrt(dx * dx + dy * dy + dz * dz) / UNITS_PER_METRE;

      // Their bearing from you, in degrees clockwise from north, minus the way
      // you are facing. Skyrim's north is +Y.
      var toThem = Math.atan2(dx, dy) * 180 / Math.PI;
      var facing = Number(mine.angleZ) || 0;
      var rel = toThem - facing;

      var far = metres >= 1000;
      var reads = far ? (Math.round(metres / 100) / 10) + ' km'
                      : Math.round(metres) + ' m';
      var sameRoom = String(them.cell) === String(mine.cell);

      bits.push(
        '<span style="margin:0 14px;color:' + (sameRoom ? '#9fcf92' : '#e9d19b') + '">' +
        '<span style="font-size:18px">' + arrowFor(rel) + '</span> ' +
        name + ' <span style="color:' + STRIP_MUTED + ';font-size:13px">' + reads + '</span>' +
        '</span>');
    }

    /*
      ONLY WHEN IT READS DIFFERENTLY (#963). This runs five times a second for
      as long as somebody is in a party, and nobody standing still changes a
      letter of it; every innerHTML write was a rebuilt node tree and a repaint
      of the game's browser layer over the frame, for the same words.
    */
    var html = bits.join('');
    if (html !== stripHtml) { stripHtml = html; stripEl.innerHTML = html; }
    if (stripEl.style.display !== '') { stripEl.style.display = ''; }
  }
  var stripHtml = null;

  var UNITS_PER_METRE = 70;   // the same seventy the voice page uses

  function ensureStrip() {
    if (stripEl) { return; }
    stripEl = document.createElement('div');
    stripEl.id = 'ts-party-strip';
    stripEl.style.cssText = STRIP_CSS;
    document.body.appendChild(stripEl);
    /*
      Five a second, which is the rate the positions arrive at. Stopped
      entirely when there is no party, so somebody playing alone pays nothing
      at all for this.
    */
    stripTimer = setInterval(function () {
      try { if (where.length) { drawStrip(); } } catch (e) { }
    }, 200);
  }


  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel">' +
      '<h2>Friends and party<span class="sub" id="' + ID + '-sub"></span></h2>' +
      '<div class="body" id="' + ID + '-body"></div>' +
      '<div class="foot"><span id="' + ID + '-foot"></span>' +
      '<span style="flex:1"></span>' +
      '<button id="' + ID + '-help">Help</button>' +
      '<button id="' + ID + '-settings">Settings</button>' +
      '<button id="' + ID + '-close">Close</button></div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('input', resetDestructive);
    root.addEventListener('click', function (ev) {
      if (destructiveArm && ev.target !== destructiveArm.button) resetDestructive();
    }, true);
    root.addEventListener('keydown', function (ev) {
      if (!shown || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      var button = ev.target;
      if (destructiveHeld) { ev.preventDefault(); ev.stopPropagation(); return; }
      if (!button || button.tagName !== 'BUTTON' ||
          ['disband', 'kick', 'drop'].indexOf(button.getAttribute('data-do')) < 0) return;
      ev.preventDefault(); ev.stopPropagation();
      if (ev.repeat) return;
      destructiveHeld = ev.key;
      button.click();
    }, true);
    document.addEventListener('keyup', function (ev) {
      if (ev.key === destructiveHeld) { destructiveHeld = ''; ev.preventDefault(); }
    });
    window.addEventListener('blur', function () { destructiveHeld = ''; resetDestructive(); });
    askEl = document.createElement('div');
    askEl.id = 'ts-ask';
    document.body.appendChild(askEl);
    root.querySelector('#' + ID + '-close').onclick = close;
    root.querySelector('#' + ID + '-help').onclick = help;
    root.querySelector('#' + ID + '-settings').onclick = settings;

    /*
      Escape and P close it, and the page has to handle both itself.

      While the browser holds the keyboard no plugin can see a key: focus
      raises DInputHook::ChromeFocus and buttonEvent goes deaf. That is
      written out at length in thornswood-bridge.js and is the reason every
      panel on this server answers its own Escape. The front's P branch,
      which toggles this panel, waits for a buttonEvent that does not come
      while the panel is up, so the footer said "Escape or P closes this"
      and P did nothing (#1919, the same as J on the journal, #530).

      P is PartyKey as bound, which the front hands over with setKey. A
      repeat is not a press, and a key with Ctrl, Alt or the Windows key
      held is not P.

      The tap of P that opens the panel cannot also close it: the fork reads
      the keyboard for this page in the same call that hands the game P going
      down, or an earlier one, so by the time the front hears P and the panel
      takes the keyboard, P is already down there and this page hears at
      most P coming up (the note over LETTERS in
      game/plugins/thornswood-emotes.js has the code path, #1852).
    */
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (ev.repeat) return;
        if (destructiveArm) resetDestructive(); else close();
        return;
      }
      if (ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey || typing(ev.target)) { return; }
      if (keyName && String(ev.key || '').toUpperCase() === keyName.toUpperCase()) {
        ev.preventDefault();
        close();
      }
    });
    return root;
  }

  // True when a key would go into a text field. The panel has none today; a
  // box added later keeps its letters.
  function typing(el) {
    if (!el || !el.tagName) { return false; }
    var t = String(el.tagName).toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || !!el.isContentEditable;
  }

  // What the footer names, Escape and the key when it is one the page hears.
  function closesLine() {
    return keyName ? 'Escape or ' + keyName + ' closes this.' : 'Escape closes this.';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function draw() {
    if (window.thornswoodDialog) { window.thornswoodDialog.redraw(root, drawContents); return; }
    drawContents();
  }

  function drawContents() {
    resetDestructive();
    if (!root) { return; }
    var body = root.querySelector('#' + ID + '-body');
    var sub = root.querySelector('#' + ID + '-sub');
    var foot = root.querySelector('#' + ID + '-foot');
    if (!data) {
      body.innerHTML = '<div class="none">Waiting for the server.</div>';
      sub.textContent = '';
      foot.textContent = '';
      return;
    }

    var html = '';

    // Anything standing gets answered first: it has a clock on it.
    if (data.offer) {
      var what = data.offer.kind === 'friend' ? 'wants to be friends'
        : (data.offer.kind === 'party' ? 'is asking you to join their party'
        : (data.offer.kind === 'apprentice' ? 'offers to take you on as an apprentice'
        : (data.offer.kind === 'dye' ? 'offers to dye your hair with ' + esc(data.offer.about || 'a hair dye')
        : (data.offer.kind === 'book' ? 'invites you into ' + esc(data.offer.about || 'a group book')
                                            : 'is offering to trade'))));
      html += '<div class="ask"><span class="who"><span class="kicker">Request</span><b>' + esc(data.offer.name) +
              '</b> ' + what + '</span>' +
              '<button class="go" data-do="yes">Accept</button>' +
              '<button data-do="no">Refuse</button></div>';
    }

    var iLead = false;
    if (data.party) {
      for (var leadI = 0; leadI < data.party.length; leadI++) {
        if (data.party[leadI].me && data.party[leadI].leader) { iLead = true; }
      }
    }

    html += '<div><h3>Your party</h3>';
    if (!data.party || !data.party.length) {
      html += '<div class="none">Not in a party. Look at somebody and press the party key to ' +
              'ask them, or press Ask to party beside a friend below.</div>';
    } else {
      for (var i = 0; i < data.party.length; i++) {
        var m = data.party[i];
        var whoId = m.p != null ? m.p : m.name;
        html += '<div class="row"><span class="dot' + (m.on ? ' on' : '') + '"></span>' +
                '<span class="nm">' + esc(m.name) + (m.me ? ' (you)' : '') + '</span>' +
                (m.leader ? '<span class="tag p">leader</span>' : '') +
                (!m.me && iLead
                  ? '<span class="tools"><button data-do="kick" data-who="' + esc(whoId) + '">Kick</button>' +
                    '<button data-do="lead" data-who="' + esc(whoId) + '">Lead</button></span>'
                  : '') +
                '</div>';
      }
      html += '<div class="row" style="border:none;background:none;padding-left:2px">' +
              '<span class="nm">' + data.together +
              (data.together === 1 ? ' of them is here with you' : ' of them are here with you') +
              '. ' + (data.together ? ('Work counts ' + data.bonus + '% more.')
                                    : ('Be in the same place for ' + data.bonus + '% more from your work.')) +
              '</span><span class="tools">' +
              (iLead ? '<button data-do="disband">Disband</button>' : '') +
              '<button data-do="leave">Leave</button></span></div>';
    }
    html += '</div>';

    html += '<div><h3>Friends</h3>';
    if (!data.friends || !data.friends.length) {
      html += '<div class="none">Nobody yet. Look at somebody and press the friend key.</div>';
    } else {
      /*
        EVERY BUTTON ON A FRIEND'S ROW SENDS THEIR PROFILE ID (#1695), never
        the name drawn there. The list is kept by profile, and a friend whose
        character ended comes back as the same profile under a new name; the
        server finds whoever that profile is playing now.
      */
      for (var j = 0; j < data.friends.length; j++) {
        var f = data.friends[j];
        var friendId = f.p != null ? f.p : f.name;
        html += '<div class="row"><span class="dot' + (f.on ? ' on' : '') + '"></span>' +
                '<span class="nm">' + esc(f.name) + '</span>' +
                (f.party ? '<span class="tag p">party</span>' : '') +
                (f.muted ? '<span class="tag m">muted</span>' : '') +
                (f.textOff ? '<span class="tag m">text</span>' : '') +
                (f.nameOff ? '<span class="tag m">name</span>' : '') +
                '<span class="tools">' +
                (f.on && !f.party ? '<button data-do="ask" data-who="' + esc(friendId) + '">Ask to party</button>' : '') +
                '<button data-do="mute" data-who="' + esc(friendId) + '">' + (f.muted ? 'Unmute' : 'Mute') + '</button>' +
                '<button data-do="mtext" data-who="' + esc(friendId) + '">' + (f.textOff ? 'Read' : 'Text') + '</button>' +
                '<button data-do="mname" data-who="' + esc(friendId) + '">' + (f.nameOff ? 'Show' : 'Name') + '</button>' +
                '<button data-do="drop" data-who="' + esc(friendId) + '">Remove</button>' +
                '</span></div>';
      }
    }
    html += '<div class="row" style="border:none;background:none;padding-left:2px">' +
            '<span class="nm">' + (data.namesAll ? 'Every name above a head is hidden.' : 'Names above heads are shown.') +
            '</span><button data-do="nameall">' + (data.namesAll ? 'Show names' : 'Hide every name') + '</button></div>';
    html += '</div>';

    /*
      NEAR YOU AND MUTED AND HIDDEN (#1628). Everything the look prompt's
      keys do, and text and a name for somebody who is not a friend, without
      a line typed in the chat. Near you is the server's near list, the one
      the look prompt reads; Add friend and Trade send the form id the way Y
      and H do, and the three switches send the profile id the friend rows
      send. Muted and hidden is everybody switched off, friend or not, here
      or not, so each one can be switched back on.
    */
    /*
      Dye hair (#2675), only while the server says you carry a hair dye:
      one button per dye beside each person, an offer they answer.
    */
    var dyes = [];
    if (Array.isArray(data.dyes)) {
      for (var di = 0; di < data.dyes.length; di++) {
        var dy = data.dyes[di];
        if (dy && typeof dy.id === 'string' && /^[a-z0-9-]+$/.test(dy.id)) { dyes.push(dy); }
      }
    }
    function dyeButtons(id) {
      var b = '';
      for (var dj = 0; dj < dyes.length; dj++) {
        b += '<button data-do="dye" data-who="' + esc(id) + '" data-dye="' + esc(dyes[dj].id) + '">' +
             (dyes.length === 1 ? 'Dye hair' : 'Dye: ' + esc(dyes[dj].name || dyes[dj].id)) + '</button>';
      }
      return b;
    }
    html += '<div><h3>Near you</h3>';
    if (!data.near || !data.near.length) {
      html += '<div class="none">Nobody close enough to look at.</div>';
    } else {
      for (var ni = 0; ni < data.near.length; ni++) {
        var nr = data.near[ni];
        html += '<div class="row"><span class="nm">' + esc(nr.name) + '</span>' +
                (nr.friend ? '<span class="tag">friend</span>' : '') +
                (nr.party ? '<span class="tag p">party</span>' : '') +
                '<span class="tools">' +
                (nr.friend ? '' : '<button data-do="befriend" data-who="' + esc(nr.id) + '">Add friend</button>') +
                '<button data-do="trade" data-who="' + esc(nr.id) + '">Trade</button>' +
                // A trade cart on the road goes with its driver (#3158): Raid cart opens it.
                (nr.cart ? '<button data-do="raid" data-who="' + esc(nr.id) + '">Raid cart</button>' : '') +
                dyeButtons(nr.id) +
                switches(nr) +
                '</span></div>';
      }
    }
    html += '</div>';

    html += '<div><h3>Muted and hidden</h3>';
    if (!data.hidden || !data.hidden.length) {
      html += '<div class="none">Nobody. Mute stops their voice, Text their lines in the chat, ' +
              'and Name the name above their head, for you alone.</div>';
    } else {
      for (var hi = 0; hi < data.hidden.length; hi++) {
        var hr = data.hidden[hi];
        html += '<div class="row"><span class="dot' + (hr.on ? ' on' : '') + '"></span>' +
                '<span class="nm">' + esc(hr.name) + '</span>' +
                '<span class="tools">' + switches(hr) + '</span></div>';
      }
    }
    html += '</div>';

    /*
      The two things that were asked for and are not here. Said on the panel
      rather than left out, because a missing feature nobody mentions reads as
      a broken one.
    */
    /*
      THE NOTE THAT USED TO SAY THESE WERE MISSING. They are not any more, and
      what is left of it is the one honest caveat: the strip is ours and not
      Skyrim's compass, and it is worth saying so rather than letting somebody
      wonder why the game's own compass never changed.
    */
    html += '<div><h3>Finding each other</h3><div class="note">' +
            'Everybody in your party has their name in green above their head, ' +
            'a marker on your map, and an arrow on the strip under your compass ' +
            'with how far away they are. Green on the strip means the same room ' +
            'as you, gold means somewhere else. ' +
            'The strip is ours rather than Skyrim\'s own compass: that one only ' +
            'draws quest targets and map markers, and putting people on it needs ' +
            'a change inside the game files rather than on this server.' +
            '</div></div>';

    body.innerHTML = html;
    sub.textContent = (data.friends ? data.friends.length : 0) + ' friend' +
                      ((data.friends && data.friends.length === 1) ? '' : 's');
    foot.textContent = closesLine();

    var buttons = body.querySelectorAll('button[data-do]');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].onclick = function () {
        var verb = this.getAttribute('data-do');
        var who = this.getAttribute('data-who') || '';
        if (verb === 'disband' || verb === 'kick' || verb === 'drop') {
          confirmDestructive(this, verb, who); return;
        }
        if (verb === 'yes') { net('/yes'); }
        else if (verb === 'no') { net('/no'); }
        else if (verb === 'leave') { net('/party leave'); }
        else if (verb === 'lead') { net('/party lead ' + who); }
        else if (verb === 'ask') { net('/party ' + who); }
        else if (verb === 'mute') { net('/mute ' + who); }
        else if (verb === 'mtext') { net('/mute text ' + who); }
        else if (verb === 'mname') { net('/hidename ' + who); }
        else if (verb === 'nameall') { net('/hidename all'); }
        else if (verb === 'befriend') { net('/friend ' + who); }
        else if (verb === 'trade') { net('/trade ' + who); }
        else if (verb === 'raid') { net('/cart raid ' + who); }
        else if (verb === 'dye') { net('/hairdye offer ' + who + ' ' + (this.getAttribute('data-dye') || '')); }
      };
    }
  }

  function resetDestructive() {
    if (destructiveArm) {
      destructiveArm.button.textContent = destructiveArm.text;
      destructiveArm.button.removeAttribute('data-confirm');
    }
    destructiveArm = null;
    if (destructiveTimer) clearTimeout(destructiveTimer);
    destructiveTimer = 0;
  }

  function destructiveTarget(verb, who) {
    if (!data || !Number.isSafeInteger(data.me) || data.me <= 0) return null;
    var rows = verb === 'drop' ? data.friends : data.party;
    if (!Array.isArray(rows)) return null;
    var target = null, leader = false;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].p) === who) target = rows[i];
      if (rows[i].p === data.me && rows[i].me && rows[i].leader) leader = true;
    }
    if (verb === 'drop') {
      return target && Number.isSafeInteger(target.p) && target.p > 0
        ? { me: data.me, target: target, line: '/friend remove ' + target.p,
            words: 'remove ' + target.name + ' from friends' } : null;
    }
    var intent = data.partyIntent;
    if (!leader || !intent || !/^[a-f0-9]{48}$/.test(intent.id) || !/^[a-f0-9]{48}$/.test(intent.version)) return null;
    if (verb === 'kick' && (!target || !Number.isSafeInteger(target.p) || target.p <= 0 || target.p === data.me)) return null;
    return { me: data.me, party: rows, intent: intent,
      line: '/party-action-v1 ' + verb + ' ' + intent.id + ' ' + intent.version + (verb === 'kick' ? ' ' + target.p : ''),
      words: verb === 'kick' ? 'kick ' + target.name + ' from this party' : 'disband this party' };
  }

  function confirmDestructive(button, verb, who) {
    if (!shown || !root.contains(button)) return;
    var target = destructiveTarget(verb, who);
    if (!target) {
      resetDestructive();
      root.querySelector('#' + ID + '-sub').textContent = 'That action is unavailable. Review the current list.';
      return;
    }
    var snapshot = JSON.stringify(target);
    var again = destructiveArm && destructiveArm.button === button &&
      destructiveArm.snapshot === snapshot && Date.now() < destructiveArm.until;
    resetDestructive();
    if (again) {
      if (!net(target.line)) root.querySelector('#' + ID + '-sub').textContent = 'Delivery not confirmed. Check the current list before trying again.';
      return;
    }
    var armed = { button: button, text: button.textContent, snapshot: snapshot, until: Date.now() + 5000 };
    destructiveArm = armed;
    button.setAttribute('data-confirm', '');
    button.textContent = 'Press again to ' + target.words;
    destructiveTimer = setTimeout(function () { if (destructiveArm === armed) resetDestructive(); }, 5000);
  }

  /* Mute, Text and Name for one person, by profile id, the way a friend's are. */
  function switches(r) {
    return '<button data-do="mute" data-who="' + esc(r.p) + '">' + (r.muted ? 'Unmute' : 'Mute') + '</button>' +
           '<button data-do="mtext" data-who="' + esc(r.p) + '">' + (r.textOff ? 'Read' : 'Text') + '</button>' +
           '<button data-do="mname" data-who="' + esc(r.p) + '">' + (r.nameOff ? 'Show' : 'Name') + '</button>';
  }

  function offerWords(kind, about) {
    if (kind === 'friend') { return 'wants to be friends.'; }
    if (kind === 'party') { return 'is asking you to join their party.'; }
    if (kind === 'apprentice') { return 'offers to take you on as an apprentice.'; }
    // A hair dye (#2675): nothing is used and nothing written until Accept.
    if (kind === 'dye') { return 'offers to dye your hair with ' + esc(about || 'a hair dye') + '.'; }
    // A group book invite, "the business The Bee" (#1591). Accept joins it.
    if (kind === 'book') { return 'invites you into ' + esc(about || 'a group book') + '.'; }
    return 'is offering to trade.';
  }

  function drawAsk() {
    if (!askEl) { return; }
    if (!data || !data.offer) { askEl.innerHTML = ''; return; }
    askEl.innerHTML =
      '<div class="card"><span class="who"><span class="kicker">Request</span><b>' + esc(data.offer.name) + '</b> ' +
      offerWords(data.offer.kind, data.offer.about) + '</span>' +
      '<button class="go" data-do="yes">Accept</button>' +
      '<button data-do="no">Refuse</button></div>';
    var buttons = askEl.querySelectorAll('button[data-do]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].onclick = function () {
        net(this.getAttribute('data-do') === 'yes' ? '/yes' : '/no');
      };
    }
  }

  function open() {
    build();
    if (shown) { return; }
    shown = true;
    root.className = 'on';
    draw();
    if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
    tell('opened');
  }

  function close() {
    if (!shown) { return; }
    resetDestructive(); destructiveHeld = '';
    shown = false;
    if (root) { root.className = ''; }
    tell('closed');
  }

  function toggle() { if (shown) { close(); } else { open(); } }

  /*
    Help, beside Close (#1633): the help panel on its People topic, and this
    one put down. Patrick's answer on #1633: a Help button on the K, P and J
    panels as well as the help key. The help opens first, so the keyboard is
    never let go between the two.
  */
  function help() {
    try { if (window.thornswoodHelp) { window.thornswoodHelp.open('people'); } } catch (e) { }
    close();
  }

  /* Settings beside Help (#3126): the Settings panel, the same way. */
  function settings() {
    try { if (window.thornswoodSettings) { window.thornswoodSettings.open(); } } catch (e) { }
    close();
  }

  window.thornswoodParty = {
    open: open,
    close: close,
    toggle: toggle,
    /*
      PartyKey's name, handed over by the front when this page says it is
      ready. A key the front has no name for (#57, say) is not one this page
      can hear, so nothing but Escape closes it then.
    */
    setKey: function (name) {
      var n = String(name == null ? '' : name);
      keyName = n.charAt(0) === '#' ? '' : n;
      if (shown) { draw(); }
    },
    isOpen: function () { return shown; },
    setData: function (d) {
      data = d || null;
      build();
      drawAsk();
      if (shown) { draw(); }
    },

    /*
      Where your party is, handed over by thornswood-front.js.

      It comes from the plugin rather than from the server's own push to this
      page, because the plugin is already reading that property for the map
      markers and a page cannot read a plugin's variables. One source, two
      uses.
    */
    setWhere: function (list) {
      where = Array.isArray(list) ? list : [];
      ensureStrip();
      drawStrip();
      if (shown) { draw(); }
    },
    /* For anybody checking whether the strip is doing anything. */
    strip: function () { return where.length; }
  };

  build();
  // Owner updates can precede this asynchronously loaded script (#1275).
  if (window.thornswoodSocialView) {
    window.thornswoodParty.setData(window.thornswoodSocialView);
  }
  tell('ready');
})();
