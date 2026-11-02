// test-seats.js
//
//     node .\tests\test-seats.js
//
// At most 25 people in the world at once, 5 staff seats over it that only the
// Discord staff roles may take, and a line at the game's menu past that
// (#481). Patrick, 28 Sep: cap it at 25 for the alpha. 29 Sep: "5 staff seats
// for now and only allow those seats to be filled by the discord roles, we
// need a queue system as well that lets them in the main menu if full but
// they sit there until a slot is free and it's their turn to join", and "I
// still want it to say N of 25 anyway".
//
// THE GAME SERVER. The seats block is lifted out of game\gamemode.js between
// its markers and run in a vm with a stand-in mp and its own clock, the way
// test-join-pass-game.js runs the join pass block. The line: the 26th and
// 27th wait in order, a seat frees and the first in line is told to come in
// and is seated, one who goes quiet is dropped after the grace, a staff role
// skips the line, and nothing a client sends moves it forward. The staff
// seats: only the Discord staff role (staffRoleProfiles), never the written
// admin or dev lists, and 5 of them.
//
// THE MENU. The chat's relay hands the server's line messages to the page and
// never draws them; the page and the front plugin are checked for the steps
// that carry the line.
//
// THE SITE. /api/play/join no longer refuses a full world: it lets them in
// and says there may be a wait. /api/allowed sends the staff role holders.
// /api/public and the home page say N of 30 with or without a number from the
// server: every seat, the staff seats too (Patrick, 12 Oct: "the real cap is
// 30 but 25 for people with non staff roles I still want it to say of 30
// awake tho"), and full still comes at 25 for anybody without a staff role.
//
// Read only. Nothing connects to anything.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const siteFiles = require('./site-files');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const src = read('game/gamemode.js');
const site = siteFiles.source();
// The home page's script, out of home.html since #1479.
const home = read('site/public/home.js');
const chatJs = read('game/ui/thornswood-chat.js');
const page = read('game/ui/thornswood-select.js');
const front = read('game/plugins/thornswood-front.js');
const doorCs = read('launcher/app/Door.cs');
const onlineCs = read('launcher/app/Online.cs');
const configCs = read('launcher/app/Config.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
const EM = String.fromCharCode(0x2014);
const FORBIDDEN = new RegExp('pla' + 'yer', 'i');
function clean(s) { return String(s).indexOf(EM) < 0 && !FORBIDDEN.test(String(s)); }

// ------------------------------------------------------------ the number
const record = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'most-online.json'), 'utf8').replace(/^﻿/, ''));
yes('records\\most-online.json says 25 people', record.people === 25);
yes('and 5 staff seats over it (Patrick, 29 Sep)', record.staffSeats === 5);
yes('dev has its own: 5 people, no staff seats over them, voice 5 (Patrick, 12 Oct)',
    !!record.dev && record.dev.people === 5 && record.dev.staffSeats === 0 && record.dev.voice === 5);

// ------------------------------------------------------------ the launcher
// "N of M awake": M is the server's own max, else this build's feed's
// maxOnline, and never the other channel's (main 30 and dev 5 since 12 Oct).
yes('the launcher shows N of M awake from the count and the max it has',
    /if \(c\.Known\) return c\.Now \+ \(c\.Max > 0 \? " of " \+ c\.Max : ""\) \+ " awake";/.test(onlineCs));
yes('its own server falls back to its own feed\'s number',
    /Count got = AskPort\(cfg, SkyMp\.ResourcePortFor\(cfg\), cfg != null && cfg\.MaxOnline > 0 \? cfg\.MaxOnline : 0\);/.test(onlineCs));
yes('the other build\'s server has no fallback, only the number it announces',
    /return AskPort\(cfg, other, 0\);/.test(onlineCs) && /got\.Max = fallbackMax;/.test(onlineCs) &&
    /"\\"max\\"\\\\s\*:\\\\s\*\(\\\\d\+\)"/.test(onlineCs));
yes('and no seat count is built into the launcher', /\[JsonInclude\] public int MaxOnline = 0;/.test(configCs));

// ------------------------------------------------------------ the block
const a = src.indexOf('// ==== thornswood seats ====');
const b = src.indexOf('// ==== end thornswood seats ====');
yes('the seats block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) done();
const block = src.slice(a, b);
yes('the seats block comes after the join pass block, whose passes it reads',
    src.indexOf('// ==== end thornswood join pass ====') >= 0 && src.indexOf('// ==== end thornswood join pass ====') < a);
yes('the staff seats ask the Discord staff role (__thornswoodHoldsStaffRole) and nothing else',
    /__thornswoodHoldsStaffRole/.test(block) &&
    !/__thornswoodIs(Staff|Dev|Admin)|thornswoodAdmins|thornswoodDevs|isStaff\(|isDev\(|isAdmin\(/.test(
      block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
yes('the door reads staffRoleProfiles out of allowed.json and hands it on',
    /doc\.staffRoleProfiles/.test(src) && /\.__thornswoodHoldsStaffRole = function \(profileId\)/.test(src) &&
    /l\.staffRoleIds\[Number\(profileId\)\]/.test(src));
yes('the door writes it into allowed.json, and keeps it for a profile Discord could not be asked about',
    /staffRoleProfiles: Array\.isArray\(doc\.staffRoleProfiles\) \? doc\.staffRoleProfiles : \[\]/.test(src) &&
    /staffRoleProfiles: merged\(doc\.staffRoleProfiles, had\.staffRoleProfiles\)/.test(src) &&
    /doc\.staffRoleProfiles = kept\.staffRoleProfiles;/.test(src));
// The chat block publishes isStaff again since #2551, for the property block's staff at any door; the seats keep to the role.
yes('the seats block no longer borrows the chat commands staff check',
    !/__thornswoodIsStaff/.test(block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
yes('the online count file carries max, how many wait, and whether it is full',
    /restarting: restarting, max: max, line: line, full: full/.test(src));
yes('and max is every seat, the number and the staff seats over it, from the seats block',
    /var capNow = seatsApi \? seatsApi\.cap\(settingsNow\) : 0;\s*max = capNow \? capNow \+ seatsApi\.staffSeats\(settingsNow\) : 0;/.test(src) &&
    !/max = Number\(\(mp\.getServerSettings\(\) \|\| \{\}\)\.thornswoodMostOnline\)/.test(src));
yes('dispatch() takes /line, /line leave and /line hand from the relay, with no character needed',
    /if \(word === '\/line'\) \{[\s\S]{0,500}seatsApi\.leave\(profileId, seatsApi\.liveHow\(\)\)[\s\S]{0,400}seatsApi\.hand\(profileId, Number\(parts\[2\]\) \|\| 0, Date\.now\(\), seatsApi\.liveHow\(\)\)[\s\S]{0,200}seatsApi\.want\(profileId, Date\.now\(\), seatsApi\.liveHow\(\)\)/.test(src));
yes('and /line gone only when the relay itself marked it (cmd.relay), so no person can drop a place with it',
    /else if \(sub === 'gone'\) \{ if \(cmd\.relay === true\) \{ seatsApi\.gone\(profileId, Date\.now\(\), seatsApi\.liveHow\(\)\); \} \}/.test(src));
yes('the command poll reads the relay boot stamp, and a new one tells the line the relay restarted',
    /doc = JSON\.parse\(body\) \|\| \{\}; list = doc\.commands \|\| \[\];/.test(src) && /relayBoot\(doc\.boot\);/.test(src) &&
    /if \(!was \|\| was === boot\) \{ return; \}[\s\S]{0,300}seatsApi\.relayRestarted\(Date\.now\(\), seatsApi\.liveHow\(\)\)/.test(src));
yes('the 45 second check-in rule is gone', !/LINE_GRACE_MS/.test(src));
yes('the place goes back to the menu as data under the name the page looks for',
    /var LINE_NAME = 'Thornswood line';/.test(src) &&
    /g\.__thornswoodSayLine = function \(profileId, what\) \{\s*post\('\/say', \{ profileId: profileId, name: LINE_NAME, text: JSON\.stringify\(what \|\| \{\}\) \}\);/.test(src));

const ACTOR = 0xff000000;
function rig(settings, keep) {
  const r = { told: [], lines: [], logged: [], kicked: [], timers: [], online: [], staff: {}, now: 1000000 };
  const box = keep || {};
  box.console = { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } };
  box.Date = { now: function () { return r.now; } };
  box.Math = Math; box.Number = Number; box.String = String; box.Object = Object; box.Array = Array;
  box.setTimeout = function (fn) { r.timers.push(fn); return r.timers.length; };
  box.setInterval = function (fn) { r.interval = fn; return 1; };
  box.clearInterval = function () { };
  box.mp = {
    getServerSettings: function () { return settings; },
    getUserByActor: function (actorId) {
      for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === actorId) { return actorId - ACTOR; } }
      return -1;
    },
    get: function (id, what) {
      if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
      for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === id) { return r.online[i].profileId; } }
      throw new Error('no such actor');
    },
    kick: function (userId) { r.kicked.push(userId); }
  };
  box.__thornswoodToProfile = function (p, text) { r.told.push({ p: p, text: text }); };
  box.__thornswoodSayLine = function (p, what) { r.lines.push({ p: p, what: JSON.parse(JSON.stringify(what)) }); };
  box.__thornswoodHoldsStaffRole = function (p) { return !!r.staff[p]; };
  // The relay poll, as the chat commands block keeps it (pollSaid).
  if (!box.__thornswoodCommandPoll) { box.__thornswoodCommandPoll = { okAt: 0, failAt: 0 }; }
  // The written lists, which must NOT open a staff seat: true for everybody.
  box.__thornswoodIsStaff = function () { return true; };
  box.__thornswoodIsDev = function () { return true; };
  box.__thornswoodIsAdmin = function () { return true; };
  if (!box.__thornswoodPassSeen) { box.__thornswoodPassSeen = { passes: {}, online: {}, said: {} }; }
  if (!keep) { vm.createContext(box); }
  vm.runInContext(block, box);
  r.box = box;
  r.api = function () { return box.__thornswoodSeats; };
  r.tick = function (ms) { r.now += (ms || 2000); r.interval(); };
  r.join = function (pid) { r.online.push({ actorId: ACTOR + pid, profileId: pid }); };
  r.leave = function (pid) { r.online = r.online.filter(function (o) { return o.profileId !== pid; }); };
  r.pass = function (pid) { box.__thornswoodPassSeen.passes[pid] = { at: r.now, x: r.now + 600000, v: '1.1.102', d: '1' + pid }; };
  r.want = function (pid) { return r.api().want(pid, r.now, r.api().liveHow()); };
  r.quit = function (pid) { return r.api().leave(pid, r.api().liveHow()); };
  r.gone = function (pid) { return r.api().gone(pid, r.now, r.api().liveHow()); };
  r.hand = function (pid, to) { return r.api().hand(pid, to, r.now, r.api().liveHow()); };
  r.relayDown = function () { box.__thornswoodCommandPoll.failAt = r.now; };
  r.relayUp = function () { box.__thornswoodCommandPoll.okAt = r.now; };
  r.relayRestarted = function () { return r.api().relayRestarted(r.now, r.api().liveHow()); };
  r.runTimers = function () { const t = r.timers; r.timers = []; t.forEach(function (fn) { fn(); }); };
  r.saidTo = function (pid) { return r.told.filter(function (t) { return t.p === pid; }); };
  r.linesTo = function (pid) { return r.lines.filter(function (t) { return t.p === pid; }).map(function (t) { return t.what; }); };
  r.lastLine = function (pid) { const l = r.linesTo(pid); return l.length ? l[l.length - 1] : null; };
  r.log = function () { return r.logged.join('\n'); };
  r.fill = function (from, n) { for (let p = 0; p < n; p++) { r.join(from + p); } r.tick(); };
  return r;
}

const SEATS = { thornswoodMostOnline: 25, maxPlayers: 30 };
let r = rig(SEATS);
yes('it says at startup how many the world holds, the staff seats and the line',
    /seats: at most 25 in the world at once, 5 staff seats over it for the Discord staff roles, and a line at the menu past that/.test(r.log()));
r.tick();
const api = r.api();
yes('it hands its sweep, line and sentence to the rest of the file',
    !!(api && api.sweep && api.want && api.leave && api.sentence && api.status));
yes('the staff seats are the engine slots over the number: 30 - 25 = 5',
    api.staffSeats(SEATS) === 5 && api.staffSeats({ thornswoodMostOnline: 25, maxPlayers: 20 }) === 0 &&
    api.staffSeats({ maxPlayers: 30 }) === 0);
const SENTENCE = api.sentence(25);
yes("the sentence for somebody who came in past the line says so and says how to wait ('" + SENTENCE + "')",
    /full/.test(SENTENCE) && /25 people/.test(SENTENCE) && /place in line/.test(SENTENCE));
yes('the sentence has no em dash and never the word the house rules forbid', clean(SENTENCE));
yes('no check-in: only a long backstop (10 minutes) for a close that never arrives, far past the menu own ask',
    api.lineGrace === undefined && api.lineSilent === 600000 && api.lineEvery === 10000 && api.lineSilent >= 60 * api.lineEvery);
yes('after a relay restart each menu has a minute to ask again, longer than the chat takes to come back (30 s at most)',
    api.relayBack === 60000);

// ---- 25 seated, the 26th and 27th wait in order
for (let p = 1; p <= 25; p++) { r.join(100 + p); r.tick(); }
yes('the first 25 are all seated, nobody told anything', r.told.length === 0 && r.kicked.length === 0);
yes('the world now reads full to somebody picking', api.status().full === true && api.status().line === 0);
yes('the 26th asks from the menu and is put in line', r.want(126) === 'joined' &&
    /line: profile 126 is waiting at the menu, 1 in line/.test(r.log()));
r.tick(1000);
yes('the 27th asks and is put behind', r.want(127) === 'joined');
r.tick();
yes('the 26th is told they are 1st in line', JSON.stringify(r.lastLine(126)) === JSON.stringify({ place: 1, of: 2 }));
yes('the 27th is told they are 2nd', JSON.stringify(r.lastLine(127)) === JSON.stringify({ place: 2, of: 2 }));
yes('online.json would say 2 waiting, full', api.status().line === 2 && api.status().full === true);
const before = r.lines.length;
r.tick();
yes('a place that has not moved is not said again every sweep', r.lines.length === before);
r.tick(10000); r.want(126); r.want(127); r.tick();
yes('it is said again now and then, so a lost message is not a lost place',
    r.linesTo(126).length >= 2 && r.lastLine(126).place === 1);

// ---- a client cannot jump the line
yes('asking again does not move anybody', r.want(127) === 'waiting' && r.want(127) === 'waiting');
r.tick();
yes('the 27th is still 2nd after asking again and again', r.lastLine(127).place === 2);
r.want(128); r.tick();
yes('a later ask goes to the back: 3rd', r.lastLine(128).place === 3);
yes('those ahead are told the new count at once, not after ten seconds',
    r.lastLine(126).place === 1 && r.lastLine(126).of === 3 && r.lastLine(127).of === 3);
r.join(128); r.tick();
yes('coming into the world past the line is refused with the sentence',
    r.saidTo(128).length === 1 && r.saidTo(128)[0].text === SENTENCE);
yes('and the log says door: full with the line', /door: full, refusing profile 128: 25 of 25 already in the world, 3 waiting in line/.test(r.log()));
r.runTimers();
yes('and that session is ended', r.kicked.indexOf(128) >= 0);
// The client connects again by itself, and the same character is the same actor:
// back between two sweeps, it never looked gone.
r.tick(r.api().outFor + 1000); r.tick();
yes('back in so fast the server never saw them go, they are refused again, not let stay',
    r.saidTo(128).length === 2 && r.timers.length === 1);
r.runTimers();
r.leave(128); r.quit(128); r.tick();

// ---- a seat frees: the first in line is told to come in and seated
r.leave(101); r.tick();
yes('a seat frees and the first in line is told it is their turn', !!r.lastLine(126) && r.lastLine(126).go === true &&
    /seats: a seat is held for profile 126, first in line/.test(r.log()));
yes('the next in line moves up to 1st', r.lastLine(127).place === 1);
r.join(127); r.tick();
yes('the 2nd in line cannot take the seat held for the 1st', r.saidTo(127).length === 1 &&
    /door: full, refusing profile 127/.test(r.log()));
r.runTimers(); r.leave(127);
r.want(127); r.tick();
r.join(126); r.tick();
yes('the 1st in line arrives and takes the seat held for them', r.saidTo(126).length === 0 &&
    /seats: profile 126 took the seat held for them/.test(r.log()));
yes('26 has a seat and 25 are in the world again', r.online.length === 25 && r.kicked.indexOf(126) < 0);
yes('an ask from somebody already in the world does nothing', r.want(126) === 'in the world');

// ---- a place goes the moment its connection closes, with nothing to check in (Patrick, 29 Sep)
r = rig(SEATS); r.tick();
r.fill(200, 25);
r.want(226); r.tick(1000); r.want(227); r.tick(1000); r.want(228); r.tick();
for (let s = 0; s < 6; s++) { r.tick(60000); }
yes('six minutes without a word from anybody waiting: nobody loses their place',
    !/lost their place/.test(r.log()) && r.api().status().line === 3 && r.lastLine(228).place === 3);
yes('the relay says the connection closed: the place goes at once', r.gone(227) === 'dropped' &&
    /line: profile 227 lost their place: their game closed its connection to the relay/.test(r.log()));
r.tick();
yes('and whoever was behind them moves up straight away', r.lastLine(228).place === 2 && r.lastLine(228).of === 2);
yes('a close from somebody not waiting changes nothing', r.gone(999) === 'not waiting' && r.api().status().line === 2);
r.quit(226); r.tick();
yes('/line leave gives the place up at once', /line: profile 226 left the line/.test(r.log()) && r.lastLine(228).place === 1);

// ---- the backstop: a close that never arrives
r = rig(SEATS); r.tick();
r.fill(1300, 25);
r.want(1326); r.tick(1000); r.want(1327); r.tick();
for (let s = 0; s < 9; s++) { r.tick(60000); r.want(1326); }
yes('nine minutes on, a menu that went silent still has its place (the backstop is 10 minutes)',
    !/profile 1327 lost/.test(r.log()));
r.tick(60000); r.want(1326); r.tick(2000);
yes('silent past 10 minutes while the relay answers, the place goes, and the log says why',
    /line: profile 1327 lost their place: nothing from their menu in 10 minutes, and the relay never said their game closed/.test(r.log()) &&
    !/profile 1326 lost/.test(r.log()));
r.want(1328); r.tick(2000);
r.relayDown();
for (let s = 0; s < 15; s++) { r.tick(60000); }
yes('while the relay does not answer at all, nobody silent for 15 minutes is dropped',
    !/profile 1328 lost/.test(r.log()) && !/profile 1326 lost/.test(r.log()) && r.api().status().line === 2);
r.relayUp(); r.tick(2000);
yes('and when it answers again they still have their places', r.api().status().line === 2);

// ---- a relay restart keeps the line
r = rig(SEATS); r.tick();
r.fill(1400, 25);
r.want(1426); r.tick(1000); r.want(1427); r.tick(1000); r.want(1428); r.tick();
yes('a relay restart gives the three waiting a minute to ask again, and says so',
    r.relayRestarted() === 3 && /the relay restarted; the 3 waiting keep their places if their menus ask again within 60s/.test(r.log()));
r.tick(20000); r.want(1428); r.tick(20000); r.want(1426); r.tick(10000);
yes('those whose menus ask again within the minute keep their places, in the same order',
    r.lastLine(1426).place === 1 && !/profile 1426 lost/.test(r.log()) && !/profile 1428 lost/.test(r.log()));
r.tick(15000);
yes('the one that did not come back after the restart loses its place, and the log says why',
    /line: profile 1427 lost their place: the relay restarted and their menu did not ask again within 60s/.test(r.log()));
r.tick();
yes('and the one behind it moves up: 2nd of 2', r.lastLine(1428).place === 2 && r.lastLine(1428).of === 2);
r.tick(9 * 60000); r.want(1426);
r.tick(2 * 60000); r.tick();
yes('after a restart the ordinary backstop applies again', /profile 1428 lost their place: nothing from their menu/.test(r.log()));

// ---- a place handed to another of the same game's characters
r = rig(SEATS); r.tick();
r.fill(1500, 25);
r.want(1526); r.tick(1000); r.want(1527); r.tick(1000); r.want(1528); r.tick();
yes('the holder hands its place to another character', r.hand(1527, 1599) === 'handing' &&
    /line: profile 1527 hands its place in line to profile 1599/.test(r.log()));
yes('its connection closing then keeps the place for that character', r.gone(1527) === 'handed' && r.api().status().line === 3);
r.tick(5000);
yes('the other character asks and takes the place, still 2nd', r.want(1599) === 'handed' &&
    /line: profile 1599 takes the place profile 1527 handed it, 2 of 3/.test(r.log()));
r.tick();
yes('and is told it is 2nd of 3', r.lastLine(1599).place === 2 && r.lastLine(1599).of === 3);
yes('nobody else can take a place that was not handed to them', (function () {
  r.want(1590); r.tick(); return r.lastLine(1590).place === 4;
})());
r.hand(1528, 1598); r.gone(1528);
r.tick(r.api().handFor + 1000);
yes('a place handed on and never taken goes once the holder has closed',
    /profile 1528 lost their place: their game closed after handing it to profile 1598, who never asked for it/.test(r.log()));
r.hand(1526, 1597); r.tick(r.api().handFor + 1000);
yes('a hand never taken while the holder is still there leaves it with the holder',
    /profile 1597 never asked for the place profile 1526 handed it, so profile 1526 keeps it/.test(r.log()) &&
    r.lastLine(1526).place === 1);
yes('a place cannot be handed to itself or to nobody', r.hand(1526, 1526) === 'nothing' && r.hand(1526, 0) === 'nothing');
r.leave(1500); r.tick();
yes('a held seat can be handed too', r.lastLine(1526).go === true && r.hand(1526, 1596) === 'handing' &&
    r.want(1596) === 'held' && r.lastLine(1596).go === true && r.lastLine(1596).secs <= 60);
r.join(1596); r.tick();
yes('and the one it was handed to arrives and is seated', /profile 1596 took the seat held for them/.test(r.log()) &&
    r.saidTo(1596).length === 0);

// ---- a held seat nobody takes goes to the next
r = rig(SEATS); r.tick();
r.fill(300, 25);
r.want(326); r.tick(1000); r.want(327); r.tick();
r.leave(300); r.tick();
yes('the seat is held for the first, with the 60 seconds to press Join now', r.lastLine(326).go === true && r.lastLine(326).secs === 60);
for (let s = 0; s < 5; s++) { r.tick(10000); r.want(327); }
yes('a held seat is still held just under a minute on',
    !/the seat held for profile 326 went unused/.test(r.log()) && r.lastLine(327).go !== true);
for (let s = 0; s < 2; s++) { r.tick(10000); r.want(327); }
yes('held for a minute and not taken, it goes to the next in line',
    /the seat held for profile 326 went unused for 60s/.test(r.log()) && r.lastLine(327).go === true);
yes('somebody whose seat is held is told again when they ask', (function () {
  const n = r.linesTo(327).length; r.want(327); return r.linesTo(327).length === n + 1 && r.lastLine(327).go === true;
})());

// ---- staff skip the line, and only the Discord staff role, 5 of them
r = rig(SEATS); r.tick();
r.fill(400, 25);
r.want(426); r.tick(1000); r.want(427); r.tick();
r.staff[499] = true; r.pass(499);
r.want(499); r.tick();
yes('a staff role with a pass skips the line into a staff seat', r.lastLine(499).go === true &&
    /seats: a seat is held for profile 499, a staff role, ahead of the line/.test(r.log()));
yes('and nobody in line moves back for it', r.lastLine(426).place === 1 && r.lastLine(427).place === 2);
r.join(499); r.tick();
yes('the staff role arrives and is seated', r.saidTo(499).length === 0 && /profile 499 took the seat held/.test(r.log()));
for (let k = 0; k < 4; k++) { r.staff[480 + k] = true; r.pass(480 + k); r.join(480 + k); }
r.tick();
yes('four more staff roles arriving directly take the other staff seats', r.told.length === 0 &&
    /profile 483 holds a staff role, seated in a staff seat \(30 in the world, the number is 25\)/.test(r.log()));
r.staff[485] = true; r.pass(485); r.join(485); r.tick();
yes('a sixth staff role finds every staff seat taken', r.saidTo(485).length === 1 &&
    /door: full, refusing profile 485: .* \(a staff role, but every staff seat is taken\)/.test(r.log()));
r.want(426); r.want(427);
r.leave(480); r.tick();
yes('a staff member leaving frees a staff seat, not one of the 25: the line waits', r.lastLine(426).go !== true);
r.leave(401); r.tick();
yes('one of the 25 leaving lets the first in line in', r.lastLine(426).go === true);

// The written admin and dev lists open nothing.
r = rig(Object.assign({ thornswoodAdmins: [599], thornswoodDevs: [598] }, SEATS)); r.tick();
r.fill(500, 25);
r.pass(599); r.pass(598);
r.want(599); r.tick(1000); r.want(598); r.tick();
yes('an admin or dev list profile with a pass but no Discord staff role waits in line like anybody',
    r.lastLine(599).place === 1 && r.lastLine(598).place === 2);
r.pass(597); r.join(597); r.tick();
yes('and arriving directly is refused, not seated in a staff seat', r.saidTo(597).length === 1);

// Staff in the world count into the staff seats first.
r = rig(SEATS); r.tick();
for (let k = 0; k < 5; k++) { r.staff[600 + k] = true; }
r.fill(600, 25);
r.want(650); r.tick();
yes('with 5 staff among 25 in the world, 5 of the 25 are still free for anybody',
    r.lastLine(650).go === true && r.api().status().full === false);

// A staff role still waiting on its pass gets the minute (#937).
r = rig(SEATS); r.tick();
r.fill(700, 25);
r.staff[798] = true; r.join(798); r.tick();
yes('a staff role arriving with no pass yet is not refused at once', r.saidTo(798).length === 0);
r.tick(30000); r.pass(798); r.tick();
yes('and is seated once the pass comes in', r.saidTo(798).length === 0 && /profile 798 holds a staff role, seated in a staff seat/.test(r.log()));
r.staff[797] = true; r.join(797); r.tick(); r.tick(r.api().staffWait + 1000);
yes('one that never shows a pass is refused after the wait, and the log says why',
    r.saidTo(797).length === 1 && /refusing profile 797: .* \(a staff role, but no join pass was shown\)/.test(r.log()));

// With a pass required, nobody waits without one. The seats block asks the
// join pass block's one reading of the switch (#1319), stood in for here.
r = rig(Object.assign({ thornswoodRequirePass: true }, SEATS));
r.box.__thornswoodJoinPass = { requiring: function () { return true; } };
r.tick();
r.fill(800, 25);
yes('with thornswoodRequirePass on, an ask with no pass is not placed', r.want(826) === 'no pass' &&
    r.lastLine(826).pass === true && r.api().status().line === 0);
r.pass(826);
yes('and with the pass it is', r.want(826) === 'joined');

// ---- the seats as before
r = rig(SEATS); r.tick();
for (let p = 1; p <= 26; p++) { r.join(900 + p); }
r.tick();
yes('26 arriving in one sweep with nobody waiting: exactly the 26th refused', r.told.length === 1 && r.told[0].p === 926);
r.leave(926); r.leave(901); r.tick();
r.join(926); r.tick();
yes('once somebody leaves and nobody waits, a person coming back straight in is seated', r.saidTo(926).length === 1);

// ---- a hot reload keeps the seats and the line
r = rig(SEATS); r.tick();
r.fill(1000, 25);
r.want(1026); r.tick(1000); r.want(1027); r.tick();
const r2 = rig(SEATS, r.box);
r2.online = r.online.slice(); r2.now = r.now;
r2.tick();
yes('after a hot reload everybody in the world keeps their seat', r2.told.length === 0);
r2.tick(10000); r2.want(1027); r2.want(1026); r2.tick();
yes('and the line keeps its order', r2.lastLine(1026).place === 1 && r2.lastLine(1027).place === 2);

// ---- already over the number when the server starts judging
r = rig(SEATS);
for (let p = 1; p <= 30; p++) { r.join(1100 + p); }
r.tick();
yes('30 already in the world when this starts: all keep their seats', r.told.length === 0 &&
    /30 already in the world keep their seats/.test(r.log()));

// ---- no number, no limit, no line
r = rig({ maxPlayers: 100 });
yes('with no thornswoodMostOnline it says nobody is turned away for numbers',
    /no thornswoodMostOnline in server-settings.json, so nobody is turned away for numbers/.test(r.log()));
r.tick();
for (let p = 1; p <= 40; p++) { r.join(1200 + p); }
r.tick();
yes('and 40 join with nobody refused', r.told.length === 0 && r.kicked.length === 0);
r.want(1299); r.tick();
yes('and an ask from the menu is let straight in', r.lastLine(1299).go === true && r.api().status().full === false);
yes('a number that is not a whole number is no number', rig({ thornswoodMostOnline: '25x' }).api().cap() === 0 &&
    rig({ thornswoodMostOnline: 2.5 }).api().cap() === 0 && rig({ thornswoodMostOnline: 25 }).api().cap() === 25);

// ------------------------------------------------------------ the relay, the page, the front
(function () {
  const got = [];
  const drawn = [];
  let sock = null;
  const win = {
    // The https address the launcher writes; there is no ws:// fallback (#1304).
    THORNSWOOD: { host: 'h', port: 1, profileId: 5, token: 't', base: 'https://h.test/voice' },
    thornswoodChat: { add: function (parts) { drawn.push(parts); } },
    skyrimPlatform: { sendMessage: function () { } }
  };
  const box = { window: win, console: console, JSON: JSON, Number: Number, String: String, Math: Math, Date: Date,
                setTimeout: function () { return 0; }, setInterval: function () { return 0; }, clearTimeout: function () { },
                WebSocket: function () { sock = this; this.readyState = 1; this.send = function () { }; } };
  vm.createContext(box);
  vm.runInContext(chatJs, box);
  win.thornswoodNet.on(function (m) { got.push(m); });
  sock.onopen();
  sock.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
  drawn.length = 0;
  sock.onmessage({ data: JSON.stringify({ t: 'chat', from: 0, profileId: 0, name: 'Thornswood line', text: '{"place":3,"of":5}' }) });
  const line = got.filter(function (m) { return m.t === 'line'; });
  yes('the chat relay hands the server line message to the page as { t: line, place }',
      line.length === 1 && line[0].place === 3 && line[0].of === 5);
  yes('and never draws it in the chat', drawn.length === 0);
  sock.onmessage({ data: JSON.stringify({ t: 'chat', from: 7, profileId: 44, name: 'Thornswood line', text: '{"go":true}' }) });
  yes('a person naming themselves Thornswood line is ordinary chat, never a turn',
      got.filter(function (m) { return m.t === 'line'; }).length === 1 && drawn.length === 1);
})();
yes('the page asks the front for a seat instead of going straight to the client',
    /if \(!cleared\) \{ tell\('want ' \+ picked\); return; \}/.test(page));
yes('the page shows "You are 3rd of 7 in line" from the server place and count',
    /'You are ' \+ ordinal\(Number\(what\.place\)\) \+ ' of ' \+ of \+ ' in line'/.test(page) &&
    /var of = Math\.max\(Number\(what\.of\) \|\| 0, Number\(what\.place\)\);/.test(page) &&
    /return n \+ \(t === 1 \? 'st' : t === 2 \? 'nd' : t === 3 \? 'rd' : 'th'\);/.test(page));
yes('on their turn the page shows Join now with the seconds the server holds the seat',
    /if \(msg\.go\) \{ if \(!turnUntil\) tell\('line: our turn'\); turn\(msg\.secs\); return; \}/.test(page) &&
    /<button class="btn2 turn" type="button">Join now<\/button>/.test(page) && /go: go,\s*line: lineSays/.test(page));
yes('pressing Join now joins; the turn passing puts them back to waiting',
    /tell\('line: joined on our turn'\);\s*go\(\);/.test(page) && /elPlace\.textContent = 'Your turn passed';/.test(page));
yes('the waiting words say there is nothing to do until their turn',
    /You do not need to do anything while you wait/.test(page));
yes('the page keeps its beat while it waits, so the front does not reload it',
    /if \(acked \|\| root\.className === 'gone'\) \{ clearInterval\(beat\); return; \}/.test(page));
yes('the front answers select:want by asking online.json, and waits in line only when it says full',
    /if \(what\.indexOf\('select:want '\) === 0\)/.test(front) &&
    /lineClient\(\)\.get\('\/online\.json'|lineHttp\.get\('\/online\.json'/.test(front) &&
    /if \(o && o\.full === true\) \{ lineStart\(id, o\); return; \}/.test(front));
yes('the front asks the server the page belongs to: 3000 for main, the port plus one for dev',
    /const RESOURCE_PORT = SERVER_PORT === 7777 \? 3000 : SERVER_PORT \+ 1;/.test(front) &&
    /lineHttp = RESOURCE_URL \? new sp\.HttpClient\(RESOURCE_URL\) : null;/.test(front));
// Since #1322 the launcher mints that token when the front asks for it.
yes('the front joins the relay only with this character own voice token, and asks the launcher for one',
    /if \(!tok \|\| tokenProfile\(tok\) !== lineId\) \{/.test(front) &&
    /function tokenProfile\(tok\) \{ return Number\(String\(tok \|\| ''\)\.split\('\.'\)\[1\]\) \|\| 0; \}/.test(front) &&
    /askToken\(lineId\)/.test(front));
yes('the front says /line every ten seconds, sends the pass, and tells the client to stay',
    /const LINE_EVERY_MS = 10000;/.test(front) && /thornswoodNet\.say\("\/line",\{quiet:true\}\)/.test(front) &&
    /'\/joinpass ' \+ pass/.test(front) && /sendMessage\("thornswood","stay"\)/.test(front));
yes('closing the game from the page gives the place up', /log\('menu: closing the game, asked from the character choice page'\);[\s\S]{0,80}try \{ lineLeave\(\); \} catch \(e\) \{ \}/.test(front));
yes('the words on the page have no em dash and never the forbidden word',
    clean((page.match(/KEEP_OPEN = [\s\S]*?;\n/) || [''])[0]) && clean((page.match(/function lineSays[\s\S]*?\n  \}\n/) || [''])[0]));

// ------------------------------------------------------------ the site
function grabFn(name) {
  const at = site.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  const bb = site.indexOf('{', at);
  let depth = 0;
  for (let i = bb; i < site.length; i++) {
    if (site[i] === '{') depth++;
    else if (site[i] === '}') { depth--; if (depth === 0) return site.slice(at + 1, i + 1); }
  }
  return '';
}
const seatsFull = new Function(grabFn('seatsFull') + '\nreturn seatsFull;')();
const worldFull = new Function(grabFn('worldFull') + '\nreturn worldFull;')();
const holdsStaffRole = new Function('cfg', grabFn('holdsStaffRole') + '\nreturn holdsStaffRole;')(
  { access: { admin: ['Owner', 'Dev'], dev: ['Owner', 'Dev', 'Gamemaster', 'Moderator', 'Loremaster'] } });
yes('full at 25 of 25', seatsFull({ up: true, online: 25, max: 25 }) === true);
yes('full when the server says so (a line, or seats held for it)', seatsFull({ up: true, online: 24, max: 25, full: true }) === true);
yes('not full at 24 of 25', seatsFull({ up: true, online: 24, max: 25 }) === false);
yes('not full with no number', seatsFull({ up: true, online: 60, max: 0 }) === false);
yes('not full while the server is down', seatsFull({ up: false, online: 25, max: 25, full: true }) === false);
yes("the site's sentence says there may be a wait at the menu, not no ('" + worldFull(25) + "')",
    /25 people/.test(worldFull(25)) && /place in line/.test(worldFull(25)) && !/Try again/.test(worldFull(25)) && clean(worldFull(25)));
yes('full at 25 of 30 when the server says so: the 5 over are staff seats', seatsFull({ up: true, online: 25, max: 30, full: true }) === true);
yes('and every seat taken is full whatever the server says', seatsFull({ up: true, online: 30, max: 30 }) === true);
yes('with no count the sentence names no number', !/\d/.test(worldFull(0)) && /place in line/.test(worldFull(0)) && clean(worldFull(0)));
yes('a staff role is a staff role: Moderator yes, Owner yes', holdsStaffRole(['Moderator']) && holdsStaffRole(['Owner']));
yes('a playtester or nothing is not', !holdsStaffRole(['Playtester', 'Content Creator']) && !holdsStaffRole([]) && !holdsStaffRole(null));
yes('standing() sets staffRole from the roles in both of its paths, the hand written admins path too',
    (site.match(/out\.staffRole = holdsStaffRole\(out\.roles\);/g) || []).length === 2);
yes('/api/allowed sends staffRoleProfiles from staffRole, and a ban takes a profile off it',
    /if \(st\.staffRole\) \{\s*for \(const n of profiles\) if \(!seenStaffRole\.has\(n\)\) \{ seenStaffRole\.add\(n\); out\.staffRoleProfiles\.push\(n\); \}/.test(site) &&
    // jarlProfiles went in #2551: the hold offices are a map by profile now.
    /\['profiles', 'devProfiles', 'adminProfiles', 'staffRoleProfiles', 'failedProfiles'\]/.test(site));
yes('the count poll reads max, line and full out of online.json',
    /o\.max > 0\) max = o\.max/.test(site) && /o\.line > 0\) line = o\.line/.test(site) && /o\.full === true\) full = true/.test(site));
yes('/api/public carries max from the server, or else from the record, and the line',
    /max: gameStatus\.max \|\| mostOnlineFallback\(\),\s*line: gameStatus\.line, full: seatsFull\(gameStatus\)/.test(site));
yes('/api/play/join says how many are in the world, not the seats, when it says there may be a wait',
    /message: wait \? worldFull\(gameStatus\.online\) : '',/.test(site));

// The fallback number: records\most-online.json, then the main feed's maxOnline.
// The main feed is the newest of feed\version\<8 digits>.json (#2727), found by
// the generations block lifted with it.
(function () {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'seats-'));
  try {
    const siteDir = path.join(tmp, 'site');
    fs.mkdirSync(path.join(siteDir, 'feed', 'version'), { recursive: true });
    const genAt = site.indexOf('const feedNewest = {};');
    const genFn = site.indexOf('\nfunction feedFile(', genAt);
    const generations = genAt < 0 || genFn < 0 ? '' : site.slice(genAt, genFn + 1) + grabFn('feedFile');
    yes('server.js has the feed generations block (feedFile)', !!generations && /function feedFile\(/.test(generations));
    const make = function () {
      return new Function('fs', 'path', 'ROOT',
        generations + '\n' +
        'const MOST_ONLINE_RECORD = path.join(ROOT, "..", "records", "most-online.json");\n' +
        'let mostOnlineSeen = { file: "", mtime: -1, size: -1, v: 0 };\n' +
        grabFn('mostOnlineFallback') + '\nreturn mostOnlineFallback;')(fs, path, siteDir);
    };
    yes('no record and no feed: no number', make()() === 0);
    fs.writeFileSync(path.join(siteDir, 'feed', 'version', '00000001.json'), JSON.stringify({ launcherVersion: '1', maxOnline: 25 }));
    yes('on the VPS (no records folder) it is the feed maxOnline: 25, which is what live serves today', make()() === 25);
    fs.mkdirSync(path.join(tmp, 'records'));
    fs.writeFileSync(path.join(tmp, 'records', 'most-online.json'), '﻿' + JSON.stringify({ people: 30, staffSeats: 5 }));
    yes('run from the repository it is records\\most-online.json itself, its seats: people and staff seats', make()() === 35);
    fs.writeFileSync(path.join(tmp, 'records', 'most-online.json'),
      JSON.stringify({ dev: { people: 5, staffSeats: 0, voice: 5 }, people: 25, staffSeats: 5, voice: 60 }));
    yes('the site is the live server, so it is main\'s 30 and never dev\'s 5', make()() === 30);
    fs.writeFileSync(path.join(tmp, 'records', 'most-online.json'), JSON.stringify({ people: 25 }));
    yes('with no staff seats it is the people', make()() === 25);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})();

const HEAD = "  if (p === '/api/play/join' && req.method === 'POST') {";
const from = site.indexOf(HEAD);
const next = site.indexOf("if ((p === '/api/play/start' || p === '/api/play/end')", from);
let route = (from >= 0 && next > from) ? site.slice(from, next) : '';
if (route) route = route.slice(0, route.lastIndexOf('/*'));
yes('the check in route is in server.js where this expects it', !!route);
if (!route) done();
yes('the route no longer refuses anybody for numbers', route.indexOf("why:'full'") < 0);
yes('the launcher logs a yes that carries a message', /if \(st\.Message != null && st\.Message\.Length > 0\) log\(st\.Message\);/.test(doorCs));

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
async function join(standing, status, channel) {
  let sent = null;
  const env = {
    p: '/api/play/join', req: { method: 'POST' }, res: {},
    body: async function () { return JSON.stringify({ ticket: 'D1', profileId: 4242, channel: channel || '' }); },
    readTicket: function (s) { return s ? { d: String(s), n: 'name' } : null; },
    standing: async function () {
      return Object.assign({ id: 'D1', name: 'name', inGuild: true, banned: false, play: true,
                             dev: false, admin: false, staffRole: false, roles: ['Playtester'] }, standing || {});
    },
    standCache: new Map(),
    cfg: { discord: { invite: '' }, access: { dev: ['Owner', 'Dev'] } },
    andList: function (l) { return l.join(' and '); },
    notAcceptedYet: function () { return 'not yet'; },
    accountBanned: function () { return 'banned'; },
    gameStatus: status, seatsFull: seatsFull, worldFull: worldFull,
    mostOnlineFallback: function () { return 25; },
    // No crash snapshots asked about here (#2319); test-2319-crash-looked-at.js runs that answer.
    sessionRows: function () { return []; },
    lookedAtFor: function () { return []; },
    departed: async function () { return new Set(); },
    // Play's doors answer inside PLAY_ANSWER_MS (#1094); Discord answers at
    // once here, so the real within() never reaches standingLate.
    PLAY_ANSWER_MS: 10000, PLAY_BODY_MS: 5000,
    passBodyFailure: function (e) { throw e; },
    within: new Function(grabFn('within') + '\nreturn within;')(),
    standingLate: function () { throw new Error('Discord answered here'); },
    jsonFile: function (f, fallback) { return f === 'linked.json' ? {} : fallback; },
    putJson: function () { return true; },
    LINKED: 'linked.json',
    slotsFor: function () { return 2; },
    sendJson: function (r, c, obj) { sent = { code: c, obj: obj }; return sent; },
    console: { log: function () { }, error: function () { } }
  };
  const names = Object.keys(env);
  const fn = new AsyncFunction(names.join(','), route + '\nreturn "fell through";');
  try { await fn.apply(null, names.map(function (n) { return env[n]; })); }
  catch (e) { return { threw: String(e) }; }
  return sent || { fellThrough: true };
}

(async function () {
  const FULL = { up: true, online: 25, max: 25, line: 3, full: true };
  let got = await join({}, { up: true, online: 25, max: 30, line: 1, full: true });
  yes('25 of 30 and full for anybody without a staff role: the wait names the 25 in the world, never 30',
      !!got.obj && got.obj.wait === true && /25 people are in the world/.test(got.obj.message) && !/30/.test(got.obj.message) && got.obj.max === 30);
  got = await join({}, FULL);
  yes('world full: a person with no staff role is let in, not refused', !!got.obj && got.code === 200 && got.obj.ok === true);
  yes('with wait and the sentence saying there may be a wait', !!got.obj && got.obj.wait === true && got.obj.message === worldFull(25));
  yes('and the count and the line', !!got.obj && got.obj.online === 25 && got.obj.max === 25 && got.obj.line === 3);
  got = await join({ staffRole: true, dev: true }, FULL);
  yes('a Discord staff role is not told to wait: a staff seat is theirs', !!got.obj && got.obj.ok === true && got.obj.wait === false && got.obj.message === '');
  got = await join({ admin: true, dev: true, staffRole: false }, FULL);
  yes('the hand written admins list is told to wait like anybody (it is not a role)', !!got.obj && got.obj.wait === true);
  got = await join({}, { up: true, online: 24, max: 25 });
  yes('24 of 25: in, no wait', !!got.obj && got.obj.ok === true && got.obj.wait === false);
  got = await join({}, { up: false, online: 0, max: 0 });
  yes('server down: in, no wait, and the number from the record', !!got.obj && got.obj.ok === true && got.obj.wait === false && got.obj.max === 25);
  got = await join({ dev: true, devBuild: true, staffRole: true }, FULL, 'dev');
  yes('the dev build (staff only) never waits', !!got.obj && got.obj.ok === true && got.obj.wait === false);

  // ------------------------------------------------------------ the home page
  // paintStatus in home.js (#3218).
  const START = "  var dot = document.getElementById('dot'), t = document.getElementById('livetext');";
  const END = "      if (gone) gone.hidden = true;\n    }\n  }\n";
  const ha = home.indexOf(START);
  const hb = ha < 0 ? -1 : home.indexOf(END, ha);
  const hblock = (ha >= 0 && hb >= 0) ? home.slice(ha, hb + END.length) : null;
  yes('home.js still has its status line', hblock !== null);
  if (hblock) {
    const say = function (status) {
      const els = {};
      const node = function () {
        const n = { children: [], _text: '', hidden: true, className: '' };
        Object.defineProperty(n, 'textContent', {
          get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
          set: function (v) { n._text = String(v); n.children = []; } });
        n.appendChild = function (c) { n.children.push(c); return c; };
        return n;
      };
      ['dot', 'livetext', 'figOnline', 'figOnlineWrap'].forEach(function (k) { els[k] = node(); });
      const document = { getElementById: function (id) { return els[id] || null; }, createElement: function () { return node(); } };
      vm.runInNewContext('(function(d){' + hblock + '})(d);', { document: document, d: { status: status }, String: String, Math: Math });
      return els;
    };
    let e = say({ up: true, online: 3, max: 25 });
    yes("with a number: '3 of 25 people in the world'", e.livetext.textContent === '3 of 25 people in the world');
    e = say({ up: true, online: 3, max: 30 });
    yes("with the seats the server says: '3 of 30 people in the world'", e.livetext.textContent === '3 of 30 people in the world');
    e = say({ up: true, online: 25, max: 30, line: 1, full: true });
    yes("full for people at 25 of 30 says the rest are kept for staff (got '" + e.livetext.textContent + "')",
        e.livetext.textContent === 'The world is full, 25 of 30 people are in it and the rest of the seats are kept for staff, 1 waiting for a seat' &&
        e.figOnline.textContent === '25 of 30' && clean(e.livetext.textContent));
    e = say({ up: true, online: 27, max: 25, line: 2, full: true });
    yes("staff over the number: never 27 of 25, and it says who waits (got '" + e.livetext.textContent + "')",
        e.livetext.textContent === 'The world is full, 25 of 25 people are in it, 2 waiting for a seat' &&
        e.figOnline.textContent === '25 of 25');
    yes('what the home page says is clean', clean(e.livetext.textContent));
  }
  done();
})();
