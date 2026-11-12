// ==== thornswood release of deleted characters ====
/*
  WHAT A DELETED CHARACTER HELD IS LET GO AT SERVER START (#2351).

  Patrick, 16 October, option A on #2351: "Delete-Person.ps1 writes a list,
  and the gamemode releases those entries at its next start." When somebody
  asks to be deleted, scripts\vps\Delete-Person.ps1 writes their profile ids,
  and the form ids of the characters it found, into
  private\deleted-characters.json, and stops nothing (#2758, Patrick, 18 Oct:
  "it should just fully apply the rest upon a server restart"):

      { "profiles": [ 5001 ], "actors": [ 4278192641 ] }

  An actor is the character's runtime form id, 0xff000000 | the local hex its
  change form's formDesc holds (formDesc "a01" is 0xff000a01), the one number
  every register keeps (#2870, formIdOf below, game\form-id.js). A list with
  an actor outside that range is the old shape, from a build before #2870,
  and is not read: nothing is let go and the list is left as it is, for a
  person (docs\GAMEMODE.md says what to do; nothing converts it).

  The part "saves" goes first, before the engine has started:
  server-log.js, which the task starts the server under, deletes their change
  forms (the engine loads them at its start, so it cannot be done from here)
  and takes them out of the card, mod menu, take count and last-left files
  (scripts\vps\Server-Log.js, startDeletions), and marks it done here. It
  is in PARTS so the list is not deleted while it waits; nothing in this file
  runs it. Its RELEASE_PARTS is this PARTS, held to it by
  tests\test-2758-start-deletions.js.

  Every block that keeps a register naming a character lets go of what the
  list names through its own release(), so a register's rule stays in the
  one place that knows it, and each does it once, as it loads, in the same
  pass as the rest of its start: no timer. Each calls
  g.__thornswoodRelease(part, release) when its register is read and before
  anything else at start acts on it:

    farms     farm claims and the seed handed out (the farming block)
    property  claims, offices (law.held), the boards' posts, the drop box and
              its record, and the beds (the property block, before rolesRead,
              which would otherwise end the office and name the character in
              the log)
    embassy   the embassy and remnant rolls (the embassy block)
    dungeon   the character on each dungeon chest's reservation (dungeon loot)
    cargo     the character on every line and hand out of the trade ships'
              manifest, every piece kept where it was (the trade ships
              block, #511)
    stalls    every market stall the character kept ends, and what was on
              it goes to the hold's drop box with no name on it (the market
              stalls block, #3160)
    carts     the character on every line, hand out and journey of the
              trade carts' manifest, every piece kept where it was (the
              trade carts block, #3158)
    books     members, their book chat, books they own, when they last left
              (the books)
    merchants the guild traders' supply waits, commission promises and a
              trade still waiting on the character, in the ledger and in
              each trader's own saved copy, retired traders' too (the purse
              service, at NPC startup, #2652)

  A part that answers that it took is marked done in the taken list
  (deleted-characters.taken.json, thornswoodTakeReleaseList below), the time
  it ran, so it never runs again; when every part is done that file is
  deleted, and nothing about who was released stays on the server. A part
  whose write did not take is said in the log and waits for the next start,
  and so does one whose block never got as far as asking; only those run then
  (__thornswoodReleaseWaiting, after the NPC startup, the last block that
  asks, says which).
  Delete-Person.ps1 merges a new request into deleted-characters.json, which
  the server never writes: one merged in while it starts is taken at the
  next start (#4920), and taking it in clears done for the new ids, so every
  part runs for them too; running again for an id already let go finds
  nothing.

  The log says counts and nothing else: never a name, a profile id or a form
  id. A list that cannot be read, or does not have the shape above, releases
  nothing, is left as it is, and the log says so.
*/
// -- the release list, taken (#4920), begin --
/*
  THE LIST IS TAKEN, NEVER WRITTEN OVER (#4920). private\deleted-characters.json
  is the requests: Delete-Person.ps1 and Release-List.ps1 merge a new one in
  whenever they run, while the game server runs too. A server that wrote back
  the copy it had read, or deleted the file once that copy was done, put
  back or threw away a request merged in since, and nobody was told.

  So the server never writes that file. It takes it, with a rename, the one
  step no other write can come between: deleted-characters.json becomes
  deleted-characters.taking.json, which goes into deleted-characters.taken.json,
  the server's own, and is deleted. Only the server writes .taken (server-log.js
  before the engine starts, then the gamemode as it loads, never at once), and
  its marks and its deleting are there. A request merged in after the take
  lands in a new deleted-characters.json and is taken at the next start; one
  merged in before it is in what was taken.

  Taking it in: every id of both, and a part done only where it is done on
  both, so a part that ran for the ids already taken runs again for the new
  ones (running again for an id already let go finds nothing). A .taking left
  by a stop between the rename and the merge goes in first, and a new list is
  never renamed onto it.

  Answers { list, file, left }: list is what is taken (null for none) and
  file is .taken; left, when set, is a request file that could not be taken
  and is left where it is, for a person: { bad, file } for one that is not a
  list (bad is what it held, null when it would not parse), or { error, file }.
  A .taken that is not a list answers { bad, file } or { error, file } and no
  list, so nothing is let go. Server-Log.js carries this same text, and
  tests\test-4920-taken-list.js holds the two the same.
*/
function thornswoodTakeReleaseList(fs, path, priv, valid) {
  var LIST = path.join(priv, 'deleted-characters.json');
  var TAKING = path.join(priv, 'deleted-characters.taking.json');
  var TAKEN = path.join(priv, 'deleted-characters.taken.json');
  function why(e) { return (e && (e.code || e.message)) || String(e); }
  function load(p) {
    var text;
    try { text = fs.readFileSync(p, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') { return { none: true }; }
      return { error: why(e), file: p };
    }
    var v = null;
    try { v = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { v = null; }
    return valid(v) ? { list: v } : { bad: v, file: p };
  }
  function ids(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (n) { if (!seen[n]) { seen[n] = true; out.push(n); } });
    return out.sort(function (x, y) { return x - y; });
  }
  var left = null;
  var taking = load(TAKING);
  if (taking.none) {
    var asked = load(LIST);
    if (asked.list) {
      try { fs.renameSync(LIST, TAKING); taking = load(TAKING); }
      catch (e) { if (!(e && e.code === 'ENOENT')) { left = { error: why(e), file: LIST }; } }
    } else if (!asked.none) { left = asked; }
  }
  if (!taking.none && !taking.list) { left = taking; taking = { none: true }; }
  var taken = load(TAKEN);
  if (!taken.none && !taken.list) { return taken; }
  if (!taking.list) { return { list: taken.list || null, file: TAKEN, left: left }; }
  var was = taken.list || { profiles: [], actors: [], done: taking.list.done || {} };
  var a = was.done || {}, b = taking.list.done || {}, done = {};
  Object.keys(a).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(b, k)) { done[k] = Math.max(a[k], b[k]); }
  });
  var list = { profiles: ids(was.profiles, taking.list.profiles), actors: ids(was.actors, taking.list.actors), done: done };
  try {
    fs.writeFileSync(TAKEN + '.tmp', JSON.stringify(list));
    fs.renameSync(TAKEN + '.tmp', TAKEN);
  } catch (e) {
    return { error: why(e), file: TAKEN };
  }
  try { fs.unlinkSync(TAKING); }
  catch (e) { left = { error: why(e), file: TAKING }; }
  return { list: list, file: TAKEN, left: left };
}
// -- the release list, taken (#4920), end --
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined' ? globalThis : this);
  var PARTS = ['saves', 'farms', 'property', 'embassy', 'dungeon', 'cargo', 'stalls', 'carts', 'books', 'merchants'];
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  // Into thornswood.log with the rest of the gamemode's own lines (log, at the top of the file).
  function rlog(line) {
    if (typeof log === 'function') { log('release: ' + line); } else { console.log('[thornswood] release: ' + line); }
  }
  var st;          // undefined until read: the list, or null for none
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { st = null; }

  // The privDir server-settings.json names, or private when it names none.
  // A settings file that will not read or parse names no folder (#2871): the
  // list is not looked for in one guessed for it, which would let nothing go
  // and say nothing. It is said, and nothing is let go.
  function where() {
    var cfg = null;
    try { cfg = JSON.parse(String(fs.readFileSync('server-settings.json', 'utf8')).replace(/^\uFEFF/, '')); }
    catch (e) {
      rlog('server-settings.json could not be read (' + ((e && (e.code || e.message)) || e) +
           '), so where the list is is not known and nothing was let go');
      return null;
    }
    return (cfg && cfg.privDir) ? String(cfg.privDir) : 'private';
  }

  // One shape for a character's form id (#2870); game\form-id.js is the
  // original and tests\test-2870-form-id-shape.js keeps this copy the same.
  function formIdOf(desc) {
    if (typeof desc !== 'string' || !/^[0-9a-f]{1,6}$/i.test(desc)) return 0;
    var local = parseInt(desc, 16);
    return local > 0 ? 0xff000000 + local : 0;
  }
  function isFormId(n) {
    return Number.isSafeInteger(n) && n > 0xff000000 && n <= 0xffffffff;
  }
  /*
    Whether the world holds a form at this id now, from the engine's own
    answer (#5036). mp.get reaches WorldState::GetFormAt, which throws
    exactly "Form with id 0x<id> doesn't exist" for an id it does not hold,
    and "Form with id 0x<id> is not <type> (actually it is <type>)" for one
    it holds as another kind of form; ScampServer::Get passes either on
    word for word. Those two are answers. Any other throw is not one: it is
    thrown on, so the list is not read this start rather than an id being
    taken for nobody's.
  */
  function formHeld(n) {
    var gone = "Form with id 0x" + n.toString(16) + " doesn't exist";
    var other = 'Form with id 0x' + n.toString(16) + ' is not ';
    try { mp.get(n, 'profileId'); return true; }
    catch (e) {
      var said = String((e && e.message) || e);
      if (said === gone) { return false; }
      if (said.indexOf(other) === 0) { return true; }
      throw e;
    }
  }

  // The list's shape, field by field. A profile that is not a whole number
  // above 0, an actor that is not a runtime form id (isFormId), or a done mark
  // that is not a time, makes the whole list unreadable rather than half read.
  function isList(list) {
    var idsOk = function (a, top) {
      return Array.isArray(a) && a.every(function (n) { return Number.isSafeInteger(n) && n > 0 && n <= top; });
    };
    return !!list && typeof list === 'object' && !Array.isArray(list) &&
      idsOk(list.profiles, Number.MAX_SAFE_INTEGER) &&
      (list.actors === undefined || (Array.isArray(list.actors) && list.actors.every(isFormId))) &&
      (list.done === undefined || (!!list.done && typeof list.done === 'object' && !Array.isArray(list.done) &&
        Object.keys(list.done).every(function (k) { return Number.isSafeInteger(list.done[k]) && list.done[k] > 0; })));
  }
  // What a file that is not a list is said as, and left as it is.
  function notList(file, v, tail) {
    var old = !!v && typeof v === 'object' && Array.isArray(v.actors) &&
      v.actors.some(function (n) { return Number.isSafeInteger(n) && n > 0 && n <= 0xffffff; });
    rlog(file + (old ? ' holds form ids in the old shape, from a build before #2870, and is not read'
      : ' is not a list of deleted characters') + ', so ' + tail + ' and it is left as it is' +
      (old ? '; docs\\GAMEMODE.md says what to do' : ''));
  }

  // The list, taken once a load (thornswoodTakeReleaseList, above).
  function read() {
    if (st !== undefined) { return st; }
    st = null;
    var priv = where();
    if (!priv) { return st; }
    var got = thornswoodTakeReleaseList(fs, path, priv, isList);
    if (got.left && got.left.error) {
      rlog(got.left.file + ' could not be taken (' + got.left.error + '), so the requests in it wait for the next start');
    } else if (got.left) {
      notList(got.left.file, got.left.bad, got.list ? 'the requests in it were not taken,' : 'nothing was let go');
    }
    if (got.error) { rlog(got.file + ' could not be read or written (' + got.error + '), so nothing was let go'); return st; }
    if (!got.list && got.bad !== undefined) { notList(got.file, got.bad, 'nothing was let go'); return st; }
    if (!got.list) { return st; }
    var file = got.file, list = got.list;
    var P = {}, A = {};
    list.profiles.forEach(function (n) { P[n] = true; });
    (list.actors || []).forEach(function (n) { A[n] = true; });
    st = {
      file: file,
      profiles: list.profiles.slice(),
      actors: (list.actors || []).slice(),
      done: list.done ? Object.assign({}, list.done) : {},
      who: {
        profile: function (n) { n = Number(n) || 0; return n > 0 && has(P, n); },
        actor: function (n) { n = Number(n) || 0; return isFormId(n) && has(A, n); }
      }
    };
    /*
      A REUSED ID IS SOMEBODY NEW (#5036). The engine hands a new form the
      lowest runtime id no loaded form holds (WorldState::GenerateFormId), so
      once a character's change form is gone its id goes to the next new
      character made. Once 'saves' is done, the characters this list names
      have no change form, and the engine started without them; a form that
      holds one of their ids now is somebody made since, not them. Without
      this a part still waiting at a later start (one whose write did not
      take, or whose block never asked) would let go of that new character's
      holdings by the id alone. The list stops naming that id, in the file
      too, so no later start can match it either.
    */
    if (has(st.done, 'saves')) {
      var taken;
      try { taken = st.actors.filter(formHeld); }
      catch (e) {
        // Said without the error's words, which carry the id.
        rlog('the world could not say whether an id on the list is held now, so nothing was let go and the list is left as it is');
        st = null;
        return st;
      }
      if (taken.length) {
        taken.forEach(function (n) { delete A[n]; });
        st.actors = st.actors.filter(function (n) { return has(A, n); });
        rlog(taken.length + ' character id(s) on the list belong to somebody made since, so the list no longer names them');
        mark();
      }
    }
    rlog('a list of ' + st.profiles.length + ' profile(s) and ' + st.actors.length +
         ' character(s) to let go, at server start');
    return st;
  }

  // The marks back into the file, or the file gone once every part is done.
  function mark() {
    try {
      if (PARTS.every(function (p) { return has(st.done, p); })) {
        fs.unlinkSync(st.file);
        rlog('every part is done, and the list is gone');
        return;
      }
      fs.writeFileSync(st.file + '.tmp', JSON.stringify({ profiles: st.profiles, actors: st.actors, done: st.done }));
      fs.renameSync(st.file + '.tmp', st.file);
    } catch (e) {
      rlog('the list could not be marked (' + ((e && e.code) || e) + '), so the parts that ran run again at the next start');
    }
  }

  g.__thornswoodRelease = function (part, release) {
    if (PARTS.indexOf(part) < 0 || typeof release !== 'function') { return; }
    if (!read() || has(st.done, part)) { return; }
    var r = null;
    try { r = release(st.who); }
    catch (e) { rlog(part + ' stopped: ' + ((e && e.message) || e) + '; its part waits for the next start'); return; }
    if (!r || !r.saved) {
      rlog(part + ' could not write what it let go, so its part waits for the next start');
      return;
    }
    st.done[part] = Date.now();
    var out = [];
    for (var k in r.counts) { if (has(r.counts, k) && r.counts[k]) { out.push(k + ' ' + r.counts[k]); } }
    rlog(part + ': ' + (out.length ? out.join(', ') : 'nothing of theirs'));
    mark();
  };

  // Which parts are still waiting once every block has loaded: a block that
  // never got as far as asking is said here, not passed over.
  g.__thornswoodReleaseWaiting = function () {
    if (!read()) { return []; }
    var left = PARTS.filter(function (p) { return !has(st.done, p); });
    if (left.length) { rlog(left.join(', ') + ' did not let go at this start, so the list waits for the next one'); }
    return left;
  };
})();
// ==== end thornswood release of deleted characters ====

