'use strict';
/*
  A warrior's maneuvers, page side (#1386).

  Patrick, 4 October: no chat commands for anything people do, so a maneuver
  is started from here and never typed. The maneuver key opens this panel
  (thornswood-front.js decides when it may), the rows are the ones the server
  says this character holds, and a number or a click starts one. Escape or the
  maneuver key closes it without starting anything.

  The server decides everything: whether the row is held, the wait, the
  stamina, who Cover is for. This sends the same internal line every pick
  sends, /maneuver <name>, through the chat's socket the way the trade and
  party panels send theirs, and the server's answer comes back in the chat.
  A row the view says is still waiting can be picked: the server answers how
  long is left.

  THE CONTRACT with thornswood-front.js:
    window.thornswoodManeuvers = { setRows(rows, keyName), toggle(), open(), close(), isOpen() }
    rows   [{ key, name, stamina, cooldown, ready }], the view's maneuvers
    page -> plugin  'maneuvers:ready' | 'maneuvers:opened' | 'maneuvers:closed'
                    'social:unavailable' when the chat's socket is not up
*/
(function () {
  if (window.thornswoodManeuvers) { return; }

  var ID = 'ts-maneuvers';
  var rows = [];
  var keyName = '';
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', what); } catch (e) { }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var CSS = [
    '#' + ID + '{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:2147483300;display:none;',
    '  min-width:360px;max-width:calc(100vw - 48px);padding:14px 18px 12px;background:rgba(11,10,8,.92);',
    '  border:1px solid rgba(198,170,109,.45);outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 18px 60px rgba(0,0,0,.7);font-family:"Palatino Linotype",Palatino,Georgia,serif;',
    '  color:#d9cfb4;user-select:none}',
    '#' + ID + '.on{display:block}',
    '#' + ID + ' .title{font-size:13px;letter-spacing:.38em;text-transform:uppercase;color:#c6aa6d;margin:0 0 8px}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:12px;padding:7px 8px;cursor:pointer;',
    '  width:100%;font-family:inherit;color:inherit;background:none;text-align:left;border-radius:0;',
    '  border:1px solid transparent;font-size:19px}',
    '#' + ID + ' .row:focus-visible{outline:2px solid #d9ab52;outline-offset:1px}',
    '#' + ID + ' .row:hover{border-color:rgba(198,170,109,.40);background:rgba(198,170,109,.08)}',
    '#' + ID + ' .key{display:inline-block;min-width:28px;text-align:center;border:2px solid rgba(217,171,82,.75);',
    '  border-radius:6px;padding:1px 6px;color:#d9ab52}',
    '#' + ID + ' .name{flex:1;color:#f6e9c8}',
    '#' + ID + ' .cost{color:rgba(217,207,180,.75);font-size:16px}',
    '#' + ID + ' .ready{color:#8fb85e;font-size:16px;min-width:64px;text-align:right}',
    '#' + ID + ' .wait{color:rgba(217,207,180,.55);font-size:16px;min-width:64px;text-align:right}',
    '#' + ID + ' .foot{margin-top:8px;font-size:14px;color:rgba(217,207,180,.6);font-style:italic}'
  ].join('\n');

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    document.body.appendChild(root);
    root.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== root && !el.getAttribute('data-n')) { el = el.parentNode; }
      if (!el || el === root) { return; }
      pick(Number(el.getAttribute('data-n')));
    });
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      var k = String(ev.key || '');
      if (k === 'Escape' || (keyName && k.toUpperCase() === keyName.toUpperCase())) {
        ev.preventDefault();
        close();
        return;
      }
      if (ev.target && ev.target.tagName === 'BUTTON' && (k === 'Enter' || k === ' ')) {
        if (ev.repeat) ev.preventDefault();
        return;
      }
      if (/^[1-9]$/.test(k)) {
        ev.preventDefault();
        pick(Number(k) - 1);
      }
    });
    return root;
  }

  // In place, so the focused control outlasts the update (#4475).
  function put(host, html, subject) {
    if (window.thornswoodDialog) { window.thornswoodDialog.patch(host, html, subject); } else { host.innerHTML = html; }
  }

  function draw() {
    build();
    var html = '<div class="title" id="' + ID + '-title">Maneuvers</div>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<button type="button" class="row" data-focus-key="' + esc(r.key) + '" data-n="' + i + '">' +
        '<span class="key">' + (i + 1) + '</span>' +
        '<span class="name">' + esc(r.name) + '</span>' +
        '<span class="cost">' + esc(r.stamina) + ' stamina</span>' +
        (r.ready ? '<span class="ready">ready</span>' : '<span class="wait">waiting</span>') +
        '</button>';
    }
    html += '<div class="foot">A number or a click starts one. ' +
      (keyName ? esc(keyName) + ' or ' : '') + 'Escape closes this.</div>';
    put(root, html);
  }

  function pick(n) {
    var r = rows[n];
    if (!r) { return; }
    var sent = false;
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) {
        window.thornswoodNet.say('/maneuver ' + r.key);
        sent = true;
      }
    } catch (e) { sent = false; }
    if (!sent) { tell('social:unavailable'); }
    close();
  }

  function open() {
    if (shown) return;
    if (!rows.length) { close(); return; }
    draw();
    root.className = 'on';
    if (!shown) {
      shown = true;
      if (window.thornswoodDialog) window.thornswoodDialog.open(root, root.querySelector('.title'));
      tell('maneuvers:opened');
    }
  }
  function close() {
    if (root) { root.className = ''; }
    if (shown) { shown = false; tell('maneuvers:closed'); }
  }
  function toggle() { if (shown) { close(); } else { open(); } }

  function setRows(next, name) {
    rows = Array.isArray(next) ? next.filter(function (r) { return r && r.key && r.name; }) : [];
    if (typeof name === 'string') { keyName = name; }
    if (!shown) { return; }
    if (!rows.length) { close(); return; }
    draw();
  }

  window.thornswoodManeuvers = {
    setRows: setRows, toggle: toggle, open: open, close: close,
    isOpen: function () { return shown; }
  };
  tell('maneuvers:ready');
})();
