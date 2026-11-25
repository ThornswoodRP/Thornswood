'use strict';
/*
  A market stall (#3160). The lock key at a stall sends /stall open; the
  server answers on thornswoodStallView, and setData with open draws this
  panel. open false, or walking away from the stall, closes it.

  THE CONTRACT with thornswood-front.js, the same shape the drop box uses:

    window.thornswoodStall = { open, close, isOpen, setData }
    page -> plugin  'stall:ready' | 'stall:opened' | 'stall:closed'
    page -> server  '/stall claim', '/stall lay <base> <nth> <count> gold <n>',
                    '/stall lay <base> <nth> <count> goods <base> <n>',
                    '/stall price <line> gold <n>' or '... goods <base> <n>',
                    '/stall back <line> <count>', '/stall buy <line> <count>',
                    '/stall find <words>', '/stall letgo', '/stall end',
                    '/stall close', through window.thornswoodNet.say; nobody
                    is told to type them (Patrick, 4 Oct: no chat commands
                    for what people do).

  WHAT IT SHOWS IS WHAT THE SERVER SENT. A free stall offers Claim. Its
  keeper lays out what they carry at a price, in gold or in goods, changes a
  price, takes goods back and lets the stall go. Anybody else sees the wares
  and buys while the keeper is there (Patrick, 22 Oct: a stall sells only
  while its keeper is there). A steward of the hold, or staff, also gets End
  this claim. The server decides who sees what; this page draws it.
*/
(function () {
  if (window.thornswoodStall) { return; }

  var ID = 'ts-stall';
  var data = null;
  var shown = false;
  var root = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'stall:' + what); }
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

  function num(s) { return String(s || '').replace(/[^0-9]/g, ''); }
  function hex(s) { return String(s || '').replace(/[^0-9a-fA-F]/g, ''); }

  /* THE LOOK IS THE DROP BOX'S, which is the notice board's. No :hover, no transitions. */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:680px;max-width:calc(100vw - 48px);height:640px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:-6px;box-shadow:0 24px 80px rgba(0,0,0,.7)}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22);display:flex;align-items:baseline;gap:14px}',
    '#' + ID + ' h2 .sub{font-size:14px;color:rgba(217,207,180,.6);font-style:italic}',
    '#' + ID + ' .body{overflow-y:auto;padding:6px 24px 18px;font-size:16px}',
    '#' + ID + ' .foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 24px;',
    '  border-top:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' h3{margin:16px 0 8px;padding-bottom:6px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);font-weight:normal;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:12px;padding:8px 10px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:160px;font-size:16px;line-height:1.35}',
    '#' + ID + ' .row .tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '#' + ID + ' .line{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' button[disabled]{opacity:.45;cursor:default}',
    '#' + ID + ' .none{color:rgba(217,207,180,.6);font-style:italic;padding:6px 2px}',
    '#' + ID + ' .note{color:rgba(217,207,180,.7);font-size:12.5px;line-height:1.5;margin-top:8px}',
    '#' + ID + ' .said{border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);padding:8px 10px;margin:10px 0}',
    '#' + ID + ' input{font-family:inherit;font-size:16px;color:#d9cfb4;background:rgba(0,0,0,.25);',
    '  border:1px solid rgba(198,170,109,.30);padding:6px 8px}',
    '#' + ID + ' input:focus,#' + ID + ' select:focus{outline:2px solid #e9d19b;outline-offset:2px}',
    '#' + ID + ' input.n{width:80px}',
    '#' + ID + ' input.find{flex:1;min-width:160px}',
    '#' + ID + ' select{font-family:inherit;font-size:16px;color:#d9cfb4;background:rgba(11,10,8,.94);',
    '  border:1px solid rgba(198,170,109,.30);padding:6px 8px;max-width:260px}',
    '#' + ID + ' ::-webkit-scrollbar{width:10px}',
    '#' + ID + ' ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#' + ID + ' ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    '  background-clip:padding-box;border-radius:6px}'
  ].join('\n');

  function build() {
    if (root) { return; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel"><h2>Market stall</h2><div class="body"></div>' +
      '<div class="foot"><button data-do="close">Close</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
    var foot = root.querySelector('.foot button');
    if (foot) { foot.onclick = function () { close(); }; }
  }

  function field(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  /* The price picker: gold, or one of the goods the find box turned up, with a number. */
  function pricePicker(prefix, found) {
    var opts = '<option value="gold">gold</option>';
    for (var i = 0; i < found.length; i++) {
      opts += '<option value="' + esc(found[i].base) + '">' + esc(found[i].name) + '</option>';
    }
    return '<input class="n" id="' + prefix + '-amt" aria-label="Price per item" placeholder="price">' +
      '<select id="' + prefix + '-kind">' + opts + '</select>';
  }
  function priceWords(prefix) {
    var amt = num(field(prefix + '-amt'));
    var kind = field(prefix + '-kind');
    if (!amt) { return ''; }
    if (!kind || kind === 'gold') { return 'gold ' + amt; }
    return 'goods ' + hex(kind) + ' ' + amt;
  }

  function draw() {
    if (!root) { return; }
    var kept = {};
    var inputs = root.querySelectorAll('input,select');
    for (var q = 0; q < inputs.length; q++) { if (inputs[q].id) { kept[inputs[q].id] = inputs[q].value; } }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var d = data || {};
    var sub = d.free ? 'nobody keeps it' : (d.mine ? 'your stall' : (d.keeperHere ? 'its keeper is here' : 'its keeper is away'));
    title.innerHTML = esc(d.place || 'Market stall') + ' <span class="sub">' + esc(sub) + '</span>';
    var out = '';
    if (d.said) { out += '<div class="said">' + esc(d.said) + '</div>'; }
    var lines = d.lines || [];

    if (d.free) {
      out += '<h3>A free stall</h3>';
      out += '<div class="line"><button class="go" data-do="claim">Claim this stall</button></div>';
      out += '<div class="note">Claiming costs nothing. You lay out what you sell and name each price, ' +
        'in gold or in goods, and the stall sells only while you are here.</div>';
    } else if (d.mine) {
      out += '<h3>On your stall (' + esc(String(lines.length)) + ' of ' + esc(String(d.max || 24)) + ' lines)</h3>';
      if (!lines.length) { out += '<div class="none">Nothing laid out.</div>'; }
      var found = d.found || [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var p = ID + '-p' + l.n;
        out += '<div class="row"><span class="nm">' + esc(l.count > 1 ? l.count + ' ' : '') + esc(l.what) +
          ', ' + esc(l.words) + ' a piece</span><span class="tools">' + pricePicker(p, found) +
          '<button data-do="price" data-n="' + esc(l.n) + '">Set price</button>' +
          '<input class="n" id="' + ID + '-back-' + esc(l.n) + '" aria-label="Count to take back" placeholder="' + (l.count > 1 ? 'all' : '1') + '">' +
          '<button data-do="back" data-n="' + esc(l.n) + '" data-all="' + esc(l.count) + '">Take back</button></span></div>';
      }
      out += '<h3>Lay out from your pack</h3>';
      var pack = d.pack || [];
      if (!pack.length) {
        out += '<div class="none">Nothing in your pack to lay out.</div>';
      } else {
        var opts = '';
        for (var k = 0; k < pack.length; k++) {
          opts += '<option value="' + esc(pack[k].base + ' ' + pack[k].nth) + '">' + esc(pack[k].what) +
            (pack[k].count > 1 ? ' (' + esc(pack[k].count) + ')' : '') + '</option>';
        }
        out += '<div class="line"><select id="' + ID + '-slot">' + opts + '</select>' +
          '<input class="n" id="' + ID + '-count" aria-label="Count to lay out" placeholder="1"></div>';
        out += '<div class="line">' + pricePicker(ID + '-lay', found) +
          '<span class="note">a piece</span><button class="go" data-do="lay">Lay it out</button></div>';
      }
      out += '<h3>Ask for goods instead of gold</h3>';
      out += '<div class="line"><input class="find" id="' + ID + '-find" aria-label="Goods wanted in return" placeholder="the name of what you want in return">' +
        '<button data-do="find">Find</button></div>';
      out += '<div class="note">What you find joins the list beside each price, so a piece can cost, say, 2 Iron Ingot ' +
        'instead of gold.</div>';
      out += '<h3>The stall</h3>';
      out += '<div class="line"><button data-do="letgo">Let the stall go</button></div>';
      out += '<div class="note">Your stall sells only while you are here. Being here keeps it yours; ' +
        'it lapses after ' + esc(String(d.lapseDays || 14)) + ' days away, and what is on it goes to the ' +
        'hold\'s drop box for you, as it does when you let it go.</div>';
    } else {
      out += '<h3>The wares</h3>';
      if (!lines.length) { out += '<div class="none">Nothing laid out.</div>'; }
      for (var j = 0; j < lines.length; j++) {
        var w = lines[j];
        out += '<div class="row"><span class="nm">' + esc(w.count > 1 ? w.count + ' ' : '') + esc(w.what) +
          ', ' + esc(w.words) + ' a piece</span><span class="tools">' +
          (w.count > 1 ? '<input class="n" id="' + ID + '-buy-' + esc(w.n) + '" aria-label="Count to buy" placeholder="1">' : '') +
          '<button class="go" data-do="buy" data-n="' + esc(w.n) + '"' + (d.keeperHere ? '' : ' disabled') + '>Buy</button>' +
          '</span></div>';
      }
      out += '<div class="note">' + (d.keeperHere
        ? 'You carry ' + esc(String(d.packGold || 0)) + ' gold. What you pay goes to the keeper.'
        : 'The keeper is not at the stall, so nothing is sold until they are.') + '</div>';
      if (d.officer) {
        out += '<h3>For the hold</h3>';
        out += '<div class="line"><button data-do="end">End this claim</button></div>';
        out += '<div class="note">The stall is free at once, and what is on it goes to the hold\'s drop box ' +
          'for its keeper.</div>';
      }
    }

    body.innerHTML = out;
    for (var key in kept) {
      if (!Object.prototype.hasOwnProperty.call(kept, key)) { continue; }
      var el = document.getElementById(key);
      if (el && kept[key]) { el.value = kept[key]; }
    }
    var buttons = body.querySelectorAll('button[data-do]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onDo; }
  }

  function onDo() {
    var verb = this.getAttribute('data-do');
    var n = num(this.getAttribute('data-n'));
    if (verb === 'claim' || verb === 'letgo' || verb === 'end') { net('/stall ' + verb); return; }
    if (verb === 'find') {
      var words = field(ID + '-find').replace(/\s+/g, ' ').trim();
      if (words) { net('/stall find ' + words); }
      return;
    }
    if (verb === 'lay') {
      var slot = field(ID + '-slot').split(' ');
      var count = num(field(ID + '-count')) || '1';
      var price = priceWords(ID + '-lay');
      if (slot.length === 2 && price) { net('/stall lay ' + hex(slot[0]) + ' ' + num(slot[1]) + ' ' + count + ' ' + price); }
      return;
    }
    if (verb === 'price' && n) {
      var pr = priceWords(ID + '-p' + n);
      if (pr) { net('/stall price ' + n + ' ' + pr); }
      return;
    }
    if (verb === 'back' && n) {
      var some = num(field(ID + '-back-' + n)) || this.getAttribute('data-all') || '1';
      net('/stall back ' + n + ' ' + num(some));
      return;
    }
    if (verb === 'buy' && n) {
      net('/stall buy ' + n + ' ' + (num(field(ID + '-buy-' + n)) || '1'));
    }
  }

  function open() {
    build();
    if (shown) { draw(); return; }
    shown = true;
    root.className = 'on';
    draw();
    tell('opened');
  }

  function close() {
    if (!shown) { return; }
    shown = false;
    if (root) { root.className = ''; }
    net('/stall close');
    tell('closed');
  }

  document.addEventListener('keydown', function (ev) {
    if (!shown) { return; }
    if (ev.key === 'Escape') { close(); }
  });

  window.thornswoodStall = {
    open: open,
    close: close,
    isOpen: function () { return shown; },
    setData: function (d) {
      data = d || null;
      if (!data || data.open === false) {
        if (shown) { shown = false; if (root) { root.className = ''; } tell('closed'); }
        return;
      }
      if (data.open) { open(); return; }
      if (shown) { draw(); }
    }
  };

  tell('ready');
})();
