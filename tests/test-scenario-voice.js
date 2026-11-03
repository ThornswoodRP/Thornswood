'use strict';
/*
  test-scenario-voice.js

  Scenario: systems/voice.md

  #5198. The voice switches and the staff silence, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js). L
  on the look prompt sends /mute with the form id under the crosshair, and
  Mute, Text and Name beside somebody on P, and Hide every name, send
  /mute, /mute text and /hidename with their profile id, through the voice
  queue, as the game does. What P draws is the social view the server
  writes. What the voice service is told (the text mutes, the silences) is
  what the gamemode posts it, kept by the stand-in in w.toVoice. The
  distances, the speaking mark and the sound itself are the voice
  service's and the launcher's (tests/test-voice-range.js and the rest).

  Brenna and Aldis stand together in Whiterun's square, with Corvin beside
  them. Sam is staff.

    A  Voice: Brenna presses L on Aldis. She is told, P marks him muted, and
       Aldis is told nothing. It does not turn his text or his name off.
    B  Text: Text beside Aldis turns his text off, and the voice service is
       told that Brenna does not read him; Aldis is told nothing.
    C  Name: Name beside Corvin hides his name and nothing else. Hide every
       name hides every name; Show names puts them back, and Corvin's stays
       hidden.
    D  Muted and hidden: everybody switched off is listed, and Aldis stays
       on it once he logs off; pressing his Text again there turns it back
       on while he is away, and the voice service is told.
    E  A restart: the switches are as they were, and the voice service is
       told the text mutes again.
    F  Staff silence: /silence alone says how it is used. Sam silences
       Brenna. The voice service is told, she is told how long, and her
       /ooc reaches nobody. She cannot lift it; /unsilence from Sam does,
       and the voice service is told. Her personal switches are untouched
       by it.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  A silence in a faction or business chat is the factions scenario's; how
  long a silence lasts, and /ooc and /roll under one, are the chat
  scenario's.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-voice.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'voice', settings: { thornswoodDevs: [1009] } });
const CITY = '1a26f:Skyrim.esm';         // Whiterun
function at(n) { return [20000 + 100 * n, -8000, -3500]; }
const BRENNA = w.person(0xff001d00, { profileId: 1000, name: 'Brenna', cell: CITY, pos: at(0) });
const ALDIS = w.person(0xff001d01, { profileId: 1001, name: 'Aldis', cell: CITY, pos: at(1) });
const CORVIN = w.person(0xff001d02, { profileId: 1002, name: 'Corvin', cell: CITY, pos: at(2) });
const SAM = w.person(0xff001d09, { profileId: 1009, name: 'Sam', cell: CITY, pos: at(5) });
const ALL = [BRENNA, ALDIS, CORVIN, SAM];
ALL.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

function said(a, line) { const n = w.heard(a).length; w.say(a, line); return w.heardSince(a, n).join(' | '); }
/* P, as the server last wrote it into the social view. */
function view(a) { w.run(1500); return w.prop(a, 'thornswoodSocialView') || {}; }
function nearRow(a, pid) { return (view(a).near || []).find(function (r) { return r.p === pid; }) || {}; }
function hiddenRow(a, pid) { return (view(a).hidden || []).find(function (r) { return r.p === pid; }); }
/* What the voice service was last told on a path. */
function told(path) { const p = w.toVoice.filter(function (x) { return x.path === path; }); return p.length ? p[p.length - 1].body : null; }
function textMutesOf(pid) { const b = told('/textmute'); return (b && b.by && b.by[pid]) || []; }
function quiet(a, fn) { const n = w.heard(a).length; fn(); return w.heardSince(a, n).length === 0; }

yes('P1 P lists Aldis and Corvin under Near you', !!nearRow(BRENNA, 1001).p && !!nearRow(BRENNA, 1002).p);

// ---------------------------------------------------------------- A. voice --
let line = '';
const aldisQuietA = quiet(ALDIS, function () { line = said(BRENNA, '/mute ' + (ALDIS >>> 0).toString(16)); });
yes('A1 L on Aldis: Brenna is told (' + line + ')', line === 'You muted Aldis.');
const a1 = nearRow(BRENNA, 1001);
yes('A1 P marks him muted (' + JSON.stringify(a1) + ')', a1.muted === true);
yes('A1 and Aldis is told nothing', aldisQuietA);
yes('A2 it does not turn his text or his name off', a1.textOff === false && a1.nameOff === false && textMutesOf(1000).length === 0);

// ----------------------------------------------------------------- B. text --
const aldisQuietB = quiet(ALDIS, function () { line = said(BRENNA, '/mute text 1001'); });
yes('B1 Text beside Aldis: Brenna will not read him (' + line + ')', line === 'You will not read Aldis.' && nearRow(BRENNA, 1001).textOff === true);
yes('B1 the voice service is told she does not read him (' + JSON.stringify(told('/textmute')) + ')', textMutesOf(1000).indexOf(1001) !== -1);
yes('B1 and Aldis is told nothing', aldisQuietB);

// ----------------------------------------------------------------- C. name --
line = said(BRENNA, '/hidename 1002');
const c1 = nearRow(BRENNA, 1002);
yes('C1 Name beside Corvin hides his name (' + line + ')', line === 'You will not see Corvin\'s name.' && c1.nameOff === true);
yes('C1 and nothing else', c1.muted === false && c1.textOff === false && textMutesOf(1000).indexOf(1002) === -1);
line = said(BRENNA, '/hidename all');
yes('C2 Hide every name hides every name (' + line + ')', line === 'Every name above a head is hidden.' && view(BRENNA).namesAll === true);
line = said(BRENNA, '/hidename all');
yes('C3 Show names puts them back (' + line + ')', line === 'Names above heads are shown again.' && view(BRENNA).namesAll === false);
yes('C3 and Corvin\'s, hidden on its own, stays hidden', nearRow(BRENNA, 1002).nameOff === true);

// ----------------------------------------------------- D. muted and hidden --
const d1 = view(BRENNA).hidden || [];
yes('D1 Muted and hidden lists everybody she switched off (' + d1.map(function (r) { return r.name; }).join(', ') + ')',
    d1.length === 2 && !!hiddenRow(BRENNA, 1001) && !!hiddenRow(BRENNA, 1002));
w.leave(ALDIS);
w.run(5000);
const d2 = hiddenRow(BRENNA, 1001);
yes('D2 Aldis stays on it once he logs off, shown away (' + JSON.stringify(d2) + ')', !!d2 && d2.on === false && d2.muted && d2.textOff);
line = said(BRENNA, '/mute text 1001');
w.run(2000);
yes('D3 his Text pressed again there turns it back on while he is away (' + line + ')',
    line === 'You will read Aldis again.' && hiddenRow(BRENNA, 1001).textOff === false && hiddenRow(BRENNA, 1001).muted === true);
yes('D3 and the voice service is told (' + JSON.stringify(told('/textmute')) + ')', textMutesOf(1000).indexOf(1001) === -1);
line = said(BRENNA, '/mute text 1001');
yes('D4 and off again', line === 'You will not read Aldis.' && textMutesOf(1000).indexOf(1001) !== -1);

// --------------------------------------------------------------- E. restart --
const posted = w.toVoice.length;
const r = w.restart();
yes('E1 the server restarts', r.loaded);
[BRENNA, ALDIS, CORVIN, SAM].forEach(w.arrive);
w.run(30000);
const e1 = view(BRENNA);
yes('E1 Brenna\'s switches are as they were (' + JSON.stringify(e1.hidden) + ')',
    hiddenRow(BRENNA, 1001).muted === true && hiddenRow(BRENNA, 1001).textOff === true && hiddenRow(BRENNA, 1002).nameOff === true && e1.namesAll === false);
yes('E2 and the voice service is told the text mutes again', w.toVoice.slice(posted).some(function (x) {
  return x.path === '/textmute' && (x.body.by[1000] || []).indexOf(1001) !== -1;
}));

// ---------------------------------------------------------- F. staff silence --
const usage = said(SAM, '/silence');
yes('F0 /silence with nothing after it says how it is used (' + usage + ')', /^\/silence who\? \/silence <name/.test(usage));
const f0 = w.toVoice.length;
const brennaHeard = said(SAM, '/silence Brenna 10 shouting over the scene');
const silencedLine = w.heard(BRENNA).filter(function (x) { return /^Staff have silenced you/.test(x); }).pop() || '';
yes('F1 Sam silences Brenna for 10 minutes (' + brennaHeard + ')', /^Silenced Brenna for 10 minutes\. \/unsilence Brenna ends it sooner\.$/.test(brennaHeard));
yes('F1 she is told how long and what stops (' + silencedLine + ')',
    /for 10 minutes: shouting over the scene\. Your voice, what you type, the words above your head, and the speaking mark stop until then\. Your name stays\./.test(silencedLine));
const sil = w.toVoice.slice(f0).filter(function (x) { return x.path === '/silenced'; }).pop();
yes('F1 the voice service is told, until 10 minutes from now (' + JSON.stringify(sil && sil.body) + ')',
    !!sil && Math.abs(sil.body.profiles[1000] - (w.now() + 600000)) < 5000);
const aldisN = w.heard(ALDIS).length;
const ooc = said(BRENNA, '/ooc can everybody hear me');
yes('F2 her /ooc reaches nobody (' + ooc + ')', /^Staff have silenced you for another 10 minutes, so that did not reach anybody\.$/.test(ooc) &&
    w.heardSince(ALDIS, aldisN).join(' ').indexOf('can everybody hear me') === -1);
const self = said(BRENNA, '/unsilence Brenna');
yes('F3 she cannot lift it herself (' + self + ')', self === 'That one is not yours to run.' && told('/silenced').profiles[1000] > w.now());
yes('F4 her own switches are untouched by it', hiddenRow(BRENNA, 1001).muted === true && hiddenRow(BRENNA, 1002).nameOff === true);
const lifted = said(SAM, '/unsilence Brenna');
yes('F5 /unsilence from Sam lifts it (' + lifted + ')', lifted === 'Brenna can speak again.' &&
    w.heard(BRENNA).indexOf('Staff have let you speak again.') !== -1);
yes('F5 and the voice service is told nobody is silenced (' + JSON.stringify(told('/silenced')) + ')', told('/silenced').profiles[1000] === undefined);
const after = said(BRENNA, '/ooc sorry about that');
yes('F6 and her /ooc is heard again', w.heard(ALDIS).join(' ').indexOf('sorry about that') !== -1 && !/silenced/.test(after));

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
