// ==== thornswood admin rename ====
// #6739: change the saved appearance name through the engine's normal
// appearance binding, which persists it and reliably updates its listeners.
(function () {
  'use strict';
  var g = globalThis;
  var MAX_NAME = 60;
  // Refuse invisible controls, markup and malformed Unicode; never remove
  // them and quietly save a different name. Ordinary spaces are normalized.
  var UNSAFE = /[\p{C}\p{Zl}\p{Zp}<>]/u;
  var NAME = /^[\p{L}\p{M}\p{N} .'\u2019-]+$/u;

  function validateName(text) {
    if (typeof text !== 'string' || UNSAFE.test(text)) {
      return { why: 'A name cannot contain controls, invisible marks or markup.' };
    }
    var name = text.normalize('NFC').trim().replace(/ +/g, ' ');
    if (!name || !/[\p{L}\p{N}]/u.test(name)) { return { why: 'A name needs at least one letter or number.' }; }
    if (Array.from(name).length > MAX_NAME) { return { why: 'A name is at most 60 characters.' }; }
    if (!NAME.test(name)) { return { why: 'Use letters, numbers, spaces, apostrophes, hyphens or periods in a name.' }; }
    return { name: name, why: '' };
  }

  function command(cmd, word, parts, pid, actorId) {
    if (word !== '/rename') { return false; }
    var staff = g.__thornswoodStaff;
    if (!staff || typeof staff.authorizeTool !== 'function') {
      if (g.__thornswoodToProfile) { g.__thornswoodToProfile(pid, 'Renaming is unavailable right now.'); }
      return true;
    }
    // Self and other-character renames have exactly the same admin boundary.
    var refused = staff.authorizeTool(cmd, pid, actorId, 'admin');
    if (refused) { staff.tell(pid, refused); return true; }
    if (UNSAFE.test(String(cmd.text || ''))) {
      staff.tell(pid, 'A name cannot contain controls, invisible marks or markup.');
      return true;
    }
    var words = parts.slice(1);
    var target;
    if (String(words[0] || '').toLowerCase() === 'self') {
      target = { actorId: actorId, pid: pid, rest: words.slice(1) };
    } else {
      target = staff.takePerson(words);
      if (!target.actorId) { staff.tell(pid, target.why || 'Name somebody who is in the world.'); return true; }
    }
    if (!target.rest.length) {
      staff.tell(pid, 'Use /rename self <new name> or /rename <person> <new name>.');
      return true;
    }
    var named = validateName(target.rest.join(' '));
    if (named.why) { staff.tell(pid, named.why); return true; }
    var saved;
    try { saved = mp.get(target.actorId, 'appearance'); }
    catch (eRead) { staff.tell(pid, 'The server could not read that character\'s saved appearance, so the name was not changed.'); return true; }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      staff.tell(pid, 'That character has no saved appearance to rename yet.');
      return true;
    }
    var oldName = String(saved.name || '');
    if (oldName === named.name) { staff.tell(pid, 'That character is already called ' + named.name + '.'); return true; }
    // Take the requestor's name before a self rename changes it.
    var byName = staff.nameOf(actorId);
    var next = Object.assign({}, saved, { name: named.name });
    try { mp.set(target.actorId, 'appearance', next); }
    catch (eWrite) { staff.tell(pid, 'The server could not rename that character. Nothing was confirmed; try again later.'); return true; }
    staff.record('rename', pid, byName, target.pid, oldName,
      'Renamed to ' + named.name + '.', 0,
      { character: target.actorId.toString(16), oldName: oldName, newName: named.name });
    // Publish from the same saved appearance used by the normal roster and
    // nearby views, including when somebody disconnects before their timer.
    if (g.__thornswoodRefreshRoster) { g.__thornswoodRefreshRoster(); }
    var social = g.__thornswoodSocial;
    if (social && social.nearTick) { social.nearTick(); }
    staff.tell(pid, 'Renamed ' + (target.actorId === actorId ? 'your character' : oldName) +
      ' to ' + named.name + '. This is logged for staff.');
    if (target.pid !== pid) { staff.tell(target.pid, 'An admin renamed your character to ' + named.name + '. This is logged for staff.'); }
    return true;
  }

  g.__thornswoodRename = { command: command, validateName: validateName };
  if (g.__thornswoodCommandTools) {
    g.__thornswoodCommandTools.register('rename', {
      command: command,
      help: [{ word: '/rename', role: 'admin',
        syntax: '/rename self <newname> | /rename <person> <newname>',
        text: 'Renames the same saved character. Names use 1 to 60 characters: letters, numbers, spaces, apostrophes, hyphens or periods.' }]
    });
  }
})();
// ==== end thornswood admin rename ====
