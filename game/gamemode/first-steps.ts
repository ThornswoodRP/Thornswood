// ==== thornswood first steps ====
/*
  THE FIRST HOUR OF A NEW CHARACTER (#3166).

  Patrick, 22 October, on his report page: a new character is guided by both
  a short guide on the K panel and a short NPC quest in the start town, and
  gets the basic tool for the profession they pick. Creation already hands
  the tool at the pick (giveTool, in the character block), so this block is
  the other two, and they are one thing: the guide is the errand's steps,
  each ticked when the server sees it done.

  WHO GIVES THE ERRAND. The Cook of the start town's Merchant's Guild, out
  of game\data\merchant-traders.json: the trader whose role is Cook and whose
  book hold is the town (docs\systems\merchant-traders.md has the sixty).
  Six of the nine stand in the inn the town's arrival used to be, and
  Markarth's in Understone Keep, where a new character arrives. The others
  are Riften's in Marise Aravel's House and Dawnstar's in Northern Star
  Goods. They are server NPCs on main and on dev, and the guide names the
  building each one stands in, so nobody has to know which one is Hulda.

  THE ERRAND. Speak to the Cook (E, as at any guild trader). They ask for
  three things: find the notice board, do one piece of your own work, and go
  back to them. The board and the work count whenever they happen after the
  arrival, before the Cook or after, so nobody is held up by the order. Back
  at the Cook it is finished, and the Cook says where the guild's trader of
  your own trade stands in the hold. Nothing is handed over: creation's 40
  gold and the tool are the whole start (docs\systems\creation.md), and the
  errand is for learning the way, not for a purse.

  HOW THE SERVER SEES EACH STEP, with nothing new on the client:
    the picks       the character state's class and profession
    the Cook        the E press the front plugin already sends for every
                    person under the crosshair (/merchant e <id>), measured
                    here at the merchant's reach of 400 in the same cell
    the board       the property block's board press (boardActivated)
    the work        the character block's credit, which every trade's work
                    goes through (creditWork)

  WHERE IT IS KEPT. thornswoodFirstSteps on the character, which the engine
  keeps with the rest of the change form, so a relog, a reload and a restart
  all find it where it was. It is begun by the arrival (arriveAt), and only
  there, so a character made before this has none and is shown nothing. It
  goes off the panel once the errand is done, or when the person puts it
  away with the button on the page (/pick firststeps hide).
*/
(function () {
  var g = globalThis;
  var PROPERTY = 'thornswoodFirstSteps';
  // The merchant's reach: within 400 of the trader in the same place
  // (docs\systems\merchants-guild.md), the distance E on a trader is answered at.
  var REACH = 400;
  // Each trade's guild trader, for the Cook's last line. A class, a warrior
  // and a mage have none of their own, and the line leaves it out.
  var TRADE_ROLE = { smith: 'Smith', woodworker: 'Woodworker', tailor: 'Tailor',
                     enchanter: 'Enchanter', cook: 'Cook', alchemist: 'Alchemist' };

  try {
    mp.makeProperty(PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) { /* already made by a previous load. harmless. */ }

  function flog() { log.apply(null, ['firststeps'].concat([].slice.call(arguments))); }

  /*
    The guild's traders by book hold and role, read once at load. A missing
    or unreadable file is said in the log, and the errand's Cook steps are
    left off the guide for that load: the picks, the board and the work are
    still there, and the guide is done when they are.
  */
  var TRADERS = {};
  (function readTraders() {
    var doc = null;
    try {
      var fs = require('fs');
      var path = require('path');
      var root = typeof __dirname === 'string' ? __dirname : path.dirname(__filename);
      // #5137: on a server the file is not beside this one; STAFF_DATA carries it.
      doc = typeof STAFF_DATA !== 'undefined' && STAFF_DATA['merchant-traders.json']
        ? JSON.parse(JSON.stringify(STAFF_DATA['merchant-traders.json']))
        : JSON.parse(fs.readFileSync(path.join(root, 'data', 'merchant-traders.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      flog('could not read data\\merchant-traders.json, so no Cook gives the first errand:', e);
      return;
    }
    var byRef = (doc && doc.byRef) || {};
    Object.keys(byRef).forEach(function (ref) {
      var t = byRef[ref];
      if (!t || typeof t.bookHold !== 'string' || typeof t.role !== 'string') { return; }
      var town = TRADERS[t.bookHold] || (TRADERS[t.bookHold] = {});
      town[t.role] = { ref: ref, cell: String(t.cell || ''), locationName: String(t.locationName || '') };
    });
  })();

  /* The town's name and hold, from the chargen block's own list. */
  function townOf(key) {
    var cg = g.__thornswoodChargen;
    var towns = (cg && cg.towns) ? cg.towns() : [];
    for (var i = 0; i < towns.length; i++) {
      if (towns[i].key === key) { return towns[i]; }
    }
    return null;
  }

  /*
    Where a trader stands, in words: the building their cell is, and the
    place as well when it is not the town itself (Markarth Side for two of
    Hjaalmarch's). A trader out of doors is the place alone.
  */
  function whereOf(t, townName) {
    var building = (typeof BUILDING_NAME !== 'undefined' && BUILDING_NAME[t.cell]) || '';
    var place = t.locationName;
    if (!building) { return place || townName; }
    if (place && place !== townName && place !== building) { return building + ', ' + place; }
    return building;
  }

  function cookOf(rec) {
    var town = rec && TRADERS[rec.town];
    return (town && town.Cook) || null;
  }

  function read(actorId) {
    var v = null;
    try { v = mp.get(actorId, PROPERTY); } catch (e) { v = null; }
    return (v && typeof v === 'object' && v.v === 1 && typeof v.town === 'string') ? v : null;
  }

  function write(actorId, rec) {
    try {
      mp.set(actorId, PROPERTY, rec);
      return true;
    } catch (e) {
      flog('could not write the first steps of', actorId.toString(16) + ':', e);
      return false;
    }
  }

  /* The K panel again, now that a step moved. */
  function redraw(actorId) {
    var C = g.__thornswoodCharacter;
    if (!C || !C.writeState || !C.stateOf) { return; }
    try { C.writeState(actorId, C.stateOf(actorId)); } catch (e) { flog('the panel could not be written for', actorId.toString(16) + ':', e); }
  }

  /* Live means begun, not finished and not put away. */
  function live(rec) { return !!rec && !rec.done && !rec.hidden; }

  /*
    Within the merchant's reach of the Cook, in the same cell. The same
    measurement as inReach in the merchant block, on the server's own
    positions, so a press relayed from anywhere else is not a visit.
  */
  function near(actorId, npcId) {
    var a = null, b = null, ca = null, cb = null;
    try {
      a = mp.get(actorId, 'pos'); b = mp.get(npcId, 'pos');
      ca = mp.get(actorId, 'worldOrCellDesc'); cb = mp.get(npcId, 'worldOrCellDesc');
    } catch (e) { return false; }
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) { return false; }
    if (!ca || String(ca) !== String(cb)) { return false; }
    var d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return d <= REACH;
  }

  function stillToDo(rec) {
    var left = [];
    if (!rec.board) { left.push('find the notice board'); }
    if (!rec.work) { left.push('do a piece of your own work'); }
    return left;
  }

  /*
    The guide, for the K panel's First steps page, or null for nobody to
    show it to. s is the character block's rules state, for the picks.
  */
  function view(actorId, s) {
    var rec = read(actorId);
    if (!live(rec)) { return null; }
    var town = townOf(rec.town);
    var townName = town ? town.name : rec.town;
    var cook = cookOf(rec);
    var at = cook ? whereOf(cook, townName) : '';
    var steps = [];
    steps.push({ key: 'pick', name: 'Your class and profession', done: !!(s && s.cls && s.prof),
                 text: 'Choose your class and your profession, on this panel. One that needs a tool hands you the tool when you pick it.' });
    if (cook) {
      steps.push({ key: 'cook', name: 'The Cook', done: !!rec.took,
                   text: 'Speak to the Cook at ' + at + '. Look at them and press E.' });
    }
    steps.push({ key: 'board', name: 'The notice board', done: !!rec.board,
                 text: 'Find the notice board in ' + townName + ' and press E on it. Jobs, notices and letters go up there.' });
    steps.push({ key: 'work', name: 'Your own work', done: !!rec.work,
                 text: 'Do one piece of your own work: a seam, a log, a fish, a crop, a plant, a hunt, or something made at a bench.' });
    if (cook) {
      steps.push({ key: 'back', name: 'Back to the Cook', done: false, text: 'Go back to the Cook at ' + at + ' and tell them.' });
    }
    return { town: townName, steps: steps };
  }

  /* The arrival, once: the record begins here and nowhere else. */
  function begin(actorId, townKey) {
    if (read(actorId)) { return false; }
    var ok = write(actorId, { v: 1, town: String(townKey || ''), since: Date.now() });
    if (ok) { flog(actorId.toString(16), 'arrived in', townKey, '- first steps begun'); }
    return ok;
  }

  /*
    Finished without a Cook: the picks, the board and the work. Said once,
    in the chat, the moment the last of them is seen.
  */
  function finishWithoutCook(actorId, rec) {
    if (cookOf(rec) || !rec.board || !rec.work) { return; }
    var C = g.__thornswoodCharacter;
    var s = null;
    try { s = (C && C.stateOf) ? C.stateOf(actorId) : null; } catch (e) { s = null; }
    if (!s || !s.cls || !s.prof) { return; }
    rec.done = Date.now();
    if (write(actorId, rec)) {
      flog(actorId.toString(16), 'finished the first steps (no Cook in', rec.town + ')');
      say(actorId, 'You have found your feet. The first steps are done.');
    }
  }

  /* A piece of work counted. Called from the character block's credit, before its own write. */
  function worked(actorId) {
    var rec = read(actorId);
    if (!live(rec) || rec.work) { return; }
    rec.work = Date.now();
    if (write(actorId, rec)) { finishWithoutCook(actorId, rec); }
  }

  /* The notice board opened for them. Called from onActivate. */
  function sawBoard(actorId) {
    var rec = read(actorId);
    if (!live(rec) || rec.board) { return; }
    rec.board = Date.now();
    if (write(actorId, rec)) { finishWithoutCook(actorId, rec); redraw(actorId); }
  }

  /*
    E on somebody, from the front plugin's /merchant e <id>. Answers the
    Cook's words when they were the Cook, in reach, and the errand is open,
    and null for every other press in the world, which is nearly all of them.
  */
  function spoke(actorId, npcId) {
    var rec = read(actorId);
    if (!live(rec)) { return null; }
    var cook = cookOf(rec);
    if (!cook) { return null; }
    var id = 0;
    try { id = Number(mp.getIdFromDesc(cook.ref)) >>> 0; } catch (e) { id = 0; }
    if (!id || id !== (Number(npcId) >>> 0) || !near(actorId, id)) { return null; }
    // A Cook lying dead says nothing; the authored Cook comes back on the NPC clock.
    var dead = false;
    try { dead = !!mp.get(id, 'isDead'); } catch (e) { dead = false; }
    if (dead) { return null; }
    var town = townOf(rec.town);
    var townName = town ? town.name : rec.town;
    if (!rec.took) {
      rec.took = Date.now();
      if (!write(actorId, rec)) { return null; }
      flog(actorId.toString(16), 'took the first errand from the Cook in', rec.town);
      redraw(actorId);
      return 'The Cook says: "New to ' + townName + '? Then do three things for me. Find the notice board, ' +
             'where the jobs and the letters go up. Do a piece of your own work, whatever your trade is. ' +
             'Then come back and tell me how it went."';
    }
    var left = stillToDo(rec);
    if (left.length) {
      return 'The Cook says: "Not yet. You still have to ' + left.join(' and ') + '."';
    }
    rec.done = Date.now();
    if (!write(actorId, rec)) { return null; }
    flog(actorId.toString(16), 'finished the first errand in', rec.town);
    redraw(actorId);
    var C = g.__thornswoodCharacter;
    var s = null;
    try { s = (C && C.stateOf) ? C.stateOf(actorId) : null; } catch (e) { s = null; }
    var role = s && s.prof ? TRADE_ROLE[s.prof] : '';
    var trader = role ? (TRADERS[rec.town] || {})[role] : null;
    var trade = trader
      ? ' The guild\'s ' + role + ' is at ' + whereOf(trader, townName) + ', and that is who buys and sells what your trade uses.'
      : '';
    return 'The Cook says: "Then you have found your feet.' + trade + ' Welcome to ' + townName + '."';
  }

  /* The page's Put this away. Nothing else changes; the steps stop being shown. */
  function hide(actorId) {
    var rec = read(actorId);
    if (!live(rec)) { return false; }
    rec.hidden = Date.now();
    if (!write(actorId, rec)) { return false; }
    flog(actorId.toString(16), 'put the first steps away');
    return true;
  }

  g.__thornswoodFirstSteps = {
    PROPERTY: PROPERTY, REACH: REACH,
    begin: begin, view: view, spoke: spoke, sawBoard: sawBoard, worked: worked, hide: hide,
    cookOf: function (townKey) { var t = TRADERS[townKey]; return (t && t.Cook) ? t.Cook.ref : ''; }
  };
})();
// ==== end thornswood first steps ====

