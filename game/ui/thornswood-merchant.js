'use strict';
/*
  The guild trader panel.

  The server owns the purse, the shelf and the price. This page only draws
  what /merchant already checked and sends the same command back. It cannot
  move gold or goods. People cannot join the guild from here.
*/
(function () {
  if (window.thornswoodMerchant) { return; }
  var ID = 'ts-merchant';
  var data = null;
  var shown = false;
  var root = null;
  var gemChoices = {};
  var dismissed = null;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'merchant:' + what); }
    catch (e) { }
  }
  function net(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) {
        return window.thornswoodNet.say(line) === true;
      }
    } catch (e) { }
    return false;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:760px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);',
    '  display:grid;grid-template-rows:auto 1fr auto;background:rgba(11,10,8,.94);',
    '  border:1px solid rgba(198,170,109,.42);outline:1px solid rgba(198,170,109,.14);',
    '  outline-offset:4px;box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .body{overflow:auto;padding:14px 18px;font-size:16px}',
    '#' + ID + ' .note{color:rgba(217,207,180,.75);font-style:italic;margin:0 0 12px}',
    '#' + ID + ' .line{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .nm{flex:1;min-width:140px}',
    '#' + ID + ' h3{font-size:20px;font-weight:normal;color:#f6e9c8;margin:16px 0 10px}',
    '#' + ID + ' .quest-copy{flex:1;min-width:240px}',
    '#' + ID + ' .quest-copy p{margin:4px 0;font-size:14px;line-height:1.5}',
    '#' + ID + ' select{font:inherit;color:#f6e9c8;background:#17140f;border:1px solid #ac9564;padding:6px;max-width:100%}',
    '#' + ID + ' input[type=number]{width:5em;font:inherit;color:#f6e9c8;background:#17140f;border:1px solid #ac9564;padding:6px}',
    '#' + ID + ' button{font-family:inherit;cursor:pointer;border:1px solid rgba(198,170,109,.55);',
    '  background:rgba(0,0,0,.25);color:#e9d19b;padding:5px 10px;font-size:15px;line-height:20px;',
    '  letter-spacing:.14em;text-transform:uppercase}',
    '#' + ID + ' button:disabled{opacity:.45}',
    '#' + ID + ' .foot{padding:12px 20px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:12px;align-items:center}'
  ].join('\n');

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML = '<div class="panel" role="dialog" aria-modal="true" aria-labelledby="' + ID + '-title"><h2 id="' + ID + '-title">Trader</h2>' +
      '<div class="body" id="' + ID + '-body"></div>' +
      '<div class="foot"><span id="' + ID + '-purse"></span><span style="flex:1"></span>' +
      '<button id="' + ID + '-close">Step back</button></div></div>';
    document.body.appendChild(root);
    root.querySelector('#' + ID + '-close').onclick = function () { net('/merchant close'); close(); };
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      if (ev.key === 'Escape') { ev.preventDefault(); net('/merchant close'); close(); }
    });
    return root;
  }
  function draw() {
    build();
    if (!data || data.open === false) { close(); return; }
    root.className = 'on';
    var was = shown;
    shown = true;
    root.querySelector('#' + ID + '-title').textContent =
      (data.trader || 'Trader') + (data.place ? ' at ' + data.place : '');
    root.querySelector('#' + ID + '-purse').textContent = 'Purse ' + (data.purse == null ? '' : data.purse)+
      (data.reservedPurse?' ('+data.reservedPurse+' promised for work)':'');
    var body = '';
    if (data.note) body += '<p class="note" role="status">' + esc(data.note) + '</p>';
    // Offer only work the server says can be taken. Accepted work keeps its
    // return/leave controls even when its original requirements no longer hold.
    var quests = (data.quests || []).filter(function (quest) { return quest.state === 'open' || quest.canTake === true; });
    body += '<h3>Work from the guild</h3>';
    if (!quests.some(function (quest) { return quest.canTake === true; })) {
      body += '<p class="note" role="status">I have nothing for you at the moment.</p>';
    }
    for (var q = 0; q < quests.length; q++) {
      var quest = quests[q];
      var location = typeof quest.locations === 'string' ? quest.locations : Object.keys(quest.locations || {}).map(function(gem){
        return gem + ': ' + quest.locations[gem];
      }).join('; ');
      if (quest.gem && quest.locations && typeof quest.locations === 'object') location = quest.locations[quest.gem] || location;
      var status = quest.state === 'open' ? (quest.waiting?'Waiting for the saved trade.':quest.kind==='commission'?'Accepted; payment reserved.':quest.kind==='retrieval'?(quest.drawn>=1?'Item collected.':'Find the named item.'):quest.kind==='kill' ? 'Defeated '+quest.kills+' of '+quest.count :
        'Drawn ' + quest.drawn + ' of ' + quest.holds + (quest.gem ? ', ' + quest.gem : '')) :
        quest.state === 'cooldown' ? ('Returns in ' + quest.waitMinutes + ' minutes') : quest.state === 'locked' ? ('Requires ' + quest.who) :
        quest.state==='unavailable' ? 'This work is unavailable.' : 'Available';
      var terms=quest.kind==='commission'?'Deliver '+(Array.isArray(quest.goods)?quest.goods.map(function(good){return good.count+' '+good.name;}).join('; '):quest.count+' '+quest.item)+'. '+
        (quest.gold===null?'No submitted payment is available.':'Payment '+quest.gold+' gold.')+
        ' Return to this specialist. This work rests for '+quest.hours+' hours after the trade settles.':quest.kind==='retrieval' ?
        'Retrieve one item. Reward '+quest.gold+' gold. Return to the named specialist. Rests for '+quest.hours+' hours.':quest.kind==='kill' ? 'Defeat '+quest.count+' at this place. Reward '+quest.gold+' gold. '+
        (quest.exactMerchant?'Return to this specialist.':'Return to a guild trader in this hold.')+' Returns after '+quest.hours+' hours.' :
        'Draw up to '+quest.holds+', return '+quest.ask+' to finish, and keep the rest. Returns after '+quest.hours+' hours.';
      body += '<div class="line"><div class="quest-copy"><strong>' + esc(quest.name) + '</strong>' +
        '<p>' + esc(location) + '</p><p>'+esc(terms)+'</p>'+(quest.check?'<p>'+esc(quest.check)+'</p>':'')+'<p>' + esc(status) + '</p>'+
        (quest.recovery ? '<p>Leave this older work before taking it again. Its progress could not be verified.</p>' : '')+'</div>';
      if (quest.state === 'open') {
        var token=Number.isSafeInteger(quest.token) && quest.token>0 ? ' data-token="'+esc(quest.token)+'"' : '';
        body += '<button data-quest="' + esc(quest.id) + '" data-action="return"'+token + (quest.canReturn ? '' : ' disabled') + '>Turn in work</button>' +
          '<button data-quest="' + esc(quest.id) + '" data-action="abandon"'+token + (quest.canAbandon ? '' : ' disabled') + '>'+(quest.kind==='kill'||quest.kind==='commission'?'Leave work':'Give back and leave')+'</button>';
      } else {
        var gems = quest.gems || [], chosen = gemChoices[quest.id] || '';
        if (gems.length) {
          body += '<select data-gem="' + esc(quest.id) + '" aria-label="Gem for ' + esc(quest.name) + '"' + (quest.canTake ? '' : ' disabled') + '><option value="">Choose a gem</option>';
          for (var g = 0; g < gems.length; g++) body += '<option value="' + esc(gems[g]) + '"' + (chosen === gems[g] ? ' selected' : '') + '>' + esc(gems[g]) + '</option>';
          body += '</select>';
        }
        var quote=quest.kind==='commission'&&typeof quest.quoteToken==='string'&&/^[0-9a-f]{64}$/.test(quest.quoteToken)?' data-token="'+esc(quest.quoteToken)+'"':
          quest.kind==='commission'&&Number.isSafeInteger(quest.quotedUnit)&&quest.quotedUnit>=0?' data-token="'+esc(quest.quotedUnit)+'"':'';
        body += '<button data-quest="' + esc(quest.id) + '" data-action="take"'+quote+' data-ready="' + (quest.canTake ? 'yes' : 'no') + '"' +
          (quest.canTake && (!gems.length || chosen) ? '' : ' disabled') + '>Take work</button>';
      }
      body += '</div>';
    }
    body += '<h3>Sell from your pack</h3>';
    var rows = data.offers || [];
    var saleCount = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!Number.isInteger(row.maxSell) || row.maxSell < 1) continue;
      saleCount++;
      body += tradeLine(row, 'sell', i, row.maxSell);
    }
    if (!saleCount) body += '<p class="note" role="status">' + esc(data.sellReason || 'This trader cannot buy anything from your pack right now.') + '</p>';
    body += '<h3>Buy from their shelf</h3>';
    var shelfCount = 0;
    for (var j = 0; j < rows.length; j++) {
      var shelf = rows[j];
      if (!Number.isInteger(shelf.sell) || shelf.sell < 0 || !(shelf.stock > 0)) continue;
      shelfCount++;
      body += tradeLine(shelf, 'buy', j, Math.min(shelf.stock, 100000));
    }
    if (!shelfCount) body += '<p class="note">This trader has no goods for sale.</p>';
    var supply = data.supply || [];
    for (var s = 0; s < supply.length; s++) {
      if (!supply[s].ready) continue;
      body += '<div class="line"><span class="nm">Supply ' + esc(supply[s].count) + ' ' + esc(supply[s].name) +
        ' for ' + esc(supply[s].pay) + '</span>' +
        '<button data-verb="supply" data-name="' + esc(supply[s].name) + '" data-price="' + supply[s].unit + '"' + (data.canTrade ? '' : ' disabled') + '>Turn in</button></div>';
    }
    var host = root.querySelector('#' + ID + '-body');
    host.innerHTML = body;
    var buttons = host.querySelectorAll('button');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].onclick = function (ev) {
        var el = ev.currentTarget;
        var questId = el.getAttribute('data-quest');
        if (questId) {
          // Availability comes from the server view. Chat transport has no
          // per-command acknowledgement, so it cannot own a pending button.
          var token=el.getAttribute('data-token');
          net('/merchant quest ' + el.getAttribute('data-action') + ' ' + questId +
            (token ? ' @'+token : gemChoices[questId] ? ' ' + gemChoices[questId] : ''));
          return;
        }
        var verb = el.getAttribute('data-verb');
        var name = el.getAttribute('data-name');
        if (verb === 'supply') net('/merchant supply @' + el.getAttribute('data-price') + ' ' + name);
        else {
          var input = document.getElementById(el.getAttribute('data-count'));
          var count = input ? Number(input.value) : 0;
          if (!Number.isInteger(count) || count < 1 || count > Number(input.max)) {
            if (input) { input.setCustomValidity('Choose a whole count from 1 to ' + input.max + '.'); input.reportValidity(); }
            return;
          }
          input.setCustomValidity('');
          net('/merchant ' + verb + ' ' + count + ' @' + el.getAttribute('data-price') + ' ' + name);
        }
      };
    }
    var selects = host.querySelectorAll('select[data-gem]');
    for (var c = 0; c < selects.length; c++) {
      selects[c].onchange = function(ev) {
        var el = ev.currentTarget, id = el.getAttribute('data-gem');
        gemChoices[id] = el.value;
        var take = host.querySelector('button[data-quest="' + id + '"][data-action="take"]');
        if (take) take.disabled = take.getAttribute('data-ready') !== 'yes' || !el.value;
      };
    }
    if (!was && window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
    tell('opened');
  }
  function tradeLine(row, verb, index, maximum) {
    var countId = ID + '-' + verb + '-' + index;
    var selling = verb === 'sell';
    return '<div class="line"><span class="nm">' + esc(row.name) + '</span>' +
      '<span>' + esc(selling ? row.buy : row.sell) + ' gold each</span>' +
      '<span>' + (selling ? 'Pack ' + esc(row.carried) : 'Shelf ' + esc(row.stock)) + '</span>' +
      '<label for="' + countId + '">Count</label><input id="' + countId + '" type="number" min="1" max="' + maximum + '" step="1" value="1" aria-label="' +
      (selling ? 'Sell count for ' : 'Buy count for ') + esc(row.name) + '">' +
      '<button data-verb="' + verb + '" data-name="' + esc(row.name) + '" data-price="' + (selling ? row.buy : row.sell) + '" data-count="' + countId + '"' +
      (data.canTrade ? '' : ' disabled') + '>' + (selling ? 'Sell' : 'Buy') + '</button></div>';
  }
  function open() { dismissed=null; draw(); }
  function close() {
    if (data && data.open !== false) dismissed=data.sessionId || 'legacy';
    if (root) root.className = '';
    if (shown) tell('closed');
    shown = false;
  }
  function setData(next) {
    data = next || null;
    if (!data || data.open === false) close();
    else if (dismissed !== (data.sessionId || 'legacy')) draw();
  }
  window.thornswoodMerchant = { open: open, close: close, setData: setData, isOpen: function () { return shown; } };
  tell('ready');
})();
