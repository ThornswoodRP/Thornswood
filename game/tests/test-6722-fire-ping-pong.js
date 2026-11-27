'use strict';
// #6722: two people standing together at a fire. One walks into the coals for
// a few seconds and out again; nobody stands in the coals after that. The fire
// spreads to the other, and must then go out: a fire caught from somebody is
// never caught back by them. Before the fix the two set each other alight in
// turn for as long as they stood together, 7 health a second each, until both
// died. The whole gamemode under the stand-in server, with each client's
// burning clock acted by a small model of the front's (thornswood-front.js,
// "burning, and catching"): 1.5 s after leaving the coals, ms after a catch,
// /burn 1 every 3 s while alight and /burn 0 once out.
const standIn = require('../../tests/stand-in-server');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '6722-fire-ping-pong', settings: { thornswoodServer: 'main' } });
const a = w.person(0xff006722, { profileId: 6722, name: 'Brenna', pos: [0, 0, 0] });
const b = w.person(0xff006723, { profileId: 6723, name: 'Corvin', pos: [100, 0, 0] });
const c = w.person(0xff006724, { profileId: 6724, name: 'Dagny', pos: [0, 100, 0] });
yes('the whole gamemode loads', w.boot());
if (w.loaded()) {
  w.arrive(a); w.arrive(b); w.arrive(c); w.run(30000);

  // One client's burning clock, the front's in small.
  function client(id) {
    return { id, until: 0, told: false, saidAt: 0, seenAt: 0, burntMs: 0 };
  }
  const people = [client(a), client(b), client(c)];
  function tick(p, inCoals) {
    const now = w.now();
    const v = w.prop(p.id, 'thornswoodBurn');
    if (v && v.at && v.at !== p.seenAt) { p.seenAt = v.at; p.until = Math.max(p.until, now + (Number(v.ms) || 5000)); }
    if (inCoals) { p.until = Math.max(p.until, now + 1500); }
    if (p.until > now) {
      p.burntMs += 1000;
      if (!p.told) { p.told = true; }
      if (now - p.saidAt >= 3000) { p.saidAt = now; w.say(p.id, '/burn 1'); }
      return;
    }
    if (p.told) { p.told = false; p.saidAt = 0; w.say(p.id, '/burn 0'); }
  }
  function play(seconds, coals) {
    for (let s = 0; s < seconds; s++) {
      for (const p of people) { tick(p, coals.indexOf(p.id) >= 0); }
      w.run(1000);
    }
  }

  // Two together: Brenna steps into the coals for 4 seconds, then out.
  people[2].off = true;
  const two = people.slice(0, 2);
  function playTwo(seconds, coals) {
    for (let s = 0; s < seconds; s++) {
      for (const p of two) { tick(p, coals.indexOf(p.id) >= 0); }
      w.run(1000);
    }
  }
  playTwo(4, [a]);
  yes('the fire spread from the one in the coals to the one beside her', two[1].burntMs > 0);
  playTwo(60, []);
  const after = [two[0].burntMs, two[1].burntMs];
  playTwo(60, []);
  yes('a minute later neither is burning any more (Brenna ' + after[0] + ' ms, Corvin ' + after[1] + ' ms)',
    two[0].burntMs === after[0] && two[1].burntMs === after[1]);
  yes('Brenna burnt only for her own fire, not again from Corvin (' + two[0].burntMs + ' ms)', two[0].burntMs <= 6000);
  yes('Corvin burnt for one catch, not for one after another (' + two[1].burntMs + ' ms)', two[1].burntMs <= 7000);

  // Somebody standing next to a person who stays in the coals keeps catching:
  // the fire is still there, so standing beside it is still worse.
  const before = two[1].burntMs;
  playTwo(20, [a]);
  yes('beside somebody still in the coals, the catch comes again (' + (two[1].burntMs - before) + ' ms in 20 s)',
    two[1].burntMs - before >= 8000);
  playTwo(60, []);

  // Three together: the fire passes through each of them once and goes out.
  people.forEach(p => { p.burntMs = 0; });
  play(4, [a]);
  play(90, []);
  const three = people.map(p => p.burntMs);
  play(60, []);
  yes('three together: the fire goes out (' + three.join(', ') + ' ms)',
    people.every((p, i) => p.burntMs === three[i]));
  yes('three together: nobody burns for more than their own fire and two catches',
    people.every(p => p.burntMs <= 13000));

  // A new fire is a new fire: walking back into the coals can set the same
  // neighbour alight again.
  const again = people[1].burntMs;
  play(4, [a]);
  play(10, []);
  yes('a second walk into the coals is a new fire that can spread again', people[1].burntMs > again);
}
t.done();
