/*
  Thornswood docs, downloads and issue boards.

  Two ways in, deliberately.

    The password lets anybody who has it read the site, run the tests, upload a
    log and report a bug. That is everyone playing.

    Discord makes you an admin: the boards become editable, and the pages that
    are only of interest to whoever is fixing things appear at all. Discord
    rather than a second password because the list of admins is then a list of
    Discord ids, which cannot be passed on by accident.

  Data is files, deliberately. A board is JSON, the two prose pages are
  markdown, uploads are the files themselves. A page can be fixed with a text
  editor when something goes wrong, the whole thing is backed up by copying a
  folder, and anyone with ssh can read a crash log without this process being
  involved at all.

  The member password crosses in clear on plain HTTP. Behind the certificate it
  does not. It guards a list of Skyrim bugs and a game installer, and should be
  treated as guarding exactly that much.
*/

'use strict';

/* node server.js --strip-metadata <folder> (#3648): takes what each picture
   and recording in the folder says about where and when it was made out of
   it, as stripMedia does to every upload, says what it did, and stops. The
   site is not started. scripts/vps/Strip-Uploads.ps1 runs it on the box. */
if (process.argv[2] === '--strip-metadata') process.exit(require('./lib/media').stripFolder(process.argv[3]));

/* THE SITE IS IN site/lib, ONE FILE PER AREA (#5357). This file was all of
   it, 10,000 lines. Each module there says at its top what it holds; they
   are loaded here in this order, and each takes what it needs from the
   others by name. Nothing outside Node is used, so the site is still these
   files and node, with no install step. */
const http   = require('http');
const tls    = require('tls');
const { BIND, DATA, EXPOSED, FILES, LEFT_OUT, PORT, UP } = require('./lib/base');
const { siteLog } = require('./lib/log');
const { cfg } = require('./lib/config');
require('./lib/pages');
require('./lib/feed');
require('./lib/public');
require('./lib/game');
require('./lib/store');
require('./lib/news');
require('./lib/limits');
require('./lib/downloads');
require('./lib/media');
require('./lib/uploads');
const { heldBroken } = require('./lib/staff');
require('./lib/auth');
require('./lib/http');
const { discordGet, roleNames } = require('./lib/discord');
require('./lib/roster');
require('./lib/signins');
require('./lib/sessions');
const { retentionSweep } = require('./lib/retention');
const { rereadTrouble } = require('./lib/trouble');
require('./lib/serverlogs');
require('./lib/members');
require('./lib/passes');
const { failed, handle } = require('./lib/serve');
const { applyDeletionRequests } = require('./lib/deletion');

applyDeletionRequests();

http.createServer((req, res) => {
  // Both halves matter. A throw before the first await arrives here as an
  // exception, and one after it arrives as a rejected promise.
  let done;
  try {
    done = handle(req, res);
  } catch (e) {
    failed(req, res, e);
    return;
  }
  if (done && typeof done.catch === 'function') {
    done.catch((e) => failed(req, res, e));
  }
}).listen(PORT, BIND, () => {
  console.log('[thornswood-docs] listening on ' + BIND + ':' + PORT);
  if (EXPOSED) {
    console.log('[thornswood-docs] WARNING: plain HTTP on every address (THORNSWOOD_DOCS_EXPOSE=1). ' +
                'Sign-ins, cookies and uploads reach ' + PORT + ' unencrypted from anywhere the firewall lets in. ' +
                'Put Caddy in front and unset it (#2185).');
  }
  console.log('[thornswood-docs] writing this to ' + siteLog.file +
              ', rolled at 4 MB, five kept');
  console.log('[thornswood-docs] documents in ' + DATA);
  console.log('[thornswood-docs] trusting ' + tls.getCACertificates('default').length +
              ' root certificates, leaving out ' + (LEFT_OUT.join(', ') || 'none'));
  rereadTrouble();
  // The first retention pass, then every hour (#2350). Before the ready line
  // below: the site harnesses read the pass's files once that line is out
  // (#4082).
  retentionSweep();
  // The files play and identity rest on, read once on the way up (#2180).
  // Each broken one has said STATE BROKEN or BANS BROKEN above this line.
  const notReady = heldBroken();
  console.log('[thornswood-docs] ' + (notReady.length
    ? 'NOT READY: ' + notReady.map((b) => b.file).join(', ') + ' will not read, /api/ready answers 503'
    : 'ready: bans, pk, linked, sessions and signins read'));
  console.log('[thornswood-docs] downloads in ' + FILES);
  console.log('[thornswood-docs] uploads in ' + UP);
  console.log('[thornswood-docs] watching the game on 127.0.0.1:' +
    (cfg.gameCheckPort || 3000) + ' (the game plays on UDP ' +
    (cfg.gamePort || 7777) + ', which cannot be probed), count from ' + cfg.onlineFile);
  console.log('[thornswood-docs] discord login ' +
    (cfg.discord.clientId ? 'ready' : 'NOT SET UP') +
    ', guild check ' + (cfg.discord.botToken && cfg.discord.guildId ? 'on' : 'OFF'));

  /* Ask Discord once on the way up, and say so loudly if it will not answer.
     Without this a dead bot token is invisible from here and shows up as every
     person except the hand written admins being told they are not in the
     server, which is the least useful way to find out. */
  if (cfg.discord.botToken && cfg.discord.guildId) {
    discordGet('/guilds/' + cfg.discord.guildId).then((r) => {
      if (r.ok) {
        console.log('[thornswood-docs] discord bot can read "' +
          String(r.body && r.body.name || '?') + '"');
        return roleNames().then((names) => {
          const n = Object.keys(names || {}).length;
          console.log('[thornswood-docs] ' + n + ' roles visible to the bot');
          if (!n) console.error('[thornswood-docs] NO ROLES VISIBLE. Nobody but the admin list will get in.');
        });
      }
      console.error('[thornswood-docs] THE BOT CANNOT READ THE SERVER: ' + r.why);
      console.error('[thornswood-docs] Until this is fixed everybody except the ids in ' +
                    '"admins" is turned away, and the page tells them so.');
    }).catch((e) => {
      // Said rather than dropped (#2736): a failure here is the roles read, and
      // without this line nobody learns the check on the way up never finished.
      console.error('[thornswood-docs] could not finish asking Discord on the way up: ' + ((e && (e.code || e.message)) || e));
    });
  }
});
