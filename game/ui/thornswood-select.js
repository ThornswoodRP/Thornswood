'use strict';
/*
  Who are you today. The character choice at the game's main menu.

  Asked for by Patrick on 20 September: pick your character in the game, the
  way the other servers do, and not in the launcher. The launcher writes the
  list of this install's characters to Data/Platform/thornswood-characters.json
  before Play; thornswood-front.js reads it at the main menu, puts it on
  window.THORNSWOOD_SELECT and fetches this file into the page.

  THE SLOTS, Patrick's spec the same evening: just the character slots, two
  by default, three for a Patreon tier or a Gamemaster (the site decides and
  the launcher passes "slots"). A taken slot is the character's name, big,
  and under it the last location, the hours played and the last time, with a
  delete icon. An empty slot prompts to make a new character.

  CLICK MEANS GO, Patrick later the same day: "if you click on one that's the
  one you go to and doesn't require a confirm button at the bottom". A click
  on a taken slot plays that character at once and a click on an empty slot
  makes a new one at once; there is no Play bar. The keys stay: up, down or
  a number lights a slot, Enter plays the lit one, Delete asks to forget it.
  They only count while the game is the window Windows is sending keys to,
  see keysCount below, because keys typed into another program reach this
  page and were taking people past the start screen. The slots are fixed by
  number too, see slots() below.

  The pick is one message, to skymp5-client rather than to our plugin:

      window.skyrimPlatform.sendMessage('thornswood', 'select', profileId)

  The client (our fork, gameData.chooseAtMenu) has been waiting at the menu
  for exactly that and logs in as that profile. thornswood-front.js hears the
  same message and writes the choice to disk for the launcher, which fetches
  the voice token for it and keeps the books. A delete is a line to the
  plugin, 'select:forget <id>', which the launcher reads the same way and
  drops the character from its list; the character itself stays on the
  server, the way the old launcher's Delete worked.

  MUSIC: the launcher passes a file name when the build carries the theme,
  and the page plays it on a loop from the menu through the loading screen.
  The page is reloaded once the world is up, which is what stops it. This was
  dev only until 22 September, when the final track arrived and went to main.

  Same rule as every overlay: nothing calls loadUrl, this mounts itself and
  hides itself. Same look as the K panel next door.
*/

(function () {
  if (window.thornswoodSelect) return;

  var LIST = window.THORNSWOOD_SELECT;
  if (!LIST || !Array.isArray(LIST.characters)) return;

  var chars = LIST.characters.slice();
  var spare = Number(LIST.spare) || 0;
  var last = Number(LIST.last) || 0;
  var SLOTS = Math.max(1, Number(LIST.slots) || 2);
  var at = 0;
  var sent = false;
  var asking = 0;        // the profile id a delete is being confirmed for, or 0

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'select:' + what); } catch (e) { }
  }

  /* The page is laid out for a 1920x1080 screen and scaled up from there. */
  function scale() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    if (!isFinite(s) || s < 1) s = 1;
    return Math.min(s, 2.4);
  }

  /*
    Kept plain on purpose. No cursor rules, no transitions, no hover styles:
    the first three cuts of this page died the moment the mouse moved over
    them, with the browser still up according to the plugin, and hover is
    the one thing a mouse move asks of a page. The lit slot is lit by a
    click or a key and nothing else.
  */
  var css = [
    '#ts-select{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;',
    'background:#0b0907;',
    'font-family:"Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;color:#e4d9bf;user-select:none;pointer-events:auto}',
    '#ts-select.gone{display:none}',
    '#ts-select *{box-sizing:border-box}',
    // the painting behind everything: the loop when it plays, the still under it.
    // Djinn, 1 October: shown at its own size and centred, no zoom or drift,
    // so the art is never cropped or rescaled and the scroll on the ledge
    // lines up with the painting (undoes the zoom added for #609).
    '#ts-select .bg{position:absolute;inset:0;z-index:0;background:#0b0907 center/cover no-repeat}',
    '#ts-select .bg video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
    '#ts-select .shade{position:absolute;inset:0;z-index:0;',
    'background:radial-gradient(ellipse at center,rgba(0,0,0,.40) 0%,rgba(0,0,0,.76) 100%)}',
    '#ts-select .panel{position:relative;z-index:1;width:960px;max-height:92vh;display:flex;flex-direction:column;transform-origin:center center;',
    'background:rgba(9,8,6,.96);border:2px solid rgba(198,170,109,.55);outline:1px solid rgba(198,170,109,.22);outline-offset:6px;',
    'box-shadow:0 30px 90px rgba(0,0,0,.8),inset 0 0 0 1px rgba(0,0,0,.6)}',
    '#ts-select .head{padding:32px 44px 20px;border-bottom:1px solid rgba(198,170,109,.3);display:flex;align-items:flex-end;justify-content:space-between}',
    '#ts-select .eyebrow{font-size:13px;letter-spacing:.42em;text-transform:uppercase;color:#c6aa6d;margin-bottom:10px}',
    '#ts-select .title{font-size:42px;color:#f6e9c8;line-height:1.05}',
    '#ts-select .count{font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:rgba(198,170,109,.7);padding-bottom:8px}',
    '#ts-select .list{padding:22px 44px 8px;overflow:auto;display:grid;gap:14px}',
    /*
      Scrollbars, for this page and for the window it sits in. The browser's
      own is a white strip against a dark page, which reads as a fault rather
      than as a control. Written without a page in front of them on purpose:
      this page is up at the main menu before any other is loaded, and the K
      panel carries the same rules for the world.
    */
    '::-webkit-scrollbar{width:10px;height:10px}',
    '::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    'background-clip:padding-box;border-radius:6px}',
    '::-webkit-scrollbar-thumb:active{background:rgba(233,209,155,.55);background-clip:padding-box}',
    '::-webkit-scrollbar-corner{background:transparent}',
    // a slot
    '#ts-select .slot{position:relative;border:1px solid rgba(198,170,109,.34);background:rgba(255,255,255,.025);padding:20px 26px 20px 30px;',
    'min-height:132px}',
    '#ts-select .slot::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:transparent}',
    '#ts-select .slot.at{border-color:#e9d19b;background:rgba(120,94,44,.30)}',
    '#ts-select .slot.at::before{background:#e9d19b}',
    '#ts-select .slot.empty{border-style:dashed;background:rgba(0,0,0,.18)}',
    '#ts-select .slot.empty.at{background:rgba(120,94,44,.22)}',
    '#ts-select .slotno{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:rgba(198,170,109,.7);margin-bottom:8px;display:flex;gap:14px}',
    '#ts-select .slotno .tag{color:#e9d19b}',
    '#ts-select .slotno .tag.gone{color:#f6c9b0}',
    '#ts-select .slot.gone{border-style:dashed}',
    '#ts-select .slotno .tag.dead,#ts-select .slotno .tag.barred{color:#f0a89a}',
    '#ts-select .slot.dead,#ts-select .slot.barred{border-style:dotted;opacity:.72}',
    '#ts-select .name{font-size:32px;color:#f6e9c8;line-height:1.1;padding-right:56px}',
    '#ts-select .name.faint{color:rgba(246,233,200,.62);font-style:italic}',
    '#ts-select .stats{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:18px;margin-top:14px}',
    '#ts-select .stat .k{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:rgba(198,170,109,.65);margin-bottom:4px}',
    '#ts-select .stat .v{font-size:17px;color:#e4d9bf}',
    '#ts-select .stat .v.dim{color:rgba(228,217,191,.5)}',
    '#ts-select .make{font-size:26px;color:#e9d19b;margin-top:2px}',
    '#ts-select .sub{font-size:15px;line-height:1.5;color:rgba(228,217,191,.6);margin-top:8px;max-width:720px}',
    // the delete icon and the confirm strip
    '#ts-select .bin{position:absolute;right:16px;top:16px;width:48px;height:48px;display:grid;place-items:center;border:1px solid rgba(198,170,109,.25);',
    'color:rgba(228,217,191,.55)}',
    '#ts-select .bin svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '#ts-select .confirm{position:absolute;inset:0;background:rgba(40,12,10,.96);display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 30px}',
    '#ts-select .confirm .q{font-size:18px;color:#f6e9c8;line-height:1.4}',
    '#ts-select .confirm .q small{display:block;font-size:13.5px;color:rgba(228,217,191,.6);margin-top:4px}',
    '#ts-select .confirm .b{display:flex;gap:10px}',
    '#ts-select .btn2{border:1px solid rgba(198,170,109,.6);padding:10px 22px;font-size:13px;letter-spacing:.2em;text-transform:uppercase;',
    'color:#e9d19b;background:rgba(0,0,0,.3);white-space:nowrap}',
    '#ts-select .btn2.danger{border-color:#e9a27a;color:#f6c9b0;background:rgba(120,40,30,.45)}',
    // the foot
    '#ts-select .foot{padding:16px 44px 30px}',
    '#ts-select .status{font-size:15px;color:rgba(228,217,191,.7);min-height:1.5em;margin-bottom:12px;text-align:center}',
    '#ts-select .hint{font-size:13px;color:rgba(228,217,191,.45);margin-top:4px;text-align:center;letter-spacing:.06em}',
    // The line at the menu while the world is full (#481): the place, big, in
    // place of the slots, which cannot be played until it is their turn.
    '#ts-select .line{display:none;text-align:center;padding:34px 44px 10px}',
    '#ts-select .line .place{font-size:40px;color:#f6e9c8;line-height:1.15}',
    '#ts-select .line .why{font-size:16px;line-height:1.55;color:rgba(228,217,191,.72);margin:14px auto 0;max-width:680px}',
    '#ts-select.waiting .line{display:block}',
    // Join now shows only when it is their turn (Patrick, 29 Sep: nothing to do while waiting,
    // only at their turn, and a minute to do it).
    '#ts-select .line .turnrow{display:none;justify-content:center;margin-top:20px}',
    '#ts-select.turn .line .turnrow{display:flex}',
    '#ts-select .line .turn{font-size:20px;padding:10px 30px}',
    // Back from being idle (#1142): why they are here, and a way to the slots.
    '#ts-select .line .away{font-size:16px;line-height:1.55;color:#c6aa6d;margin:0 auto 16px;max-width:680px}',
    '#ts-select .line .otherrow{justify-content:center;margin-top:18px}',
    // The server ended the last session (#1157): its sentence, over the slots, until a pick.
    '#ts-select .ended{display:none;font-size:16px;line-height:1.55;color:#c6aa6d;text-align:center;margin:0 auto;padding:22px 44px 0;max-width:760px}',
    '#ts-select.waiting .list,#ts-select.waiting .hint{display:none}',
    // Well below the hint and centred, so it is nowhere near the characters.
    '#ts-select .quitrow{display:flex;justify-content:center;margin-top:18px}',
    '#ts-select .quit{opacity:.72}',
    // Show the sealed scroll next time: an inked tick box, quieter than Close the game.
    '#ts-select .backrow{display:flex;justify-content:center;margin-top:16px;margin-bottom:4px}',
    '#ts-select .backbox{display:inline-flex;align-items:center;gap:9px;padding:5px 13px 5px 10px;background:rgba(0,0,0,.62);',
    'border:1px solid rgba(150,82,64,.32);font-style:italic;font-size:14px;letter-spacing:.02em;color:#a2584a;',
    'text-shadow:0 1px 0 rgba(0,0,0,.8)}',
    '#ts-select .backbox input{-webkit-appearance:none;appearance:none;flex:none;width:15px;height:15px;margin:0;',
    'border:1.5px solid rgba(162,88,74,.7);border-radius:1px 3px 1px 3px;background:rgba(0,0,0,.45)}',
    '#ts-select .backbox input:checked{background:rgba(0,0,0,.45) url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\'><path d=\'M3.5 10.5 C5.5 11.5 7 13.5 8.2 16 C10.5 10.5 13.5 6 17.5 2.5\' fill=\'none\' stroke=\'%23b0604f\' stroke-width=\'2.6\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") center/140% no-repeat}',
    '#ts-select .quit:hover{opacity:1}',
    /*
      The scroll in front of the choice, Djinn, 24 September. The painting
      plays with the sealed "To Start" scroll resting on the ledge by the
      warrior; clicking it breaks the seal, the scroll rises and unrolls, and
      clicking Continue brings up the slots. No key does either, see introKey.
      The stage below is 16:9 and covers the window the way the loop does
      (object-fit:cover), so the scroll sits on the same spot of the ledge at
      any size. Same rules as the rest of this page: no hover, no cursor
      rules, no transitions; the only motion is the glow below and the
      keyframes the click starts.
    */
    '#ts-select .intro{position:absolute;inset:0;z-index:1;overflow:hidden}',
    '#ts-select .intro .stage{position:absolute;left:50%;top:50%;width:max(100vw,177.778vh);height:max(56.25vw,100vh);transform:translate(-50%,-50%)}',
    '#ts-select .intro .closed{position:absolute;left:20.625%;top:74.931%;width:17.93%;height:auto}',
    /*
      The glow behind the sealed scroll, Djinn, 25 September: it has to look
      clickable. A soft candle-gold halo centred on the seal breathes brighter
      and dimmer every 2.6 seconds and fades the moment the scroll is opened.
      The one motion here not started by a click, and still no hover, cursor
      or transition rules: it is an opacity keyframe on a gradient, which the
      compositor runs without repainting the page.
    */
    '#ts-select .intro .halo{position:absolute;left:29.9%;top:79.8%;width:24%;height:22%;transform:translate(-50%,-50%);border-radius:50%;',
    'pointer-events:none;opacity:.35;animation:tsGlow 1.3s ease-in-out infinite alternate;',
    'background:radial-gradient(ellipse closest-side,rgba(255,222,150,.85) 0%,rgba(246,200,112,.55) 38%,rgba(230,170,80,.22) 64%,transparent 100%)}',
    '#ts-select .intro.opening .halo{animation:tsFade .3s ease forwards}',
    '@keyframes tsGlow{from{opacity:.35}to{opacity:1}}',
    '#ts-select .intro .flash{position:absolute;left:29.881%;top:79.632%;width:3%;height:0;padding-bottom:3%;border-radius:50%;opacity:0;',
    'transform:translate(-50%,-50%) scale(0);pointer-events:none;',
    'background:radial-gradient(circle,#fff8e0 0%,rgba(243,211,143,.95) 22%,rgba(158,111,201,.55) 52%,transparent 72%)}',
    // The open scroll, Djinn, 1 October: smaller than the painted
    // THORNSWOOD title and sitting under it, with its lettering scaled to
    // match so it still reads easily.
    '#ts-select .intro .open{position:absolute;left:50%;top:62%;width:34%;opacity:0;transform:translate(-50%,-50%) scale(.04,.12);pointer-events:none}',
    '#ts-select .intro .open img{display:block;width:100%;height:auto}',
    '#ts-select .intro .words{position:absolute;left:17%;right:17%;top:20%;bottom:18%;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;text-align:center;opacity:0}',
    '#ts-select .intro .said{font-style:italic;font-size:1.28vw;line-height:1.45;color:#2c1e10}',
    /*
      What is written on the open scroll, Djinn, 25 September: it has to read
      as ink on the parchment, not as a page's form. The tick box is a small
      square ruled in the same brown ink with a quill stroke for the tick, and
      Continue is lettered between two ink flourishes instead of sitting in a
      dark button. Still no hover, cursor or transition rules, as above.
    */
    '#ts-select .intro .skip{margin-top:1.05vw;font-size:.88vw;font-style:italic;color:#3a2714;display:flex;align-items:center;gap:.6vw;',
    'text-shadow:0 1px 0 rgba(255,236,190,.35)}',
    '#ts-select .intro .skip input{-webkit-appearance:none;appearance:none;flex:none;width:.95vw;height:.95vw;margin:0;position:relative;',
    'border:.13vw solid rgba(44,30,16,.78);border-radius:.12vw .22vw .1vw .25vw;background:rgba(255,238,196,.18);',
    'box-shadow:inset 0 0 .25vw rgba(90,60,25,.35),0 1px 0 rgba(255,236,190,.35)}',
    '#ts-select .intro .skip input:checked{background:rgba(255,238,196,.18) url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\'><path d=\'M3.5 10.5 C5.5 11.5 7 13.5 8.2 16 C10.5 10.5 13.5 6 17.5 2.5\' fill=\'none\' stroke=\'%232c1e10\' stroke-width=\'2.4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") center/135% no-repeat}',
    '#ts-select .intro .go{margin-top:1.05vw;padding:.3vw 0;border:0;background:none;display:flex;align-items:center;gap:.9vw;',
    'font-size:1vw;letter-spacing:.32em;text-transform:uppercase;color:#2c1e10;text-shadow:0 1px 0 rgba(255,236,190,.4)}',
    '#ts-select .intro .go::before,#ts-select .intro .go::after{content:"";width:2.6vw;height:.12vw;',
    'background:linear-gradient(90deg,transparent,rgba(44,30,16,.8))}',
    '#ts-select .intro .go::after{background:linear-gradient(270deg,transparent,rgba(44,30,16,.8))}',
    '#ts-select .intro.opening .flash{animation:tsFlash .7s ease-out forwards}',
    '#ts-select .intro.opening .closed{animation:tsFade .5s ease .35s forwards}',
    '#ts-select .intro.opening .open{pointer-events:auto;animation:tsRise 1.1s cubic-bezier(.22,.9,.25,1) .35s forwards}',
    '#ts-select .intro.opening .words{animation:tsShow .9s ease 1.6s forwards}',
    '@keyframes tsFlash{0%{opacity:0;transform:translate(-50%,-50%) scale(0)}12%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(8)}}',
    '@keyframes tsFade{to{opacity:0}}',
    '@keyframes tsShow{to{opacity:1}}',
    '@keyframes tsRise{0%{opacity:0;left:29.5%;top:81%;transform:translate(-50%,-50%) scale(.04,.12)}30%{opacity:1}',
    '60%{transform:translate(-50%,-50%) scale(.3,1)}100%{opacity:1;left:50%;top:62%;transform:translate(-50%,-50%) scale(1,1)}}'
  ].join('');
  var style = document.createElement('style');
  style.id = 'ts-select-css';
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.id = 'ts-select';
  root.innerHTML =
    '<div class="bg"></div><div class="shade"></div>' +
    '<div class="intro" style="display:none"><div class="stage">' +
      '<div class="halo"></div><img class="closed" src="thornswood-scroll.webp" alt="To Start">' +
      '<div class="flash"></div>' +
      '<div class="open"><img src="thornswood-scroll-open.webp" alt="">' +
        '<div class="words"><div class="said">The seal is broken.<br>Your journey through Thornswood begins.</div>' +
        '<label class="skip"><input type="checkbox" class="skipnext"> Start without the scroll next time</label>' +
        '<div class="btn2 go">Continue</div></div></div>' +
    '</div></div>' +
    '<div class="panel">' +
      '<div class="head"><div><div class="eyebrow">Thornswood</div><div class="title">Who are you today?</div></div>' +
      '<div class="count"></div></div>' +
      '<div class="ended"></div>' +
      '<div class="list"></div>' +
      '<div class="line"><div class="away" style="display:none"></div><div class="place"></div><div class="why"></div>' +
        '<div class="turnrow"><button class="btn2 turn" type="button">Join now</button></div>' +
        '<div class="otherrow" style="display:none"><button class="btn2 other" type="button">Choose another character</button></div></div>' +
      '<div class="foot"><div class="status"></div>' +
      '<div class="hint">Click a character to play. Click an empty slot for a new character. Delete forgets the one that is lit.</div>' +
      /*
        A way out of this page that is not Task Manager.

        Patrick, 22 September: "add a close game button in the main menu with
        the chacrther selector". Until now the only way to leave was alt
        tabbing and killing Skyrim, which is also what people do when the page
        itself stops answering: Djinn's "Timed out" report ends "have to task
        out exit". A quit that the page offers is one they can reach while it
        is still drawing.

        It asks a second time before it goes, the way Forget does, because
        this is one click from Play and quitting by accident is a loading
        screen and a walk back to where you were.
      */
      '<div class="quitrow"><div class="btn2 quit">Close the game</div></div></div>' +
    '</div>';
  document.body.appendChild(root);
  var elPanel = root.querySelector('.panel');
  var elBg = root.querySelector('.bg');
  var elList = root.querySelector('.list');

  /*
    The painting. The still goes on as the background at once; the loop is
    laid over it and plays if this browser decodes it, and is taken away
    again if it cannot, so what is behind the panel is the painting either
    way and never a black box. Muted, because the music is its own element.
    Djinn, 1 October: the still stays under the loop on purpose. Skyrim and
    the mods are still loading when the page comes up, so the still is what
    shows until the loop can play. The loop plays at its own speed (not
    sped up), the timing the animation was approved at.
  */
  if (LIST.still) { try { elBg.style.backgroundImage = 'url("' + String(LIST.still) + '")'; } catch (e) { } }
  if (LIST.video) {
    try {
      var vid = document.createElement('video');
      vid.muted = true; vid.loop = true; vid.autoplay = true;
      vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
      vid.preload = 'auto';
      vid.onerror = function () { try { vid.remove(); } catch (e) { } tell('painting: the loop would not play here, the still stays'); };
      vid.onplaying = function () { tell('painting: the loop is playing'); };
      vid.src = String(LIST.video);
      elBg.appendChild(vid);
      var vp = vid.play();
      if (vp && typeof vp.catch === 'function') { vp.catch(function () { }); }
    } catch (e) { tell('painting: ' + e); }
  }
  var elCount = root.querySelector('.count');
  var elStatus = root.querySelector('.status');

  /*
    STILL LOADING UNTIL THE FRONT IS IN (#5140). The engine shows this page
    as the game starts, about 25 seconds before the plugins run, and it does
    not hand the page the mouse until the front plugin focuses it: a pick
    goes to the front first (the seat check below), so nothing on the page
    can act before then. On 31 Oct the page was focused from the start with
    no cursor and looked frozen, and a click at the middle picked the
    character drawn there. So until the front has said anything to this
    page, the line under the slots says it is still loading, and the cursor
    comes with the front. LIST.front is set when the front itself wrote the
    list (a page it reloads or brings back), which it only does once it is in.
  */
  var LOADING_WORDS = 'The game is still loading. Your characters can be picked in a moment.';
  var frontIn = LIST.front === true;
  function frontHere() {
    if (frontIn) return;
    frontIn = true;
    if (!sent && elStatus.textContent === LOADING_WORDS) elStatus.textContent = '';
    tell('the front is in, so the slots can be picked');
  }

  /*
    The scroll, Djinn, 24 September. Up first unless this person ticked
    "Start without the scroll next time" (the launcher passes intro:false
    then, from Data/Platform/thornswood-intro.txt, which the plugin writes).
    It only stands in front of the slots: the painting, the music and the
    pick are exactly as before, and if either picture of the scroll is
    missing the slots come straight up.
  */
  var elIntro = root.querySelector('.intro');
  var elShade = root.querySelector('.shade');
  var introPhase = 0;       // 0 not showing, 1 on the ledge, 2 opened
  var introSay = '';        // 'intro off' or 'intro on', said again with the pick
  var introWent = false;    // Continue was pressed, so the choice has started
  function introEnd(why) {
    if (!introPhase) return;
    introPhase = 0;
    var box = root.querySelector('.intro .skipnext');
    /*
      Ticking "Start without the scroll next time" and then walking into the
      slots used to be a one way door for the rest of the start: the way back
      is drawn only when the scroll was already off, so the person who had
      just switched it off had nothing to switch it on with until the next
      start. The same tick box goes up here, unticked, so the scroll can be
      brought back in the same sitting.
    */
    if (box && box.checked) { introSay = 'intro off'; tell(introSay); showBackBox(); }
    elIntro.style.display = 'none';
    elPanel.style.display = '';
    elShade.style.display = '';
    if (why) tell('intro: ' + why);
    fit(); draw();
  }
  function introOpen() {
    if (introPhase !== 1) return;
    introPhase = 2;
    elIntro.className = 'intro opening';
    tell('intro: the scroll was opened');
  }
  // Keys while the scroll is up. Every one of them, the tick box's Space
  // included: the mouse is the only thing that moves this screen.
  /*
    The scroll moves only for a click, Djinn, 25 September. Enter, Space and
    Escape used to open it, continue or skip it, and on 25 September at
    16:23:50 it opened with nobody at the game: four key presses typed into
    another window reached the game (thornswood-input.log, fg another
    window, keys 4). So while the scroll is up every key is swallowed and
    only the mouse opens it, ticks the box and presses Continue.

    Swallowed and written down. Nothing said so the first time, so the only
    evidence that stray keys were reaching the page at all was a count in
    another log that happened to be running that evening. strayKey puts one
    line in the front log the first time a key is ignored here.
  */
  function introKey(ev) {
    if (!introPhase) return false;
    ev.preventDefault();
    strayKey('the sealed scroll only opens for a click');
    return true;
  }

  /*
    Bring the scroll back, Djinn, 25 September: the faint hint line that did
    this was easy to miss, and a full button looked more important than
    Close the game. So it is a small inked tick box on a black strip, red
    lettering in the page's own italic, like the tick box on the open scroll.
    Ticked says 'intro on', unticked 'intro off', each time it changes.

    Up when the scroll was off at this start, and up when it was switched off
    on the scroll a moment ago (see introEnd). Never up otherwise: with the
    scroll already coming back next time there is nothing here to ask for.
  */
  var backShown = false;
  function showBackBox() {
    if (backShown) return;
    backShown = true;
    var backRow = el('div', 'backrow');
    var backBox = el('label', 'backbox');
    var backTick = document.createElement('input');
    backTick.type = 'checkbox';
    backBox.appendChild(backTick);
    backBox.appendChild(document.createTextNode('Show the sealed scroll next time'));
    backTick.onchange = function () {
      introSay = backTick.checked ? 'intro on' : 'intro off';
      tell(introSay);
    };
    backRow.appendChild(backBox);
    root.querySelector('.foot').insertBefore(backRow, root.querySelector('.quitrow'));
  }

  if (elIntro && LIST.intro !== false) {
    introPhase = 1;
    elPanel.style.display = 'none';
    elShade.style.display = 'none';
    elIntro.style.display = '';
    var introImgs = elIntro.querySelectorAll('img');
    for (var ii = 0; ii < introImgs.length; ii++) {
      introImgs[ii].onerror = function () { introEnd('a scroll picture is missing, straight to the slots'); };
    }
    elIntro.querySelector('.closed').onclick = introOpen;
    /*
      Continue is when the choice really starts, Djinn, 25 September: the
      client's fallback to the last character is meant to count from here
      and not from the game reaching the menu, so time on the scroll is not
      time taken from choosing. Told to the client as 'thornswood',
      'choosing'; a client from before that change ignores it.

      SAID ONCE WAS NOT ENOUGH, and that is why the three minutes still ran
      from the menu on the build people were given. This page is up about
      fifteen seconds before any plugin is, and the client only starts
      listening for the choice when the server has asked it to sign in, so a
      word sent on the click can land before anybody is listening and be gone.
      The pick has been repeated for that reason since 21 September. So has
      'stay' since the day it was added. This is repeated on the same beat
      now, until a character is picked, and the front repeats it too.
    */
    elIntro.querySelector('.go').onclick = function () {
      introWent = true;
      try { window.skyrimPlatform.sendMessage('thornswood', 'choosing'); } catch (e) { }
      // The front hears this and says the same word to the client from its
      // own tick, so the wait survives the page being reloaded or dying.
      tell('choosing');
      introEnd('continue clicked, the choice starts now');
    };
    tell('intro: the scroll is up');
  } else if (LIST.intro === false) {
    showBackBox();
  }

  /*
    Close the game. Asked twice, then sent to the front, which calls the
    engine's own quit: nothing in a browser can shut Skyrim.

    The second click is the confirm, on the same button, which is the lightest
    thing that cannot be done by accident. It gives up after five seconds so a
    stray first click does not leave a loaded gun sitting on the page.
  */
  var elQuit = root.querySelector('.quit');
  var quitArmed = 0;
  if (elQuit) {
    elQuit.onclick = function () {
      var now = Date.now();
      if (quitArmed && now - quitArmed < 5000) {
        quitArmed = 0;
        elQuit.textContent = 'Closing...';
        elQuit.className = 'btn2 quit';
        tell('quit');
        /*
          AND IT PUTS ITSELF BACK IF NOTHING HAPPENS.

          Patrick: "close game button in main menu doesnt wokr just says
          closing game forever". It said Closing for ever because the quit was
          throwing on the other side and the page had committed to the word
          with nothing to take it back.

          A button that says Closing for ever is indistinguishable from a slow
          quit, which is exactly how this was reported and why it took a
          measurement rather than a glance to find. Six seconds is far longer
          than a working exit needs and short enough that somebody has not yet
          decided the launcher is broken.
        */
        setTimeout(function () {
          try {
            if (root.className === 'gone') { return; }
            elQuit.textContent = 'Close the game';
            elQuit.className = 'btn2 quit';
            tell('quit did not take, the game is still here');
          } catch (e) { }
        }, 6000);
        return;
      }
      quitArmed = now;
      elQuit.textContent = 'Click again to close';
      elQuit.className = 'btn2 quit danger';
      setTimeout(function () {
        if (!quitArmed) { return; }
        quitArmed = 0;
        elQuit.textContent = 'Close the game';
        elQuit.className = 'btn2 quit';
      }, 5000);
    };
  }

  function fit() {
    try { elPanel.style.transform = 'scale(' + scale().toFixed(3) + ')'; } catch (e) { }
  }

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function when(iso) {
    var d = new Date(String(iso || ''));
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + SHORT[d.getMonth()] + ', ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function hours(c) {
    var s = Number(c.seconds);
    if (!isFinite(s) || s < 0) {
      // An older launcher sends only the text, "1h 20m played".
      return String(c.played || '').replace(/\s*played$/, '');
    }
    if (s < 60) return 'Under a minute';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + ' min';
  }

  /*
    The slots, fixed by the stored number. Slot n is the character the
    launcher numbered n; every number from 1 to the allowance with nobody in
    it is an empty card offering a new character; a character numbered past
    the allowance is drawn after them, in number order, because a character
    that exists is never hidden over a role change. Nothing is compacted or
    renumbered here.

    Patrick, 20 September: "when I deleted a character the slots moved, I
    want each slot to stay as is and so slot 1 and 3 could have things in
    them and slot 2 says make a new character". This page had switched to
    drawing 1 to n for the characters there are, in slot order, earlier the
    same day, because the stored numbers had climbed past the allowance (1
    empty, 2 empty, 3, 4, 5 on a three slot account) and the page was
    offering a fourth and a fifth. That is closed where the list is kept, on
    the site (site\lib\characters.js, #5938): nextSlot hands out the lowest
    free number and tidySlots moves a character down from above the
    allowance whenever a number under it is free, before this list is
    written. A character with no number, or one
    whose number another already holds, is drawn in the first empty slot
    rather than lost; the launcher has written a number since the day the
    file existed, so that is a hand edited file and nothing more.
  */
  function slots() {
    var held = {};
    var loose = [];
    // Dead for good (#1010): in no slot, drawn last, never played, so the
    // slot it held offers a new character.
    var dead = [];
    chars.forEach(function (c) {
      if (c.pk) { dead.push(c); return; }
      var n = Number(c.slot) || 0;
      if (n >= 1 && !held[n]) held[n] = c;
      else loose.push(c);
    });
    var out = [];
    var n;
    for (n = 1; n <= SLOTS; n++) {
      var c = held[n] || loose.shift() || null;
      out.push({ n: n, id: c ? (Number(c.profileId) || 0) : spare, c: c });
    }
    var beyond = [];
    for (var k in held) { if (held.hasOwnProperty(k) && Number(k) > SLOTS) beyond.push(Number(k)); }
    beyond.sort(function (a, b) { return a - b; });
    beyond.forEach(function (m) { out.push({ n: m, id: Number(held[m].profileId) || 0, c: held[m] }); });
    loose.forEach(function (c) { out.push({ n: out.length + 1, id: Number(c.profileId) || 0, c: c }); });
    dead.forEach(function (c) { out.push({ n: 0, id: Number(c.profileId) || 0, c: c }); });
    return out;
  }

  var BIN = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  /*
    What the click meant is decided by where the mouse went DOWN, not by what
    the click landed on.

    Stopping the click at the bin is not enough, and Patrick found that the
    hard way on 20 September: the delete icon stopped working and a press on
    it played the character instead. A browser fires click on the nearest
    common ancestor of what the mouse went down on and what it came up on, so
    a press that starts on the bin's icon and ends one pixel outside it fires
    the click on the slot, the bin's own handler never runs, and the slot
    plays. The icon is 36 pixels of a card the size of the panel, the cursor
    in the main menu is drawn by the game rather than by the page, and the
    browser only hears about the pointer when it moves, so a press that drifts
    is the normal case there rather than the odd one.

    So every press through the page records where it started, and the slot
    asks that question before it plays. Nothing here restyles on a mouse move,
    which is the rule this page keeps: it listens, it does not paint.
  */
  var downOn = '';       // 'bin', 'confirm' or ''
  var downSlot = -1;     // which slot the press started in

  function partOf(node, cls) {
    while (node && node !== root) {
      if (node.className && (' ' + node.className + ' ').indexOf(' ' + cls + ' ') >= 0) return true;
      node = node.parentNode;
    }
    return false;
  }

  function draw() {
    elList.textContent = '';
    var list = slots();
    if (at >= list.length) at = Math.max(0, list.length - 1);
    var taken = list.filter(function (e) { return !!e.c && !e.c.pk; }).length;
    elCount.textContent = taken + ' of ' + SLOTS + ' slots';
    list.forEach(function (e, i) {
      var card = el('div', 'slot' + (i === at ? ' at' : '') + (e.c ? '' : ' empty') + (e.c && e.c.gone ? ' gone' : '') +
                    (e.c && e.c.pk ? ' dead' : '') + (e.c && e.c.banned ? ' barred' : ''));
      var no = el('div', 'slotno', e.c && e.c.pk ? 'No slot' : 'Slot ' + e.n);
      if (e.c && e.id === last && !e.c.pk) no.appendChild(el('span', 'tag', 'last played'));
      if (e.c && e.c.pk) no.appendChild(el('span', 'tag dead', 'dead for good'));
      else if (e.c && e.c.banned) no.appendChild(el('span', 'tag barred', 'banned'));
      else if (e.c && e.c.gone) no.appendChild(el('span', 'tag gone', 'not on this server'));
      if (!e.c) no.appendChild(el('span', '', 'empty'));
      card.appendChild(no);
      if (e.c) {
        var c = e.c;
        card.appendChild(el('div', 'name' + (c.name && !c.gone ? '' : ' faint'), c.name || 'Unnamed character'));
        /*
          THE SERVER SAID IT HAS NO CHARACTER UNDER THIS ID (#955). Its world
          started over since this character was played, or it could not load
          it. Picking the slot makes a new character on it, so the card says
          that in place of the stats of a character that will not come back.
          The bin stays, so the slot can be cleared.
        */
        /*
          STAFF KILLED IT FOR GOOD, OR BANNED IT BY ITSELF (#1010). Neither
          can be played; the join pass would refuse it and the server would
          end the session. A dead one holds no slot, so an empty slot above
          offers a new character. The bin stays, so it can be forgotten.
        */
        if (c.pk) {
          card.appendChild(el('div', 'sub',
            'This character has died for good and cannot be played again. Make a new character in an empty slot.'));
        } else if (c.banned) {
          card.appendChild(el('div', 'sub',
            'Staff have banned this character for now. Play another character, or ask staff in the Discord.'));
        } else if (c.gone) {
          card.appendChild(el('div', 'sub',
            'The server no longer has this character. Playing this slot makes a new character in the creation hall.'));
        }
        var stats = el('div', 'stats');
        if (c.gone || c.pk) stats.style.display = 'none';
        var s1 = el('div', 'stat'); s1.appendChild(el('div', 'k', 'Last location'));
        s1.appendChild(el('div', 'v' + (c.where ? '' : ' dim'), c.where || 'Not seen in the world yet'));
        var s2 = el('div', 'stat'); s2.appendChild(el('div', 'k', 'Hours played'));
        var hp = hours(c); s2.appendChild(el('div', 'v' + (hp ? '' : ' dim'), hp || 'None yet'));
        var s3 = el('div', 'stat'); s3.appendChild(el('div', 'k', 'Last played'));
        var w = when(c.lastPlayed); s3.appendChild(el('div', 'v' + (w ? '' : ' dim'), w || 'Never'));
        stats.appendChild(s1); stats.appendChild(s2); stats.appendChild(s3);
        card.appendChild(stats);
        var bin = el('div', 'bin');
        bin.title = 'Forget this character';
        bin.innerHTML = BIN;
        bin.onmousedown = function (ev) { downOn = 'bin'; downSlot = i; if (ev.stopPropagation) ev.stopPropagation(); };
        bin.onclick = function (ev) { if (ev.stopPropagation) ev.stopPropagation(); ask(i, e.id); };
        card.appendChild(bin);
        if (asking === e.id) {
          var strip = el('div', 'confirm');
          var q = el('div', 'q', 'Forget ' + (c.name || 'this character') + '?');
          q.appendChild(el('small', '', 'This launcher drops it from the list. The character itself stays on the server.'));
          strip.appendChild(q);
          var b = el('div', 'b');
          var yes = el('div', 'btn2 danger', 'Forget');
          yes.onmousedown = function (ev) { downOn = 'confirm'; downSlot = i; if (ev.stopPropagation) ev.stopPropagation(); };
          yes.onclick = function (ev) { if (ev.stopPropagation) ev.stopPropagation(); forget(e.id); };
          var no2 = el('div', 'btn2', 'Keep');
          no2.onmousedown = function (ev) { downOn = 'confirm'; downSlot = i; if (ev.stopPropagation) ev.stopPropagation(); };
          no2.onclick = function (ev) { if (ev.stopPropagation) ev.stopPropagation(); asking = 0; draw(); };
          b.appendChild(yes); b.appendChild(no2);
          strip.appendChild(b);
          strip.onmousedown = function (ev) { downOn = 'confirm'; downSlot = i; if (ev.stopPropagation) ev.stopPropagation(); };
          strip.onclick = function (ev) { if (ev.stopPropagation) ev.stopPropagation(); };
          card.appendChild(strip);
        }
      } else {
        card.appendChild(el('div', 'make', 'Make a new character'));
        card.appendChild(el('div', 'sub', e.id
          ? 'A fresh face. You will wake in the creation hall and choose your class, your profession and your home there.'
          : 'The launcher minted no id for a new character. Press Play in the launcher again.'));
      }
      /*
        The click is the choice, unless the press started on the bin or in
        the confirm strip. It can land here even then: see the note on
        downOn at the top of the file.
      */
      card.onmousedown = function () { if (downOn === '') downSlot = i; };
      card.onclick = function () {
        var was = downOn, wasSlot = downSlot;
        downOn = ''; downSlot = -1;
        if (was === 'confirm') { return; }
        if (was === 'bin') { ask(wasSlot < 0 ? i : wasSlot, null); return; }
        at = i; asking = 0; draw(); play();
      };
      elList.appendChild(card);
    });
    if (!sent) elStatus.textContent = frontIn ? '' : LOADING_WORDS;
  }

  /* Put the confirm strip up on a slot, by index, and by id when it is known. */
  function ask(i, id) {
    var list = slots();
    if (i < 0 || i >= list.length) return;
    var e = list[i];
    if (!e || !e.c) return;
    at = i;
    asking = id === null || id === undefined ? Number(e.c.profileId) || 0 : id;
    draw();
  }

  function forget(id) {
    asking = 0;
    chars = chars.filter(function (c) { return Number(c.profileId) !== id; });
    if (last === id) last = 0;
    tell('forget ' + id);
    draw();
  }

  /*
    The pick goes to skymp5-client, and again every two seconds until the
    plugin says it heard. This page can be up long before any plugin runs
    (SkyrimPlatform loads the page at start and its plugins fifteen seconds
    later), so a pick made in that gap would otherwise be lost. The client
    ignores the repeats once it has one.

    BUT FIRST THE FRONT ASKS WHETHER THERE IS A SEAT (#481). Patrick, 29 Sep:
    a full world lets people into the menu, where "they sit there until a
    slot is free and it's their turn to join". So the pick goes to the front
    as 'select:want <id>' until it answers: go() when a seat is free, and the
    pick goes to the client as it always did; or line() when the world is
    full, and this page shows the place in line the game server gives it
    over the chat's relay, and goes by itself when the server says it is
    their turn. The order is the server's: nothing here can move a place.
  */
  var acked = false;
  var picked = 0;
  var cleared = false;   // the front or the server said go: the pick goes to the client
  var waiting = false;   // waiting in line at the menu
  var joinWords = '';
  function sendPick() {
    if (!picked || acked) return;
    if (introSay) tell(introSay);
    if (!cleared) { tell('want ' + picked); return; }
    try { window.skyrimPlatform.sendMessage('thornswood', 'select', picked); } catch (err) { }
  }

  /* 1st, 2nd, 3rd, 4th, 11th, 21st. */
  function ordinal(n) {
    var h = n % 100;
    if (h >= 11 && h <= 13) return n + 'th';
    var t = n % 10;
    return n + (t === 1 ? 'st' : t === 2 ? 'nd' : t === 3 ? 'rd' : 'th');
  }
  var elPlace = root.querySelector('.line .place');
  var elWhy = root.querySelector('.line .why');
  var elTitle = root.querySelector('.title');
  var KEEP_OPEN = 'You do not need to do anything while you wait: just keep the game open. ' +
                  'When it is your turn, press Join now within a minute. Closing the game gives up your place.';
  var elTurn = root.querySelector('.line .turn');
  var turnUntil = 0, turnTimer = 0;
  function turnOff() {
    turnUntil = 0;
    if (turnTimer) { clearInterval(turnTimer); turnTimer = 0; }
    if (waiting) root.className = 'waiting';
  }
  /* Their turn: Join now, with the seconds the server holds the seat. */
  function turn(secs) {
    var until = Date.now() + Math.max(0, Number(secs) || 60) * 1000;
    if (!turnUntil || until < turnUntil) turnUntil = until;   // the server's clock wins
    root.className = 'waiting turn';
    elPlace.textContent = 'It is your turn';
    function tick() {
      var left = Math.ceil((turnUntil - Date.now()) / 1000);
      if (left <= 0) {
        turnOff();
        elPlace.textContent = 'Your turn passed';
        elWhy.textContent = 'The seat went to the next in line, and you are back at the end of the line. ' + KEEP_OPEN;
        tell('line: turn passed');
        return;
      }
      elWhy.textContent = 'A seat is yours for ' + left + (left === 1 ? ' second' : ' seconds') +
                          '. Press Join now, or it goes to the next in line.';
    }
    tick();
    if (!turnTimer) turnTimer = setInterval(tick, 1000);
  }
  if (elTurn) elTurn.addEventListener('click', function () {
    if (!turnUntil) return;
    turnOff();
    tell('line: joined on our turn');
    go();
  });
  /* What the line says, from the front (finding, launcher) or the server (place, pass). */
  function lineSays(what) {
    frontHere();
    what = what || {};
    if (!waiting) {
      waiting = true;
      sent = true;
      root.className = 'waiting';
      if (elTitle) elTitle.textContent = away ? 'You were away' : 'The world is full';
      elStatus.textContent = '';
      tell('line shown');
    }
    if (Number(what.id) > 0 && !picked) picked = Number(what.id);
    if (Number(what.place) > 0) {
      if (turnUntil) turnOff();   // back in line: the turn is over
      // Place against how many are waiting, both from the server, redrawn
      // each time either moves (Patrick, 29 Sep: the place against the
      // number in line, updated live).
      var of = Math.max(Number(what.of) || 0, Number(what.place));
      elPlace.textContent = 'You are ' + ordinal(Number(what.place)) + ' of ' + of + ' in line';
      elWhy.textContent = (of === 1 ? 'Nobody is ahead of you. ' :
                           (Number(what.place) - 1) + ' ahead of you, ' + (of - Number(what.place)) + ' behind. ') + KEEP_OPEN;
    } else if (what.pass) {
      elPlace.textContent = 'Waiting for your place in line';
      elWhy.textContent = 'The launcher is still vouching for this character. Keep the launcher and the game open.';
    } else if (what.phase === 'launcher') {
      elPlace.textContent = 'Waiting for your place in line';
      elWhy.textContent = 'Waiting for the launcher to get this character ready. Keep the launcher and the game open.';
    } else if (!elPlace.textContent) {
      elPlace.textContent = 'Finding your place in line';
      elWhy.textContent = KEEP_OPEN;
    }
  }
  /* The server's word, over the relay: a place, or that it is their turn. */
  function onRelay(msg) {
    if (!msg || msg.t !== 'line' || !waiting || cleared) return;
    if (msg.go) { if (!turnUntil) tell('line: our turn'); turn(msg.secs); return; }
    lineSays(msg);
  }
  /*
    BACK FROM BEING AWAY (#1142). Patrick, 29 Sep: somebody who does not
    answer "Are you still here?" is taken "to the main menu where they can
    rechoose their character and they automatically rejoin the queue with the
    same 1 minute to join rule". The front brings this page back with
    LIST.away, the character they were, and the server has already put them
    at the end of the line. So the page opens in that place, with the same
    Join now on their turn, and Choose another character shows the slots:
    the place is kept while they choose, and the one they pick takes it over
    (the front hands it on).
  */
  var away = (LIST.away && Number(LIST.away.id) > 0) ? LIST.away : null;
  /*
    ENDED BY THE SERVER (#1157). A refusal, a ban, a character dead for good
    or a staff /kick: the front took the game out of the world before the
    kick, so the client did not connect again by itself, and LIST.ended is the
    sentence the server said. It stays over the slots until a character is
    picked, which is the only thing that connects again.
  */
  var ended = (typeof LIST.ended === 'string' && LIST.ended) ? LIST.ended : '';
  var elEnded = root.querySelector('.ended');
  var AWAY_WORDS = 'You were taken out of the world after 15 minutes with nothing from your keyboard, mouse or character. ' +
                   'You have a place in line to come back in, as this character or any of your others.';
  var elAway = root.querySelector('.line .away');
  var elOtherRow = root.querySelector('.line .otherrow');
  var elOther = root.querySelector('.line .other');
  function chooseOther() {
    if (!waiting || cleared) return;
    turnOff();
    waiting = false;
    sent = false;
    picked = 0;
    root.className = '';
    if (elTitle) elTitle.textContent = 'Who are you today?';
    elStatus.textContent = 'Your place in line is kept while you choose. Click the character to wait with.';
    draw();
    tell('line: choosing another character');
  }
  if (elOther) elOther.addEventListener('click', chooseOther);

  var hooked = false;
  setInterval(function () {
    if (hooked || !waiting) return;
    if (window.thornswoodNet && window.thornswoodNet.on) {
      hooked = true;
      window.thornswoodNet.on(onRelay);
    }
  }, 500);
  /* A seat: the pick goes to the client, and the world loads. */
  function go() {
    frontHere();
    if (cleared || !picked) return;
    cleared = true;
    if (waiting) {
      waiting = false;
      root.className = '';
      if (elTitle) elTitle.textContent = 'Who are you today?';
      joinWords = 'A seat is free. ' + (joinWords || 'Joining. The world is loading.');
    }
    elStatus.textContent = joinWords || 'Joining. The world is loading.';
    draw();
    sendPick();
    // Said again until the front hears it, as play() does; a page the front
    // reloaded while it waited has no play() running.
    var again = setInterval(function () {
      if (acked) { clearInterval(again); return; }
      sendPick();
    }, 2000);
  }
  function play() {
    if (sent) return;
    // Nothing picks before the front is in (#5140): the line says still loading.
    if (!frontIn) { tell('a pick before the front was in was not taken'); return; }
    var list = slots();
    var e = list[at];
    if (!e || !e.id) return;
    // Never a character staff killed for good or banned by itself (#1010).
    if (e.c && (e.c.pk || e.c.banned)) {
      elStatus.textContent = e.c.pk
        ? 'That character has died for good. Pick another, or make a new character in an empty slot.'
        : 'Staff have banned that character for now. Pick another.';
      return;
    }
    sent = true;
    picked = e.id;
    if (elEnded) elEnded.style.display = 'none';
    joinWords = e.c && !e.c.gone ? 'Joining as ' + (e.c.name || 'your character') + '. The world is loading.' : 'Off to the creation hall. The world is loading.';
    elStatus.textContent = 'Checking for a seat.';
    draw();
    sendPick();
    tell('picked');
    // Until the front answers, and then until the client has the pick. Not
    // while waiting in line: the front has the pick and the server the turn.
    var again = setInterval(function () {
      if (acked) { clearInterval(again); return; }
      if (waiting && !cleared) return;
      sendPick();
    }, 2000);
  }
  function onAcked() {
    acked = true;
    setTimeout(function () { root.className = 'gone'; }, 1200);
  }

  /*
    THE KEYBOARD ONLY COUNTS WHILE THE GAME IS THE WINDOW WINDOWS IS TYPING
    INTO.

    The sealed scroll was made click only on 25 September because it opened
    at 16:23:50 with nobody at the game: four key presses typed into another
    program reached it (thornswood-input.log for that window, fg another
    window, keys 4). The slots behind it were left exactly as they were, and
    they answer Enter by playing the lit one, so the same stray keys still
    took somebody past the start screen and into the world as whoever was lit.
    That half was written down as not fixed at the time and is fixed here.

    A page cannot see which window has the keyboard. The front can:
    sp.win32.foregroundWindow is what the pulse already asks every five
    seconds in the world, and the choice block asks it once a second while
    this page is up and calls keys(true) or keys(false) below. Until it has
    said, and while it says the game is behind something else, every key here
    is swallowed. Nothing on this page needs one: a click plays a character, a
    click opens the scroll, a click presses Continue.

    A client too old to have win32, or a game with no front plugin, never
    calls keys at all. Then the keys work from the first mouse move on this
    page, which is the game handing the browser the mouse and so is somebody
    at the game, and is what they did before this.
  */
  var keysHere = false;
  var keysSaidAt = 0;
  var strayAt = 0;
  function keysCount() {
    if (!keysSaidAt) return moved;
    return keysHere && (Date.now() - keysSaidAt) < 5000;
  }

  /*
    DECIDED AT THE KEY, NOT ON THE LAST ANSWER (#591).

    The once a second answer above is up to a second old when a key lands,
    and somebody who alt tabs to Discord and types hi and Enter inside that
    second had the Enter count as the game's: the lit character played. So a
    key that comes with no answer from the last 150 ms is held, the front is
    asked again at once ('select:keycheck <n>'), and the key is acted on only
    if the answer to that ask, carrying the same n, says the game has the
    keyboard. Another window, or no answer inside a second, and it is dropped.
    Keys that come in a burst share one ask, so arrows held down still move.
  */
  var KEY_FRESH_MS = 150;
  var KEY_ASK_MS = 1000;
  var heldKeys = [];
  var heldAsk = 0;
  var heldTimer = 0;
  function keysFresh() {
    return keysHere && (Date.now() - keysSaidAt) < KEY_FRESH_MS;
  }
  function holdKey(key) {
    if (heldKeys.length < 20) heldKeys.push(key);
    if (heldTimer) return;
    heldAsk++;
    tell('keycheck ' + heldAsk);
    heldTimer = setTimeout(function () {
      heldTimer = 0;
      if (!heldKeys.length) return;
      heldKeys = [];
      strayKey('nothing said in time which window has the keyboard');
    }, KEY_ASK_MS);
  }
  function keysSay(on, ask) {
    frontHere();
    keysHere = !!on;
    keysSaidAt = Date.now();
    if (!heldKeys.length) return;
    if (!keysHere) {
      heldKeys = [];
      if (heldTimer) { clearTimeout(heldTimer); heldTimer = 0; }
      strayKey('the keys are going to another window, not the game');
      return;
    }
    // A yes counts for held keys only when it answers this ask; a once a
    // second answer read before the key was pressed does not.
    if (ask !== heldAsk) return;
    if (heldTimer) { clearTimeout(heldTimer); heldTimer = 0; }
    var keys = heldKeys;
    heldKeys = [];
    for (var i = 0; i < keys.length; i++) keyAct(keys[i]);
  }
  /* One line in the front log, and not one every keystroke. */
  function strayKey(why) {
    var now = Date.now();
    if (strayAt && now - strayAt < 10000) return;
    strayAt = now;
    tell('a key was ignored: ' + why);
  }

  function onKey(ev) {
    if (root.className === 'gone') return;
    if (introKey(ev)) return;
    if (!keysCount()) {
      ev.preventDefault();
      strayKey('the keys are going to another window, not the game');
      return;
    }
    if (keysSaidAt && (heldKeys.length || !keysFresh())) {
      if (keyActs(ev.key)) ev.preventDefault();
      holdKey(ev.key);
      return;
    }
    if (keyAct(ev.key)) ev.preventDefault();
  }
  /* Whether this page has anything bound to the key at all. */
  function keyActs(key) {
    if (asking) return key === 'Escape' || key === 'Enter';
    return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' ||
           key === 'Delete' || /^[1-9]$/.test(key);
  }
  /* What a key does once it counts. True when it was used. */
  function keyAct(key) {
    if (root.className === 'gone') return false;
    var list = slots();
    var n = list.length;
    if (asking) {
      if (key === 'Escape') { asking = 0; draw(); return true; }
      if (key === 'Enter') { forget(asking); return true; }
      return false;
    }
    if (key === 'ArrowDown') { at = n ? (at + 1) % n : 0; draw(); return true; }
    if (key === 'ArrowUp') { at = n ? (at + n - 1) % n : 0; draw(); return true; }
    if (key === 'Enter') { play(); return true; }
    if (key === 'Delete') {
      var e = list[at];
      if (e && e.c) { asking = e.id; draw(); }
      return true;
    }
    if (/^[1-9]$/.test(key)) {
      var k = Number(key) - 1;
      if (k < n) { at = k; draw(); return true; }
    }
    return false;
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', fit);

  // ----------------------------------------------------------------- music --
  var audio = null;
  if (LIST.music) {
    try {
      audio = document.createElement('audio');
      audio.src = String(LIST.music);
      audio.loop = true;
      audio.volume = 0.55;
      audio.preload = 'auto';
      document.body.appendChild(audio);
      var p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(function () { tell('music playing'); },
               function (err) {
                 tell('music refused: ' + (err && err.message ? err.message : err) + ', trying on the first key or click');
                 var once = function () {
                   try { audio.play(); } catch (e) { }
                   window.removeEventListener('keydown', once, true);
                   window.removeEventListener('mousedown', once, true);
                 };
                 window.addEventListener('keydown', once, true);
                 window.addEventListener('mousedown', once, true);
               });
      }
    } catch (e) { tell('music failed: ' + e); }
  }

  // -------------------------------------------------------------- witness --
  function seen() {
    var out = [];
    try { out.push('vis=' + document.visibilityState); } catch (e) { }
    try {
      var cs = window.getComputedStyle(elPanel);
      out.push('panel=' + cs.display + '/' + cs.opacity + '/' + cs.visibility + (elPanel.isConnected ? '' : '/detached'));
      var r = elPanel.getBoundingClientRect();
      var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.push('top=' + (top ? (top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (top.className && typeof top.className === 'string' ? '.' + top.className.replace(/\s+/g, '.') : '')) : 'nothing'));
    } catch (e) { out.push('err=' + e); }
    out.push('size=' + window.innerWidth + 'x' + window.innerHeight + ' scale=' + scale().toFixed(2));
    return out.join(' ');
  }
  var moved = false;
  window.addEventListener('mousemove', function (ev) {
    if (moved) return;
    moved = true;
    tell('mouse first moved at ' + ev.clientX + ',' + ev.clientY + ' ' + seen());
  }, true);
  // Every two seconds while the choice is up. The plugin reloads the page
  // after six seconds without one, which is how a page that dies under the
  // mouse comes back instead of leaving a blank menu.
  //
  // No fallback while the scroll is on, Djinn, 25 September: the client's
  // fallback to the last character is only for somebody who ticked "Start
  // without the scroll next time". With the scroll on, this page tells the
  // client ('thornswood', 'stay') on the first beat and every ten seconds
  // after, until a character is picked; from the first one the client never
  // falls back this session (the fork's AuthService). Repeated because the
  // page is up before the client listens. With the scroll off it stays quiet
  // and the three minute fallback works as before.
  //
  // And Continue's word with it. 'choosing' restarts the client's three
  // minutes from the moment the scroll is closed, and it was sent once, on
  // the click, into a client that may not have been listening yet. It goes on
  // the same ten seconds now, until a character is picked.
  var beats = 0;
  var beat = setInterval(function () {
    // Until the pick is taken, not until it is made: a person waiting in line
    // at the menu (#481) sits on this page for as long as the line takes.
    if (acked || root.className === 'gone') { clearInterval(beat); return; }
    tell('alive ' + seen());
    if (LIST.intro !== false && beats % 5 === 0) {
      try { window.skyrimPlatform.sendMessage('thornswood', 'stay'); } catch (e) { }
      if (introWent) {
        try { window.skyrimPlatform.sendMessage('thornswood', 'choosing'); } catch (e) { }
      }
    }
    beats++;
  }, 2000);

  window.thornswoodSelect = {
    play: play,
    acked: onAcked,
    // The front, once a second while this page is up: whether the game is the
    // window Windows is sending the keys to. See keysCount above.
    // And at once with the same n when the page asks 'select:keycheck <n>'.
    keys: keysSay,
    close: function () { root.className = 'gone'; },
    // The front's answer to 'select:want' (#481): a seat, or wait in line.
    go: go,
    line: lineSays
  };
  fit();
  draw();
  // The server ended the last session (#1157): what it said, over the slots.
  if (ended && elEnded) {
    elEnded.textContent = ended;
    elEnded.style.display = 'block';
    tell('ended: back at the choice after the server ended the session');
  }
  // Back from being away: straight into the place the server keeps (see chooseOther).
  if (away) {
    picked = Number(away.id);
    if (elAway) { elAway.textContent = AWAY_WORDS; elAway.style.display = 'block'; }
    if (elOtherRow) elOtherRow.style.display = 'flex';
    lineSays({ id: picked });
    tell('away: back at the choice in the place kept for profile ' + picked);
  }
  // When the page itself started, so the front log shows how long it sat
  // drawn but hidden before the plugins ran and showed the browser.
  var startedAt = '';
  try { startedAt = ' page started ' + new Date(performance.timeOrigin).toTimeString().slice(0, 8) + '.' + String(Math.floor(performance.timeOrigin % 1000)).padStart(3, '0'); } catch (e) { }
  tell('ready ' + slots().length + ' slots ' + seen() + startedAt);
})();
