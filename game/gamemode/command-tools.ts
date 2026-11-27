// Registered playtest/admin tools and their role-specific help (#6731).
// Only modules loaded by the server can register an implemented command.
(function () {
  'use strict';
  var g = globalThis;
  var levels = { playtester: 1, staff: 2, admin: 3 };
  var modules = Object.create(null), routes = Object.create(null), entries = [];

  function register(id, definition) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) || modules[id] || !definition ||
        typeof definition.command !== 'function' || !Array.isArray(definition.help) || !definition.help.length) {
      throw new Error('A command module needs a unique name, a handler and help entries.');
    }
    var own = Object.create(null);
    var added = definition.help.map(function (entry) {
      if (!entry || typeof entry.word !== 'string' || !/^\/[a-z][a-z0-9-]*$/.test(entry.word) ||
          typeof entry.role !== 'string' ||
          !Object.prototype.hasOwnProperty.call(levels, entry.role) ||
          typeof entry.syntax !== 'string' || !entry.syntax.trim() ||
          typeof entry.text !== 'string' || !entry.text.trim() || routes[entry.word] || own[entry.word + '|' + entry.role]) {
        throw new Error('Command help needs a unique command, a known role, syntax and a description.');
      }
      own[entry.word + '|' + entry.role] = true;
      return { word: entry.word, role: entry.role, syntax: entry.syntax, text: entry.text };
    });
    modules[id] = definition.command;
    added.forEach(function (entry) {
      if (!routes[entry.word] || levels[entry.role] < levels[routes[entry.word].role]) {
        routes[entry.word] = { handler: definition.command, role: entry.role };
      }
      entries.push(entry);
      if (WORDS.indexOf(entry.word) === -1) { WORDS.push(entry.word); }
    });
  }

  function command(cmd, word, parts, pid, actorId) {
    var route = routes[word];
    if (!route) { return false; }
    var staff = g.__thornswoodStaff;
    if (!staff) { throw new Error('The staff authorization boundary is not available.'); }
    var refused = staff.authorizeTool(cmd, pid, actorId, route.role);
    if (refused) { staff.tell(pid, refused); return true; }
    route.handler(cmd, word, parts, pid, actorId);
    return true;
  }

  function help(role) {
    var level = levels[role] || 0;
    return entries.filter(function (entry) { return levels[entry.role] <= level; })
      .map(function (entry) { return { word: entry.word, role: entry.role, syntax: entry.syntax, text: entry.text }; });
  }
  g.__thornswoodCommandTools = { register: register, command: command, help: help };

  // These predate the module catalog and are implemented by the existing
  // router/staff blocks. Their canonical detailed reference is the guide.
  var legacy = [
    { role: 'playtester', syntax: '/give <item> [count]', text: 'Give yourself an item; for example /give iron ore 5.' },
    { role: 'playtester', syntax: '/spawn <creature> [count] [keep]', text: 'Spawn nearby; for example /spawn troll 2.' },
    { role: 'playtester', syntax: '/tp <place>, /goto <place>', text: 'Move yourself; for example /tp whiterun.' },
    { role: 'playtester', syntax: '/where', text: 'Read your current location and facing.' },
    { role: 'staff', syntax: '/silence <person> [length] [why], /unsilence <person>', text: 'Silence or restore speech.' },
    { role: 'staff', syntax: '/freeze <person> [why], /unfreeze <person>', text: 'Hold someone in place or release them.' },
    { role: 'staff', syntax: '/freezeaccount <person> [why], /unfreezeaccount <person>', text: 'Account freeze: holds the original character and refuses alternate admission. Unavailable unless account mode is enabled and ready.' },
    { role: 'staff', syntax: '/silenceaccount <person> [length] [why], /unsilenceaccount <person>', text: 'Account speech restraint across character changes. Unavailable unless account mode is enabled and ready.' },
    { role: 'staff', syntax: '/goto <person>, /bring <person>, /tp <person> <place>', text: 'Move yourself to someone, or move them.' },
    { role: 'staff', syntax: '/give <person> <item> [count], /spawnat <person> <creature> [count]', text: 'Give items or spawn nearby.' },
    { role: 'staff', syntax: '/warn <person> <why>, /kick <person> [why]', text: 'Warn someone or end their session.' },
    { role: 'staff', syntax: '/ban <person> <length> <why>, /banaccount <person> <length> <why>', text: 'Ban one character or their account.' },
    { role: 'staff', syntax: '/unban <person>, /unbanaccount <person>, /note <person> <text>', text: 'Lift a ban or keep a staff note.' },
    { role: 'staff', syntax: '/pk <person> <why>', text: 'Record a permanent character death.' },
    { role: 'staff', syntax: '/hurt <person> [what], /despawn', text: 'Inspect or set a scene injury, or remove a spawned creature.' },
    { role: 'admin', syntax: '/unpk <person or character> <why>', text: 'Undo a permanent death made by mistake.' },
    { role: 'admin', syntax: '/embassy, /remnant', text: 'Read and manage the corresponding rolls.' }
  ];

  function showHelp(cmd, word, parts, pid, actorId) {
    var role = word === '/adminhelp' ? 'admin' : word === '/staffhelp' ? 'staff' : 'playtester';
    var staff = g.__thornswoodStaff;
    if (parts.length !== 1) { staff.tell(pid, 'Usage: ' + word); return true; }
    var title = role === 'admin' ? 'Admin commands' : role === 'staff' ? 'Staff commands' : 'Playtest commands';
    staff.tell(pid, title + ': self-only playtest tools work on both Dev and Main.');
    legacy.filter(function (entry) { return levels[entry.role] <= levels[role]; })
      .concat(help(role)).forEach(function (entry) { staff.tell(pid, entry.syntax + ': ' + entry.text); });
    return true;
  }
  register('help', {
    command: showHelp,
    help: [
      { word: '/testhelp', role: 'playtester', syntax: '/testhelp', text: 'Show your self-only test commands.' },
      { word: '/staffhelp', role: 'staff', syntax: '/staffhelp', text: 'Show the staff moderation commands.' },
      { word: '/adminhelp', role: 'admin', syntax: '/adminhelp', text: 'Show the admin commands and the lower tiers.' }
    ]
  });
})();
