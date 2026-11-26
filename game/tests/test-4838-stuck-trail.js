// #4838: an escape trail contains recent steps from this journey only.
// The whole gamemode runs over the stand-in engine, including real death,
// carriage and staff command handlers. No client, server or service is used.
'use strict';
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const WORLD = '3c:Skyrim.esm';
const w = standIn.world({ name: '4838-stuck-trail', settings: { thornswoodDevs: [104] } });
const people = [101, 102, 103, 104].map((profileId, i) => w.person(0xff004830 + i, {
  profileId, name: ['Walker', 'Rider', 'Guest', 'Guide'][i], cell: WORLD,
  pos: [20000, -3000, 0], inventory: { entries: [{ baseId: 0xf, count: 100 }] }
}));
const [WALKER, RIDER, GUEST, GUIDE] = people;
yes('the actual gamemode loads', w.boot());
if (!w.loaded()) { t.done(w); }
people.forEach(w.arrive);
w.run(30000);
const stuck = w.box().__thornswoodStuck;
const key = actor => (actor >>> 0).toString(16);
function seed(actor, cell, pos) {
  delete stuck.state.chars[key(actor)];
  delete stuck.state.used[key(actor)];
  w.moveTo(actor, cell, pos);
  stuck.trailTick();
  w.moveTo(actor, cell, [pos[0] + 500, pos[1], pos[2]]);
  stuck.trailTick();
}
function here(actor) {
  const row = w.row(actor);
  return { desc: row.worldOrCellDesc, pos: row.pos.slice() };
}
function trail(actor) { return stuck.state.chars[key(actor)].trail; }

// Death and respawn are separate events. There may be no sample between them.
seed(WALKER, WORLD, [20000, -3000, 0]);
yes('ordinary recent walking provides an escape point', !!stuck.backSpot(WALKER, here(WALKER)));
w.die(WALKER, 0, null);
yes('death immediately discards the previous journey', trail(WALKER).length === 0);
w.respawn(WALKER);
yes('respawn has no old escape point before the next sampling tick', stuck.backSpot(WALKER, here(WALKER)) === null);
stuck.command(101, WALKER, w.now());
yes('an escape after respawn cannot return to the death location', w.row(WALKER).worldOrCellDesc !== WORLD);

// A paid carriage uses the actual ride transaction and its fare.
const carriages = w.box().__thornswoodCarriages;
const start = carriages.stopByKey('carriage:whiterun');
const finish = carriages.stopByKey('carriage:solitude');
w.ref(0xff304830, { base: start.base, type: 'NPC_', cell: start.world, pos: start.pos.slice() });
seed(RIDER, start.world, [start.pos[0] - 500, start.pos[1], start.pos[2]]);
const ride = carriages.ride(RIDER, 102, 'Solitude');
yes('the actual carriage journey succeeds and takes the fare', ride.went && w.count(RIDER, 0xf) === 80);
yes('the carriage starts a new trail immediately', trail(RIDER).length === 0 && stuck.backSpot(RIDER, here(RIDER)) === null);
stuck.command(102, RIDER, w.now());
yes('escape cannot undo the paid carriage trip', w.row(RIDER).worldOrCellDesc !== start.world ||
  Math.hypot(w.row(RIDER).pos[0] - start.pos[0], w.row(RIDER).pos[1] - start.pos[1]) > 1000);

// Staff bring/goto and both forms of teleport must reset the mover's trail.
for (const command of ['/bring Guest', '/tp Guest solitude', '/goto Guest', '/tp whiterun']) {
  const moved = /Guest/.test(command) && !command.startsWith('/goto') ? GUEST : GUIDE;
  seed(moved, WORLD, [20000, -3000, 0]);
  if (moved === GUEST) w.moveTo(GUIDE, finish.world, finish.pos.slice());
  else w.moveTo(GUEST, finish.world, finish.pos.slice());
  w.say(GUIDE, command);
  yes(command + ' succeeds before checking the escape history',
    !/not yours|did not work|Nobody|cannot/.test(w.heard(GUIDE).at(-1) || '') &&
    Math.hypot(w.row(moved).pos[0] - 20500, w.row(moved).pos[1] + 3000) > 1000);
  yes(command + ' discards the mover\'s old steps', stuck.backSpot(moved, here(moved)) === null &&
    trail(moved).every(point => Math.hypot(point.pos[0] - 20500, point.pos[1] + 3000) > 1000));
}

// A short trail is bounded in time as well as in number of points.
seed(WALKER, WORLD, [20000, -3000, 0]);
w.run(59999);
yes('a recent step remains available just before one minute', !!stuck.backSpot(WALKER, here(WALKER)));
w.run(1);
yes('a step expires at one minute exactly', stuck.backSpot(WALKER, here(WALKER)) === null);
yes('stale steps cannot choose a temple using an old journey on another map',
  stuck.mapSpot(WALKER, { desc: 'unknown:Interior.esp', pos: [0, 0, 0] }) === null);
w.moveTo(WALKER, WORLD, [21100, -3000, 0]);
stuck.trailTick();
w.moveTo(WALKER, WORLD, [21600, -3000, 0]);
stuck.trailTick();
yes('new walking after the old trail expires provides a recent point', !!stuck.backSpot(WALKER, here(WALKER)));

// Clearing a journey must not create another use during an existing cooldown.
const before = { at: w.now(), from: here(WALKER), to: here(WALKER) };
stuck.state.used[key(WALKER)] = before;
w.say(GUIDE, '/bring Walker');
stuck.command(101, WALKER, w.now());
yes('a staff move preserves the character\'s cooldown', /once every 5 minutes/.test(w.heard(WALKER).at(-1) || ''));
yes('the staff move does not change when the cooldown began', stuck.state.used[key(WALKER)].at === before.at);
t.done(w);
