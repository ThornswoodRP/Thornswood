'use strict';
/*
  The trade ships' panel (#2700, split from #511): the dock, and the staff
  side that keeps the ports and routes. The trade carts (#3158) use it too:
  a cart stop, a raid on a cart on the road, and the staff side that keeps
  the stops and roads.

  E on a port's crate opens the dock side; Ports and routes on the Office page
  of K opens the staff side. The server answers on thornswoodShipView, and
  setData with open draws this panel; open false closes it.

  THE CONTRACT with thornswood-front.js, the same shape the box panel uses:

    window.thornswoodShip = { open, close, isOpen, setData }
    page -> plugin  'ship:ready' | 'ship:opened' | 'ship:closed'
    page -> server  '/ship load|sail|collect|return|take|close ...' at a dock and
                    '/ship draft|confirm|add|staff ...' for staff, through
                    window.thornswoodNet.say; nobody is told to type them
                    (Patrick, 4 Oct: no chat commands for what people do).
                    A cart's view says kind 'cart' and word '/cart', and every
                    line goes out under that word instead: '/cart load|drive|
                    pullin|collect|return|take|close ...' and the staff's
                    '/cart draft|confirm|add|bring|staff ...'.

  WHAT IT SHOWS IS WHAT THE SERVER SENT. The server decides who may load or
  sail (the Trading Company's charter), whose name a person sees on a line,
  what they may collect, take back or take (#511), and what a staff draft
  would change. This page draws the rows it is given and never
  works out who may do what. Nothing here moves a piece or a coin.
*/
(function () {
  if (window.thornswoodShip) { return; }

  var ID = 'ts-ship';
  var data = null;
  var shown = false;
  var root = null;
  // trade-cargo.js ID_RE: the first character is a letter or digit too.
  var KEY_RULE = 'Start with a lowercase letter or digit. Use 1 to 64 lowercase letters, digits, : _ . or - with no spaces.';

  /* The word every line goes out under: the view's, or the ships' when it names none. */
  function word() { return data && data.word === '/cart' ? '/cart' : '/ship'; }
  function isCart() { return !!data && data.kind === 'cart'; }

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'ship:' + what); }
    catch (e) { }
  }
  function net(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) { window.thornswoodNet.say(line); return true; }
    } catch (e) { }
    return false;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function plain(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:760px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);',
    '  display:grid;grid-template-rows:auto 1fr auto;background:rgba(11,10,8,.94);',
    '  border:1px solid rgba(198,170,109,.42);outline:1px solid rgba(198,170,109,.14);',
    '  outline-offset:-6px;box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' h3{font-size:19px;font-weight:normal;color:#f6e9c8;margin:16px 0 8px}',
    '#' + ID + ' .body{overflow:auto;padding:12px 20px;font-size:16px}',
    '#' + ID + ' .note{color:rgba(217,207,180,.8);font-style:italic;margin:0 0 10px}',
    '#' + ID + ' .line{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:6px}',
    '#' + ID + ' .nm{flex:1;min-width:160px;overflow-wrap:anywhere}',
    '#' + ID + ' select,#' + ID + ' input{font:inherit;color:#f6e9c8;background:#17140f;border:1px solid #ac9564;padding:5px}',
    '#' + ID + ' input[type=number]{width:5em}',
    '#' + ID + ' button{font-family:inherit;cursor:pointer;border:1px solid rgba(198,170,109,.55);',
    '  background:rgba(0,0,0,.25);color:#e9d19b;padding:5px 10px;font-size:14px;letter-spacing:.12em;text-transform:uppercase}',
    '#' + ID + ' .foot{padding:12px 20px;border-top:1px solid rgba(198,170,109,.22);display:flex;gap:12px;justify-content:flex-end}'
  ].join('\n');

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML = '<div class="panel" role="dialog" aria-modal="true" aria-labelledby="' + ID + '-title">' +
      '<h2 id="' + ID + '-title">Ship</h2><div class="body" id="' + ID + '-body"></div>' +
      '<div class="foot"><button id="' + ID + '-close">Step back</button></div></div>';
    document.body.appendChild(root);
    root.querySelector('#' + ID + '-close').onclick = function () { net(word() + ' close'); close(); };
    root.addEventListener('click', onClick);
    root.addEventListener('input', clearValidity);
    root.addEventListener('change', clearValidity);
    return root;
  }

  function clearValidity(ev) {
    var field = ev.target;
    if (field && field.setCustomValidity) { field.setCustomValidity(''); }
    if (field && (field.id === ID + '-rfrom' || field.id === ID + '-rto')) {
      var to = document.getElementById(ID + '-rto');
      if (to && to.setCustomValidity) { to.setCustomValidity(''); }
    }
  }
  function refuse(id, reason) {
    var field = document.getElementById(id);
    if (field) {
      field.setCustomValidity(reason);
      field.focus();
      field.reportValidity();
    }
  }
  function val(id) { var el = document.getElementById(id); return el ? plain(el.value) : ''; }
  function count(id) {
    var el = document.getElementById(id);
    var n = el ? Number(el.value) : 0;
    if (!Number.isInteger(n) || n < 1 || (el.max && n > Number(el.max))) {
      if (el && el.setCustomValidity) { el.setCustomValidity('Choose a whole count from 1 to ' + (el.max || 'any') + '.'); el.reportValidity(); }
      return 0;
    }
    if (el.setCustomValidity) { el.setCustomValidity(''); }
    return n;
  }

  /* Every button carries what it sends; a button that needs a box reads it here. */
  function onClick(ev) {
    var el = ev.target;
    while (el && el !== root && !(el.getAttribute && el.getAttribute('data-act'))) { el = el.parentNode; }
    if (!el || el === root) { return; }
    var a = el.getAttribute('data-act'), h = el.getAttribute('data-hold') || '', k = el.getAttribute('data-key') || '';
    var n;
    if (a === 'say') { net(el.getAttribute('data-line')); return; }
    var w = word() + ' ';
    if (a === 'collect' || a === 'return' || a === 'take') {
      n = count(el.getAttribute('data-count'));
      if (n) { net(w + a + ' ' + h + ' ' + el.getAttribute('data-line') + ' ' + n); }
      return;
    }
    if (a === 'load') {
      var piece = val(ID + '-piece-' + h).split(':'), to = val(ID + '-for-' + h);
      n = count(ID + '-count-' + h);
      if (piece.length === 2 && to && n) { net(w + 'load ' + h + ' ' + piece[0] + ' ' + piece[1] + ' ' + n + ' ' + to); }
      return;
    }
    if (a === 'port') {
      var key = val(ID + '-pkey').toLowerCase(), hold = val(ID + '-phold'), name = val(ID + '-pname');
      if (!/^[a-z0-9][a-z0-9:_.-]{0,63}$/.test(key)) { refuse(ID + '-pkey', 'The key is not valid. ' + KEY_RULE); return; }
      if (key && hold && name) { net(w + 'draft port ' + key + ' ' + hold + ' ' + name); }
      return;
    }
    if (a === 'route') {
      var m = count(ID + '-rmin');
      var from = val(ID + '-rfrom'), to = val(ID + '-rto');
      if (m && from === to) { refuse(ID + '-rto', 'Choose two different ' + places().places + ' for this ' + places().route + '.'); return; }
      if (m) { net(w + 'draft route ' + from + ' ' + to + ' ' + m); }
      return;
    }
    if (a === 'minutes') {
      var mm = count(el.getAttribute('data-count'));
      if (mm) { net(w + 'draft route ' + k + ' ' + mm); }
      return;
    }
    if (a === 'days') {
      var dd = count(ID + '-days');
      if (dd) { net(w + 'draft days ' + dd); }
    }
  }

  // A key keeps a line's count box the same element across an update (#4475).
  function line(inner, key) { return '<div class="line"' + (key ? ' data-row-key="' + esc(key) + '"' : '') + '>' + inner + '</div>'; }
  function btn(text, attrs) { return '<button ' + attrs + '>' + esc(text) + '</button>'; }
  function say(text, l) { return btn(text, 'data-act="say" data-line="' + esc(l) + '"'); }
  function options(list, valueOf, textOf, selected) {
    return list.map(function (x) { return '<option value="' + esc(valueOf(x)) + '"' +
      (selected !== undefined && valueOf(x) === selected ? ' selected' : '') + '>' + esc(textOf(x)) + '</option>'; }).join('');
  }

  function drawDock() {
    var b = '';
    if (data.note) { b += '<p class="note" role="status">' + esc(data.note) + '</p>'; }
    if (data.charter && !data.charter.may) { b += '<p class="note">' + esc(data.charter.why) + '</p>'; }
    var holds = data.holds || [];
    if (!holds.length) { b += '<p class="note">No ship is at this dock.</p>'; }
    holds.forEach(function (h) {
      var hid = esc(h.id);
      b += '<h3>' + hid + ', ' + esc(h.used) + ' of ' + esc(h.max) + ' lines</h3>';
      (h.lines || []).forEach(function (l) {
        var cid = ID + '-c-' + hid + '-' + l.line;
        var out = '<span class="nm">' + esc(l.count) + ' ' + esc(l.item) + ', for ' + esc(l.forName) + '</span>';
        var act = l.canCollect ? ['collect', 'Collect'] : (l.canReturn ? ['return', 'Take back'] : (l.canTake ? ['take', 'Take'] : null));
        if (act) {
          out += '<input id="' + cid + '" type="number" min="1" max="' + esc(l.count) + '" step="1" value="' + esc(l.count) + '" aria-label="Count">';
          out += btn(act[1], 'data-act="' + act[0] + '" data-hold="' + hid + '" data-line="' + esc(l.line) + '" data-count="' + cid + '"');
        }
        b += line(out, 'cargo:' + h.id + ':' + l.line);
      });
      if (h.canLoad && (data.pack || []).length && (data.people || []).length) {
        b += line('<select id="' + ID + '-piece-' + hid + '" aria-label="What to load">' +
          options(data.pack, function (p) { return p.base + ':' + p.nth; }, function (p) { return p.name + ' (' + p.count + ')'; }) + '</select>' +
          '<input id="' + ID + '-count-' + hid + '" type="number" min="1" step="1" value="1" aria-label="Count">' +
          '<label>for</label><select id="' + ID + '-for-' + hid + '" aria-label="Who it is for">' +
          options(data.people, function (p) { return p.actor; }, function (p) { return p.name; }) + '</select>' +
          btn('Load', 'data-act="load" data-hold="' + hid + '"'));
      }
      (h.sail || []).forEach(function (s) {
        b += line('<span class="nm">To ' + esc(s.name) + ', ' + esc(s.minutes) + ' minutes at sea</span>' +
          say('Sail', '/ship sail ' + h.id + ' ' + s.to));
      });
    });
    var inc = data.incoming || [];
    if (inc.length) {
      b += '<h3>Bound here</h3>';
      inc.forEach(function (s) { b += line('<span class="nm">' + esc(s.id) + ' from ' + esc(s.from) + ', due in ' + esc(s.dueIn) + ' minutes</span>'); });
    }
    return b;
  }

  /* The words staff read for a ship's places, or a cart's. */
  function places() {
    return isCart()
      ? { place: 'stop', places: 'stops', crate: 'cart stop', at: 'at a cart stop', route: 'road', none: 'No cart stops. A world with no carts.',
          vehicle: 'cart', put: 'Put a cart here', minutes: 'least minutes on the road' }
      : { place: 'port', places: 'ports', crate: 'dock', at: 'at a dock', route: 'route', none: 'No ports. A world with no ships.',
          vehicle: 'ship', put: 'Put a ship here', minutes: 'minutes' };
  }

  function drawStaff() {
    var b = '', P = places(), w = word() + ' ';
    if (data.note) { b += '<p class="note" role="status">' + esc(data.note) + '</p>'; }
    var inForce = data.inForce || { ports: [], routes: [] }, draft = data.draft || { ports: [], routes: [] };
    b += '<h3>In force</h3>';
    if (!inForce.ports.length) { b += '<p class="note">' + esc(P.none) + '</p>'; }
    inForce.ports.forEach(function (p) {
      b += line('<span class="nm">' + esc(p.name) + ' (' + esc(p.key) + ', ' + esc(p.hold) + ')' + (p.crate ? '' : ', no crate yet') +
        ', ' + (p.ships || []).length + ' ' + P.vehicle + '(s)</span>' + say(P.put, w + 'add ' + p.key));
    });
    inForce.routes.forEach(function (r) {
      b += line('<span class="nm">' + esc(r.from) + ' to ' + esc(r.to) + ', ' + esc(r.minutes) + ' ' + P.minutes +
        (isCart() ? '' : ', crew of ' + esc(r.crew)) + '</span>');
    });
    if (!isCart() && inForce.days) {
      b += line('<span class="nm">Cargo nobody collects goes to the hold\'s drop box after ' + esc(inForce.days) + ' days at the dock</span>');
    }
    var taken = data.taken || [];
    if (taken.length) {
      b += '<h3>Taken lately</h3>';
      taken.forEach(function (t) {
        b += line('<span class="nm">' + esc(t.count) + ' ' + esc(t.item) + ' from ' + esc(t.hold) + ', by ' + esc(t.by) +
          (t.at ? ', ' + esc(new Date(t.at).toLocaleString()) : '') + '</span>');
      });
    }
    if (isCart()) {
      var road = data.onRoad || [];
      b += '<h3>On the road</h3>';
      if (!road.length) { b += '<p class="note">No cart is on the road.</p>'; }
      road.forEach(function (c) {
        b += line('<span class="nm">' + esc(c.id) + ', ' + esc(c.from) + ' to ' + esc(c.to) +
          (c.dueIn ? ', ' + esc(c.dueIn) + ' minutes left' : ', the road is done') + (c.driver ? '' : ', its driver is gone') + '</span>' +
          say('Bring it in', w + 'bring ' + c.id));
      });
    }
    b += '<h3>Your draft</h3>';
    if (data.crate && data.crate.here) {
      b += data.crate.dockOf
        ? '<p class="note">The container you just opened is the ' + esc(P.crate) + ' of ' + esc(data.crate.dockOf) + '.</p>'
        : line('<span class="nm">The container you just opened, as a new ' + esc(P.place) + ':</span>' +
          '<input id="' + ID + '-pkey" type="text" maxlength="64" placeholder="key" aria-label="Key" aria-describedby="' + ID + '-key-rule">' +
          '<select id="' + ID + '-phold" aria-label="Hold">' + options(data.holdKeys || [], function (x) { return x; }, function (x) { return x; }) + '</select>' +
          '<input id="' + ID + '-pname" type="text" maxlength="64" placeholder="name people read" aria-label="Name">' +
          btn('Add ' + P.place, 'data-act="port"')) +
          '<p class="note" id="' + ID + '-key-rule">' + esc(KEY_RULE) + '</p>';
    } else {
      b += '<p class="note">Open a crate ' + esc(P.at) + ', then this page within a minute, to make it a ' + esc(P.place) +
        ' or move a ' + esc(P.place) + '\'s crate.</p>';
    }
    draft.ports.forEach(function (p) {
      b += line('<span class="nm">' + esc(p.name) + ' (' + esc(p.key) + ')</span>' +
        (data.crate && data.crate.here && !data.crate.dockOf ? say('Its crate is the one I opened', w + 'draft crate ' + p.key) : '') +
        say('Remove', w + 'draft unport ' + p.key));
    });
    draft.routes.forEach(function (r) {
      var cid = ID + '-m-' + r.from + '-' + r.to;
      b += line('<span class="nm">' + esc(r.from) + ' to ' + esc(r.to) + '</span>' +
        '<input id="' + esc(cid) + '" type="number" min="1" max="10080" step="1" value="' + esc(r.minutes) + '" aria-label="Minutes">' +
        btn('Set minutes', 'data-act="minutes" data-key="' + esc(r.from + ' ' + r.to) + '" data-count="' + esc(cid) + '"') +
        say('Remove', w + 'draft unroute ' + r.from + ' ' + r.to), 'route:' + r.from + ' ' + r.to);
    });
    if (!isCart()) {
      b += line('<span class="nm">Days cargo waits at the dock before the drop box</span>' +
        '<input id="' + ID + '-days" type="number" min="1" max="60" step="1" value="' + esc(draft.days || 7) + '" aria-label="Days">' +
        btn('Set days', 'data-act="days"'));
    }
    if (draft.ports.length > 1) {
      var keys = draft.ports.map(function (p) { return p.key; });
      b += line('<span class="nm">A new ' + esc(P.route) + '</span>' +
        '<select id="' + ID + '-rfrom" aria-label="From">' + options(keys, function (x) { return x; }, function (x) { return x; }) + '</select>' +
        '<select id="' + ID + '-rto" aria-label="To">' + options(keys, function (x) { return x; }, function (x) { return x; }, keys[1]) + '</select>' +
        '<input id="' + ID + '-rmin" type="number" min="1" max="10080" step="1" value="60" aria-label="Minutes">' +
        btn('Add ' + P.route, 'data-act="route"'));
    } else {
      b += '<p class="note">A ' + esc(P.route) + ' needs two different ' + esc(P.places) + '.</p>';
    }
    b += '<h3>If you confirm</h3>';
    var ch = data.changes || [], st = data.strands || [];
    if (!ch.length) { b += '<p class="note">The draft is the list in force.</p>'; }
    ch.forEach(function (c) { b += line('<span class="nm">' + esc(c) + '</span>'); });
    st.forEach(function (s) { b += line('<span class="nm">Refused: ' + esc(s) + '</span>'); });
    b += line((data.canConfirm ? say('Confirm', w + 'confirm ' + data.base) : '') + say('Back to the list in force', w + 'draft reset'));
    return b;
  }

  /* A line aboard with a count box and one button that sends it, for collect, return and take. */
  function countLine(text, act, holdId, l) {
    var cid = ID + '-c-' + holdId + '-' + l.line;
    return '<span class="nm">' + text + '</span>' +
      '<input id="' + cid + '" type="number" min="1" max="' + esc(l.count) + '" step="1" value="' + esc(l.count) + '" aria-label="Count">' +
      btn(act === 'collect' ? 'Collect' : (act === 'return' ? 'Take back' : 'Take'),
        'data-act="' + act + '" data-hold="' + esc(holdId) + '" data-line="' + esc(l.line) + '" data-count="' + cid + '"');
  }

  /* A cart stop (#3158): the carts standing here, a load, the roads out, and the carts on their way in. */
  function drawStop() {
    var b = '';
    if (data.note) { b += '<p class="note" role="status">' + esc(data.note) + '</p>'; }
    if (data.driving) {
      b += '<p class="note">You are driving ' + esc(data.driving.id) + ' to ' + esc(data.driving.to) + '. It comes in at that stop\'s crate.</p>';
    }
    var carts = data.carts || [];
    if (!carts.length) { b += '<p class="note">No cart is at this stop.</p>'; }
    carts.forEach(function (c) {
      var cid = esc(c.id);
      b += '<h3>' + cid + ', ' + esc(c.used) + ' of ' + esc(c.max) + ' lines</h3>';
      (c.lines || []).forEach(function (l) {
        var text = esc(l.count) + ' ' + esc(l.item) + ', for ' + esc(l.forName);
        var lineKey = 'cargo:' + c.id + ':' + l.line;
        if (l.canCollect) { b += line(countLine(text, 'collect', c.id, l), lineKey); }
        else if (l.canReturn) { b += line(countLine(text, 'return', c.id, l), lineKey); }
        else { b += line('<span class="nm">' + text + '</span>', lineKey); }
      });
      if (c.others) { b += '<p class="note">' + esc(c.others) + ' more line(s) on it for other people.</p>'; }
      if (c.canLoad && (data.pack || []).length && (data.people || []).length) {
        b += line('<select id="' + ID + '-piece-' + cid + '" aria-label="What to load">' +
          options(data.pack, function (p) { return p.base + ':' + p.nth; }, function (p) { return p.name + ' (' + p.count + ')'; }) + '</select>' +
          '<input id="' + ID + '-count-' + cid + '" type="number" min="1" step="1" value="1" aria-label="Count">' +
          '<label>for</label><select id="' + ID + '-for-' + cid + '" aria-label="Who it is for">' +
          options(data.people, function (p) { return p.actor; }, function (p) { return p.name; }) + '</select>' +
          btn('Load', 'data-act="load" data-hold="' + cid + '"'));
      }
      (c.drive || []).forEach(function (d) {
        b += line('<span class="nm">To ' + esc(d.name) + ', at least ' + esc(d.minutes) + ' minutes on the road</span>' +
          say('Drive', '/cart drive ' + c.id + ' ' + d.to));
      });
    });
    var inc = data.incoming || [];
    if (inc.length) {
      b += '<h3>On the way here</h3>';
      inc.forEach(function (c) {
        b += line('<span class="nm">' + esc(c.id) + ' from ' + esc(c.from) +
          (c.dueIn ? ', in ' + esc(c.dueIn) + ' minutes at the soonest' : '') + (c.mine ? ', which you drive' : '') + '</span>' +
          (c.canPullIn ? say('Pull in', '/cart pullin ' + c.id) : ''));
      });
    }
    return b;
  }

  /* A raid on a cart on the road (#3158): every piece aboard, and Take. */
  function drawRaid() {
    var b = '';
    if (data.note) { b += '<p class="note" role="status">' + esc(data.note) + '</p>'; }
    b += '<p class="note">' + esc(data.driver) + '\'s cart, on the road from ' + esc(data.road && data.road.from) +
      ' to ' + esc(data.road && data.road.to) + '. Whatever you take is written down as taken by you.</p>';
    var lines = data.lines || [];
    if (!lines.length) { b += '<p class="note">Nothing is left on it.</p>'; }
    lines.forEach(function (l) { b += line(countLine(esc(l.count) + ' ' + esc(l.item), 'take', data.cart, l), 'cargo:' + data.cart + ':' + l.line); });
    return b;
  }

  function draw() {
    build();
    if (!data || data.open !== true) { close(); return; }
    root.className = 'on';
    var was = shown;
    shown = true;
    root.querySelector('#' + ID + '-title').textContent = data.mode === 'staff' ? (isCart() ? 'Cart stops and roads' : 'Ports and routes') :
      data.mode === 'raid' ? 'A cart on the road' :
      data.mode === 'stop' ? ((data.stop && data.stop.name) || 'The cart stop') :
      ((data.port && data.port.name) || 'The dock');
    var html = data.mode === 'staff' ? drawStaff() :
      data.mode === 'stop' ? drawStop() : data.mode === 'raid' ? drawRaid() : drawDock();
    // In place, so a count being typed and its focus outlast the update (#4475).
    var host = root.querySelector('#' + ID + '-body');
    if (window.thornswoodDialog) window.thornswoodDialog.patch(host, html, JSON.stringify([data.mode, data.port && data.port.name, data.stop && data.stop.name, data.cart])); else host.innerHTML = html;
    if (!was) {
      if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
      tell('opened');
    }
  }

  function open() { draw(); }
  function close() {
    if (root) { root.className = ''; }
    if (shown) { tell('closed'); }
    shown = false;
  }
  function setData(next) {
    data = next || null;
    if (!data || data.open !== true) { close(); } else { draw(); }
  }

  document.addEventListener('keydown', function (ev) {
    if (!shown) { return; }
    if (ev.key === 'Escape') { ev.preventDefault(); net(word() + ' close'); close(); }
  });

  window.thornswoodShip = {
    open: open, close: close, setData: setData,
    isOpen: function () { return shown; }
  };
  tell('ready');
})();
