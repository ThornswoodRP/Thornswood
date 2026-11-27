'use strict';
/*
  The emote wheel, as an overlay inside the front rather than a page of its own.

  The wheel stays in the dead middle of the screen. The middle of it is
  eight quick slots. Click one to play it, or press its number, 1 to 8,
  while the wheel is open. With the wheel shut the number keys are Skyrim's
  own favourites hotkeys and play no emote. On the right, beside
  it, is a search and every emote, in alphabetical order. Click a name to
  play it. Click a slot number under the search, then a name, to put that
  emote on the slot.

  The page draws and reports. Which animation a name means, and playing it,
  belong to the plugin.

  THE CONTRACT with thornswood-front.js:
    window.thornswoodEmotes = { close() }
    page -> plugin  '__close' (and the rest of the __ messages)
    The two-minute cap calls close() by that name. close() sends __close so
    the plugin's open follows (#1918). Hide-only is not close:
    thornswoodHideWheel is what the plugin uses after it has already set
    open false.
*/

(function () {
  if (window.thornswoodSetWheel) return;

  var items = [];
  var slots = [];
  var pin = 0;
  var query = '';
  var standChar = 'n';

  var css = [
    '#thornswood-wheel{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;',
    'background:radial-gradient(ellipse at center,rgba(0,0,0,.28) 0%,rgba(0,0,0,.55) 100%);',
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4;user-select:none}',
    '#thornswood-wheel.gone{display:none}',
    '#thornswood-wheel .wheelwrap{position:absolute;left:50%;top:50%;width:520px;height:520px;',
    'margin:0;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center}',
    '#thornswood-wheel svg{overflow:visible;font-family:"Palatino Linotype",Palatino,Georgia,serif}',
    '#thornswood-wheel .seg{fill:rgba(14,13,11,.72);stroke:rgba(198,170,109,.28);stroke-width:1}',
    '#thornswood-wheel .seg.hot{fill:rgba(120,94,44,.88);stroke:rgba(233,209,155,.9)}',
    '#thornswood-wheel .label{fill:#f6e9c8;font-family:"Palatino Linotype",Palatino,Georgia,serif;',
    'font-size:13px;text-anchor:middle;dominant-baseline:middle;pointer-events:none}',
    '#thornswood-wheel .num{fill:rgba(198,170,109,.85);font-family:"Palatino Linotype",Palatino,Georgia,serif;',
    'font-size:12px;text-anchor:middle;dominant-baseline:middle;pointer-events:none}',
    '#thornswood-hub{fill:rgba(14,13,11,.86);stroke:rgba(198,170,109,.45);stroke-width:1.5}',
    '#thornswood-hub.hot{fill:rgba(120,44,44,.9);stroke:rgba(233,170,155,.9)}',
    '#thornswood-hubtext{fill:#c6aa6d;font-family:"Palatino Linotype",Palatino,Georgia,serif;',
    'font-size:13px;text-anchor:middle;dominant-baseline:middle;pointer-events:none;letter-spacing:.12em}',
    '#thornswood-wheel .side{position:absolute;top:50%;right:36px;transform:translateY(-50%);',
    'width:300px;height:520px;max-height:calc(100% - 48px);box-sizing:border-box;',
    'display:flex;flex-direction:column;padding:16px 16px 12px;overflow:hidden;',
    'background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    'outline:1px solid rgba(198,170,109,.14);outline-offset:4px;box-shadow:0 24px 80px rgba(0,0,0,.7)}',
    '#thornswood-wheel .side input{box-sizing:border-box;font-family:inherit;font-size:16px;line-height:22px;',
    'color:#f6e9c8;background:rgba(0,0,0,.35);border:1px solid rgba(198,170,109,.42);',
    'padding:8px 10px;width:100%;margin:0 0 10px}',
    '#thornswood-wheel .side input:focus{border-color:rgba(198,170,109,.55)}',
    '#thornswood-wheel .pins{display:flex;gap:4px;margin-bottom:10px}',
    '#thornswood-wheel .pins button,#thornswood-wheel .row button{box-sizing:border-box;font-family:inherit;cursor:pointer;',
    'border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    'padding:0;width:28px;height:28px;font-size:14px}',
    '#thornswood-wheel .pins button.on,#thornswood-wheel button.go,#thornswood-wheel .row .nm:focus{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#thornswood-wheel .rows{overflow:auto;flex:1;min-height:0;border-top:1px solid rgba(198,170,109,.22);padding-top:8px}',
    '#thornswood-wheel .row{display:flex;align-items:center;margin-bottom:4px;',
    'border-bottom:1px solid rgba(198,170,109,.14)}',
    '#thornswood-wheel .row .nm{flex:1;width:auto;height:auto;text-align:left;font-size:16px;',
    'text-transform:none;color:#f6e9c8;padding:7px 8px}',
    '#thornswood-wheel .none{color:rgba(217,207,180,.7);font-style:italic;padding:8px 2px}',
    '#thornswood-wheel ::-webkit-scrollbar{width:10px;height:10px}',
    '#thornswood-wheel ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#thornswood-wheel ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    'background-clip:padding-box;border-radius:6px}'
  ].join('');

  var style = document.createElement('style');
  style.id = 'thornswood-wheel-css';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  try {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  } catch (e) { }

  var SVGNS = 'http://www.w3.org/2000/svg';
  var host = document.createElement('div');
  host.id = 'thornswood-wheel';
  host.className = 'gone';
  host.innerHTML =
    '<div class="wheelwrap">' +
    '<svg width="500" height="500" viewBox="-250 -250 500 500" aria-label="Emote wheel">' +
    '<g id="thornswood-segments"></g>' +
    '<circle id="thornswood-hub" cx="0" cy="0" r="46"></circle>' +
    '<text id="thornswood-hubtext" x="0" y="1" font-family="Palatino Linotype, Palatino, Georgia, serif" font-size="13">STOP</text>' +
    '</svg></div>' +
    '<div class="side">' +
    '<input id="thornswood-emote-find" placeholder="Search" aria-label="Search emotes" autocomplete="off">' +
    '<div class="pins" id="thornswood-emote-pins"></div>' +
    '<div class="rows" id="thornswood-emote-rows"></div>' +
    '</div>';
  document.body.appendChild(host);

  var segs = document.getElementById('thornswood-segments');
  var hub = document.getElementById('thornswood-hub');
  var find = document.getElementById('thornswood-emote-find');
  var pins = document.getElementById('thornswood-emote-pins');
  var rows = document.getElementById('thornswood-emote-rows');

  var R_IN = 78, R_OUT = 210, R_LABEL = 148;

  function polar(r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  }

  function wedge(from, to) {
    var a = polar(R_OUT, from), b = polar(R_OUT, to);
    var c = polar(R_IN, to), d = polar(R_IN, from);
    var big = (to - from) > 180 ? 1 : 0;
    return 'M' + a[0] + ',' + a[1] +
           'A' + R_OUT + ',' + R_OUT + ' 0 ' + big + ' 1 ' + b[0] + ',' + b[1] +
           'L' + c[0] + ',' + c[1] +
           'A' + R_IN + ',' + R_IN + ' 0 ' + big + ' 0 ' + d[0] + ',' + d[1] + 'Z';
  }

  function say(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-emote', what); }
    catch (e) { try { console.log('[emotes] sendMessage failed: ' + e); } catch (e2) { } }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function open() { return host.className.indexOf('gone') === -1; }

  function searching() {
    return document.activeElement === find;
  }

  function drawSlots() {
    while (segs.firstChild) segs.removeChild(segs.firstChild);
    var n = slots.length || 8;
    var step = 360 / n;
    for (var i = 0; i < n; i++) {
      (function (i) {
        var from = i * step - step / 2;
        var to = from + step;
        var path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('class', 'seg');
        path.setAttribute('d', wedge(from, to));
        var mid = polar(R_LABEL, from + step / 2);
        var label = document.createElementNS(SVGNS, 'text');
        label.setAttribute('class', 'label');
        label.setAttribute('x', mid[0]);
        label.setAttribute('y', mid[1] - 8);
        label.textContent = slots[i] || '';
        label.setAttribute('font-family', 'Palatino Linotype, Palatino, Georgia, serif');
        label.setAttribute('font-size', '13');
        var num = document.createElementNS(SVGNS, 'text');
        num.setAttribute('class', 'num');
        num.setAttribute('font-family', 'Palatino Linotype, Palatino, Georgia, serif');
        num.setAttribute('font-size', '11');
        num.setAttribute('x', mid[0]);
        num.setAttribute('y', mid[1] + 14);
        num.textContent = String(i + 1);
        function hot(on) { path.setAttribute('class', on ? 'seg hot' : 'seg'); }
        path.addEventListener('mouseenter', function () { hot(true); });
        path.addEventListener('mouseleave', function () { hot(false); });
        path.addEventListener('click', function () {
          if (slots[i]) { say('__slot ' + (i + 1)); }
        });
        segs.appendChild(path);
        segs.appendChild(label);
        segs.appendChild(num);
      })(i);
    }
  }

  function drawPins() {
    var buttons = pins.querySelectorAll('button');
    if (buttons.length !== (slots.length || 8)) {
      var html = '';
      for (var i = 0; i < (slots.length || 8); i++) {
        html += '<button data-pin="' + (i + 1) + '" aria-label="Assign to slot ' + (i + 1) + '">' +
                (i + 1) + '</button>';
      }
      pins.innerHTML = html;
      buttons = pins.querySelectorAll('button');
    }
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].className = pin === b + 1 ? 'on' : '';
      buttons[b].setAttribute('aria-pressed', pin === b + 1 ? 'true' : 'false');
      buttons[b].onclick = function () {
        var n = Number(this.getAttribute('data-pin'));
        pin = pin === n ? 0 : n;
        drawPins();
      };
    }
  }

  function drawRows() {
    var low = query.toLowerCase();
    var list = items.filter(function (it) {
      return !low || it.name.toLowerCase().indexOf(low) !== -1;
    });
    if (!list.length) {
      rows.innerHTML = '<div class="none">No emote by that name.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<div class="row"><button class="nm" data-play="' + esc(list[i].name) + '">' +
              esc(list[i].name) + '</button></div>';
    }
    rows.innerHTML = html;
    var buttons = rows.querySelectorAll('button[data-play]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].onclick = function () {
        var name = this.getAttribute('data-play');
        if (pin) {
          slots[pin - 1] = name;
          say('__assign ' + pin + ' ' + name);
          drawSlots();
          return;
        }
        say('__play ' + name);
      };
    }
  }

  find.oninput = function () { query = find.value; drawRows(); };
  find.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  hub.addEventListener('mouseenter', function () { hub.setAttribute('class', 'hot'); });
  hub.addEventListener('mouseleave', function () { hub.setAttribute('class', ''); });
  hub.addEventListener('click', function () { say('__hub'); });

  host.addEventListener('mousedown', function (e) {
    if (e.target === host) { say('__close'); }
  });

  document.addEventListener('contextmenu', function (e) {
    if (!open()) return;
    e.preventDefault();
  });

  // The wheel key's letter, G unless it is bound elsewhere, and CloseKey's
  // letter when CloseKey is bound to one. Escape closes the wheel whatever
  // CloseKey is, the way it closes every panel here.
  var closeChar = 'g';
  var closeKeyLetter = '';

  /*
    G and Escape close the wheel here, and the page says so with __close.
    The plugin decides, the same as for a click outside the wheel (#1852).

    While the wheel is up it holds the keyboard and only this page hears a
    key: the fork hands the game, and so every plugin's buttonEvent, no key
    down while the browser has focus (the note over LETTERS in
    game/plugins/thornswood-emotes.js has the code path). The plugin's own G
    and Escape wait for a press that does not come while the wheel is up,
    and every other panel here answers its own Escape for the same reason.

    The tap that opens the wheel cannot also close it. The fork reads the
    whole keyboard on every input read, whoever has focus, and hands this
    page a change only, and only while the browser has focus
    (ProcessKeyboardData in DInputHook.cpp, OnKeyStateChange in main.cpp).
    That read is made in the same call that hands the game G going down, or
    an earlier one, so before the plugin hears G and the wheel takes the
    keyboard, G is already down in it (or a tap that quick was missed by it
    altogether). This page hears at most G coming up.
    tests/test-1852-wheel-keys.js plays it through. In the search, G is a
    letter of the name and Escape still closes.
  */
  document.addEventListener('keydown', function (e) {
    if (!open()) return;
    var k = e.key || '';
    // Repeating navigation is useful; repeating an activation must not play
    // or assign another emote. Ordinary search text still belongs to the input.
    if (searching() && k !== 'Escape' && k !== 'Tab' && k !== 'Enter' &&
        k !== 'ArrowDown' && k !== 'ArrowUp') { return; }
    if (e.repeat && k !== 'Tab' && k.indexOf('Arrow') !== 0) { e.preventDefault(); return; }
    if (k === 'Escape' || e.keyCode === 27) { e.preventDefault(); say('__close'); return; }
    if (k === 'Tab' || e.keyCode === 9) {
      // Keep native traversal through every control. Only entering the wheel
      // or crossing its ends needs an explicit focus move.
      var controls = host.querySelectorAll('input,button,[tabindex="0"]');
      var at = Array.prototype.indexOf.call(controls, document.activeElement);
      if (at < 0 || (!e.shiftKey && at === controls.length - 1) || (e.shiftKey && at === 0)) {
        e.preventDefault();
        controls[e.shiftKey ? controls.length - 1 : 0].focus();
      }
      return;
    }
    var pinButtons = pins.querySelectorAll('button');
    var rowButtons = rows.querySelectorAll('button[data-play]');
    var pinAt = Array.prototype.indexOf.call(pinButtons, document.activeElement);
    var rowAt = Array.prototype.indexOf.call(rowButtons, document.activeElement);
    if (searching() && k === 'Enter') {
      e.preventDefault();
      if (rowButtons.length) { rowButtons[0].click(); }
      return;
    }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && pinAt >= 0) {
      e.preventDefault();
      var nextPin = Math.max(0, Math.min(pinButtons.length - 1, pinAt + (k === 'ArrowLeft' ? -1 : 1)));
      pinButtons[nextPin].focus();
      return;
    }
    if ((k === 'ArrowDown' || k === 'ArrowUp') && (searching() || pinAt >= 0 || rowAt >= 0)) {
      e.preventDefault();
      if (k === 'ArrowUp' && (pinAt >= 0 || rowAt === 0)) { find.focus(); }
      else if (rowButtons.length) {
        var nextRow = rowAt < 0 ? (k === 'ArrowUp' ? rowButtons.length - 1 : 0) :
                      Math.max(0, Math.min(rowButtons.length - 1, rowAt + (k === 'ArrowUp' ? -1 : 1)));
        rowButtons[nextRow].focus();
      }
      return;
    }
    if (!searching() && standChar && k.toLowerCase() === standChar) {
      e.preventDefault();
      say('__stand');
      return;
    }
    if ((closeChar && k.toLowerCase() === closeChar) ||
        (closeKeyLetter && k.toLowerCase() === closeKeyLetter)) {
      e.preventDefault();
      say('__close');
      return;
    }
    if (k >= '1' && k <= '8') {
      e.preventDefault();
      say('__slot ' + k);
    }
  }, true);

  window.thornswoodSetWheel = function (list, slotNames, closeKeyChar, stopKeyChar, closeLetter) {
    items = (list || []).slice().sort(function (a, b) {
      return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1;
    });
    slots = (slotNames || []).slice();
    while (slots.length < 8) { slots.push(''); }
    // An empty letter is a wheel key that is not a letter. It leaves no
    // letter to close on, rather than a G that would close a wheel G does
    // not open.
    if (typeof closeKeyChar === 'string') {
      closeChar = closeKeyChar.toLowerCase();
    }
    if (typeof closeLetter === 'string') {
      closeKeyLetter = closeLetter.toLowerCase();
    }
    if (typeof stopKeyChar === 'string' && stopKeyChar) {
      standChar = stopKeyChar.toLowerCase();
    }
    host.className = '';
    query = '';
    find.value = '';
    pin = 0;
    drawSlots();
    drawPins();
    drawRows();
  };

  // Older callers. The wheel no longer has a second ring, so a list handed
  // this way is the emote list and the slots stay as they are.
  window.thornswoodSetRing = function (list, title, hubWord, hint, closeKeyChar) {
    window.thornswoodSetWheel(list, slots.length ? slots : [], closeKeyChar);
    if (hubWord) {
      var word = document.getElementById('thornswood-hubtext');
      if (word) { word.textContent = hubWord; }
    }
  };

  window.thornswoodHideWheel = function () {
    host.className = 'gone';
    pin = 0;
    try { find.blur(); } catch (e) { }
  };

  // The front's cap looks up this name in CAP_CLOSES and calls close().
  // Sending __close is the close: the plugin sets open false, hides the
  // wheel, and gives the keyboard back. Calling HideWheel here would leave
  // the plugin thinking the wheel is still up, so the next G would shut a
  // wheel nobody can see and the stop key would not stand you up.
  window.thornswoodEmotes = {
    close: function () { say('__close'); }
  };

  say('__ready');
})();
