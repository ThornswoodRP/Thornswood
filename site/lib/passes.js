/*
  Launcher tickets and join passes, launcher versions, and the plain pages
  for a sign in that went wrong.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { feedLaunchers, getWithToken, makePass, makeTicket,
  notAllowedPage, notFoundPage, passLoginKey, plainPage, readTicket,
  versionCompare, versionParts, wantsHtml };

const https  = require('https');
const fs     = require('fs');
const crypto = require('crypto');
const { cfg, notAcceptedYet } = require('./config');
const { feedFile } = require('./feed');
const { sameSecret, sign } = require('./auth');
const { boundDiscord, readDiscordBody } = require('./discord');

/* The ticket the launcher keeps. Signed rather than stored, so a restart does
   not sign everybody out, and short enough lived that leaving the Discord
   stops mattering within the month even if nothing checks. Every use is
   re-checked against Discord anyway; the expiry is only for when it cannot be. */
function makeTicket(id, name) {
  const body = Buffer.from(JSON.stringify({
    d: String(id), n: String(name || ''), x: Date.now() + 30 * 86400000
  })).toString('base64url');
  return 'tk1.' + body + '.' + sign('ticket:' + body);
}

function readTicket(t) {
  const parts = String(t || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'tk1') return null;
  if (!sameSecret(parts[2], sign('ticket:' + parts[1]))) return null;
  let o;
  try { o = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); }
  catch (e) { return null; }
  if (!o || !o.d || !o.x || o.x < Date.now()) return null;
  return o;
}

/*
  THE JOIN PASS (#937). Patrick, 28 Sep: "People should not be allowed in at all
  if they don't join from our launcher." The game server only ever sees a
  profile number the client picked, so it cannot tell our launcher from Skyrim
  started by hand, from another launcher, or from one of ours that is out of
  date. The launcher asks /api/play/pass for this with the Discord ticket it
  already holds, the game's front plugin hands it to the game server, and the
  game server checks it with its own copy of the key (gamemode.js, the join pass
  block) and ends a session that has none.

      jp1.<body>.<mac>

  body is base64url JSON: p the profile number, s the server ("main" or "dev"),
  v the launcher version, d the Discord id, i when it was issued and x when it
  runs out, both unix milliseconds. mac is base64url HMAC-SHA256 over "jp1." and
  the body, keyed on cfg.passKey. site\tests\test-join-pass-site.js and
  tests\test-join-pass-game.js hold one pass in common, so the two ends cannot
  drift apart. Ten minutes, though the game server lets a pass prove one
  session only, and start one only in the minute and a half after i (#1320),
  so the launcher renews it every minute while the game runs.
*/
const PASS_MS = 10 * 60000;

function b64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePass(key, o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s, v: o.v, d: o.d, i: o.i, x: o.x }));
  const mac = b64u(crypto.createHmac('sha256', key).update('jp1.' + body).digest());
  return 'jp1.' + body + '.' + mac;
}

/*
  THE PASS'S OWN KEY (#1320). The login rides the game's own port, which is not
  encrypted, so a pass alone in it could be seen and shown again on another
  connection. With the fork's login challenge (skymp5-server's
  thornswoodLogin.ts) the game sends each login a fresh nonce, and the client
  answers with the pass and HMAC-SHA256 of "jlp1." + nonce under this key. The
  key goes to the launcher here, over https, beside the pass, and never on the
  game's port; the game server derives the same one from passKey and the pass
  (the join pass block in gamemode.js). base64url HMAC-SHA256 of "jpk1." and
  the pass's own mac, keyed on cfg.passKey.
*/
function passLoginKey(key, pass) {
  const mac = String(pass || '').split('.')[2] || '';
  return b64u(crypto.createHmac('sha256', key).update('jpk1.' + mac).digest());
}

/* Digits and dots, an optional leading v, nine digits a part at most: the
   same rule FeedNotice.IsVersion keeps in the launcher. Null for anything else. */
function versionParts(v) {
  const t = String(v == null ? '' : v).trim().replace(/^v/i, '');
  if (!/^\d{1,9}(\.\d{1,9})*$/.test(t)) return null;
  return t.split('.').map(Number);
}

function versionCompare(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/* Which launchers a channel lets into the game: from minLauncher (Publish-Update
   writes it as the launcher it published) up to launcherVersion, both read from
   this site's own copy of the feed. With no minLauncher the floor is the current
   launcher. Null when the feed cannot be read, which refuses the pass. Read again
   only when the file changes. */
const feedLaunchersSeen = {};
function feedLaunchers(server) {
  const dir = server === 'dev' ? 'feed-dev' : 'feed';
  const file = feedFile(dir);
  if (!file) return null;
  let st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  const hit = feedLaunchersSeen[dir];
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.v;
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { doc = null; }
  let v = null;
  if (doc && versionParts(doc.launcherVersion)) {
    const current = String(doc.launcherVersion).trim().replace(/^v/i, '');
    const min = versionParts(doc.minLauncher) ? String(doc.minLauncher).trim().replace(/^v/i, '') : current;
    v = { current: current, min: min };
  }
  feedLaunchersSeen[dir] = { mtime: st.mtimeMs, size: st.size, v: v };
  return v;
}

function getWithToken(url, token) {
  const u = new URL(url);
  return boundDiscord((h) => https.get({
    hostname: u.hostname, path: u.pathname,
    headers: { Authorization: 'Bearer ' + token }
  }, (res) => readDiscordBody(res, h)));
}

/* Refused at the door. It says which of the three reasons it was and what the
   person's own Discord id is, because "you are not allowed" with no reason is
   a support ticket and this is the answer to it. */
/*
  A PAGE RATHER THAN FOUR CHARACTERS.

  A wrong address answered "not here" as plain text, which for the second
  somebody reads it makes the whole site look unfinished or broken. The same
  shape as the Not allowed in page below: the site's colours, a sentence, and a
  way back, because a dead end with no way out of it is the actual fault.

  BROWSERS ONLY. An API caller asking for JSON must not be handed HTML: it
  cannot read it and the error it then reports is a parse failure rather than a
  404, which is how a wrong address becomes an hour of somebody's evening. The
  Accept header decides, and anything that does not say text/html keeps the
  plain text it has always had.
*/
function wantsHtml(req) {
  return String((req && req.headers && req.headers.accept) || '').indexOf('text/html') >= 0;
}

function plainPage(title, lines) {
  const esc = (t) => String(t == null ? '' : t).replace(/[<>&]/g, '');
  return '<!doctype html><html lang="en"><head><meta charset=utf-8><title>' + esc(title) + ' | Thornswood</title>' +
    '<meta name="description" content="Find your way back to Thornswood, the Skyrim roleplay community.">' +
    '<meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link rel="stylesheet" href="/door.css">' +
    '</head><body class="door">' +
    '<main class="door-box">' +
    '<h1>' + esc(title) + '</h1>' +
    lines.map((t) => '<p>' + esc(t) + '</p>').join('') +
    '<p><a href="/">Back to Thornswood</a> · <a href="/help">Get help</a></p>' +
    '</main></body></html>';
}

function notFoundPage() {
  return plainPage('Not here', [
    'That address does not exist on this site.',
    'If a link brought you here, say so in the Discord and it will be fixed.'
  ]);
}

function notAllowedPage(me, st) {
  const nm = String(me.username || '').replace(/[<>&]/g, '');
  const id = String(me.id).replace(/[^0-9]/g, '');
  const esc = (t) => String(t == null ? '' : t).replace(/[<>&]/g, '');
  let why;
  if (st.lookupFailed) {
    // Not the person's fault and not a role problem. Saying "you are not in
    // the Discord" here is how somebody who IS in it loses an evening.
    why = '<p>Thornswood could not ask Discord about that account, so it cannot ' +
          'let anybody in right now. This is the site, not you.</p>' +
          '<p class="door-note">' + esc(st.lookupFailed) + '</p>' +
          '<p>Tell Patrick and try again in a minute.</p>';
  } else if (st.banned) {
    why = '<p>That account is banned from Thornswood.</p>';
  } else if (!st.inGuild) {
    why = '<p>That account is not in the Thornswood Discord.</p>' +
      (cfg.discord.invite
        ? '<p><a href="' + cfg.discord.invite + '">Join it here</a>, then try again.</p>'
        : '');
  } else {
    why = '<p>That account is in the Discord, but ' + esc(notAcceptedYet(true)) + '</p>' +
          '<p class="door-note">Roles Thornswood can see on it: ' +
          (st.roles && st.roles.length ? '<b>' + st.roles.map(esc).join(', ') + '</b>' : 'none') +
          '.<br>It needs one of: <b>' + (cfg.access.play || []).map(esc).join(', ') + '</b>.</p>';
  }
  return '<!doctype html><meta charset=utf-8><title>Not allowed in</title>' +
    '<link rel="stylesheet" href="/door.css">' +
    '<body class="door">' +
    '<div class="door-box"><h1>Not allowed in</h1>' +
    why +
    '<p class="door-note">Signed in to Discord as <b>' + nm +
    '</b>, id <code>' + id + '</code>. Quote that id if you ask about it.</p>' +
    '<p><a href="/">Back to the site</a></p></div></body>';
}

Object.assign(module.exports, { PASS_MS });
