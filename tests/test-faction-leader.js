// test-faction-leader.js
//
// Apply: Faction Leader replaced Apply: Trading Company on the Discord
// ticket panel. The Free Skyrim Trading Company is one of the seats.
//
// Djinn, 11-12 Oct 2026: the form, the pick list, the staff flag, the
// confirmed panel sentence, and Faction Leader routing to upper staff
// by role ID. This file holds the source to those decisions so a
// pull request that puts the company form back, drops factions.json from
// Install-Bot, grants a faction lead Discord role, or matches Lead
// roles by a name prefix goes red here.
// bot/tests/test-faction-leader.py runs the form and the routing.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join(''); };

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const bot = read('bot/bot.py');
const install = read('scripts/deploy/Install-Bot.ps1');
const build = read('bot/Build-Discord.py');
const names = JSON.parse(read('bot/factions.json'));
// The site is server.js over its modules in site\lib since #5357.
const site = require('./site-files').source();
const page = read('docs/systems/trading-company.md');
const factions = read('docs/systems/factions.md');
const STAFF_RULE = 'No GM or staff member (Loremaster, Discord Moderator, or any other staff role) may hold an in-game RP role with faction leadership, such as a Jarl or a faction lead.';

// The pin is a name==version line. PyPI and the hashed lockfile write
// discord-py; requirements.in writes discord.py. Both are the same
// package (PEP 503). The VPS runner is Windows: the file may arrive
// with CRLF, a UTF-8 BOM, or UTF-16. Read bytes, decode, join
// backslash continuations, then demand exactly version 2.7.1.
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return Buffer.from(buf.slice(2)).swap16().toString('utf16le');
  }
  var s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function requirementPins(text) {
  var joined = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\\\n/g, ' ');
  var pins = {};
  joined.split('\n').forEach(function (raw) {
    var line = raw.trim();
    if (!line || line.charAt(0) === '#') return;
    var m = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!-]+)\b/.exec(line);
    if (!m) return;
    pins[m[1].toLowerCase().replace(/[-_.]+/g, '-')] = m[2];
  });
  return pins;
}
var reqPins = requirementPins(decodeText(
  fs.readFileSync(path.join(REPO, 'bot', 'requirements.txt'))));

yes('F1 discord.py is pinned at 2.7.1, which has Select inside a modal since 2.6.0',
    reqPins['discord-py'] === '2.7.1' &&
    bot.indexOf('discord.ui.Label(') !== -1 &&
    bot.indexOf('discord.ui.Select(') !== -1 &&
    bot.indexOf('required=True') !== -1);

yes('F2 factions.json is names only, in this order, and Other is not in it',
    Array.isArray(names) &&
    names.join('|') === [
      'Imperial Embassy',
      'Thalmor Remnant',
      'Free Skyrim Trading Company',
      'The Companions',
      'College of Winterhold',
      'Bards College',
      'Thieves Guild',
      'Dark Brotherhood',
      'Vigilants of Stendarr',
      'Dawnguard',
      'Silver Hand',
      'Forsworn',
      'Orc Strongholds',
      'Khajiit Caravans',
      'Blades',
      'Volkihar Clan'
    ].join('|') &&
    names.indexOf('Other') === -1 &&
    !JSON.stringify(names).includes('token') &&
    !JSON.stringify(names).includes('secret'));

yes('F3 the panel offers Apply: Faction Leader and not Apply: Trading Company',
    /\('faction',\s+'Apply: Faction Leader'/.test(bot) &&
    !/\('company',\s+'Apply: Trading Company'/.test(bot) &&
    /'faction':\s+'Faction Lead of the faction named below'/.test(bot) &&
    !/'company':\s+'Trading Company'/.test(bot));

yes('F4 the three copied questions stay optional (long), and only the pick is required',
    /'What would they do with the faction\?'/.test(bot) &&
    /'Who is your character\?'/.test(bot) &&
    /'How much time can you give it\?'/.test(bot) &&
    !/'What would they do for the company\?'/.test(bot) &&
    /required=not long/.test(bot) &&
    /FACTION_OTHER_Q = 'If Other, which faction\?'/.test(bot) &&
    /max_length=200/.test(bot));

yes('F5 Install-Bot sends factions.json on the artifact list and in the copy loop',
    install.indexOf("'bot/factions.json'") !== -1 &&
    install.indexOf("foreach ($f in 'bot.py', '_pyguard.py', 'trust.py', 'card.py', 'staff-channel.txt', 'requirements.txt', 'factions.json')") !== -1);

// #3317 (Patrick, 22 Oct, page card q-3317-faction-roles, A): one
// "<faction> Leader" role per named faction, from factions.json, short names,
// and its member role, the short name; Trading Company is renamed to the
// company's member role so its holders keep it (lore/factions.md, 22 Oct).
yes('F6 Build-Discord makes a member and a Leader role for each faction in factions.json, Trading Company renamed',
    build.indexOf("ROLES.append(('Trading Company'") === -1 &&
    /FACTION_MEMBERS = tuple\(FACTION_SHORT\.get\(f, f\) for f in FACTIONS\)/.test(build) &&
    /'Free Skyrim Trading Company': \('Trading Company',\)/.test(build) &&
    /FACTION_LEADERS = tuple\(FACTION_SHORT\.get\(f, f\) \+ ' Leader' for f in FACTIONS\)/.test(build) &&
    /'factions\.json'/.test(build));

// #3317 (Patrick, 22 Oct, 11:03 AM, and page card q-3317-seat-rule-check, A):
// every staff role counts for the seat rule, and the bot refuses rather than
// flags. bot/tests/test-3317-seats.py runs it.
yes('F7 is_staff still leaves Trial Gamemaster out, and the seat rule counts every staff role and refuses',
    /Lead Gamemaster and Trial Gamemaster carry Manage Threads/.test(bot) &&
    /SEAT_RULE_STAFF = \('Owner', 'Co-Owner',/.test(bot) && /'Trial Gamemaster'/.test(bot) &&
    /def seat_refusal\(kind, who, guild\):/.test(bot) &&
    /LEADERSHIP_KINDS = \('jarl', 'faction'\)/.test(bot) &&
    /def is_staff\(who\):/.test(bot) &&
    /The one gate on \/close, the Close ticket button/.test(bot));

yes('F8 Faction Leader routing is IDs only; empty list refuses; no staff-log fallback',
    /def upper_staff_ids\(/.test(bot) &&
    /FACTION_REFUSED/.test(bot) &&
    /FACTION_THREAD_FAILED/.test(bot) &&
    /was not written to the staff log or the site inbox/.test(bot) &&
    bot.indexOf("UPPER_STAFF_NAMES.add('owner')") === -1 &&
    !/startswith\(['"]Lead/.test(bot) &&
    bot.indexOf("name='faction-seat'") === -1 &&
    install.indexOf('UPPER_STAFF_ROLES') !== -1 &&
    /Owner role ID/.test(install) &&
    /Lead Gamemaster role ID/.test(install));

yes('F15 Install-Bot keeps existing UPPER_STAFF_ROLES unless -UpperStaffRoles is passed, IDs only',
    install.indexOf("ContainsKey('UpperStaffRoles')") !== -1 &&
    install.indexOf("'^[0-9,]*$'") !== -1 &&
    install.indexOf('WARNING: UPPER_STAFF_ROLES is empty') !== -1 &&
    install.indexOf('must be role IDs only (digits and commas)') !== -1);

yes('F16 empty UPPER_STAFF_ROLES is a bot-log warning only, never a channel post',
    /def warn_upper_staff_config\(/.test(bot) &&
    /UPPER_STAFF_ROLES is empty, so Faction Leader tickets will/.test(bot) &&
    /match no role/.test(bot) &&
    /Log only: never a/.test(bot) &&
    !/await \w+\.send\([^)]*UPPER_STAFF/.test(bot));

yes('F17 /close on Faction Leader threads lets UPPER_STAFF_ROLES IDs through; is_staff is unchanged',
    /def can_close_ticket\(who, ch\):/.test(bot) &&
    /def holds_upper_staff\(who\):/.test(bot) &&
    /is_staff is unchanged/.test(bot) &&
    /if not can_close_ticket\(interaction\.user, ch\):/.test(bot) &&
    /The one gate on \/close, the Close ticket button/.test(bot));

yes('F18 a half-written Faction Leader thread is deleted as the opened object, never by name',
    bot.indexOf('await opened.delete()') !== -1 &&
    bot.indexOf('forget_ticket(guild, who, opened)') !== -1 &&
    /never one looked up by name/.test(bot));

yes('F9 submit re-checks a known name; Other is not flagged; there is no seat file',
    /faction_pick_is_known\(picked\)/.test(bot) &&
    /Other is a normal option/.test(bot) &&
    bot.indexOf('FACTION_SEATS') === -1 &&
    bot.indexOf('_seats_write') === -1);

yes('F10 the pick and the Other text stay out of the pinging head and Asking for',
    /head = '%s opened this\. %s'/.test(bot) &&
    /'faction':\s+'Faction Lead of the faction named below'/.test(bot) &&
    /The pick and the Other box stay out of the opening line/.test(bot));

yes('F11 the panel uses Djinn\'s confirmed staff-rule sentence and does not say apply for the Trading Company',
    bot.indexOf(STAFF_RULE) !== -1 &&
    /STAFF_LEADERSHIP_RULE/.test(bot) &&
    !/Applying for the Trading Company/.test(bot) &&
    !/Apply: Trading Company/.test(bot) &&
    bot.indexOf('Staff cannot hold a Jarl seat or a faction lead.') === -1);

yes('F12 the site inbox still stores any ticket kind as a free string',
    /ticket: String\(o\.kind \|\| ''\)\.slice\(0, 20\)/.test(site));

yes('F13 the trading company page no longer says Apply: Trading Company',
    page.indexOf('Apply: Trading Company') === -1 &&
    /Apply:\s*\nFaction Leader|Apply: Faction Leader/.test(page) &&
    /Trading Company/.test(page) &&
    page.indexOf('/faction-seat') === -1);

yes('F14 the factions page names the lead seats and the confirmed staff rule, with no seat command',
    /Apply: Faction Leader/.test(factions) &&
    factions.indexOf(STAFF_RULE) !== -1 &&
    factions.indexOf('/faction-seat') === -1 &&
    /does not make a new Discord role/.test(factions));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
