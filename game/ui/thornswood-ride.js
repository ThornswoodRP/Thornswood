'use strict';
/*
  A carriage or ferry driver's stops and fares (#1635). Opened by pressing E
  on the driver: the front plugin tells the server which driver it was, and
  the server answers with what is on this page.

  THE CONTRACT with thornswood-front.js and the server, the shape the board,
  the merchant and the repair panels use:

    window.thornswoodRide = { open, close, isOpen, setData }
    page -> plugin  'ride:ready' | 'ride:wants' | 'ride:opened' | 'ride:closed'
    page -> server  '/ride <stop>', through window.thornswoodNet.say, the one
                    line a Ride button sends

  The server owns the route list, the fares, the pack and the ledger. This
  page only draws the stops the carriages block worked out (panelView in
  game/gamemode.js) and sends one back. Nobody is told to type that line:
  no chat commands for what people do (Patrick, 4 October).

  setData with open set asks the plugin for the panel ('ride:wants') rather
  than opening it, because the carriage mod's own conversation opens on the
  same press and the panel waits for it to close. The plugin opens it, and
  closes it when you walk away from the driver. A later setData redraws what
  is open: a refusal comes back as the same view with the server's line in
  it, and the panel stays. open false closes it.
*/
(function () {
  if (window.thornswoodRide) { return; }

  var ID = 'ts-ride';
  var data = null;
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'ride:' + what); }
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
    '#' + ID + ' .panel{width:560px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);',
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
    '#' + ID + ' .row .fare{color:#e9d19b;white-space:nowrap}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' button:disabled{opacity:.45}',
    '#' + ID + ' .said{color:#f6e9c8;padding:8px 12px;margin-bottom:12px;',
    '  border:1px solid rgba(198,170,109,.42);background:rgba(0,0,0,.30)}',
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
      '<div class="panel"><h2>Driver</h2><div class="body"></div>' +
      '<div class="foot"><button data-do="close">Step back</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
    var foot = root.querySelector('.foot button');
    if (foot) { foot.onclick = function () { close(); }; }
  }

  // In place, so the focused control outlasts the update (#4475).
  function put(host, html, subject) {
    if (window.thornswoodDialog) { window.thornswoodDialog.patch(host, html, subject); } else { host.innerHTML = html; }
  }

  function draw() {
    if (!root) { return; }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var d = data || {};
    title.innerHTML = esc(d.driver || 'Driver') +
      ' <span class="sub">' + esc((d.what || '') + (d.from ? ' from ' + d.from : '')) + '</span>';
    var out = '';
    if (d.note) { out += '<div class="said">' + esc(d.note) + '</div>'; }
    var stops = d.stops || [];
    if (!stops.length) { out += '<div class="none">This driver goes nowhere from here.</div>'; }
    for (var i = 0; i < stops.length; i++) {
      out += '<div class="row" data-row-key="' + esc(stops[i].name) + '"><span class="nm">' + esc(stops[i].name) + '</span>' +
        '<span class="fare">' + esc(stops[i].fare) + ' gold</span>' +
        '<button class="go" data-focus-key="' + esc(stops[i].name) + '" data-n="' + i + '">Ride</button></div>';
    }
    out += '<div class="note">The fare goes into ' + esc(d.ledger || 'the hold') + '\'s drop box. ' +
      'If the gold is not in your pack, you do not move and nothing is taken.</div>';
    put(body, out, d.driver || '');
    var buttons = body.querySelectorAll('button[data-n]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onRide; }
  }

  function onRide() {
    var stop = ((data && data.stops) || [])[Number(this.getAttribute('data-n'))];
    if (!stop) { return; }
    // One press, one ride. The server's answer draws the panel again.
    var buttons = root.querySelectorAll('button[data-n]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].disabled = true; }
    net('/ride ' + stop.name);
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

  window.thornswoodRide = {
    open: function () { if (data && data.open) { open(); } },
    close: close,
    isOpen: function () { return shown; },
    setData: function (d) {
      data = d || null;
      if (!data || !data.open) { close(); return; }
      if (shown) { draw(); return; }
      tell('wants');
    }
  };

  tell('ready');
})();
