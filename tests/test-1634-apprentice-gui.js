// test-1634-apprentice-gui.js
//
// #1634: masters and apprentices are taken on and ended from the look prompt
// and K, not by typing /apprentice. Patrick, 4 Oct: no chat commands for
// anything people do. Patrick's answers on #1388: either one can end it, the
// apprentice as well as the Master, and a taught school or Bladebinder keeps
// the spells already learned when it ends.
//
//   A  the near list puts a Master's "Take on as apprentice" on the look
//      prompt for exactly the people they could take on, with the halves
//   B  the K panel's view: who you took on, who took you on, the sister half
//      waiting, the outside trades used
//   C  the lines the buttons send: Take on by form id, the Master's End by
//      form id and half, the apprentice's own End (leave), and that no line
//      of the server's tells anybody to type /apprentice
//   D  the K panel page itself, in a stand-in document: Take on, End asking
//      twice, the apprentice's End, and the answer
//   E  the look prompt in the front plugin: the row, and K opening the page
//   F  the words: out of the list named to everybody and /help, out of the
//      pages, and the pages say how studying is reached with no /study
//
// The traps from the issue: tests/test-1388-apprentice.js slices the same
// functions, and the server keeps answering the line the buttons send.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-help.js'), 'utf8')
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
function read(...bits) { return fs.readFileSync(path.join(REPO, ...bits), 'utf8').split(CR).join(''); }
const ui = read('game', 'ui', 'thornswood-skills.js');
const front = read('game', 'plugins', 'thornswood-front.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(text, a, b) {
  const i = text.indexOf(a);
  const j = i < 0 ? -1 : text.indexOf(b, i);
  return (i >= 0 && j >= 0) ? text.slice(i, j) : null;
}

const RULES = between(src, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between(src, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const SOCIAL = between(src, '// ==== thornswood social:', '// ==== end thornswood social ====');
const SOCIAL_CMDS = between(src, "    if (word === '/friend' || word === '/party' || word === '/mute' ||",
                            "    if (word === '/rest') {");
yes('the rules, the character store, the social block and the /yes branch are in the gamemode',
    !!(RULES && CHARACTER && SOCIAL && SOCIAL_CMDS));
if (!(RULES && CHARACTER && SOCIAL && SOCIAL_CMDS)) { done(); }

/* One server over a store, the way test-1388-apprentice.js builds it. */
function server(store, online, gone) {
  const said = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (gone.indexOf(id) !== -1) { throw new Error('no form ' + id); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) {
      if (gone.indexOf(id) !== -1) { throw new Error('no form ' + id); }
      (store[id] = store[id] || {})[key] = JSON.stringify(value);
    }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    isFinite: isFinite, parseInt: parseInt,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    notify: function (id, m) { said.push({ id: id, text: m, how: 'notify' }); },
    say: function (id, m) { said.push({ id: id, text: m, how: 'chat' }); },
    log: function () { },
    spellOn: function () { return true; },
    giveTool: function () { return null; },
    raceOf: function () { return ''; }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext(SOCIAL, ctx, { filename: 'gamemode.js social' });
  const C = ctx.__thornswoodCharacter;
  const soc = ctx.__thornswoodSocial;
  function told(actor) {
    return said.filter(function (x) { return x.id === actor && x.how === 'chat'; }).map(function (x) { return x.text; });
  }
  return {
    ctx: ctx, said: said, C: C, P: ctx.__thornswoodProgression, soc: soc, told: told,
    /** A line as a button sends it, through the character block the way handle() hands it on. */
    send: function (actor, text) {
      said.length = 0;
      const parts = text.trim().split(/\s+/);
      const pid = soc.profileOf(actor);
      const handled = C.command(parts[0], parts, actor, pid, function (p, m) { said.push({ id: actor, text: m, how: 'chat' }); });
      return handled ? told(actor) : null;
    },
    /** Accept or Refuse on the prompt, through the chat block's /yes and /no branch. */
    answer: function (actor, text) {
      said.length = 0;
      const parts = text.trim().split(/\s+/);
      new Function('globalThis', 'actorId', 'profileId', 'parts', 'word',
                   'toProfile', 'say', 'notify', 'journalCommand', SOCIAL_CMDS)(
        ctx, actor, soc.profileOf(actor), parts, parts[0],
        function (p, m) { said.push({ id: soc.actorForProfile(p), text: m, how: 'chat' }); },
        function (to, m) { said.push({ id: to, text: m, how: 'chat' }); }, function () { }, function () { });
      return said.slice();
    },
    /** One pass of the near list, and what the look prompt of that person would read. */
    near: function (actor) {
      soc.nearTick();
      const v = mp.get(actor, 'thornswoodNear');
      return (v && v.w) || {};
    }
  };
}

const store = {};
const online = [];
const gone = [];
let srv = server(store, online, gone);
const P = srv.P;
function person(id, name, pid, prof, half, change) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(pid);
  store[id].appearance = JSON.stringify({ name: name });
  store[id].worldOrCellDesc = JSON.stringify('town:X.esm');
  store[id].pos = JSON.stringify([0, 0, 0]);
  if (online.indexOf(id) === -1) { online.push(id); }
  let s = srv.C.stateOf(id);
  let r = srv.P.pickClass(s, 'miner');
  if (r.ok) { s = r.state; }
  if (prof) {
    r = srv.P.pickProfession(s, prof, half);
    if (r.ok) { s = r.state; }
  }
  if (change) { change(s); }
  srv.C.writeState(id, s);
  return id;
}
function st(id) { return srv.C.stateOf(id); }
function hex(id) { return id.toString(16); }
function view(id) { return srv.C.forPanel(st(id), false, id); }
// Everything the server said in the test, to hold it to never naming the line.
const everySaid = [];
function heard(lines) { lines.forEach(function (l) { everySaid.push(String(l && l.text !== undefined ? l.text : l)); }); return lines; }

const EORLUND = 0xff000201, LINA = 0xff000202, HROKI = 0xff000203, SVEN = 0xff000204,
      NOBODY = 0xff000205, TOLFDIR = 0xff000206, ONMUND = 0xff000207, GERD = 0xff000208, BRYN = 0xff000209;
person(EORLUND, 'Eorlund', 201, 'smith', 'platewright', function (s) { s.ranks.platewright = 'master'; });
person(LINA, 'Lina', 202, 'smith', 'edgewright');
person(HROKI, 'Hroki', 203, 'cook', 'hearthcook', function (s) { s.ranks.hearthcook = 'master'; s.ranks.confectioner = 'master'; });
person(SVEN, 'Sven', 204, 'smith', 'edgewright');
person(NOBODY, 'Ysolda', 205, null, null);
person(TOLFDIR, 'Tolfdir', 206, 'mage', ['destruction', 'alteration'], function (s) { s.ranks.destruction = 'master'; });
person(ONMUND, 'Onmund', 207, 'mage', ['restoration', 'illusion']);
person(GERD, 'Gerd', 208, 'smith', 'platewright');
person(BRYN, 'Bryn', 209, 'smith', 'edgewright');

// ------------------------------------------------- A. the look prompt's row --
{
  let w = srv.near(EORLUND);
  yes('A1: a Master Platewright looking at an Edgewright gets the row, for her sister half (' + JSON.stringify(w[hex(LINA)] && w[hex(LINA)].a) + ')',
      !!w[hex(LINA)] && JSON.stringify(w[hex(LINA)].a) === JSON.stringify([{ h: 'platewright', k: 'sister' }]));
  yes('A1: and none for a Platewright, whose own half it is, or for somebody with no profession',
      !!w[hex(GERD)] && !w[hex(GERD)].a && !!w[hex(NOBODY)] && !w[hex(NOBODY)].a);
  yes('A1: and none for a Cook: a Master Platewright could only teach a Cook plate, and the row says so',
      JSON.stringify(w[hex(HROKI)].a) === JSON.stringify([{ h: 'platewright', k: 'outside' }]));
  w = srv.near(LINA);
  yes('A2: somebody who is a Master of nothing sees the row on nobody',
      Object.keys(w).length > 3 && Object.keys(w).every(function (k) { return !w[k].a; }));
  w = srv.near(HROKI);
  yes('A3: a Master of two halves gets both on a Smith, as outside trades (' + JSON.stringify(w[hex(SVEN)].a) + ')',
      JSON.stringify(w[hex(SVEN)].a) === JSON.stringify([{ h: 'hearthcook', k: 'outside' }, { h: 'confectioner', k: 'outside' }]));
  w = srv.near(TOLFDIR);
  yes('A4: a Master mage gets no row on another mage, whose own profession it is',
      !w[hex(ONMUND)].a && JSON.stringify(w[hex(GERD)].a) === JSON.stringify([{ h: 'destruction', k: 'outside' }]));
}

// --------------------------------------------- B and C. take on, view, end --
{
  let v = view(LINA).apprentice;
  yes('B1: the K view of somebody nobody took on: nothing either way, the sister half waiting, none of the two used',
      !!v && v.took.length === 0 && v.by.length === 0 && v.sister && v.sister.half === 'platewright' &&
      v.sister.rank === 'novice' && v.used === 0 && v.of === 2 && v.mastered.length === 0);
  yes('B1: a Master\'s view names what they are a Master of', JSON.stringify(view(HROKI).apprentice.mastered) === '["hearthcook","confectioner"]');
  yes('B1: somebody with no profession has no page, and nobody has one while creating',
      !view(NOBODY).apprentice && !srv.C.forPanel(st(LINA), true, LINA).apprentice);

  // Take on, as K's button sends it: the form id from the crosshair, and the half.
  let lines = heard(srv.send(EORLUND, '/apprentice ' + hex(LINA) + ' platewright'));
  yes('C1: Take on sends the form id and the half, and the offer stands on her prompt (' + lines.join(' ') + ')',
      /Asked Lina to be your apprentice in Platewright/.test(lines.join(' ')) &&
      !!srv.soc.standingOffer(202) && srv.soc.standingOffer(202).half === 'platewright');
  heard(srv.answer(LINA, '/yes'));
  yes('C1: she accepts on the prompt and both sides are recorded',
      st(LINA).masters.platewright.id === EORLUND && st(EORLUND).apprentices.length === 1);
  const w = srv.near(EORLUND);
  yes('C1: the row is gone from the look prompt once she is his apprentice', !w[hex(LINA)].a);
  lines = heard(srv.send(EORLUND, '/apprentice end'));
  yes('C1: End with nobody named points at K, and ends nothing (' + lines.join(' ') + ')',
      /K lists the people you took on, each with End/.test(lines.join(' ')) && st(EORLUND).apprentices.length === 1);

  v = view(EORLUND).apprentice;
  yes('B2: K lists her on his side, by form id and half, as her sister half (' + JSON.stringify(v.took) + ')',
      v.took.length === 1 && v.took[0].id === hex(LINA) && v.took[0].name === 'Lina' && v.took[0].half === 'platewright' &&
      v.took[0].kind === 'sister');
  v = view(LINA).apprentice;
  yes('B2: and him on hers, standing, and the sister half no longer waits (' + JSON.stringify(v.by) + ')',
      v.by.length === 1 && v.by[0].name === 'Eorlund' && v.by[0].half === 'platewright' && v.by[0].kind === 'sister' &&
      v.by[0].stands === true && v.by[0].id === hex(EORLUND) && v.sister === null);

  // Work under him, then she ends it herself.
  for (let i = 0; i < 101; i++) { srv.C.credit(LINA, 'platewright'); }
  yes('C2: work under him raises her sister half past novice', P.rankOf(st(LINA), 'platewright') === 'advanced');
  lines = heard(srv.send(LINA, '/apprentice leave platewright'));
  yes('C2: the apprentice\'s own End ends it from her side (' + lines.join(' ') + ')',
      /You ended your apprenticeship in Platewright with Eorlund/.test(lines.join(' ')) &&
      /ranks you earned in it stay/.test(lines.join(' ')));
  yes('C2: both sides are cleared, and the rank she earned stays',
      !(st(LINA).masters || {}).platewright && st(EORLUND).apprentices.length === 0 &&
      P.rankOf(st(LINA), 'platewright') === 'advanced');
  yes('C2: Eorlund is told', srv.said.some(function (x) {
    return x.id === EORLUND && /Lina has ended their apprenticeship with you in Platewright/.test(x.text);
  }));
  heard(srv.said);
  for (let i = 0; i < 300; i++) { srv.C.credit(LINA, 'platewright'); }
  yes('C2: and past it the count waits at the next threshold again', P.rankOf(st(LINA), 'platewright') === 'advanced');
  lines = heard(srv.send(LINA, '/apprentice leave platewright'));
  yes('C2: ending it again is refused, nothing to end (' + lines.join(' ') + ')', /Nobody has taken you on in that/.test(lines.join(' ')));
  yes('C2: the row is back on his look prompt now she has no Master in it', !!srv.near(EORLUND)[hex(LINA)].a);

  // An outside trade, ended by the apprentice: it stays counted.
  heard(srv.send(HROKI, '/apprentice ' + hex(SVEN) + ' hearthcook'));
  heard(srv.answer(SVEN, '/yes'));
  heard(srv.send(HROKI, '/apprentice ' + hex(SVEN) + ' confectioner'));
  heard(srv.answer(SVEN, '/yes'));
  v = view(SVEN).apprentice;
  yes('B3: K shows both outside trades on his side and the two used (' + JSON.stringify(v.by) + ', ' + v.used + ')',
      v.by.length === 2 && v.by.every(function (r) { return r.kind === 'outside' && r.name === 'Hroki' && r.stands; }) && v.used === 2);
  lines = heard(srv.send(SVEN, '/apprentice leave hearthcook'));
  yes('C3: the apprentice ends an outside trade: the novice list goes and it still counts (' + lines.join(' ') + ')',
      /You ended your novice Hearthcook with Hroki/.test(lines.join(' ')) && /still counts as one of your two/.test(lines.join(' ')) &&
      st(SVEN).taught.indexOf('hearthcook') === -1 && (st(SVEN).untaught || []).indexOf('hearthcook') !== -1 &&
      !P.rankOf(st(SVEN), 'hearthcook'));
  yes('C3: Hroki\'s list loses the row and he is told',
      st(HROKI).apprentices.length === 1 && st(HROKI).apprentices[0].half === 'confectioner' &&
      srv.said.some(function (x) { return x.id === HROKI && /Sven has ended the novice Hearthcook you taught them/.test(x.text); }));
  heard(srv.said);
  yes('C3: and it does not open a third: K still says both are used', view(SVEN).apprentice.used === 2);

  // The Master's End, as K sends it: the form id and the half.
  lines = heard(srv.send(HROKI, '/apprentice end ' + hex(SVEN) + ' confectioner'));
  yes('C4: the Master\'s End by form id and half ends it (' + lines.join(' ') + ')',
      /You ended Sven's novice Confectioner/.test(lines.join(' ')) && st(SVEN).taught.length === 0 &&
      !(st(HROKI).apprentices || []).length);
  heard(srv.said);

  // A taught school, ended by the apprentice: the spells already learned stay.
  heard(srv.send(TOLFDIR, '/apprentice ' + hex(GERD) + ' destruction'));
  heard(srv.answer(GERD, '/yes'));
  const g = st(GERD);
  g.spells = { known: ['Flames'] };
  srv.C.writeState(GERD, g);
  lines = heard(srv.send(GERD, '/apprentice leave destruction'));
  yes('C5: a taught school ended by the apprentice keeps the spells already learned, and says so (' + lines.join(' ') + ')',
      st(GERD).spells.known.indexOf('Flames') !== -1 && /spells you already learned from it stay/.test(lines.join(' ')) &&
      st(GERD).taught.indexOf('destruction') === -1);

  // A Master whose character is gone: End clears the apprentice's side only.
  heard(srv.send(EORLUND, '/apprentice ' + hex(BRYN) + ' platewright'));
  heard(srv.answer(BRYN, '/yes'));
  gone.push(EORLUND);
  v = view(BRYN).apprentice;
  yes('B4: a Master whose character is gone reads as no longer standing on K, and the sister half waits again',
      v.by.length === 1 && v.by[0].stands === false && v.sister && v.sister.half === 'platewright');
  lines = heard(srv.send(BRYN, '/apprentice leave platewright'));
  yes('C6: and the apprentice can still end it, which clears his own side (' + lines.join(' ') + ')',
      /You ended your apprenticeship in Platewright with Eorlund/.test(lines.join(' ')) && !(st(BRYN).masters || {}).platewright);
  gone.length = 0;

  // Lines typed without the half or the id say where the buttons are.
  lines = heard(srv.send(HROKI, '/apprentice ' + hex(LINA)));
  yes('C7: a Master of two halves asked without the half is pointed at the prompt (' + lines.join(' ') + ')',
      /could take Lina on in Hearthcook or Confectioner/.test(lines.join(' ')) && /press the key the prompt names/.test(lines.join(' ')));
  lines = heard(srv.send(LINA, '/apprentice'));
  yes('C7: and the line on its own points at K (' + lines.join(' ') + ')', /K lists all of it under Masters and apprentices/.test(lines.join(' ')));

  yes('C8: nothing the server said in all of this tells anybody to type /apprentice (' + everySaid.length + ' lines)',
      everySaid.length > 20 && everySaid.every(function (t) { return !/\/apprentice/.test(t); }));
  const block = CHARACTER.slice(CHARACTER.indexOf('MASTERS AND APPRENTICES'), CHARACTER.indexOf('    The commands. Called from handle()'));
  const quoted = block.match(/'[^'\n]*'/g) || [];
  yes('C8: and no string the apprentice code can say holds /apprentice either',
      quoted.length > 50 && quoted.every(function (q) { return !/\/apprentice/.test(q); }));
}

// ------------------------------------------------ D. the K panel's page --
{
  const sentPage = [];
  const saidLines = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
      set: function (v) { n._text = String(v); n.children = []; }
    });
    n.appendChild = function (c) { n.children.push(c); return c; };
    n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
    return n;
  }
  const docu = {
    head: node('head'), body: node('body'),
    createElement: function (tag) {
      const n = node(tag);
      Object.defineProperty(n, 'innerHTML', { set: function () {
        const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
        n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
                 '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
      } });
      return n;
    },
    createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
  };
  const timers = [];
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function (to, m) { sentPage.push(m); } },
                thornswoodNet: { say: function (line) { saidLines.push(line); } } };
  let now = Date.now();
  const FakeDate = function () { return new Date(now); };
  FakeDate.now = function () { return now; };
  const box = { window: win, document: docu, setTimeout: function (fn, ms) { timers.push({ fn: fn, at: now + ms }); },
                Date: FakeDate, JSON: JSON, console: console };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
  const api = win.thornswoodSkills;
  yes('D: the K panel runs in a stand-in document and has takeOn', ran && !!api && typeof api.takeOn === 'function');
  if (!api) { done(); }
  const root = docu.body.children[0];
  const nav = root._q['.nav'], body = root._q['.body'], status = root._q['.status'], confirmBtn = root._q['[data-act="confirm"]'];
  const navNames = function () {
    return nav.children.filter(function (r) { return /navrow/.test(r.className); }).map(function (r) { return r.children[0].textContent; });
  };
  const all = function (n, out) { out = out || []; out.push(n); n.children.forEach(function (c) { all(c, out); }); return out; };
  const buttons = function (label) {
    return all(body).filter(function (n) { return /\bact\b/.test(n.className) && (!label || n.textContent === label); });
  };
  function wait(ms) {
    now += ms;
    const due = timers.filter(function (t) { return t.at <= now; });
    for (let i = 0; i < due.length; i++) { timers.splice(timers.indexOf(due[i]), 1); due[i].fn(); }
  }

  // Lina has a profession and nobody: the page is there, saying so.
  api.open();
  api.setData(null, { panel: view(LINA) });
  yes('D1: somebody with a profession has Masters and apprentices on K (' + navNames().join(', ') + ')',
      navNames().indexOf('Masters and apprentices') !== -1);
  api.setData(null, { panel: Object.assign(view(LINA), { creating: true }) });
  yes('D1: and not while creating', navNames().indexOf('Masters and apprentices') === -1);
  api.setData(null, { panel: view(NOBODY) });
  yes('D1: and not with no profession', navNames().indexOf('Masters and apprentices') === -1);
  // Leaving creation shuts the panel on its own timer; let it, so it does not shut a later page.
  wait(1000);
  api.close();

  // Hroki presses K looking at Lina: two halves he could teach her.
  api.setData(null, { panel: view(HROKI) });
  api.takeOn({ id: hex(LINA), name: 'Lina', halves: [{ h: 'hearthcook', k: 'outside' }, { h: 'confectioner', k: 'outside' }] });
  yes('D2: K from the look prompt opens the panel on Masters and apprentices (' + root.className + ')',
      root.className === '' && /Masters and apprentices/.test(navNames().join(',')) &&
      /take on Lina/.test(nav.textContent));
  yes('D2: with Lina in front of him and a Take on for each half (' + body.textContent + ')',
      /Lina/.test(body.textContent) && /in front of you/.test(body.textContent) &&
      /Novice Hearthcook, an outside trade/.test(body.textContent) && /Novice Confectioner, an outside trade/.test(body.textContent) &&
      buttons('Take on').length === 2);
  yes('D2: there is no Confirm on this page; the buttons are on the cards', confirmBtn.style.display === 'none');
  buttons('Take on')[1].onclick({ stopPropagation: function () { } });
  yes('D3: Take on sends the line with her form id and that half, and nothing else (' + saidLines.join(' | ') + ')',
      saidLines.length === 1 && saidLines[0] === '/apprentice ' + hex(LINA) + ' confectioner');
  yes('D3: and says she answers on her own prompt (' + status.textContent + ')', /Asked Lina\. They answer on their own prompt/.test(status.textContent));
  saidLines.length = 0;
  yes('D3: the person in front of him is that press\'s, not the next', buttons('Take on').length === 0);
  api.close();
  api.takeOn({ id: 'zz not hex', name: 'Lina', halves: [{ h: 'hearthcook', k: 'outside' }] });
  api.takeOn({ id: hex(LINA), name: 'Lina', halves: [{ h: 'Hearth Cook!', k: 'outside' }] });
  yes('D3: a bad id or a bad half opens nothing', root.className === 'gone');

  // Through the server: Lina says yes, and both pages list it.
  heard(srv.send(HROKI, '/apprentice ' + hex(LINA) + ' confectioner'));
  heard(srv.answer(LINA, '/yes'));
  api.open();
  api.setData(null, { panel: view(HROKI) });
  const navRow = function () {
    return nav.children.filter(function (r) { return /navrow/.test(r.className) && r.children[0].textContent === 'Masters and apprentices'; })[0];
  };
  navRow().onclick();
  yes('D4: his page lists Lina under You took on, with End (' + navRow().textContent + ': ' + body.textContent + ')',
      /You took on/.test(body.textContent) && /Lina/.test(body.textContent) && /Novice Confectioner, an outside trade/.test(body.textContent) &&
      buttons('End').length === 1 && /1 apprentice$/.test(navRow().textContent));
  buttons('End')[0].onclick({ stopPropagation: function () { } });
  yes('D5: End asks twice: the first press sends nothing and arms it', saidLines.length === 0 && buttons('Press again to end').length === 1);
  wait(5100);
  yes('D5: a first press on its own disarms after five seconds', buttons('End').length === 1 && buttons('Press again to end').length === 0);
  buttons('End')[0].onclick({ stopPropagation: function () { } });
  wait(1000);
  buttons('Press again to end')[0].onclick({ stopPropagation: function () { } });
  yes('D5: the second press inside five seconds sends End with her form id and the half (' + saidLines.join(' | ') + ')',
      saidLines.length === 1 && saidLines[0] === '/apprentice end ' + hex(LINA) + ' confectioner');
  heard(srv.send(HROKI, saidLines[0]));
  saidLines.length = 0;
  api.setData(null, { panel: view(HROKI) });
  yes('D5: the server\'s answer takes the row off and the page says it ended (' + status.textContent + ')',
      buttons('End').length === 0 && /Ended with Lina/.test(status.textContent));
  api.close();

  // Sven's side: Hroki teaches him, and Sven ends it from his own page.
  heard(srv.send(TOLFDIR, '/apprentice ' + hex(BRYN) + ' destruction'));
  heard(srv.answer(BRYN, '/yes'));
  api.open();
  api.setData(null, { panel: view(BRYN) });
  navRow().onclick();
  yes('D6: the apprentice\'s page lists his Master under Took you on, with End, and says the spells stay (' + body.textContent + ')',
      /Took you on/.test(body.textContent) && /Tolfdir/.test(body.textContent) && /Novice Destruction, an outside trade they taught you/.test(body.textContent) &&
      /spells you already learned from it stay/.test(body.textContent) && buttons('End').length === 1 &&
      /1 of your 2 outside trades used/.test(body.textContent) && /Platewright, your sister half, waits at Novice/.test(body.textContent));
  buttons('End')[0].onclick({ stopPropagation: function () { } });
  buttons('Press again to end')[0].onclick({ stopPropagation: function () { } });
  yes('D6: his End sends leave and the half (' + saidLines.join(' | ') + ')', saidLines.length === 1 && saidLines[0] === '/apprentice leave destruction');
  heard(srv.send(BRYN, saidLines[0]));
  api.setData(null, { panel: view(BRYN) });
  yes('D6: and the answer takes it off his page (' + status.textContent + ')',
      buttons('End').length === 0 && /Ended with Tolfdir/.test(status.textContent) && !(st(TOLFDIR).apprentices || []).length);
  api.close();
  saidLines.length = 0;

  // A Master's page says how to take somebody on.
  api.open();
  api.setData(null, { panel: view(TOLFDIR) });
  navRow().onclick();
  yes('D7: a Master\'s page says they take somebody on by looking at them (' + body.textContent + ')',
      /You are a Master of Destruction\. Look at somebody/.test(body.textContent) && !/\/apprentice/.test(body.textContent));
  api.close();
  const pageText = between(ui, 'function drawApprentice()', 'function drawRecipes()') || '';
  yes('D8: the page itself tells nobody to type anything: the only /apprentice in it is what the buttons send',
      pageText.length > 500 && (pageText.match(/\/apprentice/g) || []).length === 2 &&
      /'\/apprentice end ' \+ r\.id/.test(pageText) && /'\/apprentice leave ' \+ r\.half/.test(pageText));
}

// ---------------------------------------------- E. the look prompt, in front --
{
  yes('E1: the row is on K, the skills key, and not a new key', /(?:const|let) APPRENTICE_KEY = SKILLS_KEY;/.test(front) &&
      !/iniNumber\(ini, 'Apprentice/.test(front));
  const dp = between(front, '  function drawPrompt(row) {', '\n  }\n');
  let drawn = [];
  const draw = dp && new Function('T', 'FRIEND_NAME', 'TRADE_NAME', 'MUTE_NAME', 'PARTY_NAME', 'SLEEP_NAME', 'APPRENTICE_NAME', 'LOOK_CSS',
    'var lookingSig = "";\n' + dp + '\n  }\nreturn drawPrompt;')(
    { js: function (s) { drawn.push(s); return true; } }, 'Y', 'H', 'L', 'P', 'U', 'K', '');
  yes('E2: drawPrompt is in the front plugin and runs', typeof draw === 'function');
  if (draw) {
    draw({ n: 'Lina', f: 0, m: 0, y: 0, s: 0 });
    yes('E2: with no a on the row, no Take on as apprentice', drawn.length === 1 && !/Take on as apprentice/.test(drawn[0]));
    draw({ n: 'Lina', f: 0, m: 0, y: 0, s: 0, a: [{ h: 'platewright', k: 'sister' }] });
    yes('E2: with a, the row names K: Take on as apprentice, and the prompt redraws for it',
        drawn.length === 2 && /K<\/span><span[^>]*>Take on as apprentice/.test(drawn[1]));
  }
  const ap = between(front, '  function apprenticePress() {', '\n  }\n');
  const calls = [];
  const press = ap && function (state) {
    return new Function('lookingAt', 'claims', 'T', 'busyMenuOpenNow', 'nearList', 'say',
      ap + '\n  }\nreturn apprenticePress();')(
      state.lookingAt, { chat: !!state.chat },
      { hasFocus: function (w) { return w === 'skills' && !!state.open; }, js: function (s) { calls.push(s); return true; } },
      function () { return state.busy ? 'InventoryMenu' : ''; },
      function () { return state.near; }, function () { });
  };
  yes('E3: apprenticePress is in the front plugin', typeof press === 'function');
  if (press) {
    const near = {}; near[hex(LINA)] = { n: 'Lina', a: [{ h: 'platewright', k: 'sister' }] };
    near[hex(GERD)] = { n: 'Gerd' };
    yes('E3: K on a person the row is up for opens K on them, and nothing goes to the server',
        press({ lookingAt: hex(LINA), near: near }) === true && calls.length === 1 &&
        /thornswoodSkills\.takeOn\(\{"id":"ff000202","name":"Lina","halves":\[\{"h":"platewright","k":"sister"\}\]\}\)/.test(calls[0]) &&
        !/\/apprentice/.test(calls[0]));
    calls.length = 0;
    yes('E3: K on anybody else, on nobody, while typing, with the panel open or a menu up is plain K',
        press({ lookingAt: hex(GERD), near: near }) === false && press({ lookingAt: '', near: near }) === false &&
        press({ lookingAt: hex(LINA), near: near, chat: true }) === false &&
        press({ lookingAt: hex(LINA), near: near, open: true }) === false &&
        press({ lookingAt: hex(LINA), near: near, busy: true }) === false && calls.length === 0);
    yes('E3: and the key handler asks it before K opens or shuts the panel',
        // The hair dye's K (#2675) may come between: it is asked after this one.
        /if \(e\.code === APPRENTICE_KEY && apprenticePress\(\)\) \{ return; \}\n(?:    \/\/[^\n]*\n    if \(e\.code === HAIR_DYE_KEY && hairDyePress\(\)\) \{ return; \}\n)?    if \(e\.code === SKILLS_KEY\) \{/.test(front));
  }
  // The row on Settings in the game (#3126), where the Controls page's was.
  const settingsPage = read('game', 'ui', 'thornswood-settings.js');
  const ini = read('launcher', 'Thornswood.ini');
  const skillsRow = (/\{ ini: 'SkillsKey', def: 37,[^}]*\}/.exec(settingsPage) || [''])[0];
  yes('E4: the Settings row and the ini say what K does on a person a Master could take on',
      !!skillsRow && /could take on as an apprentice sees this key named under the crosshair/.test(skillsRow) &&
      /could take on as an apprentice sees this key named under the crosshair/.test(ini.replace(/\n; /g, ' ')));
}

// ------------------------------------------------------------ F. the words --
{
  const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const pwords = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  const W = words ? new Function('return ' + words[1])() : [];
  const PW = pwords ? new Function('return ' + pwords[1])() : [];
  yes('F1: the server still answers /apprentice, the line the buttons send', W.indexOf('/apprentice') !== -1);
  yes('F1: and it is not in the list named to everybody', PW.indexOf('/helpme') !== -1 && PW.indexOf('/apprentice') === -1);
  // The help is a panel since #1633: its Work topic, as a fresh install reads it.
  const help = helpTopic('work');
  yes('F1: the help panel\'s Work says a Master takes you on from the prompt and K lists it, with no /apprentice',
      !!help && !/\/apprentice/.test(help) && /presses K when the prompt names it/.test(help) && /either of you can end it there/.test(help));
  const gate = between(src, 'function craftAnswer(actorId, row) {', '\n}\n') || '';
  yes('F1: the craft gate says where a Master takes you on, with no /apprentice',
      /can take you on, from the prompt they see when they look at you/.test(gate) && !/\/apprentice/.test(gate));
  const doc = function (p) { return read('docs', 'systems', p); };
  const pages = { appr: doc('apprenticeship.md'), prof: doc('professions.md'), warrior: doc(path.join('professions', 'warrior.md')),
                  magic: doc('magic.md'), livery: doc(path.join('professions', 'tailor', 'liverywright.md')),
                  systems: read('docs', 'GAME-SYSTEMS.md'), site: read('site', 'data', 'site', 'classes.md') };
  yes('F2: no page about it tells anybody to type /apprentice or /study',
      Object.keys(pages).every(function (k) { return !/`\/apprentice|`\/study/.test(pages[k]); }));
  yes('F2: apprenticeship.md says how it is done: the prompt row, K, Take on, End from either side',
      /Take on as apprentice/.test(pages.appr) && /Either of you\s+ends it there, and End asks twice/.test(pages.appr) &&
      /Either of you can end it: the\s+master, or you/.test(pages.appr));
  yes('F2: and Patrick\'s answer on the spells: a taught school or Bladebinder keeps the spells learned',
      /taught school or a taught Bladebinder keeps the spells\s+already learned from it/.test(pages.appr));
  yes('F2: the pages say how studying is reached: E at a study desk in the College halls (#1387)',
      /walk up to\s+one and press E/.test(pages.magic) && /a study desk hands them 1 spell point/.test(pages.appr));
  yes('F2: the overview, professions, warrior and the site say either can end it, with no command',
      /either\s+of you can end it/.test(pages.systems) && /either of them ends it on\s+the K panel/.test(pages.prof) &&
      /takes\s+you on, and stays/.test(pages.warrior) && /either of you can end it/.test(pages.site));
  const cmds = doc('commands.md');
  const crow = cmds.split('\n').filter(function (l) { return /^\| `\/apprentice/.test(l); })[0] || '';
  yes('F3: commands.md lists the line as one nobody is told to type, with what replaced it',
      /Nowhere\./.test(crow) && /Never in the list or the help/.test(crow) && /Take on/.test(crow) && /#1634/.test(crow) && !/To come/.test(crow));
}

done();
