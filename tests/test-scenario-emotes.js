'use strict';
/*
  test-scenario-emotes.js

  Scenario: systems/emotes.md

  #5198. What the emote wheel means to the server, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. The wheel
  itself, its slots, its search and the name above the head are the game's
  side (thornswood-emotes.js, tests/test-emote-input-animation.js). What the
  server sees is the animation the client sent for its own character, which
  the engine keeps as lastAnimEvent until they move, and nothing typed: Sit
  is a seat on the ground, and the lute, the flute, the drum and Sing are a
  bard to everybody resting in the same place.

  Aldis and Corvin are tired. Brenna plays, and has no lute until she is
  handed one.

    A  Aldis plays Sit: within a measure she is resting, sitting, with
       nothing pressed or typed. Corvin plays Sit by a fire: he is resting
       by a fire.
    B  Sitting, Aldis's rest climbs at the seat's 20 an hour, less the
       drain; half an hour later, the same.
    C  Brenna plays the Lute with no lute in her pack: no music, and Aldis's
       rest climbs as before. With a lute in her pack the same emote is a
       bard, and Aldis's rest climbs by the bard's 25 more an hour. Brenna
       playing in another cell is no help to Aldis.
    D  With the lute gone the Lute plays nothing again; Sing needs nothing,
       and the music helps.
    E  Aldis walks off: she is up, without a word. Playing another emote
       stands Corvin up too.
    F  Aldis comes back into the world after leaving sitting: the engine
       keeps no animation over a login, so she comes in up. After a restart
       nobody comes in resting: no wheel idle starts on its own.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-emotes.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'emotes' });
const CITY = '1691d:Skyrim.esm';
const INN = '16bdf:Skyrim.esm';
const LUTE = '1d9b:PlayFluteLuteDrum.esp';
const SIT = 'IdleSitCrossLeggedEnter', PLAY_LUTE = 'IdleLuteStart', SING = 'IdleDialogueHappyStart', WAVE = 'IdleWave';
w.record(LUTE, 'WEAP', { editorId: 'LuteWeapon' });
const id = w.idOf;
function at(n) { return [2000 + 60 * n, 0, 0]; }

const BRENNA = w.person(0xff000e00, { profileId: 1000, name: 'Brenna', prof: 'cook', cell: CITY, pos: at(0) });
const ALDIS = w.person(0xff000e01, { profileId: 1001, name: 'Aldis', prof: 'tailor', cell: CITY, pos: at(1) });
const CORVIN = w.person(0xff000e02, { profileId: 1002, name: 'Corvin', prof: 'smith', cell: CITY, pos: at(2) });
const ALL = [BRENNA, ALDIS, CORVIN];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 30, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.say(BRENNA, '/place indoors - 0 1 0 -');
w.say(ALDIS, '/place indoors - 0 1 0 -');
w.say(CORVIN, '/place indoors - 0 1 0 120');
w.run(30000);
const N = () => w.box().__thornswoodNeeds;
function m(a) { return N().read(a) || {}; }
function near(x, want, slack) { return typeof x === 'number' && Math.abs(x - want) <= slack; }
function f1(x) { return typeof x === 'number' ? x.toFixed(2) : String(x); }
/* How much rest a changed over the next half hour, by the hour. */
function restRate(a) {
  const r0 = m(a).rest, t0 = w.now();
  w.run(30 * 60 * 1000);
  return (m(a).rest - r0) / ((w.now() - t0) / 3600000);
}

// ------------------------------------------------------------- A. sit --
let heardAt = w.heard(ALDIS).length;
w.animate(ALDIS, SIT);
w.animate(CORVIN, SIT);
w.run(6000);
yes('A1 Aldis plays Sit: she is resting, sitting, with nothing typed (' + m(ALDIS).resting + ')', m(ALDIS).resting === 'sit');
yes('A2 Corvin plays Sit by a fire: he is resting by it (' + m(CORVIN).resting + ')', m(CORVIN).resting === 'campfire');

// ----------------------------------------------------------- B. the seat --
const plain = restRate(ALDIS);
yes('B1 sitting, Aldis\'s rest climbs at the seat\'s 20 an hour less the 12.5 drain (' + f1(plain) + ' an hour)', near(plain, 20 - 12.5, 0.3));
const plain2 = restRate(ALDIS);
yes('B2 and a half hour later, the same: the measure keeps her sitting (' + f1(plain2) + ')', near(plain2, plain, 0.3) && m(ALDIS).resting === 'sit');

// ------------------------------------------------------------ C. the lute --
w.animate(BRENNA, PLAY_LUTE);
const noLute = restRate(ALDIS);
yes('C1 Brenna plays the Lute with no lute in her pack: no music, the same rate (' + f1(noLute) + ')', near(noLute, plain, 0.3));
w.give(BRENNA, id(LUTE), 1);
w.animate(BRENNA, PLAY_LUTE);
const withLute = restRate(ALDIS);
yes('C2 with a lute in her pack it is a bard: Aldis\'s rest climbs the bard\'s 25 more an hour (' + f1(withLute) + ')', near(withLute, plain + 25, 1));
w.moveTo(BRENNA, INN, [0, 0, 0]);
w.animate(BRENNA, PLAY_LUTE);
w.run(6 * 60 * 1000);   // past the five minutes a bard counts for after the last tick that saw them
const away = restRate(ALDIS);
yes('C3 Brenna playing in another cell is no help to Aldis (' + f1(away) + ')', near(away, plain, 0.3));

// ------------------------------------------------------------ D. Sing --
w.moveTo(BRENNA, CITY, at(0));
w.give(BRENNA, id(LUTE), -1);
w.animate(BRENNA, PLAY_LUTE);
w.run(6 * 60 * 1000);
const gone = restRate(ALDIS);
yes('D1 lute gone, the Lute plays nothing again (' + f1(gone) + ')', near(gone, plain, 0.3));
w.animate(BRENNA, SING);
const sung = restRate(ALDIS);
yes('D2 Sing needs nothing, and it is a bard (' + f1(sung) + ')', near(sung, plain + 25, 1));

// ------------------------------------------------------- E. standing up --
heardAt = w.heard(ALDIS).length;
w.moveTo(ALDIS, CITY, at(5));
w.run(6000);
yes('E1 Aldis walks off: she is up (' + JSON.stringify(m(ALDIS).resting) + ')', !m(ALDIS).resting);
yes('E1 without a word (' + w.heardSince(ALDIS, heardAt).join(' | ') + ')',
    !w.heardSince(ALDIS, heardAt).some(function (l) { return /rest|seat|sit/i.test(l); }));
w.animate(CORVIN, WAVE);
w.run(6000);
yes('E2 Corvin plays another emote, and that stands him up (' + JSON.stringify(m(CORVIN).resting) + ')', !m(CORVIN).resting);

// ------------------------------------------------- F. back into the world --
w.animate(ALDIS, SIT);
w.run(6000);
yes('F1 Aldis sits down again', m(ALDIS).resting === 'sit');
w.leave(ALDIS);
w.run(60000);
w.arrive(ALDIS);
w.run(30000);
yes('F1 and comes back in up after leaving sitting: no animation is kept over a login (' + JSON.stringify(m(ALDIS).resting) + ')',
    !m(ALDIS).resting && !w.prop(ALDIS, 'lastAnimEvent'));
const r = w.restart();
yes('F2 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
yes('F2 and nobody comes back in resting: no wheel idle starts on its own (' + ALL.map(function (a) { return JSON.stringify(m(a).resting); }).join(' ') + ')',
    ALL.every(function (a) { return !m(a).resting; }));

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
