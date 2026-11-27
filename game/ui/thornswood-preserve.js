'use strict';
/*
  The preserving panel (#3163). Opened from the inventory: when you are a
  cook and carry raw food that spoils, the inventory shows a key, and that
  key asks the server, which answers with what is on this page.

  THE CONTRACT with thornswood-front.js and the server, the repair panel's
  shape:

    window.thornswoodPreserve = { open, close, isOpen, setData }
    page -> plugin  'preserve:ready' | 'preserve:opened' | 'preserve:closed'
    page -> server  '/preserve salt <base in hex> <days left> <name>' or
                    '/preserve smoke ...', through window.thornswoodNet.say,
                    the one line a button sends

  The server owns the pack, the salt, the firewood and the fire. This page
  only draws the rows the spoilage block worked out (view() in
  game/gamemode.js) and sends one row back. Nobody is told to type that
  line: no chat commands for what people do (Patrick, 4 October). setData
  with open set opens the panel; every later one redraws it.
*/
(function () {
  if (window.thornswoodPreserve) { return; }

  var ID = 'ts-preserve';
  var data = null;
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'preserve:' + what); }
    catch (e) { }
  }

  function net(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) {
        window.thornswoodNet.say(line);
        return true;
      }
    } catch (e) { }
    return false;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /*
    THE LOOK IS THE REPAIR PANEL'S, which is the notice board's. Every colour
    below is one that panel already uses. No :hover and no transitions.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:640px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);',
    '  display:grid;grid-template-rows:auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22);display:flex;align-items:baseline;gap:14px}',
    '#' + ID + ' h2 .sub{font-size:14px;color:rgba(217,207,180,.7);font-style:italic}',
    '#' + ID + ' .body{overflow:auto;padding:16px 24px;display:block;font-size:16px}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:10px;align-items:center;justify-content:flex-end}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:160px;font-size:16px;line-height:1.35}',
    '#' + ID + ' .row .why{color:rgba(217,207,180,.7);font-style:italic;font-size:14px}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .none{color:rgba(217,207,180,.7);font-style:italic;padding:6px 2px}',
    '#' + ID + ' .note{color:rgba(217,207,180,.7);font-size:12.5px;line-height:1.5;margin-top:8px}',
    '#' + ID + ' ::-webkit-scrollbar{width:10px;height:10px}',
    '#' + ID + ' ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#' + ID + ' ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    '  background-clip:padding-box;border-radius:6px}',
    '#' + ID + ' ::-webkit-scrollbar-corner{background:transparent}'
  ].join('\n');

  function build() {
    if (root) { return; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel"><h2>Preserve food</h2><div class="body"></div>' +
      '<div class="foot"><button data-do="close">Close</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
    var foot = root.querySelector('.foot button');
    if (foot) { foot.onclick = function () { close(); }; }
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function draw() {
    if (!root) { return; }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var d = data || {};
    var rows = d.rows || [];
    var per = Number(d.perWood) || 5;
    title.innerHTML = 'Preserve food <span class="sub">' +
      esc(plural(Number(d.salt) || 0, 'Salt Pile', 'Salt Piles') + ', ' +
          plural(Number(d.wood) || 0, 'Firewood', 'Firewood') +
          (d.fire ? ', at a fire' : ', no fire here')) + '</span>';
    var out = '';
    if (d.note) { out += '<div class="none">' + esc(d.note) + '</div>'; }
    if (!d.may && !d.note) {
      out += '<div class="none">Salting and smoking food is a cook\'s work. A Hearthcook or a ' +
        'Confectioner can preserve it for you.</div>';
    }
    if (d.may && !rows.length && !d.note) {
      out += '<div class="none">You carry no raw food that spoils.</div>';
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = esc(row.name) + (row.count > 1 ? ' (' + esc(row.count) + ')' : '') +
        ' <b>' + esc(plural(Number(row.left) || 0, 'day', 'days')) + ' left</b>';
      var whys = [];
      if (!(d.salt > 0)) { whys.push('Salting takes a Salt Pile a piece.'); }
      if (!d.fire) { whys.push('Smoking takes a lit fire.'); }
      else if (!(d.wood > 0)) { whys.push('Smoking takes one Firewood for every ' + per + ' pieces.'); }
      out += '<div class="row"><span class="nm">' + label +
        (whys.length ? '<br><span class="why">' + esc(whys.join(' ')) + '</span>' : '') + '</span>';
      if (d.may && d.salt > 0) {
        out += '<button class="go" data-do="salt" data-n="' + i + '">Salt</button>';
      }
      if (d.may && d.fire && d.wood > 0) {
        out += '<button class="go" data-do="smoke" data-n="' + i + '">Smoke</button>';
      }
      out += '</div>';
    }
    out += '<div class="note">Raw meat and fish keep 7 days, a dish 14. Salted or smoked food never ' +
      'spoils. Salting takes a Salt Pile a piece; smoking takes a lit fire and one Firewood for every ' +
      per + ' pieces. A press preserves as much of the stack as you carry salt or firewood for.</div>';
    body.innerHTML = out;
    var buttons = body.querySelectorAll('button[data-n]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onPreserve; }
  }

  function onPreserve() {
    var row = ((data && data.rows) || [])[Number(this.getAttribute('data-n'))];
    var how = this.getAttribute('data-do');
    if (!row || (how !== 'salt' && how !== 'smoke')) { return; }
    this.disabled = true;
    net('/preserve ' + how + ' ' + row.base + ' ' + row.left + ' ' + row.name);
  }

  function open() {
    build();
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

  document.addEventListener('keydown', function (ev) {
    if (!shown) { return; }
    if (ev.key === 'Escape') { close(); }
  });

  window.thornswoodPreserve = {
    open: open,
    close: close,
    isOpen: function () { return shown; },
    setData: function (d) {
      data = d || null;
      if (data && data.open) { open(); return; }
      if (shown) { draw(); }
    }
  };

  tell('ready');
})();
