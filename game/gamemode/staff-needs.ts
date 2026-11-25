// ==== thornswood needs testing tools ====
(function () {
  'use strict';
  var g = globalThis;
  var METERS = { hunger: 'food', thirst: 'drink', rest: 'rest', temperature: 'temp' };
  var USAGE = 'Usage: /setneeds <hunger|thirst|rest|temperature> <0..100> [for <person>].';
  function command(cmd, word, parts, pid, actor) {
    if (word !== '/setneeds') { return false; }
    var staff = g.__thornswoodStaff;
    var refused = staff.authorizeTool(cmd, pid, actor, 'playtester');
    if (refused) { staff.tell(pid, refused); return true; }
    var meter = String(parts[1] || '').toLowerCase(), number = String(parts[2] || '');
    if (!Object.prototype.hasOwnProperty.call(METERS, meter) || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(number) ||
        !Number.isFinite(Number(number)) || Number(number) < 0 || Number(number) > 100 ||
        (parts.length !== 3 && (parts.length < 5 || String(parts[3]).toLowerCase() !== 'for'))) {
      staff.tell(pid, USAGE); return true;
    }
    var target = actor, targetPid = pid;
    if (parts.length > 3) {
      var person = staff.takePerson(parts.slice(4));
      if (!person.actorId) { staff.tell(pid, person.why); return true; }
      if (person.rest.length) { staff.tell(pid, USAGE); return true; }
      if (person.pid !== pid) {
        refused = staff.authorizeTool(cmd, pid, actor, 'admin');
        if (refused) { staff.tell(pid, refused); return true; }
      }
      target = person.actorId; targetPid = person.pid;
    }
    var needs = g.__thornswoodNeeds;
    if (!needs || !needs.setForTesting) { staff.tell(pid, 'Needs testing is unavailable. Try again later.'); return true; }
    var me = staff.nameOf(actor), name = staff.nameOf(target);
    var result = needs.setForTesting(target, METERS[meter], Number(number));
    if (!result.ok) { staff.tell(pid, result.why); return true; }
    staff.record('setneeds', pid, me, targetPid, name, '', 0,
      { meter: meter, from: result.from, to: result.to });
    var label = meter.charAt(0).toUpperCase() + meter.slice(1);
    staff.tell(pid, label + ' set to ' + result.to + '/100 for ' + name + '.');
    if (targetPid !== pid) { staff.tell(targetPid, 'Staff set your ' + meter + ' to ' + result.to + '/100 for testing.'); }
    return true;
  }
  g.__thornswoodStaffNeeds = { command: command };
  g.__thornswoodCommandTools.register('setneeds', {
    command: command,
    help: [{ word: '/setneeds', role: 'playtester', syntax: '/setneeds <hunger|thirst|rest|temperature> <0..100>',
      text: 'Set one of your needs for testing. Food, drink and rest are full at 100; temperature is comfortable at 50.' },
      { word: '/setneeds', role: 'admin', syntax: '/setneeds <hunger|thirst|rest|temperature> <0..100> for <person>',
        text: 'Set one need on another character for testing.' }]
  });
})();
// ==== end thornswood needs testing tools ====
