'use strict';
// test-4475-panel-updates.js
//
// An update from the server changes what changed in a panel and keeps the
// rest (#4475). The panels used to put every update in with innerHTML, which
// threw away the field somebody was typing in: focus fell to the page and the
// text went back to what the server last said, every second or so. Measured in
// Chromium on 26 Nov before the change: the trader's and the ship's counts
// went back to 1 and 5 with focus on the page, and the drop box lost a row's
// count. Now they are kept, a count stays with its item when the list moves,
// a press meant for a gone row never lands on another, the P panel is left
// alone when only positions move, and Join now and Choose another character
// answer Enter and Space while waiting in line.
//
// Runs the real pages and the real bridge in tests/fixtures/panel-page.js.
//
//   node game/tests/test-4475-panel-updates.js
//
// Read only.
const fs = require('fs'), path = require('path');
const makePage = require('../../tests/fixtures/panel-page');
const root = path.join(__dirname, '../..');
const ui = name => fs.readFileSync(path.join(root, 'game/ui/thornswood-' + name + '.js'), 'utf8');
let pass = 0, fail = 0;
function yes(what, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + what); ok ? pass++ : fail++; }
const copy = v => JSON.parse(JSON.stringify(v));
function page(name, word, view) {
  const p = makePage();
  p.run('bridge', ui('bridge'));
  p.run(name, ui(name));
  p.api = p.win['thornswood' + word];
  p.view = copy(view);
  p.feed = change => { if (change) change(p.view); p.api.setData(copy(p.view)); };
  p.feed();
  if (!p.api.isOpen()) p.api.open();
  p.byLabel = label => p.doc.querySelectorAll('input').find(n => n.getAttribute('aria-label') === label) || null;
  p.type = (node, text) => { node.focus(); node.value = text; node.selectionStart = 1; node.selectionEnd = 1; if (node.oninput) node.oninput.call(node); };
  return p;
}

// ------------------------------------------------------ the trader --
const trader = { open: true, sessionId: 'm1', trader: 'Smith', place: 'Whiterun', canTrade: true, purse: 100, quests: [],
  offers: [{ name: 'Iron Ingot', buy: 5, sell: 10, maxSell: 3, carried: 3, stock: 4 },
           { name: 'Steel Ingot', buy: 8, sell: 16, maxSell: 2, carried: 2, stock: 6 }] };
{
  const p = page('merchant', 'Merchant', trader);
  const field = p.byLabel('Sell count for Steel Ingot');
  p.type(field, '2');
  p.feed(v => { v.purse = 90; });
  yes('trader: a count being typed is the same field after an update', p.byLabel('Sell count for Steel Ingot') === field);
  const now = p.byLabel('Sell count for Steel Ingot');
  yes('trader: it keeps its focus, its text and its caret', !!now && p.doc.activeElement === now && now.value === '2' && now.selectionStart === 1);
  p.feed(v => { v.offers.shift(); });
  yes('trader: when a line above it goes, the count stays with its item', p.byLabel('Sell count for Steel Ingot') === field && field.value === '2' && p.doc.activeElement === field);
  const sell = p.doc.querySelector('[data-verb="sell"]');
  field.max = field.getAttribute('max'); field.setCustomValidity = () => { }; field.reportValidity = () => { };
  sell.click();
  yes('trader: Sell sends the count typed for that item', p.sent.at(-1) === '/merchant sell 2 @8 Steel Ingot');
  sell.focus();
  p.feed(v => { v.offers = []; });
  const dialog = p.doc.querySelector('[role="dialog"]');
  yes('trader: a focused button whose line is gone hands focus to the dialog, not to another line', p.doc.activeElement === dialog);
  p.feed(v => { v.offers = copy(trader.offers); });
  p.type(p.byLabel('Buy count for Iron Ingot'), '4');
  p.feed(v => { v.sessionId = 'm2'; });
  const fresh = p.byLabel('Buy count for Iron Ingot');
  yes('trader: another session gets new fields, with nothing typed for the last one', !!fresh && fresh.value !== '4');
}

// ------------------------------------------------------ the dock --
{
  const dock = { open: true, mode: 'dock', port: { name: 'Solitude' },
    holds: [{ id: 'S1', used: 2, max: 24, lines: [{ line: 1, count: 5, item: 'Ore', forName: 'A', canCollect: true },
                                                   { line: 2, count: 3, item: 'Hide', forName: 'A', canCollect: true }] }] };
  const p = page('ship', 'Ship', dock);
  const field = p.doc.getElementById('ts-ship-c-S1-2');
  p.type(field, '2');
  p.feed(v => { v.holds[0].lines.shift(); v.holds[0].used = 1; });
  yes('dock: a count stays typed and focused when the line above it is collected', p.doc.getElementById('ts-ship-c-S1-2') === field && field.value === '2' && p.doc.activeElement === field);
}

// ------------------------------------------------------ the drop box --
{
  const box = { open: true, hold: 'whiterun', where: 'Whiterun', packGold: 50,
    rows: [{ n: 1, count: 3, what: 'Bread', mine: true }, { n: 2, count: 4, what: 'Apple', mine: true }],
    pack: [{ slot: 1, what: 'Leek', count: 2 }, { slot: 2, what: 'Salt', count: 5 }] };
  const p = page('box', 'Box', box);
  const take = p.doc.getElementById('ts-box-take-2');
  p.type(take, '3');
  p.feed(v => { v.rows.shift(); });
  yes('drop box: a row\'s count is kept when the row above it is taken', p.doc.getElementById('ts-box-take-2') === take && take.value === '3' && p.doc.activeElement === take);
  const pick = p.doc.getElementById('ts-box-slot');
  const salt = pick.querySelectorAll('option').find(o => o.getAttribute('value') === '2');
  p.feed(v => { v.pack.shift(); });
  yes('drop box: a pick in the list is the same option when the pack above it changes', pick.querySelectorAll('option').length === 1 && pick.querySelectorAll('option')[0] === salt);
  p.feed(v => { v.hold = 'windhelm'; v.where = 'Windhelm'; });
  yes('drop box: another hold\'s box gets new fields', p.doc.getElementById('ts-box-take-2') !== take);
}

// ------------------------------------------------------ a market stall --
{
  const stall = { open: true, mine: true, place: 'Whiterun', max: 24, found: [],
    lines: [{ n: 1, count: 3, what: 'Bread', words: '2 gold' }, { n: 2, count: 2, what: 'Leek', words: '1 gold' }],
    pack: [{ base: 'a', nth: 0, what: 'Apple', count: 3 }] };
  const p = page('stall', 'Stall', stall);
  const back = p.doc.getElementById('ts-stall-back-2');
  p.type(back, '1');
  p.feed(v => { v.lines.shift(); });
  yes('stall: a count to take back stays with its line', p.doc.getElementById('ts-stall-back-2') === back && back.value === '1' && p.doc.activeElement === back);
}

// ------------------------------------------------------ the P panel --
{
  const p = page('party', 'Party', { me: 1000, party: [{ p: 1000, name: 'Aldis', me: true, leader: true, on: true }, { p: 1001, name: 'Brenna', on: true }],
    friends: [], near: [], muted: [] });
  const body = p.doc.getElementById('ts-party-body');
  const first = body.childNodes[0];
  let writes = 0;
  const kick = p.doc.querySelector('[data-do="kick"]');
  const patch = p.win.thornswoodDialog.patch;
  p.win.thornswoodDialog.patch = function (host) { if (host === body) writes++; return patch.apply(this, arguments); };
  for (let i = 0; i < 10; i++) p.api.setWhere([{ p: 1001, x: i, y: 0, z: 0, cell: 1 }]);
  yes('P: positions moving redraw the strip and leave the panel as it was', writes === 0 && body.childNodes[0] === first && p.doc.querySelector('[data-do="kick"]') === kick);
}

// ------------------------------------------------------ the K panel --
{
  const p = makePage();
  p.run('bridge', ui('bridge'));
  p.run('skills', ui('skills'));
  const api = p.win.thornswoodSkills;
  const door = name => ({ name, by: 'Aldis', hold: 'whiterun', where: 'Whiterun', ours: true, rent: { amount: 5, every: 7, owed: 0 } });
  let hunger = 10, at = door('Breezehome');
  const feed = () => api.setData(null, { panel: { 'class': 'hunter', profession: 'smith', half: 'edgewright', ranks: {}, tree: {}, points: 0,
    body: { hunger: hunger++ }, officePage: { steward: true, offices: [], door: at } } });
  api.open();
  feed();
  const office = p.doc.querySelectorAll('.navrow').find(n => /^Office/.test(n.textContent));
  if (office) office.onclick();
  const rent = () => p.doc.querySelectorAll('input').find(n => n.getAttribute('aria-label') === 'Weekly rent in gold') || null;
  const field = rent();
  yes('K: the Office page has the rent box', !!field);
  if (field) {
    field.focus(); field.value = '12';
    feed();
    yes('K: the rent being typed is kept, focused, when the Body page\'s meters move', rent() === field && field.value === '12' && p.doc.activeElement === field);
    at = door('Jorrvaskr');
    feed();
    yes('K: another building\'s door draws a new rent box', !!rent() && rent() !== field);
  }
}

// ------------------------------------------------------ the shared code --
{
  const files = fs.readdirSync(path.join(root, 'game/ui')).filter(f => /^thornswood-.*\.js$/.test(f));
  const left = files.filter(f => /thornswoodDialog\.redraw/.test(fs.readFileSync(path.join(root, 'game/ui', f), 'utf8')));
  yes('no panel still puts its focus back after a rebuild: every one updates in place', left.length === 0 && !/redraw:\s*function/.test(ui('bridge')));
}

// ------------------------------------------------------ the line at the menu --
{
  const src = ui('select').split(String.fromCharCode(13)).join('');
  const a = src.indexOf('  var keysHere = false;'), b = src.indexOf("\n  window.addEventListener('keydown', onKey, true);", a);
  const KEYS = a < 0 || b < 0 ? null : src.slice(a, b);
  yes('line: the page\'s key handling can be lifted out', !!KEYS);
  if (KEYS) {
    const rig = function () {
      const st = { now: 10000, told: [], played: 0, clicks: 0 };
      const button = { tagName: 'BUTTON', click() { st.clicks++; } };
      const doc = { activeElement: button };
      const make = new Function('root', 'introKey', 'slots', 'draw', 'play', 'forget', 'tell', 'Date', 'setTimeout', 'clearTimeout', 'frontHere', 'document',
        'var moved = false, asking = 0, at = 0, introPhase = 0, waiting = true;\n' + KEYS + '\n' + 'return { onKey: onKey, keys: keysSay };');
      const api = make({ className: 'waiting turn', contains(n) { return n === button; } }, () => false, () => [{ id: 1, c: 1 }], () => { }, () => { st.played++; }, () => { },
        s => st.told.push(s), { now: () => st.now }, () => ({}), () => { }, () => { }, doc);
      const key = k => { let stopped = false; api.onKey({ key: k, preventDefault() { stopped = true; } }); return stopped; };
      return { st, api, key, doc };
    };
    for (const k of ['Enter', ' ']) {
      const r = rig();
      r.api.keys(true);
      const taken = r.key(k);
      yes('line: ' + JSON.stringify(k) + ' presses the focused Join now or Choose another once, and nothing plays', taken && r.st.clicks === 1 && r.st.played === 0);
    }
    {
      const r = rig();
      r.api.keys(false);
      r.key('Enter');
      yes('line: with the keyboard on another window, Enter presses nothing', r.st.clicks === 0);
    }
    {
      const r = rig();
      r.doc.activeElement = { tagName: 'DIV' };
      r.api.keys(true);
      yes('line: Enter with no button focused is left alone', r.key('Enter') === false && r.st.clicks === 0 && r.st.played === 0);
    }
  }
  yes('line: Join now takes the keyboard when the turn comes', /if \(first && elTurn\) elTurn\.focus\(\);/.test(src));
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
