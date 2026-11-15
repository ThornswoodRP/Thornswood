// test-1629-party-gui.js
//
// #1629. A party is asked, listed, left, disbanded, and its lead handed or a
// member kicked without typing. P on somebody who is not in your party sends
// the ask, the way Y sends a friend request; P with nobody there, or on a
// party member, opens the P panel, whose buttons send the rest. /party is
// out of every help list and every line that told people to type it.
//
// Patrick, 4 Oct: "no more commands for things [people] do, only for dev and
// staff commands; everything else takes buttons and GUI".
//
// WHAT THIS RUNS. The real key handler, partyPress and lookVerb out of
// thornswood-front.js over a pretend game and page; the real social and trade
// blocks and the social branch of handle() out of gamemode.js over a fake mp,
// sending exactly the lines the key and the panel send. Then the words: the
// gamemode's list of words named to everybody, its own lines, the Help page,
// and the pages.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const gm = process.env.GM ? fs.readFileSync(process.env.GM, 'utf8').split(CR).join('') : read('game', 'gamemode.js');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = read('game', 'ui', 'thornswood-help.js');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}
const front = process.env.FRONT ? fs.readFileSync(process.env.FRONT, 'utf8').split(CR).join('')
                                : read('game', 'plugins', 'thornswood-front.js');
const panel = read('game', 'ui', 'thornswood-party.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function code(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ----------------------------------------------------------- the P key
const keys = slice(front, "  sp.on('buttonEvent', guard('keys', (e) => {", '\n  }));\n');
const menus = slice(front, '  const KEYBOARD_MENUS = [', '\n  ];');
const partyPress = slice(front, '  function partyPress() {', '\n  }\n');
const lookVerb = slice(front, '  function lookVerb(cmd) {', '\n  }\n');
yes('the key handler, partyPress and lookVerb are in the plugin',
    keys !== null && menus !== null && partyPress !== null && lookVerb !== null);

/*
  The keys as the plugin declares them: every `const ..._KEY` and ESC at the
  top of its scope, in its order, read through the plugin's own iniNumber from
  a Thornswood.ini that is empty unless a case gives it lines. Read from the
  plugin rather than typed here (#1652): a typed copy kept the friend key on G
  after #529 moved it to Y, so the harness pressed a key the plugin no longer
  reads.
*/
const KEY_DECLS = (front.match(/^  (?:const|let) (?:[A-Z]+_)*KEY\b[^;\n]*;|^  const ESC = \d+;/gm) || []).join('\n');
const INI_AT = front.indexOf('  function iniNumber(text, key, fallback) {');
const INI_NUMBER = INI_AT < 0 ? '' : front.slice(INI_AT, front.indexOf('\n  }\n', INI_AT) + 4);
function keyPrelude(iniText) {
  return 'const ini = ' + JSON.stringify(iniText || '') + ';\n' + INI_NUMBER + KEY_DECLS + '\n';
}
yes('the plugin reads its keys through iniNumber', INI_NUMBER !== '' && KEY_DECLS !== '');
const KEY = INI_NUMBER === '' ? {} : new Function(keyPrelude('') + 'return { ' +
  (KEY_DECLS.match(/(?:const|let) \w+/g) || []).map(function (d) { d = d.replace(/^(?:const|let) /, ''); return d + ': ' + d; }).join(', ') + ' };')();

const Y = KEY.FRIEND_KEY, P = KEY.PARTY_KEY;
yes('the plugin declares every key the handler reads', !!keys &&
    (keys.match(/\b(?:[A-Z]+_)*KEY\b|\bESC\b/g) || []).every(function (k) { return typeof KEY[k] === 'number'; }));
const HEX = 'ff000004';

function rig(opts) {
  opts = opts || {};
  const w = { open: {}, lines: [], toggles: 0, shut: [], notes: [], logs: [], threw: [], handlers: {} };
  (opts.menus || []).forEach(function (m) { w.open[m] = true; });
  const claims = Object.assign({}, opts.claims || {});
  const near = opts.near || {};
  const page = {
    thornswoodNet: { say: function (line) { w.lines.push(line); return true; } },
    skyrimPlatform: { sendMessage: function (t, m) { w.notes.push(m); } }
  };
  const sp = {
    on: function (ev, fn) { (w.handlers[ev] = w.handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { return !!w.open[n]; } }
  };
  const T = {
    ready: true,
    js: function (s) {
      if (s.indexOf('thornswoodParty.toggle') >= 0) { w.toggles++; return true; }
      if (s.indexOf('thornswood') >= 0 && s.indexOf('.toggle') >= 0) { return true; }
      new Function('window', s)(page);
      return true;
    },
    hasFocus: function (who) { return !!claims[who]; }
  };
  const guard = function (name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (err) { w.threw.push(name + ': ' + err); return undefined; }
    };
  };
  // The game's Quick Magic on P. openedBy names it when this same press put
  // it up, which is what lets P through the menu check; shutFor is the shut.
  const magic = {
    openedBy: function () { return opts.magicByThisPress ? 'MagicMenu' : ''; },
    shutFor: function (e) { w.shut.push(e.code); },
    keyDown: function () { }
  };
  const prelude =
    'let keysSeen = 0, sawAnyKey = true;\n' +
    menus + '\n' +
    "const JOURNAL_MENU = 'Journal Menu';\n" +
    keyPrelude('') +
    'function rememberKey() { }\n' +
    'function wantTyping() { }\n' +
    'function journalKeyDown() { }\n' +
    'function journalKeyPressed() { }\n' +
    'function moldPress() { return false; }\n' +
    'function sleepPress() { return false; }\n' +
    'function repairPress() { return false; }\n' +
    'function furniturePress() { return false; }\n' +
    'function arrangePress() { return false; }\n' +
    'function deliverPress() { return false; }\n' +
    'function boxPress() { return false; }\n' +
    'function boardPress() { return false; }\n' +
    'function driverPress() { return false; }\n' +
    'function merchantPress() { return false; }\n' +
    'function lockPress() { return false; }\n' +
    // Tend their wounds (#1383), X on a hurt person, and Tend your wounds,
    // H in the inventory. Nobody hurt is looked at and no inventory is open
    // here; test-1383-treatments.js has what they do.
    'function treatPress() { return false; }\nfunction treatSelfPress() { return false; }\n' +
    // Salt or smoke your food (#3163), Y in the inventory. No inventory is
    // open here; test-3163-spoilage.js has what it does.
    'function preservePress() { return false; }\n' +
    'function maneuverKeyPressed() { }\n' +
    'function helpKeyPressed() { }\n' +
    'function commandKeyPressed() { }\n' +
    'const statsOnSlash = { openedBy: function () { return ""; }, shutFor: function () { }, keyDown: function () { } };\n' +
    'function busyMenuOpen() { for (const n of KEYBOARD_MENUS) { if (sp.Ui.isMenuOpen(n)) { return n; } } return ""; }\n' +
    'let lookingAt = ' + JSON.stringify(opts.looking || '') + ';\n' +
    'function nearList() { return near; }\n' +
    'function note(t) { notes.push(t); }\n' +
    lookVerb + partyPress;
  new Function('sp', 'T', 'claims', 'say', 'guard', 'magicOnP', 'near', 'notes', prelude + keys)(
    sp, T, claims, function (t) { w.logs.push(String(t)); }, guard, magic, near, w.notes);
  w.press = function (c) {
    (w.handlers.buttonEvent || []).forEach(function (f) { f({ code: c, isDown: true, isUp: false }); });
  };
  return w;
}

if (keys && menus && partyPress && lookVerb) {
  const stranger = {}; stranger[HEX] = { n: 'Second', f: 0, m: 0, y: 0 };
  const member = {}; member[HEX] = { n: 'Second', f: 0, m: 0, y: 1 };
  {
    const w = rig({ looking: HEX, near: stranger });
    w.press(P);
    yes('K1 P on somebody not in your party sends the ask with their form id',
        w.lines.length === 1 && w.lines[0] === '/party ' + HEX);
    yes('K1 and does not open the panel', w.toggles === 0);
    yes('K1 and the Quick Magic the press opened is still shut', w.shut.length === 1 && w.shut[0] === P);
    yes('K1 nothing threw', w.threw.length === 0);
  }
  {
    const w = rig({ looking: HEX, near: member });
    w.press(P);
    yes('K2 P on a party member opens the panel and asks nothing',
        w.toggles === 1 && w.lines.length === 0 && w.shut.length === 1);
  }
  {
    const w = rig({ near: stranger });
    w.press(P);
    yes('K3 P with nobody in front of you opens the panel', w.toggles === 1 && w.lines.length === 0);
  }
  {
    const w = rig({ looking: HEX, near: {} });
    w.press(P);
    yes('K4 P on somebody the near list does not carry opens the panel', w.toggles === 1 && w.lines.length === 0);
  }
  {
    const w = rig({ looking: HEX, near: stranger, claims: { party: true } });
    w.press(P);
    yes('K5 with the panel up, P closes it, even over somebody not in the party',
        w.toggles === 1 && w.lines.length === 0);
  }
  {
    const w = rig({ looking: HEX, near: stranger, menus: ['MagicMenu'], magicByThisPress: true });
    w.press(P);
    yes('K6 the magic menu this same press opened does not stop the ask, and is shut',
        w.lines.length === 1 && w.lines[0] === '/party ' + HEX && w.shut.length === 1 &&
        !w.logs.some(function (l) { return /MagicMenu is open/.test(l); }));
  }
  {
    const w = rig({ looking: HEX, near: stranger, menus: ['MagicMenu'] });
    w.press(P);
    yes('K7 a magic menu that was up before the press is the game\'s: nothing is sent or opened',
        w.lines.length === 0 && w.toggles === 0);
  }
  ['InventoryMenu', 'RaceSex Menu', 'Dialogue Menu'].forEach(function (m) {
    const w = rig({ looking: HEX, near: stranger, menus: [m] });
    w.press(P);
    yes('K8 over ' + m + ' P asks nothing and opens nothing', w.lines.length === 0 && w.toggles === 0);
  });
  {
    const w = rig({ looking: HEX, near: stranger, claims: { chat: true } });
    w.press(P);
    yes('K9 while the chat has the keyboard P is a letter', w.lines.length === 0 && w.toggles === 0);
  }
  {
    const w = rig({ looking: HEX, near: stranger });
    w.press(Y);
    yes('K10 Y on the same person still asks to be friends', w.lines.length === 1 && w.lines[0] === '/friend ' + HEX);
  }
  yes('K11 the look prompt says Ask to party for one and Party menu for the other',
      /keyRow\(PARTY_NAME, row\.y \? 'Party menu' : 'Ask to party', !!row\.y\)/.test(front));
}

// ------------------------------------------------ the server's answers
const social = slice(gm, '// ==== thornswood social:', '// ==== end thornswood social ====');
const trade = slice(gm, '// ==== thornswood trade ====', '// ==== end thornswood trade ====');
const ca = gm.indexOf("    if (word === '/friend' || word === '/party' || word === '/mute' ||");
const cb = ca < 0 ? -1 : gm.indexOf("    if (word === '/rest') {", ca);
const branch = (ca >= 0 && cb >= 0) ? gm.slice(ca, cb) : null;
yes('the social and trade blocks and the social branch of handle are in the gamemode',
    social !== null && trade !== null && branch !== null);

function world() {
  const store = {};
  const said = [];
  const g = {};
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') {
        return Object.keys(store).filter(function (k) { return store[k].here; }).map(Number);
      }
      const row = store[id];
      if (!row) { return undefined; }
      if (key === 'inventory') { return { entries: (row.inventory || []).slice() }; }
      return row[key];
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id][key] = v;
    },
    lookupEspmRecordById: function () { return null; }
  };
  function run(block) {
    new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
      'guard', 'say', 'notify', 'Math', 'Number', 'String', 'Object', 'Array',
      'JSON', 'isFinite', 'parseInt', require('../../tests/fixtures/ordinary-quest-items') + block)(
      g, mp, { now: function () { return 1700000000000; } }, { log: function () { } },
      function () { return 1; }, function () { }, function (n, f) { return f; },
      function (id, line) { said.push({ to: id, line: line }); },
      function () { },
      Math, Number, String, Object, Array, JSON, isFinite, parseInt);
  }
  run(social);
  run(trade);
  const soc = g.__thornswoodSocial;
  return {
    g: g, soc: soc, store: store, said: said,
    person: function (id, name, pid) {
      store[id] = { here: true, profileId: pid, appearance: { name: name },
                    worldOrCellDesc: 'cell:X.esm', pos: [0, 0, 0], inventory: [] };
      return id;
    },
    send: function (actor, text) {
      const parts = text.split(/\s+/);
      new Function('globalThis', 'actorId', 'profileId', 'parts', 'word',
        'toProfile', 'say', 'notify', 'journalCommand', branch)(
        g, actor, soc.profileOf(actor), parts, parts[0],
        function (pid, line) { said.push({ to: soc.actorForProfile(pid), line: line }); },
        function (to, line) { said.push({ to: to, line: line }); }, function () { }, function () { });
    },
    last: function (id) {
      const mine = said.filter(function (s) { return s.to === id; });
      return mine.length ? mine[mine.length - 1].line : '';
    },
    members: function (pid) {
      const p = soc.partyOf(pid);
      return p ? p.members.slice().sort() : [];
    }
  };
}

if (social && trade && branch) {
  const w = world();
  const A = w.person(0xff000003, 'First', 701);
  const B = w.person(0xff000004, 'Second', 702);
  const C = w.person(0xff000005, 'Third', 703);

  // What P sends with Second under the crosshair.
  w.send(A, '/party ff000004');
  const o = w.soc.standingOffer(702);
  yes('S1 P\'s line puts a party ask in front of the person looked at',
      !!o && o.kind === 'party' && o.from === 701);
  yes('S1 they are told to answer on the prompt', /Accept or refuse on the prompt/.test(w.last(B)));
  yes('S1 and the asker is told it went', /^Asked Second\. They have \d+ seconds\./.test(w.last(A)));

  // Accept on the prompt.
  w.send(B, '/yes');
  yes('S2 Accept puts them in the party, and the one who asked leads it',
      w.members(701).join() === '701,702' && w.soc.partyOf(701).leader === 701);

  // The panel lists who is in it and how many are here: the view it is sent.
  const v = w.soc.view(A);
  yes('S3 the P panel is sent who is in the party, who leads, and how many are here',
      v.party.length === 2 && v.party.some(function (m) { return m.me && m.leader; }) && v.together === 1);

  // Asking somebody already in your party is refused on the server too,
  // whatever the near list said when the key went down.
  w.send(A, '/party ff000004');
  yes('S3 the server will not ask somebody already in your party',
      /^Second is already in your party\.$/.test(w.last(A)) && !w.soc.standingOffer(702));

  // Anyone in the party can ask.
  w.send(B, '/party ff000005');
  w.send(C, '/yes');
  yes('S4 somebody who does not lead can ask too', w.members(701).join() === '701,702,703');

  // The leader's three buttons refuse anybody else.
  w.send(B, '/party kick 703');
  yes('S5 Kick from somebody who does not lead is refused',
      /Only the leader can do that/.test(w.last(B)) && w.members(701).length === 3);
  w.send(B, '/party disband');
  yes('S5 and so is Disband', /Only the leader can do that/.test(w.last(B)) && w.members(701).length === 3);

  // Lead, beside a name: the panel sends the profile id.
  w.send(A, '/party lead 702');
  yes('S6 Lead hands the party across', w.soc.partyOf(701).leader === 702);
  w.send(A, '/party kick 703');
  yes('S6 and the one who handed it no longer kicks', /Only the leader can do that/.test(w.last(A)));

  // Kick, beside a name.
  w.send(B, '/party kick 701');
  yes('S7 Kick takes that person out and the party stays',
      !w.soc.partyOf(701) && w.members(702).join() === '702,703');

  // Leave.
  w.send(C, '/party leave');
  yes('S8 Leave takes you out, and a party of one ends',
      /You left the party/.test(w.last(C)) && !w.soc.partyOf(703) && !w.soc.partyOf(702));

  // Disband.
  w.send(A, '/party ff000004');
  w.send(B, '/yes');
  w.send(A, '/party disband');
  yes('S9 Disband ends it for everyone', !w.soc.partyOf(701) && !w.soc.partyOf(702));

  // The line for somebody not in a party never says to type anything.
  w.send(A, '/party');
  yes('S10 not being in a party is answered with the key, not a command',
      /^You are not in a party\. Look at somebody and press the party key/.test(w.last(A)) &&
      w.last(A).indexOf('/party') === -1);
}

// ----------------------------------------------------------- the words
{
  const pw = gm.match(/const PLAYER_WORDS = (\[[\s\S]*?\]);/);
  const ww = gm.match(/^const WORDS = (\[[\s\S]*?\]);$/m);
  let named = [], answered = [];
  try { named = pw ? new Function('return ' + code(pw[1]))() : []; } catch (e) { named = []; }
  try { answered = ww ? new Function('return ' + code(ww[1]))() : []; } catch (e) { answered = []; }
  yes('W1 /party is not in the list of words named to everybody',
      named.indexOf('/helpme') !== -1 && named.indexOf('/party') === -1);
  yes('W1 and the server still answers the line the key and the panel send',
      answered.indexOf('/party') !== -1);
  // Since #1633 the reply ends with helpLine, which names that list.
  yes('W2 the reply to an unknown word reads that same list',
      /'No command called ' \+ word \+ '\. ' \+ helpLine\(profileId\)/.test(gm) &&
      /function helpLine\(profileId\) \{[\s\S]*?PLAYER_WORDS\.join\(', '\)/.test(gm));

  // Every string in the gamemode that says /party is the bare word the
  // handler compares against: no line tells anybody to type it.
  const lits = (code(gm).match(/'[^'\n]*\/party[^'\n]*'/g) || []).filter(function (l, i, all) {
    return all.indexOf(l) === i;
  });
  yes('W3 no line the gamemode says names /party' +
      (lits.length > 1 || (lits.length === 1 && lits[0] !== "'/party'") ? ' (' + lits.join(', ') + ')' : ''),
      lits.length === 1 && lits[0] === "'/party'");

  // The help is a panel since #1633: its People topic, as a fresh install reads it.
  const people = helpTopic('people');
  yes('W4 the help panel\'s People says P on somebody asks them to party',
      !!people && /P asks them to party/.test(people) && people.indexOf('/party') === -1);
}

// --------------------------------------------------- the panel and the pages
{
  const p = code(panel);
  yes('P1 the P panel sends Leave, Disband, Kick, Lead and Ask as the lines the server answers',
      /verb === 'leave'\) \{ net\('\/party leave'\); \}/.test(p) &&
      /verb === 'disband'\) \{ net\('\/party disband'\); \}/.test(p) &&
      /verb === 'kick'\) \{ net\('\/party kick ' \+ who\); \}/.test(p) &&
      /verb === 'lead'\) \{ net\('\/party lead ' \+ who\); \}/.test(p) &&
      /verb === 'ask'\) \{ net\('\/party ' \+ who\); \}/.test(p));
  yes('P2 Kick, Lead and Disband are drawn for the leader only',
      /!m\.me && iLead/.test(p) && /iLead \? '<button data-do="disband">Disband<\/button>'/.test(p));
  yes('P3 the panel says how many of them are here with you',
      /data\.together/.test(p) && /of them are here with you/.test(p));
  yes('P4 the panel\'s own words never say /party', !/<div class="none">[^<]*\/party/.test(panel));

  const partyMd = read('docs', 'systems', 'party.md');
  const chatMd = read('docs', 'systems', 'chat.md');
  const cmdMd = read('docs', 'systems', 'commands.md');
  yes('D1 the party page and the chat page never tell anybody to type /party',
      partyMd.indexOf('/party') === -1 && chatMd.indexOf('/party') === -1);
  const row = cmdMd.split('\n').filter(function (l) { return l.indexOf('| `/party <name>`') === 0; })[0] || '';
  yes('D2 the commands page says where /party went', /Out of the list/.test(row) && /#1629/.test(row));
  yes('D3 the pages have no em dash', (partyMd + chatMd + row).indexOf(String.fromCharCode(0x2014)) === -1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
