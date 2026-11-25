'use strict';
/*
  The hold's drop box, on the shelf on its notice board's right post (#2298).
  E on the box sends /dropbox open; the server answers on thornswoodBoxView,
  and setData with open draws this panel. open false, or walking away from
  the board, closes it.

  THE CONTRACT with thornswood-front.js, the same shape the ride panel uses:

    window.thornswoodBox = { open, close, isOpen, setData }
    page -> plugin  'box:ready' | 'box:opened' | 'box:closed'
    page -> server  '/dropbox gold <amount>', '/dropbox leave <slot> <count> <name>',
                    '/dropbox take <n> [count]', '/dropbox records', through
                    window.thornswoodNet.say; nobody is told to type them
                    (Patrick, 4 Oct: no chat commands for what people do).

  WHAT IT SHOWS IS WHAT THE SERVER SENT. Patrick, 12 Oct: a person sees only
  what they put in, gold too, and only the hold's officers see everything and
  get Records. The server filters; this page draws the rows it is given and
  never works out who may see what.
*/
(function () {
  if (window.thornswoodBox) { return; }

  var ID = 'ts-box';
  var data = null;
  var shown = false;
  var root = null;
  var showRecords = false;
  var goldPending = null;
  var goldNotice = '';
  var goldSequence = 0;
  var goldInstance = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  var GOLD_REPLY_MS = 30000;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'box:' + what); }
    catch (e) { }
  }

  function net(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) {
        window.thornswoodNet.say(line);
        return true;
      }
    } catch (e) {
      // The bridge may have queued the line before another callback threw.
      // Delivery is unknown, so a deposit must still await its own receipt.
      return null;
    }
    return false;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function when(ms) {
    var t = Number(ms) || 0;
    if (!t) { return ''; }
    try {
      var d = new Date(t);
      var h = d.getHours();
      var m = d.getMinutes();
      var ampm = h < 12 ? 'AM' : 'PM';
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    } catch (e) { return ''; }
  }

  /* THE LOOK IS THE NOTICE BOARD'S. Every colour below is one that panel uses. No :hover, no transitions. */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:640px;max-width:calc(100vw - 48px);height:600px;',
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
    '#' + ID + ' .row{display:flex;align-items:center;gap:12px;padding:8px 10px;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:160px;font-size:16px;line-height:1.35}',
    '#' + ID + ' .row .tools{display:flex;gap:8px;flex-wrap:wrap}',
    '#' + ID + ' .line{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' button:disabled{background:rgba(0,0,0,.25);border-color:rgba(198,170,109,.25);color:rgba(217,207,180,.5);cursor:default}',
    '#' + ID + ' .none{color:rgba(217,207,180,.6);font-style:italic;padding:6px 2px}',
    '#' + ID + ' .note{color:rgba(217,207,180,.7);font-size:12.5px;line-height:1.5;margin-top:8px}',
    '#' + ID + ' .said{border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);padding:8px 10px;margin:10px 0}',
    '#' + ID + ' input{font-family:inherit;font-size:16px;color:#d9cfb4;background:rgba(0,0,0,.25);',
    '  border:1px solid rgba(198,170,109,.30);padding:6px 8px}',
    '#' + ID + ' input:focus,#' + ID + ' select:focus{outline:2px solid #e9d19b;outline-offset:2px}',
    '#' + ID + ' input.n{width:90px}',
    '#' + ID + ' input.who{flex:1;min-width:160px}',
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
      '<div class="panel"><h2>Drop box</h2><div class="body"></div>' +
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

  function rowLine(r, officer) {
    var what = (r.count > 1 || r.gold ? r.count + ' ' : '') + esc(r.what);
    var bits = [what];
    if (r.forName) { bits.push('for ' + esc(r.forName)); }
    if (officer) { bits.push('put in by ' + esc(r.mine ? 'you' : r.who)); }
    if (r.at) { bits.push(esc(when(r.at))); }
    return bits.join(', ');
  }

  function draw() {
    if (!root) { return; }
    var keptGold = field(ID + '-gold');
    var keptFor = field(ID + '-for');
    var keptCount = field(ID + '-count');
    var keptSlot = field(ID + '-slot');
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var d = data || {};
    var officer = !!d.officer;
    title.innerHTML = esc(d.where || 'Drop box') + ' <span class="sub">drop box' +
      (officer ? ', ' + esc(String(d.allGold || 0)) + ' gold in it' : '') + '</span>';
    var out = '';
    if (d.said) { out += '<div class="said">' + esc(d.said) + '</div>'; }

    out += '<h3>' + (officer ? 'In the box' : 'What you put in') + '</h3>';
    var rows = d.rows || [];
    if (!rows.length) { out += '<div class="none">' + (officer ? 'Nothing in it.' : 'Nothing of yours.') + '</div>'; }
    if (!officer && d.mineGold) {
      out += '<div class="note">Your gold in the box: ' + esc(String(d.mineGold)) + '</div>';
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out += '<div class="row"><span class="nm">' + rowLine(r, officer) + '</span><span class="tools">';
      if (r.count > 1) {
        out += '<input class="n" id="' + ID + '-take-' + esc(r.n) + '" aria-label="Count to take" placeholder="all">';
      }
      out += '<button data-do="take" data-n="' + esc(r.n) + '">' + (r.mine ? 'Take back' : 'Take') + '</button>';
      out += '</span></div>';
    }

    out += '<h3>Put in gold</h3>';
    out += '<div class="line"><input class="n" id="' + ID + '-gold" aria-label="Gold to put in" placeholder="gold">' +
      '<button class="go" data-do="gold"' + (goldPending ? ' disabled aria-busy="true"' : '') + '>' +
      (goldPending ? 'Putting in...' : 'Put in') + '</button></div>';
    if (goldNotice) { out += '<div class="note" role="status" aria-live="polite">' + esc(goldNotice) + '</div>'; }
    out += '<div class="note">You carry ' + esc(String(d.packGold || 0)) + ' gold. Gold you put in pays what you owe ' +
      'on your rent first. You may take your own back, and then the rent is owed again.</div>';

    var pack = d.pack || [];
    out += '<h3>Leave something for somebody</h3>';
    if (!pack.length) {
      out += '<div class="none">Nothing in your pack to leave.</div>';
    } else {
      var opts = '';
      for (var p = 0; p < pack.length; p++) {
        opts += '<option value="' + esc(pack[p].slot) + '">' + esc(pack[p].what) +
          (pack[p].count > 1 ? ' (' + esc(pack[p].count) + ')' : '') + '</option>';
      }
      out += '<div class="line"><select id="' + ID + '-slot">' + opts + '</select>' +
        '<input class="n" id="' + ID + '-count" aria-label="Count to leave" placeholder="1">' +
        '<input class="who" id="' + ID + '-for" aria-label="Recipient" placeholder="who it is for"></div>';
      out += '<div class="line"><button class="go" data-do="leave">Leave it</button></div>';
      out += '<div class="note">For a delivery somebody was not here to take: it waits in the box, ' +
        'and the hold\'s steward hands it out.</div>';
    }

    if (officer) {
      out += '<h3>Records</h3>';
      out += '<div class="line"><button data-do="records">' + (showRecords ? 'Refresh the records' : 'Records') + '</button></div>';
      var recs = d.records;
      if (showRecords && recs) {
        if (!recs.length) { out += '<div class="none">Nothing has gone in or out yet.</div>'; }
        for (var k = 0; k < recs.length; k++) {
          var x = recs[k];
          // Rent handed to a steward in person (#3895) is a payment too, kept beside the box's own.
          var line = x.act === 'rent'
            ? esc(when(x.at)) + ': ' + esc(x.who) + ' was handed ' + esc(x.count) + ' gold of rent by ' + esc(x.by || 'somebody')
            : esc(when(x.at)) + ': ' + esc(x.who) + (x.act === 'in' ? ' put in ' : ' took out ') +
              esc(x.count > 1 || x.what === 'Gold' ? x.count + ' ' : '') + esc(x.what);
          if (x.forName) { line += ' for ' + esc(x.forName); }
          if (x.act === 'out' && x.by && x.by !== x.who) { line += ', put in by ' + esc(x.by); }
          if (x.note) { line += ' (' + esc(x.note) + ')'; }
          out += '<div class="row"><span class="nm">' + line + '</span></div>';
        }
      }
    }

    body.innerHTML = out;
    var g = document.getElementById(ID + '-gold');
    if (g && keptGold) { g.value = keptGold; }
    var f = document.getElementById(ID + '-for');
    if (f && keptFor) { f.value = keptFor; }
    var c = document.getElementById(ID + '-count');
    if (c && keptCount) { c.value = keptCount; }
    var s = document.getElementById(ID + '-slot');
    if (s && keptSlot) { s.value = keptSlot; }
    var buttons = body.querySelectorAll('button[data-do]');
    for (var b = 0; b < buttons.length; b++) { buttons[b].onclick = onDo; }
  }

  function onDo() {
    var verb = this.getAttribute('data-do');
    var n = this.getAttribute('data-n');
    if (verb === 'gold') {
      if (!shown || goldPending) { return; }
      var amount = field(ID + '-gold').replace(/[^0-9]/g, '');
      if (!amount) { return; }
      var pending = { hold: data && data.hold, request: goldInstance + '-' + (++goldSequence).toString(36) };
      goldPending = pending;
      goldNotice = '';
      draw(); // Feedback precedes the send, including a synchronous bridge reply.
      if (net('/dropbox gold ' + amount + ' ' + pending.request) === false) {
        goldPending = null;
        goldNotice = 'The gold request could not be sent. Please try again.';
        draw();
        return;
      }
      window.setTimeout(function () {
        if (goldPending !== pending) { return; }
        goldPending = null;
        goldNotice = 'No answer arrived. Check the box before putting in more gold.';
        if (shown) { draw(); }
      }, GOLD_REPLY_MS);
      return;
    }
    if (verb === 'leave') {
      var slot = field(ID + '-slot').replace(/[^0-9]/g, '');
      var count = field(ID + '-count').replace(/[^0-9]/g, '') || '1';
      var who = field(ID + '-for').replace(/\s+/g, ' ').trim();
      if (slot && who) { net('/dropbox leave ' + slot + ' ' + count + ' ' + who); }
      return;
    }
    if (verb === 'take' && n) {
      var some = field(ID + '-take-' + n).replace(/[^0-9]/g, '');
      net('/dropbox take ' + n + (some ? ' ' + some : ''));
      return;
    }
    if (verb === 'records') {
      showRecords = true;
      net('/dropbox records');
    }
  }

  function open() {
    build();
    if (shown) { draw(); return; }
    shown = true;
    root.className = 'on';
    draw();
    if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
    tell('opened');
  }

  function close() {
    if (!shown) { return; }
    shown = false;
    showRecords = false;
    if (root) { root.className = ''; }
    tell('closed');
  }

  document.addEventListener('keydown', function (ev) {
    if (!shown) { return; }
    if (ev.key === 'Escape') { close(); }
    var target = ev.target;
    var button = target && target.getAttribute && target.getAttribute('data-do') === 'gold';
    var amount = target && target.id === ID + '-gold';
    if ((ev.key === 'Enter' && (button || amount)) || (ev.key === ' ' && button)) {
      ev.preventDefault();
      if (ev.repeat) { return; }
      var put = root && root.querySelector('[data-do="gold"]');
      if (put) { onDo.call(put); }
    }
  });

  window.thornswoodBox = {
    open: open,
    close: close,
    isOpen: function () { return shown; },
    setData: function (d) {
      // Only this gold action's receipt at its box answers its pending press.
      // A balance change, records refresh or an earlier receipt is unrelated.
      if (goldPending && d && d.goldRequest === goldPending.request &&
          (d.hold === goldPending.hold || d.open === false)) {
        goldPending = null;
        goldNotice = '';
      }
      data = d || null;
      if (!data || data.open === false) { close(); return; }
      if (data.open) { open(); return; }
      if (shown) { draw(); }
    }
  };

  tell('ready');
})();
