// ==== thornswood keeping times ====
/*
  HOW LONG THE GAME SERVER'S OWN RECORDS OF PEOPLE ARE KEPT (#2353).

  Two files this gamemode appends to were never aged by anything, while the
  privacy page gave a time for everything else, or nothing at all:

    for-bot\moderation.log   one JSON line for every staff action in the
                             world, every /stuck (the character, profile,
                             Discord account and both places) and every move
                             out for being idle, which the bot says in the
                             staff channel. MODLOG_DAYS, 365, the same year as
                             the site's own moderation.log, its reports and
                             chat, so a report has the staff log beside it for
                             as long as the report exists.
    private\door.log         who the door let in, turned away or heard about,
                             by profile and actor, with the time.
                             DOOR_DAYS, 90, the time thornswood.log is kept
                             (scripts\vps\Server-Log.js), because the lines are
                             of the same kind and most go to both.

  Decided by Patrick on 12 October: a keeping time for each store, enforced
  in the code that writes it, the times Claude's to pick. door.log was
  named by the weekly review on 19 October.

  HOW. At load and every hour, each file is read, every line older than its
  time is taken out, and the rest is written back whole with the engine's
  mp.writeFileWhole (#2740), never in place, because the bot reads
  moderation.log while the server runs. Both are appended a line at a time
  (appendFileSync opens and closes for each), so between lines nothing here
  holds them, and the read and the write happen with no line written in
  between. A line's time is its at (moderation.log) or the stamp it starts
  with (door.log). A line whose time cannot be read is kept: it is a corrupt
  line either way, and a guess that deletes a staff record is the wrong way
  to be wrong. A write the engine refuses (the bot or somebody over ssh has
  the file open without sharing delete) leaves the file as it was and is
  said in thornswood.log, once for each new reason, and the next pass, within
  the hour, writes what is true then.
*/
(function () {
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); }
  catch (e) {
    log('keeping times: no file access here (' + e + '), so moderation.log and door.log are not aged');
    return;
  }
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  var MODLOG_DAYS = 365;
  var DOOR_DAYS = 90;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var EVERY_MS = 60 * 60 * 1000;

  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }
  // Where each file is, as the blocks that write them work it out: the staff
  // block's recordFile and the door's LOG.
  function files() {
    var s = settings();
    var priv = String(s.privDir || 'private');
    var forBot = String(s.forBotDir || path.join(path.dirname(priv), 'for-bot'));
    return [
      { name: 'moderation.log', file: path.join(forBot, 'moderation.log'), days: MODLOG_DAYS,
        timeOf: function (line) { try { return Date.parse(JSON.parse(line).at); } catch (e) { return NaN; } } },
      { name: 'door.log', file: path.join(priv, 'door.log'), days: DOOR_DAYS,
        timeOf: function (line) { return Date.parse(line.split(' ')[0]); } }
    ];
  }

  // The text with every line older than cut taken out, and how many went. A
  // last line with no line ending is left as it is.
  function keptLines(text, cut, timeOf) {
    var lines = String(text).split('\n');
    var last = lines.pop();
    var kept = [], dropped = 0;
    for (var i = 0; i < lines.length; i++) {
      var t = timeOf(lines[i]);
      if (isFinite(t) && t > 0 && t < cut) { dropped++; continue; }
      kept.push(lines[i] + '\n');
    }
    return { text: kept.join('') + last, dropped: dropped };
  }

  var failed = {};
  function age(f, now) {
    var text;
    try { text = fs.readFileSync(f.file, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') { return 0; }
      return said(f, 'could not be read (' + ((e && (e.code || e.message)) || e) + ')');
    }
    var out = keptLines(text, now - f.days * DAY_MS, f.timeOf);
    if (!out.dropped) { return 0; }
    try { mp.writeFileWhole(f.file, out.text); }
    catch (e) { return said(f, 'could not be written (' + ((e && e.message) || e) + ')'); }
    if (failed[f.name]) { delete failed[f.name]; }
    log('keeping times: ' + out.dropped + ' line' + (out.dropped === 1 ? '' : 's') + ' older than ' +
        f.days + ' days taken out of ' + f.name);
    return out.dropped;
  }
  function said(f, why) {
    if (failed[f.name] !== why) {
      failed[f.name] = why;
      log('keeping times: ' + f.name + ' ' + why + ', so lines older than ' + f.days +
          ' days are still in it; the next pass, within the hour, tries it again');
    }
    return 0;
  }
  function sweep(now) {
    var list = files(), n = {};
    for (var i = 0; i < list.length; i++) { n[list[i].name] = age(list[i], Number(now) || Date.now()); }
    return n;
  }

  g.__thornswoodKeepingTimes = { sweep: sweep, keptLines: keptLines, MODLOG_DAYS: MODLOG_DAYS, DOOR_DAYS: DOOR_DAYS };
  if (g.__thornswoodKeepingTimer) { clearInterval(g.__thornswoodKeepingTimer); }
  g.__thornswoodKeepingTimer = setInterval(function () { sweep(Date.now()); }, EVERY_MS);
  sweep(Date.now());
})();
// ==== end thornswood keeping times ====

