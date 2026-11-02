/*
  Asking Discord: each call with its time limit and quiet spells, the role
  names, and the linked accounts.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { boundDiscord, discordGet, discordQuietMs, discordWrite,
  post, readDiscordBody, roleNames };

const https  = require('https');
const path   = require('path');
const { DATA } = require('./base');
const { cfg } = require('./config');

// --------------------------------------------------------------- discord --
/* THE SIGN-IN CALLBACK'S TWO QUESTIONS (#1163). post exchanges the
   code and getWithToken reads who the person is. Both used to listen only
   for data, end and the request's error. Discord sending its headers and
   then stalling, never answering, or dropping halfway left the promise
   unsettled, so the browser sat on a blank page and the launcher waited
   out its two minutes. The same ten seconds as discordGet, and a response
   that fails, is cut off or closes before its end settles the question
   once. The callback turns that into words. */
function discordSilent() {
  const e = new Error('Discord did not answer');
  e.discordSilent = true;
  return e;
}
function readDiscordBody(res, h) {
  let out = '';
  res.on('data', (d) => out += d);
  res.on('error', h.giveUp);
  res.on('aborted', h.giveUp);
  // complete is false until a whole answer has arrived. A stub that is not
  // a real response leaves it unset, and that one is finished on end.
  res.on('close', () => { if (res.complete === false) h.giveUp(); });
  res.on('end', () => {
    if (res.complete === false) return h.giveUp();
    try { h.done(JSON.parse(out)); }
    catch (e) { h.fail(e); }
  });
}
function boundDiscord(open) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let req = null;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(v);
    };
    const giveUp = () => finish(reject, discordSilent());
    timer = setTimeout(() => {
      giveUp();
      // destroy() does not throw, so no try (#2736).
      if (req) req.destroy();
    }, DISCORD_ASK_MS);
    req = open({
      giveUp: giveUp,
      done: (v) => finish(resolve, v),
      fail: (e) => finish(reject, e)
    });
    if (req && req.on) req.on('error', (e) => finish(reject, e));
  });
}
function post(url, form) {
  const u = new URL(url);
  const data = new URLSearchParams(form).toString();
  return boundDiscord((h) => {
    const r = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                 'Content-Length': Buffer.byteLength(data) }
    }, (res) => readDiscordBody(res, h));
    r.end(data);
    return r;
  });
}

/* Asking Discord who somebody is in the server. Needs the bot, because a
   person's OAuth login only proves who they are, not that they are in the
   Thornswood Discord or what roles they carry there. */
/* Returns { ok, status, body }. It used to return null for everything that was
   not a 200, which meant a dead bot token, a rate limit and a person who really
   is not in the server all came back identical, and the site told all three of
   them they were not in the Discord. The one person that never affected was
   whoever is on the hand written admin list, because that is checked first, so
   it looked fine from the only account that could have noticed. */
/* QUIET UNTIL. discordGet recognised a 429 and then asked again straight
   away, for the next person on the list, so one rate limit became a run of
   them. Discord says how long to wait: Retry-After or x-ratelimit-reset-after
   on the 429, and x-ratelimit-remaining 0 with x-ratelimit-reset-after on the
   last answer before one. That time is kept here, once for the whole site,
   and until it passes discordGet answers "rate limited" without asking. It
   is not a sleep: a sleep here would be paid once per linked account and
   blow the door's ten seconds (issue #415). Capped at a minute, so a strange
   header cannot shut the site out of Discord for longer than that. */
let discordQuietUntil = 0;
function discordQuietMs() { return Math.max(0, discordQuietUntil - Date.now()); }
function discordWaitMs(headers, text) {
  const h = headers || {};
  let s = parseFloat(h['retry-after']);
  if (!(s >= 0) && h['retry-after']) {
    // Retry-After may also be a date (RFC 9110); Discord sends seconds.
    const at = Date.parse(h['retry-after']);
    if (at) s = (at - Date.now()) / 1000;
  }
  if (!(s >= 0)) s = parseFloat(h['x-ratelimit-reset-after']);
  // Only a body that is a JSON object is read for it (#2736). Cloudflare in
  // front of Discord answers some 429s with a page, which has no wait in it
  // and falls through to -1; a body that looks like JSON and is not is said.
  if (!(s >= 0) && /^\s*\{/.test(String(text || ''))) {
    try { s = parseFloat(JSON.parse(text).retry_after); }
    catch (e) { console.error('[thornswood] discord rate limit answer is not readable JSON (' + e.name + '), so it names no wait'); }
  }
  if (!(s >= 0)) return -1;
  return Math.min(60000, Math.ceil(s * 1000));
}
/* TEN SECONDS FOR THE WHOLE ANSWER (#1094). The limit was req.setTimeout,
   which only watches for a quiet socket and then destroys the request. When
   Discord sent its headers and stalled, the response never ended, nothing
   listened for it failing, and the promise never settled, so the visitor or
   launcher waiting on it never heard back. Now one timer runs from the
   question to the last byte, and a response that fails, is cut off or closes
   before its end settles the question too, once. */
const DISCORD_ASK_MS = 10000;
function discordGet(path) {
  return new Promise((resolve) => {
    if (!cfg.discord.botToken) {
      return resolve({ ok: false, status: 0, body: null, why: 'no bot token set' });
    }
    if (discordQuietMs() > 0) {
      return resolve({ ok: false, status: 429, body: null, why: 'rate limited by Discord' });
    }
    let settled = false;
    let timer = null;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!v.ok && v.status === 0 && v.why) console.error('[thornswood] discord ' + path + ': ' + v.why);
      resolve(v);
    };
    const req = https.get({
      hostname: 'discord.com', path: '/api/v10' + path,
      headers: { Authorization: 'Bot ' + cfg.discord.botToken }
    }, (res) => {
      let out = '';
      const cut = () => settle({ ok: false, status: 0, body: null, why: 'Discord stopped partway through its answer' });
      res.on('data', (d) => out += d);
      res.on('error', cut);
      res.on('aborted', cut);
      res.on('close', () => { if (!res.complete) cut(); });
      res.on('end', () => {
        const hdr = res.headers || {};
        if (res.statusCode === 429 || String(hdr['x-ratelimit-remaining']) === '0') {
          const wait = discordWaitMs(res.statusCode === 429 ? hdr : { 'x-ratelimit-reset-after': hdr['x-ratelimit-reset-after'] }, out);
          // A 429 with no readable wait still backs off for a second.
          const ms = wait >= 0 ? wait : (res.statusCode === 429 ? 1000 : 0);
          discordQuietUntil = Math.max(discordQuietUntil, Date.now() + ms);
        }
        if (res.statusCode === 200) {
          try { return settle({ ok: true, status: 200, body: JSON.parse(out) }); }
          catch (e) { return settle({ ok: false, status: 200, body: null, why: 'unreadable answer' }); }
        }
        if (res.statusCode === 404) {
          return settle({ ok: false, status: 404, body: null, why: 'not found' });
        }
        let msg = 'Discord answered ' + res.statusCode;
        if (res.statusCode === 401) msg = 'the bot token is wrong or has been reset';
        else if (res.statusCode === 403) msg = 'the bot is in the server but not allowed to read members';
        else if (res.statusCode === 429) msg = 'rate limited by Discord';
        console.error('[thornswood] discord ' + path + ': ' + msg);
        settle({ ok: false, status: res.statusCode, body: null, why: msg });
      });
    });
    timer = setTimeout(() => {
      settle({ ok: false, status: 0, body: null, why: 'Discord did not answer inside ten seconds' });
      req.destroy();
    }, DISCORD_ASK_MS);
    req.on('error', (e) => settle({ ok: false, status: 0, body: null, why: 'could not reach Discord: ' + e.message }));
  });
}

/*
  The one write the site makes to Discord (#2551): give or take a member's
  role, for a Jarl's office change made in the game (changeOffice). PUT or
  DELETE on the member's role, with the reason Discord's audit log shows.
  Discord answers 204 when it is done. A 429 sets the same quiet time
  discordGet keeps, so no request is sent into a rate limit; nothing here
  retries, and the Jarl is told to try again.
*/
function discordWrite(method, path, reason) {
  return new Promise((resolve) => {
    if (!cfg.discord.botToken || !cfg.discord.guildId) {
      return resolve({ ok: false, status: 0, why: 'no bot token set' });
    }
    if (discordQuietMs() > 0) {
      return resolve({ ok: false, status: 429, why: 'rate limited by Discord' });
    }
    let settled = false;
    let timer = null;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!v.ok) console.error('[thornswood] discord ' + method + ' ' + path + ': ' + v.why);
      resolve(v);
    };
    const req = https.request({
      hostname: 'discord.com', path: '/api/v10' + path, method: method,
      headers: { Authorization: 'Bot ' + cfg.discord.botToken, 'Content-Length': 0,
                 'X-Audit-Log-Reason': encodeURIComponent(String(reason || '').slice(0, 400)) }
    }, (res) => {
      let out = '';
      res.on('data', (d) => out += d);
      res.on('error', () => settle({ ok: false, status: 0, why: 'Discord stopped partway through its answer' }));
      res.on('end', () => {
        const hdr = res.headers || {};
        if (res.statusCode === 429) {
          const wait = discordWaitMs(hdr, out);
          discordQuietUntil = Math.max(discordQuietUntil, Date.now() + (wait >= 0 ? wait : 1000));
        }
        if (res.statusCode === 204 || res.statusCode === 200) return settle({ ok: true, status: res.statusCode });
        let why = 'Discord answered ' + res.statusCode;
        if (res.statusCode === 401) why = 'the bot token is wrong or has been reset';
        else if (res.statusCode === 403) why = 'the bot may not change that role';
        else if (res.statusCode === 404) why = 'Discord does not know that member or role';
        else if (res.statusCode === 429) why = 'rate limited by Discord';
        settle({ ok: false, status: res.statusCode, why });
      });
    });
    timer = setTimeout(() => {
      settle({ ok: false, status: 0, why: 'Discord did not answer inside ten seconds' });
      req.destroy();
    }, DISCORD_ASK_MS);
    req.on('error', (e) => settle({ ok: false, status: 0, why: 'could not reach Discord: ' + e.message }));
    req.end();
  });
}

/* Role ids mean nothing on their own, so they are turned back into names once
   every five minutes and matched by name. */
let roleCache = { at: 0, byId: {} };
async function roleNames() {
  if (Date.now() - roleCache.at < 300000 && Object.keys(roleCache.byId).length) {
    return roleCache.byId;
  }
  const got = await discordGet('/guilds/' + cfg.discord.guildId + '/roles');
  if (!got.ok || !Array.isArray(got.body)) return roleCache.byId;
  const byId = {};
  got.body.forEach((r) => { byId[r.id] = r.name; });
  roleCache = { at: Date.now(), byId };
  return byId;
}

const LINKED = path.join(DATA, 'linked.json');

Object.assign(module.exports, { LINKED });
