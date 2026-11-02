// test-1630-journal-gui.js
//
// #1630. Journals and group books are J only. Patrick, 4 Oct: "no more
// commands for things [people] do, only for dev and staff commands;
// everything else takes buttons and GUI". The J panel sends every /journal
// and /book line, and the server keeps answering them, but nobody is told to
// type them: they are out of the list of words named to everybody, out of
// /help people, out of the server's own answers and out of the pages.
//
// What J lacked, and has now, is run here: Invite for the person in front of
// you (the plugin hands the panel who the look prompt was drawn for as J
// opens), each role's permissions as buttons, Rename role, and Remove for
// whoever holds Invite. The server half is the real thornswoodBooks() and the
// real social offer, taken out of game/gamemode.js.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const gm = read('game', 'gamemode.js');
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
const journalSrc = read('game', 'ui', 'thornswood-journal.js');
const front = read('game', 'plugins', 'thornswood-front.js');

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
  return String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"]*$/gm, '');
}
function list(name) {
  const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(gm);
  try { return m ? new Function('return ' + m[1])() : []; } catch (e) { return []; }
}

// ------------------------------------------------- A. nobody is told to type
{
  const W = list('WORDS');
  const PW = list('PLAYER_WORDS');
  yes('A1: the server still answers /journal and /book, the lines J sends',
      W.indexOf('/journal') !== -1 && W.indexOf('/book') !== -1 &&
      gm.indexOf("if (word === '/book') {") !== -1 && gm.indexOf("if (word === '/journal') {") !== -1);
  yes('A2: neither is on the list of words named to everybody (/help, the unknown word reply)',
      PW.indexOf('/helpme') !== -1 && PW.indexOf('/journal') === -1 && PW.indexOf('/book') === -1);

  // The help is a panel since #1633: its People topic, as a fresh install reads it.
  const people = helpTopic('people');
  yes('A3: the help panel\'s People names J and its buttons for a group book, and no /book line',
      !!people && /J opens your journals/.test(people) && /New business and New faction/.test(people) &&
      /Leave there/.test(people) && !/\/book/.test(people) && !/\/journal/.test(people));

  const jc = slice(gm, '  function journalCommand(soc, actorId, profileId, parts, text) {', '\n  }\n');
  let empty = '';
  try {
    empty = new Function('return ' + jc.trim())()({ stateOf: function () { return { journals: [] }; } }, 1, 1, ['/journal']);
  } catch (e) { empty = 'threw ' + e.message; }
  yes('A4: the answer with no journals points at J, not at a line to type',
      /^No journals yet\. J opens them/.test(empty) && !/\//.test(empty));

  const told = [];
  const lit = /'([^'\n]*)'/g;
  const plain = code(gm);
  let m;
  while ((m = lit.exec(plain)) !== null) {
    if (/\/(journal|book) [a-z<]/i.test(m[1])) { told.push(m[1].slice(0, 60)); }
  }
  yes('A5: no line the server says tells anybody to type /journal or /book' +
      (told.length ? ' (' + told.join('; ') + ')' : ''), told.length === 0);

  const pages = {
    'docs/systems/journal.md': read('docs', 'systems', 'journal.md'),
    'docs/systems/factions.md': read('docs', 'systems', 'factions.md'),
    'docs/systems/chat.md': read('docs', 'systems', 'chat.md'),
    'site/data/help.md': read('site', 'data', 'help.md')
  };
  const naming = Object.keys(pages).filter(function (p) { return /\/journal\b|\/book\b/.test(pages[p]); });
  yes('A6: the pages and the site\'s help name neither' + (naming.length ? ' (' + naming.join(', ') + ')' : ''),
      naming.length === 0);
  yes('A7: factions.md says the person in front of you is invited on J, and the P prompt names the book',
      /Open J while\s+looking at them/.test(pages['docs/systems/factions.md']) &&
      /P\s+prompt, which names the book/.test(pages['docs/systems/factions.md']));
}

// -------------------------------------------- B. the books block, as J uses it
const bStart = gm.indexOf('/* BOOKS-START */');
const bEnd = gm.indexOf('/* BOOKS-END */');
const block = bStart >= 0 && bEnd > bStart ? gm.slice(bStart, bEnd) : '';
yes('B0: the books block is in gamemode.js', /function thornswoodBooks\(/.test(block));

const offered = [];
function makeBooks(dir) {
  const box = {
    globalThis: null,
    env: {
      fs: fs, path: path, privDir: dir,
      now: function () { return 1700000000000; },
      roles: function (pid) {
        if (Number(pid) === 1) { return { business: true, faction: true, staff: false, account: 'acct-a' }; }
        return { business: false, faction: false, staff: false, account: 'p:' + pid };
      },
      silenced: function () { return false; },
      nameOf: function (actorId, pid) { return Number(pid) === 1 ? 'Ada' : (Number(pid) === 4 ? 'Bjorn' : 'M' + pid); },
      // The look prompt's form id, the same hex Y, H and L send, is a person.
      find: function (actorId, who) {
        if (who === 'ff000004') { return { actorId: 0xff000004, pid: 4, name: 'Bjorn', why: '' }; }
        const n = Number(who);
        if (!n) { return { actorId: 0, pid: 0, name: '', why: 'Nobody here by that name.' }; }
        return { actorId: 50 + n, pid: n, name: 'M' + n, why: '' };
      },
      offer: function (from, to, about) { offered.push({ from: from, to: to, about: about }); return ''; },
      refresh: function () { },
      online: function () { return {}; },
      atBox: function () { return ''; }
    }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(block + '\nthis.api = thornswoodBooks(env);', box, { filename: 'books.js' });
  return box.api;
}
function parts(line) { return line.trim().split(/\s+/); }

if (block) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-1630-'));
  const api = makeBooks(dir);
  function say(pid, line) { return api.command({ actorId: pid, profileId: pid, parts: parts(line) }); }
  yes('B1: New business on J founds one', say(1, '/book new business The Bee') === 'Founded The Bee.');
  const bee = api.books()[0];

  const ownerView = api.view(1, {});
  const ob = ownerView.books[0];
  yes('B2: the view names the five permissions, for the role buttons',
      JSON.stringify(ownerView.permNames) === '["Read","Prices","Invite","Roles","Speak"]');
  yes('B3: and whoever sets roles gets each role with what it may do',
      JSON.stringify(ob.roles) === '[{"name":"Member","perms":["Read","Speak"]}]');

  const asked = say(1, '/book invite ' + bee.id + ' ff000004');
  yes('B4: Invite for the person in front of you sends their form id, and the server finds them',
      /You asked Bjorn/.test(asked));
  yes('B5: the offer carries which book, for the P prompt (#1591)',
      offered.length === 1 && offered[0].about === 'the business The Bee');
  yes('B6: and accepting joins it', api.accept(4, 'Bjorn').ok === true);
  yes('B7: a member who may not set roles is not sent the roles',
      JSON.stringify(api.view(4, {}).books[0].roles) === '[]');

  // The lines a role button sends: the role's whole list with one switched.
  yes('B8: a permission button adds one', say(1, '/book role ' + bee.id + ' perm | Member | Read Speak Invite') === 'Set Member.');
  yes('B9: and the role holds exactly that list',
      JSON.stringify(api.books()[0].roles[0].perms) === '["Read","Speak","Invite"]');
  // Invite also removes someone who is not the owner (factions.md, Roles).
  say(1, '/book invite ' + bee.id + ' 5');
  api.accept(5, 'M5');
  yes('B10: someone with Invite and not Roles can remove someone, as the panel now offers',
      say(4, '/book member ' + bee.id + ' remove | M5') === 'Removed M5.');
  yes('B11: but not set a role', /cannot set roles/.test(say(4, '/book member ' + bee.id + ' role | Bjorn | Member')));
  yes('B12: switching the last one off leaves a role that may do nothing',
      say(1, '/book role ' + bee.id + ' perm | Member |') === 'Set Member.' &&
      JSON.stringify(api.books()[0].roles[0].perms) === '[]');
  say(1, '/book role ' + bee.id + ' new | Clerk');
  yes('B13: Rename role sends the old name and the new one',
      say(1, '/book role ' + bee.id + ' rename | Clerk | Steward') === 'Renamed Clerk to Steward.');
  yes('B14: a member cannot switch a role\'s permissions',
      /cannot set roles/.test(say(4, '/book role ' + bee.id + ' perm | Member | Read Roles')));
  const unknown = say(1, '/book');
  yes('B15: a line the book does not know points at J, and teaches no /book line',
      unknown === 'The group book is on J.');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

// --------------------------------------------- C. the social offer names it
{
  const off = slice(gm, '  function offer(kind, fromActor, toActor, about) {', '\n  }\n');
  const stand = slice(gm, '  function standingOffer(toPid) {', '\n  }\n');
  let o = null;
  try {
    const run = new Function('profileOf', 'nameOfPerson', 'SOCIAL',
      'var offers = {};' + off + stand + 'return { offer: offer, standingOffer: standingOffer };')(
      function (a) { return a === 11 ? 1 : 4; }, function () { return 'Ada'; }, { offerFor: 45000 });
    run.offer('book', 11, 44, 'the faction The North Gate');
    o = run.standingOffer(4);
    run.offer('friend', 11, 44);
    o = { book: o, friend: run.standingOffer(4) };
  } catch (e) { o = null; }
  yes('C1: a book offer keeps what it is into, and another offer has none',
      !!o && o.book && o.book.kind === 'book' && o.book.about === 'the faction The North Gate' &&
      o.friend && o.friend.about === '');
  yes('C2: the P panel is handed it with the offer',
      /offer: offerNow \? \{ kind: offerNow\.kind, from: offerNow\.from, name: offerNow\.fromName,\s*about: offerNow\.about \|\| '' \} : null,/.test(gm));
  yes('C3: the books block hands the social offer the book (#1591)',
      /soc\.offer\('book', actorId, hit\.actorId, about\)/.test(block));
}

// -------------------------------------- D. the plugin tells J who is in front
{
  const src = slice(front, "  sp.on('browserMessage', guard('journal facing', (event) => {", '\n  }));\n');
  yes('D0: the plugin has a listener of its own for J opening', !!src);
  const handlers = [];
  const page = { got: [] };
  page.thornswoodJournal = { setFacing: function (f) { page.got.push(f); } };
  const T = { js: function (c) { new Function('window', c)(page); return true; } };
  const near = { ff000004: { n: 'Bjorn' } };
  // The handler reads the look prompt's own lookingAt, kept here in its scope.
  let setLooking = function () { };
  try {
    setLooking = new Function('sp', 'guard', 'nearList', 'T',
      "var lookingAt = '';\n" + src + '\nreturn function (v) { lookingAt = v; };')(
      { on: function (what, fn) { handlers.push({ what: what, fn: fn }); } },
      function (name, fn) { return fn; },
      function () { return near; }, T);
  } catch (e) { console.log('     ' + e.message); }
  const h = handlers[0] && handlers[0].what === 'browserMessage' && handlers[0].fn;
  if (h) {
    setLooking('ff000004');
    h({ arguments: ['thornswood-front', 'party:opened'] });
    yes('D1: another panel opening tells J nothing', page.got.length === 0);
    h({ arguments: ['thornswood-front', 'journal:opened'] });
    yes('D2: J opening while somebody is under the crosshair hands J their id and name',
        page.got.length === 1 && page.got[0] && page.got[0].id === 'ff000004' && page.got[0].name === 'Bjorn');
    setLooking('');
    h({ arguments: ['thornswood-front', 'journal:opened'] });
    yes('D3: nobody in front clears it', page.got.length === 2 && page.got[1] === null);
    setLooking('ff000009');
    h({ arguments: ['thornswood-front', 'journal:opened'] });
    yes('D4: something not on the server\'s near list is nobody', page.got.length === 3 && page.got[2] === null);
  } else {
    yes('D1: the listener runs', false);
  }
  yes('D5: the J key handling is not where this lives (#1016)',
      !!src && front.indexOf("guard('journal facing'") > front.indexOf('function sleepPress()') &&
      front.indexOf("guard('journal facing'") < front.indexOf('J is our journal alone'));
}

// ---------------------------------------------- E. the J panel, pressed
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag).toLowerCase(), attrs: {}, kids: [], children: [], html: '',
    id: '', className: '', textContent: '', value: '', onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) {
          if (tests.some(function (t) { return t(k); })) { out.push(k); }
          walk(k.kids);
        });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this.html; },
    set(h) { this.html = h; this.kids = parse(h); }
  });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { throw new Error('the stand-in page cannot read the selector ' + sel); }
  return function (el) {
    if (m[1] && el.tagName !== m[1].toLowerCase()) { return false; }
    if (m[2] && el.attrs.id !== m[2]) { return false; }
    if (m[3] && !Object.prototype.hasOwnProperty.call(el.attrs, m[3])) { return false; }
    return true;
  };
}
function parse(html) {
  const out = [];
  const tag = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const el = makeEl(m[1]);
    const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
    let a;
    while ((a = attr.exec(m[2]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
    el.id = el.attrs.id || '';
    el.className = el.attrs['class'] || '';
    if (el.tagName === 'input') { el.value = el.attrs.value || ''; }
    const shut = html.indexOf('</' + m[1] + '>', tag.lastIndex);
    if (el.tagName === 'button' && shut > 0) { el.textContent = unesc(html.slice(tag.lastIndex, shut)); }
    out.push(el);
  }
  return out;
}

{
  const sent = [];
  const doc = {
    head: makeEl('head'), body: makeEl('body'), activeElement: null, createElement: makeEl,
    addEventListener() { }
  };
  const win = {
    skyrimPlatform: { sendMessage() { } },
    thornswoodNet: { say(line) { sent.push(line); return true; } },
    innerWidth: 1920, innerHeight: 1080,
    addEventListener() { }
  };
  new Function('window', 'document', journalSrc)(win, doc);
  const J = win.thornswoodJournal;
  const root = doc.body.children[0];
  yes('E0: the journal runs and has setFacing for the plugin', !!J && typeof J.setFacing === 'function');

  const PERMS = ['Read', 'Prices', 'Invite', 'Roles', 'Speak'];
  function view(book) {
    return {
      journals: [], shared: [], friends: [],
      group: { show: true, canBusiness: true, canFaction: false, permNames: PERMS, books: [book] }
    };
  }
  const owned = {
    id: 'g1', name: 'The Bee', kind: 'business', read: true, speak: true, canPrices: true,
    invite: true, canRoles: true, owner: true, staff: false, leave: false,
    people: [{ name: 'Ada', role: 'Owner', on: true, left: 0 }], chat: [], priceList: [], submitted: [],
    roles: [{ name: 'Member', perms: ['Read', 'Speak'] }, { name: 'The "Hand"', perms: [] }]
  };
  J.setData(view(owned));
  J.open();
  const g = root.querySelector('#ts-journal-side').querySelectorAll('button[data-group]')[0];
  if (g) { g.onclick.call(g); }
  function main() { return root.querySelector('#ts-journal-main'); }
  function buttons(verb) {
    return main().querySelectorAll('button[data-g]').filter(function (b) { return b.getAttribute('data-g') === verb; });
  }
  function press(b) { if (!b) { return null; } b.onclick.call(b); return sent[sent.length - 1]; }

  yes('E1: with nobody in front there is no Invite-them button, and the name field is there',
      buttons('invitefacing').length === 0 && buttons('invite').length === 1 && !!root.querySelector('#ts-journal-ginvite'));
  J.setFacing({ id: 'ff000004', name: 'Bjorn <Ox>' });
  const facingBtn = buttons('invitefacing')[0];
  yes('E2: with somebody in front, Invite names them, escaped',
      !!facingBtn && facingBtn.textContent === 'Invite Bjorn <Ox>' && /Invite Bjorn &lt;Ox&gt;/.test(main().innerHTML));
  yes('E3: and it sends /book invite with their form id', press(facingBtn) === '/book invite g1 ff000004');
  root.querySelector('#ts-journal-ginvite').value = 'Sera';
  yes('E4: the name field still invites by name', press(buttons('invite')[0]) === '/book invite g1 Sera');
  J.setFacing(null);
  yes('E5: nobody in front again takes the button away', buttons('invitefacing').length === 0);

  const perm = function (role, p) {
    return buttons('perm').filter(function (b) { return b.getAttribute('data-role') === role && b.getAttribute('data-perm') === p; })[0];
  };
  yes('E6: each role has a button for each of the five permissions',
      buttons('perm').length === 10 && PERMS.every(function (p) { return !!perm('Member', p); }));
  yes('E7: a permission the role holds is lit, one it does not is not',
      /\bgo\b/.test(perm('Member', 'Read').className) && !/\bgo\b/.test(perm('Member', 'Prices').className));
  yes('E8: pressing one it lacks sends the list with it added',
      press(perm('Member', 'Prices')) === '/book role g1 perm | Member | Read Speak Prices');
  yes('E9: pressing one it holds sends the list without it',
      press(perm('Member', 'Read')) === '/book role g1 perm | Member | Speak');
  yes('E10: a role name with a quote in it stays whole in the button and the line',
      press(perm('The "Hand"', 'Invite')) === '/book role g1 perm | The "Hand" | Invite' &&
      /data-role="The &quot;Hand&quot;"/.test(main().innerHTML));
  root.querySelector('#ts-journal-grold').value = 'The "Hand"';
  root.querySelector('#ts-journal-grnew').value = 'Steward';
  yes('E11: Rename role sends the old name and the new one',
      press(buttons('rolerename')[0]) === '/book role g1 rename | The "Hand" | Steward');
  root.querySelector('#ts-journal-grole').value = 'Clerk';
  yes('E12: New role is still there', press(buttons('rolenew')[0]) === '/book role g1 new | Clerk');

  const verbs = main().querySelectorAll('button[data-g]').map(function (b) { return b.getAttribute('data-g'); });
  const wanted = ['say', 'invite', 'perm', 'rolenew', 'rolerename', 'setrole', 'remove', 'rename', 'disband', 'price'];
  const missing = wanted.filter(function (v) { return verbs.indexOf(v) === -1; });
  yes('E13: every verb the owner has on factions.md has a button' + (missing.length ? ' (not: ' + missing.join(', ') + ')' : ''),
      missing.length === 0);

  // Someone whose role holds Invite and not Roles.
  const inviter = Object.assign({}, owned, { canRoles: false, owner: false, canPrices: false, leave: true, roles: [] });
  J.setData(view(inviter));
  yes('E14: Invite without Roles has Remove and no Set role and no role buttons',
      buttons('remove').length === 1 && buttons('setrole').length === 0 && buttons('perm').length === 0 &&
      buttons('rolenew').length === 0);
  root.querySelector('#ts-journal-gwho').value = 'M5';
  yes('E15: and Remove names who', press(buttons('remove')[0]) === '/book member g1 remove | M5');
  yes('E16: a member can leave on the tab', press(buttons('leave')[0]) === '/book leave g1');

  // A plain member: nothing to invite or remove with.
  J.setData(view(Object.assign({}, owned, { invite: false, canRoles: false, owner: false, canPrices: false, leave: true, roles: [] })));
  const gb = root.querySelector('#ts-journal-side').querySelectorAll('button[data-group]')[0];
  if (gb) { gb.onclick.call(gb); }
  yes('E17: a member without Invite has no Invite and no Remove',
      buttons('invite').length === 0 && buttons('remove').length === 0 && buttons('invitefacing').length === 0);

  // The journal half, every verb journal.md names.
  J.setData({ journals: [{ id: 'b1', title: 'Road', pages: [{ id: 'p1', title: 'Day', text: '' }] }],
              shared: [], friends: [{ name: 'Sera', p: 7 }], group: { show: false } });
  const side = root.querySelector('#ts-journal-side');
  yes('E18: the group tab is absent when the server says so', side.querySelectorAll('button[data-group]').length === 0);
  const nb = side.querySelectorAll('button[data-new]')[0];
  yes('E19: New journal is a button', press(nb) === '/journal new Journal');
  const b1 = side.querySelectorAll('button[data-book]')[0];
  if (b1) { b1.onclick.call(b1); }
  const tab = main().querySelectorAll('button[data-page]')[0];
  if (tab) { tab.onclick.call(tab); }
  const does = main().querySelectorAll('button[data-do]').map(function (b) { return b.getAttribute('data-do'); });
  const jWanted = ['rename', 'dropbook', 'sharebook', 'unsharebook', 'newpage', 'save', 'sharepage', 'unsharepage'];
  const jMissing = jWanted.filter(function (v) { return does.indexOf(v) === -1; });
  yes('E20: every journal verb journal.md names has a button' + (jMissing.length ? ' (not: ' + jMissing.join(', ') + ')' : ''),
      jMissing.length === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
