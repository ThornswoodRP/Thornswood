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

  A part that answers that it took is marked done in the file, the time it
  ran, so it never runs again; when every part is done the file is deleted,
  and nothing about who was released stays on the server. A part whose write
  did not take is said in the log and waits for the next start, and so does
  one whose block never got as far as asking; only those run then
  (__thornswoodReleaseWaiting, after the NPC startup, the last block that
  asks, says which).
  Delete-Person.ps1 merges a new request into a list still waiting and clears
  done, so every part runs for the new ids too; running again for an id
  already let go finds nothing.

  The log says counts and nothing else: never a name, a profile id or a form
  id. A list that cannot be read, or does not have the shape above, releases
  nothing, is left as it is, and the log says so.
*/
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

  // Where the list is: the privDir server-settings.json names, or private
  // when it names none. A settings file that will not read or parse names no
  // folder (#2871): the list is not looked for in one guessed for it, which
  // would let nothing go and say nothing. It is said, and nothing is let go.
  function where() {
    var cfg = null;
    try { cfg = JSON.parse(String(fs.readFileSync('server-settings.json', 'utf8')).replace(/^\uFEFF/, '')); }
    catch (e) {
      rlog('server-settings.json could not be read (' + ((e && (e.code || e.message)) || e) +
           '), so where the list is is not known and nothing was let go');
      return null;
    }
    return path.join((cfg && cfg.privDir) ? String(cfg.privDir) : 'private', 'deleted-characters.json');
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

  // The list, read once a load, field by field. A profile that is not a whole
  // number above 0, an actor that is not a runtime form id (isFormId), or a
  // done mark that is not a time, makes the whole list unreadable rather than
  // half read.
  function read() {
    if (st !== undefined) { return st; }
    st = null;
    var file = where();
    if (!file) { return st; }
    var text = null;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) {
      if (e && e.code !== 'ENOENT') { rlog(file + ' could not be read (' + e.code + '), so nothing was let go'); }
      return st;
    }
    var list = null;
    try { list = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { list = null; }
    var idsOk = function (a, top) {
      return Array.isArray(a) && a.every(function (n) { return Number.isSafeInteger(n) && n > 0 && n <= top; });
    };
    var ok = !!list && typeof list === 'object' && !Array.isArray(list) &&
      idsOk(list.profiles, Number.MAX_SAFE_INTEGER) &&
      (list.actors === undefined || (Array.isArray(list.actors) && list.actors.every(isFormId))) &&
      (list.done === undefined || (!!list.done && typeof list.done === 'object' && !Array.isArray(list.done) &&
        Object.keys(list.done).every(function (k) { return Number.isSafeInteger(list.done[k]) && list.done[k] > 0; })));
    if (!ok) {
      var old = !!list && typeof list === 'object' && Array.isArray(list.actors) &&
        list.actors.some(function (n) { return Number.isSafeInteger(n) && n > 0 && n <= 0xffffff; });
      rlog(file + (old ? ' holds form ids in the old shape, from a build before #2870, and is not read'
        : ' is not a list of deleted characters') + ', so nothing was let go and it is left as it is' +
        (old ? '; docs\\GAMEMODE.md says what to do' : ''));
      return st;
    }
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

