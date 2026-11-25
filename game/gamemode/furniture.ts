// ==== thornswood furniture ====
/*
  ============================================================================
  FURNITURE A HOLDER SETS DOWN, MOVES AND PICKS UP (#2679, split from #507).

  The design is on the issue (comment 6246616411). In short:

  A PIECE IS AN ITEM FIRST. A chair, a bench, a bed, a bedroll or a chest is
  a MISC record in Thornswood-Content.esp, made at the woodworking bench
  (Woodwright, ranked by its dearest input like every recipe) and sold in an
  ordinary Trade like anything else. game/data/furniture.json is the
  catalog and every number: the cap for a building, the reach, how long a
  piece stays in your hands, the turn step and which kinds of base may be
  set down. Staff change it there; nothing below is a number to argue with.

  WHO ARRANGES. The building's holder, or whoever carries its deed or its
  master key: the people setLock lets turn the lock. A plain key lets you in
  and does not let you move the furniture. Only inside the held building
  itself (its interior cell), never outdoors and never in a building nobody
  holds.

  NOTHING IS TYPED. In the inventory, inside a building you may arrange, a
  line names the lock key: Arrange furniture. It shuts the inventory and
  asks for the furniture panel (game/ui/thornswood-furniture.js), which
  lists the pieces you carry with a Place button each. Place sets the piece
  in front of you, facing you. With the crosshair on a piece you may
  arrange, the line names two keys: the mold key to Move it and the lock key
  to Pick it up. Move puts it in your hands for limits.carryMs: then the
  mold key sets it down in front of you and the lock key turns it by
  limits.turnStep. Pick up puts the item back in your pack and takes the
  piece out of the world; a chest has to be empty first. /furniture is the
  line the keys and the panel send, never typed, and is not in PLAYER_WORDS.

  WHERE IT IS KEPT. The fork keeps a reference the server placed with the
  world, the way it keeps the notice boards, the drop boxes and the
  woodworking benches (#2516, #516), and a placed chest keeps what is in it
  the way the drop box does. private/furniture.json, beside the property
  register, holds each piece: its reference, its row, its building, where it
  stands and its angle. It names nobody: a piece belongs to the building,
  not to whoever set it down. A piece that is not where the register says
  when the server starts is stood again, next to one of the building's own
  doors, the board's way (set the angle, then move).

  RELEASE. A claim that lapses, an eviction, a deed handed over: the pieces
  stay for the next holder, as property.md says of the chests already there.
  Deleting or resetting a character releases its claims (#2651, #2670,
  Release-List.ps1), and nothing here names a person, so there is nothing of
  the furniture's own to release. A wipe moves the world and the registers
  aside together, and private/furniture.json is in Wipe-Saves.ps1's list
  with property.json, so the register never outlives the references.

  A TOOL, NOT AN OUTCOME. The server checks and does what was asked and logs
  it under [property] furniture:. It decides nothing for anybody.
*/
(function () {
  'use strict';
  var g = globalThis;

  var LINE_PROPERTY = 'thornswoodFurnitureLine';
  var PANEL_PROPERTY = 'thornswoodFurnitureView';

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function hex(id) { return (Number(id) >>> 0).toString(16); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function wrap(a) { return ((num(a, 0) % 360) + 360) % 360; }

  /*
    The testable core. api is everything that reaches the world, so
    tests/test-2679-furniture.js drives this with a pretend one.
  */
  function create(api) {
    var doc = api.catalog || {};
    var limits = doc.limits || {};
    var rows = {};
    (doc.pieces || []).forEach(function (r) { if (r && r.key) { rows[r.key] = r; } });
    var book = api.readRegister() || {};
    var pieces = (book && typeof book.pieces === 'object' && book.pieces) ? book.pieces : {};
    // Pieces taken out of a pack and not yet set down, waiting on the pack's save (#4901).
    var debits = (book && Array.isArray(book.debits)) ? book.debits : [];
    // In memory only: a piece in somebody's hands, by actor, { ref, until }.
    var carrying = {};

    function typeOn(t) { return !!(limits.types && limits.types[t]); }
    function capOf(building) {
      var over = limits.buildings || {};
      return own(over, building) ? num(over[building], 0) : num(limits.perBuilding, 0);
    }
    function reach() { return num(limits.reach, 120); }
    function pickReach() { return num(limits.pickReach, 400); }
    function carryMs() { return num(limits.carryMs, 60000); }
    function turnStep() { return num(limits.turnStep, 45); }

    /* Answers whether the register was written. */
    function save() {
      return api.writeRegister({ pieces: pieces, debits: debits }) !== false;
    }

    function piecesIn(building) {
      var out = [];
      for (var k in pieces) {
        if (own(pieces, k) && pieces[k] && pieces[k].building === building) { out.push(pieces[k]); }
      }
      return out;
    }

    /* Pieces for that building still waiting on a pack's save, which the cap counts too. */
    function waitingIn(building) {
      return debits.filter(function (d) { return d && d.data && d.data.building === building; }).length;
    }

    /* The building the person stands in, when it is one the property block knows. */
    function buildingAt(actorId) {
      var cell = api.cellOf(actorId);
      return (cell && api.isBuilding(cell)) ? cell : '';
    }

    /* '' when they may arrange here, else the sentence that says why not. */
    function refusal(actorId, building) {
      if (!building) { return 'Furniture is arranged inside a building somebody holds.'; }
      var held = api.holderOf(building);
      if (!held) { return 'Nobody holds ' + api.nameOf(building) + '. Claim it first.'; }
      if (!api.mayArrange(actorId, building, held)) {
        return api.nameOf(building) + ' is held by ' + held.name +
          '. Its furniture is for the holder, or whoever carries its deed or master key, to arrange.';
      }
      return '';
    }

    function carryOf(actorId) {
      var c = carrying[actorId];
      if (!c) { return null; }
      if (api.now() > c.until || !own(pieces, hex(c.ref))) { delete carrying[actorId]; return null; }
      return c;
    }

    function carrierOf(ref) {
      for (var a in carrying) {
        if (own(carrying, a) && carrying[a].ref === ref && api.now() <= carrying[a].until) { return Number(a); }
      }
      return 0;
    }

    /* Where a piece goes: reach in front of the person, on their own floor. */
    function inFront(actorId) {
      var p = api.posOf(actorId), a = api.angleOf(actorId);
      if (!p || !a) { return null; }
      var h = num(a[2], 0) * Math.PI / 180, r = reach();
      return [p[0] + Math.sin(h) * r, p[1] + Math.cos(h) * r, p[2]];
    }

    function near(actorId, ref) {
      var a = api.posOf(actorId), b = api.posOf(ref);
      if (!a || !b) { return false; }
      var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return dx * dx + dy * dy + dz * dz <= pickReach() * pickReach();
    }

    /* What the client's lines need, written to the person: see LINE_PROPERTY. */
    function lineFor(actorId) {
      var building = buildingAt(actorId);
      var may = !!building && !refusal(actorId, building);
      var c = may ? carryOf(actorId) : null;
      return {
        b: building, n: building ? api.nameOf(building) : '', may: may,
        p: may ? piecesIn(building).filter(function (x) { return !!x.ref; }).map(function (x) { return hex(x.ref); }) : [],
        c: c ? hex(c.ref) : '', left: c ? Math.max(0, c.until - api.now()) : 0
      };
    }

    function look(actorId) { api.line(actorId, lineFor(actorId)); }

    /* Everybody in that building has their lines written again after a change. */
    function lookAll(building) {
      (api.online() || []).forEach(function (id) {
        if (api.cellOf(id) === building) { look(id); }
      });
    }

    /* The panel: every row of the catalog whose type is on, with how many they carry. */
    function view(actorId, note) {
      var building = buildingAt(actorId);
      var why = refusal(actorId, building);
      var list = [];
      for (var k in rows) {
        if (!own(rows, k) || !typeOn(rows[k].type)) { continue; }
        list.push({ key: k, name: rows[k].name, carried: api.count(actorId, rows[k].itemDesc) });
      }
      var here = building ? piecesIn(building).length : 0;
      return { open: true, n: building ? api.nameOf(building) : '', why: why, note: note || '',
               here: here, cap: building ? capOf(building) : 0, rows: list };
    }

    function stand(id, baseDesc, anchor, pos, angle) {
      api.turn(id, angle);
      api.moveNear(id, anchor, pos);
    }

    function place(actorId, key) {
      var building = buildingAt(actorId);
      var why = refusal(actorId, building);
      if (why) { return why; }
      var row = own(rows, key) ? rows[key] : null;
      if (!row || !typeOn(row.type)) { return 'That is not furniture that can be set down.'; }
      if (!api.placementReady()) { return 'Furniture placement is unavailable just now.'; }
      if (!(api.count(actorId, row.itemDesc) > 0)) { return 'You carry no ' + row.name + '.'; }
      var cap = capOf(building);
      if (piecesIn(building).length + waitingIn(building) >= cap) {
        return api.nameOf(building) + ' already has ' + cap + ' pieces set down, which is all it takes.';
      }
      var bad = api.baseRefusal(row);
      if (bad) { api.log('furniture: refused', row.key + ':', bad); return 'That piece cannot be set down on this server.'; }
      var pos = inFront(actorId);
      if (!pos) { return 'Could not tell where you stand. Try again.'; }
      var angle = wrap(num(api.angleOf(actorId)[2], 0) + 180);
      // Set down only once the pack's take is saved (#4901): landPiece.
      var r = packs.begin(actorId, function (entries) { return api.cutOne(entries, row.itemDesc) || ('You carry no ' + row.name + '.'); },
                          'piece', { key: row.key, building: building, angle: angle,
                                     pos: pos.map(function (v) { return Math.round(v * 10) / 10; }), by: api.who(actorId) });
      if (r.why) { return r.why; }
      return r.line && r.line !== PIECE_DOWN ? r.line : '';
    }

    var PIECE_DOWN = 'It is set down.';

    /*
      A piece set down, once its item is saved out of the pack (#4901). Its
      place was fixed when it was asked for. One that cannot be stood just
      now stays in the register, the way standAll keeps one with nothing to
      stand next to, and is stood at the next start: the item is out of the
      pack for good, so the piece is never dropped.
    */
    function landPiece(d, landed) {
      var w = d.data;
      var row = own(rows, w.key) ? rows[w.key] : null;
      var name = row ? row.name : w.key;
      if (!landed) {
        return { line: 'Your pack was not saved with the ' + name + ' out of it, so it was not set down.' };
      }
      return { name: name, piece: { ref: 0, marker: d.marker, key: w.key, base: row ? row.base : w.base,
                                     building: w.building, pos: w.pos, angle: w.angle } };
    }

    // A paid piece is durable before it gets a reference. Bind the disabled
    // reference before moving and enabling it in the building.
    var pendingPaid = {};
    function standPaidPiece(k, preferred) {
      var piece = pieces[k];
      pendingPaid[piece.marker] = k;
      if (!piece.base) { return false; }
      var anchor = preferred && api.cellOf(preferred) === piece.building ? preferred : api.anchorIn(piece.building);
      if (!anchor) { return false; }
      try {
        var id = piece.ref;
        if (!(id && api.refStands(id, piece.base) && api.placementMarker(id) === piece.marker)) {
          id = api.stagePlacement(piece.base, piece.marker);
        }
        if (id !== piece.ref) {
          if (own(pieces, hex(id)) && pieces[hex(id)].marker !== piece.marker) {
            throw new Error('the placed reference already belongs to another registered piece');
          }
          var next = Object.assign({}, pieces);
          delete next[k];
          next[hex(id)] = Object.assign({}, piece, { ref: id });
          if (!api.writePackRegister({ pieces: next, debits: debits })) { return false; }
          pieces = next;
          piece = next[hex(id)];
          pendingPaid[piece.marker] = hex(id);
        }
        if (!api.refAt(id, piece.base, piece.building, piece.pos, piece.angle)) {
          stand(id, piece.base, anchor, piece.pos, piece.angle);
        }
        if (!api.refAt(id, piece.base, piece.building, piece.pos, piece.angle)) {
          throw new Error('the disabled furniture did not reach its registered position');
        }
        api.enablePlacement(id);
        delete pendingPaid[piece.marker];
      } catch (e) {
        api.log('furniture: could not stand paid piece', piece.key + ':', e);
        return false;
      }
      lookAll(piece.building);
      return true;
    }

    function commitPackDebit(land, row, paid, actor) {
      var result = land(row, paid);
      var next = Object.assign({}, pieces);
      var waiting = debits.filter(function (debit) { return debit !== row; });
      var k = 'w' + row.marker;
      if (paid) { next[k] = result.piece; }
      if (!api.writePackRegister({ pieces: next, debits: waiting })) { return ''; }
      pieces = next;
      debits = waiting;
      if (!paid) { return result.line; }
      if (standPaidPiece(k, actor)) {
        api.log('furniture:', row.data.by, 'set down a', result.name, 'in', api.nameOf(row.data.building));
        return PIECE_DOWN;
      }
      return 'The ' + result.name + ' is kept in the register and will stand once it can be placed.';
    }

    var packs = api.packFirst(function () { return debits; }, function () {
      return api.writePackRegister({ pieces: pieces, debits: debits });
    }, { piece: landPiece }, commitPackDebit);

    /* The piece under their crosshair, when they may touch it: { piece } or { why }. */
    function reachable(actorId, refHex) {
      var p = own(pieces, String(refHex || '').toLowerCase()) ? pieces[String(refHex).toLowerCase()] : null;
      if (!p) { return { why: 'That is not a piece anybody set down.' }; }
      var building = buildingAt(actorId);
      if (building !== p.building) { return { why: 'That piece is in another building.' }; }
      var why = refusal(actorId, building);
      if (why) { return { why: why }; }
      if (!near(actorId, p.ref)) { return { why: 'Get closer to it.' }; }
      return { piece: p };
    }

    function move(actorId, refHex) {
      var r = reachable(actorId, refHex);
      if (r.why) { return r.why; }
      var other = carrierOf(r.piece.ref);
      if (other && other !== actorId) { return 'Somebody else has that piece in their hands.'; }
      carrying[actorId] = { ref: r.piece.ref, until: api.now() + carryMs() };
      api.log('furniture:', api.who(actorId), 'took up', r.piece.key, hex(r.piece.ref), 'to move it');
      look(actorId);
      return '';
    }

    function down(actorId) {
      var c = carryOf(actorId);
      if (!c) { look(actorId); return 'You are not carrying a piece.'; }
      var p = pieces[hex(c.ref)];
      var building = buildingAt(actorId);
      if (building !== p.building || refusal(actorId, building)) {
        delete carrying[actorId];
        look(actorId);
        return 'The piece stays in ' + api.nameOf(p.building) + '.';
      }
      var pos = inFront(actorId);
      if (!pos) { return 'Could not tell where you stand. Try again.'; }
      try { stand(p.ref, p.base, actorId, pos, p.angle); } catch (e) {
        api.log('furniture: could not move', hex(p.ref) + ':', e);
        return 'It would not go there.';
      }
      p.pos = pos.map(function (v) { return Math.round(v * 10) / 10; });
      delete carrying[actorId];
      save();
      api.log('furniture:', api.who(actorId), 'set', p.key, hex(p.ref), 'down at', p.pos.join(','), 'in', p.building);
      lookAll(p.building);
      return '';
    }

    function turn(actorId) {
      var c = carryOf(actorId);
      if (!c) { look(actorId); return 'You are not carrying a piece.'; }
      var p = pieces[hex(c.ref)];
      var angle = wrap(p.angle + turnStep());
      try { stand(p.ref, p.base, p.ref, p.pos, angle); } catch (e) {
        api.log('furniture: could not turn', hex(p.ref) + ':', e);
        return 'It would not turn.';
      }
      p.angle = angle;
      c.until = api.now() + carryMs();
      save();
      look(actorId);
      return '';
    }

    function pick(actorId, refHex) {
      var r = reachable(actorId, refHex);
      if (r.why) { return r.why; }
      var p = r.piece;
      var row = own(rows, p.key) ? rows[p.key] : null;
      if (!row) { return 'That piece is not in the catalog any more. Staff can take it up.'; }
      var other = carrierOf(p.ref);
      if (other && other !== actorId) { return 'Somebody else has that piece in their hands.'; }
      if (row.type === 'CONT' && !api.containerEmpty(p.ref)) { return 'Empty the ' + row.name + ' first.'; }
      // The item goes into the pack before the piece leaves the world, so a
      // pack that will not take it leaves the piece standing, never lost.
      if (!api.give(actorId, row.itemDesc)) {
        api.log('furniture: could not hand', api.who(actorId), 'the', row.name, 'for', hex(p.ref) + '; it stays standing');
        return 'Your pack would not take the ' + row.name + ', so it stays where it is.';
      }
      try { api.remove(p.ref); } catch (e) {
        api.log('furniture: could not take up', hex(p.ref) + ':', e);
        if (!api.take(actorId, row.itemDesc)) {
          api.log('furniture: and could not take the', row.name, 'back from', api.who(actorId));
        }
        return 'It would not come up.';
      }
      delete pieces[hex(p.ref)];
      if (carrying[actorId] && carrying[actorId].ref === p.ref) { delete carrying[actorId]; }
      save();
      api.log('furniture:', api.who(actorId), 'picked up the', row.name, hex(p.ref), 'in', p.building);
      lookAll(p.building);
      return '';
    }

    /*
      At start: every piece stood where the register says. One the server
      still has is moved back if it wandered; one it does not is placed
      again, next to a door of its own building. One with nothing to stand
      next to is said, and stays in the register for the next start.
    */
    function standAll() {
      var changed = false, stood = 0, kept = 0;
      for (var k in pieces) {
        if (!own(pieces, k)) { continue; }
        var p = pieces[k];
        if (!p || !p.base || !p.building || !p.pos) { continue; }
        if (p.marker) {
          if (p.ref && api.refAt(p.ref, p.base, p.building, p.pos, p.angle) &&
              api.placementMarker(p.ref) === p.marker && api.placementEnabled(p.ref)) {
            kept++;
          } else {
            var localRef = p.ref && api.cellOf(p.ref) === p.building ? p.ref : 0;
            if (!localRef && !api.anchorIn(p.building)) {
              api.log('furniture: nothing to stand', p.key, k, 'next to in', p.building);
            }
            if (standPaidPiece(k, localRef)) { stood++; }
          }
          continue;
        }
        if (api.refAt(p.ref, p.base, p.building, p.pos, p.angle)) { kept++; continue; }
        var id = api.refStands(p.ref, p.base) ? p.ref : 0;
        var anchor = (id && api.cellOf(id) === p.building) ? id : api.anchorIn(p.building);
        if (!anchor) {
          api.log('furniture: nothing to stand', p.key, k, 'next to in', p.building);
          continue;
        }
        try {
          if (!id) { id = api.place(p.base); }
          stand(id, p.base, anchor, p.pos, p.angle);
        } catch (e) {
          api.log('furniture: could not stand', p.key, k + ':', e);
          continue;
        }
        if (id !== p.ref) { delete pieces[k]; p.ref = id; pieces[hex(id)] = p; }
        changed = true;
        stood++;
      }
      if (changed) { save(); }
      api.log('furniture:', kept, 'piece(s) where they were,', stood, 'stood again');
      return { kept: kept, stood: stood };
    }

    /*
      /furniture and the words after it, from the inventory key, the panel's
      buttons and the crosshair keys. Answers a sentence for the person, or ''.
    */
    function command(actorId, words) {
      var verb = String((words && words[0]) || 'open').toLowerCase();
      var said = '';
      if (verb === 'look') { look(actorId); return ''; }
      if (verb === 'open') { api.show(actorId, view(actorId)); look(actorId); return ''; }
      if (verb === 'place') {
        said = place(actorId, String(words[1] || ''));
        // The page shuts itself on Place so the piece can be seen; it opens
        // again only to say why a piece was not set down.
        var after = view(actorId, said);
        after.open = !!said;
        api.show(actorId, after);
        return said;
      }
      if (verb === 'move') { return move(actorId, words[1]); }
      if (verb === 'down') { return down(actorId); }
      if (verb === 'turn') { return turn(actorId); }
      if (verb === 'pick') { return pick(actorId, words[1]); }
      return '';
    }

    return {
      command: command, look: look, lineFor: lineFor, view: view, place: place, move: move,
      down: down, turn: turn, pick: pick, standAll: standAll, refusal: refusal, capOf: capOf,
      settle: function () {
        packs.settle();
        for (var marker in pendingPaid) {
          var key = pendingPaid[marker];
          if (own(pieces, key)) { standPaidPiece(key, 0); }
          else { delete pendingPaid[marker]; }
        }
      },
      pieces: function () { return pieces; }, carrying: function () { return carrying; }
    };
  }

  g.__thornswoodFurnitureCreate = create;
  if (typeof mp === 'undefined' || !mp) { return; }

  var fs = require('fs');
  var path = require('path');

  function catalog() {
    var root = typeof __dirname === 'string' ? __dirname : path.dirname(__filename);
    // #2873: on a server the file is not beside this one; STAFF_DATA carries it.
    // A copy, because the pieces are written to below.
    var doc = typeof STAFF_DATA !== 'undefined' && STAFF_DATA['furniture.json']
      ? JSON.parse(JSON.stringify(STAFF_DATA['furniture.json']))
      : JSON.parse(fs.readFileSync(path.join(root, 'data', 'furniture.json'), 'utf8').replace(/^\uFEFF/, ''));
    (doc.pieces || []).forEach(function (r) {
      r.itemDesc = String(r.item) + ':Thornswood-Content.esp';
    });
    return doc;
  }

  function registerPath() {
    var dir = 'private';
    try {
      var s = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (s && typeof s.privDir === 'string' && s.privDir) { dir = s.privDir; }
    } catch (e) { }
    return path.join(dir, 'furniture.json');
  }

  // -- store: read and write (#4529), begin --
  /*
    ONE WAY A STORE'S FILE IS READ AND WRITTEN (#4529). The same text is in
    the season, farming, property and furniture blocks, and
    game/tests/test-4529-store-saves.js holds the copies to it, since each block
    is lifted and run alone. Seven stores (the property register and its
    jail, bed and bench books, the season, the farm claims and the
    furniture register) were each written straight over the old file, and
    each loader read a
    file that would not parse as empty and said nothing. writeFileSync
    empties a file before it writes it, so a server stopped partway left it
    half written; the next start read nothing from it, and the next save
    wrote that nothing over everything it held.

    storeRead(file, what) is { doc } for a file that reads, { doc: null }
    for one that is not there, and { doc: null, bad } for one that is there
    and does not read: that one is said in the log with the file and why,
    and is never written over.

    storeWrite(file, text, read) writes text to <file>.tmp and renames it
    over the file, so a stop partway leaves the old file whole. When read
    says the file did not read, it is first renamed aside as
    <file>.unreadable-<time>, and that is said, so what it held is kept for
    staff to put right. A failure throws, for the caller to say.
  */
  function storeRead(file, what) {
    var fs = require('fs');
    var text, doc, why = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') { return { doc: null, bad: '' }; }
      why = 'it could not be opened (' + ((e && e.code) || e) + ')';
    }
    if (!why) {
      try { doc = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
      catch (e2) { why = 'it does not parse (' + ((e2 && e2.message) || e2) + ')'; }
    }
    if (!why && (!doc || typeof doc !== 'object')) { why = 'it holds no ' + what; }
    if (!why) { return { doc: doc, bad: '' }; }
    console.log('[thornswood] ' + file + ' could not be read: ' + why + '. This start holds no ' + what +
                ' from it, and it is never written over: the first save sets it aside as ' + file + '.unreadable-<time>');
    return { doc: null, bad: why };
  }
  function storeWrite(file, text, read) {
    var fs = require('fs');
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    if (read && read.bad) {
      if (fs.existsSync(file)) {
        var aside = file + '.unreadable-' + Date.now();
        fs.renameSync(file, aside);
        console.log('[thornswood] ' + file + ' did not read at this start (' + read.bad + '), so it is kept as ' +
                    aside + ' and a new one is written');
      }
      read.bad = '';
    }
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
  }
  // -- store: read and write (#4529), end --

  // The furniture register as it was read at this start (#4529).
  var furnitureRead = storeRead(registerPath(), 'furniture piece');

  function plog() {
    var a = ['[property]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    log.apply(null, a);
  }

  function refSelf(id) { return { type: 'form', desc: mp.getDescFromId(id) }; }
  function refCall(fn, id, args) {
    return mp.callPapyrusFunction('method', 'ObjectReference', fn, refSelf(id), args || []);
  }
  function baseOf(id) { try { return String(mp.get(id, 'baseDesc') || '').toLowerCase(); } catch (e) { return ''; } }
  function cellOf(id) { try { return String(mp.get(id, 'worldOrCellDesc') || ''); } catch (e) { return ''; } }

  /* The first plain stack of that item in the pack, its index, or -1. */
  function entriesOf(id) {
    try { var inv = mp.get(id, 'inventory'); return ((inv && inv.entries) || []).slice(); } catch (e) { return null; }
  }
  function plain(e) {
    for (var k in e) { if (own(e, k) && k !== 'baseId' && k !== 'count' && e[k] !== undefined && e[k] !== null) { return false; } }
    return true;
  }

  var doc = null;
  try { doc = catalog(); } catch (e) { plog('furniture: game/data/furniture.json would not read, so nobody can arrange:', e); return; }

  try {
    mp.makeProperty(LINE_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: [
        '(function(){',
        '  try {',
        '    var v = ctx.value;',
        '    if (!v || typeof v !== "object") { return; }',
        '    var was = globalThis.thornswoodFurnitureLine;',
        '    if (was && was.stamp === v.at) { return; }',
        '    globalThis.thornswoodFurnitureLine = { stamp: v.at, seen: Date.now(), may: !!v.may,',
        '      b: String(v.b || ""), n: String(v.n || ""), c: String(v.c || ""),',
        '      left: Number(v.left) || 0, p: Array.isArray(v.p) ? v.p.map(String) : [] };',
        '  } catch (e) { }',
        '})();'
      ].join('\n'),
      updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }
  try {
    mp.makeProperty(PANEL_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: [
        '(function(){',
        '  try {',
        '    var v = ctx.value;',
        '    if (!v || typeof v !== "object") { return; }',
        '    var st = ctx.state;',
        '    if (!st || st.thornswoodFurnitureAt === v.at) { return; }',
        '    st.thornswoodFurnitureAt = v.at;',
        '    var src = "(function(){try{var d=" + JSON.stringify(v) + ";window.thornswoodFurnitureView=d;" +',
        '      "if(window.thornswoodFurniture&&window.thornswoodFurniture.setData){window.thornswoodFurniture.setData(d);}" +',
        '      "}catch(e){}})();";',
        '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
        '  } catch (e) { }',
        '})();'
      ].join('\n'),
      updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }

  var stamp = 0;
  function stamped(v) {
    var out = JSON.parse(JSON.stringify(v));
    stamp = Math.max(Date.now(), stamp + 1);
    out.at = stamp;
    return out;
  }

  function prop() { return g.__thornswoodProperty || null; }

  /* One furniture item off the pack, to set its piece down. Never adds. */
  function takeOne(actorId, itemDesc) {
    var baseId = idOf(itemDesc) >>> 0;
    var entries = entriesOf(actorId);
    if (!baseId || !entries) { return false; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || (e.baseId >>> 0) !== baseId || !(Number(e.count) > 0)) { continue; }
      var copy = JSON.parse(JSON.stringify(e));
      copy.count = Number(e.count) - 1;
      if (copy.count > 0) { entries[i] = copy; } else { entries.splice(i, 1); }
      try { mp.set(actorId, 'inventory', { entries: entries }); return true; } catch (err) { return false; }
    }
    return false;
  }

  /* One furniture item back into the pack, for a piece picked up. Never gold. */
  function giveOne(actorId, itemDesc) {
    var baseId = idOf(itemDesc) >>> 0;
    var entries = entriesOf(actorId);
    if (!baseId || !entries) { return false; }
    var merged = false;
    for (var i = 0; i < entries.length && !merged; i++) {
      if (entries[i] && (entries[i].baseId >>> 0) === baseId && plain(entries[i])) {
        entries[i] = { baseId: baseId, count: (Number(entries[i].count) || 0) + 1 };
        merged = true;
      }
    }
    if (!merged) { entries.push({ baseId: baseId, count: 1 }); }
    try { mp.set(actorId, 'inventory', { entries: entries }); return true; } catch (e) { return false; }
  }

  function admitPackDebit(actor, change) {
    var merchants = g.__thornswoodMerchantTrade;
    return merchants ? merchants.withQuestInventoryMutation(actor, change) : null;
  }

  // -- pack first (#4901), begin --
  /*
    Write the intent before taking from a pack. The engine saves the
    inventory and an operation marker together. The receipt identifies the
    character and sequence, and the marker identifies the specific debit.
    This register keeps one pending debit and one fixed-size marker per
    character. Only a later admitted debit can replace the marker after the
    earlier intent has finished. Completion replaces the durable intent
    with the finished register state before making that state visible.
  */
  function packFirst(mp, book, keep, landers, tell, markerField, commit, nextMarker, admit) {
    var registered = false;
    try {
      mp.makeProperty(markerField, {
        isVisibleByOwner: false, isVisibleByNeighbors: false, updateOwner: '', updateNeighbor: ''
      });
      registered = true;
    } catch (err) { tell(0, '', err); }

    function sequenceOf(receipt, who) {
      var doc = JSON.parse(receipt);
      if (doc === null) { return 0; }
      if (!doc || doc.actor !== who.desc || doc.profile !== who.profileId ||
          !Number.isSafeInteger(doc.sequence) || doc.sequence < 1) {
        throw new Error('the pack receipt belongs to a different character or has an invalid sequence');
      }
      return doc.sequence;
    }
    function ready() {
      return registered && ['compareAndSetInventoryAndProperty', 'getInventoryReceipt',
        'getSavedInventoryReceipt', 'getActorRuntimeIdentity', 'getNpcAIState',
        'getDescFromId', 'getIdFromDesc', 'get'].every(function (k) { return typeof mp[k] === 'function'; });
    }
    function person(actorId) {
      var ai = mp.getNpcAIState(actorId);
      var desc = mp.getDescFromId(actorId);
      var runtime = mp.getActorRuntimeIdentity(actorId);
      if (!ai || ai.isHuman !== true || !Number.isInteger(ai.profileId) || ai.profileId < 1 ||
          !Number.isSafeInteger(ai.lifeGeneration) || ai.lifeGeneration < 0 ||
          typeof desc !== 'string' || !desc || typeof runtime !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runtime)) {
        return null;
      }
      return { desc: desc, profileId: ai.profileId, life: ai.lifeGeneration, runtime: runtime };
    }
    function validMarker(value) {
      return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
    }
    function readMarker(id) {
      var value = mp.get(id, markerField);
      if (value == null || validMarker(value)) { return value == null ? null : value; }
      throw new Error('the pack debit marker is invalid');
    }
    function sameOwner(row, who) {
      return row && row.human && row.human.desc === who.desc && row.human.profileId === who.profileId;
    }
    function wellFormed(row) {
      return !!row && Object.prototype.hasOwnProperty.call(landers, row.kind) &&
        !!row.human && typeof row.human.desc === 'string' && Number.isInteger(row.human.profileId) &&
        row.human.profileId > 0 && Number.isSafeInteger(row.human.life) && row.human.life >= 0 &&
        Number.isSafeInteger(row.sequence) && row.sequence > 0 && validMarker(row.marker) &&
        (row.previousMarker === null || validMarker(row.previousMarker)) && Array.isArray(row.taken);
    }
    function settleOne(row) {
      if (!wellFormed(row)) { return ''; }
      var id = mp.getIdFromDesc(row.human.desc) >>> 0;
      if (!id) { return ''; }
      var who = person(id);
      if (!who || !sameOwner(row, who)) { return ''; }
      var mark = readMarker(id);
      var saved = sequenceOf(mp.getSavedInventoryReceipt(id), who);
      var live = sequenceOf(mp.getInventoryReceipt(id), who);
      if (mark === row.marker && saved >= row.sequence && live >= saved) {
        return commit(landers[row.kind], row, true, id);
      }
      if (mark === row.previousMarker && who.life === row.human.life && live === saved && saved >= row.sequence - 1) {
        return commit(landers[row.kind], row, false, id);
      }
      return '';
    }
    function begin(actorId, cut, kind, data) {
      if (!ready()) { return { why: 'That is not running on this server. Nothing was taken.' }; }
      try {
        var admitted = admit(actorId, function (owner, stillActive) {
          return { debit: beginAdmitted(actorId, cut, kind, data, owner, stillActive) };
        });
        if (admitted && admitted.debit) { return admitted.debit; }
      } catch (e) {
        tell(0, '', e);
      }
      return { why: 'Your pack is busy or could not be checked. Nothing was taken.' };
    }
    function beginAdmitted(actorId, cut, kind, data, owner, stillActive) {
      var who, receipt, before, previousMarker, sequence, marker;
      try {
        who = person(actorId);
        if (!who || !owner || owner.desc !== who.desc || owner.profileId !== who.profileId || !stillActive()) {
          return { why: 'Your pack owner could not be verified. Nothing was taken.' };
        }
        if (book().some(function (row) { return sameOwner(row, who); })) {
          return { why: 'The server is still writing down your last take. Nothing was taken.' };
        }
        receipt = mp.getInventoryReceipt(actorId);
        if (mp.getSavedInventoryReceipt(actorId) !== receipt) {
          return { why: 'Your pack is still being saved after your last change. Try again in a moment. Nothing was taken.' };
        }
        sequence = sequenceOf(receipt, who) + 1;
        if (!Number.isSafeInteger(sequence)) { throw new Error('the pack receipt sequence is exhausted'); }
        previousMarker = readMarker(actorId);
        marker = nextMarker();
        var inv = mp.get(actorId, 'inventory');
        before = JSON.parse(JSON.stringify((inv && inv.entries) || []));
      } catch (e) {
        tell(0, '', e);
        return { why: 'Your pack could not be read. Nothing was taken.' };
      }
      var out = cut(JSON.parse(JSON.stringify(before)));
      if (typeof out === 'string') { return { why: out }; }
      var row = { kind: kind, data: data, human: { desc: who.desc, profileId: who.profileId, life: who.life },
                  sequence: sequence, marker: marker, previousMarker: previousMarker, taken: out.taken, at: Date.now() };
      if (!validMarker(marker) || marker === previousMarker) {
        return { why: 'The server could not identify that debit. Nothing was taken.' };
      }
      var rows = book();
      rows.push(row);
      if (!keep()) {
        rows.splice(rows.indexOf(row), 1);
        return { why: 'The server could not write that down. Nothing was taken.' };
      }
      if (!stillActive()) { return { line: '' }; }
      try {
        mp.compareAndSetInventoryAndProperty(actorId, { entries: before }, receipt, { entries: out.entries },
          sequence, who.profileId, { name: markerField, expected: previousMarker, replacement: marker,
                                   expectedLifeGeneration: who.life, expectedRuntimeIdentity: who.runtime });
      } catch (e2) {
        tell(0, '', e2);
      }
      try { return { line: settleOne(row) }; }
      catch (e3) {
        tell(0, '', e3);
        return { line: '' };
      }
    }
    function settle() {
      if (!ready()) { return; }
      var rows = book().slice();
      for (var i = 0; i < rows.length; i++) {
        var line = '';
        try { line = settleOne(rows[i]); }
        catch (e) { tell(0, '', e); }
        if (line) { tell(rows[i].human.profileId, line); }
      }
    }
    return { begin: begin, settle: settle, ready: ready };
  }
  // -- pack first (#4901), end --

  /* One furniture item out of a list of pack entries, for packFirst: { entries, taken }, or null when none is there. */
  function cutOne(entries, itemDesc) {
    var baseId = idOf(itemDesc) >>> 0;
    if (!baseId) { return null; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || (e.baseId >>> 0) !== baseId || !(Number(e.count) > 0)) { continue; }
      e.count = Number(e.count) - 1;
      if (e.count <= 0) { entries.splice(i, 1); }
      return { entries: entries, taken: [{ baseId: baseId, count: 1 }] };
    }
    return null;
  }

  /* A line to a person in the world, from a piece that landed or let go after they asked. */
  function tellPerson(pid, line, err) {
    if (err) { plog('furniture: a take out of a pack:', err); return; }
    if (!line) { return; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    for (var i = 0; i < online.length; i++) {
      var pidHere = 0;
      try { pidHere = Number(mp.get(online[i], 'profileId')) || 0; } catch (e2) { pidHere = 0; }
      if (pidHere !== Number(pid)) { continue; }
      if (typeof notify === 'function') {
        try { notify(online[i], line); } catch (e3) { plog('furniture: could not show', hex(online[i]), 'a line:', e3); }
      }
      return;
    }
  }

  var placementField = 'thornswoodFurniturePlacement';
  var placementRegistered = false;
  try {
    mp.makeProperty(placementField, {
      isVisibleByOwner: false, isVisibleByNeighbors: false, updateOwner: '', updateNeighbor: ''
    });
    placementRegistered = true;
  } catch (err) { plog('could not register furniture placement markers:', err); }

  g.__thornswoodFurniture = create({
    catalog: doc,
    now: function () { return Date.now(); },
    log: plog,
    readRegister: function () { return furnitureRead.doc; },
    writeRegister: function (book) {
      try { storeWrite(registerPath(), JSON.stringify(book, null, 1), furnitureRead); return true; }
      catch (e) { plog('furniture: could not write', registerPath() + ':', e); return false; }
    },
    writePackRegister: function (book) {
      try {
        if (furnitureRead.bad) { throw new Error('the furniture register could not be read at startup'); }
        var file = registerPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        mp.writeFileWhole(file, JSON.stringify(book, null, 1));
        return true;
      } catch (e) { plog('furniture: could not commit a placement:', e); return false; }
    },
    packFirst: function (book, keep, landers, commit) {
      return packFirst(mp, book, keep, landers, tellPerson, 'thornswoodFurnitureDebit', commit, require('crypto').randomUUID, admitPackDebit);
    },
    placementReady: function () {
      return placementRegistered && typeof mp.writeFileWhole === 'function' &&
        typeof mp.placeDisabledFurniture === 'function';
    },
    placementMarker: function (id) { return mp.get(id, placementField); },
    placementEnabled: function (id) { return mp.get(id, 'isDisabled') === false; },
    stagePlacement: function (baseDesc, marker) {
      return mp.placeDisabledFurniture(idOf(baseDesc) >>> 0, marker);
    },
    enablePlacement: function (id) { mp.set(id, 'isDisabled', false); },
    cutOne: cutOne,
    actorOf: function (desc) { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } },
    cellOf: cellOf,
    posOf: function (id) { try { return mp.get(id, 'pos') || null; } catch (e) { return null; } },
    angleOf: function (id) { try { return mp.get(id, 'angle') || null; } catch (e) { return null; } },
    isBuilding: function (cell) {
      var P = prop();
      return !!(P && P.doorsOf && P.doorsOf(cell).length);
    },
    holderOf: function (b) { var P = prop(); return P ? P.holderOf(b) : null; },
    nameOf: function (b) { var P = prop(); return P ? P.nameOf(b) : b; },
    // The rule setLock keeps: the holder, the deed or its master key.
    mayArrange: function (actorId, building, held) {
      var P = prop();
      if (!P || !held) { return false; }
      var pid = 0;
      try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
      return (pid > 0 && held.by === pid) || P.holdsDeed(actorId, building) ||
        P.holdsMasterKey(actorId, building);
    },
    who: function (actorId) {
      var n = '';
      try { n = String((mp.get(actorId, 'appearance') || {}).name || ''); } catch (e) { n = ''; }
      return (n || 'somebody') + ' (' + hex(actorId) + ')';
    },
    online: function () { try { return mp.get(0, 'onlinePlayers') || []; } catch (e) { return []; } },
    count: function (actorId, itemDesc) {
      var baseId = idOf(itemDesc) >>> 0;
      if (!baseId) { return 0; }
      var n = 0;
      (entriesOf(actorId) || []).forEach(function (e) { if (e && (e.baseId >>> 0) === baseId) { n += Number(e.count) || 0; } });
      return n;
    },
    take: takeOne,
    give: giveOne,
    /*
      The base is there and of the kind its row says, and a container base
      neither respawns nor brings contents of its own, so setting one down
      makes nothing out of nothing. '' when it is fine.
    */
    baseRefusal: function (row) {
      var id = idOf(row.base) >>> 0;
      var rec = null;
      try { rec = id ? (mp.lookupEspmRecordById(id) || {}).record : null; } catch (e) { rec = null; }
      if (!rec) { return row.base + ' is not in the load order'; }
      if (String(rec.type) !== row.type) { return row.base + ' is a ' + rec.type + ', not a ' + row.type; }
      if (row.type === 'CONT') {
        var fields = rec.fields || [];
        for (var i = 0; i < fields.length; i++) {
          var t = fields[i] && String(fields[i].type);
          if (t === 'CNTO') { return row.base + ' carries contents of its own'; }
          if (t === 'DATA' && fields[i].data && (fields[i].data[0] & 0x02)) { return row.base + ' respawns'; }
        }
      }
      return '';
    },
    place: function (baseDesc) {
      var id = idOf(baseDesc) >>> 0;
      if (!id) { throw new Error(baseDesc + ' is not in the load order'); }
      return mp.place(id);
    },
    // Angle before the move: the move is what streams it, with its angle (see the boards).
    turn: function (id, angle) { refCall('SetAngle', id, [0, 0, angle]); },
    moveNear: function (id, anchor, pos) {
      var at = mp.get(anchor, 'pos');
      refCall('MoveTo', id, [refSelf(anchor), pos[0] - at[0], pos[1] - at[1], pos[2] - at[2], false]);
    },
    remove: function (id) {
      try { refCall('Delete', id, []); } catch (e) { refCall('Disable', id, [false]); }
    },
    containerEmpty: function (id) {
      var entries = entriesOf(id);
      return !!entries && !entries.some(function (e) { return e && Number(e.count) > 0; });
    },
    refStands: function (id, baseDesc) { return !!id && baseOf(id) === String(baseDesc).toLowerCase(); },
    refAt: function (id, baseDesc, cell, pos, angle) {
      if (!id || baseOf(id) !== String(baseDesc).toLowerCase() || cellOf(id) !== cell) { return false; }
      try {
        var p = mp.get(id, 'pos'), a = mp.get(id, 'angle');
        for (var i = 0; i < 3; i++) { if (Math.abs(p[i] - pos[i]) > 1) { return false; } }
        var d = Math.abs((((Number(a[2]) - angle) % 360) + 540) % 360 - 180);
        return d < 0.5;
      } catch (e) { return false; }
    },
    // A door of the building standing in the building, which the server loads.
    anchorIn: function (building) {
      var P = prop();
      var doors = (P && P.doorsOf) ? P.doorsOf(building) : [];
      for (var i = 0; i < doors.length; i++) {
        var id = idOf(doors[i]) >>> 0;
        if (id && cellOf(id) === building) { return id; }
      }
      return 0;
    },
    line: function (actorId, v) {
      try { mp.set(actorId, LINE_PROPERTY, stamped(v)); } catch (e) {
        plog('furniture: could not write the line of', hex(actorId) + ':', e);
      }
    },
    show: function (actorId, v) {
      try { mp.set(actorId, PANEL_PROPERTY, stamped(v)); } catch (e) {
        plog('furniture: could not send the furniture panel to', hex(actorId) + ':', e);
      }
    }
  });

  try { g.__thornswoodFurniture.standAll(); } catch (e) { plog('furniture: standing the pieces failed:', e); }

  // A piece is set down once its item is saved out of the pack (#4901): see packFirst.
  if (g.__thornswoodFurniturePackTimer) {
    try { clearInterval(g.__thornswoodFurniturePackTimer); } catch (e) { plog('furniture: the old pack timer would not stop:', e); }
  }
  g.__thornswoodFurniturePackTimer = setInterval(
    guard('furniturePackTick', g.__thornswoodFurniture.settle), 1000);
})();
// ==== end thornswood furniture ====


