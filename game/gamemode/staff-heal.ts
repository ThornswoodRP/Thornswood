// Restore vitals for a self-only playtest or an admin's named target (#6733).
(function () {
  'use strict';
  var g = globalThis;
  var USAGE = 'Usage: /heal, or /heal for <person> for an admin.';

  function command(cmd, word, parts, pid, actorId) {
    if (word !== '/heal') { return false; }
    var staff = g.__thornswoodStaff;
    var refused = staff.authorizeTool(cmd, pid, actorId, 'playtester');
    if (refused) { staff.tell(pid, refused); return true; }
    var target = { actorId: actorId, pid: pid, name: staff.nameOf(actorId) };
    var args = parts.slice(1);
    if (args.length) {
      if (args.length < 2 || args[0].toLowerCase() !== 'for') { staff.tell(pid, USAGE); return true; }
      target = staff.takePerson(args.slice(1));
      if (!target.actorId || target.rest.length) { staff.tell(pid, target.why || USAGE); return true; }
      if (target.pid !== pid) {
        refused = staff.authorizeTool(cmd, pid, actorId, 'admin');
        if (refused) { staff.tell(pid, refused); return true; }
      }
    }
    var dead, current;
    try { dead = mp.get(target.actorId, 'isDead'); current = mp.get(target.actorId, 'percentages'); }
    catch (e) { staff.tell(pid, 'The server could not read those vitals. Nothing was requested.'); return true; }
    if (dead === true) { staff.tell(pid, 'That character is dead. Healing cannot undo death; use the normal wake or the appropriate admin process.'); return true; }
    if (dead !== false || !current || ['health', 'magicka', 'stamina'].some(function (key) {
      return typeof current[key] !== 'number' || !Number.isFinite(current[key]);
    })) {
      staff.tell(pid, 'The server could not read those vitals. Nothing was requested.'); return true;
    }
    if (current.health === 1 && current.magicka === 1 && current.stamina === 1) {
      staff.tell(pid, target.name + ' already has full health, magicka and stamina.'); return true;
    }
    try {
      mp.set(target.actorId, 'percentages', { health: 1, magicka: 1, stamina: 1 });
      var confirmed = mp.get(target.actorId, 'percentages');
      if (mp.get(target.actorId, 'isDead') !== false || !confirmed ||
          confirmed.health !== 1 || confirmed.magicka !== 1 || confirmed.stamina !== 1) {
        throw new Error('The native vitals write was not applied.');
      }
    }
    catch (e) {
      log('heal: could not confirm vitals for ' + target.actorId.toString(16) + ': ' + e);
      staff.tell(pid, 'Healing could not be confirmed. The server recorded why; try again only after the problem is checked.');
      return true;
    }
    var byName = staff.nameOf(actorId);
    staff.record('heal', pid, byName, target.pid, target.name, 'restored health, magicka and stamina', 0);
    staff.tell(pid, 'Restored health, magicka and stamina for ' + target.name + '.');
    if (target.pid !== pid) { staff.tell(target.pid, 'An admin restored your health, magicka and stamina.'); }
    return true;
  }
  g.__thornswoodHeal = { command: command };
  g.__thornswoodCommandTools.register('heal', {
    command: command,
    help: [
      { word: '/heal', role: 'playtester', syntax: '/heal', text: 'Restore your health, magicka and stamina for testing.' },
      { word: '/heal', role: 'admin', syntax: '/heal for <person>', text: 'Restore another character\'s vitals without undoing death or permanent decisions.' }
    ]
  });
})();
