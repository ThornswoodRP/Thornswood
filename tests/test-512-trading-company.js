'use strict';
// Issue #512: the Free Skyrim Trading Company's terms as staff data
// (game/trading-company.js, game/data/trading-company.json). Bad terms are
// refused, a proposal changes nothing, a haul keeps the cut it was posted
// under, and the #511 charter hook.
//
// #2695, Patrick, 18 Oct 2026: staff change the terms on an in-game staff
// panel where staff confirm a proposal; the Trading Company role charters by
// default; no freight fee by default, with a ledger fee as a setting; the haul
// fee stays apart from the board's job fee. So gamemode.js carries the two
// files in its company terms block (scripts/dev/Build-TradingCompanyGamemode.js),
// keeps the terms in force in private/company-terms.json, posts and pays hauls
// and splits sales by them, and staff propose, confirm and drop on the Office
// page of K with lines the server checks again. mayCharter keeps its name,
// arguments and return shape: Waystone's #2700 builds on it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tc = require('../game/trading-company');

let passed = 0;
function ok(name, fn) { fn(); passed++; }

const text = fs.readFileSync(path.join(__dirname, '../game/data/trading-company.json'), 'utf8');
const terms = tc.loadTerms(text);
const mode = fs.readFileSync(path.join(__dirname, '../game/gamemode.js'), 'utf8');

const fixture = require('./fixtures/company-block');
const build = require('../scripts/dev/Build-TradingCompanyGamemode.js');
const modeLf = mode.split('\r\n').join('\n');
function num(name) {
  const m = new RegExp('var ' + name + ' = (\\d+);').exec(mode);
  assert.ok(m, 'gamemode.js still has ' + name);
  return Number(m[1]);
}
function slice(src, a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i < 0 || j < 0) ? '' : src.slice(i, j + b.length);
}
const prop = slice(modeLf, '// ==== thornswood property ====', '// ==== end thornswood property ====');
function propFn(name) {
  const a = prop.indexOf('\n  function ' + name + '(');
  const b = a < 0 ? -1 : prop.indexOf('\n  }\n', a + 1);
  return (a < 0 || b < 0) ? '' : prop.slice(a, b + 4);
}

ok('the file is UTF-8 without a BOM, and the module too', () => {
  assert.notEqual(text.charCodeAt(0), 0xFEFF);
  assert.notEqual(fs.readFileSync(path.join(__dirname, '../game/trading-company.js'), 'utf8').charCodeAt(0), 0xFEFF);
});

ok('the file checks', () => assert.deepEqual(tc.checkTerms(terms), []));

const JOB_FEE = num('JOB_FEE');

ok('the shipped terms are the numbers the company had: a tenth of a haul and of a sale each way, from 10 gold', () => {
  assert.equal(terms.haulFee, 30);
  for (let p = 0; p <= 5000; p++) {
    assert.equal(tc.haulCut({ pay: p }, terms), p < 10 ? 0 : Math.floor(p / 10), 'pay ' + p);
    const t = p < 10 ? 0 : Math.floor(p / 10);
    assert.deepEqual(tc.saleCuts(p, terms), { price: p, worker: t, gone: t, seller: p - t - t }, 'price ' + p);
  }
});
ok('the shipped defaults: charter by the company, no freight', () => {
  assert.equal(terms.charter, 'company');
  assert.equal(terms.freightPerLoad, 0);
  assert.deepEqual(tc.freightFor(terms), { gold: 0, to: 'ledger' });
});

function bad(change, why) {
  const t = Object.assign({}, terms, change);
  assert.ok(tc.checkTerms(t).length > 0, why);
  assert.throws(() => tc.loadTerms(JSON.stringify(t)), /refused/, why);
}
ok('bad terms are refused, never defaulted', () => {
  bad({ haulFee: -1 }, 'negative fee');
  bad({ haulFee: 1.5 }, 'fraction of gold');
  bad({ haulFee: '30' }, 'a string');
  bad({ haulCutPercent: 101 }, 'over 100');
  bad({ saleWorkerPercent: 60, saleGonePercent: 41 }, 'sale cuts over the price');
  bad({ charter: 'jarl' }, 'unknown charter rule');
  bad({ freightTo: 'pocket' }, 'unknown freight destination');
  bad({ extra: 1 }, 'unknown key');
  bad({ v: 2 }, 'version');
  const missing = Object.assign({}, terms); delete missing.saleCutFrom;
  assert.ok(tc.checkTerms(missing).some(s => /Missing/.test(s)));
  assert.throws(() => tc.loadTerms('{not json'), /not readable/);
  assert.throws(() => tc.haulCut({ pay: 100 }, Object.assign({}, terms, { haulCutPercent: -5 })), /refused/);
});

ok('a sale with both cuts at 50 leaves the seller nothing and never less', () => {
  const t = Object.assign({}, terms, { saleWorkerPercent: 50, saleGonePercent: 50 });
  for (let p = 0; p <= 999; p++) {
    const s = tc.saleCuts(p, t);
    assert.ok(s.seller >= 0);
    assert.equal(s.worker + s.gone + s.seller, s.price);
  }
});

ok('a haul keeps the cut it was posted under', () => {
  const posted = tc.stampHaul({ pay: 100, dest: 'Windhelm' }, terms);
  assert.deepEqual(posted.cut, { percent: 10, from: 10 });
  const raised = Object.assign({}, terms, { haulCutPercent: 25 });
  assert.equal(tc.haulCut(posted, raised), 10, 'paid as posted');
  assert.equal(tc.haulCut(tc.stampHaul({ pay: 100 }, raised), raised), 25, 'a new haul pays the new cut');
  assert.equal(tc.haulCut({ pay: 100 }, raised), 25, 'a haul from before stamps reads the current terms');
  assert.equal(tc.haulCut({ pay: 9 }, terms), 0);
  assert.equal(tc.haulCut({ pay: 'x' }, terms), 0);
  assert.equal(posted.dest, 'Windhelm', 'the stamp leaves the rest of the haul alone');
});

ok('the charter hook reads the setting', () => {
  const co = { company: true }, staff = { staff: true }, nobody = {};
  assert.equal(tc.mayCharter(co, terms), true);
  assert.equal(tc.mayCharter(staff, terms), true, 'an admin testing counts as the company');
  assert.equal(tc.mayCharter(nobody, terms), false);
  assert.equal(tc.mayCharter(null, terms), false);
  const anyone = Object.assign({}, terms, { charter: 'anyone' });
  assert.equal(tc.mayCharter(nobody, anyone), true);
  const st = Object.assign({}, terms, { charter: 'staff' });
  assert.equal(tc.mayCharter(co, st), false);
  assert.equal(tc.mayCharter(staff, st), true);
  assert.equal(tc.mayCharter({ company: 'yes' }, terms), false, 'only a real true counts');
});

ok('a proposal changes nothing; staff confirm it', () => {
  const state = { terms: tc.loadTerms(text), history: [] };
  const before = JSON.stringify(state);
  const next = Object.assign({}, state.terms, { haulFee: 40, freightPerLoad: 5 });
  const p = tc.proposeTerms(state.terms, next, [{ pay: 50 }, { pay: 80 }]);
  assert.equal(p.ok, true);
  assert.deepEqual(p.changes, [{ term: 'haulFee', from: 30, to: 40 }, { term: 'freightPerLoad', from: 0, to: 5 }]);
  assert.equal(p.openHaulsKeepTerms, 2);
  assert.equal(JSON.stringify(state), before, 'proposing touched nothing');
  next.haulFee = 999;
  assert.equal(p.next.haulFee, 40, 'the proposal is its own copy');
  const after = tc.adoptTerms(state, p, 1000);
  assert.equal(after.terms.haulFee, 40);
  assert.equal(after.history.length, 1);
  assert.deepEqual(after.history[0], { at: 1000, changes: p.changes }, 'the history names nobody (#2353)');
  assert.equal(JSON.stringify(state), before, 'adopting returns new state');
  assert.throws(() => tc.adoptTerms(after, p, 1001), /changed since/, 'a stale proposal');
  assert.throws(() => tc.adoptTerms(state, p, -1), /says when/);
  const same = tc.proposeTerms(state.terms, state.terms, []);
  assert.throws(() => tc.adoptTerms(state, same, 1), /changes nothing/);
  const refused = tc.proposeTerms(state.terms, Object.assign({}, state.terms, { haulFee: -3 }), []);
  assert.equal(refused.ok, false);
  assert.ok(refused.why.length > 0);
  assert.throws(() => tc.adoptTerms(state, refused, 'staff:1', 1), /refused/);
});

ok('nothing in the module names a person, a hold, a port or a time', () => {
  const src = fs.readFileSync(path.join(__dirname, '../game/trading-company.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const word of ['Solitude', 'Windhelm', 'Dawnstar', 'Haafingar', 'Eastmarch', 'Date.now', 'setTimeout', 'setInterval']) {
    assert.ok(src.indexOf(word) < 0, word);
  }
});

// ---------------------------------------------------------------- #2695

// The block runs in a context of its own, so its objects are compared by value.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

ok('gamemode.js carries the terms and the module as the build script makes them', () => {
  const lib = fs.readFileSync(path.join(__dirname, '../game/trading-company.js'), 'utf8');
  assert.equal(build.build(mode, text, lib), mode, 'run node scripts/dev/Build-TradingCompanyGamemode.js');
  assert.ok(fixture.blockOf(mode), 'one company terms block');
  const stale = Object.assign({}, terms, { haulFee: terms.haulFee + 1 });
  assert.notEqual(build.build(mode, JSON.stringify(stale), lib), mode, 'a change to the file shows as stale');
});

ok('the property block keeps no number of the company\'s own any more', () => {
  assert.ok(prop, 'the property block');
  assert.ok(!/HAUL_TENTH_FROM|SALE_CUT_FROM/.test(prop), 'no fixed cut floors');
  assert.ok(!/Math\.floor\(p \/ 10\)/.test(prop), 'no fixed tenth');
  assert.ok(/g\.__thornswoodCompany/.test(propFn('haulTenth')) && /haulCut\(/.test(propFn('haulTenth')));
  assert.ok(/g\.__thornswoodCompany/.test(propFn('saleCuts')) && /\.saleCuts\(price\)/.test(propFn('saleCuts')));
});

ok('answer 5: a haul pays the company\'s haul fee, apart from the board\'s job fee', () => {
  const post = propFn('postHaul');
  assert.ok(post, 'postHaul');
  assert.ok(post.indexOf('JOB_FEE') < 0, 'posting a haul never reads the job fee');
  assert.ok(/var fee = co\.haulFee\(\);\s*\n\s*var cost = fee \+ pay;/.test(post));
  assert.ok(/var made = co\.stampHaul\(\{/.test(post) && /notices\[hold\]\.push\(made\);/.test(propFn('landHaul') || ''),
    'the haul carries the cut it was posted under, stamped when it is asked for and put up as stamped once the pack is saved (#4901)');
  assert.ok(/not loaded on this server, so no haul is posted/.test(post), 'no terms, no haul, never a guessed fee');
  assert.equal(JOB_FEE, 30, 'the board job fee is its own 30');
  assert.ok(/var fee = isJob \? JOB_FEE : NOTICE_FEE;/.test(prop), 'a job still pays the job fee');
  const confirm = propFn('confirmHaul');
  assert.ok(/var tenth = haulTenth\(pay, n\);\s*\n\s*if \(tenth === null\)/.test(confirm), 'delivery pays by the stamp, or not at all');
});

ok('the trade block refuses a sale when the terms are not loaded', () => {
  assert.ok(/var cuts = pr\.saleCuts\(price\);\s*\n\s*if \(!cuts\) \{ return refuse\(/.test(modeLf));
});

const api = fixture.companyApi(mode);
ok('the block\'s API reads the shipped terms: answers 3 and 4 by default', () => {
  deq(api.terms(), terms);
  assert.equal(api.haulFee(), 30);
  assert.equal(api.mayCharter({ company: true }), true, 'the Trading Company role charters');
  assert.equal(api.mayCharter({}), false, 'anybody else does not, by default');
  assert.equal(api.mayCharter({ staff: true }), true);
  deq(api.freightFor(), { gold: 0, to: 'ledger' }, 'no freight, and a ledger fee when staff set one');
  deq(api.saleCuts(125), { price: 125, worker: 12, gone: 12, seller: 101 });
  const h = api.stampHaul({ pay: 100 });
  deq(h.cut, { percent: 10, from: 10 });
  assert.equal(api.haulCut(h), 10);
});

ok('mayCharter keeps its name, arguments and return shape for #2700', () => {
  assert.equal(typeof tc.mayCharter, 'function');
  assert.equal(tc.mayCharter.length, 2, 'mayCharter(who, terms)');
  for (const who of [{ company: true }, { staff: true }, {}, null, undefined, { company: 'yes' }]) {
    assert.equal(typeof tc.mayCharter(who, terms), 'boolean');
  }
  assert.equal(api.mayCharter.length, 1, 'the server\'s mayCharter(who) over the terms in force');
});

/* A disk of its own for the block, so a restart is a second load over the same files. */
function disk() {
  const files = {};
  const fake = {
    files: files,
    readFileSync(p) {
      const k = String(p);
      if (!Object.prototype.hasOwnProperty.call(files, k)) { const e = new Error('ENOENT ' + k); e.code = 'ENOENT'; throw e; }
      return files[k];
    },
    existsSync(p) { return Object.prototype.hasOwnProperty.call(files, String(p)) || String(p) === 'private'; },
    mkdirSync() { },
    writeFileSync(p, t) { files[String(p)] = String(t); },
    renameSync(a, b) { files[String(b)] = files[String(a)]; delete files[String(a)]; }
  };
  return { fs: fake, require: (n) => (n === 'fs' ? fake : require(n)) };
}
const FILE = path.join('private', 'company-terms.json');

function server(d, extra) {
  const said = [];
  const records = [];
  const staffPids = (extra && extra.staff) || [7];
  const globals = Object.assign({
    mp: { get: (id, key) => (key === 'appearance' ? { name: 'Staffer' } : (key === 'onlinePlayers' ? [] : undefined)) },
    __thornswoodIsStaff: (pid) => staffPids.indexOf(pid) >= 0,
    __thornswoodStaff: (extra && extra.noLog) ? undefined : {
      unproven: (cmd) => (cmd && cmd.proven === true ? '' : 'not proven'),
      record: function () { records.push(Array.prototype.slice.call(arguments)); }
    },
    __thornswoodProperty: { notices: () => (extra && extra.notices) || {} }
  }, (extra && extra.globals) || {});
  const c = fixture.load(mode, { require: d.require, globals: globals }).api;
  const proven = { proven: true };
  function line(pid, l, cmd) {
    const parts = l.split(/\s+/);
    c.command(parts, 0xff000001, pid, (p, m) => said.push(m), cmd === undefined ? proven : cmd);
    return said[said.length - 1];
  }
  return { c, said, records, line };
}

ok('a staff member proposes on the card; nothing changes until a confirm; a restart keeps both', () => {
  const d = disk();
  const notices = { whiterun: [tc.stampHaul({ haul: true, pay: 50 }, terms), { haul: true, pay: 9 },
                               Object.assign(tc.stampHaul({ haul: true, pay: 80 }, terms), { paid: 72 })] };
  const s1 = server(d, { notices });
  const m = s1.line(7, '/companyterms propose freightPerLoad=5 haulFee=40');
  assert.match(m, /You propose new terms/);
  assert.match(m, /1 open haul keeps the terms it was posted under/, 'only the open, stamped haul');
  assert.equal(s1.c.haulFee(), 30, 'proposing changed nothing');
  deq(s1.records[0].slice(0, 5), ['companypropose', 7, 'Staffer', 0, 'the company\'s terms']);
  const p = s1.c.pending();
  deq(p.changes, [{ term: 'haulFee', from: 30, to: 40 }, { term: 'freightPerLoad', from: 0, to: 5 }]);
  const s2 = server(d);
  deq(s2.c.pending().changes, p.changes, 'the proposal survives a restart');
  assert.match(s2.line(7, '/companyterms confirm ' + (p.at + 1)), /not the proposal waiting now/);
  assert.equal(s2.c.haulFee(), 30, 'a stale confirm changed nothing');
  assert.match(s2.line(7, '/companyterms confirm ' + p.at), /terms change/);
  assert.equal(s2.c.haulFee(), 40);
  deq(s2.c.freightFor(), { gold: 5, to: 'ledger' }, 'a ledger fee, set by staff');
  assert.equal(s2.c.pending(), null);
  assert.equal(s2.records[0][0], 'companyconfirm');
  const s3 = server(d);
  assert.equal(s3.c.haulFee(), 40, 'the confirmed terms survive a restart');
  const h = s3.c.history();
  assert.equal(h.length, 1);
  deq(Object.keys(h[0]).sort(), ['at', 'changes'], 'the kept history names nobody: who is in the staff log (#2353)');
  assert.equal(p.by, undefined, 'nor does the kept proposal');
  assert.match(s2.records[0][5], /^proposed before the last restart: /, 'a confirm after a restart says the proposer is not known here');
  assert.equal(s3.c.haulCut(notices.whiterun[0]), 5, 'a haul posted before keeps its cut');
});

ok('a proposal that would not check, or names a term the card has not, or changes nothing, is refused whole', () => {
  const s = server(disk());
  assert.match(s.line(7, '/companyterms propose haulCutPercent=101'), /Nothing changed/);
  assert.match(s.line(7, '/companyterms propose saleWorkerPercent=60 saleGonePercent=41'), /more than the price/);
  assert.match(s.line(7, '/companyterms propose v=2'), /does not know/);
  assert.match(s.line(7, '/companyterms propose bogus=1'), /does not know/);
  assert.match(s.line(7, '/companyterms propose haulFee=-1'), /does not know/);
  assert.match(s.line(7, '/companyterms propose haulFee=1x'), /whole number/);
  assert.match(s.line(7, '/companyterms propose charter=jarl'), /charter must be one of/);
  assert.match(s.line(7, '/companyterms propose haulFee=30'), /in force already/);
  assert.match(s.line(7, '/companyterms propose haulFee=31 haulFee=32'), /twice/);
  assert.match(s.line(7, '/companyterms propose'), /Change a term/);
  assert.equal(s.c.pending(), null);
  assert.equal(s.records.length, 0, 'nothing refused goes in the staff log');
});

ok('every line is checked for staff again on the server, with the staff block\'s proof', () => {
  const s = server(disk());
  assert.match(s.line(8, '/companyterms propose haulFee=40'), /staff's\. Nothing changed/);
  assert.match(s.line(7, '/companyterms propose haulFee=40', {}), /not proven/);
  assert.equal(s.c.pending(), null);
  const nolog = server(disk(), { noLog: true });
  assert.match(nolog.line(7, '/companyterms propose haulFee=40'), /staff log is not loaded/);
  assert.equal(nolog.c.pending(), null);
  s.line(7, '/companyterms propose haulFee=40');
  const at = s.c.pending().at;
  assert.match(s.line(8, '/companyterms confirm ' + at), /staff's/);
  assert.equal(s.c.haulFee(), 30, 'not staff, no confirm');
  assert.match(s.line(7, '/companyterms drop ' + at), /drop the proposal/);
  assert.equal(s.c.pending(), null);
  assert.equal(s.c.haulFee(), 30);
  assert.equal(s.records[s.records.length - 1][0], 'companydrop');
  assert.match(s.line(7, '/companyterms drop ' + at), /Nothing is proposed/);
});

ok('a confirm against terms changed since the proposal is refused', () => {
  const d = disk();
  const a = server(d);
  a.line(7, '/companyterms propose haulFee=40');
  const p = a.c.pending();
  a.c.confirm(p.at, 'Staffer (profile 7)');
  // A proposal written against the old terms, as another server's card might have been.
  d.fs.files[FILE] = JSON.stringify(Object.assign(JSON.parse(d.fs.files[FILE]), { pending: p }));
  const b = server(d);
  assert.match(b.line(7, '/companyterms confirm ' + p.at), /changed since/);
  assert.equal(b.c.haulFee(), 40);
});

ok('a file that does not read or check leaves the shipped terms, and is put aside on the next write', () => {
  const d = disk();
  d.fs.files[FILE] = '{"terms":{"v":1,"haulFee":-5}}';
  const s = server(d);
  deq(s.c.terms(), terms, 'never half used');
  s.line(7, '/companyterms propose haulFee=35');
  assert.ok(Object.keys(d.fs.files).some((k) => k.indexOf('company-terms.json.unreadable-') >= 0), 'the bad file is kept');
  assert.equal(JSON.parse(d.fs.files[FILE]).pending.next.haulFee, 35);
  const nofs = fixture.companyApi(mode);
  assert.equal(nofs.propose(Object.assign({}, terms, { haulFee: 35 }), 'x').ok, false, 'no disk, no change');
});

ok('the card is drawn for staff only, with every term but the version', () => {
  const s = server(disk());
  assert.equal(s.c.staffView(8), null);
  const v = s.c.staffView(7);
  deq(v.fields.map((x) => x.key), tc.KEYS.filter((k) => k !== 'v'));
  deq(v.fields.find((x) => x.key === 'charter').choices, tc.CHARTER);
  deq(v.fields.find((x) => x.key === 'freightTo').choices, tc.FREIGHT_TO);
  assert.equal(v.pending, null);
  s.line(7, '/companyterms propose charter=anyone');
  deq(s.c.staffView(7).pending.changes, [{ term: 'charter', label: 'Who charters a ship hold', from: 'company', to: 'anyone' }]);
});

ok('the wiring: the Office page carries the card for staff, and its word is never a player\'s', () => {
  function arrayOf(name) {
    const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(modeLf);
    return m ? new Function('return ' + m[1])() : null;
  }
  assert.ok(arrayOf('WORDS').indexOf('/companyterms') >= 0);
  assert.ok(arrayOf('PLAYER_WORDS').indexOf('/companyterms') < 0);
  assert.ok(/word === '\/companyterms' \|\|/.test(modeLf), 'the character block hands it to the property block');
  assert.ok(/if \(word === '\/companyterms'\) \{\s*\n\s*var companyTerms = g\['__thornswoodCompany'\];/.test(prop));
  assert.ok(/view\.company = \(staff && companyApi && companyApi\.staffView\) \? companyApi\.staffView\(pid\) : null;/.test(prop));
  const ui = fs.readFileSync(path.join(__dirname, '../game/ui/thornswood-skills.js'), 'utf8');
  assert.ok(/if \(o\.company\) wrap\.appendChild\(officeCompany\(o\.company\)\);/.test(ui));
  assert.ok(/officeButton\('Confirm', '\/companyterms confirm ' \+ String\(Number\(p\.at\) \|\| 0\), 'Press again/.test(ui), 'confirm asks twice');
  assert.ok(/return '\/companyterms propose ' \+ pairs\.join\(' '\);/.test(ui));
});

ok('nothing in the block proposes by itself or names a person, a hold or a time', () => {
  const block = fixture.blockOf(mode).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const word of ['Solitude', 'Windhelm', 'Whiterun', 'setTimeout', 'setInterval']) { assert.ok(block.indexOf(word) < 0, word); }
});

ok('the new files are UTF-8 without a BOM', () => {
  for (const p of ['../scripts/dev/Build-TradingCompanyGamemode.js', './fixtures/company-block.js']) {
    assert.notEqual(fs.readFileSync(path.join(__dirname, p), 'utf8').charCodeAt(0), 0xFEFF, p);
  }
});

console.log('test-512-trading-company: ' + passed + ' passed, 0 failed');
