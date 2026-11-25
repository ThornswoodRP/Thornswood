// ==== thornswood gameplay inspection ====
// #6732: inspect the recorded gameplay state without settling or writing it.
(function () {
  'use strict';
  var g = globalThis;
  function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function read(actor, property) {
    try { return mp.get(actor, property); } catch (e) { return undefined; }
  }
  function text(value, most) {
    if (typeof value !== 'string') { return 'unavailable'; }
    var out = value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').trim();
    return out ? (out.length > most ? out.slice(0, most - 3) + '...' : out) : 'unavailable';
  }
  function number(value, scale, suffix) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(value * scale)) { return 'unavailable'; }
    return String(Number((value * scale).toFixed(1))) + suffix;
  }
  function field(value, key, scale, suffix) {
    return number(object(value) ? value[key] : undefined, scale, suffix);
  }
  function named(value, table) {
    if (value === null || value === '') { return 'not chosen'; }
    return typeof value === 'string' && table && Object.prototype.hasOwnProperty.call(table, value)
      ? table[value].name : 'unavailable';
  }
  function rankLabels(table) {
    var out = {};
    Object.keys(table.classes).forEach(function (key) { out[key] = table.classes[key].name; });
    Object.keys(table.professions).forEach(function (key) {
      var halves = table.professions[key].halves;
      Object.keys(halves || {}).forEach(function (half) { out[half] = halves[half]; });
    });
    table.schools.forEach(function (key) { out[key] = key.charAt(0).toUpperCase() + key.slice(1); });
    return out;
  }
  function report(staff, pid, actor) {
    var appearance = read(actor, 'appearance');
    staff.tell(pid, 'Character: ' + text(object(appearance) ? appearance.name : undefined, 90) +
      ' (form ' + actor.toString(16) + ').');
    var pos = read(actor, 'pos');
    staff.tell(pid, 'Location: ' + text(read(actor, 'worldOrCellDesc'), 120) + '; position ' +
      [0,1,2].map(function (i) { return number(Array.isArray(pos) ? pos[i] : undefined, 1, ''); }).join(', ') + '.');
    var vitals = read(actor, 'percentages');
    staff.tell(pid, 'Health: ' + field(vitals, 'health', 100, '%') + '; Magicka: ' +
      field(vitals, 'magicka', 100, '%') + '; Stamina: ' + field(vitals, 'stamina', 100, '%') + '.');
    // Needs.read supplies defaults and stateOf can migrate. Read the saved
    // properties themselves so missing or invalid values remain unavailable.
    var needs = read(actor, 'thornswoodNeeds');
    staff.tell(pid, 'Needs (last recorded): Food: ' + field(needs, 'food', 1, '/100') +
      '; Drink: ' + field(needs, 'drink', 1, '/100') + '; Rest: ' + field(needs, 'rest', 1, '/100') +
      '; Temperature: ' + field(needs, 'temp', 1, '/100') + '.');
    var saved = read(actor, 'thornswoodCharacter');
    var state = object(saved) && saved.v === 1 ? saved : null;
    var progression = g.__thornswoodProgression;
    var table = progression && progression.TABLE;
    var labels = table ? rankLabels(table) : {};
    staff.tell(pid, 'Class: ' + (state ? named(state.cls, table && table.classes) : 'unavailable') +
      '; Profession: ' + (state ? named(state.prof, table && table.professions) : 'unavailable') +
      '; Half: ' + (state && typeof state.half === 'string' && Object.prototype.hasOwnProperty.call(labels, state.half)
        ? labels[state.half] : state && state.half === null ? 'not chosen' : 'unavailable') + '.');
    var ranks = state && object(state.ranks) ? state.ranks : null;
    var entries = ranks && table ? Object.keys(labels).filter(function (key) {
      return Object.prototype.hasOwnProperty.call(ranks, key);
    }).map(function (key) {
      return labels[key] + ': ' + (table.ranks.indexOf(ranks[key]) !== -1 ? ranks[key] : 'unavailable');
    }) : null;
    var line = 'Ranks: ';
    (entries || []).forEach(function (entry) {
      if (line.length + entry.length > 250) { staff.tell(pid, line); line = 'Ranks: '; }
      line += (line === 'Ranks: ' ? '' : '; ') + entry;
    });
    staff.tell(pid, line + (entries ? (entries.length ? '.' : 'none recorded.') : 'unavailable.'));
    var godMode = read(actor, 'isGodMode');
    staff.tell(pid, 'God mode: ' + (typeof godMode === 'boolean' ? (godMode ? 'on' : 'off') : 'unavailable') + '.');
  }
  function command(cmd, word, parts, pid, actor) {
    if (word !== '/inspect') { return false; }
    var staff = g.__thornswoodStaff;
    var refused = staff.authorizeTool(cmd, pid, actor, 'playtester');
    if (refused) { staff.tell(pid, refused); return true; }
    var target = actor;
    if (parts.length !== 1) {
      if (String(parts[1]).toLowerCase() !== 'for' || parts.length < 3) {
        staff.tell(pid, 'Usage: /inspect or /inspect for <person>.'); return true;
      }
      var person = staff.takePerson(parts.slice(2));
      if (!person.actorId) { staff.tell(pid, person.why); return true; }
      if (person.rest.length) { staff.tell(pid, 'Usage: /inspect for <person>.'); return true; }
      if (person.pid !== pid) {
        refused = staff.authorizeTool(cmd, pid, actor, 'admin');
        if (refused) { staff.tell(pid, refused); return true; }
      }
      target = person.actorId;
    }
    report(staff, pid, target);
    return true;
  }
  g.__thornswoodInspect = { command: command };
  g.__thornswoodCommandTools.register('inspect', {
    command: command,
    help: [{ word: '/inspect', role: 'playtester', syntax: '/inspect',
      text: 'Read your own recorded gameplay state without changing it.' },
      { word: '/inspect', role: 'admin', syntax: '/inspect for <person>',
        text: 'Read another character\'s recorded gameplay state without changing it.' }]
  });
})();
// ==== end thornswood gameplay inspection ====
