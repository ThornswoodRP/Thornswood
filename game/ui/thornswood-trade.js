'use strict';
/*
  Trading, the panel.

  Patrick, 22 September: "Currently the looking at people doesnt have the trade
  menu and when it did you had to use youyr cursor and a bunch of other bs I
  just want to press a key while looking at them."

  So the key does the asking and this only ever appears once both people are in
  a trade. Nobody has to find it, and it opens and closes itself: there is no
  trade key that opens an empty trade window.

  THE PILES BELONG TO THE SERVER. Everything on this panel is drawn from what
  the server says the two piles are, and every button sends an ordinary
  /trade line. This page cannot move an item; it can only ask. That is what
  makes it safe to let a page draw a trade at all.

  THE RULE THAT MATTERS, and it is worth knowing before you press Agree:
  ANY change to either pile takes BOTH agreements back. What you agreed to is
  what you get, or nothing happens.

  THE CONTRACT with thornswood-front.js:
    window.thornswoodTrade = { open, close, toggle, isOpen, setData }
    page -> plugin  'trade:ready' | 'trade:opened' | 'trade:closed'
*/
(function () {
  if (window.thornswoodTrade) { return; }

  var ID = 'ts-trade';
  var data = null;
  var shown = false;
  var root = null;
  var filter = '';
  var cat = '';
  // Counts typed into a row, kept for the piece while Find or a category
  // hides its row, so it is still there when the row comes back.
  var typed = {};
  var goldDraft = null;
  var sessionId = '';

  function resetDrafts() {
    typed = {}; goldDraft = null; filter = ''; cat = '';
    var active = document.activeElement;
    if (root && active && root.contains(active) && active.blur) active.blur();
  }

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'trade:' + what); }
    catch (e) { }
  }

  function net(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) {
        return window.thornswoodNet.say(line) !== false;
      }
    } catch (e) { }
    return false;
  }

  /*
    THE LOOK IS THE K PANEL'S, as the journal's and the party panel's are.
    Patrick, 23 September, about the journal: "the journal menu works but is
    ugly asf and doesn't match the theme we use with our other menus". This
    window was drawn from the same old template: system-ui sans serif, a
    rounded 12px panel, flat grey #1b1f26 and #212630 and a brass #d9ab52.
    It now carries thornswood-skills.js's values, the way the head of
    thornswood-party.js describes, and tools/test-party-trade-theme.js fails
    on a colour here that the K panel does not use.

    THIS IS WHERE ITEMS CHANGE HANDS, so no control got smaller. Every button
    keeps the font size and padding it had, Agree and Walk away keep their
    larger ones, and the buttons and the two boxes carry the line height the
    old type gave them, so each is the height it was whichever font of the
    stack the machine has. Uppercase and spaced, every button is wider than
    it was. Measured in Edge at 1920 by 1080 under the front's reset on
    24 September: the row buttons 24px tall as before, Agree and Walk away
    35px, the find and gold boxes 32px, and all of them inside their rows.
    Agree, once you have agreed, is drawn at the same opacity it was.

    No :hover, for the reason the K panel has none (see the head of
    thornswood-skills.js). The front's stylesheet in this same document sets
    margin, padding, border and background to nothing on every element, so
    each rule sets what it needs.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483100;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:1020px;max-width:calc(100vw - 48px);height:640px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .cols{display:grid;grid-template-columns:1fr 1fr 1fr;overflow:hidden}',
    '#' + ID + ' .col{overflow:auto;padding:14px 16px;border-right:1px solid rgba(198,170,109,.22);',
    '  font-size:16px}',
    '#' + ID + ' .col:last-child{border-right:none}',
    '#' + ID + ' h3{margin:0 0 9px;padding-bottom:6px;font-size:12px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);font-weight:normal;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .line{display:flex;align-items:stretch;gap:8px;padding:10px 12px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .top{display:flex;align-items:center;gap:10px;flex:1 1 100%;min-width:0}',
    '#' + ID + ' .acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%}',
    '#' + ID + ' .line .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px}',
    '#' + ID + ' .line .c{color:rgba(217,207,180,.7);font-variant-numeric:tabular-nums;font-size:16px}',
    '#' + ID + ' .qty{width:88px;margin:0;flex:none}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:5px 10px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' .foot button{padding:8px 18px;font-size:16px;line-height:22px}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' button.off{opacity:.55}',
    '#' + ID + ' input{font-family:inherit;font-size:16px;line-height:22px;color:#f6e9c8;background:rgba(0,0,0,.35);',
    '  border:1px solid rgba(198,170,109,.30);padding:8px 10px;width:100%;margin-bottom:9px}',
    '#' + ID + ' input:focus{border-color:rgba(198,170,109,.55)}',
    '#' + ID + ' .none{color:rgba(217,207,180,.7);font-style:italic;padding:6px 2px;line-height:1.5}',
    '#' + ID + ' .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
    '#' + ID + ' .chips button.on{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .cat{margin:12px 0 6px;font-size:15px;letter-spacing:.16em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);font-weight:normal}',
    '#' + ID + ' .gold{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}',
    '#' + ID + ' .gold input{width:110px;margin:0}',
    '#' + ID + ' .ok{color:#9fcf92}',
    '#' + ID + ' .sale{padding:10px 12px;margin-bottom:10px;line-height:1.5;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.20)}',
    '#' + ID + ' .wait{color:rgba(217,207,180,.7)}',
    '#' + ID + ' .foot{padding:12px 20px;border-top:1px solid rgba(198,170,109,.22);display:flex;gap:12px;',
    '  align-items:center;font-size:13.5px;font-style:italic;color:rgba(217,207,180,.7)}',
    // The K panel's scrollbars, the same rules scoped to this window, so it
    // has them whether or not the K panel's page loaded first.
    '#' + ID + ' ::-webkit-scrollbar{width:10px;height:10px}',
    '#' + ID + ' ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#' + ID + ' ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    '  background-clip:padding-box;border-radius:6px}',
    '#' + ID + ' ::-webkit-scrollbar-thumb:active{background:rgba(233,209,155,.55);background-clip:padding-box}',
    '#' + ID + ' ::-webkit-scrollbar-corner{background:transparent}'
  ].join('\n');

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel">' +
      '<h2 id="' + ID + '-title">Trade</h2>' +
      '<div class="cols">' +
      '<div class="col" id="' + ID + '-pack"></div>' +
      '<div class="col" id="' + ID + '-mine"></div>' +
      '<div class="col" id="' + ID + '-theirs"></div>' +
      '</div>' +
      '<div class="foot"><span id="' + ID + '-state"></span><span style="flex:1"></span>' +
      '<button id="' + ID + '-sale" style="display:none">Buy for the company</button>' +
      '<button id="' + ID + '-cancel">Walk away</button>' +
      '<button class="go" id="' + ID + '-ok">Agree</button></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector('#' + ID + '-cancel').onclick = function () { net('/trade cancel'); };
    // A sale out of Skyrim (#1393): only a company worker sees it.
    root.querySelector('#' + ID + '-sale').onclick = function () { net('/trade sale'); };
    /*
      Escape outside an editing field WALKS AWAY rather than hiding the panel.
      A trade you cannot see is a trade you have forgotten you are in, holding
      somebody else standing there waiting. In a text box its first press
      only leaves that edit; a fresh second press can then walk away.
    */
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (ev.repeat) { return; }
        var field = ev.target || document.activeElement;
        if (field && root.contains(field) &&
            (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable)) {
          field.blur();
          return;
        }
        net('/trade cancel');
      }
    });
    return root;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Text and double-quoted HTML attributes have different escaping rules.
  function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

  function submitGold(value) {
    var draft = goldDraft, sentSession = sessionId;
    if (net('/trade gold ' + value)) {
      // This is local delivery acceptance, not a server receipt. Subsequent
      // authoritative views own submitted text; unrelated views keep unsent text.
      if (sessionId === sentSession && goldDraft === draft) goldDraft = null;
      if (shown) draw();
    }
  }

  /*
    WHAT A BUTTON ASKS FOR, #1718. Each line is one piece (a key to one
    house, a sword at its own condition, an enchanted dagger), and the
    server numbers each piece for the trade, so a button sends '#' and that
    number: the piece the line was drawn for, never the first one that has
    its name. A server from before #1718 sends no number and is asked by
    the name.
  */
  function ref(line) {
    return line.p ? '#' + line.p : String(line.n);
  }

  /*
    A SALE OUT OF SKYRIM (#1393). When a company worker has pressed Buy for
    the company, both sides read what happens before they agree: the things
    leave Skyrim, and the gold is split as the server says.
  */
  function saleLine(s) {
    if (!s) { return ''; }
    var split = s.available !== true
      ? (s.price ? 'The company payout is unavailable. Read the trade again before agreeing.'
                 : (s.mine ? 'Put the price up as gold.' : 'No price is up yet.'))
      : (s.cut || s.gone)
      ? (s.mine
        ? 'Of ' + s.price + ' gold, ' + esc(data.them) + ' receives ' + s.seller + ', ' + s.cut +
          ' stays with you for handling it, and ' + s.gone + ' leaves the world.'
        : 'Of ' + s.price + ' gold, you receive ' + s.seller + ', ' + s.cut + ' is ' + esc(s.worker) +
          '\'s for handling it, and ' + s.gone + ' leaves the world.')
      : (s.price
        ? 'Nothing is cut: the whole ' + s.price + ' goes to ' + (s.mine ? esc(data.them) : 'you') + '.'
        : (s.mine ? 'Put the price up as gold.' : 'No price is up yet.'));
    return '<div class="sale">' + (s.mine
      ? 'You are buying for the Free Skyrim Trading Company. What ' + esc(data.them) +
        ' puts up leaves Skyrim and does not come back. Your gold is the price. '
      : esc(s.worker) + ' is buying for the Free Skyrim Trading Company. What you put up leaves Skyrim ' +
        'and does not come back. Their gold is the price. ') + split + '</div>';
  }

  function draw() {
    if (!root || !data) { return; }
    root.querySelector('#' + ID + '-title').textContent = data.sale
      ? (data.sale.mine ? 'Buying for the company from ' + (data.them || 'somebody')
                        : 'Selling out of Skyrim to ' + (data.them || 'somebody'))
      : 'Trading with ' + (data.them || 'somebody');
    var saleBtn = root.querySelector('#' + ID + '-sale');
    saleBtn.style.display = data.canBuy ? '' : 'none';
    saleBtn.textContent = data.sale && data.sale.mine ? 'Make it a trade' : 'Buy for the company';

    // What you are carrying, with a box to narrow it down: a pack of two
    // hundred things is not a list anybody reads.
    var pack = root.querySelector('#' + ID + '-pack');
    var low = filter.toLowerCase();
    var kinds = [];
    (data.pack || []).forEach(function (it) {
      var k = it.k || 'Other';
      if (kinds.indexOf(k) < 0) { kinds.push(k); }
    });
    kinds.sort();
    if (cat && kinds.indexOf(cat) < 0) { cat = ''; }
    var ph = '<h3>Your pack</h3>' +
             '<input id="' + ID + '-find" aria-label="Find by name" placeholder="Find by name" value="' + attr(filter) + '">';
    ph += '<div class="chips"><button data-cat=""' + (cat ? '' : ' class="on"') + '>All</button>';
    for (var c = 0; c < kinds.length; c++) {
      ph += '<button data-cat="' + attr(kinds[c]) + '"' + (cat === kinds[c] ? ' class="on"' : '') + '>' +
            esc(kinds[c]) + '</button>';
    }
    ph += '</div>';
    var items = (data.pack || []).filter(function (it) {
      if (cat && (it.k || 'Other') !== cat) { return false; }
      return !low || String(it.n).toLowerCase().indexOf(low) !== -1 ||
        String(it.k || '').toLowerCase().indexOf(low) !== -1;
    });
    if (!items.length) {
      ph += '<div class="none">' + (low ? 'No matches. Try a different name or choose All.'
        : cat ? 'Nothing in that category.' : 'You are carrying nothing.') + '</div>';
    } else {
      if (items.length > 200) ph += '<div class="none">Showing 200 of ' + items.length + ' matches. Use Find or a category to narrow the list.</div>';
      var grouped = {};
      var order = [];
      for (var i = 0; i < items.length && i < 200; i++) {
        var key = items[i].k || 'Other';
        if (!grouped[key]) { grouped[key] = []; order.push(key); }
        grouped[key].push(items[i]);
      }
      for (var g = 0; g < order.length; g++) {
        ph += '<div class="cat">' + esc(order[g]) + '</div>';
        var rows = grouped[order[g]];
        for (var r = 0; r < rows.length; r++) {
          var it = rows[r];
          var itRef = attr(ref(it));
          var addKey = 'add:' + ref(it);
          ph += '<div class="line" data-row-key="' + attr(addKey) + '"><div class="top"><span class="nm">' + esc(it.n) + '</span>' +
                '<span class="c">' + it.c + '</span></div><div class="acts">' +
                '<input class="qty" data-side="add" data-for="' + itRef + '" aria-label="Count to offer" placeholder="How many" value="' + attr(typed[addKey] || '') + '">' +
                '<button data-qty="' + itRef + '">Add</button>' +
                '<button data-add="' + itRef + '" data-n="1">Add 1</button>' +
                (it.c >= 5 ? '<button data-add="' + itRef + '" data-n="5">Add 5</button>' : '') +
                (it.c >= 10 ? '<button data-add="' + itRef + '" data-n="10">Add 10</button>' : '') +
                (it.c > 1 ? '<button data-add="' + itRef + '" data-n="' + it.c + '">All</button>' : '') +
                '</div></div>';
        }
      }
    }
    put(pack, ph);

    var mine = root.querySelector('#' + ID + '-mine');
    var mh = '<h3>You are offering ' + (data.iAgreed ? '<span class="ok">&#10003; agreed</span>' : '') + '</h3>' +
             saleLine(data.sale);
    if (!(data.mine || []).length) { mh += '<div class="none">Nothing yet.</div>'; }
    for (var j = 0; j < (data.mine || []).length; j++) {
      var mineRow = data.mine[j];
      var mineRef = attr(ref(mineRow));
      var remKey = 'rem:' + ref(mineRow);
      mh += '<div class="line" data-row-key="' + attr(remKey) + '"><div class="top"><span class="nm">' + esc(mineRow.n) + '</span>' +
            '<span class="c">' + mineRow.c + '</span></div><div class="acts">' +
            '<input class="qty" data-side="rem" data-for="' + mineRef + '" aria-label="Count to take back" placeholder="How many" value="' + attr(typed[remKey] || '') + '">' +
            '<button data-take="' + mineRef + '">Take</button>' +
            (mineRow.c > 1 ? '<button data-rem="' + mineRef + '" data-n="1">Take 1</button>' : '') +
            '<button data-rem="' + mineRef + '">Take back</button></div></div>';
    }
    mh += '<div class="gold"><span>Gold</span>' +
          '<input id="' + ID + '-gold" aria-label="Gold to offer" value="' + attr(goldDraft === null ? (data.myGold || 0) : goldDraft) + '">' +
          '<button data-do="gold">Set</button>' +
          '<button data-do="goldall">All</button>' +
          '<button data-do="goldclear">None</button></div>';
    put(mine, mh);

    var theirs = root.querySelector('#' + ID + '-theirs');
    var th = '<h3>' + esc(data.them) + ' is offering ' +
             (data.theyAgreed ? '<span class="ok">&#10003; agreed</span>' : '<span class="wait">still deciding</span>') + '</h3>';
    if (!(data.theirs || []).length && !data.theirGold) { th += '<div class="none">Nothing yet.</div>'; }
    for (var k = 0; k < (data.theirs || []).length; k++) {
      th += '<div class="line"><div class="top"><span class="nm">' + esc(data.theirs[k].n) + '</span>' +
            '<span class="c">' + data.theirs[k].c + '</span></div></div>';
    }
    if (data.theirGold) {
      th += '<div class="line"><div class="top"><span class="nm">gold</span><span class="c">' + data.theirGold + '</span></div></div>';
    }
    put(theirs, th);

    var offerVersion = data.offerVersion;
    var versioned = typeof offerVersion === 'string' && /^[0-9a-f]{48}$/.test(offerVersion);
    root.querySelector('#' + ID + '-state').textContent =
      !versioned ? 'Waiting for a current trade offer.'
      : data.iAgreed && data.theyAgreed ? 'Swapping...'
      : (data.iAgreed ? 'Waiting for ' + data.them + '.'
                      : 'Changing either side takes both agreements back.');
    var okBtn = root.querySelector('#' + ID + '-ok');
    okBtn.className = data.iAgreed ? 'off' : 'go';
    okBtn.textContent = data.iAgreed ? 'Agreed' : 'Agree';
    var payoutAvailable = !data.sale || data.sale.available === true;
    okBtn.disabled = !versioned || !payoutAvailable || !!data.iAgreed;
    // Capture this draw, rather than reading whichever data arrives after a
    // click. The server checks it again before recording any agreement.
    var canAgree = versioned && payoutAvailable && !data.iAgreed;
    okBtn.onclick = function () { if (canAgree) { net('/trade agree ' + offerVersion); } };

    var find = root.querySelector('#' + ID + '-find');
    if (find) {
      find.oninput = function () { filter = this.value; draw(); };
    }
    var chips = pack.querySelectorAll('button[data-cat]');
    for (var ci = 0; ci < chips.length; ci++) {
      chips[ci].onclick = function () { cat = this.getAttribute('data-cat') || ''; draw(); };
    }
    wire(pack); wire(mine);
    root.querySelector('#' + ID + '-gold').oninput = function () { goldDraft = this.value; };
    showDrafts();
  }

  /*
    What each box holds is this page's to say: what is typed and not yet
    sent, or else what the server says. A box kept through an update keeps
    whatever was in it, so it is told here, and only when it differs, so
    the caret stays where it was.
  */
  function showDrafts() {
    var gold = root.querySelector('#' + ID + '-gold');
    setValue(gold, goldDraft === null ? String(data.myGold || 0) : goldDraft);
    setValue(root.querySelector('#' + ID + '-find'), filter);
    var boxes = root.querySelectorAll('input[data-for]');
    for (var i = 0; i < boxes.length; i++) {
      setValue(boxes[i], typed[(boxes[i].getAttribute('data-side') || 'add') + ':' + boxes[i].getAttribute('data-for')] || '');
    }
  }
  function setValue(box, value) {
    if (box && box.value !== value) { box.value = value; }
  }

  // In place, so a count being typed and its focus outlast the update (#4475).
  function put(host, html) {
    if (window.thornswoodDialog) { window.thornswoodDialog.patch(host, html, sessionId); } else { host.innerHTML = html; }
  }

  function readQty(where, name) {
    var boxes = where.querySelectorAll('input');
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].getAttribute('data-for') !== name) { continue; }
      var raw = String(boxes[i].value || '').replace(/[^0-9]/g, '');
      var n = parseInt(raw, 10);
      if (!n || n < 1) { n = 1; }
      if (n > 9999) { n = 9999; }
      return n;
    }
    return 1;
  }

  function wire(where) {
    var boxes = where.querySelectorAll('input');
    for (var q = 0; q < boxes.length; q++) {
      if (!boxes[q].getAttribute('data-for')) { continue; }
      boxes[q].oninput = function () {
        var side = this.getAttribute('data-side') || 'add';
        typed[side + ':' + this.getAttribute('data-for')] = this.value;
      };
    }
    var b = where.querySelectorAll('button[data-add],button[data-rem],button[data-do],button[data-qty],button[data-take]');
    for (var i = 0; i < b.length; i++) {
      b[i].onclick = function () {
        var addWhat = this.getAttribute('data-add');
        var remWhat = this.getAttribute('data-rem');
        var qtyWhat = this.getAttribute('data-qty');
        var takeWhat = this.getAttribute('data-take');
        if (qtyWhat) { net('/trade add ' + qtyWhat + ' ' + readQty(where, qtyWhat)); return; }
        if (takeWhat) { net('/trade remove ' + takeWhat + ' ' + readQty(where, takeWhat)); return; }
        if (addWhat) { net('/trade add ' + addWhat + ' ' + (this.getAttribute('data-n') || '1')); return; }
        if (remWhat) {
          var n = this.getAttribute('data-n');
          net('/trade remove ' + remWhat + (n ? ' ' + n : ''));
          return;
        }
        var act = this.getAttribute('data-do');
        var g = root.querySelector('#' + ID + '-gold');
        if (act === 'gold') { submitGold(g ? g.value : '0'); }
        else if (act === 'goldall') {
          var all = (data && data.heldGold) || 0;
          if (g) { g.value = String(all); }
          goldDraft = String(all);
          submitGold(all);
        }
        else if (act === 'goldclear') {
          if (g) { g.value = '0'; }
          goldDraft = '0';
          submitGold(0);
        }
      };
    }
  }

  function open() {
    build();
    if (shown) { return; }
    shown = true;
    root.className = 'on';
    draw();
    if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
    tell('opened');
  }

  function close() {
    resetDrafts(); sessionId = '';
    if (!shown) { return; }
    shown = false;
    if (root) { root.className = ''; }
    tell('closed');
  }

  window.thornswoodTrade = {
    open: open,
    close: close,
    toggle: function () { if (shown) { net('/trade cancel'); } },
    isOpen: function () { return shown; },
    /*
      THE PANEL FOLLOWS THE TRADE RATHER THAN A KEY. The server sends
      open:false when the trade ends, whichever way it ended, so the window
      cannot be left up over a trade that is over.
    */
    setData: function (d) {
      data = d || null;
      if (!data || !data.open) { close(); return; }
      var nextSession = typeof data.sessionId === 'string' && /^[0-9a-f]{48}$/.test(data.sessionId) ? data.sessionId : '';
      if (!nextSession || nextSession !== sessionId) resetDrafts();
      sessionId = nextSession;
      if (!shown) { open(); } else { draw(); }
    }
  };

  build();
  // Owner updates can precede this asynchronously loaded script (#1275).
  if (window.thornswoodTradeView) {
    window.thornswoodTrade.setData(window.thornswoodTradeView);
  }
  tell('ready');
})();
