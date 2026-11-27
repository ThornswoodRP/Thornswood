'use strict';
/*
  Every panel scales with the screen, and with one text size (#4474).

  The game's browser is the size of the screen, and every panel is a box laid
  out in CSS pixels for 1920 by 1080. On a bigger screen the box stayed that
  size, so at 2560 by 1440 the P panel, the notice board, a trade and the drop
  box filled a smaller share of it, and at 3840 by 2160 a quarter, while the
  skills panel and the journal had a fit() of their own that scaled them up
  (#958). There was no text size either: somebody who wanted the words bigger
  on any screen could not have them.

  So one rule for every panel, here, the one the skills and the journal
  already used: laid out for 1920 by 1080 and scaled by the smaller of the two
  ratios, never below 1 and never above 2.4, then times the text size chosen
  in the game's Settings (Thornswood.ini TextSize, a percent, which
  thornswood-front.js hands over as window.THORNSWOOD.textSize). A box is
  never scaled past what fits on the screen with 24 pixels to spare on each
  side, so a big text size on a small screen makes the panel as big as the
  screen allows and no bigger.

  WHAT IT SCALES. Each panel is a root of ours on <body>, its id ts-
  something, holding its box, .panel. The two panels that fit themselves,
  the skills panel and the journal (SELF_FIT), are left alone: their fit()
  asks scaleFor here, and fitAll calls it. The box is scaled with a
  transform about its centre, so its layout and its own max sizes are what
  they were; the root's flex centring keeps it in the middle.

  WHEN. When a root is added to <body>, when one is shown (its style, class
  or hidden changes), when the window changes size, and when the front hands
  over a new text size (thornswoodScale.settings, called from
  chatSettingsToPage). A hidden box has no size to measure, so it is fitted
  when it is shown.

  THE CONTRACT
    window.thornswoodScale = {
      screen(w, h)          the screen's ratio: min(w/1920, h/1080), from 1 to 2.4
      text()                the text size as a ratio, 1 when none was chosen
      scaleFor(w, h, bw, bh) the scale for a box bw by bh: screen times text,
                             capped to fit the screen, never below 1
      fit(panel)            scales one box now
      fitAll()              scales every box of ours now
      settings()            the front changed the text size: fitAll
    }
  game/tests/test-4474-panel-scale.js holds it.
*/
(function () {
  if (window.thornswoodScale) { return; }

  var BASE_W = 1920, BASE_H = 1080, MAX_SCALE = 2.4, EDGE = 24;
  // The Settings panel's choices, in percent; anything else is 100.
  var TEXT_CHOICES = [100, 115, 130, 150];
  // The roots whose own fit() scales them, by scaleFor below.
  var SELF_FIT = ['ts-skills', 'ts-journal'];

  function screen(w, h) {
    var s = Math.min(w / BASE_W, h / BASE_H);
    if (!isFinite(s) || s < 1) { s = 1; }
    return Math.min(s, MAX_SCALE);
  }

  function text() {
    var c = window.THORNSWOOD;
    var n = c ? Number(c.textSize) : 100;
    return (TEXT_CHOICES.indexOf(n) >= 0 ? n : 100) / 100;
  }

  function scaleFor(w, h, bw, bh) {
    var s = screen(w, h) * text();
    if (bw > 0) { s = Math.min(s, (w - 2 * EDGE) / bw); }
    if (bh > 0) { s = Math.min(s, (h - 2 * EDGE) / bh); }
    if (!isFinite(s) || s < 1) { s = 1; }
    return s;
  }

  function fit(panel) {
    try {
      var bw = panel.offsetWidth, bh = panel.offsetHeight;
      if (!bw || !bh) { return; }
      var s = scaleFor(window.innerWidth, window.innerHeight, bw, bh);
      panel.style.transformOrigin = 'center center';
      panel.style.transform = s === 1 ? '' : 'scale(' + s.toFixed(3) + ')';
    } catch (e) { }
  }

  function ours(el) {
    return !!(el && el.nodeType === 1 && el.parentNode === document.body &&
              /^ts-/.test(el.id || '') && SELF_FIT.indexOf(el.id) < 0);
  }

  function boxOf(root) {
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (/(^|\s)panel(\s|$)/.test(kids[i].className || '')) { return kids[i]; }
    }
    return null;
  }

  function fitRoot(root) {
    if (!ours(root)) { return; }
    var box = boxOf(root);
    if (box) { fit(box); }
  }

  function fitAll() {
    if (!document.body) { return; }
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) { fitRoot(kids[i]); }
    // The two panels that fit themselves ask scaleFor, so they hear it too.
    try { window.thornswoodSkills && window.thornswoodSkills.fit && window.thornswoodSkills.fit(); } catch (e) { }
    try { window.thornswoodJournal && window.thornswoodJournal.fit && window.thornswoodJournal.fit(); } catch (e2) { }
  }

  function watch() {
    if (!document.body || typeof MutationObserver === 'undefined') { return; }
    var shown = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { fitRoot(list[i].target); }
    });
    var watched = [];
    function follow(el) {
      if (!ours(el) || watched.indexOf(el) >= 0) { return; }
      watched.push(el);
      shown.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      fitRoot(el);
    }
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) { follow(kids[i]); }
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var added = list[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) { follow(added[j]); }
      }
    }).observe(document.body, { childList: true });
  }

  window.thornswoodScale = {
    screen: screen, text: text, scaleFor: scaleFor, fit: fit, fitAll: fitAll,
    settings: fitAll, BASE_W: BASE_W, BASE_H: BASE_H, MAX_SCALE: MAX_SCALE, TEXT_CHOICES: TEXT_CHOICES,
    SELF_FIT: SELF_FIT
  };
  window.addEventListener('resize', fitAll);
  if (document.body) { watch(); }
  else { document.addEventListener('DOMContentLoaded', watch); }
})();
