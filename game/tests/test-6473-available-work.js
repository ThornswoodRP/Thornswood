'use strict';
// Whole gamemode NPC activation -> authoritative work view -> actual merchant
// renderer. Forged hidden-work requests still go through the queued command.
const fs = require('fs'), path = require('path'), vm = require('vm');
const standIn = require('../../tests/stand-in-server');
const t = standIn.checks(), yes = t.yes;
const catalogue = standIn.npcCatalogue(), roster = require('../data/merchant-roster.json');
const ledger = require('../../scripts/ops/New-AlphaMerchantLedger').createAlphaMerchantLedger(roster, require('../data/npc-population.json'));
const cook = roster.merchants.find(row => row.role === 'Cook' && row.bookHold === 'whiterun');
const placed = catalogue.population.keep.find(row => row[0] === cook.reference);
const w = standIn.world({ name: '6473-available-work', loadOrder: catalogue.population.plugins,
  settings: { loadOrder: catalogue.population.plugins, thornswoodServer: 'main' }, files: {
    'private/merchant-ledger.json': ledger, 'private/merchant-ledger.initialized': '1'
  } });
w.cast(catalogue);
const actor = w.person(0xff006473, { profileId: 1000, name: 'Brenna', prof: 'cook', half: 'hearthcook',
  cls: 'hunter', character: { ranks: { hearthcook: 'novice', confectioner: 'novice', hunter: 'master' } },
  cell: placed[2], pos: [placed[3][0] + 100, placed[3][1], placed[3][2]] });
const nodes = new Map();
const node = () => ({ style: {}, querySelector(selector) {
  if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector);
}, querySelectorAll: () => [], appendChild() {} });
const document = { head: node(), body: node(), createElement: node, addEventListener() {} };
const ui = { document, window: { skyrimPlatform: { sendMessage() {} } } };
const panelSource = fs.readFileSync(path.join(__dirname, '../ui/thornswood-merchant.js'), 'utf8');
vm.runInNewContext(panelSource, ui);
function render(view) {
  ui.window.thornswoodMerchant.setData(view);
  return nodes.get('#ts-merchant-body').innerHTML;
}
function visit() { w.activate(w.idOf(cook.reference), actor); w.run(500); return w.prop(actor, 'thornswoodMerchantView'); }
function say(text) { w.say(actor, text); w.run(1500); return w.heard(actor).slice(-1)[0] || ''; }
function has(html, id) { return html.includes('data-quest="' + id + '"'); }

yes('the whole gamemode loads', w.boot());
if (w.loaded()) {
  w.arrive(actor); w.run(30000);
  let view = visit(), html = render(view);
  const locked = view.quests.filter(row => row.state === 'locked');
  const available = view.quests.filter(row => row.canTake);
  yes('the real Novice Cook view contains rank-locked work and eligible work', locked.length > 0 && available.length > 0);
  yes('rank-locked work is absent from the actual NPC menu', locked.every(row => !has(html, row.id)));
  yes('eligible work remains visible and actionable', available.every(row => has(html, row.id)));
  const before = JSON.stringify(w.prop(actor, 'thornswoodQuests'));
  say('/merchant quest take ' + locked[0].id);
  yes('a forged hidden rank-locked request cannot alter saved work',
    JSON.stringify(w.prop(actor, 'thornswoodQuests')) === before);

  // Accepted scarce work remains manageable before any goods have been drawn.
  const accepted = available.find(row => row.id === 'mammoth');
  yes('the Master Hunter has eligible mammoth work from the Cook', !!accepted);
  if (accepted) {
    say('/merchant quest take ' + accepted.id);
    view = w.prop(actor, 'thornswoodMerchantView'); html = render(view);
    const open = view.quests.find(row => row.id === accepted.id);
    yes('accepting work preserves its return and leave controls', open.state === 'open' && !open.canTake && has(html, open.id) &&
      html.includes('data-action="abandon"') && html.includes('data-action="return"'));
    yes('held work does not conceal that no new work is available', /I have nothing for you at the moment\./.test(html));
    const original = w.prop(actor, 'thornswoodCharacter');
    w.box().mp.set(actor, 'thornswoodCharacter', { ...original, ranks: { ...original.ranks, hunter: 'novice' } });
    html = render(visit());
    yes('losing the original rank does not hide already accepted work or its leave control',
      has(html, accepted.id) && html.includes('data-action="abandon"'));
    w.box().mp.set(actor, 'thornswoodCharacter', original);
    say('/merchant quest abandon ' + accepted.id);
    yes('the visible leave control still has a working server action', !w.prop(actor, 'thornswoodQuests').open[accepted.id]);
  }

  // Restore a persisted, valid cooldown, as on an ordinary relog after completion.
  const cool = Object.fromEntries(available.map(row => [row.id, w.now() + 60000]));
  w.box().mp.set(actor, 'thornswoodQuests', { v: 1, open: {}, cool });
  view = visit(); html = render(view);
  const cooling = view.quests.filter(row => row.state === 'cooldown');
  yes('the actual saved cooldown is represented by the server', cooling.length === available.length);
  yes('cooling-down work is absent from the NPC menu', cooling.every(row => !has(html, row.id)));
  yes('when all new work is locked or cooling down the NPC says nothing is available',
    /I have nothing for you at the moment\./.test(html) && !html.includes('>Take work</button>'));
  const coolingBefore = JSON.stringify(w.prop(actor, 'thornswoodQuests'));
  say('/merchant quest take ' + cooling[0].id);
  yes('a forged cooling-down request cannot alter its saved cooldown or accept work',
    JSON.stringify(w.prop(actor, 'thornswoodQuests')) === coolingBefore);
  w.run(61000); view = visit(); html = render(view);
  yes('work becomes visible again after its real server cooldown expires',
    available.every(row => view.quests.some(next => next.id === row.id && next.canTake) && has(html, row.id)) &&
    !/I have nothing for you at the moment\./.test(html));

  const standing = w.prop(actor, 'thornswoodCharacter');
  w.box().mp.set(actor, 'thornswoodCharacter', { ...standing, ranks: { ...standing.ranks, hearthcook: 'advanced' } });
  const advanced = visit(), advancedHtml = render(advanced);
  const unlocked = advanced.quests.filter(row => row.canTake && locked.some(old => old.id === row.id));
  yes('newly satisfied real profession requirements reveal the unlocked commission',
    unlocked.length > 0 && unlocked.every(row => has(advancedHtml, row.id)));

  // All providers share this menu, including commissions temporarily unable to take.
  const item = available[0];
  html = render({ ...view, quests: [{ ...item, id: 'no-pay', kind: 'commission', state: 'unavailable', canTake: false, goods: [] }] });
  yes('a non-actionable commission is hidden and uses the same empty-work message',
    !has(html, 'no-pay') && /I have nothing for you at the moment\./.test(html));
  html = render({ ...view, quests: [] });
  yes('a trader with no work rows also explains there is no work at the moment', /I have nothing for you at the moment\./.test(html));
  yes('ordinary buying and selling remain present when there is no guild work',
    html.includes('Sell from your pack') && html.includes('Buy from their shelf'));
}
t.done(w);
