/*
  config.json, read once at start: its defaults filled in, the member
  password, cookie secret and join pass key made and kept, and the data
  folders made. And the one switch (#428) that says whether the world is open
  to everybody, which the defaults need.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { andList, forMode, notAcceptedYet };

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { DATA, FILES, FOR_BOT, FROM_BOT, PUBLIC, ROOT, UP } = require('./base');

const CFGFILE = path.join(ROOT, 'config.json');
let cfg = {
  password: '',
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  patreon: '',           // the page link, once there is one to link at
  /* Both of these live on this same machine, so the site can just look. */
  gamePort: 7777,
  // What the site actually connects to when it asks whether the game is up.
  // NOT 7777: the game's own traffic there is UDP, and a TCP connect to a UDP
  // port cannot succeed, so probing it reported the server down every single
  // time whatever the server was doing. 3000 is the resources port the client
  // pulls from, it is TCP, and it is the same process, so if one is gone both
  // are. This is the port the service watcher has always used, for this reason.
  gameCheckPort: 3000,
  onlineFile: 'C:/Thornswood-Server/data/online.json',
  /* Discord roles decide everything. A role name here, not an id, because the
     names are what he maintains and the ids are what Discord hands back. */
  /*
    Patrick, 28 Sep: "we are in alpha so the world is open by application".
    Anyone can download it; getting in is an application in the Discord.
    Staff give Member after an application is accepted. Discord has no
    default-role setting, so joining does not hand Member out. Playtester
    (access.play) is what opens the game, and Member is not on that list.
    The application, and the age and rules questions it asks (#428), is the
    way into the world.

    LOCKED 12 Oct and 15 Oct (Patrick via Smeagle on #428): closed playtest /
    alpha stays. Do not flip public mode. open stays false until Patrick ends
    the alpha and Discord onboarding grants Member with the 18+ and rules
    answers. The switch below is built; leaving it off is the requirement.

    The day the world opens to everybody, "open": true in config.json is the
    one switch (#428). It puts Member on the play list at load (playRoles),
    tells the bot and the pages through /api/public, and they follow: the
    bot drops the application from its panel, and the join, help, rules and
    home wording change with it. Off unless config.json says true. It only
    opens the world to everybody if everybody in the Discord has Member.
  */
  open: false,
  access: {
    // #3317 (Patrick, 22 Oct): every staff role plays the main build, with
    // Playtester; the site's admin pages are Owner, Co-Owner and the Dev rank.
    admin:  ['Owner', 'Co-Owner', 'Lead Dev', 'Dev'],
    play:   ['Owner', 'Co-Owner', 'Lead Dev', 'Lead Gamemaster', 'Lead Loremaster',
             'Lead Moderator', 'Lead Content Creator', 'Lead Support', 'Dev',
             'Gamemaster', 'Trial Gamemaster', 'Loremaster', 'Moderator',
             'Content Creator', 'Support', 'Playtester'],
    banned: ['Banned']
  },
  botKey: '',            // shared secret the Discord bot signs /api/ticket with
  admins: [],            // discord ids, an override for when the bot is down
  secret: '',
  passKey: '',           // signs join passes; the game servers hold a copy (#937)
  /* Cloudflare Turnstile on the report form (#3216). The site key goes to the
     page and is public; the secret is what the site checks a pass with, and
     lives only here. Both are set on the box by Set-Turnstile.ps1. Either one
     empty, as on a copy on your machine, means no widget and no check. */
  turnstileSiteKey: '',
  turnstileSecret: ''
};
/* The byte order mark matters. Windows PowerShell puts one on the front of
   anything it writes with -Encoding UTF8, JSON.parse refuses a string that
   starts with it, and this used to be a bare catch that swallowed the error
   and carried on with the defaults. Which meant the site ran for days looking
   configured from the outside and holding nothing. Strip it, and remember
   whether the read actually worked. */
let cfgBroken = null;
let fileHadPassword = false;
try {
  const parsedCfg = JSON.parse(
    fs.readFileSync(CFGFILE, 'utf8').replace(/^\uFEFF/, ''));
  if (parsedCfg && typeof parsedCfg === 'object' && !Array.isArray(parsedCfg) &&
      typeof parsedCfg.password === 'string' && parsedCfg.password.length > 0) {
    fileHadPassword = true;
  }
  cfg = Object.assign(cfg, parsedCfg);
} catch (e) {
  if (fs.existsSync(CFGFILE)) cfgBroken = e;
}
cfg.discord = Object.assign({ clientId:'', clientSecret:'', botToken:'', guildId:'', invite:'' },
                            cfg.discord || {});
// dev, company and slots3 get their defaults below. The hold offices are not
// a list here: they are read from the roles' own names (OFFICE_ROLE, #2551).
cfg.access  = Object.assign({ admin:[], play:[], banned:[] }, cfg.access || {});
// The one switch (#428). Only a real true opens it: "true", 1 or a typo does not.
cfg.open = cfg.open === true;
cfg.access.play = playRoles(cfg.access.play, cfg.open);
// Who is staff in the game: the staff seats over the most the world holds,
// the game's staff powers (devProfiles), and the uploads queue. Since #3317
// (Patrick, 22 Oct) it is the staff who work in the world: Owner and
// Co-Owner, and the Dev, Gamemaster and Loremaster ranks with their leads.
// Moderators moderate the Discord only, and Content Creator and Support work
// in the Discord, so none of them is staff in the game. It folds access.admin
// in through out.dev below, so widening admin still widens it.
if (!Array.isArray(cfg.access.dev)) {
  cfg.access.dev = ['Owner', 'Co-Owner', 'Lead Dev', 'Dev', 'Lead Gamemaster',
                    'Gamemaster', 'Trial Gamemaster', 'Lead Loremaster', 'Loremaster'];
}
// Who may use the dev build and join the dev server (#605, the install gate).
// Patrick, 22 Oct (#3317): "Dev build: Owner, Co-Owner, Dev and the leads
// only". Every lead of the council is in it, a lead whose rank is not staff
// in the game included. It folds access.admin in through out.devBuild below.
if (!Array.isArray(cfg.access.devBuild)) {
  cfg.access.devBuild = ['Owner', 'Co-Owner', 'Lead Dev', 'Lead Gamemaster',
                         'Lead Loremaster', 'Lead Moderator', 'Lead Content Creator',
                         'Lead Support', 'Dev'];
}
// Who the Free Skyrim Trading Company has taken on (#1393): an application in
// Discord, the same shape as a Jarl's, and a person gives the role. The game
// lets them handle a company sale.
if (!Array.isArray(cfg.access.company)) {
  cfg.access.company = ['Free Skyrim Trading Company'];
}
// Who gets a third character slot at the game's main menu. Everybody gets
// two; a Patreon tier or a Gamemaster gets three, and so do the admin roles.
// Decided by Patrick on 20 September. The tier names are Build-Discord.py's.
if (!Array.isArray(cfg.access.slots3)) {
  cfg.access.slots3 = ['Thalmor Boot-Licker', 'Talos Worshiper', 'Milk Drinker', 'Gamemaster'];
}
cfg.admins  = Array.isArray(cfg.admins) ? cfg.admins.map(String) : [];

// A list of role names for a sentence: "Owner, Dev and Gamemaster" rather than
// "Owner and Dev and Gamemaster", so the dev-role refusal reads plainly once
// access.dev holds more than the old admin pair (#605).
function andList(names) {
  const a = (names || []).filter(Boolean);
  if (a.length === 0) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/* The member password is a bootstrap for a site that has no Discord sign in
   yet (#1305). It is not a word shipped in the repository. A config that
   already has a password keeps it, and that password is not printed again.
   A fresh config, or one with none, gets a random password. It is saved with
   the other keys and printed once, for the operator. A file that will not
   parse is left untouched; the password held in memory is still random, so
   an empty one cannot sign in. */
let tellPassword = false;
if (!fileHadPassword) {
  cfg.password = crypto.randomBytes(24).toString('hex');
  tellPassword = !cfgBroken;
}

/* Signs the admin cookie. Kept apart from the password so changing the
   password does not sign everybody out of Discord, and made once rather than
   shipped, so it is never a value that exists in the repository. */
/* Never write over a file that failed to parse. It is not empty, it is
   unreadable, and the difference is somebody's client secret. Writing the
   defaults back over it is how the whole Discord configuration disappeared
   once already. */
if (cfgBroken) {
  console.error('[thornswood] config.json is on disk but will not parse, so ' +
                'NOTHING in it is being used and it has been left untouched:');
  console.error('[thornswood]   ' + cfgBroken.message);
  // A throwaway one, so cookies still cannot be forged while it is broken.
  // Not written anywhere, so a restart invalidates every session, which is
  // the correct amount of unpleasant.
  cfg.secret = crypto.randomBytes(32).toString('hex');
} else if (!cfg.secret) {
  cfg.secret = crypto.randomBytes(32).toString('hex');
  // Said when it cannot be kept (#2736): the secret then lives only in this
  // run, so every restart signs everybody out until config.json can be written.
  try { fs.writeFileSync(CFGFILE, JSON.stringify(cfg, null, 2), 'utf8'); }
  catch (e) {
    console.error('[thornswood] could not keep the new cookie secret in config.json (' + (e.code || e.message) +
                  '), so a restart signs everybody out');
  }
}
/* The join pass key (#937). Made here once and kept in config.json, never in
   the repository; Set-Door.ps1 -Connect copies it into each game server's
   door.json, which is how the two ends share it without anybody handling it.
   A key that could not be kept is no key at all: a pass signed with one that
   dies with this process would be refused by every game server, so /api/play/pass
   answers 503 instead, which is the safe side. */
if (cfgBroken) {
  cfg.passKey = '';
} else if (!cfg.passKey) {
  cfg.passKey = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(CFGFILE, JSON.stringify(cfg, null, 2), 'utf8'); }
  catch (e) {
    cfg.passKey = '';
    console.error('[thornswood] could not keep a join pass key in config.json, so no join ' +
                  'passes are issued: ' + e.message);
  }
}

if (tellPassword) {
  try {
    fs.writeFileSync(CFGFILE, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('[thornswood] member bootstrap password (shown once): ' + cfg.password);
  } catch (e) {
    console.error('[thornswood] could not keep a member bootstrap password in config.json, ' +
                  'so it was not printed: ' + e.message);
  }
}

// A folder that cannot be made is said (#2736), by its path and the error
// code; every read and write under it fails after this, and the line here is
// the one that says why.
for (const dir of [DATA, FOR_BOT, FROM_BOT, PUBLIC, FILES, UP]) {
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { console.error('[thornswood-docs] could not make ' + dir + ' (' + (e.code || e.message) + ')'); }
}
/* A site from before #1102 kept those three directly in data. Each is moved
   into for-bot once: copied, so the copy takes that folder's rules rather
   than keeping the old file's, then removed. One already in for-bot is never
   written over, and the old one is then left where it is and said. */
for (const n of ['trouble.json', 'inbox.json', 'moderation.log']) {
  const from = path.join(DATA, n);
  const to = path.join(FOR_BOT, n);
  try {
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) {
      console.log('[thornswood-docs] ' + n + ' is in data and in data\\for-bot; the one in for-bot is used, the other is left for a look');
      continue;
    }
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
    console.log('[thornswood-docs] moved ' + n + ' into data\\for-bot, where the bot reads it');
  } catch (e) { console.log('[thornswood-docs] could not move ' + n + ' into data\\for-bot: ' + e.message); }
}


// ==== thornswood open switch ====
/* The one switch (#428), cfg.open, off unless config.json says true.

   LOCKED closed (Patrick, 12 Oct option B + 15 Oct via Smeagle): do not set
   open true and do not ship a public-mode flip from this card. Alpha / apply
   for Playtester stays the door. Public flip waits on Discord onboarding that
   grants Member and records 18+ and rules, after Patrick ends the alpha.

   playRoles is the play list with Member added when the world is open to
   everybody. Staff give Member after an application is accepted. Discord
   has no default-role setting. Playtester (access.play) is what opens the
   game while the switch is off. With the switch off the list is left
   exactly as it was.

   forMode is how the written pages follow the same switch. A page marks its
   alpha wording with <!-- alpha --> ... <!-- /alpha --> lines and its open
   wording with <!-- open --> ... <!-- /open -->, and only the one that
   applies is served. bot/content.py reads join.md through the same markers
   for #start-here, so the site and the Discord cannot disagree.
   A page's <!-- engine-pin:<name> --> and <!-- /engine-pin:<name> --> lines
   say where scripts/release/Write-EnginePinText.ps1 writes the engine pin
   (#5148); they are for that script, so they are left out the same way. */
function playRoles(play, open) {
  const list = Array.isArray(play) ? play.slice() : [];
  if (open === true && list.indexOf('Member') < 0) list.push('Member');
  return list;
}

function forMode(md, open) {
  const drop = open === true ? 'alpha' : 'open';
  return String(md)
    .replace(new RegExp('^<!-- ' + drop + ' -->[ \\t]*\\r?\\n[\\s\\S]*?^<!-- /' + drop +
                        ' -->[ \\t]*(?:\\r?\\n|$)', 'gm'), '')
    .replace(/^<!-- \/?(?:alpha|open) -->[ \t]*(?:\r?\n|$)/gm, '')
    .replace(/^[ \t]*<!-- \/?engine-pin:[a-z]+ -->[ \t]*(?:\r?\n|$)/gm, '');
}
/* What somebody in the Discord without a play role is told, by the launcher's
   door, the join pass and the sign in page. In the alpha that is an
   application; with the switch on it is only the Member role. With inner, the
   words that follow "That account is in the Discord, but". */
function notAcceptedYet(inner) {
  const open = cfg.open === true;
  const how = open
    ? 'Ask in the Discord and somebody will sort it.'
    : 'Apply in the Discord: open a ticket and pick Apply to be an alpha playtester.';
  if (inner) {
    return (open ? 'it does not have the Member role yet. '
                 : 'it has not been accepted into the alpha yet. ') + how;
  }
  return (open ? 'That Discord account does not have the Member role yet. '
               : 'That Discord account has not been accepted into the alpha yet. ') + how;
}
// ==== end thornswood open switch ====

Object.assign(module.exports, { cfg });
