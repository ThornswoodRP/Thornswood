// test-1628-social-gui.js
//
// #1628. Friends, trade, mutes and answering an offer are keys and panels,
// never /friend, /trade, /mute, /hidename, /yes or /no typed in the chat.
// Patrick, 4 Oct: "no more commands for things [people] do, only for dev and
// staff commands; everything else takes buttons and GUI".
//
// What this holds:
//   the help    none of the six words is named to everybody: not in
//               PLAYER_WORDS (which /help and the unknown word reply read),
//               not in /help, not in the body of the system pages (the
//               launcher's Help page, held to the same, went with #3146)
//   the server  it still answers every line the keys and panels send,
//               because removing a word from the help must not stop the
//               server answering the panel (the trap on the issue)
//   Near you    the P panel lists the people the look prompt can see, from
//               the same thornswoodNear list, with Add friend, Trade, Mute,
//               Text and Name, and each one does what Y, H and L do
//   Muted and   everybody switched off, friend or not, online or not, and
//   hidden      each switch turns back on from the panel, including for
//               somebody who has logged off (a voice mute used to need them
//               standing there)
//
// It runs the REAL social and trade blocks and the REAL command branch out of
// gamemode.js over a fake mp, and the REAL P panel page in a small DOM, and
// presses its buttons.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const src = read('game', 'gamemode.js');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
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
const panelSrc = read('game', 'ui', 'thornswood-party.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function lift(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}
function code(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SIX = ['/friend', '/trade', '/mute', '/hidename', '/yes', '/no'];
function namesAny(text) {
  return SIX.filter(function (w) { return new RegExp('(^|[^a-z0-9])' + w + '\\b').test(text); });
}

// ------------------------------------------------------------- the help
function list(name) {
  const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(src);
  try { return m ? new Function('return ' + code(m[1]))() : null; } catch (e) { return null; }
}
const WORDS = list('WORDS');
const PLAYER_WORDS = list('PLAYER_WORDS');
yes('WORDS and PLAYER_WORDS read', !!WORDS && !!PLAYER_WORDS && PLAYER_WORDS.indexOf('/helpme') !== -1);
if (WORDS && PLAYER_WORDS) {
  const told = SIX.filter(function (w) { return PLAYER_WORDS.indexOf(w) !== -1; });
  yes('none of the six is on the list named to everybody' + (told.length ? ' (still: ' + told.join(', ') + ')' : ''),
      told.length === 0);
  const deaf = SIX.filter(function (w) { return WORDS.indexOf(w) === -1; });
  yes('and all six are still words the server answers, for the keys and panels' +
      (deaf.length ? ' (not: ' + deaf.join(', ') + ')' : ''), deaf.length === 0);
  yes('/stuck, /helpme and /report stay named to everybody (#1682)',
      ['/stuck', '/helpme', '/report'].every(function (w) { return PLAYER_WORDS.indexOf(w) !== -1; }));
}

const helpBlock = lift("if (word === '/help' || word === '/commands') {", '// Anything else beginning with a slash');
yes('the /help block is in the gamemode', !!helpBlock);
if (helpBlock) {
  const strings = (helpBlock.match(/'(?:[^'\\]|\\.)*'/g) || []).join(' ');
  const named = namesAny(strings);
  yes('/help names none of the six' + (named.length ? ' (names: ' + named.join(', ') + ')' : ''), named.length === 0);
  // The help is a panel since #1633: its People topic, as a fresh install reads it.
  const people = helpTopic('people');
  yes('the help panel\'s People names none of the six, and says a request is answered with Accept or Refuse on its prompt',
      namesAny(people).length === 0 && /Answer a request with Accept or Refuse on its prompt\./.test(people));
}

/*
  The pages. Above "Where this is" is what a person reads as how to do it, and
  none of the six is there. Below it, a page may say which line a key sends.
*/
['friends.md', 'trade.md', 'voice.md', 'people.md', 'factions.md', 'chat.md'].forEach(function (page) {
  const text = read('docs', 'systems', page);
  const cut = text.indexOf('## Where this is');
  const body = cut < 0 ? text : text.slice(0, cut);
  const named = namesAny(body);
  yes('docs/systems/' + page + ' tells nobody to type the six' + (named.length ? ' (names: ' + named.join(', ') + ')' : ''),
      named.length === 0);
});

// ------------------------------------------------- the real blocks, over mp
const social = lift('// ==== thornswood social:', '// ==== end thornswood social ====');
const trade = lift('// ==== thornswood trade ====', '// ==== end thornswood trade ====');
const ca = src.indexOf("    if (word === '/friend' || word === '/party' || word === '/mute' ||");
const cb = ca < 0 ? -1 : src.indexOf("    if (word === '/rest') {", ca);
const commands = (ca >= 0 && cb > ca) ? src.slice(ca, cb) : null;
yes('the social block, the trade block and the social commands are in the gamemode',
    !!social && !!trade && !!commands);

function world() {
  const store = {};
  const clock = { now: 1700000000000 };
  const said = [];
  const timers = [];
  const properties = {};
  const g = {};
  const mp = {
    makeProperty: function (name, config) { properties[name] = config; },
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
      if (key === 'inventory') { store[id].inventory = (v && v.entries) || []; return; }
      store[id][key] = v;
    },
    lookupEspmRecordById: function () { return null; }
  };
  function run(block) {
    return new Function(
      'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
      'guard', 'say', 'notify', 'Math', 'Number', 'String', 'Object', 'Array',
      'JSON', 'isFinite', 'parseInt',
      require('../../tests/fixtures/ordinary-quest-items') + block)(
      g, mp, { now: function () { return clock.now; } },
      { log: function () { } },
      function (f) { timers.push(f); return timers.length; }, function () { },
      function (n, f) { return f; },
      function (id, line) { said.push({ to: id, line: line }); },
      function (id, line) { said.push({ to: id, line: line }); },
      Math, Number, String, Object, Array, JSON, isFinite, parseInt);
  }
  run(social);
  run(trade);
  const w = {
    g: g, soc: g.__thornswoodSocial, trade: g.__thornswoodTrade, store: store, clock: clock, said: said,
    person: function (id, name, pid, pos) {
      store[id] = { here: true, profileId: pid, appearance: { name: name },
                    worldOrCellDesc: 'town:X.esm', pos: pos || [0, 0, 0], inventory: [] };
      return id;
    },
    gone: function (id) { store[id].here = false; },
    lines: function (id) { return said.filter(function (s) { return s.to === id; }).map(function (s) { return s.line; }); },
    last: function (id) { const l = w.lines(id); return l[l.length - 1] || ''; },
    /* One line, as the panel or a key sends it through the chat connection. */
    send: function (actor, text) {
      const parts = text.split(/\s+/);
      new Function('globalThis', 'actorId', 'profileId', 'parts', 'word',
        'toProfile', 'say', 'notify', 'journalCommand', commands)(
        g, actor, w.soc.profileOf(actor), parts, parts[0],
        function (pid, line) { said.push({ to: w.soc.actorForProfile(pid), line: line }); },
        function (to, line) { said.push({ to: to, line: line }); }, function () { }, function () { });
    }
  };
  return w;
}

if (social && trade && commands) {
  const A = 0xff000001, B = 0xff000002, C = 0xff000003, D = 0xff000004;
  const hexB = B.toString(16), hexC = C.toString(16), hexA = A.toString(16);

  // ---------------------------------------------------------- Near you
  {
    const w = world();
    w.person(A, 'Bjorn', 101, [0, 0, 0]);
    w.person(B, 'Sera', 102, [200, 0, 0]);
    w.person(C, 'Aela', 103, [300, 0, 0]);
    w.person(D, 'Far', 104, [90000, 0, 0]);
    w.soc.nearTick();
    const v = w.soc.view(A);
    const ids = (v.near || []).map(function (r) { return r.id; });
    yes('N1 Near you is the look prompt\'s near list: the two standing close',
        ids.length === 2 && ids.indexOf(hexB) !== -1 && ids.indexOf(hexC) !== -1);
    yes('N1 not somebody across the hold, and not yourself',
        ids.indexOf(D.toString(16)) === -1 && ids.indexOf(hexA) === -1);
    const sera = (v.near || []).filter(function (r) { return r.id === hexB; })[0] || {};
    yes('N1 each row carries the form id the keys send, the profile id and the name',
        sera.p === 102 && sera.name === 'Sera' && Object.keys(w.store[A].thornswoodNear.w).indexOf(sera.id) !== -1);
    yes('N1 and starts with nothing switched off and no friend',
        !sera.friend && !sera.muted && !sera.textOff && !sera.nameOff);
    yes('N1 sorted by name', (v.near || []).length > 0 && v.near[0].name === 'Aela');

    // Add friend sends what Y sends, and Accept on the prompt answers it.
    w.send(A, '/friend ' + hexB);
    yes('N2 Add friend asks them, the way Y does',
        !!w.soc.standingOffer(102) && w.soc.standingOffer(102).kind === 'friend' && /Asked Sera/.test(w.last(A)));
    yes('N2 and they are told to use the prompt, not to type',
        /Accept or refuse on the prompt\./.test(w.last(B)) && namesAny(w.last(B)).length === 0);
    w.send(B, '/yes');
    yes('N2 Accept on the prompt still lands it: the server answers the line the prompt sends',
        w.soc.isFriend(A, 102) && w.soc.isFriend(B, 101));
    w.soc.nearTick();
    const after = w.soc.view(A).near.filter(function (r) { return r.id === hexB; })[0] || {};
    yes('N2 and the row says friend, so the panel drops Add friend', after.friend === true);

    // Refuse.
    w.send(A, '/friend ' + hexC);
    w.send(C, '/no');
    yes('N3 Refuse on the prompt turns it down, and nothing is written',
        !w.soc.standingOffer(103) && !w.soc.isFriend(A, 103) && /You turned Bjorn down\./.test(w.last(C)));

    // Text and Name for somebody who is not a friend: the gap on the issue.
    w.send(A, '/mute text 103');
    w.send(A, '/hidename 103');
    w.send(A, '/mute 103');
    const st = w.soc.stateOf(A);
    yes('N4 Text, Name and Mute work on somebody near who is not a friend',
        st.textOff[103] === 'Aela' && st.namesOff[103] === 'Aela' && st.muted[103] === 'Aela');
    yes('N4 each kept under their name, not a number',
        /Aela/.test(w.lines(A).slice(-3).join(' ')) && !/103/.test(w.lines(A).slice(-3).join(' ')));
    const aela = w.soc.view(A).near.filter(function (r) { return r.id === hexC; })[0] || {};
    yes('N4 and the Near you row shows all three on, for the panel\'s labels',
        aela.muted && aela.textOff && aela.nameOff);

    // Trade sends what H sends, and the trade window's verbs are still answered.
    w.send(A, '/trade ' + hexB);
    yes('N5 Trade asks them, the way H does', w.soc.standingOffer(102) && w.soc.standingOffer(102).kind === 'trade');
    w.send(B, '/yes');
    yes('N5 Accept starts the trade', !!w.trade.tradeOf(A) && w.trade.tradeOf(A) === w.trade.tradeOf(B));
    const before = w.store[A].thornswoodTrade.at;
    w.store[A].thornswoodTrade = { open: false, at: before };   // the window closed on this side
    w.send(A, '/trade ' + hexC);
    yes('N6 asking again while a trade stands starts no second one',
        !w.soc.standingOffer(103) && w.trade.tradeOf(A) === w.trade.tradeOf(B));
    yes('N6 and sends the open trade\'s window again, so Walk away is back',
        w.store[A].thornswoodTrade.open === true && w.store[A].thornswoodTrade.at > before);
    yes('N6 and says so without teaching a typed verb',
        /already in a trade/.test(w.last(A)) && !/add, remove/.test(w.last(A)) && namesAny(w.last(A)).length === 0);
    w.send(A, '/trade cancel');
    yes('N7 Walk away still ends it: the server answers the window\'s line', !w.trade.tradeOf(A) && !w.trade.tradeOf(B));
  }

  // -------------------------------------------------- Muted and hidden
  {
    const w = world();
    w.person(A, 'Bjorn', 101, [0, 0, 0]);
    w.person(B, 'Sera', 102, [200, 0, 0]);
    w.person(C, 'Serana', 103, [300, 0, 0]);
    w.soc.nearTick();
    w.soc.addFriend(A, B);
    w.soc.addFriend(A, C);
    w.send(A, '/mute 102');
    yes('H1 a friend\'s Mute goes by profile id: Sera, with Serana also a friend',
        w.soc.stateOf(A).muted[102] === 'Sera' && !w.soc.stateOf(A).muted[103]);
    w.send(A, '/mute text ' + hexC);
    w.soc.stateOf(A).namesOff[150] = true;          // switched off before names were kept
    w.soc.write(A, w.soc.stateOf(A));
    let v = w.soc.view(A);
    const names = (v.hidden || []).map(function (r) { return r.name; });
    yes('H2 Muted and hidden lists everybody switched off, friend or not',
        names.length === 3 && names.indexOf('Sera') !== -1 && names.indexOf('Serana') !== -1);
    const sera = v.hidden.filter(function (r) { return r.p === 102; })[0] || {};
    const serana = v.hidden.filter(function (r) { return r.p === 103; })[0] || {};
    yes('H2 each row says which of the three is off, one person at a time',
        sera.muted && !sera.textOff && !sera.nameOff && serana.textOff && !serana.muted);
    const legacy = v.hidden.filter(function (r) { return r.p === 150; })[0] || {};
    yes('H2 a switch kept with no name still has a row, so it can be turned back on',
        legacy.name === 'somebody' && legacy.nameOff === true && legacy.on === false);

    // They log off. The switches have to come back on from the panel.
    w.gone(B);
    w.gone(C);
    v = w.soc.view(A);
    yes('H3 somebody who logged off stays on the list, by name, as away',
        v.hidden.some(function (r) { return r.p === 102 && r.name === 'Sera' && r.on === false; }));
    w.send(A, '/mute 102');
    yes('H3 THE TRAP: Unmute works on somebody who is not online (it needed them standing there)',
        !w.soc.stateOf(A).muted[102] && /You unmuted Sera\./.test(w.last(A)));
    w.send(A, '/mute text 103');
    w.send(A, '/hidename 150');
    v = w.soc.view(A);
    yes('H3 Read and Show turn the rest back on, and the list is empty',
        v.hidden.length === 0 && !w.soc.stateOf(A).textOff[103] && !w.soc.stateOf(A).namesOff[150]);

    // Not yourself.
    w.send(A, '/mute 101');
    yes('H4 a switch on yourself is refused, by profile id', /That is you\./.test(w.last(A)) && !w.soc.stateOf(A).muted[101]);
    w.send(A, '/mute text ' + hexA);
    yes('H4 and by form id', /That is you\./.test(w.last(A)) && !w.soc.stateOf(A).textOff[101]);

    // Hide every name is still answered.
    w.send(A, '/hidename all');
    yes('H5 Hide every name is still answered', w.soc.stateOf(A).namesAll === true);
  }
}

// ---------------------------------------------------------- the P panel
/*
  The real page, in a small DOM. Every innerHTML is kept, querySelectorAll
  hands back the buttons it holds, and pressing one runs its real onclick.
*/
{
  const cache = {};
  function element(tag) {
    const el = {
      tagName: tag, id: '', className: '', children: [], textContent: '', innerHTML: '',
      style: { cssText: '', display: '' },
      appendChild: function (c) { el.children.push(c); return c; },
      addEventListener: function () { }, removeEventListener: function () { },
      setAttribute: function () { },
      querySelector: function (sel) { return cache[sel] || (cache[sel] = element('div')); },
      querySelectorAll: function (sel) {
        if (sel !== 'button[data-do]') { return []; }
        // The same objects until the html changes, so a press finds the
        // onclick the page put on them.
        if (el.found && el.found.html === el.innerHTML) { return el.found.list; }
        const out = [];
        const re = /<button([^>]*)>([^<]*)<\/button>/g;
        let m;
        while ((m = re.exec(el.innerHTML)) !== null) {
          const attrs = {};
          m[1].replace(/([a-z-]+)="([^"]*)"/g, function (all, k, v) { attrs[k] = v; return all; });
          if (!attrs['data-do']) { continue; }
          out.push({ label: m[2], attrs: attrs, getAttribute: function (k) { return this.attrs[k] || null; } });
        }
        el.found = { html: el.innerHTML, list: out };
        return out;
      },
      classList: { add: function () { }, remove: function () { }, toggle: function () { } }
    };
    return el;
  }
  const sent = [];
  const window = {
    thornswoodNet: { say: function (line) { sent.push(line); return true; } },
    skyrimPlatform: { sendMessage: function () { } }
  };
  const document = {
    head: element('head'), body: element('body'),
    createElement: element, getElementById: function () { return null; },
    addEventListener: function () { }, querySelector: function () { return null; }
  };
  const sandbox = {
    window: window, document: document, console: { log: function () { } },
    setInterval: function () { return 1; }, clearInterval: function () { },
    setTimeout: function () { return 0; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let err = null;
  try { vm.runInContext(panelSrc, sandbox, { filename: 'thornswood-party.js' }); } catch (e) { err = e; }
  yes('P1 the P panel loads' + (err ? ' (' + err.message + ')' : ''), !err && !!window.thornswoodParty);

  if (!err && window.thornswoodParty) {
    const P = window.thornswoodParty;
    P.setData({
      me: 101, party: [], together: 0, bonus: 15, namesAll: false,
      friends: [{ p: 102, name: 'Sera', on: true, muted: false, textOff: false, nameOff: false, party: false }],
      near: [
        { id: 'ff000002', p: 102, name: 'Sera', friend: true, party: false, muted: false, textOff: false, nameOff: false },
        { id: 'ff000003', p: 103, name: 'Aela', friend: false, party: false, muted: true, textOff: false, nameOff: true }
      ],
      hidden: [{ p: 103, name: 'Aela', on: true, muted: true, textOff: false, nameOff: true },
               { p: 150, name: 'Olfrid', on: false, muted: false, textOff: true, nameOff: false }],
      offer: { kind: 'friend', from: 104, name: 'Brynjolf' }
    });
    P.open();
    const body = cache['#ts-party-body'];
    const html = body ? body.innerHTML : '';
    yes('P2 the panel draws Near you and Muted and hidden',
        html.indexOf('<h3>Near you</h3>') !== -1 && html.indexOf('<h3>Muted and hidden</h3>') !== -1);
    const near = html.slice(html.indexOf('<h3>Near you</h3>'), html.indexOf('<h3>Muted and hidden</h3>'));
    const hidden = html.slice(html.indexOf('<h3>Muted and hidden</h3>'));
    const aelaRow = near.slice(near.indexOf('Aela'));
    yes('P2 a person near who is not a friend has Add friend, Trade, Mute, Text and Name',
        /Add friend[\s\S]*Trade[\s\S]*Unmute[\s\S]*Text[\s\S]*Show/.test(aelaRow));
    const seraRow = near.slice(near.indexOf('Sera'), near.indexOf('Aela') < near.indexOf('Sera') ? near.length : near.indexOf('Aela'));
    yes('P2 a friend near has no Add friend, and a friend tag', seraRow.indexOf('Add friend') === -1 && /tag">friend</.test(seraRow));
    yes('P2 Muted and hidden has both, with their switches', /Aela/.test(hidden) && /Olfrid/.test(hidden) && /Read/.test(hidden));

    const buttons = body.querySelectorAll('button[data-do]');
    function press(label, who) {
      const b = buttons.filter(function (x) { return x.label === label && (who == null || x.attrs['data-who'] === String(who)); })[0];
      if (!b) { return 'no button ' + label + ' ' + who; }
      sent.length = 0;
      // The page sets onclick on the object it got from querySelectorAll.
      b.onclick.call(b);
      return sent.join(' | ');
    }
    yes('P3 Add friend sends the friend line with the form id, as Y does', press('Add friend', 'ff000003') === '/friend ff000003');
    yes('P3 Trade sends the trade line with the form id, as H does', press('Trade', 'ff000003') === '/trade ff000003');
    yes('P3 Unmute sends the profile id', press('Unmute', 103) === '/mute 103');
    yes('P3 Text sends the text switch by profile id', press('Text', 103) === '/mute text 103');
    yes('P3 Show sends the name switch by profile id', press('Show', 103) === '/hidename 103');
    yes('P3 Read on somebody away sends the text switch for them', press('Read', 150) === '/mute text 150');
    yes('P3 a friend\'s Mute sends the profile id, the same as Text and Name',
        press('Mute', 102) === '/mute 102');
    yes('P4 Accept and Refuse on the panel send the answer lines',
        press('Accept') === '/yes' && press('Refuse') === '/no');

    const words = html.replace(/<[^>]*>/g, ' ');
    yes('P5 the panel tells nobody to type the six', namesAny(words).length === 0);
    yes('P5 and never says player', !/\bplayers?\b/i.test(words + ' ' + panelSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
