// ==== thornswood map calendar ====
/*
  THE DATE, THE SEASON AND THE SERVER CLOCK ON THE MAP (#3156).

  Patrick, 22 Oct 2026, on his page: C, they show on the map menu. The front
  plugin draws them while the map is open (thornswood-front.js, THE MAP'S
  CALENDAR). This block hands it the two things only the server knows:

    - the season, from the season block above, the one after it, and when
      it turns;
    - the server's clock: the zone the box keeps (Mountain time,
      scripts/vps/vps-harden.ps1's $BoxTimeZone, the clock staff give times
      in), as its offset from UTC in minutes and its short name.

  The date itself is the game's calendar, which the engine's TimeService
  writes from today's date in UTC, the year 4E 252 in 2026. The front reads
  it from the same globals the game's own map line reads, so the two never
  disagree, and nothing here sends it.

  One property, seen by its owner only. The pass below sets it on everybody
  online whose value is not the one wanted now: once each time somebody
  comes on, then only when a season turns or the clock goes on or off
  summer time. What each character was last given is kept here, so the pass asks
  the engine nothing. A property is kept on the character, so whoever joins
  has the last value at once, and a value that went out of date while they
  were away is put right within one pass.
*/
(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var PROP = 'thornswoodCalendar';
  var EVERY_MS = 5000;
  var told = {};       // actorId -> the signature it was last given

  function clog() {
    var a = ['[thornswood calendar]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  /* The box's zone at now: minutes east of UTC, and its short name (MDT,
     MST), or '' when this Node cannot name it. */
  function zoneAt(now) {
    var d = new Date(now);
    var name = '';
    try {
      var parts = d.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ');
      name = parts[parts.length - 1];
    } catch (e) {
      name = '';
    }
    if (!/^[A-Za-z][A-Za-z0-9+:-]{1,8}$/.test(name)) { name = ''; }
    return { off: -d.getTimezoneOffset(), tz: name };
  }

  /* What everybody should hold at now. */
  function calendarAt(now) {
    var z = zoneAt(now);
    var v = { season: '', next: '', turns: 0, off: z.off, tz: z.tz };
    var S = g.__thornswoodSeason;
    if (S && S.seasonAt && S.turnsAt) {
      v.season = S.seasonAt(now);
      v.turns = S.turnsAt(now);
      v.next = S.seasonAt(v.turns);
    }
    return v;
  }

  function signature(v) {
    return [v.season, v.next, v.turns, v.off, v.tz].join('|');
  }

  /*
    ON THE CLIENT. Handed to the front through globalThis.thornswoodCalendar,
    the one thing the two scopes share, as the needs HUD hands it drunk. Only
    marked as handed over once the hook is there, so a front that loads after
    this first runs is still told.
  */
  function calendarScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    var sig = [v.season, v.next, v.turns, v.off, v.tz].join("|");',
      '    if (st.thornswoodCalendar === sig) { return; }',
      '    if (typeof globalThis === "undefined" || typeof globalThis.thornswoodCalendar !== "function") { return; }',
      '    globalThis.thornswoodCalendar({ season: String(v.season || ""), next: String(v.next || ""),',
      '      turns: Number(v.turns) || 0, off: Number(v.off), tz: String(v.tz || "") });',
      '    st.thornswoodCalendar = sig;',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  try {
    mp.makeProperty(PROP, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: calendarScript(),
      updateNeighbor: ''
    });
  } catch (e) {
    clog('could not make the property, so the map shows the date alone:', e);
  }

  function pass(now) {
    var want = calendarAt(now || Date.now());
    var sig = signature(want);
    var online = mp.get(0, 'onlinePlayers') || [];
    var here = {};
    for (var i = 0; i < online.length; i++) {
      var id = online[i];
      here[id] = true;
      if (told[id] === sig) { continue; }
      try {
        mp.set(id, PROP, want);
        told[id] = sig;
      } catch (e) {
        clog('could not set the calendar on ' + id + ':', e);
      }
    }
    for (var gone in told) {
      if (Object.prototype.hasOwnProperty.call(told, gone) && !here[gone]) { delete told[gone]; }
    }
  }

  g.__thornswoodCalendar = { prop: PROP, at: calendarAt, pass: pass, script: calendarScript, told: told };

  if (g.__thornswoodCalendarTimer) { clearInterval(g.__thornswoodCalendarTimer); }
  g.__thornswoodCalendarTimer = setInterval(function () {
    try { pass(Date.now()); } catch (e) { clog('the pass failed, nobody was told:', e); }
  }, EVERY_MS);
  var first = calendarAt(Date.now());
  clog('the server clock is ' + (first.tz || 'unnamed') + ', ' + first.off + ' minutes from UTC; ' +
       (first.season || 'no season') + ' turns to ' + (first.next || 'nothing') + ' at ' +
       (first.turns ? new Date(first.turns).toISOString() : 'no time'));
})();
// ==== end thornswood map calendar ====

