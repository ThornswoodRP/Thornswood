'use strict';
/*
  Journals, behind J.

  Patrick, 22 September: "J for Journal... This would open the journal menu,
  which would allow you to have multiple journals with multiple pages, and
  share your journal or specific pages of your journal with friends."

  All four of those are here: more than one journal, pages inside each, sharing
  a whole journal, and sharing one page. Sharing is with a FRIEND and not with
  anybody, which is the server's rule and is refused there rather than hidden
  here, so the refusal says why.

  WHAT SHARING MEANS. It is not a copy. The page stays yours, and the person
  you shared it with reads what it says NOW: correct a page and they see the
  correction. That also means a shared page only shows up while its owner is
  online, which is a real limit and is written on the panel where somebody
  would look for it rather than left to be discovered.

  THE CONTRACT with thornswood-front.js:
    window.thornswoodJournal = { open, close, toggle, isOpen, setData, setFacing, setKey }
    page -> plugin  'journal:ready' | 'journal:opened' | 'journal:closed'
    plugin -> page  setFacing({ id, name }) or setFacing(null) as it opens:
                    who the look prompt was drawn for when J opened

  Most actions use /journal; exact page saves use /journal-write-v1 with a
  JSON [journalId,pageId,title,text] payload. See the journalCommand note
  in gamemode.js. Those lines are the panel's: J is the only way in, nobody is
  told to type them, and no help names them (Patrick, 4 Oct: buttons, not
  commands; #1630).

  A faction or a business is a separate tab on this same panel, drawn only
  when the server says this character may see it. Those lines go out as /book,
  the same way.
*/
(function () {
  if (window.thornswoodJournal) { return; }

  var ID = 'ts-journal';
  var data = null;
  var shown = false;
  var root = null;
  // JournalKey's name as bound, from the front (setKey); J on a fresh
  // install. The Settings panel moves it with the game running (#3126).
  var keyName = 'J';
  var openBook = '';     // which journal is being read
  var openPage = '';     // which page inside it
  var editing = false;
  var pageDraft = null; // only the currently selected owned page
  var pendingLeave = null, leaveChoice = null, lastEdit = 'text', leaveNotice = '';
  var destructiveArm = null, destructiveTimer = 0, destructiveHeld = '';
  var groupFieldError = null;
  var DESTRUCTIVE_ARM_MS = 5000; // The same second-press window as Office.
  var readingShared = -1;
  var openGroup = '';
  var onBoards = false;  // the Boards tab is what the right side shows (issue 1627)
  // Who was in front of you when J opened, { id, name }, or null. The plugin
  // hands it over from the look prompt (#1630); see setFacing.
  var facing = null;
  // ONE CLICK, ONE JOURNAL (#2037). When New was pressed, and how many journals
  // there were then. Further presses are ignored until the server's view shows
  // the new one (setData) or NEW_WAIT_MS passes with no answer.
  var newAt = 0;
  var newFrom = -1;
  var NEW_WAIT_MS = 3000;
  // The press is still in the chat's queue, waiting for the socket (#2135).
  // The 3 s wait is for an answer to a line that has gone, so it starts when
  // the line leaves, not when it was queued: until #2135 it ran out while the
  // line was still queued, the next press queued another, and the welcome
  // sent the server one journal per 3 s somebody had been waiting.
  var newQueued = false;

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'journal:' + what); }
    catch (e) { }
  }

  /* 'sent', 'queued' (the chat holds it until it joins), or '' (it went
     nowhere). say answers true only for a line on the socket. */
  /*
    HOW MUCH A PAGE HOLDS (#2563). The same numbers as SOCIAL.pageChars and
    writePage's title cut in game/gamemode.js; the chat socket's COMMAND_CHARS
    in voice/voice-server.js is sized to carry a page this long whole.
    tests/test-2563-journal-length.js holds the three together.
  */
  var PAGE_CHARS = 4000;
  var TITLE_CHARS = 60;

  function net(line) {
    try {
      var n = window.thornswoodNet;
      if (n && n.say) {
        var before = queued();
        if (n.say(line) === true) { return 'sent'; }
        return queued() > before ? 'queued' : '';
      }
    } catch (e) { }
    return '';
  }
  function queued() {
    try { return Number(window.thornswoodNet.state().queued) || 0; } catch (e) { return 0; }
  }

  /*
    THE LOOK IS THE K PANEL'S. Patrick, 23 September, playing on dev: "Also
    the journal menu works but is ugly asf and doesn't match the theme we use
    with our other menus". It had been drawn from another template: system-ui
    sans serif, rounded 12px and 7px corners, flat grey #1b1f26 and a brass
    #d9ab52, which is the To Do List web page's palette and not the game's.
    Every colour below is one thornswood-skills.js already uses, and the rest
    follows it too: the Palatino stack (fonts on the machine, never one off
    the network, because this is the game's own browser), parchment text,
    gold hairlines, square corners, the dark vignette behind the panel,
    uppercase gold buttons with one gold primary, and gold scrollbars.
    tools/test-journal-theme.js fails on a colour here that the K panel does
    not use.

    Only the look changed. The grid, the sizes, the ids and classes the
    script reads and every line it sends are as they were.

    No :hover and no transitions, for the reason the K panel has none (see
    the head of thornswood-skills.js). The journal and page you picked are
    lit by the click, and the cursor still turns into a hand.

    The front's own stylesheet, in this same document, sets margin, padding,
    border and background to nothing on every element (measured in its
    build.js on 24 September), so each rule sets what it needs rather than
    leaning on the browser's defaults.
  */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483000;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:1040px;max-width:calc(100vw - 48px);height:660px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .cols{display:grid;grid-template-columns:280px 1fr;overflow:hidden}',
    '#' + ID + ' .side{overflow:auto;border-right:1px solid rgba(198,170,109,.22);padding:16px 14px;',
    '  font-size:15px}',
    '#' + ID + ' .main{overflow:auto;padding:18px 24px;font-size:17px}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);display:flex;gap:10px;',
    '  align-items:center;font-size:13.5px;font-style:italic;color:rgba(217,207,180,.7)}',
    '#' + ID + ' h3{margin:14px 0 7px;padding-bottom:6px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;',
    '  color:rgba(198,170,109,.85);font-weight:normal;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' h3:first-child{margin-top:0}',
    // The K panel's button at 11px rather than its 13px. Uppercase and spaced
    // is wider than the old buttons were, and at 12px Save no longer fit on
    // the line with the page's title and went onto one of its own, pushing
    // the text box down (measured in Edge at 1920 by 1080, 24 September).
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:14px;line-height:18px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    // A journal in the list and a page tab are names rather than actions, so
    // they read as the K panel's cards and choices do, not as its buttons.
    '#' + ID + ' .item{display:block;width:100%;text-align:left;margin-bottom:6px;',
    '  padding:9px 12px;border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);',
    '  color:#f6e9c8;font-size:15px;letter-spacing:.02em;text-transform:none;white-space:normal}',
    '#' + ID + ' .item.sel{border-color:rgba(198,170,109,.55);background:rgba(120,94,44,.24);',
    '  box-shadow:inset 3px 0 0 0 #c6aa6d}',
    '#' + ID + ' .item.go{text-align:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase;',
    '  background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#' + ID + ' .item .c{float:right;color:rgba(217,207,180,.5);font-size:12px;font-style:italic}',
    '#' + ID + ' button[data-page]{font-size:13.5px;letter-spacing:.02em;text-transform:none;color:#d9cfb4;',
    '  border-color:rgba(198,170,109,.30);background:rgba(0,0,0,.20)}',
    '#' + ID + ' button[data-page].go{border-color:#e9d19b;background:rgba(201,162,75,.20);color:#f6e9c8}',
    '#' + ID + ' input,#' + ID + ' textarea,#' + ID + ' select{font-family:inherit;font-size:16px;color:#f6e9c8;',
    '  background:rgba(0,0,0,.35);border:1px solid rgba(198,170,109,.30);padding:8px 10px;width:100%}',
    '#' + ID + ' input:focus,#' + ID + ' textarea:focus,#' + ID + ' select:focus{border-color:rgba(198,170,109,.55)}',
    // the list the select drops down is drawn on its own, so it gets a solid
    // colour rather than a see-through one
    '#' + ID + ' option{background:#1b1205;color:#d9cfb4}',
    '#' + ID + ' textarea{min-height:300px;resize:vertical;line-height:1.55;font-size:15px}',
    '#' + ID + ' .bar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}',
    '#' + ID + ' .bar .grow{flex:1}',
    '#' + ID + ' .none{color:rgba(217,207,180,.6);font-style:italic;padding:8px 2px;line-height:1.55}',
    '#' + ID + ' .read{white-space:pre-wrap;line-height:1.65;font-size:17px;color:#d9cfb4}',
    '#' + ID + ' .from{color:rgba(217,207,180,.6);font-style:italic;font-size:12.5px;margin-bottom:10px}',
    '#' + ID + ' .main b{font-weight:normal;font-size:16.5px;color:#f6e9c8}',
    // The K panel's scrollbars, the same rules scoped to this panel, so the
    // journal has them whether or not the K panel's page loaded first.
    '#' + ID + ' ::-webkit-scrollbar{width:10px;height:10px}',
    '#' + ID + ' ::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '#' + ID + ' ::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    '  background-clip:padding-box;border-radius:6px}',
    '#' + ID + ' ::-webkit-scrollbar-thumb:active{background:rgba(233,209,155,.55);background-clip:padding-box}',
    '#' + ID + ' ::-webkit-scrollbar-corner{background:transparent}'
  ].join('\n');

  /*
    SCALED TO THE SCREEN, THE K PANEL'S WAY. Issue 958.

    Patrick on dev, 28 September: "it doesn't scale the menu size for bigger
    screens or is just too small". The panel is a fixed 1040 by 660 box in
    CSS pixels, and the game's browser is the size of the screen, so at his
    3440 by 1440 it filled under a third of the width, and at 3840 by 2160 a
    quarter. It is laid out for 1920 by 1080 and scaled up from there by the
    smaller of the two ratios, exactly as fit() in thornswood-skills.js does:
    1920 by 1080 draws it as is, 2560 by 1440 at 1.333, 3440 by 1440 at
    1.333, 3840 by 2160 at 2. Never below 1, where max-width and max-height
    already keep it on a smaller screen, and never above 2.4.
    game/tests/test-journal-scale.js holds it at those sizes.
  */
  var BASE_W = 1920, BASE_H = 1080, MAX_SCALE = 2.4;

  function scaleFor(w, h) {
    var s = Math.min(w / BASE_W, h / BASE_H);
    if (!isFinite(s) || s < 1) { s = 1; }
    return Math.min(s, MAX_SCALE);
  }

  function fit() {
    try {
      var panel = root && root.querySelector('.panel');
      if (!panel) { return; }
      panel.style.transformOrigin = 'center center';
      panel.style.transform = 'scale(' + scaleFor(window.innerWidth, window.innerHeight).toFixed(3) + ')';
    } catch (e) { }
  }

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel">' +
      '<h2>Journals</h2>' +
      '<div id="' + ID + '-leave-choice" hidden role="group" aria-labelledby="' + ID + '-leave-title" style="padding:12px 18px;border:1px solid #c6aa6d;margin:8px 0">' +
      '<p id="' + ID + '-leave-title">Discard unsaved page changes before leaving this page?</p>' +
      '<button type="button" id="' + ID + '-keep">Keep editing</button>' +
      '<button type="button" id="' + ID + '-discard">Discard and continue</button></div>' +
      '<div class="cols">' +
      '<div class="side" id="' + ID + '-side"></div>' +
      '<div class="main" id="' + ID + '-main"></div>' +
      '</div>' +
      '<p id="' + ID + '-field-reason" role="status" aria-live="polite" style="display:none;margin:0;padding:0 18px"></p>' +
      '<div class="foot"><span id="' + ID + '-foot"></span><span style="flex:1"></span>' +
      '<button id="' + ID + '-help">Help</button>' +
      '<button id="' + ID + '-settings">Settings</button>' +
      '<button id="' + ID + '-close">Close</button></div>' +
      '</div>';
    document.body.appendChild(root);
    leaveChoice = root.querySelector('#' + ID + '-leave-choice'); leaveChoice.hidden = true;
    root.addEventListener('focusin', rememberEditor);
    root.addEventListener('focusout', rememberEditor);
    root.addEventListener('input', resetDestructive);
    root.addEventListener('input', function (ev) {
      if (groupFieldError && ev.target === groupFieldError.field) clearGroupFieldError();
    });
    root.addEventListener('click', function (ev) {
      if (destructiveArm && ev.target !== destructiveArm.button) resetDestructive();
    }, true);
    root.addEventListener('keydown', function (ev) {
      if (shown && destructiveHeld && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault(); ev.stopPropagation(); return;
      }
      var button = ev.target;
      if (!shown || !button || button.tagName !== 'BUTTON' ||
          (button.getAttribute('data-do') !== 'dropbook' && button.getAttribute('data-g') !== 'disband' &&
           button.getAttribute('data-g') !== 'remove' &&
           button.id !== ID + '-discard') || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault(); ev.stopPropagation();
      if (ev.repeat || destructiveHeld) return;
      destructiveHeld = ev.key;
      button.click();
    }, true);
    document.addEventListener('keyup', function (ev) {
      if (ev.key === destructiveHeld) { destructiveHeld = ''; ev.preventDefault(); }
    });
    window.addEventListener('blur', function () { destructiveHeld = ''; resetDestructive(); });
    root.querySelector('#' + ID + '-close').onclick = close;
    // Help, beside Close (#1633): the help panel on its People topic, which
    // has journals and group books, and this one put down; the help opens
    // first, so the keyboard is never let go between the two.
    root.querySelector('#' + ID + '-help').onclick = function () {
      try { if (window.thornswoodHelp) { window.thornswoodHelp.open('people'); } } catch (e) { }
      close();
    };
    // Settings beside it (#3126): the Settings panel, the same way.
    root.querySelector('#' + ID + '-settings').onclick = function () {
      try { if (window.thornswoodSettings) { window.thornswoodSettings.open(); } } catch (e) { }
      close();
    };
    fit();
    window.addEventListener('resize', fit);
    // The page answers its own Escape, and its own J; no plugin can see a key
    // while the browser holds the keyboard. See thornswood-bridge.js. The
    // footer has said "Escape or J closes this" since #288, and J reached
    // neither the game nor the plugin while this panel held the keyboard, so
    // it did nothing (#530). J closes only when the caret is not in a title
    // or a page, where it is a letter somebody is writing.
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (ev.repeat) return;
        if (destructiveArm) { resetDestructive(); return; }
        if (pendingLeave) cancelLeave(true); else close();
        return;
      }
      if (keyName && String(ev.key || '').toUpperCase() === keyName.toUpperCase() &&
          !ev.ctrlKey && !ev.altKey && !ev.metaKey && !typing(ev.target)) {
        ev.preventDefault(); close();
      }
    });
    return root;
  }

  // True when a key would go into a title, a page or any other text field.
  function typing(el) {
    if (!el || !el.tagName) { return false; }
    var t = String(el.tagName).toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || !!el.isContentEditable;
  }

  // The quote too: a role or a price line's name goes inside an attribute
  // (data-role, data-name), and a name with a quote in it would end it there.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function books() { return (data && data.journals) || []; }
  function bookOf(id) {
    var b = books();
    for (var i = 0; i < b.length; i++) { if (b[i].id === id) { return b[i]; } }
    return null;
  }
  function pageOf(book, id) {
    var p = (book && book.pages) || [];
    for (var i = 0; i < p.length; i++) { if (p[i].id === id) { return p[i]; } }
    return null;
  }

  function newJournal() {
    openGroup = '';
    var now = Date.now();
    if (newQueued) {
      if (queued() > 0) { return false; }
      // It has left since the last press: wait for its answer from now.
      newQueued = false;
      newAt = now;
      return false;
    }
    if (newAt && now - newAt < NEW_WAIT_MS) { return false; }
    newAt = now;
    newFrom = books().length;
    var went = net('/journal new Journal');
    if (went === 'queued') { newQueued = true; }
    else if (!went) { newAt = 0; }
    return !!went;
  }

  function rememberEditor(ev) {
    var field = ev.target;
    if (!field || !root.contains(field) || (field.id !== ID + '-ptitle' && field.id !== ID + '-text')) return;
    lastEdit = field.id === ID + '-ptitle' ? 'ptitle' : 'text';
    if (pendingLeave && pageDraft === pendingLeave.draft) {
      pendingLeave.editor = lastEdit;
      pendingLeave.selection = typeof field.selectionStart === 'number' ?
        {start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection} : null;
    }
  }

  function resetDestructive() {
    if (destructiveArm) destructiveArm.button.textContent = destructiveArm.text;
    destructiveArm = null;
    if (destructiveTimer) clearTimeout(destructiveTimer);
    destructiveTimer = 0;
  }

  // A mounted control and an unchanged authoritative view, never a cached
  // command alone. A redraw or changed ownership cannot inherit an arm.
  function confirmDestructive(button, current, wording, send) {
    if (!shown || !root.contains(button)) return;
    var target = current();
    if (!target) { resetDestructive(); return; }
    var snapshot = JSON.stringify(target);
    var again = destructiveArm && destructiveArm.button === button &&
      destructiveArm.snapshot === snapshot && Date.now() < destructiveArm.until;
    resetDestructive();
    if (again) { send(); return; }
    var armed = {button:button,text:button.textContent,snapshot:snapshot,until:Date.now()+DESTRUCTIVE_ARM_MS};
    destructiveArm = armed;
    button.textContent = 'Press again to ' + wording;
    destructiveTimer = setTimeout(function () {
      if (destructiveArm === armed) resetDestructive();
    }, DESTRUCTIVE_ARM_MS);
  }

  function cancelLeave(focus) {
    var intent = pendingLeave;
    pendingLeave = null;
    if (leaveChoice) {
      leaveChoice.hidden = true;
      root.querySelector('#' + ID + '-keep').onclick = null;
      root.querySelector('#' + ID + '-discard').onclick = null;
    }
    if (focus) {
      var field = root.querySelector('#' + ID + '-' + (intent && intent.editor || lastEdit));
      if (field) {
        field.focus();
        if (intent && pageDraft === intent.draft && intent.selection && typeof field.setSelectionRange === 'function') {
          field.setSelectionRange(intent.selection.start, intent.selection.end, intent.selection.direction);
        }
      }
    }
  }

  function leavePage(run, valid, submit, destructiveTitle) {
    leaveNotice = '';
    if (!pageDraft) {
      if ((!valid || valid()) && (!submit || submit()) && run) run();
      return;
    }
    var field = root.querySelector('#' + ID + '-' + lastEdit);
    var selection = field && typeof field.selectionStart === 'number' ?
      {start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection} : null;
    var intent = {draft:pageDraft,run:run,valid:valid,editor:lastEdit,selection:selection};
    pendingLeave = intent; leaveChoice.hidden = false;
    var keep = root.querySelector('#' + ID + '-keep'), discard = root.querySelector('#' + ID + '-discard');
    root.querySelector('#' + ID + '-leave-title').textContent = destructiveTitle ?
      'Throw away "' + destructiveTitle + '" and its unsaved changes?' : 'Discard unsaved page changes before leaving this page?';
    discard.textContent = destructiveTitle ? 'Throw away journal and unsaved changes' : 'Discard and continue';
    keep.onclick = function () { if (pendingLeave === intent) cancelLeave(true); };
    discard.onclick = function () {
      if (pendingLeave !== intent || pageDraft !== intent.draft) return;
      if (intent.valid && !intent.valid()) {
        cancelLeave(true); leaveNotice = 'That destination changed. Your unsaved page is still here. '; drawJournalFoot(); return;
      }
      if (submit && !submit()) {
        cancelLeave(true); leaveNotice = 'Could not continue yet. Your unsaved page is still here. '; drawJournalFoot(); return;
      }
      cancelLeave(false); pageDraft = null; draw();
      if (intent.run) intent.run();
      if (shown) {
        var target = root.querySelector('#' + ID + '-' + lastEdit) || root.querySelector('button[data-page]') || root.querySelector('#' + ID + '-main');
        if (target) { if (!typing(target) && target.tagName !== 'BUTTON') target.tabIndex = -1; target.focus(); }
      }
    };
    keep.focus();
  }

  function drawSide() {
    var side = root.querySelector('#' + ID + '-side');
    var html = '<h3>Yours</h3>';
    var b = books();
    if (!b.length) {
      html += '<div class="none">Nothing yet.</div>';
    } else {
      for (var i = 0; i < b.length; i++) {
        html += '<button class="item' + (b[i].id === openBook && readingShared < 0 ? ' sel' : '') +
                '" data-book="' + esc(b[i].id) + '">' + esc(b[i].title) +
                '<span class="c">' + b[i].pages.length + '</span></button>';
      }
    }
    html += '<button class="item go" data-new="1" style="margin-top:8px">New journal</button>';

    var shared = (data && data.shared) || [];
    html += '<h3>Shared with you</h3>';
    if (!shared.length) {
      html += '<div class="none">Nothing. A page only shows here while the person who wrote it is online.</div>';
    } else {
      for (var j = 0; j < shared.length; j++) {
        html += '<button class="item' + (readingShared === j ? ' sel' : '') +
                '" data-shared="' + j + '">' + esc(shared[j].title) +
                '<span class="c">' + shared[j].pages.length + '</span>' +
                '<div style="color:rgba(217,207,180,.6);font-size:12px;font-style:italic">from ' + esc(shared[j].from) + '</div></button>';
      }
    }
    var group = data && data.group;
    if (group && group.show) {
      html += '<h3>Group</h3>';
      var gb = group.books || [];
      if (!gb.length) { html += '<div class="none">No book yet.</div>'; }
      for (var gi = 0; gi < gb.length; gi++) {
        html += '<button class="item' + (gb[gi].id === openGroup ? ' sel' : '') +
                '" data-group="' + esc(gb[gi].id) + '">' + esc(gb[gi].name) +
                '<span class="c">' + esc(gb[gi].kind) + '</span></button>';
      }
      if (group.canBusiness || group.canFaction) {
        html += '<input id="' + ID + '-gname" aria-label="Group name" placeholder="A name">';
        if (group.canBusiness) {
          html += '<button class="item go" data-found="business">New business</button>';
        }
        if (group.canFaction) {
          html += '<button class="item go" data-found="faction">New faction</button>';
        }
      }
    }
    html += boardsSide();
    put(side, html, 'side');

    var items = side.querySelectorAll('button[data-book],button[data-new],button[data-shared]');
    for (var k = 0; k < items.length; k++) {
      items[k].onclick = function () {
        if (this.getAttribute('data-new')) {
          /*
            No window.prompt. A browser modal inside the game is a dialog
            nothing can dismiss: the page owns the keyboard while it is up and
            no plugin can reach it. So a journal is made with a plain name and
            renamed on the panel, which is one more click and cannot strand
            anybody.
          */
          leavePage(null, null, newJournal);
          return;
        }
        if (this.getAttribute('data-shared') !== null) {
          var index = Number(this.getAttribute('data-shared'));
          var sharedSnapshot = JSON.stringify(((data && data.shared) || [])[index]);
          leavePage(function () {
            readingShared = index; openBook = ''; openPage = ''; editing = false; openGroup = ''; draw();
          }, function () { return sharedSnapshot !== undefined && JSON.stringify(((data && data.shared) || [])[index]) === sharedSnapshot; });
          return;
        }
        var bookId = this.getAttribute('data-book');
        if (bookId === openBook && pageOf(bookOf(openBook), openPage)) return;
        leavePage(function () {
          openBook = bookId; readingShared = -1; openPage = ''; editing = false; openGroup = ''; draw();
        }, function () { return !!bookOf(bookId); });
      };
    }
    var groupBtns = side.querySelectorAll('button[data-group],button[data-found]');
    for (var gbi = 0; gbi < groupBtns.length; gbi++) {
      groupBtns[gbi].onclick = function () {
        if (!shown || !root.contains(this)) return;
        var found = this.getAttribute('data-found');
        if (found) {
          var nameEl = root.querySelector('#' + ID + '-gname');
          var gname = nameEl ? String(nameEl.value || '').trim() : '';
          clearGroupFieldError();
          if (!needGroupField('gname', 'Give the group a name first.')) return;
          net('/book new ' + found + ' ' + gname);
          return;
        }
        var groupId = this.getAttribute('data-group');
        leavePage(function () {
          openGroup = groupId; openBook = ''; readingShared = -1; openPage = ''; editing = false; draw();
        }, function () { return !!(data && data.group && data.group.show && (data.group.books || []).some(function (book) { return book.id === groupId; })); });
      };
    }
    var boardBtns = side.querySelectorAll('button[data-board]');
    for (var bb = 0; bb < boardBtns.length; bb++) {
      boardBtns[bb].onclick = function () {
        var hold = this.getAttribute('data-board');
        leavePage(function () {
          onBoards = true; openBook = ''; readingShared = -1; openPage = ''; editing = false; openGroup = '';
          net('/board ' + hold); draw();
        }, function () { return !!(data && data.boards && (data.boards.list || []).some(function (board) { return board.hold === hold; })); });
      };
    }
  }

  /*
    BOARDS (issue 1627). Every town's notice board, read only, from anywhere, and
    the jobs you have taken under it. It was /board <hold> and /jobs, typed;
    Patrick, 4 Oct: nothing people do is a chat command. Picking a town sends
    /board <town>, which nobody is told to type, and the server answers by
    putting that board in this panel's data (boards.read). Which town is
    lit is the server's answer, not a guess here, so after a restart none is.
    Posting, taking and handing back stay at the board itself, on its panel.
  */
  function boardsShown() {
    return onBoards && !openBook && !openGroup && readingShared < 0;
  }

  function boardsSide() {
    var bv = data && data.boards;
    var towns = (bv && bv.list) || [];
    if (!towns.length) { return ''; }
    var reading = (bv.read && bv.read.hold) || '';
    var html = '<h3>Boards</h3>';
    for (var i = 0; i < towns.length; i++) {
      html += '<button class="item' + (boardsShown() && towns[i].hold === reading ? ' sel' : '') +
              '" data-board="' + esc(towns[i].hold) + '">' + esc(towns[i].where || towns[i].hold) + '</button>';
    }
    return html;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* When a post went up, as the board panel says it: 6:43 PM, 15 Oct (#2554). */
  function postedAt(at) {
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

  function drawBoards(main) {
    var bv = data && data.boards;
    var read = bv && bv.read;
    if (!read) {
      put(main, '<div class="none">Pick a town under Boards to read its notice board.</div>');
      return;
    }
    var out = '<div class="from">The notice board in ' + esc(read.where || read.hold) +
              '. Post, take and hand back at the board itself.</div>';
    var wall = read.wall || [];
    if (!wall.length) { out += '<div class="none">Nothing on it.</div>'; }
    for (var i = 0; i < wall.length; i++) {
      var row = wall[i];
      var kind = row.letter ? 'Letter' : (row.haul ? 'Haul' : (row.job ? 'Job' : 'Notice'));
      /*
        A notice or a job has a title and a body (#2554): the title heads
        it, with Job or Notice, a job's reward, who and when, and the body is
        under it. This page is only for reading, so nothing is folded away.
      */
      if (!row.letter && !row.haul) {
        out += '<div style="margin-bottom:14px"><b>' + esc(row.n) + '. ' + esc(row.title) + '</b><br>' +
               kind + (row.job ? ', ' + esc(String(Number(row.reward) || 0)) + ' gold reward' : '') + ', ' +
               esc(row.name) + (row.at ? ', ' + esc(postedAt(row.at)) : '') +
               (row.taken ? ', taken by ' + esc(row.taken) : '') +
               '<div class="read">' + esc(row.text) + '</div></div>';
        continue;
      }
      out += '<div style="margin-bottom:14px"><b>' + esc(row.n) + '. ' + kind + ', ' + esc(row.name) +
             (row.taken ? ', taken by ' + esc(row.taken) : '') + '</b>' +
             '<div class="read">' + esc(row.text) + '</div></div>';
    }
    var older = Number(read.older) || 0;
    if (older > 0) {
      out += '<div class="none">' + older + (older === 1 ? ' older one is' : ' older ones are') +
             ' up and not on the wall.</div>';
    }
    var jobs = (bv && bv.jobs) || [];
    out += '<h3 style="margin-top:20px">Your jobs</h3>';
    if (!jobs.length) { out += '<div class="none">You have taken none.</div>'; }
    for (var j = 0; j < jobs.length; j++) {
      var job = jobs[j];
      var what = job.letter ? 'Letter' : (job.haul ? 'Haul' : 'Job');
      var head = (!job.letter && !job.haul)
        ? esc(job.title) + '</b><br>' + esc(String(Number(job.reward) || 0)) + ' gold reward'
        : '</b>';
      out += '<div style="margin-bottom:14px"><b>' + esc(job.where || job.hold) + ', ' + esc(job.n) + '. ' +
             what + ', for ' + esc(job.name) + (job.letter || job.haul ? '' : ': ') + head +
             '<div class="read">' + esc(job.text) + '</div></div>';
    }
    if (jobs.length) {
      out += '<div class="none">A job is handed back at the board it came from.</div>';
    }
    put(main, out);
  }

  function groupBook() {
    var g = data && data.group;
    var rows = (g && g.books) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === openGroup) { return rows[i]; }
    }
    return null;
  }

  function leftWords(row) {
    if (row.on) { return 'here'; }
    if (!row.left) { return ''; }
    try {
      var d = new Date(row.left);
      if (isNaN(d.getTime())) { return ''; }
      return 'left ' + d.toLocaleString();
    } catch (e) { return ''; }
  }

  function gold(n) { return n == null || n === '' ? '' : String(n); }

  function drawGroup(main) {
    var book = groupBook();
    if (!book) { put(main, '<div class="none">Gone.</div>'); return; }
    var out = '<div class="from">' + esc(book.name) + ', ' + esc(book.kind) + '</div>';
    if (book.read) {
      out += '<b>People</b>';
      var people = book.people || [];
      if (!people.length) { out += '<div class="none">Nobody in it.</div>'; }
      for (var i = 0; i < people.length; i++) {
        var when = leftWords(people[i]);
        out += '<div class="read">' + esc(people[i].name) + ', ' + esc(people[i].role) +
               (when ? ', ' + esc(when) : '') + '</div>';
      }
      out += '<b>Prices</b>';
      if (book.submitted && book.submitted.length) {
        out += '<div class="none">Submitted to ' + esc(book.submitted.join(', ')) + '.</div>';
      }
      if (book.canPrices) {
        out += '<div class="none">Leave the list on the notice board while you are standing at it. The list stays in the book.</div>';
      }
      var list = book.priceList || [];
      if (!list.length) { out += '<div class="none">No prices yet.</div>'; }
      for (var p = 0; p < list.length; p++) {
        out += '<div class="read">' + esc(list[p].name) +
               ' buy ' + esc(gold(list[p].buy)) + ' sell ' + esc(gold(list[p].sell));
        if (book.canPrices) {
          out += ' <button data-g="drop" data-name="' + esc(list[p].name) + '">Remove</button>';
        }
        out += '</div>';
      }
      if (book.canPrices) {
        out += '<div class="bar"><input id="' + ID + '-price-name" aria-label="Item name" placeholder="what">' +
               '<input id="' + ID + '-price-buy" aria-label="Buying price" placeholder="buy, blank if not">' +
               '<input id="' + ID + '-price-sell" aria-label="Selling price" placeholder="sell, blank if not">' +
               '<button data-g="price">Set price</button></div>';
      }
      out += '<b>Talk</b>';
      var chat = book.chat || [];
      if (!chat.length) { out += '<div class="none">Nothing said yet.</div>'; }
      for (var c = 0; c < chat.length; c++) {
        out += '<div class="read">(( ' + esc(chat[c].name) + ': ' + esc(chat[c].text) + ' ))</div>';
      }
    } else {
      out += '<div class="none">You cannot read this book.</div>';
    }
    if (book.speak) {
      out += '<div class="bar"><input id="' + ID + '-gline" aria-label="Out of character message" placeholder="out of character">' +
             '<button class="go" data-g="say">Say</button></div>';
    }
    if (book.invite) {
      /*
        factions.md: "You invite the character in front of you, or by name".
        The person in front is whoever the look prompt named when J opened,
        sent as the same form id Y, H and L send. Nobody in front, no button.
      */
      out += '<div class="bar">' +
             (facing ? '<button data-g="invitefacing">Invite ' + esc(facing.name) + '</button>' : '') +
             '<input id="' + ID + '-ginvite" aria-label="Person to invite" placeholder="who is here">' +
             '<button data-g="invite">Invite</button></div>';
    }
    if (book.canRoles) {
      /*
        Each role and what it may do, a permission lit while the role holds
        it. A press switches that one and sends the role's whole list
        (factions.md, Roles: "The owner makes the roles and sets what each
        role may do").
      */
      out += '<b>Roles</b>';
      var roleRows = book.roles || [];
      var permNames = (data && data.group && data.group.permNames) || [];
      for (var ri = 0; ri < roleRows.length; ri++) {
        out += '<div class="bar"><span class="grow">' + esc(roleRows[ri].name) + '</span>';
        for (var pn = 0; pn < permNames.length; pn++) {
          var held = (roleRows[ri].perms || []).indexOf(permNames[pn]) !== -1;
          out += '<button data-g="perm" data-role="' + esc(roleRows[ri].name) + '" data-perm="' +
                 esc(permNames[pn]) + '"' + (held ? ' class="go"' : '') + '>' + esc(permNames[pn]) + '</button>';
        }
        out += '</div>';
      }
      out += '<div class="bar"><input id="' + ID + '-grole" aria-label="New role name" placeholder="a role">' +
             '<button data-g="rolenew">New role</button></div>';
      out += '<div class="bar"><input id="' + ID + '-grold" aria-label="Current role name" placeholder="a role">' +
             '<input id="' + ID + '-grnew" aria-label="Replacement role name" placeholder="its new name">' +
             '<button data-g="rolerename">Rename role</button></div>';
    }
    // Invite also removes someone who is not the owner (factions.md, Roles).
    if (book.canRoles || book.invite) {
      out += '<div class="bar"><input id="' + ID + '-gwho" aria-label="Person in the book" placeholder="who is in the book">' +
             (book.canRoles ? '<input id="' + ID + '-gset" aria-label="Role to assign" placeholder="their role">' +
                              '<button data-g="setrole">Set role</button>' : '') +
             (book.invite ? '<button data-g="remove">Remove</button>' : '') + '</div>';
    }
    if (book.owner) {
      out += '<div class="bar"><input id="' + ID + '-grename" aria-label="New group name" placeholder="a new name">' +
             '<button data-g="rename">Rename</button>' +
             '<button data-g="disband">Disband</button></div>';
    }
    if (book.staff) {
      out += '<div class="bar"><input id="' + ID + '-ghand" aria-label="New owner" placeholder="who already belongs">' +
             '<button data-g="give">Hand it on</button></div>';
    }
    if (book.leave) {
      out += '<div class="bar"><button data-g="leave">Leave</button></div>';
    }
    put(main, out);
    var actions = main.querySelectorAll('button[data-g]');
    for (var a = 0; a < actions.length; a++) {
      actions[a].onclick = onGroup;
    }
  }

  // Own only the validity and description token installed for this refusal.
  // Existing hints/errors, and newer changes by another owner, survive cleanup.
  function clearGroupFieldError() {
    var error = groupFieldError;
    if (!error) return;
    groupFieldError = null;
    var field = error.field;
    var ownsValidity = field.validity.customError && field.validationMessage === error.reason;
    var newerError = field.validity.customError && !ownsValidity;
    if (ownsValidity) field.setCustomValidity(error.custom);
    // A surviving replacement error also owns its ordinary true ARIA marker.
    if (field.getAttribute('aria-invalid') === 'true' && !newerError) {
      if (error.invalid == null) field.removeAttribute('aria-invalid');
      else field.setAttribute('aria-invalid', error.invalid);
    }
    if (error.added) {
      var now = field.getAttribute('aria-describedby');
      var remaining = now === error.installed ? error.described :
        String(now || '').split(/\s+/).filter(function (id) { return id && id !== ID + '-field-reason'; }).join(' ');
      if (remaining == null || remaining === '') field.removeAttribute('aria-describedby');
      else field.setAttribute('aria-describedby', remaining);
    }
    var note = root.querySelector('#' + ID + '-field-reason');
    note.textContent = ''; note.style.display = 'none';
  }

  function needGroupField(id, reason) {
    var field = root.querySelector('#' + ID + '-' + id);
    if (!field || !root.contains(field)) return false;
    if (String(field.value || '').trim()) return true;
    var described = field.getAttribute('aria-describedby');
    var added = String(described || '').split(/\s+/).indexOf(ID + '-field-reason') < 0;
    var installed = added ? (described ? described + ' ' : '') + ID + '-field-reason' : described;
    groupFieldError = {field:field,reason:reason,custom:field.validity.customError ? field.validationMessage : '',
      invalid:field.getAttribute('aria-invalid'),described:described,added:added,installed:installed};
    var note = root.querySelector('#' + ID + '-field-reason');
    note.textContent = reason; note.style.display = 'block';
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', installed);
    field.setCustomValidity(reason); field.focus(); field.reportValidity();
    return false;
  }

  function gval(id) {
    var el = root.querySelector('#' + ID + '-' + id);
    return el ? String(el.value || '').trim() : '';
  }

  function blankGold(id) {
    var v = gval(id);
    return v ? v : '-';
  }

  function onGroup() {
    if (!shown || !root.contains(this)) return;
    clearGroupFieldError();
    var book = groupBook();
    if (!book) { return; }
    var verb = this.getAttribute('data-g');
    if (verb === 'say') {
      var line = gval('gline');
      if (!needGroupField('gline', 'Write a message first.')) return;
      net('/book say ' + book.id + ' ' + line);
      return;
    }
    if (verb === 'invite') {
      var who = gval('ginvite');
      if (!needGroupField('ginvite', 'Name the person to invite.')) return;
      net('/book invite ' + book.id + ' ' + who);
      return;
    }
    if (verb === 'invitefacing') {
      if (!facing) { return; }
      net('/book invite ' + book.id + ' ' + facing.id);
      return;
    }
    if (verb === 'leave') { net('/book leave ' + book.id); openGroup = ''; return; }
    if (verb === 'rename') {
      var next = gval('grename');
      if (!needGroupField('grename', 'Give the group a new name.')) return;
      net('/book rename ' + book.id + ' ' + next);
      return;
    }
    if (verb === 'disband') {
      confirmDestructive(this, function () {
        var current = groupBook(); return current && current.id === book.id && current.owner ? current : null;
      }, 'disband "' + book.name + '"', function () {
        if (net('/book disband ' + book.id)) { openGroup = ''; draw(); }
      });
      return;
    }
    if (verb === 'price') {
      var item = gval('price-name');
      if (!needGroupField('price-name', 'Name the item to price.')) return;
      net('/book price ' + book.id + ' | ' + item + ' | ' + blankGold('price-buy') + ' | ' + blankGold('price-sell'));
      return;
    }
    if (verb === 'drop') {
      net('/book price ' + book.id + ' drop | ' + (this.getAttribute('data-name') || ''));
      return;
    }
    if (verb === 'rolenew') {
      var role = gval('grole');
      if (!needGroupField('grole', 'Give the new role a name.')) return;
      net('/book role ' + book.id + ' new | ' + role);
      return;
    }
    if (verb === 'rolerename') {
      var was = gval('grold');
      var renamed = gval('grnew');
      if (!needGroupField('grold', 'Name the current role.') ||
          !needGroupField('grnew', 'Give the role a new name.')) return;
      net('/book role ' + book.id + ' rename | ' + was + ' | ' + renamed);
      return;
    }
    if (verb === 'perm') {
      var rname = this.getAttribute('data-role') || '';
      var flip = this.getAttribute('data-perm') || '';
      var rows = book.roles || [];
      var perms = [];
      for (var ri = 0; ri < rows.length; ri++) {
        if (rows[ri].name === rname) { perms = (rows[ri].perms || []).slice(); }
      }
      var at = perms.indexOf(flip);
      if (at === -1) { perms.push(flip); } else { perms.splice(at, 1); }
      // An empty list is a role that may do nothing, which the server keeps.
      net('/book role ' + book.id + ' perm | ' + rname + ' | ' + perms.join(' '));
      return;
    }
    if (verb === 'setrole') {
      var person = gval('gwho');
      var set = gval('gset');
      if (!needGroupField('gwho', 'Name the person whose role changes.') ||
          !needGroupField('gset', 'Name the role to assign.')) return;
      net('/book member ' + book.id + ' role | ' + person + ' | ' + set);
      return;
    }
    if (verb === 'remove') {
      var gone = gval('gwho');
      if (!needGroupField('gwho', 'Name the person to remove.')) { resetDestructive(); return; }
      confirmDestructive(this, function () {
        var current = groupBook();
        return current && current.id === book.id && current.invite && gval('gwho') === gone
          ? { book: current, who: gone } : null;
      }, 'remove "' + gone + '" from "' + book.name + '"', function () {
        net('/book member ' + book.id + ' remove | ' + gone);
      });
      return;
    }
    if (verb === 'give') {
      var heir = gval('ghand');
      if (!needGroupField('ghand', 'Name the new owner.')) return;
      net('/book give ' + book.id + ' | ' + heir);
    }
  }

  function drawMain() {
    var main = root.querySelector('#' + ID + '-main');
    // Losing the source view is not permission to erase its private local draft.
    // Keep the mounted editor for copying, but retire its former write controls.
    if (draftSourceMissing()) {
      var stale = main.querySelectorAll('button,select');
      for (var si = 0; si < stale.length; si++) stale[si].disabled = true;
      return;
    }


    if (openGroup) { drawGroup(main); return; }

    if (readingShared >= 0) {
      var sh = ((data && data.shared) || [])[readingShared];
      if (!sh) { put(main, '<div class="none">Gone.</div>'); return; }
      var out = '<div class="from">' + esc(sh.title) + ', from ' + esc(sh.from) +
                (sh.whole ? ' (the whole journal)' : ' (shared pages)') + '</div>';
      for (var i = 0; i < sh.pages.length; i++) {
        out += '<div style="margin-bottom:22px"><b>' + esc(sh.pages[i].title) + '</b>' +
               '<div class="read">' + esc(sh.pages[i].text) + '</div></div>';
      }
      put(main, out);
      return;
    }

    var book = bookOf(openBook);
    if (!book) {
      if (boardsShown()) { drawBoards(main); return; }
      put(main, '<div class="none">Pick a journal on the left, or start one.</div>');
      return;
    }

    var friends = ((data && data.friends) || []).filter(function (f) { return true; });
    var pick = '<select id="' + ID + '-who"><option value="">a friend...</option>';
    for (var f = 0; f < friends.length; f++) {
      var whoId = friends[f].p != null && friends[f].p !== '' ? String(friends[f].p) : friends[f].name;
      pick += '<option value="' + esc(whoId) + '">' + esc(friends[f].name) + '</option>';
    }
    pick += '</select>';

    var html =
      '<div class="bar">' +
      '<input id="' + ID + '-title" aria-label="Journal title" value="' + esc(book.title) + '" style="max-width:360px">' +
      '<button data-do="rename">Rename</button>' +
      '<span class="grow"></span>' +
      '<button data-do="dropbook">Throw away</button>' +
      '</div>' +
      '<div class="bar">' +
      '<span style="color:rgba(198,170,109,.85);font-size:13px;letter-spacing:.18em;text-transform:uppercase">Share with</span>' +
      pick +
      '<button data-do="sharebook">Whole journal</button>' +
      '<button data-do="unsharebook">Stop sharing</button>' +
      '</div>';

    html += '<div class="bar">';
    for (var p = 0; p < book.pages.length; p++) {
      html += '<button data-page="' + esc(book.pages[p].id) + '"' +
              (book.pages[p].id === openPage ? ' class="go"' : '') + '>' +
              esc(book.pages[p].title) + '</button>';
    }
    html += '<button class="go" data-do="newpage">New page</button></div>';

    var page = pageOf(book, openPage);
    if (pageDraft && (pageDraft.journalId !== book.id || pageDraft.pageId !== openPage)) pageDraft = null;
    if (!page) {
      html += '<div class="none">' + (book.pages.length ? 'Pick a page.' : 'No pages yet.') + '</div>';
    } else {
      html +=
        '<div class="bar">' +
        '<input id="' + ID + '-ptitle" aria-label="Page title" maxlength="' + TITLE_CHARS + '" value="' + esc(pageDraft ? pageDraft.title : page.title) + '" style="max-width:320px">' +
        '<span class="grow"></span>' +
        '<button data-do="sharepage">Share this page</button>' +
        '<button data-do="unsharepage">Stop sharing it</button>' +
        '<button class="go" data-do="save">Save</button>' +
        '</div>' +
        '<textarea id="' + ID + '-text" aria-label="Page text" maxlength="' + PAGE_CHARS + '">' + esc(pageDraft ? pageDraft.text : (page.text || '')) + '</textarea>';
    }

    put(main, html);

    var pages = main.querySelectorAll('button[data-page]');
    for (var q = 0; q < pages.length; q++) {
      pages[q].onclick = function () {
        var pageId = this.getAttribute('data-page');
        if (pageId === openPage) return;
        leavePage(function () { openPage = pageId; draw(); }, function () { return !!pageOf(bookOf(book.id), pageId); });
      };
    }
    var acts = main.querySelectorAll('button[data-do]');
    for (var r = 0; r < acts.length; r++) {
      acts[r].onclick = function () { act(this.getAttribute('data-do'), book, this); };
    }
    if (page) {
      var titleField = root.querySelector('#' + ID + '-ptitle');
      var textField = root.querySelector('#' + ID + '-text');
      if (titleField) { titleField.value = pageDraft ? pageDraft.title : page.title; titleField.oninput = function () { captureDraft(book); }; }
      if (textField) { textField.value = pageDraft ? pageDraft.text : (page.text || ''); textField.oninput = function () { captureDraft(book); }; }
    }
  }

  function draftSourceMissing() {
    var source = pageDraft && bookOf(pageDraft.journalId);
    return !!pageDraft && (!source || !pageOf(source, pageDraft.pageId));
  }

  function captureDraft(book) {
    cancelLeave(false); leaveNotice = '';
    var active = document.activeElement;
    if (active && (active.id === ID + '-ptitle' || active.id === ID + '-text')) lastEdit = active.id === ID + '-ptitle' ? 'ptitle' : 'text';
    pageDraft = {journalId:book.id,pageId:openPage,title:val('ptitle'),text:val('text')};
    drawJournalFoot();
  }

  function reconcileDraft() {
    if (!pageDraft || !data) return;
    var answer = data.journalSave;
    var book = bookOf(pageDraft.journalId), page = book && pageOf(book, pageDraft.pageId);
    if (answer && answer.status === 'saved' && answer.journalId === pageDraft.journalId &&
        answer.pageId === pageDraft.pageId && answer.title === pageDraft.title && answer.text === pageDraft.text &&
        page && page.title === pageDraft.title && page.text === pageDraft.text) {
      if (pendingLeave) cancelLeave(leaveChoice.contains(document.activeElement));
      pageDraft = null;
      if (shown) drawJournalFoot();
    }
  }

  function drawJournalFoot() {
    var foot = root && root.querySelector('#' + ID + '-foot');
    if (foot) foot.textContent = (draftSourceMissing() ? 'This page is no longer available. Your unsaved text is kept here for copying. ' : '') + leaveNotice + (pageDraft ? 'Unsaved changes. ' : '') +
      'Escape' + (keyName ? ' or ' + keyName : '') + ' closes this. Sharing needs them to be a friend.';
  }

  function sayNeedFriend() {
    var foot = root && root.querySelector('#' + ID + '-foot');
    if (foot) { foot.textContent = 'Pick a friend first. Sharing only works with somebody on your list.'; }
  }

  function val(id) {
    var el = root.querySelector('#' + ID + '-' + id);
    return el ? String(el.value || '') : '';
  }

  function act(verb, book, button) {
    book = book && bookOf(book.id);
    if (!book || (verb === 'save' && !pageOf(book, openPage))) { drawJournalFoot(); return; }

    var who = val('who');
    if (verb === 'rename') {
      net('/journal title ' + book.id + ' ' + val('title'));
      return;
    }
    if (verb === 'newpage') {
      leavePage(null, function () { return !!bookOf(book.id); },
        function () { return !!net('/journal-write-v1 ' + JSON.stringify([book.id, '', 'New page', ''])); });
      return;
    }
    if (verb === 'save') {
      captureDraft(book);
      var raw = val('text');
      if (raw.length > PAGE_CHARS) {
        var foot = root.querySelector('#' + ID + '-foot');
        if (foot) { foot.textContent = 'That page is ' + raw.length + ' characters long and a page holds ' + PAGE_CHARS + '. Shorten it to save.'; }
        return;
      }
      var title = val('ptitle');
      var line = '/journal-write-v1 ' + JSON.stringify([book.id, openPage || '', title, raw]);
      if (title.length > TITLE_CHARS || line.length > 25000) {
        var titleFoot = root.querySelector('#' + ID + '-foot');
        if (titleFoot) titleFoot.textContent = 'That page request is too long. Nothing was sent; your draft is unsaved.';
        return;
      }
      net(line);
      return;
    }
    if (verb === 'dropbook') {
      if (!shown || !root.contains(button)) return;
      var snapshot = JSON.stringify(book);
      var current = function () { return openBook === book.id ? bookOf(book.id) : null; };
      var send = function () { return !!net('/journal drop ' + book.id); };
      if (pageDraft) {
        resetDestructive();
        leavePage(function () { openBook = ''; draw(); }, function () { return JSON.stringify(current()) === snapshot; },
          send, book.title);
      } else {
        confirmDestructive(button, current, 'throw away "' + book.title + '"', function () {
          if (send()) { openBook = ''; draw(); }
        });
      }
      return;
    }
    if (verb === 'sharebook') {
      if (!who) { sayNeedFriend(); return; }
      net('/journal share ' + book.id + ' - ' + who);
      return;
    }
    if (verb === 'unsharebook') { net('/journal unshare ' + book.id + ' -'); return; }
    if (verb === 'sharepage') {
      if (!openPage) { return; }
      if (!who) { sayNeedFriend(); return; }
      net('/journal share ' + book.id + ' ' + openPage + ' ' + who);
      return;
    }
    if (verb === 'unsharepage') {
      if (!openPage) { return; }
      net('/journal unshare ' + book.id + ' ' + openPage);
    }
  }

  // In place, so what is being typed and its focus outlast the update (#4475).
  // The main page's controls are new ones whenever it shows something else.
  function put(host, html, subject) {
    if (subject === undefined) {
      var bv = data && data.boards;
      subject = JSON.stringify([openGroup, readingShared, openBook, openPage, bv && bv.read && bv.read.hold]);
    }
    if (window.thornswoodDialog) { window.thornswoodDialog.patch(host, html, subject); } else { host.innerHTML = html; }
  }

  function draw() {
    if (!root || !shown) { return; }
    clearGroupFieldError();
    resetDestructive();
    drawSide();
    drawMain();
    drawJournalFoot();
  }

  function open() {
    build();
    if (shown) { return; }
    shown = true;
    root.className = 'on';
    fit();
    draw();
    if (window.thornswoodDialog) window.thornswoodDialog.open(root.querySelector('.panel'), root.querySelector('h2'));
    tell('opened');
  }

  function close() {
    if (!shown) { return; }
    resetDestructive(); destructiveHeld = '';
    clearGroupFieldError();
    shown = false; cancelLeave(false);
    if (root) { root.className = ''; }
    tell('closed');
  }

  function toggle() { if (shown) { close(); } else { open(); } }

  window.thornswoodJournal = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return shown; },
    scaleFor: scaleFor,
    /*
      JournalKey's name, as the front has it bound, so the key that opened
      this closes it wherever it is. A key the front has no name for (#57,
      say) is not one this page can hear, so only Escape closes it then; the
      same as the P panel's setKey (#1919).
    */
    setKey: function (name) {
      var n = String(name == null ? '' : name);
      keyName = n.charAt(0) === '#' ? '' : n;
      if (shown) { draw(); }
    },
    /*
      Who was in front of you as J opened, from the look prompt
      (thornswood-front.js, the journal facing handler), or null for nobody.
      The group tab offers Invite with their name only while there is
      somebody. Not redrawn under somebody typing, the same as setData.
    */
    setFacing: function (f) {
      facing = (f && f.id) ? { id: String(f.id), name: String(f.name || 'them') } : null;
      if (!shown) { return; }
      var el = document.activeElement;
      if (el && root && root.contains && root.contains(el) && typing(el)) { return; }
      draw();
    },
    setData: function (d) {
      resetDestructive();
      var sourceWasMissing = draftSourceMissing();
      data = d || null;
      reconcileDraft();
      // The new journal has arrived, so New answers the next press again.
      if ((newAt || newQueued) && books().length !== newFrom) { newAt = 0; newFrom = -1; newQueued = false; }
      /*
        Redrawn on every push, and that is a real cost: typing into a page and
        having a friend log in would otherwise rebuild the textarea under the
        cursor. So a draw that would replace the text box leaves it alone
        while it has focus.
      */
      if (!shown) { return; }
      if (sourceWasMissing || draftSourceMissing()) { draw(); return; }
      var el = document.activeElement;
      if (el && root && root.contains && root.contains(el) && typing(el)) { return; }
      draw();
    }
  };

  build();
  // Owner updates can precede this asynchronously loaded script (#1275).
  if (window.thornswoodSocialView) {
    window.thornswoodJournal.setData(window.thornswoodSocialView);
  }
  tell('ready');
})();
