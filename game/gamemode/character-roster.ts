// ==== thornswood character roster ====
// ---------------------------------------------------------------- roster ---
// Who each profile id actually is, written where the launcher can read it.
//
// The launcher knows a profile id and nothing else. That is by design: the id
// is the only thing that decides which character the server hands back, and it
// is the only thing the launcher has any business choosing. But it makes for a
// poor card. "profile 1964204031" tells nobody anything.
//
// Everything worth showing lives here instead. The race and the sex are in the
// appearance the client uploaded, the trade and the town are in the chargen
// state this gamemode wrote when the launcher's choice was applied, and none of
// it is on anybody's disk.
//
// It goes out the same way the online count does: a small file in the folder
// the server already serves over HTTP on 3000. Nothing new is opened and no
// protocol is invented.
//
// Kept, not rebuilt. onlinePlayers only lists people who are connected, and
// somebody looking at the launcher is by definition not connected, so a file
// built fresh from who is online would be empty exactly when it is read. Each
// profile's row is written while they are on and left there afterwards.
(function () {
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }
  if (!fs || !path) return;

  var EVERY_MS = 4000;

  var dataDir = 'data';
  var privDir = 'private';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.dataDir) dataDir = String(cfg.dataDir);
    if (cfg && cfg.privDir) privDir = String(cfg.privDir);
  } catch (e) { }


  /*
    Make the folder before writing into it.

    privDir held door.json, allowed.json and characters.json on 18 September
    and on 20 September the whole folder was gone. Every write into it is
    wrapped in a try, so a missing folder is not an error anybody sees: the
    character register silently stops being saved, the door silently never
    fetches a roster, and /tp silently refuses everybody because the list it
    reads was never written. That is three separate reports with one cause and
    no log line between them.

    One mkdir at load costs nothing and there is no case where the right answer
    is to carry on writing into a folder that is not there.
  */
  function ensureDir(d) {
    try {
      if (d && !fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
        console.log('[thornswood] made the missing folder ' + d);
      }
    } catch (e) {
      console.log('[thornswood] could not make ' + d + ': ' + e);
    }
  }
  ensureDir(privDir);

  var FILE = path.join(privDir, 'characters.json');

  var book = {};
  try {
    var had = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (had && had.who && typeof had.who === 'object') book = had.who;
  } catch (e) { book = {}; }

  // The ten playable races, by the low three bytes of their form id. Skyrim.esm
  // is always file index zero so the top byte is zero anyway, but masking makes
  // that an assumption the code states rather than one it relies on.
  var RACES = {
    0x013740: 'Argonian',
    0x013741: 'Breton',
    0x013742: 'Dark Elf',
    0x013743: 'High Elf',
    0x013744: 'Imperial',
    0x013745: 'Khajiit',
    0x013746: 'Nord',
    0x013747: 'Orc',
    0x013748: 'Redguard',
    0x013749: 'Wood Elf'
  };

  // Anything else, including vampire variants and whatever a mod adds, is
  // looked up properly and turned into words. Deliberately not a second hand
  // written table: a list of ids for mod added races would be wrong the first
  // time somebody changed the mod list.
  var looked = {};

  function spaced(editorId) {
    var s = String(editorId || '');
    if (/Race$/i.test(s)) s = s.slice(0, -4);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (i > 0 && c >= 'A' && c <= 'Z' && !(s.charAt(i - 1) >= 'A' && s.charAt(i - 1) <= 'Z')) out += ' ';
      out += c;
    }
    return out.trim();
  }

  function raceName(id) {
    id = Number(id) || 0;
    if (!id) return '';
    var known = RACES[id & 0xFFFFFF];
    if (known) return known;
    if (looked[id] !== undefined) return looked[id];

    var name = '';
    try {
      var found = mp.lookupEspmRecordById(id);
      var rec = found && found.record;
      var fields = (rec && rec.fields) || [];
      for (var i = 0; i < fields.length; i++) {
        if (String(fields[i].type) !== 'EDID') continue;
        var bytes = fields[i].data || [];
        var text = '';
        for (var b = 0; b < bytes.length; b++) {
          if (!bytes[b]) break;
          text += String.fromCharCode(bytes[b]);
        }
        name = spaced(text);
        break;
      }
    } catch (e) { name = ''; }

    looked[id] = name;
    return name;
  }

  /*
   * Where somebody is, in words: the main menu's Last location and the
   * launcher's "last seen in".
   *
   * worldOrCellDesc is a form descriptor, "16789:Skyrim.esm", which is the
   * right thing to store and the wrong thing to show anybody. A claimable
   * building is named from BUILDING_NAME, the names measured out of the
   * plugins and their string tables (Build-DoorTable.py): "Volkihar Keep",
   * "Candlehearth Hall". Anything else falls back to its editor id spaced
   * out, which gives something readable rather than nothing, and a cell with
   * neither is left alone rather than guessed at.
   *
   * Then the hold, read the way the game reads it (#2551): the cell's or the
   * worldspace's location (XLCN), and that location's parents (PNAM) up to a
   * hold's own location record. The server reads the record that wins the
   * load order, so the places Thornswood-Last.esp gives a hold (Patrick,
   * 17 Oct, decision 2 = B on #2551: Castle Volkihar, Nightingale Hall,
   * Ironbind Barrow, Jakob's and Frederik's houses, Oar's Rest's utility
   * room, the Lost Hut, Darkfall Cave, Dayspring Canyon and its caves) are
   * named in it: "Volkihar Keep, Haafingar". Until this the line was the
   * spaced editor id alone, "DLC1 Vampire Castle Guildhall", and named no
   * hold anywhere. A place no hold's location covers (open ground on
   * Tamriel, which is one worldspace here, Apocrypha, a test cell) is named
   * without one.
   *
   * Cached because a cell's name never changes and this runs every four
   * seconds for everybody online.
   */
  var places = {};

  // Each hold's location record, by editor id, to the hold's name as the
  // creation hall writes it (CHARGEN's towns), and Solstheim for Raven Rock.
  // The same ten records scripts/dev/Build-BuildingHolds.py reads.
  var HOLD_NAMES = {
    WhiterunHoldLocation: 'Whiterun Hold', HaafingarHoldLocation: 'Haafingar',
    RiftHoldLocation: 'The Rift', ReachHoldLocation: 'The Reach',
    EastmarchHoldLocation: 'Eastmarch', FalkreathHoldLocation: 'Falkreath Hold',
    HjaalmarchHoldLocation: 'Hjaalmarch', PaleHoldLocation: 'The Pale',
    WinterholdHoldLocation: 'Winterhold', DLC2SolstheimLocation: 'Solstheim'
  };

  function fieldOf(rec, type) {
    var fields = (rec && rec.fields) || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] && String(fields[i].type) === type) { return fields[i].data || null; }
    }
    return null;
  }

  function plainText(bytes) {
    var text = '';
    for (var i = 0; bytes && i < bytes.length; i++) {
      if (!bytes[i]) break;
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }

  // A form id a record names, in the server's own numbering, or 0.
  function namedForm(found, rec, type) {
    var b = fieldOf(rec, type);
    if (!b || b.length < 4) return 0;
    var local = (b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 0x1000000;
    if (!local || !found || typeof found.toGlobalRecordId !== 'function') return 0;
    return Number(found.toGlobalRecordId(local)) || 0;
  }

  // The name of the hold a cell or worldspace record is in, or ''.
  function holdOfPlace(found, rec) {
    var loc = namedForm(found, rec, 'XLCN');
    var seen = {};
    while (loc && !seen[loc]) {
      seen[loc] = true;
      var lres = mp.lookupEspmRecordById(loc);
      var lrec = lres && lres.record;
      if (!lrec || String(lrec.type) !== 'LCTN') return '';
      var edid = plainText(fieldOf(lrec, 'EDID'));
      if (Object.prototype.hasOwnProperty.call(HOLD_NAMES, edid)) return HOLD_NAMES[edid];
      loc = namedForm(lres, lrec, 'PNAM');
    }
    return '';
  }

  var buildingNames = null;

  function buildingNamed(desc) {
    if (typeof BUILDING_NAME === 'undefined') return '';
    if (!buildingNames) {
      buildingNames = {};
      for (var k in BUILDING_NAME) {
        if (Object.prototype.hasOwnProperty.call(BUILDING_NAME, k)) { buildingNames[k.toLowerCase()] = String(BUILDING_NAME[k]); }
      }
    }
    var key = desc.toLowerCase();
    return Object.prototype.hasOwnProperty.call(buildingNames, key) ? buildingNames[key] : '';
  }

  function placeName(desc) {
    desc = String(desc || '');
    if (!desc) return '';
    if (places[desc] !== undefined) return places[desc];

    var out = '';
    try {
      var id = mp.getIdFromDesc(desc);
      var found = id ? mp.lookupEspmRecordById(id) : null;
      var rec = found && found.record;
      var fields = (rec && rec.fields) || [];

      /*
        EDID first, FULL only when it is really text.

        Skyrim.esm and the DLCs are localized, which means a FULL field does
        not hold a name at all: it holds a four byte index into the strings
        file beside the plugin. Reading those bytes as characters wrote four
        bytes of binary into characters.json as somebody's location, for every
        vanilla cell in the game.

        The editor id is always plain ASCII and always present, so it is the
        one to trust. A FULL is taken only when every byte of it is printable
        ASCII, which a real name in an unlocalized plugin is and a string index
        almost never is.
      */
      var edid = '';
      var full = '';
      for (var i = 0; i < fields.length; i++) {
        var t = String(fields[i].type);
        if (t === 'FULL' && !full) {
          var bytes = fields[i].data || [];
          var text = '';
          var printable = bytes.length > 0;
          for (var b = 0; b < bytes.length; b++) {
            if (!bytes[b]) break;
            if (bytes[b] < 32 || bytes[b] > 126) { printable = false; break; }
            text += String.fromCharCode(bytes[b]);
          }
          if (printable && text) { full = text; }
        } else if (t === 'EDID' && !edid) {
          edid = plainText(fields[i].data || []);
        }
      }
      var name = buildingNamed(desc);
      if (!name && edid) { name = spaced(edid); }
      else if (!name && full) { name = full; }
      var hold = name ? holdOfPlace(found, rec) : '';
      out = hold ? name + ', ' + hold : name;
    } catch (e) { out = ''; }

    places[desc] = out;
    return out;
  }

  /*
    Into a file beside it and then renamed over it, never written in place.

    writeFileSync empties the file before it writes it. A server stopped in
    between left a half written book, the load above could not parse it, and
    it started again from nothing: every row for somebody offline was gone
    from the server's own copy. The site merges what it is sent and kept its
    rows, but this file is the one a restart reads.

    Still synchronous, on purpose. Measured on 24 September on Patrick's
    machine, a book of 8 to 167 kilobytes, three runs of two hundred writes:
    0.8 to 2.1 ms in place, 2.3 to 4.7 ms through the rename, and this runs at
    most once every four seconds and only when a row changed. An asynchronous
    write could still be running when a hot reload starts the next copy of
    this block writing the same two files.

    The engine's mp.writeFileWhole does the write and the rename (#2740).
    Until then this was node's renameSync, MoveFileEx on Windows, which is
    refused while any other program has the file open, share-delete or not,
    and a refused rename wrote the book in place after all, the very write
    this exists to avoid. mp.writeFileWhole renames with POSIX
    semantics, which a reader sharing delete does not stop; one that does not
    share delete still refuses it, and then the book on disk stays the last
    one written whole, the console says why (once for each new reason), and
    the book stays marked unwritten, so the next pass four seconds on puts
    the whole book there.
  */
  var writeFailed = '';
  function write() {
    var wrote = false;
    try {
      mp.writeFileWhole(FILE, JSON.stringify({ at: Date.now(), who: book }));
      wrote = true;
      writeFailed = '';
    } catch (e) {
      var why = String((e && e.message) || e);
      if (why !== writeFailed) { console.log('[thornswood] could not write ' + FILE + ': ' + why); }
      writeFailed = why;
    }
    push();
    return wrote;
  }

  /*
    The same book, to the site.

    The launcher used to read characters.json straight off the resource port.
    On 18 September the file moved into the private folder (it names people
    and where they stand), the port has answered 404 since, and every card in
    the launcher, and now the game's own menu, has been nameless. The site is
    the one thing the launcher can prove itself to, so the book goes there
    with the door's key, and the site hands each person their own rows and
    nobody else's (POST /api/play/roster with the Discord ticket). Sent when
    the book changes, and once after a start so a restart is not a blank.
  */
  /*
    WHICH OF THE LAUNCHERS' CHARACTERS THIS WORLD STILL HOLDS (#955).

    Patrick picked his character on dev on 28 Sep and was sent to creation.
    The dev server's log: "Creating character ff000005", "1 logged as
    902356861". The engine found no actor under that profile and made a new
    one, so the gamemode was right to treat it as new. The character had been
    made on 20 Sep in a dev world that started over on 23 Sep, and since 26 Sep
    the engine also skips any character whose saved race no longer loads
    ("Skipping ChangeForm ...: bad raceId in appearanceDump"). The launcher
    still listed it, with its old name off the site's roster, which never
    forgets a row.

    So the server says which characters it has. Every profile the site allows
    in (allowed.json, which the door refreshes) is looked up in this world, and
    the answer goes to the site with the roster: checked is the list looked
    at, held the ones with a character here. The site tells each launcher
    which of its own characters this server does not have, and the menu marks
    them. Sent once after a start and every HELD_EVERY_MS.
  */
  var HELD_EVERY_MS = 300000;
  var serverName = 'main';
  try {
    var cfgS = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    serverName = String((cfgS && cfgS.thornswoodServer) || '').trim().toLowerCase() || 'main';
  } catch (e) { }
  var heldSaid = false;
  function heldReport() {
    if (typeof mp === 'undefined' || !mp || typeof mp.getActorsByProfileId !== 'function') {
      if (!heldSaid) { heldSaid = true; console.log('[thornswood] roster: this server cannot look characters up by profile, so the menu is not told which are gone'); }
      return null;
    }
    var ids = [];
    try {
      var doc = JSON.parse(fs.readFileSync(path.join(privDir, 'allowed.json'), 'utf8').replace(/^\uFEFF/, ''));
      var list = (doc && Array.isArray(doc.profiles)) ? doc.profiles : [];
      for (var i = 0; i < list.length; i++) {
        var n = Number(list[i]);
        if (n > 0 && ids.indexOf(n) < 0) ids.push(n);
      }
    } catch (e) { return null; }
    if (!ids.length) return null;
    var held = [];
    for (var j = 0; j < ids.length; j++) {
      var got;
      try { got = mp.getActorsByProfileId(ids[j]); } catch (e) { return null; }
      if (got && got.length) held.push(ids[j]);
    }
    return { checked: ids, held: held };
  }

  var pushSaid = false;
  function push() {
    var conf;
    try {
      conf = JSON.parse(fs.readFileSync(path.join(privDir, 'door.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) { return; }
    if (!conf || !conf.site || !conf.key) return;
    var https;
    try { https = require('https'); } catch (e) { return; }
    var u;
    try { u = new URL(String(conf.site).replace(/\/+$/, '') + '/api/roster'); } catch (e) { return; }
    var msg = { key: String(conf.key), who: book, server: serverName };
    var rep = heldReport();
    if (rep) { msg.checked = rep.checked; msg.held = rep.held; }
    var body = JSON.stringify(msg);
    try {
      var req = https.request({
        host: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST', timeout: 5000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, function (resp) {
        resp.resume();
        if (resp.statusCode !== 200 && !pushSaid) {
          pushSaid = true;
          console.log('[thornswood] the site answered ' + resp.statusCode + ' to the roster; names will be missing from the menu');
        }
      });
      req.on('error', function (e) {
        if (!pushSaid) {
          pushSaid = true;
          console.log('[thornswood] could not send the roster to the site: ' + (e && e.message ? e.message : e));
        }
      });
      req.on('timeout', function () { req.destroy(); });
      req.end(body);
    } catch (e) { }
  }
  setTimeout(push, 15000);
  // The held report goes again every five minutes, a new character included.
  // Stored so a hot reload replaces it rather than adding another.
  if (globalThis.__thornswoodHeldPush) {
    try { clearInterval(globalThis.__thornswoodHeldPush); } catch (e) { }
  }
  globalThis.__thornswoodHeldPush = setInterval(push, HELD_EVERY_MS);

  var dirty = false;

  // Cleared on a hot reload. Three of these ran unstored, so every reload
  // added another copy of each and none of them ever stopped.
  if (globalThis.__thornswoodRoster) {
    try { clearInterval(globalThis.__thornswoodRoster); } catch (e) { }
  }
  globalThis.__thornswoodRoster = setInterval(function () {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }

    for (var i = 0; i < online.length; i++) {
      var id = online[i];
      try {
        var pid = Number(mp.get(id, 'profileId')) || 0;
        if (!pid) continue;

        var look = mp.get(id, 'appearance') || null;
        var state = null;
        try { state = chargenOf(id); } catch (e) { state = null; }
        // The profession lives on the character property since 20 September;
        // the old trade key is read for anybody made before it.
        var ch = null;
        try { ch = mp.get(id, 'thornswoodCharacter'); } catch (e) { ch = null; }

        var where = '';
        try { where = placeName(mp.get(id, 'worldOrCellDesc')); } catch (e) { where = ''; }

        var row = {
          name: String((look && look.name) || ''),
          race: look ? raceName(look.raceId) : '',
          female: !!(look && look.isFemale),
          trade: String((ch && ch.prof) || (state && state.class) || ''),
          town: String((state && state.destination) || ''),
          // Where they were standing the last time the server looked. Kept on
          // the row rather than thrown away when they log out, because the
          // only person who ever reads this is looking at a launcher with the
          // game shut, and "last seen in" is the whole point of it.
          where: where,
          at: Date.now()
        };

        var was = book[String(pid)];
        // Compared field by field rather than by timestamp, because the
        // timestamp moves every four seconds and this file sits in a folder
        // the server serves. Rewriting it fifteen times a minute for nothing
        // is churn nobody asked for.
        if (!was || was.name !== row.name || was.race !== row.race ||
            was.female !== row.female || was.trade !== row.trade ||
            was.town !== row.town || was.where !== row.where) {
          book[String(pid)] = row;
          dirty = true;
        }
      } catch (e) { }
    }

    // Still dirty when the write was refused: the file is behind the book.
    if (dirty) { dirty = !write(); }
  }, EVERY_MS);

  console.log('[thornswood] character roster published at ' + FILE);
})();
// ==== end thornswood character roster ====

