// test-load-order-refusal.js
//
// A mismatched session is told where its load order parts from the server's,
// in one sentence, and is refused when the server is set to refuse (#402).
//
// The game's own check paints LOAD ORDER ERROR in red and carries on. On
// 17 Sep a tester's screenshot of the mining bug had that caption on it, so he
// was reporting bugs from a session where every custom object could resolve to
// something else, and nothing on screen told him to stop and press Fix.
//
// This lifts the load order refusal block out of gamemode.js and runs it over
// a pretend server: a fake mp, a manifest the shape the live one has, and the
// lines the front plugin would send, built with the front plugin's own copy of
// loadOrderMark. An altered list must come back as a refusal, not a caption.
//
// GAMEMODE=<path> runs it against another copy.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const GM = process.env.GAMEMODE || path.join(REPO_DIR, 'game', 'gamemode.js');
const FRONT = path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const VERIFY = path.join(REPO_DIR, 'launcher', 'app', 'Verify.cs');
const VOICE = path.join(REPO_DIR, 'voice', 'voice-server.js');
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* The function from its first line to the closing brace at its own indent. */
function lift(text, name) {
  const a = text.indexOf('  function ' + name + '(');
  if (a < 0) { return null; }
  const b = text.indexOf('\n  }\n', a);
  return b < 0 ? null : text.slice(a, b + 4);
}

// ------------------------------------------------ the two copies of the mark

const gmMarkText = lift(src, 'loadOrderMark');
const frontMarkText = lift(front, 'loadOrderMark');
yes('the gamemode has loadOrderMark', !!gmMarkText);
yes('the front plugin has loadOrderMark', !!frontMarkText);
yes('and the two are the same function, letter for letter', !!gmMarkText && gmMarkText === frontMarkText);

const mark = frontMarkText ? new Function(frontMarkText + '\nreturn loadOrderMark;')() : function () { return ''; };
yes('a mark is five hex', /^[0-9a-f]{5}$/.test(mark('Skyrim.esm', 249753412, 616253901)));
yes('the name is read without case, as the game reads it',
    mark('JKs Skyrim.esp', 10, -5) === mark('jks skyrim.esp', 10, -5));
yes('a signed crc32 and its unsigned twin are the same mark',
    mark('Update.esm', 18874041, -423982917) === mark('Update.esm', 18874041, -423982917 >>> 0));
yes('other bytes are another mark', mark('Riften Expansion.esp', 100, 7) !== mark('Riften Expansion.esp', 100, 8));
yes('and so is the name alone', mark('Riften Expansion.esp') !== mark('Riften Expansion.esp', 100, 7));

// ------------------------------------------------ the front plugin's half

{
  const verify = fs.readFileSync(VERIFY, 'utf8');
  const m = /Storefront = new HashSet<string>\([^)]*\)\s*\{([\s\S]*?)\};/.exec(verify);
  const launcher = m ? (m[1].match(/"([^"]+)"/g) || []).map(function (s) { return s.slice(1, -1).toLowerCase(); }).sort() : [];
  const f = /const LOAD_ORDER_STOREFRONT = (\[[\s\S]*?\]);/.exec(front);
  const plugin = f ? new Function('return ' + f[1])().map(function (s) { return s.toLowerCase(); }).sort() : [];
  yes('Verify.cs still names the files Steam owns', launcher.length === 10);
  yes('the front marks by name alone exactly the files Verify.cs leaves out of its byte check',
      launcher.length > 0 && JSON.stringify(launcher) === JSON.stringify(plugin));

  yes('the front sends the list as /loadorder <total> <from> <marks>',
      /tellServer\(word \+ ' ' \+ total \+ ' ' \+ from \+ ' ' \+/.test(front) && /sendMarks\('\/loadorder', orderMarks\);/.test(front));
  yes('it reads each plugin with getFileInfo, one a frame', /sp\.getFileInfo\(name\)/.test(front) &&
      /orderMarks\.push\(markOf\(orderToReport\[orderMarks\.length\]\)\);\s*return;/.test(front));
  // #1715: the light plugins the same way, after the full ones, under their
  // own word, from the list it writes to thornswood-plugins-light.txt.
  yes('and the light plugins as /loadorderlight, one a frame, after the full ones',
      /lightMarks\.push\(markOf\(lightToReport\[lightMarks\.length\]\)\);\s*return;/.test(front) &&
      /if \(lightToReport\) \{ sendMarks\('\/loadorderlight', lightMarks\); \}/.test(front) &&
      /lightToReport = light\.slice\(\);\s*fs\.writeFileSync\('Data\/Platform\/thornswood-plugins-light\.txt'/.test(front));
  yes('the list it sends is the one it writes to thornswood-loadorder.txt, taken before the write',
      /orderToReport = names\.slice\(\);\s*fs\.writeFileSync\('Data\/Platform\/thornswood-loadorder\.txt',\s*names\.join/.test(front));
  const resend = /const LOAD_ORDER_RESEND_MS = (\d+);/.exec(front);
  yes('it sends the report again every two minutes, so a lost one does not stay lost',
      !!resend && Number(resend[1]) === 120000 &&
      /if \(orderSentAt && now - orderSentAt < LOAD_ORDER_RESEND_MS\) \{ return; \}/.test(front) &&
      !/^\s+orderToReport = null;/m.test(front));

  const chunk = /const LOAD_ORDER_CHUNK = (\d+);/.exec(front);
  const n = chunk ? Number(chunk[1]) : 0;
  const voice = fs.readFileSync(VOICE, 'utf8');
  // A load order line is a command, so it keeps COMMAND_CHARS (#2554); held to 400 still, the cap a said line keeps.
  const cap = /pageText\(msg\.text\)\.slice\(0, COMMAND_CHARS\)/.test(voice) &&
              /const SAID_CHARS = (\d+);/.test(voice) ? /const SAID_CHARS = (\d+);/.exec(voice) : null;
  const longest = '/loadorderlight 4096 4032 ' + new Array(n + 1).join('fffff');
  yes('a full line fits under the voice service\u2019s chat cap (' + longest.length + ' of ' +
      (cap ? cap[1] : '?') + ')', n > 0 && !!cap && longest.length < Number(cap[1]));
}

// ------------------------------------------------ the gamemode's half

const a = src.indexOf('// ==== thornswood load order refusal ====');
const b = src.indexOf('// ==== end thornswood load order refusal ====');
yes('the refusal block is in the gamemode', a >= 0 && b > a);

{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const player = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const W = words ? new Function('return ' + words[1])() : [];
  const P = player ? new Function('return ' + player[1])() : [];
  yes('/loadorder and /loadorderlight are words the server answers', W.indexOf('/loadorder') >= 0 && W.indexOf('/loadorderlight') >= 0);
  yes('and /help never offers either to anybody', P.indexOf('/loadorder') < 0 && P.indexOf('/loadorderlight') < 0);
  yes('handle() hands both to the refusal block with the character',
      /word === '\/loadorder' \|\| word === '\/loadorderlight'[\s\S]{0,400}lo\.take\(profileId, parts, actorId,/.test(code));
  yes('a held report never says "your character is not back" to somebody who typed nothing',
      /word !== '\/loadorder'/.test(code) && /word !== '\/loadorderlight'/.test(code));
  yes('the manifest block keeps the published list for it',
      /globalThis\.__thornswoodManifestMods = mods;/.test(code));
}

const NAMES = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm',
               'Water for ENB.esm', 'Embers XD.esm', 'RaceCompatibility.esm',
               'Immersive Sounds - Compendium.esp', 'IcePenguinWorldMap.esp', 'JKs Skyrim.esp',
               'WindhelmSSE.esp', 'CWE - JK - United.esp', "JK's Whiterun's Outskirts.esp",
               'Riften Expansion.esp', 'Thornswood-Content.esp', 'Playable Rieklings.esp'];
const STOREFRONT = ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'];

function manifest(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = i < NAMES.length ? NAMES[i] : ('Filler ' + i + '.esp');
    out.push({ filename: name, size: 1000 + i * 37, crc32: ((i * 2654435761) | 0) });
  }
  return out;
}

/* What the front plugin would send for this list: the same marks, the same lines. */
function linesFor(list, word) {
  const marks = list.map(function (m) {
    return STOREFRONT.indexOf(m.filename.toLowerCase()) >= 0 ? mark(m.filename) : mark(m.filename, m.size, m.crc32);
  });
  const out = [];
  for (let from = 0; from < marks.length; from += 64) {
    out.push((word || '/loadorder') + ' ' + marks.length + ' ' + from + ' ' + marks.slice(from, from + 64).join(''));
  }
  return out;
}

function rig(settings, mods) {
  const r = { told: [], logged: [], kicked: [], timers: [] };
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function (fn) { r.interval = fn; return 1; },
    clearInterval: function () { },
    mp: {
      getServerSettings: function () { return settings; },
      getUserByActor: function (actorId) { return actorId === 0xff000a01 ? 7 : -1; },
      get: function (id, what) {
        if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
        for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === id) { return r.online[i].profileId; } }
        throw new Error('no such actor');
      },
      kick: function (userId) { r.kicked.push(userId); }
    }
  };
  r.online = [];
  r.box = box;
  vm.createContext(box);
  vm.runInContext(src.slice(a, b), box, { filename: 'gamemode.js (load order refusal)' });
  box.__thornswoodManifestMods = mods;
  r.lo = box.__thornswoodLoadOrder;
  // The relay answering, as the command poll records it.
  r.relay = function (okAt, failAt) { box.__thornswoodCommandPoll = { okAt: okAt || 0, failAt: failAt || 0 }; };
  r.sweep = function (now) {
    return r.lo.sweep(now, r.online, function (pid, t) { r.told.push(t); });
  };
  r.send = function (profileId, lines) {
    let last;
    lines.forEach(function (line) {
      last = r.lo.take(profileId, line.split(/\s+/), 0xff000a01, function (t) { r.told.push(t); });
    });
    return last;
  };
  r.fire = function () { const t = r.timers.splice(0); t.forEach(function (fn) { fn(); }); };
  return r;
}

if (a >= 0 && b > a) {
  const mods = manifest(48);

  // ---- the light plugins (#1715) ----
  {
    const LIGHT = ['_ResourcePack.esl', 'Expressive Facegen Morphs.esl', 'KhisartinBeards.esp', 'HammerHair.esp']
      .map(function (n, i) { return { filename: n, size: 500 + i, crc32: 900 + i }; });
    let r = rig({}, mods);
    r.box.__thornswoodManifestLight = LIGHT;
    r.send(20, linesFor(mods));
    yes('light: a light list in the server’s order is passed', r.send(20, linesFor(LIGHT, '/loadorderlight')) === null && r.told.length === 0);
    const swapped = LIGHT.slice(); swapped[2] = LIGHT[3]; swapped[3] = LIGHT[2];
    const v = r.send(21, linesFor(swapped, '/loadorderlight'));
    yes('light: two light plugins swapped are refused at light position 2, naming the server’s plugin there',
        !!v && v.light === true && v.at === 2 && v.theirs === 'KhisartinBeards.esp');
    yes('light: told in one sentence that names the light position',
        r.told.length === 1 && r.told[0].indexOf('light position 2') >= 0 && r.told[0].indexOf('KhisartinBeards.esp') >= 0);
    r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    r.box.__thornswoodManifestLight = LIGHT;
    const cut = r.send(22, linesFor(LIGHT.slice(0, 2), '/loadorderlight'));
    r.fire();
    yes('light: a light list cut short is refused, and with refusing on the session ends',
        !!cut && cut.at === 2 && r.kicked.length === 1);
    r = rig({}, mods);
    r.box.__thornswoodManifestLight = null;
    yes('light: a server with no light list judges nothing by the light report',
        r.send(23, linesFor(swapped, '/loadorderlight')) === null && r.told.length === 0);
    // The sweep: a server with a light list needs both reports.
    r = rig({}, mods);
    r.box.__thornswoodManifestLight = LIGHT;
    const t0 = 1000000;
    r.relay(t0, 0);
    r.online = [{ actorId: 0xff000a01, profileId: 24 }];
    r.sweep(t0);
    r.send(24, linesFor(mods));
    r.relay(t0 + 300001, 0);
    yes('light: a server with a light list counts a profile with only the full report as not reported',
        r.sweep(t0 + 300001).indexOf(24) >= 0);
    r = rig({}, mods);
    r.box.__thornswoodManifestLight = LIGHT;
    r.relay(t0, 0);
    r.online = [{ actorId: 0xff000a01, profileId: 25 }];
    r.sweep(t0);
    r.send(25, linesFor(mods));
    r.send(25, linesFor(LIGHT, '/loadorderlight'));
    r.relay(t0 + 300001, 0);
    yes('light: and with both reports it is reported', r.sweep(t0 + 300001).length === 0);
    r = rig({}, mods);
    r.relay(t0, 0);
    r.online = [{ actorId: 0xff000a01, profileId: 26 }];
    r.sweep(t0);
    r.send(26, linesFor(mods));
    r.relay(t0 + 300001, 0);
    yes('light: a server with no light list needs the full report only, as before', r.sweep(t0 + 300001).length === 0);
  }

  {
    const r = rig({}, mods);
    yes('the block publishes take, verdict and mark', !!(r.lo && r.lo.take && r.lo.verdict && r.lo.mark));
    const v = r.send(1, linesFor(mods));
    yes('a list that matches the server\u2019s is passed', v === null);
    yes('and nothing is said to that person', r.told.length === 0);
    r.fire();
    yes('and nobody is disconnected', r.kicked.length === 0);
  }

  {
    const r = rig({}, mods);
    const extra = mods.concat([{ filename: 'SkyHUD.esp', size: 5, crc32: 5 }]);
    yes('plugins after the server\u2019s last are left alone, as the game leaves them',
        r.send(2, linesFor(extra)) === null && r.told.length === 0);
  }

  // The altered lists. Each must be a refusal, not a caption.
  const altered = [
    ['two plugins swapped', function (l) { const t = l[9]; l[9] = l[10]; l[10] = t; return l; }, 9],
    ['one plugin with other bytes under the same name',
      function (l) { l[14] = { filename: l[14].filename, size: l[14].size, crc32: l[14].crc32 + 1 }; return l; }, 14],
    ['a plugin missing from the middle', function (l) { l.splice(12, 1); return l; }, 12],
    ['the list cut short', function (l) { return l.slice(0, 30); }, 30]
  ];
  altered.forEach(function (c) {
    const r = rig({}, mods);
    const list = c[1](mods.map(function (m) { return Object.assign({}, m); }));
    const v = r.send(3, linesFor(list));
    yes(c[0] + ': refused at position ' + c[2], !!v && v.at === c[2] && v.theirs === mods[c[2]].filename);
    yes(c[0] + ': told in one sentence naming the position and the plugin',
        r.told.length === 1 && r.told[0].indexOf('position ' + c[2]) >= 0 &&
        r.told[0].indexOf(mods[c[2]].filename) >= 0 && /press Fix in the launcher, then Play again\.$/.test(r.told[0]));
    r.fire();
    yes(c[0] + ': while the server is only watching, they stay and the log says WOULD REFUSE',
        r.kicked.length === 0 && r.logged.some(function (s) { return /WOULD REFUSE profile 3/.test(s); }));
  });

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const list = mods.map(function (m) { return Object.assign({}, m); });
    list[20] = { filename: list[20].filename, size: list[20].size + 1, crc32: list[20].crc32 };
    const v = r.send(4, linesFor(list));
    yes('with thornswoodLoadOrderRefuse on, an altered list is refused', !!v && v.at === 20);
    yes('the sentence says the session is ending', r.told.length === 1 && /this session is being ended/.test(r.told[0]));
    yes('the connection is not cut before the sentence has had time to land', r.kicked.length === 0);
    r.fire();
    yes('and then the session is ended', r.kicked.length === 1 && r.kicked[0] === 7);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: 'yes' }, mods);
    const list = mods.slice(0, 10);
    r.send(5, linesFor(list));
    r.fire();
    yes('only true turns refusing on; any other value watches', r.kicked.length === 0);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const list = mods.map(function (m) { return Object.assign({}, m); });
    list[0] = { filename: 'Skyrim.esm', size: 1, crc32: 1 };
    yes('the files Steam owns pass by name, since Fix cannot mend them',
        r.send(6, linesFor(list)) === null && r.told.length === 0);
    const unread = linesFor(mods);
    const marks = unread[0].split(' ')[3];
    const at = 15 * 5;
    const nameOnly = marks.slice(0, at) + mark(mods[15].filename) + marks.slice(at + 5);
    yes('a plugin the client could not read passes by name',
        r.send(6, ['/loadorder 48 0 ' + nameOnly]) === null && r.told.length === 0);
  }

  {
    const big = manifest(150);
    const r = rig({}, big);
    const lines = linesFor(big);
    yes('a long list goes as several lines', lines.length === 3);
    yes('the first lines judge nothing', r.lo.take(7, lines[0].split(' '), 1, function () { }) === undefined &&
        r.lo.take(7, lines[1].split(' '), 1, function () { }) === undefined);
    yes('the last one judges the whole list', r.lo.take(7, lines[2].split(' '), 1, function () { }) === null);

    const r2 = rig({}, big);
    r2.lo.take(8, lines[0].split(' '), 1, function () { });
    yes('a line out of order is dropped rather than judged',
        r2.lo.take(8, lines[2].split(' '), 1, function (t) { r2.told.push(t); }) === undefined &&
        r2.told.length === 0);
  }

  {
    const r = rig({}, undefined);
    yes('with no manifest published nothing is judged and nobody is told',
        r.send(9, linesFor(mods.slice(0, 3))) === undefined && r.told.length === 0);
  }

  // ---------------------------------------------- the report that never comes
  const ACTOR = 0xff000a01;
  const G = 300000;
  function online(r, pid) { r.online = [{ actorId: ACTOR, profileId: pid }]; }
  function at(r, now) { r.relay(now - 1000, 0); return r.sweep(now); }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const t0 = Date.now();
    online(r, 11);
    yes('the grace is five minutes', r.lo.grace === G);
    yes('no report yet is nothing while the grace runs',
        at(r, t0).length === 0 && at(r, t0 + G - 1).length === 0 && r.told.length === 0);
    const j = at(r, t0 + G + 1);
    yes('online five minutes with no report, refusing on: judged', j.length === 1 && j[0] === 11);
    yes('and told in one sentence that the game has not reported, and to press Fix',
        r.told.length === 1 && /has not told the server which plugins it loaded/.test(r.told[0]) &&
        /this session is being ended/.test(r.told[0]));
    r.fire();
    yes('and the session is ended after the sentence', r.kicked.length === 1 && r.kicked[0] === 7);
    at(r, t0 + G + 60000);
    yes('judged once, not again every sweep', r.told.length === 1);
  }

  {
    const r = rig({}, mods);
    const t0 = Date.now();
    online(r, 12);
    at(r, t0);
    at(r, t0 + G + 1);
    r.fire();
    yes('no report while only watching: told, WOULD REFUSE in the log, and they stay',
        r.told.length === 1 && r.kicked.length === 0 &&
        r.logged.some(function (s) { return /WOULD REFUSE profile 12: no load order report/.test(s); }));
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const t0 = Date.now();
    online(r, 13);
    at(r, t0);
    r.send(13, linesFor(mods));
    yes('a report that matches: never judged as no report', at(r, t0 + G + 1).length === 0 && r.told.length === 0);
    r.fire();
    yes('and nobody is disconnected', r.kicked.length === 0);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const t0 = Date.now();
    r.send(14, linesFor(mods));   // sent from the main menu, before the character is online
    online(r, 14);
    yes('a report that came just before the character did still counts',
        at(r, t0 + 1000).length === 0 && at(r, t0 + G + 2000).length === 0 && r.told.length === 0);
  }

  {
    const big = manifest(150);
    const r = rig({ thornswoodLoadOrderRefuse: true }, big);
    const t0 = Date.now();
    online(r, 15);
    at(r, t0);
    r.send(15, linesFor(big).slice(0, 2));
    yes('a partial report is no report: judged once the grace is over',
        at(r, t0 + G + 1).length === 1 && /has not told the server/.test(r.told[0]));
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, undefined);
    const t0 = Date.now();
    online(r, 16);
    at(r, t0);
    yes('the server’s own failure, no manifest published: nobody is judged',
        at(r, t0 + G + 1).length === 0 && at(r, t0 + 3 * G).length === 0 && r.told.length === 0);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const t0 = Date.now();
    online(r, 17);
    r.relay(0, 0);
    r.sweep(t0);
    r.sweep(t0 + G + 1);
    yes('the server’s own failure, the command relay never answering: nobody is judged', r.told.length === 0);
    r.relay(t0 + G - 60000, 0);   // answered, but not lately
    yes('nor while its last answer is stale', r.sweep(t0 + G + 1).length === 0);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const t0 = Date.now();
    online(r, 18);
    at(r, t0);
    const broke = t0 + 100000;
    r.relay(t0 + G, broke);
    yes('a break in the relay during the grace starts the clock again',
        r.sweep(t0 + G + 1).length === 0 && r.told.length === 0);
    r.relay(broke + G + 1000, broke);
    yes('and the grace then runs from the break', r.sweep(broke + G + 1).length === 1);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    const t0 = Date.now();
    online(r, 19);
    at(r, t0);
    r.online = [];
    at(r, t0 + 1000);
    online(r, 19);
    at(r, t0 + 2000);
    yes('a person who leaves and comes back starts a new grace',
        at(r, t0 + G + 1).length === 0 && at(r, t0 + G + 2001).length === 1);
  }

  {
    const r = rig({ thornswoodLoadOrderRefuse: true }, mods);
    r.box.mp.get = function () { throw new Error('the server is having a bad moment'); };
    let threw = false;
    try { r.interval(); } catch (e) { threw = true; }
    r.fire();
    yes('the sweep failing is the server’s failure: logged, nobody refused',
        !threw && r.kicked.length === 0 &&
        r.logged.some(function (s) { return /load order sweep failed, nobody refused/.test(s); }));
  }

  {
    const r = rig({}, mods);
    r.send(20, linesFor(mods));
    r.send(20, linesFor(mods));
    yes('a report sent again says "matches" once, not every two minutes',
        r.logged.filter(function (s) { return /load order of profile 20 matches/.test(s); }).length === 1);
    const list = mods.slice(0, 20);
    r.send(21, linesFor(list));
    r.send(21, linesFor(list));
    yes('and a list that differs is told once while only watching', r.told.length === 1);
  }

  {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    yes('the command poll records when the relay answers and when it fails',
        /pollSaid\(true\);/.test(code) && /req\.on\('error', function \(\) \{ pollSaid\(false\); \}\)/.test(code) &&
        /req\.on\('timeout', function \(\) \{ pollSaid\(false\);/.test(code) &&
        /g\.__thornswoodCommandPoll/.test(code));
    yes('and the chat block lends the sweep its way of telling somebody',
        /g\.__thornswoodToProfile = toProfile;/.test(code));
  }

  {
    const r = rig({}, mods);
    const s = [r.lo.sentence({ at: 3, theirs: 'X.esp' }, false), r.lo.sentence({ at: 3, theirs: 'X.esp' }, true),
               r.lo.noReport(false), r.lo.noReport(true)];
    s.forEach(function (t, i) {
      yes('the ' + (i % 2 ? 'refusing' : 'watching') + (i > 1 ? ' no report' : '') + ' sentence is one sentence, with no em dash and no "player"',
          t.split('. ').length === 1 && t.indexOf('\u2014') < 0 && !/player/i.test(t));
    });
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
