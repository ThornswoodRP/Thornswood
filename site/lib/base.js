/*
  Where the site lives and what it trusts: the port and address it answers
  on, its folders, and the root certificates every request it makes is checked
  against (#3111). Loaded first, before any connection is made.
*/

'use strict';

const path   = require('path');
const crypto = require('crypto');
const tls    = require('tls');


/* NO eMUDHRA ROOT (#3111). Every request this process makes, discord.com with
   the bot token and the webhooks among them, verified against Node's bundled
   roots, which are Mozilla's from when this Node was built and carry all four
   of eMudhra's emSign roots. emSign ECC Root CA - G3 is the root of the eight
   intermediates found on 17 Oct 2026 with keys anyone could recover (Mozilla
   bug 2083449), and Node checks no revocation list, so a certificate made with
   one of those keys was enough to sit between this site and Discord. Mozilla
   still lists G1, and takes C1 and C3 out only in NSS 3.132, so a newer Node
   does not end it either. Nothing this site talks to chains to eMudhra, so
   its roots are what Node trusts by default less each one whose subject or
   issuer is eMudhra's, set once here before any connection is made, and
   bot\trust.py leaves out the same for the bot. Taking away is all this does:
   a root Node drops leaves with the next Node. */
const NOT_TRUSTED = /O=eMudhra/i;
const LEFT_OUT = [];
tls.setDefaultCACertificates(tls.getCACertificates('default').filter((pem) => {
  const c = new crypto.X509Certificate(pem);
  if (!NOT_TRUSTED.test(c.subject) && !NOT_TRUSTED.test(c.issuer)) return true;
  LEFT_OUT.push((c.subject.match(/^CN=(.*)$/m) || [null, c.subject])[1]);
  return false;
}));

const PORT   = Number(process.env.THORNSWOOD_DOCS_PORT || 3001);
/* LOOPBACK UNLESS ASKED (#2185). Caddy holds 443 and hands everything on from
   127.0.0.1, so this answers only there. Listening on every address put port
   3001 open as a plain HTTP way past the certificate, cookies and passwords
   included, on any box where THORNSWOOD_DOCS_LOCAL had not been set, and the
   unsafe answer was the default. Now a plain listener on every address takes
   THORNSWOOD_DOCS_EXPOSE=1, for a box with no proxy in front, and says so
   loudly at every start. THORNSWOOD_DOCS_LOCAL=1 still means loopback and
   wins over EXPOSE. */
const EXPOSED = process.env.THORNSWOOD_DOCS_EXPOSE === '1' && process.env.THORNSWOOD_DOCS_LOCAL !== '1';
const BIND   = EXPOSED ? '0.0.0.0' : '127.0.0.1';
const ROOT   = path.join(__dirname, '..');
const DATA   = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const FILES  = path.join(ROOT, 'files');
const UP     = path.join(ROOT, 'uploads');
/* What the site writes for the bot and nothing else: trouble.json, inbox.json
   and moderation.log (issue #1102). The bot runs as its own account, which is
   granted read on this folder only (scripts\vps\Bot-Service.ps1), so it never
   reaches the site's own records beside it, sessions.json among them. */
const FOR_BOT = path.join(DATA, 'for-bot');
/* And the other way round (issue #3140): what the bot writes for the site and
   nothing else, lists.json, the Known Issues page and the roadmap it builds
   from the issue board. The bot's account is given Modify on this folder only
   (Bot-Service.ps1), so it writes nothing else of the site's. */
const FROM_BOT = path.join(DATA, 'from-bot');
const LISTS = path.join(FROM_BOT, 'lists.json');

Object.assign(module.exports, { BIND, DATA, EXPOSED, FILES, FOR_BOT,
  FROM_BOT, LEFT_OUT, LISTS, PORT, PUBLIC, ROOT, UP });
