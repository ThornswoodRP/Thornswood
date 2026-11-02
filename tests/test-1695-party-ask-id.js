// test-1695-party-ask-id.js
//
// #1695. Ask to party beside a friend on the P panel sent the name the
// friends list stored the day you became friends, and the server looked for
// that name among the people online. A friend whose character ended comes
// back as the same profile on a new character, under a new name: the panel
// showed them online under the old name, and Ask to party answered "Nobody
// here by that name", or reached somebody else who answers to it. Remove
// sent the same stored name.
//
// What this holds:
//   the panel   every button on a friend's row sends the profile id the list
//               is kept by, never the name drawn there
//   the server  /party with a friend's profile id asks whoever that profile
//               is playing now; a friend who is not in the world is refused
//               and said to be away; a profile id that is no friend is
//               refused; Remove by profile id drops exactly that friend
//   the list    shows the name a friend is online under, and the kept name
//               while they are away; so do Muted and hidden and the reply to
//               a journal share
//
// It runs the REAL social and trade blocks, the REAL social branch of
// handle() and the REAL journal verbs out of gamemode.js over a fake mp, and
// the REAL P panel page in a small DOM, and sends the line its button sends.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const gm = process.env.GM ? fs.readFileSync(process.env.GM, 'utf8').split(CR).join('') : read('game', 'gamemode.js');
const panelSrc = read('game', 'ui', 'thornswood-party.js');

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

const social = slice(gm, '// ==== thornswood social:', '// ==== end thornswood social ====');
const trade = slice(gm, '// ==== thornswood trade ====', '// ==== end thornswood trade ====');
const ca = gm.indexOf("    if (word === '/friend' || word === '/party' || word === '/mute' ||");
const cb = ca < 0 ? -1 : gm.indexOf("    if (word === '/rest') {", ca);
const branch = (ca >= 0 && cb >= 0) ? gm.slice(ca, cb) : null;
const journal = slice(gm, '  function journalCommand(soc, actorId, profileId, parts, text) {', '\n  }\n');
yes('the social and trade blocks, the social branch of handle and the journal verbs are in the gamemode',
    social !== null && trade !== null && branch !== null && journal !== null);

// ------------------------------------------------------------ the P panel
/*
  The real page, in a small DOM, the way test-1628-social-gui.js runs it:
  every innerHTML is kept, querySelectorAll hands back the buttons it holds,
  and pressing one runs its real onclick. Returns the line a press sends.
*/
function panel() {
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
  return {
    err: err,
    show: function (view) {
      window.thornswoodParty.setData(JSON.parse(JSON.stringify(view)));
      window.thornswoodParty.open();
      return (cache['#ts-party-body'] || {}).innerHTML || '';
    },
    friendsHtml: function () {
      const html = (cache['#ts-party-body'] || {}).innerHTML || '';
      const a = html.indexOf('<h3>Friends</h3>');
      const b = html.indexOf('<h3>Near you</h3>');
      return a < 0 ? '' : html.slice(a, b < 0 ? html.length : b);
    },
    press: function (label, who) {
      const body = cache['#ts-party-body'];
      const buttons = body ? body.querySelectorAll('button[data-do]') : [];
      const b = buttons.filter(function (x) {
        return x.label === label && (who == null || x.attrs['data-who'] === String(who));
      })[0];
      if (!b) { return 'no button ' + label + ' ' + who; }
      sent.length = 0;
      b.onclick.call(b);
      return sent.join(' | ');
    },
    buttons: function () {
      const body = cache['#ts-party-body'];
      return body ? body.querySelectorAll('button[data-do]') : [];
    }
  };
}

// ------------------------------------------------------------- the world
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
      'JSON', 'isFinite', 'parseInt', require('./fixtures/ordinary-quest-items') + block)(
      g, mp, { now: function () { return 1700000000000; } }, { log: function () { } },
      function () { return 1; }, function () { }, function (n, f) { return f; },
      function (id, line) { said.push({ to: id, line: line }); },
      function () { },
      Math, Number, String, Object, Array, JSON, isFinite, parseInt);
  }
  run(social);
  run(trade);
  const soc = g.__thornswoodSocial;
  const sayTo = function (to, line) { said.push({ to: to, line: line }); };
  const journalCommand = new Function('say', journal + '\nreturn journalCommand;')(sayTo);
  const w = {
    g: g, soc: soc, store: store, said: said,
    person: function (id, name, pid) {
      store[id] = { here: true, profileId: pid, appearance: { name: name },
                    worldOrCellDesc: 'cell:X.esm', pos: [0, 0, 0], inventory: [] };
      return id;
    },
    gone: function (id) { store[id].here = false; },
    send: function (actor, text) {
      const parts = text.split(/\s+/);
      const before = said.length;
      new Function('globalThis', 'actorId', 'profileId', 'parts', 'word',
        'toProfile', 'say', 'notify', 'journalCommand', branch)(
        g, actor, soc.profileOf(actor), parts, parts[0],
        function (pid, line) { said.push({ to: soc.actorForProfile(pid), line: line }); },
        sayTo, function () { }, journalCommand);
      return said.slice(before);
    },
    journal: function (actor, text) {
      return journalCommand(soc, actor, soc.profileOf(actor), text.split(/\s+/));
    },
    last: function (id) {
      const mine = said.filter(function (s) { return s.to === id; });
      return mine.length ? mine[mine.length - 1].line : '';
    }
  };
  return w;
}

if (social && trade && branch && journal) {
  const p = panel();
  yes('the P panel loads' + (p.err ? ' (' + p.err.message + ')' : ''), !p.err);

  const w = world();
  const A = w.person(0xff000001, 'Bjorn', 101);
  const B = w.person(0xff000002, 'Sera', 102);

  // Friends the way the game makes them: Y's line and Accept on the prompt.
  w.send(A, '/friend ff000002');
  w.send(B, '/yes');
  yes('F1 Bjorn and Sera are friends, kept by profile, under the name she had that day',
      w.soc.isFriend(A, 102) && w.soc.stateOf(A).friends[102].name === 'Sera');

  // Her character ends. She comes back on the same profile as Lydia, and a
  // new arrival takes the name Sera.
  w.gone(B);
  const B2 = w.person(0xff000005, 'Lydia', 102);
  const C = w.person(0xff000006, 'Sera', 103);

  let v = w.soc.view(A);
  let row = v.friends.filter(function (f) { return f.p === 102; })[0] || {};
  yes('L1 the friends list shows the name she is online under, and that she is online',
      row.name === 'Lydia' && row.on === true);
  yes('L1 and the stranger who now answers to Sera is not on it',
      v.friends.length === 1 && !v.friends.some(function (f) { return f.p === 103; }));

  // ------------------------------------------- Ask to party, from the panel
  if (!p.err) {
    p.show(v);
    const friends = p.friendsHtml();
    yes('P1 the panel draws her row under the name she is on now', /Lydia/.test(friends) && !/>Sera</.test(friends));
    const line = p.press('Ask to party', 102);
    yes('P2 Ask to party sends her profile id, not a name', line === '/party 102');
    yes('P3 Remove beside her sends her profile id too', p.press('Remove', 102) === '/friend remove 102');
    yes('P4 Mute, Text and Name still send it',
        p.press('Mute', 102) === '/mute 102' && p.press('Text', 102) === '/mute text 102' &&
        p.press('Name', 102) === '/hidename 102');
    const rowButtons = p.buttons().filter(function (b) {
      return ['ask', 'mute', 'mtext', 'mname', 'drop'].indexOf(b.attrs['data-do']) !== -1;
    });
    yes('P5 no button on a friend\'s row carries a name',
        rowButtons.length === 5 && rowButtons.every(function (b) { return b.attrs['data-who'] === '102'; }));

    // The panel's line, through the server.
    w.send(A, line);
    const o = w.soc.standingOffer(102);
    yes('S1 THE DEFECT: the ask reaches her on her new character',
        !!o && o.kind === 'party' && o.from === 101);
    yes('S1 and not the stranger who answers to the name the list kept', !w.soc.standingOffer(103));
    yes('S1 she is told on the prompt, and the asker by the name she is on now',
        /is asking you to join their party/.test(w.last(B2)) && /^Asked Lydia\./.test(w.last(A)));
    w.send(B2, '/yes');
    yes('S2 Accept puts her new character in the party',
        !!w.soc.partyOf(101) && w.soc.partyOf(101).members.join() === '101,102');
    v = w.soc.view(A);
    p.show(v);
    yes('S2 and the panel has no Ask to party beside her any more',
        p.press('Ask to party', 102).indexOf('no button') === 0);
    w.send(A, '/party 102');
    yes('S2 an ask that left as she joined is refused on the server',
        /^Lydia is already in your party\.$/.test(w.last(A)));
    w.send(A, '/party leave');
  }

  // ---------------------------------------- two people with one name
  {
    const w2 = world();
    const X = w2.person(0xff000001, 'Bjorn', 101);
    const Y = w2.person(0xff000002, 'Aela', 102);
    w2.send(X, '/friend ff000002');
    w2.send(Y, '/yes');
    const Z = w2.person(0xff000003, 'Aela', 104);
    w2.send(X, '/party 102');
    yes('T1 with two people online as Aela, the friend\'s profile id reaches the friend',
        !!w2.soc.standingOffer(102) && !w2.soc.standingOffer(104));
    w2.send(X, '/party Aela');
    yes('T1 where a name could only say more than one person answers to it',
        /More than one person here answers to that/.test(w2.last(X)));
    yes('T1 nobody else was asked', !w2.soc.standingOffer(104) && Z > 0);
  }

  // -------------------------------------------------------- the refusals
  {
    // She logs off between the panel drawing and the press.
    w.gone(B2);
    delete w.soc.offers[102];
    const out = w.send(A, '/party 102');
    yes('R1 a friend who is not in the world is refused, honestly',
        out.length === 1 && out[0].to === A && /^Sera is not in the world right now\.$/.test(out[0].line));
    yes('R1 and nobody is asked, not even the stranger who answers to Sera',
        !w.soc.standingOffer(102) && !w.soc.standingOffer(103));
    v = w.soc.view(A);
    row = v.friends.filter(function (f) { return f.p === 102; })[0] || {};
    yes('R1 while she is away the list shows the name it kept, as away', row.name === 'Sera' && row.on === false);

    w.send(A, '/party 103');
    yes('R2 a profile id that is no friend is refused, and nobody is asked',
        /^They are not on your friends list\.$/.test(w.last(A)) && !w.soc.standingOffer(103));
    w.send(A, '/party 101');
    yes('R3 nor is your own', /not on your friends list|That is you/.test(w.last(A)) && !w.soc.standingOffer(101));
    w.send(A, '/party ff000006');
    yes('R4 P on somebody still asks them by form id, friend or not',
        !!w.soc.standingOffer(103) && w.soc.standingOffer(103).from === 101);
    delete w.soc.offers[103];
  }

  // ------------------------------------- the name beside her elsewhere
  {
    const B3 = w.person(0xff000007, 'Lydia', 102);
    w.send(A, '/mute 102');
    yes('N1 muting her names her as she is now',
        /^You muted Lydia\.$/.test(w.last(A)) && w.soc.stateOf(A).muted[102] === 'Lydia');
    const hid = (w.soc.view(A).hidden || []).filter(function (r) { return r.p === 102; })[0] || {};
    yes('N1 and Muted and hidden lists her under that name', hid.name === 'Lydia');
    w.send(A, '/mute 102');

    const made = w.journal(A, '/journal new Notes');
    const book = w.soc.stateOf(A).journals[0];
    const shared = w.journal(A, '/journal share ' + (book && book.id) + ' - 102');
    yes('N2 sharing a journal with her names her as she is now', /Started/.test(made) && shared === 'Shared with Lydia.');
    yes('N2 and she is told', /shared a journal with you/.test(w.last(B3)));
    w.gone(B3);
  }

  // ------------------------------------------------------------- Remove
  {
    w.send(A, '/friend remove 103');
    yes('D1 Remove with a profile id that is no friend drops nobody',
        /^They are not on your friends list\.$/.test(w.last(A)) && w.soc.isFriend(A, 102));
    w.send(A, '/friend remove 102');
    yes('D2 Remove by profile id drops her while she is away, by the name the list shows',
        !w.soc.isFriend(A, 102) && /^Sera is no longer on your list\.$/.test(w.last(A)));

    // On her new character, online: the name the row shows is not the one kept.
    const w3 = world();
    const X = w3.person(0xff000001, 'Bjorn', 101);
    const Y = w3.person(0xff000002, 'Sera', 102);
    w3.send(X, '/friend ff000002');
    w3.send(Y, '/yes');
    w3.gone(Y);
    w3.person(0xff000003, 'Lydia', 102);
    w3.send(X, '/friend remove 102');
    yes('D3 Remove beside a friend on a new character drops her, named as she is now',
        !w3.soc.isFriend(X, 102) && /^Lydia is no longer on your list\.$/.test(w3.last(X)));
    yes('D3 and only from your own list', w3.soc.isFriend(Y, 101));
  }
}

// ---------------------------------------------------------- the words
{
  const fn = slice(gm, '  function friendNow(actorId, pid) {', '\n  }\n') || '';
  const lines = (fn + (branch || '')).match(/'[^'\n]*'/g) || [];
  yes('W1 the refusals are in the server',
      /'They are not on your friends list\.'/.test(fn) && /' is not in the world right now\.'/.test(fn) &&
      /'They are not on your friends list\.'/.test(branch || ''));
  yes('W2 no line the server says here has the banned word or an em dash',
      lines.length > 0 && lines.every(function (l) {
        return !/\bplayers?\b/i.test(l) && l.indexOf(String.fromCharCode(0x2014)) === -1;
      }));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
