// ==== thornswood season ====
/*
  THE SEASON AND THE SKY.

  docs/systems/temperature.md and docs/systems/classes/farmer.md.
  Four seasons, 7 real days each, one for the whole province. The first
  time this server counts one, that moment is spring. The count is kept
  in private/season.json so a restart does not start spring over.

  A season shifts an outdoor target. Indoors ignores it. Spring 0,
  summer 4 warmer, autumn 2 colder, winter 6 colder. That shift is
  applied before clothing, fire and the sky.

  The sky is one roll per climate, shared by everybody standing in it.
  It lasts 20 to 60 real minutes, a whole number of minutes, each length
  as likely as the others. Then it rolls again. The next sky is not
  announced.

  Clear, cloudy, rain and snow can all come up in every season. Winter
  changes the odds. It does not lock the sky to snow. The chances are
  the table on the temperature page, out of 100. A snowy climate moves
  10 from clear onto snow. Clear does not go under 10. If it would, the
  rest comes off rain. A mild climate moves 5 from snow onto clear, and
  snow may land on 0. Winterhold, the Pale, and the high mountains are
  the snowy climates. The high mountains are height above 6,000 units,
  the same cut the temperature page uses for height. Whiterun, the Rift
  and Falkreath are the mild climates. Every other climate uses the
  table as it is written.

  The records are Cathedral Weathers, the ones already in weather.json.
  Nothing here follows the game's months, and nothing here bans rain
  in winter.

  Crops: spring and summer, every rank. Autumn, novice and advanced.
  An expert crop waits. Winter, no rank. The plot stays sown. The crop
  clock does not run, even on a warm day. A plot that waited finishes
  later from where the clock stopped. Time before the first season
  count is spring, so a crop already in the ground is not thrown back
  to the start.

  Yields and cooling (#3144). Patrick, 22 Oct, A: seasons are mild,
  yields up or down a quarter, winter cold a quarter faster. A crop
  brought in, a plant picked and a fish caught give a quarter more in
  summer and a quarter less in winter; spring and autumn give what the
  rank gives. The season is the one at the moment of the harvest. The
  share is a whole number out on average: 2 and a half is 2 or 3, half
  the time each, so a winter plant that gives 1 is bare a quarter of
  the time. Out under the sky in winter the meter cools a quarter
  faster; warming does not change, and a roof ignores it.
*/
(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var WEEK = 7 * 24 * 60 * 60 * 1000;
  var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  var SHIFT = { spring: 0, summer: 4, autumn: -2, winter: -6 };
  var YIELD = { spring: 1, summer: 1.25, autumn: 1, winter: 0.75 };
  var COOLING = { spring: 1, summer: 1, autumn: 1, winter: 1.25 };
  var TABLE = {
    spring: { clear: 30, cloudy: 30, rain: 35, snow: 5 },
    summer: { clear: 40, cloudy: 30, rain: 28, snow: 2 },
    autumn: { clear: 25, cloudy: 30, rain: 35, snow: 10 },
    winter: { clear: 20, cloudy: 35, rain: 25, snow: 20 }
  };
  var SNOWY = {
    WinterholdHoldLocation: true,
    PaleHoldLocation: true,
    mountains: true
  };
  var MILD = {
    WhiterunHoldLocation: true,
    RiftHoldLocation: true,
    FalkreathHoldLocation: true
  };
  var HIGH = 6000;
  var SKY_PROPERTY = 'thornswoodSky';
  var pushed = {};

  function slog() {
    var a = ['[thornswood season]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  function unit() {
    try {
      if (typeof g.__thornswoodSeasonUnit === 'function') {
        var u = Number(g.__thornswoodSeasonUnit());
        if (isFinite(u)) { return u < 0 ? 0 : (u >= 1 ? 0.999999 : u); }
      }
    } catch (e) { }
    return Math.random();
  }

  function seasonPath() {
    var fs = require('fs');
    var path = require('path');
    var priv = 'private';
    try {
      var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { priv = String(cfg.privDir); }
    } catch (e) { }
    try { if (!fs.existsSync(priv)) { fs.mkdirSync(priv, { recursive: true }); } } catch (e2) { }
    return path.join(priv, 'season.json');
  }

  function freshState(now) {
    return { epoch: now, rolls: {} };
  }

  function loadState() {
    var now = Date.now();
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(seasonPath(), 'utf8')); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') { return freshState(now); }
    var epoch = Number(raw.epoch) || 0;
    if (epoch <= 0) { epoch = now; }
    var rolls = {};
    var src = (raw.rolls && typeof raw.rolls === 'object') ? raw.rolls : {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) { continue; }
      if (k === '__proto__') { continue; }
      var row = src[k];
      if (!row || typeof row !== 'object') { continue; }
      var kind = String(row.kind || '');
      var desc = String(row.desc || '');
      var until = Number(row.until) || 0;
      var id = Number(row.id) || 0;
      if (!kind || !desc || until <= 0) { continue; }
      rolls[String(k)] = { kind: kind, desc: desc, id: id, hex: id ? id.toString(16) : '', until: until };
    }
    return { epoch: epoch, rolls: rolls };
  }

  function saveState() {
    try {
      var rolls = {};
      for (var k in state.rolls) {
        if (!Object.prototype.hasOwnProperty.call(state.rolls, k)) { continue; }
        if (k === '__proto__') { continue; }
        var row = state.rolls[k];
        rolls[k] = { kind: row.kind, desc: row.desc, id: row.id, until: row.until };
      }
      require('fs').writeFileSync(seasonPath(), JSON.stringify({ epoch: state.epoch, rolls: rolls }));
    } catch (e) { slog('could not write the season file:', e); }
  }

  if (!g.__thornswoodSeasonState) { g.__thornswoodSeasonState = loadState(); }
  var state = g.__thornswoodSeasonState;
  try {
    if (!require('fs').existsSync(seasonPath())) { saveState(); }
  } catch (eSave) { }


  function seasonIndex(t) {
    var elapsed = t - state.epoch;
    if (elapsed < 0) { return 0; }
    return Math.floor(elapsed / WEEK);
  }

  function seasonName(t) {
    if (t < state.epoch) { return 'spring'; }
    return SEASONS[seasonIndex(t) % 4];
  }

  function allows(rank, season) {
    if (season === 'winter') { return false; }
    if (season === 'autumn') { return rank === 'novice' || rank === 'advanced'; }
    return true;
  }

  function grownMs(from, to, rank) {
    from = Number(from) || 0;
    to = Number(to) || 0;
    if (to <= from) { return 0; }
    rank = String(rank || 'novice');
    var total = 0;
    var t = from;
    var guard = 0;
    while (t < to && guard < 80) {
      guard++;
      var name, next;
      if (t < state.epoch) {
        name = 'spring';
        next = state.epoch;
      } else {
        var idx = Math.floor((t - state.epoch) / WEEK);
        name = SEASONS[idx % 4];
        next = state.epoch + (idx + 1) * WEEK;
      }
      var end = next < to ? next : to;
      if (end <= t) { t += 1; continue; }
      if (allows(rank, name)) { total += end - t; }
      t = end;
    }
    return total;
  }

  /*
    A harvest's count for the season (#3144). The quarter is kept on
    average: the whole part always, and one more as often as the part
    left over, so 3 in winter is 2 three times in four and 3 once.
  */
  function seasonYield(count, now) {
    count = Math.floor(Number(count) || 0);
    if (count <= 0) { return 0; }
    var exact = count * (YIELD[seasonName(now || Date.now())] || 1);
    var whole = Math.floor(exact);
    if (exact > whole && unit() < exact - whole) { whole++; }
    return whole;
  }

  // The words a harvest line adds, '' in a season that changes nothing.
  function yieldWord(now) {
    var season = seasonName(now || Date.now());
    var share = YIELD[season] || 1;
    if (share === 1) { return ''; }
    var name = season.charAt(0).toUpperCase() + season.slice(1);
    return share > 1 ? name + ' gives more.' : name + ' gives less.';
  }

  function copyOdds(season) {
    var src = TABLE[season] || TABLE.spring;
    return { clear: src.clear, cloudy: src.cloudy, rain: src.rain, snow: src.snow };
  }

  function adjusted(season, climate) {
    var o = copyOdds(season);
    if (SNOWY[climate]) {
      var want = 10;
      var fromClear = o.clear - 10;
      if (fromClear < 0) { fromClear = 0; }
      var takeClear = fromClear < want ? fromClear : want;
      var rest = want - takeClear;
      if (rest > o.rain) { rest = o.rain; }
      o.clear -= takeClear;
      o.rain -= rest;
      o.snow += takeClear + rest;
    } else if (MILD[climate]) {
      var take = o.snow < 5 ? o.snow : 5;
      o.snow -= take;
      o.clear += take;
    }
    return o;
  }

  function pickKind(odds, n) {
    var order = ['clear', 'cloudy', 'rain', 'snow'];
    var left = n;
    for (var i = 0; i < order.length; i++) {
      left -= odds[order[i]];
      if (left < 0) { return order[i]; }
    }
    return 'snow';
  }

  var skyPools = null;
  function pools() {
    if (skyPools) { return skyPools; }
    skyPools = { clear: [], cloudy: [], rain: [], snow: [] };
    var table = null;
    try {
      table = (typeof WEATHER !== 'undefined' && WEATHER && WEATHER.items) ? WEATHER.items : null;
    } catch (e) { table = null; }
    if (!table) { return skyPools; }
    for (var d in table) {
      if (!Object.prototype.hasOwnProperty.call(table, d)) { continue; }
      if (d.indexOf('Cathedral Weathers.esp') < 0) { continue; }
      var row = table[d];
      var k = Number(row && row.k) || 0;
      var kind = '';
      if (k & 8) { kind = 'snow'; }
      else if (k & 4) { kind = 'rain'; }
      else if (k & 2) { kind = 'cloudy'; }
      else if (k & 1) { kind = 'clear'; }
      if (kind) { skyPools[kind].push({ desc: d, k: k }); }
    }
    return skyPools;
  }

  function ensureRoll(climate, now) {
    climate = String(climate || 'open');
    now = now || Date.now();
    var row = Object.prototype.hasOwnProperty.call(state.rolls, climate) ? state.rolls[climate] : null;
    if (row && row.until > now && row.desc) { return row; }
    var season = seasonName(now);
    var odds = adjusted(season, climate);
    var kind = pickKind(odds, Math.floor(unit() * 100));
    var pool = pools()[kind] || [];
    if (!pool.length) { return row; }
    var rec = pool[Math.floor(unit() * pool.length)];
    var minutes = 20 + Math.floor(unit() * 41);
    var id = 0;
    try { id = (typeof idOf === 'function') ? idOf(rec.desc) : 0; } catch (e) { id = 0; }
    var next = {
      kind: kind,
      desc: rec.desc,
      id: id || 0,
      hex: id ? Number(id).toString(16) : '',
      until: now + minutes * 60000,
      minutes: minutes
    };
    state.rolls[climate] = next;
    saveState();
    return next;
  }

  function climateOf(actorId, n) {
    if (n && n.place !== 'indoors' && !n.roof && Number(n.high) > HIGH) { return 'mountains'; }
    var cell = '';
    var pos = null;
    try {
      cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      pos = mp.get(actorId, 'pos');
    } catch (e) { cell = ''; }
    if (cell.toLowerCase() === '800:dragonborn.esm') { return 'DLC2SolstheimLocation'; }
    var outdoors = false;
    try {
      outdoors = (typeof WORLDSPACES !== 'undefined' && WORLDSPACES && WORLDSPACES.has)
        ? WORLDSPACES.has(cell) : false;
    } catch (e2) { outdoors = false; }
    var hold = null;
    if (!outdoors) {
      try { if (typeof holdOfCell === 'function') { hold = holdOfCell(cell); } } catch (e3) { hold = null; }
    }
    if (!hold && pos) {
      var p = (pos && typeof pos.length === 'number') ? { x: pos[0], y: pos[1] } : pos;
      try { if (typeof nearestCapital === 'function') { hold = nearestCapital(p); } } catch (e4) { hold = hold; }
    }
    return hold || 'open';
  }

  function skyScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var id = Number(v.id) || 0;',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodSkyId === id) { return; }',
      '    st.thornswoodSkyId = id;',
      '    if (!id) {',
      '      try { if (ctx.sp.Weather.releaseOverride) { ctx.sp.Weather.releaseOverride(); } } catch (e0) { }',
      '      return;',
      '    }',
      '    var form = ctx.sp.Game.getFormEx(id);',
      '    if (!form) { return; }',
      '    var weather = ctx.sp.Weather.from(form);',
      '    if (weather && weather.forceActive) { weather.forceActive(true); }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  try {
    mp.makeProperty(SKY_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: skyScript(),
      updateNeighbor: ''
    });
  } catch (e) { }

  function pushSky(actorId, id) {
    id = Number(id) || 0;
    if (pushed[actorId] === id) { return; }
    pushed[actorId] = id;
    try { mp.set(actorId, SKY_PROPERTY, { id: id, at: Date.now() }); } catch (e) { }
  }

  function skyAdjust(actorId, n) {
    n = n || {};
    var indoors = n.place === 'indoors' || !!n.roof;
    if (indoors) {
      pushSky(actorId, 0);
      return { sky: n.sky || '', place: n.place || '', id: 0, indoors: true };
    }
    var climate = climateOf(actorId, n);
    var roll = ensureRoll(climate, Date.now());
    var place = n.place || '';
    var sky = n.sky || '';
    if (roll && roll.hex) {
      sky = String(roll.hex).toLowerCase();
      // Ground snow stays the snow place. A clear sky is not that place,
      // and a snow roll does not turn bare ground into it. Falling snow
      // is still the weather record, read by exposure, not this place.
      // Rain may mark bare ground. A clear or cloudy roll puts that back.
      if (place === 'outdoors' || place === 'rain') {
        if (roll.kind === 'clear' || roll.kind === 'cloudy') {
          if (place === 'rain') { place = 'outdoors'; }
        } else if (roll.kind === 'rain') {
          if (place === 'outdoors') { place = 'rain'; }
        }
      }
    }
    pushSky(actorId, roll && roll.id ? roll.id : 0);
    return {
      sky: sky, place: place, id: roll ? roll.id : 0,
      kind: roll ? roll.kind : '', climate: climate,
      until: roll ? roll.until : 0
    };
  }

  g.__thornswoodSeason = {
    WEEK: WEEK,
    SHIFT: SHIFT,
    seasonAt: seasonName,
    outdoorShift: function (now) { return SHIFT[seasonName(now || Date.now())]; },
    YIELD: YIELD,
    COOLING: COOLING,
    seasonYield: seasonYield,
    yieldWord: yieldWord,
    coolingShare: function (now) { return COOLING[seasonName(now || Date.now())]; },
    allows: allows,
    grownMs: grownMs,
    odds: adjusted,
    ensureRoll: ensureRoll,
    climateOf: climateOf,
    // A snowy climate, and the height of the high mountains: cold storage
    // for food is a chest in one (#3163, the spoilage block).
    snowy: function (climate) { return Object.prototype.hasOwnProperty.call(SNOWY, String(climate || '')); },
    high: HIGH,
    skyAdjust: skyAdjust,
    setEpoch: function (ms) { state.epoch = Number(ms) || Date.now(); saveState(); },
    epoch: function () { return state.epoch; },
    resetRolls: function () { state.rolls = {}; saveState(); },
    // When the season at t gives way to the next one. Time before the first
    // count is spring, and that spring runs a whole week from the count.
    turnsAt: function (t) {
      var idx = t < state.epoch ? 0 : seasonIndex(t);
      return state.epoch + (idx + 1) * WEEK;
    }
  };
  slog('season is', seasonName(Date.now()));
})();
// ==== end thornswood season ====

