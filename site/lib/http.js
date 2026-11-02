/*
  Answering a request: the security headers, send and its Range replies,
  reading a body, cookies, the cross site check and the sign in attempt
  cookie.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { body, crossSite, cspFor, passBodyFailure, rangeReply,
  send };

const fs     = require('fs');
const { versionAssets } = require('./public');
const { ADMIN, COOKIE, cookies } = require('./auth');

// ----------------------------------------------------------------- plumb --
/* One CSP for every answer (#1474). home.html and the hub load CSS/JS as
   same-origin files, so style-src needs only 'self'. Keep this string in one
   place so send(), Range replies, and the request-level setHeader cannot
   drift.

   The one other site in it is Cloudflare Web Analytics (#3218, Patrick's
   answer on 22 Oct 2026). Cloudflare writes its beacon into every page it
   carries, so the page never names it: the script comes from
   static.cloudflareinsights.com and posts what it measured to
   cloudflareinsights.com. With script-src 'self' alone every page raised a
   CSP error in the console and Cloudflare counted nothing. The privacy page
   names it. It sets no cookie and keeps nothing on the visitor's machine.

   The third is Cloudflare Turnstile on the report form (#3216, Patrick's
   answer on 22 Oct 2026): its script and the frame it draws the check in
   both come from challenges.cloudflare.com. The privacy page names it. */
const CSP_HEADER = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";
/* A NONCE ON EVERY ANSWER (#3216). Bot Fight Mode, on by Patrick's answer on
   22 Oct 2026, turns on Cloudflare's JavaScript Detections, which cannot be
   turned off on its own and writes a small inline script into every page
   Cloudflare carries. script-src 'self' refuses any inline script, so every
   page would raise a CSP error and the detection would never run. Cloudflare
   reads a nonce out of this header and puts it on the script it writes in, so
   each answer gets a fresh one (handle() makes it). The site's own pages
   carry no inline script and never use it; a nonce is only good for the one
   answer it came with, so it opens nothing to anybody else. */
/* What no page here may use (#2762). Nothing on this site asks for the
   camera, the microphone, the location, a payment or a USB device, so a page
   or a frame in it that tried would be refused. Caddy sends the same value on
   every answer from the name (scripts\deploy\Caddyfile, its header block),
   and tests\test-2762-door-headers.js keeps the two equal. */
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
function cspFor(res) {
  const n = res && res.cspNonce;
  return n ? CSP_HEADER.replace("script-src 'self'", "script-src 'self' 'nonce-" + n + "'") : CSP_HEADER;
}
function send(res, code, payload, type, extra) {
  // Defense in depth (#1366 / #1474): conservative CSP (this page and the hub
  // name nothing on other sites, and CSS and JS are external same-origin
  // files; the analytics beacon Cloudflare adds is the one exception, above),
  // frame-ancestors self so the hub cannot be iframed for clickjacking, and a
  // referrer policy that does not leak path on cross-origin navigations.
  // A page names its files with their hashes (versionAssets, #3218), here so
  // that no page sent can miss it.
  if (/^text\/html\b/.test(String(type || '')) && payload) payload = versionAssets(payload);
  res.writeHead(code, Object.assign({
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': cspFor(res),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS_POLICY
  }, extra || {}));
  res.end(payload);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));

/*
  One byte range, when a client asks for one. Answers 206 or 416 and returns
  true, or returns false when there is no range to honour and the caller sends
  its own 200.

  The static files had this and /file/ did not. /file/ was where the old
  installer got its payload (until #4824), asking for the rest of a half
  downloaded zip with a Range header and appending whatever a 206 brought,
  and a browser resumes a download from it the same way. The site answered
  every such request 200 with the whole file and no Accept-Ranges, so a
  connection that dropped at 300 MB started again from nothing, while the Join
  page promises it carries on. The To Do List has it measured live: a Range
  request for the payload came back 200 with the full length.

  A 206 that starts anywhere but the byte asked for is written onto the end of
  the partial file and corrupts it with nothing to notice, so the start is
  exactly the number in the header and test-file-range.js holds it there.

  headers are the ones this file is served with (content-type, and on /file/
  the attachment name and its validators), lower case so none is sent twice.
  When they carry an etag or last-modified, an If-Range that names neither is
  a client resuming a file that has since changed, and it gets the whole new
  file rather than the tail of it. head is a HEAD: headers only, and a HEAD
  with a range on the installer does not read half a gigabyte to throw away.
*/
function rangeReply(req, res, file, size, headers, head) {
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (!m) return false;
  const ifRange = req.headers['if-range'];
  if (ifRange && (headers.etag || headers['last-modified']) &&
      ifRange !== headers.etag && ifRange !== headers['last-modified']) return false;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end = m[2] === '' ? null : parseInt(m[2], 10);
  // bytes=-500 means the LAST 500, not "from 0 to 500".
  if (start === null && end !== null) { start = Math.max(0, size - end); end = size - 1; }
  if (start !== null && end === null) { end = size - 1; }
  if (start === null || start > end || start >= size) {
    res.writeHead(416, {
      'content-range': 'bytes */' + size,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': cspFor(res),
      'referrer-policy': 'strict-origin-when-cross-origin'
    });
    res.end();
    return true;
  }
  end = Math.min(end, size - 1);
  // send() puts the security headers on every other answer; a range must not
  // be the one reply that quietly goes out without them.
  res.writeHead(206, Object.assign({}, headers, {
    'content-range': 'bytes ' + start + '-' + end + '/' + size,
    'content-length': (end - start) + 1,
    'accept-ranges': 'bytes',
    'cache-control': headers['cache-control'] || 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': cspFor(res),
    'referrer-policy': 'strict-origin-when-cross-origin'
  }));
  if (head) { res.end(); return true; }
  fs.createReadStream(file, { start: start, end: end }).pipe(res);
  return true;
}

/*
  What was sent with a request, settled on every path (#1095).

  It resolved on 'end' and nothing else. Over the cap it destroyed the
  request, after which 'end' never came, and a connection that dropped or a
  sender that stopped halfway left it waiting too, so the route never went
  on and the visitor got a dropped connection instead of words.

  Now it rejects with a BodyFailed, which failed() below turns into an
  answer: 413 with the most the route takes when it is too big, 408 when it
  took longer than waitMs to arrive (by default ten seconds, plus a second
  for every 64 KB the route allows), and nothing when the connection has
  already gone, because nobody is left to read it. Over the cap the rest is
  read and thrown away rather than the socket cut, so the answer can reach
  the sender. The routes pass a BodyFailed on (passBodyFailure) rather than
  reading it as a body that was not JSON.
*/
class BodyFailed extends Error {
  constructor(status, why, words) { super(why); this.status = status; this.why = why; this.words = words; }
}
function passBodyFailure(e) { if (e instanceof BodyFailed) throw e; }
function body(req, cap, waitMs) {
  const max = cap || 4000000;
  const wait = waitMs > 0 ? waitMs : 10000 + Math.ceil(max / 65536) * 1000;
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0, settled = false;
    const settle = (e, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e) reject(e); else resolve(v);
    };
    const timer = setTimeout(() => settle(new BodyFailed(408, 'slow',
      'That took too long to arrive, so it was not read. Try again.')), wait);
    const gone = () => settle(new BodyFailed(0, 'closed', ''));
    req.on('data', (d) => {
      if (settled) return;
      size += d.length;
      if (size > max) {
        return settle(new BodyFailed(413, 'too big', 'That was too big to send here: the most this takes is ' +
          (max >= 1048576 ? Math.round(max / 1048576) + ' MB' : Math.max(1, Math.round(max / 1024)) + ' KB') + '.'));
      }
      parts.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
    });
    req.on('end', () => settle(null, Buffer.concat(parts).toString('utf8')));
    req.on('error', gone);
    req.on('aborted', gone);
    req.on('close', () => { if (!req.complete) gone(); });
  });
}

/*
  What each extension is served as. Anything not named here falls through to
  text/plain, which is right for robots.txt and wrong for everything binary.

  .jpg and .mp4 were both missing on 20 September and both were needed the same
  day: the front page's hero became a video with a still as its poster, and the
  site served them as text/plain. A browser will not play a video it is told is
  text, so the hero was simply blank and the reasonable reading from the outside
  was that the wrong picture had been published. It had not; it was unplayable.

  Wrong Content-Type is a bad failure because nothing errors. The file arrives,
  200, the right bytes, and the browser quietly declines to do anything with it.
*/
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff'
};

const origin = (req) => {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
                'http';
  return proto + '://' + (req.headers.host || 'localhost');
};
const secureHere = (req) =>
  (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

const setCookie = (req, name, value, days) =>
  name + '=' + value + '; Path=/; Max-Age=' + (days * 86400) +
  '; HttpOnly; SameSite=Lax' + (secureHere(req) ? '; Secure' : '');

/*
  A request that changes something comes from a page of this site, or from
  something that is not a browser at all (#1367).

  The sign in cookies are SameSite=Lax, and until this that attribute was all
  that stood between another site and every write here. Lax keeps the cookies
  off a POST, PUT or DELETE that another site starts, in a browser that knows
  the attribute. A browser too old to know it sends them, and every route
  reads its body as JSON whatever the Content-Type says, so a plain form with
  enctype="text/plain" on any page could send a signed in admin to
  /api/staff/pk with a body that parses. Lax also counts every name under
  thornswood.net as the same site, so a page on any other name under it would
  carry the cookies as well.

  So anything but GET (a HEAD is a GET by the time this is asked) is held to
  where it came from. A browser names the page that sent it in Origin on every
  such request, and an old one that leaves Origin off still sends Referer.
  Either naming another origin is refused, and Origin "null" is another origin
  (a sandboxed frame, a page that turned the referrer off). With neither, it
  is the launcher, a game server, the bot or the voice service: none of them
  holds a sign in cookie, and each proves itself another way (a ticket, the
  bot's key). A request with neither that does carry one of the sign in
  cookies is a browser with both taken off, and is refused too.

  This site's origin is the one the request was sent to, read the way the
  Discord callback builds its redirect address (origin above). A page on
  another site cannot make a browser send this site's Origin, so it cannot
  match.

  GET changes nothing here that a page elsewhere can choose: /auth/discord
  starts a sign in tied to this browser, its callback finishes only the
  attempt this browser began (ATTEMPT below), and /api/signins drops rows
  past their age. site/tests/test-1367-cross-site.js holds every write route to
  this.

  Answers '' when the request may go on, or which of the three it failed:
  'origin', 'referer', or 'neither' (a sign in cookie and no page named).
*/
function crossSite(req) {
  if (req.method === 'GET') return '';
  const own = origin(req).toLowerCase();
  const said = req.headers.origin;
  if (said !== undefined) {
    return String(said).toLowerCase() === own ? '' : 'origin';
  }
  const ref = req.headers.referer;
  if (ref !== undefined) {
    let from = '';
    try { from = new URL(String(ref)).origin.toLowerCase(); } catch (e) { from = ''; }
    return from === own ? '' : 'referer';
  }
  const c = cookies(req);
  return (c[COOKIE] || c[ADMIN]) ? 'neither' : '';
}

/*
  One Discord sign in attempt, tied to the browser that started it. Entry 248.

  The OAuth state was the same string for every attempt that asked for the
  same page: signed, and nothing else. Anybody holding one could hand it to
  somebody else's browser, or use it again, and the callback took it. Now
  every press of the button makes a random value that goes two ways, inside
  the signed state out through Discord and back, and into a short cookie in
  this browser only. The callback wants the two to match, once, inside ten
  minutes, and refuses before Discord is asked anything.

  The launcher's nonce is a different thing and rides alongside unchanged. It
  proves the ticket landed on the port of the button that was pressed; this
  proves the callback is finishing an attempt this browser began.

  Named per attempt, so two tabs signing in at once do not overwrite each
  other. The path keeps it off every other request. The launcher waits two
  minutes for its ticket (Discord.cs), so ten is room to spare.
*/
const ATTEMPT = 'twst_';
const ATTEMPT_MS = 10 * 60000;
const attemptsSpent = new Map();
const attemptCookie = (req, attempt, value, seconds) =>
  ATTEMPT + attempt.slice(0, 8) + '=' + value + '; Path=/auth/discord; Max-Age=' + seconds +
  '; HttpOnly; SameSite=Lax' + (secureHere(req) ? '; Secure' : '');

/* Which doors have been answered with the key in the address, so site.log
   says once, and without the key, that a game server still runs a gamemode
   from before the key moved into a header. When neither door has said it
   since both servers were redeployed, the address form can go. */
const keyInAddress = new Set();

Object.assign(module.exports, { ATTEMPT, ATTEMPT_MS, attemptCookie,
  attemptsSpent, BodyFailed, keyInAddress, origin, PERMISSIONS_POLICY,
  secureHere, sendJson, setCookie, TYPES });
