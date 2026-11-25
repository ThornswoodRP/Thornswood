'use strict';
// Legacy trade fixtures agree to the same owner view the real page receives.
// A closed trade has no observed offer, including deliberate replay checks.
module.exports = function observedOfferVersion(trade, actor) {
  const live = trade.tradeOf(actor);
  return live ? trade.view(live, actor).offerVersion : undefined;
};
