'use strict';
// The real trade page/front bridge queues a late Agree into the whole gamemode.
// Only accepted activity renews the existing idle window, never a refusal.
const fs = require('fs'), path = require('path');
const standIn = require('../../tests/stand-in-server');
const makePage = require('../../tests/fixtures/panel-page');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({name: '4892-trade-idle', settings: {thornswoodServer: 'main'}});
const root = path.join(__dirname, '../..'), SWORD = '12eb7:Skyrim.esm';
w.record(SWORD, 'WEAP', {editorId: 'IronSword'});
const a = w.person(0xff004892, {profileId: 1000, name: 'Brenna', cell: '3c:Skyrim.esm', pos: [0, 0, 0], inventory: {entries: [{baseId: w.idOf(SWORD), count: 4}, {baseId: 15, count: 100}]}});
const b = w.person(0xff004893, {profileId: 1001, name: 'Corvin', cell: '3c:Skyrim.esm', pos: [100, 0, 0], inventory: {entries: [{baseId: 15, count: 100}]}});
const api = () => w.box().__thornswoodTrade;
const live = () => api().tradeOf(a);
const view = id => w.prop(id, 'thornswoodTrade') || {};
const packs = () => JSON.stringify([w.row(a).inventory, w.row(b).inventory]);
const writes = () => w.did.filter(row => row[2] === 'set' && row[3] === 'inventory').length;
function begin() { if (live()) api().cancel(a); return api().begin(a, b) === ''; }
function say(id, line) { w.say(id, line); w.run(2100); return w.heard(id).at(-1) || ''; }
function drawnAgree(id) {
  const p = makePage();
  p.run('bridge', fs.readFileSync(path.join(root, 'game/ui/thornswood-bridge.js'), 'utf8'));
  p.run('trade', fs.readFileSync(path.join(root, 'game/ui/thornswood-trade.js'), 'utf8'));
  p.win.thornswoodTrade.setData(view(id));
  p.doc.getElementById('ts-trade-ok').click();
  return p.sent.at(-1) || '';
}
function nearDeadline() { w.run(live().at + api().TRADE.idleFor - 6000 - w.now()); }
function expiresAt(at) { w.run(Math.max(0, at + api().TRADE.idleFor + api().TRADE.every + 1 - w.now())); return !live(); }

yes('the whole gamemode loads', w.boot());
if (w.loaded()) {
  [a, b].forEach(w.arrive); w.run(30000);
  yes('a fresh untouched trade opens', begin());
  const untouched = live().at;
  yes('an untouched trade still expires on its ordinary deadline', expiresAt(untouched));

  begin(); nearDeadline();
  const oldAt = live().at, before = packs(), beforeWrites = writes(), click = drawnAgree(a), sentAt = w.now();
  yes('the actual page captures the current versioned Agree wire', click === '/trade agree ' + view(a).offerVersion);
  say(a, click);
  const renewedAt = live() && live().at;
  yes('a first valid queued approval renews the clock at server acceptance', !!live() && live().okA && !live().okB && renewedAt > oldAt && renewedAt >= sentAt && renewedAt <= w.now() && renewedAt === view(a).at);
  yes('the renewed approval alone never changes items or gold', packs() === before && writes() === beforeWrites);
  // Go past the former deadline, then nearly a full normal window after acceptance.
  w.run(Math.max(0, oldAt + api().TRADE.idleFor + api().TRADE.every + 1 - w.now()));
  yes('a late approval stays open past its former idle deadline', !!live());
  if (live()) {
    w.run(Math.max(0, renewedAt + api().TRADE.idleFor - 1 - w.now()));
    yes('the accepted approval gets the full ordinary idle window', !!live());
    yes('there is no extra expiry grace beyond the ordinary idle window', expiresAt(renewedAt));
  } else {
    yes('the accepted approval gets the full ordinary idle window', false);
    yes('there is no extra expiry grace beyond the ordinary idle window', false);
  }

  for (const kind of ['missing', 'malformed', 'stale', 'extra', 'legacy', 'refresh', 'replay']) {
    begin();
    const version = view(a).offerVersion;
    if (kind === 'replay') say(a, drawnAgree(a));
    if (kind === 'stale') api().gold(b, 1);
    const at = live().at; nearDeadline();
    const line = kind === 'missing' ? '/trade agree' : kind === 'malformed' ? '/trade agree bad'
      : kind === 'extra' ? '/trade agree ' + view(a).offerVersion + ' extra'
      : kind === 'legacy' ? '/trade ok ' + view(a).offerVersion : kind === 'refresh' ? '/trade refresh'
      : '/trade agree ' + version;
    say(a, line);
    yes(kind + ' cannot renew the trade idle clock', !!live() && live().at === at);
    yes(kind + ' leaves the ordinary expiry deadline intact', expiresAt(at));
  }

  // Place the deadline between native expiry ticks: the approval must not
  // revive an expired conversation simply because its cleanup tick is next.
  if (live()) api().cancel(a);
  const every = api().TRADE.every;
  w.run((1000 - w.now() % every + every) % every);
  begin(); const expiredAt = live().at, expiredVersion = view(a).offerVersion;
  w.run(api().TRADE.idleFor + 1);
  yes('the overdue request arrives before the next cleanup tick', !!live());
  const expiredAnswer = api().confirm(a, expiredVersion);
  yes('a valid token after the strict deadline cannot revive the trade', /timed out/.test(expiredAnswer) && !!live() && !live().okA && !live().okB && live().at === expiredAt);
  yes('the normal cleanup tick still closes the overdue trade', expiresAt(expiredAt));

  // A second approval that cannot swap must not gain activity by invalidating.
  begin(); api().gold(a, 10); say(a, drawnAgree(a));
  const refusedAt = live().at;
  w.row(a).inventory.entries = w.row(a).inventory.entries.filter(row => row.baseId !== 15);
  nearDeadline(); const refusedPack = packs(), refusedWrites = writes();
  say(b, drawnAgree(b));
  yes('a refused swap clears approval without renewing idle time', !!live() && !live().okA && !live().okB && live().at === refusedAt);
  yes('the refused swap preserves both packs', packs() === refusedPack && writes() === refusedWrites);
  yes('a refused swap still expires at its previous deadline', expiresAt(refusedAt));
  w.row(a).inventory.entries.push({baseId: 15, count: 100});

  const property = w.box().__thornswoodProperty, company = w.box().__thornswoodCompany;
  const membership = property.inCompany; property.inCompany = pid => pid === 1001;
  begin(); api().gold(b, 20); api().sale(b); say(a, drawnAgree(a));
  const payoutAt = live().at; nearDeadline();
  const proposal = company.propose({...company.terms(), saleWorkerPercent: 20}, 'Fixture staff');
  yes('canonical company terms can change while this trade is idle', proposal.ok && company.confirm(proposal.pending.at, 'Fixture reviewer').ok);
  const payoutPacks = packs(), payoutWrites = writes(); say(b, drawnAgree(b));
  yes('a changed-payout refusal invalidates approval without renewing time', !!live() && !live().okA && !live().okB && live().at === payoutAt);
  yes('the changed-payout refusal writes neither inventory', packs() === payoutPacks && writes() === payoutWrites);
  yes('a changed-payout refusal keeps its previous expiry deadline', expiresAt(payoutAt));
  property.inCompany = membership;

  // Existing successful edits keep renewing the same clock.
  begin();
  for (const edit of [() => api().add(a, '12eb7', 1), () => api().add(a, '12eb7', 1),
      () => api().remove(a, '12eb7', 1), () => api().gold(b, 2)]) {
    const at = live().at; w.run(3000); const answer = edit();
    yes('a successful pile edit still renews activity', answer === '' && live().at === w.now() && live().at > at);
  }
  property.inCompany = pid => pid === 1001;
  for (let i = 0; i < 2; i++) { const at = live().at; w.run(3000); api().sale(b); yes('a successful sale-mode change still renews activity', live().at === w.now() && live().at > at); }
  property.inCompany = membership;
  const validA = drawnAgree(a), validB = drawnAgree(b), swapWrites = writes();
  say(a, validA); say(b, validB);
  yes('two current approvals still exchange exactly once', !live() && writes() === swapWrites + 2);
  const swapped = packs(); say(a, validA); say(b, validB);
  yes('completed approval replay cannot repeat the exchange', packs() === swapped && writes() === swapWrites + 2);
}
t.done(w);
