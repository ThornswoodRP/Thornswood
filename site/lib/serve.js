/*
  handle(): every route the site answers, and failed(), the last catch on
  a request.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { failed, handle };

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { FILES, PUBLIC, ROOT, UP } = require('./base');
const { andList, cfg, forMode, notAcceptedYet } = require('./config');
const { BLURB, BOARDS, DOCS, escAttr, fillCreditsCommits, fillLoreLine,
  fillPage, LEVEL, MD_PAGES, pageHtml, pageMarkdown, PUBLIC_EDGE_SECONDS,
  PUBLIC_PAGES, readLines, roadmapBoard } = require('./pages');
const { feedFile, feedSettings, feedView, nativePublished, nativeTag, newestSetup, releaseCopy } = require('./feed');
const { creditsFacts, findPageVersion, PAGES, pageSha256, PUBLIC_ORIGIN,
  publicAssetBody, publicAssetVersion, publicDiscovery, publicPageBody,
  singlePageHeading } = require('./public');
const { gameStatus, mostOnlineFallback, seatsFull, worldFull } = require('./game');
const { boardRev, INBOX, jsonFile, noteRules, putJson, readBoard, readDoc,
  readLists, RESULTS, RULES_OK, writeBoardOne, writeDoc } = require('./store');
const { NEWS } = require('./news');
const { galleryPage, loginBackoff, loginBackoffBump, loginKey, loginNote,
  loginWait, publicApiWait, publicJson, reportFrom, reportRefusal,
  reportTaken, requestAddr, trimInbox, turnstileOn, turnstilePasses } = require('./limits');
const { downloadServed, listFiles } = require('./downloads');
const { deleteUpload, GALLERY, GALLERY_ALLOW, GALLERY_CAP, GALLERY_HOLD_DAYS,
  GPENDING, GREPORTS, KIND, listUploads, pendingCopies, pictureSize,
  receiveUpload, shotSrcset, SMALL_CAP, SMALL_KINDS, SMALL_WIDTHS, smallCopy,
  smallFile, srcsetWidths, UP_SMALL, uploadRemoved, UPMETA,
  withGalleryPending } = require('./uploads');
const { accountBanned, accountOf, activeBans, banMinutes, banUntilText,
  characterBar, dropBan, findDead, heldBroken, modLog, PK, pkActive,
  pkProfiles, putBan, putNote, putPk, recordKey, staffRecords, undoPk } = require('./staff');
const { ADMIN, ADMIN_DAYS, allowed, COOKIE, cookies, discordReady,
  discordUnasked, gallerySender, galleryStaff, memberToken,
  personReportRefusal, PLAY_ANSWER_MS, PLAY_BODY_MS, sameSecret, sign,
  standCache, standingCached, standingLate, standingsForDoor, SUBMIT_DOORS,
  SUBMIT_WAIT_MS, who, within } = require('./auth');
const { ATTEMPT, ATTEMPT_MS, attemptCookie, attemptsSpent, body, BodyFailed,
  crossSite, cspFor, keyInAddress, origin, passBodyFailure,
  PERMISSIONS_POLICY, rangeReply, secureHere, send, sendJson, setCookie,
  TYPES } = require('./http');
const { LINKED, post } = require('./discord');
const { cleanEconomy, ECONOMY, ECONOMY_KEEP_DAYS, economyNow, ROSTER,
  ROSTER_HELD_FRESH_MS, slotsFor } = require('./roster');
const { ATTEMPTS, freshSignIns, noteSignIn } = require('./signins');
const { crashedRow, findSession, lookedAtFor, markLooked, openSessionOf,
  pruneSessionLogs, putSessionLogs, putSessions, retentionSay, sessionKey,
  sessionRows, SLOG_ALL, slogFile } = require('./sessions');
const { copyKeptChat, dropKeptChat, freshGalleryReports, isObjectLike,
  sessionWindow, stalePending } = require('./retention');
const { applyTrouble, noteTrouble, readTrouble, TROUBLE_RULES } = require('./trouble');
const { chatSlice, DEPLOYS_DIR, readDeploys, serverLogSlice, sessionRow } = require('./serverlogs');
const { changeOffice, departed, officesForDoor, standing } = require('./members');
const { feedLaunchers, getWithToken, makePass, makeTicket, notAllowedPage,
  notFoundPage, PASS_MS, passLoginKey, plainPage, readTicket, versionCompare,
  versionParts, wantsHtml } = require('./passes');

// ------------------------------------------------------------------ serve --
/*
  One malformed request used to take the whole site down, and the game's login
  with it.

  The handler is async, so anything it throws becomes a rejected promise rather
  than an exception, and an unhandled rejection ends the process. A request for
  /% is enough on its own: decodeURIComponent throws URIError on a percent sign
  that is not followed by two hex digits, and that is the third line of the
  handler, before any route has been looked at. Nobody has to be attacking
  anything. A scanner walking the address space does it without meaning to.

  Deploy-Docs.ps1 restarts the process three times an hour and then gives up,
  so a few seconds of a bored scanner took the site off the internet until
  somebody noticed, and with it /api/play/allowed, which is what the launcher
  asks before it will let anybody connect. The site being down meant nobody
  could start the game.

  So the handler is a named function now and nothing calls it without a catch.
  A bad URL is the request's fault and gets 400; anything else is ours and gets
  500, logged with a stack so it can be fixed rather than quietly swallowed.
*/
function failed(req, res, e) {
  // What was sent could not be read (body() above, #1095): too big or too
  // slow is answered in words, and a connection already gone gets nothing.
  // Closed after, so the rest of a body too big is not read for nothing.
  if (e instanceof BodyFailed) {
    console.error('[thornswood-docs] body ' + e.why + ' on ' +
                  JSON.stringify(String(req.url || '').split('?')[0].slice(0, 200)));
    // failed() must not throw: it is the last catch on the request, and a
    // throw from here is an unhandled rejection, which stops the site. An
    // answer that cannot be written is said instead of dropped (#2736).
    try {
      if (!e.status || res.headersSent || res.destroyed) { if (!res.writableEnded) res.destroy(); return; }
      send(res, e.status, JSON.stringify({ ok: false, why: e.why, error: e.words, message: e.words }),
           null, { Connection: 'close' });
    } catch (e2) {
      console.error('[thornswood-docs] could not answer the body ' + e.why + ' (' + (e2.code || e2.name) + ')');
    }
    return;
  }
  const bad = e instanceof URIError;
  // The path and never the query. A caller that puts a key or a ticket in the
  // address would have it copied into site.log, which Get-Logs brings down
  // off the VPS. Entry 248.
  console.error('[thornswood-docs] ' + (bad ? 'malformed request ' : 'handler threw on ') +
                JSON.stringify(String(req.url || '').split('?')[0].slice(0, 200)) + ': ' +
                (e && e.stack ? e.stack : e));
  try {
    // Half an answer is already on the wire and cannot be taken back. Cutting
    // the connection is the only honest end to it.
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(bad ? 400 : 500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(bad ? 'bad request' : 'server error');
  } catch (e2) {
    // The socket went away while we were answering. Nothing left to tell.
  }
}

/*
  The last net, under everything rather than around one handler.

  A throw inside a setTimeout, or a promise nobody waited for, never reaches
  the catch above. After an uncaught exception Node says the process is in an
  unknown state, so carrying on can hand out corrupt answers or half-written
  files (#1358). Log it, then exit, and let the process manager start a clean
  one. How the process is hosted and the three restarts an hour are entry 105.

  An unhandled rejection is different: the process is still defined, so it is
  logged and the site keeps answering.
*/
process.on('unhandledRejection', (e) => {
  console.error('[thornswood-docs] unhandled rejection, carrying on: ' +
                (e && e.stack ? e.stack : e));
});
process.on('uncaughtException', (e) => {
  console.error('[thornswood-docs] uncaught exception, exiting: ' +
                (e && e.stack ? e.stack : e));
  process.exit(1);
});

async function handle(req, res) {
  // Apply before parsing the address, so streamed and malformed responses
  // carry the same policy as ordinary pages. The nonce is this answer's own
  // (cspFor, #3216).
  res.cspNonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', cspFor(res));
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  /* The address is a path on this site, so it is read as one (#929).

     new URL(req.url, 'http://x') read an address that starts with two slashes
     as a scheme relative one, //host/path, so the first segment became a host
     name rather than part of the path. // and /// have no host at all and
     threw Invalid URL, which answered 500. //rules, //config.json and ///x
     came out as the path "/" and were all answered with the front page. A
     backslash counts as a slash there, so /\ did the same. Putting the origin
     in front of a path keeps every slash of it in the path. An address that
     is not a path (the absolute form a proxy sends, or *) is read as before,
     and one that still cannot be read is the request's fault: 400, like a
     bad percent sign, never 500. */
  const raw = String(req.url || '/');
  let url;
  try { url = new URL(raw.charAt(0) === '/' ? 'http://x' + raw : raw, 'http://x'); }
  catch (e) { return failed(req, res, new URIError('not an address: ' + e.message)); }
  const p = decodeURIComponent(url.pathname);
  const route = p.replace(/\/+$/, '').toLowerCase() || '/';
  // HEAD is GET without a body. Every route below asks for GET by name, so a
  // HEAD fell through to the 404 at the bottom, and an uptime monitor or a
  // link checker that uses HEAD reported every address on the site as gone.
  // Node drops the body of a HEAD answer on its own, so routing it as GET is
  // the whole fix for the small answers. The streamed ones skip the read as
  // well: a HEAD for the installer is a question about its size, not a
  // download.
  const head = req.method === 'HEAD';
  if (head) req.method = 'GET';

  /* Set once, here, rather than inside send(): the streamed answers below
     write their own headers and never go through it. Node keeps a setHeader
     value through a later writeHead, so one line covers every route.

     CSP and Referrer-Policy (#1366) ride the same path so a Range answer or a
     piped file is not the one reply without them. send() also sets them for
     the ordinary answers.

     Only on an answer that came in over the certificate. Caddy holds 443 and
     the plain to secure redirect already works, so this is the part that stops
     a browser trying the plain one again. On plain HTTP it means nothing and
     is left off. */
  // No try (#2736): setHeader throws only once the headers are sent, and
  // nothing has been sent at the top of the handler.
  if (secureHere(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  /* Two slashes together are one (#929). The site already reads /rules/ and
     /rules// as /rules, so //rules, /feed//version.json and // itself are
     sent to the same address with one slash, by the same 301 that sends
     /download to /downloads. Slashes only at the end are left to the routes
     below, exactly as before. The address sent is the one the URL parser
     already read, with its dot segments resolved and every backslash made a
     slash, and every run of slashes is one after this, so it always starts
     with exactly one slash and can never name another site. Where it lands is
     asked for again and goes through every check below, the /feed assets'
     64 hex name included. Only GET and HEAD: a POST to //api/login is not a
     door, and falls to the 404 at the bottom. */
  if (req.method === 'GET' && (/\/\/(?!\/*$)/.test(url.pathname) || /^\/\/+$/.test(url.pathname))) {
    return send(res, 301, '', 'text/plain', { Location: url.pathname.replace(/\/{2,}/g, '/') + url.search });
  }

  if (req.method === 'GET' && PUBLIC_PAGES.includes(route) &&
      /^www\.thornswood\.net(?::\d+)?$/i.test(req.headers.host || '')) {
    return send(res, 301, '', 'text/plain', {Location:PUBLIC_ORIGIN + route + url.search});
  }
  // These contain only public addresses. They never require a Discord lookup.
  if (req.method === 'GET' && route === '/sitemap.xml') {
    return send(res, 200, '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      PUBLIC_PAGES.map(page => '<url><loc>' + PUBLIC_ORIGIN + page + '</loc></url>').join('') + '</urlset>',
      'application/xml; charset=utf-8');
  }
  if (req.method === 'GET' && route === '/robots.txt') {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'robots.txt')), 'text/plain; charset=utf-8',
      {'Cache-Control':'public, max-age=3600'});
  }
  if (req.method === 'GET' && route === '/llms.txt') {
    const pages = ['/world','/rules','/join','/classes','/known','/help','/news','/roadmap','/privacy','/terms','/cookies','/credits'];
    return send(res, 200, '# Thornswood\n\n> A free Skyrim roleplay fan project and online community. Eighteen and over.\n\n' +
      'The site describes an evolving game. Consult Known issues for current limits and News for released changes.\n\n## Public pages\n\n' +
      pages.map(page => '- [' + BLURB[page][0] + '](' + PUBLIC_ORIGIN + page + '): ' + BLURB[page][1]).join('\n') + '\n',
      'text/plain; charset=utf-8');
  }

  if (req.method === 'GET' && (/^\/api\/(?:public|gallery|releases|roadmap)$/.test(route) || /^\/api\/page\/[a-z-]+$/.test(route))) {
    const retry = publicApiWait(req, Date.now());
    if (retry) return send(res, 429, JSON.stringify({error:'Too many requests. Try again shortly.'}),
      'application/json; charset=utf-8', {'Retry-After':String(retry)});
  }

  // Nothing is changed for a page on another site (#1367, crossSite above).
  // Asked before anything else is, Discord included, so a refused request
  // costs nothing and every route below it is covered.
  const foreign = crossSite(req);
  if (foreign) {
    const named = String(req.headers.origin || req.headers.referer || 'no page named');
    console.log('[thornswood-docs] refused a ' + req.method + ' to ' + route.slice(0, 80) +
                ' from another site (' + foreign + ': ' + named.replace(/[^\x20-\x7e]/g, '?').slice(0, 120) + ')');
    return sendJson(res, 403, { ok: false, why: 'cross-site', error: foreign === 'neither'
      ? 'Your browser did not say which page sent that, so it was not done. Do it from a page on this site, in a browser that says so.'
      : 'That was sent from a page on another site, so it was not done. Do it from a page on this site.' });
  }

  // A page load (GET, HEAD was made GET above) waits SUBMIT_WAIT_MS and may
  // use the last answer Discord gave (#1096). A Submit waits that same short
  // time (#467). Every other request that is signed in, including a staff
  // POST from the hub, waits no longer than Play (#1164).
  const pageLoad = req.method === 'GET';
  const submitDoor = req.method === 'POST' && SUBMIT_DOORS.has(route);
  const w = await who(req, (pageLoad || submitDoor) ? SUBMIT_WAIT_MS : PLAY_ANSWER_MS, pageLoad);

  // ---------------------------------------------------------- member login
  if (p === '/api/login' && req.method === 'POST') {
    const from = loginKey(req);
    const wait = loginWait(from, Date.now());
    if (wait) {
      // The window above is the cap (#1305). While the member password is
      // the door, each further guess waits longer than the last (#1308).
      // Discord sign-in keeps the flat window and does not grow this wait.
      const retry = discordReady() ? wait : loginBackoffBump(from, Date.now(), wait);
      return send(res, 429, JSON.stringify({
        error: 'Too many sign-in attempts from this connection. Try again in ' + retry + ' seconds.'
      }), 'application/json; charset=utf-8', { 'Retry-After': String(retry) });
    }
    loginNote(from, Date.now());
    if (discordReady()) {
      return sendJson(res, 403, { error: 'Discord sign in only. The password is off.' });
    }
    let given = '';
    try { given = (JSON.parse(await body(req, 4096)) || {}).password || ''; }
    catch (e) { passBodyFailure(e); }
    if (!cfg.password || !sameSecret(given, String(cfg.password))) {
      return sendJson(res, 401, { error: 'wrong password' });
    }
    loginBackoff.delete(from);
    return send(res, 200, JSON.stringify({ ok: true }),
      'application/json; charset=utf-8',
      { 'Set-Cookie': setCookie(req, COOKIE, memberToken(), 365) });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    return send(res, 200, JSON.stringify({ ok: true }),
      'application/json; charset=utf-8',
      { 'Set-Cookie': [
          COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
          ADMIN  + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
        ] });
  }

  // --------------------------------------------------------- discord login
  // An invite link that never goes stale in six places at once.
  if (route === '/discord' && req.method === 'GET') {
    if (!cfg.discord.invite) return send(res, 404, 'No invite link set yet.', 'text/plain');
    return send(res, 302, '', 'text/plain', { Location: cfg.discord.invite });
  }

  // ------------------------------------------------------- security.txt
  /* Where somebody who finds a hole in the site says so (RFC 9116, #3216,
     Patrick's answer on 22 Oct 2026). The first contact is the report page:
     open to anybody without an account, read by staff and nobody else, and
     the place staff already read every day, so a finding is never waiting in
     a mailbox nobody opens. The second is the Discord, for a direct message
     to the owner alone. These are the routes SECURITY.md gives too (#3683,
     Patrick's answer on 26 Oct, q-3683-report-route A), so a stranger gets
     one answer wherever they look. GitHub's Report a vulnerability button
     joins both, with a Policy line for SECURITY.md, once the repository is
     public: before that both addresses answer 404 to anybody outside it.

     Expires is written as the file is asked for, 180 days on, inside the
     year RFC 9116 asks for. The file says what this site answers, and the
     site answering is the proof somebody still keeps it: a date written by
     hand into a file would run out by itself one day while the contact
     still worked, and a check that a person has to remember to move is the
     kind that gets forgotten. */
  if (p === '/.well-known/security.txt' && req.method === 'GET') {
    const until = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    until.setUTCHours(0, 0, 0, 0);
    return send(res, 200, [
      'Contact: ' + PUBLIC_ORIGIN + '/report',
      'Contact: ' + PUBLIC_ORIGIN + '/discord',
      'Expires: ' + until.toISOString(),
      'Preferred-Languages: en',
      'Canonical: ' + PUBLIC_ORIGIN + '/.well-known/security.txt',
      ''
    ].join('\n'), 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
  }

  // ----------------------------------------------------------- domain proof
  // Discord's Connections > Domain check fetches /.well-known/discord and
  // wants its dh= line back as plain text. Anything dropped into
  // public\.well-known is served here by name; the static block below only
  // serves single-segment paths, so this needs its own route. No sign in,
  // Discord is not a member.
  const proof = p.match(/^\/\.well-known\/([A-Za-z0-9._-]+)$/);
  if (proof && req.method === 'GET') {
    const dir = path.join(PUBLIC, '.well-known');
    const file = path.join(dir, proof[1]);
    if (file.startsWith(dir + path.sep) && fs.existsSync(file)) {
      return send(res, 200, fs.readFileSync(file), 'text/plain; charset=utf-8',
        { 'Cache-Control': 'no-store' });
    }
    return send(res, 404, 'no such file', 'text/plain');
  }

  if (p === '/auth/discord' && req.method === 'GET') {
    if (!cfg.discord.clientId) {
      return send(res, 500, 'Discord login is not set up on this server yet.', 'text/plain');
    }
    // back is where the browser lands afterwards; port is the launcher waiting
    // on the loopback address for its ticket. Both are signed into the state so
    // neither can be swapped on the way through Discord.
    const back = url.searchParams.get('back') || '/';
    const askedPort = String(url.searchParams.get('port') || '').replace(/[^0-9]/g, '').slice(0, 5);
    // The launcher's own nonce. It rides through Discord inside the signed
    // state and comes back on the loopback redirect, which is how the launcher
    // knows the ticket it just caught belongs to the button its owner pressed
    // and not to a web page that guessed the port.
    const nonce = String(url.searchParams.get('nonce') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
    // This attempt's own value and the time it began, after the three above,
    // and the same value in a cookie for this browser. See ATTEMPT.
    const attempt = crypto.randomBytes(16).toString('hex');
    const raw = Buffer.from(back + '\u0000' + askedPort + '\u0000' + nonce + '\u0000' +
                            attempt + '\u0000' + Date.now()).toString('base64url');
    const state = raw + '.' + sign(raw);
    const go = 'https://discord.com/api/oauth2/authorize' +
      '?client_id=' + encodeURIComponent(cfg.discord.clientId) +
      '&redirect_uri=' + encodeURIComponent(origin(req) + '/auth/discord/callback') +
      '&response_type=code&scope=identify' +
      '&state=' + encodeURIComponent(state);
    return send(res, 302, '', 'text/plain', {
      Location: go, 'Set-Cookie': attemptCookie(req, attempt, attempt, ATTEMPT_MS / 1000) });
  }

  if (p === '/auth/discord/callback' && req.method === 'GET') {
    const code = url.searchParams.get('code') || '';
    const state = (url.searchParams.get('state') || '').split('.');
    let back = '/', port = '', nonce = '', attempt = '', began = 0;
    // No try (#2736): Buffer.from skips what is not base64url rather than
    // throwing, and the state is ours, checked against its signature first.
    if (state.length === 2 && sameSecret(state[1], sign(state[0]))) {
      const bits = Buffer.from(state[0], 'base64url').toString().split('\u0000');
      back = bits[0] || '/';
      port = (bits[1] || '').replace(/[^0-9]/g, '').slice(0, 5);
      nonce = (bits[2] || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
      attempt = (bits[3] || '').replace(/[^0-9a-f]/g, '').slice(0, 32);
      began = Number(bits[4]) || 0;
    }
    // Refused here, before Discord is asked anything: a state with no attempt
    // in it, one this browser did not start, one already used, or one older
    // than ten minutes. A signature alone used to be enough, and it is the
    // same for everybody who asked for the same page.
    const now = Date.now();
    for (const [k, t] of attemptsSpent) { if (now - t > ATTEMPT_MS) attemptsSpent.delete(k); }
    const age = now - began;
    if (attempt.length !== 32 || attemptsSpent.has(attempt) ||
        !(age > -60000 && age < ATTEMPT_MS) ||
        !sameSecret(cookies(req)[ATTEMPT + attempt.slice(0, 8)] || '', attempt)) {
      return send(res, 302, '', 'text/plain', { Location: '/?discord=expired' });
    }
    // Spent whatever happens next, and the cookie cleared on every answer
    // below. The one that sets cookies of its own carries this in its list.
    attemptsSpent.set(attempt, now);
    const spent = attemptCookie(req, attempt, '', 0);
    res.setHeader('Set-Cookie', spent);
    // Two slashes is another host to a browser (//2130706433), so back has to
    // start with exactly one.
    if (!/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(back)) back = '/';
    if (!code) return send(res, 302, '', 'text/plain', { Location: '/?discord=cancelled' });

    let me;
    try {
      const tok = await post('https://discord.com/api/oauth2/token', {
        client_id: cfg.discord.clientId,
        client_secret: cfg.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: origin(req) + '/auth/discord/callback'
      });
      if (!tok || !tok.access_token) throw new Error('no token');
      me = await getWithToken('https://discord.com/api/users/@me', tok.access_token);
    } catch (e) {
      // Discord never finished (#1163). Words on this answer, not a blank
      // wait and not a redirect the page has to interpret.
      if (e && e.discordSilent) {
        return send(res, 200, plainPage('Discord did not answer', [
          'Discord did not answer.',
          'Try again.'
        ]), TYPES['.html']);
      }
      return send(res, 302, '', 'text/plain', { Location: '/?discord=failed' });
    }
    if (!me || !me.id) {
      return send(res, 302, '', 'text/plain', { Location: '/?discord=failed' });
    }
    const st = await standing(me.id);
    standCache.delete(String(me.id));

    // Written before the decision, so a refusal is recorded as surely as a
    // success. The one somebody wants to look up later is always the refusal.
    noteSignIn(req, me, st, back);

    if (!st.inGuild || st.banned || !st.play) {
      return send(res, 200, notAllowedPage(me, st), TYPES['.html']);
    }
    const name = String(st.name || me.global_name || me.username || '').replace(/[|;]/g, '');
    // When it was made goes inside the signature, so identity() can refuse
    // it once it is older than ADMIN_DAYS whatever the browser kept.
    const at = String(Date.now());
    const value = encodeURIComponent(me.id + '|' + name + '|' + at + '|' +
                                     sign(me.id + '|' + name + '|' + at));

    // Remembered so there is a list of who has linked, when, and under what
    // name, which is what makes a ban traceable to a person later.
    const linked = jsonFile(LINKED, {});
    const was = linked[me.id] || {};
    linked[me.id] = Object.assign(was, {
      id: String(me.id), name: name,
      handle: String(me.username || ''),
      first: was.first || Date.now(), seen: Date.now(),
      roles: st.roles
    });
    putJson(LINKED, linked);

    /* Only twa (#2166). The member cookie tw is the password door's, and
       the privacy page calls it the fallback for a site with no Discord
       sign-in: isMember ignores it whenever Discord is configured, and this
       callback only runs then. It used to be set here as well, so every
       Discord sign-in left a year-long cookie that granted nothing and that
       the page said was not set. Now it is cleared instead, which also ends
       the ones earlier sign-ins left behind, the way sign-out clears it. */
    const cookies2 = [setCookie(req, ADMIN, value, ADMIN_DAYS),
                      COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax', spent];

    // The launcher asked, so hand the ticket back to it on the loopback
    // address rather than leaving it in the browser.
    if (port) {
      return send(res, 302, '', 'text/plain', {
        Location: 'http://127.0.0.1:' + port + '/thornswood?ticket=' +
                  encodeURIComponent(makeTicket(me.id, name)) +
                  '&name=' + encodeURIComponent(name) +
                  (me.avatar ? '&avatar=' + encodeURIComponent(String(me.avatar)) : '') +
                  (nonce ? '&nonce=' + encodeURIComponent(nonce) : ''),
        'Set-Cookie': cookies2
      });
    }
    return send(res, 302, '', 'text/plain', { Location: back, 'Set-Cookie': cookies2 });
  }

  /* Who has tried to sign in. Admins only, because it is a list of people. */
  if (p === '/api/signins' && req.method === 'GET') {
    // Aged here too, and written back when anything went, so a month with no
    // sign-ins still empties the file rather than only the answer.
    if (!w.admin) return sendJson(res, 403, { error: 'admins only' });
    const rows = jsonFile(ATTEMPTS, []);
    const live = freshSignIns(rows, Date.now());
    if (Array.isArray(rows) && live.length !== rows.length && !putJson(ATTEMPTS, live)) {
      retentionSay('signin', { event: 'write-failed', rows: rows.length, kept: live.length });
    }
    return sendJson(res, 200, { signins: live });
  }

  if (p === '/api/hello') {
    return sendJson(res, w.member ? 200 : 401, {
      ok: w.member, admin: w.admin, dev: !!w.dev, play: !!w.play,
      name: w.name,
      discord: discordReady(),
      invite: cfg.discord.invite || ''
    });
  }

  // ---------------------------------------------------------- public front
  if (req.method === 'GET' && PUBLIC_PAGES.indexOf(route) >= 0) {
    try {
      // The one switch (#428): only the alpha or the open wording goes out.
      let html = forMode(fs.readFileSync(path.join(PUBLIC, 'home.html'), 'utf8'), cfg.open);
      // One place holds the invite link, so it cannot go stale in nine.
      // /join, never /hub. Somebody clicking Apply wants to know how to apply,
      // and sending them to the admin panel is the worst possible answer.
      html = html.split('DISCORD_URL').join(cfg.discord.invite || '/join');
      // One lore line from lines.md under The World (#3147), a new pick each
      // time a page is served. Every page, not only /: the front is in each
      // one, for the page's script to show when it goes back to /. After the
      // invite link, for the same reason as the written pages below.
      html = fillLoreLine(html, readLines().lore, Math.random());
      // The og tags a crawler reads are the ones in the file, so the page
      // actually being served is written into them here. The browser tab reads
      // the same tags; home.js keeps no list of its own (#3138).
      const blurb = BLURB[route];
      let pageTitle = null;
      if (blurb) {
        pageTitle = blurb[0] === 'Thornswood' ? blurb[0] : blurb[0] + ' · Thornswood';
        html = html.replace(
          /(<meta property="og:title" id="ogTitle" content=")[^"]*(")/,
          '$1' + escAttr(pageTitle) + '$2');
        for (const re of [/(<meta property="og:description" id="ogDesc" content=")[^"]*(")/,
                          /(<meta name="description" content=")[^"]*(")/]) {
          html = html.replace(re, '$1' + escAttr(blurb[1]) + '$2');
        }
      }
      // A written page goes out with its words in it. After the invite link
      // above, so nothing anybody typed is mistaken for DISCORD_URL.
      if (MD_PAGES.indexOf(route) >= 0) {
        let md = pageMarkdown(route.slice(1));
        if (md !== null && route === '/credits') {
          const facts = creditsFacts();
          md = fillCreditsCommits(md, facts.deployed, facts.feeds);
        }
        if (md === null) return send(res, 404, notFoundPage(), TYPES['.html']);
        html = fillPage(html, singlePageHeading(pageHtml(md), blurb[0]));
      } else if (route !== '/') {
        // The remaining public pages draw themselves after an API fetch. Do not
        // paint the home landing while that request is in flight.
        html = fillPage(html, publicPageBody(route));
        // MD pages get <title> from fillPage (the page's h1). Non-MD routes
        // used to keep the home title until the page's script ran, so a crawler
        // or a slow tab saw only Thornswood. Set it from BLURB here.
        if (pageTitle) {
          html = html.replace('<title>Thornswood</title>',
            () => '<title>' + escAttr(pageTitle) + '</title>');
        }
      }
      html = publicDiscovery(html, route);
      /* no-cache, not send()'s no-store (#3218). A public page is the same for
         everybody: nothing in it says who is asking. no-store kept every one
         of them out of the browser's back and forward cache, so Back from
         the rules to the front page fetched and drew the whole page again.
         no-cache still asks the site each time the page is opened anew.
         Cloudflare, and only Cloudflare, keeps it for PUBLIC_EDGE_SECONDS
         (#5190): its cache rule for these pages takes this header and caches
         nothing that does not carry it, so a page that says who is asking
         can never be kept at the edge. A merge's new page is out everywhere
         within that time of the agent putting it in. */
      return send(res, 200, html, TYPES['.html'],
        { 'Cache-Control': 'no-cache', 'Cloudflare-CDN-Cache-Control': 'max-age=' + PUBLIC_EDGE_SECONDS });
    } catch (e) { return send(res, 500, 'no home.html', 'text/plain'); }
  }

  // Two addresses people type, or paste out of an old message. Both mean the
  // Downloads page, and both answered 404.
  if ((route === '/download' || route === '/install') && req.method === 'GET') {
    return send(res, 301, '', 'text/plain', { Location: '/downloads' });
  }

  // The template the front route fills in. Served as a file it still says
  // DISCORD_URL and shows both the alpha wording and the open wording (#997).
  if (route === '/home.html' && req.method === 'GET') {
    return send(res, 301, '', 'text/plain', { Location: '/' });
  }

  // Everything the front page needs and nothing that is anybody's business.
  if (route === '/api/public' && req.method === 'GET') {
    const feed = publicJson(NEWS, { news: [] });
    // Installed launchers read the original full array. The website opts into
    // pagination until those clients can follow a continuation themselves.
    const gallery = galleryPage(0, url.searchParams.get('galleryLimit') === '24' ? 24 : Number.MAX_SAFE_INTEGER);
    // no-cache for the same reason as the public pages: the same answer for
    // everybody, and a no-store answer to the page's own fetch kept the page
    // out of the back and forward cache as well (#3218).
    return send(res, 200, JSON.stringify({
      // The one switch (#428), for the pages and the Discord bot.
      open: cfg.open === true,
      invite: cfg.discord.invite || '',
      patreon: cfg.patreon || '',
      // max is always the number when one is known anywhere, so the page
      // says "N of 25" whether or not the server has said it (#481).
      status: { up: gameStatus.up, online: gameStatus.online, max: gameStatus.max || mostOnlineFallback(),
                line: gameStatus.line, full: seatsFull(gameStatus) },
      gallery: gallery.gallery,
      galleryTotal: gallery.total,
      galleryNext: gallery.next,
      launcher: feed.launcher || '',
      collection: feed.collection || '',
      // The revision that link opens, the one the server was built against (#4115).
      collectionRevision: Number(feed.collectionRevision) > 0 ? Number(feed.collectionRevision) : 0,
      files: listFiles(),
      news: (feed.news || []).slice(0, 6).map((n) => ({ date:n.date, title:n.title })),
      // The hints and lore lines (#3147): the Discord bot's status lines.
      lines: readLines()
    }), 'application/json; charset=utf-8', { 'Cache-Control': 'no-cache' });
  }

  /* Reporting a problem is public on purpose. Somebody whose install will not
     start cannot sign in to say so, and making them ask in Discord first is
     how a bug turns into nobody bothering. Held to one short message at a
     time, five an hour from one place, and the inbox is capped so it cannot
     be used to fill the disk. See thornswood report limits above. */
  // What the report page needs to draw the form: the Turnstile site key, or
  // nothing when the check is off (#3216). Public, like the key itself.
  if (route === '/api/report/form' && req.method === 'GET') {
    return sendJson(res, 200, { turnstile: turnstileOn() ? cfg.turnstileSiteKey : '' });
  }

  if (route === '/api/report' && req.method === 'POST') {
    const sender = reportFrom(req);
    const refuse = (no) => send(res, 429, JSON.stringify({ error: no.error }), null,
                                { 'Retry-After': String(no.wait) });
    // Asked before the body is read, so a sender already past the limit is
    // turned away without the site reading 20 KB from them first.
    const early = reportRefusal(sender, Date.now());
    if (early) return refuse(early);
    let o;
    try { o = JSON.parse(await body(req, 20000)); }
    catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
    // The form's hidden field. A person never sees it, so anything in it was
    // put there by a script filling in every box it found. Answered as if it
    // worked, so the script has nothing to learn from, and nothing is kept.
    if (o && String(o.homepage || '').trim()) return sendJson(res, 200, { ok: true });
    const title = String(o.title || '').trim().slice(0, 200);
    if (!title) return sendJson(res, 400, { error: 'say what happened in the first box' });
    // Turnstile's pass (#3216), asked before the limit is read again below,
    // because it waits on Cloudflare and nothing may wait between that read
    // and reportTaken. A refused pass is not counted against the sender.
    if (turnstileOn()) {
      const ts = await turnstilePasses(o.turnstile, requestAddr(req));
      if (ts === 'unasked') {
        return sendJson(res, 503, { error: 'Cloudflare did not answer the check that you are a person, so nothing was sent. Try again in a minute.' });
      }
      if (ts !== 'yes') {
        return sendJson(res, 403, { error: 'The check that you are a person did not pass. Wait for the tick under the form, then send it again.' });
      }
    }
    // And asked again now the body is in, because the answer above is stale.
    // A script that opens thirty connections, sends every set of headers and
    // then every body gets all thirty past the first check before any of
    // them is counted, and Caddy passes headers on before it has the body, so
    // that works through it. From here to reportTaken nothing awaits, so no
    // other request can run in between and each one sees the last one's count.
    const late = reportRefusal(sender, Date.now());
    if (late) return refuse(late);
    /* A REPORT ABOUT A PERSON IS NEVER ANONYMOUS (#414). A problem or an idea
       needs no account, because somebody whose install will not start cannot
       sign in. A report naming somebody does: it is kept against the Discord
       account that sent it, so staff can come back to the reporter and so a
       made up grudge cannot fill the queue from a hundred browsers. It is
       counted per account as well as per connection. */
    let person = null;
    if (o.kind === 'report') {
      const no = personReportRefusal(w);
      if (no) return sendJson(res, no.code, { error: no.error });
      const about = String(o.about || '').trim().slice(0, 60);
      if (!about) return sendJson(res, 400, { error: 'say who it is about in the Who box' });
      const acct = 'acct:' + w.id;
      const mine = reportRefusal(acct, Date.now(), 'your account');
      if (mine) return refuse(mine);
      person = { about, acct };
    }
    const list = jsonFile(INBOX, []);
    list.unshift(Object.assign({
      id: 'i' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      kind: person ? 'report' : (o.kind === 'idea' ? 'idea' : 'bug'),
      title,
      detail: String(o.detail || '').slice(0, 8000),
      by: person ? String(w.name || '').slice(0, 40) : String(o.by || '').slice(0, 40),
      at: Date.now(),
      state: 'new',
      from: person ? 'the public page, signed in' : 'the public page'
    }, person ? { about: person.about, discordId: String(w.id) } : {}));
    if (!putJson(INBOX, trimInbox(list))) {
      return sendJson(res, 500, { error: 'could not save' });
    }
    reportTaken(sender, Date.now());
    if (person) reportTaken(person.acct, Date.now());
    return sendJson(res, 200, { ok: true });
  }

  /*
    From inside the game: /helpme and /report (#414, gamemode.js, the asking
    staff block). Keyed with the door's key in a header, the same key and the
    same header /api/allowed takes, so nothing but a game server can write
    one. The dev server's door.json names the site with /dev on the end, so
    its reports come in on /dev/api/report/game and say so.

    Counted per profile on the same limits as the public page, as a backstop
    behind the game's own tighter ones. The profile id is what the game
    server was told by the client, a claim rather than a proof, and the row
    says so in words staff read.
  */
  if ((route === '/api/report/game' || route === '/dev/api/report/game') && req.method === 'POST') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    if (!sameSecret(String(req.headers['x-thornswood-key'] || ''), String(cfg.botKey))) {
      return sendJson(res, 401, { error: 'no' });
    }
    let o;
    try { o = JSON.parse(await body(req, 8000)) || {}; }
    catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
    const dev = route.indexOf('/dev/') === 0;
    const kind = o.kind === 'report' ? 'report' : (o.kind === 'help' ? 'help' : (o.kind === 'problem' ? 'problem' : ''));
    const pid = Number(o.profileId) || 0;
    if (!kind || !(pid > 0)) return sendJson(res, 400, { error: 'no kind or no profile' });
    const key = 'game:' + (dev ? 'dev:' : '') + pid;
    const no = reportRefusal(key, Date.now(), 'that profile');
    if (no) return send(res, 429, JSON.stringify({ error: no.error }), null, { 'Retry-After': String(no.wait) });
    const name = String(o.name || '').trim().slice(0, 60) || 'Somebody';
    const about = String(o.about || '').trim().slice(0, 60);
    if (kind === 'report' && !about) return sendJson(res, 400, { error: 'a report names somebody' });
    const said = String(o.said || '').trim().slice(0, kind === 'problem' ? 1000 : 300);
    if (kind === 'problem' && !said) return sendJson(res, 400, { error: 'a problem says what went wrong' });
    const cell = String(o.cell || '').slice(0, 120);
    const pos = (Array.isArray(o.pos) ? o.pos : []).slice(0, 3).map((n) => Math.round((Number(n) || 0) * 10) / 10);
    const aboutPid = Number(o.aboutProfileId) || 0;
    // Report a problem (#3155): the account holding the profile, and the
    // session its launcher has open, whose logs arrive when the game closes.
    // The bot files it on the board from here.
    let problem = null;
    if (kind === 'problem') {
      const acct = accountOf(pid);
      const open = acct ? openSessionOf(sessionRows(), acct, dev ? 'dev' : 'main') : null;
      problem = { discordId: acct, session: open ? String(open.session) : '', server: dev ? 'dev' : 'main' };
    }
    const list = jsonFile(INBOX, []);
    list.unshift(Object.assign({
      id: 'i' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      kind,
      title: kind === 'help' ? (said || 'Asked for help and said nothing more') : said,
      about: kind === 'report' ? about : '',
      aboutProfileId: kind === 'report' && aboutPid > 0 ? aboutPid : 0,
      detail: 'At ' + (cell || 'an unknown place') + (pos.length === 3 ? ', ' + pos.join(', ') : '') + '. ' +
        'Profile ' + pid + (kind === 'report' && aboutPid > 0 ? ', about profile ' + aboutPid : '') +
        ': the game takes these numbers from the client, so they are a claim, not proof.' +
        (kind === 'problem' ? ''
          : ' ' + (Number(o.staffTold) > 0 ? Number(o.staffTold) + ' of staff in the world were told in game.'
                                           : 'Nobody from staff was in the world.')),
      by: name,
      profileId: pid,
      cell,
      pos,
      at: Date.now(),
      state: 'new',
      from: dev ? 'in game on the dev server' : 'in game'
    }, problem || {}));
    if (!putJson(INBOX, trimInbox(list))) {
      return sendJson(res, 500, { error: 'could not save' });
    }
    reportTaken(key, Date.now());
    return sendJson(res, 200, { ok: true });
  }

  /*
    Bans and notes from staff in the game (#412): /ban, /unban and /note in
    the gamemode's staff block. Keyed with the door's key in the header, like
    /api/report/game above, and /dev on the front from the dev server.

    The game server has already checked that the one asking holds a staff
    role and proved who they are (join token and join pass). This checks the
    role again here, on the Discord account that holds their profile, so a
    game server cannot make somebody staff by saying so.

    One character or the whole account (#1010): ban and unban are the one
    character, kept under "p:<profile>"; banaccount and unbanaccount are the
    Discord account holding the profile, so every character on it is covered,
    and a new one too, and the door leaves them all out. A profile no account
    holds has no account to ban, and says so. minutes 0 is for good. pk kills
    the character for good (see PK): it is kept, never played again. Staff
    may do any of these to staff; the game refuses only doing it to yourself.
    unpk (/unpk) undoes a PK made by mistake, for the admin role only (see
    PK); the character is found by findDead, and o.why is required.
  */
  const staffGame = /^(\/dev)?\/api\/staff\/game\/(ban|unban|banaccount|unbanaccount|pk|unpk|note)$/.exec(route);
  if (staffGame && req.method === 'POST') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    if (!sameSecret(String(req.headers['x-thornswood-key'] || ''), String(cfg.botKey))) {
      return sendJson(res, 401, { error: 'no' });
    }
    let o;
    try { o = JSON.parse(await body(req, 8000)) || {}; }
    catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
    const from = staffGame[1] ? 'the dev server' : 'the live server';
    const byPid = Number(o.byProfileId) || 0;
    if (staffGame[2] === 'unpk' && byPid > 0) {
      const byIdU = accountOf(byPid);
      if (!byIdU) return sendJson(res, 403, { error: 'the staff profile is not linked to a Discord account' });
      const stU = await standingCached(byIdU);
      if (stU.lookupFailed && !stU.admin) return sendJson(res, 503, { error: 'could not ask Discord' });
      if (!stU.admin || stU.banned) {
        return sendJson(res, 403, { error: 'admins only', message: 'Only an admin can undo a PK.' });
      }
      const hit = findDead(o);
      if (!hit.pid) return sendJson(res, 404, { error: 'no such dead character', message: hit.message });
      const whyU = String(o.why || (hit.rest || []).join(' ')).trim().slice(0, 500);
      if (!whyU) {
        return sendJson(res, 400, { error: 'an undo says why',
          message: 'Say why: /unpk ' + (String((jsonFile(PK, {})[String(hit.pid)] || {}).name || '') || hit.pid) +
                   ' made by mistake.' });
      }
      const byNameU = String(o.byName || stU.name || '').slice(0, 60);
      const u = await undoPk(hit.pid, byNameU, byIdU, whyU, from);
      return sendJson(res, u.status, Object.assign({ profileId: hit.pid, why: whyU }, u.body));
    }
    const pid = Number(o.profileId) || 0;
    if (!(pid > 0) || !(byPid > 0)) return sendJson(res, 400, { error: 'no profile' });
    const byId = accountOf(byPid);
    if (!byId) return sendJson(res, 403, { error: 'the staff profile is not linked to a Discord account' });
    const st = await standingCached(byId);
    if (st.lookupFailed && !st.admin) return sendJson(res, 503, { error: 'could not ask Discord' });
    if (!st.dev || st.banned) return sendJson(res, 403, { error: 'that Discord account holds no staff role' });
    const byName = String(o.byName || st.name || '').slice(0, 60);
    const name = String(o.name || '').slice(0, 60);
    const key = recordKey(pid);
    const account = accountOf(pid);
    const now = Date.now();
    const what = staffGame[2];

    if (what === 'ban' || what === 'banaccount') {
      const why = String(o.why || '').trim().slice(0, 500);
      if (!why) return sendJson(res, 400, { error: 'a ban says why' });
      if (what === 'banaccount' && !account) {
        return sendJson(res, 404, { error: 'no Discord account holds that character, so ban the character' });
      }
      const minutes = banMinutes(o.minutes);
      const until = minutes ? now + minutes * 60000 : 0;
      const whole = what === 'banaccount';
      const banKey = whole ? account : 'p:' + pid;
      if (!putBan(banKey, { at: now, until, why, by: byName, byId, name, profiles: [pid], from,
                            scope: whole ? 'account' : 'character', account })) {
        return sendJson(res, 500, { error: 'could not save' });
      }
      // Every character the ban covers, so the game server can end each one
      // that is online now rather than at its next list.
      const covers = whole
        ? Array.from(new Set([pid].concat(((jsonFile(LINKED, {})[account] || {}).profiles || [])
                                            .map(Number).filter((n) => n > 0))))
        : [pid];
      return sendJson(res, 200, { ok: true, until, account: whole, profiles: covers });
    }
    if (what === 'unban' || what === 'unbanaccount') {
      if (what === 'unbanaccount' && !account) {
        return sendJson(res, 404, { error: 'no Discord account holds that character' });
      }
      const r = dropBan([what === 'unbanaccount' ? account : 'p:' + pid]);
      if (!r.ok) return sendJson(res, 500, { error: 'could not save' });
      const freed = what === 'unbanaccount'
        ? Array.from(new Set([pid].concat(((jsonFile(LINKED, {})[account] || {}).profiles || [])
                                            .map(Number).filter((n) => n > 0))))
        : [pid];
      return sendJson(res, 200, { ok: true, was: r.was, profiles: freed });
    }
    if (what === 'pk') {
      const why = String(o.why || '').trim().slice(0, 500);
      if (!why) return sendJson(res, 400, { error: 'a PK says why' });
      const had = jsonFile(PK, {})[String(pid)];
      if (pkActive(had)) return sendJson(res, 200, { ok: true, was: true, at: Number(had.at) || 0 });
      if (!putPk(pid, { at: now, by: byName, byId, why, name, account, from })) {
        return sendJson(res, 500, { error: 'could not save' });
      }
      return sendJson(res, 200, { ok: true, was: false, at: now });
    }
    const text = String(o.text || '').trim().slice(0, 1000);
    if (!text) return sendJson(res, 400, { error: 'a note says something' });
    if (!putNote(key, { at: now, by: byName, byId, text, profileId: pid, name, from })) {
      return sendJson(res, 500, { error: 'could not save' });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/ticket' && req.method === 'POST') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    let o;
    try { o = JSON.parse(await body(req, 40000)); }
    catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
    if (!sameSecret(String(o.key || ''), String(cfg.botKey))) {
      return sendJson(res, 401, { error: 'no' });
    }
    const title = String(o.title || '').trim().slice(0, 200);
    if (!title) return sendJson(res, 400, { error: 'no title' });
    const list = jsonFile(INBOX, []);
    list.unshift({
      id: 'i' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      kind: 'ticket',
      ticket: String(o.kind || '').slice(0, 20),
      title,
      detail: String(o.detail || '').slice(0, 20000),
      by: String(o.by || '').slice(0, 60),
      discordId: String(o.discordId || '').replace(/[^0-9]/g, '').slice(0, 20),
      at: Date.now(),
      state: 'new',
      from: 'the Discord bot'
    });
    if (!putJson(INBOX, trimInbox(list))) {
      return sendJson(res, 500, { error: 'could not save' });
    }
    // An application's answer to the rules question (#428), kept against the
    // Discord id. The ticket is already saved, so a failure here is logged
    // rather than handed back as a failed ticket.
    if (o.rules && !noteRules(RULES_OK, o.discordId, o.rules, o.by, Date.now())) {
      console.error('[thornswood-docs] could not write down the rules answer for ' +
                    String(o.discordId || '').replace(/[^0-9]/g, '').slice(0, 20));
    }
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/roadmap' && req.method === 'GET') {
    // Built from the issue board by the bot (#3140). The intro is markdown,
    // and it is rendered here like the written pages so the front page needs
    // no markdown library of its own.
    const rm = roadmapBoard(readLists());
    return sendJson(res, 200, Object.assign({}, rm,
      { introHtml: rm.intro ? pageHtml(rm.intro) : '' }));
  }

  if (route === '/api/releases' && req.method === 'GET') {
    const feed = publicJson(NEWS, { launcher:'', news: [] });
    // PowerShell writes a one item list as a bare string, so entries with a
    // single detail line arrived here as text rather than a list. The page then
    // called .map on a string, threw, and the catch around the fetch told
    // everybody the whole news page could not load. Take either shape and hand
    // out one of them, so no writer upstream can blank the page again.
    const asList = (v) => (Array.isArray(v)
      ? v.filter((x) => x !== null && x !== undefined && x !== '').map(String)
      : (v === null || v === undefined || v === '' ? [] : [String(v)]));
    return sendJson(res, 200, {
      launcher: feed.launcher || '',
      news: (feed.news || []).slice(0, 60).map((n) => ({
        date: n.date, title: n.title, body: n.body || '',
        details: asList(n.details), files: asList(n.files).length
      }))
    });
  }

  const verRoute = route.match(/^\/api\/page-version\/([0-9a-fA-F]{64})$/);
  if (verRoute && req.method === 'GET') {
    const hit = findPageVersion(verRoute[1]);
    if (!hit) return sendJson(res, 404, { error: 'no such version' });
    return sendJson(res, 200, hit);
  }

  const pg = route.match(/^\/api\/page\/([a-z-]+)$/);
  if (pg && req.method === 'GET') {
    // The same page the front route renders, for a home.html that was served
    // without it. html is the one to show; md is kept for anything reading it.
    // sha256 is what the installer stores. changed is the day that wording last changed,
    // or null when the list has no row for this text.
    // Only the pages the site shows (#3656): every .md in data\site was
    // served here, lines.md's notes for the team included, though no page
    // shows them.
    const md = MD_PAGES.indexOf('/' + pg[1]) >= 0 ? pageMarkdown(pg[1]) : null;
    if (md === null) return sendJson(res, 404, { error: 'no such page' });
    const sha = pageSha256(md);
    const ver = findPageVersion(sha);
    return sendJson(res, 200, {
      md: md, html: pageHtml(md), sha256: sha, changed: ver ? ver.changed : null
    });
  }

  // Pictures chosen for the gallery are public. Everything else in uploads is
  // not, which is why this is a separate door with its own list.
  if (route === '/api/gallery' && req.method === 'GET') {
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 24);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 60) {
      return sendJson(res, 400, {error:'Use a nonnegative offset and a limit from 1 to 60.'});
    }
    return sendJson(res, 200, galleryPage(offset, limit));
  }
  const shot = route.match(/^\/shot\/([a-z0-9._ -]+)$/);
  if (shot && req.method === 'GET') {
    const item = jsonFile(GALLERY, [])
      .find((g) => String(g.name).toLowerCase() === shot[1]);
    // ?w= is one of its smaller copies (#3218), and only one its srcset names.
    // The file by the name gallery.json keeps, since the address is lower
    // cased and a name may not be: the same file on the box's Windows, and
    // none at all on a copy of the site on Linux.
    const wide = url.searchParams.get('w');
    const file = !item ? ''
      : wide === null ? path.join(UP, String(item.name))
      : srcsetWidths(item.srcset).indexOf(Number(wide)) >= 0 ? smallCopy(item.name, Number(wide)) : '';
    if (!file || !file.startsWith(UP + path.sep) || !fs.existsSync(file)) {
      return send(res, 404, 'no such picture', 'text/plain');
    }
    const st = fs.statSync(file);
    const shotKind = {
      'content-type': KIND[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    };
    // Byte range when asked: a recording will not play in Safari/iOS without it,
    // the same reason public/ and /file already call rangeReply.
    if (rangeReply(req, res, file, st.size, shotKind, head)) return;
    res.writeHead(200, Object.assign({}, shotKind, {
      'content-length': st.size,
      'accept-ranges': 'bytes'
    }));
    if (head) return res.end();
    return fs.createReadStream(file).pipe(res);
  }

  // ---------------------------------------------------------------- static
  if (req.method === 'GET' &&
      (p === '/index.html' || Object.prototype.hasOwnProperty.call(PAGES, route))) {
    try { return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), TYPES['.html']); }
    catch (e) { return send(res, 500, 'no index.html', 'text/plain'); }
  }
  if (req.method === 'GET' && /^\/[A-Za-z0-9._-]+$/.test(p)) {
    if (/\.map$/i.test(p)) return send(res, 404, 'not here', 'text/plain');
    const file = path.join(PUBLIC, p.slice(1));
    if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file)) {
      const type = TYPES[path.extname(file).toLowerCase()] || 'text/plain';
      /*
        How long it may be kept. A name asked for with the hash it has now
        (versionAssets, #3218) is that file and no other for good, so a year
        and immutable. Anything else is the hour and an ETag: a browser
        reuses it for the hour and then asks, and the answer to that
        question is 25 bytes rather than 1.8 MB.

        send() puts Cache-Control: no-store on everything, which is right for
        a page that holds who somebody is and wrong for a picture. no-store
        also means a browser cannot even answer with a 304, so before this a
        page reload was a full download of all of public/.

        The ETag is the hash of what is served, so it changes the moment a
        deploy writes a new file, a stylesheet's when one of its fonts does.
      */
      const name = p.slice(1);
      const version = publicAssetVersion(name);
      const cache = version && url.searchParams.get('v') === version
        ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
      /*
        A byte range when one is asked for, because video needs it.

        Safari and iOS do not play a video from a plain 200 with the whole file
        in it: they ask for a range first and give up if the answer ignores the
        header. Chrome tolerates it, which is exactly how this ships broken for
        half the people and fine for whoever tested it.

        A stylesheet is sent as versionAssets writes it, which is not the file
        on disk byte for byte, so it is never sent in pieces. The range carries
        the same cache line as the whole file; it went out no-store, which kept
        the banner video from being kept at all. No Range header means the
        whole file, with Accept-Ranges added so a client knows it may ask.
      */
      if (!/\.css$/i.test(name) &&
          rangeReply(req, res, file, fs.statSync(file).size, { 'content-type': type, 'cache-control': cache }, head)) return;
      const etag = '"' + (version || crypto.createHash('sha256').update(publicAssetBody(name)).digest('hex').slice(0, 16)) + '"';
      if (String(req.headers['if-none-match'] || '') === etag) {
        res.writeHead(304, {
          'etag': etag,
          'cache-control': cache,
          'x-content-type-options': 'nosniff'
        });
        return res.end();
      }
      const extra = { 'Cache-Control': cache, 'ETag': etag };
      if (!/\.css$/i.test(name)) extra['Accept-Ranges'] = 'bytes';
      return send(res, 200, publicAssetBody(name), type, extra);
    }
  }

  // ------------------------------------------------------------- downloads
  // Streamed, not read into memory: a download can be hundreds of megabytes
  // and reading it up front would hold all of that per person downloading.
  const dl = p.match(/^\/file\/([A-Za-z0-9._ -]+)$/);
  if (dl && req.method === 'GET') {
    // The setup programs, from their GitHub Releases (newestSetup, #4824).
    for (const ch of Object.keys(SETUP_KINDS)) {
      if (dl[1] !== SETUP_KINDS[ch].name) continue;
      const setup = newestSetup(ch);
      if (!setup) return send(res, 404, 'the installer is not published yet', 'text/plain');
      res.writeHead(302, { location: setup.url, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      return res.end();
    }
    const file = path.join(FILES, dl[1]);
    // Only what files.json publishes (downloadServed, #3798).
    const meta = jsonFile(path.join(FILES, 'files.json'), {});
    if (!file.startsWith(FILES + path.sep) || !downloadServed(dl[1], meta) ||
        !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, 'no such file', 'text/plain');
    }
    const st = fs.statSync(file);
    /* Resumable, because a dropped connection should carry on. Accept-Ranges
       on the 200 so a client knows before it starts. The ETag and
       Last-Modified are what a browser needs before it will resume at all,
       and what If-Range is checked against, so a download taken in the
       browser resumes too and never onto a different file. */
    const kind = {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="' + path.basename(file) + '"',
      'etag': '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"',
      'last-modified': new Date(st.mtimeMs).toUTCString()
    };
    if (rangeReply(req, res, file, st.size, kind, head)) return;
    res.writeHead(200, Object.assign({}, kind, {
      'content-length': st.size,
      'accept-ranges': 'bytes'
    }));
    if (head) return res.end();
    return fs.createReadStream(file).pipe(res);
  }

  // --------------------------------------------------------------- ship feed
  // Anonymous version.json and content-addressed packs for the launcher.
  // Live at /feed/, preclear at /feed-dev/. Assets are named by lowercase
  // sha256 only so a path cannot walk outside the folder. #649.
  const feedVer = p.match(/^\/(feed(?:-dev)?)\/version\.json$/);
  if (feedVer && req.method === 'GET') {
    // The newest of the feed's generations (feedFile), never a name a Ship
    // replaces (#2727).
    const file = feedFile(feedVer[1]);
    if (!file) return send(res, 404, 'no such file', 'text/plain');
    /*
      AN ETAG, AND 304 FOR A LAUNCHER THAT ALREADY HAS THIS ONE. #445.

      Every launcher asks for this file every thirty seconds while somebody is
      in a session, because the countdown that closes the game for an update
      has to land inside the server's five minute window. The document is about
      ninety kilobytes and only changes when somebody ships, so nearly ten
      megabytes an hour per launcher was the same bytes over again.

      no-cache stays as it is. It means "ask before reusing this", not "do not
      keep it", which is exactly what a feed wants: the launcher still asks
      every thirty seconds and hears about a release straight away, and the
      answer is a few bytes when nothing has moved.

      The tag is size and modified time, the same shape the static and asset
      branches use, so every new generation of the feed changes it.
    */
    // What the launcher is answered: the whole generation, or once the
    // feed's minLauncher reads it, the update fields alone (feedView, #1050).
    const view = feedView(feedVer[1], file);
    const vtag = view.tag;
    if (String(req.headers['if-none-match'] || '') === vtag) {
      res.writeHead(304, {
        'etag': vtag,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff'
      });
      return res.end();
    }
    return send(res, 200, view.body, 'application/json; charset=utf-8',
      { 'Cache-Control': 'no-cache', 'ETag': vtag });
  }


  // --------------------------------------------------------------- feed watch (#2440)
  // Long-poll tip for open launchers. A launcher holding the ETag of its last
  // version.json waits here until the file changes (or the wait times out),
  // then runs one ordinary conditional feed check. Anonymous, same /feed and
  // /feed-dev folders as version.json. No new timer on the launcher that
  // hammers the document: the tip is quiet until a Ship writes the feed.
  const feedWatch = p.match(/^\/(feed(?:-dev)?)\/watch$/);
  if (feedWatch && req.method === 'GET') {
    const channel = feedWatch[1];
    if (!feedFile(channel)) return send(res, 404, 'no such file', 'text/plain');
    const have = String(req.headers['if-none-match'] || '');
    const WAIT_MS = 50000;
    const started = Date.now();
    const tick = () => {
      if (res.writableEnded || res.destroyed) return;
      // Each tick the newest generation: a Ship's send is a new one (#2727).
      // Generations are never deleted, so only a feed folder taken away by
      // hand ends the wait, with the 404 a channel with no feed answers.
      const file = feedFile(channel);
      let view;
      try { view = feedView(channel, file); }
      catch (e) {
        if (!res.headersSent) return send(res, 404, 'no such file', 'text/plain');
        return;
      }
      // The tag version.json answers with, split or whole (feedView, #1050).
      const tag = view.tag;
      if (!have || have !== tag) {
        if (res.headersSent) return;
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'etag': tag,
          'x-content-type-options': 'nosniff'
        });
        return res.end(JSON.stringify({ etag: tag }));
      }
      if (Date.now() - started >= WAIT_MS) {
        if (res.headersSent) return;
        res.writeHead(204, {
          'cache-control': 'no-store',
          'etag': tag,
          'x-content-type-options': 'nosniff'
        });
        return res.end();
      }
      const t = setTimeout(tick, 500);
      if (t && typeof t.unref === 'function') t.unref();
    };
    tick();
    return;
  }
  const feedAsset = p.match(/^\/(feed(?:-dev)?)\/assets\/([0-9a-f]{64})$/);
  if (feedAsset && req.method === 'GET') {
    const dir = path.join(ROOT, feedAsset[1], 'assets');
    const file = path.join(dir, feedAsset[2]);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) {
      // The rest of the feed, which version.json names as "settings" and
      // which is only ever here (feedView, #1050). Small, so no Range.
      const settings = feedSettings(feedAsset[1], feedAsset[2]);
      if (settings) {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': settings.length,
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff'
        });
        return res.end(head ? undefined : settings);
      }
      return send(res, 404, 'no such file', 'text/plain');
    }
    const st = fs.statSync(file);
    // The Release's copy of these bytes, once GitHub holds it publicly
    // (release copies, #3686). no-cache: the answer moves when it appears.
    const copy = releaseCopy(feedAsset[1], feedAsset[2], st.size);
    if (copy) {
      res.writeHead(302, { location: copy, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      return res.end();
    }
    /* Same Range resume as /file/: packs are tens of megabytes and a drop
       must carry on. Cache-Control is long and immutable because the name
       is the bytes; a new pack is a new name. */
    const kind = {
      'content-type': 'application/octet-stream',
      'etag': '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"',
      'last-modified': new Date(st.mtimeMs).toUTCString(),
      'cache-control': 'public, max-age=31536000, immutable'
    };
    if (rangeReply(req, res, file, st.size, kind, head)) return;
    res.writeHead(200, Object.assign({}, kind, {
      'content-length': st.size,
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff'
    }));
    if (head) return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  // --------------------------------------------------------------- uploads
  /*
    The files themselves. The hub member cookie is the door for all of them, as
    it always was, with one opening: a picture still waiting in the gallery
    queue is read by staff as well (#755).

    The queue page, /uploads, opens for the access.dev roles and its doors take
    the hub cookie or a launcher ticket (#742, #743). The picture beside each
    row in that queue is this address, and it asked w.member, so a Loremaster,
    Gamemaster or Moderator was shown a page of broken pictures and asked to
    decide on shots they could not see. The launcher has no cookie to offer at
    all, so it could not show one either.

    A name on gallery-pending.json therefore goes through galleryStaff, the one
    gate the six staff doors already share, rather than a second check written
    here that would drift from them: st.dev, so being allowed into the game
    (st.play) is not enough. Everything else in uploads is the member cookie
    exactly as before, and an approved shot leaves the queue and is public at
    /shot, so this opening is only what is waiting on a decision.
  */
  const up = p.match(/^\/up\/([A-Za-z0-9._ -]+)$/);
  if (up && req.method === 'GET') {
    if (!w.member) {
      // Nobody who has offered neither a staff cookie nor a ticket is told
      // anything new: they get the 'sign in first' every other name gets,
      // whether that name is in the queue or not.
      const staffAsking = w.dev || url.searchParams.get('ticket');
      const waiting = staffAsking &&
        jsonFile(GPENDING, []).some((x) => String(x.name) === up[1]);
      const gs = waiting ? await galleryStaff(url, w) : null;
      if (!gs) return send(res, 401, 'sign in first', 'text/plain');
      if (!gs.ok) {
        return send(res, gs.code,
                    String((gs.body && gs.body.error) || 'staff only'), 'text/plain');
      }
    }
    // ?w= is a waiting picture's smaller copy (#3218), for the staff card.
    const wide = url.searchParams.get('w');
    const file = wide === null ? path.join(UP, up[1])
      : SMALL_WIDTHS.indexOf(Number(wide)) >= 0 ? smallCopy(up[1], Number(wide)) : '';
    if (!file || !file.startsWith(UP + path.sep) || !fs.existsSync(file)) {
      return send(res, 404, 'no such file', 'text/plain');
    }
    /* A gallery submission that staff removed is not served to anybody
       (#2352), whether its file is still on disk because staff chose to keep
       it, because its delete failed, or because the launcher's buttons never
       ask to delete it. The removal marks it on uploads.json (removedUpload). */
    if (uploadRemoved(up[1])) {
      return send(res, 404, 'removed from the gallery', 'text/plain');
    }
    const st = fs.statSync(file);
    const kind = KIND[path.extname(file).toLowerCase()];
    const inline = kind && !url.searchParams.get('dl');
    res.writeHead(200, {
      'Content-Type': inline ? kind : 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': (inline ? 'inline' : 'attachment') +
        '; filename="' + path.basename(file) + '"'
    });
    if (head) return res.end();
    return fs.createReadStream(file).pipe(res);
  }

  if (p === '/api/upload' && req.method === 'POST') {
    if (!w.member) return sendJson(res, 401, { error: 'sign in first' });
    const asked = (url.searchParams.get('name') || 'file').split(/[\\/]/).pop();
    return receiveUpload(req, res, asked, 200 * 1024 * 1024, null, (name) => {
      const meta = jsonFile(UPMETA, {});
      meta[name] = {
        orig: asked,
        by:   (url.searchParams.get('by')   || '').slice(0, 40),
        note: (url.searchParams.get('note') || '').slice(0, 300),
        at:   Date.now()
      };
      putJson(UPMETA, meta);
      sendJson(res, 200, { ok: true, name });
    });
  }

  const rm = p.match(/^\/api\/upload\/([A-Za-z0-9._ -]+)$/);
  if (rm && req.method === 'DELETE') {
    if (!w.admin) return sendJson(res, 403, { error: 'admins only' });
    const file = path.join(UP, rm[1]);
    if (!file.startsWith(UP + path.sep)) return sendJson(res, 400, { error: 'no' });
    // A delete that fails is said, not answered ok (#2352, #2354), and the
    // file's note stays so the uploads list still shows what is on disk.
    const gone = deleteUpload(rm[1]);
    if (!gone.ok) return sendJson(res, 500, { ok: false, name: rm[1], fileKept: true, code: gone.code,
                                              error: 'The file could not be deleted (' + gone.code + '). It is still on the site.' });
    const meta = jsonFile(UPMETA, {});
    delete meta[rm[1]];
    putJson(UPMETA, meta);
    return sendJson(res, 200, { ok: true });
  }

  // ------------------------------------------------------------- gallery --
  /*
    Somebody sends a picture in, staff decide whether it goes on the public
    gallery. Two doors in: a signed-in Discord account that may play (or the
    hub member cookie), or the launcher with the same signed Discord ticket it
    uses at /api/play/join, so a person can send a shot from the game without
    a site sign in.

    The staff side takes the same two, through galleryStaff, and asks st.dev of
    the ticket rather than st.play (#743).

    The body IS the file, the /api/upload way, so the ticket and the note ride in
    the query, not in the body. The file lands in uploads/ under a stamped name
    through the shared helper, exactly as an /api/upload file does, and an entry
    goes on gallery-pending.json. Nothing here touches gallery.json: a submission
    is not public until an admin approves it, and /api/public and /shot read only
    gallery.json, so a pending shot is not reachable by either.

    The site may send several pictures from one form (multi-select or drop). Each
    file is still one POST to this door, body = the file, so the launcher ticket
    path and the single-file path stay the same. A short queue serialises the
    pending.json write so two rapid submits cannot drop an entry.
  */
  if (p === '/api/gallery/submit' && req.method === 'POST') {
    // Who is asking. A hub member, or a launcher ticket verified the way the
    // door verifies it: read it, ask Discord for the standing, and hold it to
    // the same answers /api/play/join gives, so a banned or departed account
    // cannot put a picture in the queue.
    const who = await gallerySender(url, w, 'Sign in to the hub, or send a valid launcher ticket.');
    if (!who.ok) return sendJson(res, who.code, who.body);
    const from = who.from, discordId = who.discordId;

    const asked = (url.searchParams.get('name') || 'shot.png').split(/[\\/]/).pop();
    const by = (url.searchParams.get('by') || '').slice(0, 40);
    const note = (url.searchParams.get('note') || '').slice(0, 300);
    return receiveUpload(req, res, asked, GALLERY_CAP, GALLERY_ALLOW, (name) => {
      // The uploads.json note too, so this shot reads the same as any other
      // file in the uploads listing (the orig name, who by, the note). With
      // the account that sent it (#2351): gallery.json keeps no account for a
      // shot once it is approved, because /api/public hands that file out, so
      // this note is how a deletion request finds an approved picture. It is
      // never in the listing (listUploads names its own fields).
      const meta = jsonFile(UPMETA, {});
      meta[name] = { orig: asked, by: by, note: note, at: Date.now() };
      if (discordId) meta[name].discordId = discordId;
      // Neither write was looked at (#2736): a queue that could not be
      // written answered ok, and the shot never reached staff. The note that
      // will not write is said, since a deletion request needs it; the queue
      // that will not write is said and answered, so the sender knows.
      if (!putJson(UPMETA, meta)) console.error('[thornswood-docs] gallery ' + JSON.stringify({ event: 'note-write-failed' }));

      withGalleryPending(() => {
        const pending = jsonFile(GPENDING, []);
        const entry = { name: name, by: by, note: note, at: Date.now(), from: from };
        if (discordId) entry.discordId = discordId;
        pending.push(entry);
        if (!putJson(GPENDING, pending)) {
          console.error('[thornswood-docs] gallery ' + JSON.stringify({ event: 'pending-write-failed' }));
          return sendJson(res, 500, { ok: false, error: 'the site could not put that in the queue for staff. Try again in a minute.' });
        }
        sendJson(res, 200, { ok: true, name: name });
      }).catch((e) => failed(req, res, e));
    });
  }

  /*
    A picture's smaller copies (#3218, SMALL_WIDTHS says why). The body IS
    the copy, a WebP or a JPEG named by its Content-Type, the /api/upload
    way; the picture's name and the copy's width ride in the query, with the
    launcher's ticket as on submit. Whoever sent the picture may send each
    width once while it waits; staff may send or replace one at any time.
    The copy has to be exactly that width and the picture's shape, both read
    off the files' own headers, and the picture has to be wider than it. A
    copy staff send for a picture already on the gallery goes out at once,
    since staff made it from the picture they were looking at; any other
    copy waits for an Accept that showed it.
  */
  if (p === '/api/gallery/copy' && req.method === 'POST') {
    const who = await gallerySender(url, w, 'Sign in to the hub, or send a valid launcher ticket.');
    if (!who.ok) return sendJson(res, who.code, who.body);
    const name = String(url.searchParams.get('name') || '');
    const width = Number(url.searchParams.get('w'));
    if (!/^[A-Za-z0-9._ -]+$/.test(name) || name === 'uploads.json') return sendJson(res, 400, { error: 'Say which picture this is a copy of.' });
    if (SMALL_WIDTHS.indexOf(width) < 0) return sendJson(res, 400, { error: 'A copy is ' + SMALL_WIDTHS.join(' or ') + ' pixels wide.' });
    const entry = jsonFile(GPENDING, []).find((x) => String(x.name) === name);
    const shown = jsonFile(GALLERY, []).find((g) => String(g.name) === name);
    if (!entry && !shown) return sendJson(res, 404, { error: 'That picture is not waiting for staff or on the gallery.' });
    const owner = !!(entry && who.discordId && String(entry.discordId || '') === who.discordId);
    if (!who.dev && !owner) return sendJson(res, 403, { error: 'Only whoever sent that picture, or staff, can send its smaller copies.' });
    if (!who.dev && pendingCopies(entry).indexOf(width) >= 0) {
      return sendJson(res, 409, { error: 'That copy is already in. Staff look at the copies before they Accept, so a copy is not changed once it is sent.' });
    }
    if (uploadRemoved(name)) return sendJson(res, 409, { error: 'That picture was removed from the gallery.' });
    const full = pictureSize(path.join(UP, name));
    if (!full) return sendJson(res, 422, { error: 'The site could not read the size of that picture, so it takes no copy of it.' });
    if (full.w <= width) return sendJson(res, 400, { error: 'That picture is ' + full.w + ' pixels wide, so it needs no ' + width + ' copy.' });
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = type === 'image/webp' ? '.webp' : type === 'image/jpeg' ? '.jpg' : '';
    if (!ext) return sendJson(res, 415, { error: 'A copy is a WebP or a JPEG.' });
    const tall = Math.round(full.h * width / full.w);
    return receiveUpload(req, res, 'copy' + ext, SMALL_CAP, SMALL_KINDS, (temp) => {
      const sent = path.join(UP, temp);
      const got = pictureSize(sent);
      if (!got || got.w !== width || Math.abs(got.h - tall) > 1) {
        // The file goes, and one that will not go is said by deleteUpload.
        deleteUpload(temp);
        return sendJson(res, 422, { error: 'That copy is ' + (got ? got.w + ' by ' + got.h : 'not a picture the site can read') +
                                           ', and a ' + width + ' copy of this picture is ' + width + ' by ' + tall + '.' });
      }
      // Kept and noted in the queue's turn, so two copies at one width sent
      // together cannot both get in: the second is told it is already in.
      withGalleryPending(() => {
        const pending = jsonFile(GPENDING, []);
        const hit = pending.find((x) => String(x.name) === name);
        if (!who.dev && (!hit || pendingCopies(hit).indexOf(width) >= 0)) {
          deleteUpload(temp);
          return sendJson(res, 409, { error: hit ? 'That copy is already in.' : 'That picture is no longer waiting for staff.' });
        }
        try {
          fs.mkdirSync(UP_SMALL, { recursive: true });
          fs.renameSync(sent, smallFile(name, width, ext));
          // The other kind at this width, if one was sent before, goes, or
          // smallCopy could go on finding it.
          for (const other of SMALL_KINDS) {
            if (other === ext) continue;
            try { fs.unlinkSync(smallFile(name, width, other)); }
            catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
          }
        } catch (e) {
          console.error('[thornswood-docs] could not keep the ' + width + ' copy of ' + name + ' (' + (e.code || e.message) + ')');
          deleteUpload(temp);
          return sendJson(res, 500, { error: 'The site could not keep that copy (' + (e.code || 'unknown') + '). Try again in a minute.' });
        }
        if (hit) {
          const have = pendingCopies(hit).concat(width);
          hit.copies = SMALL_WIDTHS.filter((n) => have.indexOf(n) >= 0);
          if (!putJson(GPENDING, pending)) {
            console.error('[thornswood-docs] gallery ' + JSON.stringify({ event: 'pending-write-failed' }));
            return sendJson(res, 500, { ok: false, error: 'The site kept the copy but could not note it on the queue. Send it again in a minute.' });
          }
        }
        if (who.dev) {
          const gallery = jsonFile(GALLERY, []);
          const item = gallery.find((g) => String(g.name) === name);
          if (item) {
            const srcset = shotSrcset(name, srcsetWidths(item.srcset).concat(width));
            if (srcset) item.srcset = srcset;
            if (!putJson(GALLERY, gallery)) {
              console.error('[thornswood-docs] gallery ' + JSON.stringify({ event: 'gallery-write-failed' }));
              return sendJson(res, 500, { ok: false, error: 'The site kept the copy but could not put it on the gallery. Send it again in a minute.' });
            }
          }
        }
        sendJson(res, 200, { ok: true, name: name, w: width });
      }).catch((e) => failed(req, res, e));
    }, true);
  }

  // The queue, for staff (access.dev) to look through. Never public, so it is
  // its own door rather than a field on /api/public. galleryStaff takes the hub
  // cookie or a launcher ticket for a staff account; everything below it does
  // the same, so the six staff doors have one gate between them.
  if (p === '/api/gallery/pending' && req.method === 'GET') {
    const gs = await galleryStaff(url, w);
    if (!gs.ok) return sendJson(res, gs.code, gs.body);
    // A submission past PENDING_DAYS is not offered while it waits for the
    // sweep to delete it (#2353).
    return sendJson(res, 200, { pending: stalePending(jsonFile(GPENDING, []), Date.now()).left });
  }

  // Approve: take it off the queue and put it on the public list. Idempotent,
  // so approving the same name twice is a 200 that changed nothing the second
  // time, and a name already on the gallery is left where it is.
  if (p === '/api/gallery/approve' && req.method === 'POST') {
    const gs = await galleryStaff(url, w);
    if (!gs.ok) return sendJson(res, gs.code, gs.body);
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const name = String(o.name || '');
    if (!name) return sendJson(res, 400, { error: 'no name' });
    // A removed submission does not come back by its name (#2352).
    if (uploadRemoved(name)) return sendJson(res, 409, { error: 'That picture was removed from the gallery, so it cannot be accepted.' });

    const pending = jsonFile(GPENDING, []);
    const hit = pending.find((x) => String(x.name) === name);
    // "by" from the call wins, then the pending entry's, then empty. The url is
    // built here so gallery.json holds exactly the shape /api/public hands out.
    const by = (o.by !== undefined && o.by !== null) ? String(o.by).slice(0, 40)
             : (hit ? String(hit.by || '') : '');

    // The smaller copies the card showed (#3218): those go out with it and
    // no others, so what is public is what staff saw. A caller that names
    // none (a launcher from before the copies) puts it up at full size.
    const showed = Array.isArray(o.copies) ? o.copies.map(Number) : [];
    const copies = pendingCopies(hit).filter((n) => showed.indexOf(n) >= 0);
    const srcset = copies.length ? shotSrcset(name, copies) : '';

    const gallery = jsonFile(GALLERY, []);
    const already = gallery.find((g) => String(g.name) === name);
    if (already) {
      already.url = '/shot/' + name;
      if (by) already.by = by;
      if (srcset) already.srcset = srcset;
    } else {
      const item = { name: name, url: '/shot/' + name, by: by };
      if (srcset) item.srcset = srcset;
      gallery.push(item);
    }
    putJson(GALLERY, gallery);

    const left = pending.filter((x) => String(x.name) !== name);
    if (left.length !== pending.length) putJson(GPENDING, left);
    return sendJson(res, 200, { ok: true, name: name, approved: true, copies: srcsetWidths(srcset) });
  }


  // Who may submit or moderate on the public gallery page. Always 200: the
  // page needs to know whether to show Sign in, Submit, or the staff tools
  // without treating a play-capable signed-in person as signed out the way
  // /api/hello does for the hub.
  /* Answered inside SUBMIT_WAIT_MS with Discord slow or silent (#1096), like
     any page load. asked is false when Discord could not be asked and there
     was no earlier answer to use, so a page says that rather than offering a
     sign in to somebody who is signed in. personWhy is what the report page
     shows under "about a person": /api/report's own words (#1097). */
  if (p === '/api/gallery/who' && req.method === 'GET') {
    const no = personReportRefusal(w);
    return sendJson(res, 200, {
      signed: !!(w.id || w.member),
      canSubmit: !!(w.play || w.member),
      staff: !!w.dev,
      admin: !!w.admin,
      name: w.name || '',
      asked: !(w.id && w.lookupFailed),
      personWhy: no ? no.why : '',
      personSays: no ? no.error : ''
    });
  }

  // Delete: take a shot off the public gallery and/or the pending queue.
  // Staff only (access.dev). Pending items that staff do not want go this
  // way; there is no separate Reject door. Whether the file goes now or is
  // held for a report is the site's to decide (#2352), not the caller's.
  if (p === '/api/gallery/approved' && req.method === 'DELETE') {
    const gs = await galleryStaff(url, w);
    if (!gs.ok) return sendJson(res, gs.code, gs.body);
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const name = String(o.name || '');
    if (!name) return sendJson(res, 400, { error: 'no name' });

    const gallery = jsonFile(GALLERY, []);
    const leftGal = gallery.filter((x) => String(x.name) !== name);
    const removedGal = gallery.length - leftGal.length;
    if (removedGal) putJson(GALLERY, leftGal);

    const pending = jsonFile(GPENDING, []);
    const leftPend = pending.filter((x) => String(x.name) !== name);
    const removedPend = pending.length - leftPend.length;
    if (removedPend) putJson(GPENDING, leftPend);

    // Drop open reports against this name too, so the reports list does not
    // keep asking about a picture that is already gone.
    const reports = jsonFile(GREPORTS, []);
    const kept = reports.filter((r) => String(r.name) !== name);
    const itsReports = reports.filter((r) => String(r.name) === name);
    if (kept.length !== reports.length) putJson(GREPORTS, kept);

    /*
      The file (#2352, option C). Deleted, unless the submission had an open
      report against it: then it is taken down after a report, and its file
      stays on the site's disk, unshown, for GALLERY_HOLD_DAYS with those
      reports beside it on uploads.json, and pruneRemovedUploads deletes it
      once that time is up. deleteFile from a client is no longer read: the
      hub asked it as a second question and the launcher never sent it, so
      the same removal kept or deleted the file depending on the button.
      Either way the file is marked removed while it is on disk, which
      /up/<name> refuses, so a removed submission is not served to anybody.
      A delete that fails is said, never answered ok: the entry is still off
      both lists, the file is marked removed so it is not served, the answer
      and the site's log say it is still there, and the retention timer
      deletes it once it can.
    */
    const answer = {
      ok: true,
      name: name,
      removed: removedGal + removedPend,
      removedApproved: removedGal,
      removedPending: removedPend,
      fileDeleted: false
    };
    const file = path.join(UP, name);
    if (file.startsWith(UP + path.sep) && fs.existsSync(file)) {
      const now = Date.now();
      const hold = itsReports.length > 0;
      const gone = hold ? { ok: false, code: '' } : deleteUpload(name);
      const meta = jsonFile(UPMETA, {});
      if (gone.ok) {
        delete meta[name];
        answer.fileDeleted = true;
      } else {
        meta[name] = Object.assign({}, meta[name] || {}, { removed: now });
        if (hold) {
          meta[name].heldUntil = now + GALLERY_HOLD_DAYS * 86400000;
          meta[name].heldReports = itsReports.slice(-20);
          answer.heldForReport = true;
          answer.heldUntil = meta[name].heldUntil;
        }
      }
      if (!putJson(UPMETA, meta)) {
        // Unmarked, a kept file would still be served at /up/<name>.
        retentionSay('gallery', { event: 'note-write-failed', file: name });
        answer.ok = false;
        answer.fileKept = !gone.ok;
        answer.error = 'Taken off the gallery, but the site could not record that, so ' +
                       (gone.ok ? 'its note is still listed.' : 'its file can still be opened by staff. Try again.');
        return sendJson(res, 500, answer);
      }
      if (!hold && !gone.ok) {
        answer.ok = false;
        answer.fileKept = true;
        answer.code = gone.code;
        answer.error = 'Taken off the gallery, but its file could not be deleted (' + gone.code +
                       '). It is no longer shown anywhere, and the site deletes it within the hour once it can.';
        return sendJson(res, 500, answer);
      }
    }
    return sendJson(res, 200, answer);
  }

  // Report an approved shot. Any signed-in play-capable member, or the
  // launcher with the same ticket /api/gallery/submit takes. The report sits
  // in gallery-reports.json for staff; it does not take the shot down.
  if (p === '/api/gallery/report' && req.method === 'POST') {
    const who = await gallerySender(url, w, 'Sign in, or send a valid launcher ticket.');
    if (!who.ok) return sendJson(res, who.code, who.body);
    const from = who.from, discordId = who.discordId;

    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const name = String(o.name || '');
    if (!name) return sendJson(res, 400, { error: 'no name' });
    const why = String(o.why || '').slice(0, 500);

    const gallery = jsonFile(GALLERY, []);
    if (!gallery.find((g) => String(g.name) === name)) {
      return sendJson(res, 404, { error: 'not on the gallery' });
    }

    const reports = jsonFile(GREPORTS, []);
    const id = crypto.randomBytes(8).toString('hex');
    const entry = { id: id, name: name, why: why, at: Date.now(), from: from };
    if (discordId) entry.discordId = discordId;
    reports.push(entry);
    // Keep the newest 500 so a flood cannot grow the file forever, and none
    // past GREPORTS_DAYS (#2353).
    putJson(GREPORTS, freshGalleryReports(reports, Date.now()).slice(-500));
    return sendJson(res, 200, { ok: true, id: id });
  }

  if (p === '/api/gallery/reports' && req.method === 'GET') {
    const gs = await galleryStaff(url, w);
    if (!gs.ok) return sendJson(res, gs.code, gs.body);
    return sendJson(res, 200, { reports: freshGalleryReports(jsonFile(GREPORTS, []), Date.now()) });
  }

  if (p === '/api/gallery/report/dismiss' && req.method === 'POST') {
    const gs = await galleryStaff(url, w);
    if (!gs.ok) return sendJson(res, gs.code, gs.body);
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const id = String(o.id || '');
    if (!id) return sendJson(res, 400, { error: 'no id' });
    const reports = jsonFile(GREPORTS, []);
    const left = reports.filter((r) => String(r.id) !== id);
    putJson(GREPORTS, left);
    return sendJson(res, 200, { ok: true, id: id, removed: reports.length - left.length });
  }


  // -------------------------------------------------------------- the door
  /*
    What the launcher talks to. The person links Discord once, the launcher
    keeps a signed ticket, and every launch it asks here whether that ticket is
    still somebody who is allowed in. The answer used to carry the server
    password as well, so the password stopped being a thing written in
    version.json for anybody who has ever installed the game to keep forever.
    It has not carried one since 18 September, when the site stopped reading
    the password at all: a yes now says who the account is and what it may
    do, and nothing more.

    Every call re-asks Discord. Leaving the server, or being handed the Banned
    role, stops the next launch working, with nothing to remember to do.
  */
  if (p === '/api/play/join' && req.method === 'POST') {
    const by = Date.now() + PLAY_ANSWER_MS;
    let o = {};
    try { o = JSON.parse(await body(req, 8192, PLAY_BODY_MS)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 401, { ok:false, why:'link', message:
      'This copy is not linked to a Discord account yet.' });

    const st = await within(standing(t.d), by - Date.now(), () => standingLate(t.d));
    standCache.delete(String(t.d));
    /*
      Could not ask Discord is not the same answer as not in the Discord.

      standing() leaves inGuild false on every failed lookup and sets
      lookupFailed to say why, because only a 404 means "not in the server".
      This door tested inGuild alone, so a rate limit or a Discord outage came
      back as 403 why 'guild', and the launcher writes a 'guild' down as a
      remembered no, which erased the 72 hour grace it keeps for exactly the
      day the site cannot vouch for anybody. The restart wave after every
      release is when Discord rate limits the site, and a stranger told they
      are not in a Discord they joined ten minutes ago assumes the thing is
      broken and leaves.

      So it answers 503 with the same why /api/play/owns already uses, and
      Door.cs treats that like a site that did not answer: a yes from the last
      few days still opens the door. The hand written admin list is left out
      of this, because standing() already let them in and it is the way back
      in on exactly this kind of morning.
    */
    if (st.lookupFailed && !st.admin) return sendJson(res, 503, discordUnasked());
    // Banned before the guild (#1010): a staff ban answers from the file and
    // says nothing about the guild, so asked the other way round a banned
    // account was told it was not in the Discord.
    if (st.banned) return sendJson(res, 403, { ok:false, why:'banned', message: accountBanned(st) });
    if (!st.inGuild) return sendJson(res, 403, { ok:false, why:'guild', message:
      'That Discord account is not in the Thornswood Discord.',
      invite: cfg.discord.invite || '' });
    if (!st.play) return sendJson(res, 403, { ok:false, why:'role', message:
      notAcceptedYet(),
      invite: cfg.discord.invite || '' });
    // The dev build checks in as channel dev. It is for the roles in
    // access.devBuild (Owner, Co-Owner, Dev and the leads, #3317, unless
    // config.json says otherwise); anyone else is sent back to the main build
    // with a plain reason.
    const wantsDev = String(o.channel || '') === 'dev';
    if (wantsDev && !st.devBuild) return sendJson(res, 403, { ok:false, why:'dev', dev: false, message:
      'The dev build is for the ' + andList(cfg.access.devBuild) + ' roles. Play on the main build.' });
    /*
      The world is full (#481). Not a no any more: Patrick, 29 Sep, a full
      world lets people into the game's menu to wait in line. The yes below
      carries wait and a sentence saying so, and the launcher logs it on the
      Play page. A Discord staff role is not told: the gamemode gives them a
      staff seat ahead of the line. The dev build is staff only.
    */
    const wait = !wantsDev && seatsFull(gameStatus) && !st.staffRole;

    // The launcher sends the profile id it is about to play as. The game
    // server never sees a Discord account, only this number, so this is the
    // one place the two get tied together, and /api/allowed hands the numbers
    // back to the server's door. A person has a couple of character slots, so
    // it is a short list rather than one value.
    const pid = Number(o.profileId) || 0;
    // Which accounts holding this id have left the Discord, asked off a copy
    // of the file before the one written back is read. Nothing may wait
    // between that read and putJson below; departed() says why.
    const left = await departed(jsonFile(LINKED, {}), pid, t.d, by);
    const linked = jsonFile(LINKED, {});
    const was = linked[t.d] || {};
    const profiles = Array.isArray(was.profiles) ? was.profiles.slice() : [];
    /*
      A number already against somebody else's Discord account is theirs, and
      this used to write it against the caller's account anyway.

      Found reading the code for To Do List entry 142, identity on the game
      server being a number the client picks. voice-server.js sends every
      profile id to every voice peer five times a second, so any account with
      the play role could learn somebody's id, check in with it here, and
      from then on /api/play/owns below answered "theirs" and the voice
      service minted a proven token for it. /owns already refuses somebody
      else's number; this is the same loop, run before anything is written.

      The caller's own list is read first, the way /owns reads it, so a
      person checking in again with an id they already hold is always
      claimed, even if an older file also has that id against a second
      account. An id nobody holds still belongs to whoever checks in with it
      first, which is the launcher that just made the character.

      Not written, and NOT refused. The first cut of this answered 409, and
      that locked out a tester who had done nothing wrong. The launcher's
      character list is kept per install, not per Discord account, and the
      door check (Door.Check, before Chars.Prepare) sends the id played last.
      So an install that had played under one account and was then linked to
      another with the launcher's own Unlink and Connect Discord (a second
      person on a shared PC, an alt, somebody who changed accounts) got a 409
      on every Play, a warning box, and no game, with no way to reach New
      character at the menu. Refusing protected nothing either: the yes below
      carries no password, and nothing in it is about the character, only
      about the account that asked. What needed protecting is linked.json,
      and leaving the id off the caller's list is the whole of that. The
      caller is still stamped as seen, because they did check in. claimed
      false says the id was left off, for whoever wants to read it.

      Such an install's spare, the id the menu's New character uses, was
      checked in under the first account too, and this route cannot tell it
      from an id somebody took. So the launcher mints the relinked account a
      fresh spare before it checks anything in (Chars.EnsureSpare), and the
      new character is filed under the account that made it.

      WHAT THIS COSTS SOMEBODY WHO CHANGED ACCOUNTS, which is new with this
      rule and not something main did. Measured by a reviewer on 24 September
      running this route, /owns and /api/allowed from main and from here: an
      install with characters 700 and 701 made under A, relinked to B. On main
      B took both at its first Play. Here they stay A's. While A is in the
      Discord the game's door still lets them in on A's standing, but /owns
      calls them somebody else's, so the voice service refuses B a token on
      either. Whether that is the right price for stopping id theft is
      Patrick's to decide; an admin action that moves an id between accounts
      is the other half of it and is not built.
      What is not a price worth paying is the rest of what the reviewer
      found: once A left the Discord, /api/allowed dropped 700 and 701 and
      the door turned B away from both, with a hand edit of linked.json on the
      VPS the only way back. So an id held only by accounts that have left the
      Discord, and are not banned (hasLeft), is free: it is taken off them and
      claimed by whoever checks in with it, which for that install is B at its
      next Play.
    */
    let claimed = pid > 0 && profiles.map(Number).indexOf(pid) >= 0;
    /*
      An id the caller already holds goes to the end of their list, so the
      eight kept below are the eight checked in most recently.

      Found reviewing this route for entry 142 on 24 September. The list was
      kept in the order ids first arrived and cut to its last eight, and an id
      already on it never moved. Every Play checks the characters in before
      the spare, and a relinked install mints a new spare each time it goes
      back to an account, so that account's list grew by one spare per switch
      while its characters sat at the front. On the ninth id its oldest
      character fell off, and the other account's next Play checked it in
      with nobody holding it and claimed it for good, which is the same harm
      the holder rule below exists to stop. Measured with test-play-join.js:
      one character, A to B to A each round, off A's list after round seven
      and B's from round eight. Moved to the end, an install's own ids are
      always the newest, and a spare the launcher retired is what drops off.
    */
    if (claimed) {
      for (let i = profiles.length - 1; i >= 0; i--) {
        if (Number(profiles[i]) === pid) profiles.splice(i, 1);
      }
      profiles.push(pid);
    }
    if (pid > 0 && !claimed) {
      let holder = '';
      const gone = [];
      for (const d of Object.keys(linked)) {
        if (String(d) === String(t.d)) continue;
        const theirs = (linked[d] && Array.isArray(linked[d].profiles))
          ? linked[d].profiles.map(Number) : [];
        if (theirs.indexOf(pid) < 0) continue;
        // An account that holds it and was not asked about above (it took the
        // id since) counts as still holding it, which is the safe side.
        if (left.has(String(d))) { gone.push(String(d)); continue; }
        holder = d;
        break;
      }
      if (holder) {
        console.log('[thornswood-docs] join kept profile ' + pid + ' off Discord ' + t.d +
                    ': it is held by Discord ' + holder);
      } else {
        // Off the accounts that have left, so one id has one holder and the
        // rule above keeps working for the account that has it now.
        for (const d of gone) {
          linked[d].profiles = linked[d].profiles.filter((n) => Number(n) !== pid);
          console.log('[thornswood-docs] join moved profile ' + pid + ' to Discord ' + t.d +
                      ' from Discord ' + d + ', which has left the Thornswood Discord');
        }
        profiles.push(pid);
        claimed = true;
      }
    }
    linked[t.d] = Object.assign(was, {
      id: String(t.d), name: st.name || t.n,
      first: was.first || Date.now(), seen: Date.now(),
      played: Date.now(), roles: st.roles,
      profiles: profiles.slice(-8)
    });
    /* Not recorded is not let in: the door lists only what linked.json holds.
       It used to answer yes whatever the write did, and a linked.json that
       will not read is never written over (#2180), so the launcher went on
       to a door that would turn the character away with no reason given. */
    if (!putJson(LINKED, linked)) {
      console.error('[thornswood-docs] check in for Discord ' + t.d + ' not recorded: linked.json was not written');
      return sendJson(res, 503, { ok: false, why: 'not recorded', message:
        'The site could not record this character against your account, so the game would not let it in. ' +
        'Try again later, and tell staff if it keeps happening.' });
    }

    return sendJson(res, 200, {
      ok: true,
      id: st.id,
      name: st.name || t.n,
      avatar: st.avatar || '',
      admin: st.admin,
      dev: !!st.dev,
      // Whether this account may install and play the dev build
      // (access.devBuild, #3317). dev above is staff in the game.
      devBuild: !!st.devBuild,
      roles: st.roles,
      slots: slotsFor(st),
      // Whether the profile id sent is now against this account. False when
      // none was sent, and when another account already holds it, in which
      // case it was left off this one and the door still said yes.
      claimed: claimed,
      // The world is full: in, but there may be a wait at the menu (#481).
      wait: wait,
      message: wait ? worldFull(gameStatus.online) : '',
      online: gameStatus.online,
      max: gameStatus.max || mostOnlineFallback(),
      line: gameStatus.line,
      // Which crashes behind the snapshots this launcher holds staff have
      // marked looked at (#2319, lookedAtFor): those it may delete.
      lookedAt: lookedAtFor(sessionRows(), t.d, o.snapshots).join(',')
    });
  }

  /*
    Both ends of a play session, from the launcher.

    Start when the game is started, end when it has closed, the same id on
    both. The ticket is read the same way the door reads it, and the row is
    written against the Discord id INSIDE that ticket, so a ticket can only
    ever write its own rows: one person's launcher cannot start, end or fill
    in a session belonging to somebody else, whatever id it sends.

    A row with no end is a session still open, not a fault. A row with no
    start is a session whose start was never seen, which is what a launcher
    that was replaced or restarted mid session produces, and it is recorded
    rather than dropped.
  */
  if ((p === '/api/play/start' || p === '/api/play/end') && req.method === 'POST') {
    const ending = (p === '/api/play/end');
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 401, { ok: false, why: 'link' });
    const key = sessionKey(o.session);
    if (!key) return sendJson(res, 400, { ok: false, why: 'no session id' });

    /* A ticket outlives a ban by up to a month, so a ban Discord confirms
       refuses here too. A lookup that failed records the session, because
       losing an evening's testing to a bad minute at Discord is the worse of
       the two. This is not what keeps the log from being scrubbed: any
       linked account could post starts until the rolling cap took every real
       session off the front with them, and the count below is what stops
       that. */
    const st = await standingCached(t.d);
    if (st.banned) return sendJson(res, 403, { ok: false, why: 'banned' });

    const rows = sessionRows();
    const at = findSession(rows, key, t.d);
    const now = Date.now();

    /* Nobody plays thirty times an hour. Past that from one account it is a
       fault or somebody pushing, and either way the row is not written. An
       end is never refused: an end only fills in a row that is already
       there. */
    if (!ending) {
      const hourAgo = now - 3600000;
      let mine = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (!r || !(Number(r.start) >= hourAgo)) continue;
        if (String(r.who) === String(t.d)) mine++;
      }
      if (mine >= 30 && at < 0) return sendJson(res, 429, { ok: false, why: 'too many' });
    }

    if (!ending) {
      // A second start on the same id is the same session said twice, not
      // another one, so it fills the row in rather than adding to it.
      if (at >= 0) {
        const was = rows[at];
        was.start = was.start || now;
        if (Number(o.profileId) > 0) was.profile = Number(o.profileId);
        if (o.version) was.version = String(o.version).slice(0, 32);
        was.channel = String(o.channel || '') === 'dev' ? 'dev' : 'main';
      } else {
        const row = sessionRow(t, o, key);
        row.start = now;
        rows.push(row);
      }
    } else {
      let m = Number(o.minutes);
      if (!isFinite(m) || m < 0) m = 0;
      m = Math.round(m * 10) / 10;
      const why = String(o.why || '') === 'update' ? 'update' : 'quit';
      if (at >= 0) {
        const was = rows[at];
        was.end = now;
        was.minutes = m;
        was.why = why;
        // The character is picked at the game's menu, so the start went out
        // not knowing it and the end is the first that does.
        if (Number(o.profileId) > 0) was.profile = Number(o.profileId);
        if (o.version) was.version = String(o.version).slice(0, 32);
      } else {
        const row = sessionRow(t, o, key);
        row.end = now;
        row.minutes = m;
        row.why = why;
        rows.push(row);   // start stays 0: it was never seen
      }
    }
    if (!putSessions(rows)) return sendJson(res, 500, { ok: false, why: 'could not save' });
    // pruneSessionLogs says its own failures and never throws (#2354).
    if (ending) pruneSessionLogs();
    return sendJson(res, 200, { ok: true });
  }

  /*
    The logs from one session, sent by the launcher as the game closes.

    That moment and no other: the game wipes its own logs at every start, so a
    log nobody collected then is gone, which is why every report has had to
    begin by asking the person to go and find four files.

    Written once. A second set for the same session is refused and the attempt
    recorded on the first, because these are meant to stand up when somebody is
    suspended and evidence that the accused can overwrite is not evidence. The
    Discord id is taken off the ticket, never off the body.

    A bigger body than the rest of the API accepts, because it is carrying
    logs, and still capped: putSessionLogs trims each log and the set.
  */
  if (p === '/api/play/logs' && req.method === 'POST') {
    let o = {};
    try { o = JSON.parse(await body(req, SLOG_ALL + 64 * 1024)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 401, { ok: false, why: 'link' });
    const key = sessionKey(o.session);
    if (!key) return sendJson(res, 400, { ok: false, why: 'no session id' });

    /* Only for a session this account actually has a row for. Without this
       anybody linked could write a log set against any id they invented, and
       the folder would fill with sets belonging to no session. */
    const rows = sessionRows();
    const at = findSession(rows, key, t.d);
    if (at < 0) return sendJson(res, 404, { ok: false, why: 'no such session' });

    const logs = (o.logs && typeof o.logs === 'object') ? o.logs : {};
    const what = putSessionLogs(key, t.d, logs);
    if (what === 'already') return sendJson(res, 409, { ok: false, why: 'already sent' });
    if (what === 'nothing') return sendJson(res, 200, { ok: true, stored: false });
    // putSessionLogs has said why in the site's log. 500 is what the launcher
    // keeps the logs for and sends again at its next start (#2736).
    if (what === 'failed') return sendJson(res, 500, { ok: false, why: 'could not save' });

    /* Read them once, now, so the page can colour this one session and the
       bot can say so in Discord. Done here rather than when somebody opens
       the page, because the point is that nobody has to open the page for
       anybody to find out.

       The launcher's own blockers and warnings come with the logs, already
       structured, and they carry more than the launcher's window shows: which
       plugin, whether it is absent or merely wrong, and the size, CRC and
       manifest index the server wanted. Those are kept whole.

       NOT IN A TRY (#2736). All of this sat in a try whose catch was empty, so
       a failure stored the logs, answered ok, and the session's trouble
       colour and the bot's crash note never happened with nothing said. What
       can fail here is said where it fails, the session key and the error
       code and never what the logs hold: the server log that will not read,
       the row that will not write, the note for the bot that will not write
       (noteTrouble says its own). The logs are stored by now, so the answer
       stays 200 stored, and says read false or noted false for what did not
       happen. Nothing else here throws on what JSON.parse hands it; a bug
       that does is failed()'s 500 and its stack in site.log. */
    const issues = Array.isArray(o.issues) ? o.issues.slice(0, 100).map(i => ({
      text: String((i && i.text) || '').slice(0, 400),
      blocking: !!(i && i.blocking),
      absent: !!(i && i.absent),
      plugin: String((i && i.plugin) || '').slice(0, 160),
      wantSize: Number(i && i.wantSize) || 0,
      wantCrc: Number(i && i.wantCrc) || 0,
      wantIndex: Number(i && i.wantIndex) || 0
    })).filter(i => i.text) : [];

    const checks = Array.isArray(o.checks) ? o.checks.slice(0, 40).map(c => ({
      name: String((c && c.name) || '').slice(0, 120),
      detail: String((c && c.detail) || '').slice(0, 400)
    })).filter(c => c.name) : [];

    if (issues.length) rows[at].issues = issues;
    if (checks.length) rows[at].checks = checks;

    /* The server's half of this session, the same window the View more
       button reads, for what the server said about this person's load
       order (#945). No server log on this box is the dev machine and says
       nothing; one that is there and will not read is said. */
    const row = rows[at];
    const from = (Number(row.start) || Number(row.end) || 0) - 60000;
    const to = (Number(row.end) || Date.now()) + 60000;
    const server = serverLogSlice(row.channel, from, to);
    if (!server.ok && server.code) {
      console.error('[thornswood-docs] session-logs ' + JSON.stringify({ event: 'server-log-unread', session: key, code: server.code }));
    }

    const found = readTrouble(logs, server.lines, row.profile);
    applyTrouble(row, found);
    row.troubleRules = TROUBLE_RULES;

    const answer = { ok: true, stored: true };
    if (!putSessions(rows)) {
      console.error('[thornswood-docs] session-logs ' + JSON.stringify({ event: 'row-write-failed', session: key }));
      answer.read = false;
    }
    /* Only a crash is worth saying out loud. */
    if (found && found.level === 'bad' && !noteTrouble(rows[at], found)) answer.noted = false;

    return sendJson(res, 200, answer);
  }

  /*
    The character roster, in from the game server and out to each person.

    In: the gamemode posts its whole book with the door key whenever it
    changes, {key, who: {"<profileId>": {name, race, female, trade, town,
    where, at}}}. Merged by profile id, so the live and the dev server share
    the file without treading on each other.

    Out: a launcher posts its ticket and gets the rows for the profile ids
    linked to that Discord account, and no others. This is how a card at the
    game's main menu knows its own name; until 20 September the launcher read
    characters.json off the resource port, which has been a 404 since the
    file moved into the private folder on the 18th.
  */
  // The dev server's door.json names the site as https://thornswood.net/dev,
  // so its roster lands on /dev/api/roster (#955). Until that route was here
  // the dev server's pushes had no door to come in by.
  if ((route === '/api/roster' || route === '/dev/api/roster') && req.method === 'POST') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    let o = {};
    try { o = JSON.parse(await body(req, 4 * 1024 * 1024)) || {}; } catch (e) { passBodyFailure(e); }
    if (!sameSecret(String(o.key || ''), String(cfg.botKey))) return sendJson(res, 401, { error: 'no' });
    const who = (o.who && typeof o.who === 'object') ? o.who : {};
    const store = jsonFile(ROSTER, { who: {} });
    if (!store.who || typeof store.who !== 'object') store.who = {};
    const srv = (String(o.server || '') === 'dev' || route.indexOf('/dev/') === 0) ? 'dev' : 'main';
    if (!store.sent || typeof store.sent !== 'object' || Array.isArray(store.sent)) store.sent = {};
    store.sent[srv] = Date.now();
    /*
      A deleted person's characters stay off the roster (#3677).

      The site takes a deletion request out of roster.json as it starts and
      then deletes the request, but a game server takes its own part only at
      its own next start (#2758), and until then it still holds their rows
      and sends its whole book here every five minutes. So the site's start
      leaves a mark in roster.json's deleted for each of their character
      numbers, { at, clear }: at is when the site removed them, and nothing
      else about them is kept. A row for a marked number is refused unless
      the game server wrote it after that (row.at, which moves only while
      somebody is playing it), so a character the number is played as again
      comes back and the deleted one does not. Each server whose book no
      longer has the old row, and whose held list does not name it, is added
      to clear, and the mark goes once every server that has ever sent a book
      (sent, and servers for a box older than sent) is there, which is when
      no server can send it back.
    */
    const marks = (store.deleted && typeof store.deleted === 'object' && !Array.isArray(store.deleted)) ? store.deleted : {};
    const stale = (pid) => {
      const m = marks[String(pid)];
      const row = who[String(pid)];
      return !!m && !(row && typeof row === 'object' && Number(row.at) > (Number(m.at) || 0));
    };
    // Which of the profiles it looked at that server holds a character for,
    // kept per server (#955). /api/play/roster reads it back as "gone".
    if (Array.isArray(o.checked) && Array.isArray(o.held)) {
      const ints = (a) => a.map(Number).filter((x) => x > 0 && Number.isInteger(x) && !stale(x)).slice(0, 100000);
      if (!store.servers || typeof store.servers !== 'object') store.servers = {};
      store.servers[srv] = { at: Date.now(), checked: ints(o.checked), held: ints(o.held) };
    }
    const held = new Set(Array.isArray(o.held) ? o.held.map(Number) : []);
    const known = ['main'].concat(Object.keys(store.servers || {}), Object.keys(store.sent));
    const refused = new Set();
    for (const pid of Object.keys(marks)) {
      const m = marks[pid];
      if (!m || typeof m !== 'object') { delete marks[pid]; continue; }
      if (stale(pid) && (who[pid] || held.has(Number(pid)))) { refused.add(pid); continue; }
      const clear = Array.isArray(m.clear) ? m.clear.map(String) : [];
      if (clear.indexOf(srv) < 0) clear.push(srv);
      m.clear = clear;
      if (known.every((s) => clear.indexOf(s) >= 0)) delete marks[pid];
    }
    if (Object.keys(marks).length) store.deleted = marks; else delete store.deleted;
    let n = 0;
    for (const pid of Object.keys(who)) {
      if (!/^\d+$/.test(pid) || refused.has(pid)) continue;
      const row = who[pid];
      if (!row || typeof row !== 'object') continue;
      store.who[pid] = {
        name: String(row.name || '').slice(0, 64), race: String(row.race || '').slice(0, 32),
        female: !!row.female, trade: String(row.trade || '').slice(0, 32),
        town: String(row.town || '').slice(0, 32), where: String(row.where || '').slice(0, 80),
        at: Number(row.at) || Date.now()
      };
      n++;
    }
    store.at = Date.now();
    putJson(ROSTER, store);
    return sendJson(res, 200, { ok: true, merged: n, total: Object.keys(store.who).length });
  }

  /*
    A game server's hold economy count (#3164), whole, with the door key, the
    roster's way: the dev server's door names the site with /dev, so its count
    comes in on /dev/api/economy and is kept apart from main's.
  */
  if ((route === '/api/economy' || route === '/dev/api/economy') && req.method === 'POST') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    let o = {};
    try { o = JSON.parse(await body(req, 4 * 1024 * 1024)) || {}; } catch (e) { passBodyFailure(e); }
    if (!sameSecret(String(o.key || ''), String(cfg.botKey))) return sendJson(res, 401, { error: 'no' });
    const srv = (String(o.server || '') === 'dev' || route.indexOf('/dev/') === 0) ? 'dev' : 'main';
    const now = Date.now();
    const kept = cleanEconomy(Object.assign({}, o, { at: now }), now);
    const store = jsonFile(ECONOMY, { servers: {} });
    const servers = (store && store.servers && typeof store.servers === 'object') ? store.servers : {};
    servers[srv] = kept;
    for (const other of Object.keys(servers)) {
      if (other !== srv) servers[other] = cleanEconomy(servers[other], now);
    }
    if (!putJson(ECONOMY, { servers })) return sendJson(res, 500, { error: 'could not save' });
    return sendJson(res, 200, { ok: true, server: srv, days: Object.keys(kept.days).length });
  }

  if (p === '/api/play/roster' && req.method === 'POST') {
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 401, { ok: false, why: 'link' });
    const linked = jsonFile(LINKED, {});
    const mine = ((linked[t.d] || {}).profiles || []).map(Number).filter((x) => x > 0);
    const store = jsonFile(ROSTER, { who: {} });
    const rows = {};
    for (const pid of mine) {
      const row = store.who && store.who[String(pid)];
      if (row) rows[String(pid)] = row;
    }
    /* This account's characters that the asking launcher's server looked up
       and does not hold (#955), from its last report if that is recent. The
       launcher marks them on the menu; it trusts the answer only for a
       character last played before goneAt. */
    const srv = String(o.channel || '') === 'dev' ? 'dev' : 'main';
    const rep = store.servers && store.servers[srv];
    let gone = [], goneAt = 0;
    if (rep && Array.isArray(rep.checked) && Array.isArray(rep.held) &&
        Date.now() - (Number(rep.at) || 0) < ROSTER_HELD_FRESH_MS) {
      const looked = new Set(rep.checked.map(Number));
      const held = new Set(rep.held.map(Number));
      gone = mine.filter((pid) => looked.has(pid) && !held.has(pid));
      goneAt = Number(rep.at) || 0;
    }
    /* This account's characters staff have killed for good, and the ones
       under a ban of their own (#1010). The launcher's menu shows a dead one
       in no slot, so the account can make a new character, and neither can
       be picked. Only the ids: why and who are staff's. */
    const now = Date.now();
    const pk = [], barred = [];
    for (const pid of mine) {
      const bar = characterBar(pid, now);
      if (bar && bar.pk) pk.push(pid);
      else if (bar) barred.push(pid);
    }
    /* And the ones an admin brought back from a PK (#1010), so the launcher
       puts a character it had moved out of its slots back into a free one. */
    const pkRows = jsonFile(PK, {}) || {};
    const revived = mine.filter((pid) => pkRows[String(pid)] && !pkActive(pkRows[String(pid)]));
    return sendJson(res, 200, { ok: true, rows, gone, goneAt, pk, banned: barred, revived });
  }

  /*
    What the game server's door asks for, every five minutes, with the bot key:
    the profile ids of everyone currently allowed in. Everyone who has ever
    checked in through the launcher is re-asked of Discord, so leaving the
    server or picking up the Banned role drops their numbers off the list
    within a refresh. If any lookup failed the answer says so and names the
    profiles it could not check in failedProfiles, and the door keeps those
    as they were, because a short list built while Discord was down would
    turn away everybody missing from it.

    devProfiles rides along in the same answer: the subset of the same people
    who also hold the dev or admin role, whichever server they connect to.
    st.dev already folds admin in (out.dev = out.admin || has(cfg.access.dev)
    up in standing()), so this is free, and it is what lets the game server
    tell a tester apart from anybody else without a second question to Discord
    for every command somebody types.
  */
  /* Whether the files play and identity rest on read (#2180): 200, or 503
     naming each one that is there and will not read, and whether it shuts
     play. Deploy-Docs asks it after every swap. Names and reasons only,
     never what a file holds. */
  if (route === '/api/ready' && req.method === 'GET') {
    const broken = heldBroken();
    return sendJson(res, broken.length ? 503 : 200, { ok: !broken.length, broken });
  }
  // The dev server's door.json names the site as https://thornswood.net/dev,
  // so its question lands here and gets only the people the dev build is
  // for. Same key, same shape, shorter list.
  const devDoor = (route === '/dev/api/allowed');
  if ((route === '/api/allowed' || devDoor) && req.method === 'GET') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    // The key comes in the X-Thornswood-Key header. In the address it was
    // written down by anything that logs a request line, this site's own
    // failed() included. Entry 248. The address form stays for one release,
    // for a game server still running a gamemode from before 24 September,
    // and only when there is no header at all; keyInAddress says when a door
    // still uses it.
    const inHeader = req.headers['x-thornswood-key'];
    const given = inHeader !== undefined ? inHeader : (url.searchParams.get('key') || '');
    if (!sameSecret(String(given), String(cfg.botKey))) {
      return sendJson(res, 401, { error: 'no' });
    }
    if (inHeader === undefined && !keyInAddress.has(route)) {
      keyInAddress.add(route);
      console.log('[thornswood-docs] ' + route + ' answered a door that sent its key in ' +
                  'the address, so that game server runs a gamemode from before 24 ' +
                  'September. The address form goes once no door says this.');
    }
    const linked = jsonFile(LINKED, {});
    const out = { profiles: [], devProfiles: [], adminProfiles: [], offices: {}, jarlClash: [], staffRoleProfiles: [], businessOwnerProfiles: [], factionLeaderProfiles: {}, factionLeaderClash: [], devRoleProfiles: [], companyProfiles: [], people: [], lookupFailed: false, lookupFailedWhy: '', failedProfiles: [], at: Date.now() };
    const seen = new Set();
    const seenDev = new Set();
    const seenAdmin = new Set();
    const seenStaffRole = new Set();
    const seenBusiness = new Set();
    // Leader role -> account -> that account's profiles, so a Leader role two
    // accounts hold can come off both below.
    const leaderAccounts = new Map();
    const seenDevRole = new Set();
    const seenCompany = new Set();
    const seenFailed = new Set();
    const hasProfiles = (d) => (Array.isArray((linked[d] || {}).profiles) ? linked[d].profiles : [])
      .map(Number).some((n) => n > 0);
    const answers = await standingsForDoor(Object.keys(linked).filter(hasProfiles));
    for (const d of Object.keys(linked)) {
      const row = linked[d] || {};
      const profiles = (Array.isArray(row.profiles) ? row.profiles : [])
        .map(Number).filter((n) => n > 0);
      if (!profiles.length) continue;
      const st = answers.get(d) || { lookupFailed: 'not asked' };
      if (st.lookupFailed) {
        /* WHY, NOT JUST THAT. This reduced a specific reason to a boolean, so
           the game server could only ever say "the site could not reach
           Discord" and the door log on 22 September said exactly that and no
           more. discordGet already works the reason out in plain words: a
           wrong token, a bot that may not read members, a rate limit, no token
           at all. Those are four different fixes and the difference was being
           thrown away one line after it was known. The first one seen is
           enough; a list where every lookup fails fails for one reason. */
        out.lookupFailed = true;
        if (!out.lookupFailedWhy) { out.lookupFailedWhy = String(st.lookupFailed); }
        /* AND WHOSE. lookupFailed alone makes one rate limited lookup throw
           the whole list away, so the door kept a stale list for everybody
           because one person could not be checked. Naming the profiles lets a
           door that knows this field keep just those as they were and take
           everybody else's fresh answer. lookupFailed and lookupFailedWhy stay
           exactly as they were, so a door older than this still keeps the
           whole list, which is what it did before. */
        for (const n of profiles) if (!seenFailed.has(n)) { seenFailed.add(n); out.failedProfiles.push(n); }
        continue;
      }
      if (!st.play || st.banned) continue;
      if (devDoor && !st.devBuild) continue;
      for (const n of profiles) if (!seen.has(n)) { seen.add(n); out.profiles.push(n); }
      if (st.dev) {
        for (const n of profiles) if (!seenDev.has(n)) { seenDev.add(n); out.devProfiles.push(n); }
      }
      // The admin roles (access.admin: Owner and Dev unless config.json says
      // otherwise), so the game server can hold an Owner's new character to
      // the same standing as the one profile number in its own settings.
      if (st.admin) {
        for (const n of profiles) if (!seenAdmin.has(n)) { seenAdmin.add(n); out.adminProfiles.push(n); }
      }
      // A Discord staff role itself, not the hand written admins list, for
      // the staff seats over the most the world holds (#481).
      if (st.staffRole) {
        for (const n of profiles) if (!seenStaffRole.has(n)) { seenStaffRole.add(n); out.staffRoleProfiles.push(n); }
      }
      if (st.businessOwner) {
        for (const n of profiles) if (!seenBusiness.has(n)) { seenBusiness.add(n); out.businessOwnerProfiles.push(n); }
      }
      for (const role of (st.leads || [])) {
        if (!leaderAccounts.has(role)) leaderAccounts.set(role, new Map());
        leaderAccounts.get(role).set(String(d), profiles);
      }
      if (st.devRole) {
        for (const n of profiles) if (!seenDevRole.has(n)) { seenDevRole.add(n); out.devRoleProfiles.push(n); }
      }
      // The trading company's role (#1393), for a company sale in the game.
      if (st.company) {
        for (const n of profiles) if (!seenCompany.has(n)) { seenCompany.add(n); out.companyProfiles.push(n); }
      }
      out.people.push({ id: String(d), name: st.name || row.name || '', profiles });
    }
    /* THE HOLD OFFICES (#2551), by profile, for every account let in above
       (out.people), read from its roles: the game reads every office through
       this and nothing else. And one Jarl a hold: a hold's Jarl role two
       accounts hold comes off both, and staff are told (officesForDoor). */
    out.jarlClash = await officesForDoor(out, answers, linked);
    /* THE FACTION BOOKS (#3317): each faction's Leader role and the profiles
       of the account that holds it. One Leader a faction, like one Jarl a
       hold: a Leader role two accounts hold goes to neither, so the book
       stays with nobody new until staff fix it, and the bot's faction panel
       refuses both the same way (bot.py leader_held_twice). */
    for (const [role, accounts] of leaderAccounts) {
      if (accounts.size > 1) { out.factionLeaderClash.push(role); continue; }
      for (const pl of accounts.values()) out.factionLeaderProfiles[role] = pl.slice();
    }
    /* STAFF BANS (#412), which are this site's own file and need no Discord.
       Every profile under an active ban is left out of every list, including
       a profile no account holds and one Discord could not be asked about,
       and the bans go to the door with why and until, so the game server can
       end the session of anybody banned who is online and tell them both. */
    out.bans = activeBans(Date.now());
    /* And every character staff have killed for good (#1010), left out the
       same way and sent as pk, so the game server ends it quietly if it is
       in the world. */
    out.pk = pkProfiles();
    // A broken ban list lets nobody through the door (#2186), and so does a
    // pk.json or linked.json that will not read (#2180): every list is
    // emptied and the door is told why.
    const shut = out.bans.broken || out.pk.broken;
    if (shut) {
      out.bansBroken = !!out.bans.broken;
      out.stateBroken = shut;
      for (const k of ['profiles', 'devProfiles', 'adminProfiles', 'staffRoleProfiles', 'failedProfiles']) {
        if (Array.isArray(out[k])) out[k] = [];
      }
      if (Array.isArray(out.people)) out.people = [];
      out.offices = {};
      out.factionLeaderProfiles = {};
    }
    const barred = new Set(out.pk);
    for (const b of out.bans) for (const n of b.profiles) barred.add(Number(n));
    if (barred.size) {
      for (const k of ['profiles', 'devProfiles', 'adminProfiles', 'staffRoleProfiles', 'failedProfiles']) {
        out[k] = out[k].filter((n) => !barred.has(Number(n)));
      }
      for (const n of Object.keys(out.offices)) if (barred.has(Number(n))) delete out.offices[n];
      for (const k of ['businessOwnerProfiles', 'devRoleProfiles', 'companyProfiles']) {
        out[k] = out[k].filter((n) => !barred.has(Number(n)));
      }
      for (const role of Object.keys(out.factionLeaderProfiles)) {
        out.factionLeaderProfiles[role] = out.factionLeaderProfiles[role].filter((n) => !barred.has(Number(n)));
        if (!out.factionLeaderProfiles[role].length) delete out.factionLeaderProfiles[role];
      }
      out.people = out.people.map((p) => Object.assign({}, p, { profiles: p.profiles.filter((n) => !barred.has(Number(n))) }))
        .filter((p) => p.profiles.length);
    }
    return sendJson(res, 200, out);
  }

  /*
    A Jarl's office change, from the game (#2551): the Office page of K, sent
    by the game server with the door's key, the same key /api/allowed takes,
    in the same header. Only a game server can ask. changeOffice checks every
    rule again and sets the role in Discord; the game reads it back through
    /api/allowed. The dev server's door names the site with /dev, so its
    question lands on /dev/api/office: the roles are the same Discord's, so a
    change made on dev is a real role.
  */
  if ((route === '/api/office' || route === '/dev/api/office') && req.method === 'POST') {
    if (!cfg.botKey) return sendJson(res, 404, { error: 'not set up' });
    const given = req.headers['x-thornswood-key'];
    if (given === undefined || !sameSecret(String(given), String(cfg.botKey))) {
      return sendJson(res, 401, { error: 'no' });
    }
    let o = {};
    try { o = JSON.parse(await body(req, 4096)) || {}; } catch (e) {
      return sendJson(res, 400, { ok: false, said: 'The site could not read that request.' });
    }
    return sendJson(res, 200, await changeOffice(o, route === '/dev/api/office' ? 'dev' : 'main'));
  }

  /*
    Does this ticket own this profile number?

    The voice service asks, because /choose cannot be locked to the loopback:
    every person's launcher posts their character creation choice to it from
    their own machine. Without an answer here it took anybody's word for
    anything, and a stranger could set your profession, your half and your
    home town before you ever claimed them.

    This route did not exist. voice-server.js has been posting here since it
    was written, every call fell through to the sign in gate below and came
    back 401, owns() reads anything that is not a 200 as "unchecked", and the
    service stored the choice anyway and logged UNVERIFIED. So the check has
    never once run, and the ticket the launcher sends to the voice port in
    clear was being spent on nothing.

    Claimed, not registered. A profile number that nobody has ever checked in
    with belongs to whoever asks for it first, which is the launcher that just
    made the character: refusing those would break character creation for
    every new character, which is the one case this runs in. A number already
    against somebody else's Discord account is theirs, and that is the case
    worth refusing, unless that account has left the Discord without being
    banned: see hasLeft.
  */
  if (p === '/api/play/owns' && req.method === 'POST') {
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 200, { ok: false, why: 'ticket' });
    const pid = Number(o.profileId) || 0;
    if (pid <= 0) return sendJson(res, 200, { ok: false, why: 'profile' });

    // Still has to be somebody who is allowed in at all. A ticket from an
    // account that has been banned or has left owns nothing.
    const st = await standingCached(t.d);
    /*
      Could not ask Discord is not the same answer as not allowed.

      standing() leaves play false on any lookup that failed, and sets
      lookupFailed to say why, because a 404 is the only failure that really
      means "not in the server". Answering 200 with ok false here would turn a
      Discord outage into every new character being refused their profession
      and home town, and voice-server.js reads a non-200 as unchecked and
      stores the choice anyway, which is exactly the behaviour a failed lookup
      should get. /api/allowed a few routes down already does this.
    */
    if (st.lookupFailed) {
      return sendJson(res, 503, { ok: false, why: 'could not ask Discord' });
    }
    if (!st.play || st.banned) return sendJson(res, 200, { ok: false, why: 'role' });

    const linked = jsonFile(LINKED, {});
    const mine = (linked[t.d] && Array.isArray(linked[t.d].profiles))
      ? linked[t.d].profiles.map(Number) : [];
    if (mine.indexOf(pid) >= 0) return sendJson(res, 200, { ok: true, why: 'theirs' });

    // The same rule /api/play/join keeps: an account that has left the
    // Discord and is not banned (hasLeft) holds nothing, so somebody whose
    // old account has gone has voice on their characters before their next
    // Play moves the ids across.
    const left = await departed(linked, pid, t.d);
    let gone = false;
    for (const d of Object.keys(linked)) {
      if (String(d) === String(t.d)) continue;
      const theirs = (linked[d] && Array.isArray(linked[d].profiles))
        ? linked[d].profiles.map(Number) : [];
      if (theirs.indexOf(pid) < 0) continue;
      if (left.has(String(d))) { gone = true; continue; }
      return sendJson(res, 200, { ok: false, why: 'somebody else' });
    }
    if (gone) return sendJson(res, 200, { ok: true, why: 'left' });
    // Nobody has it. The launcher that just made the character is the one
    // asking, and it checks in with this number a moment later anyway.
    return sendJson(res, 200, { ok: true, why: 'unclaimed' });
  }

  /*
    A join pass for one character (#937; the format is over makePass).

    The launcher asks when a character is picked at the game's menu and again
    every four minutes while the game runs. Every no names what to do, because
    the launcher shows the message as it stands.

    REFUSED, NOT GUESSED, whenever this cannot be sure: no key, a feed it cannot
    read, a launcher version that is not a version, or Discord not answering
    (the hand written admin list aside, as at /api/play/join). A refusal here
    means that session is ended by the game server, which is the point.

    THE VERSION IS THE LAUNCHER'S OWN WORD, checked against what the channel
    published: a Velopack number only when its Release is out on GitHub with
    the channel's Velopack feed on it (nativePublished, #4825), and a launcher
    from before Velopack only while the channel has no Velopack setup program
    out, inside the update feed's minLauncher to launcherVersion as before.
    So an old launcher cannot get in, and neither can a request that simply
    claims to be a new one. A person who writes their own request with their own ticket gets a
    pass only for their own characters, which is all the game server lets it
    prove.

    WHOSE CHARACTER, the rule /api/play/owns keeps: the caller's own, one that
    nobody holds yet (the launcher checks every id in at Play), or one held only
    by an account that has left the Discord. Somebody else's is refused.
  */
  if (p === '/api/play/pass' && req.method === 'POST') {
    const by = Date.now() + PLAY_ANSWER_MS;
    let o = {};
    try { o = JSON.parse(await body(req, 8192, PLAY_BODY_MS)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 401, { ok: false, why: 'link', message:
      'This copy is not linked to a Discord account yet.' });
    const pid = Number(o.profileId) || 0;
    if (!(pid > 0) || Math.floor(pid) !== pid) return sendJson(res, 400, { ok: false, why: 'profile', message:
      'No character was named.' });
    const server = String(o.channel || '') === 'dev' ? 'dev' : 'main';
    if (!cfg.passKey) return sendJson(res, 503, { ok: false, why: 'no key', message:
      'Thornswood cannot let anybody into the game right now. Tell Patrick.' });

    const said = String(o.version == null ? '' : o.version).trim().slice(0, 40);
    const have = versionParts(said);
    const setup = newestSetup(server);
    if (nativeTag(server, said)) {
      const out = await within(nativePublished(server, said), by - Date.now(), () => 'unknown');
      if (out === 'unknown') return sendJson(res, 503, { ok: false, why: 'releases', message:
        'Thornswood could not check this launcher with GitHub just now. Try again in a minute.' });
      if (out !== 'yes') return sendJson(res, 403, { ok: false, why: 'unknown launcher', message:
        'This launcher says it is ' + said + ', which Thornswood never published. ' +
        'Install the launcher from thornswood.net/downloads, then press Play again.' });
    } else if (setup) {
      return sendJson(res, 403, { ok: false, why: 'update', message:
        'Thornswood has a new launcher, and this one (' + (said || 'too old to say') + ') cannot update itself to it. ' +
        'Install it once from thornswood.net/downloads, then press Play again.' });
    } else {
      const feed = feedLaunchers(server);
      if (!feed) return sendJson(res, 503, { ok: false, why: 'feed', message:
        'Thornswood could not read its own update feed just now. Try again in a minute.' });
      if (!have || versionCompare(have, versionParts(feed.min)) < 0) {
        return sendJson(res, 403, { ok: false, why: 'update', need: feed.min, message:
          'This launcher is ' + (said || 'too old to say') + ' and Thornswood needs ' + feed.min +
          ' or newer. Update the launcher, then press Play again.' });
      }
      if (versionCompare(have, versionParts(feed.current)) > 0) {
        return sendJson(res, 403, { ok: false, why: 'unknown launcher', need: feed.current, message:
          'This launcher says it is ' + said + ', which Thornswood never published. ' +
          'Install the launcher from thornswood.net, then press Play again.' });
      }
    }

    const st = await within(standingCached(t.d), by - Date.now(), () => standingLate(t.d));
    if (st.lookupFailed && !st.admin) return sendJson(res, 503, discordUnasked());
    // Banned before the guild, as at /api/play/join (#1010).
    if (st.banned) return sendJson(res, 403, { ok: false, why: 'banned', message: accountBanned(st) });
    if (!st.inGuild) return sendJson(res, 403, { ok: false, why: 'guild', message:
      'That Discord account is not in the Thornswood Discord.' });
    if (!st.play) return sendJson(res, 403, { ok: false, why: 'role', message:
      notAcceptedYet() });
    if (server === 'dev' && !st.devBuild) return sendJson(res, 403, { ok: false, why: 'dev', message:
      'The dev build is for the ' + andList(cfg.access.devBuild) + ' roles. Play on the main build.' });

    const linked = jsonFile(LINKED, {});
    const mine = (linked[t.d] && Array.isArray(linked[t.d].profiles))
      ? linked[t.d].profiles.map(Number) : [];
    if (mine.indexOf(pid) < 0) {
      const left = await departed(linked, pid, t.d, by);
      for (const d of Object.keys(linked)) {
        if (String(d) === String(t.d)) continue;
        const theirs = (linked[d] && Array.isArray(linked[d].profiles))
          ? linked[d].profiles.map(Number) : [];
        if (theirs.indexOf(pid) < 0 || left.has(String(d))) continue;
        console.log('[thornswood-docs] no join pass for profile ' + pid + ' to Discord ' + t.d +
                    ': it is held by Discord ' + d);
        return sendJson(res, 403, { ok: false, why: 'somebody else', message:
          'That character belongs to another Discord account.' });
      }
    }

    const now = Date.now();
    /* This one character (#1010): killed for good by staff, or banned by
       itself. The account is fine, so the answer says to pick another. */
    const bar = characterBar(pid, now);
    if (bar && bar.shut) return sendJson(res, 503, { ok: false, why: 'state broken', message:
      'The site cannot read its list of characters right now, so nobody can join until staff repair it. Try again later.' });
    if (bar && bar.pk) return sendJson(res, 403, { ok: false, why: 'pk', message:
      'That character has died for good and cannot be played again. ' +
      'Pick another character at the menu, or make a new one.' });
    if (bar) return sendJson(res, 403, { ok: false, why: 'banned character', until: bar.until, message:
      'Staff have banned that character ' + banUntilText(bar.until) +
      (bar.why ? ': ' + bar.why : '') + '. Pick another character at the menu.' });
    const pass = makePass(cfg.passKey, { p: pid, s: server, v: said, d: String(t.d), i: now, x: now + PASS_MS });
    return sendJson(res, 200, { ok: true, pass: pass, key: passLoginKey(cfg.passKey, pass), until: now + PASS_MS, server: server });
  }

  // The same question without asking for the password, for the launcher to
  // show who it is linked as without pretending it is about to connect.
  if (p === '/api/play/who' && req.method === 'POST') {
    const by = Date.now() + PLAY_ANSWER_MS;
    let o = {};
    try { o = JSON.parse(await body(req, 8192)) || {}; } catch (e) { passBodyFailure(e); }
    const t = readTicket(o.ticket);
    if (!t) return sendJson(res, 401, { ok:false, why:'link' });
    const st = await within(standingCached(t.d), by - Date.now(), () => standingLate(t.d));
    if (st.lookupFailed && !st.admin) return sendJson(res, 503, discordUnasked());
    return sendJson(res, st.play && !st.banned ? 200 : 403, {
      ok: st.play && !st.banned, id: st.id, name: st.name || t.n,
      admin: st.admin, dev: !!st.dev, banned: st.banned, inGuild: st.inGuild, roles: st.roles
    });
  }

  // ------------------------------------------------------------------- api
  if (p.startsWith('/api/')) {
    // Staff as well as hub members, so the Gallery page can boot (#742). What
    // they get is still decided by LEVEL below: for staff who are not admins
    // that is the pages marked 'staff' and nothing else.
    // A staff POST from the hub already stopped waiting on Discord (#1164).
    // Not being staff because Discord did not answer is not 'sign in first'.
    if (req.method !== 'GET' && w.id && w.lookupFailed && !w.admin) return sendJson(res, 503, discordUnasked());
    if (!w.member && !w.dev) return sendJson(res, 401, { error: 'sign in first' });

    if (p === '/api/all' && req.method === 'GET') {
      const docs = {}, boards = {};
      for (const n of Object.keys(DOCS))   if (allowed(n, w)) docs[n]   = readDoc(n);
      const all = readBoard();
      const boardRevs = {};
      for (const n of Object.keys(BOARDS)) if (allowed(n, w)) { boards[n] = all[n] || { intro:'', sections:[] }; boardRevs[n] = boardRev(all, n); }
      return sendJson(res, 200, {
        me: w,
        titles: Object.assign({}, DOCS, BOARDS),
        level: LEVEL,
        docs, boards, boardRevs,
        // Member and admin material, held back from staff who are neither.
        // They are here for the Gallery page, which reads none of these: the
        // queue and the live list are their own doors.
        results: w.member ? jsonFile(RESULTS, {}) : {},
        files: w.member ? listFiles() : [],
        uploads: w.member ? listUploads() : [],
        news: jsonFile(NEWS, { launcher:'', news: [] }),
        invite: cfg.discord.invite || '',
        // The Linked accounts page is every staff role's since #1010 (Patrick,
        // 28 September: all staff can ban and PK, and the site's staff pages
        // can do it), so the accounts and the records go to staff (w.dev,
        // which folds admin in). Notes, bans and PKs are staff's to read and
        // nobody else's: a hub member without a staff role gets none.
        linked: w.dev ? Object.values(jsonFile(LINKED, {})) : [],
        records: w.dev ? staffRecords(Date.now()) : { bans: {}, notes: {}, pk: {}, names: {} },
        sessions: w.admin ? sessionRows() : [],
        inbox: w.admin ? trimInbox(jsonFile(INBOX, []), Date.now()) : []
      });
    }

    /* The hub's Hold economy page (#3164): staff, the same as the page. */
    if (p === '/api/economy' && req.method === 'GET') {
      if (!w.dev) return sendJson(res, 403, { error: 'staff only' });
      return sendJson(res, 200, { keepDays: ECONOMY_KEEP_DAYS, servers: economyNow(Date.now()) });
    }

    if (p === '/api/results' && req.method === 'PUT') {
      // A hub door, not a staff one: the gate above now lets staff in as far
      // as the pages LEVEL marks 'staff', and this writes the test marks.
      if (!w.member) return sendJson(res, 403, { error: 'hub members only' });
      let obj;
      try { obj = JSON.parse(await body(req)); }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      if (!putJson(RESULTS, obj)) return sendJson(res, 500, { error: 'could not save' });
      return sendJson(res, 200, { ok: true });
    }

    /*
      Bans and notes from the hub (#412), for staff (the access.dev roles).
      Keyed by Discord id, the rows the Linked accounts page lists. Staff only
      to read, because a note is staff's view of a person. What is done here
      goes to moderation.log for the bot to say in the staff channel; the
      game's /ban and /note are said from the game server's own log.
    */
    if (p === '/api/staff/records' && req.method === 'GET') {
      if (!w.dev) return sendJson(res, 403, { error: 'staff only' });
      return sendJson(res, 200, staffRecords(Date.now()));
    }

    /*
      Which commit each part on this box runs (#459), for staff (#1359).

      It sat above with /api/public, open to anybody, because a commit, a zip
      name and a hash were read as telling a stranger nothing. They tell a
      stranger plenty: the commit says which source is live to the hour, and
      the stamp says when each part last went out, which is what somebody
      looking for a way in reads first. Nothing in the repo fetches it and no
      page draws it, so the only caller is a person asking what is deployed.
      That person signs in.

      The same gate as the other staff doors, so widening access.dev widens
      this with them: the block above answers 401 'sign in first' to anybody
      with neither cookie, and a hub member who is not staff gets the 403
      'staff only' every staff door sends. No record is read before the
      refusal, so nothing leaks in the body or the timing.
    */
    if (p === '/api/deploys' && req.method === 'GET') {
      if (!w.dev) return sendJson(res, 403, { error: 'staff only' });
      return sendJson(res, 200, { parts: readDeploys(DEPLOYS_DIR) });
    }

    /*
      One character or the whole account (#1010). With a profileId (one of
      this account's characters) ban and unban are that character alone and
      pk kills it for good; without one, ban and unban are the account, every
      character on it and any new one. Staff may do these to staff, but not
      to their own account: a ban would lock them out of the page that lifts
      it.
    */
    const staffHub = /^\/api\/staff\/(ban|unban|note|pk|unpk)$/.exec(p);
    if (staffHub && req.method === 'POST') {
      if (!w.dev) return sendJson(res, 403, { error: 'staff only' });
      // Undoing a PK is the admin role's alone (Patrick, 29 September).
      if (staffHub[1] === 'unpk' && !w.admin) {
        return sendJson(res, 403, { error: 'admins only', message: 'Only an admin can undo a PK.' });
      }
      let o;
      try { o = JSON.parse(await body(req, 8000)) || {}; }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      const id = String(o.id || '').trim();
      const linked = jsonFile(LINKED, {});
      if (!/^\d{5,25}$/.test(id) || !linked[id]) return sendJson(res, 404, { error: 'nobody linked with that id' });
      const whoName = String(linked[id].name || linked[id].handle || '').slice(0, 60);
      const profiles = (Array.isArray(linked[id].profiles) ? linked[id].profiles : []).map(Number).filter((n) => n > 0);
      const now = Date.now();
      const act = staffHub[1];
      const pid = Number(o.profileId) || 0;
      if (pid && profiles.indexOf(pid) < 0) return sendJson(res, 404, { error: 'that character is not on this account' });
      if ((act === 'pk' || act === 'unpk') && !pid) return sendJson(res, 400, { error: 'a PK names the character' });
      if ((act === 'ban' || act === 'pk') && String(w.id) === id) {
        return sendJson(res, 400, { error: 'that is your own account' });
      }
      const charName = pid ? String(((jsonFile(ROSTER, { who: {} }).who || {})[String(pid)] || {}).name || '').slice(0, 60) : '';
      const whoChar = pid ? (charName ? charName + ' (' + whoName + ')' : whoName) : whoName;
      if (act === 'ban') {
        const why = String(o.why || '').trim().slice(0, 500);
        if (!why) return sendJson(res, 400, { error: 'a ban says why' });
        const minutes = banMinutes(o.minutes);
        const until = minutes ? now + minutes * 60000 : 0;
        const row = { at: now, until, why, by: w.name, byId: w.id, from: 'the hub', account: id };
        const ok = pid
          ? putBan('p:' + pid, Object.assign(row, { name: charName || whoName, profiles: [pid], scope: 'character' }))
          : putBan(id, Object.assign(row, { name: whoName, profiles, scope: 'account' }));
        if (!ok) return sendJson(res, 500, { error: 'could not save' });
        const said = banUntilText(until) + ': ' + why;
        if (pid) modLog({ did: 'ban', byName: w.name, whoName: whoChar, who: pid, why: said });
        else modLog({ did: 'banaccount', byName: w.name, whoName: whoChar, why: said });
        return sendJson(res, 200, { ok: true, until, account: !pid });
      }
      if (act === 'unban') {
        const r = dropBan([pid ? 'p:' + pid : id]);
        if (!r.ok) return sendJson(res, 500, { error: 'could not save' });
        if (r.was && pid) modLog({ did: 'unban', byName: w.name, whoName: whoChar, who: pid });
        else if (r.was) modLog({ did: 'unbanaccount', byName: w.name, whoName: whoChar });
        return sendJson(res, 200, { ok: true, was: r.was });
      }
      if (act === 'pk') {
        const why = String(o.why || '').trim().slice(0, 500);
        if (!why) return sendJson(res, 400, { error: 'a PK says why' });
        const had = jsonFile(PK, {})[String(pid)];
        if (pkActive(had)) return sendJson(res, 200, { ok: true, was: true, at: Number(had.at) || 0 });
        if (!putPk(pid, { at: now, by: w.name, byId: w.id, why, name: charName, account: id, from: 'the hub' })) {
          return sendJson(res, 500, { error: 'could not save' });
        }
        modLog({ did: 'pk', byName: w.name, whoName: whoChar, who: pid, why });
        return sendJson(res, 200, { ok: true, was: false, at: now });
      }
      if (act === 'unpk') {
        const why = String(o.why || '').trim().slice(0, 500);
        if (!why) return sendJson(res, 400, { error: 'an undo says why', message: 'Say why the PK is undone.' });
        const u = await undoPk(pid, w.name, w.id, why, 'the hub');
        if (u.body.ok && u.body.was) {
          const deadName = String(u.body.name || '') || charName;
          modLog({ did: 'unpk', byName: w.name, whoName: deadName ? deadName + ' (' + whoName + ')' : whoName, who: pid, why });
        }
        return sendJson(res, u.status, u.body);
      }
      const text = String(o.text || '').trim().slice(0, 1000);
      if (!text) return sendJson(res, 400, { error: 'a note says something' });
      if (!putNote(id, { at: now, by: w.name, byId: w.id, text, profileId: 0, name: whoName, from: 'the hub' })) {
        return sendJson(res, 500, { error: 'could not save' });
      }
      modLog({ did: 'note', byName: w.name, whoName, why: text });
      return sendJson(res, 200, { ok: true });
    }

    // ------------------------------------------------------- admins only --
    if (!w.admin) return sendJson(res, 403, { error: 'admins only' });

    const md = p.match(/^\/api\/doc\/([a-z]+)$/);
    if (md && req.method === 'PUT') {
      if (!writeDoc(md[1], await body(req))) return sendJson(res, 400, { error: 'no such doc' });
      return sendJson(res, 200, { ok: true });
    }

    const mb = p.match(/^\/api\/board\/([a-z]+)$/);
    if (mb && req.method === 'PUT') {
      let obj;
      try { obj = JSON.parse(await body(req)); }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      const saved = writeBoardOne(mb[1], obj, req.headers['x-board-rev']);
      if (!saved.ok) {
        if (saved.status === 409) console.warn('board ' + mb[1] + ': a save from revision ' + req.headers['x-board-rev'] + ' was refused, the board is at ' + saved.rev);
        return sendJson(res, saved.status, { error: saved.error, message: saved.message, rev: saved.rev });
      }
      return sendJson(res, 200, { ok: true, rev: saved.rev });
    }

    /* Everything from one session, for the View more button on /sessions.
       Admins only, like everything below the line above.

       The client half is what the launcher sent when the game closed. The
       server half is sliced out of the game server's own log now, by this
       session's start and end, rather than having been copied anywhere. A
       session still open has no end yet, so the slice runs to now.

       The row is found by the session id AND the Discord id it belongs to, so
       a stray id cannot read somebody else's session. */
    if (p === '/api/session-logs' && req.method === 'GET') {
      const key = sessionKey(url.searchParams.get('session'));
      const rows = sessionRows();
      const at = key ? findSession(rows, key, url.searchParams.get('who')) : -1;
      if (at < 0) return sendJson(res, 404, { error: 'no such session' });
      const row = rows[at];

      let client = {};
      let sent = null;
      let keptChat = null;
      try {
        const f = slogFile(key);
        if (fs.existsSync(f)) {
          const set = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
          client = set.logs || {};
          if (row.keep && isObjectLike(set.chat) && Array.isArray(set.chat.lines)) keptChat = set.chat;
          /* The provenance, so the page can show where this came from and
             whether anybody tried to send a second set over it. A set that
             holds only a kept session's chat was not sent by anybody. */
          if (!set.chatOnly) sent = {
            who: String(set.who || ''),
            at: Number(set.at) || 0,
            bytes: Number(set.bytes) || 0,
            sha256: set.sha256 || {},
            resent: Number(set.resent) || 0
          };
        }
      } catch (e) { client = {}; sent = null; }

      /* A minute either side, because the launcher stamps the session and the
         server stamps its own lines, and the two clocks are the same clock but
         the moments are not: the start is sent as the game launches and the
         server sees the connection a little after. */
      const { from, to } = sessionWindow(row);
      const server = serverLogSlice(row.channel, from, to);
      /* A kept session's chat is its copy (#2166), which outlives the voice
         service's day files; otherwise the day files, read now. */
      const chat = keptChat ? { why: '', lines: keptChat.lines } : chatSlice(row.profile, from, to, row.channel);

      return sendJson(res, 200, {
        session: key,
        channel: row.channel,
        client,
        sent,
        /* What they said, in this session only. The page shows it beside the
           logs rather than on a page of its own. */
        chat: chat.lines,
        chatWhy: chat.why,
        chatKept: !!keptChat,
        chatCopiedAt: keptChat ? Number(keptChat.copiedAt) || 0 : 0,
        /* Whether this one is held past the retention rule, so the button
           beside the provenance shows the right state. */
        keep: !!row.keep,
        keptBy: String(row.keptBy || ''),
        server: server.lines,
        serverWhy: server.ok ? '' : server.why,
        clientSent: Object.keys(client).length > 0
      });
    }

    /* /api/chat was here: the whole chat log, a day at a time, for everybody
       at once, behind a page of its own. It is gone, and so is that page.
       Answering "what did this person do" meant reading a session on one page,
       working out when it ran, then going to another page, picking the day and
       filtering by name, and holding the two together in your head. What it
       did is now chatSlice, and the lines come back inside /api/session-logs
       under the session they were said in, beside that session's other files.
       Decided by Patrick on 22 September. */

    /* Hold one session's logs indefinitely, or let them age out again.

       Everything else is pruned after SLOG_DAYS. This is the switch for the
       set that an argument rests on, so a suspension is not quietly undone a
       year later by the retention rule. Admins only, and it records who held
       it and when, because "who decided to keep this" is part of the evidence
       rather than separate from it. */
    if (p === '/api/session-keep' && req.method === 'PUT') {
      let obj;
      try { obj = JSON.parse(await body(req)); }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      const key = sessionKey(obj && obj.session);
      const rows = sessionRows();
      const at = key ? findSession(rows, key, obj.who) : -1;
      if (at < 0) return sendJson(res, 404, { error: 'no such session' });
      const on = !!(obj && obj.keep);
      rows[at].keep = on;
      if (on) { rows[at].keptBy = String(w.name || ''); rows[at].keptAt = Date.now(); }
      else { delete rows[at].keptBy; delete rows[at].keptAt; }
      if (!putSessions(rows)) return sendJson(res, 500, { error: 'could not save' });
      /* The chat it rests on is held with it (#2166), or let go with it. */
      const chatCopy = on ? copyKeptChat(rows[at]) : dropKeptChat(key);
      return sendJson(res, 200, { ok: true, keep: on, chatCopy });
    }

    /* Mark a crash looked at, or take the mark off again (#2319, crashedRow
       and markLooked). The person's launcher deletes that crash's snapshot
       at a Play after its next check in, so the mark is the word that
       nobody needs it any more. Admins only, like the page, and it records
       who and when. */
    if (p === '/api/session-looked' && req.method === 'PUT') {
      let obj;
      try { obj = JSON.parse(await body(req)); }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      const key = sessionKey(obj && obj.session);
      const rows = sessionRows();
      const at = key ? findSession(rows, key, obj.who) : -1;
      if (at < 0) return sendJson(res, 404, { error: 'no such session' });
      if (!crashedRow(rows[at])) return sendJson(res, 400, { error: 'not a crash',
        message: 'Only a session that crashed can be marked looked at.' });
      markLooked(rows[at], !!(obj && obj.looked), w.name, Date.now());
      if (!putSessions(rows)) return sendJson(res, 500, { error: 'could not save' });
      const row = rows[at];
      return sendJson(res, 200, { ok: true, looked: !!row.looked, lookedBy: row.lookedBy || '', lookedAt: row.lookedAt || 0 });
    }

    /* The sheet part: what a staff member writes against one session.
       Admins only, like everything below the line above, and one row at a
       time rather than the whole file, so two people with the page open do
       not write over each other's notes. The row is found by the session id
       AND the Discord id it belongs to, so a stray id cannot land a note on
       somebody else's session. */
    if (p === '/api/session-note' && req.method === 'PUT') {
      let obj;
      try { obj = JSON.parse(await body(req)); }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      const key = sessionKey(obj && obj.session);
      const rows = sessionRows();
      const at = key ? findSession(rows, key, obj.who) : -1;
      if (at < 0) return sendJson(res, 404, { error: 'no such session' });
      rows[at].note = String(obj.note == null ? '' : obj.note).slice(0, 2000);
      rows[at].noteBy = String(w.name || '');
      rows[at].noteAt = Date.now();
      if (!putSessions(rows)) return sendJson(res, 500, { error: 'could not save' });
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/inbox' && req.method === 'PUT') {
      let obj;
      try { obj = JSON.parse(await body(req)); }
      catch (e) { passBodyFailure(e); return sendJson(res, 400, { error: 'bad json' }); }
      // The whole list, back from the hub, through the same keeping time as
      // every other write (#2353), so a list the hub read before a row aged
      // out cannot write that row back.
      if (!Array.isArray(obj)) return sendJson(res, 400, { error: 'the inbox is a list' });
      if (!putJson(INBOX, trimInbox(obj, Date.now()))) return sendJson(res, 500, { error: 'could not save' });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: 'no such endpoint' });
  }

  // The site's own look for a person, the same four characters for anything
  // that did not ask for HTML. See notFoundPage above.
  if (wantsHtml(req)) { return send(res, 404, notFoundPage(), TYPES['.html']); }
  send(res, 404, 'not here', 'text/plain');
}
