'use strict';
/*
  The treatment panel (#1383). Opened two ways: from the inventory, where a
  key shows while you have a wound somebody could tend, and from the look
  prompt, where the same row shows on somebody else who has one. Either key
  asks the server, which answers with what is on this page.

  THE CONTRACT with thornswood-front.js and the server, the shape the repair
  panel uses:

    window.thornswoodTreat = { open, close, isOpen, setData }
    page -> plugin  'treat:ready' | 'treat:opened' | 'treat:closed'
    page -> server  '/treat <me or their form id> <cloth|bandage|splint|
                    poultice|remedy|set>', through window.thornswoodNet.say,
                    the one line a button sends

  The server owns the wounds, the pack and every rule (docs/systems/injury.md,
  plan() in the injury and disease block of game/gamemode.js). This page only
  draws the rows it worked out and sends one back. Nobody is told to type that
  line: no chat commands for what people do (Patrick, 4 October). setData with
  open set opens the panel; every later one redraws it.
*/
(function () {
  if (window.thornswoodTreat) { return; }

  var ID = 'ts-treat';
  var data = null;
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'treat:' + what); }
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
    below is one those panels already use. No :hover and no transitions.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:600px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);',
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
    '#' + ID + ' .wounds{margin-bottom:12px;line-height:1.5;color:#e0a98f}',
    '#' + ID + ' .said{margin-bottom:12px;line-height:1.45;color:#f6e9c8}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:160px;font-size:16px;line-height:1.35}',
    '#' + ID + ' .row .why{color:rgba(217,207,180,.7);font-style:italic;font-size:14px}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .none{color:rgba(217,207,180,.7);font-style:italic;padding:6px 2px}',
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
      '<div class="panel"><h2>Wounds</h2><div class="body"></div>' +
      '<div class="foot"><button data-do="close">Close</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
    var foot = root.querySelector('.foot button');
    if (foot) { foot.onclick = function () { close(); }; }
  }

  // What a row's button says: what doing it is called.
  var VERB = { cloth: 'Tear cloth', bandage: 'Bandage', splint: 'Splint', poultice: 'Apply',
               remedy: 'Give', set: 'Set' };

  function draw() {
    if (!root) { return; }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var rows = (data && data.rows) || [];
    var who = data && data.who ? String(data.who) : '';
    title.innerHTML = (who ? esc(who) + '\'s wounds' : 'Your wounds') +
      ' <span class="sub">' + esc(who ? 'within reach' : 'from your pack') + '</span>';
    var out = '';
    if (data && data.note) { out += '<div class="said">' + esc(data.note) + '</div>'; }
    var lines = (data && data.lines) || [];
    out += lines.length ? '<div class="wounds">' + lines.map(esc).join('<br>') + '</div>'
                        : '<div class="none">Nothing that shows.</div>';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var count = Number(row.count);
      var label = esc(row.name) + (count >= 0 ? ' <b>' + esc(count) + '</b>' : '');
      out += '<div class="row"><span class="nm">' + label +
        (row.can ? '' : '<br><span class="why">' + esc(row.why) + '</span>') + '</span>';
      if (row.can) {
        out += '<button class="go" data-n="' + i + '">' + esc(VERB[row.id] || 'Do it') + '</button>';
      }
      out += '</div>';
    }
    body.innerHTML = out;
    var buttons = body.querySelectorAll('button[data-n]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onDo; }
  }

  function onDo() {
    var row = ((data && data.rows) || [])[Number(this.getAttribute('data-n'))];
    if (!row || !data) { return; }
    this.disabled = true;
    net('/treat ' + (data.target || 'me') + ' ' + row.id);
  }

  function open() {
    build();
    draw();
    if (shown) { return; }
    shown = true;
    root.className = 'on';
    if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
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

  window.thornswoodTreat = {
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
