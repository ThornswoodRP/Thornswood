// ==== thornswood staff progression ====
// #6736: a test tool for one legal step on the character's current ladder.
// Progression owns the rewards and character owns the saved record and view.
(function () {
  'use strict';
  var g = globalThis;
  var USAGE = 'Use /rankup class [for <person>] or /rankup profession [school] [for <person>].';

  function command(cmd, word, parts, pid, actorId) {
    var settingClass = word === '/setclass';
    if (word !== '/rankup' && !settingClass) { return false; }
    var usage = settingClass ? 'Use /setclass <class> [for <person>].' : USAGE;
    var staff = g.__thornswoodStaff;
    if (!staff) { return true; }
    function refuse(why) { staff.tell(pid, why); return true; }
    var P = g.__thornswoodProgression, C = g.__thornswoodCharacter;
    if (!P || !C) { return refuse('The progression tools are not running.'); }
    var args = parts.slice(1);
    var kind = settingClass ? 'class' : String(args.shift() || '').toLowerCase();
    if (kind !== 'class' && kind !== 'profession') { return refuse(usage); }
    var at = args.map(function (s) { return String(s).toLowerCase(); }).indexOf('for');
    var targetWords = at < 0 ? [] : args.slice(at + 1);
    var choice = at < 0 ? args : args.slice(0, at);
    if ((at >= 0 && !targetWords.length) || choice.length > (settingClass || kind === 'profession' ? 1 : 0) ||
        (settingClass && choice.length !== 1)) {
      return refuse(usage);
    }
    var target = { actorId: actorId, pid: pid, name: staff.nameOf(actorId) };
    if (targetWords.length && !(targetWords.length === 1 && targetWords[0].toLowerCase() === 'me')) {
      target = staff.takePerson(targetWords);
      if (!target.actorId || !target.pid || target.rest.length) {
        return refuse(target.why || 'Name exactly one character after for.');
      }
    }
    var denied = staff.authorizeTool(cmd, pid, actorId, target.actorId === actorId ? 'playtester' : 'admin');
    if (denied) { return refuse(denied); }
    if (staff.actorFor(target.pid) !== target.actorId) { return refuse('That character is not in the world.'); }
    var s = C.stateOf(target.actorId), key;
    if (settingClass) {
      var cls = String(choice[0]).toLowerCase();
      var changed = P.setClassForTesting(s, cls);
      if (!changed.ok) { return refuse(changed.why); }
      try { C.writeState(target.actorId, changed.state, true); }
      catch (e) { return refuse('The class change could not be saved.'); }
      if (C.stateOf(target.actorId).cls !== cls) { return refuse('The class change could not be saved.'); }
      staff.tell(target.pid, 'Your class is now ' + C.nameOf(cls) + ' at Novice.');
      if (target.pid !== pid) { staff.tell(pid, 'Changed ' + target.name + '\'s class to ' + C.nameOf(cls) + '.'); }
      staff.record('setclass', pid, staff.nameOf(actorId), target.pid, target.name, cls, 0,
        { from: s.cls || null, to: cls });
      return true;
    }
    if (kind === 'class') {
      key = s.cls;
      if (!P.has(P.TABLE.classes, key)) { return refuse('Choose a class before advancing its rank.'); }
    } else {
      if (!P.has(P.TABLE.professions, s.prof)) { return refuse('Choose a profession before advancing its rank.'); }
      if (s.prof === 'mage') {
        key = String(choice[0] || '').toLowerCase();
        if (P.TABLE.schools.indexOf(key) < 0 || s.schools.indexOf(key) < 0) {
          return refuse('Name one of that mage\'s chosen schools after profession.');
        }
      } else {
        if (choice.length) { return refuse('This profession advances its chosen half, without a school name.'); }
        key = s.half;
        if (P.halvesOf(s.prof).indexOf(key) < 0) { return refuse('Choose a half of the profession before advancing its rank.'); }
      }
    }
    var from = P.rankOf(s, key);
    // creditWork migrates a legacy class without standing to novice itself.
    var legacyClass = !from && kind === 'class';
    if (legacyClass) { from = 'novice'; }
    var rung = P.TABLE.ranks.indexOf(from);
    if (rung < 0) { return refuse('That progression rank cannot be read. Nothing was advanced.'); }
    if (from === 'master') { return refuse('That rank is already Master.'); }
    var need = legacyClass ? P.TUNING.workPerRank.advanced : P.workNeeded(s, key);
    var done = P.workDone(s, key);
    if (!Number.isFinite(need) || need <= 0 || !Number.isFinite(done) || done < 0) {
      return refuse('That work count cannot be read. Nothing was advanced.');
    }
    // One threshold, once. Normal school rewards are calculated by the same
    // function as earned work; no rank or reward is written by this module.
    var r = P.creditWork(s, key, null, Math.max(1, need - done));
    if (!r.ok || !r.raised || r.raised.key !== key || r.raised.to !== P.TABLE.ranks[rung + 1]) {
      return refuse((r && r.why) || 'That rank cannot advance.');
    }
    try { C.writeState(target.actorId, r.state, true); }
    catch (e) { return refuse('The new rank could not be saved.'); }
    // writeState logs a refused engine write; do not report or audit success
    // unless the single saved character property contains the new rank.
    if (P.rankOf(C.stateOf(target.actorId), key) !== r.raised.to) {
      return refuse('The new rank could not be saved.');
    }
    staff.tell(target.pid, C.raiseLines(target.actorId, r));
    if (target.pid !== pid) {
      staff.tell(pid, 'Advanced ' + target.name + '\'s ' + C.nameOf(key) + ' to ' + r.raised.to + '.');
    }
    staff.record('rankup', pid, staff.nameOf(actorId), target.pid, target.name,
      kind + ' ' + key, 0, { key: key, from: r.raised.from, to: r.raised.to });
    return true;
  }

  g.__thornswoodStaffProgression = { command: command };
  var tools = g.__thornswoodCommandTools;
  if (tools && tools.register) {
    tools.register('progression', { command: command, help: [{ word: '/rankup', role: 'playtester',
      syntax: '/rankup class|profession [school]', text: 'Advance your current class or profession by one rank.' },
      { word: '/rankup', role: 'admin', syntax: '/rankup class|profession [school] for <person>',
        text: 'Advance another character\'s current class or profession by one rank.' },
      { word: '/setclass', role: 'playtester', syntax: '/setclass <class>', text: 'Change your gathering class at Novice.' },
      { word: '/setclass', role: 'admin', syntax: '/setclass <class> for <person>',
        text: 'Change another character\'s gathering class at Novice.' }] });
  }
})();
// ==== end thornswood staff progression ====
