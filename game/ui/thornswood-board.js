'use strict';
/*
  The notice board, opened by clicking it while you are standing at it.

  THE CONTRACT with thornswood-front.js, the same shape the party panel uses:

    window.thornswoodBoard = { open, close, toggle, isOpen, setData }
    page -> plugin  'board:ready' | 'board:opened' | 'board:closed'
                    'board:near x y z here'

  Everything this panel DOES it does by sending the ordinary lines, through
  window.thornswoodNet.say. There is no second protocol. The labels are
  words. The lines are how the panel talks to the server, and nobody is told
  to type one (Patrick, 4 Oct: no chat commands for anything people do).
  Make a post sends /board-post-v1 (#4771); Take, Take down, Put it back
  and Pay the reward send /take, /board-unpin-v1, /dropjob and /job done (#1627,
  #2554); Send a haul and Confirm send /haul (#1393); Write a letter sends
  /letter-post-v1 (#4412).

  setData never opens the panel. E on the board does: the server answers it
  (#2516) on thornswoodBoardOpen, which calls open(). A later setData redraws
  what is already open, and the plugin closes it once you walk away.

  A POST HAS A TITLE AND A BODY (#2554). Patrick, 15 Oct: a Make a post
  button, apart from the list and pinned to the bottom of the board, so the
  posts above it scroll freely. It asks for a title, the body, and Job or
  Notice, and a job also asks for its reward. The list shows each post's
  title, Job or Notice, a job's reward, who posted it and when; Read opens
  it, which shows its body and, on a job, Take.
*/
(function () {
  if (window.thornswoodBoard) { return; }

  var ID = 'ts-board';
  var TITLE_CHARS = 60;
  var BODY_CHARS = 600;
  var data = null;
  var shown = false;
  var root = null;
  var takedownArm = null, takedownTimer = 0, takedownHeld = '';
  var boardFieldError = null;

  /*
    WHAT MAKE A POST KEEPS. The draft is kept here as it is typed, so a
    redraw, a walk away or Back loses nothing. The form is drawn once when
    it opens and left alone after that: a push from the server while
    somebody is typing would otherwise rebuild the box under the cursor.
    `pending` is the title just sent and the newest number on the wall at
    that moment; the post is up once a post of yours with that title and a
    higher number is on the wall, and then the form closes. A refusal is
    answered in the chat and the draft stays to be fixed.
  */
  var composing = false;
  var formDrawn = false;
  var draft = { kind: 'notice', title: '', body: '', reward: '' };
  var pending = null;
  var said = '';
  var opened = {};

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'board:' + what); }
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

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* When a post went up, on this machine's clock: 6:43 PM, 15 Oct. */
  function when(at) {
    var t = Number(at);
    if (!(t > 0)) { return ''; }
    var d = new Date(t);
    var h = d.getHours();
    var m = d.getMinutes();
    var half = h < 12 ? 'AM' : 'PM';
    h = h % 12;
    if (h === 0) { h = 12; }
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + half + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  /*
    THE LOOK IS THE PARTY PANEL'S, which is the K panel's. Every colour
    below is one that panel already uses. No :hover and no transitions.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:720px;max-width:calc(100vw - 48px);height:640px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22);display:flex;align-items:baseline;gap:14px}',
    '#' + ID + ' h2 .sub{font-size:14px;color:rgba(217,207,180,.6);font-style:italic}',
    '#' + ID + ' .body{overflow:auto;padding:16px 24px;display:block;',
    '  font-size:16px}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:10px;align-items:center;justify-content:flex-end}',
    '#' + ID + ' .foot .make{margin-right:auto}',
    '#' + ID + ' h3{margin:16px 0 8px;padding-bottom:6px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);font-weight:normal;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' h3:first-child{margin-top:0}',
    '#' + ID + ' .row{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap;',
    '  border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);margin-bottom:8px}',
    '#' + ID + ' .row .nm{flex:1;min-width:160px;font-size:16px;line-height:1.35}',
    '#' + ID + ' .row .nm.open{cursor:pointer}',
    '#' + ID + ' .row .meta{font-size:13.5px;color:rgba(217,207,180,.7)}',
    '#' + ID + ' .row .read{flex-basis:100%;white-space:pre-wrap;line-height:1.55;font-size:16px;',
    '  padding:8px 2px 2px;border-top:1px solid rgba(198,170,109,.18)}',
    '#' + ID + ' .row .acts{flex-basis:100%;display:flex;gap:8px;justify-content:flex-end}',
    '#' + ID + ' .tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button[data-confirm]{max-width:100%;white-space:normal;overflow-wrap:anywhere}',
    '#' + ID + ' .action-status{flex:1;min-width:0;overflow-wrap:anywhere;color:#e9d19b}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .none{color:rgba(217,207,180,.6);font-style:italic;padding:6px 2px}',
    '#' + ID + ' .note{color:rgba(217,207,180,.7);font-size:12.5px;line-height:1.5;margin-top:8px}',
    '#' + ID + ' .said{color:#e9d19b;font-size:14px;line-height:1.5;margin-top:8px}',
    '#' + ID + ' .line{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
    '#' + ID + ' input,#' + ID + ' textarea{font-family:inherit;font-size:16px;color:#d9cfb4;background:rgba(0,0,0,.25);',
    '  border:1px solid rgba(198,170,109,.42);padding:8px 10px;width:100%;box-sizing:border-box}',
    '#' + ID + ' textarea{resize:none;height:220px;line-height:1.5}',
    '#' + ID + ' input.pay{width:110px;flex:none}',
    '#' + ID + ' select{font-family:inherit;font-size:16px;color:#d9cfb4;background:rgba(11,10,8,.94);',
    '  border:1px solid rgba(198,170,109,.42);padding:8px 10px;flex:none}',
    '#' + ID + ' ::-webkit-scrollbar{width:10px;height:10px}',
    '#' + ID + ' ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#' + ID + ' ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    '  background-clip:padding-box;border-radius:6px}',
    '#' + ID + ' ::-webkit-scrollbar-thumb:active{background:rgba(233,209,155,.55);background-clip:padding-box}',
    '#' + ID + ' ::-webkit-scrollbar-corner{background:transparent}'
  ].join('\n');

  function build() {
    if (root) { return; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    // Make a post is in the foot, apart from the list, so it stays put while
    // the posts above it scroll (#2554).
    root.innerHTML =
      '<div class="panel"><h2>Notice board</h2><div class="body"></div>' +
      '<div class="foot"><span class="action-status" id="' + ID + '-action-status" role="status" aria-live="polite"></span>' +
      '<button class="go make" data-do="compose">Make a post</button>' +
      '<button class="shut" data-do="close">Close</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('input', resetTakedown);
    function editBoardField(ev) { if (boardFieldError && (!boardFieldError.field || ev.target === boardFieldError.field)) clearBoardFieldError(); }
    root.addEventListener('input', editBoardField);
    root.addEventListener('change', editBoardField);
    root.addEventListener('click', function (ev) {
      if (takedownArm && ev.target !== takedownArm.button) resetTakedown();
    }, true);
    root.addEventListener('keydown', function (ev) {
      if (!shown || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      if (takedownHeld) { ev.preventDefault(); ev.stopPropagation(); return; }
      var b = ev.target;
      if (!b || b.tagName !== 'BUTTON' || b.getAttribute('data-do') !== 'unpin') return;
      ev.preventDefault(); ev.stopPropagation();
      if (ev.repeat) return;
      takedownHeld = ev.key; b.click();
    }, true);
    document.addEventListener('keyup', function (ev) {
      if (ev.key === takedownHeld) { takedownHeld = ''; ev.preventDefault(); }
    });
    window.addEventListener('blur', function () { takedownHeld = ''; resetTakedown(); });
    root.addEventListener('click', function (e) {
      if (e.target === root) { close(); }
    });
  }

  function field(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  // Own the exact note, description token and native error installed here.
  // Replaced notes, newer messages and other validation owners survive cleanup.
  function clearBoardFieldError() {
    var error = boardFieldError;
    if (!error) return;
    boardFieldError = null;
    var field = error.field;
    if (field) {
      var ownsValidity = field.validity.customError && field.validationMessage === error.reason;
      var newerError = field.validity.customError && !ownsValidity;
      if (ownsValidity) field.setCustomValidity(error.custom);
      if (field.getAttribute('aria-invalid') === 'true' && !newerError) {
        if (error.invalid == null) field.removeAttribute('aria-invalid');
        else field.setAttribute('aria-invalid', error.invalid);
      }
      var currentNote = root.querySelector('#' + error.token);
      if (error.added && (!currentNote || (currentNote === error.note && error.note.textContent === error.reason))) {
        var now = field.getAttribute('aria-describedby');
        var remaining = now === error.installed ? error.described :
          String(now || '').split(/\s+/).filter(function (id) { return id && id !== error.token; }).join(' ');
        if (remaining == null || remaining === '') field.removeAttribute('aria-describedby');
        else field.setAttribute('aria-describedby', remaining);
      }
    }
    if (error.note.textContent === error.reason) {
      error.note.textContent = ''; error.note.style.display = 'none';
    }
  }

  function showBoardReason(noteId, reason) {
    var note = root.querySelector('#' + ID + '-' + noteId);
    if (!note || !root.contains(note)) return null;
    boardFieldError = {field:null,reason:reason,note:note,token:note.id};
    note.textContent = reason; note.style.display = 'block';
    return boardFieldError;
  }

  function needBoardField(id, value, reason, noteId) {
    var field = root.querySelector('#' + ID + '-' + id);
    if (!field || !root.contains(field)) return false;
    if (value) return true;
    var error = showBoardReason(noteId, reason);
    if (!error) return false;
    var described = field.getAttribute('aria-describedby');
    var added = String(described || '').split(/\s+/).indexOf(error.token) < 0;
    var installed = added ? (described ? described + ' ' : '') + error.token : described;
    error.field = field; error.custom = field.validity.customError ? field.validationMessage : '';
    error.invalid = field.getAttribute('aria-invalid'); error.described = described;
    error.added = added; error.installed = installed;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', installed);
    field.setCustomValidity(reason); field.focus(); field.reportValidity();
    return false;
  }

  /* The newest number on the wall: what a post sent now will be above. */
  function topN(b) {
    var wall = (b && b.wall) || [];
    var top = 0;
    for (var i = 0; i < wall.length; i++) { top = Math.max(top, Number(wall[i].n) || 0); }
    return top;
  }

  function isUp(b) {
    if (!pending) { return false; }
    if (pending.hold !== b.hold || draft.title !== pending.title || draft.body !== pending.body ||
        draft.kind !== pending.kind || (pending.kind === 'job' && Number(draft.reward) !== pending.reward)) return false;
    var wall = (b && b.wall) || [];
    for (var i = 0; i < wall.length; i++) {
      var r = wall[i];
      // Match the complete published text, not merely a newer same-title row.
      // An older accepted post must not erase what is being written now.
      if (r.mine && !r.letter && !r.haul && r.title === pending.title && r.text === pending.body &&
          !!r.job === (pending.kind === 'job') && (!r.job || Number(r.reward) === pending.reward) &&
          Number(r.n) > pending.top) { return true; }
    }
    return false;
  }

  /* A notice or a job (#2554); a letter and a haul keep their one line. */
  function plain(row) { return !row.letter && !row.haul; }

  function draw() {
    if (window.thornswoodDialog) { window.thornswoodDialog.redraw(root, drawContents); return; }
    drawContents();
  }

  function drawContents() {
    resetTakedown();
    clearBoardFieldError();
    if (!root) { return; }
    var title = root.querySelector('h2');
    var body = root.querySelector('.body');
    var make = root.querySelector('.make');
    var b = data && data.board;
    if (!b || !b.here) {
      title.innerHTML = 'Notice board';
      body.innerHTML = '<div class="none">Step up to the board.</div>';
      formDrawn = false;
      if (make) { make.style.display = 'none'; }
      return;
    }
    title.innerHTML = esc(b.where || 'Notice board') +
      ' <span class="sub">' + esc(String(b.paid || 0)) + ' gold paid in</span>';
    if (isUp(b)) {
      pending = null;
      said = '';
      composing = false;
      draft = { kind: draft.kind, title: '', body: '', reward: '' };
    }
    if (make) { make.style.display = composing ? 'none' : ''; }
    if (composing) { drawForm(body); return; }
    formDrawn = false;
    drawList(b, body);
  }

  function drawList(b, body) {
    var keptPay = field(ID + '-pay');
    var keptDest = field(ID + '-dest');
    var keptHaul = field(ID + '-haul');
    var keptTo = field(ID + '-to');
    var keptLetter = field(ID + '-letter');
    var out = '<h3>On the board</h3>';
    var wall = b.wall || [];
    if (!wall.length) { out += '<div class="none">Nothing on it.</div>'; }
    for (var i = 0; i < wall.length; i++) {
      var row = wall[i];
      var tools = '';
      /*
        Take down stays on the row, for the poster and for a guard of this
        hold, who takes down any post on its board (#502). Pay the reward is
        the poster's, once somebody has taken the job (#2554).
      */
      if (plain(row) && row.job && row.mine && row.taken) {
        tools += '<button class="go" data-do="paid" data-n="' + esc(row.n) + '">Pay the reward</button>';
      }
      if ((row.mine && !(row.job && row.taken)) || (row.haul && b.steward) || b.guard) {
        tools += '<button data-do="unpin" data-n="' + esc(row.n) + '">Take down</button>';
      }
      if (row.held) {
        tools += '<button data-do="drop" data-n="' + esc(row.n) + '">' +
          (row.haul ? 'Hand it back' : 'Put it back') + '</button>';
      }
      var who = row.taken ? ', taken by ' + esc(row.taken) : '';
      if (!plain(row)) {
        var kind = row.letter ? 'Letter' : 'Haul';
        if (row.job && !row.taken && !row.mine) {
          tools = '<button class="go" data-do="take" data-n="' + esc(row.n) + '">Take</button>' + tools;
        }
        out += '<div class="row"><span class="nm"><b>' + esc(row.n) + '.</b> ' + kind +
          ', ' + esc(row.name) + who + '<br>' + esc(row.text) + '</span><span class="tools">' + tools +
          '</span></div>';
        continue;
      }
      var key = 'w' + row.n;
      var isOpen = !!opened[key];
      var meta = (row.job ? 'Job, ' + esc(String(Number(row.reward) || 0)) + ' gold reward' : 'Notice') +
        ', ' + esc(row.name) + (row.at ? ', ' + esc(when(row.at)) : '') + who;
      out += '<div class="row"><span class="nm open" data-do="open" data-key="' + key + '"><b>' + esc(row.n) +
        '.</b> ' + esc(row.title) + '<br><span class="meta">' + meta + '</span></span><span class="tools">' +
        '<button data-do="open" data-key="' + key + '">' + (isOpen ? 'Hide' : 'Read') + '</button>' + tools +
        '</span>';
      if (isOpen) {
        out += '<div class="read">' + esc(row.text) + '</div>';
        // Opening a job shows Take (Patrick, 15 Oct, #2554).
        if (row.job && !row.taken && !row.mine) {
          out += '<div class="acts"><button class="go" data-do="take" data-n="' + esc(row.n) + '">Take</button></div>';
        }
      }
      out += '</div>';
    }
    var older = Number(b.older) || 0;
    if (older > 0) {
      out += '<div class="note">' + esc(String(older)) + (older === 1 ? ' older one is' : ' older ones are') +
        ' up and not on the wall.</div>';
    }
    /*
      YOUR JOBS (#1627): every job you have taken, in every town, which was
      /jobs. A job goes back only at the board it came from, so Put it back
      is on the rows of this board and the others say where theirs is.
    */
    var jobs = b.jobs || [];
    out += '<h3>Your jobs</h3>';
    if (!jobs.length) { out += '<div class="none">You have taken none.</div>'; }
    for (var j = 0; j < jobs.length; j++) {
      var mine = jobs[j];
      var what = mine.letter ? 'Letter' : (mine.haul ? 'Haul' : 'Job');
      var jkey = 'j' + mine.hold + ':' + mine.n;
      var jopen = !!opened[jkey];
      var line = plain(mine)
        ? esc(mine.title) + '<br><span class="meta">' + esc(String(Number(mine.reward) || 0)) + ' gold reward</span>'
        : esc(mine.text);
      out += '<div class="row"><span class="nm"><b>' + esc(mine.n) + '.</b> ' + what + ', ' +
        esc(mine.where || mine.hold) + ', for ' + esc(mine.name) + '<br>' + line +
        '</span><span class="tools">';
      if (plain(mine)) {
        out += '<button data-do="open" data-key="' + jkey + '">' + (jopen ? 'Hide' : 'Read') + '</button>';
      }
      if (mine.hold === b.hold) {
        out += '<button data-do="drop" data-n="' + esc(mine.n) + '">' +
          (mine.haul ? 'Hand it back' : 'Put it back') + '</button>';
      } else {
        out += '<span class="none">Back at ' + esc(mine.where || mine.hold) + '</span>';
      }
      out += '</span>';
      if (plain(mine) && jopen) { out += '<div class="read">' + esc(mine.text) + '</div>'; }
      out += '</div>';
    }
    /*
      A LETTER (#1595, docs/systems/noticeboards.md): who it is for and the
      words, up to 300 characters. The name and words use separate URI tokens;
      quotes and spaces remain part of the same recipient name. The name is
      held to 60, the same as a post's title.
    */
    out += '<h3>Write a letter</h3>';
    out += '<div class="line"><input id="' + ID + '-to" aria-label="Letter recipient" maxlength="60" placeholder="who it is for"></div>';
    out += '<div class="line"><input id="' + ID + '-letter" aria-label="Letter text" maxlength="300" placeholder="the letter">' +
      '<button class="go" data-do="letter">Post the letter</button></div>';
    out += '<div class="said" id="' + ID + '-letter-reason" role="status" aria-live="polite" style="display:none"></div>';
    out += '<div class="note">35 gold: 20 for the board, and 15 held for whoever carries it, paid to them ' +
      'when they hand it over. Up to 300 characters. Only the person it is for reads it. ' +
      'Taken down before then, the 15 comes back to you.</div>';
    /*
      A HAUL (#1393, docs/systems/trading-company.md): a job with a pay and a
      town it goes to. The towns are every board but this one, from the
      server.
    */
    var dests = b.dests || [];
    if (dests.length) {
      out += '<h3>Send a haul</h3>';
      out += '<div class="line"><input class="pay" id="' + ID + '-pay" aria-label="Haul pay in gold" placeholder="pay">' +
        '<select id="' + ID + '-dest">';
      for (var d = 0; d < dests.length; d++) {
        out += '<option value="' + esc(dests[d].hold) + '">' + esc(dests[d].where) + '</option>';
      }
      out += '</select></div>';
      out += '<div class="line"><input id="' + ID + '-haul" aria-label="Haul cargo" placeholder="what it carries">' +
        '<button class="go" data-do="haul">Send a haul</button></div>';
      out += '<div class="said" id="' + ID + '-haul-reason" role="status" aria-live="polite" style="display:none"></div>';
      out += '<div class="note">30 gold for the board, and the pay, both held with this hold. ' +
        'At the town it goes to, you or a steward confirm it on that board, and the hauler is paid. ' +
        'The company keeps a tenth of the pay, and nothing under 10. Handed back or taken down ' +
        'before then, the pay comes back to you and the 30 stays.</div>';
    }
    var come = b.arrivals || [];
    if (come.length) {
      out += '<h3>Hauls that came here</h3>';
      for (var a = 0; a < come.length; a++) {
        var h = come[a];
        out += '<div class="row"><span class="nm">From ' + esc(h.where || h.from) + ', ' + esc(h.name) +
          ', carried by ' + esc(h.hauler) + '<br>' + esc(h.text) + '<br>' + esc(h.hauler) + ' is paid ' +
          esc(String(h.pay - h.kept)) + (h.kept ? ', and the company keeps ' + esc(String(h.kept)) : '') +
          '.</span><span class="tools"><button class="go" data-do="done" data-from="' + esc(h.from) +
          '" data-n="' + esc(h.n) + '">Confirm</button></span></div>';
      }
    }
    out += '<h3>Leave a price list</h3>';
    var lists = b.submit || [];
    if (!lists.length) { out += '<div class="none">No list you can leave.</div>'; }
    for (var s = 0; s < lists.length; s++) {
      out += '<div class="row"><span class="nm">' + esc(lists[s].name) +
        '</span><span class="tools"><button class="go" data-do="submit" data-id="' +
        esc(lists[s].id) + '">Leave the list</button></span></div>';
    }
    body.innerHTML = out;
    var payBox = document.getElementById(ID + '-pay');
    var destBox = document.getElementById(ID + '-dest');
    var haulBox = document.getElementById(ID + '-haul');
    if (payBox && keptPay) { payBox.value = keptPay; }
    if (destBox && keptDest) { destBox.value = keptDest; }
    if (haulBox && keptHaul) { haulBox.value = keptHaul; }
    var toBox = document.getElementById(ID + '-to');
    var letterBox = document.getElementById(ID + '-letter');
    if (toBox && keptTo) { toBox.value = keptTo; }
    if (letterBox && keptLetter) { letterBox.value = keptLetter; }
    wire(body);
  }

  function wire(body) {
    var buttons = body.querySelectorAll('[data-do]');
    for (var k = 0; k < buttons.length; k++) { buttons[k].onclick = onDo; }
  }

  /* What a post costs, said under the form for the kind picked. */
  function costLine() {
    return draft.kind === 'job'
      ? 'A job is 30 gold for the board, and the reward. The reward is held until you say the job is done, ' +
        'with Pay the reward on it, and then it goes to whoever took it. Taken down before anybody takes ' +
        'it, the reward comes back to you. The 30 stays with the hold.'
      : 'A notice is 20 gold. The gold stays with the hold.';
  }

  /*
    MAKE A POST (#2554): the title, the body, Job or Notice, and a job's
    reward. Drawn once when it opens; picking Job or Notice changes only
    what shows, so nothing typed is lost.
  */
  function drawForm(body) {
    if (formDrawn) { showKind(); return; }
    formDrawn = true;
    body.innerHTML =
      '<h3>Make a post</h3>' +
      '<div class="line"><button data-do="kind" data-kind="notice" id="' + ID + '-k-notice">Notice</button>' +
      '<button data-do="kind" data-kind="job" id="' + ID + '-k-job">Job</button></div>' +
      '<div class="line"><input id="' + ID + '-title" aria-label="Post title" maxlength="' + TITLE_CHARS + '" placeholder="the title"></div>' +
      '<div class="line"><textarea id="' + ID + '-text" aria-label="Post text" maxlength="' + BODY_CHARS +
      '" placeholder="what it says"></textarea></div>' +
      '<div class="line" id="' + ID + '-rewardline"><input class="pay" id="' + ID +
      '-reward" aria-label="Job reward in gold" placeholder="reward"><span class="note">gold, for whoever does the job</span></div>' +
      '<div class="note">The title is up to ' + TITLE_CHARS + ' characters and what it says up to ' +
      BODY_CHARS + '.</div>' +
      '<div class="note" id="' + ID + '-cost"></div>' +
      '<div class="said" id="' + ID + '-said"></div>' +
      '<div class="line" style="justify-content:flex-end;margin-top:12px">' +
      '<button data-do="back">Back</button><button class="go" data-do="send">Post it</button></div>';
    var boxes = [['-title', 'title'], ['-text', 'body'], ['-reward', 'reward']];
    for (var i = 0; i < boxes.length; i++) {
      var el = document.getElementById(ID + boxes[i][0]);
      if (!el) { continue; }
      el.value = draft[boxes[i][1]];
      el.addEventListener('input', keep(boxes[i][1]));
    }
    wire(body);
    showKind();
  }

  function keep(name) {
    return function () { draft[name] = String(this.value || ''); };
  }

  function showKind() {
    var isJob = draft.kind === 'job';
    var n = document.getElementById(ID + '-k-notice');
    var j = document.getElementById(ID + '-k-job');
    if (n) { n.className = isJob ? '' : 'go'; }
    if (j) { j.className = isJob ? 'go' : ''; }
    var line = document.getElementById(ID + '-rewardline');
    if (line) { line.style.display = isJob ? '' : 'none'; }
    var cost = document.getElementById(ID + '-cost');
    if (cost) { cost.textContent = costLine(); }
    var told = document.getElementById(ID + '-said');
    if (told) { told.textContent = said; }
  }

  function say(line) {
    said = line;
    showKind();
  }

  /*
    The page says what is missing before anything is sent, so nobody waits
    on the server for an empty title. The server checks every one of these
    again and refuses before any gold is taken.
  */
  function send() {
    var b = data && data.board;
    if (!b || !b.here) { return; }
    var title = draft.title;
    var text = draft.body;
    if (!title.trim()) { say('Give it a title.'); return; }
    if (title.length > TITLE_CHARS) { say('A title is up to ' + TITLE_CHARS + ' characters.'); return; }
    if (!text.trim()) { say('Write what it says.'); return; }
    if (text.length > BODY_CHARS) { say('What it says is up to ' + BODY_CHARS + ' characters.'); return; }
    var rewardValue = 0;
    if (draft.kind === 'job') {
      var reward = draft.reward.trim();
      if (!/^\d+$/.test(reward) || !(Number(reward) > 0)) {
        say('A job\'s reward is a whole number of gold, above nothing.');
        return;
      }
      rewardValue = Number(reward);
    }
    var line = '/board-post-v1 ' + JSON.stringify([draft.kind, rewardValue, title, text, b.hold]);
    pending = {hold:b.hold,title:title,body:text,kind:draft.kind,reward:rewardValue,top:topN(b)};
    say('Putting it up. If it cannot go up, the chat says why.');
    net(line);
  }

  function onDo() {
    var verb = this.getAttribute('data-do');
    var n = this.getAttribute('data-n');
    if (verb === 'compose') { composing = true; said = ''; draw(); return; }
    if (verb === 'close') { close(); return; }
    if (verb === 'back') { composing = false; pending = null; said = ''; draw(); return; }
    if (verb === 'kind') {
      draft.kind = this.getAttribute('data-kind') === 'job' ? 'job' : 'notice';
      showKind();
      return;
    }
    if (verb === 'send') { send(); return; }
    if (verb === 'open') {
      var key = this.getAttribute('data-key');
      if (key) { opened[key] = !opened[key]; draw(); }
      return;
    }
    if (verb === 'letter') {
      if (!shown || !root.contains(this)) return;
      clearBoardFieldError();
      var to = document.getElementById(ID + '-to').value;
      var words = document.getElementById(ID + '-letter').value;
      if (!needBoardField('to', to.trim(), 'Say who the letter is for.', 'letter-reason') ||
          !needBoardField('letter', words.trim(), 'Write what the letter says.', 'letter-reason')) return;
      var letterLine;
      try { letterLine = '/letter-post-v1 ' + encodeURIComponent(to) + ' ' + encodeURIComponent(words); }
      catch (eLetter) { showBoardReason('letter-reason', 'That letter contains invalid text. Nothing was sent; keep your draft.'); return; }
      net(letterLine);
      return;
    }
    if (verb === 'haul') {
      if (!shown || !root.contains(this)) return;
      clearBoardFieldError();
      var pay = field(ID + '-pay').replace(/[^0-9]/g, '');
      var dest = field(ID + '-dest');
      var what = field(ID + '-haul');
      if (!needBoardField('pay', pay, 'Enter the haul pay in gold.', 'haul-reason') ||
          !needBoardField('dest', dest, 'Choose the haul destination.', 'haul-reason') ||
          !needBoardField('haul', what, 'Say what the haul carries.', 'haul-reason')) return;
      net('/haul ' + pay + ' ' + dest + ' ' + what);
      return;
    }
    if (verb === 'done' && n) {
      var from = this.getAttribute('data-from');
      if (from) { net('/haul done ' + from + ' ' + n); }
      return;
    }
    if (verb === 'take' && n) { net('/take ' + n); return; }
    if (verb === 'paid' && n) { net('/job done ' + n); return; }
    if (verb === 'unpin' && n) { confirmTakedown(this, n); return; }
    if (verb === 'drop' && n) { net('/dropjob ' + n); return; }
    if (verb === 'submit') {
      var id = this.getAttribute('data-id');
      if (id) { net('/book submit ' + id); }
    }
  }

  function open() {
    build();
    if (shown) { draw(); return; }
    shown = true;
    root.className = 'on';
    formDrawn = false;
    draw();
    if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
    tell('opened');
  }

  function resetTakedown() {
    if (takedownArm) {
      takedownArm.button.textContent = takedownArm.text;
      takedownArm.button.removeAttribute('data-confirm');
    }
    takedownArm = null;
    if (takedownTimer) clearTimeout(takedownTimer);
    takedownTimer = 0;
  }

  function actionStatus(text) {
    var el = root.querySelector('#' + ID + '-action-status');
    if (el) el.textContent = text;
  }

  function takedownTarget(n) {
    var b = data && data.board;
    if (!data || !Number.isSafeInteger(data.me) || data.me <= 0 || !b || !b.here || typeof b.hold !== 'string') return null;
    var wall = b.wall || [];
    for (var i = 0; i < wall.length; i++) {
      var row = wall[i];
      if (String(row.n) !== n) continue;
      if (!Number.isSafeInteger(row.n) || row.n <= 0 || !Number.isSafeInteger(row.at) || row.at < 0 ||
          !((row.mine && !(row.job && row.taken)) || (row.haul && b.steward) || b.guard)) return null;
      return { me: data.me, hold: b.hold, here: b.here, guard: !!b.guard, steward: !!b.steward, row: row,
        line: '/board-unpin-v1 ' + JSON.stringify([b.hold, row.n, row.at]),
        words: (row.letter ? 'letter #' + row.n : row.haul ? 'haul #' + row.n : '"' + row.title + '"') + ' from ' + (b.where || b.hold) };
    }
    return null;
  }

  function confirmTakedown(button, n) {
    if (!shown || !root.contains(button)) return;
    var target = takedownTarget(n);
    if (!target) { resetTakedown(); actionStatus('That post is unavailable. Review the current board.'); return; }
    var snapshot = JSON.stringify(target);
    var again = takedownArm && takedownArm.button === button && takedownArm.snapshot === snapshot && Date.now() < takedownArm.until;
    resetTakedown(); actionStatus('');
    if (again) {
      var uncertain = 'Delivery not confirmed. Check the current board before trying again.';
      try { if (window.thornswoodNet && window.thornswoodNet.say && window.thornswoodNet.say(target.line) === true) return; }
      catch (e) { actionStatus(uncertain); return; }
      actionStatus(uncertain);
      return;
    }
    var armed = { button: button, text: button.textContent, snapshot: snapshot, until: Date.now() + 5000 };
    takedownArm = armed; button.setAttribute('data-confirm', ''); button.textContent = 'Press again to take down ' + target.words;
    takedownTimer = setTimeout(function () { if (takedownArm === armed) resetTakedown(); }, 5000);
  }

  function close() {
    if (!shown) { return; }
    resetTakedown(); takedownHeld = '';
    clearBoardFieldError();
    shown = false;
    if (root) { root.className = ''; }
    tell('closed');
  }

  document.addEventListener('keydown', function (ev) {
    if (!shown) { return; }
    if (ev.key === 'Escape') {
      ev.preventDefault(); if (ev.repeat) return;
      if (takedownArm) resetTakedown(); else close();
    }
  });

  var foot = null;
  function wireFoot() {
    build();
    if (foot) { return; }
    foot = root.querySelector('.foot');
    if (!foot) { return; }
    var make = root.querySelector('.make');
    var shut = root.querySelector('.shut');
    if (make) { make.onclick = onDo; }
    if (shut) { shut.onclick = function () { close(); }; }
  }

  window.thornswoodBoard = {
    open: function () { wireFoot(); open(); },
    close: close,
    toggle: function () { if (shown) { close(); } else { open(); } },
    isOpen: function () { return shown; },
    setData: function (d) {
      data = d || null;
      var b = data && data.board;
      if (b && isFinite(Number(b.x)) && isFinite(Number(b.y)) && isFinite(Number(b.z))) {
        tell('near ' + String(b.hold || 'board') + ' ' + Number(b.x) + ' ' + Number(b.y) + ' ' + Number(b.z));
      } else {
        tell('near none');
      }
      wireFoot();
      if (shown) { draw(); }
    }
  };

  tell('ready');
})();
