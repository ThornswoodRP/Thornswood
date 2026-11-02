/*
  The Discord server's members, a person's standing, the hold offices and
  their roles, and who has left.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { changeOffice, departed, officesForDoor, standing };

const { cfg } = require('./config');
const { jsonFile } = require('./store');
const { BANS_BROKEN_WHY, bansNow, modLog } = require('./staff');
const { standCache, standGood, standingCached, within } = require('./auth');
const { discordGet, discordWrite, LINKED, roleNames } = require('./discord');

/* The whole member list in ONE request instead of one request per person.

   /api/allowed walks every linked account and asked Discord about each one
   separately. standingCached holds an answer for sixty seconds and both doors
   ask every five minutes, so the cache was always cold by the time they came
   back: about forty lookups per door, two doors, every five minutes, in a
   burst. The live server's log read "the site could not reach Discord, keeping
   the list as it was: rate limited by Discord" at 16:44, 16:49, 16:54, 16:59,
   17:04 and 17:09 on 22 September, once per refresh, which is what that burst
   looks like from the other end.

   One request answers for everybody. Cached the same sixty seconds, so a page
   that asks about several people in a row still only asks Discord once.

   It needs the Server Members intent, which is a switch in the Discord
   developer portal and may be off. A 403 comes back, byId stays null, and
   every caller falls through to the single lookup it used before, so this can
   only make things better or leave them exactly as they were. */
let membersCache = { at: 0, byId: null };
async function guildMembers() {
  /* Keyed on WHEN it was asked, not on what came back. Testing byId meant a
     failure was never remembered, because a failure stores null and null is
     falsy, so a guild with the intent switched off asked for the whole list
     once per person: ten people, ten refused list requests, on top of their
     ten single lookups. That is worse than not having this at all, and the
     comment below claimed the opposite until test-discord-members.js was run
     against it. */
  if (membersCache.at && Date.now() - membersCache.at < 60000) return membersCache.byId;
  if (!cfg.discord.botToken || !cfg.discord.guildId) return null;
  const r = await discordGet('/guilds/' + cfg.discord.guildId + '/members?limit=1000');
  if (!r.ok || !Array.isArray(r.body)) {
    // Remembered as a failure for the same sixty seconds. Without this, a
    // guild with the intent switched off asks for the whole list once per
    // person and doubles the very thing this is here to stop.
    membersCache = { at: Date.now(), byId: null };
    return null;
  }
  const byId = {};
  r.body.forEach(function (m) { if (m && m.user && m.user.id) byId[String(m.user.id)] = m; });
  membersCache = { at: Date.now(), byId: byId };
  return byId;
}

/* One member, out of the cached list when it is there and by name when it is
   not. Answers in the same shape discordGet does, so callers do not change. */
async function memberOf(discordId) {
  const all = await guildMembers();
  if (all) {
    const hit = all[String(discordId)];
    if (hit) return { ok: true, status: 200, body: hit };
    /* Absent from a COMPLETE list means not in the server, which is a 404 and
       is the one answer callers treat as certain. A list of exactly 1000 is
       the page limit rather than the whole guild, so it proves nothing about
       who is missing and the single lookup has to be asked. */
    if (Object.keys(all).length < 1000) {
      return { ok: false, status: 404, body: null, why: 'not found' };
    }
  }
  return await discordGet('/guilds/' + cfg.discord.guildId + '/members/' + discordId);
}

/* What this person is allowed to do, decided by their roles in the Discord and
   nothing else. Leaving the server, or being given the Banned role, takes
   everything away at once, which is the whole reason for doing it this way. */
async function standing(discordId) {
  const out = { id: String(discordId), inGuild: false, banned: false,
                admin: false, play: false, dev: false, roles: [], name: '', avatar: '' };

  /*
    THE FILE FIRST, AND BEFORE EVERY OTHER BRANCH.

    A ban read off a role only works when the bot is in the guild, the guild
    lookup succeeds and somebody spelled the role right. The branch below for
    "no bot configured yet" hands play to everybody, which is correct for an
    ordinary member and wrong for somebody who has been thrown out.

    So the list is read here, where nothing can route around it, and it wins.
  */
  // A ban with an end (#412) stops counting once it has passed.
  const readB = bansNow();
  if (readB.broken) {
    out.banned = true; out.reason = BANS_BROKEN_WHY; out.until = 0; out.byFile = true; out.bansBroken = true;
    return out;
  }
  const bans = readB.table;
  if (bans && Object.prototype.hasOwnProperty.call(bans, String(discordId)) &&
      !(Number((bans[String(discordId)] || {}).until) > 0 &&
        Number((bans[String(discordId)] || {}).until) <= Date.now())) {
    out.banned = true;
    out.reason = String((bans[String(discordId)] || {}).why || '');
    out.until = Number((bans[String(discordId)] || {}).until) || 0;
    out.byFile = true;
    return out;
  }

  /* The hand written admin list is an override, not a hint. It is the way back
     in when the bot is not in the server yet, has been kicked, or Discord is
     having a bad morning, so it cannot be gated behind a guild lookup that
     needs all three of those to be fine. */
  if (cfg.admins.indexOf(String(discordId)) >= 0) {
    out.admin = true; out.play = true; out.inGuild = true; out.dev = true; out.devBuild = true;
    if (cfg.discord.botToken && cfg.discord.guildId) {
      const r = await memberOf(discordId);
      if (r.ok) {
        const me = r.body;
        out.name = (me.nick || (me.user && (me.user.global_name || me.user.username)) || '');
        if (me.user && me.user.avatar) out.avatar = String(me.user.avatar);
        const names = await roleNames();
        out.roles = (me.roles || []).map((id) => names[id]).filter(Boolean);
        out.staffRole = holdsStaffRole(out.roles);
        out.businessOwner = holdsNamedRole(out.roles, 'Business Owner');
        out.leads = leaderRoles(out.roles);
        out.devRole = holdsNamedRole(out.roles, 'Dev');
      } else if (r.status !== 404) {
        out.lookupFailed = r.why;
      }
    }
    return out;
  }

  if (!cfg.discord.botToken || !cfg.discord.guildId) {
    // No bot configured yet, so the manual admin list is all there is and
    // everybody else is treated as an ordinary member.
    out.inGuild = true;
    out.play = true;
    return out;
  }
  const r = await memberOf(discordId);
  if (!r.ok) {
    // A real 404 is the only one that means "not in the server". Everything
    // else is the site's problem and has to say so, or somebody who IS in the
    // server spends an evening being told they are not.
    if (r.status !== 404) out.lookupFailed = r.why;
    return out;
  }
  const m = r.body;
  out.inGuild = true;
  out.name = (m.nick || (m.user && (m.user.global_name || m.user.username)) || '');
  if (m.user && m.user.avatar) out.avatar = String(m.user.avatar);
  const names = await roleNames();
  out.roles = (m.roles || []).map((id) => names[id]).filter(Boolean);
  const has = (list) => (list || []).some((n) => out.roles.indexOf(n) >= 0);
  // The role as well as the file. Either one is a ban, because the role is
  // what a moderator reaches for in Discord and the file is what survives
  // somebody renaming it.
  out.banned = has(cfg.access.banned);
  if (out.banned) { out.admin = false; out.play = false; return out; }
  if (has(cfg.access.admin)) out.admin = true;
  out.play = out.admin || has(cfg.access.play);
  out.dev = out.admin || has(cfg.access.dev);
  out.devBuild = out.admin || has(cfg.access.devBuild);
  out.company = has(cfg.access.company);
  out.staffRole = holdsStaffRole(out.roles);
  out.businessOwner = holdsNamedRole(out.roles, 'Business Owner');
  out.leads = leaderRoles(out.roles);
  out.devRole = holdsNamedRole(out.roles, 'Dev');
  return out;
}

/*
  Whether these Discord roles include a staff role (#481): access.admin or
  access.dev, by name. For the staff seats over the most the world holds,
  which Patrick keeps for "the discord roles" (29 Sep), so it reads the roles
  alone. st.dev is not the same thing: the hand written admins list sets it
  for an account that holds no role at all.
*/
function holdsStaffRole(roles) {
  const mine = Array.isArray(roles) ? roles : [];
  const staff = [].concat(cfg.access.admin || [], cfg.access.dev || []);
  return staff.some((n) => mine.indexOf(n) >= 0);
}

function holdsNamedRole(roles, name) {
  const mine = Array.isArray(roles) ? roles : [];
  return mine.indexOf(name) >= 0;
}

/*
  THE FACTION LEADER ROLES HELD (#3317). Every faction's Leader role is its
  name and " Leader" (bot/Build-Discord.py FACTION_LEADERS), and a faction
  that comes in through the application as Other gets one the same way, so
  the site reads them by that shape rather than keeping a second list of the
  factions. Whoever holds one owns that faction's book in the game (Patrick,
  22 Oct, page card q-3317-faction-books, A).
*/
function leaderRoles(roles) {
  const mine = Array.isArray(roles) ? roles : [];
  return mine.filter((n) => typeof n === 'string' && /^[^\n]{1,96} Leader$/.test(n));
}

/*
  THE HOLD OFFICES, FROM THE ROLES (#2551). Patrick, 15 Oct: a Jarl's hold
  comes from their "Jarl of <Hold>" Discord role, and each hold has a Court,
  a Steward and Guards, which are Discord roles too ("<Hold> Court",
  "Steward of <Hold>", "Guard of <Hold>", made by bot\Build-Discord.py and
  never hoisted). The role is the one truth: the game keeps no list of who
  holds what, it reads this, through /api/allowed.

  The key is the hold as the game names it (its ledger holds); the town is
  how the role names it. Raven Rock is here although Build-Discord.py makes
  no roles for it, so roles made for it by hand are read the same way.

  OFFICE_ROLE says, for one office and one hold, the role's exact name. Only
  the four offices are read, by exact name: a role somebody calls "Jarl of
  Whiterun's dog" is nobody's office.
*/
const OFFICE_HOLDS = {
  whiterun: 'Whiterun', solitude: 'Solitude', riften: 'Riften', markarth: 'Markarth',
  windhelm: 'Windhelm', falkreath: 'Falkreath', morthal: 'Morthal', dawnstar: 'Dawnstar',
  winterhold: 'Winterhold', ravenrock: 'Raven Rock'
};
const OFFICE_KINDS = ['jarl', 'court', 'steward', 'guard'];
function OFFICE_ROLE(office, hold) {
  const town = Object.prototype.hasOwnProperty.call(OFFICE_HOLDS, hold) ? OFFICE_HOLDS[hold] : '';
  if (!town) return '';
  if (office === 'jarl') return 'Jarl of ' + town;
  if (office === 'court') return town + ' Court';
  if (office === 'steward') return 'Steward of ' + town;
  if (office === 'guard') return 'Guard of ' + town;
  return '';
}
/* { jarl: [holds], court: [...], steward: [...], guard: [...] } for these role names. */
function officesOf(roles) {
  const mine = Array.isArray(roles) ? roles : [];
  const out = { jarl: [], court: [], steward: [], guard: [] };
  for (const office of OFFICE_KINDS) {
    for (const hold of Object.keys(OFFICE_HOLDS)) {
      if (mine.indexOf(OFFICE_ROLE(office, hold)) >= 0) out[office].push(hold);
    }
  }
  return out;
}
/* Whether these offices hold anything at all. */
function holdsAnOffice(o) {
  return !!o && OFFICE_KINDS.some((k) => Array.isArray(o[k]) && o[k].length > 0);
}

/*
  Who holds each hold's Jarl role, over the whole Discord: { hold: Map(id ->
  name) }, or null when the member list cannot be read (guildMembers needs
  the Server Members intent, and says null without it). Over the whole
  Discord because a second holder who has never played still holds the role.
*/
async function jarlRoleHolders() {
  const all = await guildMembers();
  if (!all) return null;
  const names = await roleNames();
  const out = {};
  for (const id of Object.keys(all)) {
    const m = all[id] || {};
    const o = officesOf((m.roles || []).map((r) => names[r]).filter(Boolean));
    for (const h of o.jarl) {
      if (!out[h]) out[h] = new Map();
      out[h].set(String(id), m.nick || (m.user && (m.user.global_name || m.user.username)) || '');
    }
  }
  return out;
}

/*
  ONE JARL A HOLD, BY THE ROLE (#2551). Patrick, 15 Oct: "If two accounts hold
  the same hold's Jarl role, neither acts as Jarl until staff fix it, and
  staff are told which accounts clash."

  Counted over the whole Discord when its member list can be read, and over
  the accounts the door just asked about (answers, from standingsForDoor)
  when it cannot. Each clash is { hold, people: [{ id, name }], profiles }:
  profiles are every profile of those accounts that linked.json knows, so the
  game can tell each of them why. The hold comes off those profiles' offices
  in out (a copy: the offices in out are the cached standings' own), so
  neither acts as its Jarl, in the game or anywhere that reads this.

  Staff are told in the staff channel, through moderation.log, which the bot
  says (bot.py, moderation_text): once when a clash starts and once when it
  ends, not at every refresh. What was last said is kept in memory, so a
  restart of the site says the clashes that stand once more.
*/
let clashSaid = {};       // hold -> the accounts last said to staff, joined
let clashLast = [];       // the clashes last found, for an office change made when the list cannot be read
async function jarlClashes(out, answers, linked) {
  let holders = await jarlRoleHolders();
  if (!holders) {
    holders = {};
    for (const [id, st] of (answers || new Map())) {
      if (!st || st.lookupFailed || st.banned) continue;
      for (const h of officesOf(st.roles).jarl) {
        if (!holders[h]) holders[h] = new Map();
        holders[h].set(String(id), st.name || '');
      }
    }
  }
  const clashes = [];
  for (const hold of Object.keys(OFFICE_HOLDS)) {
    const by = holders[hold];
    if (!by || by.size < 2) continue;
    const ids = Array.from(by.keys()).sort();
    const profiles = [];
    for (const id of ids) {
      for (const n of (Array.isArray((linked[id] || {}).profiles) ? linked[id].profiles : [])) {
        const p = Number(n);
        if (p > 0 && profiles.indexOf(p) < 0) profiles.push(p);
      }
    }
    clashes.push({ hold, people: ids.map((id) => ({ id, name: by.get(id) })), profiles });
  }
  if (out && out.offices) {
    for (const c of clashes) {
      for (const p of c.profiles) {
        const o = out.offices[String(p)];
        if (!o || o.jarl.indexOf(c.hold) < 0) continue;
        const left = Object.assign({}, o, { jarl: o.jarl.filter((h) => h !== c.hold) });
        if (holdsAnOffice(left)) out.offices[String(p)] = left;
        else delete out.offices[String(p)];
      }
    }
  }
  clashLast = clashes;
  const now = {};
  for (const c of clashes) {
    now[c.hold] = c.people.map((x) => x.id).join(',');
    if (clashSaid[c.hold] !== now[c.hold]) {
      modLog({ did: 'jarlclash', hold: c.hold, role: OFFICE_ROLE('jarl', c.hold), people: c.people });
    }
  }
  for (const hold of Object.keys(clashSaid)) {
    if (!Object.prototype.hasOwnProperty.call(now, hold)) {
      modLog({ did: 'jarlclear', hold, role: OFFICE_ROLE('jarl', hold) });
    }
  }
  clashSaid = now;
  return clashes;
}

/*
  out.offices for /api/allowed: each profile of every account the route let
  in (out.people) gets its account's offices, read from the roles the door's
  answer holds for it, and the clashes come off (jarlClashes). Answers the
  clashes, for out.jarlClash.
*/
async function officesForDoor(out, answers, linked) {
  for (const p of (out.people || [])) {
    const st = answers.get(String(p.id)) || answers.get(p.id);
    if (!st || st.lookupFailed || st.banned) continue;
    const o = officesOf(st.roles);
    if (!holdsAnOffice(o)) continue;
    for (const n of p.profiles) out.offices[String(n)] = o;
  }
  return jarlClashes(out, answers, linked);
}

/* The Discord account a profile is linked to, or ''. */
function accountOfProfile(linked, pid) {
  const n = Number(pid) || 0;
  if (n <= 0) return '';
  for (const d of Object.keys(linked || {})) {
    const ps = Array.isArray((linked[d] || {}).profiles) ? linked[d].profiles : [];
    if (ps.some((x) => Number(x) === n)) return String(d);
  }
  return '';
}

/*
  A JARL GIVES OR TAKES AN OFFICE FROM THE GAME (#2551). Patrick, 15 Oct:
  "They still do it in game tho", and the game asks the site, and the bot
  sets the Discord role, so the role stays the one truth.

  The site asks Discord with the bot's own token (discord.botToken is the
  same token as the bot's, docs/guide/secrets.md, the secrets table), so the
  role is set by the bot's account, with the bot's Manage Roles, and Discord's
  audit log names the bot and the reason. Nothing in the game or here keeps a
  copy: the next /api/allowed reads the role back, and the game asks for that
  at once after a change.

  o: { by, byName, who, whoName, office, hold, give } from the game server,
  by and who profiles. Answers { ok, said }: said is the sentence for the
  Jarl, already in plain words. Every rule is checked here again, whatever
  the game checked: the asker holds that hold's Jarl role, alone, and the
  office is one of the three a Jarl gives.
*/
async function changeOffice(o, server) {
  const office = String((o && o.office) || '');
  const hold = String((o && o.hold) || '');
  const give = !!(o && o.give === true);
  const role = (office === 'court' || office === 'steward' || office === 'guard') ? OFFICE_ROLE(office, hold) : '';
  if (!role) return { ok: false, said: 'A Jarl gives the Court, a Steward and Guards of a hold, and nothing else.' };
  const town = OFFICE_HOLDS[hold];
  const byName = String((o && o.byName) || '').slice(0, 60) || 'somebody';
  const whoName = String((o && o.whoName) || '').slice(0, 60) || 'them';
  const linked = jsonFile(LINKED, {});
  const byAcct = accountOfProfile(linked, o && o.by);
  const whoAcct = accountOfProfile(linked, o && o.who);
  if (!byAcct) return { ok: false, said: 'Your character is not linked to a Discord account, so nobody can tell whether you are Jarl.' };
  if (!whoAcct) return { ok: false, said: whoName + ' is not linked to a Discord account, so the role has nobody to go to.' };
  // Asked fresh: a Jarl role taken a minute ago is taken now.
  standCache.delete(byAcct);
  const st = await standingCached(byAcct);
  if (st.lookupFailed) return { ok: false, said: 'Discord could not be asked just now. Try again in a minute.' };
  if (st.banned || officesOf(st.roles).jarl.indexOf(hold) < 0) {
    return { ok: false, said: 'Only the Jarl of ' + town + ' gives its offices.' };
  }
  const holders = await jarlRoleHolders();
  const twice = holders ? (holders[hold] ? holders[hold].size > 1 : false)
    : clashLast.some((c) => c.hold === hold);
  if (twice) {
    return { ok: false, said: 'Two Discord accounts hold the Jarl of ' + town + ' role, so neither acts as Jarl until staff fix it. Staff have been told.' };
  }
  const names = await roleNames();
  const roleId = Object.keys(names).filter((id) => names[id] === role)[0] || '';
  if (!roleId) return { ok: false, said: 'There is no ' + role + ' role in the Discord yet. Staff make it with the Discord builder.' };
  const m = await memberOf(whoAcct);
  if (!m.ok) {
    return { ok: false, said: m.status === 404 ? whoName + ' is not in the Discord, so the role has nobody to go to.'
      : 'Discord could not be asked just now. Try again in a minute.' };
  }
  const has = (m.body.roles || []).map(String).indexOf(String(roleId)) >= 0;
  if (give && has) return { ok: false, said: whoName + ' already holds ' + role + '.' };
  if (!give && !has) return { ok: false, said: whoName + ' does not hold ' + role + '.' };
  const reason = (give ? 'Given' : 'Taken') + ' by ' + byName + ', Jarl of ' + town + ', in the game';
  const w = await discordWrite(give ? 'PUT' : 'DELETE',
    '/guilds/' + cfg.discord.guildId + '/members/' + whoAcct + '/roles/' + roleId, reason);
  if (!w.ok) {
    return { ok: false, said: w.status === 403
      ? 'The bot may not change ' + role + ': its own role has to sit above it in the Discord. Staff fix that.'
      : 'Discord did not take the change (' + w.why + '). Try again in a minute.' };
  }
  // The next read of either account, and of the member list, is Discord's new answer.
  standCache.delete(whoAcct);
  standGood.delete(whoAcct);
  membersCache = { at: 0, byId: null };
  modLog({ did: 'office', from: server || 'main', give, office, hold, role,
           by: Number(o.by) || 0, byName, byAccount: byAcct, who: Number(o.who) || 0, whoName, whoAccount: whoAcct });
  return { ok: true, said: give ? whoName + ' holds ' + role + ' now. The role is set in Discord.'
                                : whoName + ' no longer holds ' + role + '. The role is taken in Discord.' };
}

/*
  Has this account left the Thornswood Discord, so that nothing it holds in
  linked.json is anybody's any more?

  Added reviewing To Do List entry 142 on 24 September. /api/play/join stopped
  writing a profile id against a second account once a first one holds it,
  because that is how somebody took an id they learned off the voice service.
  It also stopped a person who moved to a new Discord account from ever having
  the characters their install made under the old one filed under the new, and
  a reviewer measured what that cost: voice refused the new account on all of
  them, and once the old account left the Discord /api/allowed dropped them and
  the game's door turned that person away from every character made before the
  switch, with a hand edit of linked.json on the VPS the only way back. On main
  before this, the new account simply took them at its first Play.

  An account that has left cannot play anything, so there is nobody left to
  keep those ids for, and /api/play/join moves them to whoever checks in with
  one next. Left means all of these, and anything short of them is the safe
  side, still holding:
    - Discord says the account is not in the server: a 404, which is the only
      failure standing() takes as certain. A lookup that failed is not left.
    - It is not banned in bans.json, which standing() reads before anything.
    - It is not on Discord's own ban list. A ban from inside Discord takes
      somebody out of the server as well, so it reads as a 404 here, and must
      not hand their characters to the second account they come back on. The
      ban list needs the bot to be allowed to ban members; when it cannot be
      read the account counts as still holding its ids.
  An account still in the Discord keeps its ids with or without the play role,
  because taking a role away is not leaving.
*/
async function hasLeft(discordId) {
  let st;
  try { st = await standingCached(String(discordId)); } catch (e) { return false; }
  if (!st || st.inGuild || st.banned || st.lookupFailed) return false;
  if (!cfg.discord.botToken || !cfg.discord.guildId) return false;
  const ban = await discordGet('/guilds/' + cfg.discord.guildId + '/bans/' +
                               encodeURIComponent(String(discordId)));
  return !!ban && !ban.ok && ban.status === 404;
}

/*
  The accounts other than the caller's that hold this profile id and have
  left the Discord (hasLeft above), as a set of Discord ids. Empty when the
  caller holds it already, so checking in with your own id never asks Discord
  about anybody else.

  Handed the table rather than reading it, and the join route reads the file
  again after this for the copy it writes back, because asking Discord waits
  and a wait between reading linked.json and writing it would write over
  whatever another launcher checked in meanwhile.
*/
async function departed(linked, pid, caller, by) {
  const out = new Set();
  const table = linked || {};
  const n = Number(pid) || 0;
  if (n <= 0) return out;
  const own = (table[caller] && Array.isArray(table[caller].profiles))
    ? table[caller].profiles.map(Number) : [];
  if (own.indexOf(n) >= 0) return out;
  for (const d of Object.keys(table)) {
    if (String(d) === String(caller)) continue;
    const theirs = (table[d] && Array.isArray(table[d].profiles))
      ? table[d].profiles.map(Number) : [];
    if (theirs.indexOf(n) < 0) continue;
    // Past the deadline (by, when the door has one) an account counts as
    // still holding, the safe side (#1094).
    const left = by ? await within(hasLeft(d), by - Date.now(), () => false) : await hasLeft(d);
    if (left) out.add(String(d));
  }
  return out;
}
