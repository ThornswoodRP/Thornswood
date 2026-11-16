// ==== thornswood take back ====
/*
  ============================================================================
  TAKING GOLD OR A THING BACK OUT OF A CHARACTER (#6271).

  Patrick, 16 Nov 2026: "With trade logs you can just delete ill gotten gold
  instead of having to wipe or let your economy get fucked". The gold and
  trade log (#6270) says who holds gold gained by cheating. An admin asks on
  the hub's Gold and trades page, and this server does it.

  WHY HERE AND NOT IN THE STORE. This server read the whole world into
  memory when it started and writes each changed character back to its
  store (the files today, MongoDB after #6237) as it changes. An edit made
  in the store behind its back is written over the next time that character
  changes here, and lost at the next start if it does not. The engine keeps
  every character in memory whether its owner is connected or not, so the
  change is made here, on the character, and saved like any other.

  THE TURN. Every 30 seconds (EVERY_MS) this asks the site POST
  /api/takeback (the door's __thornswoodAskSite: door.json's site, which is
  /dev for the dev server, and the door key in a header) with what it did
  with the asks it had, and gets the ones still waiting for it. Each ask
  is { id, pid, record, count, why, byName }.

  TAKEN ONCE. An ask done is marked on the character itself (TAKEN_PROPERTY,
  the last MARKS_KEPT ask ids), in the same save as the pack it changed. So
  an answer that never reached the site, or a restart before it did, finds
  the mark and answers done again instead of taking a second time.

  WHAT IS TAKEN is what the character holds of that record, up to the count
  asked and never more: things not worn first, then worn ones. The answer
  says how many were taken, and the site's line in the staff channel says
  so beside how many were asked. A character this server does not hold, or
  a record it does not know, is answered as not done, with why.

  The take goes in the gold and trade log too, as a take back, so a search
  of the person shows it beside what it undid.
  ============================================================================
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var EVERY_MS = 30000;
  var MARKS_KEPT = 200;
  var TAKEN_PROPERTY = 'thornswoodTakenBack';

  function tblog() {
    var a = ['[thornswood take back]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  try {
    mp.makeProperty(TAKEN_PROPERTY, { isVisibleByOwner: false, isVisibleByNeighbors: false, updateOwner: '', updateNeighbor: '' });
  } catch (e) {
    // Made already by an earlier load of this block: a hot reload.
  }

  // On globalThis, so a hot reload keeps the answers not yet handed back.
  if (!g.__thornswoodTakeBackState) { g.__thornswoodTakeBackState = { done: [], asking: false }; }
  var state = g.__thornswoodTakeBackState;

  function actorOf(pid) {
    var got = null;
    try { got = mp.getActorsByProfileId(Number(pid) || 0); } catch (e) { got = null; }
    return (got && got.length) ? Number(got[0]) || 0 : 0;
  }
  function marksOf(actorId) {
    var m = null;
    try { m = mp.get(actorId, TAKEN_PROPERTY); } catch (e) { m = null; }
    return (m && Array.isArray(m.asks)) ? m.asks : [];
  }

  /*
    One ask, done on the character: { id, ok, took, why }. Never throws: a
    write that fails is an answer that says so, and nothing was taken.
  */
  function doAsk(ask) {
    var id = String(ask.id || '');
    var count = Math.floor(Number(ask.count) || 0);
    if (!id || !(count > 0)) { return { id: id, ok: false, took: 0, why: 'the ask had no id or no count' }; }
    var actorId = actorOf(ask.pid);
    if (!actorId) { return { id: id, ok: false, took: 0, why: 'this server holds no character with profile ' + ask.pid }; }
    var marks = marksOf(actorId);
    for (var m = 0; m < marks.length; m++) {
      if (marks[m] && marks[m].id === id) { return { id: id, ok: true, took: Number(marks[m].took) || 0, why: 'already done' }; }
    }
    var baseId = 0;
    try { baseId = Number(mp.getIdFromDesc(String(ask.record || ''))) || 0; } catch (e) { baseId = 0; }
    if (!baseId) { return { id: id, ok: false, took: 0, why: 'this server does not know the record ' + ask.record }; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory') || { entries: [] }; } catch (e) { return { id: id, ok: false, took: 0, why: 'the pack could not be read' }; }
    var entries = (inv.entries || []).slice();
    var left = count;
    // Not worn first, then worn.
    for (var pass = 0; pass < 2 && left > 0; pass++) {
      for (var k = 0; k < entries.length && left > 0; k++) {
        var e = entries[k];
        if (!e || Number(e.baseId) !== baseId) { continue; }
        if ((pass === 0) === !!e.worn) { continue; }
        var had = Number(e.count) || 1;
        var take = Math.min(left, had);
        var rest = {};
        for (var f in e) { if (Object.prototype.hasOwnProperty.call(e, f)) { rest[f] = e[f]; } }
        rest.count = had - take;
        entries[k] = rest;
        left -= take;
      }
    }
    var took = count - left;
    var keep = [];
    for (var j = 0; j < entries.length; j++) { if (entries[j] && (Number(entries[j].count) || 0) > 0) { keep.push(entries[j]); } }
    var mark = { id: id, took: took, at: Date.now() };
    var newMarks = marks.concat([mark]).slice(-MARKS_KEPT);
    try {
      if (took > 0) { mp.set(actorId, 'inventory', { entries: keep }); }
      mp.set(actorId, TAKEN_PROPERTY, { asks: newMarks });
    } catch (e2) {
      return { id: id, ok: false, took: 0, why: 'the pack could not be written: ' + String((e2 && e2.message) || e2) };
    }
    var name = '';
    try { var ap = mp.get(actorId, 'appearance'); name = String((ap && ap.name) || ''); } catch (e3) { name = ''; }
    tblog(String(ask.byName || 'an admin'), 'took back', took, 'of', count, ask.record, 'from', (name || 'somebody'),
          '(profile ' + ask.pid + '):', String(ask.why || ''));
    var l = g.__thornswoodLedger;
    if (took > 0 && l && typeof l.takeBack === 'function') {
      try { l.takeBack(actorId, ask.record, took, String(ask.byName || '')); }
      catch (e4) { tblog('the gold and trade log would not take the take back:', String((e4 && e4.message) || e4)); }
    }
    return { id: id, ok: true, took: took, why: took < count ? 'they held ' + took : '' };
  }

  function turn() {
    if (state.asking) { return; }
    var ask = g.__thornswoodAskSite;
    if (typeof ask !== 'function') { return; }
    var handing = state.done.slice();
    state.asking = true;
    ask('/api/takeback', { done: handing }, function (why, doc) {
      state.asking = false;
      if (why) {
        if (why !== state.said) { tblog('the site was not asked:', why, '; the answers are kept for the next turn'); state.said = why; }
        return;
      }
      state.said = '';
      // The site has the answers it was handed.
      state.done.splice(0, handing.length);
      var waiting = (doc && Array.isArray(doc.waiting)) ? doc.waiting : [];
      for (var i = 0; i < waiting.length; i++) {
        var already = false;
        for (var d = 0; d < state.done.length; d++) { if (state.done[d].id === waiting[i].id) { already = true; } }
        if (!already) { state.done.push(doAsk(waiting[i])); }
      }
    });
  }

  if (g.__thornswoodTakeBackTimer) { try { clearInterval(g.__thornswoodTakeBackTimer); } catch (e) { } }
  state.asking = false;
  g.__thornswoodTakeBackTimer = setInterval(function () {
    try { turn(); } catch (e) { state.asking = false; tblog('the turn threw:', String((e && e.message) || e)); }
  }, EVERY_MS);

  g.__thornswoodTakeBack = { doAsk: doAsk, turn: turn, EVERY_MS: EVERY_MS, TAKEN_PROPERTY: TAKEN_PROPERTY,
                             answers: function () { return state.done.slice(); } };
  tblog('ready: asks from the hub are taken every', EVERY_MS / 1000, 's');
})();
// ==== end thornswood take back ====
