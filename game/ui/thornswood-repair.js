'use strict';
/*
  The repair panel (#1384). Opened from the inventory: with a repair kit in
  the pack, the inventory shows a key, and that key asks the server, which
  answers with what is on this page.

  THE CONTRACT with thornswood-front.js and the server, the shape the board
  and the merchant panels use:

    window.thornswoodRepair = { open, close, isOpen, setData }
    page -> plugin  'repair:ready' | 'repair:opened' | 'repair:closed'
    page -> server  '/repair mend-name-v1 <base in hex> <condition> <encoded name>', through
                    window.thornswoodNet.say, the one line a button sends

  The server owns the pack, the kits and the numbers. This page only draws
  the rows the durability block worked out (view() in game/gamemode.js) and
  sends one row back. Nobody is told to type that line: no chat commands for
  what people do (Patrick, 4 October). setData with open set opens the
  panel; every later one redraws it.
*/
(function () {
  if (window.thornswoodRepair) { return; }

  var ID = 'ts-repair';
  var data = null;
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'repair:' + what); }
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
    THE LOOK IS THE NOTICE BOARD'S, which is the party panel's. Every colour
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
    '#' + ID + ' h2 .sub{font-size:14px;color:rgba(217,207,180,.6);font-style:italic}',
    '#' + ID + ' .body{overflow:auto;padding:16px 24px;display:block;font-size:16px}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:10px;align-items:center;justify-content:flex-end}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:160px;font-size:16px;line-height:1.35}',
    '#' + ID + ' .row .why{color:rgba(217,207,180,.6);font-style:italic;font-size:14px}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .none{color:rgba(217,207,180,.6);font-style:italic;padding:6px 2px}',
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
      '<div class="panel"><h2>Repair</h2><div class="body"></div>' +
      '<div class="foot"><button data-do="close">Close</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
    var foot = root.querySelector('.foot button');
    if (foot) { foot.onclick = function () { close(); }; }
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** Why a row has no button, in the words a person reads. */
  function why(row, kitsByKind) {
    var kit = kitsByKind[row.kind] || {};
    if (row.cond >= row.to) { return 'A repair by you would not raise it.'; }
    // Not your trade, or not its bench (#4578): the server says where it is mended.
    if (row.where) { return row.where; }
    if (!kit.made) { return 'No ' + row.kit + ' has been made in the world yet.'; }
    return 'You carry no ' + row.kit + '. ' + (/^[aeiou]/i.test(row.maker) ? 'An ' : 'A ') +
      row.maker + ' makes them.';
  }

  function draw() {
    if (!root) { return; }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var kits = (data && data.kits) || [];
    var rows = (data && data.rows) || [];
    var kitsByKind = {};
    var carried = [];
    for (var k = 0; k < kits.length; k++) {
      kitsByKind[kits[k].kind] = kits[k];
      if (kits[k].count > 0) { carried.push(plural(kits[k].count, kits[k].name)); }
    }
    title.innerHTML = 'Repair <span class="sub">' +
      esc(carried.length ? carried.join(', ') : 'no repair kit carried') + '</span>';
    var out = '';
    if (data && data.note) { out += '<div class="none">' + esc(data.note) + '</div>'; }
    if (!rows.length && !(data && data.note)) {
      out += '<div class="none">Everything you carry is at 100%.</div>';
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = esc(row.name) + ' <b>' + esc(row.cond) + '%</b>' +
        (row.count > 1 ? ' (' + esc(row.count) + ')' : '') + (row.worn ? ', worn' : '');
      out += '<div class="row"><span class="nm">' + label + '<br><span class="why">' +
        (row.can ? esc(row.kit + ', to ' + row.to + '%') : esc(why(row, kitsByKind))) +
        '</span></span>';
      if (row.can) {
        out += '<button class="go" data-n="' + i + '">Mend</button>';
      }
      out += '</div>';
    }
    // Who mends to what is the server's (repairTo, #3442): each row already
    // says the number, so the note does not say the rule again.
    out += '<div class="note">One kit mends one piece, by the trade that makes it, at the bench it is made at. ' +
      'Each row says what a repair by you comes out at.</div>';
    body.innerHTML = out;
    var buttons = body.querySelectorAll('button[data-n]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onMend; }
  }

  function onMend() {
    var row = ((data && data.rows) || [])[Number(this.getAttribute('data-n'))];
    if (!row) { return; }
    var encoded;
    try { encoded = encodeURIComponent(row.name); } catch (e) { encoded = ''; }
    // Keep the entire ASCII request below the transport's command limit.
    if (!encoded || encoded.length > 8000) {
      this.textContent = 'Cannot send this name';
      return;
    }
    this.disabled = true;
    if (!net('/repair mend-name-v1 ' + row.base + ' ' + row.cond + ' ' + encoded)) { this.disabled = false; }
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

  window.thornswoodRepair = {
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
