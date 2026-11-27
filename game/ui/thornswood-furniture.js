'use strict';
/*
  The furniture panel (#2679). Opened from the inventory: inside a building
  you may arrange (you hold it, or carry its deed or its master key), the
  inventory shows the lock key, Arrange furniture, and that key asks the
  server, which answers with what is on this page.

  THE CONTRACT with thornswood-front.js and the server, the repair panel's:

    window.thornswoodFurniture = { open, close, isOpen, setData }
    page -> plugin  'furniture:ready' | 'furniture:opened' | 'furniture:closed'
    page -> server  '/furniture place <key>', through window.thornswoodNet.say,
                    the one line a button sends

  The server owns the pack, the catalog (game/data/furniture.json) and every
  check. This page only draws the rows the furniture block worked out (view()
  in game/gamemode.js) and sends one row back. Place shuts the page so the
  piece can be seen in front of you; the server opens it again only to say
  why a piece was not set down. Moving and picking up are keys in the world,
  named on the line under the crosshair. Nobody is told to type anything.
*/
(function () {
  if (window.thornswoodFurniture) { return; }

  var ID = 'ts-furniture';
  var data = null;
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'furniture:' + what); }
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

  // The repair panel's look, which is the notice board's.
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
      '<div class="panel"><h2>Furniture</h2><div class="body"></div>' +
      '<div class="foot"><button data-do="close">Close</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
    var foot = root.querySelector('.foot button');
    if (foot) { foot.onclick = function () { close(); }; }
  }

  function draw() {
    if (!root) { return; }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var rows = (data && data.rows) || [];
    var where = data && data.n ? data.n : '';
    var count = data && data.cap ? (data.here + ' of ' + data.cap + ' pieces set down') : '';
    title.innerHTML = 'Furniture <span class="sub">' + esc([where, count].filter(Boolean).join(', ')) + '</span>';
    var out = '';
    if (data && data.why) { out += '<div class="none">' + esc(data.why) + '</div>'; }
    if (data && data.note) { out += '<div class="none">' + esc(data.note) + '</div>'; }
    var carried = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!(row.carried > 0)) { continue; }
      carried++;
      out += '<div class="row"><span class="nm">' + esc(row.name) +
        (row.carried > 1 ? ' (' + esc(row.carried) + ')' : '') + '</span>';
      if (!(data && data.why)) { out += '<button class="go" data-n="' + i + '">Place</button>'; }
      out += '</div>';
    }
    if (!carried) {
      out += '<div class="none">You carry no furniture. A Woodwright makes it at the woodworking bench, ' +
        'and anybody can trade it.</div>';
    }
    out += '<div class="note">Place sets the piece down in front of you, facing you. Look at a piece ' +
      'and the line under it names the keys to move it or pick it up; a chest is picked up empty.</div>';
    body.innerHTML = out;
    var buttons = body.querySelectorAll('button[data-n]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onPlace; }
  }

  function onPlace() {
    var row = ((data && data.rows) || [])[Number(this.getAttribute('data-n'))];
    if (!row) { return; }
    this.disabled = true;
    if (net('/furniture place ' + row.key)) { close(); }
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

  window.thornswoodFurniture = {
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
