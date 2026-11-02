/*
  The characters each game server holds, the hold economy counts (#3164)
  and how many character slots a person has.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { cleanEconomy, economyNow, slotsFor };

const path   = require('path');
const { DATA } = require('./base');
const { cfg } = require('./config');
const { jsonFile } = require('./store');
// The game server's character roster, pushed here by the gamemode with the
// door key (POST /api/roster) and handed back per person (POST /api/play/roster).
// Keyed by profile id; live and dev both push into it, their ids never meet.
const ROSTER = path.join(DATA, 'roster.json');
// How old a server's report of which characters it holds may be and still be
// passed on (#955). It is sent every five minutes; an hour covers a restart.
const ROSTER_HELD_FRESH_MS = 60 * 60 * 1000;

/*
  WHAT EACH HOLD GATHERS, MAKES AND TRADES (#3164), for the hub's Hold economy
  page. Each game server counts it (the hold economy block in
  game\gamemode.js) and sends the whole of what it keeps every five minutes,
  POST /api/economy with the door key; the dev server's door names the site
  with /dev, so its count lands on /dev/api/economy. Kept per server and
  replaced whole on each push, so this file holds what the game server holds
  and never more, and days past ECONOMY_KEEP_DAYS go on every write and read.
  A row is a day, a hold, a kind, an item and a count: nothing about anybody.
*/
const ECONOMY = path.join(DATA, 'economy.json');
const ECONOMY_KINDS = ['gathered', 'crafted', 'bought', 'sold', 'hauled'];
const ECONOMY_HOLDS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
                       'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock', 'elsewhere'];
const ECONOMY_KEEP_DAYS = 30;
const ECONOMY_MOST = 1000000000;
/* The box's own date, the day the game server counts a row on (same box). */
function economyDay(t) {
  const d = new Date(t);
  const two = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
/* One server's count held to its shape: anything else is left out. */
function cleanEconomy(o, now) {
  const out = { at: 0, today: '', keepDays: ECONOMY_KEEP_DAYS, days: {}, names: {} };
  if (!o || typeof o !== 'object') return out;
  out.at = Number(o.at) > 0 ? Number(o.at) : 0;
  out.today = /^\d{4}-\d{2}-\d{2}$/.test(String(o.today || '')) ? String(o.today) : '';
  const cut = economyDay((Number(now) || Date.now()) - (ECONOMY_KEEP_DAYS - 1) * 86400000);
  const days = (o.days && typeof o.days === 'object') ? o.days : {};
  const names = (o.names && typeof o.names === 'object') ? o.names : {};
  const has = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  for (const day of Object.keys(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cut) continue;
    const holds = days[day];
    if (!holds || typeof holds !== 'object') continue;
    for (const hold of Object.keys(holds)) {
      if (ECONOMY_HOLDS.indexOf(hold) < 0) continue;
      const kinds = holds[hold];
      if (!kinds || typeof kinds !== 'object') continue;
      for (const kind of ECONOMY_KINDS) {
        const items = kinds[kind];
        if (!items || typeof items !== 'object') continue;
        for (const key of Object.keys(items)) {
          const n = items[key];
          if (!key || key.length > 120 || key === '__proto__' || !Number.isSafeInteger(n) || n <= 0) continue;
          const row = ((out.days[day] = out.days[day] || {})[hold] = out.days[day][hold] || {});
          (row[kind] = row[kind] || {})[key] = Math.min(n, ECONOMY_MOST);
          const nm = has(names, key) && typeof names[key] === 'string' ? names[key].slice(0, 120) : '';
          out.names[key] = nm || key;
        }
      }
    }
  }
  return out;
}
/* Every server's count as kept now, aged on the way out as well as in. */
function economyNow(now) {
  const store = jsonFile(ECONOMY, { servers: {} });
  const servers = (store && store.servers && typeof store.servers === 'object') ? store.servers : {};
  const out = {};
  for (const srv of ['main', 'dev']) {
    if (servers[srv]) out[srv] = cleanEconomy(servers[srv], now);
  }
  return out;
}

/* How many character slots this person gets at the game's main menu. */
function slotsFor(st) {
  if (!st) return 2;
  if (st.admin || st.dev) return 3;
  const roles = Array.isArray(st.roles) ? st.roles : [];
  return (cfg.access.slots3 || []).some((n) => roles.indexOf(n) >= 0) ? 3 : 2;
}

Object.assign(module.exports, { ECONOMY, ECONOMY_KEEP_DAYS, ROSTER,
  ROSTER_HELD_FRESH_MS });
