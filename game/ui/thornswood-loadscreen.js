'use strict';
/*
  The loading screen (#3130): Thornswood's animated backdrop and one of its
  own hints, over every load, in place of Skyrim's model and Skyrim's hint.

  Patrick's ask: "replace the vanilla in-game loading screens with our same
  animated backdrop, and replace the vanilla hints with real Thornswood
  hints", and on 22 Oct: "it doesn't need to load the still photo first".

  WHY IN THE PAGE, AND WHY IT WORKS NOW. Djinn's first try (22 Oct, pulled)
  put the backdrop up from the plugin when the plugin heard the Loading Menu
  open. The plugin hears menus from the game's update, and no update runs
  while the game loads, so on dev the open and the close came together after
  the load was over and the backdrop flashed once. The engine now tells the
  page itself, from the game's own menu event on the game's thread, as the
  Loading Menu opens and closes, and draws the page while it is open
  (ThornswoodRP/skymp, LoadingScreen.h):

      window event 'skyrimPlatform:loading'  detail.loading true or false
      window.skyrimPlatformLoading           the same answer, for a page
                                             that comes up mid load

  The page is drawn from the swap chain's Present and the browser runs on
  its own threads, so the loop keeps playing through the load.

  WHAT IT SHOWS. The loop the main menu plays, thornswood-menu.webm (or .mp4,
  the launcher's own rule in Chars.cs), loaded and paused when the page comes
  up so its first frame is ready before any load. No still under it: until
  the first frame is decoded the screen is the page's dark colour, never a
  picture that the loop then replaces. Over it, low down, one hint from
  window.THORNSWOOD_HINTS, which Go.ps1 writes into thornswood-hints.js from
  site/data/site/lines.md, the one copy of the hints (#3147). Never the same
  hint twice running.

  WHEN. Up when the load starts, down when it ends. Not while the character
  choice is up: that page already shows the painting, and it is how
  somebody picks, so a load under it (the game's own at the main menu) stays
  under it. If the choice goes while the load is still on, this comes up then.

  THE RECORD. 'load:up' and 'load:down' to thornswood-front.js, with this
  page's own clock and how far the loop played, because they are sent during
  the load and reach the plugin's log only after it.

  Plain like the choice page: no transitions, no hover, nothing to click
  (pointer-events none), and nothing calls loadUrl.
*/
(function () {
  if (window.thornswoodLoadscreen) { return; }

  var ID = 'ts-load';
  var root = null, elHint = null, vid = null;
  var up = false, waiting = false, upAt = 0, playedFrom = 0, lastHint = -1;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'load:' + what); } catch (e) { }
  }

  function hints() {
    var h = window.THORNSWOOD_HINTS;
    return Array.isArray(h) ? h.filter(function (s) { return typeof s === 'string' && s; }) : [];
  }

  // A hint at random, never the one shown last.
  function pickHint() {
    var h = hints();
    if (!h.length) { return ''; }
    var i = Math.floor(Math.random() * h.length);
    if (h.length > 1 && i === lastHint) { i = (i + 1) % h.length; }
    lastHint = i;
    return h[i];
  }

  function choiceUp() {
    var s = document.getElementById('ts-select');
    return !!(s && s.className !== 'gone');
  }

  function mount() {
    if (root) { return; }
    var css = document.createElement('style');
    css.textContent = [
      '#' + ID + '{position:fixed;inset:0;z-index:2147483647;display:none;background:#0b0907;',
      'pointer-events:none;user-select:none;overflow:hidden;',
      'font-family:"Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;color:#e4d9bf}',
      '#' + ID + '.up{display:block}',
      '#' + ID + ' video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '#' + ID + ' .shade{position:absolute;left:0;right:0;bottom:0;height:34%;',
      'background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,.72) 100%)}',
      '#' + ID + ' .hint{position:absolute;left:50%;bottom:7%;transform:translateX(-50%);width:min(1100px,84vw);',
      'text-align:center;font-size:clamp(18px,1.6vw,30px);line-height:1.4;',
      'text-shadow:0 2px 6px rgba(0,0,0,.9),0 0 18px rgba(0,0,0,.7)}',
      '#' + ID + ' .hint:empty{display:none}'
    ].join('');
    (document.head || document.documentElement).appendChild(css);

    root = document.createElement('div');
    root.id = ID;
    root.setAttribute('aria-hidden', 'true');

    vid = document.createElement('video');
    vid.muted = true; vid.loop = true; vid.autoplay = false;
    vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
    vid.preload = 'auto';
    var tried = 0;
    vid.onerror = function () {
      // The launcher's rule: the webm, else the mp4. With neither, the
      // screen stays the dark colour with the hint on it.
      if (tried === 0) { tried = 1; vid.src = 'thornswood-menu.mp4'; return; }
      try { vid.remove(); } catch (e) { }
      vid = null;
      tell('no loop plays here, the hint stays on the dark');
    };
    vid.src = 'thornswood-menu.webm';
    root.appendChild(vid);

    var shade = document.createElement('div');
    shade.className = 'shade';
    root.appendChild(shade);

    elHint = document.createElement('div');
    elHint.className = 'hint';
    root.appendChild(elHint);

    (document.body || document.documentElement).appendChild(root);
  }

  function show() {
    mount();
    if (up) { return; }
    if (choiceUp()) { waiting = true; return; }
    waiting = false;
    up = true;
    upAt = Date.now();
    elHint.textContent = pickHint();
    // Last in the page, so it is over every overlay of the same z-index.
    try { root.parentNode.appendChild(root); } catch (e) { }
    root.className = 'up';
    playedFrom = vid ? vid.currentTime : 0;
    if (vid) {
      try {
        var p = vid.play();
        if (p && typeof p.catch === 'function') { p.catch(function () { }); }
      } catch (e) { }
    }
    tell('up at ' + upAt);
  }

  function hide() {
    waiting = false;
    if (!up) { return; }
    up = false;
    if (root) { root.className = ''; }
    var played = 0;
    if (vid) {
      played = vid.currentTime - playedFrom;
      if (played < 0 && vid.duration) { played += vid.duration; }
      try { vid.pause(); } catch (e) { }
    }
    var now = Date.now();
    tell('down at ' + now + ', up ' + (now - upAt) + ' ms, the loop played ' + played.toFixed(2) + ' s');
  }

  function onLoading(loading) {
    if (loading) { show(); } else { hide(); }
  }

  window.addEventListener('skyrimPlatform:loading', function (e) {
    onLoading(!!(e && e.detail && e.detail.loading));
  });

  // The choice going while a load is still on brings this up then.
  function watchChoice() {
    var s = document.getElementById('ts-select');
    if (!s || typeof MutationObserver !== 'function') { return; }
    new MutationObserver(function () {
      if (waiting && !choiceUp() && window.skyrimPlatformLoading === true) { show(); }
    }).observe(s, { attributes: true, attributeFilter: ['class'] });
  }

  function start() {
    mount();
    watchChoice();
    if (window.skyrimPlatformLoading === true) { show(); }
  }

  window.thornswoodLoadscreen = {
    isUp: function () { return up; },
    hint: function () { return elHint ? elHint.textContent : ''; }
  };

  if (document.body) { start(); }
  else { document.addEventListener('DOMContentLoaded', start); }
})();
